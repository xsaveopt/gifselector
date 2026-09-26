import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
process.env.GIFS_ALLOWED_DOMAINS = " Example.com, foo.org ,, bar.net ";
process.env.GIFS_MAX_FILE_SIZE_MB = "4";
process.env.DISCORD_RATE_LIMIT_MAX = "7";
process.env.DISCORD_RATE_LIMIT_WINDOW_MINUTES = "3";
const config = (await import("../../src/server/config.ts")).default;

describe("config.ALLOWED_IMPORT_DOMAINS", () => {
  it("parses a comma-separated env var into trimmed, lowercased domains", () => {
    assert.deepEqual(config.ALLOWED_IMPORT_DOMAINS, ["example.com", "foo.org", "bar.net"]);
  });
});

describe("config size and rate limits", () => {
  it("resolves the file size limit into bytes", () => {
    assert.equal(config.MAX_FILE_SIZE_MB, 4);
    assert.equal(config.MAX_FILE_SIZE_BYTES, 4 * 1024 * 1024);
  });

  it("resolves the discord allowance and window", () => {
    assert.equal(config.DISCORD_RATE_LIMIT_MAX, 7);
    assert.equal(config.DISCORD_RATE_LIMIT_WINDOW_MS, 3 * 60 * 1000);
  });
});

type Config = typeof config;

let loadCount = 0;

async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  loadCount += 1;
  const specifier = `../../src/server/config.ts?load=${loadCount}`;
  try {
    return ((await import(specifier)) as { default: Config }).default;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("config.BASE_PATH", () => {
  it("adds a leading slash and drops a trailing one", async () => {
    const loaded = await loadConfig({ BASE_PATH: " gifs/ " });
    assert.equal(loaded.BASE_PATH, "/gifs");
    assert.equal(loaded.MOUNT_PATH, "/gifs");
  });

  it("treats a bare slash as no base path and mounts at the root", async () => {
    const loaded = await loadConfig({ BASE_PATH: "/" });
    assert.equal(loaded.BASE_PATH, "");
    assert.equal(loaded.MOUNT_PATH, "/");
  });
});

describe("config.TRUST_PROXY", () => {
  it("maps the accepted spellings onto what express expects", async () => {
    assert.equal((await loadConfig({ TRUST_PROXY: undefined })).TRUST_PROXY, false);
    assert.equal((await loadConfig({ TRUST_PROXY: "" })).TRUST_PROXY, false);
    assert.equal((await loadConfig({ TRUST_PROXY: "true" })).TRUST_PROXY, true);
    assert.equal((await loadConfig({ TRUST_PROXY: "false" })).TRUST_PROXY, false);
    assert.equal((await loadConfig({ TRUST_PROXY: "2" })).TRUST_PROXY, 2);
    assert.equal((await loadConfig({ TRUST_PROXY: "loopback" })).TRUST_PROXY, "loopback");
  });
});

describe("config.PUBLIC_ORIGIN", () => {
  it("reduces a url to its origin", async () => {
    const loaded = await loadConfig({ GIFS_PUBLIC_ORIGIN: " https://gifs.example.com/some/path " });
    assert.equal(loaded.PUBLIC_ORIGIN, "https://gifs.example.com");
  });

  it("refuses a value that is not a url", async () => {
    await assert.rejects(
      loadConfig({ GIFS_PUBLIC_ORIGIN: "gifs.example.com" }),
      /GIFS_PUBLIC_ORIGIN is not a valid URL: gifs\.example\.com/,
    );
  });

  it("refuses a url that is not http or https", async () => {
    await assert.rejects(
      loadConfig({ GIFS_PUBLIC_ORIGIN: "ftp://gifs.example.com" }),
      /GIFS_PUBLIC_ORIGIN must be http or https, got ftp:/,
    );
  });
});

describe("config.DEFAULT_CATEGORY_ID", () => {
  it("accepts a positive integer and ignores anything else", async () => {
    assert.equal((await loadConfig({ GIFS_DEFAULT_CATEGORY_ID: "3" })).DEFAULT_CATEGORY_ID, 3);
    assert.equal((await loadConfig({ GIFS_DEFAULT_CATEGORY_ID: "0" })).DEFAULT_CATEGORY_ID, null);
    assert.equal((await loadConfig({ GIFS_DEFAULT_CATEGORY_ID: "1.5" })).DEFAULT_CATEGORY_ID, null);
    assert.equal((await loadConfig({ GIFS_DEFAULT_CATEGORY_ID: "abc" })).DEFAULT_CATEGORY_ID, null);
  });
});

describe("config fallbacks", () => {
  it("falls back to the default domains when the list is blank", async () => {
    const defaults = (await import("../../src/server/valid-domains.ts")).default;
    const loaded = await loadConfig({ GIFS_ALLOWED_DOMAINS: " , ," });
    assert.deepEqual(loaded.ALLOWED_IMPORT_DOMAINS, defaults);
  });

  it("falls back to the default limits for blank, zero or non-numeric values", async () => {
    const loaded = await loadConfig({
      GIFS_MAX_FILE_SIZE_MB: " ",
      GIFS_MAX_MEGAPIXELS: "0",
      GIFS_MEDIA_TIMEOUT_SECONDS: "soon",
    });
    assert.equal(loaded.MAX_FILE_SIZE_MB, 15);
    assert.equal(loaded.MAX_PIXELS, 50_000_000);
    assert.equal(loaded.MEDIA_TIMEOUT_MS, 60_000);
  });

  it("trims trailing slashes from the discord origin and splits the id lists", async () => {
    const loaded = await loadConfig({
      DISCORD_PUBLIC_ORIGIN: "https://gifs.example.com//",
      DISCORD_ALLOWED_USER_IDS: " 1, ,2 ",
      DISCORD_CHANNEL_IDS: "",
    });
    assert.equal(loaded.DISCORD_PUBLIC_ORIGIN, "https://gifs.example.com");
    assert.deepEqual(loaded.DISCORD_ALLOWED_USER_IDS, ["1", "2"]);
    assert.deepEqual(loaded.DISCORD_CHANNEL_IDS, []);
  });
});

describe("config in production", () => {
  it("refuses to load with the default secret and password", async () => {
    await assert.rejects(
      loadConfig({ NODE_ENV: "production", JWT_SECRET: undefined, ADMIN_PASSWORD: undefined }),
      /Refusing to start in production with default JWT_SECRET and ADMIN_PASSWORD\. Set JWT_SECRET, ADMIN_PASSWORD/,
    );
  });

  it("names only the setting that is still on its default", async () => {
    await assert.rejects(
      loadConfig({ NODE_ENV: "production", ADMIN_PASSWORD: undefined }),
      /Refusing to start in production with default ADMIN_PASSWORD\./,
    );
  });

  it("loads once both are set", async () => {
    const loaded = await loadConfig({ NODE_ENV: "production" });
    assert.equal(loaded.JWT_SECRET, "test-secret");
  });
});

describe("config.ENABLE_FILE_LOGGING", () => {
  it("is on for 1 or true and off otherwise", async () => {
    assert.equal((await loadConfig({ LOG_TO_FILE: "1" })).ENABLE_FILE_LOGGING, true);
    assert.equal((await loadConfig({ LOG_TO_FILE: "true" })).ENABLE_FILE_LOGGING, true);
    assert.equal((await loadConfig({ LOG_TO_FILE: "yes" })).ENABLE_FILE_LOGGING, false);
  });
});
