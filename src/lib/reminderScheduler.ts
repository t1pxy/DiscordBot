import type { Client } from "discord.js";
import { REMINDER_MS } from "../config.js";
import { listDueReminders } from "./meetingsRepo.js";
import { sendMeetingReminder } from "./meetingView.js";

const CHECK_INTERVAL_MS = 30_000;

/** Polls for meetings starting within the reminder window and sends reminders for them. */
export function startReminderScheduler(client: Client): void {
  setInterval(async () => {
    const now = Date.now();
    const dueMeetings = listDueReminders(now, now + REMINDER_MS);
    for (const meeting of dueMeetings) {
      await sendMeetingReminder(client, meeting);
    }
  }, CHECK_INTERVAL_MS);
}
