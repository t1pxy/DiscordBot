export type RsvpStatus = "yes" | "no" | "maybe";

export type MeetingStatus = "scheduled" | "cancelled";

export interface Meeting {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  title: string;
  description: string | null;
  starts_at: number;
  status: MeetingStatus;
  reminder_sent: number;
  created_at: number;
}

export interface RsvpCounts {
  yes: number;
  no: number;
  maybe: number;
}
