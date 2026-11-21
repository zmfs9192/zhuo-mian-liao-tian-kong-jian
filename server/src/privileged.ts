import {
existsSync,
mkdirSync,
readFileSync,
readdirSync,
renameSync,
unlinkSync,
writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { connect as tlsConnect } from "node:tls";
import { createConnection, type Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { lookup as dnsLookup } from "node:dns/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
createCipheriv,
createDecipheriv,
randomBytes,
randomUUID,
} from "node:crypto";
import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

// Host-side capabilities for this space — ported from the multi-agent
// collaborative space's Pioneer VPN implementation (same Pioneer
// account, same protocol, same tunnel logic):
//
// pioneerEncrypt / pioneerDecrypt — the Pioneer VPN API envelope:
// AES-128-CBC (key/IV recovered from the official installer the user
// supplied) over JSON text, base64 on the wire. The actions speak the
// protocol; only the cipher itself lives here because action code may
// not import node:crypto.
//
// randomUuid — a fresh UUID (the Pioneer device id is generated once
// through this and then stored server-side).
//
// pioneerTunnel* — a real local proxy daemon (spawned detached from
// this layer, pid/status files under this artifact's tunnel/
// directory, loopback port 19352 — the collaborative space's daemon
// uses 19351, so the two never collide) that speaks HTTP CONNECT +
// SOCKS5 on the inside and the trojan protocol over TLS to the
// selected Pioneer node on the outside. pioneerTunnelFetch fetches
// one URL through that daemon, so the panel can prove the exit IP
// really changed. The trojan password arrives from the action layer
// (it is extracted there from the server-side-only node config) and
// is written only to the daemon's config file inside the artifact
// directory — it is never returned to the client.
export const privileged = definePrivilegedContracts({
  pioneerEncrypt: {
    request: z.object({ text: z.string().max(100000) }),
    response: z.object({ ok: z.boolean(), text: z.string() }),
  },
  pioneerDecrypt: {
    request: z.object({ text: z.string().max(2000000) }),
    response: z.object({ ok: z.boolean(), text: z.string() }),
  },
  randomUuid: {
    request: z.object({}),
    response: z.object({ uuid: z.string() }),
  },
  readBlobBytes: {
    request: z.object({ key: z.string().min(1).max(500) }),
    response: z.object({
      ok: z.boolean(),
      dataBase64: z.string(),
      contentType: z.string(),
      error: z.string(),
    }),
  },
  readBlobPreview: {
    request: z.object({
      key: z.string().min(1).max(500),
      maxDim: z.number().int().min(64).max(2048),
    }),
    response: z.object({
      ok: z.boolean(),
      dataBase64: z.string(),
      contentType: z.string(),
      error: z.string(),
    }),
  },
  prewarmBlobPreviews: {
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
      generated: z.number(),
      cached: z.number(),
      skipped: z.number(),
      failed: z.number(),
      error: z.string(),
    }),
  },
  // Splits one stored image into a rows × cols grid of PNG tiles
  // (row-major order) for the 图像 workspace. The original object
  // is only read, never modified; the caller stores each tile as
  // its own blob. Tiles are PNG so a later single-part AI edit
  // loses nothing to recompression.
  splitBlobImage: {
    request: z.object({
      key: z.string().min(1).max(500),
      rows: z.number().int().min(1).max(6),
      cols: z.number().int().min(1).max(6),
    }),
    response: z.object({
      ok: z.boolean(),
      width: z.number(),
      height: z.number(),
      tiles: z.array(
        z.object({
          dataBase64: z.string(),
          contentType: z.string(),
          width: z.number(),
          height: z.number(),
        }),
      ),
      error: z.string(),
    }),
  },
  // Runs one code snippet for the 代码 workspace's run panel:
  // javascript/typescript via bun, python via python3. The code
  // is written to a fresh temp dir, executed with a hard timeout
  // and capped output, and the temp dir is removed afterwards.
  runCodeSnippet: {
    request: z.object({
      language: z.string().min(1).max(40),
      code: z.string().max(200000),
      fileName: z.string().max(200).default("main.js"),
    }),
    response: z.object({
      ok: z.boolean(),
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
      timedOut: z.boolean(),
      error: z.string(),
    }),
  },
  pioneerTunnelStart: {
    request: z.object({
      host: z.string().min(1).max(300),
      port: z.number().int().min(1).max(65535),
      password: z.string().min(1).max(1000),
      sni: z.string().max(300).default(""),
    }),
    response: z.object({ ok: z.boolean(), running: z.boolean(), error: z.string() }),
  },
  pioneerTunnelStop: {
    request: z.object({}),
    response: z.object({ ok: z.boolean(), running: z.boolean() }),
  },
  pioneerTunnelStatus: {
    request: z.object({}),
    response: z.object({
      running: z.boolean(),
      host: z.string(),
      port: z.number(),
      startedAt: z.string(),
      connections: z.number(),
      lastError: z.string(),
    }),
  },
  pioneerTunnelFetch: {
    request: z.object({
      url: z.string().min(1).max(2000),
      timeoutMs: z.number().int().min(1000).max(30000).default(20000),
    }),
    response: z.object({
      ok: z.boolean(),
      status: z.number(),
      body: z.string(),
      error: z.string(),
    }),
  },
  // Fetches one web page (or file) for the in-space browser: a
  // plain server-side GET with a desktop browser user agent,
  // redirects followed, the body returned as base64 and capped
  // at maxBytes (truncated=true when the cap cut it). The
  // browser renders what comes back inside the space; response
  // headers that would refuse framing never reach the frame
  // because the page is re-served from the space's own document,
  // and any fetch failure is reported verbatim instead of
  // bouncing the user out to a system browser.
  fetchWebPage: {
    request: z.object({
      url: z.string().min(1).max(4000),
      maxBytes: z.number().int().min(1024).max(25165824).default(6291456),
      timeoutMs: z.number().int().min(1000).max(60000).default(25000),
      // Optional form-submit support for the in-space browser: a
      // POST with an already-serialized urlencoded body, so a
      // page's form submit navigates inside the space instead of
      // being blocked. The wider method set serves the browser's
      // in-page network bridge (fetch/XHR issued by page scripts
      // are relayed through here so they carry the space's
      // cookie jar and are not killed by the frame's opaque
      // origin).
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
        .default("GET"),
      body: z.string().max(262144).default(""),
      // Binary request bodies (bridge relays of Blob /
      // ArrayBuffer payloads), base64; wins over `body` when
      // non-empty.
      bodyBase64: z.string().max(8388608).default(""),
      contentType: z.string().max(200).default(""),
      // Extra request headers the page itself set (bridge
      // relays), name/value pairs. Server-controlled headers
      // (host, cookie, content-length, user-agent…) are filtered
      // out in the handler; the cookie jar below is the only
      // cookie source.
      headers: z
        .array(z.tuple([z.string().max(200), z.string().max(8192)]))
        .max(80)
        .default([]),
      // The device identity the in-space browser presents
      // (浏览器设置 → 设备模式）: a full User-Agent string plus
      // the Sec-CH-UA low-entropy hints that belong to it.
      // Empty userAgent keeps the built-in desktop default;
      // the action layer only ever passes one of its three
      // fixed device profiles, never page-supplied input (the
      // bridge header filter above strips user-agent from page
      // headers, so a page cannot impersonate another device).
      userAgent: z.string().max(600).default(""),
      secChUaMobile: z.string().max(4).default(""),
      secChUaPlatform: z.string().max(80).default(""),
      // 浏览器设置 → 忽略证书错误： when true, TLS certificate
      // verification is skipped for this fetch (self-signed /
      // expired / mismatched certs no longer fail the load).
      // Only the action layer sets it, from the stored browser
      // setting; a page can never request it.
      ignoreCertErrors: z.boolean().default(false),
      // The in-space browser's cookie jar, seeded by the action
      // from server-side storage: cookies are matched per hop
      // (domain + path + secure), updated from every hop's
      // Set-Cookie, and the raw Set-Cookie values of every hop
      // are returned so the action can persist them.
      cookies: z
        .array(
          z.object({
            domain: z.string().min(1).max(255),
            name: z.string().min(1).max(255),
            value: z.string().max(8192),
            path: z.string().max(512).default("/"),
            secure: z.boolean().default(false),
          }),
        )
        .max(500)
        .default([]),
      // Optional free-proxy egress (代理中心 → 免费代理）: when
      // the user has switched one of the server-tested free
      // proxies on, the browser's fetches are routed through it
      // over a raw socket (HTTP CONNECT / SOCKS4 / SOCKS5). The
      // proxy is a stranger-run public relay — the UI says so
      // plainly; nothing routes through it unless the user
      // picked it.
      proxy: z
        .object({
          protocol: z.enum(["http", "socks4", "socks5"]),
          host: z.string().min(1).max(255),
          port: z.number().int().min(1).max(65535),
        })
        .optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      status: z.number(),
      finalUrl: z.string(),
      contentType: z.string(),
      bodyBase64: z.string(),
      truncated: z.boolean(),
      error: z.string(),
      // How long the fetch itself took on this server — the
      // browser's 抓包 (capture) panel shows it as the request's
      // duration.
      durationMs: z.number(),
      // The exact request headers sent and the response headers
      // received (name/value pairs, duplicates preserved), for
      // the capture panel's detail view. Timing segments are
      // filled only where this server can really measure them:
      // the raw-socket proxy path measures connect / TLS /
      // time-to-headers / receive; a plain fetch() exposes only
      // the total, so its segments stay null — never invented.
      requestHeaders: z.array(z.tuple([z.string(), z.string()])),
      responseHeaders: z.array(z.tuple([z.string(), z.string()])),
      timings: z
        .object({
          dnsMs: z.number().nullable(),
          connectMs: z.number().nullable(),
          tlsMs: z.number().nullable(),
          waitMs: z.number().nullable(),
          receiveMs: z.number().nullable(),
        })
        .nullable(),
      // Raw Set-Cookie values grouped by the hop URL that sent
      // them (redirect hops included), so the action can persist
      // the browser's cookie jar exactly as a real browser
      // would have stored them.
      setCookies: z.array(
        z.object({
          url: z.string(),
          values: z.array(z.string().max(8192)).max(40),
        }),
      ),
    }),
  },
  // Live-tests free-proxy candidates from this server: for
  // each candidate it really connects through the proxy to a
  // plain-HTTP test target and requires an HTTP 200 back —
  // a proxy that does not answer, answers with an error, or
  // is too slow is reported as failed with the real reason.
  // Only candidates this test passes are ever shown to the
  // user as usable. Batches run with bounded concurrency.
  testFreeProxies: {
    request: z.object({
      candidates: z
        .array(
          z.object({
            protocol: z.enum(["http", "socks4", "socks5"]),
            host: z.string().min(1).max(255),
            port: z.number().int().min(1).max(65535),
          }),
        )
        .max(240),
      timeoutMs: z.number().int().min(1000).max(20000).default(7000),
    }),
    response: z.object({
      results: z.array(
        z.object({
          protocol: z.string(),
          host: z.string(),
          port: z.number(),
          ok: z.boolean(),
          status: z.number(),
          latencyMs: z.number(),
          error: z.string(),
        }),
      ),
    }),
  },
  // Password vault crypto （密码本）: AES-256-GCM over the plain
  // password. The 256-bit key lives ONLY in a server-side file
  // (vault.key beside the artifact directory, mode 0600, created
  // on first use) — never in the database, never in an action
  // response, never in a log. The stored format is
  // "v1:<base64 iv>.<base64 authTag>.<base64 ciphertext>".
  vaultEncrypt: {
    request: z.object({ text: z.string().min(1).max(2000) }),
    response: z.object({ ok: z.boolean(), text: z.string(), error: z.string() }),
  },
  vaultDecrypt: {
    request: z.object({ text: z.string().min(1).max(20000) }),
    response: z.object({ ok: z.boolean(), text: z.string(), error: z.string() }),
  },
  // Host permissions for agents （智能体主机权限）: the real
  // execution behind the per-agent switches in the agent
  // settings. execLinuxCommand runs ONE bash command on this
  // host (working directory ~/workspace, hard timeout, capped
  // output). hostListDir / hostReadFile / hostWriteFile touch
  // text files only under ~/workspace, ~/memory and /tmp, with
  // sensitive paths (ssh / aws / gnupg material, .env files,
  // the password vault key) refused outright. The action layer
  // only ever calls these for an agent whose permission switch
  // the user turned on, and re-checks the switch per call.
  execLinuxCommand: {
    request: z.object({
      command: z.string().min(1).max(4000),
      timeoutSecs: z.number().int().min(1).max(60).default(30),
    }),
    response: z.object({
      ok: z.boolean(),
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
      timedOut: z.boolean(),
      error: z.string(),
    }),
  },
  hostListDir: {
    request: z.object({ path: z.string().min(1).max(1000) }),
    response: z.object({
      ok: z.boolean(),
      entries: z.array(
        z.object({ name: z.string(), isDir: z.boolean(), size: z.number() }),
      ),
      error: z.string(),
    }),
  },
  hostReadFile: {
    request: z.object({ path: z.string().min(1).max(1000) }),
    response: z.object({
      ok: z.boolean(),
      content: z.string(),
      truncated: z.boolean(),
      error: z.string(),
    }),
  },
  hostWriteFile: {
    request: z.object({
      path: z.string().min(1).max(1000),
      content: z.string().max(200000),
    }),
    response: z.object({
      ok: z.boolean(),
      bytes: z.number(),
      error: z.string(),
    }),
  },
});

// --- Pioneer Trojan tunnel daemon ---
// The daemon is a small standalone script written into the artifact's
// tunnel/ directory and spawned detached, because every privileged
// call is a short-lived process. It listens on 127.0.0.1:19352 as an
// HTTP CONNECT + SOCKS5 proxy and forwards each connection to the
// selected Pioneer node with the trojan protocol over TLS. When the
// host environment defines an egress proxy (HTTPS_PROXY etc.), the
// daemon first CONNECTs through it to reach the node, mirroring how
// this server reaches the internet at all; with no proxy env it dials
// the node directly. The trojan password lives only in the daemon's
// config.json inside the artifact directory.
const TUNNEL_PORT = 19352;

function tunnelDir(): string {
  return join(
    homedir(),
    "workspace",
    "ts-spaces",
    "zhuo-mian-liao-tian-kong-jian",
    "tunnel",
  );
}

type TunnelStatusFile = {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  connections: number;
  lastError: string;
};

function readTunnelStatusFile(): TunnelStatusFile | null {
  try {
    const raw = readFileSync(join(tunnelDir(), "status.json"), "utf8");
    const p = JSON.parse(raw) as Partial<TunnelStatusFile>;
    if (typeof p.pid !== "number") return null;
    return {
      pid: p.pid,
      host: typeof p.host === "string" ? p.host : "",
      port: typeof p.port === "number" ? p.port : 0,
      startedAt: typeof p.startedAt === "string" ? p.startedAt : "",
      connections: typeof p.connections === "number" ? p.connections : 0,
      lastError: typeof p.lastError === "string" ? p.lastError : "",
    };
  } catch {
    return null;
  }
}

function tunnelPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function tryConnectOnce(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
const PIONEER_TUNNEL_DAEMON_SOURCE = String.raw`
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATUS_PATH = path.join(DIR, "status.json");
let cfg = { host: "", port: 0, password: "", sni: "" };
try { cfg = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8")); } catch (e) {}
const startedAt = new Date().toISOString();
let connections = 0;
let lastError = "";
function writeStatus() {
  // Only genuine state transitions call this (listen, errors):
  // status.json must NOT be rewritten for ordinary proxied
  // connections — the connection counter still increments in
  // memory and rides along on the next transition's write.
  try {
    fs.writeFileSync(STATUS_PATH, JSON.stringify({ pid: process.pid, host: String(cfg.host || ""), port: Number(cfg.port || 0), startedAt: startedAt, connections: connections, lastError: lastError }));
  } catch (e) {}
}
process.on("uncaughtException", function (e) { lastError = "daemon: " + (e && e.message ? e.message : String(e)); writeStatus(); });
const HASH = crypto.createHash("sha224").update(String(cfg.password || ""), "utf8").digest("hex");

function ipv6Bytes(ip) {
  let addr = ip;
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  const halves = addr.split("::");
  let parts = [];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    parts = left.concat(new Array(Math.max(0, missing)).fill("0"), right);
  } else { parts = addr.split(":"); }
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) { buf.writeUInt16BE(parseInt(parts[i] || "0", 16) || 0, i * 2); }
  return buf;
}
function addrBytes(host) {
  const v = net.isIP(host);
  if (v === 4) return Buffer.concat([Buffer.from([1]), Buffer.from(host.split(".").map(function (x) { return Number(x) & 255; }))]);
  if (v === 6) return Buffer.concat([Buffer.from([4]), ipv6Bytes(host)]);
  const b = Buffer.from(host, "utf8");
  return Buffer.concat([Buffer.from([3, b.length & 255]), b]);
}
function trojanHead(host, port) {
  const pb = Buffer.alloc(2);
  pb.writeUInt16BE(port & 65535, 0);
  return Buffer.concat([Buffer.from(HASH + "\r\n", "ascii"), Buffer.from([1]), addrBytes(host), pb, Buffer.from("\r\n", "ascii")]);
}
function egressProxy() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    return {
      host: u.hostname,
      port: Number(u.port) || 8080,
      auth: u.username ? Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password || ""), "utf8").toString("base64") : "",
    };
  } catch (e) { return null; }
}
function openUpstream(host, port, first, cb) {
  let settled = false;
  const timer = setTimeout(function () {
    if (!settled) { settled = true; lastError = "连接节点超时（20 秒）"; writeStatus(); cb(new Error("连接节点超时（20 秒）"), null); }
  }, 20000);
  function fail(e) {
    lastError = "节点连接失败：" + (e && e.message ? e.message : String(e));
    writeStatus();
    if (!settled) { settled = true; clearTimeout(timer); cb(e, null); }
  }
  function beginTls(sock) {
    const up = tls.connect({ socket: sock, servername: cfg.sni || cfg.host, rejectUnauthorized: false });
    up.once("secureConnect", function () {
      if (settled) { try { up.destroy(); } catch (e) {} return; }
      settled = true; clearTimeout(timer);
      connections += 1;
      try { up.write(Buffer.concat([trojanHead(host, port), first])); } catch (e) {}
      cb(null, up);
    });
    up.once("error", fail);
  }
  const px = egressProxy();
  if (!px) {
    const direct = tls.connect({ host: cfg.host, port: Number(cfg.port), servername: cfg.sni || cfg.host, rejectUnauthorized: false });
    direct.once("secureConnect", function () {
      if (settled) { try { direct.destroy(); } catch (e) {} return; }
      settled = true; clearTimeout(timer);
      connections += 1;
      try { direct.write(Buffer.concat([trojanHead(host, port), first])); } catch (e) {}
      cb(null, direct);
    });
    direct.once("error", fail);
    return;
  }
  const rawSock = net.createConnection({ host: px.host, port: px.port });
  rawSock.once("error", fail);
  rawSock.once("connect", function () {
    let head = "CONNECT " + cfg.host + ":" + Number(cfg.port) + " HTTP/1.1\r\nHost: " + cfg.host + ":" + Number(cfg.port) + "\r\n";
    if (px.auth) head += "Proxy-Authorization: Basic " + px.auth + "\r\n";
    head += "\r\n";
    try { rawSock.write(head); } catch (e) { fail(e); return; }
    let acc = Buffer.alloc(0);
    const onData = function (chunk) {
      acc = Buffer.concat([acc, chunk]);
      const idx = acc.indexOf("\r\n\r\n");
      if (idx < 0) { if (acc.length > 16384) { try { rawSock.destroy(); } catch (e) {} fail(new Error("出口代理响应异常")); } return; }
      rawSock.removeListener("data", onData);
      const line = acc.slice(0, idx).toString("latin1").split("\r\n")[0] || "";
      if (line.indexOf(" 200") < 0) { try { rawSock.destroy(); } catch (e) {} fail(new Error("出口代理拒绝连接节点：" + line)); return; }
      beginTls(rawSock);
    };
    rawSock.on("data", onData);
  });
}
function pipePair(a, b) {
  a.on("data", function (d) { if (!b.destroyed) { try { b.write(d); } catch (e) {} } });
  b.on("data", function (d) { if (!a.destroyed) { try { a.write(d); } catch (e) {} } });
  a.on("error", function () { try { b.destroy(); } catch (e) {} });
  b.on("error", function () { try { a.destroy(); } catch (e) {} });
  a.on("close", function () { try { b.destroy(); } catch (e) {} });
  b.on("close", function () { try { a.destroy(); } catch (e) {} });
}
const server = net.createServer(function (client) {
  client.once("data", function (first) {
    if (!first || first.length === 0) { client.destroy(); return; }
    if (first[0] === 5) {
      const nMethods = first.length > 1 ? first[1] : 0;
      const greetingLen = 2 + nMethods;
      if (first.length < greetingLen) { client.destroy(); return; }
      function handleRequest(req) {
        if (req.length < 4 || req[1] !== 1) { try { client.write(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); client.end(); } catch (e) {} return; }
        const atyp = req[3];
        let host = ""; let off = 4;
        if (atyp === 1) { host = Array.from(req.slice(4, 8)).join("."); off = 8; }
        else if (atyp === 3) { const l = req[4]; host = req.slice(5, 5 + l).toString("utf8"); off = 5 + l; }
        else if (atyp === 4) { const segs = []; for (let i = 0; i < 8; i++) segs.push(req.readUInt16BE(4 + i * 2).toString(16)); host = segs.join(":"); off = 20; }
        else { client.destroy(); return; }
        if (req.length < off + 2) { client.destroy(); return; }
        const port = req.readUInt16BE(off);
        const rest = req.slice(off + 2);
        openUpstream(host, port, rest, function (err, up) {
          if (err || !up) { try { client.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); client.end(); } catch (e) {} return; }
          try { client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); } catch (e) {}
          pipePair(client, up);
        });
      }
      try { client.write(Buffer.from([5, 0])); } catch (e) {}
      const rest0 = first.slice(greetingLen);
      if (rest0.length >= 4) { handleRequest(rest0); return; }
      let acc = rest0;
      const onReq = function (chunk) { acc = Buffer.concat([acc, chunk]); if (acc.length >= 4) { client.removeListener("data", onReq); handleRequest(acc); } };
      client.on("data", onReq);
      return;
    }
    let acc = first;
    function handleHttp(buf) {
      const headEnd = buf.indexOf("\r\n\r\n");
      const head = (headEnd >= 0 ? buf.slice(0, headEnd) : buf).toString("latin1");
      const rest = headEnd >= 0 ? buf.slice(headEnd + 4) : Buffer.alloc(0);
      const lines = head.split("\r\n");
      const m = /^(\S+)\s+(\S+)\s+HTTP\/\d\.\d$/.exec(lines[0] || "");
      if (!m) { client.destroy(); return; }
      const method = m[1].toUpperCase();
      const target = m[2];
      if (method === "CONNECT") {
        const hp = target.split(":");
        const port = Number(hp[hp.length - 1]) || 443;
        const host = hp.slice(0, hp.length - 1).join(":").replace(/^\[|\]$/g, "");
        openUpstream(host, port, rest, function (err, up) {
          if (err || !up) { try { client.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"); client.end(); } catch (e) {} return; }
          try { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); } catch (e) {}
          pipePair(client, up);
        });
        return;
      }
      let u = null;
      try { u = new URL(target); } catch (e) {}
      if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) { try { client.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"); client.end(); } catch (e) {} return; }
      const host = u.hostname;
      const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      const pathQ = (u.pathname || "/") + (u.search || "");
      const headers = lines.slice(1).filter(function (l) { return l && !/^proxy-/i.test(l); });
      const out = method + " " + pathQ + " HTTP/1.1\r\n" + headers.join("\r\n") + "\r\n\r\n";
      openUpstream(host, port, Buffer.concat([Buffer.from(out, "latin1"), rest]), function (err, up) {
        if (err || !up) { try { client.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"); client.end(); } catch (e) {} return; }
        pipePair(client, up);
      });
    }
    if (acc.indexOf("\r\n\r\n") >= 0) { handleHttp(acc); return; }
    const onData = function (chunk) { acc = Buffer.concat([acc, chunk]); if (acc.indexOf("\r\n\r\n") >= 0 || acc.length > 65536) { client.removeListener("data", onData); handleHttp(acc); } };
    client.on("data", onData);
  });
  client.on("error", function () {});
});
server.on("error", function (e) { lastError = "本地代理启动失败：" + (e && e.message ? e.message : String(e)); writeStatus(); });
server.listen(19352, "127.0.0.1", function () { writeStatus(); });
`;

function parseHttpResponse(buf: Buffer): { status: number; body: string } {
  const idx = buf.indexOf("\r\n\r\n");
  if (idx < 0) return { status: 0, body: "" };
  const headText = buf.slice(0, idx).toString("latin1");
  const lines = headText.split("\r\n");
  const statusMatch = /^HTTP\/\d\.\d\s+(\d{3})/.exec(lines[0] ?? "");
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const c = line.indexOf(":");
    if (c > 0) headers.set(line.slice(0, c).trim().toLowerCase(), line.slice(c + 1).trim());
  }
  let body = buf.slice(idx + 4);
  if ((headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) {
    const out: Buffer[] = [];
    let pos = 0;
    while (pos < body.length) {
      const lineEnd = body.indexOf("\r\n", pos);
      if (lineEnd < 0) break;
      const size = parseInt(body.slice(pos, lineEnd).toString("latin1").trim(), 16);
      if (!Number.isFinite(size) || size <= 0) break;
      out.push(body.slice(lineEnd + 2, lineEnd + 2 + size));
      pos = lineEnd + 2 + size + 2;
    }
    body = Buffer.concat(out);
  } else {
    const len = Number(headers.get("content-length") ?? "");
    if (Number.isFinite(len) && len >= 0 && body.length > len) body = body.slice(0, len);
  }
  return { status, body: body.toString("utf8") };
}

function fetchViaTunnelProxy(opts: {
  https: boolean;
  host: string;
  port: number;
  pathQ: string;
  fullUrl: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; body: string; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const sockets: Socket[] = [];
    const done = (r: { ok: boolean; status: number; body: string; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(r);
    };
    const watchdog = setTimeout(() => {
      for (const s of sockets) s.destroy();
      done({ ok: false, status: 0, body: "", error: `经隧道请求超时（${opts.timeoutMs} 毫秒）` });
    }, opts.timeoutMs);
    const collect = (sock: Socket) => {
      const chunks: Buffer[] = [];
      let total = 0;
      sock.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > 1024 * 1024) sock.destroy();
      });
      const finish = () => {
        const parsed = parseHttpResponse(Buffer.concat(chunks));
        if (parsed.status === 0) {
          done({ ok: false, status: 0, body: "", error: "经隧道收到的响应无法解析" });
          return;
        }
        done({
          ok: parsed.status >= 200 && parsed.status < 300,
          status: parsed.status,
          body: parsed.body.slice(0, 200000),
          error: parsed.status >= 200 && parsed.status < 300 ? "" : `目标站点返回 HTTP ${parsed.status}`,
        });
      };
      sock.once("end", finish);
      sock.once("close", finish);
      sock.once("error", (e) => done({ ok: false, status: 0, body: "", error: `经隧道读取响应失败：${e.message}` }));
    };
    const sendRequest = (sock: Socket) => {
      const target = opts.https ? opts.pathQ : opts.fullUrl;
      sock.write(
        `GET ${target} HTTP/1.1\r\nHost: ${opts.host}${opts.port ? `:${opts.port}` : ""}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nAccept: application/json, text/plain, */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`,
      );
    };
    const proxy = createConnection({ host: "127.0.0.1", port: TUNNEL_PORT });
    sockets.push(proxy);
    proxy.once("error", (e) =>
      done({ ok: false, status: 0, body: "", error: `无法连接本地隧道代理：${e.message}（隧道可能尚未启动）` }),
    );
    proxy.once("connect", () => {
      if (!opts.https) {
        sendRequest(proxy);
        collect(proxy);
        return;
      }
      proxy.write(
        `CONNECT ${opts.host}:${opts.port} HTTP/1.1\r\nHost: ${opts.host}:${opts.port}\r\n\r\n`,
      );
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx < 0) {
          if (head.length > 16384) {
            proxy.destroy();
            done({ ok: false, status: 0, body: "", error: "隧道代理 CONNECT 响应异常" });
          }
          return;
        }
        proxy.removeListener("data", onData);
        const line = head.slice(0, idx).toString("latin1").split("\r\n")[0] ?? "";
        if (!line.includes(" 200")) {
          proxy.destroy();
          done({ ok: false, status: 0, body: "", error: `隧道代理 CONNECT 失败：${line}` });
          return;
        }
        const secure = tlsConnect({ socket: proxy, servername: opts.host });
        sockets.push(secure as unknown as Socket);
        secure.once("secureConnect", () => {
          sendRequest(secure as unknown as Socket);
          collect(secure as unknown as Socket);
        });
        secure.once("error", (e) =>
          done({ ok: false, status: 0, body: "", error: `经隧道的 TLS 连接失败：${e.message}` }),
        );
      };
      proxy.on("data", onData);
    });
  });
}

// --- free proxies （免费代理）: raw-socket proxying + live tests ---
// The proxy center's free-proxy section lists only proxies this
// server has just tested itself. Testing and using share one
// machinery: open a tunnel through the candidate (HTTP CONNECT /
// SOCKS4 / SOCKS5) to the target, then speak plain HTTP (or TLS
// for https) over it. Responses are read as raw buffers so
// binary downloads survive the trip byte-for-byte.

type FreeProxySpec = {
  protocol: "http" | "socks4" | "socks5";
  host: string;
  port: number;
};

type SockReader = {
  take: (n: number, timeoutMs: number) => Promise<Buffer>;
  readUntil: (delim: string, timeoutMs: number, max: number) => Promise<Buffer>;
  readLine: (timeoutMs: number) => Promise<string>;
  takeRestUntilClose: (timeoutMs: number, cap: number) => Promise<Buffer>;
};

function makeSockReader(sock: Socket): SockReader {
  let buf: Buffer = Buffer.alloc(0);
  let closed = false;
  let errMsg = "";
  const listeners = new Set<() => void>();
  const poke = () => {
    for (const f of [...listeners]) f();
  };
  sock.on("data", (c: Buffer) => {
    buf = Buffer.concat([buf, c]);
    poke();
  });
  sock.on("error", (e) => {
    errMsg = e.message;
    closed = true;
    poke();
  });
  sock.on("close", () => {
    closed = true;
    poke();
  });
  async function wait(cond: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (closed) return;
      if (Date.now() - start > timeoutMs) throw new Error("读取超时");
      await new Promise<void>((r) => {
        const f = () => {
          listeners.delete(f);
          r();
        };
        listeners.add(f);
        setTimeout(f, 200);
      });
    }
  }
  return {
    async take(n, timeoutMs) {
      await wait(() => buf.length >= n || closed, timeoutMs);
      const out = buf.subarray(0, Math.min(n, buf.length));
      buf = buf.subarray(out.length);
      if (out.length === 0 && errMsg) throw new Error(errMsg);
      return Buffer.from(out);
    },
    async readUntil(delim, timeoutMs, max) {
      await wait(
        () => buf.indexOf(delim) >= 0 || buf.length > max || closed,
        timeoutMs,
      );
      const idx = buf.indexOf(delim);
      if (idx < 0) {
        if (errMsg) throw new Error(errMsg);
        throw new Error("响应头过大或连接中断");
      }
      const out = buf.subarray(0, idx + delim.length);
      buf = buf.subarray(out.length);
      return Buffer.from(out);
    },
    async readLine(timeoutMs) {
      const b = await this.readUntil("\r\n", timeoutMs, 8192);
      return b.toString("latin1").replace(/\r\n$/, "");
    },
    async takeRestUntilClose(timeoutMs, cap) {
      const start = Date.now();
      while (!closed && buf.length < cap) {
        if (Date.now() - start > timeoutMs) break;
        await new Promise<void>((r) => {
          const f = () => {
            listeners.delete(f);
            r();
          };
          listeners.add(f);
          setTimeout(f, 200);
        });
      }
      const out = buf.subarray(0, cap);
      buf = buf.subarray(out.length);
      return Buffer.from(out);
    },
  };
}

function socketConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port });
    const to = setTimeout(() => {
      sock.destroy();
      reject(new Error("连接代理超时"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(to);
      resolve(sock);
    });
    sock.once("error", (e) => {
      clearTimeout(to);
      reject(e);
    });
  });
}

/** Opens a tunnel through the proxy to (targetHost, targetPort)
 * and returns the connected socket + its reader positioned
 * exactly at the start of the tunneled stream. */
async function openProxyStream(
  proxy: FreeProxySpec,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<{ sock: Socket; reader: SockReader }> {
  const sock = await socketConnect(proxy.host, proxy.port, timeoutMs);
  const reader = makeSockReader(sock);
  try {
    if (proxy.protocol === "socks5") {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
      const head = await reader.take(2, timeoutMs);
      if (head.length < 2 || head[0] !== 0x05 || head[1] !== 0x00) {
        throw new Error("SOCKS5 代理不支持无认证连接");
      }
      const hostBuf = Buffer.from(targetHost, "utf8");
      sock.write(
        Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
        ]),
      );
      const rh = await reader.take(4, timeoutMs);
      if (rh.length < 4) throw new Error("SOCKS5 代理响应不完整");
      if (rh[1] !== 0x00) {
        throw new Error(`SOCKS5 连接被拒（代码 ${rh[1]}）`);
      }
      const atyp = rh[3] ?? 0;
      if (atyp === 0x01) await reader.take(6, timeoutMs);
      else if (atyp === 0x03) {
        const l = await reader.take(1, timeoutMs);
        await reader.take((l[0] ?? 0) + 2, timeoutMs);
      } else if (atyp === 0x04) await reader.take(18, timeoutMs);
      else throw new Error("SOCKS5 返回地址类型异常");
    } else if (proxy.protocol === "socks4") {
      let ip: string | null = null;
      try {
        ip = (await dnsLookup(targetHost, { family: 4 })).address;
      } catch {
        ip = null;
      }
      if (!ip) throw new Error("无法把目标地址解析为 IPv4");
      const parts = ip.split(".").map((p) => Number(p) & 0xff);
      sock.write(
        Buffer.concat([
          Buffer.from([
            0x04,
            0x01,
            (targetPort >> 8) & 0xff,
            targetPort & 0xff,
          ]),
          Buffer.from(parts),
          Buffer.from([0x00]),
        ]),
      );
      const rh = await reader.take(8, timeoutMs);
      if (rh.length < 8 || rh[1] !== 90) {
        throw new Error(`SOCKS4 连接被拒（代码 ${rh[1] ?? "?"}）`);
      }
    } else {
      sock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: close\r\n\r\n`,
      );
      const head = await reader.readUntil("\r\n\r\n", timeoutMs, 16384);
      const line = head.toString("latin1").split("\r\n")[0] ?? "";
      if (!/ 200/.test(line)) {
        throw new Error(`HTTP 代理 CONNECT 失败：${line || "无响应"}`);
      }
    }
  } catch (e) {
    sock.destroy();
    throw e;
  }
  return { sock, reader };
}

type ProxyTimings = {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  waitMs: number | null;
  receiveMs: number | null;
};

type ProxyHttpResponse = {
  status: number;
  contentType: string;
  location: string;
  body: Buffer;
  truncated: boolean;
  resHeaders: [string, string][];
  // Set by fetchOnceViaProxy (it owns the stopwatch); the bare
  // reader leaves it null.
  timings: ProxyTimings | null;
};

/** Reads one HTTP/1.1 response (status, headers, body) from a
 * tunneled stream. Handles chunked and content-length bodies;
 * a connection-close body is read until close or the cap.
 * onHeaders fires the moment the response head is complete
 * (the time-to-first-byte marker for timing waterfalls). */
async function readProxyResponse(
  reader: SockReader,
  timeoutMs: number,
  maxBytes: number,
  onHeaders?: () => void,
): Promise<ProxyHttpResponse> {
  const headBuf = await reader.readUntil("\r\n\r\n", timeoutMs, 32768);
  const headText = headBuf.toString("latin1");
  const lines = headText.split("\r\n");
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(lines[0] ?? "");
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  if (!status) throw new Error("经代理收到的响应无法解析");
  const headers = new Map<string, string>();
  const resHeaders: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const name = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers.set(name, value);
      resHeaders.push([name, value]);
    }
  }
  onHeaders?.();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  const push = (b: Buffer) => {
    if (total >= maxBytes) {
      truncated = true;
      return;
    }
    const room = maxBytes - total;
    chunks.push(b.length > room ? b.subarray(0, room) : b);
    total += Math.min(b.length, room);
    if (b.length > room) truncated = true;
  };
  const te = (headers.get("transfer-encoding") ?? "").toLowerCase();
  const cl = Number(headers.get("content-length") ?? "");
  if (te.includes("chunked")) {
    for (;;) {
      const sizeLine = await reader.readLine(timeoutMs);
      const size = Number.parseInt(sizeLine.trim(), 16);
      if (!Number.isFinite(size)) throw new Error("经代理收到的分块响应异常");
      if (size === 0) {
        // trailers until the empty line
        for (;;) {
          const t = await reader.readLine(timeoutMs);
          if (t === "") break;
        }
        break;
      }
      let remaining = size;
      while (remaining > 0) {
        const part = await reader.take(remaining, timeoutMs);
        if (part.length === 0) throw new Error("经代理收到的响应中断");
        push(part);
        remaining -= part.length;
      }
      await reader.take(2, timeoutMs); // trailing CRLF
      if (truncated) break;
    }
  } else if (Number.isFinite(cl) && cl >= 0) {
    let remaining = cl;
    while (remaining > 0) {
      const part = await reader.take(remaining, timeoutMs);
      if (part.length === 0) break;
      push(part);
      remaining -= part.length;
      if (truncated) break;
    }
  } else {
    push(await reader.takeRestUntilClose(timeoutMs, maxBytes + 1));
  }
  return {
    status,
    contentType: headers.get("content-type") ?? "",
    location: headers.get("location") ?? "",
    body: Buffer.concat(chunks),
    truncated,
    resHeaders,
    timings: null,
  };
}

type WebMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** One cookie in the in-space browser's jar, as the action
 * seeds it and as Set-Cookie updates rewrite it. Matching is
 * the standard browser rule: host equals the cookie domain or
 * is a subdomain of it, the request path starts with the
 * cookie path, and Secure cookies only travel over https. */
type JarCookie = {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
};

function jarHeaderFor(jar: JarCookie[], url: URL): string {
  const host = url.hostname.toLowerCase();
  const path = url.pathname || "/";
  const byName = new Map<string, string>();
  for (const c of jar) {
    if (c.secure && url.protocol !== "https:") continue;
    if (host !== c.domain && !host.endsWith(`.${c.domain}`)) continue;
    if (!path.startsWith(c.path)) continue;
    byName.set(c.name, c.value);
  }
  return [...byName.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const idx = pathname.lastIndexOf("/");
  return idx <= 0 ? "/" : pathname.slice(0, idx);
}

/** Folds one hop's raw Set-Cookie values into the jar, the way
 * a browser would: Domain / Path attributes win over the
 * defaults, an expired cookie (Max-Age<=0 or a past Expires)
 * deletes its jar entry instead of storing an empty value. */
function jarAbsorb(jar: JarCookie[], url: URL, values: string[]): void {
  for (const raw of values) {
    const parts = raw.split(";");
    const first = (parts[0] ?? "").trim();
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    if (!name) continue;
    const value = first.slice(eq + 1).trim();
    let domain = url.hostname.toLowerCase();
    let path = defaultCookiePath(url.pathname || "/");
    let secure = false;
    let remove = false;
    for (const attrRaw of parts.slice(1)) {
      const attr = attrRaw.trim();
      const aeq = attr.indexOf("=");
      const an = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
      const av = aeq >= 0 ? attr.slice(aeq + 1).trim() : "";
      if (an === "domain" && av) domain = av.replace(/^\./, "").toLowerCase();
      else if (an === "path" && av.startsWith("/")) path = av;
      else if (an === "secure") secure = true;
      else if (an === "max-age") {
        const n = Number(av);
        if (Number.isFinite(n) && n <= 0) remove = true;
      } else if (an === "expires") {
        const t = Date.parse(av);
        if (Number.isFinite(t) && t <= Date.now()) remove = true;
      }
    }
    const idx = jar.findIndex(
      (c) => c.domain === domain && c.name === name && c.path === path,
    );
    if (remove) {
      if (idx >= 0) jar.splice(idx, 1);
      continue;
    }
    const entry: JarCookie = { domain, name, value, path, secure };
    if (idx >= 0) jar[idx] = entry;
    else jar.push(entry);
  }
}

/** Request headers a page (via the bridge) may not set itself:
 * the server owns these — host framing, the cookie jar, body
 * length, connection handling and the browser's own UA. */
const BRIDGE_FORBIDDEN_HEADERS = new Set([
  "host",
  "cookie",
  "content-length",
  "connection",
  "user-agent",
  "accept-encoding",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
]);

/** The `sec-ch-ua` brand header a real Chrome sends beside
 * every User-Agent that names a Chrome version. The browser's
 * compat identity claims Chrome (e.g. the recommended desktop
 * UA, Chrome 131) and already sends sec-ch-ua-mobile /
 * sec-ch-ua-platform — but never sent sec-ch-ua itself, an
 * inconsistent client-hints fingerprint that risk gateways
 * (ByteDance's among them) flag as a non-browser caller.
 * Derived from the UA actually being sent; a UA without a
 * Chrome token (the Safari/iOS profile) honestly gets none. */
function secChUaForUa(ua: string): string | null {
  const m = /Chrome\/(\d+)/.exec(ua || "");
  if (!m) return null;
  return `"Chromium";v="${m[1]}", "Google Chrome";v="${m[1]}", "Not-A.Brand";v="99"`;
}

function filterBridgeHeaders(
  headers: [string, string][],
): [string, string][] {
  const out: [string, string][] = [];
  for (const [n, v] of headers) {
    const ln = n.trim().toLowerCase();
    if (!ln || BRIDGE_FORBIDDEN_HEADERS.has(ln)) continue;
    if (/[\r\n]/.test(n) || /[\r\n]/.test(v)) continue;
    out.push([ln, v]);
  }
  return out;
}

/** One request through a free proxy (no redirect following —
 * the caller loops), binary-safe. */
async function fetchOnceViaProxy(
  proxy: FreeProxySpec,
  url: URL,
  opts: {
    method: WebMethod;
    bodyBuf: Buffer | null;
    contentType: string;
    extraHeaders: [string, string][];
    cookieHeader: string;
    maxBytes: number;
    timeoutMs: number;
    userAgent?: string;
    secChUaMobile?: string;
    secChUaPlatform?: string;
    ignoreCertErrors?: boolean;
  },
): Promise<ProxyHttpResponse & { reqHeaders: [string, string][] }> {
  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  // Timing segments, measured on this socket: connecting to
  // the proxy + its tunnel, the TLS handshake (https only),
  // waiting for the response head, and receiving the body.
  // The target's DNS is resolved by the proxy itself, so
  // dnsMs honestly stays null on this path.
  const t0 = Date.now();
  const { sock, reader } = await openProxyStream(
    proxy,
    url.hostname,
    port,
    opts.timeoutMs,
  );
  const connectMs = Date.now() - t0;
  let stream: Socket = sock;
  let streamReader = reader;
  let tlsMs: number | null = null;
  if (isHttps) {
    const tlsT0 = Date.now();
    const secure = tlsConnect({ socket: sock, servername: url.hostname, rejectUnauthorized: !opts.ignoreCertErrors });
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("经代理的 TLS 握手超时")), opts.timeoutMs);
      secure.once("secureConnect", () => {
        clearTimeout(to);
        resolve();
      });
      secure.once("error", (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
    tlsMs = Date.now() - tlsT0;
    stream = secure as unknown as Socket;
    streamReader = makeSockReader(stream);
  }
  try {
    const pathQ = (url.pathname || "/") + (url.search || "");
    const hostHeader = url.port
      ? `${url.hostname}:${url.port}`
      : url.hostname;
    const bodyBuf = opts.bodyBuf;
    const reqHeaders: [string, string][] = [
      ["host", hostHeader],
      ["user-agent", opts.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"],
      ...(opts.secChUaMobile
        ? ([["sec-ch-ua-mobile", opts.secChUaMobile]] as [string, string][])
        : []),
      ...(opts.secChUaPlatform
        ? ([["sec-ch-ua-platform", opts.secChUaPlatform]] as [string, string][])
        : []),
      ...(secChUaForUa(opts.userAgent || "") &&
      !opts.extraHeaders.some(([n]) => n === "sec-ch-ua")
        ? ([["sec-ch-ua", secChUaForUa(opts.userAgent || "") as string]] as [
            string,
            string,
          ][])
        : []),
      ["accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
      ["accept-language", "zh-CN,zh;q=0.9,en;q=0.8"],
      ["accept-encoding", "identity"],
      ...opts.extraHeaders,
      ...(opts.cookieHeader
        ? ([["cookie", opts.cookieHeader]] as [string, string][])
        : []),
      ...(bodyBuf
        ? ([
            ...(opts.extraHeaders.some(([n]) => n === "content-type")
              ? []
              : ([
                  [
                    "content-type",
                    opts.contentType || "application/x-www-form-urlencoded",
                  ],
                ] as [string, string][])),
            ["content-length", String(bodyBuf.length)],
          ] as [string, string][])
        : []),
      ["connection", "close"],
    ];
    const head =
      `${opts.method} ${pathQ} HTTP/1.1\r\n` +
      reqHeaders.map(([k, v]) => `${k}: ${v}\r\n`).join("") +
      "\r\n";
    const sentAt = Date.now();
    stream.write(head);
    if (bodyBuf) stream.write(bodyBuf);
    let headersAt = 0;
    const resp = await readProxyResponse(
      streamReader,
      opts.timeoutMs,
      opts.maxBytes,
      () => {
        headersAt = Date.now();
      },
    );
    const doneAt = Date.now();
    resp.timings = {
      dnsMs: null,
      connectMs,
      tlsMs,
      waitMs: headersAt ? headersAt - sentAt : null,
      receiveMs: headersAt ? doneAt - headersAt : null,
    };
    return { ...resp, reqHeaders };
  } finally {
    stream.destroy();
  }
}

/** fetchWebPage through a user-selected free proxy, following
 * redirects like a browser (301/302/303 turn a body-carrying
 * method into GET) and keeping the cookie jar across hops. */
async function fetchWebPageViaProxy(
  proxy: FreeProxySpec,
  startUrl: URL,
  args: {
    method: WebMethod;
    bodyBuf: Buffer | null;
    contentType: string;
    extraHeaders: [string, string][];
    cookies: JarCookie[];
    maxBytes: number;
    timeoutMs: number;
    userAgent?: string;
    secChUaMobile?: string;
    secChUaPlatform?: string;
    ignoreCertErrors?: boolean;
  },
): Promise<{
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  bodyBase64: string;
  truncated: boolean;
  error: string;
  durationMs: number;
  requestHeaders: [string, string][];
  responseHeaders: [string, string][];
  timings: ProxyTimings | null;
  setCookies: { url: string; values: string[] }[];
}> {
  const startedAt = Date.now();
  const jar: JarCookie[] = args.cookies.map((c) => ({ ...c }));
  const setCookies: { url: string; values: string[] }[] = [];
  let current = startUrl;
  let method = args.method;
  let bodyBuf = args.bodyBuf;
  for (let hop = 0; hop <= 5; hop++) {
    let r: ProxyHttpResponse & { reqHeaders: [string, string][] };
    try {
      r = await fetchOnceViaProxy(proxy, current, {
        method,
        bodyBuf,
        contentType: args.contentType,
        extraHeaders: args.extraHeaders,
        cookieHeader: jarHeaderFor(jar, current),
        maxBytes: args.maxBytes,
        timeoutMs: args.timeoutMs,
        userAgent: args.userAgent,
        secChUaMobile: args.secChUaMobile,
        secChUaPlatform: args.secChUaPlatform,
        ignoreCertErrors: args.ignoreCertErrors,
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        finalUrl: current.toString(),
        contentType: "",
        bodyBase64: "",
        truncated: false,
        error: `经免费代理（${proxy.protocol}://${proxy.host}:${proxy.port}）访问失败：${e instanceof Error ? e.message : "网络错误"}——免费代理随时会失效，可在代理中心换一个或停止使用`,
        durationMs: Date.now() - startedAt,
        requestHeaders: [],
        responseHeaders: [],
        timings: null,
        setCookies,
      };
    }
    const hopSetCookies = r.resHeaders
      .filter(([n]) => n === "set-cookie")
      .map(([, v]) => v);
    if (hopSetCookies.length > 0) {
      setCookies.push({ url: current.toString(), values: hopSetCookies });
      jarAbsorb(jar, current, hopSetCookies);
    }
    const isRedirect = [301, 302, 303, 307, 308].includes(r.status);
    if (isRedirect && r.location && hop < 5) {
      let next: URL;
      try {
        next = new URL(r.location, current);
      } catch {
        break;
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") break;
      if (
        (r.status === 301 || r.status === 302 || r.status === 303) &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        method = "GET";
        bodyBuf = null;
      }
      current = next;
      continue;
    }
    return {
      ok: r.status >= 200 && r.status < 400,
      status: r.status,
      finalUrl: current.toString(),
      contentType: r.contentType,
      bodyBase64: r.body.toString("base64"),
      truncated: r.truncated,
      error: r.status >= 400 ? `网站返回 HTTP ${r.status}` : "",
      durationMs: Date.now() - startedAt,
      requestHeaders: r.reqHeaders ?? [],
      responseHeaders: r.resHeaders,
      timings: r.timings,
      setCookies,
    };
  }
  return {
    ok: false,
    status: 0,
    finalUrl: current.toString(),
    contentType: "",
    bodyBase64: "",
    truncated: false,
    error: "经免费代理访问时重定向次数过多",
    durationMs: Date.now() - startedAt,
    requestHeaders: [],
    responseHeaders: [],
    timings: null,
    setCookies,
  };
}

// --- blob store reads for image previews ---
// The blob store lives beside this artifact (index.sqlite maps
// key → object_id; bytes under objects/<object_id 前两位>/<object_id>).
function blobStoreDir(): string {
  return join(
    homedir(),
    "workspace",
    "ts-spaces",
    "zhuo-mian-liao-tian-kong-jian",
    "blobs",
  );
}

/** Every blob store a lookup may consult, in order: the
 * production store first (in production it is the only one and
 * behaviour is exactly as before), then any sandbox
 * data-workspace stores (.space-build/data-workspaces/<id>/blobs)
 * so images a sandbox build just wrote — an uploaded 图像
 * project, a split part — can be found by the same readers
 * during verification. Keys carry a timestamp + random suffix,
 * so a cross-store key collision is not a practical concern,
 * and the production store always wins when it has the key. */
function candidateBlobStoreDirs(): string[] {
  const dirs = [blobStoreDir()];
  try {
    const wsRoot = join(
      homedir(),
      "workspace",
      "ts-spaces",
      "zhuo-mian-liao-tian-kong-jian",
      ".space-build",
      "data-workspaces",
    );
    for (const entry of readdirSync(wsRoot)) {
      const d = join(wsRoot, entry, "blobs");
      try {
        if (existsSync(join(d, "index.sqlite"))) dirs.push(d);
      } catch {
        // an unreadable entry is simply not a candidate
      }
    }
  } catch {
    // no sandbox workspaces — production only
  }
  return dirs;
}

async function lookupBlobObjectIn(
  storeDir: string,
  key: string,
): Promise<
  | { objectId: string; contentType: string }
  | { error: string }
  | null
> {
  const indexPath = join(storeDir, "index.sqlite");
  try {
    const mod = (await import("bun:sqlite")) as {
      Database: new (
        path: string,
        opts?: { readonly?: boolean },
      ) => {
        query: (sql: string) => {
          get: (
            ...params: unknown[]
          ) => { object_id?: unknown; content_type?: unknown } | null;
        };
        close: () => void;
      };
    };
    const db = new mod.Database(indexPath, { readonly: true });
    try {
      const row = db
        .query(
          "SELECT object_id, content_type FROM blobs WHERE key = ? LIMIT 1",
        )
        .get(key);
      if (row && typeof row.object_id === "string") {
        return {
          objectId: row.object_id,
          contentType:
            typeof row.content_type === "string" ? row.content_type : "",
        };
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      error: `读取图片索引失败：${e instanceof Error ? e.message : "未知错误"}`,
    };
  }
  return null;
}

/** Finds one blob key across the candidate stores (production
 * first), returning the store it was found in alongside the
 * object id — callers must read (and cache previews) inside
 * THAT store. */
async function lookupBlobObject(
  key: string,
): Promise<
  | { storeDir: string; objectId: string; contentType: string }
  | { error: string }
> {
  for (const dir of candidateBlobStoreDirs()) {
    const found = await lookupBlobObjectIn(dir, key);
    if (found && "objectId" in found) {
      return { storeDir: dir, objectId: found.objectId, contentType: found.contentType };
    }
    if (found && "error" in found) return found;
  }
  return { error: "这张图片的存储记录不存在，可能已被删除" };
}

/** Runs GraphicsMagick once to shrink `src` into a JPEG at `dest`
 * (longest side capped at maxDim, transparency flattened onto
 * white — the same treatment the client canvas path used).
 * Resolves false on any failure so the caller can fall back to
 * the original bytes. */
function runGmConvert(
  src: string,
  dest: string,
  maxDim: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        "gm",
        [
          "convert",
          src,
          "-background",
          "white",
          "-flatten",
          "-resize",
          `${maxDim}x${maxDim}>`,
          "-quality",
          "84",
          dest,
        ],
        { stdio: "ignore" },
      );
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      finish(false);
    }, 25000);
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/** Reads an image's pixel size with GraphicsMagick identify.
 * Resolves null on any failure. */
function runGmIdentify(
  src: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { width: number; height: number } | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("gm", ["identify", "-format", "%w %h", src], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      finish(null);
      return;
    }
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      finish(null);
    }, 25000);
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      const m = /(\d+)\s+(\d+)/.exec(out.trim());
      if (!m) return finish(null);
      finish({ width: Number(m[1]), height: Number(m[2]) });
    });
  });
}

/** Crops one WxH+X+Y tile out of `src` into `dest` (PNG — the
 * destination extension picks the format). Resolves false on
 * any failure. */
function runGmCrop(
  src: string,
  dest: string,
  w: number,
  h: number,
  x: number,
  y: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        "gm",
        ["convert", src, "-crop", `${w}x${h}+${x}+${y}`, "+repage", dest],
        { stdio: "ignore" },
      );
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      finish(false);
    }, 25000);
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/** Ensures the cached preview JPEG for one blob object exists
 * at previews/<object_id>-<maxDim>.jpg and returns its path, or
 * null when generation failed (the caller then falls back to
 * the original bytes). An existing non-empty cache file is
 * returned as-is — previews are generated exactly once per
 * (object, size), which is what keeps image-heavy rooms from
 * re-generating (and re-shipping) megabytes on every open.
 * Shared by readBlobPreview (single image, on demand) and
 * prewarmBlobPreviews (every stored image, ahead of time). */
async function ensurePreviewFile(
  storeDir: string,
  objectId: string,
  maxDim: number,
): Promise<string | null> {
  const cacheDir = join(storeDir, "previews");
  const cachePath = join(cacheDir, `${objectId}-${maxDim}.jpg`);
  try {
    if (existsSync(cachePath) && readFileSync(cachePath).length > 0) {
      return cachePath;
    }
  } catch {
    // regenerate below
  }
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {
    // the convert below will fail and the caller falls back
  }
  const srcPath = join(storeDir, "objects", objectId.slice(0, 2), objectId);
  // The temp name must keep the .jpg suffix: GraphicsMagick
  // picks the output format from the file extension, and an
  // unknown suffix silently keeps the input format (a 360px
  // PNG is ~5x the bytes of the JPEG this cache exists for).
  const tmpPath = `${cachePath}.tmp-${process.pid}.jpg`;
  const converted = await runGmConvert(srcPath, tmpPath, maxDim);
  if (converted) {
    try {
      renameSync(tmpPath, cachePath);
      if (readFileSync(cachePath).length > 0) return cachePath;
    } catch {
      // fall through to the failure return
    }
  }
  try {
    unlinkSync(tmpPath);
  } catch {
    // nothing to clean up
  }
  return null;
}

/** The password vault's AES-256 key file: 32 random bytes as hex,
 * created on first use with mode 0600 beside the artifact (NOT in
 * the database — a database copy alone can never decrypt a saved
 * password). Read fresh on every call so a replaced key takes
 * effect without a restart. */
function vaultKeyPath(): string {
  return join(
    homedir(),
    "workspace",
    "ts-spaces",
    "zhuo-mian-liao-tian-kong-jian",
    "vault.key",
  );
}

function loadVaultKey(): Buffer {
  const path = vaultKeyPath();
  try {
    const raw = readFileSync(path, "utf8").trim();
    const key = Buffer.from(raw, "hex");
    if (key.length === 32) return key;
  } catch {
    // fall through and create it
  }
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex"), { mode: 0o600 });
  return key;
}

/* ---------------- agent host permissions ----------------
 * The filesystem scope for the host file tools: an agent the
 * user granted file editing to may list / read / write text
 * files under ~/workspace, ~/memory and /tmp — nowhere else.
 * Sensitive material inside that scope is still refused:
 * credential directories and files (.ssh, .aws, .gnupg,
 * .netrc, *.pem / *.key, .env files, this artifact's vault.key)
 * must never be readable or overwritable through an agent, no
 * matter which switch is on. Paths are resolved (dot segments
 * and ~ expanded) before either check, so traversal spellings
 * cannot sneak past. */
function resolveHostPath(raw: string): string {
  let p = raw.trim();
  if (p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  return resolve(p);
}

function hostPathVerdict(abs: string): { ok: true } | { ok: false; error: string } {
  const home = homedir();
  const roots = [join(home, "workspace"), join(home, "memory"), "/tmp"];
  if (!roots.some((r) => abs === r || abs.startsWith(`${r}/`))) {
    return {
      ok: false,
      error: `路径不在允许范围内（只能操作 ${join(home, "workspace")}、${join(home, "memory")} 和 /tmp 下的文件）：${abs}`,
    };
  }
  const lower = abs.toLowerCase();
  const blockedSegments = ["/.ssh/", "/.aws/", "/.gnupg/", "/.config/gh/"];
  if (
    blockedSegments.some((s) => lower.includes(s)) ||
    lower.endsWith("/.netrc") ||
    lower.endsWith("/vault.key") ||
    /(^|\/)\.env(\.|$)/.test(lower) ||
    /\.(pem|key|p12|pfx)$/.test(lower)
  ) {
    return { ok: false, error: `该路径属于敏感凭证文件，禁止智能体访问：${abs}` };
  }
  return { ok: true };
}

const HOST_OUTPUT_CAP = 30000;
function capHostOutput(s: string): string {
  return s.length > HOST_OUTPUT_CAP
    ? `${s.slice(0, HOST_OUTPUT_CAP)}\n…（输出过长，已截断到前 ${HOST_OUTPUT_CAP} 字）`
    : s;
}

/* One HTTP hop over node:http/https with certificate
 * verification DISABLED — the transport for 浏览器设置 →
 * 忽略证书错误. Only called when that setting is on. Follows
 * no redirects itself (the caller loops, exactly like the
 * fetch path), asks for identity encoding and still decodes
 * gzip/deflate/br if a server sends them anyway. */
function fetchOneHopInsecure(
  target: URL,
  opts: {
    method: string;
    headers: Record<string, string>;
    bodyBuf: Buffer | null;
    timeoutMs: number;
  },
): Promise<{
  status: number;
  headers: Map<string, string>;
  setCookies: string[];
  headerPairs: [string, string][];
  body: Buffer;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isHttps = target.protocol === "https:";
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const req = doRequest(
      {
        hostname: target.hostname,
        port: target.port ? Number(target.port) : isHttps ? 443 : 80,
        path: (target.pathname || "/") + (target.search || ""),
        method: opts.method,
        headers: { ...opts.headers, "accept-encoding": "identity" },
        timeout: opts.timeoutMs,
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let body = Buffer.concat(chunks);
          const enc = (res.headers["content-encoding"] ?? "").toLowerCase();
          try {
            if (enc.includes("gzip")) body = gunzipSync(body);
            else if (enc.includes("deflate")) body = inflateSync(body);
            else if (enc.includes("br")) body = brotliDecompressSync(body);
          } catch {
            // undecodable body is returned as received
          }
          const headers = new Map<string, string>();
          const headerPairs: [string, string][] = [];
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            if (Array.isArray(v)) {
              for (const item of v) headerPairs.push([k, item]);
              if (k !== "set-cookie") headers.set(k, v.join(", "));
            } else {
              headers.set(k, v);
              headerPairs.push([k, v]);
            }
          }
          const rawSet = res.headers["set-cookie"];
          const setCookies = rawSet ? [...rawSet] : [];
          resolvePromise({
            status: res.statusCode ?? 0,
            headers,
            setCookies,
            headerPairs,
            body,
          });
        });
        res.on("error", rejectPromise);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("请求超时"));
    });
    req.on("error", rejectPromise);
    if (opts.bodyBuf) req.write(opts.bodyBuf);
    req.end();
  });
}

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  async execLinuxCommand(args) {
    const command = args.command.trim();
    if (!command) {
      return { ok: false, exitCode: -1, stdout: "", stderr: "", timedOut: false, error: "命令为空" };
    }
    const timeoutMs = Math.min(60, Math.max(1, args.timeoutSecs)) * 1000;
    return await new Promise((resolvePromise) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("bash", ["-lc", command], {
          cwd: join(homedir(), "workspace"),
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });
      } catch (e) {
        resolvePromise({
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          timedOut: false,
          error: `无法启动命令：${e instanceof Error ? e.message : "未知错误"}`,
        });
        return;
      }
      let out = "";
      let err = "";
      let timedOut = false;
      child.stdout?.on("data", (d: Buffer) => {
        if (out.length < HOST_OUTPUT_CAP * 2) out += d.toString("utf8");
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (err.length < HOST_OUTPUT_CAP * 2) err += d.toString("utf8");
      });
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolvePromise({
          ok: false,
          exitCode: -1,
          stdout: capHostOutput(out),
          stderr: capHostOutput(err),
          timedOut,
          error: `命令启动失败：${e.message}`,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = typeof code === "number" ? code : -1;
        resolvePromise({
          ok: exitCode === 0 && !timedOut,
          exitCode,
          stdout: capHostOutput(out),
          stderr: capHostOutput(err),
          timedOut,
          error: timedOut
            ? `命令超时（${timeoutMs / 1000} 秒），已终止`
            : "",
        });
      });
    });
  },
  async hostListDir(args) {
    const abs = resolveHostPath(args.path);
    const verdict = hostPathVerdict(abs);
    if (!verdict.ok) return { ok: false, entries: [], error: verdict.error };
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const names = readdirSync(abs).slice(0, 500);
      const entries = names.map((name) => {
        let isDir = false;
        let size = 0;
        try {
          const st = statSync(join(abs, name));
          isDir = st.isDirectory();
          size = st.size;
        } catch {
          // unreadable entry: listed with size 0
        }
        return { name, isDir, size };
      });
      entries.sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      );
      return { ok: true, entries, error: "" };
    } catch (e) {
      return {
        ok: false,
        entries: [],
        error: `无法列出目录：${e instanceof Error ? e.message : "未知错误"}`,
      };
    }
  },
  async hostReadFile(args) {
    const abs = resolveHostPath(args.path);
    const verdict = hostPathVerdict(abs);
    if (!verdict.ok) return { ok: false, content: "", truncated: false, error: verdict.error };
    try {
      const bytes = readFileSync(abs);
      if (bytes.length > 2 * 1024 * 1024) {
        return { ok: false, content: "", truncated: false, error: "文件超过 2MB，无法通过此工具读取" };
      }
      if (bytes.includes(0)) {
        return { ok: false, content: "", truncated: false, error: "该文件是二进制文件，无法按文本读取" };
      }
      const content = bytes.toString("utf8");
      const CAP = 60000;
      return {
        ok: true,
        content: content.length > CAP ? content.slice(0, CAP) : content,
        truncated: content.length > CAP,
        error: "",
      };
    } catch (e) {
      return {
        ok: false,
        content: "",
        truncated: false,
        error: `无法读取文件：${e instanceof Error ? e.message : "未知错误"}`,
      };
    }
  },
  async hostWriteFile(args) {
    const abs = resolveHostPath(args.path);
    const verdict = hostPathVerdict(abs);
    if (!verdict.ok) return { ok: false, bytes: 0, error: verdict.error };
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, args.content, "utf8");
      return { ok: true, bytes: Buffer.byteLength(args.content, "utf8"), error: "" };
    } catch (e) {
      return {
        ok: false,
        bytes: 0,
        error: `无法写入文件：${e instanceof Error ? e.message : "未知错误"}`,
      };
    }
  },
  vaultEncrypt(args) {
    try {
      const key = loadVaultKey();
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([
        cipher.update(args.text, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return {
        ok: true,
        text: `v1:${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`,
        error: "",
      };
    } catch (e) {
      return {
        ok: false,
        text: "",
        error: `密码加密失败：${e instanceof Error ? e.message : "未知错误"}`,
      };
    }
  },
  vaultDecrypt(args) {
    try {
      const body = args.text.startsWith("v1:")
        ? args.text.slice(3)
        : args.text;
      const parts = body.split(".");
      if (parts.length !== 3) return { ok: false, text: "", error: "密码数据格式不正确" };
      const [ivB64, tagB64, dataB64] = parts as [string, string, string];
      const key = loadVaultKey();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivB64, "base64"),
      );
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]);
      return { ok: true, text: dec.toString("utf8"), error: "" };
    } catch {
      return { ok: false, text: "", error: "密码解密失败（数据可能已损坏或密钥已更换）" };
    }
  },
  pioneerEncrypt(args) {
    try {
      const cipher = createCipheriv(
        "aes-128-cbc",
        Buffer.from("btB0KwUmFcNk0PE3", "utf8"),
        Buffer.from("hMeYA6IvQj2Vc7xc", "utf8"),
      );
      const enc = Buffer.concat([cipher.update(args.text, "utf8"), cipher.final()]);
      return { ok: true, text: enc.toString("base64") };
    } catch {
      return { ok: false, text: "" };
    }
  },
  pioneerDecrypt(args) {
    try {
      const decipher = createDecipheriv(
        "aes-128-cbc",
        Buffer.from("btB0KwUmFcNk0PE3", "utf8"),
        Buffer.from("hMeYA6IvQj2Vc7xc", "utf8"),
      );
      const dec = Buffer.concat([
        decipher.update(Buffer.from(args.text, "base64")),
        decipher.final(),
      ]);
      return { ok: true, text: dec.toString("utf8") };
    } catch {
      return { ok: false, text: "" };
    }
  },
  randomUuid() {
    return { uuid: randomUUID() };
  },
  // Reads one stored blob's bytes back from this artifact's own
  // blob store on disk (blobs/index.sqlite maps key → object_id;
  // the bytes live in blobs/objects/<object_id 前两位>/<object_id>).
  // The action layer has no blob byte read (ctx.blobs offers only
  // put/getUrl/delete/head/list, and the URL it returns is a
  // client-relative path the server cannot fetch), so preview
  // images get their bytes through here and travel back over the
  // actions channel. The key is validated against the charset
  // every key this app writes uses, which also keeps the index
  // lookup's SQL free of anything quotable.
  async readBlobBytes(args) {
    const fail = (error: string) => ({
      ok: false,
      dataBase64: "",
      contentType: "",
      error,
    });
    const key = args.key;
    if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..")) {
      return fail("文件地址无效，无法读取");
    }
    const looked = await lookupBlobObject(key);
    if ("error" in looked) return fail(looked.error);
    const { objectId, contentType } = looked;
    if (!objectId || !/^[a-f0-9]{64}$/.test(objectId)) {
      return fail("这个文件的存储记录不存在，可能已被删除");
    }
    try {
      const bytes = readFileSync(
        join(looked.storeDir, "objects", objectId.slice(0, 2), objectId),
      );
      if (bytes.length === 0) return fail("文件内容为空，无法读取");
      // The cap matches the reply-media store's own acceptance
      // cap (64MB): a file the space agreed to store — a large
      // generated original included — must always be readable
      // back for download. The old 16MB cap made stored files
      // between 16MB and 64MB permanently undownloadable.
      if (bytes.length > 64 * 1024 * 1024) {
        return fail("文件过大，无法读取");
      }
      return {
        ok: true,
        dataBase64: Buffer.from(bytes).toString("base64"),
        contentType: contentType || "image/png",
        error: "",
      };
    } catch {
      return fail("这个文件的存储文件不存在，可能已被删除");
    }
  },
  // Preview-sized read of one stored image: the bytes that travel
  // back over the actions channel are a downscaled JPEG generated
  // ONCE here (GraphicsMagick) and cached beside the blob store
  // (previews/<object_id>-<maxDim>.jpg), instead of the full
  // original on every view. A generated photo is 1–4 MB as a PNG;
  // its 1440px preview is a few hundred KB and its 360px
  // thumbnail a few tens of KB, which is what makes image-heavy
  // rooms open quickly and stops the preview traffic from
  // crowding out every other action on the user's phone. GIF and
  // SVG keep their original bytes (animation / vector), and any
  // gm failure falls back to the original bytes — the client's
  // own downscale then still applies, exactly as before.
  async readBlobPreview(args) {
    const fail = (error: string) => ({
      ok: false,
      dataBase64: "",
      contentType: "",
      error,
    });
    const key = args.key;
    if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..")) {
      return fail("图片地址无效，无法预览");
    }
    const looked = await lookupBlobObject(key);
    if ("error" in looked) return fail(looked.error);
    const { objectId, contentType } = looked;
    const storeDir = looked.storeDir;
    if (!/^[a-f0-9]{64}$/.test(objectId)) {
      return fail("这张图片的存储记录不存在，可能已被删除");
    }
    const srcPath = join(
      storeDir,
      "objects",
      objectId.slice(0, 2),
      objectId,
    );
    const passthrough =
      contentType === "image/gif" || contentType === "image/svg+xml";
    if (!passthrough) {
      const cachePath = await ensurePreviewFile(storeDir, objectId, args.maxDim);
      if (cachePath) {
        try {
          const cached = readFileSync(cachePath);
          if (cached.length > 0) {
            return {
              ok: true,
              dataBase64: Buffer.from(cached).toString("base64"),
              contentType: "image/jpeg",
              error: "",
            };
          }
        } catch {
          // fall back to the original bytes below
        }
      }
    }
    try {
      const bytes = readFileSync(srcPath);
      if (bytes.length === 0) return fail("图片内容为空，无法预览");
      if (bytes.length > 16 * 1024 * 1024) {
        return fail("图片过大，无法预览");
      }
      return {
        ok: true,
        dataBase64: Buffer.from(bytes).toString("base64"),
        contentType: contentType || "image/png",
        error: "",
      };
    } catch {
      return fail("这张图片的存储文件不存在，可能已被删除");
    }
  },
  // Splits one stored image into a rows × cols grid of PNG
  // tiles for the 图像 workspace. Tile boundaries are computed
  // by rounding cumulative fractions, so the tiles exactly tile
  // the original with no gaps or overlaps. The original object
  // is only read. Tiles come back as base64; the action layer
  // stores each one as its own blob.
  async splitBlobImage(args) {
    const fail = (error: string) => ({
      ok: false,
      width: 0,
      height: 0,
      tiles: [] as {
        dataBase64: string;
        contentType: string;
        width: number;
        height: number;
      }[],
      error,
    });
    const key = args.key;
    if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..")) {
      return fail("图片地址无效，无法切分");
    }
    const looked = await lookupBlobObject(key);
    if ("error" in looked) return fail(looked.error);
    const { objectId } = looked;
    const storeDir = looked.storeDir;
    if (!/^[a-f0-9]{64}$/.test(objectId)) {
      return fail("这张图片的存储记录不存在，可能已被删除");
    }
    const srcPath = join(storeDir, "objects", objectId.slice(0, 2), objectId);
    const size = await runGmIdentify(srcPath);
    if (!size || size.width < 1 || size.height < 1) {
      return fail("读不到这张图片的尺寸，无法切分");
    }
    const { width, height } = size;
    const tmpDir = join(storeDir, "split-tmp");
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch {
      return fail("切分准备失败，请重试");
    }
    const tiles: {
      dataBase64: string;
      contentType: string;
      width: number;
      height: number;
    }[] = [];
    const stamp = `${process.pid}-${Date.now()}`;
    try {
      for (let r = 0; r < args.rows; r++) {
        const y0 = Math.round((r * height) / args.rows);
        const y1 = Math.round(((r + 1) * height) / args.rows);
        for (let c = 0; c < args.cols; c++) {
          const x0 = Math.round((c * width) / args.cols);
          const x1 = Math.round(((c + 1) * width) / args.cols);
          const tileW = Math.max(1, x1 - x0);
          const tileH = Math.max(1, y1 - y0);
          const dest = join(tmpDir, `${stamp}-${r}-${c}.png`);
          const okCrop = await runGmCrop(
            srcPath,
            dest,
            tileW,
            tileH,
            x0,
            y0,
          );
          if (!okCrop) return fail("切分失败，请重试");
          try {
            const bytes = readFileSync(dest);
            if (bytes.length === 0) return fail("切分失败，请重试");
            tiles.push({
              dataBase64: Buffer.from(bytes).toString("base64"),
              contentType: "image/png",
              width: tileW,
              height: tileH,
            });
          } finally {
            try {
              unlinkSync(dest);
            } catch {
              // temp cleanup is best-effort
            }
          }
        }
      }
    } catch {
      return fail("切分失败，请重试");
    }
    return { ok: true, width, height, tiles, error: "" };
  },
  // Pre-generates BOTH cached preview sizes (360px thumb and
  // 1440px full) for every image in the blob store, ahead of
  // any first open. Until this existed, a room's images each
  // generated their preview on first view — a multi-megabyte
  // original's GraphicsMagick pass plus its base64 trip through
  // the same actions channel every other request (including
  // the member panel's small setGroupMember call) queues
  // behind, which is what made 加入 feel stuck and surfaced as
  // 加载失败 timeouts in image-heavy rooms like 群聊4. Counts
  // are per (image, size): generated = newly written now,
  // cached = already on disk and left untouched, skipped =
  // not a previewable image (non-image blob, or GIF/SVG which
  // readBlobPreview passes through), failed = generation was
  // attempted and did not produce a file.
  async prewarmBlobPreviews() {
    const counts = { generated: 0, cached: 0, skipped: 0, failed: 0 };
    const storeDir = blobStoreDir();
    try {
      const mod = (await import("bun:sqlite")) as {
        Database: new (
          path: string,
          opts?: { readonly?: boolean },
        ) => {
          query: (sql: string) => {
            all: (
              ...params: unknown[]
            ) => { object_id?: unknown; content_type?: unknown }[];
          };
          close: () => void;
        };
      };
      const db = new mod.Database(join(storeDir, "index.sqlite"), {
        readonly: true,
      });
      let rows: { object_id?: unknown; content_type?: unknown }[] = [];
      try {
        rows = db.query("SELECT object_id, content_type FROM blobs").all();
      } finally {
        db.close();
      }
      for (const row of rows) {
        const objectId =
          typeof row.object_id === "string" ? row.object_id : "";
        const contentType =
          typeof row.content_type === "string" ? row.content_type : "";
        if (
          !/^[a-f0-9]{64}$/.test(objectId) ||
          !contentType.startsWith("image/") ||
          contentType === "image/gif" ||
          contentType === "image/svg+xml"
        ) {
          counts.skipped++;
          continue;
        }
        for (const maxDim of [360, 1440]) {
          const cachePath = join(
            storeDir,
            "previews",
            `${objectId}-${maxDim}.jpg`,
          );
          let existed = false;
          try {
            existed = existsSync(cachePath) && readFileSync(cachePath).length > 0;
          } catch {
            existed = false;
          }
          if (existed) {
            counts.cached++;
            continue;
          }
          const made = await ensurePreviewFile(storeDir, objectId, maxDim);
          if (made) counts.generated++;
          else counts.failed++;
        }
      }
      return { ok: true, ...counts, error: "" };
    } catch (e) {
      return {
        ok: false,
        ...counts,
        error: `预览图预生成失败：${e instanceof Error ? e.message : "未知错误"}`,
      };
    }
  },
  async runCodeSnippet(args) {
    const fail = (error: string) => ({ ok: false, exitCode: -1, stdout: "", stderr: "", timedOut: false, error });
    const lang = args.language.trim().toLowerCase();
    let cmd: string[] | null = null;
    let ext = "txt";
    if (lang === "javascript" || lang === "js" || lang === "node") { ext = "js"; }
    else if (lang === "typescript" || lang === "ts") { ext = "ts"; }
    else if (lang === "python" || lang === "py" || lang === "python3") { ext = "py"; }
    else if (lang === "html" || lang === "css") { return fail("HTML / CSS 不需要运行，请用预览查看效果"); }
    else { return fail(`暂不支持直接运行 ${args.language}，目前可运行 JavaScript、TypeScript 和 Python`); }
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    let dir = "";
    try {
      dir = mkdtempSync(join(tmpdir(), "space-code-run-"));
      const safeName = (args.fileName || `main.${ext}`).replace(/[^A-Za-z0-9._-]/g, "_");
      // A name that already carries a runnable extension keeps
      // it (main.jsx / app.tsx / script.py run as themselves —
      // bun handles the JSX/TSX variants); only an extensionless
      // or foreign-named file gains the language's extension.
      // The old endsWith(`.${ext}`) check turned main.jsx into
      // main.jsx.js, which no longer parses as JSX.
      const filePath = join(
        dir,
        /\.(?:js|jsx|mjs|cjs|ts|tsx|py)$/i.test(safeName)
          ? safeName
          : `${safeName}.${ext}`,
      );
      writeFileSync(filePath, args.code);
      if (ext === "py") cmd = ["python3", filePath];
      else cmd = [process.execPath, "run", filePath];
      const result = await new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
        let child: ReturnType<typeof spawn>;
        try { child = spawn(cmd![0]!, cmd!.slice(1), { stdio: ["ignore", "pipe", "pipe"], cwd: dir }); }
        catch { resolve({ exitCode: -1, stdout: "", stderr: "无法启动运行环境", timedOut: false }); return; }
        let out = ""; let err = ""; let timedOut = false;
        const cap = (s: string) => (s.length > 60000 ? s.slice(0, 60000) + "\n…（输出过长，已截断）" : s);
        child.stdout?.on("data", (d: Buffer) => { out = cap(out + d.toString("utf8")); });
        child.stderr?.on("data", (d: Buffer) => { err = cap(err + d.toString("utf8")); });
        const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch {} }, 10000);
        child.on("error", (e) => { clearTimeout(timer); resolve({ exitCode: -1, stdout: out, stderr: err || e.message, timedOut }); });
        child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: typeof code === "number" ? code : -1, stdout: out, stderr: err, timedOut }); });
      });
      return { ok: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, stdout: result.stdout, stderr: result.timedOut ? (result.stderr + "\n运行超时（10 秒），已终止") : result.stderr, timedOut: result.timedOut, error: "" };
    } catch (e) {
      return fail(`运行失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
    }
  },
  async pioneerTunnelStart(args) {
    const dir = tunnelDir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return { ok: false, running: false, error: `无法创建隧道目录：${e instanceof Error ? e.message : "未知错误"}` };
    }
    const scriptPath = join(dir, "trojan-daemon.mjs");
    try {
      const existing = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
      if (existing !== PIONEER_TUNNEL_DAEMON_SOURCE) {
        writeFileSync(scriptPath, PIONEER_TUNNEL_DAEMON_SOURCE);
      }
    } catch (e) {
      return { ok: false, running: false, error: `无法写入隧道守护进程：${e instanceof Error ? e.message : "未知错误"}` };
    }
    const status = readTunnelStatusFile();
    if (status && tunnelPidAlive(status.pid)) {
      let sameConfig = false;
      try {
        const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
          host?: unknown;
          port?: unknown;
          password?: unknown;
          sni?: unknown;
        };
        sameConfig =
          cfg.host === args.host &&
          cfg.port === args.port &&
          cfg.password === args.password &&
          (typeof cfg.sni === "string" ? cfg.sni : "") === (args.sni ?? "");
      } catch {
        sameConfig = false;
      }
      if (sameConfig) return { ok: true, running: true, error: "" };
      try {
        process.kill(status.pid, "SIGTERM");
      } catch {
        // already gone
      }
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if (!(await tryConnectOnce(TUNNEL_PORT, 250))) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ host: args.host, port: args.port, password: args.password, sni: args.sni ?? "" }),
      );
      writeFileSync(join(dir, "status.json"), "");
    } catch (e) {
      return { ok: false, running: false, error: `无法写入隧道配置：${e instanceof Error ? e.message : "未知错误"}` };
    }
    try {
      const child = spawn(process.execPath, [scriptPath], {
        detached: true,
        stdio: "ignore",
        cwd: dir,
      });
      child.on("error", () => {});
      child.unref();
    } catch (e) {
      return { ok: false, running: false, error: `无法启动隧道守护进程：${e instanceof Error ? e.message : "未知错误"}` };
    }
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await tryConnectOnce(TUNNEL_PORT, 400)) {
        return { ok: true, running: true, error: "" };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const after = readTunnelStatusFile();
    return {
      ok: false,
      running: false,
      error: after?.lastError || "隧道守护进程未能在本地端口 19352 上启动",
    };
  },
  pioneerTunnelStop() {
    const status = readTunnelStatusFile();
    if (status && tunnelPidAlive(status.pid)) {
      try {
        process.kill(status.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    try {
      writeFileSync(join(tunnelDir(), "status.json"), "");
    } catch {
      // directory may not exist yet; nothing to stop
    }
    return { ok: true, running: false };
  },
  pioneerTunnelStatus() {
    const status = readTunnelStatusFile();
    if (!status || !tunnelPidAlive(status.pid)) {
      return { running: false, host: "", port: 0, startedAt: "", connections: 0, lastError: status?.lastError ?? "" };
    }
    return {
      running: true,
      host: status.host,
      port: status.port,
      startedAt: status.startedAt,
      connections: status.connections,
      lastError: status.lastError,
    };
  },
  async pioneerTunnelFetch(args) {
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      return { ok: false, status: 0, body: "", error: "地址无效" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, status: 0, body: "", error: "只支持 http / https 地址" };
    }
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return await fetchViaTunnelProxy({
      https: url.protocol === "https:",
      host: url.hostname,
      port,
      pathQ: (url.pathname || "/") + (url.search || ""),
      fullUrl: args.url,
      timeoutMs: args.timeoutMs,
    });
  },
  async fetchWebPage(args) {
    const fetchT0 = Date.now();
    const fail0 = (error: string) => ({
      ok: false,
      status: 0,
      finalUrl: "",
      contentType: "",
      bodyBase64: "",
      truncated: false,
      error,
      durationMs: Date.now() - fetchT0,
      requestHeaders: [] as [string, string][],
      responseHeaders: [] as [string, string][],
      timings: null,
      setCookies: [] as { url: string; values: string[] }[],
    });
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      return fail0("地址无效");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return fail0("只支持 http / https 地址");
    }
    // The request body: an explicit base64 payload (bridge
    // relays of binary data) wins over the text body.
    let bodyBuf: Buffer | null = null;
    if (args.bodyBase64) {
      try {
        bodyBuf = Buffer.from(args.bodyBase64, "base64");
      } catch {
        bodyBuf = null;
      }
    }
    if (!bodyBuf && args.body) bodyBuf = Buffer.from(args.body, "utf8");
    if (args.method === "GET" || args.method === "HEAD") bodyBuf = null;
    const extraHeaders = filterBridgeHeaders(args.headers);
    if (args.proxy) {
      return await fetchWebPageViaProxy(args.proxy, url, {
        method: args.method,
        bodyBuf,
        contentType: args.contentType,
        extraHeaders,
        cookies: args.cookies,
        maxBytes: args.maxBytes,
        timeoutMs: args.timeoutMs,
        userAgent: args.userAgent,
        secChUaMobile: args.secChUaMobile,
        secChUaPlatform: args.secChUaPlatform,
        ignoreCertErrors: args.ignoreCertErrors,
      });
    }
    // 忽略证书错误 path: node:http/https with verification
    // off, manual redirects + jar exactly like the fetch path
    // below (Bun/undici fetch cannot disable verification
    // per-request portably, so this path is separate and real).
    if (args.ignoreCertErrors) {
      const jar2: JarCookie[] = args.cookies.map((c) => ({ ...c }));
      const setCookies2: { url: string; values: string[] }[] = [];
      let current2 = url;
      let method2: WebMethod = args.method;
      let body2 = bodyBuf;
      let lastPairs2: [string, string][] = [];
      try {
        for (let hop = 0; hop <= 8; hop++) {
          const hdrs: Record<string, string> = {};
          hdrs["user-agent"] =
            args.userAgent ||
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
          if (args.secChUaMobile) hdrs["sec-ch-ua-mobile"] = args.secChUaMobile;
          if (args.secChUaPlatform) hdrs["sec-ch-ua-platform"] = args.secChUaPlatform;
          {
            const brand = secChUaForUa(hdrs["user-agent"]);
            if (brand && !extraHeaders.some(([n]) => n === "sec-ch-ua")) {
              hdrs["sec-ch-ua"] = brand;
            }
          }
          hdrs["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
          hdrs["accept-language"] = "zh-CN,zh;q=0.9,en;q=0.8";
          for (const [n, v] of extraHeaders) hdrs[n] = v;
          const ch = jarHeaderFor(jar2, current2);
          if (ch) hdrs["cookie"] = ch;
          if (body2 && !hdrs["content-type"]) {
            hdrs["content-type"] = args.contentType || "application/x-www-form-urlencoded";
          }
          if (body2) hdrs["content-length"] = String(body2.length);
          lastPairs2 = Object.entries(hdrs) as [string, string][];
          const hopRes = await fetchOneHopInsecure(current2, {
            method: method2,
            headers: hdrs,
            bodyBuf: body2,
            timeoutMs: args.timeoutMs,
          });
          if (hopRes.setCookies.length > 0) {
            setCookies2.push({ url: current2.toString(), values: hopRes.setCookies });
            jarAbsorb(jar2, current2, hopRes.setCookies);
          }
          const isRedirect2 = [301, 302, 303, 307, 308].includes(hopRes.status);
          const location2 = hopRes.headers.get("location");
          if (isRedirect2 && location2 && hop < 8) {
            let next2: URL;
            try {
              next2 = new URL(location2, current2);
            } catch {
              break;
            }
            if (next2.protocol !== "http:" && next2.protocol !== "https:") break;
            if (
              (hopRes.status === 301 || hopRes.status === 302 || hopRes.status === 303) &&
              method2 !== "GET" &&
              method2 !== "HEAD"
            ) {
              method2 = "GET";
              body2 = null;
            }
            current2 = next2;
            continue;
          }
          const truncated2 = hopRes.body.length > args.maxBytes;
          const capped2 = truncated2 ? hopRes.body.subarray(0, args.maxBytes) : hopRes.body;
          const resPairs2: [string, string][] = [...hopRes.headerPairs];
          for (const c of hopRes.setCookies) resPairs2.push(["set-cookie", c]);
          return {
            ok: hopRes.status >= 200 && hopRes.status < 400,
            status: hopRes.status,
            finalUrl: current2.toString(),
            contentType: hopRes.headers.get("content-type") ?? "",
            bodyBase64: Buffer.from(capped2).toString("base64"),
            truncated: truncated2,
            error: hopRes.status >= 400 ? `网站返回 HTTP ${hopRes.status}` : "",
            durationMs: Date.now() - fetchT0,
            requestHeaders: lastPairs2,
            responseHeaders: resPairs2,
            timings: null,
            setCookies: setCookies2,
          };
        }
        return {
          ...fail0("重定向次数过多"),
          finalUrl: current2.toString(),
          requestHeaders: lastPairs2,
          setCookies: setCookies2,
        };
      } catch (e) {
        return {
          ...fail0(e instanceof Error ? e.message : "网络请求失败"),
          finalUrl: current2.toString(),
          requestHeaders: lastPairs2,
          setCookies: setCookies2,
        };
      }
    }
    // Direct path: redirects are followed MANUALLY (fetch's
    // own follow would hide every hop's Set-Cookie, and login
    // flows set their session cookies exactly on those hops).
    // The jar is applied per hop and updated from every hop,
    // exactly like a real browser's redirect handling.
    const jar: JarCookie[] = args.cookies.map((c) => ({ ...c }));
    const setCookies: { url: string; values: string[] }[] = [];
    let current = url;
    let method: WebMethod = args.method;
    let lastReqHeaderPairs: [string, string][] = [];
    try {
      for (let hop = 0; hop <= 8; hop++) {
        const headers = new Headers();
        headers.set(
          "user-agent",
          args.userAgent ||
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        );
        if (args.secChUaMobile) {
          headers.set("sec-ch-ua-mobile", args.secChUaMobile);
        }
        if (args.secChUaPlatform) {
          headers.set("sec-ch-ua-platform", args.secChUaPlatform);
        }
        {
          const brand = secChUaForUa(
            args.userAgent ||
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          );
          if (brand && !extraHeaders.some(([n]) => n === "sec-ch-ua")) {
            headers.set("sec-ch-ua", brand);
          }
        }
        headers.set(
          "accept",
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        );
        headers.set("accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
        for (const [n, v] of extraHeaders) headers.set(n, v);
        const cookieHeader = jarHeaderFor(jar, current);
        if (cookieHeader) headers.set("cookie", cookieHeader);
        if (bodyBuf) {
          if (!headers.has("content-type")) {
            headers.set(
              "content-type",
              args.contentType || "application/x-www-form-urlencoded",
            );
          }
        }
        const pairs: [string, string][] = [];
        headers.forEach((v, k) => {
          pairs.push([k, v]);
        });
        lastReqHeaderPairs = pairs;
        const res = await fetch(current.toString(), {
          method,
          redirect: "manual",
          signal: AbortSignal.timeout(args.timeoutMs),
          headers,
          ...(bodyBuf ? { body: new Uint8Array(bodyBuf) } : {}),
        });
        let hopSetCookies: string[] = [];
        try {
          hopSetCookies =
            (
              res.headers as Headers & {
                getSetCookie?: () => string[];
              }
            ).getSetCookie?.() ?? [];
        } catch {
          hopSetCookies = [];
        }
        if (hopSetCookies.length > 0) {
          setCookies.push({
            url: current.toString(),
            values: hopSetCookies,
          });
          jarAbsorb(jar, current, hopSetCookies);
        }
        const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
        const location = res.headers.get("location");
        if (isRedirect && location && hop < 8) {
          // Drain the hop body so the connection can close
          // cleanly; redirect bodies carry nothing we render.
          try {
            await res.arrayBuffer();
          } catch {
            // an unreadable redirect body does not block the hop
          }
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            break;
          }
          if (next.protocol !== "http:" && next.protocol !== "https:") break;
          if (
            (res.status === 301 || res.status === 302 || res.status === 303) &&
            method !== "GET" &&
            method !== "HEAD"
          ) {
            method = "GET";
            bodyBuf = null;
          }
          current = next;
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const truncated = buf.length > args.maxBytes;
        const capped = truncated ? buf.subarray(0, args.maxBytes) : buf;
        const resHeaderPairs: [string, string][] = [];
        res.headers.forEach((v, k) => {
          resHeaderPairs.push([k, v]);
        });
        for (const c of hopSetCookies) resHeaderPairs.push(["set-cookie", c]);
        return {
          ok: res.status >= 200 && res.status < 400,
          status: res.status,
          finalUrl: current.toString(),
          contentType: res.headers.get("content-type") ?? "",
          bodyBase64: capped.toString("base64"),
          truncated,
          error: res.status >= 400 ? `网站返回 HTTP ${res.status}` : "",
          durationMs: Date.now() - fetchT0,
          requestHeaders: lastReqHeaderPairs,
          responseHeaders: resHeaderPairs,
          timings: null,
          setCookies,
        };
      }
      return {
        ...fail0("重定向次数过多"),
        finalUrl: current.toString(),
        requestHeaders: lastReqHeaderPairs,
        setCookies,
      };
    } catch (e) {
      return {
        ...fail0(e instanceof Error ? e.message : "网络请求失败"),
        finalUrl: current.toString(),
        requestHeaders: lastReqHeaderPairs,
        setCookies,
      };
    }
  },
  async testFreeProxies(args) {
    type Cand = { protocol: "http" | "socks4" | "socks5"; host: string; port: number };
    type Result = {
      protocol: string;
      host: string;
      port: number;
      ok: boolean;
      status: number;
      latencyMs: number;
      error: string;
    };
    const results: Result[] = new Array(args.candidates.length);
    let nextIdx = 0;
    async function testOne(c: Cand): Promise<Result> {
      const t0 = Date.now();
      let sock: Socket | null = null;
      try {
        const opened = await openProxyStream(c, "example.com", 80, args.timeoutMs);
        sock = opened.sock;
        sock.write(
          "GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        );
        const resp = await readProxyResponse(opened.reader, args.timeoutMs, 65536);
        const latencyMs = Date.now() - t0;
        if (resp.status === 200) {
          return { protocol: c.protocol, host: c.host, port: c.port, ok: true, status: 200, latencyMs, error: "" };
        }
        return {
          protocol: c.protocol,
          host: c.host,
          port: c.port,
          ok: false,
          status: resp.status,
          latencyMs,
          error: `测试目标返回 HTTP ${resp.status}`,
        };
      } catch (e) {
        return {
          protocol: c.protocol,
          host: c.host,
          port: c.port,
          ok: false,
          status: 0,
          latencyMs: Date.now() - t0,
          error: e instanceof Error ? e.message : "连接失败",
        };
      } finally {
        sock?.destroy();
      }
    }
    async function worker() {
      for (;;) {
        const i = nextIdx++;
        if (i >= args.candidates.length) return;
        const c = args.candidates[i];
        if (c) results[i] = await testOne(c);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(12, args.candidates.length) }, () => worker()),
    );
    return { results: results.filter((r): r is Result => r != null) };
  },

});
