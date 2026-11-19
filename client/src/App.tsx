// 桌面聊天空间 — a macOS-desktop-style three-column window with
// three-section navigation: the sidebar （智能体 / 文件 / Pioneer VPN)
// switches what the middle column lists, and picking an item in the
// middle column opens the matching pane on the right. Every chat
// window is the same kind of room (group-style: member toggle row,
// member-based replies); a room's members decide who replies in it.
// Muse is the fixed agent; replies come from the server action
// (platform Muse channel), never from canned text.

import {
useCallback,
useEffect,
useRef,
useState,
type PointerEvent as ReactPointerEvent,
type ReactNode,
type RefObject,
type TouchEvent as ReactTouchEvent,
} from "react";
import {
useMutation,
useQuery,
useQueryClient,
} from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";
import logoAnthropic from "./assets/logos/anthropic.png";
import logoDeepseek from "./assets/logos/deepseek.png";
import logoDoubao from "./assets/logos/doubao.png";
import logoGemini from "./assets/logos/gemini.png";
import logoGrok from "./assets/logos/grok.png";
import logoKimi from "./assets/logos/kimi.png";
import logoMistral from "./assets/logos/mistral.png";
import logoOpenai from "./assets/logos/openai.png";
import logoOpenrouter from "./assets/logos/openrouter.png";
import logoQwen from "./assets/logos/qwen.png";
import logoSiliconflow from "./assets/logos/siliconflow.png";
import logoWenxin from "./assets/logos/wenxin.png";
import logoYuanbao from "./assets/logos/yuanbao.png";
import logoZhipu from "./assets/logos/zhipu.png";

const FIELDS = actionFields<typeof Actions>();

type Conversation = ApiResponse<
  typeof api,
  "listConversations"
>["conversations"][number];
type ChatMessage = ApiResponse<typeof api, "listMessages">["messages"][number];
type FileItem = ApiResponse<typeof api, "listFiles">["files"][number];
type PioneerState = ApiResponse<typeof api, "pioneerGetState">;
type Agent = ApiResponse<typeof api, "listAgents">["agents"][number];
type Profile = ApiResponse<typeof api, "getProfile">;
type GroupMembers = ApiResponse<typeof api, "listGroupMembers">;
type MuseSettings = ApiResponse<typeof api, "getMuseSettings">;
type Skill = ApiResponse<typeof api, "listSkills">["skills"][number];
type Trigger = ApiResponse<typeof api, "listTriggers">["triggers"][number];
type IpPurity = ApiResponse<typeof api, "pioneerTestIpPurity">;
type PioneerLog = ApiResponse<typeof api, "pioneerGetLogs">["logs"][number];

const DEFAULT_PROFILE: Profile = {
  name: "我",
  glyph: "",
  color: "#b9bec7",
  avatarUrl: null,
  showTime: true,
  soundOn: false,
  gestureControl: false,
  themeMode: "system",
  fontScale: 3,
  codeWrap: true,
  customInstructions: "",
  customInstructionsEnabled: true,
};

const DEFAULT_MUSE: MuseSettings = {
  name: "Muse",
  role: "",
  color: "#2f6bff",
  avatarUrl: null,
  enabled: true,
  thinking: "默认",
  systemPrompt: "",
  memory: "",
  note: "",
  sortOrder: 0,
};

/** A locally-built stand-in for a provisional room: the server
 * creates the room but deliberately keeps it out of every list
 * until the user's first message saves it, so the client renders
 * the open window from this description (title + membership) in
 * the meantime. */
function makeTempConv(
  id: number,
  init: Partial<Conversation>,
): Conversation {
  return {
    id,
    title: "新对话",
    kind: "direct",
    agentId: null,
    memberBased: true,
    memberAgentIds: [],
    museMember: false,
    stageOwner: "",
    iconColor: "",
    iconGlyph: "",
    avatarUrl: null,
    preview: "",
    previewAt: null,
    updatedAt: new Date().toISOString(),
    ...init,
  };
}

/** A short two-note tone for a newly arrived reply (only played when
 * the user's 提示音 setting is on). Pure WebAudio — no audio file. */
function playReplyTone() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    const notes: Array<[number, number]> = [
      [880, 0],
      [1318, 0.12],
    ];
    for (const [freq, delay] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ac.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
    setTimeout(() => void ac.close().catch(() => {}), 600);
  } catch {
    // No audio available — the tone is a nicety, never an error.
  }
}

/* Provider catalogue — the same list as the multi-agent collaborative
   space: grouped by vendor, each vendor's models in canonical
   newest → oldest order with real model ids. Picking a provider fills
   its real API base; 自定义 leaves the address to the user. */
type ProviderDef = {
  id: string;
  label: string;
  base: string;
  glyph: string;
  color: string;
  models: string[];
};
const PROVIDERS: ProviderDef[] = [
  {
    id: "openai", label: "OpenAI", base: "https://api.openai.com/v1", glyph: "◎", color: "#10a37f",
    models: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-5.6", "gpt-5.5", "gpt-5.5-pro", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "gemini", label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", glyph: "✦", color: "#4796e3",
    models: ["gemini-4-hydrogen", "gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
  },
  {
    id: "anthropic", label: "Anthropic", base: "https://api.anthropic.com/v1", glyph: "✳", color: "#d97757",
    models: ["claude-fable-5-2", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-opus-4-5"],
  },
  {
    id: "deepseek", label: "DeepSeek", base: "https://api.deepseek.com/v1", glyph: "DS", color: "#4d6bfe",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash", "deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "qwen", label: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", glyph: "☁", color: "#6c3df0",
    models: ["qwen3.8-flash", "qwen3.8-max", "qwen3.7-flash", "qwen3.7-plus", "qwen3.7-max", "qwen3.6-flash", "qwen3.6-plus", "qwen3.5-flash", "qwen3.5-plus", "qwen-max", "qwen-plus", "qwen-turbo", "qwen-flash"],
  },
  {
    id: "kimi", label: "Kimi（Moonshot）", base: "https://api.moonshot.cn/v1", glyph: "☾", color: "#3b3f4a",
    models: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3", "kimi-k2.7-code-highspeed", "kimi-k2.7-code", "kimi-k2.6"],
  },
  {
    id: "zhipu", label: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", glyph: "智", color: "#2f6fed",
    models: ["glm-5.3-flashx", "glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6"],
  },
  { id: "xai", label: "xAI（Grok）", base: "https://api.x.ai/v1", glyph: "𝕏", color: "#4a4a52", models: [] },
  { id: "mistral", label: "Mistral", base: "https://api.mistral.ai/v1", glyph: "M", color: "#ff7000", models: [] },
  { id: "hunyuan", label: "腾讯混元（元宝）", base: "https://api.hunyuan.cloud.tencent.com/v1", glyph: "元", color: "#0052d9", models: [] },
  { id: "doubao", label: "豆包（火山方舟）", base: "https://ark.cn-beijing.volces.com/api/v3", glyph: "豆", color: "#1664ff", models: [] },
  { id: "wenxin", label: "文心一言（百度千帆）", base: "https://qianfan.baidubce.com/v2", glyph: "文", color: "#2932e1", models: [] },
  { id: "openrouter", label: "OpenRouter", base: "https://openrouter.ai/api/v1", glyph: "⇄", color: "#6467f2", models: [] },
  {
    id: "siliconflow", label: "硅基流动", base: "https://api.siliconflow.cn/v1", glyph: "Si", color: "#7c5cf0",
    models: ["deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.3-Flash", "zai-org/GLM-5.3", "Qwen/Qwen3.8-27B", "zai-org/GLM-5.2", "deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Flash", "Pro/moonshotai/Kimi-K2.6", "Qwen/Qwen3.6-27B"],
  },
  { id: "custom", label: "自定义（手动填地址）", base: "", glyph: "…", color: "#5d6a82", models: [] },
];

const THINKING_LEVELS = ["默认", "关闭", "低", "中", "高"] as const;

const AGENT_COLORS = [
  "#4d6bfe", "#10a37f", "#d97757", "#4796e3", "#6c3df0",
  "#3b3f4a", "#2f6fed", "#7c5cf0", "#6467f2", "#ff7000", "#5d6a82",
];

type Section = "agents" | "files" | "vpn";

type PendingImage = {
  dataBase64: string;
  mimeType: string;
  preview: string;
  fileName: string;
  size: number;
};
type PendingFile = {
  dataBase64: string;
  mimeType: string;
  fileName: string;
  size: number;
};

/* ---------------- time / format helpers ---------------- */

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function hm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
/** Date separator pill label, e.g. 「今天 17:08」. */
function pillLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `今天 ${hm(d)}`;
  if (sameDay(d, yesterday)) return `昨天 ${hm(d)}`;
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
}
/** Compact time shown in list rows. */
function listTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return hm(d);
  if (sameDay(d, yesterday)) return "昨天";
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
/** Full date + time, for detail panes. */
function fullTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)}`;
}
/** The files-column icon for a file, by type: images get their own
 * glyph (rows also show a thumbnail), audio/video/archives get
 * theirs, everything else the generic document glyph. */
function fileTypeIcon(f: {
  mimeType: string | null;
  isImage: boolean;
}): string[] {
  if (f.isImage) return PATHS.image;
  const mime = f.mimeType ?? "";
  if (mime.startsWith("audio/")) return PATHS.music;
  if (mime.startsWith("video/")) return PATHS.film;
  if (
    mime === "application/zip" ||
    mime === "application/x-rar-compressed" ||
    mime === "application/x-7z-compressed" ||
    mime === "application/gzip" ||
    mime === "application/x-tar"
  ) {
    return PATHS.archive;
  }
  return PATHS.file;
}

/** The files column's category tabs: every file belongs to
 * exactly one category by its type — 图片 / 视频 / 音频 / 文件
 * (everything else). Entering the files section always lands on
 * 图片； the tabs at the top switch the list to one category. */
type FileCategory = "image" | "video" | "audio" | "other";

function fileCategoryOf(f: {
  mimeType: string | null;
  isImage: boolean;
}): FileCategory {
  if (f.isImage || (f.mimeType ?? "").startsWith("image/")) return "image";
  const mime = f.mimeType ?? "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

const FILE_CATEGORIES: {
  key: FileCategory;
  label: string;
  emptyText: string;
}[] = [
  { key: "image", label: "图片", emptyText: "暂无图片" },
  { key: "video", label: "视频", emptyText: "暂无视频" },
  { key: "audio", label: "音频", emptyText: "暂无音频" },
  { key: "other", label: "文件", emptyText: "暂无其他文件" },
];

function formatSize(bytes: number | null) {
  if (bytes == null) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------------- icons (inline SVG, lucide-style) ---------------- */

function Icon({
  d,
  size = 22,
  filled = false,
}: {
  d: string[];
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const PATHS = {
  chat: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  sparkles: [
    "M9.94 15.5a2 2 0 0 0-1.44-1.44L2.37 12.48a.5.5 0 0 1 0-.96l6.13-1.58A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z",
  ],
  globe: [
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
    "M2 12h20",
    "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20Z",
  ],
  plus: ["M12 5v14", "M5 12h14"],
  compose: [
    "M12 20h9",
    "M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",
    "M15 5l3 3",
  ],
  gear: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m21 21-4.3-4.3"],
  refresh: [
    "M3 12a9 9 0 0 1 15-6.7L21 8",
    "M21 3v5h-5",
    "M21 12a9 9 0 0 1-15 6.7L3 16",
    "M3 21v-5h5",
  ],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0-2-2h-3l-2.5-3z",
    "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  ],
  send: ["M22 2 11 13", "M22 2 15 22l-4-9-9-4Z"],
  back: ["m15 18-6-6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  contrast: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "M12 18a6 6 0 0 0 0-12v12Z",
  ],
  sun: [
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M12 2v2",
    "M12 20v2",
    "m4.93 4.93 1.41 1.41",
    "m17.66 17.66 1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "m6.34 17.66-1.41 1.41",
    "m19.07 4.93-1.41 1.41",
  ],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  swipeRight: ["M5 12h14", "m12 5 7 7-7 7"],
  sliders: [
    "M21 4h-7",
    "M10 4H3",
    "M21 12h-9",
    "M8 12H3",
    "M21 20h-5",
    "M12 20H3",
    "M14 2v4",
    "M8 10v4",
    "M16 18v4",
  ],
  image: [
    "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z",
    "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21",
  ],
  file: [
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M10 9H8",
    "M16 13H8",
    "M16 17H8",
  ],
  download: [
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    "m7 10 5 5 5-5",
    "M12 15V3",
  ],
  upload: [
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    "m17 8-5-5-5 5",
    "M12 3v12",
  ],
  music: [
    "M9 18V5l12-2v13",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  film: [
    "M19.82 2H4.18A2.18 2.18 0 0 0 2 4.18v15.64A2.18 2.18 0 0 0 4.18 22h15.64A2.18 2.18 0 0 0 22 19.82V4.18A2.18 2.18 0 0 0 19.82 2Z",
    "M7 2v20",
    "M17 2v20",
    "M2 12h20",
    "M2 7h5",
    "M2 17h5",
    "M17 17h5",
    "M17 7h5",
  ],
  archive: ["M21 8v13H3V8", "M2 3h20v5H2Z", "M10 12h4"],
  trash: [
    "M3 6h18",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  ],
  x: ["M18 6 6 18", "m6 6 12 12"],
  check: ["M20 6 9 17l-5-5"],
  person: [
    "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
    "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  ],
  shield: [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    "m9 12 2 2 4-4",
  ],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"],
  zap: [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
  ban: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "m4.9 4.9 14.2 14.2",
  ],
  bug: [
    "m8 2 1.88 1.88",
    "M14.12 3.88 16 2",
    "M9 7.13v-1a3.003 3.003 0 1 1 6 0v1",
    "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z",
    "M12 20v-9",
    "M6.53 9C4.6 8.8 3 7.1 3 5",
    "M6 13H2",
    "M3 21c0-2.1 1.7-3.9 3.8-4",
    "M20.97 5c0 2.1-1.6 3.8-3.5 4",
    "M22 13h-4",
    "M17.2 17c2.1.1 3.8 1.9 3.8 4",
  ],
  bot: [
    "M12 8V4H8",
    "M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z",
    "M2 14h2",
    "M20 14h2",
    "M15 13v2",
    "M9 13v2",
  ],
  monitor: [
    "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M8 21h8",
    "M12 17v4",
  ],
  pin: [
    "M20 10c0 4.99-5.54 10.19-7.4 11.79a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0Z",
    "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
  eye: [
    "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0Z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  network: [
    "M12 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M5 2v4",
    "M19 2v4",
    "M5 16v6",
    "M19 16v6",
    "M7 4h10",
    "M12 9v4",
    "M7 20h10",
    "M5 6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2",
  ],
  cloud: [
    "M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 1.5A4 4 0 0 0 7 19Z",
  ],
  puzzle: [
    "M14 3.5V6a2 2 0 0 0 4 0h2.5a.5.5 0 0 1 .5.5V10a2 2 0 0 0 0 4H18a2 2 0 0 1-2 2h-2.5a.5.5 0 0 0-.5.5V21a.5.5 0 0 1-.5.5H10a2 2 0 0 1-2-2v-2.5a.5.5 0 0 0-.5-.5H4a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5H6a2 2 0 0 0 0-4V4a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 .5.5V5a2 2 0 0 0 4 0V3.5a.5.5 0 0 0-.5-.5Z",
  ],
  brain: [
    "M12 5a3 3 0 1 0-3-3 3 3 0 0 0-2 5 3 3 0 0 0-1 5.8V17a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5Z",
    "M12 5a3 3 0 1 1 3-3 3 3 0 0 1 2 5 3 3 0 0 1 1 5.8V17a3 3 0 0 1-3 3 3 3 0 0 1-3-3V5Z",
  ],
};

/* ---------------- avatars ---------------- */

/** Muse's script-m mark in a white circle, as in the reference. The
 * mark's colour is Muse's own avatar colour setting. An uploaded
 * avatar image, when set, replaces the mark. */
function MuseAvatar({
  size = 40,
  color = "#2f6bff",
  imageUrl = null,
}: {
  size?: number;
  color?: string;
  imageUrl?: string | null;
}) {
  if (imageUrl) {
    return (
      <span
        className="block shrink-0 overflow-hidden rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="font-bold italic"
        style={{
          color,
          fontSize: size * 0.52,
          lineHeight: 1,
          fontFamily: "Georgia, 'Times New Roman', serif",
          transform: "translateY(-1px)",
        }}
      >
        m
      </span>
    </span>
  );
}

/** An added agent's avatar: its uploaded avatar image when one
 * is set (image wins); otherwise the vendor's official logo for
 * a successfully set-up agent whose glyph/colour are still the
 * vendor preset (see vendorLogoFor); otherwise its configured
 * colour disc + glyph. */
function AgentAvatar({
  color,
  glyph,
  name,
  size = 40,
  imageUrl = null,
  logo = null,
}: {
  color: string;
  glyph: string;
  name: string;
  size?: number;
  imageUrl?: string | null;
  logo?: VendorLogo | null;
}) {
  if (imageUrl) {
    return (
      <span
        className="block shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  if (logo) {
    return (
      <span
        className="block shrink-0 overflow-hidden rounded-full ring-1 ring-black/[0.06]"
        style={{ width: size, height: size, backgroundColor: logo.bg }}
        aria-hidden="true"
      >
        <img
          src={logo.src}
          alt=""
          className="h-full w-full"
          style={{ objectFit: logo.fit }}
        />
      </span>
    );
  }
  const label = glyph || (name || "智").slice(0, 2);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: color || "#5d6a82" }}
      aria-hidden="true"
    >
      <span
        className="font-semibold"
        style={{
          fontSize: label.length > 1 ? size * 0.34 : size * 0.46,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </span>
  );
}

/** The user's own avatar: their profile colour disc with their
 * avatar glyph, or the neutral silhouette while no glyph is set
 * (the same mark the rail's bottom avatar has always shown). */
function UserAvatar({
  size = 40,
  profile,
}: {
  size?: number;
  profile?: Profile;
}) {
  const color = profile?.color || "#b9bec7";
  const glyph = (profile?.glyph ?? "").trim();
  if (profile?.avatarUrl) {
    return (
      <span
        className="block shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img
          src={profile.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden="true"
    >
      {glyph ? (
        <span
          className="font-semibold"
          style={{
            fontSize: glyph.length > 1 ? size * 0.34 : size * 0.46,
            lineHeight: 1,
          }}
        >
          {glyph}
        </span>
      ) : (
        <Icon d={PATHS.person} size={size * 0.58} filled />
      )}
    </span>
  );
}

/**
 * Group avatar. With no custom icon set it is the default mark —
 * users glyph in a soft blue tile, exactly as before. Once the group
 * settings panel saves a colour or glyph, it becomes a coloured disc
 * showing the glyph, or the group name's first character while no
 * glyph is set.
 */
function GroupAvatar({
  size = 44,
  title = "",
  iconColor = "",
  iconGlyph = "",
  iconImageUrl = null,
}: {
  size?: number;
  title?: string;
  iconColor?: string;
  iconGlyph?: string;
  iconImageUrl?: string | null;
}) {
  if (iconImageUrl) {
    return (
      <span
        className="block shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img src={iconImageUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  if (iconColor || iconGlyph) {
    const label = iconGlyph || (title || "群").slice(0, 2);
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: iconColor || "#5d6a82",
        }}
        aria-hidden="true"
      >
        <span
          className="font-semibold"
          style={{
            fontSize: label.length > 1 ? size * 0.34 : size * 0.46,
            lineHeight: 1,
          }}
        >
          {label}
        </span>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[#e8effd] text-[#2f6bff]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon d={PATHS.users} size={size * 0.52} />
    </span>
  );
}

/* ---------------- avatar image editing (settings panels) ---------------- */

type AvatarImagePayload = {
  dataBase64: string;
  mimeType: "image/jpeg" | "image/png";
};

/**
 * Draft state for one settings panel's avatar image: the saved
 * image's URL, a newly picked image (centre-cropped to a square
 * JPEG of at most 512px in the browser and previewed immediately),
 * or a removal. Nothing is uploaded until the panel saves — the
 * payload rides along with the panel's normal save action, and
 * removing restores the colour + glyph avatar.
 */
function useAvatarDraft(initialUrl: string | null) {
  const [savedUrl, setSavedUrl] = useState<string | null>(initialUrl);
  const [picked, setPicked] = useState<{
    previewUrl: string;
    payload: AvatarImagePayload;
  } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");

  const previewUrl = picked ? picked.previewUrl : removed ? null : savedUrl;

  function reset(url: string | null) {
    setSavedUrl(url);
    setPicked(null);
    setRemoved(false);
    setError("");
  }

  function pick(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("请选择一张图片文件");
      return;
    }
    setError("");
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const sw = Math.min(img.naturalWidth, img.naturalHeight);
        const side = Math.max(1, Math.min(sw, 512));
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const g = canvas.getContext("2d");
        if (!g) throw new Error("no 2d context");
        g.drawImage(
          img,
          (img.naturalWidth - sw) / 2,
          (img.naturalHeight - sw) / 2,
          sw,
          sw,
          0,
          0,
          side,
          side,
        );
        const dataBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
        if (!dataBase64) throw new Error("empty image");
        setPicked({
          previewUrl: objUrl,
          payload: { dataBase64, mimeType: "image/jpeg" },
        });
        setRemoved(false);
      } catch {
        URL.revokeObjectURL(objUrl);
        setError("这张图片处理失败，请换一张试试");
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      setError("这张图片读不出来，请换一张试试");
    };
    img.src = objUrl;
  }

  function remove() {
    setPicked(null);
    setRemoved(true);
    setError("");
  }

  return {
    previewUrl,
    image: picked?.payload ?? null,
    removed,
    error,
    pick,
    remove,
    reset,
  };
}

/**
 * The tappable big avatar at the top of a settings panel: tapping
 * it (or its camera badge) opens the system image picker; the
 * picked image previews in place at once and only takes effect
 * when the panel's save button is pressed. While an image is in
 * place, 「移除图片」 under it restores the colour + glyph avatar
 * on save. The fallback avatar (colour + glyph) is passed as
 * children and shows whenever no image is set.
 */
function AvatarEditor({
  size = 56,
  label,
  previewUrl,
  onPick,
  onRemove,
  children,
}: {
  size?: number;
  label: string;
  previewUrl: string | null;
  onPick: (f: File) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <button
        type="button"
        aria-label={label}
        onClick={() => inputRef.current?.click()}
        className="relative shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
      >
        {previewUrl ? (
          <span
            className="block overflow-hidden rounded-full"
            style={{ width: size, height: size }}
          >
            <img
              src={previewUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          </span>
        ) : (
          children
        )}
        <span
          className="absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#2f6bff] text-white ring-2 ring-white"
          aria-hidden="true"
        >
          <Icon d={PATHS.camera} size={11} />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      {previewUrl ? (
        <button
          type="button"
          onClick={onRemove}
          className="min-h-0 px-1 py-0.5 text-[11px] text-[#c0392b]"
        >
          移除图片
        </button>
      ) : (
        <span className="px-1 py-0.5 text-[11px] text-[#9a9aa0]">
          点头像换图
        </span>
      )}
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function GridIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function TypingBubble({
  agent,
  name,
  museColor = "#2f6bff",
  museAvatarUrl = null,
}: {
  agent: {
    name: string;
    color: string;
    glyph: string;
    avatarUrl?: string | null;
    provider?: string;
    connectionType?: string;
    configured?: boolean;
  } | null;
  name: string;
  museColor?: string;
  museAvatarUrl?: string | null;
}) {
  return (
    <div className="flex items-end gap-2">
      {agent ? (
        <AgentAvatar
          color={agent.color}
          glyph={agent.glyph}
          name={agent.name}
          size={36}
          imageUrl={agent.avatarUrl ?? null}
          logo={
            agent.provider && agent.connectionType
              ? vendorLogoFor({
                  provider: agent.provider,
                  connectionType: agent.connectionType,
                  glyph: agent.glyph,
                  color: agent.color,
                  configured: agent.configured ?? false,
                  avatarUrl: agent.avatarUrl ?? null,
                })
              : null
          }
        />
      ) : (
        <MuseAvatar size={36} color={museColor} imageUrl={museAvatarUrl} />
      )}
      <div>
        <p className="mb-1 pl-1 text-xs text-[#8a8a8a]">{name}</p>
        <div
          className="flex items-center gap-1 rounded-xl rounded-tl-sm bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          role="status"
          aria-label={`${name} 正在输入`}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-bounce rounded-full bg-[#b5b5b5]"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  name,
  size,
}: {
  name: string;
  size: number | null;
}) {
  return (
    <span className="mb-1 flex items-center gap-2 rounded-lg bg-black/[0.05] px-2.5 py-2">
      <span className="shrink-0 text-[#8a8a8a]">
        <Icon d={PATHS.file} size={22} />
      </span>
      <span className="min-w-0">
        <span className="block max-w-[190px] truncate text-[13px] text-[#191919]">
          {name}
        </span>
        <span className="block text-[11px] text-black/40">
          {formatSize(size)}
        </span>
      </span>
    </span>
  );
}

/**
 * Loads an image stored in the space's blob store for display.
 *
 * Why this loader is built the way it is — three display routes
 * were tried before it, and each failed on the user's phone
 * webview in a different way:
 *  1. The blob URL straight in <img src>: the blob route serves
 *     stored bytes with a CSP `sandbox` header (the platform
 *     keeps uploaded content inert) and the phone webview refuses
 *     to render such a response as an image at all.
 *  2. fetch → `blob:` object URL: inside the artifact's sandboxed
 *     iframe the page origin is opaque, and the phone webview
 *     refuses `blob:` image loads from an opaque origin too.
 *  3. fetch → FileReader data: URL of the ORIGINAL bytes: worked
 *     only intermittently — a generated photo is 1–5 MB, so the
 *     data URL is a multi-megabyte base64 string and the decoded
 *     bitmap tens of megabytes; the phone webview dropped the
 *     picture under that pressure ("shows for a few seconds, then
 *     gone"), and because every component instance fetched its
 *     own copy and ANY single failed fetch permanently fell back
 *     to route 1's unrenderable URL, once it was gone it never
 *     came back — no retry existed anywhere.
 *  4. fetch (shared + downscaled + retryable, the previous build)
 *     → data: URL: removed route 3's three failure drivers, yet
 *     the user's phone STILL could not load the pictures. Every
 *     variant of routes 1–4 shares one link the sandbox browser
 *     cannot fault: the client itself reaching the blob route.
 *     On the user's device, everything the app loads through its
 *     actions channel (rooms, messages, settings) works — only
 *     blob-route content has ever failed there.
 *
 *  5. actions channel, full original bytes (the previous build):
 *     the pictures finally showed, but every view of every image
 *     pulled the whole 1–4 MB original through the actions
 *     channel — a 44px file-list thumbnail cost the same ~5 MB
 *     base64 response as the full view. Rooms with several
 *     generated photos took tens of seconds to settle, the
 *     channel stayed saturated, and unrelated taps (adding an
 *     agent to a group) queued behind the image traffic and
 *     appeared to hang, with loads timing out as "加载失败".
 *
 * So the bytes still arrive through the actions channel, but the
 * server now downscales ONCE and caches the preview beside the
 * blob store: the `getPreviewImageData` action takes the variant
 * and returns a JPEG capped at the variant's size (thumb 360px,
 * full 1440px — a few tens / a few hundred KB instead of
 * megabytes). This loader decodes and caches exactly as route 4
 * did, and its own canvas downscale remains as a backstop for
 * the rare response that still carries original bytes (GIF/SVG
 * passthrough, or a server-side conversion failure fallback):
 *  - SHARED: one module-level cache keyed by URL + variant. Every
 *    thumbnail, bubble, detail and lightbox showing the same
 *    image shares ONE fetch and ONE resulting string; remounts
 *    (switching sections, reopening a room) render instantly
 *    from the cache instead of refetching megabytes.
 *  - SMALL: the fetched bitmap is downscaled on a canvas before
 *    encoding (thumbnails to 360px, full views to 1440px, JPEG
 *    0.85), so a 2.7 MB PNG becomes a few hundred KB of data URL
 *    and a proportionally small bitmap — far inside what the
 *    webview holds onto. Images already under the cap keep
 *    their original bytes untouched (no re-encode, PNG
 *    transparency preserved).
 *  - RECOVERABLE: a failed load retries with backoff inside the
 *    loader, failures are never cached, and every surface that
 *    shows a picture gets a failed state with a real retry
 *    action — a transient failure can no longer strand an image
 *    for the rest of the session.
 */
type PreviewVariant = "thumb" | "full";

const PREVIEW_MAX_DIM: Record<PreviewVariant, number> = {
  thumb: 360,
  full: 1440,
};

/** Finished preview data URLs, shared by every component. */
const previewDataCache = new Map<string, string>();
/** In-flight loads, so concurrent components share one fetch. */
const previewLoadsInFlight = new Map<string, Promise<string>>();

function previewCacheKey(url: string, variant: PreviewVariant): string {
  return `${variant}:${url}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("preview read failed"));
    reader.onerror = () =>
      reject(reader.error ?? new Error("preview read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Downscales an oversized fetched image to the variant's cap
 * and re-encodes it as JPEG; anything at or under the cap — and
 * any image the canvas path cannot handle — keeps its original
 * bytes via FileReader, exactly like the previous loader. */
async function downscaleBlobToDataUrl(
  blob: Blob,
  maxDim: number,
): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blobToDataUrl(blob);
  }
  try {
    const { width, height } = bitmap;
    if (Math.max(width, height) <= maxDim) {
      return await blobToDataUrl(blob);
    }
    const scale = maxDim / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return await blobToDataUrl(blob);
    // JPEG has no alpha: flatten onto white so a transparent
    // PNG does not turn black.
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** Gets one image's preview through the actions channel (see the
 * loader note above: the client never fetches the blob route
 * itself any more, and the server returns a variant-sized
 * downscale rather than the original bytes) and builds its
 * preview data URL, retrying transient failures with backoff. */
async function fetchPreviewDataUrl(
  url: string,
  variant: PreviewVariant,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await api.getPreviewImageData({ url, variant });
      const binary = atob(res.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: res.mimeType });
      if (!blob.type.startsWith("image/")) {
        throw new Error("preview action did not return an image");
      }
      return await downscaleBlobToDataUrl(blob, PREVIEW_MAX_DIM[variant]);
    } catch (e) {
      lastError = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("preview load failed");
}

/** Loads (or reuses) the preview data URL for one image +
 * variant. Successes are cached for the rest of the session;
 * failures are not, so the next mount — or an explicit retry —
 * tries again. */
function loadPreviewDataUrl(
  url: string,
  variant: PreviewVariant,
): Promise<string> {
  const key = previewCacheKey(url, variant);
  const cached = previewDataCache.get(key);
  if (cached) return Promise.resolve(cached);
  const flying = previewLoadsInFlight.get(key);
  if (flying) return flying;
  const p = fetchPreviewDataUrl(url, variant).then(
    (dataUrl) => {
      previewDataCache.set(key, dataUrl);
      previewLoadsInFlight.delete(key);
      return dataUrl;
    },
    (e: unknown) => {
      previewLoadsInFlight.delete(key);
      throw e;
    },
  );
  previewLoadsInFlight.set(key, p);
  return p;
}

/**
 * The display state of one stored image: `src` is the preview
 * data URL once loaded (instantly, when the shared cache already
 * holds it), `failed` marks a load that exhausted its retries —
 * callers render a retry affordance wired to `retry` — and
 * `onImgError` is for the <img> element itself: if the webview
 * still refuses a produced data URL, the cached copy is dropped
 * and the surface lands in the same retryable failed state
 * instead of sitting on a broken picture forever.
 */
function usePreviewImage(url: string | null, variant: PreviewVariant) {
  const [src, setSrc] = useState<string | null>(() =>
    url ? (previewDataCache.get(previewCacheKey(url, variant)) ?? null) : null,
  );
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      setFailed(false);
      return;
    }
    const cached = previewDataCache.get(previewCacheKey(url, variant));
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    loadPreviewDataUrl(url, variant).then(
      (dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url, variant, reloadTick]);
  const retry = useCallback(() => setReloadTick((t) => t + 1), []);
  const onImgError = useCallback(() => {
    if (url) previewDataCache.delete(previewCacheKey(url, variant));
    setSrc(null);
    setFailed(true);
  }, [url, variant]);
  return { src, failed, retry, onImgError };
}

/** The file list's row thumbnail: the image itself for image
 * files (the shared downscaled preview, see usePreviewImage),
 * the type icon tile for everything else, while the thumbnail
 * is loading, and when its load failed — tapping the row opens
 * the detail pane, whose full-size preview carries the retry. */
function FileThumb({ file }: { file: FileItem }) {
  const { src, onImgError } = usePreviewImage(
    file.isImage ? file.url : null,
    "thumb",
  );
  if (file.isImage && file.url && src) {
    return (
      <img
        src={src}
        alt=""
        onError={onImgError}
        className="h-11 w-11 shrink-0 rounded-[10px] object-cover"
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#f0f0f2] text-[#8a8a8a]">
      <Icon d={fileTypeIcon(file)} size={22} />
    </span>
  );
}

/** Full-screen image preview, opened by tapping an image in a
 * chat bubble or in the file detail pane. The picture renders
 * from the same shared preview loader as the inline previews;
 * the download button keeps the direct blob URL (a download is
 * not a render, so the serving headers do not matter there). A
 * failed load shows a retry button instead of a dead placeholder. */
function ImageLightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string | null;
  onClose: () => void;
}) {
  const { src, failed, retry, onImgError } = usePreviewImage(url, "full");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onClick={onClose}
      />
      {src ? (
        <img
          src={src}
          alt={name ?? "图片"}
          onError={onImgError}
          className="relative max-h-[92dvh] max-w-[94vw] object-contain"
        />
      ) : failed ? (
        <span className="relative flex flex-col items-center gap-3 text-[#9a9aa0]">
          <Icon d={PATHS.image} size={40} />
          <span className="text-sm text-white/70">图片加载失败</span>
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white"
          >
            重新加载
          </button>
        </span>
      ) : (
        <span className="relative text-[#9a9aa0]">
          <Icon d={PATHS.image} size={40} />
        </span>
      )}
      <div className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-3 flex gap-2">
        <a
          href={url}
          download={name ?? "image"}
          target="_blank"
          rel="noreferrer"
          aria-label="下载图片"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <Icon d={PATHS.download} size={19} />
        </a>
        <button
          type="button"
          aria-label="关闭预览"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <Icon d={PATHS.x} size={19} />
        </button>
      </div>
      {name && (
        <p className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 max-w-[90vw] -translate-x-1/2 truncate text-sm text-white/85">
          {name}
        </p>
      )}
    </div>
  );
}

function MessageRow({
  msg,
  profile,
  showUserName = false,
  showTime = true,
  museName = "Muse",
  museColor = "#2f6bff",
  museAvatarUrl = null,
  onPreviewImage,
}: {
  msg: ChatMessage;
  profile?: Profile;
  showUserName?: boolean;
  showTime?: boolean;
  museName?: string;
  museColor?: string;
  museAvatarUrl?: string | null;
  /** Opens the full-screen preview for this message's image. */
  onPreviewImage?: (url: string, name: string | null) => void;
}) {
  const time = hm(new Date(msg.createdAt));
  // The message's image (a photo the user sent, or one an agent
  // generated and the space collected): rendered from the shared
  // preview loader (see usePreviewImage) and tappable to open the
  // full-screen preview. While the bytes load, a neutral tile
  // holds the bubble's shape instead of a broken-image glyph; a
  // load that exhausted its retries becomes a retry tile, so a
  // picture can never be stranded for the rest of the session.
  const rawImageUrl = msg.imageUrl;
  const {
    src: imageSrc,
    failed: imageFailed,
    retry: retryImage,
    onImgError: onImageImgError,
  } = usePreviewImage(rawImageUrl, "full");
  const imageEl = rawImageUrl ? (
    imageSrc ? (
      <button
        type="button"
        aria-label="预览图片"
        onClick={() =>
          onPreviewImage?.(rawImageUrl, msg.attachment?.name ?? null)
        }
        className="mb-1 block max-w-full cursor-pointer p-0"
      >
        <img
          src={imageSrc}
          alt="图片"
          onError={onImageImgError}
          className="max-h-56 w-auto max-w-full rounded-lg object-contain"
        />
      </button>
    ) : imageFailed ? (
      <button
        type="button"
        aria-label="重新加载图片"
        onClick={retryImage}
        className="mb-1 flex h-40 w-56 max-w-full flex-col items-center justify-center gap-1.5 rounded-lg bg-black/[0.05] text-[#9a9aa0]"
      >
        <Icon d={PATHS.image} size={26} />
        <span className="text-xs">图片加载失败，点按重试</span>
      </button>
    ) : (
      <span className="mb-1 flex h-40 w-56 max-w-full items-center justify-center rounded-lg bg-black/[0.05] text-[#9a9aa0]">
        <Icon d={PATHS.image} size={26} />
      </span>
    )
  ) : null;
  // A video attachment plays inline in the bubble (a generated
  // video from a web agent arrives exactly this way); other
  // non-image files keep the file chip.
  const videoUrl =
    msg.attachment &&
    !msg.attachment.isImage &&
    msg.attachment.mimeType?.startsWith("video/") &&
    msg.attachment.url
      ? msg.attachment.url
      : null;
  const videoEl = videoUrl ? (
    <video
      src={videoUrl}
      controls
      preload="metadata"
      aria-label="视频"
      className="mb-1 max-h-64 w-full rounded-lg bg-black object-contain"
    />
  ) : null;
  // An audio attachment (a generated voice/music clip) plays
  // inline too; only the remaining types keep the file chip.
  const audioUrl =
    msg.attachment &&
    !msg.attachment.isImage &&
    msg.attachment.mimeType?.startsWith("audio/") &&
    msg.attachment.url
      ? msg.attachment.url
      : null;
  const audioEl = audioUrl ? (
    <audio
      src={audioUrl}
      controls
      preload="metadata"
      aria-label="音频"
      className="mb-1 w-[240px] max-w-full"
    />
  ) : null;
  const fileChip =
    msg.attachment && !msg.attachment.isImage && !videoUrl && !audioUrl ? (
      <AttachmentChip name={msg.attachment.name} size={msg.attachment.size} />
    ) : null;
  if (msg.role === "user") {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="flex max-w-[78%] flex-col items-end sm:max-w-[68%]">
          {showUserName && (
            <p className="mb-1 pr-1 text-xs text-[#8a8a8a]">
              {profile?.name || "我"}
            </p>
          )}
          <div className="rounded-xl rounded-tr-sm bg-[#95ec69] px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            {imageEl}
            {videoEl}
            {audioEl}
            {fileChip}
            {msg.content && (
              <p
                className={`text-[15px] leading-relaxed text-[#191919] ${
                  profile?.codeWrap === false
                    ? "whitespace-pre overflow-x-auto"
                    : "break-words whitespace-pre-wrap"
                }`}
              >
                {msg.content}
              </p>
            )}
            {showTime && (
              <p className="mt-0.5 text-right text-[10px] text-black/35">
                {time}
              </p>
            )}
          </div>
        </div>
        <UserAvatar size={36} profile={profile} />
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      {msg.agent ? (
        <AgentAvatar
          color={msg.agent.color}
          glyph={msg.agent.glyph}
          name={msg.agent.name}
          size={36}
          imageUrl={msg.agent.avatarUrl}
          logo={vendorLogoFor(msg.agent)}
        />
      ) : (
        <MuseAvatar size={36} color={museColor} imageUrl={museAvatarUrl} />
      )}
      <div className="flex max-w-[78%] flex-col items-start sm:max-w-[68%]">
        <p className="mb-1 pl-1 text-xs text-[#8a8a8a]">
          {msg.agent ? msg.agent.name : museName}
        </p>
        <div className="rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          {imageEl}
          {videoEl}
          {audioEl}
          {fileChip}
          {msg.content && (
            <p
              className={`text-[15px] leading-relaxed text-[#191919] ${
                profile?.codeWrap === false
                  ? "whitespace-pre overflow-x-auto"
                  : "break-words whitespace-pre-wrap"
              }`}
            >
              {msg.content}
            </p>
          )}
          {msg.streaming && (
            <p className="text-[15px] leading-relaxed text-[#191919]">
              {!msg.content && (
                <span className="text-[#9a9aa0]">正在生成…</span>
              )}
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-[#191919] align-[-2px]"
              />
            </p>
          )}
          {showTime && (
            <p className="mt-0.5 text-right text-[10px] text-black/30">{time}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- file detail pane (third column, 文件 section) ---------------- */

function DetailHeader({
  title,
  onBack,
  backAlwaysVisible = false,
}: {
  title: string;
  onBack: () => void;
  /** The VPN detail's back button stays visible at every width —
   * the user reported it missing from the detail page's top-left. */
  backAlwaysVisible?: boolean;
}) {
  return (
    <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-black/[0.05] px-3 pt-safe sm:px-4">
      <div className="flex h-12 items-center">
        <button
          type="button"
          aria-label="返回列表"
          onClick={onBack}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05] ${backAlwaysVisible ? "" : "md:hidden"}`}
        >
          <Icon d={PATHS.back} size={22} />
        </button>
      </div>
      <h2 className="pointer-events-none absolute left-1/2 max-w-[60%] -translate-x-1/2 truncate text-[16px] font-medium">
        {title}
      </h2>
      <div className="flex h-12 items-center" />
    </header>
  );
}

function FileDetail({
  file,
  hasFiles,
  codeWrap,
  onBack,
  onOpenChat,
  onDeleted,
  onPreviewImage,
}: {
  file: FileItem | null;
  hasFiles: boolean;
  /** The 外观 setting: long lines in the text preview wrap (true)
   * or stay on one line and scroll sideways (false). */
  codeWrap: boolean;
  onBack: () => void;
  onOpenChat: (f: FileItem) => void;
  onDeleted: () => void;
  /** Opens the full-screen preview for an image file. */
  onPreviewImage: (url: string, name: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const contentQuery = useQuery({
    queryKey: ["fileContent", file?.source, file?.id],
    queryFn: () =>
      api.getFileContent({
        source: file?.source ?? "upload",
        id: file?.id ?? 0,
      }),
    enabled: file != null && file.isText,
  });
  const accessMutation = useMutation({
    mutationFn: async (access: boolean) =>
      await api.setFileAgentAccess({
        source: file?.source ?? "upload",
        id: file?.id ?? 0,
        access,
      }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => setActionError("权限保存失败，请重试"),
  });
  const deleteMutation = useMutation({
    mutationFn: async () =>
      await api.deleteFile({
        source: file?.source ?? "upload",
        id: file?.id ?? 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onDeleted();
    },
    onError: () => setActionError("删除失败，请重试"),
  });
  // The big image preview loads through the shared preview
  // loader, exactly like the chat bubbles (see usePreviewImage),
  // and tapping it opens the full-screen preview. A failed load
  // shows a retry button in place of the picture.
  const imageUrl = file?.isImage ? file.url : null;
  const {
    src: previewSrc,
    failed: previewFailed,
    retry: retryPreview,
    onImgError: onPreviewImgError,
  } = usePreviewImage(imageUrl, "full");

  return (
    <>
      <DetailHeader title="文件详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {!file ? (
          <p className="py-16 text-center text-sm text-[#9a9aa0]">
            {hasFiles
              ? "从左侧列表选择一个文件，这里会显示它的预览和详情"
              : "暂无文件"}
          </p>
        ) : (
          <div className="mx-auto max-w-xl">
            {file.isImage && imageUrl ? (
              previewSrc ? (
                <button
                  type="button"
                  aria-label={`预览 ${file.name}`}
                  onClick={() => onPreviewImage(imageUrl, file.name)}
                  className="block w-full cursor-pointer p-0"
                >
                  <img
                    src={previewSrc}
                    alt={file.name}
                    onError={onPreviewImgError}
                    className="max-h-[50dvh] w-full rounded-xl object-contain shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
                  />
                </button>
              ) : previewFailed ? (
                <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl bg-black/[0.04] text-[#9a9aa0]">
                  <Icon d={PATHS.image} size={30} />
                  <p className="text-sm">图片加载失败</p>
                  <button
                    type="button"
                    onClick={retryPreview}
                    className="rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm font-medium text-[#191919]"
                  >
                    重新加载
                  </button>
                </div>
              ) : (
                <div className="flex h-48 w-full items-center justify-center rounded-xl bg-black/[0.04] text-[#9a9aa0]">
                  <Icon d={PATHS.image} size={30} />
                </div>
              )
            ) : file.mimeType?.startsWith("video/") && file.url ? (
              <video
                src={file.url}
                controls
                preload="metadata"
                aria-label={file.name}
                className="max-h-[50dvh] w-full rounded-xl bg-black object-contain shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
              />
            ) : file.mimeType?.startsWith("audio/") && file.url ? (
              <div className="rounded-xl bg-white px-4 py-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <audio
                  src={file.url}
                  controls
                  preload="metadata"
                  aria-label={file.name}
                  className="w-full"
                />
                <p className="max-w-full truncate pt-3 text-center text-sm text-[#191919]">
                  {file.name}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-white px-4 py-10 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <span className="text-[#8a8a8a]">
                  <Icon d={fileTypeIcon(file)} size={52} />
                </span>
                <p className="max-w-full truncate text-sm text-[#191919]">
                  {file.name}
                </p>
              </div>
            )}
            {file.isText && (
              <div className="mt-4 rounded-xl bg-white px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-sm font-medium">内容预览</p>
                {contentQuery.isPending ? (
                  <p className="pt-2 text-sm text-[#9a9aa0]">加载中…</p>
                ) : contentQuery.isError ? (
                  <p className="pt-2 text-sm text-[#c0392b]">
                    内容加载失败，请重试
                  </p>
                ) : contentQuery.data?.available ? (
                  <>
                    <pre
                      className={`max-h-[40dvh] overflow-y-auto overscroll-contain pt-2 font-sans text-[13px] leading-relaxed text-[#191919] ${
                        codeWrap
                          ? "whitespace-pre-wrap break-words"
                          : "whitespace-pre overflow-x-auto"
                      }`}
                    >
                      {contentQuery.data.content}
                    </pre>
                    {contentQuery.data.truncated && (
                      <p className="pt-2 text-xs text-[#9a9aa0]">
                        内容较长，这里只显示前一部分
                      </p>
                    )}
                  </>
                ) : (
                  <p className="pt-2 text-sm text-[#9a9aa0]">
                    {contentQuery.data?.reason ?? "这个文件的内容暂时无法读取"}
                  </p>
                )}
              </div>
            )}
            <dl className="mt-4 space-y-2 rounded-xl bg-white px-4 py-3.5 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">文件名</dt>
                <dd className="min-w-0 truncate text-right">{file.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">大小</dt>
                <dd>{formatSize(file.size)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">类型</dt>
                <dd className="min-w-0 truncate text-right">
                  {file.mimeType || "未知"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">来源</dt>
                <dd className="min-w-0 truncate text-right">
                  {file.source === "upload"
                    ? "文件栏上传"
                    : `聊天「${file.conversationTitle}」`}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">
                  {file.source === "upload" ? "上传时间" : "发送时间"}
                </dt>
                <dd>{fullTime(file.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">智能体访问</dt>
                <dd>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={file.agentAccess}
                    aria-label={`允许智能体访问 ${file.name}`}
                    disabled={accessMutation.isPending}
                    onClick={() =>
                      accessMutation.mutate(!file.agentAccess)
                    }
                    className={`relative h-5 w-9 min-h-0 shrink-0 rounded-full transition-colors ${
                      file.agentAccess ? "bg-[#34c759]" : "bg-black/[0.15]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        file.agentAccess ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </dd>
              </div>
            </dl>
            <p className="px-1 pt-2 text-xs leading-relaxed text-[#9a9aa0]">
              {file.agentAccess
                ? file.isText
                  ? "已开启：智能体能在对话里读取这个文件的内容，你要求修改时它会把改好的内容保存回来。"
                  : "已开启：智能体能在对话里看到这个文件的文件名、类型和大小（这类文件不读内容，也不能修改）。"
                : "已关闭：智能体看不到这个文件。"}
            </p>
            {actionError && (
              <p className="px-1 pt-2 text-sm text-[#c0392b]">{actionError}</p>
            )}
            <div className="mt-4 flex gap-2">
              {file.url ? (
                <a
                  href={file.url}
                  download={file.name}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white"
                >
                  <Icon d={PATHS.download} size={16} />
                  下载文件
                </a>
              ) : (
                <p className="flex-1 rounded-xl bg-black/[0.05] px-3 py-2.5 text-center text-sm text-[#9a9aa0]">
                  文件暂时不可用
                </p>
              )}
              {file.source === "chat" && (
                <button
                  type="button"
                  onClick={() => onOpenChat(file)}
                  className="flex-1 rounded-xl bg-white px-3 py-2.5 text-sm font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                >
                  在聊天中打开
                </button>
              )}
            </div>
            {confirmDelete ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex-1 rounded-xl bg-[#e5484d] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  确认删除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-xl bg-white px-3 py-2.5 text-sm font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-[#c0392b] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
              >
                <Icon d={PATHS.trash} size={15} />
                删除文件
                {file.source === "chat" ? "（聊天里的这条文件消息也会删掉）" : ""}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- Pioneer VPN: middle column ---------------- */

function usePioneerState() {
  return useQuery({
    queryKey: ["pioneer"],
    queryFn: () => api.pioneerGetState({}),
  });
}

/** Status pill: green dot + region when the tunnel is verified up. */
function VpnPill({ pioneer }: { pioneer: PioneerState }) {
  const connected = pioneer.tunnel?.state === "connected";
  const label = connected
    ? pioneer.selectedName.replace(/^中国/, "") ||
      pioneer.tunnel?.exitCountry ||
      "已连接"
    : "代理";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-[#191919]">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${connected ? "bg-[#28c840]" : "bg-[#b9bec7]"}`}
      />
      {label}
    </span>
  );
}

function VpnColumn({
  search,
  onOpenDetail,
}: {
  search: string;
  onOpenDetail: () => void;
}) {
  const queryClient = useQueryClient();
  const pioneerQuery = usePioneerState();
  const pioneer = pioneerQuery.data;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pioneer"] });
    queryClient.invalidateQueries({ queryKey: ["pioneerLogs"] });
  };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [customHost, setCustomHost] = useState("");
  const [note, setNote] = useState("");
  const [noteOk, setNoteOk] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [serversCollapsed, setServersCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vpn-servers-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleServersCollapsed = () =>
    setServersCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("vpn-servers-collapsed", next ? "1" : "0");
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return next;
    });

  useEffect(() => {
    if (pioneer?.username) setUsername((u) => u || pioneer.username);
  }, [pioneer?.username]);
  useEffect(() => {
    if (pioneer?.customHost) setCustomHost((h) => h || pioneer.customHost);
  }, [pioneer?.customHost]);

  const loginMut = useMutation({
    mutationFn: async () =>
      await api.pioneerLogin({
        username: username.trim(),
        password,
        customHost: customHost.trim(),
      }),
    onSuccess: (r) => {
      invalidate();
      if (r.ok) {
        setNote(r.detail);
        setNoteOk(true);
        setPassword("");
      } else {
        setNote(r.error);
        setNoteOk(false);
      }
    },
    onError: () => {
      setNote("登录请求未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const fetchMut = useMutation({
    mutationFn: async () => await api.pioneerFetchServers({}),
    onSuccess: (r) => {
      invalidate();
      if (r.ok) {
        setNote(`已重新识别服务器列表，共 ${r.count} 个地区`);
        setNoteOk(true);
      } else {
        setNote(r.error);
        setNoteOk(false);
      }
    },
    onError: () => {
      setNote("识别服务器列表未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const logoutMut = useMutation({
    mutationFn: async (forget: boolean) => await api.pioneerLogout({ forget }),
    onSuccess: () => {
      invalidate();
      setConfirmLogout(false);
      setNote("");
      setPassword("");
    },
    onError: () => {
      setNote("退出登录未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const selectMut = useMutation({
    mutationFn: async (countryId: number) =>
      await api.pioneerSelectServer({ countryId }),
    onSuccess: (r) => {
      invalidate();
      if (r.ok && r.node) {
        const base = `已连接服务器「${r.node.name || r.node.country || ""}」，节点地址 ${r.node.host || "—"}${r.node.ips.length ? `，IP ${r.node.ips.join("、")}` : ""}`;
        if (r.tunnel && r.tunnel.state === "connected") {
          setNote(`${base}；Trojan 隧道已建立，真实出口 IP ${r.tunnel.exitIp}`);
          setNoteOk(true);
        } else if (r.tunnel) {
          setNote(`${base}；但隧道未建立：${r.tunnel.error}`);
          setNoteOk(false);
        } else {
          setNote(base);
          setNoteOk(true);
        }
      } else {
        setNote(r.error);
        setNoteOk(false);
      }
    },
    onError: () => {
      setNote("选择服务器未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const disconnectMut = useMutation({
    mutationFn: async () => await api.pioneerDisconnectServer({}),
    onSuccess: () => {
      invalidate();
      setNote("已断开服务器，隧道已停止，帐号仍保持登录");
      setNoteOk(true);
    },
    onError: () => {
      setNote("断开服务器未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const globalModeMut = useMutation({
    mutationFn: async (enabled: boolean) =>
      await api.pioneerSetGlobalMode({ enabled }),
    onSuccess: (r) => {
      invalidate();
      if (r.globalMode) {
        setNote(
          pioneer?.tunnel?.state === "connected"
            ? "全局模式已开启，智能体请求将经 VPN 隧道发送"
            : "全局模式已开启；VPN 未连接时暂不生效，连接后自动经隧道发送",
        );
      } else {
        setNote("全局模式已关闭，智能体请求恢复直连");
      }
      setNoteOk(true);
    },
    onError: () => {
      setNote("全局模式设置未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  // IP purity lives in this panel (above 重新识别服务器列表）, not in
  // the connection detail, and it runs in both states: connected it
  // tests the tunnel exit, disconnected it tests the direct egress.
  const [purity, setPurity] = useState<IpPurity | null>(null);
  const purityMut = useMutation({
    mutationFn: async () => await api.pioneerTestIpPurity({}),
    onSuccess: (r) => {
      setPurity(r);
      queryClient.invalidateQueries({ queryKey: ["pioneerLogs"] });
    },
    onError: () =>
      setPurity({
        ok: false,
        error: "无法检测：测试请求未能完成，请稍后重试",
        result: null,
      }),
  });

  if (pioneerQuery.isPending) {
    return <p className="px-5 py-6 text-sm text-[#9a9aa0]">加载中…</p>;
  }
  if (pioneerQuery.isError || !pioneer) {
    return (
      <div className="px-5 py-6">
        <p className="text-sm text-[#c0392b]">VPN 状态加载失败</p>
        <button
          type="button"
          onClick={() => pioneerQuery.refetch()}
          className="mt-2 rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm"
        >
          重试
        </button>
      </div>
    );
  }

  const selectingId = selectMut.isPending ? (selectMut.variables ?? 0) : 0;
  const q = search.trim().toLowerCase();
  const servers = pioneer.servers.filter(
    (sv) => !q || sv.name.toLowerCase().includes(q),
  );
  const inputCls =
    "w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm outline-none placeholder:text-[#9a9aa0]";
  const labelCls = "mb-1 block text-xs font-medium text-[#6e6e73]";

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between pt-1">
        <VpnPill pioneer={pioneer} />
        {pioneer.loggedIn && (
          <span className="max-w-[55%] truncate text-xs text-[#9a9aa0]">
            {pioneer.account}
          </span>
        )}
      </div>

      {note ? (
        <p
          role="status"
          className={`mt-2 text-[13px] leading-relaxed ${noteOk ? "text-[#3d7a1e]" : "text-[#c0392b]"}`}
        >
          {note}
        </p>
      ) : null}
      {!pioneer.loggedIn && pioneer.status === "error" && pioneer.error && !note ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[#c0392b]">
          上次登录失败：{pioneer.error}
        </p>
      ) : null}

      {pioneer.loggedIn ? (
        <>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#9a9aa0]">帐号类型</dt>
              <dd>
                {pioneer.userType === "free"
                  ? "免费版（free）"
                  : pioneer.userType || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#9a9aa0]">到期时间</dt>
              <dd>{pioneer.dueTime || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#9a9aa0]">已连接服务器</dt>
              <dd className="min-w-0 truncate">
                {pioneer.selectedName || "尚未连接"}
              </dd>
            </div>
          </dl>

          <div className="mt-3 rounded-xl bg-black/[0.03] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">全局模式</span>
              <SettingsSwitch
                checked={pioneer.globalMode}
                label="全局模式"
                onToggle={() => globalModeMut.mutate(!pioneer.globalMode)}
              />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-[#9a9aa0]">
              {pioneer.globalMode
                ? pioneer.tunnel?.state === "connected"
                  ? `已开启 · 智能体的请求经 VPN 隧道发送（出口 ${pioneer.tunnel.exitIp || "—"}）`
                  : "已开启 · VPN 未连接，暂未生效，智能体请求仍为直连"
                : "开启后，智能体的全部请求（API 与网页版）改经 VPN 隧道发送，出口变为所连节点"}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleServersCollapsed}
            aria-expanded={!serversCollapsed}
            aria-label={serversCollapsed ? "展开服务器地区列表" : "折叠隐藏服务器地区列表"}
            className="mt-4 mb-1 flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-xs font-medium text-[#6e6e73]">
              服务器列表（地区）· 点击连接，再次点击断开
              <span className="ml-1 font-normal text-[#9a9aa0]">
                共 {pioneer.servers.length} 个
                {pioneer.serversUpdatedAt
                  ? ` · 识别于 ${fullTime(pioneer.serversUpdatedAt)}`
                  : ""}
              </span>
            </span>
            <span className="shrink-0 text-[#9a9aa0]">
              <Icon
                d={serversCollapsed ? PATHS.chevronDown : PATHS.chevronUp}
                size={16}
              />
            </span>
          </button>
          {!serversCollapsed && (
            <>
          {pioneer.servers.length === 0 ? (
            <p className="py-3 text-sm text-[#9a9aa0]">
              尚未识别到服务器列表，点击下方按钮重新识别。
            </p>
          ) : servers.length === 0 ? (
            <p className="py-3 text-sm text-[#9a9aa0]">没有匹配的地区</p>
          ) : (
            <ul className="divide-y divide-black/[0.05]">
              {servers.map((sv) => {
                const selected = sv.id === pioneer.selectedId;
                const selecting = selectingId === sv.id;
                const disconnecting = selected && disconnectMut.isPending;
                return (
                  <li key={sv.id}>
                    <button
                      type="button"
                      disabled={
                        selectMut.isPending || disconnectMut.isPending
                      }
                      onClick={() =>
                        selected
                          ? disconnectMut.mutate()
                          : selectMut.mutate(sv.id)
                      }
                      aria-label={
                        selected ? `断开服务器 ${sv.name}` : `连接服务器 ${sv.name}`
                      }
                      aria-pressed={selected}
                      className={`flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm disabled:opacity-60 ${
                        selected ? "font-medium text-[#2f6bff]" : ""
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
                            selected
                              ? "border-[#2f6bff] bg-[#2f6bff] text-white"
                              : "border-black/20 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="truncate">{sv.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-[#9a9aa0]">
                        {selecting
                          ? "正在连接节点…"
                          : disconnecting
                            ? "正在断开…"
                            : selected
                              ? "已连接 · 再点断开"
                              : `#${sv.id}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
            </>
          )}

          {pioneer.selectedId !== 0 && (
            <button
              type="button"
              onClick={onOpenDetail}
              className="mt-3 w-full rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm font-medium md:hidden"
            >
              查看连接详情（节点与出口）
            </button>
          )}

          <IpPuritySection
            purity={purity}
            pending={purityMut.isPending}
            onTest={() => purityMut.mutate()}
          />

          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={fetchMut.isPending}
              onClick={() => fetchMut.mutate()}
              aria-label="重新识别 Pioneer 服务器列表"
              className="w-full rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {fetchMut.isPending ? "识别中…" : "重新识别服务器列表"}
            </button>
            {confirmLogout ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={logoutMut.isPending}
                  onClick={() => logoutMut.mutate(false)}
                  aria-label="确认退出 Pioneer 登录"
                  className="flex-1 rounded-xl bg-[#e5484d] px-3 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  确认退出
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmLogout(false)}
                  className="flex-1 rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                aria-label="退出 Pioneer 登录"
                className="w-full rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm text-[#c0392b]"
              >
                退出登录
              </button>
            )}
            {confirmLogout && (
              <button
                type="button"
                disabled={logoutMut.isPending}
                onClick={() => logoutMut.mutate(true)}
                aria-label="退出 Pioneer 并清除已保存的帐号密码"
                className="w-full py-1 text-center text-xs text-[#c0392b]"
              >
                退出并清除已保存的帐号密码
              </button>
            )}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#9a9aa0]">
            点击地区即连接，再次点击已连接的地区即断开：断开会停止隧道并清除所选节点，帐号保持登录。连接时服务端按 Pioneer 官方客户端相同的方式请求该地区的节点；节点由 Pioneer 每次连接时分配，无法自选节点编号。
          </p>
        </>
      ) : (
        <div className="pt-3">
          <label className={labelCls} htmlFor="pioneer-username">
            Pioneer 帐号（邮箱）
          </label>
          <input
            id="pioneer-username"
            {...FIELDS.pioneerLogin.username}
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入 Pioneer 帐号邮箱"
            autoComplete="off"
            spellCheck={false}
          />
          <label className={`${labelCls} mt-3`} htmlFor="pioneer-password">
            密码
          </label>
          <input
            id="pioneer-password"
            {...FIELDS.pioneerLogin.password}
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              pioneer.hasPassword
                ? "已保存，不显示；留空则使用已保存的密码"
                : "请输入 Pioneer 帐号密码"
            }
            autoComplete="off"
          />
          <label className={`${labelCls} mt-3`} htmlFor="pioneer-host">
            服务地址（可选）
          </label>
          <input
            id="pioneer-host"
            {...FIELDS.pioneerLogin.customHost}
            className={inputCls}
            value={customHost}
            onChange={(e) => setCustomHost(e.target.value)}
            placeholder="留空自动使用 Pioneer 官方服务地址"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={
              loginMut.isPending ||
              username.trim() === "" ||
              (password === "" && !pioneer.hasPassword)
            }
            onClick={() => loginMut.mutate()}
            aria-label="登录 Pioneer 并识别服务器列表"
            className="mt-4 w-full rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loginMut.isPending ? "正在向 Pioneer 服务器验证…" : "登录并识别服务器列表"}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
            帐号与密码仅存储于服务端，不会下发到页面。登录后服务端会按 Pioneer 官方客户端相同的协议直连 Pioneer 服务器验证，并立即识别其服务器列表。
          </p>
        </div>
      )}
      <VpnLogSection />
      <p className="mt-4 border-t border-black/[0.05] pt-3 text-[11px] leading-relaxed text-[#9a9aa0]">
        VPN 只影响本空间服务端的出口，不改变 Muse 应用和您设备的 IP。
      </p>
    </div>
  );
}

/** The VPN log section of the Pioneer panel: the newest recorded
 * events (login, connect, disconnect, global mode, purity tests)
 * with their real outcomes, newest first. Collapsible like the
 * server list, with the state persisted; 清空 wipes the log after
 * a second tap confirms. */
const VPN_LOG_KIND_META: Record<string, { label: string; dot: string }> = {
  login: { label: "登录", dot: "bg-[#2f6bff]" },
  logout: { label: "退出", dot: "bg-[#9a9aa0]" },
  servers: { label: "服务器", dot: "bg-[#9a9aa0]" },
  connect: { label: "连接", dot: "bg-[#34c759]" },
  disconnect: { label: "断开", dot: "bg-[#9a9aa0]" },
  global: { label: "全局模式", dot: "bg-[#2f6bff]" },
  test: { label: "纯净度测试", dot: "bg-[#e8a13a]" },
};

function VpnLogSection() {
  const queryClient = useQueryClient();
  const logsQuery = useQuery({
    queryKey: ["pioneerLogs"],
    queryFn: () => api.pioneerGetLogs({}),
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vpn-logs-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("vpn-logs-collapsed", next ? "1" : "0");
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return next;
    });
  const [confirmClear, setConfirmClear] = useState(false);
  const clearMut = useMutation({
    mutationFn: async () => await api.pioneerClearLogs({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pioneerLogs"] });
      setConfirmClear(false);
    },
    onError: () => setConfirmClear(false),
  });
  const logs = logsQuery.data?.logs ?? [];

  return (
    <section className="mt-4">
      <div className="mb-1 flex w-full items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开 VPN 日志" : "折叠隐藏 VPN 日志"}
          className="flex min-w-0 items-center justify-between gap-2 text-left"
        >
          <span className="text-xs font-medium text-[#6e6e73]">
            VPN 日志
            <span className="ml-1 font-normal text-[#9a9aa0]">
              最近 {logs.length} 条
            </span>
          </span>
          <span className="shrink-0 text-[#9a9aa0]">
            <Icon d={collapsed ? PATHS.chevronDown : PATHS.chevronUp} size={16} />
          </span>
        </button>
        {logs.length > 0 &&
          (confirmClear ? (
            <button
              type="button"
              disabled={clearMut.isPending}
              onClick={() => clearMut.mutate()}
              aria-label="确认清空 VPN 日志"
              className="shrink-0 text-xs font-medium text-[#c0392b] disabled:opacity-50"
            >
              确认清空
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              aria-label="清空 VPN 日志"
              className="shrink-0 text-xs text-[#9a9aa0]"
            >
              清空
            </button>
          ))}
      </div>
      {!collapsed &&
        (logsQuery.isPending ? (
          <p className="py-3 text-sm text-[#9a9aa0]">加载中…</p>
        ) : logsQuery.isError ? (
          <div className="py-3">
            <p className="text-sm text-[#c0392b]">日志加载失败</p>
            <button
              type="button"
              onClick={() => logsQuery.refetch()}
              className="mt-2 rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm"
            >
              重试
            </button>
          </div>
        ) : logs.length === 0 ? (
          <p className="py-3 text-sm text-[#9a9aa0]">暂无日志记录</p>
        ) : (
          <ul className="max-h-80 divide-y divide-black/[0.05] overflow-y-auto overscroll-contain">
            {logs.map((log: PioneerLog) => {
              const meta = VPN_LOG_KIND_META[log.kind] ?? {
                label: "记录",
                dot: "bg-[#9a9aa0]",
              };
              const failed = /失败|未建立|未连接/.test(log.message);
              return (
                <li key={log.id} className="flex gap-2 py-2">
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${failed ? "bg-[#e5484d]" : meta.dot}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed break-words">
                      {log.message}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#9a9aa0]">
                      {meta.label} · {fullTime(log.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

/* ---------------- IP purity: badges, local checks, section ---------------- */

type FlagState = boolean | null; // true = 检出， false = 未检出， null = 未检测

/** One rounded icon badge in the reference style: green = pass /
 * not detected, red = detected / risk, grey = not measured. */
function FlagBadge({
  icon,
  label,
  state,
  trueText,
  falseText,
}: {
  icon: string[];
  label: string;
  state: FlagState | "unknown";
  trueText: string;
  falseText: string;
}) {
  const cls =
    state === true
      ? "border-[#f3c1bd] bg-[#fce8e6] text-[#b3261e]"
      : state === false
        ? "border-[#bfe3c0] bg-[#e6f4ea] text-[#137333]"
        : "border-black/[0.08] bg-black/[0.04] text-[#8a8a8a]";
  const text =
    state === true ? trueText : state === false ? falseText : "未检测";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium ${cls}`}
    >
      <Icon d={icon} size={15} />
      {label} {text}
    </span>
  );
}

type LocalChecks = {
  localTz: string;
  localOffsetSec: number;
  tzNameMatch: boolean | null;
  tzOffsetMatch: boolean | null;
  lang: string;
  langRegion: string;
  langMatch: boolean | null;
  webrtcIp: string | null;
  webrtcDone: boolean;
};

/** Formats a UTC offset in seconds as +08:00 / -05:30. */
function fmtUtcOffset(sec: number): string {
  const sign = sec < 0 ? "-" : "+";
  const abs = Math.abs(sec);
  const h = String(Math.floor(abs / 3600)).padStart(2, "0");
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * Runs the real client-side checks once per purity result, all of
 * them genuinely measurable in the browser: local timezone name and
 * UTC offset vs the IP's, browser language region vs the IP's
 * country, and a WebRTC srflx probe of the device's public address
 * vs the exit IP. A check that cannot be determined for a given run
 * stays null and its badge is simply not rendered — no placeholder.
 */
function useLocalChecks(result: IpPurity["result"]) {
  const [checks, setChecks] = useState<LocalChecks | null>(null);
  const key = result ? `${result.ip}|${result.checkedAt}` : "";
  useEffect(() => {
    if (!result) {
      setChecks(null);
      return;
    }
    let cancelled = false;
    const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const localOffsetSec = -new Date().getTimezoneOffset() * 60;
    const tzNameMatch =
      result.timezone && clientTz ? clientTz === result.timezone : null;
    const tzOffsetMatch =
      result.tzOffsetSec !== null ? localOffsetSec === result.tzOffsetSec : null;
    const lang = navigator.language || "";
    let langRegion = "";
    try {
      langRegion = new Intl.Locale(lang).region ?? "";
    } catch {
      langRegion = lang.split("-")[1]?.toUpperCase() ?? "";
    }
    const langMatch =
      langRegion && result.countryCode
        ? langRegion === result.countryCode
        : null;
    const base: LocalChecks = {
      localTz: clientTz,
      localOffsetSec,
      tzNameMatch,
      tzOffsetMatch,
      lang,
      langRegion,
      langMatch,
      webrtcIp: null,
      webrtcDone: false,
    };
    setChecks(base);
    // WebRTC probe: gather one srflx candidate (the browser's real
    // public address as seen by a public STUN server). No candidate
    // within the timeout = 未检测， never a guessed verdict.
    let pc: RTCPeerConnection | null = null;
    const timer = setTimeout(() => {
      if (!cancelled) setChecks((c) => (c ? { ...c, webrtcDone: true } : c));
      try { pc?.close(); } catch { /* noop */ }
    }, 3000);
    try {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pc.createDataChannel("probe");
      pc.onicecandidate = (ev) => {
        const cand = ev.candidate?.candidate ?? "";
        const m = cand.match(/srflx.*?(\d{1,3}(?:\.\d{1,3}){3})/);
        if (m && !cancelled) {
          clearTimeout(timer);
          setChecks((c) =>
            c ? { ...c, webrtcIp: m[1] ?? null, webrtcDone: true } : c,
          );
          try { pc?.close(); } catch { /* noop */ }
        }
      };
      void pc
        .createOffer()
        .then((o) => pc?.setLocalDescription(o))
        .catch(() => {});
    } catch {
      clearTimeout(timer);
      if (!cancelled) setChecks((c) => (c ? { ...c, webrtcDone: true } : c));
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { pc?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return checks;
}

const RISK_SEGMENTS = [
  { grade: "A+", to: 8, color: "#0e8a3c" },
  { grade: "A", to: 26, color: "#22a44a" },
  { grade: "B", to: 45, color: "#8bc34a" },
  { grade: "C", to: 65, color: "#f2c418" },
  { grade: "D", to: 85, color: "#ef7d1a" },
  { grade: "F", to: 100, color: "#d92d20" },
];

function IpPuritySection({
  purity,
  pending,
  onTest,
}: {
  purity: IpPurity | null;
  pending: boolean;
  onTest: () => void;
}) {
  const [showExplain, setShowExplain] = useState(false);
  // Collapsible like the server list above it: default expanded,
  // the state persists across refreshes in localStorage.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vpn-purity-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const persistCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem("vpn-purity-collapsed", next ? "1" : "0");
    } catch {
      // storage unavailable — the toggle still works for this session
    }
  };
  // The test button lives on the title row and works while
  // collapsed; running a test always expands to show the result.
  const handleTest = () => {
    if (collapsed) persistCollapsed(false);
    onTest();
  };
  const result = purity?.result ?? null;
  const checks = useLocalChecks(result);
  const score = result?.riskScore ?? null;
  // Timezone consistency prefers the IANA name comparison and falls
  // back to the UTC-offset comparison; WebRTC leak = the browser's
  // real srflx public address differs from the tested exit IP (the
  // VPN tunnel here is server-side, so a different real address is
  // an honest 不一致）. Either stays null — and renders no badge —
  // when it cannot actually be measured for this run.
  const tzConsistent = checks
    ? (checks.tzNameMatch ?? checks.tzOffsetMatch)
    : null;
  const webrtcMismatch =
    checks?.webrtcIp && result ? checks.webrtcIp !== result.ip : null;
  return (
    <section
      aria-label="IP 纯净度测试"
      className="mt-4 rounded-xl bg-white px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => persistCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开 IP 纯净度测试" : "折叠隐藏 IP 纯净度测试"}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
        >
          <span className="shrink-0 text-[#137333]">
            <Icon d={PATHS.shield} size={17} />
          </span>
          <span className="flex-1">IP 纯净度测试</span>
          <span className="shrink-0 text-[#9a9aa0]">
            <Icon
              d={collapsed ? PATHS.chevronDown : PATHS.chevronUp}
              size={16}
            />
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleTest}
          aria-label="测试当前出口 IP 纯净度"
          className="shrink-0 rounded-lg bg-[#2f6bff] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {pending ? "正在查询…" : purity ? "重新测试" : "测试"}
        </button>
      </div>
      {!collapsed && purity && !purity.ok && (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-[#fdecec] px-3 py-2 text-[13px] leading-relaxed text-[#b3261e]"
        >
          无法检测：{purity.error}
        </p>
      )}
      {!collapsed && result && (
        <div className="mt-3 space-y-4">
          {/* 1. IP 风险评分 */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">IP 风险评分</p>
              <button
                type="button"
                onClick={() => setShowExplain((v) => !v)}
                aria-expanded={showExplain}
                className="shrink-0 text-[13px] text-[#137333]"
              >
                风险系数值说明
              </button>
            </div>
            {showExplain && (
              <p className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2 text-[12px] leading-relaxed text-[#6e6e73]">
                分数由查询到的真实标记按固定公式算出：基础 5 分，被标记为代理 +70、托管机房
                +35、移动网络 +10，满分 100。0–8 为 A+（极低风险）、9–26 为 A、27–45 为
                B、46–65 为 C、66–85 为 D、86–100 为 F。代理或机房标记缺失时不评分，显示「未评估」。
              </p>
            )}
            {score !== null ? (
              <>
                <p className="mt-2">
                  <span
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] font-bold text-white"
                    style={{
                      backgroundColor:
                        RISK_SEGMENTS.find((s) => s.grade === result.riskGrade)
                          ?.color ?? "#0e8a3c",
                    }}
                  >
                    {result.riskGrade} · {score}% {result.riskLabel}
                  </span>
                </p>
                <div
                  className="mt-3 flex overflow-hidden rounded-md"
                  role="img"
                  aria-label={`风险评分 ${score} 分，等级 ${result.riskGrade}`}
                >
                  {RISK_SEGMENTS.map((s, i) => {
                    const from = i === 0 ? 0 : (RISK_SEGMENTS[i - 1]?.to ?? 0);
                    return (
                      <span
                        key={s.grade}
                        className="py-1 text-center text-[11px] font-semibold text-white"
                        style={{
                          width: `${s.to - from}%`,
                          backgroundColor: s.color,
                          outline:
                            result.riskGrade === s.grade
                              ? "2px solid rgba(0,0,0,0.45)"
                              : undefined,
                          outlineOffset: -2,
                        }}
                      >
                        {s.grade}
                      </span>
                    );
                  })}
                </div>
                <div className="relative mt-1 h-4 text-[11px] text-[#9a9aa0]">
                  {[0, 8, 26, 45, 65, 85, 100].map((n) => (
                    <span
                      key={n}
                      className="absolute -translate-x-1/2"
                      style={{ left: `${n}%` }}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 inline-flex rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm font-medium text-[#8a8a8a]">
                未评估（来源未提供代理 / 机房标记）
              </p>
            )}
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">测试出口</dt>
                <dd className="text-right font-medium">{result.exitLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">出口 IP</dt>
                <dd className="break-all text-right font-medium">{result.ip}</dd>
              </div>
              {result.ipSegment && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-[#9a9aa0]">IP 段</dt>
                  <dd className="break-all text-right">{result.ipSegment}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">归属地</dt>
                <dd className="text-right">
                  {[result.country, result.region, result.city]
                    .filter((x) => x !== "")
                    .join(" · ") || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">运营商</dt>
                <dd className="break-all text-right">{result.isp || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">组织</dt>
                <dd className="break-all text-right">{result.org || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">ASN</dt>
                <dd className="break-all text-right">
                  {result.asn || "—"}
                  {result.asname ? `（${result.asname}）` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">IP 类型</dt>
                <dd>{result.ipType}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">IP 时区</dt>
                <dd>
                  {result.timezone || "—"}
                  {result.timezone && result.tzOffsetSec !== null
                    ? `（UTC${fmtUtcOffset(result.tzOffsetSec)}）`
                    : ""}
                </dd>
              </div>
              {result.lat !== null && result.lon !== null && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-[#9a9aa0]">经纬度</dt>
                  <dd>
                    {result.lat.toFixed(4)}, {result.lon.toFixed(4)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">IPv6</dt>
                <dd className="break-all text-right">
                  {result.ipv6Supported
                    ? `支持 · ${result.ipv6Address}`
                    : "不支持"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-[#9a9aa0]">综合结论</dt>
                <dd className="font-medium">{result.verdict}</dd>
              </div>
            </dl>
          </div>

          {/* 2. 原生 IP — only rendered when the source's flags
              actually allow the judgement. */}
          {result.nativeIp !== null && (
            <div className="flex items-center justify-between gap-3 border-t border-black/[0.05] pt-3">
              <p className="text-sm font-medium">原生 IP</p>
              <span
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${
                  result.nativeIp
                    ? "border-[#bfe3c0] bg-[#e6f4ea] text-[#137333]"
                    : "border-[#f3c1bd] bg-[#fce8e6] text-[#b3261e]"
                }`}
              >
                {result.nativeIp ? "原生 IP" : "非原生 IP"}
              </span>
            </div>
          )}

          {/* 3. 代理检测 — the proxy flag is the one risk flag the
              real source publishes; it renders only when present. */}
          {result.proxy !== null && (
            <div className="border-t border-black/[0.05] pt-3">
              <p className="text-sm font-medium">代理检测</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <FlagBadge icon={PATHS.network} label="代理" state={result.proxy} trueText="检出" falseText="未检出" />
              </div>
            </div>
          )}

          {/* 4. 本机一致性实测 — every badge here is measured in
              this browser; a badge that cannot be determined for
              this run is not rendered at all. */}
          <div className="border-t border-black/[0.05] pt-3">
            <p className="text-sm font-medium">本机一致性实测</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tzConsistent !== null && (
                <FlagBadge
                  icon={PATHS.clock}
                  label="时区"
                  state={tzConsistent ? false : true}
                  trueText="不一致"
                  falseText="一致"
                />
              )}
              {checks?.langMatch !== null && checks?.langMatch !== undefined && (
                <FlagBadge
                  icon={PATHS.globe}
                  label="浏览器语言"
                  state={checks.langMatch ? false : true}
                  trueText="不一致"
                  falseText="一致"
                />
              )}
              {webrtcMismatch !== null && (
                <FlagBadge
                  icon={PATHS.network}
                  label="WebRTC"
                  state={webrtcMismatch}
                  trueText="不一致"
                  falseText="一致"
                />
              )}
            </div>
            {checks && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#9a9aa0]">
                本机时区 {checks.localTz || "未知"}（UTC{fmtUtcOffset(checks.localOffsetSec)}）
                {checks.lang
                  ? `；浏览器语言 ${checks.lang}${checks.langRegion ? `（地区 ${checks.langRegion}）` : ""}`
                  : ""}
                {checks.webrtcIp
                  ? `；WebRTC 实测本机公网地址 ${checks.webrtcIp}`
                  : ""}
              </p>
            )}
          </div>

          <div className="border-t border-black/[0.05] pt-3">
            <div className="space-y-0.5">
              {result.basis.map((b) => (
                <p key={b} className="text-[12px] leading-relaxed text-[#6e6e73]">
                  · {b}
                </p>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
              数据来源：{result.source}；IPv6 由 api6.ipify.org /
              v6.ident.me 实测；本机一致性为本机浏览器实测 · 查询时间：
              {fullTime(result.checkedAt)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Pioneer VPN: detail pane (third column) ---------------- */

function VpnDetail({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const pioneerQuery = usePioneerState();
  const pioneer = pioneerQuery.data;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pioneer"] });
    queryClient.invalidateQueries({ queryKey: ["pioneerLogs"] });
  };
  const [note, setNote] = useState("");
  const [noteOk, setNoteOk] = useState(false);

  const switchNodeMut = useMutation({
    mutationFn: async () => await api.pioneerSwitchNode({}),
    onSuccess: (r) => {
      invalidate();
      if (r.ok && r.node) {
        const base = `已重新连接，Pioneer 本次分配的节点为「${r.node.name || r.node.host || "—"}」（地址 ${r.node.host || "—"}${r.node.ips.length ? `，IP ${r.node.ips.join("、")}` : ""}）`;
        if (r.tunnel && r.tunnel.state === "connected") {
          setNote(`${base}；Trojan 隧道已建立，真实出口 IP ${r.tunnel.exitIp}`);
          setNoteOk(true);
        } else if (r.tunnel) {
          setNote(`${base}；但隧道未建立：${r.tunnel.error}`);
          setNoteOk(false);
        } else {
          setNote(base);
          setNoteOk(true);
        }
      } else {
        setNote(r.error);
        setNoteOk(false);
      }
    },
    onError: () => {
      setNote("换节点未能完成，请稍后重试");
      setNoteOk(false);
    },
  });
  const tunnelRefreshMut = useMutation({
    mutationFn: async () => await api.pioneerRefreshTunnelExit({}),
    onSuccess: () => invalidate(),
    onError: () => invalidate(),
  });
  // Re-verify the tunnel exit once per selected region when the pane
  // is shown, mirroring the collaborative space's panel behaviour.
  const checkedForRef = useRef(0);
  const selectedId = pioneer?.selectedId ?? 0;
  const loggedIn = pioneer?.loggedIn ?? false;
  useEffect(() => {
    if (!loggedIn || selectedId === 0) return;
    if (checkedForRef.current === selectedId) return;
    checkedForRef.current = selectedId;
    tunnelRefreshMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, selectedId]);

  const nodeShown =
    pioneer?.node && pioneer.selectedId !== 0 && pioneer.node.countryId === pioneer.selectedId
      ? pioneer.node
      : null;

  return (
    <>
      <DetailHeader title="Pioneer VPN" onBack={onBack} backAlwaysVisible />
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {pioneerQuery.isPending ? (
          <p className="py-16 text-center text-sm text-[#9a9aa0]">加载中…</p>
        ) : !pioneer ? (
          <p className="py-16 text-center text-sm text-[#9a9aa0]">
            VPN 状态加载失败
          </p>
        ) : !pioneer.loggedIn ? (
          <p className="py-16 text-center text-sm text-[#9a9aa0]">
            在左侧登录 Pioneer 帐号后，这里会显示连接详情
          </p>
        ) : (
          <div className="mx-auto max-w-xl">
            <div className="flex items-center justify-between">
              <VpnPill pioneer={pioneer} />
              <span className="text-xs text-[#9a9aa0]">
                {pioneer.selectedName
                  ? `已连接服务器 · ${pioneer.selectedName}`
                  : "尚未连接服务器"}
              </span>
            </div>
            {note ? (
              <p
                role="status"
                className={`mt-3 text-[13px] leading-relaxed ${noteOk ? "text-[#3d7a1e]" : "text-[#c0392b]"}`}
              >
                {note}
              </p>
            ) : null}
            {pioneer.nodeError ? (
              <p className="mt-3 rounded-xl bg-[#fdecec] px-3 py-2 text-[13px] leading-relaxed text-[#b3261e]">
                节点信息获取失败：{pioneer.nodeError}
              </p>
            ) : null}
            {nodeShown ? (
              <div className="mt-3 rounded-xl bg-white px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-sm font-medium">
                  已选节点 · {nodeShown.name || nodeShown.country || pioneer.selectedName}
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">服务器地址</dt>
                    <dd className="break-all text-right">{nodeShown.host || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">IP</dt>
                    <dd className="break-all text-right">
                      {nodeShown.ips.length
                        ? nodeShown.ips.map((ip) => (
                            <span key={ip} className="block">
                              {ip}
                            </span>
                          ))
                        : "未能解析，仅显示服务器地址"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">端口</dt>
                    <dd>{nodeShown.port || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">协议</dt>
                    <dd>{nodeShown.protocol || "—"}</dd>
                  </div>
                  {nodeShown.sni ? (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-[#9a9aa0]">SNI</dt>
                      <dd className="break-all text-right">{nodeShown.sni}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">获取时间</dt>
                    <dd>{pioneer.nodeAt ? fullTime(pioneer.nodeAt) : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-[#9a9aa0]">隧道</dt>
                    <dd
                      className={
                        pioneer.tunnel?.state === "connected"
                          ? "font-medium text-[#3d7a1e]"
                          : ""
                      }
                    >
                      {tunnelRefreshMut.isPending && !pioneer.tunnel
                        ? "正在验证…"
                        : pioneer.tunnel?.state === "connected"
                          ? "已连接（Trojan）"
                          : pioneer.tunnel?.state === "unsupported"
                            ? "该节点无法建立 Trojan 隧道"
                            : pioneer.tunnel?.state === "error"
                              ? "建立失败"
                              : "尚未建立"}
                    </dd>
                  </div>
                  {pioneer.tunnel?.state === "connected" ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-[#9a9aa0]">真实出口 IP</dt>
                        <dd className="break-all text-right font-medium">
                          {pioneer.tunnel.exitIp}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-[#9a9aa0]">出口位置</dt>
                        <dd className="text-right">
                          {[
                            pioneer.tunnel.exitCountry,
                            pioneer.tunnel.exitRegion,
                            pioneer.tunnel.exitCity,
                          ]
                            .filter((x) => x !== "")
                            .join(" · ") || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-[#9a9aa0]">验证时间</dt>
                        <dd>
                          {pioneer.tunnel.checkedAt
                            ? fullTime(pioneer.tunnel.checkedAt)
                            : "—"}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
                {pioneer.tunnel && pioneer.tunnel.state !== "connected" && pioneer.tunnel.error ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-[#c0392b]">
                    {pioneer.tunnel.error}
                  </p>
                ) : null}
                <p className="mt-3 text-[13px] leading-relaxed text-[#9a9aa0]">
                  节点由 Pioneer 在每次连接时轮换分配（如 tw01、tw02、tw03）。经实测，Pioneer
                  的接口不接受指定节点编号，服务器列表也不提供节点清单，因此无法直接选定某个节点；可以重新连接，由
                  Pioneer 重新分配一个节点。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={switchNodeMut.isPending}
                    onClick={() => switchNodeMut.mutate()}
                    aria-label="换一个节点，重新连接当前地区"
                    className="rounded-lg bg-[#2f6bff] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  >
                    {switchNodeMut.isPending ? "正在重新连接并分配节点…" : "换一个节点"}
                  </button>
                  <button
                    type="button"
                    disabled={tunnelRefreshMut.isPending}
                    onClick={() => tunnelRefreshMut.mutate()}
                    aria-label="重新验证 Pioneer 隧道出口 IP"
                    className="rounded-lg bg-black/[0.05] px-3 py-2 text-[13px] font-medium disabled:opacity-50"
                  >
                    {tunnelRefreshMut.isPending ? "正在经隧道验证出口…" : "重新验证出口 IP"}
                  </button>
                </div>
              </div>
            ) : (
              !pioneer.nodeError && (
                <p className="py-14 text-center text-sm text-[#9a9aa0]">
                  在左侧列表点击一个地区即可连接，这里会显示 Pioneer 分配的节点与经隧道实测的真实出口
                </p>
              )
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-[#9a9aa0]">
              VPN 只影响本空间服务端的出口，不改变 Muse 应用和您设备的 IP。完整节点配置仅保存在服务端，不会下发到页面。
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- swipe-to-delete list row ---------------- */

const SWIPE_DELETE_W = 76;

/**
 * A middle-column list row that swipes left to reveal a red 删除
 * button behind it. Tapping that button deletes immediately (no extra
 * confirmation — the swipe itself is the deliberate step); tapping
 * anywhere else in the list slides it back (the list container closes
 * whichever row is open). Mouse drag works the same way, and on
 * hover-capable desktops a 删除 button also fades in at the row's
 * right edge so the action is discoverable without touch.
 *
 * The selected wash only paints at md widths, where the list and the
 * open conversation sit side by side. On phones the list is a
 * full-screen step of its own — no chat is open while it is on
 * screen — so an unclicked row never sits grey there; grey appears
 * only under the finger via the active: press feedback.
 */
function SwipeableRow({
  rowKey,
  openKey,
  onOpenKeyChange,
  onDelete,
  deleteLabel,
  onOpen,
  onLongPress,
  ariaLabel,
  selected = false,
  hideHoverDelete = false,
  children,
}: {
  rowKey: string;
  openKey: string | null;
  onOpenKeyChange: (key: string | null) => void;
  onDelete: () => void;
  deleteLabel: string;
  onOpen: () => void;
  /** Suppresses the floating hover 删除 pill. Rows whose own
   * trailing control already occupies the right edge (the file
   * rows' agent-access switch) pass this: the pill would paint
   * exactly over that control and swallow its clicks. Those rows
   * keep swipe / mouse-drag delete, and their detail pane carries
   * a delete button of its own. */
  hideHoverDelete?: boolean;
  /** Optional long-press action (conversation rows pass it to open
   * the rename/delete sheet). A press held ~500ms without moving
   * fires it and swallows the click that follows; any real movement
   * — a swipe or a scroll — cancels it. */
  onLongPress?: () => void;
  ariaLabel: string;
  selected?: boolean;
  children: ReactNode;
}) {
  const isOpen = openKey === rowKey;
  const [dragX, setDragX] = useState<number | null>(null);
  const dragXRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(
    null,
  );
  const draggedRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const offset = dragX ?? (isOpen ? -SWIPE_DELETE_W : 0);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }
  function handlePointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      base: isOpen ? -SWIPE_DELETE_W : 0,
    };
    draggedRef.current = false;
    longPressedRef.current = false;
    clearLongPressTimer();
    if (onLongPress) {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressedRef.current = true;
        onLongPress();
      }, 500);
    }
  }
  function handlePointerMove(e: ReactPointerEvent) {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPressTimer();
    if (dragXRef.current === null) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll wins; abandon the swipe.
        startRef.current = null;
        return;
      }
    }
    draggedRef.current = true;
    const next = Math.max(-SWIPE_DELETE_W, Math.min(0, s.base + dx));
    dragXRef.current = next;
    setDragX(next);
  }
  function handlePointerEnd() {
    clearLongPressTimer();
    const wasDragging = dragXRef.current !== null;
    startRef.current = null;
    if (wasDragging) {
      onOpenKeyChange(
        (dragXRef.current ?? 0) < -SWIPE_DELETE_W / 2 ? rowKey : null,
      );
      dragXRef.current = null;
      setDragX(null);
    }
  }
  function handleClick() {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (isOpen) {
      onOpenKeyChange(null);
      return;
    }
    onOpen();
  }

  return (
    <div
      className="group relative overflow-hidden rounded-xl"
      data-swipe-key={rowKey}
    >
      <button
        type="button"
        aria-label={deleteLabel}
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-[#e5484d] text-[15px] font-medium text-white"
        style={{ width: SWIPE_DELETE_W }}
      >
        删除
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-current={selected ? "true" : undefined}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
        className={`relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left select-none active:bg-black/[0.06] ${
          selected ? "bg-white md:bg-[#f0f0f2]" : "bg-white hover:bg-black/[0.03]"
        }`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragX === null ? "transform 0.25s ease" : "none",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
      {!isOpen && !hideHoverDelete && (
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={onDelete}
          className="absolute top-1/2 right-2 z-10 hidden -translate-y-1/2 rounded-lg bg-[#e5484d] px-2.5 py-1.5 text-[13px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100 md:block"
        >
          删除
        </button>
      )}
    </div>
  );
}

/**
 * A sidebar-drawer recent-chat row: the same gestures as
 * SwipeableRow — swipe left to reveal a red 删除 button, tap to
 * open — plus a long press (~500ms, cancelled by any real movement)
 * that opens the rename/delete action sheet for the conversation.
 * The styling follows the drawer's own rows (transparent over the
 * drawer's grey, wash only under the finger or while current), not
 * the middle column's white cards.
 */
function RecentChatRow({
  rowKey,
  openKey,
  onOpenKeyChange,
  onDelete,
  deleteLabel,
  onOpen,
  onLongPress,
  ariaLabel,
  selected = false,
  children,
}: {
  rowKey: string;
  openKey: string | null;
  onOpenKeyChange: (key: string | null) => void;
  onDelete: () => void;
  deleteLabel: string;
  onOpen: () => void;
  onLongPress: () => void;
  ariaLabel: string;
  selected?: boolean;
  children: ReactNode;
}) {
  const isOpen = openKey === rowKey;
  const [dragX, setDragX] = useState<number | null>(null);
  const dragXRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(
    null,
  );
  const draggedRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const offset = dragX ?? (isOpen ? -SWIPE_DELETE_W : 0);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }
  function handlePointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      base: isOpen ? -SWIPE_DELETE_W : 0,
    };
    draggedRef.current = false;
    longPressedRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressedRef.current = true;
      onLongPress();
    }, 500);
  }
  function handlePointerMove(e: ReactPointerEvent) {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPressTimer();
    if (dragXRef.current === null) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        return;
      }
    }
    draggedRef.current = true;
    const next = Math.max(-SWIPE_DELETE_W, Math.min(0, s.base + dx));
    dragXRef.current = next;
    setDragX(next);
  }
  function handlePointerEnd() {
    clearLongPressTimer();
    const wasDragging = dragXRef.current !== null;
    startRef.current = null;
    if (wasDragging) {
      onOpenKeyChange(
        (dragXRef.current ?? 0) < -SWIPE_DELETE_W / 2 ? rowKey : null,
      );
      dragXRef.current = null;
      setDragX(null);
    }
  }
  function handleClick() {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (isOpen) {
      onOpenKeyChange(null);
      return;
    }
    onOpen();
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      data-recent-swipe-key={rowKey}
    >
      <button
        type="button"
        aria-label={deleteLabel}
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-[#e5484d] text-[15px] font-medium text-white"
        style={{ width: SWIPE_DELETE_W }}
      >
        删除
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-current={selected ? "true" : undefined}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left select-none active:bg-black/[0.08] ${
          selected ? "bg-[#f0f0f2]" : "bg-[#f5f5f5] hover:bg-black/[0.04]"
        }`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragX === null ? "transform 0.25s ease" : "none",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A plain middle-column list row with NO swipe behaviour and NO
 * delete affordance at all. Agent rows use this: the user asked for
 * the 删除 button to go away entirely, so no gesture on an agent
 * row — swipe left, swipe right, or long press — can reveal one.
 * The row only opens on a plain tap; the context menu is suppressed
 * so a long press cannot surface anything either. The selected wash
 * follows the same rule as SwipeableRow: md widths only, with the
 * grey on phones appearing solely under the finger (active:).
 */
function PlainRow({
  onOpen,
  ariaLabel,
  selected = false,
  children,
  entryKey,
  dragging = false,
  dragDy = 0,
  onPointerDown,
}: {
  onOpen: () => void;
  ariaLabel: string;
  selected?: boolean;
  children: ReactNode;
  /** Agent-list drag reorder: this row's entry key, set only for
   * rows that take part in the long-press drag ordering. */
  entryKey?: string;
  /** True while THIS row is the one being dragged: it lifts with a
   * shadow and follows the pointer vertically. */
  dragging?: boolean;
  dragDy?: number;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-entry-key={entryKey}
      onPointerDown={onPointerDown}
      className={`relative rounded-xl ${
        dragging
          ? "z-30 shadow-[0_10px_28px_rgba(0,0,0,0.22)]"
          : "overflow-hidden"
      }`}
      style={
        dragging
          ? { transform: `translateY(${dragDy}px) scale(1.02)` }
          : undefined
      }
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left select-none active:bg-black/[0.06] ${
          selected ? "bg-white md:bg-[#f0f0f2]" : "bg-white hover:bg-black/[0.03]"
        }`}
        style={{
          touchAction: dragging ? "none" : "pan-y",
          WebkitTouchCallout: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------- modal scroll guard ---------------- */

/**
 * Backdrop ref for every settings/modal overlay. React attaches
 * touch listeners passively, and `overflow: hidden` on the body does
 * not stop the app's inner scroll containers in an embedded webview —
 * so the lock is enforced here with native non-passive listeners:
 * a touch or wheel gesture that starts outside the panel's own
 * scroll region ([data-modal-scroll]) is cancelled outright, and a
 * gesture inside it is cancelled at the region's top/bottom edge so
 * it can never chain through to the columns underneath.
 */
function modalBackdropRef(el: HTMLDivElement | null) {
  if (!el || el.dataset.guardAttached) return;
  el.dataset.guardAttached = "1";
  let lastY = 0;
  const scrollerOf = (t: EventTarget | null) =>
    t instanceof HTMLElement
      ? t.closest<HTMLElement>("[data-modal-scroll]")
      : null;
  const onTouchStart = (e: TouchEvent) => {
    lastY = e.touches[0]?.clientY ?? 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY ?? lastY;
    const dy = y - lastY;
    lastY = y;
    const sc = scrollerOf(e.target);
    if (!sc) {
      e.preventDefault();
      return;
    }
    const atTop = sc.scrollTop <= 0;
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
    if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    const sc = scrollerOf(e.target);
    if (!sc) {
      e.preventDefault();
      return;
    }
    const atTop = sc.scrollTop <= 0;
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
    if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0))
      e.preventDefault();
  };
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("wheel", onWheel, { passive: false });
}

/* ---------------- agent settings panel (add / edit) ---------------- */

type AgentForm = {
  name: string;
  role: string;
  color: string;
  glyph: string;
  enabled: boolean;
  provider: string;
  apiBase: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: string;
  thinking: string;
  systemPrompt: string;
  // Legacy long-term-memory field: the form no longer edits it
  // (folded into systemPrompt — see formFromAgent); it is always
  // "" in the form and is sent back as "" on save.
  memory: string;
  note: string;
  connectionType: string;
  // Advanced API parameters （高级 API 参数）: all kept as raw
  // input text — an empty field means "not set", and the parameter
  // is then left out of the API request entirely.
  topP: string;
  frequencyPenalty: string;
  presencePenalty: string;
  seed: string;
  stopSequences: string;
  responseFormat: string;
  maxCompletionTokens: string;
  // Streaming output （流式输出） and tool calling （工具调用）:
  // streamEnabled is a plain switch; toolMode '' = tools not
  // offered, otherwise the tool_choice sent with the built-in
  // tool set ('auto' | 'required' | 'none').
  streamEnabled: boolean;
  toolMode: string;
  // The browser device id for web-token sites whose chat endpoint
  // requires one (Doubao's device_id): copied from the user's own
  // browser request URL, saved server-side with the agent's other
  // settings and sent with that site's chat calls. '' = not set.
  webDeviceId: string;
  // Credential-bundle alignment state （千问's console one-click
  // export), read-only in this form: whether a full Cookie string
  // is stored server-side with the token (its value is never sent
  // to the page), and the browser User-Agent stored with it
  // ('' = none). Both are set by pasting the bundle into the
  // 网页登录令牌 field and verifying — there is no separate
  // input for them.
  webCookieSet: boolean;
  webUserAgent: string;
  // The web product's own chat options (web agents only), per
  // site — the two sites do NOT share one feature set:
  // DeepSeek: webMode 'default' 快速 / 'expert' 专家 plus the
  // independent webThinking （深度思考） and webSearch （智能搜索）
  // switches. 豆包： the model-menu selection below (webModel /
  // webReasoning) plus webSearch （联网搜索）; its webMode is a
  // server-derived deep-think summary kept for the classic
  // fallback protocol, not a user-facing mode any more.
  webMode: string;
  webThinking: boolean;
  webSearch: boolean;
  // The site's model-menu selection （豆包 only): the picked
  // model by its wire key from the account's detected menu
  // (webModelKey; '' = never picked by key), the legacy
  // webModel projection of the same pick, and the 推理强度
  // (webReasoning: '' = never picked, a legacy level name, or
  // a numeric level string from the model's own levels).
  // Other sites keep all three ''.
  webModel: string;
  webModelKey: string;
  webReasoning: string;
};

/**
 * The add/edit agent form — the same field set as the multi-agent
 * collaborative space's seat settings: 名称、角色、启用、服务商、API
 * 地址、密钥、模型、温度、最大 tokens、思考强度、系统提示词， plus a
 * real 测试连接 that calls the provider's GET /models and offers the
 * returned list as a model dropdown. The saved key is never echoed
 * back: the key field starts empty and an empty value on save keeps
 * the stored key.
 */
/**
 * The blank/default form for adding a new agent. It must carry NO
 * provider identity: an earlier version pre-filled one vendor's
 * preset (name, glyph, colour, API base, first model), which made
 * every fresh "add" panel indistinguishable from the previously
 * added agent that used that vendor — the user reported it as the
 * panel "still showing the last agent's info". The default panel is
 * therefore genuinely empty: neutral colour, no glyph, the neutral
 * 自定义 provider with no address and no model. Picking a real
 * provider from the dropdown still fills in that provider's base /
 * model / identity as a convenience — but only after the user's own
 * pick, never before.
 */
/** One selectable chat mode of a web product (its own web UI's
 * mode switch). The value is what the server stores in webMode
 * and sends in that site's request (DeepSeek's model_type).
 * 豆包 has no such mode list — its selection is the account's
 * detected model menu (see the DoubaoMenu helpers below). */
type WebModeOption = { value: string; label: string; hint: string };

/** The web-token sites: one entry per AI web product, keyed by the
 * provider id stored on web agents. Each site has its OWN token
 * location and help text — they are not interchangeable. The chat
 * options are likewise per site (`modes` / `hasThinkingToggle` /
 * `searchLabel`): DeepSeek's web UI offers a 快速/专家 mode switch
 * plus independent 深度思考 and 智能搜索 toggles; 豆包's offers
 * its account-detected model menu plus 联网搜索 —
 * no mode switch and no separate thinking toggle. Sites without
 * these fields expose no chat options in the panel. */
type WebSiteMeta = {
  name: string;
  label: string;
  glyph: string;
  color: string;
  site: string;
  tokenHelp: string;
  /** Set when the site's chat calls carry a structural limit the
   * settings panel must state up front (e.g. a page-JavaScript
   * signature the server cannot reproduce). Shown under the
   * token help so the limit is known before the first send. */
  chatNote?: string;
  /** Legacy model list (unused by the current per-site options). */
  models?: string[];
  modes?: WebModeOption[];
  defaultMode?: string;
  /** DeepSeek only: its web UI has a standalone 深度思考 toggle,
   * independent of the mode switch. */
  hasThinkingToggle?: boolean;
  /** The site's own name for its web-search switch （智能搜索 on
   * DeepSeek, 联网搜索 on 豆包）; absent = the site exposes no
   * search switch the space can drive. */
  searchLabel?: string;
  searchHint?: string;
};
const WEB_SITES: Record<string, WebSiteMeta> = {
  deepseek: {
    name: "DeepSeek·网页", label: "DeepSeek", glyph: "DS", color: "#4d6bfe", site: "chat.deepseek.com",
    tokenHelp: "在电脑浏览器打开 chat.deepseek.com 并登录，按 F12 打开开发者工具，在「应用 → 本地存储」里找到 userToken 的值粘贴到这里。",
    chatNote: "说明：每个房间在 DeepSeek 官网固定对应一个对话，房间里的消息都追加到那个对话里，所以在官网能看到这个房间的对话记录；新建房间会另开一个新的官网对话，互不影响。官网账号自身的记忆也随这些对话保留。只有那个官网对话失效时，空间才会为这个房间重开一个；清空房间记录后，下次回复也会重新开一个官网对话。模式说明：这里按官网协议发送 model_type（快速 default / 专家 expert），深度思考与智能搜索是两个独立开关，同样照常发送。但 DeepSeek 在 2026 年把网页版的快速 / 专家合并了，官网现在主要以快速模型（V4.1 Flash）应答，专家是否真正路由到 V4 Pro 由 DeepSeek 服务端按账号决定，回复里没有可验证的标记——若专家与快速答得没差别，多半是官网侧已统一，不是这里没有发出去。",
    modes: [
      { value: "default", label: "快速模式", hint: "DeepSeek V4 Flash，回答更快" },
      { value: "expert", label: "专家模式", hint: "DeepSeek V4 Pro，能力更强，复杂问题更稳" },
    ],
    defaultMode: "default",
    hasThinkingToggle: true,
    searchLabel: "智能搜索（联网搜索）",
    searchHint: "开启后会先联网搜索、再结合搜索结果回答，并附来源",
  },
  chatgpt: {
    name: "GPT", label: "ChatGPT", glyph: "◎", color: "#10a37f", site: "chatgpt.com",
    tokenHelp: "在电脑浏览器登录 chatgpt.com 后，新开一个标签页打开 chatgpt.com/api/auth/session，把页面中 accessToken 的值粘贴到这里。",
  },
  claude: {
    name: "Claude", label: "Claude", glyph: "✳", color: "#d97757", site: "claude.ai",
    tokenHelp: "在电脑浏览器登录 claude.ai，按 F12 打开开发者工具，在「应用 → Cookie」里找到 sessionKey 的值粘贴到这里。",
  },
  gemini: {
    name: "Gemini", label: "Gemini", glyph: "✦", color: "#4796e3", site: "gemini.google.com",
    tokenHelp: "在电脑浏览器登录 gemini.google.com，按 F12 打开开发者工具，在「应用 → Cookie」里复制 __Secure-1PSID 和 __Secure-1PSIDTS 两个值，用 | 分隔粘贴（也可以直接粘贴整段 Cookie）。两个值都贴时，空间会自动续期其中短命的 __Secure-1PSIDTS 并保存新值，登录能保持更久；只贴 1PSID 也能验证，但会很快过期。",
  },
  grok: {
    name: "Grok", label: "Grok", glyph: "𝕏", color: "#4a4a52", site: "grok.com",
    tokenHelp: "在电脑浏览器登录 grok.com，按 F12 打开开发者工具，在「应用 → Cookie」里复制 sso 的值粘贴（也可以直接粘贴整段 Cookie）。",
  },
  qwen: {
    name: "千问", label: "千问", glyph: "☁", color: "#6c3df0", site: "chat.qwen.ai",
    tokenHelp: "推荐用控制台一键提取（不会漏参数）：在电脑浏览器打开 chat.qwen.ai 并确认已登录能正常聊天，按 F12 打开开发者工具，切换到「控制台 (Console)」标签页（若提示粘贴警告，先按提示输入 allow pasting 回车），粘贴这一行并回车：copy(JSON.stringify({ token: localStorage.getItem('token'), cookie: document.cookie, ua: navigator.userAgent }, null, 2)) —— 整段凭证 JSON 已复制到剪贴板，直接粘贴到这里点「验证登录」即可。空间会把三部分分别保存到服务端，之后每次调用都按这组凭证对齐发送：访问令牌（Bearer）、完整 Cookie、与你浏览器完全一致的 User-Agent；若 Cookie 里带有 token 且与本地存储的不一致，以 Cookie 里的为准。注意：访问令牌有效期很短（实测约 15 分钟），导出后请尽快粘贴；过期后重新运行这一行导出再粘贴即可。也可以只粘贴本地存储里的 token 值（在「应用 → 本地存储」里找 token 一项），但那样没有 Cookie 与 UA 对齐，千问风控更容易误判为令牌过期。Cookie 里带 refresh_token 的那串是刷新凭证、不是访问令牌，单独粘贴它验证会直接说明贴错了什么。",
  },
  doubao: {
    name: "豆包", label: "豆包", glyph: "豆", color: "#1664ff", site: "www.doubao.com",
    tokenHelp: "在电脑浏览器登录 www.doubao.com，按 F12 打开开发者工具，点上方「网络」，刷新页面，在左侧列表点任意一个 doubao.com 的请求，在右侧「标头 → 请求标头」里找到 Cookie 那一行，把整段复制下来粘贴到这里（要整段，其中包含登录会话和 msToken）。",
    chatNote: "发消息只走令牌直连（已按你的要求停用真浏览器代发）：服务端用你保存的 Cookie 直接向豆包发请求，不开浏览器。这套直连已和豆包测试空间里实测发通的那套对齐：请求指纹是你自己浏览器的（Windows Edge 157、agw-js-conv、客户端提示头和语言头），查询参数里的地区、device_id / web_id / tea_uuid 全部从本智能体自己的 Cookie 和它账号的官网页面恢复（每个豆包智能体各用各的，绝不套用另一个智能体的，恢复不到的参数就不带），web_tab_id 每个官网对话生成一个并在该对话内复用，URL 不带 a_bogus、也不带 msToken。发送顺序只有两条，都是新统一协议：第一条是和测试空间完全一致的 plain 请求体，第二条带当前的模型选择包（模型键、mode_id、参数、推理强度按官网格式写全），聊天框里的模型切换靠第二条生效；旧的经典协议请求体已经删掉（实测只会报 710020202 参数无效）。任一条出现真人验证要求就停发、不会连发。每个房间在豆包官网固定对应一个对话，后续消息只发新增内容、不重发全部历史；切换模型选择后下一条会新开官网对话。每次实际发出的完整数据（地址、参数、请求体）和豆包的真实返回都记在下方「发送数据诊断」里，旁边的「指导日志」按每次发送的结果给出下一步该做什么，可以逐项核对到底卡在哪。发送前会先按测试空间同款规则逐字段清洗并校验 Cookie（剔除不可见字符；某字段的值放不进请求头时会点名字段并停发，不再变成无原因的 0 字节网络错误）；万一请求在本地出错，「指导日志」会记下底层错误的原文（名称、信息、原因链）、出错时所处的阶段和耗时，而不是只剩一句固定文案。像 Pro 这种账号配置里标了「需升级」的模型，仍然需要先开通豆包会员才能用。",
    // No `modes` for 豆包： its selection is the account's
    // detected model menu (DoubaoMenu) — the settings panel
    // and the toolbar both render that catalog, and the
    // server's adapter resolves webModelKey / webReasoning
    // against it, not webMode.
    searchLabel: "联网搜索",
    searchHint: "开启后回答会结合实时网络信息；豆包本身也会边想边搜，关闭时仍可能按需自动搜索",
  },
  hunyuan: {
    name: "元宝", label: "元宝", glyph: "元", color: "#0052d9", site: "yuanbao.tencent.com",
    tokenHelp: "在电脑浏览器登录 yuanbao.tencent.com，按 F12 打开开发者工具，在「应用 → Cookie」里复制整段 Cookie 粘贴到这里。",
  },
  kimi: {
    name: "Kimi", label: "Kimi", glyph: "☾", color: "#3b3f4a", site: "kimi.moonshot.cn",
    tokenHelp: "在电脑浏览器登录 kimi.moonshot.cn，按 F12 打开开发者工具，在「应用 → 本地存储」里找到 accessToken 的值粘贴到这里。",
  },
  zhipu: {
    name: "智谱", label: "智谱清言", glyph: "智", color: "#2f6fed", site: "chatglm.cn",
    tokenHelp: "在电脑浏览器登录 chatglm.cn，按 F12 打开开发者工具，在「应用 → 本地存储」里找到 token 的值粘贴到这里。",
  },
  mistral: {
    name: "Mistral", label: "Mistral", glyph: "M", color: "#ff7000", site: "chat.mistral.ai",
    tokenHelp: "在电脑浏览器登录 chat.mistral.ai，按 F12 打开开发者工具，在「应用 → Cookie」里复制整段 Cookie 粘贴到这里。",
  },
  wenxin: {
    name: "文心一言", label: "文心一言", glyph: "文", color: "#2932e1", site: "chat.baidu.com",
    tokenHelp: "在电脑浏览器登录 chat.baidu.com，按 F12 打开开发者工具，在「应用 → Cookie」里复制整段 Cookie 粘贴到这里。",
    chatNote: "注意：文心一言的对话请求由页面脚本签名，服务端暂时只能验证登录、无法代发消息（发送时会如实说明）。",
  },
};

function webSiteMeta(provider: string): WebSiteMeta {
  return (
    WEB_SITES[provider] ?? {
      name: provider,
      label: provider,
      glyph: "…",
      color: "#5d6a82",
      site: provider,
      tokenHelp: "在该站登录后，从浏览器开发者工具中复制登录令牌粘贴到这里。",
    }
  );
}

/* ---- 豆包's detected account menu (client side) ----
 * The menu the settings panel and the chat toolbar render is
 * the account's OWN menu config as detected server-side from
 * Doubao (agent.webMenu — see detectDoubaoModels), exactly
 * like an API agent's model dropdown comes from the provider's
 * /models list. Before any detection, the fallback below —
 * Doubao's own five models in their standing config shape,
 * mirroring the server's DOUBAO_FALLBACK_MENU — stands in, and
 * the UI offers 识别可用模型 to replace it with the account's
 * real list (which also carries the 会员 gate per model). */

type DoubaoMenu = NonNullable<Agent["webMenu"]>;
type DoubaoMenuModel = DoubaoMenu["models"][number];

const DOUBAO_LEVELS_345: DoubaoMenuModel["levels"] = [
  { level: 3, name: "低" },
  { level: 4, name: "中" },
  { level: 5, name: "高" },
];

const DOUBAO_FALLBACK_MODELS: DoubaoMenuModel[] = [
  { key: "0", name: "快速", modeId: "1", agentMode: 2, tags: [], extraParams: {}, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
  { key: "3", name: "专家", modeId: "1", agentMode: 2, tags: [], extraParams: {}, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
  { key: "9", name: "自动", modeId: "3", agentMode: 1, tags: ["小额免费"], extraParams: { total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
  { key: "seed-lite-7b", name: "豆包 2.1 Lite", modeId: "3", agentMode: 1, tags: ["限时优惠 0.01x"], extraParams: { memory_profile: "256k", total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
  { key: "5", name: "豆包 2.1 Pro", modeId: "3", agentMode: 1, tags: ["0.65x"], extraParams: { total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: true },
];

/** The model list to render: the detected account menu when
 * one exists, else the fallback. */
function doubaoModelsOf(menu: DoubaoMenu | null | undefined): DoubaoMenuModel[] {
  return menu && menu.models.length ? menu.models : DOUBAO_FALLBACK_MODELS;
}

const DOUBAO_LEGACY_KEY_BY_MODEL: Record<string, string> = {
  "": "9",
  "doubao-2.1-lite": "seed-lite-7b",
  "doubao-2.1-pro": "5",
};

/** The wire key of a stored pick: webModelKey when set, else
 * the legacy webModel resolved to its key (mirrors the
 * server's doubaoSelectedKey). */
function doubaoSelectedKeyOf(a: {
  webModelKey: string;
  webModel: string;
}): string {
  if (a.webModelKey) return a.webModelKey;
  return DOUBAO_LEGACY_KEY_BY_MODEL[a.webModel] ?? "9";
}

/** The catalog entry for a key; an unknown key (the account's
 * menu changed since the pick) resolves to the 自动 entry so
 * labels and levels still render sanely. */
function doubaoEntryOf(
  models: DoubaoMenuModel[],
  key: string,
): DoubaoMenuModel {
  return (
    models.find((m) => m.key === key) ??
    models.find((m) => m.key === "9") ??
    (models[0] as DoubaoMenuModel)
  );
}

/** The 推理强度 value (a level number as a string) a stored
 * webReasoning means for one model: numeric strings are the
 * level itself, the legacy names map 低 3 / 中 4 / 高 5, and
 * anything the model does not offer — including never-picked
 * '' — falls back to the model's own default level from the
 * account config. This is exactly what the server sends, so
 * what the menu shows is what the next reply will do. */
function doubaoReasoningValueOf(
  reasoning: string,
  entry: DoubaoMenuModel,
): string {
  let level: number | null = null;
  if (/^\d+$/.test(reasoning)) level = Number(reasoning);
  else if (reasoning === "low") level = 3;
  else if (reasoning === "medium") level = 4;
  else if (reasoning === "high") level = 5;
  if (level != null && entry.levels.some((l) => l.level === level))
    return String(level);
  return String(entry.defaultLevel);
}

/** The 推理强度 carried when a model is picked: the stored
 * level when the newly picked model offers it, else that
 * model's own default level — the pick always lands on a
 * level the model really has. */
function doubaoReasoningOnModelPick(
  entry: DoubaoMenuModel,
  stored: string,
): string {
  return doubaoReasoningValueOf(stored, entry);
}

/** The display name of a stored 推理强度 value for one model. */
function doubaoLevelName(entry: DoubaoMenuModel, value: string): string {
  return (
    entry.levels.find((l) => l.level === Number(value))?.name ?? "低"
  );
}


/* ---------------- vendor official logos ----------------
 * The real official logo of each vendor, sourced from the
 * vendor's own published brand/app-icon artwork and stored in
 * src/assets/logos (see DATA-PLAN.md for the source of each).
 * `bg` is the tile colour shown behind a symbol-only logo;
 * full-bleed app icons (cover) ignore it. */
type VendorLogo = { src: string; bg: string; fit: "contain" | "cover" };
const VENDOR_LOGOS: Record<string, VendorLogo> = {
  anthropic: { src: logoAnthropic, bg: "#ffffff", fit: "contain" },
  deepseek: { src: logoDeepseek, bg: "#ffffff", fit: "contain" },
  doubao: { src: logoDoubao, bg: "#ffffff", fit: "cover" },
  gemini: { src: logoGemini, bg: "#ffffff", fit: "contain" },
  grok: { src: logoGrok, bg: "#000000", fit: "cover" },
  kimi: { src: logoKimi, bg: "#000000", fit: "cover" },
  mistral: { src: logoMistral, bg: "#ffffff", fit: "contain" },
  openai: { src: logoOpenai, bg: "#ffffff", fit: "cover" },
  openrouter: { src: logoOpenrouter, bg: "#ffffff", fit: "contain" },
  qwen: { src: logoQwen, bg: "#ffffff", fit: "contain" },
  siliconflow: { src: logoSiliconflow, bg: "#ffffff", fit: "contain" },
  wenxin: { src: logoWenxin, bg: "#ffffff", fit: "contain" },
  yuanbao: { src: logoYuanbao, bg: "#ffffff", fit: "contain" },
  zhipu: { src: logoZhipu, bg: "#ffffff", fit: "cover" },
};

/** Provider id (as stored on the agent) → vendor logo key, for
 * API-mode agents and for web-token agents respectively. */
const API_VENDOR_LOGOS: Record<string, string> = {
  openai: "openai",
  gemini: "gemini",
  anthropic: "anthropic",
  deepseek: "deepseek",
  qwen: "qwen",
  kimi: "kimi",
  zhipu: "zhipu",
  xai: "grok",
  mistral: "mistral",
  hunyuan: "yuanbao",
  doubao: "doubao",
  wenxin: "wenxin",
  openrouter: "openrouter",
  siliconflow: "siliconflow",
};
const WEB_VENDOR_LOGOS: Record<string, string> = {
  deepseek: "deepseek",
  chatgpt: "openai",
  claude: "anthropic",
  gemini: "gemini",
  grok: "grok",
  qwen: "qwen",
  doubao: "doubao",
  hunyuan: "yuanbao",
  kimi: "kimi",
  zhipu: "zhipu",
  mistral: "mistral",
  wenxin: "wenxin",
};

/**
 * Whether an agent's avatar is its vendor's official logo. The
 * logo is the DEFAULT avatar of a successfully set-up agent: it
 * applies from the moment the agent first counts as configured
 * (API: address + key + model complete; web: login verified —
 * the server's `configured` flag), including agents set up
 * before logos existed, whose stored avatars are still the
 * vendor presets. It never overrides the user's own choices:
 * an uploaded avatar image wins first (the caller checks it),
 * and once the user changes the avatar glyph or colour away
 * from the vendor's preset, the colour + glyph avatar returns.
 * An unconfigured agent, a 自定义 provider and an unknown
 * vendor keep the colour + glyph avatar.
 */
function vendorLogoFor(a: {
  provider: string;
  connectionType: string;
  glyph: string;
  color: string;
  configured: boolean;
  avatarUrl: string | null;
}): VendorLogo | null {
  if (a.avatarUrl || !a.configured) return null;
  const isWeb = a.connectionType === "web";
  const vendor = (isWeb ? WEB_VENDOR_LOGOS : API_VENDOR_LOGOS)[a.provider];
  if (!vendor) return null;
  const preset = isWeb
    ? WEB_SITES[a.provider]
    : PROVIDERS.find((p) => p.id === a.provider);
  if (!preset) return null;
  if (
    a.glyph !== preset.glyph ||
    a.color.toLowerCase() !== preset.color.toLowerCase()
  ) {
    return null;
  }
  return VENDOR_LOGOS[vendor] ?? null;
}

function defaultAgentForm(): AgentForm {
  return {
    name: "",
    role: "",
    color: "#5d6a82",
    glyph: "",
    enabled: true,
    provider: "custom",
    apiBase: "",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: "4096",
    thinking: "默认",
    systemPrompt: "",
    memory: "",
    note: "",
    connectionType: "api",
    topP: "",
    frequencyPenalty: "",
    presencePenalty: "",
    seed: "",
    stopSequences: "",
    responseFormat: "",
    maxCompletionTokens: "",
    streamEnabled: false,
    toolMode: "",
    webDeviceId: "",
    webCookieSet: false,
    webUserAgent: "",
    webMode: "",
    webThinking: false,
    webSearch: false,
    webModel: "",
    webModelKey: "",
    webReasoning: "",
  };
}

/** The form seeded from one saved agent (its key always starts blank:
 * keys are never sent back to the page). */
function formFromAgent(a: Agent): AgentForm {
  return {
    name: a.name,
    role: a.role,
    color: a.color,
    glyph: a.glyph,
    enabled: a.enabled,
    provider: a.provider,
    apiBase: a.apiBase,
    apiKey: "",
    model: a.model,
    temperature: a.temperature,
    maxTokens: String(a.maxTokens),
    thinking: a.thinking,
    // The legacy long-term-memory text is folded into the one
    // 系统指令 field (the separate 长期记忆 field is gone — it
    // duplicated the system prompt): the form shows the combined
    // text as the system prompt and saves memory back as "", so
    // the next save moves the text into system_prompt for good.
    systemPrompt: [a.systemPrompt, a.memory]
      .filter((s) => s.trim() !== "")
      .join("\n\n"),
    memory: "",
    note: a.note,
    connectionType: a.connectionType,
    topP: a.topP == null ? "" : String(a.topP),
    frequencyPenalty: a.frequencyPenalty == null ? "" : String(a.frequencyPenalty),
    presencePenalty: a.presencePenalty == null ? "" : String(a.presencePenalty),
    seed: a.seed == null ? "" : String(a.seed),
    stopSequences: a.stopSequences,
    responseFormat: a.responseFormat,
    maxCompletionTokens:
      a.maxCompletionTokens == null ? "" : String(a.maxCompletionTokens),
    streamEnabled: a.streamEnabled,
    toolMode: a.toolMode,
    webDeviceId: a.webDeviceId,
    webCookieSet: a.webCookieSet,
    webUserAgent: a.webUserAgent,
    webMode: a.webMode,
    webThinking: a.webThinking,
    webSearch: a.webSearch,
    webModel: a.webModel,
    webModelKey: a.webModelKey,
    webReasoning: a.webReasoning,
  };
}

/** Whether a saved agent has any advanced API parameter set —
 * the panel opens its 高级 API 参数 section expanded for such an
 * agent so the saved values are visible without hunting. */
function agentHasAdvanced(a: Agent): boolean {
  return (
    a.topP != null ||
    a.frequencyPenalty != null ||
    a.presencePenalty != null ||
    a.seed != null ||
    a.stopSequences.trim() !== "" ||
    a.responseFormat !== "" ||
    a.maxCompletionTokens != null ||
    a.streamEnabled ||
    a.toolMode !== ""
  );
}

/** Parses an optional numeric form field: blank or invalid text
 * means "not set" (null, the parameter is not sent); valid text
 * is clamped into the field's real range. */
function parseOptionalNumber(
  raw: string,
  min: number,
  max: number,
  integer = false,
): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const v = integer ? Math.floor(n) : n;
  return Math.min(max, Math.max(min, v));
}


/* ---- 豆包发送数据诊断 ----
 * Inside the Doubao agent's own settings: everything the space
 * actually sends to Doubao, from the getDoubaoSendData action —
 * the stored Cookie's field names (values never leave the
 * server), the recovered request parameters and their sources,
 * the current model selection, the exact requests the next send
 * will make (built by the same server code that sends, with a
 * placeholder message text), and the last real send's record:
 * per attempt the exact URL + body that went out and the site's
 * real response digest. This is where "what is wrong, and would
 * changing accounts help" is answered from data, not guesses. */
type DoubaoLastSendRecord = {
  at: number;
  outcome: string;
  reuse: boolean;
  attempts: {
    label: string;
    url: string;
    bodyJson: string;
    bodyTruncated: boolean;
    status: number;
    apiError: string;
    responseBytes: number;
    verifyChallenge: boolean;
    verifyScene: string;
    gotReply: boolean;
  }[];
};

function prettyJsonText(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function DoubaoSendDataSection({ agentId }: { agentId: number }) {
  type SendData = ApiResponse<typeof api, "getDoubaoSendData">;
  const [data, setData] = useState<SendData | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadMutation = useMutation({
    mutationFn: async () => await api.getDoubaoSendData({ agentId }),
    onSuccess: (d) => {
      setData(d);
      setLoadError("");
    },
    onError: (e) =>
      setLoadError(e instanceof Error ? e.message : "读取发送数据失败"),
  });
  const lastSend: DoubaoLastSendRecord | null = (() => {
    if (!data?.lastSendJson) return null;
    try {
      const parsed = JSON.parse(data.lastSendJson) as DoubaoLastSendRecord;
      return parsed && Array.isArray(parsed.attempts) ? parsed : null;
    } catch {
      return null;
    }
  })();
  const outcomeText = (o: string) =>
    o === "ok" ? "成功拿到回复" : o === "blocked" ? "被风控拦截（真人验证）" : "失败";
  /* The 推理强度 question, answered from the records themselves
   * (the user asked whether that later-added setting is what
   * makes Doubao refuse): a request body either carries the
   * reasoning_effort field or it does not, and the last send's
   * record shows exactly which bodies went out and what each
   * got back. These facts are computed from the record on every
   * render — nothing here is a canned conclusion. A truncated
   * body cannot support a "field absent" claim, so it is
   * excluded from that check. */
  const bodyCarriesReasoning = (bodyJson: string) =>
    bodyJson.includes("reasoning_effort");
  const bodyCarriesModelSelection = (bodyJson: string) =>
    bodyJson.includes("model_item_key");
  const planAttempts = data?.plan.attempts ?? [];
  const reasoningPlanIdx = planAttempts.findIndex((a) =>
    bodyCarriesReasoning(a.bodyJson),
  );
  const lastVerifyIdx = lastSend
    ? lastSend.attempts.findIndex((a) => a.verifyChallenge)
    : -1;
  const lastVerifyAttempt =
    lastSend && lastVerifyIdx >= 0 ? lastSend.attempts[lastVerifyIdx] : undefined;
  const refusedWithoutReasoning =
    !!lastVerifyAttempt &&
    !lastVerifyAttempt.bodyTruncated &&
    !bodyCarriesReasoning(lastVerifyAttempt.bodyJson) &&
    !bodyCarriesModelSelection(lastVerifyAttempt.bodyJson);
  const reasoningWasSent =
    lastSend?.attempts.some((a) => bodyCarriesReasoning(a.bodyJson)) ?? false;
  const stoppedBeforeRest =
    !!lastSend &&
    lastVerifyIdx >= 0 &&
    planAttempts.length > 0 &&
    lastSend.attempts.length < planAttempts.length;
  const preCls =
    "mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2 font-mono text-[10px] leading-relaxed text-[#3a3a3c]";
  const rowCls = "flex items-baseline justify-between gap-3 py-0.5 text-[12px]";
  return (
    <div className="mt-4 rounded-xl border border-black/[0.06] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">发送数据诊断</span>
        <button
          type="button"
          disabled={loadMutation.isPending}
          onClick={() => loadMutation.mutate()}
          className="shrink-0 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
        >
          {loadMutation.isPending
            ? "读取中…"
            : data
              ? "重新读取"
              : "查看实际发送数据"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
        空间实际发给豆包的全部数据都在这里：请求地址、参数、请求体，以及豆包每次的真实返回。登录
        Cookie 只列字段名，值只保存在服务端、永不回显。判断「换号有没有用」看上次实际发送里豆包的返回：若是风控的真人验证（verify），判定针对的是空间的发送环境、不是账号（已用另一个账号对照实测过，结论相同）；若登录关键字段缺失，则是
        Cookie 没粘完整。每条请求下面都标了它带不带推理强度字段（reasoning_effort），上次发送记录的最后有按那次真实记录算出的核对结论：报错到底是不是推理强度这个设置导致的，看那里。
      </p>
      {loadError && (
        <p role="alert" className="mt-2 text-[12px] leading-relaxed text-[#b3261e]">
          {loadError}
        </p>
      )}
      {data && (
        <div className="mt-2">
          <p className="text-[12px] font-medium">登录 Cookie 字段（共 {data.cookieFieldCount} 个）</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {data.loginFields.map((f) => (
              <span
                key={f.name}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  f.present
                    ? "bg-[#e6f4ea] text-[#137333]"
                    : "bg-[#fce8e6] text-[#b3261e]"
                }`}
              >
                {f.name}：{f.present ? "有" : "缺失"}
              </span>
            ))}
          </div>
          <p className="mt-1 break-all text-[11px] leading-relaxed text-[#9a9aa0]">
            全部字段：{data.cookieFields.join("、")}
          </p>

          <p className="mt-3 text-[12px] font-medium">请求参数（与浏览器对齐）</p>
          <div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">地区 region</span>
              <span>{data.plan.params.region}（来自本智能体自己 Cookie 的地区）</span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">device_id</span>
              <span>
                {data.plan.params.deviceId || "无"}（{data.plan.params.deviceIdSource}）
              </span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">web_id / tea_uuid</span>
              <span>
                {data.plan.params.webIdPresent
                  ? `${data.plan.params.webId}（与 device_id 是两个不同的值）`
                  : "无"}
              </span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">msToken</span>
              <span>
                {data.plan.params.msTokenPresent
                  ? "Cookie 里有（不放进请求 URL）"
                  : "无"}
              </span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">fp（s_v_web_id）</span>
              <span>{data.plan.params.fpPresent ? "有（在 Cookie 里，URL 不带 fp 参数）" : "无"}</span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">客户端版本</span>
              <span>
                version_code {data.plan.params.versionCode} · pc_version{" "}
                {data.plan.params.pcVersion}
              </span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">当前模型选择</span>
              <span>
                模型键 {data.plan.selection.modelKey} · mode_id{" "}
                {data.plan.selection.modeId} · 推理档位 {data.plan.selection.effort} ·
                深度思考门控 {data.plan.selection.gate} · 联网搜索
                {data.plan.selection.search ? "开" : "关"}
              </span>
            </div>
            <div className={rowCls}>
              <span className="text-[#6e6e73]">当前登录状态</span>
              <span>
                {data.webStatus || "未验证"}
                {data.webError ? ` — ${data.webError}` : ""}
              </span>
            </div>
          </div>

          <p className="mt-3 text-[12px] font-medium">
            下一次发送将发出的请求（按顺序，正文处是示例）
          </p>
          {data.plan.attempts.map((a, i) => (
            <div key={i} className="mt-2">
              <p className="text-[12px]">
                {i + 1}. {a.label}
              </p>
              <p className="text-[11px] leading-relaxed text-[#9a9aa0]">
                {bodyCarriesReasoning(a.bodyJson)
                  ? "这条请求体带推理强度字段（reasoning_effort）"
                  : bodyCarriesModelSelection(a.bodyJson)
                    ? "这条请求体不带推理强度字段（reasoning_effort），但带模型选择字段（model_item_key）"
                    : "这条请求体不带推理强度字段（reasoning_effort），也没有模型选择字段（model_item_key）"}
              </p>
              <pre className={preCls}>{a.url}</pre>
              <pre className={preCls}>{prettyJsonText(a.bodyJson)}</pre>
            </div>
          ))}

          <p className="mt-3 text-[12px] font-medium">上次实际发送记录</p>
          {!lastSend ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              还没有发送记录：在任意房间给豆包发一条消息后，这里会记下那次实际发出的全部数据和豆包的真实返回。
            </p>
          ) : (
            <div className="mt-1">
              <p className="text-[12px] leading-relaxed">
                {new Date(lastSend.at).toLocaleString()} · 结果：
                {outcomeText(lastSend.outcome)} ·
                {lastSend.reuse ? "续接了房间的官网对话" : "新开官网对话"}
              </p>
              {lastSend.attempts.map((a, i) => (
                <div key={i} className="mt-2">
                  <p className="text-[12px] leading-relaxed">
                    {i + 1}. {a.label} — HTTP {a.status} · 返回 {a.responseBytes}{" "}
                    字节{a.apiError ? ` · 接口错误：${a.apiError}` : ""}
                    {a.verifyChallenge
                      ? ` · 风控真人验证 verify${a.verifyScene ? `（${a.verifyScene}）` : ""}`
                      : ""}
                    {a.gotReply ? " · 拿到了回复" : ""}
                  </p>
                  <p className="text-[11px] leading-relaxed text-[#9a9aa0]">
                    {a.bodyTruncated
                      ? "这条的记录已截断，字段核对以完整记录为准"
                      : bodyCarriesReasoning(a.bodyJson)
                        ? "这条实际发出的请求体带推理强度字段（reasoning_effort）"
                        : bodyCarriesModelSelection(a.bodyJson)
                          ? "这条实际发出的请求体不带推理强度字段（reasoning_effort），但带模型选择字段（model_item_key）"
                          : "这条实际发出的请求体不带推理强度字段（reasoning_effort），也没有模型选择字段（model_item_key）"}
                  </p>
                  <pre className={preCls}>{a.url}</pre>
                  <pre className={preCls}>
                    {prettyJsonText(a.bodyJson)}
                    {a.bodyTruncated ? "\n…（记录时已截断，实际发送的是完整正文）" : ""}
                  </pre>
                </div>
              ))}
              {lastSend.outcome !== "ok" && (
                <div className="mt-3 rounded-lg bg-black/[0.03] p-2.5">
                  <p className="text-[12px] font-medium">
                    核对：这次报错是不是推理强度设置导致的
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed">
                    上次实际发出了 {lastSend.attempts.length} 条请求
                    {planAttempts.length > 0
                      ? `（按下次发送的计划共 ${planAttempts.length} 条）`
                      : ""}
                    。
                    {refusedWithoutReasoning && (
                      <>
                        被真人验证拦下的是第 {lastVerifyIdx + 1}{" "}
                        条，它实际发出的请求体不带推理强度字段、没有任何模型选择字段——就是和豆包测试空间完全一致的那份
                        plain 请求体。
                        {stoppedBeforeRest &&
                          reasoningPlanIdx >= 0 &&
                          `带推理强度的请求排在第 ${reasoningPlanIdx + 1} 条，第一条被拦下后就停发了，它根本没有发出。`}
                        {!reasoningWasSent &&
                          reasoningPlanIdx < 0 &&
                          "这次发出的请求里没有任何一条带推理强度字段。"}
                      </>
                    )}
                    {lastVerifyIdx >= 0 && !refusedWithoutReasoning && (
                      <>
                        这次被真人验证拦下的请求体带有推理强度字段，仅凭这条记录不能排除它的影响；但发送顺序里排在它前面的请求同样没能通过，结果见上面逐条记录。
                      </>
                    )}
                    {lastVerifyIdx < 0 && !reasoningWasSent && (
                      <>
                        这次发出的请求没有任何一条带推理强度字段，但仍然失败了——失败与推理强度无关，具体原因看上面逐条记录里豆包的真实返回。
                      </>
                    )}
                    {lastVerifyIdx < 0 && reasoningWasSent && (
                      <>
                        这次没有出现真人验证判定；带推理强度的请求也实际发出了，它的结果见上面逐条记录。
                      </>
                    )}
                  </p>
                  {refusedWithoutReasoning && (
                    <p className="mt-1 text-[12px] leading-relaxed">
                      结论：不是推理强度导致的。豆包拦下这条请求时，请求里根本没有这个设置；把模型设置改回只有快速
                      / 专家、删掉推理强度，实际发出的第一条请求体和这次被拦下的完全相同，结果不会变。下一步按「指导日志」里这条记录的指引做：在自己浏览器里完成验证、换一份新鲜 Cookie 再发一条，不要连发。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- 豆包指导日志 ----
 * Next to 发送数据诊断 in the Doubao agent's settings: the last
 * 20 sends, one entry each, from the getDoubaoSendLog action.
 * Every entry states what actually happened (outcome, HTTP
 * status, response size, Doubao's own error code, verify/shark
 * flags, how many candidate text segments the parser found) and
 * — the point of the section — one plain-language guidance line
 * saying what to do next, derived server-side from that entry's
 * outcome and error code. The response summary is expandable
 * per entry; it is a capped excerpt, never the whole body, and
 * no Cookie value is ever part of the log. */
function DoubaoGuidanceLogSection({ agentId }: { agentId: number }) {
  type SendLog = ApiResponse<typeof api, "getDoubaoSendLog">;
  const [data, setData] = useState<SendLog | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadMutation = useMutation({
    mutationFn: async () => await api.getDoubaoSendLog({ agentId }),
    onSuccess: (d) => {
      setData(d);
      setLoadError("");
    },
    onError: (e) =>
      setLoadError(e instanceof Error ? e.message : "读取指导日志失败"),
  });
  const outcomeLabel = (o: string) =>
    o === "replied"
      ? "已回复"
      : o === "rejected"
        ? "被拒绝"
        : o === "unparsed"
          ? "未解析出文字"
          : o === "blocked"
            ? "风控拦截"
            : o === "network_error"
              ? "网络出错"
              : o === "cookie_invalid"
                ? "Cookie 字段非法（未发出）"
                : o;
  const preCls =
    "mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2 font-mono text-[10px] leading-relaxed text-[#3a3a3c]";
  return (
    <div className="mt-4 rounded-xl border border-black/[0.06] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">指导日志</span>
        <button
          type="button"
          disabled={loadMutation.isPending}
          onClick={() => loadMutation.mutate()}
          className="shrink-0 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
        >
          {loadMutation.isPending
            ? "读取中…"
            : data
              ? "重新读取"
              : "查看指导日志"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
        每次给豆包发消息，这里都会记下一条：结果如何、豆包返回了什么、解析出了多少段候选文本，并按结果给出一句下一步该怎么做的指引。保留最近
        20 条；日志只记发送结果和响应摘要（不存完整响应体），绝不记录 Cookie 的值。
      </p>
      {loadError && (
        <p role="alert" className="mt-2 text-[12px] leading-relaxed text-[#b3261e]">
          {loadError}
        </p>
      )}
      {data && data.entries.length === 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-[#9a9aa0]">
          还没有记录：在任意房间给豆包发一条消息后，这里会出现第一条。
        </p>
      )}
      {data &&
        data.entries.map((e) => (
          <div
            key={e.id}
            className="mt-2 rounded-lg border border-black/[0.05] p-2.5"
          >
            <p className="text-[12px] leading-relaxed">
              {new Date(e.at).toLocaleString()} · {outcomeLabel(e.outcome)}
              {e.httpStatus != null ? ` · HTTP ${e.httpStatus}` : ""} ·{" "}
              {e.responseBytes} 字节
              {e.errorCode != null
                ? ` · 错误码 ${e.errorCode}${e.errorMsg ? `（${e.errorMsg}）` : ""}`
                : e.errorMsg
                  ? ` · ${e.errorMsg}`
                  : ""}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[#6e6e73]">
              关键字：{e.hasVerify ? "含 verify" : "无 verify"} ·{" "}
              {e.hasShark ? "含 shark" : "无 shark"} · 解析出{" "}
              {e.candidateCount} 段候选文本（扫描 {e.payloadCount}{" "}
              个数据载荷）
            </p>
            <p className="mt-1 rounded-lg bg-[#e6f4ea] px-2 py-1.5 text-[12px] leading-relaxed text-[#137333]">
              指引：{e.guidance}
            </p>
            {e.summary && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] text-[#6e6e73]">
                  响应摘要
                </summary>
                <pre className={preCls}>{e.summary}</pre>
              </details>
            )}
          </div>
        ))}
    </div>
  );
}

function AgentPanel({
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial: Agent | null;
  onClose: () => void;
  onSaved: (agentId: number, conversationId: number | null) => void;
  onDeleted: (agentId: number) => void;
}) {
  const queryClient = useQueryClient();
  const editing = initial !== null;
  const nameManualRef = useRef(editing);
  const [form, setForm] = useState<AgentForm>(() =>
    initial ? formFromAgent(initial) : defaultAgentForm(),
  );
  // The 高级 API 参数 section starts collapsed, except when the
  // agent being edited already has advanced values saved.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(
    () => initial != null && agentHasAdvanced(initial),
  );
  const [testModels, setTestModels] = useState<string[] | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [saveError, setSaveError] = useState("");
  // The footer's 删除智能体 button first flips the footer into its
  // confirmation state (the deletion is permanent and takes every
  // conversation with the agent along); only 确认删除 calls the
  // server. Reset whenever the panel's target changes.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // DeepSeek web-login state for the form: the pasted token lives
  // only in this input (never seeded from the server — the stored
  // token is never echoed back) and is sent solely to the verify
  // action; the displayed login state starts from the saved facts.
  const [webTokenInput, setWebTokenInput] = useState("");
  const [webState, setWebState] = useState<{ status: string; account: string; error: string }>({
    status: initial?.webStatus ?? "",
    account: initial?.webAccount ?? "",
    error: initial?.webError ?? "",
  });
  const avatarDraft = useAvatarDraft(initial?.avatarUrl ?? null);
  // 豆包's detected account menu （识别可用模型）: starts from
  // the agent's stored snapshot; a successful detection replaces
  // it in place so the model list below re-renders from the
  // account's real menu without reopening the panel.
  const [menuState, setMenuState] = useState<DoubaoMenu | null>(
    initial?.webMenu ?? null,
  );
  const [menuNote, setMenuNote] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const detectMenuMutation = useMutation({
    mutationFn: async () =>
      await api.detectDoubaoModels({ agentId: initial?.id ?? 0 }),
    onSuccess: (data) => {
      setMenuState(data.menu);
      setMenuNote({
        ok: true,
        text: `已按该账号的官网菜单识别到 ${data.menu.models.length} 个模型，列表已更新`,
      });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) => {
      setMenuNote({
        ok: false,
        text: err instanceof Error ? err.message : "识别失败，请稍后再试",
      });
    },
  });

  // Deterministic reset: whenever the panel's target changes (a
  // different agent to edit, or a fresh "add" opening), every field —
  // and the connection-test state — goes back to that target's saved
  // values or, for adding, to blank/default values. This does not
  // rely on the panel unmounting between openings.
  const initialId = initial?.id ?? null;
  useEffect(() => {
    setForm(initial ? formFromAgent(initial) : defaultAgentForm());
    setShowAdvanced(initial != null && agentHasAdvanced(initial));
    nameManualRef.current = initial !== null;
    setTestModels(null);
    setTestNote(null);
    setSaveError("");
    setConfirmDelete(false);
    setDeleteError("");
    setWebTokenInput("");
    setWebState({
      status: initial?.webStatus ?? "",
      account: initial?.webAccount ?? "",
      error: initial?.webError ?? "",
    });
    setMenuState(initial?.webMenu ?? null);
    setMenuNote(null);
    avatarDraft.reset(initial?.avatarUrl ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  const provider =
    PROVIDERS.find((p) => p.id === form.provider) ??
    PROVIDERS[PROVIDERS.length - 1];
  const modelCandidates = testModels ?? provider?.models ?? [];

  function set<K extends keyof AgentForm>(key: K, value: AgentForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function pickProvider(id: string) {
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => ({
      ...f,
      provider: p.id,
      apiBase: p.base,
      name: nameManualRef.current ? f.name : p.label,
      glyph: nameManualRef.current ? f.glyph : p.glyph,
      color: nameManualRef.current ? f.color : p.color,
      model:
        f.model.trim() === "" || (provider?.models ?? []).includes(f.model)
          ? (p.models[0] ?? f.model)
          : f.model,
    }));
    setTestModels(null);
    setTestNote(null);
  }

  const webMeta = webSiteMeta(form.provider);
  // 豆包's model menu in this panel: the account's detected
  // catalog (menuState) or the fallback list, the form's
  // current pick resolved against it.
  const doubaoModels = doubaoModelsOf(menuState);
  const doubaoKey = doubaoSelectedKeyOf(form);
  const doubaoEntry = doubaoEntryOf(doubaoModels, doubaoKey);

  /** Switching the web site re-points the agent at that site's
   * adapter: provider, default identity and model follow the site
   * (unless the user already named the agent by hand), and any
   * typed/shown token state resets — one site's token means
   * nothing to another. */
  function pickWebSite(id: string) {
    const s = WEB_SITES[id];
    if (!s) return;
    setForm((f) => ({
      ...f,
      provider: id,
      name: nameManualRef.current ? f.name : s.name,
      glyph: nameManualRef.current ? f.glyph : s.glyph,
      color: nameManualRef.current ? f.color : s.color,
      model: s.models?.[0] ?? f.model,
      // The new site's own chat options start at that site's web
      // defaults — one site's mode/switches mean nothing to
      // another, so they never carry over.
      webMode: s.defaultMode ?? "",
      webThinking: false,
      webSearch: false,
      webModel: "",
      webModelKey: "",
      webReasoning: "",
    }));
    setWebTokenInput("");
    setWebState({ status: "", account: "", error: "" });
    setMenuState(null);
    setMenuNote(null);
  }

  const testMutation = useMutation({
    mutationFn: async () =>
      await api.testAgentConnection({
        agentId: initial?.id ?? null,
        apiBase: form.apiBase.trim(),
        apiKey: form.apiKey,
        model: form.model.trim(),
      }),
    onSuccess: (r) => {
      if (r.ok) {
        setTestModels(r.models);
        setTestNote({
          ok: true,
          text: `${r.detail}（延迟 ${r.latencyMs} ms）`,
        });
      } else {
        setTestNote({ ok: false, text: r.detail });
      }
    },
    onError: (err) =>
      setTestNote({
        ok: false,
        text: `测试请求未能完成：${err instanceof Error ? err.message : "网络错误"}`,
      }),
  });

  const verifyWebMutation = useMutation({
    mutationFn: async () =>
      await api.verifyWebToken({
        agentId: initial?.id ?? 0,
        token: webTokenInput,
      }),
    onSuccess: (r) => {
      setWebState({ status: r.status, account: r.account, error: r.error });
      if (r.ok) setWebTokenInput("");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) =>
      setWebState((s) => ({
        ...s,
        error: `验证请求未能完成：${err instanceof Error ? err.message : "网络错误"}`,
      })),
  });

  const webStatusLine = !editing
    ? null
    : webState.status === "logged_in"
      ? {
          text: `已登录${webState.account ? ` · ${webState.account}` : ""}`,
          cls: "text-[#3d7a1e]",
        }
      : webState.status === "expired"
        ? {
            text: `令牌已过期${webState.error ? `：${webState.error}` : ""}`,
            cls: "text-[#c0392b]",
          }
        : webState.status === "blocked"
          ? {
              text: `被网页端拦截${webState.error ? `：${webState.error}` : ""}`,
              cls: "text-[#c0392b]",
            }
          : webState.status === "error"
            ? {
                text: `验证失败${webState.error ? `：${webState.error}` : ""}`,
                cls: "text-[#c0392b]",
              }
            : { text: "尚未登录", cls: "text-[#9a9aa0]" };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim(),
        color: form.color,
        glyph: form.glyph.trim(),
        enabled: form.enabled,
        provider: form.provider,
        apiBase: form.apiBase.trim(),
        apiKey: form.apiKey,
        model: form.model.trim(),
        temperature: form.temperature,
        maxTokens: Math.min(
          32768,
          Math.max(1, Math.floor(Number(form.maxTokens) || 4096)),
        ),
        thinking: form.thinking as (typeof THINKING_LEVELS)[number],
        topP: parseOptionalNumber(form.topP, 0, 1),
        frequencyPenalty: parseOptionalNumber(form.frequencyPenalty, -2, 2),
        presencePenalty: parseOptionalNumber(form.presencePenalty, -2, 2),
        seed: parseOptionalNumber(form.seed, -2147483648, 2147483647, true),
        stopSequences: form.stopSequences.trim(),
        responseFormat: form.responseFormat as "" | "text" | "json_object",
        maxCompletionTokens: parseOptionalNumber(
          form.maxCompletionTokens,
          1,
          131072,
          true,
        ),
        streamEnabled: form.streamEnabled,
        toolMode: form.toolMode as "" | "auto" | "required" | "none",
        webDeviceId: form.webDeviceId,
        webMode: (webSiteMeta(form.provider).modes?.some(
          (m) => m.value === form.webMode,
        )
          ? form.webMode
          : (webSiteMeta(form.provider).defaultMode ?? "")) as
          | ""
          | "default"
          | "expert"
          | "fast",
        webThinking: form.webThinking,
        webSearch: form.webSearch,
        // The model-menu selection rides along for 豆包 (the
        // server normalises it away for every other provider
        // and re-derives 豆包's stored mode from it).
        webModel: form.provider === "doubao" ? form.webModel : "",
        webModelKey: form.provider === "doubao" ? form.webModelKey : "",
        webReasoning: form.provider === "doubao" ? form.webReasoning : "",
        systemPrompt: form.systemPrompt,
        memory: form.memory,
        note: form.note.trim(),
        connectionType: form.connectionType as "api" | "web",
        avatarImage: avatarDraft.image,
        removeAvatar: avatarDraft.removed,
      };
      if (initial) {
        await api.updateAgent({ agentId: initial.id, ...payload });
        return { id: initial.id, conversationId: null as number | null };
      }
      const res = await api.createAgent(payload);
      return { id: res.id, conversationId: res.conversationId as number | null };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onSaved(res.id, res.conversationId);
    },
    onError: (err) =>
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  // Permanent deletion (edit mode only — a not-yet-created agent
  // has nothing to delete): the server removes the agent together
  // with all of its conversations and messages. On success the
  // parent is told which agent went away (so an open room with it
  // can be closed) and the panel closes.
  const deleteMutation = useMutation({
    mutationFn: async () =>
      await api.deleteAgent({ agentId: initial?.id ?? 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (initial) onDeleted(initial.id);
      onClose();
    },
    onError: (err) =>
      setDeleteError(
        `删除失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  const inputCls =
    "w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm outline-none placeholder:text-[#9a9aa0]";
  const labelCls = "mb-1 block text-xs font-medium text-[#6e6e73]";

  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "智能体设置" : "添加 Agent"}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
          <h3 className="text-base font-semibold">
            {editing ? "智能体设置" : "添加 Agent"}
          </h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
          >
            <Icon d={PATHS.x} size={17} />
          </button>
        </div>
        <div data-modal-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-5">
          <div className="flex items-center gap-3">
            <AvatarEditor
              size={56}
              label="更换智能体头像图片"
              previewUrl={avatarDraft.previewUrl}
              onPick={avatarDraft.pick}
              onRemove={avatarDraft.remove}
            >
              <AgentAvatar
                color={form.color}
                glyph={form.glyph}
                name={form.name}
                size={56}
                logo={
                  initial
                    ? vendorLogoFor({
                        provider: form.provider,
                        connectionType: form.connectionType,
                        glyph: form.glyph,
                        color: form.color,
                        configured: initial.configured,
                        avatarUrl: avatarDraft.previewUrl,
                      })
                    : null
                }
              />
            </AvatarEditor>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {form.name || "未命名智能体"}
              </p>
              <p className="truncate text-[13px] text-[#9a9aa0]">
                {form.role || "未设置角色"}
                {form.model ? ` · ${form.model}` : ""}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              aria-label="启用该智能体"
              onClick={() => set("enabled", !form.enabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                form.enabled ? "bg-[#34c759]" : "bg-black/[0.15]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  form.enabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {avatarDraft.error && (
            <p role="alert" className="mt-2 text-[13px] text-[#c0392b]">
              {avatarDraft.error}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="agent-name">
                名称
              </label>
              <input
                id="agent-name"
                {...FIELDS.createAgent.name}
                className={inputCls}
                value={form.name}
                onChange={(e) => {
                  nameManualRef.current = true;
                  set("name", e.target.value);
                }}
                placeholder="智能体名称"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="agent-role">
                角色
              </label>
              <input
                id="agent-role"
                {...FIELDS.createAgent.role}
                className={inputCls}
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                placeholder="如：编程助手"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-note">
              备注
            </label>
            <input
              id="agent-note"
              {...FIELDS.createAgent.note}
              className={inputCls}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="只给自己看，显示在智能体列表里，不会发给智能体"
              autoComplete="off"
            />
          </div>

          <div className="mt-3">
            <span className={labelCls}>头像颜色</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {AGENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`头像颜色 ${c}`}
                  aria-pressed={form.color === c}
                  onClick={() => set("color", c)}
                  className={`h-7 w-7 rounded-full ${
                    form.color === c
                      ? "ring-2 ring-[#191919] ring-offset-2"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="自定义头像颜色"
                value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#5d6a82"}
                onChange={(e) => set("color", e.target.value)}
                className="h-7 w-9 cursor-pointer rounded bg-transparent"
              />
              <input
                aria-label="头像颜色代码"
                {...FIELDS.createAgent.color}
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
                spellCheck={false}
                className="w-24 rounded-[8px] bg-[#f0f0f2] px-2 py-1.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="mt-3">
            <span className={labelCls}>登录方式</span>
            <div className="flex gap-2" role="group" aria-label="登录方式">
              <button
                type="button"
                aria-pressed={form.connectionType !== "web"}
                onClick={() => set("connectionType", "api")}
                className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                  form.connectionType !== "web"
                    ? "bg-[#2f6bff] text-white"
                    : "bg-[#f0f0f2] text-[#3a3a3c]"
                }`}
              >
                接口 API
              </button>
              <button
                type="button"
                aria-pressed={form.connectionType === "web"}
                onClick={() => {
                  set("connectionType", "web");
                  if (!WEB_SITES[form.provider]) pickWebSite("deepseek");
                  else if (
                    form.provider === "deepseek" &&
                    form.webMode !== "default" &&
                    form.webMode !== "expert"
                  )
                    set("webMode", "default");
                }}
                className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                  form.connectionType === "web"
                    ? "bg-[#2f6bff] text-white"
                    : "bg-[#f0f0f2] text-[#3a3a3c]"
                }`}
              >
                网页令牌
              </button>
            </div>
          </div>

          {form.connectionType === "web" ? (
            <>
              <div className="mt-3">
                <label className={labelCls} htmlFor="agent-web-site">
                  站点
                </label>
                <select
                  id="agent-web-site"
                  className={inputCls}
                  value={WEB_SITES[form.provider] ? form.provider : "deepseek"}
                  onChange={(e) => pickWebSite(e.target.value)}
                >
                  {Object.entries(WEB_SITES).map(([id, s]) => (
                    <option key={id} value={id}>
                      {s.label}（{s.site}）
                    </option>
                  ))}
                </select>
              </div>

              {form.provider === "doubao" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={labelCls}>模型</span>
                    {editing ? (
                      <button
                        type="button"
                        aria-label="识别可用模型"
                        disabled={detectMenuMutation.isPending}
                        onClick={() => detectMenuMutation.mutate()}
                        className="flex min-h-0 shrink-0 items-center gap-1 rounded-full bg-[#e8effd] px-2.5 py-1 text-[11px] font-medium text-[#1664ff] transition-colors disabled:opacity-50"
                      >
                        <Icon d={PATHS.refresh} size={11} />
                        {detectMenuMutation.isPending
                          ? "识别中…"
                          : "识别可用模型"}
                      </button>
                    ) : null}
                  </div>
                  <div
                    className="overflow-hidden rounded-[10px] bg-[#f7f7f8]"
                    role="group"
                    aria-label="豆包模型"
                  >
                    {(["1", "3"] as const).map((modeId) => {
                      const group = doubaoModels.filter(
                        (m) => m.modeId === modeId,
                      );
                      if (!group.length) return null;
                      return (
                        <div key={modeId}>
                          <p className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-[#9a9aa0]">
                            {modeId === "1" ? "对话" : "工作任务"}
                          </p>
                          {group.map((m) => {
                            if (m.needUpgrade) {
                              return (
                                <div
                                  key={m.key}
                                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[#9a9aa0]"
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {m.name}
                                  </span>
                                  {m.tags[0] && (
                                    <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px]">
                                      {m.tags[0]}
                                    </span>
                                  )}
                                  <span className="shrink-0 rounded-full bg-[#fce8e6] px-1.5 py-0.5 text-[10px] text-[#b3261e]">
                                    需开通会员
                                  </span>
                                </div>
                              );
                            }
                            const active = doubaoKey === m.key;
                            return (
                              <button
                                key={m.key}
                                type="button"
                                aria-pressed={active}
                                aria-label={`模型 ${m.name}`}
                                onClick={() => {
                                  set("webModelKey", m.key);
                                  set(
                                    "webReasoning",
                                    doubaoReasoningOnModelPick(
                                      m,
                                      form.webReasoning,
                                    ),
                                  );
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                                  active
                                    ? "bg-[#e8effd] font-medium text-[#1664ff]"
                                    : "text-[#3a3a3c] active:bg-black/[0.04]"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {m.name}
                                </span>
                                {m.tags[0] && (
                                  <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-[#6e6e73]">
                                    {m.tags[0]}
                                  </span>
                                )}
                                {active && <Icon d={PATHS.check} size={15} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {menuNote && (
                    <p
                      className={`mt-1 text-[11px] leading-relaxed ${
                        menuNote.ok ? "text-[#137333]" : "text-[#b3261e]"
                      }`}
                    >
                      {menuNote.text}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    {menuState
                      ? `列表来自该账号官网菜单的识别结果${initial?.webMenuAt ? `（识别于 ${new Date(initial.webMenuAt).toLocaleString()}）` : ""}：模型、分组、档位和会员门槛都以豆包下发给这个账号的配置为准。`
                      : "当前是豆包菜单的通用列表；保存令牌并验证登录后，点「识别可用模型」会读取该账号自己的官网菜单配置，换成这个账号真实可用的模型和档位（包括哪些需要会员）。"}
                    对话里的快速 /
                    专家是普通对话的模型；工作任务的模型本要在豆包云端环境运行。这份选择按官网格式完整写进直连请求的模型选择包（该模型自己的
                    mode_id、参数与推理强度档位），在发送的第二条请求体里发出（第一条先用改版前的请求体，顺序与每次实际发出的完整数据见下方「发送数据诊断」）；切换选择后下一条回复会新开一个官网对话按新选择发送。对话通道上最终由哪个模型回答由豆包按账号权益决定，回复里没有可验证的标记。
                  </p>
                  <span className={`${labelCls} mt-3`}>推理强度</span>
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="推理强度"
                  >
                    {doubaoEntry.levels.map((l) => {
                      const value = String(l.level);
                      const active =
                        doubaoReasoningValueOf(form.webReasoning, doubaoEntry) ===
                        value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          aria-label={`推理强度 ${l.name}`}
                          onClick={() => set("webReasoning", value)}
                          className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                            active
                              ? "bg-[#2f6bff] text-white"
                              : "bg-[#f0f0f2] text-[#3a3a3c]"
                          }`}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    档位来自所选模型在账号配置里的
                    reasoning_effort_config（每个模型自己的档位不完全一样），并决定深度思考开关：档位
                    4 以上 = 开，快速模型本身不思考（实测开时回复会先进入思考阶段）。保存后每次回复都按所选模型和推理强度发；豆包最终按哪个模型回答还取决于账号权益，回复里没有可验证的标记。这个字段只出现在发送顺序的第二条请求体里；第一条是和豆包测试空间完全一致的 plain 请求体、不带它。任一条出现真人验证要求就停发，所以若第一条被拦下、第二条根本没发出，报错就与这个设置无关，逐条核对见下方「发送数据诊断」末尾的核对结论，每次发送的结果和下一步建议见「指导日志」。
                  </p>
                </div>
              )}

              {webMeta.modes && form.provider !== "doubao" && (
                <div className="mt-3">
                  <span className={labelCls}>
                    {form.provider === "deepseek" ? "模式（模型）" : "聊天模式"}
                  </span>
                  <div
                    className="flex gap-2"
                    role="group"
                    aria-label={form.provider === "deepseek" ? "DeepSeek 模式" : "豆包聊天模式"}
                  >
                    {webMeta.modes.map((m) => {
                      const active =
                        (form.webMode || webMeta.defaultMode) === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => set("webMode", m.value)}
                          className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                            active
                              ? "bg-[#2f6bff] text-white"
                              : "bg-[#f0f0f2] text-[#3a3a3c]"
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    {webMeta.modes.find(
                      (m) => m.value === (form.webMode || webMeta.defaultMode),
                    )?.hint ?? ""}
                    {form.provider === "deepseek"
                      ? "。这是 DeepSeek 网页接口的模式参数：当前网页版界面已把模式按钮合并成一个，但接口仍按这个参数区分快速与专家，保存后每次回复都按这个模式发。"
                      : "。这是豆包网页版自己的模式切换，保存后每次回复都按这个模式发。"}
                  </p>
                </div>
              )}

              {webMeta.hasThinkingToggle && (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">深度思考</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#9a9aa0]">
                      DeepSeek 网页版的独立开关，和上面的模式互不影响，可以同时开。开启后它会先深度推理再回答。
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.webThinking}
                    aria-label="深度思考"
                    onClick={() => set("webThinking", !form.webThinking)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                      form.webThinking ? "bg-[#34c759]" : "bg-black/[0.15]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                        form.webThinking ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}

              {webMeta.searchLabel && (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">{webMeta.searchLabel}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#9a9aa0]">
                      {webMeta.searchHint ?? ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.webSearch}
                    aria-label={webMeta.searchLabel}
                    onClick={() => set("webSearch", !form.webSearch)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                      form.webSearch ? "bg-[#34c759]" : "bg-black/[0.15]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                        form.webSearch ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}

              <div className="mt-3">
                <label className={labelCls} htmlFor="agent-web-token">
                  网页登录令牌
                </label>
                <input
                  id="agent-web-token"
                  {...FIELDS.verifyWebToken.token}
                  className={inputCls}
                  type="password"
                  value={webTokenInput}
                  onChange={(e) => setWebTokenInput(e.target.value)}
                  placeholder={`粘贴 ${webMeta.site} 的登录令牌`}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                  {webMeta.tokenHelp}
                  令牌只保存在服务端，页面上永不回显；留空点「验证登录」会验证已保存的令牌。
                </p>
                {webMeta.chatNote && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    {webMeta.chatNote}
                  </p>
                )}
              </div>

              {initial && form.provider === "qwen" && (
                <div className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2.5">
                  <p className="text-[12px] font-medium">凭证对齐状态</p>
                  <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-[#6e6e73]">
                    <li>
                      访问令牌：
                      {initial.webStatus === "logged_in"
                        ? "已保存，验证通过"
                        : initial.webStatus === "expired"
                          ? "已保存，但已过期——重新导出整段凭证再粘贴"
                          : "以「验证登录」的结果为准"}
                    </li>
                    <li>
                      Cookie：
                      {form.webCookieSet
                        ? "已保存，调用时随令牌一起发送"
                        : "未保存——粘贴控制台导出的整段 JSON 后会自动保存"}
                    </li>
                    <li className="break-all">
                      User-Agent：
                      {form.webUserAgent
                        ? `已保存，调用时与浏览器保持一致（${form.webUserAgent}）`
                        : "未保存——调用时使用服务端通用 UA"}
                    </li>
                  </ul>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#9a9aa0]">
                    出口 IP 由服务端网络决定，无法与提取凭证的浏览器保持一致；三项都对齐后仍被拒绝时，通常是令牌已过期或出口
                    IP 被风控，重新导出一份新凭证再试。
                  </p>
                </div>
              )}

              {form.provider === "doubao" && (
                <div className="mt-3">
                  <label className={labelCls} htmlFor="agent-web-device-id">
                    设备号 device_id（豆包发消息需要）
                  </label>
                  <input
                    id="agent-web-device-id"
                    {...FIELDS.createAgent.webDeviceId}
                    className={inputCls}
                    value={form.webDeviceId}
                    onChange={(e) => set("webDeviceId", e.target.value)}
                    placeholder="从你自己浏览器的请求网址里复制那串数字"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    直连发送时作为 device_id
                    参数一起发出；留空时会尝试从豆包页面里恢复，恢复不到就不带（发送数据诊断里会如实标明来源）。每个豆包智能体单独保存自己的设备号：给这个智能体填，只影响它自己，不会改动另一个豆包智能体的。在电脑浏览器登录这个智能体对应的豆包账号后，按 F12 打开开发者工具，点「网络」，点任意一条
                    doubao.com 的请求，看它的请求网址里 device_id=
                    后面那串数字，复制填到这里（也可以直接把整条请求网址粘贴进来，会自动提取）。
                  </p>
                </div>
              )}

              {initial && form.provider === "doubao" && (
                <DoubaoSendDataSection agentId={initial.id} />
              )}

              {initial && form.provider === "doubao" && (
                <DoubaoGuidanceLogSection agentId={initial.id} />
              )}

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  disabled={!editing || verifyWebMutation.isPending}
                  onClick={() => verifyWebMutation.mutate()}
                  className="shrink-0 rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {verifyWebMutation.isPending ? "验证中…" : "验证登录"}
                </button>
                {webStatusLine && (
                  <p
                    role="status"
                    className={`min-w-0 text-[13px] leading-relaxed ${webStatusLine.cls}`}
                  >
                    {webStatusLine.text}
                  </p>
                )}
              </div>
              {!editing && (
                <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
                  先点下方保存这个智能体，再回到它的设置里粘贴令牌并验证登录。
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
                这是调用该站网页端的非官方方式：可能因网页改版失效，也有账号风控风险；令牌过期后重新粘贴新令牌即可，这里不会显示编造的有效期。
              </p>
            </>
          ) : (
            <>
          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-provider">
              服务商
            </label>
            <select
              id="agent-provider"
              className={inputCls}
              value={form.provider}
              onChange={(e) => pickProvider(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-base">
              API 地址
            </label>
            <input
              id="agent-base"
              {...FIELDS.createAgent.apiBase}
              className={inputCls}
              value={form.apiBase}
              onChange={(e) => set("apiBase", e.target.value)}
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-key">
              API Key（密钥）
            </label>
            <input
              id="agent-key"
              {...FIELDS.createAgent.apiKey}
              className={inputCls}
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={
                initial?.hasApiKey
                  ? "已保存，不显示；留空则不修改"
                  : "粘贴该服务商的 API Key"
              }
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              密钥只保存在服务端，页面上永不回显。
            </p>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-model">
              模型
            </label>
            <div className="flex gap-2">
              <input
                id="agent-model"
                {...FIELDS.createAgent.model}
                className={inputCls}
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="填写真实的模型 id"
                autoComplete="off"
                spellCheck={false}
              />
              {modelCandidates.length > 0 && (
                <select
                  aria-label="从模型列表选择"
                  className="w-32 shrink-0 rounded-[10px] bg-[#f0f0f2] px-2 py-2 text-sm outline-none"
                  value={
                    modelCandidates.includes(form.model) ? form.model : ""
                  }
                  onChange={(e) => {
                    if (e.target.value) set("model", e.target.value);
                  }}
                >
                  <option value="">列表选择…</option>
                  {modelCandidates.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              {testModels
                ? "上方列表是测试连接时接口实时返回的模型。"
                : "列表来自服务商目录（按新旧排序）；点「测试连接」可获取接口实时返回的模型列表。"}
            </p>
          </div>

          <div className="mt-3">
            <button
              type="button"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
              className="rounded-xl bg-black/[0.05] px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {testMutation.isPending ? "正在连接…" : "测试连接"}
            </button>
            {testNote && (
              <p
                role="status"
                className={`mt-2 text-[13px] leading-relaxed ${
                  testNote.ok ? "text-[#3d7a1e]" : "text-[#c0392b]"
                }`}
              >
                {testNote.text}
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-black/[0.06] pt-3">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-left"
            >
              <span className="text-sm font-medium">高级 API 参数</span>
              <span
                className={`text-[#9a9aa0] transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              >
                <Icon d={PATHS.chevronRight} size={16} />
              </span>
            </button>
            {showAdvanced && (
              <div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                  以下参数留空就是不设置，请求里不会带上，由服务商用它自己的默认值。某个参数被接口拒绝时，会自动去掉全部高级参数重试一次，不会因此没回复。
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="agent-top-p">
                      Top P（0–1）
                    </label>
                    <input
                      id="agent-top-p"
                      {...FIELDS.createAgent.topP}
                      className={inputCls}
                      inputMode="decimal"
                      value={form.topP}
                      onChange={(e) => set("topP", e.target.value)}
                      placeholder="不设置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="agent-seed">
                      随机种子 Seed
                    </label>
                    <input
                      id="agent-seed"
                      {...FIELDS.createAgent.seed}
                      className={inputCls}
                      inputMode="numeric"
                      value={form.seed}
                      onChange={(e) => set("seed", e.target.value)}
                      placeholder="不设置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="agent-freq-penalty">
                      频率惩罚（-2–2）
                    </label>
                    <input
                      id="agent-freq-penalty"
                      {...FIELDS.createAgent.frequencyPenalty}
                      className={inputCls}
                      inputMode="decimal"
                      value={form.frequencyPenalty}
                      onChange={(e) => set("frequencyPenalty", e.target.value)}
                      placeholder="不设置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="agent-pres-penalty">
                      存在惩罚（-2–2）
                    </label>
                    <input
                      id="agent-pres-penalty"
                      {...FIELDS.createAgent.presencePenalty}
                      className={inputCls}
                      inputMode="decimal"
                      value={form.presencePenalty}
                      onChange={(e) => set("presencePenalty", e.target.value)}
                      placeholder="不设置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="agent-max-completion">
                      最大完成 tokens
                    </label>
                    <input
                      id="agent-max-completion"
                      {...FIELDS.createAgent.maxCompletionTokens}
                      className={inputCls}
                      inputMode="numeric"
                      value={form.maxCompletionTokens}
                      onChange={(e) => set("maxCompletionTokens", e.target.value)}
                      placeholder="不设置"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="agent-response-format">
                      输出格式
                    </label>
                    <select
                      id="agent-response-format"
                      className={inputCls}
                      value={form.responseFormat}
                      onChange={(e) => set("responseFormat", e.target.value)}
                    >
                      <option value="">不设置</option>
                      <option value="json_object">JSON 对象</option>
                      <option value="text">纯文本</option>
                    </select>
                  </div>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                  最大完成 tokens 是推理模型用的新参数：填了之后会代替上面的「最大 tokens」发送（二选一）。
                </p>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="agent-stop">
                    停止序列 Stop
                  </label>
                  <input
                    id="agent-stop"
                    {...FIELDS.createAgent.stopSequences}
                    className={inputCls}
                    value={form.stopSequences}
                    onChange={(e) => set("stopSequences", e.target.value)}
                    placeholder="如 END### —— 多个用逗号或换行分隔，最多 4 个"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">流式输出（stream）</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#9a9aa0]">
                      开启后请求带 stream 参数，回复会边生成边出现，不用等整段写完；生成失败时，未写完的内容会被清掉，不会留下半截回复。
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.streamEnabled}
                    aria-label="流式输出"
                    onClick={() => set("streamEnabled", !form.streamEnabled)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                      form.streamEnabled ? "bg-[#34c759]" : "bg-black/[0.15]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                        form.streamEnabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="agent-tool-mode">
                    工具调用（tools）
                  </label>
                  <select
                    id="agent-tool-mode"
                    className={inputCls}
                    value={form.toolMode}
                    onChange={(e) => set("toolMode", e.target.value)}
                  >
                    <option value="">不启用</option>
                    <option value="auto">自动（模型自行决定）</option>
                    <option value="required">必须调用工具</option>
                    <option value="none">禁止调用工具</option>
                  </select>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    启用后，请求会带上空间内置的三个工具：当前时间、计算器、打开网页。模型决定调用时，空间会真的执行，把结果发回给它再继续回答（每条回复最多连续调用 5
                    轮）；选「禁止调用」是带着工具但明确不许它用。部分模型或网关不支持工具调用，被拒绝时会自动去掉高级参数重试一次。
                  </p>
                </div>
              </div>
            )}
          </div>
            </>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="agent-temp">
                温度 · {form.temperature.toFixed(1)}
              </label>
              <input
                id="agent-temp"
                {...FIELDS.createAgent.temperature}
                type="range"
                aria-label="温度"
                step={0.1}
                value={form.temperature}
                onChange={(e) => set("temperature", Number(e.target.value))}
                className="w-full accent-[#2f6bff]"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="agent-max-tokens">
                最大 tokens
              </label>
              <input
                id="agent-max-tokens"
                {...FIELDS.createAgent.maxTokens}
                className={inputCls}
                aria-label="最大 tokens"
                value={form.maxTokens}
                onChange={(e) => set("maxTokens", e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-thinking">
              思考强度
            </label>
            <select
              id="agent-thinking"
              className={inputCls}
              value={form.thinking}
              onChange={(e) => set("thinking", e.target.value)}
            >
              {THINKING_LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  {lv}
                </option>
              ))}
            </select>
            {form.connectionType !== "web" && (
              <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                接口方式下会按各家官网 API 的原生写法发送：OpenAI / OpenRouter / xAI /
                Gemini 用 reasoning_effort，Claude 用 thinking
                思考预算，通义千问用 enable_thinking + 预算，智谱 / DeepSeek / Kimi
                用 thinking 开关；同时附带一句思考程度的系统提示兜底。选「默认」则不发送任何思考参数。
              </p>
            )}
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="agent-prompt">
              系统指令（系统提示词）
            </label>
            <textarea
              id="agent-prompt"
              {...FIELDS.createAgent.systemPrompt}
              className={`${inputCls} min-h-[96px] resize-y`}
              value={form.systemPrompt}
              onChange={(e) => set("systemPrompt", e.target.value)}
              placeholder="留空则不附加任何系统指令"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              只属于这个智能体，它在任何房间回复时都会带上，其他智能体看不到。想让它长期记住的事（背景、偏好、进行中的事项）也直接写在这里——原来的「长期记忆」是手动填写、和系统指令重复，已经合并进来。
              {initial?.memory.trim()
                ? "之前写在「长期记忆」里的内容已并入上方，保存后就只存在于这一处。"
                : ""}
              {form.connectionType === "web" &&
                "另外：网页版用官网账号登录时，官网账号自身的记忆随它在官网的对话保留（每个房间固定对应一个官网对话），不需要在这里重复写。"}
            </p>
          </div>

          {saveError && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {saveError}
            </p>
          )}
        </div>
        <div className="shrink-0 border-t border-black/[0.06] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {confirmDelete ? (
            <div>
              <p
                role="alert"
                className="text-[13px] leading-relaxed text-[#c0392b]"
              >
                确定要删除「{form.name.trim() || initial?.name || "这个智能体"}
                」吗？删除后会连同该智能体的全部对话记录一起彻底删除、并将它移出所有房间，不可恢复。如果只是想让它离开某个房间，不需要删除它——在那个房间的成员管理里点「移出房间」即可。
              </p>
              {deleteError && (
                <p role="alert" className="mt-2 text-[13px] text-[#c0392b]">
                  {deleteError}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  className="flex-1 rounded-xl bg-[#e5484d] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {deleteMutation.isPending ? "删除中…" : "确认删除"}
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError("");
                  }}
                  className="flex-1 rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                {editing && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex-1 rounded-xl bg-[#fce8e6] px-3 py-2.5 text-sm font-medium text-[#c0392b]"
                  >
                    删除智能体
                  </button>
                )}
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  className="flex-1 rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saveMutation.isPending
                    ? "保存中…"
                    : editing
                      ? "保存设置"
                      : "添加智能体"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
                {form.connectionType === "web"
                  ? "网页令牌方式下，回复来自该站网页端的真实接口（用你自己的网页登录令牌）；未登录、令牌过期或被网页端拦截时都会如实提示，不会编造回复。"
                  : "没有配好 API（地址、Key、模型）的智能体会保持沉默，不会编造回复；配好后，它的回复来自对应服务商的真实接口，并带上与它的对话历史。"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- my profile panel ---------------- */

const PROFILE_COLORS = ["#b9bec7", ...AGENT_COLORS];

/**
 * The user's own profile settings — the same shape as the
 * collaborative space's 「我」 settings: name, avatar glyph, avatar
 * colour (swatches + custom colour picker + #RRGGBB input) with a
 * live preview, saved server-side. The name labels the user's
 * messages and their group membership everywhere in the space.
 */
function ProfilePanel({
  initial,
  onClose,
}: {
  initial: Profile;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [glyph, setGlyph] = useState(initial.glyph);
  const [color, setColor] = useState(initial.color || "#b9bec7");
  const [showTime, setShowTime] = useState(initial.showTime);
  const [soundOn, setSoundOn] = useState(initial.soundOn);
  const [nameError, setNameError] = useState("");
  const [saveError, setSaveError] = useState("");
  const avatarDraft = useAvatarDraft(initial.avatarUrl);

  const saveMutation = useMutation({
    mutationFn: async () =>
      await api.updateProfile({
        name: name.trim(),
        glyph: glyph.trim(),
        color,
        showTime,
        soundOn,
        avatarImage: avatarDraft.image,
        removeAvatar: avatarDraft.removed,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(["profile"], res);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      onClose();
    },
    onError: (err) =>
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function handleSave() {
    if (!name.trim()) {
      setNameError("名字不能为空，请填写一个名字");
      return;
    }
    setNameError("");
    saveMutation.mutate();
  }

  const inputCls =
    "w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm outline-none placeholder:text-[#9a9aa0]";
  const labelCls = "mb-1 block text-xs font-medium text-[#6e6e73]";
  const draft: Profile = {
    name,
    glyph,
    color,
    avatarUrl: null,
    showTime,
    soundOn,
    gestureControl: initial.gestureControl,
    themeMode: initial.themeMode,
    fontScale: initial.fontScale,
    codeWrap: initial.codeWrap,
    customInstructions: initial.customInstructions,
    customInstructionsEnabled: initial.customInstructionsEnabled,
  };

  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="个人资料设置"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
          <h3 className="text-base font-semibold">个人资料</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
          >
            <Icon d={PATHS.x} size={17} />
          </button>
        </div>
        <div data-modal-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-5">
          <div className="flex items-center gap-3">
            <AvatarEditor
              size={56}
              label="更换我的头像图片"
              previewUrl={avatarDraft.previewUrl}
              onPick={avatarDraft.pick}
              onRemove={avatarDraft.remove}
            >
              <UserAvatar size={56} profile={draft} />
            </AvatarEditor>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {name.trim() || "我"}
              </p>
              <p className="truncate text-[13px] text-[#9a9aa0]">
                你在聊天里显示的样子
              </p>
            </div>
          </div>

          {avatarDraft.error && (
            <p role="alert" className="mt-2 text-[13px] text-[#c0392b]">
              {avatarDraft.error}
            </p>
          )}

          <div className="mt-4">
            <label className={labelCls} htmlFor="profile-name">
              名字
            </label>
            <input
              id="profile-name"
              {...FIELDS.updateProfile.name}
              className={inputCls}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError("");
              }}
              placeholder="你的名字"
              autoComplete="off"
            />
            {nameError && (
              <p role="alert" className="mt-1 text-xs text-[#c0392b]">
                {nameError}
              </p>
            )}
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="profile-glyph">
              头像文字
            </label>
            <input
              id="profile-glyph"
              {...FIELDS.updateProfile.glyph}
              className={inputCls}
              value={glyph}
              onChange={(e) => setGlyph(e.target.value)}
              placeholder="留空则显示默认头像，如：肖"
              autoComplete="off"
            />
          </div>

          <div className="mt-3">
            <span className={labelCls}>头像颜色</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`头像颜色 ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${
                    color === c ? "ring-2 ring-[#191919] ring-offset-2" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="自定义头像颜色"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#b9bec7"}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-9 cursor-pointer rounded bg-transparent"
              />
              <input
                aria-label="头像颜色代码"
                {...FIELDS.updateProfile.color}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                spellCheck={false}
                className="w-24 rounded-[8px] bg-[#f0f0f2] px-2 py-1.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block text-sm">消息气泡显示时间</span>
                <span className="block text-xs text-[#9a9aa0]">
                  每条消息气泡右下角的小字时间
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={showTime}
                aria-label="消息气泡显示时间"
                onClick={() => setShowTime(!showTime)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  showTime ? "bg-[#34c759]" : "bg-black/[0.15]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    showTime ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block text-sm">新消息提示音</span>
                <span className="block text-xs text-[#9a9aa0]">
                  收到新回复时播放一声短提示音
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={soundOn}
                aria-label="新消息提示音"
                onClick={() => setSoundOn(!soundOn)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  soundOn ? "bg-[#34c759]" : "bg-black/[0.15]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    soundOn ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {saveError && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {saveError}
            </p>
          )}
        </div>
        <div className="shrink-0 border-t border-black/[0.06] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={handleSave}
            className="w-full rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- space settings panel ---------------- */

/**
 * The space settings — opened from the gear in the sidebar footer.
 * Like a phone's settings app, the panel opens on a grouped list of
 * functions; tapping a row opens that function's own page instead
 * of showing every control at once. The whole panel is full-screen:
 * the list and every function's page fill the entire display, with
 * a back chevron at a sub-page's top-left returning to the list.
 * The functions live here:
 * - 外观： the theme mode （系统模式 / 日间模式 / 夜间模式）, whether
 *   long lines in messages and text previews wrap, and the UI text
 *   size — all saved immediately to the profile row and applied to
 *   the whole space at once (the appearance layer in theme.css).
 * - 手势控制： the gesture switch; while on, a right swipe anywhere
 *   in the space goes back to the previous screen. Inside this
 *   panel a right swipe first pops an open sub-page back to the
 *   list — the App asks through backRef before closing the panel.
 * - 自定义指令： one standing instruction that applies to EVERY
 *   agent in the space (Muse and every added agent), unlike each
 *   agent's own 系统提示词 which only affects that one agent. It is
 *   edited as a draft and saved with its own button, and the page
 *   carries an enable switch of its own: while the switch is off
 *   the text stays saved but the server injects nothing; turning
 *   it back on restores the effect. The switch saves immediately,
 *   like the gesture switch.
 * - 技能： the skills library, modelled on the Gemini skills UI
 *   the user screenshotted: a list page (全部 (N), one row per
 *   skill) whose header carries only 创建， opening an editor
 *   with 名称 / 说明 / 指令 fields, an enable switch and a scope
 *   picker （全部智能体 or 指定智能体 with per-agent checkboxes).
 *   The editor's header carries 添加文件， which opens the
 *   上传文件 dialog and attaches the file INTO that skill (the
 *   user's correction: it never imports/creates a skill).
 *   Enabled skills — instructions plus attached file contents —
 *   are injected server-side into the applicable agents' reply
 *   context.
 * - 定时与事件触发： standing triggers — one agent speaking in
 *   one room without the user messaging first. 定时 triggers fire
 *   on their interval (executed server-side by runDueTriggers);
 *   事件 triggers fire when the user posts in the trigger's room
 *   and the agent is not a member of it. Each row shows the last
 *   execution's real outcome from the server.
 * Every control saves immediately, like the other display
 * preferences on the profile row.
 */
type SettingsPage =
  | "list"
  | "appearance"
  | "gesture"
  | "instructions"
  | "skills"
  | "skillEdit"
  | "triggers"
  | "triggerEdit";

/** The schedule intervals a trigger can fire on, shortest first. */
const TRIGGER_INTERVALS = [
  { minutes: 5, label: "每 5 分钟" },
  { minutes: 15, label: "每 15 分钟" },
  { minutes: 30, label: "每 30 分钟" },
  { minutes: 60, label: "每小时" },
  { minutes: 180, label: "每 3 小时" },
  { minutes: 360, label: "每 6 小时" },
  { minutes: 720, label: "每 12 小时" },
  { minutes: 1440, label: "每天" },
  { minutes: 10080, label: "每周" },
] as const;

function triggerIntervalLabel(minutes: number): string {
  return (
    TRIGGER_INTERVALS.find((i) => i.minutes === minutes)?.label ??
    `每 ${minutes} 分钟`
  );
}

function triggerLastRunText(t: Trigger): string {
  if (!t.lastRunAt || !t.lastStatus) return "尚未执行";
  const when = new Date(t.lastRunAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (t.lastStatus === "ok") return `上次执行 ${when} · 已发送回复`;
  if (t.lastStatus === "silent")
    return `上次执行 ${when} · 未回复${t.lastError ? `：${t.lastError}` : ""}`;
  return `上次执行 ${when} · 失败${t.lastError ? `：${t.lastError}` : ""}`;
}

const THEME_MODES = [
  { value: "system", label: "系统模式", icon: PATHS.contrast },
  { value: "light", label: "日间模式", icon: PATHS.sun },
  { value: "dark", label: "夜间模式", icon: PATHS.moon },
] as const;

function themeModeLabel(mode: Profile["themeMode"]): string {
  return mode === "dark"
    ? "夜间模式"
    : mode === "light"
      ? "日间模式"
      : "系统模式";
}

/** The iOS-style switch shared by the settings sub-pages. */
function SettingsSwitch({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? "bg-[#34c759]" : "bg-black/[0.15]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function SettingsPanel({
  profile,
  onClose,
  backRef,
  initialPage = "list",
}: {
  profile: Profile;
  onClose: () => void;
  backRef: RefObject<(() => boolean) | null>;
  /** Where the panel opens: the chat toolbar's 技能 entry opens
   * straight on the skills page; every other entry keeps the
   * settings list. */
  initialPage?: SettingsPage;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  // Opened straight from a chat window's 技能 pill: the skills
  // page is then the panel's ENTRY page, not a sub-page of the
  // settings list — its back button (and gesture back) must
  // leave the panel entirely and return to the chat the user
  // came from, instead of landing on a settings list they never
  // opened.
  const skillsIsEntry = initialPage === "skills";
  const [gestureControl, setGestureControl] = useState(
    profile.gestureControl,
  );
  const [themeMode, setThemeMode] = useState(profile.themeMode);
  const [fontScale, setFontScale] = useState(profile.fontScale);
  const [codeWrap, setCodeWrap] = useState(profile.codeWrap);
  const [instructions, setInstructions] = useState(
    profile.customInstructions,
  );
  const [instructionsEnabled, setInstructionsEnabled] = useState(
    profile.customInstructionsEnabled,
  );
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Gesture back asks this first: an open sub-page pops back to
  // the list before the panel itself is allowed to close. The
  // one exception is the skills page when it is the entry page
  // (opened from a chat's 技能 pill): there is no list visit to
  // pop back to, so the gesture falls through and closes the
  // panel, returning to the chat.
  useEffect(() => {
    backRef.current = () => {
      if (page === "skillEdit") {
        setPage("skills");
        return true;
      }
      if (page === "triggerEdit") {
        setPage("triggers");
        return true;
      }
      if (page === "skills" && skillsIsEntry) return false;
      if (page !== "list") {
        setPage("list");
        return true;
      }
      return false;
    };
    return () => {
      backRef.current = null;
    };
  }, [backRef, page, skillsIsEntry]);

  const gestureMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      await api.setGestureControl({ enabled }),
    onSuccess: (res) => {
      queryClient.setQueryData<Profile>(["profile"], (old) =>
        old ? { ...old, gestureControl: res.gestureControl } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      setGestureControl(profile.gestureControl);
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });

  const appearanceMutation = useMutation({
    mutationFn: async (next: {
      themeMode: Profile["themeMode"];
      fontScale: number;
      codeWrap: boolean;
    }) => await api.setAppearance(next),
    onSuccess: (res) => {
      queryClient.setQueryData<Profile>(["profile"], (old) =>
        old
          ? {
              ...old,
              themeMode: res.themeMode,
              fontScale: res.fontScale,
              codeWrap: res.codeWrap,
            }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      setThemeMode(profile.themeMode);
      setFontScale(profile.fontScale);
      setCodeWrap(profile.codeWrap);
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });

  const instructionsMutation = useMutation({
    mutationFn: async (text: string) =>
      await api.setCustomInstructions({ text }),
    onSuccess: (res) => {
      queryClient.setQueryData<Profile>(["profile"], (old) =>
        old
          ? { ...old, customInstructions: res.customInstructions }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setInstructionsSaved(true);
    },
    onError: (err) => {
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });

  const instructionsEnabledMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      await api.setCustomInstructionsEnabled({ enabled }),
    onSuccess: (res) => {
      queryClient.setQueryData<Profile>(["profile"], (old) =>
        old
          ? {
              ...old,
              customInstructionsEnabled: res.customInstructionsEnabled,
            }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      setInstructionsEnabled(profile.customInstructionsEnabled);
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });

  /* ---------------- skills ----------------
   * The 技能 page (modelled on the Gemini skills UI): a list of
   * the user's skills and a 创建 editor (名称 / 说明 / 指令 plus
   * the agents it applies to). 添加文件 lives on ONE skill's own
   * edit page: it opens the 上传文件 dialog and attaches the file
   * INTO that skill — it never creates a new skill. Enabled skills
   * (instructions + attached file contents) are injected
   * server-side into the reply context of the agents they apply
   * to. */
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: () => api.listSkills({}),
  });
  const skills = skillsQuery.data?.skills ?? [];
  const skillAgentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents({}),
  });
  const skillAgents = skillAgentsQuery.data?.agents ?? [];
  const skillMuseQuery = useQuery({
    queryKey: ["museSettings"],
    queryFn: () => api.getMuseSettings({}),
  });
  const skillMuseName = skillMuseQuery.data?.name || "Muse";

  const [editingSkillId, setEditingSkillId] = useState<number | null>(
    null,
  );
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillInstr, setSkillInstr] = useState("");
  const [skillEnabled, setSkillEnabled] = useState(true);
  const [skillScope, setSkillScope] = useState<"all" | "selected">(
    "all",
  );
  const [skillMuse, setSkillMuse] = useState(true);
  const [skillAgentIds, setSkillAgentIds] = useState<number[]>([]);
  const [skillError, setSkillError] = useState("");
  const [skillConfirmDelete, setSkillConfirmDelete] = useState(false);
  // Files already attached to the skill being edited (server
  // state, refreshed from every add/remove response), and files
  // picked for a skill that has not been created yet — those ride
  // along locally and are attached right after the create lands.
  type SkillFileMeta = Skill["files"][number];
  type StagedSkillFile = {
    fileName: string;
    size: number | null;
    mime: string | null;
    text: string;
  };
  const [skillFiles, setSkillFiles] = useState<SkillFileMeta[]>([]);
  const [stagedSkillFiles, setStagedSkillFiles] = useState<
    StagedSkillFile[]
  >([]);
  // The 上传文件 dialog (opened by the edit page's 添加文件):
  // the picked file is read and staged here first; 上传 commits
  // it into the skill, 取消 drops it.
  const [skillUploadOpen, setSkillUploadOpen] = useState(false);
  const [skillUploadPick, setSkillUploadPick] =
    useState<StagedSkillFile | null>(null);
  const [skillUploadError, setSkillUploadError] = useState("");
  const [skillUploadDrag, setSkillUploadDrag] = useState(false);
  const skillUploadInputRef = useRef<HTMLInputElement>(null);

  function openSkillEditor(skill: Skill | null) {
    setSkillError("");
    setSkillConfirmDelete(false);
    setSkillUploadOpen(false);
    setSkillUploadPick(null);
    setSkillUploadError("");
    setStagedSkillFiles([]);
    if (skill) {
      setEditingSkillId(skill.id);
      setSkillName(skill.name);
      setSkillDesc(skill.description);
      setSkillInstr(skill.instructions);
      setSkillEnabled(skill.enabled);
      setSkillScope(skill.scope === "selected" ? "selected" : "all");
      setSkillMuse(skill.museAssigned);
      setSkillAgentIds(skill.agentIds);
      setSkillFiles(skill.files);
    } else {
      setEditingSkillId(null);
      setSkillName("");
      setSkillDesc("");
      setSkillInstr("");
      setSkillEnabled(true);
      setSkillScope("all");
      setSkillMuse(true);
      setSkillAgentIds([]);
      setSkillFiles([]);
    }
    setPage("skillEdit");
  }

  const skillSaveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: skillName.trim(),
        description: skillDesc.trim(),
        instructions: skillInstr,
        scope: skillScope,
        museAssigned: skillScope === "selected" ? skillMuse : false,
        agentIds: skillScope === "selected" ? skillAgentIds : [],
      };
      const res =
        editingSkillId != null
          ? await api.updateSkill({
              id: editingSkillId,
              ...payload,
              enabled: skillEnabled,
            })
          : await api.createSkill(payload);
      // Files picked before the skill existed are attached to it
      // now that it has an id.
      if (editingSkillId == null && stagedSkillFiles.length > 0) {
        for (const f of stagedSkillFiles) {
          await api.addSkillFile({ skillId: res.skill.id, ...f });
        }
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setStagedSkillFiles([]);
      setPage("skills");
    },
    onError: (err) =>
      setSkillError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function submitSkill() {
    if (!skillName.trim()) {
      setSkillError("请填写技能名称");
      return;
    }
    if (!skillInstr.trim()) {
      setSkillError("请填写技能指令");
      return;
    }
    if (
      skillScope === "selected" &&
      !skillMuse &&
      skillAgentIds.length === 0
    ) {
      setSkillError("指定智能体时，至少选择一个智能体");
      return;
    }
    setSkillError("");
    skillSaveMutation.mutate();
  }

  const skillDeleteMutation = useMutation({
    mutationFn: async (id: number) => await api.deleteSkill({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setSkillConfirmDelete(false);
      setPage("skills");
    },
    onError: (err) =>
      setSkillError(
        `删除失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  const skillAddFileMutation = useMutation({
    mutationFn: async (pick: StagedSkillFile) => {
      if (editingSkillId == null) {
        throw new Error("技能尚未保存，无法添加文件");
      }
      return await api.addSkillFile({ skillId: editingSkillId, ...pick });
    },
    onSuccess: (res) => {
      setSkillFiles(res.skill.files);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      closeSkillUpload();
    },
    onError: (err) =>
      setSkillUploadError(
        `添加失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  const skillRemoveFileMutation = useMutation({
    mutationFn: async (fileId: number) => {
      if (editingSkillId == null) {
        throw new Error("技能尚未保存，无法移除文件");
      }
      return await api.removeSkillFile({
        skillId: editingSkillId,
        fileId,
      });
    },
    onSuccess: (res) => {
      setSkillFiles(res.skill.files);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (err) =>
      setSkillError(
        `移除文件失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function openSkillUpload() {
    setSkillUploadPick(null);
    setSkillUploadError("");
    setSkillUploadDrag(false);
    setSkillUploadOpen(true);
  }

  function closeSkillUpload() {
    setSkillUploadOpen(false);
    setSkillUploadPick(null);
    setSkillUploadError("");
    setSkillUploadDrag(false);
  }

  /** Reads a file picked (or dropped) in the 上传文件 dialog and
   * stages it for the 上传 button. Only readable text can become
   * part of a skill — a PDF's text cannot be extracted here, so it
   * gets an honest in-dialog error instead of a silent bad add. */
  async function stageSkillUploadFile(file: File) {
    setSkillUploadError("");
    setSkillUploadPick(null);
    if (file.size > 1024 * 1024) {
      setSkillUploadError("文件太大：附属文件请控制在 1MB 以内");
      return;
    }
    if (
      file.type === "application/pdf" ||
      /\.pdf$/i.test(file.name)
    ) {
      setSkillUploadError(
        "PDF 文件暂时读不出文字内容，请先转成 TXT 或 MD 文件再添加",
      );
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setSkillUploadError("读取文件失败，请重试");
      return;
    }
    if (!text.trim() || text.includes("�")) {
      setSkillUploadError(
        "这个文件不是可读的文本文件，无法添加（支持 CSV、PY、TXT、MD 等文本文件）",
      );
      return;
    }
    setSkillUploadPick({
      fileName: file.name,
      size: file.size,
      mime: file.type || null,
      text,
    });
  }

  /** The dialog's 上传 button: the file lands in THIS skill —
   * immediately for a saved skill, or staged and attached when a
   * new skill is created from this editor. */
  function confirmSkillUpload() {
    const pick = skillUploadPick;
    if (!pick) return;
    if (editingSkillId != null) {
      skillAddFileMutation.mutate(pick);
    } else {
      setStagedSkillFiles((prev) => [...prev, pick]);
      closeSkillUpload();
    }
  }

  /* ---------------- 定时与事件触发 ----------------
   * Standing rules that make ONE agent speak in ONE room without
   * the user sending a message there first: 定时 (fires on its
   * interval, executed by the server's runDueTriggers) or 事件
   * （房间有新消息： the user posts in the trigger's room and the
   * agent — not a member of that room — adds a reply). The list
   * shows each trigger's last real execution outcome. */
  const triggersQuery = useQuery({
    queryKey: ["triggers"],
    queryFn: () => api.listTriggers({}),
  });
  const triggers = triggersQuery.data?.triggers ?? [];
  const triggerRoomsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.listConversations({}),
  });
  const triggerRooms =
    triggerRoomsQuery.data?.conversations ?? [];

  const [editingTriggerId, setEditingTriggerId] = useState<
    number | null
  >(null);
  const [trigName, setTrigName] = useState("");
  const [trigAgentKey, setTrigAgentKey] = useState("muse");
  const [trigRoomId, setTrigRoomId] = useState<number | null>(null);
  const [trigKind, setTrigKind] = useState<"schedule" | "event">(
    "schedule",
  );
  const [trigInterval, setTrigInterval] = useState(60);
  const [trigInstruction, setTrigInstruction] = useState("");
  const [trigEnabled, setTrigEnabled] = useState(true);
  const [trigError, setTrigError] = useState("");
  const [trigConfirmDelete, setTrigConfirmDelete] = useState(false);

  function openTriggerEditor(t: Trigger | null) {
    setTrigError("");
    setTrigConfirmDelete(false);
    if (t) {
      setEditingTriggerId(t.id);
      setTrigName(t.name);
      setTrigAgentKey(
        t.agentId == null ? "muse" : `agent-${t.agentId}`,
      );
      setTrigRoomId(t.conversationId);
      setTrigKind(t.kind === "event" ? "event" : "schedule");
      setTrigInterval(t.intervalMinutes);
      setTrigInstruction(t.instruction);
      setTrigEnabled(t.enabled);
    } else {
      setEditingTriggerId(null);
      setTrigName("");
      setTrigAgentKey("muse");
      setTrigRoomId(triggerRooms[0]?.id ?? null);
      setTrigKind("schedule");
      setTrigInterval(60);
      setTrigInstruction("");
      setTrigEnabled(true);
    }
    setPage("triggerEdit");
  }

  const triggerSaveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        agentId:
          trigAgentKey === "muse"
            ? null
            : Number(trigAgentKey.replace("agent-", "")),
        conversationId: trigRoomId ?? 0,
        kind: trigKind,
        name: trigName.trim(),
        instruction: trigInstruction.trim(),
        enabled: trigEnabled,
        intervalMinutes: trigInterval,
        eventType:
          trigKind === "event"
            ? ("room_new_message" as const)
            : ("" as const),
      };
      return editingTriggerId != null
        ? await api.updateTrigger({ id: editingTriggerId, ...payload })
        : await api.createTrigger(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triggers"] });
      setPage("triggers");
    },
    onError: (err) =>
      setTrigError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function submitTrigger() {
    if (trigRoomId == null) {
      setTrigError("暂无可选房间：先在聊天里发一条消息，房间保存下来后才能选作触发目标");
      return;
    }
    if (!trigInstruction.trim()) {
      setTrigError("请填写触发指令");
      return;
    }
    setTrigError("");
    triggerSaveMutation.mutate();
  }

  const triggerDeleteMutation = useMutation({
    mutationFn: async (id: number) => await api.deleteTrigger({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triggers"] });
      setTrigConfirmDelete(false);
      setPage("triggers");
    },
    onError: (err) =>
      setTrigError(
        `删除失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  const triggerToggleMutation = useMutation({
    mutationFn: async (t: Trigger) =>
      await api.updateTrigger({
        id: t.id,
        agentId: t.agentId,
        conversationId: t.conversationId,
        kind: t.kind === "event" ? "event" : "schedule",
        name: t.name,
        instruction: t.instruction,
        enabled: !t.enabled,
        intervalMinutes: t.intervalMinutes,
        eventType:
          t.eventType === "room_new_message"
            ? ("room_new_message" as const)
            : ("" as const),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["triggers"] }),
    onError: (err) =>
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function toggleInstructionsEnabled() {
    const next = !instructionsEnabled;
    setInstructionsEnabled(next);
    setSaveError("");
    instructionsEnabledMutation.mutate(next);
  }

  function saveInstructions() {
    setSaveError("");
    setInstructionsSaved(false);
    instructionsMutation.mutate(instructions);
  }

  function toggleGesture() {
    const next = !gestureControl;
    setGestureControl(next);
    setSaveError("");
    gestureMutation.mutate(next);
  }

  function saveAppearance(
    next: Partial<{
      themeMode: Profile["themeMode"];
      fontScale: number;
      codeWrap: boolean;
    }>,
  ) {
    const merged = { themeMode, fontScale, codeWrap, ...next };
    setThemeMode(merged.themeMode);
    setFontScale(merged.fontScale);
    setCodeWrap(merged.codeWrap);
    setSaveError("");
    appearanceMutation.mutate(merged);
  }

  const pageTitle =
    page === "appearance"
      ? "外观"
      : page === "gesture"
        ? "手势控制"
        : page === "instructions"
          ? "自定义指令"
          : page === "skills" || page === "skillEdit"
            ? "技能"
            : page === "triggers" || page === "triggerEdit"
              ? "定时与事件触发"
              : "设置";

  const rowChevron = (
    <span className="shrink-0 text-[#c7c7cc]">
      <Icon d={PATHS.chevronRight} size={16} />
    </span>
  );

  // Every page of this panel — the function list included — is
  // full-screen: no dim backdrop, no card margins, the content
  // fills the whole display edge to edge.
  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label={pageTitle}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {page === "skills" || page === "skillEdit" ? (
          /* The skills pages carry their own header, like the
             reference UI: back chevron + title on the left, the
             添加文件 / 创建 actions on the right. */
          <div className="flex items-center gap-2 px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
            <button
              type="button"
              aria-label={
                page === "skillEdit"
                  ? "返回技能列表"
                  : skillsIsEntry
                    ? "返回聊天"
                    : "返回设置"
              }
              onClick={() => {
                if (page === "skillEdit") setPage("skills");
                else if (skillsIsEntry) onClose();
                else setPage("list");
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05]"
            >
              <Icon d={PATHS.back} size={18} />
            </button>
            <h3 className="min-w-0 flex-1 text-lg font-medium">技能</h3>
            {/* 添加文件 belongs to ONE skill: it only exists on
                that skill's edit page and opens the 上传文件
                dialog, which attaches the file into this skill.
                The list page deliberately has no such button. */}
            {page === "skillEdit" && (
              <button
                type="button"
                aria-label="添加文件"
                onClick={openSkillUpload}
                className="shrink-0 rounded-full bg-[#f0f0f2] px-4 py-1.5 text-sm text-[#191919]"
              >
                添加文件
              </button>
            )}
            {page === "skills" ? (
              <button
                type="button"
                aria-label="创建技能"
                onClick={() => openSkillEditor(null)}
                className="shrink-0 rounded-full bg-[#2f6bff] px-4 py-1.5 text-sm font-medium text-white"
              >
                创建
              </button>
            ) : (
              <button
                type="button"
                aria-label={editingSkillId != null ? "保存技能" : "创建技能"}
                disabled={skillSaveMutation.isPending}
                onClick={submitSkill}
                className="shrink-0 rounded-full bg-[#2f6bff] px-4 py-1.5 text-sm font-medium text-white disabled:bg-black/[0.08] disabled:text-[#9a9aa0]"
              >
                {skillSaveMutation.isPending
                  ? "保存中…"
                  : editingSkillId != null
                    ? "保存"
                    : "创建"}
              </button>
            )}
          </div>
        ) : (
          <div className="relative flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
            {page === "list" ? (
              <button
                type="button"
                aria-label="返回"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
              >
                <Icon d={PATHS.back} size={18} />
              </button>
            ) : (
              <button
                type="button"
                aria-label="返回设置"
                onClick={() =>
                  setPage(
                    page === "triggerEdit" ? "triggers" : "list",
                  )
                }
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
              >
                <Icon d={PATHS.back} size={18} />
              </button>
            )}
            <h3 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold">
              {pageTitle}
            </h3>
            {page === "list" ? (
              <span className="h-8 w-8" aria-hidden="true" />
            ) : (
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
              >
                <Icon d={PATHS.x} size={17} />
              </button>
            )}
          </div>
        )}
        <div
          data-modal-scroll
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-[calc(7rem+env(safe-area-inset-bottom))]"
        >
          {page === "list" && (
            <div className="overflow-hidden rounded-2xl bg-[#f7f7f8]">
              <button
                type="button"
                aria-label="外观"
                onClick={() => setPage("appearance")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
              >
                <span className="shrink-0 text-[#6e6e73]">
                  <Icon d={PATHS.contrast} size={21} />
                </span>
                <span className="min-w-0 flex-1 text-sm">外观</span>
                <span className="shrink-0 text-[13px] text-[#9a9aa0]">
                  {themeModeLabel(themeMode)}
                </span>
                {rowChevron}
              </button>
              <div className="ml-[52px] border-t border-black/[0.05]" />
              <button
                type="button"
                aria-label="手势控制"
                onClick={() => setPage("gesture")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
              >
                <span className="shrink-0 text-[#6e6e73]">
                  <Icon d={PATHS.swipeRight} size={21} />
                </span>
                <span className="min-w-0 flex-1 text-sm">手势控制</span>
                <span className="shrink-0 text-[13px] text-[#9a9aa0]">
                  {gestureControl ? "已开启" : "已关闭"}
                </span>
                {rowChevron}
              </button>
              <div className="ml-[52px] border-t border-black/[0.05]" />
              <button
                type="button"
                aria-label="自定义指令"
                onClick={() => setPage("instructions")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
              >
                <span className="shrink-0 text-[#6e6e73]">
                  <Icon d={PATHS.sliders} size={21} />
                </span>
                <span className="min-w-0 flex-1 text-sm">自定义指令</span>
                <span className="shrink-0 text-[13px] text-[#9a9aa0]">
                  {!instructions.trim()
                    ? "未设置"
                    : instructionsEnabled
                      ? "已开启"
                      : "已关闭"}
                </span>
                {rowChevron}
              </button>
              <div className="ml-[52px] border-t border-black/[0.05]" />
              <button
                type="button"
                aria-label="技能"
                onClick={() => setPage("skills")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
              >
                <span className="shrink-0 text-[#6e6e73]">
                  <Icon d={PATHS.sparkles} size={21} />
                </span>
                <span className="min-w-0 flex-1 text-sm">技能</span>
                <span className="shrink-0 text-[13px] text-[#9a9aa0]">
                  {skills.length === 0
                    ? "未添加"
                    : `${skills.length} 个`}
                </span>
                {rowChevron}
              </button>
              <div className="ml-[52px] border-t border-black/[0.05]" />
              <button
                type="button"
                aria-label="定时与事件触发"
                onClick={() => setPage("triggers")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
              >
                <span className="shrink-0 text-[#6e6e73]">
                  <Icon d={PATHS.clock} size={21} />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  定时与事件触发
                </span>
                <span className="shrink-0 text-[13px] text-[#9a9aa0]">
                  {triggers.length === 0
                    ? "未添加"
                    : `${triggers.length} 个`}
                </span>
                {rowChevron}
              </button>
            </div>
          )}

          {page === "appearance" && (
            <>
              <div
                className="flex gap-3"
                role="radiogroup"
                aria-label="主题模式"
              >
                {THEME_MODES.map((m) => {
                  const selected = themeMode === m.value;
                  return (
                    <div
                      key={m.value}
                      className="flex flex-1 flex-col items-center gap-2"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={m.label}
                        onClick={() =>
                          saveAppearance({ themeMode: m.value })
                        }
                        className={`flex h-[72px] w-full items-center justify-center rounded-2xl transition-colors ${
                          selected
                            ? "bg-[#2f6bff]/10 text-[#191919] ring-2 ring-[#2f6bff]"
                            : "bg-[#f7f7f8] text-[#6e6e73] ring-1 ring-black/[0.06]"
                        }`}
                      >
                        <Icon
                          d={m.icon}
                          size={30}
                          filled={m.value !== "light"}
                        />
                      </button>
                      <span
                        className={`text-[13px] ${
                          selected ? "font-medium" : "text-[#6e6e73]"
                        }`}
                      >
                        {m.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-[#f7f7f8] px-4 py-3.5">
                <span className="min-w-0 text-sm">
                  代码块中的长行自动换行
                </span>
                <SettingsSwitch
                  checked={codeWrap}
                  label="代码块中的长行自动换行"
                  onToggle={() =>
                    saveAppearance({ codeWrap: !codeWrap })
                  }
                />
              </div>
              <p className="mt-2 px-1 text-xs leading-relaxed text-[#9a9aa0]">
                关闭后，聊天消息和文本文件预览里的长行不再自动折行，可以左右滑动查看完整一行。
              </p>

              <p className="mt-5 mb-2 px-1 text-[13px] font-medium text-[#6e6e73]">
                文本大小
              </p>
              <div className="rounded-2xl bg-[#f7f7f8] px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-xs text-[#6e6e73]">
                    小
                  </span>
                  <input
                    {...FIELDS.setAppearance.fontScale}
                    type="range"
                    step={1}
                    aria-label="文本大小"
                    className="min-w-0 flex-1 accent-[#2f6bff]"
                    value={fontScale}
                    onChange={(e) =>
                      saveAppearance({
                        fontScale: Number(e.target.value),
                      })
                    }
                  />
                  <span className="shrink-0 text-base text-[#6e6e73]">
                    大
                  </span>
                </div>
                <div
                  className="mt-1.5 flex justify-between px-6"
                  aria-hidden="true"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className={`h-1 w-1 rounded-full ${
                        n === fontScale
                          ? "bg-[#2f6bff]"
                          : "bg-black/[0.15]"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-4 border-t border-black/[0.05] pt-4">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-[#95ec69] px-3 py-2">
                      <p className="text-[15px] leading-relaxed text-[#191919]">
                        这段文字有多大？
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#191919]">
                    界面上的文字会按这个大小显示，包括聊天、列表和各个面板。
                  </p>
                  <p className="mt-3 text-center text-xs text-[#9a9aa0]">
                    预览
                  </p>
                </div>
              </div>
            </>
          )}

          {page === "gesture" && (
            <>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block text-sm">手势控制</span>
                  <span className="block text-xs text-[#9a9aa0]">
                    开启后可以用滑动手势操作界面
                  </span>
                </span>
                <SettingsSwitch
                  checked={gestureControl}
                  label="手势控制"
                  onToggle={toggleGesture}
                />
              </div>

              <div className="mt-3 rounded-xl bg-[#f7f7f8] px-3.5 py-3">
                <p className="text-xs font-medium text-[#6e6e73]">
                  可用手势
                </p>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span>向右滑动</span>
                  <span className="text-[#6e6e73]">返回上一界面</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#9a9aa0]">
                  {gestureControl
                    ? "在聊天、文件、设置面板等界面向右滑动，即可回到上一个界面。"
                    : "开启手势控制后，上面的手势才会生效。"}
                </p>
              </div>
            </>
          )}

          {page === "instructions" && (
            <>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block text-sm">启用自定义指令</span>
                  <span className="block text-xs text-[#9a9aa0]">
                    {instructionsEnabled
                      ? "已开启，下面的指令对所有智能体生效"
                      : "已关闭，指令保留但不生效"}
                  </span>
                </span>
                <SettingsSwitch
                  checked={instructionsEnabled}
                  label="启用自定义指令"
                  onToggle={toggleInstructionsEnabled}
                />
              </div>
              <p className="mt-2 px-1 text-xs leading-relaxed text-[#9a9aa0]">
                写在这里的指令对空间里的所有智能体都生效，包括 Muse
                和你添加的每一个智能体。它和单个智能体设置里的系统提示词不同：那里的只对那一个智能体生效，这里的会叠加在每个智能体的回复要求之上。关掉上面的开关后，指令会保留在这里，但不再对智能体生效，重新打开即恢复。留空保存即可清除。
              </p>
              <label
                htmlFor="global-custom-instructions"
                className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
              >
                指令内容
              </label>
              <textarea
                {...FIELDS.setCustomInstructions.text}
                id="global-custom-instructions"
                aria-label="全局自定义指令"
                rows={8}
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  setInstructionsSaved(false);
                }}
                placeholder="例如：回答尽量简洁，先给结论再解释；不确定的事情直接说不确定，不要编造。"
                className="w-full resize-y rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-[#9a9aa0]"
              />
              <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-xs text-[#9a9aa0]">
                  {instructions.length} / 4000 字
                </span>
                {instructionsSaved && (
                  <span className="text-xs text-[#137333]">已保存</span>
                )}
              </div>
              <button
                type="button"
                onClick={saveInstructions}
                disabled={
                  instructionsMutation.isPending ||
                  instructions === profile.customInstructions
                }
                className="mt-3 w-full rounded-xl bg-[#2f6bff] py-2.5 text-sm font-medium text-white disabled:bg-black/[0.08] disabled:text-[#9a9aa0]"
              >
                {instructionsMutation.isPending ? "保存中…" : "保存"}
              </button>
            </>
          )}

          {page === "skills" && (
            <>
              <p className="px-1 text-sm text-[#6e6e73]">
                添加或创建技能，扩展智能体的功能
              </p>
              <p className="mt-5 mb-1 px-1 text-sm text-[#6e6e73]">
                全部 ({skills.length})
              </p>
              {skillsQuery.isPending ? (
                <p className="px-1 py-6 text-sm text-[#9a9aa0]">
                  加载中…
                </p>
              ) : skills.length === 0 ? (
                <p className="px-1 py-6 text-sm leading-relaxed text-[#9a9aa0]">
                  还没有技能。点右上角「创建」新建一个；进入某个技能后，点「添加文件」可以把文件加到那个技能里。启用后的技能会进入对应智能体的回复要求里。
                </p>
              ) : (
                <div>
                  {skills.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={`技能 ${s.name}`}
                      onClick={() => openSkillEditor(s)}
                      className="flex w-full items-center gap-3 py-3 text-left active:bg-black/[0.03]"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f0f0f2] text-[#3a3a3c]">
                        <Icon d={PATHS.file} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">
                          {s.name}
                        </span>
                        <span className="block truncate text-[13px] text-[#9a9aa0]">
                          {s.description || "暂无说明"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-[#9a9aa0]">
                        {!s.enabled
                          ? "已停用"
                          : s.scope === "selected"
                            ? "指定智能体"
                            : "全部智能体"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {page === "skillEdit" && (
            <>
              <div className="rounded-2xl bg-[#f7f7f8] px-4 py-4">
                <label
                  htmlFor="skill-name"
                  className="mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  名称
                </label>
                <input
                  {...FIELDS.createSkill.name}
                  id="skill-name"
                  aria-label="技能名称"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="例如：get-more-perspectives"
                  className="w-full rounded-[10px] bg-white px-3 py-2 text-sm outline-none ring-1 ring-black/[0.06] placeholder:text-[#9a9aa0]"
                />
                <label
                  htmlFor="skill-desc"
                  className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  说明
                </label>
                <textarea
                  {...FIELDS.createSkill.description}
                  id="skill-desc"
                  aria-label="技能说明"
                  rows={2}
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                  placeholder="一句话说明这个技能做什么"
                  className="w-full resize-y rounded-[10px] bg-white px-3 py-2 text-sm leading-relaxed outline-none ring-1 ring-black/[0.06] placeholder:text-[#9a9aa0]"
                />
                <label
                  htmlFor="skill-instr"
                  className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  指令
                </label>
                <textarea
                  {...FIELDS.createSkill.instructions}
                  id="skill-instr"
                  aria-label="技能指令"
                  rows={12}
                  value={skillInstr}
                  onChange={(e) => setSkillInstr(e.target.value)}
                  placeholder="写下这个技能的完整指令，智能体处理相关请求时会按它执行。"
                  className="w-full resize-y rounded-[10px] bg-white px-3 py-2 text-sm leading-relaxed outline-none ring-1 ring-black/[0.06] placeholder:text-[#9a9aa0]"
                />
                <div className="mt-1 text-right text-xs text-[#9a9aa0]">
                  {skillInstr.length} / 20000 字
                </div>
              </div>

              {/* Files attached into THIS skill (via the header's
                  添加文件 upload dialog). Their contents are part
                  of the skill: agents applying it see them too. */}
              <div className="mt-4 rounded-2xl bg-[#f7f7f8] px-4 py-4">
                <p className="text-xs font-medium text-[#6e6e73]">
                  附属文件
                  {skillFiles.length + stagedSkillFiles.length > 0
                    ? ` (${skillFiles.length + stagedSkillFiles.length})`
                    : ""}
                </p>
                {skillFiles.length === 0 &&
                stagedSkillFiles.length === 0 ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-[#9a9aa0]">
                    还没有附属文件。点右上角「添加文件」，把文件加到这个技能里，智能体执行技能时会连同文件内容一起参考。
                  </p>
                ) : (
                  <div className="mt-1">
                    {skillFiles.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#3a3a3c] ring-1 ring-black/[0.05]">
                          <Icon d={PATHS.file} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {f.name}
                          </span>
                          <span className="block text-xs text-[#9a9aa0]">
                            {f.size != null
                              ? `${(f.size / 1024).toFixed(1)} KB`
                              : "大小未知"}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`移除文件 ${f.name}`}
                          disabled={skillRemoveFileMutation.isPending}
                          onClick={() =>
                            skillRemoveFileMutation.mutate(f.id)
                          }
                          className="shrink-0 rounded-full px-2 py-1 text-[13px] text-[#b3261e] disabled:text-[#9a9aa0]"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {stagedSkillFiles.map((f, i) => (
                      <div
                        key={`staged-${i}`}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#3a3a3c] ring-1 ring-black/[0.05]">
                          <Icon d={PATHS.file} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {f.fileName}
                          </span>
                          <span className="block text-xs text-[#9a9aa0]">
                            {f.size != null
                              ? `${(f.size / 1024).toFixed(1)} KB`
                              : "大小未知"}
                            {" · 保存技能后添加"}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`移除文件 ${f.fileName}`}
                          onClick={() =>
                            setStagedSkillFiles((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                          className="shrink-0 rounded-full px-2 py-1 text-[13px] text-[#b3261e]"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {editingSkillId != null && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-[#f7f7f8] px-4 py-3.5">
                  <span className="min-w-0">
                    <span className="block text-sm">启用技能</span>
                    <span className="block text-xs text-[#9a9aa0]">
                      {skillEnabled
                        ? "已启用，会进入对应智能体的回复要求"
                        : "已停用，技能保留但不生效"}
                    </span>
                  </span>
                  <SettingsSwitch
                    checked={skillEnabled}
                    label="启用技能"
                    onToggle={() => setSkillEnabled(!skillEnabled)}
                  />
                </div>
              )}

              <p className="mt-5 mb-2 px-1 text-[13px] font-medium text-[#6e6e73]">
                生效范围
              </p>
              <div className="overflow-hidden rounded-2xl bg-[#f7f7f8]">
                <button
                  type="button"
                  role="radio"
                  aria-checked={skillScope === "all"}
                  aria-label="全部智能体"
                  onClick={() => setSkillScope("all")}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    全部智能体
                  </span>
                  {skillScope === "all" && (
                    <span className="shrink-0 text-[#2f6bff]">
                      <Icon d={PATHS.check} size={17} />
                    </span>
                  )}
                </button>
                <div className="ml-4 border-t border-black/[0.05]" />
                <button
                  type="button"
                  role="radio"
                  aria-checked={skillScope === "selected"}
                  aria-label="指定智能体"
                  onClick={() => setSkillScope("selected")}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04]"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    指定智能体
                  </span>
                  {skillScope === "selected" && (
                    <span className="shrink-0 text-[#2f6bff]">
                      <Icon d={PATHS.check} size={17} />
                    </span>
                  )}
                </button>
              </div>

              {skillScope === "selected" && (
                <div className="mt-3 overflow-hidden rounded-2xl bg-[#f7f7f8]">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={skillMuse}
                    aria-label={`智能体 ${skillMuseName}`}
                    onClick={() => setSkillMuse(!skillMuse)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04]"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] ${
                        skillMuse
                          ? "bg-[#2f6bff] text-white"
                          : "bg-black/[0.08] text-transparent"
                      }`}
                    >
                      <Icon d={PATHS.check} size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {skillMuseName}
                    </span>
                  </button>
                  {skillAgents.map((a) => {
                    const picked = skillAgentIds.includes(a.id);
                    return (
                      <div key={a.id}>
                        <div className="ml-4 border-t border-black/[0.05]" />
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={picked}
                          aria-label={`智能体 ${a.name || "未命名智能体"}`}
                          onClick={() =>
                            setSkillAgentIds(
                              picked
                                ? skillAgentIds.filter(
                                    (id) => id !== a.id,
                                  )
                                : [...skillAgentIds, a.id],
                            )
                          }
                          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04]"
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] ${
                              picked
                                ? "bg-[#2f6bff] text-white"
                                : "bg-black/[0.08] text-transparent"
                            }`}
                          >
                            <Icon d={PATHS.check} size={13} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {a.name || "未命名智能体"}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  {skillAgents.length === 0 && (
                    <p className="px-4 pb-3 text-xs text-[#9a9aa0]">
                      还没有添加其他智能体，目前只有 {skillMuseName}{" "}
                      可选。
                    </p>
                  )}
                </div>
              )}

              <p className="mt-3 px-1 text-xs leading-relaxed text-[#9a9aa0]">
                技能是给智能体的一套固定指令：启用后，处理相关请求时对应智能体会按技能指令执行，叠加在全局自定义指令和智能体自己的系统提示词之上。
              </p>

              {skillError && (
                <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
                  {skillError}
                </p>
              )}

              {editingSkillId != null && (
                <button
                  type="button"
                  aria-label="删除技能"
                  disabled={skillDeleteMutation.isPending}
                  onClick={() => {
                    if (!skillConfirmDelete) {
                      setSkillConfirmDelete(true);
                      return;
                    }
                    skillDeleteMutation.mutate(editingSkillId);
                  }}
                  className={`mt-5 w-full rounded-xl py-2.5 text-sm font-medium ${
                    skillConfirmDelete
                      ? "bg-[#b3261e] text-white"
                      : "bg-[#fce8e6] text-[#b3261e]"
                  }`}
                >
                  {skillDeleteMutation.isPending
                    ? "删除中…"
                    : skillConfirmDelete
                      ? "确认删除这个技能？"
                      : "删除技能"}
                </button>
              )}
            </>
          )}

          {page === "triggers" && (
            <>
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-[#6e6e73]">
                  全部 ({triggers.length})
                </p>
                <button
                  type="button"
                  aria-label="新建触发"
                  onClick={() => openTriggerEditor(null)}
                  className="shrink-0 rounded-full bg-[#2f6bff] px-4 py-1.5 text-sm font-medium text-white"
                >
                  新建
                </button>
              </div>
              <p className="mt-2 px-1 text-[13px] leading-relaxed text-[#9a9aa0]">
                触发让某个智能体不用等你发消息，自己在指定房间发言：定时触发按间隔执行，事件触发在你在该房间发新消息、且该智能体不是房间成员时执行。
              </p>
              {triggersQuery.isPending ? (
                <p className="px-1 py-6 text-sm text-[#9a9aa0]">
                  加载中…
                </p>
              ) : triggers.length === 0 ? (
                <p className="px-1 py-6 text-sm leading-relaxed text-[#9a9aa0]">
                  还没有触发。点右上角「新建」，选一个智能体、一个房间和触发方式，它就会按时或在事件发生时去那个房间发言。
                </p>
              ) : (
                <div>
                  {triggers.map((t) => (
                    <div
                      key={t.id}
                      className="flex w-full items-center gap-3 py-3"
                    >
                      <button
                        type="button"
                        aria-label={`触发 ${t.name || t.instruction}`}
                        onClick={() => openTriggerEditor(t)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left active:bg-black/[0.03]"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f0f0f2] text-[#3a3a3c]">
                          <Icon
                            d={
                              t.kind === "event"
                                ? PATHS.zap
                                : PATHS.clock
                            }
                            size={20}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px]">
                            {t.name || t.instruction}
                          </span>
                          <span className="block truncate text-[13px] text-[#9a9aa0]">
                            {t.agentName} · 「{t.roomTitle}」 ·{" "}
                            {t.kind === "event"
                              ? "房间有新消息时"
                              : triggerIntervalLabel(
                                  t.intervalMinutes,
                                )}
                          </span>
                          <span className="block truncate text-xs text-[#9a9aa0]">
                            {triggerLastRunText(t)}
                          </span>
                        </span>
                      </button>
                      <SettingsSwitch
                        checked={t.enabled}
                        label={`启用触发 ${t.name || t.instruction}`}
                        onToggle={() =>
                          triggerToggleMutation.mutate(t)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {page === "triggerEdit" && (
            <>
              <div className="rounded-2xl bg-[#f7f7f8] px-4 py-4">
                <label
                  htmlFor="trigger-name"
                  className="mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  名称（可留空）
                </label>
                <input
                  {...FIELDS.createTrigger.name}
                  id="trigger-name"
                  aria-label="触发名称"
                  value={trigName}
                  onChange={(e) => setTrigName(e.target.value)}
                  placeholder="例如：每日晨报"
                  className="w-full rounded-[10px] bg-white px-3 py-2 text-sm outline-none ring-1 ring-black/[0.06] placeholder:text-[#9a9aa0]"
                />
                <label
                  htmlFor="trigger-agent"
                  className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  执行的智能体
                </label>
                <select
                  id="trigger-agent"
                  aria-label="执行的智能体"
                  value={trigAgentKey}
                  onChange={(e) => setTrigAgentKey(e.target.value)}
                  className="w-full rounded-[10px] bg-white px-3 py-2 text-sm outline-none ring-1 ring-black/[0.06]"
                >
                  <option value="muse">{skillMuseName}</option>
                  {skillAgents.map((a) => (
                    <option key={a.id} value={`agent-${a.id}`}>
                      {a.name || "未命名智能体"}
                    </option>
                  ))}
                </select>
                <label
                  htmlFor="trigger-room"
                  className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  目标房间
                </label>
                <select
                  id="trigger-room"
                  aria-label="目标房间"
                  value={trigRoomId ?? ""}
                  onChange={(e) =>
                    setTrigRoomId(
                      e.target.value === ""
                        ? null
                        : Number(e.target.value),
                    )
                  }
                  className="w-full rounded-[10px] bg-white px-3 py-2 text-sm outline-none ring-1 ring-black/[0.06]"
                >
                  {triggerRooms.length === 0 && (
                    <option value="">暂无可选房间</option>
                  )}
                  {triggerRooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                {triggerRooms.length === 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                    房间要在聊天里发过消息、保存下来之后才能选作目标。
                  </p>
                )}
                <span className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]">
                  触发方式
                </span>
                <div
                  className="flex gap-2"
                  role="group"
                  aria-label="触发方式"
                >
                  <button
                    type="button"
                    aria-pressed={trigKind === "schedule"}
                    onClick={() => setTrigKind("schedule")}
                    className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                      trigKind === "schedule"
                        ? "bg-[#2f6bff] text-white"
                        : "bg-white text-[#3a3a3c] ring-1 ring-black/[0.06]"
                    }`}
                  >
                    定时
                  </button>
                  <button
                    type="button"
                    aria-pressed={trigKind === "event"}
                    onClick={() => setTrigKind("event")}
                    className={`flex-1 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                      trigKind === "event"
                        ? "bg-[#2f6bff] text-white"
                        : "bg-white text-[#3a3a3c] ring-1 ring-black/[0.06]"
                    }`}
                  >
                    事件
                  </button>
                </div>
                {trigKind === "schedule" ? (
                  <>
                    <label
                      htmlFor="trigger-interval"
                      className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                    >
                      执行间隔
                    </label>
                    <select
                      id="trigger-interval"
                      aria-label="执行间隔"
                      value={trigInterval}
                      onChange={(e) =>
                        setTrigInterval(Number(e.target.value))
                      }
                      className="w-full rounded-[10px] bg-white px-3 py-2 text-sm outline-none ring-1 ring-black/[0.06]"
                    >
                      {TRIGGER_INTERVALS.map((i) => (
                        <option key={i.minutes} value={i.minutes}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
                      到间隔就会执行一次，回复直接发到目标房间里。新建的定时触发会在下一次检查时立即执行一次，之后按间隔重复。
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-[11px] leading-relaxed text-[#9a9aa0]">
                    事件：你在目标房间发出新消息时触发一次。若这个智能体已经是该房间的成员，它会按成员身份回复，事件触发不会重复执行。
                  </p>
                )}
                <label
                  htmlFor="trigger-instruction"
                  className="mt-4 mb-1 block text-xs font-medium text-[#6e6e73]"
                >
                  触发指令
                </label>
                <textarea
                  {...FIELDS.createTrigger.instruction}
                  id="trigger-instruction"
                  aria-label="触发指令"
                  rows={5}
                  value={trigInstruction}
                  onChange={(e) => setTrigInstruction(e.target.value)}
                  placeholder="触发时要这个智能体做什么，如：总结这个房间最近的讨论，给出下一步建议"
                  className="w-full resize-y rounded-[10px] bg-white px-3 py-2 text-sm leading-relaxed outline-none ring-1 ring-black/[0.06] placeholder:text-[#9a9aa0]"
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm">启用触发</span>
                    <span className="block text-xs text-[#9a9aa0]">
                      {trigEnabled
                        ? "已启用，会按上面的方式执行"
                        : "已停用，保留设置但不执行"}
                    </span>
                  </span>
                  <SettingsSwitch
                    checked={trigEnabled}
                    label="启用触发"
                    onToggle={() => setTrigEnabled(!trigEnabled)}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={submitTrigger}
                disabled={triggerSaveMutation.isPending}
                className="mt-4 w-full rounded-xl bg-[#2f6bff] py-2.5 text-sm font-medium text-white disabled:bg-black/[0.08] disabled:text-[#9a9aa0]"
              >
                {triggerSaveMutation.isPending
                  ? "保存中…"
                  : editingTriggerId != null
                    ? "保存"
                    : "创建"}
              </button>

              {trigError && (
                <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
                  {trigError}
                </p>
              )}

              {editingTriggerId != null && (
                <button
                  type="button"
                  aria-label="删除触发"
                  disabled={triggerDeleteMutation.isPending}
                  onClick={() => {
                    if (!trigConfirmDelete) {
                      setTrigConfirmDelete(true);
                      return;
                    }
                    triggerDeleteMutation.mutate(editingTriggerId);
                  }}
                  className={`mt-5 w-full rounded-xl py-2.5 text-sm font-medium ${
                    trigConfirmDelete
                      ? "bg-[#b3261e] text-white"
                      : "bg-[#fce8e6] text-[#b3261e]"
                  }`}
                >
                  {triggerDeleteMutation.isPending
                    ? "删除中…"
                    : trigConfirmDelete
                      ? "确认删除这个触发？"
                      : "删除触发"}
                </button>
              )}
            </>
          )}

          {saveError && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {saveError}
            </p>
          )}
        </div>
      </div>

      {/* 上传文件 dialog — opened by 添加文件 on one skill's edit
          page; the chosen file is attached into THAT skill. */}
      {skillUploadOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={(e) => {
            e.stopPropagation();
            closeSkillUpload();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="上传文件"
            className="w-full max-w-md rounded-t-3xl bg-white px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-medium">上传文件</h4>
            <input
              ref={skillUploadInputRef}
              type="file"
              accept=".md,.txt,.csv,.py,.json,.yaml,.yml,.pdf,text/*,application/pdf"
              className="hidden"
              aria-label="选择要上传的文件"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void stageSkillUploadFile(f);
              }}
            />
            <button
              type="button"
              aria-label="拖放或选择要上传的文件"
              onClick={() => skillUploadInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setSkillUploadDrag(true);
              }}
              onDragLeave={() => setSkillUploadDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setSkillUploadDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void stageSkillUploadFile(f);
              }}
              className={`mt-4 flex w-full flex-col items-center rounded-2xl border border-dashed px-4 py-8 text-center ${
                skillUploadDrag
                  ? "border-[#2f6bff] bg-[#e8effd]"
                  : "border-black/25 bg-white"
              }`}
            >
              <span className="text-[#3a3a3c]">
                <Icon d={PATHS.upload} size={26} />
              </span>
              <span className="mt-3 text-[15px]">
                拖放或选择要上传的{" "}
                <span className="underline decoration-dotted underline-offset-4">
                  文件
                </span>
              </span>
              <span className="mt-1.5 text-[13px] text-[#9a9aa0]">
                (PDF、CSV、PY、TXT 和 MD)
              </span>
              {skillUploadPick && (
                <span className="mt-3 max-w-full truncate rounded-full bg-[#f0f0f2] px-3 py-1 text-[13px] text-[#3a3a3c]">
                  {skillUploadPick.fileName}
                  {skillUploadPick.size != null
                    ? ` · ${(skillUploadPick.size / 1024).toFixed(1)} KB`
                    : ""}
                </span>
              )}
            </button>
            <p className="mt-3 text-[13px] leading-relaxed text-[#9a9aa0]">
              文件会添加到当前技能「{skillName.trim() || "未命名技能"}
              」里，智能体执行这个技能时会连同文件内容一起参考。
            </p>
            {skillUploadError && (
              <p
                role="alert"
                className="mt-2 text-[13px] text-[#c0392b]"
              >
                {skillUploadError}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                aria-label="取消上传"
                onClick={closeSkillUpload}
                className="rounded-full px-4 py-2 text-sm text-[#191919] hover:bg-black/[0.05]"
              >
                取消
              </button>
              <button
                type="button"
                aria-label="上传文件到技能"
                disabled={
                  !skillUploadPick || skillAddFileMutation.isPending
                }
                onClick={confirmSkillUpload}
                className="rounded-full bg-[#2f6bff] px-5 py-2 text-sm font-medium text-white disabled:bg-black/[0.08] disabled:text-[#9a9aa0]"
              >
                {skillAddFileMutation.isPending ? "上传中…" : "上传"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Muse's own settings panel ---------------- */

/**
 * Muse's settings — opened by tapping Muse's avatar. Muse is the
 * fixed platform agent: its model and API channel are shown as fixed
 * facts that cannot change, while the display name, role, avatar
 * colour, enabled switch, thinking level and extra system prompt are
 * editable and saved server-side, exactly like an added agent's
 * settings minus the provider fields.
 */
function MusePanel({
  initial,
  onClose,
}: {
  initial: MuseSettings;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState(initial.role);
  const [color, setColor] = useState(initial.color || "#2f6bff");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [thinking, setThinking] = useState(initial.thinking);
  // The legacy long-term-memory text is folded into the one
  // 系统指令 field (the separate 长期记忆 field is gone — it
  // duplicated the system prompt): the form shows the combined
  // text and saves memory back as "".
  const [systemPrompt, setSystemPrompt] = useState(
    [initial.systemPrompt, initial.memory]
      .filter((s) => s.trim() !== "")
      .join("\n\n"),
  );
  const [note, setNote] = useState(initial.note);
  const [nameError, setNameError] = useState("");
  const [saveError, setSaveError] = useState("");
  const avatarDraft = useAvatarDraft(initial.avatarUrl);

  const saveMutation = useMutation({
    mutationFn: async () =>
      await api.updateMuseSettings({
        name: name.trim(),
        role: role.trim(),
        color,
        enabled,
        thinking: thinking as (typeof THINKING_LEVELS)[number],
        systemPrompt,
        memory: "",
        note: note.trim(),
        avatarImage: avatarDraft.image,
        removeAvatar: avatarDraft.removed,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(["museSettings"], res);
      queryClient.invalidateQueries({ queryKey: ["museSettings"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
    },
    onError: (err) =>
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function handleSave() {
    if (!name.trim()) {
      setNameError("名称不能为空，请填写一个名称");
      return;
    }
    setNameError("");
    saveMutation.mutate();
  }

  const inputCls =
    "w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm outline-none placeholder:text-[#9a9aa0]";
  const labelCls = "mb-1 block text-xs font-medium text-[#6e6e73]";

  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Muse 设置"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
          <h3 className="text-base font-semibold">Muse 设置</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
          >
            <Icon d={PATHS.x} size={17} />
          </button>
        </div>
        <div data-modal-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-5">
          <div className="flex items-center gap-3">
            <AvatarEditor
              size={56}
              label="更换 Muse 头像图片"
              previewUrl={avatarDraft.previewUrl}
              onPick={avatarDraft.pick}
              onRemove={avatarDraft.remove}
            >
              <MuseAvatar size={56} color={color} />
            </AvatarEditor>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {name.trim() || "Muse"}
              </p>
              <p className="truncate text-[13px] text-[#9a9aa0]">
                {role.trim() || "本空间的固定智能体"}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="启用 Muse"
              onClick={() => setEnabled(!enabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                enabled ? "bg-[#34c759]" : "bg-black/[0.15]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  enabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          {!enabled && (
            <p className="mt-2 text-[13px] leading-relaxed text-[#9a9aa0]">
              已停用：Muse 会保持沉默，不回复任何消息，直到重新打开这个开关。
            </p>
          )}
          {avatarDraft.error && (
            <p role="alert" className="mt-2 text-[13px] text-[#c0392b]">
              {avatarDraft.error}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="muse-name">
                显示名称
              </label>
              <input
                id="muse-name"
                {...FIELDS.updateMuseSettings.name}
                className={inputCls}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError("");
                }}
                placeholder="Muse"
                autoComplete="off"
              />
              {nameError && (
                <p role="alert" className="mt-1 text-xs text-[#c0392b]">
                  {nameError}
                </p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="muse-role">
                角色
              </label>
              <input
                id="muse-role"
                {...FIELDS.updateMuseSettings.role}
                className={inputCls}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="如：全能助手"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="muse-note">
              备注
            </label>
            <input
              id="muse-note"
              {...FIELDS.updateMuseSettings.note}
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="只给自己看，显示在智能体列表里，不会发给智能体"
              autoComplete="off"
            />
          </div>

          <div className="mt-3">
            <span className={labelCls}>头像颜色</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {AGENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`头像颜色 ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${
                    color === c ? "ring-2 ring-[#191919] ring-offset-2" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="自定义头像颜色"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#2f6bff"}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-9 cursor-pointer rounded bg-transparent"
              />
              <input
                aria-label="头像颜色代码"
                {...FIELDS.updateMuseSettings.color}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                spellCheck={false}
                className="w-24 rounded-[8px] bg-[#f0f0f2] px-2 py-1.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="muse-thinking">
              思考强度
            </label>
            <select
              id="muse-thinking"
              className={inputCls}
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
            >
              {THINKING_LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  {lv}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="muse-prompt">
              系统指令（系统提示词）
            </label>
            <textarea
              id="muse-prompt"
              {...FIELDS.updateMuseSettings.systemPrompt}
              className={`${inputCls} min-h-[96px] resize-y`}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="留空则不附加；填写的内容会作为补充要求加到 Muse 的系统提示里"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              只属于 Muse，它在任何房间回复时都会带上，其他智能体看不到。想让 Muse
              长期记住的事也直接写在这里——原来的「长期记忆」是手动填写、和系统指令重复，已经合并进来。
              {initial.memory.trim()
                ? "之前写在「长期记忆」里的内容已并入上方，保存后就只存在于这一处。"
                : ""}
            </p>
          </div>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#9a9aa0]">模型</dt>
              <dd className="text-right">
                平台内置 Muse
                <span className="ml-1.5 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-[#6e6e73]">
                  固定，不可更改
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#9a9aa0]">API</dt>
              <dd className="text-right">
                平台通道
                <span className="ml-1.5 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-[#6e6e73]">
                  固定，不可更改
                </span>
              </dd>
            </div>
          </dl>

          {saveError && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {saveError}
            </p>
          )}
        </div>
        <div className="shrink-0 border-t border-black/[0.06] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={handleSave}
            className="w-full rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? "保存中…" : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- group settings panel ---------------- */

/**
 * One group's own settings — opened by tapping the group's avatar in
 * the group list or at the top of the group chat (tapping anywhere
 * else on the row still opens the chat). Edits the group name and
 * the group icon: colour + glyph, the same controls as the 「我」
 * profile panel (swatches + custom colour picker + #RRGGBB input)
 * with a live preview. Clearing both icon fields restores the
 * default group avatar. Saved server-side via updateGroupSettings.
 */
function GroupSettingsPanel({
  conv,
  onClose,
}: {
  conv: Conversation;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(conv.title);
  const [glyph, setGlyph] = useState(conv.iconGlyph);
  const [color, setColor] = useState(conv.iconColor);
  const [stageOwner, setStageOwner] = useState(conv.stageOwner);
  const [titleError, setTitleError] = useState("");
  const [saveError, setSaveError] = useState("");
  const avatarDraft = useAvatarDraft(conv.avatarUrl);

  // The stage owner （阶段负责人） is picked from the room's
  // current members: Muse (when a member) plus the member agents.
  const ownerAgentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents({}),
  });
  const ownerMuseQuery = useQuery({
    queryKey: ["museSettings"],
    queryFn: () => api.getMuseSettings({}),
  });
  const ownerAgents = ownerAgentsQuery.data?.agents ?? [];
  const ownerOptions: { value: string; label: string }[] = [
    { value: "", label: "不指定" },
    ...(conv.museMember
      ? [
          {
            value: "muse",
            label: ownerMuseQuery.data?.name || "Muse",
          },
        ]
      : []),
    ...conv.memberAgentIds.map((id) => ({
      value: String(id),
      label:
        ownerAgents.find((a) => a.id === id)?.name || `智能体 ${id}`,
    })),
  ];
  const ownerStale =
    stageOwner !== "" &&
    !ownerOptions.some((o) => o.value === stageOwner);

  const saveMutation = useMutation({
    mutationFn: async () =>
      await api.updateGroupSettings({
        conversationId: conv.id,
        title: title.trim(),
        iconColor: color.trim(),
        iconGlyph: glyph.trim(),
        stageOwner,
        avatarImage: avatarDraft.image,
        removeAvatar: avatarDraft.removed,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
    },
    onError: (err) =>
      setSaveError(
        `保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      ),
  });

  function handleSave() {
    if (!title.trim()) {
      setTitleError("房间名称不能为空，请填写一个名称");
      return;
    }
    setTitleError("");
    saveMutation.mutate();
  }

  const inputCls =
    "w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2 text-sm outline-none placeholder:text-[#9a9aa0]";
  const labelCls = "mb-1 block text-xs font-medium text-[#6e6e73]";

  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="房间设置"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
          <h3 className="text-base font-semibold">房间设置</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
          >
            <Icon d={PATHS.x} size={17} />
          </button>
        </div>
        <div
          data-modal-scroll
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-5"
        >
          <div className="flex items-center gap-3">
            <AvatarEditor
              size={56}
              label="更换房间头像图片"
              previewUrl={avatarDraft.previewUrl}
              onPick={avatarDraft.pick}
              onRemove={avatarDraft.remove}
            >
              <GroupAvatar
                size={56}
                title={title.trim()}
                iconColor={color.trim()}
                iconGlyph={glyph.trim()}
              />
            </AvatarEditor>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {title.trim() || "房间"}
              </p>
              <p className="truncate text-[13px] text-[#9a9aa0]">
                房间在列表和聊天框顶部显示的样子
              </p>
            </div>
          </div>

          {avatarDraft.error && (
            <p role="alert" className="mt-2 text-[13px] text-[#c0392b]">
              {avatarDraft.error}
            </p>
          )}

          <div className="mt-4">
            <label className={labelCls} htmlFor="group-settings-title">
              房间名称
            </label>
            <input
              id="group-settings-title"
              {...FIELDS.updateGroupSettings.title}
              className={inputCls}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError("");
              }}
              placeholder="房间名称"
              autoComplete="off"
            />
            {titleError && (
              <p role="alert" className="mt-1 text-xs text-[#c0392b]">
                {titleError}
              </p>
            )}
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="group-settings-glyph">
              图标文字
            </label>
            <input
              id="group-settings-glyph"
              {...FIELDS.updateGroupSettings.iconGlyph}
              className={inputCls}
              value={glyph}
              onChange={(e) => setGlyph(e.target.value)}
              placeholder="留空则显示群名首字，如：群"
              autoComplete="off"
            />
          </div>

          <div className="mt-3">
            <span className={labelCls}>图标颜色</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`图标颜色 ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${
                    color === c ? "ring-2 ring-[#191919] ring-offset-2" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="自定义图标颜色"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#5d6a82"}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-9 cursor-pointer rounded bg-transparent"
              />
              <input
                aria-label="图标颜色代码"
                {...FIELDS.updateGroupSettings.iconColor}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                spellCheck={false}
                className="w-24 rounded-[8px] bg-[#f0f0f2] px-2 py-1.5 text-xs outline-none"
              />
            </div>
            {(color || glyph || avatarDraft.previewUrl) && (
              <button
                type="button"
                onClick={() => {
                  setColor("");
                  setGlyph("");
                  avatarDraft.remove();
                }}
                className="mt-2 rounded-lg bg-black/[0.05] px-3 py-1.5 text-[13px]"
              >
                恢复默认图标
              </button>
            )}
          </div>

          <div className="mt-4">
            <label className={labelCls} htmlFor="group-settings-owner">
              阶段负责人
            </label>
            <select
              id="group-settings-owner"
              className={inputCls}
              value={ownerStale ? "" : stageOwner}
              onChange={(e) => setStageOwner(e.target.value)}
            >
              {ownerOptions.map((o) => (
                <option key={o.value || "none"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-[#9a9aa0]">
              {ownerStale
                ? "当前负责人已不是本房间成员，保存后将清除负责人。"
                : "指定后，每轮回复由负责人先发言统筹，其他成员配合补充，避免重复干活。负责人需是本房间成员；成员被移出房间后负责人自动失效。"}
            </p>
          </div>

          {saveError && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {saveError}
            </p>
          )}
        </div>
        <div className="shrink-0 border-t border-black/[0.06] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={handleSave}
            className="w-full rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- group member management panel ---------------- */

/**
 * Member management for one group chat, opened from the + at the top
 * of the group pane. Top: the current members (the user is fixed;
 * agent members can be removed). Bottom: every recorded agent —
 * Muse plus all added agents — tap one to add it to the group, tap
 * again to take it out. Only members reply in the group.
 */
function GroupMembersPanel({
  conversationId,
  title,
  profile,
  agents,
  members,
  muse,
  onClose,
}: {
  conversationId: number;
  title: string;
  profile: Profile;
  agents: Agent[];
  members: GroupMembers;
  muse: MuseSettings;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  // Membership toggles apply OPTIMISTICALLY: the row flips the
  // moment it is tapped, the server call settles in the
  // background, and a failure rolls the flip back with a note.
  // The previous shape waited for the round-trip with every row
  // in the panel disabled — on a slow channel (or one busy with
  // image previews) that read as "tapping 加入 does nothing for
  // ages", and a second agent could not be added until the first
  // one's round-trip finished.
  const toggleMutation = useMutation({
    mutationFn: async (vars: { agentId: number | null; member: boolean }) =>
      await api.setGroupMember({
        conversationId,
        agentId: vars.agentId,
        member: vars.member,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({
        queryKey: ["groupMembers", conversationId],
      });
      const prev = queryClient.getQueryData<GroupMembers>([
        "groupMembers",
        conversationId,
      ]);
      if (prev) {
        const next: GroupMembers =
          vars.agentId == null
            ? {
                ...prev,
                museMember: vars.member,
                museEnabled: vars.member ? true : prev.museEnabled,
              }
            : {
                ...prev,
                agentIds: vars.member
                  ? [...prev.agentIds, vars.agentId]
                  : prev.agentIds.filter((id) => id !== vars.agentId),
                disabledAgentIds: vars.member
                  ? prev.disabledAgentIds
                  : prev.disabledAgentIds.filter(
                      (id) => id !== vars.agentId,
                    ),
              };
        queryClient.setQueryData(["groupMembers", conversationId], next);
      }
      return { prev };
    },
    onSuccess: (res) => {
      setNote("");
      queryClient.setQueryData(["groupMembers", conversationId], res);
      // A membership change can auto-rename the room while its
      // title is still a default — refresh the lists and header.
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(
          ["groupMembers", conversationId],
          context.prev,
        );
      }
      setNote("成员更新失败，请重试");
    },
  });
  const memberAgents = agents.filter((a) => members.agentIds.includes(a.id));
  const hasAgentMembers = members.museMember || memberAgents.length > 0;

  function toggleRow(agentId: number | null, isMember: boolean, name: string) {
    return (
      <button
        key={agentId == null ? "muse" : `agent-${agentId}`}
        type="button"
        onClick={() =>
          toggleMutation.mutate({ agentId, member: !isMember })
        }
        aria-label={isMember ? `将 ${name} 移出房间` : `将 ${name} 加入房间`}
        aria-pressed={isMember}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.03]"
      >
        {agentId == null ? (
          <MuseAvatar size={40} color={muse.color} imageUrl={muse.avatarUrl} />
        ) : (
          (() => {
            const found = agents.find((a) => a.id === agentId);
            return (
              <AgentAvatar
                color={found?.color ?? "#5d6a82"}
                glyph={found?.glyph ?? ""}
                name={name}
                size={40}
                imageUrl={found?.avatarUrl ?? null}
                logo={found ? vendorLogoFor(found) : null}
              />
            );
          })()
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {name}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
            {agentId == null
              ? "本空间的固定智能体"
              : agents.find((a) => a.id === agentId)?.role || "添加的智能体"}
          </span>
        </span>
        <span
          className={`shrink-0 text-[13px] font-medium ${
            isMember ? "text-[#1fa637]" : "text-[#2f6bff]"
          }`}
        >
          {isMember ? "已加入 · 点按移出房间" : "加入"}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={modalBackdropRef}
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="成员管理"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
          <h3 className="min-w-0 truncate text-base font-semibold">
            成员 · {title}
          </h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05]"
          >
            <Icon d={PATHS.x} size={17} />
          </button>
        </div>
        <div data-modal-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-5">
          <p className="text-xs font-medium text-[#6e6e73]">当前成员</p>
          <div className="mt-1.5">
            <div className="flex items-center gap-3 rounded-xl px-2 py-2">
              <UserAvatar size={40} profile={profile} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {profile.name || "我"}
                </span>
                <span className="mt-0.5 block text-[13px] text-[#9a9aa0]">
                  我 · 房主
                </span>
              </span>
            </div>
            {members.museMember && (
              <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                <MuseAvatar
                  size={40}
                  color={muse.color}
                  imageUrl={muse.avatarUrl}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {muse.name || "Muse"}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-[#9a9aa0]">
                    本空间的固定智能体
                    {members.museEnabled ? "" : " · 在本房间已关掉"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() =>
                    toggleMutation.mutate({ agentId: null, member: false })
                  }
                  aria-label={`将 ${muse.name || "Muse"} 移出房间`}
                  className="shrink-0 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[13px] text-[#c0392b] disabled:opacity-50"
                >
                  移出房间
                </button>
              </div>
            )}
            {memberAgents.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2"
              >
                <AgentAvatar
                  color={a.color}
                  glyph={a.glyph}
                  name={a.name}
                  size={40}
                  imageUrl={a.avatarUrl}
                  logo={vendorLogoFor(a)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {a.name || "未命名智能体"}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
                    {a.role || "添加的智能体"}
                    {members.disabledAgentIds.includes(a.id)
                      ? " · 在本房间已关掉"
                      : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() =>
                    toggleMutation.mutate({ agentId: a.id, member: false })
                  }
                  aria-label={`将 ${a.name} 移出房间`}
                  className="shrink-0 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[13px] text-[#c0392b] disabled:opacity-50"
                >
                  移出房间
                </button>
              </div>
            ))}
            {!hasAgentMembers && (
              <p className="px-2 py-1 text-[13px] text-[#9a9aa0]">
                目前只有你一个人，还没有智能体成员，房间里发消息不会有回复。
              </p>
            )}
          </div>

          <p className="mt-4 text-xs font-medium text-[#6e6e73]">
            已录入的智能体 · 点按加入或移出
          </p>
          <div className="mt-1.5">
            {toggleRow(null, members.museMember, muse.name || "Muse")}
            {agents.map((a) =>
              toggleRow(a.id, members.agentIds.includes(a.id), a.name || "未命名智能体"),
            )}
            {agents.length === 0 && (
              <p className="px-2 py-1 text-[13px] leading-relaxed text-[#9a9aa0]">
                还没有添加其他智能体。在智能体栏右上角 + 里选「添加 Agent」可以添加。
              </p>
            )}
          </div>

          {note && (
            <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
              {note}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-[#9a9aa0]">
            只有房间里的智能体成员会在房间里回复；没加进来的不会回复。被停用或还没配好
            API 的智能体即使在房间里也会保持沉默。
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
            「移出房间」只是让智能体离开这个房间，不会删除这个智能体，它在其他房间和智能体列表里都不受影响。彻底删除一个智能体只能在智能体列表里点它的头像、进入它自己的设置后操作。
          </p>
        </div>
        <div className="shrink-0 border-t border-black/[0.06] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-black/[0.05] px-3 py-2.5 text-sm font-medium"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- web composer toolbar ----------------
 * The web-version toolbar inside the composer, shown ONLY when
 * the room's replying member is a web-token agent — API agents,
 * Muse and empty rooms render nothing here at all (their
 * composer stays exactly as before). Like the web products
 * themselves, the toolbar is per site, never one shared set:
 * - DeepSeek: 快速/专家 mode segmented control plus the
 *   independent 深度思考 and 智能搜索 toggle pills — the three
 *   real request parameters of DeepSeek's web UI.
 * - 豆包： its 联网搜索 toggle plus the pill row of its latest
 *   web composer （云电脑 / 项目 / 技能 / 插件）, and — the
 *   element the previous version misread as a static label —
 *   the model selector at the right end: the site's own model
 *   menu button ("自动 · 低" is model + 推理强度， not a mode
 *   caption). Tapping it opens the site's model menu as the
 *   site lists it: 自动 / 豆包 2.1 Lite / 豆包 2.1 Pro (its
 *   own models, really selectable here — all three are the
 *   site's 工作任务-mode models, and the server sends the
 *   official client's full selection bundle for them:
 *   mode parameters + model_item_key + reasoning_effort),
 *   the menu's third-party models (DeepSeek V4.1 Flash,
 *   Qwen 4 Max, Kimi K3.1 Pro / 高速， Kimi K3, GLM 5.3 /
 *   Flash, plus the 「更多模型」 submenu's DeepSeek V4 Pro /
 *   Qwen 3.8 Max / Qwen 3.8 Flash — listed with their rate
 *   tags as the site shows them; the space does not select
 *   other vendors' models through Doubao, so tapping one
 *   says so and points at those vendors' own web agents),
 *   plus the 推理强度 row （低 / 中 / 高）. Model + reasoning
 *   are saved per agent; changing either drops the agent's
 *   stored官网 conversations server-side, so the next reply
 *   starts a fresh one under the new selection. Of the screenshot pills only 技能 has a
 *   real counterpart here — the space's skills, which really
 *   enter this agent's replies — so it opens the skills page
 *   and shows how many skills currently apply. 云电脑 / 项目 /
 *   插件 run in Doubao's own cloud environment and the token
 *   protocol carries no such switch, so those pills are
 *   visibly marked 暂不支持 and explain that when tapped
 *   instead of pretending to work.
 * - Every other web site: its own label + login state + 技能 —
 *   those sites' web UIs expose no mode/search switch the token
 *   protocol can drive, so none is faked for them.
 * Every mode/search switch saves immediately through
 * updateAgentWebOptions onto the same fields the settings panel
 * edits, so toolbar and settings never disagree, and the next
 * reply really carries the new values. */
function WebComposerToolbar({
  agent,
  candidates,
  pickedId,
  onPick,
  onOpenSkills,
  onNotice,
}: {
  agent: Agent;
  candidates: Agent[];
  pickedId: number | null;
  onPick: (agentId: number) => void;
  onOpenSkills: () => void;
  onNotice: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const meta = webSiteMeta(agent.provider);
  // 豆包's catalog for this toolbar (the model button's label
  // and the picker sheet both render from it): the account's
  // detected menu or the fallback list.
  const doubaoModels = doubaoModelsOf(agent.webMenu);
  const doubaoKey = doubaoSelectedKeyOf(agent);
  const doubaoEntry = doubaoEntryOf(doubaoModels, doubaoKey);
  const doubaoReasoning = doubaoReasoningValueOf(
    agent.webReasoning,
    doubaoEntry,
  );
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: () => api.listSkills({}),
  });
  const allSkills = skillsQuery.data?.skills ?? [];
  const skillCount = allSkills.filter(
    (s) =>
      s.enabled &&
      (s.scope === "all" || s.agentIds.includes(agent.id)),
  ).length;

  const optionsMutation = useMutation({
    mutationFn: async (next: {
      webMode: string;
      webThinking: boolean;
      webSearch: boolean;
      webModel: string;
      webModelKey: string;
      webReasoning: string;
    }) =>
      await api.updateAgentWebOptions({
        agentId: agent.id,
        webMode: next.webMode as "" | "default" | "expert" | "fast",
        webThinking: next.webThinking,
        webSearch: next.webSearch,
        webModel: next.webModel,
        webModelKey: next.webModelKey,
        webReasoning: next.webReasoning,
      }),
    onMutate: (next) => {
      queryClient.setQueryData<ApiResponse<typeof api, "listAgents">>(
        ["agents"],
        (old) =>
          old
            ? {
                agents: old.agents.map((a) =>
                  a.id === agent.id
                    ? {
                        ...a,
                        webMode: next.webMode,
                        webThinking: next.webThinking,
                        webSearch: next.webSearch,
                        webModel: next.webModel,
                        webModelKey: next.webModelKey,
                        webReasoning: next.webReasoning,
                      }
                    : a,
                ),
              }
            : old,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onNotice(
        `网页版选项保存失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });
  const busy = optionsMutation.isPending;
  const currentMode = agent.webMode || meta.defaultMode || "";
  function apply(next: Partial<{
    webMode: string;
    webThinking: boolean;
    webSearch: boolean;
    webModel: string;
    webModelKey: string;
    webReasoning: string;
  }>) {
    optionsMutation.mutate({
      webMode: next.webMode ?? currentMode,
      webThinking: next.webThinking ?? agent.webThinking,
      webSearch: next.webSearch ?? agent.webSearch,
      webModel: next.webModel ?? agent.webModel,
      webModelKey: next.webModelKey ?? agent.webModelKey,
      webReasoning: next.webReasoning ?? agent.webReasoning,
    });
  }
  // 豆包's model menu (opened from the toolbar's model button).
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // 识别可用模型 from inside the model menu: re-reads the
  // account's own menu config; the agents query refresh brings
  // the new catalog into this toolbar (and everywhere else).
  const detectMenuMutation = useMutation({
    mutationFn: async () =>
      await api.detectDoubaoModels({ agentId: agent.id }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onNotice(
        `已按该账号的官网菜单识别到 ${data.menu.models.length} 个模型，菜单已更新`,
      );
    },
    onError: (err) => {
      onNotice(
        `识别可用模型失败：${err instanceof Error ? err.message : "网络错误"}`,
      );
    },
  });

  const pillCls = (on: boolean) =>
    `flex h-6 min-h-0 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
      on
        ? "border-[#1664ff]/35 bg-[#e8effd] text-[#1664ff]"
        : "border-black/[0.07] bg-black/[0.03] text-[#3a3a3c] hover:bg-black/[0.05]"
    }`;
  const segWrapCls =
    "flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.05] p-0.5";
  const segBtnCls = (on: boolean) =>
    `h-5 min-h-0 shrink-0 rounded-full px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
      on ? "bg-[#2f6bff] text-white shadow-sm" : "text-[#6e6e73]"
    }`;

  const skillsPill = (
    <button
      key="skills"
      type="button"
      aria-label={`技能，已启用 ${skillCount} 个，打开技能设置`}
      onClick={onOpenSkills}
      className={pillCls(skillCount > 0)}
    >
      <Icon d={PATHS.sparkles} size={12} />
      技能
      {skillCount > 0 ? ` · ${skillCount}` : ""}
      <Icon d={PATHS.chevronRight} size={10} />
    </button>
  );

  let controls: ReactNode = null;
  if (agent.provider === "deepseek" && meta.modes) {
    controls = (
      <>
        <div
          className={segWrapCls}
          role="group"
          aria-label="DeepSeek 模式"
        >
          {meta.modes.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-label={`DeepSeek 模式 ${m.label}`}
              aria-pressed={currentMode === m.value}
              disabled={busy}
              onClick={() => apply({ webMode: m.value })}
              className={segBtnCls(currentMode === m.value)}
            >
              {m.value === "default" ? "快速" : "专家"}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={agent.webThinking}
          aria-label="深度思考"
          disabled={busy}
          onClick={() => apply({ webThinking: !agent.webThinking })}
          className={pillCls(agent.webThinking)}
        >
          <Icon d={PATHS.brain} size={12} />
          深度思考
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={agent.webSearch}
          aria-label="智能搜索"
          disabled={busy}
          onClick={() => apply({ webSearch: !agent.webSearch })}
          className={pillCls(agent.webSearch)}
        >
          <Icon d={PATHS.globe} size={12} />
          智能搜索
        </button>
        {skillsPill}
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 pl-1 text-[11px] whitespace-nowrap text-[#9a9aa0] sm:flex">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${agent.webStatus === "logged_in" ? "bg-[#34c759]" : "bg-[#b9bec7]"}`}
          />
          DeepSeek 网页版
          {currentMode === "expert" ? " · 专家" : " · 快速"}
        </span>
      </>
    );
  } else if (agent.provider === "doubao") {
    const unsupported = (label: string) => (
      <button
        key={label}
        type="button"
        aria-label={`${label}（暂不支持）`}
        onClick={() =>
          onNotice(
            `豆包网页版的「${label}」运行在豆包自己的云端环境里，令牌直连协议没有这一项，空间里暂不支持`,
          )
        }
        className="flex h-6 min-h-0 shrink-0 items-center gap-1 rounded-full border border-black/[0.07] bg-black/[0.03] px-2 text-[11px] font-medium whitespace-nowrap text-[#6e6e73] transition-colors hover:bg-black/[0.05]"
      >
        {label === "云电脑" ? (
          <Icon d={PATHS.cloud} size={12} />
        ) : label === "项目" ? (
          <Icon d={PATHS.folder} size={12} />
        ) : (
          <Icon d={PATHS.puzzle} size={12} />
        )}
        {label}
        <Icon d={PATHS.chevronRight} size={10} />
      </button>
    );
    const currentModelLabel = doubaoEntry.name;
    const currentReasoning = doubaoReasoningValueOf(
      agent.webReasoning,
      doubaoEntry,
    );
    const currentReasoningLabel = doubaoLevelName(
      doubaoEntry,
      currentReasoning,
    );
    controls = (
      <>
        <button
          type="button"
          role="switch"
          aria-checked={agent.webSearch}
          aria-label="联网搜索"
          disabled={busy}
          onClick={() => apply({ webSearch: !agent.webSearch })}
          className={pillCls(agent.webSearch)}
        >
          <Icon d={PATHS.globe} size={12} />
          联网搜索
        </button>
        {unsupported("云电脑")}
        {unsupported("项目")}
        {skillsPill}
        {unsupported("插件")}
        {/* The site's model-menu button: current model +
            推理强度， exactly what the 豆包 web composer shows
            at its right end ("GLM 5.3 Flash 低" style). It is a
            real selector — tapping opens the model menu below
            the toolbar's render. */}
        <button
          type="button"
          aria-label={`模型 ${currentModelLabel}，推理强度 ${currentReasoningLabel}，打开模型菜单`}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => setModelPickerOpen(true)}
          className="ml-auto flex h-6 min-h-0 shrink-0 items-center gap-1.5 rounded-full border border-black/[0.07] bg-black/[0.03] px-2 text-[11px] font-medium whitespace-nowrap text-[#3a3a3c] transition-colors hover:bg-black/[0.05]"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${agent.webStatus === "logged_in" ? "bg-[#34c759]" : "bg-[#b9bec7]"}`}
          />
          {currentModelLabel} · {currentReasoningLabel}
          <Icon d={PATHS.chevronDown} size={11} />
        </button>
      </>
    );
  } else {
    controls = (
      <>
        <span className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-black/[0.07] bg-black/[0.03] px-2 text-[11px] font-medium whitespace-nowrap text-[#3a3a3c]">
          {meta.label} 网页版
        </span>
        <span
          className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] whitespace-nowrap ${
            agent.webStatus === "logged_in"
              ? "bg-[#e6f4ea] text-[#137333]"
              : "bg-black/[0.04] text-[#6e6e73]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${agent.webStatus === "logged_in" ? "bg-[#34c759]" : "bg-[#b9bec7]"}`}
          />
          {agent.webStatus === "logged_in" ? "已登录" : "尚未登录"}
        </span>
        {skillsPill}
        {agent.provider === "wenxin" && (
          <span className="flex h-6 shrink-0 items-center rounded-full bg-[#fce8e6] px-2 text-[11px] whitespace-nowrap text-[#b3261e]">
            仅验证登录 · 暂不能发消息
          </span>
        )}
      </>
    );
  }

  return (
    <div
      data-gesture-off=""
      aria-label={`网页版工具栏 ${agent.name}`}
      className="border-t border-black/[0.05] pt-1 pb-0"
    >
      {candidates.length > 1 && (
        <div
          className="flex items-center gap-1 overflow-x-auto overscroll-contain pb-0.5"
          role="group"
          aria-label="选择工具栏对应的智能体"
        >
          <span className="shrink-0 pr-0.5 text-[11px] whitespace-nowrap text-[#9a9aa0]">
            网页版
          </span>
          {candidates.map((c) => {
            const on = (pickedId ?? candidates[0]?.id) === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-label={`工具栏智能体 ${c.name}`}
                aria-pressed={on}
                onClick={() => onPick(c.id)}
                className={`flex h-6 min-h-0 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  on
                    ? "bg-[#2f6bff] text-white"
                    : "bg-black/[0.05] text-[#3a3a3c]"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {/* The controls wrap onto a second line instead of
          scrolling sideways: on a phone the row is wider than
          the screen, and a horizontally scrolled-away control
          (above all 豆包's model selector at the right end)
          would read as missing. */}
      <div className="flex flex-wrap items-center gap-1">
        {controls}
      </div>
      {modelPickerOpen && agent.provider === "doubao" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="豆包模型菜单"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setModelPickerOpen(false)}
          />
          <div className="relative flex max-h-[82dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <h4 className="text-base font-semibold">模型</h4>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="识别可用模型"
                  disabled={detectMenuMutation.isPending}
                  onClick={() => detectMenuMutation.mutate()}
                  className="flex h-8 min-h-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-[#1664ff] transition-colors hover:bg-black/[0.05] disabled:opacity-50"
                >
                  <Icon d={PATHS.refresh} size={13} />
                  {detectMenuMutation.isPending ? "识别中…" : "识别可用模型"}
                </button>
                <button
                  type="button"
                  aria-label="关闭模型菜单"
                  onClick={() => setModelPickerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/[0.05]"
                >
                  <Icon d={PATHS.x} size={16} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {(["1", "3"] as const).map((modeId) => {
                const group = doubaoModels.filter((m) => m.modeId === modeId);
                if (!group.length) return null;
                return (
                  <div key={modeId}>
                    <p className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-[#9a9aa0]">
                      {modeId === "1" ? "对话" : "工作任务"}
                    </p>
                    {group.map((m) => {
                      if (m.needUpgrade) {
                        return (
                          <button
                            key={m.key}
                            type="button"
                            aria-label={`${m.name}（需要开通豆包会员）`}
                            onClick={() =>
                              onNotice(
                                `「${m.name}」需要开通豆包会员才能用——这是你账号的官网菜单配置里标明的（该模型带「需升级」标记），未开通前选不了`,
                              )
                            }
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[#9a9aa0] transition-colors hover:bg-black/[0.03]"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {m.name}
                            </span>
                            {m.tags[0] && (
                              <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px]">
                                {m.tags[0]}
                              </span>
                            )}
                            <span className="shrink-0 rounded-full bg-[#fce8e6] px-1.5 py-0.5 text-[10px] text-[#b3261e]">
                              需开通会员
                            </span>
                          </button>
                        );
                      }
                      const active = doubaoKey === m.key;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          aria-label={`选择模型 ${m.name}`}
                          aria-pressed={active}
                          disabled={busy}
                          onClick={() => {
                            apply({
                              webModelKey: m.key,
                              webReasoning: doubaoReasoningOnModelPick(
                                m,
                                agent.webReasoning,
                              ),
                            });
                            setModelPickerOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                            active
                              ? "bg-[#e8effd] font-medium text-[#1664ff]"
                              : "text-[#191919] hover:bg-black/[0.03]"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {m.name}
                          </span>
                          {m.tags[0] && (
                            <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-[#6e6e73]">
                              {m.tags[0]}
                            </span>
                          )}
                          {active && <Icon d={PATHS.check} size={15} />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-black/[0.06] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">推理强度</span>
                <div
                  className={`${segWrapCls} flex-wrap justify-end`}
                  role="group"
                  aria-label="推理强度"
                >
                  {doubaoEntry.levels.map((l) => {
                    const value = String(l.level);
                    const active = doubaoReasoning === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={`推理强度 ${l.name}`}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => apply({ webReasoning: value })}
                        className={segBtnCls(active)}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#9a9aa0]">
                {agent.webMenu
                  ? `列表来自该账号官网菜单的识别结果${agent.webMenuAt ? `（识别于 ${new Date(agent.webMenuAt).toLocaleString()}）` : ""}，模型、档位与会员门槛都以豆包下发给这个账号的配置为准。`
                  : "当前是豆包菜单的通用列表；点上方「识别可用模型」会读取该账号自己的官网菜单配置，换成这个账号真实可用的模型和档位。"}
                所选模型按官网格式发在对话通道上（它自己的 mode_id、参数与推理强度档位），选完下一条回复生效，并会为新选择新开一个官网对话。推理强度档位 4 以上开启深度思考，快速模型本身不思考。豆包最终按哪个模型回答还取决于账号权益，回复里没有可验证的标记。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- main app ---------------- */

const SECTION_META: { key: Section; label: string; d: string[] }[] = [
  { key: "agents", label: "智能体", d: PATHS.sparkles },
  { key: "files", label: "文件", d: PATHS.folder },
  { key: "vpn", label: "代理", d: PATHS.globe },
];

const SECTION_TITLES: Record<Section, string> = {
  agents: "智能体",
  files: "文件",
  vpn: "代理",
};

const SECTION_SEARCH_PLACEHOLDERS: Record<Section, string> = {
  agents: "搜索智能体",
  files: "搜索文件",
  vpn: "搜索地区",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function App() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>("agents");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Files are identified by source + id: uploads and chat messages
  // live in different tables and their ids can collide.
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  // The files column's batch-manage mode: rows turn into a
  // checklist (tap to select), swipe and the per-row switch step
  // aside, and a toolbar offers select-all, batch agent-access
  // on/off and batch delete for the selection.
  const [fileBatchMode, setFileBatchMode] = useState(false);
  const [fileSelection, setFileSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [fileBatchConfirmDelete, setFileBatchConfirmDelete] =
    useState(false);
  // The files column's active category tab. Entering the files
  // section always lands on 图片 (the effect beside the section
  // state resets it); the tabs switch the list to one category.
  const [fileCategory, setFileCategory] = useState<FileCategory>("image");
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [search, setSearch] = useState("");
  // Composer state is kept PER CONVERSATION (keyed by room id):
  // each window has its own draft and its own pending attachment,
  // so typing in one room never leaks into another and switching
  // rooms never loses what was typed there.
  const [draftsByConv, setDraftsByConv] = useState<Record<number, string>>(
    {},
  );
  const [pendingByConv, setPendingByConv] = useState<
    Record<number, { image: PendingImage | null; file: PendingFile | null }>
  >({});
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // The 会话信息 popover (and its toggle button) live inside this
  // wrapper: a pointer down anywhere outside it closes the popover.
  const infoRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showInfo) return;
    function onPointerDown(e: PointerEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
        setConfirmClear(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showInfo]);
  const [agentPanelNonce, setAgentPanelNonce] = useState(0);
  const [agentPanel, setAgentPanel] = useState<{ agent: Agent | null } | null>(
    null,
  );
  const [swipedKey, setSwipedKey] = useState<string | null>(null);
  // The drawer's recent-chat rows have their own swipe-open key
  // (the drawer and the middle column can both be on screen).
  const [recentSwipedKey, setRecentSwipedKey] = useState<string | null>(
    null,
  );
  // The conversation a long press landed on: non-null shows the
  // bottom action sheet （重命名 / 删除）; renameConv + renameTitle
  // drive the rename dialog the sheet's 重命名 entry opens.
  const [chatSheetConv, setChatSheetConv] = useState<Conversation | null>(
    null,
  );
  const [renameConv, setRenameConv] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  // First-column (sidebar) visibility, toggled by the ≡ button at the
  // top-left of the second column. Desktop starts with the sidebar
  // shown (the classic three columns); phones start with it hidden —
  // a pure second-column window — and the sidebar then slides in as
  // a drawer over the list.
  const [railOpen, setRailOpen] = useState<boolean>(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );
  const [groupSettingsConv, setGroupSettingsConv] =
    useState<Conversation | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showMuseSettings, setShowMuseSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Where the settings panel opens: normally its list; the chat
  // toolbar's 技能 entry opens it straight on the skills page.
  const [settingsInitialPage, setSettingsInitialPage] =
    useState<SettingsPage>("list");
  // In a room with several web agents, which one's web toolbar
  // the composer shows — picked per room from the toolbar's own
  // selector chips; the first enabled web member is the default.
  const [webToolbarPickByConv, setWebToolbarPickByConv] = useState<
    Record<number, number>
  >({});
  // The settings panel registers its sub-page back step here: a
  // gesture right-swipe pops an open 外观 / 手势控制 page back to
  // the settings list before it may close the panel itself.
  const settingsBackRef = useRef<(() => boolean) | null>(null);
  // The device's colour scheme, tracked live so the 外观 setting's
  // 系统模式 follows it (and flips the moment the device flips).
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [showMembers, setShowMembers] = useState(false);
  const [colMenu, setColMenu] = useState<"agents" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The image currently open in the full-screen preview (tapped
  // in a chat bubble or in the file detail pane); null = closed.
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    name: string | null;
  } | null>(null);
  // Send state is PER CONVERSATION too: which rooms currently
  // have a reply in flight, each room's optimistic echo of the
  // message just sent, and each room's send-failure banner. One
  // room waiting on a reply must never block, relabel or clear
  // another room — every window chats independently, even several
  // windows onto the same agent.
  const [sendingConvs, setSendingConvs] = useState<ReadonlySet<number>>(
    new Set(),
  );
  // The same set in a ref, updated synchronously by markConvSending:
  // the messages query's polling gate and discardTempRoom read it
  // outside React's render cycle.
  const sendingConvsRef = useRef<ReadonlySet<number>>(new Set());
  const [sendErrorsByConv, setSendErrorsByConv] = useState<
    Record<number, { message: string; silent: boolean }>
  >({});
  const [optimisticByConv, setOptimisticByConv] = useState<
    Record<number, ChatMessage[]>
  >({});

  function markConvSending(convId: number, on: boolean) {
    if (sendingConvsRef.current.has(convId) === on) return;
    const next = new Set(sendingConvsRef.current);
    if (on) next.add(convId);
    else next.delete(convId);
    sendingConvsRef.current = next;
    setSendingConvs(next);
  }

  function setConvSendError(
    convId: number,
    error: { message: string; silent: boolean } | null,
  ) {
    setSendErrorsByConv((prev) => {
      if (error == null) {
        if (!(convId in prev)) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      }
      return { ...prev, [convId]: error };
    });
  }

  function setConvOptimistic(convId: number, msgs: ChatMessage[]) {
    setOptimisticByConv((prev) => ({ ...prev, [convId]: msgs }));
  }
  // The provisional room currently open, if any: created by the
  // compose button or an agent row, not yet saved (it joins the
  // lists only once the user sends something in it). Leaving it
  // unsent discards it server-side via discardTempRoom.
  const [tempConv, setTempConvState] = useState<Conversation | null>(null);
  const tempConvRef = useRef<Conversation | null>(null);
  function setTempRoom(c: Conversation | null) {
    tempConvRef.current = c;
    setTempConvState(c);
  }

  /** Deletes the open provisional room server-side (unless it is
   * the room being opened instead): an unsent room must not linger
   * as an empty record, appear in any list, or hold a room number. */
  function discardTempRoom(exceptId?: number) {
    const t = tempConvRef.current;
    if (!t || t.id === exceptId) return;
    // A room with a send in flight is NOT unsent: its first
    // message is being saved server-side right now (which already
    // made the room permanent there), so deleting it here would
    // kill the conversation the user just started and strand the
    // in-flight reply. The send's own settle clears the temporary
    // mark instead.
    if (sendingConvsRef.current.has(t.id)) return;
    setTempRoom(null);
    // The discarded room's per-conversation composer/send state
    // goes with it (a send already in flight for it still finishes
    // server-side; its result simply has no window to land in).
    setDraftsByConv((prev) => {
      if (!(t.id in prev)) return prev;
      const next = { ...prev };
      delete next[t.id];
      return next;
    });
    setPendingByConv((prev) => {
      if (!(t.id in prev)) return prev;
      const next = { ...prev };
      delete next[t.id];
      return next;
    });
    setConvSendError(t.id, null);
    setConvOptimistic(t.id, []);
    retryStateRef.current.delete(t.id);
    try {
      window.sessionStorage.removeItem("draft-room-id");
    } catch {
      // storage unavailable: the server sweep handles the orphan
    }
    void api
      .deleteConversation({ conversationId: t.id })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
      })
      .catch(() => {
        // Already gone (e.g. swept): nothing more to do.
      });
  }

  // A page refresh also leaves an unsent room behind: the room id
  // kept in session storage belongs to a room that was never
  // saved, so it is discarded on the next load.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("draft-room-id");
      if (!raw) return;
      window.sessionStorage.removeItem("draft-room-id");
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) {
        void api
          .deleteConversation({ conversationId: id })
          .catch(() => {});
      }
    } catch {
      // storage unavailable: nothing to clean up locally
    }
  }, []);
  // Retry bookkeeping, per conversation: whether the failed
  // send's user message was already saved server-side (retry then
  // only regenerates the reply) and the last payload sent from
  // that room (retry re-sends it when nothing was saved).
  const retryStateRef = useRef(
    new Map<
      number,
      {
        savedUser: boolean;
        payload: {
          text: string;
          image: PendingImage | null;
          file: PendingFile | null;
        } | null;
      }
    >(),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genericFileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.listConversations({}),
  });
  const conversations = conversationsQuery.data?.conversations ?? [];

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents({}),
  });
  const agents = agentsQuery.data?.agents ?? [];

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile({}),
  });
  const profile = profileQuery.data ?? DEFAULT_PROFILE;

  const museSettingsQuery = useQuery({
    queryKey: ["museSettings"],
    queryFn: () => api.getMuseSettings({}),
  });
  const museSettings = museSettingsQuery.data ?? DEFAULT_MUSE;

  // Shared with the VPN column/detail (same query key): the rail's
  // VPN item shows the live tunnel state — grey 「离线」 while
  // disconnected, the connected region's name in green when the
  // tunnel is verified up.
  const pioneerQuery = usePioneerState();
  const pioneer = pioneerQuery.data;
  const vpnConnected = pioneer?.tunnel?.state === "connected";
  const vpnRegionName =
    vpnConnected && pioneer
      ? pioneer.selectedName.replace(/^中国/, "") ||
        pioneer.tunnel?.exitCountry ||
        "已连接"
      : "";

  const filesQuery = useQuery({
    queryKey: ["files"],
    queryFn: () => api.listFiles({}),
    enabled: section === "files",
  });
  // Landing on the files section always starts from the 图片
  // category; the user switches categories with the tabs.
  useEffect(() => {
    if (section === "files") setFileCategory("image");
  }, [section]);
  const files = filesQuery.data?.files ?? [];
  const selectedFile =
    files.find((f) => `${f.source}:${f.id}` === selectedFileKey) ?? null;
  // The batch-manage selection resolved against the current file
  // list: keys of files that no longer exist simply drop out.
  const selectedBatchItems = files
    .filter((f) => fileSelection.has(`${f.source}:${f.id}`))
    .map((f) => ({ source: f.source, id: f.id }));
  function toggleFileSelection(key: string) {
    setFileBatchConfirmDelete(false);
    setFileSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The room an agent row stands for: the most recent room whose
  // only agent member is that agent (for Muse, agentId null: the
  // starter room). Conversations arrive newest-activity first, so
  // the first solo room found per agent is the one the server's
  // openAgentRoom opens.
  function soloRoomOf(c: Conversation, agentId: number | null): boolean {
    return agentId == null
      ? c.museMember && c.memberAgentIds.length === 0
      : !c.museMember &&
          c.memberAgentIds.length === 1 &&
          c.memberAgentIds[0] === agentId;
  }
  // The default selection: Muse's solo room — preferring one that
  // actually has messages, so the space never opens onto a blank
  // thread when a real chat exists.
  const museRoom =
    conversations.find((c) => soloRoomOf(c, null) && c.previewAt != null) ??
    conversations.find((c) => soloRoomOf(c, null)) ??
    null;
  // The solo room the Muse row represents and previews.
  const museRowRoom = conversations.find((c) => soloRoomOf(c, null)) ?? null;

  // Select Muse's room on first load.
  useEffect(() => {
    if (selectedId == null && museRoom) {
      setSelectedId(museRoom.id);
    }
  }, [museRoom, selectedId]);

  // When the open conversation disappears (deleted via swipe), drop
  // the dangling selection so the third column falls back to the
  // section's default/empty state instead of stale content. Guarded
  // by the selection stamp + fetch state: a selection made a moment
  // ago (e.g. a just-created conversation) must not be judged against
  // a list snapshot that predates it.
  const selectionStampRef = useRef(0);
  useEffect(() => {
    if (!conversationsQuery.data) return;
    if (conversationsQuery.isFetching) return;
    if (conversationsQuery.dataUpdatedAt < selectionStampRef.current) return;
    if (
      selectedId != null &&
      selectedId !== tempConvRef.current?.id &&
      !conversations.some((c) => c.id === selectedId)
    ) {
      setSelectedId(null);
      setMobileDetail(false);
    }
  }, [
    conversations,
    selectedId,
    conversationsQuery.data,
    conversationsQuery.isFetching,
    conversationsQuery.dataUpdatedAt,
  ]);

  const isChatSection = section === "agents";
  const activeConvId = section === "agents" ? selectedId : null;
  const activeConv =
    conversations.find((c) => c.id === activeConvId) ??
    (tempConv && tempConv.id === activeConvId ? tempConv : null);
  const activeAgent =
    activeConv?.agentId != null
      ? (agents.find((a) => a.id === activeConv.agentId) ?? null)
      : null;
  const activeTitle = activeConv?.title || "新对话";

  // The open room's view of the per-conversation composer and
  // send state declared above.
  const draft =
    activeConvId != null ? (draftsByConv[activeConvId] ?? "") : "";
  const pendingImage =
    activeConvId != null
      ? (pendingByConv[activeConvId]?.image ?? null)
      : null;
  const pendingFile =
    activeConvId != null ? (pendingByConv[activeConvId]?.file ?? null) : null;
  function setDraft(value: string) {
    if (activeConvId == null) return;
    const id = activeConvId;
    setDraftsByConv((prev) => ({ ...prev, [id]: value }));
  }
  function setPendingImage(image: PendingImage | null) {
    if (activeConvId == null) return;
    const id = activeConvId;
    setPendingByConv((prev) => ({
      ...prev,
      [id]: { image, file: prev[id]?.file ?? null },
    }));
  }
  function setPendingFile(file: PendingFile | null) {
    if (activeConvId == null) return;
    const id = activeConvId;
    setPendingByConv((prev) => ({
      ...prev,
      [id]: { image: prev[id]?.image ?? null, file },
    }));
  }
  // True only while THIS room has a reply in flight: it gates this
  // room's send button and typing bubble, and nothing in any other
  // room.
  const sending = activeConvId != null && sendingConvs.has(activeConvId);
  const activeSendError =
    activeConvId != null ? (sendErrorsByConv[activeConvId] ?? null) : null;
  const sendError = activeSendError?.message ?? null;
  const sendSilent = activeSendError?.silent ?? false;

  // While a reply is being generated, the messages query polls:
  // a streaming agent's reply row grows chunk by chunk server-side,
  // and only polling makes that visible live. The interval runs
  // while THIS room has a send/retry in flight (the in-flight set,
  // kept in sendingConvsRef beside the state) or while any shown
  // message is still flagged streaming, and stops the moment
  // neither holds. A send in flight in some other room does not
  // make this room poll.
  const messagesQuery = useQuery({
    queryKey: ["messages", activeConvId],
    queryFn: () => api.listMessages({ conversationId: activeConvId ?? 0 }),
    enabled: isChatSection && activeConvId != null,
    refetchInterval: (query) => {
      const msgs = query.state.data?.messages ?? [];
      if (msgs.some((m) => m.streaming)) return 700;
      const cid = query.queryKey[1];
      return typeof cid === "number" && sendingConvsRef.current.has(cid)
        ? 700
        : false;
    },
  });
  const serverMessages = messagesQuery.data?.messages ?? [];
  // The optimistic echo of a just-sent message is dropped as soon
  // as the saved copy of that same message appears in the server
  // list. The server saves the user's message at the START of a
  // send while the reply is still being generated, and this list
  // polls during the wait — without the dedupe, the bubble shows
  // twice (echo + saved copy) until the reply lands and the send
  // settles, which is exactly the duplicate users reported. A
  // match needs the same role, the same text, the same attachment
  // name, and a save time within a minute of the echo's own
  // timestamp, so an identical message from an earlier turn can
  // never swallow a fresh echo.
  const optimisticMessages =
    activeConvId != null ? (optimisticByConv[activeConvId] ?? []) : [];
  const unsavedOptimistic = optimisticMessages.filter(
    (o) =>
      !serverMessages.some(
        (m) =>
          m.role === o.role &&
          m.content === o.content &&
          (m.attachment?.name ?? null) === (o.attachment?.name ?? null) &&
          Math.abs(Date.parse(m.createdAt) - Date.parse(o.createdAt)) <
            60_000,
      ),
  );
  const displayMessages = [...serverMessages, ...unsavedOptimistic];

  const activeGroupId = isChatSection ? activeConvId : null;
  const groupMembersQuery = useQuery({
    queryKey: ["groupMembers", activeGroupId],
    queryFn: () =>
      api.listGroupMembers({ conversationId: activeGroupId ?? 0 }),
    enabled: activeGroupId != null,
  });
  const groupMembers: GroupMembers = groupMembersQuery.data ?? {
    museMember: false,
    agentIds: [],
    museEnabled: false,
    disabledAgentIds: [],
  };
  const groupHasAgentMembers =
    groupMembers.museMember || groupMembers.agentIds.length > 0;
  const groupHasEnabledMembers =
    (groupMembers.museMember && groupMembers.museEnabled) ||
    groupMembers.agentIds.some(
      (id) => !groupMembers.disabledAgentIds.includes(id),
    );
  // The membership the header count and the info popover display.
  // The user is always a member of their own rooms, so every count
  // includes them: a room with one agent in it has 2 members, in
  // every window. The live members query is the source once it has
  // loaded; until it lands, the room's own member summary from the
  // conversation list stands in, so a window never shows a count
  // that leaves a member — or the user — out while data loads.
  const membersLoaded = groupMembersQuery.data != null;
  const shownMuseMember = membersLoaded
    ? groupMembers.museMember
    : (activeConv?.museMember ?? false);
  const shownAgentIds = membersLoaded
    ? groupMembers.agentIds
    : (activeConv?.memberAgentIds ?? []);
  const groupMemberNames = [
    profile.name || "我",
    ...(shownMuseMember ? [museSettings.name || "Muse"] : []),
    ...shownAgentIds.map(
      (id) => agents.find((a) => a.id === id)?.name || "智能体",
    ),
  ];
  // A provisional room's header title follows its live membership
  // (the server list does not carry the room yet): nobody in →
  // 「新对话」, one member → that member's name, several → 「群聊」
  // (its number is only taken when the room is actually saved).
  const tempActive = tempConv != null && activeConvId === tempConv.id;
  const displayTitle = !tempActive
    ? activeTitle
    : shownMuseMember && shownAgentIds.length === 0
      ? museSettings.name || "Muse"
      : !shownMuseMember && shownAgentIds.length === 1
        ? agents.find((a) => a.id === shownAgentIds[0])?.name || "智能体"
        : shownMuseMember || shownAgentIds.length > 0
          ? "群聊"
          : "新对话";
  // Everyone in the room: the user (always a member) plus the
  // agent members — the same count in every window.
  const activeMemberCount =
    1 + (shownMuseMember ? 1 : 0) + shownAgentIds.length;
  // Who the typing bubble names while a send is in flight. The
  // server answers a group round member by member — Muse first,
  // then the added agents in join order (produceGroupReplies) —
  // and each finished reply lands in the polled message list, so
  // the member actually generating right now is the first one in
  // that order who has not yet replied to the latest user message.
  // Naming the first member unconditionally (the old behaviour)
  // kept the bubble on 豆包 while DeepSeek was already the one
  // replying. Members the server skips without generating are
  // left out of the order, mirroring produceReply's silent cases:
  // switched off in this room or globally, an API agent that is
  // not configured, a web agent with no saved token (webStatus
  // stays '' until a token is pasted and checked) or one whose
  // token is already known expired (it fails instantly, without
  // generating). Muse counts only while its own switch is on,
  // exactly like the server.
  const replyOrder: (number | null)[] = [];
  if (
    groupMembers.museMember &&
    groupMembers.museEnabled &&
    museSettings.enabled
  )
    replyOrder.push(null);
  for (const id of groupMembers.agentIds) {
    if (groupMembers.disabledAgentIds.includes(id)) continue;
    const a = agents.find((x) => x.id === id);
    if (!a || !a.enabled) continue;
    if (a.connectionType === "web") {
      if (a.webStatus === "" || a.webStatus === "expired") continue;
    } else if (!a.configured) {
      continue;
    }
    replyOrder.push(id);
  }
  const lastUserMsgIdx = serverMessages.reduce(
    (acc, m, i) => (m.role === "user" ? i : acc),
    -1,
  );
  const repliedThisRound = new Set<number | null>();
  for (let i = lastUserMsgIdx + 1; i < serverMessages.length; i++) {
    const m = serverMessages[i];
    if (m && m.role === "assistant") repliedThisRound.add(m.agentId);
  }
  // The first member still owing a reply this round is the one
  // generating; if every member has replied (the send is just
  // settling) the last one in the order stands. With nobody in
  // the order at all, fall back to the room's first switched-on
  // member (or Muse), as before.
  const typingIdx = replyOrder.findIndex((t) => !repliedThisRound.has(t));
  const typingTarget: number | null | undefined =
    typingIdx >= 0
      ? replyOrder[typingIdx]
      : replyOrder.length > 0
        ? replyOrder[replyOrder.length - 1]
        : groupMembers.museMember && groupMembers.museEnabled
          ? null
          : groupMembers.agentIds.find(
              (id) => !groupMembers.disabledAgentIds.includes(id),
            );
  const groupTypingAgent =
    typingTarget == null
      ? null
      : (agents.find((a) => a.id === typingTarget) ?? null);
  const groupTypingName =
    typingTarget === null
      ? museSettings.name || "Muse"
      : typingTarget === undefined
        ? "房间成员"
        : (groupTypingAgent?.name ?? "房间成员");
  // The composer's web toolbar follows the room's ENABLED web
  // members — the agents that will actually reply here. API
  // members, Muse and switched-off members contribute nothing:
  // a room whose replying members are all API/Muse (or nobody)
  // gets no toolbar at all. Before the members query lands, the
  // room's own member summary stands in so a solo web room shows
  // its toolbar without waiting. With several web members the
  // toolbar shows a selector and follows the per-room pick.
  const webToolbarCandidates: Agent[] = (
    membersLoaded
      ? groupMembers.agentIds.filter(
          (id) => !groupMembers.disabledAgentIds.includes(id),
        )
      : shownAgentIds
  )
    .map((id) => agents.find((a) => a.id === id))
    .filter(
      (a): a is Agent =>
        a != null && a.connectionType === "web" && a.enabled,
    );
  // A solo room created from an agent row carries the agent on
  // the conversation itself before membership data arrives.
  if (
    webToolbarCandidates.length === 0 &&
    activeAgent &&
    activeAgent.connectionType === "web" &&
    activeAgent.enabled
  ) {
    webToolbarCandidates.push(activeAgent);
  }
  const webToolbarPick =
    activeConvId != null ? webToolbarPickByConv[activeConvId] : undefined;
  const webToolbarAgent =
    webToolbarCandidates.find((a) => a.id === webToolbarPick) ??
    webToolbarCandidates[0] ??
    null;

  // While any overlay panel is open, the page behind it must not
  // scroll at all: lock the document's own scrolling until it closes
  // (the panels' content areas scroll themselves, with
  // overscroll-behavior: contain so a swipe at their edge cannot
  // chain through to the columns underneath).
  const overlayOpen =
    agentPanel != null ||
    groupSettingsConv != null ||
    showProfile ||
    showMuseSettings ||
    showSettings ||
    showMembers;
  useEffect(() => {
    if (!overlayOpen) return;
    const body = document.body;
    const html = document.documentElement;
    // iOS / embedded-webview-proof lock: overflow:hidden alone does
    // not stop the underlying scroll containers there, so the body is
    // also taken out of flow with position:fixed at the current
    // scroll offset (restored on close). The panels additionally
    // guard their own gestures via modalBackdropRef.
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      overscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      body.style.overscrollBehavior = prev.overscroll;
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [overlayOpen]);

  // Keep the thread pinned to the latest message. The last
  // message's content length is a dependency too: a streaming
  // reply grows in place without adding a row, and the thread
  // must follow it down as it lengthens.
  const lastDisplayContentLen =
    displayMessages[displayMessages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, lastDisplayContentLen, activeConvId, section]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const q = search.trim().toLowerCase();
  const filteredFiles = files.filter(
    (f) => !q || f.name.toLowerCase().includes(q),
  );
  // The files column shows ONE category at a time (default 图片):
  // the tab counts come from the search-filtered list, and the
  // rendered rows — batch select-all included — are the active
  // category's slice of it.
  const fileCategoryCounts: Record<FileCategory, number> = {
    image: 0,
    video: 0,
    audio: 0,
    other: 0,
  };
  for (const f of filteredFiles) fileCategoryCounts[fileCategoryOf(f)]++;
  const categoryFiles = filteredFiles.filter(
    (f) => fileCategoryOf(f) === fileCategory,
  );
  const activeCategory =
    FILE_CATEGORIES.find((c) => c.key === fileCategory) ??
    FILE_CATEGORIES[0]!;
  const filteredAgents = agents.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q),
  );

  /* ---- agent list order + long-press drag reorder ----
   * Muse and the added agents render as ONE merged list ordered by
   * the shared sortOrder scale (Muse's value lives on its settings
   * row). Ties — never reordered, all zeros — break Muse-first then
   * by agent id, the historical order. The 「我」 profile row is not
   * an agent: it always stays above this list and never drags.
   * A press held ~500ms without moving starts a drag (a move before
   * that is a scroll and cancels it); the dragged row lifts and
   * follows the pointer, an insertion line marks the drop slot, and
   * releasing saves the new order server-side at once. Dragging is
   * disabled while a search query filters the list. */
  type AgentEntry = { key: string; agentId: number | null; sort: number };
  const serverEntries: AgentEntry[] = [
    { key: "muse", agentId: null, sort: museSettings.sortOrder },
    ...agents.map((a) => ({
      key: `agent-${a.id}`,
      agentId: a.id as number | null,
      sort: a.sortOrder,
    })),
  ].sort(
    (x, y) =>
      x.sort - y.sort ||
      (x.agentId == null ? -1 : y.agentId == null ? 1 : x.agentId - y.agentId),
  );
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const entryKeys = pendingOrder ?? serverEntries.map((e) => e.key);
  const orderedEntries = entryKeys
    .map((k) => serverEntries.find((e) => e.key === k))
    .filter((e): e is AgentEntry => e != null);
  for (const e of serverEntries) {
    if (!entryKeys.includes(e.key)) orderedEntries.push(e);
  }
  const museEntryVisible =
    !q || "muse".includes(q) || museSettings.name.toLowerCase().includes(q);
  const visibleEntries = orderedEntries.filter((e) =>
    e.agentId == null
      ? museEntryVisible
      : filteredAgents.some((a) => a.id === e.agentId),
  );

  const entriesRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    key: string;
    dy: number;
    lineTop: number;
  } | null>(null);
  const dragRef = useRef<{
    key: string;
    startY: number;
    overIndex: number;
    activated: boolean;
    timer: number;
  } | null>(null);
  const dragListenersRef = useRef<{
    move: (ev: PointerEvent) => void;
    up: () => void;
    touchBlock: (ev: TouchEvent) => void;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const consumeSuppressClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  };

  const reorderMutation = useMutation({
    mutationFn: async (items: Array<{ agentId: number | null }>) =>
      await api.reorderAgents({ items }),
    onMutate: (items) => {
      // Optimistic: rewrite the shared sortOrder scale in both
      // caches so the rendered order matches the drop at once.
      const pos = (agentId: number | null) =>
        (items.findIndex((i) => i.agentId === agentId) + 1) * 10;
      queryClient.setQueryData<ApiResponse<typeof api, "getMuseSettings">>(
        ["museSettings"],
        (old) => (old ? { ...old, sortOrder: pos(null) } : old),
      );
      queryClient.setQueryData<ApiResponse<typeof api, "listAgents">>(
        ["agents"],
        (old) =>
          old
            ? {
                agents: old.agents.map((a) => ({
                  ...a,
                  sortOrder: pos(a.id),
                })),
              }
            : old,
      );
    },
    onError: () => {
      setToast("排序保存失败，请重试");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["museSettings"] });
    },
    onSettled: () => setPendingOrder(null),
  });

  function detachDragListeners() {
    const l = dragListenersRef.current;
    if (!l) return;
    window.removeEventListener("pointermove", l.move);
    window.removeEventListener("pointerup", l.up);
    window.removeEventListener("pointercancel", l.up);
    window.removeEventListener("touchmove", l.touchBlock);
    dragListenersRef.current = null;
  }

  function cancelDragSession() {
    const s = dragRef.current;
    if (s) window.clearTimeout(s.timer);
    dragRef.current = null;
    detachDragListeners();
    setDrag(null);
  }

  function updateDrag(clientY: number, dy: number) {
    const s = dragRef.current;
    const wrap = entriesRef.current;
    if (!s || !wrap) return;
    const els = Array.from(
      wrap.querySelectorAll<HTMLElement>("[data-entry-key]"),
    );
    const others = els.filter((el) => el.dataset.entryKey !== s.key);
    let over = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        over = i;
        break;
      }
    }
    s.overIndex = over;
    const wrapRect = wrap.getBoundingClientRect();
    let lineTop = 0;
    if (others.length > 0 && over >= others.length) {
      lineTop =
        others[others.length - 1]!.getBoundingClientRect().bottom -
        wrapRect.top -
        1;
    } else if (others.length > 0) {
      lineTop = others[over]!.getBoundingClientRect().top - wrapRect.top - 1;
    }
    setDrag({ key: s.key, dy, lineTop });
  }

  function finishDragSession() {
    const s = dragRef.current;
    if (!s) return;
    const wasActive = s.activated;
    const overIndex = s.overIndex;
    const key = s.key;
    window.clearTimeout(s.timer);
    dragRef.current = null;
    detachDragListeners();
    setDrag(null);
    if (!wasActive) return;
    // The pointer-up is followed by a click on the row: swallow it,
    // a long-press must never also open the chat or the settings.
    suppressClickRef.current = true;
    const keys = orderedEntries.map((e) => e.key);
    const without = keys.filter((k) => k !== key);
    const next = [
      ...without.slice(0, overIndex),
      key,
      ...without.slice(overIndex),
    ];
    if (next.join("|") === keys.join("|")) return;
    setPendingOrder(next);
    reorderMutation.mutate(
      next.map((k) => ({
        agentId: k === "muse" ? null : Number(k.slice("agent-".length)),
      })),
    );
  }

  function handleEntryPointerDown(key: string, e: React.PointerEvent) {
    if (q || dragRef.current || reorderMutation.isPending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startIndex = orderedEntries.findIndex((en) => en.key === key);
    if (startIndex < 0) return;
    const session = {
      key,
      startY: e.clientY,
      overIndex: startIndex,
      activated: false,
      timer: 0,
    };
    dragRef.current = session;
    const move = (ev: PointerEvent) => {
      const s = dragRef.current;
      if (!s || s.key !== key) return;
      const dy = ev.clientY - s.startY;
      if (!s.activated) {
        // Moved before the long-press fired: this is a scroll (or a
        // swipe), not a drag — abandon the session entirely.
        if (Math.abs(dy) > 10) cancelDragSession();
        return;
      }
      updateDrag(ev.clientY, dy);
    };
    const up = () => finishDragSession();
    const touchBlock = (ev: TouchEvent) => {
      if (dragRef.current?.activated) ev.preventDefault();
    };
    dragListenersRef.current = { move, up, touchBlock };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchmove", touchBlock, { passive: false });
    session.timer = window.setTimeout(() => {
      const s = dragRef.current;
      if (!s || s.key !== key) return;
      s.activated = true;
      updateDrag(s.startY, 0);
    }, 500);
  }
  // Rooms already represented by a row above (Muse's solo room and
  // each agent's solo room) are not repeated in the 全部对话 list;
  // every other room — compose-created rooms, multi-member rooms,
  // older solo rooms — is listed there.
  const representedRoomIds = new Set<number>();
  if (museRowRoom) representedRoomIds.add(museRowRoom.id);
  for (const a of agents) {
    const solo = conversations.find((c) => soloRoomOf(c, a.id));
    if (solo) representedRoomIds.add(solo.id);
  }
  const roomConvs = conversations.filter(
    (c) => !representedRoomIds.has(c.id),
  );
  const filteredRooms = roomConvs.filter((c) => {
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.preview.toLowerCase().includes(q)
    );
  });

  // Recent chat windows for the sidebar, newest activity first:
  // only conversations that actually have messages belong here —
  // a room nobody has written in yet (previewAt is null until its
  // first message) is not a "recent chat" and stays out of the
  // list. Derived straight from the conversations query, so sends
  // and deletions add or remove entries the moment they land.
  const recentChats = [...conversations]
    .filter((c) => c.previewAt != null)
    .sort((a, b) => {
      const ta = new Date(a.previewAt ?? a.updatedAt).getTime();
      const tb = new Date(b.previewAt ?? b.updatedAt).getTime();
      return tb - ta;
    });

  function recentChatName(conv: Conversation): string {
    return conv.title || "新对话";
  }

  /** The avatar a room shows in lists and headers: its uploaded
   * image or custom icon when set; otherwise the solo member's own
   * avatar for a one-agent room; otherwise the default room icon. */
  function roomAvatar(conv: Conversation, size: number) {
    if (conv.avatarUrl || conv.iconColor || conv.iconGlyph) {
      return (
        <GroupAvatar
          size={size}
          title={conv.title}
          iconColor={conv.iconColor}
          iconGlyph={conv.iconGlyph}
          iconImageUrl={conv.avatarUrl}
        />
      );
    }
    if (conv.museMember && conv.memberAgentIds.length === 0) {
      return (
        <MuseAvatar
          size={size}
          color={museSettings.color}
          imageUrl={museSettings.avatarUrl}
        />
      );
    }
    if (!conv.museMember && conv.memberAgentIds.length === 1) {
      const a = agents.find((x) => x.id === conv.memberAgentIds[0]);
      if (a) {
        return (
          <AgentAvatar
            color={a.color}
            glyph={a.glyph}
            name={a.name}
            size={size}
            imageUrl={a.avatarUrl}
            logo={vendorLogoFor(a)}
          />
        );
      }
    }
    return <GroupAvatar size={size} title={conv.title} />;
  }

  /** Pointer down anywhere in a list closes a swiped-open row, unless
   * the tap lands on that row itself (its delete button included). */
  function closeSwipeOnOutsideTap(e: ReactPointerEvent) {
    if (!swipedKey) return;
    const t = e.target as HTMLElement;
    if (!t.closest(`[data-swipe-key="${swipedKey}"]`)) setSwipedKey(null);
  }

  /** The same close-on-outside-tap for the drawer's recent-chat rows. */
  function closeRecentSwipeOnOutsideTap(e: ReactPointerEvent) {
    if (!recentSwipedKey) return;
    const t = e.target as HTMLElement;
    if (!t.closest(`[data-recent-swipe-key="${recentSwipedKey}"]`))
      setRecentSwipedKey(null);
  }

  /** Opens a freshly created provisional room: registers it as
   * the open temporary room (rendered from its local description
   * until the first message saves it into the server lists) and
   * remembers its id in session storage so a refresh can discard
   * it if it was never saved. */
  function openTempRoom(id: number, init: Partial<Conversation>) {
    openConversation(id);
    setTempRoom(makeTempConv(id, init));
    try {
      window.sessionStorage.setItem("draft-room-id", String(id));
    } catch {
      // storage unavailable: in-page discard still applies
    }
  }

  // The sidebar's compose （书写） button: a brand-new room with only
  // the user in it — no agent members, no greeting, completely
  // empty — opened straight away as a provisional room: it is only
  // saved once something is sent in it.
  const composeMutation = useMutation({
    mutationFn: async () =>
      await api.createConversation({ agentId: null, memberBased: true }),
    onSuccess: (res) => {
      openTempRoom(res.id, {});
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => setToast("新建对话失败，请重试"),
  });

  // Tapping an agent row (Muse included): every tap opens a
  // brand-new provisional room with that agent already inside and
  // switched on — never a previous room with the agent (those stay
  // reachable from the recent-chats list). Like a composed room it
  // is only saved once something is sent in it.
  const openRoomMutation = useMutation({
    mutationFn: async (agentId: number | null) =>
      await api.openAgentRoom({ agentId }),
    onSuccess: (res, agentId) => {
      const name =
        agentId == null
          ? museSettings.name || "Muse"
          : agents.find((a) => a.id === agentId)?.name || "智能体";
      openTempRoom(res.id, {
        title: name,
        agentId,
        memberAgentIds: agentId != null ? [agentId] : [],
        museMember: agentId == null,
      });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: () => setToast("打开对话失败，请重试"),
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: number) =>
      await api.deleteConversation({ conversationId }),
    onSuccess: () => {
      setSwipedKey(null);
      setRecentSwipedKey(null);
      setToast("已删除");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => setToast("删除失败，请重试"),
  });

  // The rename half of a conversation row's long-press sheet:
  // saves the new title server-side (which also marks it user-set,
  // so membership changes stop auto-renaming the room).
  const renameConversationMutation = useMutation({
    mutationFn: async (vars: { conversationId: number; title: string }) =>
      await api.renameConversation(vars),
    onSuccess: () => {
      setRenameConv(null);
      setToast("已改名");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: () => setToast("改名失败，请重试"),
  });

  /** Opens the long-press action sheet for one conversation row:
   * any swiped-open row slides shut first. */
  function openChatSheet(conv: Conversation) {
    setSwipedKey(null);
    setRecentSwipedKey(null);
    setChatSheetConv(conv);
  }

  /** Starts a rename from the action sheet: the dialog opens with
   * the current name filled in. */
  function beginRename(conv: Conversation) {
    setChatSheetConv(null);
    setRenameTitle(recentChatName(conv));
    setRenameConv(conv);
  }

  function submitRename() {
    if (!renameConv) return;
    const title = renameTitle.trim();
    if (!title) {
      setToast("名字不能为空");
      return;
    }
    renameConversationMutation.mutate({
      conversationId: renameConv.id,
      title,
    });
  }

  // The per-file agent-access switch in the files column: saved
  // server-side the moment it flips.
  const fileAccessMutation = useMutation({
    mutationFn: async (vars: { f: FileItem; access: boolean }) =>
      await api.setFileAgentAccess({
        source: vars.f.source,
        id: vars.f.id,
        access: vars.access,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => setToast("权限保存失败，请重试"),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (f: FileItem) =>
      await api.deleteFile({ source: f.source, id: f.id }),
    onSuccess: (_res, f) => {
      setSwipedKey(null);
      setToast("文件已删除");
      if (selectedFileKey === `${f.source}:${f.id}`) {
        setSelectedFileKey(null);
        setMobileDetail(false);
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => setToast("删除失败，请重试"),
  });

  // Batch operations for the files column's manage mode: the
  // selection is a set of `${source}:${id}` keys resolved against
  // the current file list at call time, so a file deleted by
  // another path simply drops out of the batch.
  const batchDeleteFilesMutation = useMutation({
    mutationFn: async (items: { source: "upload" | "chat"; id: number }[]) =>
      await api.deleteFiles({ items }),
    onSuccess: (res, items) => {
      setFileSelection(new Set());
      setFileBatchConfirmDelete(false);
      setSwipedKey(null);
      setToast(`已删除 ${res.deleted} 个文件`);
      if (
        selectedFileKey &&
        items.some((it) => `${it.source}:${it.id}` === selectedFileKey)
      ) {
        setSelectedFileKey(null);
        setMobileDetail(false);
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => setToast("批量删除失败，请重试"),
  });

  const batchAccessMutation = useMutation({
    mutationFn: async (vars: {
      items: { source: "upload" | "chat"; id: number }[];
      access: boolean;
    }) => await api.setFilesAgentAccess(vars),
    onSuccess: (_res, vars) => {
      setToast(
        vars.access
          ? `已为 ${vars.items.length} 个文件开启智能体权限`
          : `已为 ${vars.items.length} 个文件关闭智能体权限`,
      );
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => setToast("批量设置权限失败，请重试"),
  });

  /** The files column's upload entry: reads every picked file and
   * sends them in one upload call; per-file failures are reported
   * by name, successes land at the top of the list. */
  async function handleUploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).slice(0, 10);
    setUploading(true);
    try {
      const payloads: {
        name: string;
        mimeType: string;
        dataBase64: string;
        size: number;
      }[] = [];
      const failedNames: string[] = [];
      for (const file of picked) {
        if (file.size > MAX_FILE_BYTES) {
          failedNames.push(`${file.name}（超过 10MB）`);
          continue;
        }
        try {
          const { dataBase64, mimeType } = await fileToBase64(file);
          payloads.push({
            name: file.name,
            mimeType: mimeType || file.type || "",
            dataBase64,
            size: file.size,
          });
        } catch {
          failedNames.push(file.name);
        }
      }
      let okCount = 0;
      if (payloads.length > 0) {
        const res = await api.uploadFiles({ files: payloads });
        okCount = res.uploaded.length;
        for (const f of res.failed) failedNames.push(f.name);
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      if (okCount > 0 && failedNames.length === 0) {
        setToast(`已上传 ${okCount} 个文件`);
      } else if (okCount > 0) {
        setToast(
          `已上传 ${okCount} 个，${failedNames.length} 个失败：${failedNames.join("、")}`,
        );
      } else {
        setToast(`上传失败：${failedNames.join("、") || "请重试"}`);
      }
    } catch {
      setToast("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  const memberToggleMutation = useMutation({
    mutationFn: async (vars: { agentId: number | null; enabled: boolean }) =>
      await api.setGroupMemberEnabled({
        conversationId: activeGroupId ?? 0,
        agentId: vars.agentId,
        enabled: vars.enabled,
      }),
    onSuccess: (res) => {
      if (activeGroupId != null) {
        queryClient.setQueryData(["groupMembers", activeGroupId], res);
        queryClient.invalidateQueries({
          queryKey: ["groupMembers", activeGroupId],
        });
      }
    },
    onError: () => setToast("开关切换失败，请重试"),
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: {
      conversationId: number;
      text: string;
      image: { dataBase64: string; mimeType: string; fileName: string; size: number } | null;
      file: { dataBase64: string; mimeType: string; fileName: string; size: number } | null;
    }) => await api.sendMessage(payload),
    // Every callback keys its effects to vars.conversationId — the
    // room the send belongs to — never to whichever room happens
    // to be open when the reply lands. Sends from different rooms
    // run concurrently and each settles into its own room.
    onMutate: (vars) => {
      markConvSending(vars.conversationId, true);
    },
    onSuccess: (res, vars) => {
      setConvOptimistic(vars.conversationId, []);
      // The send saved the user's message server-side, so a
      // provisional room is now a real, listed conversation: it is
      // no longer temporary.
      if (tempConvRef.current?.id === vars.conversationId) {
        setTempRoom(null);
        try {
          window.sessionStorage.removeItem("draft-room-id");
        } catch {
          // storage unavailable: nothing to clear
        }
      }
      const retry = retryStateRef.current.get(vars.conversationId) ?? {
        savedUser: false,
        payload: null,
      };
      if (res.ok) {
        setConvSendError(vars.conversationId, null);
        retry.savedUser = false;
        if (profile.soundOn) playReplyTone();
      } else if (res.silent) {
        // The agent deliberately stayed silent (disabled / API not
        // configured): the message is saved, the reason is shown as a
        // muted notice, and there is nothing to retry.
        retry.savedUser = false;
        setConvSendError(vars.conversationId, {
          message: res.error ?? "对方未回复",
          silent: true,
        });
      } else {
        retry.savedUser = res.userMessage != null;
        const convTitle =
          conversations.find((c) => c.id === vars.conversationId)?.title ||
          (tempConvRef.current?.id === vars.conversationId
            ? tempConvRef.current.title
            : "") ||
          "对方";
        setConvSendError(vars.conversationId, {
          message: res.userMessage
            ? `消息已发送，但 ${convTitle} 回复失败：${res.error ?? "未知错误"}`
            : (res.error ?? "发送失败，请重试"),
          silent: false,
        });
      }
      retryStateRef.current.set(vars.conversationId, retry);
      queryClient.invalidateQueries({ queryKey: ["messages", vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (err, vars) => {
      setConvOptimistic(vars.conversationId, []);
      const retry = retryStateRef.current.get(vars.conversationId) ?? {
        savedUser: false,
        payload: null,
      };
      retry.savedUser = false;
      retryStateRef.current.set(vars.conversationId, retry);
      setConvSendError(vars.conversationId, {
        message: `发送失败：${err instanceof Error ? err.message : "网络错误"}，请重试`,
        silent: false,
      });
      queryClient.invalidateQueries({ queryKey: ["messages", vars.conversationId] });
    },
    onSettled: (_res, _err, vars) => {
      markConvSending(vars.conversationId, false);
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (conversationId: number) =>
      await api.retryReply({ conversationId }),
    onMutate: (conversationId) => {
      markConvSending(conversationId, true);
    },
    onSuccess: (res, conversationId) => {
      const retry = retryStateRef.current.get(conversationId) ?? {
        savedUser: false,
        payload: null,
      };
      if (res.ok) {
        setConvSendError(conversationId, null);
        retry.savedUser = false;
        if (profile.soundOn) playReplyTone();
      } else if (res.silent) {
        setConvSendError(conversationId, {
          message: res.error ?? "对方未回复",
          silent: true,
        });
      } else {
        const convTitle =
          conversations.find((c) => c.id === conversationId)?.title ||
          (tempConvRef.current?.id === conversationId
            ? tempConvRef.current.title
            : "") ||
          "对方";
        setConvSendError(conversationId, {
          message: `${convTitle} 回复失败：${res.error ?? "未知错误"}`,
          silent: false,
        });
      }
      retryStateRef.current.set(conversationId, retry);
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err, conversationId) =>
      setConvSendError(conversationId, {
        message: `重试失败：${err instanceof Error ? err.message : "网络错误"}`,
        silent: false,
      }),
    onSettled: (_res, _err, conversationId) => {
      markConvSending(conversationId, false);
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (conversationId: number) =>
      await api.clearConversation({ conversationId }),
    onSuccess: (_res, conversationId) => {
      setConfirmClear(false);
      setShowInfo(false);
      setToast("聊天记录已清空");
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: () => setToast("清空失败，请重试"),
  });

  function switchSection(next: Section) {
    // Switching sections leaves the open room: an unsent
    // provisional room is discarded.
    discardTempRoom();
    setSection(next);
    setSearch("");
    setMobileDetail(false);
    setShowInfo(false);
    setConfirmClear(false);
    setShowAttachMenu(false);
    setColMenu(null);
    setShowMembers(false);
    setSwipedKey(null);
  }

  function openConversation(id: number) {
    // Moving to another room leaves the previous one: an unsent
    // provisional room is discarded.
    discardTempRoom(id);
    selectionStampRef.current = Date.now();
    setSelectedId(id);
    setMobileDetail(true);
    setSwipedKey(null);
    setShowInfo(false);
  }

  /** The chat pane's ≡ button: the same sidebar toggle as the one
   * in the second column's header. It replaces the old back arrow —
   * leaving the chat for the list goes through here, so an unsent
   * provisional room is discarded on the way out. */
  function handleChatMenuButton() {
    discardTempRoom();
    if (railOpen) {
      setRailOpen(false);
    } else {
      setRailOpen(true);
      setMobileDetail(false);
    }
  }

  /** On phones the sidebar is a drawer: picking anything in it
   * closes it again. On desktop it stays put as a column. */
  function closeRailOnPhone() {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setRailOpen(false);
    }
  }

  function pickSidebarSection(next: Section) {
    switchSection(next);
    closeRailOnPhone();
  }

  /** Sidebar recent-chat entry: jump straight into that room. */
  function openRecentChat(conv: Conversation) {
    setSection("agents");
    openConversation(conv.id);
    setSearch("");
    closeRailOnPhone();
  }

  /** Gesture back — only while 手势控制 is on in the settings: one
   * step back toward the previous screen. The topmost open layer
   * closes first (settings panels, then the chat's info popover and
   * other small popups), then the phone drawer, then the open
   * detail pane returns to its list (leaving an unsent provisional
   * room discards it, exactly like the chat header's ≡ button),
   * and finally a non-agents section returns to the agents list.
   * At the root there is nowhere further back to go. */
  function goBack() {
    if (agentPanel != null) return setAgentPanel(null);
    if (groupSettingsConv != null) return setGroupSettingsConv(null);
    if (showProfile) return setShowProfile(false);
    if (showMuseSettings) return setShowMuseSettings(false);
    if (showSettings) {
      // An open settings sub-page pops back to the list first.
      if (settingsBackRef.current?.()) return;
      return setShowSettings(false);
    }
    if (showMembers) return setShowMembers(false);
    if (showInfo) {
      setShowInfo(false);
      setConfirmClear(false);
      return;
    }
    if (showAttachMenu) return setShowAttachMenu(false);
    if (colMenu) return setColMenu(null);
    if (swipedKey) return setSwipedKey(null);
    if (
      railOpen &&
      typeof window !== "undefined" &&
      window.innerWidth < 768
    ) {
      return setRailOpen(false);
    }
    if (mobileDetail) {
      discardTempRoom();
      return setMobileDetail(false);
    }
    if (section !== "agents") return switchSection("agents");
  }

  // Right-swipe detection for gesture control: a clearly horizontal
  // rightward swipe (≥70px across, ≤45px of vertical drift) counts
  // as "back". Swipes starting inside a [data-gesture-off] region
  // (the horizontally scrolling member row) never trigger it, and
  // leftward swipes are left to the rows' swipe-to-delete.
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleGestureTouchStart(e: ReactTouchEvent) {
    if (!profile.gestureControl) return;
    const t = e.touches[0];
    if (!t) return;
    if ((e.target as HTMLElement).closest("[data-gesture-off]")) {
      gestureStartRef.current = null;
      return;
    }
    gestureStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleGestureTouchEnd(e: ReactTouchEvent) {
    const start = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!start || !profile.gestureControl) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx >= 70 && Math.abs(dy) <= 45) goBack();
  }

  /** The sidebar compose button: switch to the chat section and
   * open a fresh room containing only the user. */
  function handleCompose() {
    setSection("agents");
    setSearch("");
    composeMutation.mutate();
    closeRailOnPhone();
  }

  /** Opens an added agent's room: its solo room when it has one,
   * otherwise a new group-style room with that agent already in. */
  function openAgent(agent: Agent) {
    openRoomMutation.mutate(agent.id);
  }

  function openFileChat(f: FileItem) {
    if (f.conversationId == null) return;
    discardTempRoom();
    setSection("agents");
    setSelectedId(f.conversationId);
    setSearch("");
    setMobileDetail(true);
  }

  async function handlePickImage(file: File) {
    try {
      const { dataBase64, mimeType } = await fileToBase64(file);
      if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
        setToast("仅支持 JPG 或 PNG 图片");
        return;
      }
      setPendingFile(null);
      setPendingImage({
        dataBase64,
        mimeType,
        preview: URL.createObjectURL(file),
        fileName: file.name,
        size: file.size,
      });
    } catch {
      setToast("图片读取失败，请重试");
    }
  }

  async function handlePickFile(file: File) {
    if (file.type === "image/jpeg" || file.type === "image/png") {
      await handlePickImage(file);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setToast("文件不能超过 10MB");
      return;
    }
    try {
      const { dataBase64, mimeType } = await fileToBase64(file);
      setPendingImage(null);
      setPendingFile({
        dataBase64,
        mimeType: mimeType || "application/octet-stream",
        fileName: file.name,
        size: file.size,
      });
    } catch {
      setToast("文件读取失败，请重试");
    }
  }

  function handleSend() {
    const text = draft.trim();
    if (activeConvId == null || sending) return;
    if (!text && !pendingImage && !pendingFile) return;
    const payload = { text, image: pendingImage, file: pendingFile };
    retryStateRef.current.set(activeConvId, {
      savedUser: false,
      payload,
    });
    setConvSendError(activeConvId, null);
    setShowAttachMenu(false);
    // Optimistic echo: the user's bubble appears immediately, in
    // this room only.
    setConvOptimistic(activeConvId, [
      {
        id: -Date.now(),
        role: "user",
        content: text,
        streaming: false,
        agentId: null,
        agent: null,
        imageUrl: pendingImage?.preview ?? null,
        attachment: pendingImage
          ? {
              name: pendingImage.fileName,
              size: pendingImage.size,
              mimeType: pendingImage.mimeType,
              url: pendingImage.preview,
              isImage: true,
            }
          : pendingFile
            ? {
                name: pendingFile.fileName,
                size: pendingFile.size,
                mimeType: pendingFile.mimeType,
                url: null,
                isImage: false,
              }
            : null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
    setPendingImage(null);
    setPendingFile(null);
    sendMutation.mutate({
      conversationId: activeConvId,
      text,
      image: pendingImage
        ? {
            dataBase64: pendingImage.dataBase64,
            mimeType: pendingImage.mimeType,
            fileName: pendingImage.fileName,
            size: pendingImage.size,
          }
        : null,
      file: pendingFile
        ? {
            dataBase64: pendingFile.dataBase64,
            mimeType: pendingFile.mimeType,
            fileName: pendingFile.fileName,
            size: pendingFile.size,
          }
        : null,
    });
  }

  function handleRetry() {
    if (activeConvId == null || sending) return;
    const retry = retryStateRef.current.get(activeConvId);
    setConvSendError(activeConvId, null);
    if (retry?.savedUser) {
      retryMutation.mutate(activeConvId);
      return;
    }
    const payload = retry?.payload;
    if (!payload) return;
    sendMutation.mutate({
      conversationId: activeConvId,
      text: payload.text,
      image: payload.image
        ? {
            dataBase64: payload.image.dataBase64,
            mimeType: payload.image.mimeType,
            fileName: payload.image.fileName,
            size: payload.image.size,
          }
        : null,
      file: payload.file
        ? {
            dataBase64: payload.file.dataBase64,
            mimeType: payload.file.mimeType,
            fileName: payload.file.fileName,
            size: payload.file.size,
          }
        : null,
    });
  }

  // The resolved appearance: the 外观 setting's mode, with 系统模式
  // following the device's live colour scheme. data-theme / data-font
  // on this root drive the whole appearance layer in theme.css.
  const resolvedTheme =
    profile.themeMode === "dark" ||
    (profile.themeMode === "system" && systemDark)
      ? "dark"
      : "light";

  return (
    <div
      data-theme={resolvedTheme}
      data-font={profile.fontScale}
      className="flex h-dvh w-full overflow-hidden overscroll-none bg-[#ededed] text-[#191919]"
      onTouchStart={handleGestureTouchStart}
      onTouchEnd={handleGestureTouchEnd}
    >
      {/* ---------- column 1: sidebar (rail + recent chats) ----------
          Toggled by the ≡ button in the second column's header. On
          phones it is a drawer sliding over the list (hidden by
          default, backdrop tap closes it); on desktop it is a real
          column whose width animates to zero when hidden, letting
          the other two columns take the space. The phone backdrop
          is fully transparent on purpose: opening the menu must not
          grey out the whole list behind it — the drawer separates
          itself with its own shadow, and grey press feedback stays
          local to the one row a finger actually touches. */}
      <div
        aria-hidden="true"
        onClick={() => setRailOpen(false)}
        className={`fixed inset-0 z-40 bg-transparent md:hidden ${
          railOpen ? "" : "pointer-events-none"
        }`}
      />
      <aside
        aria-label="侧边栏"
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] shrink-0 flex-col overflow-hidden border-r border-black/[0.04] bg-[#f5f5f5] shadow-[8px_0_30px_rgba(0,0,0,0.12)] transition-all duration-300 ease-out md:static md:z-auto md:shadow-none ${
          railOpen
            ? "translate-x-0 md:w-[264px] md:opacity-100"
            : "pointer-events-none -translate-x-full md:w-0 md:translate-x-0 md:border-r-0 md:opacity-0"
        }`}
      >
        <div className="flex h-full w-[280px] max-w-[85vw] flex-col md:w-[264px]">
          <div className="flex items-center justify-between px-4 pt-safe">
            <div className="mt-3 hidden gap-2 md:flex" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <span className="mt-3 text-[15px] font-semibold md:hidden">
              菜单
            </span>
            <button
              type="button"
              aria-label="收起侧边栏"
              onClick={() => setRailOpen(false)}
              className="mt-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#191919] shadow-[0_1px_4px_rgba(0,0,0,0.12)] transition-colors hover:bg-black/[0.04]"
            >
              <Icon d={PATHS.menu} size={19} />
            </button>
          </div>

          {/* The sidebar's section entries, as icon + name rows. */}
          <nav aria-label="主导航" className="mt-3 flex flex-col gap-1 px-3">
            {SECTION_META.map((item) => {
              const active = section === item.key;
              const isVpn = item.key === "vpn";
              // The VPN entry doubles as the live status indicator:
              // grey 「离线」 while disconnected; once the tunnel is
              // verified up it shows the connected region's name in
              // green with a soft green glow. Other entries keep the
              // usual orange active state.
              const label = isVpn
                ? vpnConnected
                  ? vpnRegionName
                  : "离线"
                : item.label;
              const sub = isVpn ? "代理" : null;
              const colorCls = isVpn
                ? vpnConnected
                  ? "text-[#1fa637]"
                  : "text-[#6e6e73]"
                : active
                  ? "text-[#ff7a1a]"
                  : "text-[#3a3a3c]";
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={item.label}
                  aria-pressed={active}
                  aria-current={active ? "true" : undefined}
                  onClick={() => pickSidebarSection(item.key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-black/[0.08] ${
                    active ? "bg-black/[0.06]" : "hover:bg-black/[0.04]"
                  } ${colorCls}`}
                  style={
                    isVpn && vpnConnected
                      ? { textShadow: "0 0 10px rgba(40, 200, 64, 0.45)" }
                      : undefined
                  }
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    style={
                      isVpn && vpnConnected
                        ? {
                            filter:
                              "drop-shadow(0 0 5px rgba(40, 200, 64, 0.65))",
                          }
                        : undefined
                    }
                  >
                    <Icon
                      d={item.d}
                      size={20}
                      filled={active && item.key === "agents"}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {label}
                    </span>
                    {sub && (
                      <span className="block truncate text-xs text-[#9a9aa0]">
                        {sub}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Recent chat windows, newest first. */}
          <p className="px-5 pt-5 pb-1 text-xs font-medium text-[#9a9aa0]">
            最近聊天
          </p>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(7rem+env(safe-area-inset-bottom))]"
            onPointerDownCapture={closeRecentSwipeOnOutsideTap}
          >
            {conversationsQuery.isPending ? (
              <p className="px-3 py-4 text-sm text-[#9a9aa0]">加载中…</p>
            ) : recentChats.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[#9a9aa0]">暂无最近聊天</p>
            ) : (
              recentChats.map((conv) => {
                const isActive =
                  conv.id === selectedId && section === "agents";
                return (
                  <RecentChatRow
                    key={conv.id}
                    rowKey={`recent-${conv.id}`}
                    openKey={recentSwipedKey}
                    onOpenKeyChange={setRecentSwipedKey}
                    onDelete={() =>
                      deleteConversationMutation.mutate(conv.id)
                    }
                    deleteLabel={`删除聊天 ${recentChatName(conv)}`}
                    onOpen={() => openRecentChat(conv)}
                    onLongPress={() => openChatSheet(conv)}
                    ariaLabel={`打开聊天 ${recentChatName(conv)}`}
                    selected={isActive}
                  >
                    {roomAvatar(conv, 40)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {recentChatName(conv)}
                        </span>
                        <span className="shrink-0 text-[11px] text-[#9a9aa0]">
                          {listTime(conv.previewAt ?? conv.updatedAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
                        {conv.preview || "暂无消息"}
                      </span>
                    </span>
                  </RecentChatRow>
                );
              })
            )}
          </div>

          {/* Sidebar footer: settings (a placeholder for now) and
              the compose button side by side. There is no profile
              avatar here any more — the profile lives on the 「我」
              row at the top of the agent list. On phones (drawer)
              the compose button is a labelled pill; on desktop it
              shrinks to a round icon button next to the gear. */}
          <div className="border-t border-black/[0.05] px-3 py-3 pb-safe">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="设置"
                onClick={() => {
                  setSettingsInitialPage("list");
                  setShowSettings(true);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#3a3a3c] shadow-[0_1px_4px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.04] transition-colors hover:bg-black/[0.03] active:bg-black/[0.06]"
              >
                <Icon d={PATHS.gear} size={19} />
              </button>
              <button
                type="button"
                aria-label="新对话"
                disabled={composeMutation.isPending}
                onClick={handleCompose}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#2f6bff] px-3 text-sm font-medium text-white shadow-[0_2px_8px_rgba(47,107,255,0.35)] transition-colors hover:bg-[#2a5fe0] disabled:opacity-50 md:w-10 md:flex-none md:px-0"
              >
                <Icon d={PATHS.compose} size={18} />
                <span className="md:hidden">新对话</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ---------- column 2: per-section list ---------- */}
      <aside
        className={`${
          mobileDetail ? "hidden md:flex" : "flex"
        } min-w-0 flex-1 shrink-0 flex-col border-r border-black/[0.06] bg-white md:w-[280px] md:flex-none`}
      >
        <div className="flex items-center justify-between px-4 pt-safe">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label={railOpen ? "隐藏侧边栏" : "显示侧边栏"}
              aria-expanded={railOpen}
              onClick={() => setRailOpen((v) => !v)}
              className="mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#191919] shadow-[0_1px_5px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.04] transition-colors hover:bg-black/[0.03]"
            >
              <Icon d={PATHS.menu} size={20} />
            </button>
            <h1 className="pt-3 text-xl font-semibold">{SECTION_TITLES[section]}</h1>
          </div>
          {section === "agents" && (
            <div className="relative mt-3">
              <button
                type="button"
                aria-label="新建"
                aria-haspopup="menu"
                aria-expanded={colMenu === "agents"}
                onClick={() =>
                  setColMenu(colMenu === "agents" ? null : "agents")
                }
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#191919] transition-colors hover:bg-black/[0.05]"
              >
                <Icon d={PATHS.plus} size={22} />
              </button>
              {colMenu === "agents" && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setColMenu(null)}
                  />
                  <div
                    role="menu"
                    aria-label="新建菜单"
                    className="absolute top-11 right-0 z-30 w-44 rounded-xl bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.05]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setColMenu(null);
                        setAgentPanelNonce((n) => n + 1);
                        setAgentPanel({ agent: null });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-black/[0.04]"
                    >
                      <Icon d={PATHS.plus} size={18} />
                      添加 Agent
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="px-4 pt-3">
          <label className="flex items-center gap-2 rounded-[10px] bg-[#f0f0f2] px-3 py-2">
            <span className="text-[#8a8a8a]">
              <Icon d={PATHS.search} size={16} />
            </span>
            <input
              type="search"
              aria-label={SECTION_SEARCH_PLACEHOLDERS[section]}
              placeholder={SECTION_SEARCH_PLACEHOLDERS[section]}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSwipedKey(null);
              }}
              className="w-full bg-transparent text-sm outline-none placeholder:text-[#9a9aa0]"
            />
          </label>
        </div>

        {section === "agents" && (
          <>
            <div
              className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(7rem+env(safe-area-inset-bottom))]"
              onPointerDownCapture={closeSwipeOnOutsideTap}
            >
              {conversationsQuery.isPending ? (
                <p className="px-3 py-6 text-sm text-[#9a9aa0]">加载中…</p>
              ) : conversationsQuery.isError ? (
                <div className="px-3 py-6">
                  <p className="text-sm text-[#c0392b]">会话加载失败</p>
                  <button
                    type="button"
                    onClick={() => conversationsQuery.refetch()}
                    className="mt-2 rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm"
                  >
                    重试
                  </button>
                </div>
              ) : (
                <>
                  {(!q ||
                    "我".includes(q) ||
                    profile.name.toLowerCase().includes(q)) && (
                    <button
                      type="button"
                      onClick={() => setShowProfile(true)}
                      aria-label="我的个人资料"
                      className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] active:bg-black/[0.06]"
                    >
                      <UserAvatar size={44} profile={profile} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {profile.name || "我"}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
                          我 · 个人资料
                        </span>
                      </span>
                    </button>
                  )}
                  <div ref={entriesRef} className="relative">
                    {visibleEntries.map((entry) => {
                      if (entry.agentId == null) {
                        const museDragging = drag?.key === "muse";
                        return (
                        <div
                          key="muse"
                          data-entry-key="muse"
                          role="button"
                          tabIndex={0}
                          aria-label={`与 ${museSettings.name || "Muse"} 的对话`}
                          aria-current={
                            museRowRoom != null && selectedId === museRowRoom.id
                              ? "true"
                              : undefined
                          }
                          onClick={() => {
                            if (consumeSuppressClick()) return;
                            openRoomMutation.mutate(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openRoomMutation.mutate(null);
                            }
                          }}
                          onPointerDown={(e) =>
                            handleEntryPointerDown("muse", e)
                          }
                          onContextMenu={(e) => e.preventDefault()}
                          className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors select-none active:bg-[#e3e3e7] ${
                            museRowRoom != null && selectedId === museRowRoom.id
                              ? "bg-white md:bg-[#f0f0f2]"
                              : "bg-white hover:bg-black/[0.03]"
                          } ${museDragging ? "relative z-30 shadow-[0_10px_28px_rgba(0,0,0,0.22)]" : ""}`}
                          style={
                            museDragging
                              ? {
                                  transform: `translateY(${drag.dy}px) scale(1.02)`,
                                  touchAction: "none",
                                }
                              : { touchAction: "pan-y" }
                          }
                        >
                          <button
                            type="button"
                            aria-label={`设置 ${museSettings.name || "Muse"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (consumeSuppressClick()) return;
                              setShowMuseSettings(true);
                            }}
                            className="shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
                          >
                            <MuseAvatar
                              size={44}
                              color={museSettings.color}
                              imageUrl={museSettings.avatarUrl}
                            />
                          </button>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[15px] font-medium">
                                {museSettings.name || "Muse"}
                              </span>
                              <span className="shrink-0 text-[11px] text-[#9a9aa0]">
                                {listTime(museRowRoom?.previewAt ?? null)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
                              {!museSettings.enabled
                                ? "已停用"
                                : museRowRoom?.preview ||
                                  museSettings.note ||
                                  "暂无消息"}
                            </span>
                          </span>
                        </div>
                        );
                      }
                      const a = agents.find((x) => x.id === entry.agentId);
                      if (!a) return null;
                      const entryKey = `agent-${a.id}`;
                      const isWeb = a.connectionType === "web";
                      const configured = isWeb
                        ? a.webStatus === "logged_in"
                        : a.hasApiKey &&
                          a.apiBase.trim() !== "" &&
                          a.model.trim() !== "";
                      const soloRoom =
                        conversations.find((c) => soloRoomOf(c, a.id)) ?? null;
                      return (
                        <PlainRow
                          key={entryKey}
                          entryKey={entryKey}
                          dragging={drag?.key === entryKey}
                          dragDy={drag?.dy ?? 0}
                          onPointerDown={(e) =>
                            handleEntryPointerDown(entryKey, e)
                          }
                          onOpen={() => {
                            if (consumeSuppressClick()) return;
                            openAgent(a);
                          }}
                          ariaLabel={`与 ${a.name} 的对话`}
                          selected={soloRoom != null && soloRoom.id === selectedId}
                        >
                          <button
                            type="button"
                            aria-label={`设置智能体 ${a.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (consumeSuppressClick()) return;
                              setAgentPanel({ agent: a });
                            }}
                            className="shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
                          >
                            <AgentAvatar
                              color={a.color}
                              glyph={a.glyph}
                              name={a.name}
                              size={44}
                              imageUrl={a.avatarUrl}
                              logo={vendorLogoFor(a)}
                            />
                          </button>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[15px] font-medium">
                                {a.name || "未命名智能体"}
                              </span>
                              <span className="shrink-0 text-[11px] text-[#9a9aa0]">
                                {listTime(a.previewAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-[#9a9aa0]">
                              {!a.enabled
                                ? "已停用"
                                : isWeb
                                  ? a.webStatus === "expired"
                                    ? "令牌已过期，请重新登录"
                                    : a.webStatus === "blocked"
                                      ? "被网页端拦截"
                                      : a.preview ||
                                        a.note ||
                                        (a.webStatus === "logged_in"
                                          ? "暂无消息"
                                          : "尚未登录网页版")
                                  : !configured
                                    ? a.note || "尚未配置 API"
                                    : a.preview || a.note || "暂无消息"}
                            </span>
                          </span>
                        </PlainRow>
                      );
                    })}
                    {drag && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2 left-2 z-40 h-[2px] rounded bg-[#2f6bff]"
                        style={{ top: drag.lineTop }}
                      />
                    )}
                  </div>
                  {filteredRooms.length > 0 && (
                    <>
                      <p className="px-3 pt-4 pb-1 text-xs font-medium text-[#9a9aa0]">
                        全部对话
                      </p>
                      {filteredRooms.map((conv: Conversation) => {
                        return (
                          <SwipeableRow
                            key={conv.id}
                            rowKey={`conv-${conv.id}`}
                            openKey={swipedKey}
                            onOpenKeyChange={setSwipedKey}
                            onDelete={() =>
                              deleteConversationMutation.mutate(conv.id)
                            }
                            deleteLabel={`删除对话 ${conv.title}`}
                            onOpen={() => openConversation(conv.id)}
                            onLongPress={() => openChatSheet(conv)}
                            ariaLabel={`对话 ${conv.title}`}
                            selected={conv.id === selectedId}
                          >
                            <button
                              type="button"
                              aria-label={`房间设置 ${conv.title}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setGroupSettingsConv(conv);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
                            >
                              {roomAvatar(conv, 40)}
                            </button>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-medium">
                                  {conv.title || "新对话"}
                                </span>
                                <span className="shrink-0 text-[11px] text-[#9a9aa0]">
                                  {listTime(conv.previewAt)}
                                </span>
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-[#9a9aa0]">
                                {conv.preview || "暂无消息"}
                              </span>
                            </span>
                          </SwipeableRow>
                        );
                      })}
                    </>
                  )}
                  {q &&
                    !"muse".includes(q) &&
                    filteredAgents.length === 0 &&
                    filteredRooms.length === 0 && (
                      <p className="px-3 py-6 text-sm text-[#9a9aa0]">
                        没有匹配的智能体
                      </p>
                    )}
                  {/* Bottom clearance spacer: some webviews trim a
                      scroll container's own bottom padding, so the
                      reserved blank space after the last row is a
                      real element — the last agent can always be
                      scrolled clear of the host app's bottom
                      buttons. */}
                  <div aria-hidden="true" className="h-10 shrink-0" />
                </>
              )}
            </div>
          </>
        )}

        {section === "files" && (
          <div className="mt-2 flex min-h-0 flex-1 flex-col px-2 pb-[calc(7rem+env(safe-area-inset-bottom))]">
            <div className="px-1 pb-2">
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f6bff] px-3 py-2.5 text-sm font-medium text-white shadow-[0_2px_8px_rgba(47,107,255,0.3)] transition-colors hover:bg-[#2a5fe0] disabled:opacity-50"
              >
                <Icon d={PATHS.upload} size={17} />
                {uploading ? "上传中…" : "上传文件"}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                aria-label="选择要上传的文件"
                className="hidden"
                onChange={(e) => {
                  void handleUploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className="px-1 pt-2 text-xs leading-relaxed text-[#9a9aa0]">
                这里是空间里已有的文件（上传的和聊天里发过的）。手机里的文件点上面上传选进来。
              </p>
              {files.length > 0 && (
                <div className="flex items-center justify-between px-1 pt-2">
                  <p className="text-xs text-[#9a9aa0]">
                    {fileBatchMode
                      ? `已选 ${selectedBatchItems.length} 个文件`
                      : `共 ${files.length} 个文件`}
                  </p>
                  <button
                    type="button"
                    aria-pressed={fileBatchMode}
                    onClick={() => {
                      setFileBatchMode((v) => !v);
                      setFileSelection(new Set());
                      setFileBatchConfirmDelete(false);
                      setSwipedKey(null);
                    }}
                    className="rounded-lg bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium text-[#191919]"
                  >
                    {fileBatchMode ? "完成" : "批量管理"}
                  </button>
                </div>
              )}
              {files.length > 0 && (
                <div
                  className="flex gap-1.5 px-1 pt-2.5"
                  role="tablist"
                  aria-label="文件类别"
                >
                  {FILE_CATEGORIES.map((c) => {
                    const active = fileCategory === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-label={`文件类别 ${c.label}`}
                        onClick={() => {
                          setFileCategory(c.key);
                          setFileSelection(new Set());
                          setFileBatchConfirmDelete(false);
                        }}
                        className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                          active
                            ? "bg-[#2f6bff] text-white"
                            : "bg-black/[0.05] text-[#3a3a3c]"
                        }`}
                      >
                        {c.label}
                        <span
                          className={`pl-1 text-[11px] ${
                            active ? "text-white/75" : "text-[#9a9aa0]"
                          }`}
                        >
                          {fileCategoryCounts[c.key]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              onPointerDownCapture={closeSwipeOnOutsideTap}
            >
              {filesQuery.isPending ? (
                <p className="px-3 py-6 text-sm text-[#9a9aa0]">加载中…</p>
              ) : filesQuery.isError ? (
                <div className="px-3 py-6">
                  <p className="text-sm text-[#c0392b]">文件加载失败</p>
                  <button
                    type="button"
                    onClick={() => filesQuery.refetch()}
                    className="mt-2 rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm"
                  >
                    重试
                  </button>
                </div>
              ) : files.length === 0 ? (
                <p className="px-3 py-6 text-sm text-[#9a9aa0]">
                  暂无文件，点上方「上传文件」添加
                </p>
              ) : filteredFiles.length === 0 ? (
                <p className="px-3 py-6 text-sm text-[#9a9aa0]">没有匹配的文件</p>
              ) : categoryFiles.length === 0 ? (
                <p className="px-3 py-6 text-sm text-[#9a9aa0]">
                  {activeCategory.emptyText}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {categoryFiles.map((f) => {
                    const key = `${f.source}:${f.id}`;
                    const meta = (
                      <>
                        <FileThumb file={f} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {f.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[#9a9aa0]">
                            {formatSize(f.size)} · {listTime(f.createdAt)} ·{" "}
                            {f.source === "upload"
                              ? "上传"
                              : `来自「${f.conversationTitle}」`}
                          </span>
                          {f.agentAccess && (
                            <span className="mt-1 inline-block rounded-full bg-[#e6f7ea] px-2 py-0.5 text-[11px] font-medium text-[#1d9e4b]">
                              智能体可访问
                            </span>
                          )}
                        </span>
                      </>
                    );
                    if (fileBatchMode) {
                      const checked = fileSelection.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={checked}
                          aria-label={`选择文件 ${f.name}`}
                          onClick={() => toggleFileSelection(key)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left select-none ${
                            checked ? "bg-[#e8effd]" : "bg-white"
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 min-h-0 shrink-0 items-center justify-center rounded-full border-2 ${
                              checked
                                ? "border-[#2f6bff] bg-[#2f6bff] text-white"
                                : "border-black/25 text-transparent"
                            }`}
                          >
                            <Icon d={PATHS.check} size={13} />
                          </span>
                          {meta}
                        </button>
                      );
                    }
                    return (
                      <div key={key} className="flex items-stretch gap-2">
                        <div className="min-w-0 flex-1">
                          <SwipeableRow
                            rowKey={`file-${key}`}
                            openKey={swipedKey}
                            onOpenKeyChange={setSwipedKey}
                            onDelete={() => deleteFileMutation.mutate(f)}
                            deleteLabel={`删除文件 ${f.name}`}
                            onOpen={() => {
                              setSelectedFileKey(key);
                              setMobileDetail(true);
                            }}
                            ariaLabel={`文件 ${f.name}`}
                            selected={key === selectedFileKey}
                            hideHoverDelete
                          >
                            {meta}
                          </SwipeableRow>
                        </div>
                        {/* The agent-access switch lives OUTSIDE the
                            swipeable row, in its own fixed tile: it
                            never slides, the red delete layer never
                            passes under it, and a swipe can never
                            start on it — the two controls cannot
                            overlap in any state. */}
                        <div
                          className={`flex w-[52px] shrink-0 items-center justify-center rounded-xl ${
                            key === selectedFileKey
                              ? "bg-white md:bg-[#f0f0f2]"
                              : "bg-white"
                          }`}
                        >
                          <button
                            type="button"
                            role="switch"
                            aria-checked={f.agentAccess}
                            aria-label={`允许智能体访问 ${f.name}`}
                            disabled={fileAccessMutation.isPending}
                            onClick={() =>
                              fileAccessMutation.mutate({
                                f,
                                access: !f.agentAccess,
                              })
                            }
                            className={`relative h-5 w-9 min-h-0 shrink-0 rounded-full transition-colors ${
                              f.agentAccess
                                ? "bg-[#34c759]"
                                : "bg-black/[0.15]"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                                f.agentAccess ? "left-[18px]" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {fileBatchMode && (
              <div className="shrink-0 px-1 pt-2">
                {fileBatchConfirmDelete ? (
                  <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                    <p className="min-w-0 flex-1 text-sm">
                      确认删除选中的 {selectedBatchItems.length} 个文件？
                    </p>
                    <button
                      type="button"
                      disabled={
                        selectedBatchItems.length === 0 ||
                        batchDeleteFilesMutation.isPending
                      }
                      onClick={() =>
                        batchDeleteFilesMutation.mutate(selectedBatchItems)
                      }
                      className="shrink-0 rounded-lg bg-[#e5484d] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      onClick={() => setFileBatchConfirmDelete(false)}
                      className="shrink-0 rounded-lg bg-black/[0.05] px-3 py-1.5 text-sm"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFileSelection(
                          new Set(
                            categoryFiles.map(
                              (f) => `${f.source}:${f.id}`,
                            ),
                          ),
                        )
                      }
                      className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      disabled={
                        selectedBatchItems.length === 0 ||
                        batchAccessMutation.isPending
                      }
                      onClick={() =>
                        batchAccessMutation.mutate({
                          items: selectedBatchItems,
                          access: true,
                        })
                      }
                      className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06)] disabled:opacity-50"
                    >
                      开启权限
                    </button>
                    <button
                      type="button"
                      disabled={
                        selectedBatchItems.length === 0 ||
                        batchAccessMutation.isPending
                      }
                      onClick={() =>
                        batchAccessMutation.mutate({
                          items: selectedBatchItems,
                          access: false,
                        })
                      }
                      className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06)] disabled:opacity-50"
                    >
                      关闭权限
                    </button>
                    <button
                      type="button"
                      disabled={selectedBatchItems.length === 0}
                      onClick={() => setFileBatchConfirmDelete(true)}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-[#c0392b] shadow-[0_1px_4px_rgba(0,0,0,0.06)] disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {section === "vpn" && (
          <VpnColumn search={search} onOpenDetail={() => setMobileDetail(true)} />
        )}
      </aside>

      {/* ---------- column 3: detail pane ---------- */}
      <main
        className={`${
          mobileDetail ? "flex" : "hidden md:flex"
        } min-w-0 flex-1 flex-col bg-[#ededed]`}
      >
        {section === "files" ? (
          <FileDetail
            file={selectedFile}
            hasFiles={files.length > 0}
            codeWrap={profile.codeWrap}
            onBack={() => setMobileDetail(false)}
            onOpenChat={openFileChat}
            onDeleted={() => {
              setSelectedFileKey(null);
              setMobileDetail(false);
            }}
            onPreviewImage={(url, name) => setPreviewImage({ url, name })}
          />
        ) : section === "vpn" ? (
          <VpnDetail onBack={() => setMobileDetail(false)} />
        ) : (
          <>
            <header className="relative flex items-center justify-between border-b border-black/[0.05] px-3 pt-safe sm:px-4">
              <div className="flex h-12 items-center gap-1">
                <button
                  type="button"
                  aria-label={railOpen ? "隐藏侧边栏" : "显示侧边栏"}
                  aria-expanded={railOpen}
                  onClick={handleChatMenuButton}
                  className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/[0.05]"
                >
                  <Icon d={PATHS.menu} size={20} />
                </button>
                {activeConv && (
                  <button
                    type="button"
                    aria-label={`房间设置 ${activeConv.title}`}
                    onClick={() => setGroupSettingsConv(activeConv)}
                    className="shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
                  >
                    {roomAvatar(activeConv, 30)}
                  </button>
                )}
              </div>
              <div className="pointer-events-none absolute left-1/2 max-w-[60%] -translate-x-1/2 text-center">
                <h2 className="truncate text-[16px] font-medium leading-tight">
                  {displayTitle}
                </h2>
                {activeConv && (
                  <p className="text-[11px] leading-tight text-[#9a9aa0]">
                    {activeMemberCount} 位成员
                  </p>
                )}
              </div>
              <div ref={infoRef} className="relative flex h-12 items-center">
                <button
                  type="button"
                  aria-label="会话信息"
                  aria-expanded={showInfo}
                  onClick={() => {
                    setShowInfo((v) => !v);
                    setConfirmClear(false);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#191919] transition-colors hover:bg-black/[0.05]"
                >
                  <GridIcon />
                </button>
                {showInfo && (
                  <div className="absolute top-12 right-0 z-30 w-60 rounded-xl bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.14)]">
                    <p className="text-sm font-medium">会话信息</p>
                    <div className="mt-3 flex items-center gap-2.5">
                      {activeConv ? (
                        <button
                          type="button"
                          aria-label={`房间设置 ${activeConv.title}`}
                          onClick={() => {
                            setShowInfo(false);
                            setGroupSettingsConv(activeConv);
                          }}
                          className="shrink-0 rounded-full transition hover:ring-2 hover:ring-[#2f6bff]/60 hover:ring-offset-1"
                        >
                          {roomAvatar(activeConv, 34)}
                        </button>
                      ) : (
                        <GroupAvatar size={34} />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm">{displayTitle}</p>
                        <p className="text-xs text-[#9a9aa0]">
                          {activeConv
                            ? `成员：${groupMemberNames.join("、")}`
                            : "暂无打开的会话"}
                        </p>
                      </div>
                    </div>
                    {activeAgent && (
                      <>
                        <dl className="mt-3 space-y-1 text-xs text-[#9a9aa0]">
                          <div className="flex justify-between gap-2">
                            <dt>服务商</dt>
                            <dd className="truncate">
                              {activeAgent.connectionType === "web"
                                ? webSiteMeta(activeAgent.provider).label
                                : (PROVIDERS.find(
                                    (p) => p.id === activeAgent.provider,
                                  )?.label ?? activeAgent.provider)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>模型</dt>
                            <dd className="truncate">
                              {activeAgent.model || "未设置"}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>状态</dt>
                            <dd>
                              {!activeAgent.enabled
                                ? "已停用"
                                : activeAgent.connectionType === "web"
                                  ? activeAgent.webStatus === "logged_in"
                                    ? `已登录网页版${activeAgent.webAccount ? ` · ${activeAgent.webAccount}` : ""}`
                                    : activeAgent.webStatus === "expired"
                                      ? "令牌已过期"
                                      : activeAgent.webStatus === "blocked"
                                        ? "被网页端拦截"
                                        : "尚未登录网页版"
                                  : activeAgent.hasApiKey &&
                                      activeAgent.apiBase.trim() !== "" &&
                                      activeAgent.model.trim() !== ""
                                    ? "已配置 API"
                                    : "尚未配置 API"}
                            </dd>
                          </div>
                        </dl>
                      </>
                    )}
                    {activeConv && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowInfo(false);
                          setShowMembers(true);
                        }}
                        className="mt-3 w-full rounded-lg bg-black/[0.05] px-3 py-2 text-sm"
                      >
                        管理成员
                      </button>
                    )}
                    <p className="mt-3 text-xs text-[#9a9aa0]">
                      共 {serverMessages.length} 条消息
                    </p>
                    {confirmClear ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            activeConvId != null && clearMutation.mutate(activeConvId)
                          }
                          disabled={clearMutation.isPending}
                          className="flex-1 rounded-lg bg-[#e5484d] px-3 py-2 text-sm text-white disabled:opacity-50"
                        >
                          确认清空
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClear(false)}
                          className="flex-1 rounded-lg bg-black/[0.05] px-3 py-2 text-sm"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClear(true)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-black/[0.05] px-3 py-2 text-sm text-[#c0392b]"
                      >
                        <Icon d={PATHS.trash} size={15} />
                        清空聊天记录
                      </button>
                    )}
                  </div>
                )}
              </div>
            </header>

            {activeConvId != null && (
              <div
                data-gesture-off=""
                className="flex items-start gap-2 overflow-x-auto overscroll-contain border-b border-black/[0.05] px-3 py-2"
                aria-label="房间成员"
              >
                {/* The user is always the room's first member: shown
                    with their saved profile avatar, name and colour,
                    in the same cell shape as the agent members but
                    with an empty slot where their switch would be —
                    the user has no switch and cannot be removed.
                    This row is what the header's member count counts:
                    the user plus the agent members beside them. */}
                <div className="flex w-14 shrink-0 flex-col items-center gap-1">
                  <span aria-hidden="true" className="h-3 shrink-0" />
                  <UserAvatar size={36} profile={profile} />
                  <span className="w-full truncate text-center text-[11px] text-[#191919]">
                    {profile.name || "我"}
                  </span>
                </div>
                {groupMembers.museMember && (
                  <div className="flex w-14 shrink-0 flex-col items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={groupMembers.museEnabled}
                      aria-label={`在本房间启用 ${museSettings.name || "Muse"}`}
                      disabled={memberToggleMutation.isPending}
                      onClick={() =>
                        memberToggleMutation.mutate({
                          agentId: null,
                          enabled: !groupMembers.museEnabled,
                        })
                      }
                      className={`relative h-3 w-6 min-h-0 shrink-0 rounded-full transition-colors ${
                        groupMembers.museEnabled
                          ? "bg-[#34c759]"
                          : "bg-black/[0.18]"
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${
                          groupMembers.museEnabled ? "left-[13px]" : "left-[1px]"
                        }`}
                      />
                    </button>
                    <span
                      className="rounded-full transition"
                      style={
                        groupMembers.museEnabled
                          ? {
                              boxShadow: `0 0 0 2px ${museSettings.color}2e, 0 0 10px 2px ${museSettings.color}59`,
                            }
                          : { filter: "grayscale(1)", opacity: 0.45 }
                      }
                    >
                      <MuseAvatar
                        size={36}
                        color={museSettings.color}
                        imageUrl={museSettings.avatarUrl}
                      />
                    </span>
                    <span
                      className={`w-full truncate text-center text-[11px] ${
                        groupMembers.museEnabled
                          ? "text-[#191919]"
                          : "text-[#9a9aa0]"
                      }`}
                    >
                      {museSettings.name || "Muse"}
                    </span>
                    {activeConv?.stageOwner === "muse" && (
                      <span className="rounded-full bg-[#2f6bff]/10 px-1.5 py-px text-[10px] font-medium text-[#2f6bff]">
                        负责人
                      </span>
                    )}
                  </div>
                )}
                {groupMembers.agentIds.map((id) => {
                  const a = agents.find((x) => x.id === id);
                  if (!a) return null;
                  const on = !groupMembers.disabledAgentIds.includes(id);
                  return (
                    <div
                      key={id}
                      className="flex w-14 shrink-0 flex-col items-center gap-1"
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`在本房间启用 ${a.name}`}
                        disabled={memberToggleMutation.isPending}
                        onClick={() =>
                          memberToggleMutation.mutate({
                            agentId: id,
                            enabled: !on,
                          })
                        }
                        className={`relative h-3 w-6 min-h-0 shrink-0 rounded-full transition-colors ${
                          on ? "bg-[#34c759]" : "bg-black/[0.18]"
                        }`}
                      >
                        <span
                          className={`absolute top-[1px] h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${
                            on ? "left-[13px]" : "left-[1px]"
                          }`}
                        />
                      </button>
                      <span
                        className="rounded-full transition"
                        style={
                          on
                            ? {
                                boxShadow: `0 0 0 2px ${a.color}2e, 0 0 10px 2px ${a.color}59`,
                              }
                            : { filter: "grayscale(1)", opacity: 0.45 }
                        }
                      >
                        <AgentAvatar
                          color={a.color}
                          glyph={a.glyph}
                          name={a.name}
                          size={36}
                          imageUrl={a.avatarUrl}
                          logo={vendorLogoFor(a)}
                        />
                      </span>
                      <span
                        className={`w-full truncate text-center text-[11px] ${
                          on ? "text-[#191919]" : "text-[#9a9aa0]"
                        }`}
                      >
                        {a.name || "智能体"}
                      </span>
                      {activeConv?.stageOwner === String(id) && (
                        <span className="rounded-full bg-[#2f6bff]/10 px-1.5 py-px text-[10px] font-medium text-[#2f6bff]">
                          负责人
                        </span>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setShowMembers(true);
                    setShowInfo(false);
                  }}
                  aria-label="添加智能体到本群"
                  className="flex w-14 shrink-0 flex-col items-center gap-1 pt-4 text-[#6e6e73]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-black/25">
                    <Icon d={PATHS.plus} size={16} />
                  </span>
                  <span className="w-full truncate text-center text-[11px]">
                    添加智能体
                  </span>
                </button>
              </div>
            )}

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
              onClick={() => {
                setShowAttachMenu(false);
              }}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {activeConvId == null ? (
                  <p className="py-10 text-center text-sm text-[#9a9aa0]">
                    从左侧选择一个聊天，或点侧边栏底部的书写按钮新建一个聊天
                  </p>
                ) : messagesQuery.isPending ? (
                  <p className="py-10 text-center text-sm text-[#9a9aa0]">
                    加载中…
                  </p>
                ) : messagesQuery.isError ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-[#c0392b]">消息加载失败</p>
                    <button
                      type="button"
                      onClick={() => messagesQuery.refetch()}
                      className="mt-2 rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm"
                    >
                      重试
                    </button>
                  </div>
                ) : displayMessages.length === 0 ? (
                  <p className="py-10 text-center text-sm leading-relaxed text-[#9a9aa0]">
                    {!groupHasAgentMembers
                      ? "这里目前只有你一个人。点上方成员行末尾的「添加智能体」把智能体加进来，加进来的智能体才会回复你。"
                      : "暂无消息，在下方输入框发条消息吧"}
                  </p>
                ) : (
                  displayMessages.map((msg, i) => {
                    const prev = displayMessages[i - 1];
                    const showPill =
                      !prev ||
                      !sameDay(
                        new Date(prev.createdAt),
                        new Date(msg.createdAt),
                      );
                    return (
                      <div key={msg.id} className="flex flex-col gap-4">
                        {showPill && (
                          <div className="flex justify-center">
                            <span className="rounded-md bg-black/[0.08] px-2 py-0.5 text-[11px] text-[#6e6e73]">
                              {pillLabel(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <MessageRow
                          msg={msg}
                          profile={profile}
                          showUserName
                          showTime={profile.showTime}
                          museName={museSettings.name || "Muse"}
                          museColor={museSettings.color}
                          museAvatarUrl={museSettings.avatarUrl}
                          onPreviewImage={(url, name) =>
                            setPreviewImage({ url, name })
                          }
                        />
                      </div>
                    );
                  })
                )}
                {sending &&
                  groupHasEnabledMembers &&
                  !serverMessages.some((m) => m.streaming) && (
                  <TypingBubble
                    agent={
                      groupTypingAgent
                        ? {
                            name: groupTypingAgent.name,
                            color: groupTypingAgent.color,
                            glyph: groupTypingAgent.glyph,
                            avatarUrl: groupTypingAgent.avatarUrl,
                            provider: groupTypingAgent.provider,
                            connectionType: groupTypingAgent.connectionType,
                            configured: groupTypingAgent.configured,
                          }
                        : null
                    }
                    name={groupTypingName}
                    museColor={museSettings.color}
                    museAvatarUrl={museSettings.avatarUrl}
                  />
                )}
              </div>
            </div>

            {/* input area */}
            <div className="relative px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-4">
              <div className="mx-auto max-w-3xl">
                {sendError && (
                  <div
                    role="alert"
                    className={`mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13px] ${
                      sendSilent
                        ? "bg-black/[0.06] text-[#6e6e73]"
                        : "bg-[#fdecec] text-[#b3261e]"
                    }`}
                  >
                    <span className="min-w-0">{sendError}</span>
                    {!sendSilent && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={sending}
                        className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-medium shadow-sm disabled:opacity-50"
                      >
                        重试
                      </button>
                    )}
                  </div>
                )}
                <div className="rounded-[18px] bg-white px-2.5 pt-1.5 pb-1 shadow-[0_2px_12px_rgba(0,0,0,0.07)]">
                  {pendingImage && (
                    <div className="relative mb-1 inline-block">
                      <img
                        src={pendingImage.preview}
                        alt="待发送的图片"
                        className="max-h-28 rounded-lg object-contain"
                      />
                      <button
                        type="button"
                        aria-label="移除待发送图片"
                        onClick={() => setPendingImage(null)}
                        className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                      >
                        <Icon d={PATHS.x} size={13} />
                      </button>
                    </div>
                  )}
                  {pendingFile && (
                    <div className="relative mb-1 inline-flex">
                      <AttachmentChip
                        name={pendingFile.fileName}
                        size={pendingFile.size}
                      />
                      <button
                        type="button"
                        aria-label="移除待发送文件"
                        onClick={() => setPendingFile(null)}
                        className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                      >
                        <Icon d={PATHS.x} size={13} />
                      </button>
                    </div>
                  )}
                  <label htmlFor="chat-input" className="sr-only">
                    {`发送到 ${activeTitle}`}
                  </label>
                  <textarea
                    id="chat-input"
                    {...FIELDS.sendMessage.text}
                    ref={textareaRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={`发送到 ${activeTitle}`}
                    rows={1}
                    className="max-h-32 min-h-[38px] w-full resize-none bg-transparent px-1 pt-1 text-[15px] outline-none placeholder:text-[#b0b0b5]"
                  />
                  {webToolbarAgent && activeConvId != null && (
                    <WebComposerToolbar
                      agent={webToolbarAgent}
                      candidates={webToolbarCandidates}
                      pickedId={webToolbarPick ?? null}
                      onPick={(agentId) =>
                        setWebToolbarPickByConv((prev) => ({
                          ...prev,
                          [activeConvId]: agentId,
                        }))
                      }
                      onOpenSkills={() => {
                        setSettingsInitialPage("skills");
                        setShowSettings(true);
                      }}
                      onNotice={(msg) => setToast(msg)}
                    />
                  )}
                  <div className="relative flex items-center justify-end gap-0.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      aria-label="选择要发送的图片"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePickImage(f);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={genericFileInputRef}
                      type="file"
                      aria-label="选择要发送的文件"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePickFile(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="发送图片或文件"
                        aria-expanded={showAttachMenu}
                        onClick={() => setShowAttachMenu((v) => !v)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-[#5a5a5e] transition-colors hover:bg-black/[0.05]"
                      >
                        <Icon d={PATHS.camera} size={20} />
                      </button>
                      {showAttachMenu && (
                        <div className="absolute right-0 bottom-12 z-30 w-44 rounded-xl bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.14)]">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAttachMenu(false);
                              fileInputRef.current?.click();
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-black/[0.04]"
                          >
                            <Icon d={PATHS.image} size={18} />
                            发送图片
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAttachMenu(false);
                              genericFileInputRef.current?.click();
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-black/[0.04]"
                          >
                            <Icon d={PATHS.file} size={18} />
                            发送文件
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="发送"
                      onClick={handleSend}
                      disabled={
                        sending || (!draft.trim() && !pendingImage && !pendingFile)
                      }
                      className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#95ec69] text-[#1a4300] shadow-sm transition-all hover:bg-[#86e257] disabled:cursor-not-allowed disabled:bg-black/[0.08] disabled:text-[#9a9aa0] disabled:shadow-none"
                    >
                      <Icon d={PATHS.send} size={17} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ---------- agent settings panel (add / edit) ---------- */}
      {agentPanel && (
        <AgentPanel
          key={
            agentPanel.agent
              ? `edit-${agentPanel.agent.id}`
              : `new-${agentPanelNonce}`
          }
          initial={agentPanel.agent}
          onClose={() => setAgentPanel(null)}
          onDeleted={(agentId) => {
            setAgentPanel(null);
            // The deleted agent's conversations are gone server-side:
            // if the room currently open belongs to it, close that
            // room too instead of leaving a dead chat on screen.
            const openIsDeletedAgent =
              (tempConv != null && tempConv.agentId === agentId) ||
              conversations.some(
                (c) => c.id === selectedId && c.agentId === agentId,
              );
            if (tempConv != null && tempConv.agentId === agentId) {
              setTempRoom(null);
              try {
                window.sessionStorage.removeItem("draft-room-id");
              } catch {
                // storage unavailable: nothing else to clean up
              }
            }
            if (openIsDeletedAgent) {
              setSelectedId(null);
              setMobileDetail(false);
            }
          }}
          onSaved={(agentId, conversationId) => {
            setAgentPanel(null);
            if (conversationId != null) {
              // A new agent's first room is provisional like any
              // other fresh room: it is saved only once the user
              // sends something in it.
              setSection("agents");
              openTempRoom(conversationId, {
                title:
                  agents.find((a) => a.id === agentId)?.name || "智能体",
                agentId,
                memberAgentIds: [agentId],
                museMember: false,
              });
            }
          }}
        />
      )}

      {/* ---------- my profile panel ---------- */}
      {showProfile && (
        <ProfilePanel
          key={`${profile.name}|${profile.glyph}|${profile.color}`}
          initial={profile}
          onClose={() => setShowProfile(false)}
        />
      )}

      {/* ---------- Muse settings panel ---------- */}
      {showMuseSettings && (
        <MusePanel
          key={`${museSettings.name}|${museSettings.role}|${museSettings.color}|${museSettings.thinking}|${museSettings.enabled}`}
          initial={museSettings}
          onClose={() => setShowMuseSettings(false)}
        />
      )}

      {/* ---------- space settings panel ---------- */}
      {showSettings && (
        <SettingsPanel
          key={settingsInitialPage}
          profile={profile}
          onClose={() => setShowSettings(false)}
          backRef={settingsBackRef}
          initialPage={settingsInitialPage}
        />
      )}

      {/* ---------- room member management panel ---------- */}
      {showMembers && activeConvId != null && (
        <GroupMembersPanel
          conversationId={activeConvId}
          title={activeTitle}
          profile={profile}
          agents={agents}
          members={groupMembers}
          muse={museSettings}
          onClose={() => setShowMembers(false)}
        />
      )}

      {/* ---------- room settings panel ---------- */}
      {groupSettingsConv && (
        <GroupSettingsPanel
          key={`${groupSettingsConv.id}|${groupSettingsConv.title}|${groupSettingsConv.iconColor}|${groupSettingsConv.iconGlyph}`}
          conv={groupSettingsConv}
          onClose={() => setGroupSettingsConv(null)}
        />
      )}

      {/* ---------- conversation long-press action sheet ---------- */}
      {chatSheetConv && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setChatSheetConv(null)}
          />
          <div
            role="menu"
            aria-label={`聊天操作 ${recentChatName(chatSheetConv)}`}
            className="relative w-full max-w-md px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
              <p className="truncate px-4 pt-3 pb-1 text-center text-[13px] text-[#9a9aa0]">
                {recentChatName(chatSheetConv)}
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => beginRename(chatSheetConv)}
                className="flex w-full items-center justify-center px-4 py-3 text-[15px] text-[#191919] transition-colors hover:bg-black/[0.04] active:bg-black/[0.06]"
              >
                重命名
              </button>
              <div className="mx-4 border-t border-black/[0.05]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = chatSheetConv.id;
                  setChatSheetConv(null);
                  deleteConversationMutation.mutate(id);
                }}
                className="flex w-full items-center justify-center px-4 py-3 text-[15px] font-medium text-[#e5484d] transition-colors hover:bg-black/[0.04] active:bg-black/[0.06]"
              >
                删除
              </button>
            </div>
            <button
              type="button"
              onClick={() => setChatSheetConv(null)}
              className="mt-2 flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-[15px] font-medium text-[#191919] shadow-xl transition-colors hover:bg-black/[0.04] active:bg-black/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ---------- conversation rename dialog ---------- */}
      {renameConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setRenameConv(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="重命名聊天"
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold">重命名聊天</h2>
            <input
              {...FIELDS.renameConversation.title}
              aria-label="聊天名称"
              value={renameTitle}
              autoFocus
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
              }}
              className="mt-3 w-full rounded-[10px] bg-[#f0f0f2] px-3 py-2.5 text-[15px] outline-none placeholder:text-[#9a9aa0]"
              placeholder="输入新的名称"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRenameConv(null)}
                className="flex-1 rounded-full bg-black/[0.05] px-4 py-2.5 text-[15px] font-medium text-[#191919] transition-colors hover:bg-black/[0.08]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={
                  renameConversationMutation.isPending ||
                  renameTitle.trim() === ""
                }
                className="flex-1 rounded-full bg-[#2f6bff] px-4 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#2a5fe0] disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- full-screen image preview ---------- */}
      {previewImage && (
        <ImageLightbox
          url={previewImage.url}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}

      {/* ---------- toast ---------- */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
