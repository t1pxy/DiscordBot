import "dotenv/config";

export const token = process.env.DISCORD_TOKEN;
export const clientId = process.env.DISCORD_CLIENT_ID;
export const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
}

export const TZ = process.env.TIMEZONE || "Asia/Bangkok";
export const REMINDER_MS = Math.max(1, Number(process.env.REMINDER_MINUTES || 10)) * 60_000;
