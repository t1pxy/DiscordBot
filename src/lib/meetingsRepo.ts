import type { Role } from "discord.js";
import { db } from "../db.js";
import type { Meeting, RsvpCounts, RsvpStatus } from "../types.js";

export function getMeeting(id: number, guildId?: string): Meeting | undefined {
  return guildId
    ? (db.prepare("SELECT * FROM meetings WHERE id=? AND guild_id=?").get(id, guildId) as Meeting | undefined)
    : (db.prepare("SELECT * FROM meetings WHERE id=?").get(id) as Meeting | undefined);
}

export function listUpcomingMeetings(guildId: string): Meeting[] {
  return db
    .prepare("SELECT * FROM meetings WHERE guild_id=? AND status='scheduled' AND starts_at>? ORDER BY starts_at LIMIT 20")
    .all(guildId, Date.now()) as Meeting[];
}

export function listMyUpcomingMeetings(guildId: string, userId: string): Meeting[] {
  return db
    .prepare(
      `SELECT m.* FROM meetings m
       JOIN meeting_rsvps r ON r.meeting_id = m.id
       WHERE m.guild_id=? AND r.user_id=? AND r.status='yes' AND m.starts_at>?
       ORDER BY m.starts_at`
    )
    .all(guildId, userId, Date.now()) as Meeting[];
}

export function listDueReminders(now: number, until: number): Meeting[] {
  return db
    .prepare("SELECT * FROM meetings WHERE status='scheduled' AND reminder_sent=0 AND starts_at>? AND starts_at<=?")
    .all(now, until) as Meeting[];
}

export function createMeeting(params: {
  guildId: string;
  channelId: string;
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: number;
  roles: Role[];
}): Meeting {
  const result = db
    .prepare(
      "INSERT INTO meetings (guild_id,channel_id,creator_id,title,description,starts_at,created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(params.guildId, params.channelId, params.creatorId, params.title, params.description, params.startsAt, Date.now());

  const id = Number(result.lastInsertRowid);
  const insertRole = db.prepare("INSERT OR IGNORE INTO meeting_roles (meeting_id,role_id) VALUES (?,?)");
  db.transaction((roles: Role[]) => {
    for (const role of roles) insertRole.run(id, role.id);
  })(params.roles);

  return getMeeting(id)!;
}

export function setMeetingMessageId(id: number, messageId: string): void {
  db.prepare("UPDATE meetings SET message_id=? WHERE id=?").run(messageId, id);
}

export function cancelMeeting(id: number): void {
  db.prepare("UPDATE meetings SET status='cancelled' WHERE id=?").run(id);
}

export function markReminderSent(id: number): void {
  db.prepare("UPDATE meetings SET reminder_sent=1 WHERE id=?").run(id);
}

export function upsertRsvp(meetingId: number, userId: string, status: RsvpStatus): void {
  db.prepare(
    `INSERT INTO meeting_rsvps (meeting_id,user_id,status,updated_at) VALUES (?,?,?,?)
     ON CONFLICT(meeting_id,user_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`
  ).run(meetingId, userId, status, Date.now());
}

export function listRsvps(meetingId: number): { user_id: string; status: RsvpStatus }[] {
  return db.prepare("SELECT user_id,status FROM meeting_rsvps WHERE meeting_id=?").all(meetingId) as {
    user_id: string;
    status: RsvpStatus;
  }[];
}

export function getRsvpCounts(meetingId: number): RsvpCounts {
  const count = (status: RsvpStatus) =>
    (db.prepare("SELECT COUNT(*) c FROM meeting_rsvps WHERE meeting_id=? AND status=?").get(meetingId, status) as { c: number }).c;
  return { yes: count("yes"), no: count("no"), maybe: count("maybe") };
}

export function getMeetingRoleIds(meetingId: number): string[] {
  return (db.prepare("SELECT role_id FROM meeting_roles WHERE meeting_id=?").all(meetingId) as { role_id: string }[]).map(
    (row) => row.role_id
  );
}

export function mentionRoles(meetingId: number): string {
  return getMeetingRoleIds(meetingId)
    .map((id) => `<@&${id}>`)
    .join(" ");
}
