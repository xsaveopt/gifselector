const dns = require("dns").promises;
const net = require("net");

const MAX_REDIRECTS = 5;

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ipInt, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function isPrivateIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const ipInt = ipv4ToInt(ip);
    return BLOCKED_V4.some((cidr) => inRange(ipInt, cidr));
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPrivateIp(mapped[1]);
    }
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true;
    const head = parseInt(lower.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return true;
    return false;
  }
  return true;
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Refusing to connect to private address");
    }
    return;
  }
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error("Host does not resolve");
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error("Refusing to connect to private address");
    }
  }
}

function assertSafeProtocol(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
}

async function safeFetch(urlStr, options = {}) {
  let current = urlStr;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const url = new URL(current);
    assertSafeProtocol(url);
    await assertPublicHost(url.hostname);

    const resp = await fetch(current, { ...options, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) {
        return resp;
      }
      current = new URL(location, current).toString();
      continue;
    }
    return resp;
  }
  throw new Error("Too many redirects");
}

module.exports = { safeFetch, assertPublicHost, isPrivateIp };
