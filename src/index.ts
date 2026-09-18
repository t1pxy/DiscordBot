import { Client, Events, GatewayIntentBits } from "discord.js";
import { TZ, token } from "./config.js";
import { deployCommands } from "./deployCommands.js";
import { handleMeetingButton, handleMeetingCommand, handleMeetingModal, handleMeetingSelect } from "./commands/meeting.js";
import { startReminderScheduler } from "./lib/reminderScheduler.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🤖 ${readyClient.user.tag} online | TZ=${TZ}`);
  await deployCommands();
  console.log("Slash commands deployed.");
  startReminderScheduler(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleMeetingCommand(interaction);
    else if (interaction.isButton()) await handleMeetingButton(interaction);
    else if (interaction.isModalSubmit()) await handleMeetingModal(interaction);
    else if (interaction.isStringSelectMenu()) await handleMeetingSelect(interaction);
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ เกิดข้อผิดพลาด กรุณาลองใหม่", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(token);
