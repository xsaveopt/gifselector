import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { tempEnv } from "./helpers.ts";

const serverEntry = path.join(import.meta.dirname, "..", "..", "src", "server", "server.ts");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

type Listener = (...args: unknown[]) => void;

function newListeners(previous: Function[], signal: NodeJS.Signals): Listener[] {
  return process.listeners(signal).filter((listener) => !previous.includes(listener)) as Listener[];
}

describe("server bootstrap in process", () => {
  const logged: string[] = [];
  const exitCodes: unknown[] = [];
  let storageDir: string;
  let logPath: string;
  let statsPath: string;
  let port: number;
  let exited: Promise<void>;
  let sigterm: Listener[];
  let sigint: Listener[];

  before(async () => {
    storageDir = tempEnv();
    logPath = path.join(storageDir, "access.log");
    statsPath = path.join(storageDir, "log_statistics.txt");
    port = await freePort();
    process.env.PORT = String(port);
    process.env.LOG_TO_FILE = "1";
    delete process.env.DISCORD_BOT_TOKEN;
    fs.writeFileSync(logPath, "[t] GET /seed from 5.5.5.5 referer=x ua=Seeder\n");

    const listening = new Promise<void>((resolve) => {
      mock.method(console, "log", (...args: unknown[]) => {
        const line = args.join(" ");
        logged.push(line);
        if (line.includes("backend running")) {
          resolve();
        }
      });
    });
    exited = new Promise((resolve) => {
      mock.method(process, "exit", (code?: number) => {
        exitCodes.push(code);
        resolve();
      });
    });
    mock.timers.enable({ apis: ["setInterval"] });

    const previousTerm = process.listeners("SIGTERM");
    const previousInt = process.listeners("SIGINT");
    await import("../../src/server/server.ts");
    await listening;
    sigterm = newListeners(previousTerm, "SIGTERM");
    sigint = newListeners(previousInt, "SIGINT");
  });

  after(() => {
    mock.timers.reset();
    mock.restoreAll();
    delete process.env.PORT;
    delete process.env.LOG_TO_FILE;
  });

  it("announces the port it listens on and answers health checks", async () => {
    assert.ok(logged.includes(`gifselector backend running on port ${port}`));
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "up");
  });

  it("writes the log statistics once at startup", () => {
    const stats = fs.readFileSync(statsPath, "utf8");
    assert.match(stats, /5\.5\.5\.5: 1/);
    assert.match(stats, /Seeder: 1/);
  });

  it("refreshes the log statistics every hour from the access log", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      headers: { "user-agent": "HourlyAgent" },
    });
    await res.text();
    assert.match(fs.readFileSync(logPath, "utf8"), /ua=HourlyAgent/);

    mock.timers.tick(60 * 60 * 1000 - 1);
    assert.doesNotMatch(fs.readFileSync(statsPath, "utf8"), /HourlyAgent/);

    mock.timers.tick(1);
    assert.match(fs.readFileSync(statsPath, "utf8"), /HourlyAgent: 1/);
  });

  it("registers exactly one shutdown handler for SIGINT and SIGTERM", () => {
    assert.equal(sigterm.length, 1);
    assert.equal(sigint.length, 1);
  });

  it("closes the server and exits cleanly on SIGTERM", async () => {
    sigterm[0]("SIGTERM");
    await exited;
    assert.ok(logged.includes("SIGTERM received, shutting down..."));
    assert.deepEqual(exitCodes, [0]);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });
});

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe("server bootstrap as a process", () => {
  const children: ChildProcess[] = [];
  let storageDir: string;

  before(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "gifselector-proc-"));
  });

  after(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function baseEnv(port: number): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH,
      PORT: String(port),
      TEST_STORAGE_DIR: storageDir,
      TEST_FRONTEND_DIST: path.join(storageDir, "dist"),
      JWT_SECRET: "test-secret",
      ADMIN_PASSWORD: "test-password",
    };
  }

  function run(env: NodeJS.ProcessEnv, onReady?: (child: ChildProcess) => void) {
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(process.execPath, [serverEntry], { cwd: storageDir, env });
      children.push(child);
      let stdout = "";
      let stderr = "";
      let ready = false;
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!ready && stdout.includes("backend running")) {
          ready = true;
          onReady?.(child);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`serves until ${signal} and then exits with code 0`, async () => {
      const port = await freePort();
      let health: number | undefined;
      const result = await run(baseEnv(port), (child) => {
        void fetch(`http://127.0.0.1:${port}/health`)
          .then(async (res) => {
            health = res.status;
            await res.text();
          })
          .finally(() => child.kill(signal));
      });
      assert.equal(health, 200);
      assert.equal(result.code, 0);
      assert.match(result.stdout, new RegExp(`gifselector backend running on port ${port}`));
      assert.match(result.stdout, new RegExp(`${signal} received, shutting down\\.\\.\\.`));
    });
  }

  it("refuses to boot in production with the default credentials", async () => {
    const env = baseEnv(await freePort());
    delete env.JWT_SECRET;
    delete env.ADMIN_PASSWORD;
    env.NODE_ENV = "production";
    const result = await run(env);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to start in production with default JWT_SECRET/);
    assert.doesNotMatch(result.stdout, /backend running/);
  });
});
