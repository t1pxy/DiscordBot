import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type Role,
  type Guild,
  type RepliableInteraction,
} from "discord.js";
import { EmbedBuilder } from "discord.js";
import { discordTime, parseThaiDate } from "../lib/time.js";
import { buildMeetingEmbed, buildRsvpButtons, refreshMeetingMessage, sendMeetingReminder } from "../lib/meetingView.js";
import {
  cancelMeeting,
  createMeeting,
  getMeeting,
  listMyUpcomingMeetings,
  listRsvps,
  listUpcomingMeetings,
  mentionRoles,
  setMeetingMessageId,
  upsertRsvp,
} from "../lib/meetingsRepo.js";
import type { RsvpStatus } from "../types.js";

const MAX_MENTIONABLE_ROLES = 5;
const ROLE_ID_PATTERN = /\d{15,20}/g;

export const meetingCommand = new SlashCommandBuilder()
  .setName("meeting")
  .setDescription("ระบบนัดประชุม")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("สร้างนัดประชุม")
      .addStringOption((o) => o.setName("title").setDescription("หัวข้อ").setRequired(true))
      .addStringOption((o) => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
      .addStringOption((o) => o.setName("time").setDescription("HH:mm เวลาไทย").setRequired(true))
      .addStringOption((o) => o.setName("description").setDescription("รายละเอียด").setRequired(false))
      .addRoleOption((o) => o.setName("role1").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption((o) => o.setName("role2").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption((o) => o.setName("role3").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption((o) => o.setName("role4").setDescription("Role ที่ต้องการ Mention").setRequired(false))
      .addRoleOption((o) => o.setName("role5").setDescription("Role ที่ต้องการ Mention").setRequired(false))
  )
  .addSubcommand((s) => s.setName("list").setDescription("ดูนัดที่กำลังจะมาถึง"))
  .addSubcommand((s) =>
    s.setName("view").setDescription("ดูรายละเอียดนัด").addIntegerOption((o) => o.setName("id").setDescription("Meeting ID").setRequired(true))
  )
  .addSubcommand((s) => s.setName("my").setDescription("ดูนัดที่ฉันตอบรับ"))
  .addSubcommand((s) =>
    s.setName("cancel").setDescription("ยกเลิกนัด").addIntegerOption((o) => o.setName("id").setDescription("Meeting ID").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("remind")
      .setDescription("ส่ง Reminder ทันที")
      .addIntegerOption((o) => o.setName("id").setDescription("Meeting ID").setRequired(true))
  )
  .addSubcommand((s) => s.setName("panel").setDescription("โพสต์แผงปุ่มสำหรับจัดการนัดประชุมแบบฟอร์ม"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .toJSON();

export async function handleMeetingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  switch (interaction.options.getSubcommand()) {
    case "create":
      return handleCreate(interaction);
    case "list":
      return handleList(interaction);
    case "view":
      return handleView(interaction);
    case "my":
      return handleMy(interaction);
    case "cancel":
      return handleCancel(interaction);
    case "remind":
      return handleRemind(interaction);
    case "panel":
      return handlePanel(interaction);
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const title = interaction.options.getString("title", true);
  const date = interaction.options.getString("date", true);
  const time = interaction.options.getString("time", true);
  const description = interaction.options.getString("description");

  const roles = Array.from({ length: MAX_MENTIONABLE_ROLES }, (_, n) => interaction.options.getRole(`role${n + 1}`)).filter(
    (r): r is Role => !!r
  );

  await performCreateMeeting(interaction, guild, { title, date, time, description, roles });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await performList(interaction, interaction.guild!.id);
}

async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  await performView(interaction, interaction.guild!.id, id);
}

async function handleMy(interaction: ChatInputCommandInteraction): Promise<void> {
  await performMy(interaction, interaction.guild!.id, interaction.user.id);
}

async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  await performCancel(interaction, interaction.guild!.id, id);
}

async function handleRemind(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  await performRemind(interaction, id);
}

async function handlePanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "❌ Channel นี้ไม่รองรับการส่งข้อความ", ephemeral: true });
    return;
  }

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("📅 จัดการนัดประชุม")
        .setDescription("กดปุ่มด้านล่างเพื่อจัดการนัดประชุมผ่านฟอร์ม"),
    ],
    components: [buildPanelRow1(), buildPanelRow2()],
  });
  await interaction.reply({ content: "✅ โพสต์แผงปุ่มแล้ว", ephemeral: true });
}

function buildPanelRow1(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel:create").setLabel("สร้างนัด").setEmoji("📝").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel:list").setLabel("ดูรายการ").setEmoji("📋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel:my").setLabel("นัดของฉัน").setEmoji("🙋").setStyle(ButtonStyle.Primary)
  );
}

function buildPanelRow2(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel:view").setLabel("ดูรายละเอียด").setEmoji("🔍").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel:cancel").setLabel("ยกเลิกนัด").setEmoji("🛑").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("panel:remind").setLabel("ส่ง Reminder").setEmoji("🔔").setStyle(ButtonStyle.Secondary)
  );
}

export async function handleMeetingButton(interaction: ButtonInteraction): Promise<void> {
  const [kind] = interaction.customId.split(":");

  if (kind === "panel") {
    return handlePanelButton(interaction);
  }

  if (kind === "meeting") {
    return handleRsvpButton(interaction);
  }
}

async function handlePanelButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const action = interaction.customId.split(":")[1];

  switch (action) {
    case "create":
      await interaction.showModal(buildCreateModal());
      return;
    case "list":
      await performList(interaction, interaction.guild.id);
      return;
    case "my":
      await performMy(interaction, interaction.guild.id, interaction.user.id);
      return;
    case "view":
    case "cancel":
    case "remind":
      await replyWithMeetingSelect(interaction, action);
      return;
  }
}

function buildCreateModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("meetingform:create")
    .setTitle("สร้างนัดประชุม")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("หัวข้อ").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("date")
          .setLabel("วันที่ (YYYY-MM-DD)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("time").setLabel("เวลา (HH:mm เวลาไทย)").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("รายละเอียด")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("roles")
          .setLabel("Mention Role (พิมพ์ role ID หรือ @role คั่นด้วยช่องว่าง)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

async function replyWithMeetingSelect(interaction: ButtonInteraction, action: "view" | "cancel" | "remind"): Promise<void> {
  const meetings = listUpcomingMeetings(interaction.guild!.id);
  if (!meetings.length) {
    await interaction.reply({ content: "📭 ยังไม่มีนัดประชุม", ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`panelselect:${action}`)
    .setPlaceholder("เลือกนัดประชุม")
    .addOptions(
      meetings.slice(0, 25).map((m) => ({
        label: `#${m.id} ${m.title}`.slice(0, 100),
        description: discordTime(m.starts_at).slice(0, 100),
        value: String(m.id),
      }))
    );

  await interaction.reply({
    content: "เลือกนัดประชุมที่ต้องการ",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleMeetingModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [kind, action] = interaction.customId.split(":");
  if (kind !== "meetingform" || action !== "create") return;

  const title = interaction.fields.getTextInputValue("title");
  const date = interaction.fields.getTextInputValue("date");
  const time = interaction.fields.getTextInputValue("time");
  const description = interaction.fields.getTextInputValue("description") || null;
  const rolesRaw = interaction.fields.getTextInputValue("roles");

  const roleIds = [...new Set(rolesRaw.match(ROLE_ID_PATTERN) ?? [])].slice(0, MAX_MENTIONABLE_ROLES);
  const roles = roleIds.map((id) => interaction.guild!.roles.cache.get(id)).filter((r): r is Role => !!r);

  await performCreateMeeting(interaction, interaction.guild, { title, date, time, description, roles });
}

export async function handleMeetingSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [kind, action] = interaction.customId.split(":");
  if (kind !== "panelselect") return;

  const id = Number(interaction.values[0]);

  switch (action) {
    case "view":
      return performView(interaction, interaction.guild.id, id);
    case "cancel":
      return performCancel(interaction, interaction.guild.id, id);
    case "remind":
      return performRemind(interaction, id);
  }
}

async function performCreateMeeting(
  interaction: RepliableInteraction,
  guild: Guild,
  params: { title: string; date: string; time: string; description: string | null; roles: Role[] }
): Promise<void> {
  const startsAt = parseThaiDate(params.date, params.time);
  if (!startsAt || startsAt <= Date.now()) {
    await interaction.reply({ content: "❌ วัน/เวลาไม่ถูกต้องหรือเป็นอดีต ใช้ YYYY-MM-DD และ HH:mm (เวลาไทย)", ephemeral: true });
    return;
  }

  const uniqueRoles = [...new Map(params.roles.map((r) => [r.id, r])).values()];

  const meeting = createMeeting({
    guildId: guild.id,
    channelId: interaction.channelId!,
    creatorId: interaction.user.id,
    title: params.title,
    description: params.description,
    startsAt,
    roles: uniqueRoles,
  });

  const channel = interaction.channel;
  if (!channel?.isSendable()) {
    await interaction.reply({ content: "❌ Channel นี้ไม่รองรับการส่งข้อความ", ephemeral: true });
    return;
  }

  const message = await channel.send({
    content: mentionRoles(meeting.id),
    embeds: [buildMeetingEmbed(meeting)],
    components: [buildRsvpButtons(meeting.id)],
    allowedMentions: { roles: uniqueRoles.map((r) => r.id) },
  });
  setMeetingMessageId(meeting.id, message.id);

  const roleSummary = uniqueRoles.length ? `\n🎯 Mention ${uniqueRoles.length} Role` : "";
  await interaction.reply({ content: `✅ สร้าง Meeting #${meeting.id} แล้ว — ${discordTime(startsAt)}${roleSummary}`, ephemeral: true });
}

async function performList(interaction: RepliableInteraction, guildId: string): Promise<void> {
  const meetings = listUpcomingMeetings(guildId);
  if (!meetings.length) {
    await interaction.reply({ content: "📭 ยังไม่มีนัดประชุม", ephemeral: interaction.isButton() });
    return;
  }

  const text = meetings
    .map((m) => {
      const roles = mentionRoles(m.id);
      return `**#${m.id} ${m.title}** — ${discordTime(m.starts_at)}${roles ? `\n${roles}` : ""}`;
    })
    .join("\n\n");

  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle("📅 นัดประชุม").setDescription(text)],
    ephemeral: interaction.isButton(),
  });
}

async function performView(interaction: RepliableInteraction, guildId: string, id: number): Promise<void> {
  const meeting = getMeeting(id, guildId);
  if (!meeting) {
    await interaction.reply({ content: "❌ ไม่พบ Meeting", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: mentionRoles(id),
    embeds: [buildMeetingEmbed(meeting)],
    allowedMentions: { parse: ["roles"] },
    ephemeral: interaction.isButton() || interaction.isStringSelectMenu(),
  });
}

async function performMy(interaction: RepliableInteraction, guildId: string, userId: string): Promise<void> {
  const meetings = listMyUpcomingMeetings(guildId, userId);
  if (!meetings.length) {
    await interaction.reply({ content: "📭 ยังไม่มีนัดที่คุณตอบรับ", ephemeral: interaction.isButton() });
    return;
  }

  const text = meetings.map((m) => `**#${m.id} ${m.title}** — ${discordTime(m.starts_at)}`).join("\n");
  await interaction.reply({ content: text, ephemeral: interaction.isButton() });
}

async function performCancel(interaction: RepliableInteraction, guildId: string, id: number): Promise<void> {
  const meeting = getMeeting(id, guildId);
  if (!meeting) {
    await interaction.reply({ content: "❌ ไม่พบ Meeting", ephemeral: true });
    return;
  }

  const isOwner = meeting.creator_id === interaction.user.id;
  const isAdmin = "memberPermissions" in interaction && (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false);
  if (!isOwner && !isAdmin) {
    await interaction.reply({ content: "❌ เฉพาะผู้สร้างหรือ Admin", ephemeral: true });
    return;
  }

  cancelMeeting(id);
  await refreshMeetingMessage(interaction.client, { ...meeting, status: "cancelled" });
  await interaction.reply({ content: `🛑 ยกเลิก Meeting #${id} แล้ว`, ephemeral: interaction.isButton() || interaction.isStringSelectMenu() });
}

async function performRemind(interaction: RepliableInteraction, id: number): Promise<void> {
  const meeting = getMeeting(id);
  if (!meeting || meeting.status !== "scheduled") {
    await interaction.reply({ content: "❌ ไม่พบ Meeting", ephemeral: true });
    return;
  }

  const sent = await sendMeetingReminder(interaction.client, meeting, true);
  await interaction.reply({
    content: sent ? "🔔 ส่ง Reminder แล้ว" : "❌ ส่ง Reminder ไม่สำเร็จ",
    ephemeral: interaction.isButton() || interaction.isStringSelectMenu(),
  });
}

async function handleRsvpButton(interaction: ButtonInteraction): Promise<void> {
  const [, idRaw, action] = interaction.customId.split(":");

  const id = Number(idRaw);
  const meeting = getMeeting(id);
  if (!meeting || meeting.status !== "scheduled") {
    await interaction.reply({ content: "❌ Meeting นี้ถูกยกเลิกแล้ว", ephemeral: true });
    return;
  }

  if (action === "list") {
    const rsvps = listRsvps(id);
    const groups: Record<RsvpStatus, string[]> = { yes: [], no: [], maybe: [] };
    for (const rsvp of rsvps) groups[rsvp.status].push(`<@${rsvp.user_id}>`);

    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle(`👥 Meeting #${id}`)
          .setDescription(
            [
              "✅ **เข้าร่วม**",
              groups.yes.join(", ") || "-",
              "",
              "❓ **อาจเข้าร่วม**",
              groups.maybe.join(", ") || "-",
              "",
              "❌ **ไม่ว่าง**",
              groups.no.join(", ") || "-",
            ].join("\n")
          ),
      ],
    });
    return;
  }

  const status = action as RsvpStatus;
  upsertRsvp(id, interaction.user.id, status);
  await refreshMeetingMessage(interaction.client, meeting);

  const label = status === "yes" ? "เข้าร่วม" : status === "no" ? "ไม่ว่าง" : "อาจเข้าร่วม";
  await interaction.reply({ content: `บันทึก **${label}** สำหรับ Meeting #${id} แล้ว`, ephemeral: true });
}
