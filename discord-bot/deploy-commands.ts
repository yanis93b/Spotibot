/**
 * deploy-commands.ts
 *
 * Registers SpotiBot's slash commands with the Discord Application API.
 * Run once (or whenever the command schema changes) via:
 *   bun run deploy-commands
 *
 * Required env:
 *   DISCORD_TOKEN      — bot token from the Discord Developer Portal
 *   DISCORD_CLIENT_ID  — the application's OAuth2 client id (Application ID)
 *
 * Optional env:
 *   DISCORD_GUILD_ID   — if set, registers commands as GUILD commands (instant,
 *                        good for dev). If omitted, registers as GLOBAL commands
 *                        (1-hour propagation delay, available everywhere).
 */

import { REST, Routes, SlashCommandBuilder } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // optional — dev-only fast path

if (!token) {
  console.error("[deploy-commands] Missing env DISCORD_TOKEN");
  process.exit(1);
}
if (!clientId) {
  console.error("[deploy-commands] Missing env DISCORD_CLIENT_ID");
  process.exit(1);
}

// ─── /generate ─────────────────────────────────────────────────────────────
const generate = new SlashCommandBuilder()
  .setName("generate")
  .setDescription("Generate an original song with SpotiBot's Ace Music engine.")
  .addStringOption((o) =>
    o
      .setName("prompt")
      .setDescription("Describe the song you want (e.g. 'a rainy-night jazz ballad about Tokyo').")
      .setRequired(true)
      .setMaxLength(900)
  )
  .addStringOption((o) =>
    o
      .setName("genre")
      .setDescription("Musical genre.")
      .setRequired(false)
      .setChoices(
        { name: "Pop", value: "pop" },
        { name: "Rock", value: "rock" },
        { name: "Hip Hop", value: "hiphop" },
        { name: "Electronic", value: "electronic" },
        { name: "Jazz", value: "jazz" },
        { name: "Classical", value: "classical" },
        { name: "R&B", value: "rnb" },
        { name: "Folk", value: "folk" },
        { name: "Metal", value: "metal" },
        { name: "Ambient", value: "ambient" }
      )
  )
  .addStringOption((o) =>
    o
      .setName("mood")
      .setDescription("Emotional tone of the track.")
      .setRequired(false)
      .setChoices(
        { name: "Happy", value: "happy" },
        { name: "Sad", value: "sad" },
        { name: "Energetic", value: "energetic" },
        { name: "Calm", value: "calm" },
        { name: "Dark", value: "dark" },
        { name: "Romantic", value: "romantic" },
        { name: "Epic", value: "epic" },
        { name: "Dreamy", value: "dreamy" }
      )
  )
  .addStringOption((o) =>
    o
      .setName("style")
      .setDescription("Vocal / arrangement style.")
      .setRequired(false)
      .setMaxLength(120)
  )
  .addIntegerOption((o) =>
    o
      .setName("duration")
      .setDescription("Target duration in seconds (10–180). Defaults to 90.")
      .setRequired(false)
      .setMinValue(10)
      .setMaxValue(180)
  );

// ─── /status ───────────────────────────────────────────────────────────────
const status = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Check the status of a generation job.")
  .addStringOption((o) =>
    o
      .setName("jobid")
      .setDescription("The job id returned by /generate.")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(120)
  );

// ─── /library ──────────────────────────────────────────────────────────────
const library = new SlashCommandBuilder()
  .setName("library")
  .setDescription("List the songs you've generated through SpotiBot.");

const commands = [generate, status, library].map((c) => c.toJSON());

async function main(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token!);

  try {
    console.log(
      `[deploy-commands] Registering ${commands.length} application (/) commands${
        guildId ? ` to guild ${guildId}` : " globally"
      }…`
    );

    const route = guildId
      ? Routes.applicationGuildCommands(clientId!, guildId)
      : Routes.applicationCommands(clientId!);

    // PUT replaces all commands on the target scope with this set — idempotent.
    const data = (await rest.put(route, { body: commands })) as Array<{ id: string; name: string }>;

    console.log(
      `[deploy-commands] ✓ Registered ${data.length} command(s): ${data
        .map((c) => `/${c.name}`)
        .join(", ")}`
    );
  } catch (err) {
    console.error("[deploy-commands] ✗ Failed to register commands:", err);
    process.exitCode = 1;
  }
}

main();
