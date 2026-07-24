import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivateIp } from "../../src/server/net-guard.ts";

describe("isPrivateIp", () => {
  it("flags loopback, private and link-local addresses", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("10.0.0.5"), true);
    assert.equal(isPrivateIp("192.168.1.1"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    assert.equal(isPrivateIp("169.254.1.1"), true);
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  });

  it("allows public addresses", () => {
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("1.1.1.1"), false);
    assert.equal(isPrivateIp("93.184.216.34"), false);
  });

  it("treats unparseable input as unsafe", () => {
    assert.equal(isPrivateIp("not-an-ip"), true);
  });
});
