import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { afterEach, describe, it, mock } from "node:test";
import { assertPublicHost, isPrivateIp, safeFetch } from "../../src/server/net-guard.ts";

function stubLookup(addresses: string[]) {
  return mock.method(dns, "lookup", async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
}

function stubFetch(responses: Array<{ status: number; location?: string }>) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  let index = 0;
  mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    urls.push(input);
    inits.push(init);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const headers = new Headers();
    if (next.location) {
      headers.set("location", next.location);
    }
    return new Response(null, { status: next.status, headers });
  });
  return { urls, inits };
}

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

  it("flags carrier-grade nat, multicast and reserved ranges", () => {
    assert.equal(isPrivateIp("100.64.0.1"), true);
    assert.equal(isPrivateIp("0.1.2.3"), true);
    assert.equal(isPrivateIp("224.0.0.1"), true);
    assert.equal(isPrivateIp("255.255.255.255"), true);
    assert.equal(isPrivateIp("198.19.0.1"), true);
  });

  it("flags the unspecified, link-local and unique-local ipv6 ranges", () => {
    assert.equal(isPrivateIp("::"), true);
    assert.equal(isPrivateIp("FE80::1"), true);
    assert.equal(isPrivateIp("fc00::1"), true);
    assert.equal(isPrivateIp("fd12:3456::1"), true);
  });

  it("allows public ipv6 and ipv4-mapped public addresses", () => {
    assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
    assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
  });
});

describe("assertPublicHost", () => {
  afterEach(() => mock.restoreAll());

  it("accepts a public ip literal without a dns lookup", async () => {
    const lookup = stubLookup([]);
    await assertPublicHost("8.8.8.8");
    assert.equal(lookup.mock.callCount(), 0);
  });

  it("rejects a private ip literal", async () => {
    await assert.rejects(assertPublicHost("10.1.2.3"), /private address/);
  });

  it("accepts a hostname whose every address is public", async () => {
    stubLookup(["93.184.216.34", "2606:2800:220:1::1"]);
    await assertPublicHost("example.com");
  });

  it("rejects a hostname when any resolved address is private", async () => {
    stubLookup(["93.184.216.34", "127.0.0.1"]);
    await assert.rejects(assertPublicHost("rebind.example.com"), /private address/);
  });

  it("rejects a hostname that resolves to nothing", async () => {
    stubLookup([]);
    await assert.rejects(assertPublicHost("empty.example.com"), /does not resolve/);
  });
});

describe("safeFetch", () => {
  afterEach(() => mock.restoreAll());

  it("refuses a non-http protocol before connecting", async () => {
    const { urls } = stubFetch([{ status: 200 }]);
    await assert.rejects(safeFetch("file:///etc/passwd"), /Unsupported protocol: file:/);
    assert.deepEqual(urls, []);
  });

  it("returns a direct response and disables automatic redirects", async () => {
    stubLookup(["93.184.216.34"]);
    const { urls, inits } = stubFetch([{ status: 200 }]);
    const res = await safeFetch("https://example.com/a.gif", { headers: { "x-test": "1" } });
    assert.equal(res.status, 200);
    assert.deepEqual(urls, ["https://example.com/a.gif"]);
    assert.equal(inits[0].redirect, "manual");
    assert.deepEqual(inits[0].headers, { "x-test": "1" });
  });

  it("follows a relative redirect against the current url", async () => {
    stubLookup(["93.184.216.34"]);
    const { urls } = stubFetch([{ status: 302, location: "/b.gif" }, { status: 200 }]);
    const res = await safeFetch("https://example.com/dir/a.gif");
    assert.equal(res.status, 200);
    assert.deepEqual(urls, ["https://example.com/dir/a.gif", "https://example.com/b.gif"]);
  });

  it("returns a redirect that carries no location header as is", async () => {
    stubLookup(["93.184.216.34"]);
    stubFetch([{ status: 301 }]);
    const res = await safeFetch("https://example.com/a.gif");
    assert.equal(res.status, 301);
  });

  it("re-checks the host on every hop and blocks a redirect to a private address", async () => {
    stubLookup(["93.184.216.34"]);
    const { urls } = stubFetch([{ status: 302, location: "http://127.0.0.1/admin" }]);
    await assert.rejects(safeFetch("https://example.com/a.gif"), /private address/);
    assert.deepEqual(urls, ["https://example.com/a.gif"]);
  });

  it("blocks a redirect to a non-http protocol", async () => {
    stubLookup(["93.184.216.34"]);
    stubFetch([{ status: 302, location: "ftp://example.com/a.gif" }]);
    await assert.rejects(safeFetch("https://example.com/a.gif"), /Unsupported protocol: ftp:/);
  });

  it("gives up after five redirects", async () => {
    stubLookup(["93.184.216.34"]);
    const { urls } = stubFetch([{ status: 302, location: "/loop" }]);
    await assert.rejects(safeFetch("https://example.com/start"), /Too many redirects/);
    assert.equal(urls.length, 6);
  });
});
