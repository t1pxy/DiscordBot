import "dotenv/config";
import {
  Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChatInputCommandInteraction, ButtonInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, Role
} from "discord.js";
import { db } from "./db.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");

const TZ = process.env.TIMEZONE || "Asia/Bangkok";
const REMINDER = Math.max(1, Number(process.env.REMINDER_MINUTES || 10)) * 60_000;

const commands = [
  new SlashCommandBuilder()
    .setName("meeting")
    .setDescription("ระบบนัดประชุม")
    .addSubcommand(s => s.setName("create").setDescription("สร้างนัดประชุม")
      .addStringOption(o => o.setName("title").setDescription("หัวข้อ").setRequired(true))
      .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
      .addStringOption(o => o.setName("time").setDescription("HH:mm เวลาไทย").setRequired(true))
      .addStringOption(o => o.setName("description").setDescription("รายละเอียด").setRequired(false))
      .addRoleOption(o => o.setName("role1").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption(o => o.setName("role2").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption(o => o.setName("role3").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption(o => o.setName("role4").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption(o => o.setName("role5").setDescription("Role ที่ต้องการ Mention").setRequired(false)))
    .addSubcommand(s => s.setName("list").setDescription("ดูนัดที่กำลังจะมาถึง"))
    .addSubcommand(s => s.setName("view").setDescription("ดูรายละเอียดนัด")
      .addIntegerOption(o => o.setName("id").setDescription("Meeting ID").setRequired(true)))
    .addSubcommand(s => s.setName("my").setDescription("ดูนัดที่ฉันตอบรับ"))
    .addSubcommand(s => s.setName("cancel").setDescription("ยกเลิกนัด")
      .addIntegerOption(o => o.setName("id").setDescription("Meeting ID").setRequired(true)))
    .addSubcommand(s => s.setName("remind").setDescription("ส่ง Reminder ทันที")
      .addIntegerOption(o => o.setName("id").setDescription("Meeting ID").setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .toJSON()
];

async function deploy() {
  const rest = new REST({ version: "10" }).setToken(token!);
  const body = [commands[0]];
  if (process.env.DISCORD_GUILD_ID)
    await rest.put(Routes.applicationGuildCommands(clientId!, process.env.DISCORD_GUILD_ID), { body });
  else
    await rest.put(Routes.applicationCommands(clientId!), { body });
}

function parseThaiDate(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y,m,d] = date.split("-").map(Number);
  const [hh,mm] = time.split(":").map(Number);
  if (m<1||m>12||d<1||d>31||hh<0||hh>23||mm<0||mm>59) return null;
  return Date.UTC(y,m-1,d,hh-7,mm);
}

function discordTime(ms: number) {
  return `<t:${Math.floor(ms/1000)}:F> (<t:${Math.floor(ms/1000)}:R>)`;
}

function roleIds(meetingId: number): string[] {
  return (db.prepare("SELECT role_id FROM meeting_roles WHERE meeting_id=?").all(meetingId) as any[]).map(x => x.role_id);
}

function mentionRoles(meetingId: number) {
  const ids = roleIds(meetingId);
  return ids.length ? ids.map(id => `<@&${id}>`).join(" ") : "";
}

function counts(id: number) {
  const get = (s:string) => (db.prepare("SELECT COUNT(*) c FROM meeting_rsvps WHERE meeting_id=? AND status=?").get(id,s) as any).c;
  return { yes:get("yes"), no:get("no"), maybe:get("maybe") };
}

function embedFor(row:any) {
  const c = counts(row.id);
  const roles = roleIds(row.id);
  return new EmbedBuilder()
    .setTitle(`📅 ${row.title}`)
    .setDescription(row.description || "ไม่มีรายละเอียด")
    .addFields(
      {name:"🕐 เวลา", value:discordTime(row.starts_at), inline:false},
      {name:"🎯 Role", value:roles.length ? roles.map((r:string)=>`<@&${r}>`).join(" ") : "ไม่มี", inline:false},
      {name:"👤 ผู้สร้าง", value:`<@${row.creator_id}>`, inline:true},
      {name:"📊 ตอบรับ", value:`✅ ${c.yes}  ❌ ${c.no}  ❓ ${c.maybe}`, inline:true}
    )
    .setFooter({text:`Meeting #${row.id} • ${TZ} • ${row.status === "cancelled" ? "CANCELLED" : "Scheduled"}`});
}

function buttons(id:number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`meeting:${id}:yes`).setLabel("เข้าร่วม").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`meeting:${id}:no`).setLabel("ไม่ว่าง").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`meeting:${id}:maybe`).setLabel("อาจเข้าร่วม").setEmoji("❓").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`meeting:${id}:list`).setLabel("รายชื่อ").setEmoji("👥").setStyle(ButtonStyle.Primary)
  );
}

async function refresh(row:any) {
  if (!row.message_id) return;
  try {
    const ch=await client.channels.fetch(row.channel_id);
    if (!ch?.isTextBased()) return;
    const msg=await ch.messages.fetch(row.message_id);
    await msg.edit({embeds:[embedFor(row)],components:row.status==="scheduled"?[buttons(row.id)]:[]});
  } catch {}
}

async function sendReminder(row:any, manual=false) {
  try {
    const ch=await client.channels.fetch(row.channel_id);
    if (!ch?.isSendable()) return false;
    const prefix=mentionRoles(row.id);
    await ch.send({
      content: `${prefix}${prefix ? "\\n" : ""}🔔 **Meeting Reminder**`,
      embeds: [new EmbedBuilder().setTitle(`📅 ${row.title}`).setDescription(`เริ่ม ${discordTime(row.starts_at)}\\nอีก ${REMINDER/60000} นาทีจะถึงเวลาประชุม${manual ? "\\n\\n⚡ ส่ง Reminder โดย Admin" : ""}`).setTimestamp()]
    });
    if (!manual) db.prepare("UPDATE meetings SET reminder_sent=1 WHERE id=?").run(row.id);
    return true;
  } catch { return false; }
}

client.once(Events.ClientReady, async c => {
  console.log(`🤖 ${c.user.tag} online | TZ=${TZ}`);
  await deploy();
  setInterval(reminderLoop, 30_000);
  console.log("Slash commands deployed.");
});

async function reminderLoop() {
  const now=Date.now(), until=now+REMINDER;
  const rows=db.prepare("SELECT * FROM meetings WHERE status='scheduled' AND reminder_sent=0 AND starts_at>? AND starts_at<=?").all(now,until) as any[];
  for(const row of rows) await sendReminder(row);
}

client.on(Events.InteractionCreate, async interaction => {
  if(interaction.isChatInputCommand()) await handleCommand(interaction);
  else if(interaction.isButton()) await handleButton(interaction);
});

async function handleCommand(i:ChatInputCommandInteraction) {
  if(!i.guild) return;
  const sub=i.options.getSubcommand();

  if(sub==="create") {
    const title=i.options.getString("title",true);
    const date=i.options.getString("date",true);
    const time=i.options.getString("time",true);
    const description=i.options.getString("description");
    const starts=parseThaiDate(date,time);
    if(!starts || starts<=Date.now()) return void await i.reply({content:"❌ วัน/เวลาไม่ถูกต้องหรือเป็นอดีต ใช้ YYYY-MM-DD และ HH:mm (เวลาไทย)",ephemeral:true});

    const roles=Array.from({length:5},(_,n)=>i.options.getRole(`role${n+1}`)).filter((r): r is Role => !!r);
    const unique=[...new Map(roles.map(r=>[r.id,r])).values()];
    const result=db.prepare("INSERT INTO meetings (guild_id,channel_id,creator_id,title,description,starts_at,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(i.guild.id,i.channelId,i.user.id,title,description||null,starts,Date.now());
    const id=Number(result.lastInsertRowid);
    const insertRole=db.prepare("INSERT OR IGNORE INTO meeting_roles (meeting_id,role_id) VALUES (?,?)");
    const tx=db.transaction((rs:Role[])=>{for(const r of rs)insertRole.run(id,r.id)}); tx(unique);

    const row=db.prepare("SELECT * FROM meetings WHERE id=?").get(id) as any;
    if (!i.channel?.isSendable()) {
      return void await i.reply({content:"❌ Channel นี้ไม่รองรับการส่งข้อความ",ephemeral:true});
    }

    const msg = await i.channel.send({
      content: mentionRoles(id),
      embeds: [embedFor(row)],
      components: [buttons(id)],
      allowedMentions: { roles: unique.map(r => r.id) }
    });
    if(msg) db.prepare("UPDATE meetings SET message_id=? WHERE id=?").run(msg.id,id);
    return void await i.reply({content:`✅ สร้าง Meeting #${id} แล้ว — ${discordTime(starts)}${unique.length?`\\n🎯 Mention ${unique.length} Role`: ""}`,ephemeral:true});
  }

  if(sub==="list") {
    const rows=db.prepare("SELECT * FROM meetings WHERE guild_id=? AND status='scheduled' AND starts_at>? ORDER BY starts_at LIMIT 20").all(i.guild.id,Date.now()) as any[];
    if(!rows.length) return void await i.reply("📭 ยังไม่มีนัดประชุม");
    const text=rows.map(r=>`**#${r.id} ${r.title}** — ${discordTime(r.starts_at)}${mentionRoles(r.id)?`\\n${mentionRoles(r.id)}`:""}`).join("\\n\\n");
    return void await i.reply({embeds:[new EmbedBuilder().setTitle("📅 นัดประชุม").setDescription(text)]});
  }

  if(sub==="view") {
    const id=i.options.getInteger("id",true);
    const row=db.prepare("SELECT * FROM meetings WHERE id=? AND guild_id=?").get(id,i.guild.id) as any;
    if(!row) return void await i.reply({content:"❌ ไม่พบ Meeting",ephemeral:true});
    return void await i.reply({content:mentionRoles(id),embeds:[embedFor(row)],allowedMentions:{parse:["roles"]}});
  }

  if(sub==="my") {
    const rows=db.prepare("SELECT m.* FROM meetings m JOIN meeting_rsvps r ON r.meeting_id=m.id WHERE m.guild_id=? AND r.user_id=? AND r.status='yes' AND m.starts_at>? ORDER BY m.starts_at").all(i.guild.id,i.user.id,Date.now()) as any[];
    if(!rows.length) return void await i.reply("📭 ยังไม่มีนัดที่คุณตอบรับ");
    return void await i.reply(rows.map(r=>`**#${r.id} ${r.title}** — ${discordTime(r.starts_at)}`).join("\\n"));
  }

  if(sub==="cancel") {
    const id=i.options.getInteger("id",true);
    const row=db.prepare("SELECT * FROM meetings WHERE id=? AND guild_id=?").get(id,i.guild.id) as any;
    if(!row) return void await i.reply({content:"❌ ไม่พบ Meeting",ephemeral:true});
    if(row.creator_id!==i.user.id && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return void await i.reply({content:"❌ เฉพาะผู้สร้างหรือ Admin",ephemeral:true});
    db.prepare("UPDATE meetings SET status='cancelled' WHERE id=?").run(id);
    await refresh({...row,status:"cancelled"});
    return void await i.reply(`🛑 ยกเลิก Meeting #${id} แล้ว`);
  }

  if(sub==="remind") {
    const id=i.options.getInteger("id",true);
    const row=db.prepare("SELECT * FROM meetings WHERE id=? AND guild_id=? AND status='scheduled'").get(id,i.guild.id) as any;
    if(!row) return void await i.reply({content:"❌ ไม่พบ Meeting",ephemeral:true});
    const ok=await sendReminder(row,true);
    return void await i.reply(ok?"🔔 ส่ง Reminder แล้ว":"❌ ส่ง Reminder ไม่สำเร็จ");
  }
}

async function handleButton(i:ButtonInteraction) {
  const [kind,idRaw,action]=i.customId.split(":");
  if(kind!=="meeting") return;
  const id=Number(idRaw);
  const row=db.prepare("SELECT * FROM meetings WHERE id=?").get(id) as any;
  if(!row || row.status!=="scheduled") return void await i.reply({content:"❌ Meeting นี้ถูกยกเลิกแล้ว",ephemeral:true});

  if(action==="list") {
    const users=db.prepare("SELECT user_id,status FROM meeting_rsvps WHERE meeting_id=?").all(id) as any[];
    const groups:any={yes:[],maybe:[],no:[]};
    for(const u of users) groups[u.status]?.push(`<@${u.user_id}>`);
    return void await i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle(`👥 Meeting #${id}`).setDescription(`✅ **เข้าร่วม**\\n${groups.yes.join(", ")||"-"}\\n\\n❓ **อาจเข้าร่วม**\\n${groups.maybe.join(", ")||"-"}\\n\\n❌ **ไม่ว่าง**\\n${groups.no.join(", ")||"-"}`)]});
  }

  db.prepare(`INSERT INTO meeting_rsvps (meeting_id,user_id,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(meeting_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`)
    .run(id,i.user.id,action,Date.now());
  await refresh(row);
  const label=action==="yes"?"เข้าร่วม":action==="no"?"ไม่ว่าง":"อาจเข้าร่วม";
  await i.reply({content:`บันทึก **${label}** สำหรับ Meeting #${id} แล้ว`,ephemeral:true});
}

client.login(token);