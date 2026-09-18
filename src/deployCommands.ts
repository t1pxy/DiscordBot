import { REST, Routes } from "discord.js";
import { clientId, guildId, token } from "./config.js";
import { meetingCommand } from "./commands/meeting.js";

export async function deployCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token!);
  const body = [meetingCommand];

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body });
  } else {
    await rest.put(Routes.applicationCommands(clientId!), { body });
  }
}
