import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { connect as tlsConnect } from "node:tls";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
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
      writeStatus();
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
      writeStatus();
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

async function lookupBlobObject(
  storeDir: string,
  key: string,
): Promise<
  | { objectId: string; contentType: string }
  | { error: string }
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

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
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
      return fail("图片地址无效，无法预览");
    }
    const storeDir = join(
      homedir(),
      "workspace",
      "ts-spaces",
      "zhuo-mian-liao-tian-kong-jian",
      "blobs",
    );
    const indexPath = join(storeDir, "index.sqlite");
    let objectId = "";
    let contentType = "";
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
          objectId = row.object_id;
          contentType =
            typeof row.content_type === "string" ? row.content_type : "";
        }
      } finally {
        db.close();
      }
    } catch (e) {
      return fail(
        `读取图片索引失败：${e instanceof Error ? e.message : "未知错误"}`,
      );
    }
    if (!objectId || !/^[a-f0-9]{64}$/.test(objectId)) {
      return fail("这张图片的存储记录不存在，可能已被删除");
    }
    try {
      const bytes = readFileSync(
        join(storeDir, "objects", objectId.slice(0, 2), objectId),
      );
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
    const storeDir = blobStoreDir();
    const looked = await lookupBlobObject(storeDir, key);
    if ("error" in looked) return fail(looked.error);
    const { objectId, contentType } = looked;
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
});
