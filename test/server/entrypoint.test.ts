import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const script = path.join(import.meta.dirname, "..", "..", "entrypoint.sh");
const onLinux = process.platform === "linux";
const dataPresent = fs.existsSync("/data");

function dataWritable(): boolean {
  try {
    fs.accessSync("/data", fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function runEntrypoint(env: Record<string, string>, ...command: string[]) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  const result = spawnSync("bash", [script, ...command], {
    env: { ...base, ...env },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("entrypoint without the data volume", { skip: !onLinux || dataPresent }, () => {
  it("refuses to start and never runs the command", () => {
    const { status, output } = runEntrypoint({}, "echo", "LAUNCHED");
    assert.equal(status, 1);
    assert.match(output, /required volume \/data: \/data is not present/);
    assert.match(output, /preflight failed/);
    assert.ok(!output.includes("LAUNCHED"));
  });

  it("masks secrets and shows plain settings in the environment report", () => {
    const { output } = runEntrypoint(
      {
        ADMIN_PASSWORD: "hunter2-not-shown",
        JWT_SECRET: "jwt-not-shown",
        DISCORD_BOT_TOKEN: "token-not-shown",
        BASE_PATH: "/gifs",
      },
      "true",
    );
    assert.ok(!output.includes("hunter2-not-shown"));
    assert.ok(!output.includes("jwt-not-shown"));
    assert.ok(!output.includes("token-not-shown"));
    assert.match(output, /ADMIN_PASSWORD\s+\*{6} \(set\)/);
    assert.match(output, /JWT_SECRET\s+\*{6} \(set\)/);
    assert.match(output, /BASE_PATH\s+\/gifs/);
    assert.match(output, /GIFS_PUBLIC_CATEGORY\s+- \(unset\)/);
  });

  it("writes no colour codes when stdout is not a terminal", () => {
    const { output } = runEntrypoint({}, "true");
    assert.ok(!output.includes("\u001b["));
  });
});

describe("entrypoint with a writable data volume", { skip: !onLinux || !dataWritable() }, () => {
  it("runs the command with its arguments once preflight passes", () => {
    const { status, output } = runEntrypoint({}, "echo", "LAUNCHED", "with args");
    assert.equal(status, 0);
    assert.match(output, /required volume \/data: read\/write OK/);
    assert.match(output, /preflight complete/);
    assert.match(output, /LAUNCHED with args/);
  });

  it("passes the command exit status through", () => {
    const { status } = runEntrypoint({}, "bash", "-c", "exit 7");
    assert.equal(status, 7);
  });

  it("leaves no write probe behind in the data volume", () => {
    const before = fs.readdirSync("/data").sort();
    runEntrypoint({}, "true");
    assert.deepEqual(fs.readdirSync("/data").sort(), before);
  });
});
