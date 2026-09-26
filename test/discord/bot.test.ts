import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Client, Events } from "discord.js";
import { tempEnv } from "../server/helpers.ts";

tempEnv();
process.env.DISCORD_BOT_TOKEN = "fake-token";
delete process.env.DISCORD_ALLOWED_USER_IDS;
delete process.env.DISCORD_PUBLIC_ORIGIN;

const { startDiscordBot, stopDiscordBot } = await import("../../src/discord/discord.ts");

interface Captured {
  logs: string[];
  warnings: string[];
  errors: string[];
}

function captureConsole(): Captured {
  const captured: Captured = { logs: [], warnings: [], errors: [] };
  mock.method(console, "log", (msg: string) => captured.logs.push(msg));
  mock.method(console, "warn", (msg: string) => captured.warnings.push(msg));
  mock.method(console, "error", (msg: string) => captured.errors.push(msg));
  return captured;
}

function stubLogin(
  result: () => Promise<string>,
  destroyImpl: () => Promise<void> = async () => {},
) {
  const clients: Client[] = [];
  const login = mock.method(Client.prototype, "login", function (this: Client) {
    clients.push(this);
    return result();
  });
  const destroy = mock.method(Client.prototype, "destroy", destroyImpl);
  return { clients, login, destroy };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("startDiscordBot with a token", () => {
  let captured: Captured;

  beforeEach(() => {
    captured = captureConsole();
  });

  afterEach(async () => {
    await stopDiscordBot();
    mock.restoreAll();
  });

  it("warns about an empty allow list and a missing public origin", () => {
    stubLogin(async () => "fake-token");
    startDiscordBot();
    assert.equal(captured.warnings.length, 2);
    assert.match(captured.warnings[0], /DISCORD_ALLOWED_USER_IDS is empty/);
    assert.match(captured.warnings[1], /DISCORD_PUBLIC_ORIGIN is not set/);
  });

  it("logs in with the configured token and message-content intents", () => {
    const { clients, login } = stubLogin(async () => "fake-token");
    startDiscordBot();
    assert.equal(login.mock.callCount(), 1);
    assert.deepEqual(login.mock.calls[0].arguments, ["fake-token"]);
    assert.ok(clients[0].options.intents.has("MessageContent"));
    assert.ok(clients[0].options.intents.has("DirectMessages"));
  });

  it("logs the bot tag once the client is ready", () => {
    const { clients } = stubLogin(async () => "fake-token");
    startDiscordBot();
    clients[0].emit(Events.ClientReady, { user: { tag: "gifbot#0001" } } as never);
    assert.ok(captured.logs.includes("[discord] logged in as gifbot#0001"));
  });

  it("reports a message that could not be handled instead of crashing", async () => {
    const { clients } = stubLogin(async () => "fake-token");
    startDiscordBot();
    const broken = {
      get author(): never {
        throw new Error("author unavailable");
      },
    };
    clients[0].emit(Events.MessageCreate, broken as never);
    await flush();
    assert.deepEqual(captured.errors, ["[discord] message handling failed: author unavailable"]);
  });

  it("reports a failed login and forgets the client", async () => {
    const { destroy } = stubLogin(async () => {
      throw new Error("An invalid token was provided.");
    });
    startDiscordBot();
    await flush();
    assert.deepEqual(captured.errors, ["[discord] login failed: An invalid token was provided."]);
    await stopDiscordBot();
    assert.equal(destroy.mock.callCount(), 0);
  });

  it("destroys the client on stop and only once", async () => {
    const { destroy } = stubLogin(async () => "fake-token");
    startDiscordBot();
    await stopDiscordBot();
    await stopDiscordBot();
    assert.equal(destroy.mock.callCount(), 1);
  });

  it("swallows an error while destroying the client", async () => {
    const { destroy } = stubLogin(
      async () => "fake-token",
      async () => {
        throw new Error("already gone");
      },
    );
    startDiscordBot();
    await stopDiscordBot();
    assert.equal(destroy.mock.callCount(), 1);
  });
});
