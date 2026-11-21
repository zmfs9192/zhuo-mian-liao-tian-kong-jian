// Panes and shared UI added for the workspace-wide upgrades:
// the pinch-zoom hook (every window zooms by two fingers and
// remembers its scale), the browser's developer-tools-grade
// 抓包 (network capture) panel, the 代理中心's 雷神加速器 pane,
// and the 虚拟位置 pane with its 3D globe.
// Kept in one module so App.tsx only wires them in.

import {
useEffect,
useMemo,
useRef,
useState,
type CSSProperties,
type PointerEvent as ReactPointerEvent,
type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

const FIELDS = actionFields<typeof Actions>();

/* ================= touch coordinate precision ================= */

/** How many on-screen (client) pixels one layout pixel of
 * `el` occupies right now — the product of every zoom /
 * transform scale on the element and its ancestors (1 when
 * nothing is zoomed). Pointer and touch events always report client
 * (visual) coordinates, while transforms, offsets and other
 * layout values live in layout px: any code that turns a
 * pointer position or movement into a layout value MUST
 * divide by this scale first, or the thing under the finger
 * drifts away from the finger by exactly the zoom factor —
 * the "我点的地方和实际按到的地方不一样" bug. Ratio-only
 * math (pinch distance ratios, fractions of a rect) is
 * scale-invariant and does not need it. */
export function visualScaleOf(el: HTMLElement | null | undefined): number {
  if (!el) return 1;
  const w = el.offsetWidth;
  if (!w) return 1;
  const s = el.getBoundingClientRect().width / w;
  return s > 0.05 && s < 20 ? s : 1;
}

/** The style for one column's zoom frame: the inner wrapper
 * that carries a column's whole content while that column is
 * pinch-zoomed. The scale is a transform over a counter-sized
 * layout box — the wrapper lays out at (100 / scale)% of the
 * column in both axes and is then painted at `scale`, so its
 * painted box is always exactly the column's box while its
 * layout genuinely happens at the effective size: text wraps,
 * flex rows reflow and every fixed-size icon and avatar takes
 * part in that layout, so at ANY scale the content scales as
 * one whole inside its own column and nothing can overlap a
 * neighbour or a sibling.
 *
 * This deliberately does NOT use the CSS `zoom` property: on
 * the phone's WebKit webview `zoom` scales fixed-size boxes
 * (inline-style px widths/heights, SVG icon sizes, images)
 * but leaves text and the surrounding flex layout at the
 * unzoomed size, so zooming in made avatars and icons balloon
 * over normally-sized text and each other — the "屏幕放大后
 * 图标直接这样了" screenshot (giant DeepSeek avatar over the
 * header, member avatars piled together, composer icons
 * bursting out of their pills). Transform scaling applies
 * the one identical factor to layout and paint in every
 * engine, which is what keeps icons, text and rows in
 * proportion. The column element clips the frame (overflow
 * hidden) and keeps its saved width, so the flex layout of
 * the shell itself never moves. `flex: none` keeps the
 * column's flex column from shrinking the counter-sized box
 * back towards 100% when scale < 1. Surfaces whose layout
 * can genuinely re-column at the effective width (the
 * sidebar's menu grid) read the scale themselves and adapt
 * their column count to the layout width (column width /
 * scale). */
export function zoomFrameStyle(scale: number): CSSProperties | undefined {
  if (!scale || !Number.isFinite(scale) || scale === 1) return undefined;
  return {
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    width: `${100 / scale}%`,
    height: `${100 / scale}%`,
    flex: "none",
  };
}

/* ================= pinch zoom ================= */

/** Attaches whole-window pinch zoom to the element behind
 * `ref`: while the gesture setting is on, a two-finger pinch
 * scales the whole window's content (the caller renders the
 * scale through `zoomFrameStyle`, so the content reflows
 * inside its column instead of overlapping the next one),
 * and ctrl+wheel does the same on
 * desktop. The gesture only engages once the finger distance
 * actually changes by more than 6px, so a two-finger swipe or
 * scroll still behaves normally; once engaged it claims the
 * gesture (stopPropagation + preventDefault) so the content
 * underneath does not also scroll. Surfaces that own their own
 * pinch (the prompt canvas viewport, the drawing canvas) carry
 * `data-pinch-local` and are left alone. The scale itself lives
 * in the caller's state, which the workspace snapshot persists
 * server-side — the zoom is remembered across exits and
 * devices. */
export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  scale: number,
  onChange: (next: number) => void,
) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startDist = 0;
    let startScale = 1;
    let engaged = false;
    const dist = (t: TouchList) => {
      const a = t[0];
      const b = t[1];
      if (!a || !b) return 0;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const isLocal = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest("[data-pinch-local]");
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || isLocal(e.target)) return;
      startDist = dist(e.touches);
      startScale = scaleRef.current;
      engaged = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist === 0) return;
      const d = dist(e.touches);
      if (!engaged) {
        if (Math.abs(d - startDist) < 6) return;
        engaged = true;
      }
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(
        2.5,
        Math.max(0.5, (startScale * d) / startDist),
      );
      onChangeRef.current(Math.round(next * 100) / 100);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        startDist = 0;
        engaged = false;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.min(
        2.5,
        Math.max(0.5, scaleRef.current * (e.deltaY < 0 ? 1.08 : 0.93)),
      );
      onChangeRef.current(Math.round(next * 100) / 100);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref, enabled]);
}

/* ================= shared bits ================= */

export function copyText(text: string): Promise<boolean> {
  try {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function downloadTextFile(
  name: string,
  text: string,
  mime = "application/json",
) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    // nowhere to download to; the caller tells the user
  }
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtTimeOfDay(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ================= capture panel ================= */

export type CaptureTimings = {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  waitMs: number | null;
  receiveMs: number | null;
};

export type CaptureFrame = {
  dir: "in" | "out";
  ts: number;
  size: number;
  preview: string;
};

export type CaptureEntry = {
  key: string;
  source: "server" | "probe";
  ts: number;
  method: string;
  url: string;
  type: string;
  status: number | null;
  size: number | null;
  durationMs: number | null;
  contentType: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
  requestBody: string;
  responseBody: string;
  timings: CaptureTimings | null;
  frames?: CaptureFrame[];
  error?: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function entryToCurl(e: CaptureEntry): string {
  const parts = [`curl ${shellQuote(e.url)}`];
  if (e.method !== "GET") parts.push(`-X ${e.method}`);
  for (const h of e.requestHeaders) {
    if (h.name.toLowerCase() === "content-length") continue;
    parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  }
  if (e.requestBody) parts.push(`--data ${shellQuote(e.requestBody)}`);
  return parts.join(" \\\n  ");
}

export function entriesToHar(entries: CaptureEntry[]): string {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "空间浏览器抓包", version: "1" },
      entries: entries.map((e) => {
        const t = e.timings;
        const seg = (v: number | null | undefined) =>
          typeof v === "number" && Number.isFinite(v) ? v : -1;
        const query: { name: string; value: string }[] = [];
        try {
          new URL(e.url).searchParams.forEach((v, k) =>
            query.push({ name: k, value: v }),
          );
        } catch {
          // unparseable URL: no query list
        }
        return {
          startedDateTime: new Date(e.ts).toISOString(),
          time: e.durationMs ?? -1,
          request: {
            method: e.method,
            url: e.url,
            httpVersion: "",
            headers: e.requestHeaders,
            queryString: query,
            postData: e.requestBody
              ? { mimeType: "", text: e.requestBody }
              : undefined,
            headersSize: -1,
            bodySize: e.requestBody
              ? new Blob([e.requestBody]).size
              : 0,
          },
          response: {
            status: e.status ?? 0,
            statusText: "",
            httpVersion: "",
            headers: e.responseHeaders,
            content: {
              size: e.size ?? -1,
              mimeType: e.contentType,
              text: e.responseBody || undefined,
            },
            headersSize: -1,
            bodySize: e.size ?? -1,
          },
          timings: {
            dns: seg(t?.dnsMs),
            connect: seg(t?.connectMs),
            ssl: seg(t?.tlsMs),
            send: 0,
            wait: seg(t?.waitMs),
            receive: seg(t?.receiveMs),
          },
          comment:
            e.source === "server"
              ? "空间服务端为取页面发出的请求"
              : "页面自身发出的请求（页面内探针记录）",
        };
      }),
    },
  };
  return JSON.stringify(har, null, 2);
}

function JsonNode({
  name,
  value,
  depth,
}: {
  name: string | null;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = value !== null && typeof value === "object";
  if (!isObj) {
    return (
      <div className="whitespace-pre-wrap break-all leading-relaxed">
        {name !== null && (
          <span className="text-[#7a4fd0]">{JSON.stringify(name)}: </span>
        )}
        <span
          className={
            typeof value === "string" ? "text-[#137333]" : "text-[#b3261e]"
          }
        >
          {JSON.stringify(value)}
        </span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div className="leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-0 font-mono text-[11px]"
        aria-expanded={open}
      >
        {name !== null && (
          <span className="text-[#7a4fd0]">{JSON.stringify(name)}: </span>
        )}
        <span className="text-[#6e6e73]">
          {open ? "▾" : "▸"} {brace[0]}
          {open ? "" : ` … ${entries.length} 项 ${brace[1]}`}
        </span>
      </button>
      {open && (
        <div className="ml-3 border-l border-black/[0.06] pl-2">
          {entries.slice(0, 200).map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
          <div className="text-[#6e6e73]">{brace[1]}</div>
        </div>
      )}
    </div>
  );
}

function BodyView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    const t = text.trim();
    if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }, [text]);
  if (!text) return <p className="text-[11px] text-[#9a9aa0]">（无）</p>;
  if (parsed !== null) {
    return (
      <div className="font-mono text-[11px]">
        <JsonNode name={null} value={parsed} depth={0} />
      </div>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
      {text.slice(0, 32768)}
    </pre>
  );
}

function HeaderList({
  headers,
}: {
  headers: { name: string; value: string }[];
}) {
  if (headers.length === 0)
    return <p className="text-[11px] text-[#9a9aa0]">（未记录）</p>;
  return (
    <div className="flex flex-col gap-0.5">
      {headers.map((h, i) => (
        <div key={i} className="break-all font-mono text-[11px] leading-relaxed">
          <span className="text-[#7a4fd0]">{h.name}:</span>{" "}
          <span>{h.value}</span>
        </div>
      ))}
    </div>
  );
}

const CAPTURE_TYPE_CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "document", label: "文档" },
  { key: "script", label: "脚本" },
  { key: "stylesheet", label: "样式" },
  { key: "image", label: "图片" },
  { key: "media", label: "媒体" },
  { key: "xhr", label: "XHR" },
  { key: "fetch", label: "Fetch" },
  { key: "websocket", label: "WS" },
  { key: "download", label: "下载" },
  { key: "other", label: "其他" },
];

export function CapturePanel({
  entries,
  paused,
  onTogglePause,
  onClear,
  onClose,
  notify,
}: {
  entries: CaptureEntry[];
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  onClose: () => void;
  notify: (msg: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // Window conveniences: 最小化 collapses the panel to its
  // title bar (recording keeps running; 还原 brings it back),
  // 最大化 stretches it over the whole page area.
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 8, y: 8 });
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; zs: number } | null>(
    null,
  );

  const domains = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      const h = hostOf(e.url);
      if (h) s.add(h);
    }
    return [...s].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (domainFilter && hostOf(e.url) !== domainFilter) return false;
      if (statusFilter !== "all") {
        const st = e.status;
        if (statusFilter === "fail") {
          if (!(st === null || st === 0 || st >= 400)) return false;
        } else {
          const base = Number(statusFilter);
          if (st === null || st < base || st >= base + 100) return false;
        }
      }
      if (kw && !e.url.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [entries, typeFilter, domainFilter, statusFilter, keyword]);

  const stats = useMemo(() => {
    let size = 0;
    let dur = 0;
    for (const e of entries) {
      size += e.size ?? 0;
      dur += e.durationMs ?? 0;
    }
    return { count: entries.length, size, dur };
  }, [entries]);

  const selected =
    filtered.find((e) => e.key === selectedKey) ??
    entries.find((e) => e.key === selectedKey) ??
    null;

  useEffect(() => {
    if (!autoScroll || selected) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, autoScroll, selected]);

  const onHeaderPointerDown = (e: ReactPointerEvent) => {
    if (maximized && !minimized) return;
    // pos is layout px (the panel's left/top inside the
    // browser pane, which carries its own zoom); the pointer
    // reports visual px — convert, or the panel trails/ leads
    // the finger by the pane's zoom factor.
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: pos.x,
      oy: pos.y,
      zs: visualScaleOf(e.currentTarget as HTMLElement),
    };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.max(0, d.ox + (ev.clientX - d.sx) / d.zs),
        y: Math.max(0, d.oy + (ev.clientY - d.sy) / d.zs),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const segRows: { label: string; get: (t: CaptureTimings) => number | null; color: string }[] = [
    { label: "DNS", get: (t) => t.dnsMs, color: "#7a4fd0" },
    { label: "连接", get: (t) => t.connectMs, color: "#2f6bff" },
    { label: "等待响应", get: (t) => t.waitMs, color: "#ff7a1a" },
    { label: "接收", get: (t) => t.receiveMs, color: "#34c759" },
  ];

  return (
    <div
      className="absolute z-30 flex max-h-[calc(100%-16px)] w-[min(680px,calc(100%-16px))] flex-col overflow-hidden rounded-xl border border-black/[0.12] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.28)]"
      style={
        minimized
          ? {
              left: pos.x,
              top: pos.y,
              height: "auto",
              width: "min(400px, calc(100% - 16px))",
            }
          : maximized
            ? {
                left: 8,
                top: 8,
                width: "calc(100% - 16px)",
                height: "calc(100% - 16px)",
              }
            : {
                left: pos.x,
                top: pos.y,
                height: "min(560px, calc(100% - 16px))",
              }
      }
      role="dialog"
      aria-label="抓包面板"
    >
      <div
        className="flex cursor-move touch-none items-center gap-1.5 border-b border-black/[0.06] bg-[#f7f7f8] px-2.5 py-1.5"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="text-xs font-semibold">抓包 · 网络</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#6e6e73]">
          {stats.count} 个请求 · {fmtBytes(stats.size)} ·{" "}
          {(stats.dur / 1000).toFixed(1)}s{paused ? " · 已暂停" : ""}
        </span>
        {!minimized && (
          <>
            <button
              type="button"
              aria-label={paused ? "继续记录" : "暂停记录"}
              onClick={onTogglePause}
              className={`min-h-0 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${paused ? "bg-[#ff7a1a] text-white" : "bg-black/[0.06]"}`}
            >
              {paused ? "已暂停" : "暂停"}
            </button>
            <button
              type="button"
              aria-label="清空记录"
              onClick={onClear}
              className="min-h-0 shrink-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium"
            >
              清空
            </button>
            <button
              type="button"
              aria-label="导出 HAR"
              onClick={() => {
                downloadTextFile(
                  `capture-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.har`,
                  entriesToHar(filtered),
                );
                notify("已导出 HAR 文件");
              }}
              className="min-h-0 shrink-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium"
            >
              导出 HAR
            </button>
            <button
              type="button"
              aria-label={maximized ? "还原抓包面板" : "最大化抓包面板"}
              aria-pressed={maximized}
              onClick={() => setMaximized((v) => !v)}
              className="min-h-0 shrink-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium"
            >
              {maximized ? "还原" : "最大化"}
            </button>
            <button
              type="button"
              aria-label="最小化抓包面板"
              onClick={() => setMinimized(true)}
              className="min-h-0 shrink-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium"
            >
              最小化
            </button>
          </>
        )}
        {minimized && (
          <button
            type="button"
            aria-label="还原抓包面板"
            onClick={() => setMinimized(false)}
            className="min-h-0 shrink-0 rounded-full bg-[#2f6bff] px-2.5 py-1 text-[11px] font-medium text-white"
          >
            还原
          </button>
        )}
        <button
          type="button"
          aria-label="关闭抓包面板"
          onClick={onClose}
          className="flex h-7 w-7 min-h-0 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-sm"
        >
          ×
        </button>
      </div>
      {!minimized && (
        <>

      <div className="flex flex-wrap items-center gap-1 border-b border-black/[0.06] px-2.5 py-1.5">
        {CAPTURE_TYPE_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={typeFilter === c.key}
            onClick={() => setTypeFilter(c.key)}
            className={`min-h-0 rounded-full px-2 py-0.5 text-[11px] ${typeFilter === c.key ? "bg-[#2f6bff] text-white" : "bg-black/[0.05] text-[#3a3a3c]"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-2.5 py-1.5">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="按地址关键字筛选"
          aria-label="按地址关键字筛选"
          className="min-h-0 min-w-0 flex-1 rounded-lg bg-black/[0.04] px-2 py-1 text-xs outline-none"
        />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          aria-label="按域名筛选"
          className="min-h-0 max-w-[130px] shrink-0 rounded-lg bg-black/[0.04] px-1.5 py-1 text-[11px]"
        >
          <option value="">全部域名</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="按状态码筛选"
          className="min-h-0 shrink-0 rounded-lg bg-black/[0.04] px-1.5 py-1 text-[11px]"
        >
          <option value="all">全部状态</option>
          <option value="200">2xx</option>
          <option value="300">3xx</option>
          <option value="400">4xx</option>
          <option value="500">5xx</option>
          <option value="fail">失败</option>
        </select>
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-[#6e6e73]">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3.5 w-3.5 min-h-0"
          />
          自动滚动
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs leading-relaxed text-[#9a9aa0]">
              还没有记录到请求。这里只抓空间内浏览器自己发出的请求：空间服务端为取页面发出的请求（标「服务端」）和页面自身发出的请求（标「页面」）。设备上其他
              App 的流量抓不到，也不会伪造。
            </p>
          ) : (
            filtered.map((e) => {
              const failed =
                e.status === 0 || (e.status !== null && e.status >= 400);
              const slow = (e.durationMs ?? 0) > 3000;
              const active = selected?.key === e.key;
              return (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => setSelectedKey(active ? null : e.key)}
                  aria-pressed={active}
                  className={`flex w-full min-h-0 items-center gap-2 border-b border-black/[0.04] px-2.5 py-1.5 text-left ${active ? "bg-[#e8effd]" : ""}`}
                >
                  <span className="w-[52px] shrink-0 text-[10px] tabular-nums text-[#9a9aa0]">
                    {fmtClock(e.ts)}
                  </span>
                  <span
                    className={`w-9 shrink-0 text-[11px] font-semibold ${failed ? "text-[#c0392b]" : "text-[#3a3a3c]"}`}
                  >
                    {e.method}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[11px] ${failed ? "text-[#c0392b]" : ""}`}
                    title={e.url}
                  >
                    {e.url}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#9a9aa0]">
                    {e.type}
                  </span>
                  <span
                    className={`w-8 shrink-0 text-right text-[11px] tabular-nums ${failed ? "font-semibold text-[#c0392b]" : "text-[#3a3a3c]"}`}
                  >
                    {e.status === null ? "…" : e.status === 0 ? "失败" : e.status}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[#9a9aa0]">
                    {fmtBytes(e.size)}
                  </span>
                  <span
                    className={`w-12 shrink-0 text-right text-[10px] tabular-nums ${slow ? "font-semibold text-[#c0392b]" : "text-[#9a9aa0]"}`}
                  >
                    {e.durationMs === null ? "—" : `${e.durationMs}ms`}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {selected && (
          <div className="flex w-[46%] min-w-[220px] shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-black/[0.08] px-3 py-2">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-all text-xs font-medium leading-relaxed">
                {selected.method} {selected.url}
              </p>
              <button
                type="button"
                aria-label="关闭详情"
                onClick={() => setSelectedKey(null)}
                className="flex h-6 w-6 min-h-0 shrink-0 items-center justify-center rounded-full bg-black/[0.06]"
              >
                ×
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() =>
                  void copyText(entryToCurl(selected)).then((ok) =>
                    notify(ok ? "已复制为 cURL" : "复制失败"),
                  )
                }
                className="min-h-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium"
              >
                复制为 cURL
              </button>
              <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[10px] text-[#6e6e73]">
                {selected.source === "server"
                  ? "服务端请求"
                  : "页面请求"}
              </span>
              {selected.error ? (
                <span className="rounded-full bg-[#fce8e6] px-2 py-1 text-[10px] text-[#c0392b]">
                  {selected.error}
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">耗时瀑布</p>
            {selected.timings ? (
              <div className="mt-1 flex flex-col gap-1">
                {segRows.map((s) => {
                  const v = selected.timings ? s.get(selected.timings) : null;
                  const total = Math.max(
                    1,
                    selected.durationMs ??
                      segRows.reduce(
                        (a, r) =>
                          a + (selected.timings ? (r.get(selected.timings) ?? 0) : 0),
                        0,
                      ),
                  );
                  return (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[10px] text-[#6e6e73]">
                        {s.label}
                      </span>
                      <span className="h-2 min-w-0 flex-1 rounded bg-black/[0.05]">
                        <span
                          className="block h-2 rounded"
                          style={{
                            width: `${v ? Math.min(100, (v / total) * 100) : 0}%`,
                            backgroundColor: s.color,
                          }}
                        />
                      </span>
                      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[#9a9aa0]">
                        {v === null ? "未测得" : `${v}ms`}
                      </span>
                    </div>
                  );
                })}
                <p className="text-[10px] text-[#9a9aa0]">
                  总耗时 {selected.durationMs ?? "—"}ms；没有测到的分段如实留空，不估算。
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                这条请求没有分段计时（
                {selected.source === "server"
                  ? "直连时只能测到总耗时"
                  : "页面资源计时未提供分段"}
                ），总耗时 {selected.durationMs ?? "—"}ms。
              </p>
            )}

            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">查询参数</p>
            {(() => {
              const rows: [string, string][] = [];
              try {
                new URL(selected.url).searchParams.forEach((v, k) =>
                  rows.push([k, v]),
                );
              } catch {
                // no parseable query
              }
              return rows.length === 0 ? (
                <p className="text-[11px] text-[#9a9aa0]">（无）</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {rows.map(([k, v], i) => (
                    <div key={i} className="break-all font-mono text-[11px]">
                      <span className="text-[#7a4fd0]">{k}</span> = {v}
                    </div>
                  ))}
                </div>
              );
            })()}

            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">Cookie</p>
            {(() => {
              const req = selected.requestHeaders.filter(
                (h) => h.name.toLowerCase() === "cookie",
              );
              const res = selected.responseHeaders.filter(
                (h) => h.name.toLowerCase() === "set-cookie",
              );
              if (req.length === 0 && res.length === 0)
                return <p className="text-[11px] text-[#9a9aa0]">（无）</p>;
              return (
                <div className="flex flex-col gap-0.5 break-all font-mono text-[11px]">
                  {req.map((h, i) => (
                    <div key={`r${i}`}>请求：{h.value}</div>
                  ))}
                  {res.map((h, i) => (
                    <div key={`s${i}`}>响应 Set-Cookie：{h.value}</div>
                  ))}
                </div>
              );
            })()}

            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">请求头</p>
            <HeaderList headers={selected.requestHeaders} />
            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">响应头</p>
            <HeaderList headers={selected.responseHeaders} />
            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">请求体</p>
            <BodyView text={selected.requestBody} />
            <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">响应体预览</p>
            <BodyView text={selected.responseBody} />

            {selected.frames && selected.frames.length > 0 && (
              <>
                <p className="mt-3 text-[11px] font-semibold text-[#6e6e73]">
                  WebSocket 消息帧（{selected.frames.length}）
                </p>
                <div className="flex flex-col gap-1">
                  {selected.frames.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-black/[0.03] px-2 py-1 font-mono text-[10px] leading-relaxed"
                    >
                      <span
                        className={
                          f.dir === "out" ? "text-[#2f6bff]" : "text-[#137333]"
                        }
                      >
                        {f.dir === "out" ? "↑ 发送" : "↓ 接收"}
                      </span>{" "}
                      <span className="text-[#9a9aa0]">
                        {fmtClock(f.ts)} · {fmtBytes(f.size)}
                      </span>
                      <div className="whitespace-pre-wrap break-all">
                        {f.preview}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/* ================= 雷神加速器 (Leigod) ================= */

const LEIGOD_FIELD_LABELS: Record<string, string> = {
  nickname: "昵称",
  nick_name: "昵称",
  user_name: "账号",
  username: "账号",
  mobile: "手机号",
  phone: "手机号",
  pause_status_id: "计时状态",
  expiry_time: "到期时间",
  expire_time: "到期时间",
  end_time: "到期时间",
  left_time: "剩余时长",
  remain_time: "剩余时长",
  total_time: "总时长",
  balance: "余额",
  level: "等级",
};

export function LeigodPane({
  onBack,
  notify,
  onOpenSite,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
  onOpenSite: (url: string) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"token" | "password" | "sms">("token");
  const [token, setToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const stateQuery = useQuery({
    queryKey: ["leigodState"],
    queryFn: () => api.getLeigodState({}),
  });
  const state = stateQuery.data;
  const info = useMemo(() => {
    if (!state?.infoJson) return null;
    try {
      const v = JSON.parse(state.infoJson) as unknown;
      return v && typeof v === "object"
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [state]);
  const paused = info?.pause_status_id === 1 || info?.pause_status_id === "1";

  const loginMutation = useMutation({
    mutationFn: async () => await api.leigodLoginWithToken({ token: token.trim() }),
    onSuccess: (res) => {
      if (res.ok) {
        setToken("");
        setLoginError("");
        queryClient.invalidateQueries({ queryKey: ["leigodState"] });
        notify(`已登录雷神账号${res.accountLabel ? `：${res.accountLabel}` : ""}`);
      } else {
        setLoginError(res.reason || "登录失败");
      }
    },
    onError: (e) =>
      setLoginError(e instanceof Error ? e.message : "登录失败，请重试"),
  });
  const refreshMutation = useMutation({
    mutationFn: async () => await api.leigodRefresh({}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["leigodState"] });
      notify(res.ok ? "账号信息已刷新" : res.reason || "刷新失败");
    },
    onError: (e) => notify(e instanceof Error ? e.message : "刷新失败"),
  });
  const pauseMutation = useMutation({
    mutationFn: async (pause: boolean) => await api.leigodSetPaused({ pause }),
    onSuccess: (res, pause) => {
      queryClient.invalidateQueries({ queryKey: ["leigodState"] });
      notify(
        res.ok
          ? pause
            ? "已暂停计时，时长不再扣除"
            : "已恢复计时"
          : res.reason || "操作失败",
      );
    },
    onError: (e) => notify(e instanceof Error ? e.message : "操作失败"),
  });
  const logoutMutation = useMutation({
    mutationFn: async () => await api.leigodLogout({}),
    onSuccess: () => {
      setConfirmLogout(false);
      queryClient.invalidateQueries({ queryKey: ["leigodState"] });
      notify("已退出雷神登录（服务端保存的令牌已清除）");
    },
    onError: (e) => notify(e instanceof Error ? e.message : "退出失败"),
  });

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回代理中心"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05]"
        >
          ‹
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-semibold">雷神加速器</p>
        <span className="shrink-0 text-[11px] text-[#9a9aa0]">leigod.com · 按分钟计费</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="rounded-xl bg-[#fdf3e3] px-3 py-2.5 text-xs leading-relaxed text-[#7a5410]">
          <p className="font-semibold">先说清楚边界</p>
          <p className="mt-0.5">
            雷神没有公开 API，加速走它自己的客户端协议与游戏专线，空间服务端没有它的协议与节点配置，无法真的替你的游戏加速——这里不会假装「正在加速」。空间内真实能做的是账号这一层：用你在官网登录后拿到的令牌，查看账号与剩余时长、暂停/恢复按分钟计费。真正的游戏加速请用雷神官方客户端（Windows / macOS / Android / iOS / 主机 / 路由器）。
          </p>
        </div>

        {stateQuery.isPending ? (
          <p className="py-8 text-center text-sm text-[#9a9aa0]">加载中…</p>
        ) : state?.loggedIn ? (
          <>
            <div className="mt-3 rounded-xl bg-[#f7f7f8] px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2f6bff] text-base font-bold text-white">
                  {(state.accountLabel || "雷").slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {state.accountLabel || "雷神账号"}
                  </p>
                  <p className="text-[11px] text-[#6e6e73]">
                    计时状态：
                    {info
                      ? paused
                        ? "已暂停（不扣时长）"
                        : "计时中"
                      : "尚未刷新"}
                    {state.updatedAt
                      ? ` · 更新于 ${fmtTimeOfDay(new Date(state.updatedAt).getTime())}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                  className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50"
                >
                  {refreshMutation.isPending ? "刷新中…" : "刷新"}
                </button>
              </div>
              {info && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {Object.entries(info)
                    .filter(
                      ([k, v]) =>
                        k in LEIGOD_FIELD_LABELS &&
                        (typeof v === "string" || typeof v === "number"),
                    )
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-2">
                        <span className="shrink-0 text-[11px] text-[#6e6e73]">
                          {LEIGOD_FIELD_LABELS[k]}
                        </span>
                        <span className="min-w-0 truncate text-[13px] font-medium">
                          {k === "pause_status_id"
                            ? paused
                              ? "已暂停"
                              : "计时中"
                            : String(v)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              {info && (
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  aria-expanded={showRaw}
                  className="mt-2 min-h-0 text-[11px] text-[#2f6bff]"
                >
                  {showRaw ? "收起" : "查看"}雷神接口返回的全部字段
                </button>
              )}
              {showRaw && info && (
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2 font-mono text-[10px] leading-relaxed">
                  {JSON.stringify(info, null, 2)}
                </pre>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pauseMutation.isPending}
                  onClick={() => pauseMutation.mutate(!paused)}
                  className={`rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${paused ? "bg-[#34c759]" : "bg-[#ff7a1a]"}`}
                >
                  {paused ? "恢复计时" : "暂停计时"}
                </button>
                {confirmLogout ? (
                  <>
                    <button
                      type="button"
                      onClick={() => logoutMutation.mutate()}
                      className="rounded-full bg-[#e5484d] px-4 py-2 text-sm font-medium text-white"
                    >
                      确认退出
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLogout(false)}
                      className="rounded-full bg-black/[0.06] px-4 py-2 text-sm font-medium"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLogout(true)}
                    className="rounded-full bg-black/[0.06] px-4 py-2 text-sm font-medium"
                  >
                    退出登录
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
                令牌约 7 天过期，过期后刷新会如实提示并退出登录，重新到官网登录复制新令牌即可。令牌只加密存在空间服务端，不会显示在这里。
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-black/[0.06] px-3.5 py-3">
              <p className="text-sm font-semibold">游戏加速</p>
              <p className="mt-1 text-xs leading-relaxed text-[#6e6e73]">
                游戏、区服、节点与智能选路都在雷神官方客户端里完成：选游戏 → 选区服 → 客户端按实时延迟智能选路 → 开始加速。空间服务端接管不了你的游戏流量，所以这里不放假的「开始加速」按钮。
              </p>
              <button
                type="button"
                onClick={() => onOpenSite("https://www.leigod.com/")}
                className="mt-2 rounded-full bg-[#2f6bff] px-4 py-2 text-sm font-medium text-white"
              >
                去雷神官网 / 下载官方客户端
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex gap-1.5">
              {(
                [
                  { k: "token", l: "令牌登录" },
                  { k: "password", l: "账号密码" },
                  { k: "sms", l: "手机验证码" },
                ] as const
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  aria-pressed={tab === t.k}
                  onClick={() => setTab(t.k)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${tab === t.k ? "bg-[#2f6bff] text-white" : "bg-black/[0.05]"}`}
                >
                  {t.l}
                </button>
              ))}
            </div>
            {tab === "token" && (
              <div className="mt-3">
                <p className="text-xs leading-relaxed text-[#6e6e73]">
                  雷神官网登录带极验验证码，空间没法替你过验证码（也不会去绕它）。可行的办法：先在雷神官网登录，在浏览器开发者工具的控制台执行{" "}
                  <span className="break-all font-mono text-[11px]">
                    JSON.parse(localStorage.getItem('account_token')).account_token
                  </span>{" "}
                  复制出你的 account_token，粘到下面。服务端会先向雷神官方接口验证它有效才保存（加密存储）。
                </p>
                <textarea
                  {...FIELDS.leigodLoginWithToken.token}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴 account_token"
                  aria-label="雷神 account_token"
                  rows={3}
                  className="mt-2 w-full rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-xs outline-none"
                />
                {loginError && (
                  <p className="mt-1.5 text-xs leading-relaxed text-[#c0392b]">
                    {loginError}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!token.trim() || loginMutation.isPending}
                    onClick={() => loginMutation.mutate()}
                    className="rounded-full bg-[#2f6bff] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {loginMutation.isPending ? "验证中…" : "登录"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSite("https://www.leigod.com/")}
                    className="rounded-full bg-black/[0.06] px-4 py-2 text-sm font-medium"
                  >
                    先去官网登录
                  </button>
                </div>
              </div>
            )}
            {tab === "password" && (
              <p className="mt-3 text-xs leading-relaxed text-[#6e6e73]">
                账号密码登录目前做不到：雷神官网的登录接口已加极验（Geetest）人机验证码，必须在官网页面上由你本人完成验证，空间服务端无法代填、也不会绕过验证码。所以这里不放一个注定失败的密码框——请用左边的「令牌登录」，或在官方客户端里用账号密码登录。QQ / 微信第三方登录同理，只能在官方客户端里用。
              </p>
            )}
            {tab === "sms" && (
              <p className="mt-3 text-xs leading-relaxed text-[#6e6e73]">
                手机号验证码登录同样做不到：发送验证码前雷神也要先过极验人机验证，空间服务端发不出这条短信。请在官网或官方客户端用验证码登录后，再回到「令牌登录」把 account_token 粘进来，效果一样（账号、剩余时长、暂停/恢复都能用）。
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================= 虚拟位置 + 3D 地球仪 ================= */

export type VLocPoint = { label: string; country: string; lat: number; lon: number };

export const VLOC_PRESETS: (VLocPoint & { aliases: string[] })[] = [
  { label: "台北", country: "台湾", lat: 25.033, lon: 121.5654, aliases: ["taipei", "taiwan", "台湾", "台北"] },
  { label: "东京", country: "日本", lat: 35.6762, lon: 139.6503, aliases: ["tokyo", "japan", "日本", "东京", "東京"] },
  { label: "首尔", country: "韩国", lat: 37.5665, lon: 126.978, aliases: ["seoul", "korea", "韩国", "首尔"] },
  { label: "香港", country: "中国香港", lat: 22.3193, lon: 114.1694, aliases: ["hong kong", "香港"] },
  { label: "新加坡", country: "新加坡", lat: 1.3521, lon: 103.8198, aliases: ["singapore", "新加坡"] },
  { label: "伦敦", country: "英国", lat: 51.5074, lon: -0.1278, aliases: ["london", "united kingdom", "英国", "伦敦"] },
  { label: "巴黎", country: "法国", lat: 48.8566, lon: 2.3522, aliases: ["paris", "france", "法国", "巴黎"] },
  { label: "纽约", country: "美国", lat: 40.7128, lon: -74.006, aliases: ["new york", "united states", "usa", "美国", "纽约"] },
  { label: "洛杉矶", country: "美国", lat: 34.0522, lon: -118.2437, aliases: ["los angeles", "洛杉矶"] },
  { label: "悉尼", country: "澳大利亚", lat: -33.8688, lon: 151.2093, aliases: ["sydney", "australia", "悉尼", "澳大利亚"] },
  { label: "柏林", country: "德国", lat: 52.52, lon: 13.405, aliases: ["berlin", "germany", "柏林", "德国"] },
  { label: "多伦多", country: "加拿大", lat: 43.6532, lon: -79.3832, aliases: ["toronto", "canada", "多伦多", "加拿大"] },
];

type CesiumWindow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Cesium?: any;
  CESIUM_BASE_URL?: string;
};

const CESIUM_SOURCES = [
  {
    js: "https://unpkg.com/cesium@1.119.0/Build/Cesium/Cesium.js",
    css: "https://unpkg.com/cesium@1.119.0/Build/Cesium/Widgets/widgets.css",
    base: "https://unpkg.com/cesium@1.119.0/Build/Cesium/",
  },
  {
    js: "https://cdn.jsdelivr.net/npm/cesium@1.119.0/Build/Cesium/Cesium.js",
    css: "https://cdn.jsdelivr.net/npm/cesium@1.119.0/Build/Cesium/Widgets/widgets.css",
    base: "https://cdn.jsdelivr.net/npm/cesium@1.119.0/Build/Cesium/",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadCesiumFrom(src: (typeof CESIUM_SOURCES)[number]): Promise<any> {
  const w = window as unknown as CesiumWindow;
  return new Promise((resolve, reject) => {
    if (w.Cesium) {
      resolve(w.Cesium);
      return;
    }
    w.CESIUM_BASE_URL = src.base;
    if (!document.querySelector(`link[href="${src.css}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = src.css;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = src.js;
    script.async = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error(`加载超时（${new URL(src.js).hostname}）`));
    }, 25000);
    script.onload = () => {
      window.clearTimeout(timer);
      if (w.Cesium) resolve(w.Cesium);
      else reject(new Error("脚本已加载但 Cesium 未就绪"));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(`脚本加载失败（${new URL(src.js).hostname}）`));
    };
    document.head.appendChild(script);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCesium(): Promise<any> {
  const errors: string[] = [];
  for (const src of CESIUM_SOURCES) {
    try {
      return await loadCesiumFrom(src);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join("；"));
}

export function GlobePicker({
  virtualPos,
  exitPos,
  googleKey,
  onStage,
  notify,
}: {
  virtualPos: VLocPoint | null;
  exitPos: VLocPoint | null;
  googleKey: string;
  onStage: (p: VLocPoint) => void;
  notify: (msg: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cesiumRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinsRef = useRef<{ pending?: unknown; virtual?: unknown; exit?: unknown }>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleTilesetRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [source, setSource] = useState<"google" | "free">("free");
  const [sourceNote, setSourceNote] = useState("");
  // Free map sources the user can switch between: OSM street,
  // 高德 (Amap) street, Esri satellite, 高德 satellite. Amap is
  // a first-class option because the user asked for other maps
  // ("比如高德的") — its tiles are the public web tiles Amap
  // itself serves (autonavi.com appmaptile), no key needed.
  const [freeLayer, setFreeLayer] = useState<
    "street" | "amap" | "satellite" | "amapSatellite"
  >("street");
  // 2D / 3D view switch (user request): 3D is the ground-hugging
  // globe view; 2D morphs the same map into a flat plane map —
  // same tiles, same pins, picking works in both (2D picks via
  // the ellipsoid instead of the globe surface).
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [pending, setPending] = useState<VLocPoint | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // Presentation: the globe is NOT embedded in the pane's
  // fixed layout any more — it opens as a full-screen overlay
  // above the whole space, by default when the pane mounts and
  // collapsible back to a slim entry row. The Cesium viewer
  // stays mounted either way; hiding only toggles the
  // overlay's visibility, and reopening resizes the viewer.
  // The view itself is a ground-hugging 3D map (see the init
  // code): no space backdrop, no orbit viewpoint, no idle
  // spin — the user corrected that explicitly.
  const [arOpen, setArOpen] = useState(true);
  const googleKeyRef = useRef(googleKey);
  googleKeyRef.current = googleKey;
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  /** Picks the ground point under a screen position in
   * whichever scene mode is active: 3D ray-casts onto the globe
   * surface; 2D has no globe surface to ray-cast, so it picks
   * on the ellipsoid through the flat camera. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pickGroundPoint = (position: unknown): any => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return undefined;
    try {
      if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
        return viewer.camera.pickEllipsoid(
          position,
          viewer.scene.globe?.ellipsoid,
        );
      }
      const ray = viewer.camera.getPickRay(position);
      return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    } catch {
      return undefined;
    }
  };

  const flyTo = (lat: number, lon: number, height = 12000) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 1.6,
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setPin = (slot: "pending" | "virtual" | "exit", p: VLocPoint | null, color: string) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    const pins = pinsRef.current as Record<string, unknown>;
    if (pins[slot]) {
      viewer.entities.remove(pins[slot]);
      pins[slot] = undefined;
    }
    if (!p) return;
    pins[slot] = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
      point: {
        pixelSize: 13,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: p.label || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
        font: "12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, -20),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  };

  // The street layer, spelled out as a template provider so
  // the zoom cap is explicit: OpenStreetMap serves real tiles
  // down to level 19 (street level); past that Cesium would
  // only stretch lower-level tiles and blur.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streetImageryProvider = (Cesium: any) =>
    new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maximumLevel: 19,
      credit: new Cesium.Credit("© OpenStreetMap contributors"),
    });

  const applyFreeLayer = (
    layer: "street" | "amap" | "satellite" | "amapSatellite",
  ) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    viewer.imageryLayers.removeAll();
    if (layer === "street" || layer === "satellite") {
      // Leaving the Amap layers clears an Amap-only failure
      // note; other notes (Google fallback) are untouched.
      setSourceNote((prev) => (prev.startsWith("高德") ? "" : prev));
    }
    if (layer === "street") {
      viewer.imageryLayers.addImageryProvider(streetImageryProvider(Cesium));
    } else if (layer === "amap") {
      // 高德街道 (Amap web tiles, style 8 = 矢量街道）: the same
      // public tile endpoint Amap's own web map loads, Chinese
      // labels throughout. Amap tiles are drawn in GCJ-02 —
      // see the honesty note in the HUD: inside mainland China
      // WGS-84 pins can sit a few hundred metres off the Amap
      // base map, and Amap detail outside China is sparse.
      const amapStreet = new Cesium.UrlTemplateImageryProvider({
        url: "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        maximumLevel: 18,
        credit: new Cesium.Credit("© 高德地图 AutoNavi"),
      });
      amapStreet.errorEvent?.addEventListener(() => {
        setSourceNote("高德瓦片暂时加载失败（网络或图源不可达），可切回街道地图");
      });
      viewer.imageryLayers.addImageryProvider(amapStreet);
    } else if (layer === "amapSatellite") {
      // 高德卫星： style 6 satellite imagery + style 8
      // transparent road/label overlay on top.
      const amapSat = new Cesium.UrlTemplateImageryProvider({
        url: "https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
        maximumLevel: 18,
        credit: new Cesium.Credit("© 高德地图 AutoNavi"),
      });
      amapSat.errorEvent?.addEventListener(() => {
        setSourceNote("高德卫星瓦片暂时加载失败（网络或图源不可达），可切回街道地图");
      });
      viewer.imageryLayers.addImageryProvider(amapSat);
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://webst01.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}",
          maximumLevel: 18,
        }),
      );
    } else {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 18,
        }),
      );
    }
  };

  const enableGoogle = async (key: string): Promise<boolean> => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !key) return false;
    try {
      Cesium.GoogleMaps.defaultApiKey = key;
      const tileset = await Cesium.createGooglePhotorealistic3DTileset();
      // Google 2D roadmap tiles under the 3D data (best effort:
      // a failed session only loses the flat base layer).
      try {
        const sessRes = await fetch(
          `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mapType: "roadmap",
              language: "zh-CN",
              region: "TW",
            }),
          },
        );
        const sess = (await sessRes.json()) as { session?: string };
        if (sess.session) {
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.addImageryProvider(
            new Cesium.UrlTemplateImageryProvider({
              url: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${sess.session}&key=${encodeURIComponent(key)}`,
              maximumLevel: 21,
            }),
          );
        }
      } catch {
        // 3D tiles still work without the 2D base
      }
      viewer.scene.primitives.add(tileset);
      googleTilesetRef.current = tileset;
      tileset.tileFailed.addEventListener((err: { statusCode?: number; message?: string }) => {
        if (err && (err.statusCode === 403 || err.statusCode === 429)) {
          disableGoogle(
            err.statusCode === 429
              ? "谷歌返回配额超限（429），已自动回退免费公开地图"
              : "谷歌拒绝了瓦片请求（403，可能是计费或 API 未开通），已自动回退免费公开地图",
          );
        }
      });
      setSource("google");
      setSourceNote("");
      return true;
    } catch (e) {
      setSourceNote(
        `谷歌数据加载失败，已回退免费公开地图：${e instanceof Error ? e.message : "未知错误"}`,
      );
      setSource("free");
      return false;
    }
  };

  const disableGoogle = (note: string) => {
    const viewer = viewerRef.current;
    if (viewer && googleTilesetRef.current) {
      try {
        viewer.scene.primitives.remove(googleTilesetRef.current);
      } catch {
        // already gone
      }
      googleTilesetRef.current = null;
    }
    setSource("free");
    setSourceNote(note);
    applyFreeLayer(freeLayer);
  };

  // init viewer once (per retry)
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMsg("");
    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;
        const viewer = new Cesium.Viewer(containerRef.current, {
          imageryProvider: streetImageryProvider(Cesium),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        });
        viewerRef.current = viewer;
        // No space at all (the user's correction, twice over):
        // no starfield sky box, no sun/moon, no atmosphere glow,
        // no black void — AND no space viewpoint. The camera
        // stays near the ground like a 3D map you stand over:
        // the scene clears to one flat colour, the overlay
        // behind the canvas is the same flat colour, and the
        // zoom cap below keeps the planet's disc from ever
        // appearing.
        try {
          if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
          if (viewer.scene.skyAtmosphere)
            viewer.scene.skyAtmosphere.show = false;
          if (viewer.scene.sun) viewer.scene.sun.show = false;
          if (viewer.scene.moon) viewer.scene.moon.show = false;
          if (viewer.scene.globe)
            viewer.scene.globe.showGroundAtmosphere = false;
          viewer.scene.backgroundColor =
            Cesium.Color.fromCssColorString("#10151d");
        } catch {
          // backdrop knobs only; the globe itself still renders
        }
        // Start low and tilted over the region — a few hundred
        // kilometres up, looking across the surface, so the
        // ground fills the whole frame from the first moment.
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(121.0, 24.2, 260000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-62),
            roll: 0,
          },
        });
        // ---- gesture + sharpness tuning -------------------------
        // Render at the device's real pixel density (Cesium
        // defaults to 1×, which is the main reason the globe
        // looked soft on retina phones), refine tiles one level
        // earlier than the default screen-space error, and keep
        // a deep tile cache with sibling preloading so panning
        // and zooming land on sharp tiles instead of sitting on
        // blurry low-level ones.
        try {
          viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
          viewer.scene.globe.maximumScreenSpaceError = 1.5;
          viewer.scene.globe.tileCacheSize = 1000;
          viewer.scene.globe.preloadSiblings = true;
          if (viewer.scene.postProcessStages?.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = true;
          }
        } catch {
          // Quality knobs only — defaults still render fine.
        }
        // Gestures: a touch more glide on spin / pan / pinch
        // than Cesium's defaults so flicks carry, and street
        // level can be reached without clipping into the ground.
        try {
          const ctrl = viewer.scene.screenSpaceCameraController;
          ctrl.inertiaSpin = 0.93;
          ctrl.inertiaTranslate = 0.93;
          ctrl.inertiaZoom = 0.85;
          ctrl.minimumZoomDistance = 25;
          // Capped low (no-space rule): at 1,200 km the surface
          // still fills the frame; the whole-planet disc view
          // from orbit can never be reached.
          ctrl.maximumZoomDistance = 1200000;
        } catch {
          // defaults apply
        }
        // Double-tap / double-click zooms toward the tapped
        // point. Cesium's stock double-click instead starts
        // tracking whatever entity sits under the finger — an
        // accidental-touch trap on a picker globe — so it is
        // replaced outright.
        viewer.screenSpaceEventHandler.setInputAction(
          (click: { position: unknown }) => {
            const cartesian = pickGroundPoint(click.position);
            const camCarto = viewer.camera.positionCartographic;
            const targetHeight = Math.max(camCarto.height / 2.2, 80);
            let lon = Cesium.Math.toDegrees(camCarto.longitude);
            let lat = Cesium.Math.toDegrees(camCarto.latitude);
            if (cartesian) {
              const c = Cesium.Cartographic.fromCartesian(cartesian);
              lon = Cesium.Math.toDegrees(c.longitude);
              lat = Cesium.Math.toDegrees(c.latitude);
            }
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(lon, lat, targetHeight),
              orientation: {
                heading: viewer.camera.heading,
                pitch: viewer.camera.pitch,
                roll: 0,
              },
              duration: 0.55,
            });
          },
          Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
        );
        viewer.screenSpaceEventHandler.setInputAction(
          (click: { position: unknown }) => {
            const cartesian = pickGroundPoint(click.position);
            if (!cartesian) return;
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const point: VLocPoint = {
              label: "",
              country: "",
              lat: Math.round(lat * 10000) / 10000,
              lon: Math.round(lon * 10000) / 10000,
            };
            setPending(point);
            onStageRef.current(point);
            setPin("pending", point, "#ff9500");
            // Reverse geocode (Nominatim): a found name is shown,
            // a miss honestly leaves just the coordinates.
            fetch(
              `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}&zoom=14&accept-language=zh`,
            )
              .then((r) => r.json())
              .then((j: { display_name?: string }) => {
                if (j.display_name) {
                  const named = { ...point, label: j.display_name.split(",").slice(0, 2).join(",") };
                  setPending(named);
                  onStageRef.current(named);
                  setPin("pending", named, "#ff9500");
                }
              })
              .catch(() => undefined);
          },
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        );
        setStatus("ready");
        if (googleKeyRef.current) {
          void enableGoogle(googleKeyRef.current);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(
          `3D 地球仪加载失败：${e instanceof Error ? e.message : "未知错误"}。这通常是网络无法访问 Cesium 的 CDN；下面的城市列表和手动经纬度仍然可用。`,
        );
      });
    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // already destroyed
        }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  // pins follow props
  useEffect(() => {
    if (status === "ready") setPin("virtual", virtualPos, "#34c759");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, virtualPos]);
  useEffect(() => {
    if (status === "ready") setPin("exit", exitPos, "#2f6bff");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, exitPos]);

  // google key changes switch the data source live
  const googleModeRef = useRef(false);
  useEffect(() => {
    if (status !== "ready") return;
    if (googleKey && !googleModeRef.current) {
      googleModeRef.current = true;
      void enableGoogle(googleKey).then((ok) => {
        if (!ok) googleModeRef.current = false;
      });
    } else if (!googleKey && googleModeRef.current) {
      googleModeRef.current = false;
      disableGoogle("Google Maps API Key 已清除，已自动回退免费公开地图");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleKey, status]);

  useEffect(() => {
    if (status === "ready" && source === "free") applyFreeLayer(freeLayer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeLayer, status]);

  // 2D / 3D morph: Cesium animates the same scene between the
  // flat plane map and the globe. The applied mode is tracked
  // so the initial 3D state does not trigger a pointless morph,
  // and morphComplete is not needed — picking reads the live
  // scene.mode, which flips at morph end; clicks during the
  // ~1s morph simply pick in the outgoing mode.
  const appliedViewModeRef = useRef<"3d" | "2d">("3d");
  useEffect(() => {
    if (status !== "ready") return;
    if (appliedViewModeRef.current === viewMode) return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    appliedViewModeRef.current = viewMode;
    try {
      if (viewMode === "2d") viewer.scene.morphTo2D(1.0);
      else viewer.scene.morphTo3D(1.0);
    } catch {
      // morph is best-effort; the viewer stays in its mode
    }
  }, [viewMode, status]);

  // AR overlay: lock the page behind it while it floats open,
  // and resize the viewer when it becomes visible again (a
  // hidden canvas has no size to render into).
  useEffect(() => {
    if (!arOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      try {
        viewerRef.current?.resize();
      } catch {
        // viewer not ready yet
      }
    }, 60);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [arOpen]);

  const doSearch = () => {
    const q = searchText.trim();
    if (!q) return;
    setSearching(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh&q=${encodeURIComponent(q)}`,
    )
      .then((r) => r.json())
      .then((arr: { lat?: string; lon?: string; display_name?: string }[]) => {
        const hit = arr[0];
        if (!hit || hit.lat === undefined || hit.lon === undefined) {
          notifyRef.current("没有搜到这个地名，换个写法试试");
          return;
        }
        const point: VLocPoint = {
          label: (hit.display_name ?? q).split(",").slice(0, 2).join(","),
          country: "",
          lat: Math.round(Number(hit.lat) * 10000) / 10000,
          lon: Math.round(Number(hit.lon) * 10000) / 10000,
        };
        setPending(point);
        onStageRef.current(point);
        setPin("pending", point, "#ff9500");
        flyTo(point.lat, point.lon, 60000);
      })
      .catch(() => notifyRef.current("地名搜索失败（网络或服务不可达）"))
      .finally(() => setSearching(false));
  };

  return (
    <div>
      {/* In-flow entry: the globe itself no longer sits in this
          fixed column — this row only reports its state and
          reopens the floating layer. */}
      <div className="flex items-center gap-2.5 rounded-2xl bg-[#171c26] px-3.5 py-3 text-white">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[15px]">
          地
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-tight">
            地球仪 · 全屏地图（2D / 3D 可切换）
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-white/60">
            {status === "loading"
              ? "正在加载地球仪…"
              : status === "error"
                ? "地球仪加载失败，可打开后重试"
                : arOpen
                  ? "地球仪已打开，贴近地面看 3D 地图"
                  : pending
                    ? `已选：${pending.label || "坐标"} · ${pending.lat.toFixed(4)}, ${pending.lon.toFixed(4)}`
                    : "全屏打开，贴近地面看 3D 地图，点任意点落图钉"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setArOpen((v) => !v)}
          aria-expanded={arOpen}
          className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#12275e]"
        >
          {arOpen ? "收起" : "打开地球仪"}
        </button>
      </div>
      {pending && (
        <p className="mt-1.5 text-xs text-[#6e6e73]">
          已选：{pending.label || "（未查到地名）"} · {pending.lat.toFixed(4)},{" "}
          {pending.lon.toFixed(4)} —— 点下方「设为虚拟位置」才保存并启用。
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
        这是空间内用公开地图瓦片做的地球仪，不是正版 Google Earth，也没有谷歌街景全景；「看到街道」指放大到街道级别的地图瓦片（道路、路名、建筑轮廓），不是街景照片。看法可以切换：3D 是贴近地面的地球仪视角，2D 是平面地图，同一套底图与图钉、点选照样可用。底图可以切换：街道（OpenStreetMap）、高德、高德卫星、卫星（Esri）——高德用 GCJ-02 坐标，大陆境内图钉可能与高德底图偏移几百米，大陆以外细节较少。部分偏远地区放大后细节较少，以图源实际返回为准。连上你自己的 Google Maps API Key 后，地球仪会改用谷歌的 Photorealistic 3D Tiles 与 2D 瓦片，画面保留谷歌版权标识；谷歌数据只允许展示，不可缓存、提取或离线使用。
      </p>

      {/* ------- Full-screen layer: the 3D map covers the
          whole space, HUD controls float over it. The backdrop
          is one flat colour (no space gradient, no vignette) —
          the same colour the Cesium scene clears to, so any
          unpainted edge reads as plain background. Portaled to
          <body>: rendered in place it sat inside the pane's
          scrollable, zoom-transformed ancestors, which clipped
          its top HUD buttons off-screen. ------- */}
      {createPortal(
        <div
        className={`fixed inset-0 z-[80] ${arOpen ? "" : "hidden"}`}
        role="dialog"
        aria-label="地球仪（全屏，2D / 3D 可切换）"
        style={{ background: "#10151d" }}
      >
        <div ref={containerRef} className="absolute inset-0" aria-label="3D 地球仪" />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/[0.85]">
            正在加载 3D 地球仪…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-md text-sm leading-relaxed text-[#f28b82]">{errorMsg}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="rounded-full bg-[#2f6bff] px-4 py-2 text-sm font-medium text-white"
              >
                重试加载
              </button>
              <button
                type="button"
                onClick={() => setArOpen(false)}
                className="rounded-full bg-white/[0.12] px-4 py-2 text-sm font-medium text-white"
              >
                先收起
              </button>
            </div>
          </div>
        )}

        {/* top HUD */}
        <div className="absolute inset-x-0 top-0 pt-safe">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <button
              type="button"
              aria-label="收起地球仪"
              onClick={() => setArOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.45] text-[17px] leading-none text-white backdrop-blur-md"
            >
              ✕
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium tracking-wide text-white/[0.92]">
              虚拟位置 · 3D 地球仪
            </span>
            <span aria-hidden="true" className="w-9 shrink-0" />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 px-3">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${source === "google" ? "bg-[#34c759]/[0.28] text-[#a9e8bb]" : "bg-[#2f6bff]/[0.3] text-[#bcd2ff]"}`}
            >
              数据源：
              {source === "google"
                ? "谷歌数据"
                : freeLayer === "amap"
                  ? "高德地图"
                  : freeLayer === "amapSatellite"
                    ? "高德卫星"
                    : freeLayer === "satellite"
                      ? "免费公开地图 · 卫星"
                      : "免费公开地图 · 街道"}
            </span>
            {(
              [
                { k: "3d", l: "3D" },
                { k: "2d", l: "2D" },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                aria-pressed={viewMode === t.k}
                aria-label={t.k === "3d" ? "3D 地球仪视图" : "2D 平面地图视图"}
                onClick={() => setViewMode(t.k)}
                className={`min-h-0 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${viewMode === t.k ? "bg-white text-[#12275e]" : "bg-black/[0.45] text-white/[0.85]"}`}
              >
                {t.l}
              </button>
            ))}
            {source === "free" &&
              (
                [
                  { k: "street", l: "街道" },
                  { k: "amap", l: "高德" },
                  { k: "satellite", l: "卫星" },
                  { k: "amapSatellite", l: "高德卫星" },
                ] as const
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  aria-pressed={freeLayer === t.k}
                  onClick={() => setFreeLayer(t.k)}
                  className={`min-h-0 rounded-full px-2.5 py-1 text-[11px] backdrop-blur-md ${freeLayer === t.k ? "bg-white text-[#12275e]" : "bg-black/[0.45] text-white/[0.85]"}`}
                >
                  {t.l}
                </button>
              ))}
          </div>
          {sourceNote && (
            <p className="mx-auto mt-1.5 max-w-lg px-4 text-center text-[11px] leading-relaxed text-[#f28b82]">
              {sourceNote}
            </p>
          )}
          {source === "free" &&
            (freeLayer === "amap" || freeLayer === "amapSatellite") && (
              <p className="mx-auto mt-1.5 max-w-lg px-4 text-center text-[11px] leading-relaxed text-white/[0.65]">
                高德地图用 GCJ-02 坐标：图钉和搜索用的是全球 WGS-84
                坐标，在中国大陆境内图钉可能与高德底图偏移几百米；高德在中国大陆以外地区细节较少。
              </p>
            )}
          <div className="mx-auto mt-2 flex max-w-lg items-center gap-1.5 px-3">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="搜地名，飞过去"
              aria-label="搜索地名"
              className="h-9 min-w-0 flex-1 rounded-full bg-black/[0.45] px-3.5 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/50"
            />
            <button
              type="button"
              disabled={searching}
              onClick={doSearch}
              className="h-9 shrink-0 rounded-full bg-[#2f6bff] px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {searching ? "搜索中…" : "飞到"}
            </button>
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
            {VLOC_PRESETS.slice(0, 9).map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  const point: VLocPoint = { label: c.label, country: c.country, lat: c.lat, lon: c.lon };
                  setPending(point);
                  onStageRef.current(point);
                  setPin("pending", point, "#ff9500");
                  flyTo(c.lat, c.lon, 80000);
                }}
                className="min-h-0 shrink-0 rounded-full bg-black/[0.45] px-2.5 py-1 text-[11px] text-white/[0.9] backdrop-blur-md"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* bottom HUD */}
        {status === "ready" && (
          <div className="absolute inset-x-0 bottom-0 pb-safe">
            <div className="flex flex-col items-center gap-2 px-3 pb-3">
              <div className="pointer-events-none flex flex-wrap justify-center gap-1.5 text-[10px] text-white">
                <span className="rounded-full bg-black/[0.45] px-2 py-0.5 backdrop-blur-md">● 橙色：待确认的选点</span>
                <span className="rounded-full bg-black/[0.45] px-2 py-0.5 backdrop-blur-md">● 绿色：当前虚拟位置</span>
                <span className="rounded-full bg-black/[0.45] px-2 py-0.5 backdrop-blur-md">● 蓝色：出口 IP 位置</span>
              </div>
              {pending ? (
                <div className="flex w-full max-w-lg items-center gap-2 rounded-2xl bg-black/[0.55] px-3.5 py-2.5 backdrop-blur-md">
                  <span className="min-w-0 flex-1 truncate text-xs leading-relaxed text-white">
                    已选：{pending.label || "（未查到地名）"} ·{" "}
                    {pending.lat.toFixed(4)}, {pending.lon.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setArOpen(false)}
                    className="shrink-0 rounded-full bg-[#34c759] px-3.5 py-1.5 text-[13px] font-medium text-white"
                  >
                    选好了，回去保存
                  </button>
                </div>
              ) : (
                <p className="pointer-events-none rounded-full bg-black/[0.4] px-3 py-1 text-center text-[11px] text-white/[0.85] backdrop-blur-md">
                  拖动平移 · 捏合缩放 · 双击放大 · 点任意点落图钉
                </p>
              )}
            </div>
          </div>
        )}
        </div>,
        document.body,
      )}
    </div>
  );

}

export function VirtualLocationPane({
  onBack,
  notify,
  pioneerRegion,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
  pioneerRegion: string | null;
}) {
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState<VLocPoint | null>(null);
  const [citySearch, setCitySearch] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const vlocQuery = useQuery({
    queryKey: ["virtualLocation"],
    queryFn: () => api.getVirtualLocation({}),
  });
  const gkeyQuery = useQuery({
    queryKey: ["googleMapsKey"],
    queryFn: () => api.getGoogleMapsKeyState({}),
  });
  const gkey = gkeyQuery.data;
  const globeKeyQuery = useQuery({
    queryKey: ["googleMapsKeyForGlobe"],
    queryFn: () => api.getGoogleMapsKeyForGlobe({}),
    enabled: gkey?.status === "ok" && gkey?.saved === true,
  });
  const v = vlocQuery.data;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["virtualLocation"] });
    queryClient.invalidateQueries({ queryKey: ["googleMapsKey"] });
    queryClient.invalidateQueries({ queryKey: ["googleMapsKeyForGlobe"] });
  };
  const setMutation = useMutation({
    mutationFn: async (args: {
      enabled?: boolean;
      label?: string;
      country?: string;
      lat?: number;
      lon?: number;
    }) => await api.setVirtualLocation(args),
    onSuccess: () => {
      invalidate();
    },
    onError: (e) => notify(e instanceof Error ? e.message : "保存失败"),
  });
  const exitMutation = useMutation({
    mutationFn: async () => await api.refreshExitIpLocation({}),
    onSuccess: (res) => {
      invalidate();
      notify(
        res.exitError
          ? `出口 IP 实测失败：${res.exitError}`
          : `已实测出口 IP：${res.exitIp}（${res.exitCountry} ${res.exitCity}）`,
      );
    },
    onError: (e) => notify(e instanceof Error ? e.message : "实测失败"),
  });
  const saveKeyMutation = useMutation({
    mutationFn: async () => await api.saveGoogleMapsKey({ key: keyInput.trim() }),
    onSuccess: (res) => {
      invalidate();
      if (res.ok) {
        setKeyInput("");
        setKeyError("");
        notify("连接成功：地球仪已自动切换到谷歌数据");
      } else {
        setKeyError(res.reason || "验证失败");
      }
    },
    onError: (e) =>
      setKeyError(e instanceof Error ? e.message : "保存失败，请重试"),
  });
  const testKeyMutation = useMutation({
    mutationFn: async () => await api.testGoogleMapsKey({}),
    onSuccess: (res) => {
      invalidate();
      notify(res.ok ? "测试连接成功，Key 有效" : `测试失败：${res.reason}`);
    },
    onError: (e) => notify(e instanceof Error ? e.message : "测试失败"),
  });
  const clearKeyMutation = useMutation({
    mutationFn: async () => await api.clearGoogleMapsKey({}),
    onSuccess: () => {
      invalidate();
      notify("Key 已清除，地球仪已回退免费公开地图");
    },
    onError: (e) => notify(e instanceof Error ? e.message : "清除失败"),
  });

  const enabled = v?.enabled === true;
  const hasLoc = v != null && v.lat !== null && v.lon !== null;
  const virtualPos: VLocPoint | null = hasLoc
    ? { label: v.label || "虚拟位置", country: v.country, lat: v.lat as number, lon: v.lon as number }
    : null;
  const exitPos: VLocPoint | null =
    v && v.exitLat !== null && v.exitLon !== null && v.exitLat !== undefined && v.exitLon !== undefined
      ? {
          label: `出口 IP${v.exitCity ? ` · ${v.exitCity}` : ""}`,
          country: v.exitCountry,
          lat: v.exitLat,
          lon: v.exitLon,
        }
      : null;

  const matchPreset = (text: string): (typeof VLOC_PRESETS)[number] | null => {
    const t = text.toLowerCase();
    return (
      VLOC_PRESETS.find((c) =>
        c.aliases.some((a) => t.includes(a.toLowerCase())),
      ) ?? null
    );
  };
  const syncFromNode = () => {
    if (pioneerRegion) {
      const hit = matchPreset(pioneerRegion);
      if (hit) {
        setMutation.mutate({ label: hit.label, country: hit.country, lat: hit.lat, lon: hit.lon });
        notify(`已同步为当前 Pioneer 节点位置：${hit.label}`);
        return;
      }
      notify(`当前 Pioneer 节点是「${pioneerRegion}」，预设城市里没有对应位置，可在地球仪上点选`);
      return;
    }
    notify("现在没有已连接的代理节点（Pioneer 未连接），没有可同步的位置");
  };

  const cityList = VLOC_PRESETS.filter(
    (c) =>
      !citySearch.trim() ||
      c.label.includes(citySearch.trim()) ||
      c.country.includes(citySearch.trim()),
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回代理中心"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05]"
        >
          ‹
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-semibold">虚拟位置</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="虚拟位置开关"
          onClick={() => {
            if (!enabled && !hasLoc) {
              notify("先在地球仪上点选一个位置，或从下面城市列表里选一个");
              return;
            }
            setMutation.mutate({ enabled: !enabled });
            notify(enabled ? "已关闭虚拟位置，恢复实际位置" : "已开启虚拟位置");
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-[#34c759]" : "bg-black/[0.18]"}`}
        >
          <span
            className={`absolute top-[2px] h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[24px]" : "left-[2px]"}`}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="flex flex-col divide-y divide-black/[0.05] rounded-xl bg-[#f7f7f8] px-3.5">
          <div className="flex items-baseline gap-2 py-2.5">
            <span className="w-[104px] shrink-0 text-xs font-semibold text-[#6e6e73]">出口 IP 归属地</span>
            <span className="min-w-0 flex-1 text-[13px]">
              {v?.exitIp
                ? `${v.exitCountry} ${v.exitCity}（${v.exitIp}）`
                : v?.exitError
                  ? `实测失败：${v.exitError}`
                  : "尚未实测"}
              {v?.exitMeasuredAt && (
                <span className="text-[11px] text-[#9a9aa0]">
                  {" "}· {fmtTimeOfDay(new Date(v.exitMeasuredAt).getTime())} 实测
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={exitMutation.isPending}
              onClick={() => exitMutation.mutate()}
              className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium shadow-sm disabled:opacity-50"
            >
              {exitMutation.isPending ? "实测中…" : "重新实测"}
            </button>
          </div>
          <div className="flex items-baseline gap-2 py-2.5">
            <span className="w-[104px] shrink-0 text-xs font-semibold text-[#6e6e73]">虚拟位置</span>
            <span className="min-w-0 flex-1 text-[13px]">
              {hasLoc
                ? `${v.label || "自定义位置"}${v.country ? `（${v.country}）` : ""} · ${(v.lat as number).toFixed(4)}, ${(v.lon as number).toFixed(4)} · ${enabled ? "已启用" : "未启用"}`
                : "未设置"}
            </span>
          </div>
          <div className="flex items-baseline gap-2 py-2.5">
            <span className="w-[104px] shrink-0 text-xs font-semibold text-[#6e6e73]">手机系统定位</span>
            <span className="min-w-0 flex-1 text-[13px]">未改变（空间改不了）</span>
          </div>
        </div>

        <div className="mt-4">
          <GlobePicker
            virtualPos={virtualPos}
            exitPos={exitPos}
            googleKey={globeKeyQuery.data?.key ?? ""}
            onStage={setStaged}
            notify={notify}
          />
        </div>

        {staged && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#fff7e8] px-3 py-2.5">
            <p className="min-w-0 flex-1 truncate text-xs">
              待确认：{staged.label || "（未查到地名）"} · {staged.lat.toFixed(4)}, {staged.lon.toFixed(4)}
            </p>
            <button
              type="button"
              onClick={() => {
                setMutation.mutate(
                  { label: staged.label, country: staged.country, lat: staged.lat, lon: staged.lon, enabled: true },
                  {
                    onSuccess: () => {
                      setStaged(null);
                      notify("已设为虚拟位置并启用");
                    },
                  },
                );
              }}
              className="shrink-0 rounded-full bg-[#34c759] px-4 py-1.5 text-xs font-semibold text-white"
            >
              设为虚拟位置
            </button>
            <button
              type="button"
              onClick={() => setStaged(null)}
              className="shrink-0 rounded-full bg-black/[0.06] px-3 py-1.5 text-xs"
            >
              取消
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <input
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            placeholder="搜城市"
            aria-label="搜索城市"
            className="h-9 min-w-0 flex-1 rounded-xl bg-black/[0.04] px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={syncFromNode}
            className="h-9 shrink-0 rounded-xl bg-black/[0.06] px-3 text-xs font-medium"
          >
            同步为当前代理节点位置
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {cityList.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() =>
                setMutation.mutate(
                  { label: c.label, country: c.country, lat: c.lat, lon: c.lon },
                  { onSuccess: () => notify(`虚拟位置已设为${c.label}${enabled ? "（已启用中）" : "，打开上方开关后生效"}`) },
                )
              }
              className="rounded-xl bg-[#f7f7f8] px-2 py-2 text-left"
            >
              <span className="block text-[13px] font-medium">{c.label}</span>
              <span className="block text-[10px] text-[#9a9aa0]">
                {c.country} · {c.lat.toFixed(2)}, {c.lon.toFixed(2)}
              </span>
            </button>
          ))}
        </div>

        {v && v.recent.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold text-[#6e6e73]">最近使用</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {v.recent.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    setMutation.mutate({ label: r.label, country: r.country, lat: r.lat, lon: r.lon })
                  }
                  className="min-h-0 rounded-full bg-black/[0.05] px-3 py-1.5 text-xs"
                >
                  {r.label || `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="mt-4 text-xs font-semibold text-[#6e6e73]">手动输入经纬度</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            {...FIELDS.setVirtualLocation.label}
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="名称（可选）"
            aria-label="位置名称"
            className="h-9 w-32 rounded-xl bg-black/[0.04] px-3 text-sm outline-none"
          />
          <input
            {...FIELDS.setVirtualLocation.lat}
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            placeholder="纬度 -90~90"
            inputMode="decimal"
            aria-label="纬度"
            className="h-9 w-28 rounded-xl bg-black/[0.04] px-3 text-sm outline-none"
          />
          <input
            {...FIELDS.setVirtualLocation.lon}
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
            placeholder="经度 -180~180"
            inputMode="decimal"
            aria-label="经度"
            className="h-9 w-28 rounded-xl bg-black/[0.04] px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => {
              const lat = Number(manualLat);
              const lon = Number(manualLon);
              if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                notify("经纬度不对：纬度要在 -90~90、经度在 -180~180 之间");
                return;
              }
              setMutation.mutate(
                { label: manualLabel || "自定义位置", country: "", lat, lon },
                { onSuccess: () => notify("已保存自定义位置") },
              );
            }}
            className="h-9 rounded-xl bg-[#2f6bff] px-4 text-sm font-medium text-white"
          >
            保存
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-black/[0.06] px-3.5 py-3">
          <p className="text-sm font-semibold">Google Maps API Key（谷歌数据）</p>
          <p className="mt-1 text-xs leading-relaxed text-[#6e6e73]">
            状态：
            {!gkey?.saved
              ? "未保存，地球仪用免费公开地图"
              : gkey.status === "ok"
                ? `已连接（Key ••••${gkey.last4}），地球仪用谷歌数据`
                : `已保存（Key ••••${gkey.last4}）但未连接：${gkey.error || "尚未验证"}`}
            {gkey?.checkedAt ? ` · 验证于 ${fmtTimeOfDay(new Date(gkey.checkedAt).getTime())}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <input
              {...FIELDS.saveGoogleMapsKey.key}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="粘贴你的 Google Maps API Key"
              aria-label="Google Maps API Key"
              type="password"
              autoComplete="off"
              className="h-9 min-w-[200px] flex-1 rounded-xl bg-black/[0.04] px-3 font-mono text-xs outline-none"
            />
            <button
              type="button"
              disabled={!keyInput.trim() || saveKeyMutation.isPending}
              onClick={() => saveKeyMutation.mutate()}
              className="h-9 shrink-0 rounded-xl bg-[#2f6bff] px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {saveKeyMutation.isPending ? "验证中…" : "连接"}
            </button>
            {gkey?.saved && (
              <>
                <button
                  type="button"
                  disabled={testKeyMutation.isPending}
                  onClick={() => testKeyMutation.mutate()}
                  className="h-9 shrink-0 rounded-xl bg-black/[0.06] px-3.5 text-xs font-medium disabled:opacity-50"
                >
                  测试连接
                </button>
                <button
                  type="button"
                  onClick={() => clearKeyMutation.mutate()}
                  className="h-9 shrink-0 rounded-xl bg-[#fce8e6] px-3.5 text-xs font-medium text-[#c0392b]"
                >
                  清除 Key
                </button>
              </>
            )}
          </div>
          {keyError && (
            <p className="mt-1.5 text-xs leading-relaxed text-[#c0392b]">{keyError}</p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
            保存时服务端会拿 Key 真实请求一次 Google Map Tiles API（Photorealistic 3D Tiles）验证，通过了才算连接、地球仪才自动切到谷歌数据；失败会如实显示原因（Key 无效、未开通 Map Tiles API、未开通计费、配额超限）。Key 只加密存在空间服务端，界面只显示掩码；加载谷歌瓦片时 Key 会随请求发给 Google，这是谷歌平台的工作方式。费用记在你自己的 Google Cloud 账号上：3D 瓦片每月前 1000 次加载免费、之后按谷歌定价计费，2D 瓦片每月前 10 万次免费，空间不代付。Key 被清除或验证失效时，地球仪会自动回退免费公开地图。
          </p>
        </div>

        <div className="mt-4 rounded-xl bg-[#fdf3e3] px-3 py-2.5 text-xs leading-relaxed text-[#7a5410]">
          <p className="font-semibold">虚拟位置的边界</p>
          <p className="mt-0.5">
            虚拟位置只在空间内生效：空间里显示的当前位置、空间内浏览器里请求定位的页面、空间内用到位置的功能，开启时用虚拟位置，关闭时用实际位置。它改不了手机系统定位，也改不了手机上其他 App（地图、微信、游戏等）读到的定位；改不了真实出口 IP 的归属地——靠 IP 判断位置的网站看到的仍是出口 IP 的位置，不是虚拟位置。虚拟位置和代理节点位置是两回事，可以不一样。
          </p>
        </div>
      </div>
    </div>
  );
}
