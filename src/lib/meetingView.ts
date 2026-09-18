import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from "discord.js";
import { TZ, REMINDER_MS } from "../config.js";
import { getMeetingRoleIds, getRsvpCounts, mentionRoles, markReminderSent } from "./meetingsRepo.js";
import { discordTime } from "./time.js";
import type { Meeting } from "../types.js";

export function buildMeetingEmbed(meeting: Meeting): EmbedBuilder {
  const counts = getRsvpCounts(meeting.id);
  const roleIds = getMeetingRoleIds(meeting.id);

  return new EmbedBuilder()
    .setTitle(`📅 ${meeting.title}`)
    .setDescription(meeting.description || "ไม่มีรายละเอียด")
    .addFields(
      { name: "🕐 เวลา", value: discordTime(meeting.starts_at), inline: false },
      { name: "🎯 Role", value: roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(" ") : "ไม่มี", inline: false },
      { name: "👤 ผู้สร้าง", value: `<@${meeting.creator_id}>`, inline: true },
      { name: "📊 ตอบรับ", value: `✅ ${counts.yes}  ❌ ${counts.no}  ❓ ${counts.maybe}`, inline: true }
    )
    .setFooter({ text: `Meeting #${meeting.id} • ${TZ} • ${meeting.status === "cancelled" ? "CANCELLED" : "Scheduled"}` });
}

export function buildRsvpButtons(meetingId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`meeting:${meetingId}:yes`).setLabel("เข้าร่วม").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`meeting:${meetingId}:no`).setLabel("ไม่ว่าง").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`meeting:${meetingId}:maybe`).setLabel("อาจเข้าร่วม").setEmoji("❓").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`meeting:${meetingId}:list`).setLabel("รายชื่อ").setEmoji("👥").setStyle(ButtonStyle.Primary)
  );
}

/** Re-renders a meeting's announcement message to reflect its current status and RSVP counts. */
export async function refreshMeetingMessage(client: Client, meeting: Meeting): Promise<void> {
  if (!meeting.message_id) return;
  try {
    const channel = await client.channels.fetch(meeting.channel_id);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(meeting.message_id);
    await message.edit({
      embeds: [buildMeetingEmbed(meeting)],
      components: meeting.status === "scheduled" ? [buildRsvpButtons(meeting.id)] : [],
    });
  } catch {
    // Message or channel may have been deleted; nothing to refresh.
  }
}

/** Sends a reminder for an upcoming meeting. Marks it as sent unless triggered manually. */
export async function sendMeetingReminder(client: Client, meeting: Meeting, manual = false): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(meeting.channel_id);
    if (!channel?.isSendable()) return false;

    const rolePrefix = mentionRoles(meeting.id);
    const minutesLeft = REMINDER_MS / 60_000;
    const description = [
      `เริ่ม ${discordTime(meeting.starts_at)}`,
      `อีก ${minutesLeft} นาทีจะถึงเวลาประชุม`,
      manual ? "\n⚡ ส่ง Reminder โดย Admin" : "",
    ]
      .filter(Boolean)
      .join("\n");

    await channel.send({
      content: `${rolePrefix}${rolePrefix ? "\n" : ""}🔔 **Meeting Reminder**`,
      embeds: [new EmbedBuilder().setTitle(`📅 ${meeting.title}`).setDescription(description).setTimestamp()],
    });

    if (!manual) markReminderSent(meeting.id);
    return true;
  } catch {
    return false;
  }
}
