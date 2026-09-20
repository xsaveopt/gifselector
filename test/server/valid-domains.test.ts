import assert from "node:assert/strict";
import { describe, it } from "node:test";
import validDomains from "../../src/server/valid-domains.ts";

describe("valid domains", () => {
  it("covers the gif sources the importer advertises", () => {
    for (const domain of ["tenor.com", "giphy.com", "klipy.com", "imgur.com"]) {
      assert.ok(validDomains.includes(domain), `${domain} should be allowed`);
    }
  });

  it("covers every discord host attachments are served from", () => {
    for (const domain of ["discord.com", "discordapp.com", "discordapp.net"]) {
      assert.ok(validDomains.includes(domain), `${domain} should be allowed`);
    }
  });

  it("holds bare lowercase hostnames only", () => {
    for (const domain of validDomains) {
      assert.equal(domain, domain.toLowerCase());
      assert.ok(!domain.includes("/"), `${domain} should not carry a scheme or path`);
      assert.ok(!domain.startsWith("."), `${domain} should not start with a dot`);
      assert.ok(!domain.startsWith("*"), `${domain} should not use a wildcard`);
      assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
  });

  it("lists each domain once", () => {
    assert.equal(new Set(validDomains).size, validDomains.length);
  });
});
