import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type OmitPartialGroupDMChannel,
} from "discord.js";
import config from "../server/config.ts";
import { importFromUrl, extensionFromFilename } from "../server/importer.ts";
import { toError } from "../server/errors.ts";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const MEDIA_CONTENT_TYPES = /^(image\/gif|image\/webp|video\/mp4)/i;
const MEDIA_EXTENSIONS = /\.(gif|webp|mp4)(\?|$)/i;

export interface AttachmentLike {
  url: string;
  contentType: string | null;
  name: string | null;
}

export function extractContentUrls(content: string): string[] {
  return content.match(URL_PATTERN) ?? [];
}

export function extractAttachmentUrls(attachments: AttachmentLike[]): string[] {
  return attachments
    .filter(
      (attachment) =>
        (attachment.contentType && MEDIA_CONTENT_TYPES.test(attachment.contentType)) ||
        MEDIA_EXTENSIONS.test(attachment.name || "") ||
        MEDIA_EXTENSIONS.test(attachment.url),
    )
    .map((attachment) => attachment.url);
}

export function isAuthorAllowed(authorId: string, allowedUserIds: string[]): boolean {
  return allowedUserIds.includes(authorId);
}

export function isChannelAllowed(channelId: string, allowedChannelIds: string[]): boolean {
  return allowedChannelIds.length === 0 || allowedChannelIds.includes(channelId);
}

export function buildShareUrl(slug: string, filename: string): string {
  const origin = config.DISCORD_PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
  return `${origin}${config.BASE_PATH}/share/${slug}.${extensionFromFilename(filename)}`;
}

async function handleMessage(message: OmitPartialGroupDMChannel<Message>): Promise<void> {
  if (message.author.bot) {
    return;
  }
  if (!isAuthorAllowed(message.author.id, config.DISCORD_ALLOWED_USER_IDS)) {
    return;
  }
  if (!isChannelAllowed(message.channelId, config.DISCORD_CHANNEL_IDS)) {
    return;
  }

  const attachmentUrls = extractAttachmentUrls([...message.attachments.values()]);
  const contentUrls = extractContentUrls(message.content).filter(
    (url) => !attachmentUrls.includes(url),
  );

  if (attachmentUrls.length === 0 && contentUrls.length === 0) {
    return;
  }

  await message.react("⏳").catch(() => {});

  const lines: string[] = [];
  for (const url of attachmentUrls) {
    const result = await importFromUrl(url, { trusted: true });
    lines.push(
      result.success && result.slug && result.filename
        ? `✅ ${buildShareUrl(result.slug, result.filename)}`
        : `❌ attachment failed: ${result.error || "unknown error"}`,
    );
  }
  for (const url of contentUrls) {
    const result = await importFromUrl(url);
    lines.push(
      result.success && result.slug && result.filename
        ? `✅ ${buildShareUrl(result.slug, result.filename)}`
        : `❌ <${url}> failed: ${result.error || "unknown error"}`,
    );
  }

  await message.reply({ content: lines.join("\n") }).catch((err: unknown) => {
    console.error(`[discord] failed to reply: ${toError(err).message}`);
  });
}

let client: Client | null = null;

export function startDiscordBot(): void {
  if (!config.DISCORD_BOT_TOKEN) {
    return;
  }
  if (config.DISCORD_ALLOWED_USER_IDS.length === 0) {
    console.warn(
      "[discord] DISCORD_BOT_TOKEN is set but DISCORD_ALLOWED_USER_IDS is empty; the bot will ignore all messages.",
    );
  }
  if (!config.DISCORD_PUBLIC_ORIGIN) {
    console.warn(
      "[discord] DISCORD_PUBLIC_ORIGIN is not set; share links will point at localhost.",
    );
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[discord] logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((err: unknown) => {
      console.error(`[discord] message handling failed: ${toError(err).message}`);
    });
  });

  client.login(config.DISCORD_BOT_TOKEN).catch((err: unknown) => {
    console.error(`[discord] login failed: ${toError(err).message}`);
    client = null;
  });
}

export async function stopDiscordBot(): Promise<void> {
  if (client) {
    await client.destroy().catch(() => {});
    client = null;
  }
}
