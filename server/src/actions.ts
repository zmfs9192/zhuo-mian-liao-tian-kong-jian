// Actions for 桌面聊天空间 — a desktop-style chat with a single agent, Muse.
//
// Conversations and messages persist in ctx.db. Muse's replies are real:
// sendMessage / retryReply call ctx.inference.complete (the platform's
// built-in Muse channel) with the full conversation history as context.
// No canned replies anywhere.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
type SpaceDb,
} from "@hatch/space-sdk";
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { privileged } from "@space/privileged";
import * as schema from "./schema";
import {
PROMPT_TAG_INITIAL_ROOT,
type PromptTagSeed,
} from "./promptTagsData";

const GREETING =
  "你好，我是 Muse。这个空间里暂时只有我一个智能体，想聊什么、需要帮忙做什么，直接发给我就行。";

const SYSTEM_PROMPT =
  "你是 Muse，正在一个桌面聊天空间里和用户一对一聊天。用自然、友好的语气回复；用户用中文时用中文，用户用其他语言时跟随用户的语言。回复长度贴合聊天场景：日常对话简短些，需要讲解时可以详细，但像即时通讯里真人打字一样自然，不要动不动用标题和大段列表堆砌。";

const attachmentOut = z.object({
  name: z.string(),
  size: z.number().nullable(),
  mimeType: z.string().nullable(),
  url: z.string().nullable(),
  isImage: z.boolean(),
});

const messageOut = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  // True while this assistant reply is still streaming in: the
  // content is the partial text so far and keeps growing until
  // the reply lands in full.
  streaming: z.boolean(),
  imageUrl: z.string().nullable(),
  attachment: attachmentOut.nullable(),
  createdAt: z.string(),
  // The id of the agent that sent an assistant message (null =
  // Muse, the fixed platform agent; also null on user messages).
  // The client matches replies to room members by this id — e.g.
  // the typing bubble names the member whose reply is actually
  // being generated, which needs the sender's identity, not just
  // its display facts.
  agentId: z.number().nullable(),
  // Display facts of the agent that sent an assistant message (null =
  // Muse, the fixed platform agent). Resolved from the agent row at
  // read time, so renames/recolors apply to past messages too.
  agent: z
    .object({
      name: z.string(),
      color: z.string(),
      glyph: z.string(),
      avatarUrl: z.string().nullable(),
      // The sender's vendor identity + whether it is successfully
      // set up: together with glyph/color these decide whether the
      // avatar shows the vendor's official logo (see the client's
      // vendorLogoFor).
      provider: z.string(),
      connectionType: z.string(),
      configured: z.boolean(),
    })
    .nullable(),
});

type MessageRow = typeof schema.messages.$inferSelect;

/** Fallback display name for attachments saved before names were recorded. */
function fallbackFileName(mimeType: string | null): string {
  if (mimeType === "image/png") return "图片.png";
  if (mimeType === "image/jpeg") return "图片.jpg";
  if (mimeType && mimeType.startsWith("image/")) return "图片";
  return "文件";
}

/** The conversation-list preview for a message whose content is
 * empty because it carries an attachment: [图片] / [视频] /
 * [文件] 名， by the attachment's real type. */
function attachmentPreview(row: {
  imageBlobKey: string | null;
  fileMime: string | null;
  fileName: string | null;
}): string {
  if (!row.imageBlobKey) return "";
  if (row.fileMime && row.fileMime.startsWith("video/")) return "[视频]";
  if (row.fileMime && row.fileMime.startsWith("audio/")) return "[音频]";
  if (row.fileMime && !row.fileMime.startsWith("image/"))
    return `[文件] ${row.fileName ?? "文件"}`;
  return "[图片]";
}

type AgentDisplay = {
name: string;
color: string;
glyph: string;
avatarUrl: string | null;
provider: string;
connectionType: string;
configured: boolean;
};

/* ---------------- avatar images ---------------- */

// The avatar-image fields every settings payload accepts: a newly
// picked image (already centre-cropped to a square JPEG/PNG by the
// client, so the payload stays small), or removeAvatar to clear the
// stored image and fall back to the colour + glyph avatar. Both
// absent = keep whatever is stored.
const avatarImageInput = z
.object({
dataBase64: z.string().min(1).max(3000000),
mimeType: z.enum(["image/jpeg", "image/png"]),
})
.nullish();
const avatarFields = {
avatarImage: avatarImageInput,
removeAvatar: z.boolean().optional().default(false),
};

/** Resolves a stored avatar blob key to its display URL. */
async function resolveAvatarUrl(
ctx: Ctx,
key: string | null | undefined,
): Promise<string | null> {
if (!key) return null;
try {
return await ctx.blobs.getUrl(key);
} catch {
return null;
}
}

/**
 * Applies one settings save's avatar change: a new image is stored
 * as a blob and its key returned; removeAvatar clears to null;
 * otherwise the current key is kept untouched.
 */
async function applyAvatarChange(
ctx: Ctx,
currentKey: string | null | undefined,
image: { dataBase64: string; mimeType: string } | null | undefined,
remove: boolean | undefined,
folder: string,
): Promise<string | null> {
if (image) {
const binary = atob(image.dataBase64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const key = `avatars/${folder}/${Date.now()}-${Math.random()
.toString(36)
.slice(2, 10)}`;
await ctx.blobs.put(key, bytes, { contentType: image.mimeType });
return key;
}
if (remove) return null;
return currentKey ?? null;
}

async function toMessageOut(
  ctx: Ctx,
  row: MessageRow,
  agentDisplay: AgentDisplay | null = null,
): Promise<z.infer<typeof messageOut>> {
  let imageUrl: string | null = null;
  let attachment: z.infer<typeof attachmentOut> | null = null;
  if (row.imageBlobKey) {
    let url: string | null = null;
    try {
      url = await ctx.blobs.getUrl(row.imageBlobKey);
    } catch {
      url = null;
    }
    // Rows saved before file metadata existed are all chat images.
    const isImage = row.fileMime
      ? row.fileMime.startsWith("image/")
      : true;
    if (isImage) imageUrl = url;
    attachment = {
      name: row.fileName ?? fallbackFileName(row.fileMime),
      size: row.fileSize,
      mimeType: row.fileMime,
      url,
      isImage,
    };
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    // A streaming row older than five minutes was abandoned by a
    // generation that never finished (its action died mid-stream);
    // it no longer counts as streaming, so the client stops
    // polling for it and shows the partial text as-is.
    streaming:
      row.streaming === 1 &&
      Date.now() - row.createdAt.getTime() < 5 * 60_000,
    imageUrl,
    attachment,
    createdAt: row.createdAt.toISOString(),
    agentId: row.role === "assistant" ? row.agentId : null,
    agent: row.role === "assistant" ? agentDisplay : null,
  };
}

type Db = SpaceDb<typeof schema>;

/** Creates the single starter conversation (with Muse's greeting) once.
 * Like every chat window it is a room: member-based, with Muse as
 * its sole agent member. */
async function ensureStarterConversation(db: Db): Promise<void> {
  const existing = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .limit(1);
  if (existing.length > 0) return;
  const inserted = await db
    .insert(schema.conversations)
    .values({ title: "Muse", memberBased: 1 })
    .returning({ id: schema.conversations.id });
  const conv = inserted[0];
  if (!conv) return;
  await db.insert(schema.groupMembers).values({
    conversationId: conv.id,
    agentId: null,
  });
  await db.insert(schema.messages).values({
    conversationId: conv.id,
    role: "assistant",
    content: GREETING,
  });
}

async function loadHistory(db: Db, conversationId: number) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .limit(60);
}

/* ---------------- chat images: one real image channel ----------------
 * A picture the user sends in the chat box is an IMAGE, not text:
 * it must reach every replying agent through that agent's own
 * image channel — Muse through the platform vision input, an
 * API agent as an OpenAI-style image_url content part, and a
 * web-token agent through its site's own upload flow (DeepSeek
 * vision upload, ChatGPT files, Claude wiggle upload, Gemini
 * Scotty upload, Mistral image parts) — never flattened into a
 * "（发送了一张图片）" text placeholder for the agent that is
 * supposed to look at it. ChatImage is the one shape every
 * channel consumes: the image bytes of ONE user message (the
 * latest turn's picture), identified by that message's id so
 * history builders attach it to exactly its own turn. 豆包's
 * token channel is text-only and its web version cannot open
 * external links, so it has no image route at all — the
 * public-image-host relay tried for it was removed at the
 * user's direction (2026-11-21). Web sites whose upload flow the
 * space has not connected yet (千问 / Grok / Kimi / 智谱 /
 * 元宝 / 文心） do NOT receive a text-flattened substitute
 * either: produceReply refuses the image turn for them with
 * the real reason (see webImageGateError), so nobody pretends
 * to have seen a picture it never received. */
type ChatImage = {
  dataBase64: string;
  mimeType: string;
  fileName: string;
  messageId: number;
};

/** The image attached to the LAST user message of a history, read
 * back from the space's blob store (the retry path has no send
 * payload to take the bytes from). Only the last user message's
 * own picture counts — an older picture is context, not the turn
 * being answered. Returns null when that message carries no
 * image, the blob is unreadable, or the payload is implausible. */
async function loadLatestChatImage(
  ctx: Ctx,
  history: MessageRow[],
): Promise<ChatImage | null> {
  const lastUser = [...history].reverse().find((r) => r.role === "user");
  if (!lastUser?.imageBlobKey) return null;
  const mime = lastUser.fileMime ?? "";
  if (!mime.startsWith("image/")) return null;
  try {
    const read = await ctx.executePrivileged(privileged.readBlobBytes, {
      key: lastUser.imageBlobKey,
    });
    if (!read.ok || !read.dataBase64) return null;
    // ~14MB of base64 ≈ 10MB of image — the composer's own cap.
    if (read.dataBase64.length > 14_000_000) return null;
    return {
      dataBase64: read.dataBase64,
      mimeType: read.contentType || mime,
      fileName: lastUser.fileName ?? fallbackFileName(mime),
      messageId: lastUser.id,
    };
  } catch {
    return null;
  }
}

/** Why an image turn is refused for a web agent whose site's
 * upload flow is not connected: the picture stays saved in the
 * room, text turns are unaffected, and nothing is sent to the
 * site as fake text. */
function webImageGateError(label: string, provider: string): string {
  return (
    `${label}这次没有收到图片：${webSiteLabel(provider)}网页版的图片上传通道空间还没有打通，` +
    `这条消息没有改走纯文字发给它。图片已经保存在这个聊天里，文字消息不受影响；` +
    `要让它看图，可以把图片发到支持图片通道的智能体（Muse、API 智能体，以及 DeepSeek / ChatGPT / Claude / Gemini / Mistral 网页版）的房间里。`
  );
}

/** The web providers whose chat adapters carry a real image
 * upload (see each adapter): the image rides the site's own
 * flow and the model really receives the picture. DeepSeek is
 * handled on its own path (callDeepseekWeb's vision upload). */
const WEB_IMAGE_PROVIDERS = new Set(["chatgpt", "claude", "gemini", "mistral"]);

/** Resolves a message sender's display name: null agent id = Muse. */
type NameOf = (agentId: number | null) => string;

type MuseSettingsRow = typeof schema.museSettings.$inferSelect;

/** Loads Muse's own settings row, creating the singleton on first use. */
async function loadMuseSettings(db: Db): Promise<MuseSettingsRow> {
  const rows = await db
    .select()
    .from(schema.museSettings)
    .where(eq(schema.museSettings.id, 1));
  const existing = rows[0];
  if (existing) return existing;
  await db.insert(schema.museSettings).values({ id: 1 });
  const again = await db
    .select()
    .from(schema.museSettings)
    .where(eq(schema.museSettings.id, 1));
  const row = again[0];
  if (!row) throw new Error("loadMuseSettings: failed to create settings row");
  return row;
}

async function loadNameOf(db: Db): Promise<NameOf> {
  const rows = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents);
  const map = new Map(rows.map((r) => [r.id, r.name || "智能体"]));
  const muse = await loadMuseSettings(db);
  const museName = muse.name.trim() || "Muse";
  return (agentId) =>
    agentId == null ? museName : (map.get(agentId) ?? "智能体");
}

/** Asks the platform Muse channel for the next reply given full history. */
async function generateReply(
  ctx: Ctx,
  history: MessageRow[],
  lastImage?: { dataBase64: string; mimeType: string } | null,
  nameOf: NameOf = (agentId) => (agentId == null ? "Muse" : "智能体"),
  filesContext = "",
  globalInstructions = "",
  stageContext = "",
  hostContext = "",
): Promise<string> {
  const transcript = history
    .map((m) => {
      const who = m.role === "user" ? "用户" : nameOf(m.agentId);
      const body = m.content
        ? m.content
        : m.imageBlobKey
          ? m.fileMime && m.fileMime.startsWith("video/")
            ? "（发送了一段视频）"
            : m.fileMime && m.fileMime.startsWith("audio/")
              ? "（发送了一段音频）"
              : m.fileMime && !m.fileMime.startsWith("image/")
                ? `（发送了文件：${m.fileName ?? "文件"}）`
                : "（发送了一张图片）"
          : "";
      return `${who}：${body}`;
    })
    .join("\n");
  const muse = await loadMuseSettings(ctx.db<typeof schema>());
  const museName = muse.name.trim() || "Muse";
  const prompt =
    `以下是你和用户在这个聊天会话里的完整记录，请接着以 ${museName} 的身份回复用户的最后一条消息。\n\n` +
    transcript;
  const museStanding = standingInstructions(muse.systemPrompt, muse.memory);
  const system =
    SYSTEM_PROMPT +
    (muse.role.trim()
      ? `\n\n你在这个空间里的角色是：${muse.role.trim()}`
      : "") +
    (museStanding
      ? `\n\n用户为你设定的补充要求：\n${museStanding}`
      : "") +
    (globalInstructions
      ? `\n\n用户为这个空间里的所有智能体设定的全局自定义指令（对每个智能体都生效，请遵守）：\n${globalInstructions}`
      : "") +
    // Shared-room conduct, same framing the added agents get:
    // only when another member has actually spoken here.
    (history.some((m) => m.role === "assistant" && m.agentId != null)
      ? `\n\n${ROOM_CONDUCT}`
      : "") +
    (stageContext ? `\n\n${stageContext}` : "") +
    thinkingInstruction(muse.thinking) +
    (filesContext ? `\n\n${filesContext}` : "") +
    (hostContext ? `\n\n${hostContext}` : "");
  const result = await ctx.inference.complete(prompt, {
    system,
    schema: z.object({ reply: z.string() }),
    timeout_secs: 120,
    ...(lastImage
      ? {
          images: [
            {
              dataBase64: lastImage.dataBase64,
              mimeType: lastImage.mimeType as "image/jpeg" | "image/png",
            },
          ],
        }
      : {}),
  });
  const reply = result.reply.trim();
  if (!reply) throw new Error("Muse 返回了空回复");
  return reply;
}

async function touchConversation(db: Db, conversationId: number) {
  await db
    .update(schema.conversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}

/* ---------------- space files ---------------- */

// Text-type files are the ones agents may actually read and edit
// when the user switches their access on; everything else is
// metadata-only for agents (name / type / size), never content.
const TEXT_FILE_EXTS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "log", "xml", "html",
  "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "java", "c",
  "h", "cpp", "sh", "yaml", "yml", "toml", "ini", "sql", "text",
]);
const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
]);

/** Image files (by MIME) sit outside the agent-access system
 * entirely (decided 2026-11-21): they carry no access switch in
 * the files column, batch permission operations skip them, and
 * they never enter the agent files context — agents see chat
 * images through the conversation itself, not this channel. */
function isImageMime(mime: string | null | undefined): boolean {
  return (mime ?? "").startsWith("image/");
}

function isTextFile(name: string, mime: string | null): boolean {
  if (mime) {
    if (mime.startsWith("text/")) return true;
    if (TEXT_MIMES.has(mime)) return true;
    if (
      mime.startsWith("image/") ||
      mime.startsWith("audio/") ||
      mime.startsWith("video/") ||
      mime === "application/pdf" ||
      mime === "application/zip" ||
      mime.startsWith("application/vnd.")
    ) {
      return false;
    }
  }
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return TEXT_FILE_EXTS.has(ext);
}

// Text content is captured into file_texts when a file enters the
// space (upload or chat send), capped so a huge file cannot bloat
// the database; bigger text files keep metadata only. The cap sits
// just under the 10MB upload limit so ordinary text files — a
// multi-MB JSON export included — are captured in full; at 1MB a
// 6.3MB JSON silently degraded to name-only for agents, which is
// what this raise fixes. Files already stored without a captured
// copy re-capture through readFileText's blob fallback under the
// same cap the first time an agent (or a preview) reads them.
const MAX_STORED_TEXT_BYTES = 8_000_000;

async function storeFileText(
  db: Db,
  blobKey: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.length > MAX_STORED_TEXT_BYTES) return;
  try {
    const content = new TextDecoder("utf-8").decode(bytes);
    await db
      .insert(schema.fileTexts)
      .values({ blobKey, content })
      .onConflictDoUpdate({
        target: schema.fileTexts.blobKey,
        set: { content },
      });
  } catch {
    // Undecodable bytes: leave the file metadata-only.
  }
}

/** Deletes one file from the space (the single-file delete and
 * the files column's batch delete share this): an upload loses
 * its row, blob and captured text; a chat file's message is
 * deleted along with its blob, so it disappears from its
 * conversation too. Returns whether a row was actually removed. */
async function deleteOneFile(
  ctx: Ctx,
  db: Db,
  source: "upload" | "chat",
  id: number,
): Promise<boolean> {
  if (source === "upload") {
    const rows = await db
      .select()
      .from(schema.spaceFiles)
      .where(eq(schema.spaceFiles.id, id));
    const f = rows[0];
    if (!f) return false;
    try {
      await ctx.blobs.delete(f.blobKey);
    } catch {
      // Blob already gone; the row still goes.
    }
    await db
      .delete(schema.fileTexts)
      .where(eq(schema.fileTexts.blobKey, f.blobKey));
    await db.delete(schema.spaceFiles).where(eq(schema.spaceFiles.id, id));
    return true;
  }
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, id));
  const m = rows[0];
  if (!m) return false;
  if (m.imageBlobKey) {
    try {
      await ctx.blobs.delete(m.imageBlobKey);
    } catch {
      // Blob already gone; the message still goes.
    }
    await db
      .delete(schema.fileTexts)
      .where(eq(schema.fileTexts.blobKey, m.imageBlobKey));
  }
  await db.delete(schema.messages).where(eq(schema.messages.id, id));
  return true;
}

/** ISO string for a stored timestamp that can never throw: one
 * corrupt row must not fail a whole list response. */
function safeIso(d: Date): string {
  return Number.isNaN(d.getTime())
    ? new Date(0).toISOString()
    : d.toISOString();
}

/** A text file's current content: the captured copy first; as a
 * fallback for files that predate capture, a best-effort read of
 * the blob URL (which the server runtime may or may not serve). */
async function readFileText(
  ctx: Ctx,
  db: Db,
  blobKey: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.fileTexts)
    .where(eq(schema.fileTexts.blobKey, blobKey));
  if (rows[0]) return rows[0].content;
  try {
    const url = await ctx.blobs.getUrl(blobKey);
    const res = await fetch(url);
    if (res.ok) {
      const content = await res.text();
      if (content.length <= MAX_STORED_TEXT_BYTES) {
        await db
          .insert(schema.fileTexts)
          .values({ blobKey, content })
          .onConflictDoUpdate({
            target: schema.fileTexts.blobKey,
            set: { content },
          });
      }
      return content;
    }
  } catch {
    // Blob bytes are not readable from the server runtime.
  }
  return null;
}

function formatBytesForPrompt(size: number | null): string {
  if (size == null) return "大小未知";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type AgentFileRef = { source: "upload" | "chat"; id: number };

/**
 * The file context handed to every replying agent: exactly the
 * files whose per-file access switch is on — nothing else about
 * the space's files is revealed. Text files carry their content
 * (capped per file and in total) plus the edit-block protocol;
 * non-text files are listed by name / type / size only.
 */
async function buildAgentFilesContext(ctx: Ctx, db: Db): Promise<string> {
  const uploads = await db
    .select()
    .from(schema.spaceFiles)
    .where(eq(schema.spaceFiles.agentAccess, 1))
    .orderBy(desc(schema.spaceFiles.id));
  // 代码区 documents carry their own per-document switch with
  // exactly the same meaning; granted ones join this context
  // with ref=code:<id> and the same edit-back protocol.
  const codeRows = await db
    .select()
    .from(schema.codeFiles)
    .where(eq(schema.codeFiles.agentAccess, 1))
    .orderBy(asc(schema.codeFiles.id));
  const chatRows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        isNotNull(schema.messages.imageBlobKey),
        eq(schema.messages.agentAccess, 1),
      ),
    )
    .orderBy(desc(schema.messages.id));
  if (uploads.length === 0 && chatRows.length === 0 && codeRows.length === 0)
    return "";
  const convs = await db
    .select({ id: schema.conversations.id, title: schema.conversations.title })
    .from(schema.conversations);
  const convTitle = new Map(convs.map((c) => [c.id, c.title]));
  const textParts: string[] = [];
  const metaParts: string[] = [];
  let budget = 120000;
  const addText = async (
    ref: AgentFileRef,
    name: string,
    size: number | null,
    mime: string | null,
    blobKey: string,
    origin: string,
  ) => {
    const content = await readFileText(ctx, db, blobKey);
    const refStr = `${ref.source}:${ref.id}`;
    if (content == null) {
      metaParts.push(
        `《${name}》（${mime || "未知类型"}，${formatBytesForPrompt(size)}，来源：${origin}；文本内容暂时无法读取）`,
      );
      return;
    }
    if (budget <= 0) {
      metaParts.push(
        `《${name}》（${mime || "未知类型"}，${formatBytesForPrompt(size)}，来源：${origin}；内容未附上，授权文件较多）`,
      );
      return;
    }
    const cap = Math.min(60000, budget);
    const shown =
      content.length > cap
        ? `${content.slice(0, cap)}\n…（文件共 ${content.length} 字，内容过长，已截断为前 ${cap} 字）`
        : content;
    budget -= shown.length;
    textParts.push(
      `[ref=${refStr}]《${name}》（${formatBytesForPrompt(size)}，来源：${origin}）\n文件内容：\n${shown}`,
    );
  };
  for (const f of uploads) {
    if (isImageMime(f.mime)) continue;
    if (isTextFile(f.name, f.mime)) {
      await addText(
        { source: "upload", id: f.id },
        f.name || "未命名文件",
        f.size,
        f.mime,
        f.blobKey,
        "文件栏上传",
      );
    } else {
      metaParts.push(
        `《${f.name || "未命名文件"}》（${f.mime || "未知类型"}，${formatBytesForPrompt(f.size)}，来源：文件栏上传）`,
      );
    }
  }
  for (const m of chatRows) {
    if (isImageMime(m.fileMime)) continue;
    const name = m.fileName ?? fallbackFileName(m.fileMime);
    const origin = `聊天「${convTitle.get(m.conversationId) ?? "对话"}」`;
    if (isTextFile(name, m.fileMime) && m.imageBlobKey) {
      await addText(
        { source: "chat", id: m.id },
        name,
        m.fileSize,
        m.fileMime,
        m.imageBlobKey,
        origin,
      );
    } else {
      metaParts.push(
        `《${name}》（${m.fileMime || "未知类型"}，${formatBytesForPrompt(m.fileSize)}，来源：${origin}）`,
      );
    }
  }
  for (const cf of codeRows) {
    const name = cf.name || "未命名代码";
    const size = new TextEncoder().encode(cf.content).length;
    if (budget <= 0) {
      metaParts.push(
        `《${name}》（代码，${formatBytesForPrompt(size)}，来源：代码区；内容未附上，授权内容较多）`,
      );
      continue;
    }
    const cap = Math.min(60000, budget);
    const shown =
      cf.content.length > cap
        ? `${cf.content.slice(0, cap)}\n…（这份代码共 ${cf.content.length} 字，内容过长，已截断为前 ${cap} 字）`
        : cf.content;
    budget -= shown.length;
    textParts.push(
      `[ref=code:${cf.id}]《${name}》（${cf.language || "纯文本"}代码，${formatBytesForPrompt(size)}，来源：代码区）\n代码内容：\n${shown}`,
    );
  }
  const lines: string[] = [
    "【系统附带的文件资料 — 不是用户在对话中输入的消息，不要把这些内容说成是用户讲过的话】用户打开了下面这些文件 / 代码各自的访问开关（文件在文件栏、代码在代码区，每一份都有自己的开关），授权你浏览它们。没有列出的你看不到，不要假装知道它们的内容。",
  ];
  if (textParts.length > 0) {
    lines.push(
      "",
      "可以读取和修改的文本文件与代码：",
      ...textParts.map((p) => `\n${p}`),
    );
  }
  if (metaParts.length > 0) {
    lines.push(
      "",
      "只能看到基本信息、不能读取内容也不能修改的文件：",
      ...metaParts.map((p) => `- ${p}`),
    );
  }
  if (textParts.length > 0) {
    lines.push(
      "",
      "修改的规则：只有当用户明确要求你修改某个文本文件或某份代码时，才在回复的最后附上修改块（标记必须原样，不要改动），把修改后的完整内容放在标记之间：",
      "[[[FILE_EDIT ref=upload:文件编号]]]",
      "修改后的完整内容",
      "[[[/FILE_EDIT]]]",
      "ref 用上面方括号里给出的编号（upload:…、chat:… 或 code:…）。文本文件的修改会保存回原处；代码（code:…）的修改不会直接覆盖，会在代码区生成一份对比提案，由用户查看改动行后点接受才生效、点拒绝则丢弃。修改块都会从显示给用户的回复里移除。用户没有要求修改时不要输出修改块；不要修改上面没有列出的文件或代码。",
    );
  }
  return lines.join("\n");
}

const FILE_EDIT_RE =
  /\[\[\[FILE_EDIT ref=(upload|chat|code):(\d+)\]\]\]\r?\n?([\s\S]*?)\r?\n?\[\[\[\/FILE_EDIT\]\]\]/g;

/**
 * Applies the file-edit blocks an agent put in its reply: each
 * block names one access-granted text file, whose stored bytes and
 * captured text are replaced with the block's content. Blocks are
 * always stripped from the text shown to the user; a block naming
 * a missing, ungranted or non-text file is dropped unapplied.
 */
async function applyFileEdits(
  ctx: Ctx,
  db: Db,
  text: string,
): Promise<{ text: string; editedNames: string[] }> {
  const editedNames: string[] = [];
  let cleaned = text;
  const matches = [...text.matchAll(FILE_EDIT_RE)];
  if (matches.length === 0) return { text, editedNames };
  for (const match of matches) {
    const source = match[1] as "upload" | "chat" | "code";
    const id = Number(match[2]);
    const newContent = match[3] ?? "";
    let blobKey: string | null = null;
    let name = "";
    let mime: string | null = null;
    if (source === "code") {
      // 代码区 documents store their text on the row: a granted
      // document's content is replaced in place. An ungranted or
      // missing document drops the block unapplied, like files.
      const rows = await db
        .select()
        .from(schema.codeFiles)
        .where(eq(schema.codeFiles.id, id));
      const cf = rows[0];
      if (cf && cf.agentAccess === 1) {
        // Professional code workflow: a chat agent never overwrites
        // a code file directly. Its edit becomes a pending proposal
        // the user reviews in the code workspace's diff view and
        // accepts or rejects there.
        await db.insert(schema.codeAiProposals).values({
          fileId: cf.id,
          originalContent: cf.content,
          proposedContent: newContent,
          instruction: "聊天中智能体提出的修改（请在代码区对比后接受或拒绝）",
          source: "chat",
          status: "pending",
        });
        editedNames.push(`${cf.name || "未命名代码"}（修改已生成对比提案，待在代码区确认）`);
      }
      cleaned = cleaned.replace(match[0], "");
      continue;
    }
    if (source === "upload") {
      const rows = await db
        .select()
        .from(schema.spaceFiles)
        .where(eq(schema.spaceFiles.id, id));
      const f = rows[0];
      if (f && f.agentAccess === 1 && isTextFile(f.name, f.mime)) {
        blobKey = f.blobKey;
        name = f.name || "未命名文件";
        mime = f.mime;
      }
    } else {
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, id));
      const m = rows[0];
      const mName = m?.fileName ?? fallbackFileName(m?.fileMime ?? null);
      if (
        m &&
        m.imageBlobKey &&
        m.agentAccess === 1 &&
        isTextFile(mName, m.fileMime)
      ) {
        blobKey = m.imageBlobKey;
        name = mName;
        mime = m.fileMime;
      }
    }
    if (blobKey) {
      const bytes = new TextEncoder().encode(newContent);
      await ctx.blobs.put(blobKey, bytes, {
        contentType: mime || "text/plain",
      });
      await db
        .insert(schema.fileTexts)
        .values({ blobKey, content: newContent })
        .onConflictDoUpdate({
          target: schema.fileTexts.blobKey,
          set: { content: newContent },
        });
      if (source === "upload") {
        await db
          .update(schema.spaceFiles)
          .set({ size: bytes.length })
          .where(eq(schema.spaceFiles.id, id));
      } else {
        await db
          .update(schema.messages)
          .set({ fileSize: bytes.length })
          .where(eq(schema.messages.id, id));
      }
      editedNames.push(name);
    }
    cleaned = cleaned.replace(match[0], "");
  }
  cleaned = cleaned.trim();
  if (!cleaned) {
    cleaned =
      editedNames.length > 0
        ? `已按你的要求更新文件：${editedNames.join("、")}。`
        : "文件修改没有成功应用（文件不存在、未开启访问，或不是文本文件）。";
  }
  return { text: cleaned, editedNames };
}

/* ---------------- agent host permissions （主机权限） ----------------
 * Per-agent switches (agents / muse_settings: can_exec_linux,
 * can_edit_files), both off by default, granted by the user in
 * the agent's settings. Two real execution routes, by how the
 * agent talks:
 *   - API agents get native function tools (run_linux_command /
 *     list_host_files / read_host_file / write_host_file, see
 *     HOST_TOOLS below): the server executes the call and feeds
 *     the real result back into the same reply.
 *   - Web-token agents and Muse have no function-calling
 *     channel, so they use the block protocol described by
 *     buildHostPermissionContext: the reply may carry LINUX_CMD
 *     / HOST_FILE_WRITE blocks, which applyHostActions executes
 *     for real after the reply lands; the blocks are stripped
 *     from the shown text and the real outcomes are appended as
 *     a factual result section (which also enters the room
 *     history, so the agent sees what happened next turn).
 * Execution itself lives in the privileged layer, which scopes
 * file access to ~/workspace, ~/memory and /tmp and refuses
 * credential paths outright. Every execution path re-checks
 * the agent's own switch — a block or tool call from an agent
 * without the permission is dropped unexecuted. */
type HostPerms = { exec: boolean; edit: boolean };

function hostPermsOf(row: {
  canExecLinux: number;
  canEditFiles: number;
}): HostPerms {
  return { exec: row.canExecLinux === 1, edit: row.canEditFiles === 1 };
}

function buildHostPermissionContext(
  perms: HostPerms,
  viaBlocks: boolean,
): string {
  if (!perms.exec && !perms.edit) return "";
  const lines: string[] = [
    "【主机权限 — 用户已在你的设置里为你开启】下面这些能力是这台 Linux 主机上的真实能力，不是模拟：",
  ];
  if (viaBlocks) {
    if (perms.exec) {
      lines.push(
        "执行 Linux 命令：当用户要求你在这台主机上执行命令时，在回复最后附上命令块（标记必须原样），系统会真的执行（工作目录 ~/workspace，单条最长 30 秒），并把真实结果（退出码和输出）附在你的回复后面展示给用户，你下一轮也能在记录里看到结果：",
        "[[[LINUX_CMD]]]",
        "要执行的命令",
        "[[[/LINUX_CMD]]]",
        "如果你不用上面的命令块、改用普通的 ```bash 代码块给出命令也可以：空间会把代码块识别出来，用户点它右上角的「在本机运行」就会真的执行，真实结果同样会附在回复后面。",
      );
    }
    if (perms.edit) {
      lines.push(
        "编辑主机文件：当用户要求你新建或修改主机上的文本文件时，在回复最后附上写入块（标记必须原样，path 写文件的绝对路径），系统会真的把内容写入该文件：",
        "[[[HOST_FILE_WRITE path=/home/hatch/workspace/文件名]]]",
        "文件的完整新内容",
        "[[[/HOST_FILE_WRITE]]]",
        "可写范围：~/workspace、~/memory、/tmp 下的文件；.ssh、.aws、.env、密钥等敏感路径会被系统拒绝。读取文件可以用上面的命令能力（cat），或直接说明要看哪个文件。",
      );
    }
    lines.push(
      "用户没有明确要求执行命令或改文件时，不要输出这些块；块都会从显示给用户的回复里移除，执行结果由系统如实附上，不要自己编造执行结果。",
    );
  } else {
    if (perms.exec)
      lines.push(
        "你有 run_linux_command 工具：可以在这台主机上真的执行 Linux 命令（工作目录 ~/workspace，单条最长 30 秒），结果会发回给你继续回答。只在用户要求或任务确实需要时调用。",
      );
    if (perms.edit)
      lines.push(
        "你有 list_host_files / read_host_file / write_host_file 工具：可以真的列出、读取和写入这台主机 ~/workspace、~/memory、/tmp 下的文本文件（敏感凭证路径会被拒绝）。改文件前先读原文，写入的是完整新内容。",
      );
  }
  return lines.join("\n");
}

const LINUX_CMD_RE =
  /\[\[\[LINUX_CMD\]\]\]\r?\n?([\s\S]*?)\r?\n?\[\[\[\/LINUX_CMD\]\]\]/g;
const HOST_FILE_WRITE_RE =
  /\[\[\[HOST_FILE_WRITE path=([^\]]+)\]\]\]\r?\n?([\s\S]*?)\r?\n?\[\[\[\/HOST_FILE_WRITE\]\]\]/g;

/**
 * Executes the host blocks a web / platform agent put in its
 * reply (see buildHostPermissionContext): each LINUX_CMD block
 * runs for real through the privileged layer, each
 * HOST_FILE_WRITE block writes for real. Blocks are always
 * stripped from the shown text; the real outcomes are appended
 * as a result section. A block whose permission is off is
 * dropped unexecuted and that fact is stated in the section.
 */
async function applyHostActions(
  ctx: Ctx,
  text: string,
  perms: HostPerms,
): Promise<string> {
  const hasCmd = /\[\[\[LINUX_CMD\]\]\]/.test(text);
  const hasWrite = /\[\[\[HOST_FILE_WRITE[\s\]]/.test(text);
  if (!hasCmd && !hasWrite) return text;
  const results: string[] = [];
  let cleaned = text;
  if (hasCmd) {
    const matches = [...text.matchAll(LINUX_CMD_RE)];
    for (const match of matches) {
      const command = (match[1] ?? "").trim();
      cleaned = cleaned.replace(match[0], "");
      if (!command) continue;
      if (!perms.exec) {
        results.push(`命令未执行（该智能体没有开启「执行 Linux 命令」权限）：${command}`);
        continue;
      }
      const r = await ctx.executePrivileged(privileged.execLinuxCommand, {
        command,
        timeoutSecs: 30,
      });
      const out = [r.stdout.trim(), r.stderr.trim()]
        .filter((s) => s !== "")
        .join("\n");
      results.push(
        `命令：${command}\n退出码：${r.exitCode}${r.timedOut ? "（超时被终止）" : ""}${r.error ? `\n${r.error}` : ""}${out ? `\n输出：\n${out}` : "\n（无输出）"}`,
      );
    }
  }
  if (hasWrite) {
    const matches = [...cleaned.matchAll(HOST_FILE_WRITE_RE)];
    for (const match of matches) {
      const path = (match[1] ?? "").trim();
      const content = match[2] ?? "";
      cleaned = cleaned.replace(match[0], "");
      if (!path) continue;
      if (!perms.edit) {
        results.push(`文件未写入（该智能体没有开启「编辑主机文件」权限）：${path}`);
        continue;
      }
      const r = await ctx.executePrivileged(privileged.hostWriteFile, {
        path,
        content,
      });
      results.push(
        r.ok
          ? `已写入文件：${path}（${r.bytes} 字节）`
          : `写入文件失败：${path}——${r.error}`,
      );
    }
  }
  cleaned = cleaned.trim();
  const section =
    results.length > 0
      ? `—— 主机执行结果 ——\n${results.join("\n\n")}`
      : "";
  if (!cleaned) return section || "（已执行，见上方结果）";
  return section ? `${cleaned}\n\n${section}` : cleaned;
}

/* ---------------- printed-code detection （代码检测运行） ----------------
 * The fallback for the host-permission switches above: an agent
 * whose 「执行 Linux 命令」 permission is on, but whose provider
 * never invokes it (no tool call, no LINUX_CMD block), simply
 * prints the command / code as an ordinary fenced block in its
 * reply. The client detects those blocks with the same
 * line-based rules as parseFencedBlocks below, renders them as
 * code panels, and puts a 「在本机运行」 button at the panel's
 * top right whenever the reply has finished — with the sender's
 * exec switch off the tap explains the missing permission
 * inline instead of the button being absent (the user's
 * "代码无法点运行"); runMessageCodeBlock re-checks the switch
 * here and runs the picked block for real when it is on.
 * Detection rule, shared by both sides: a fenced block whose
 * language tag names a runnable language is code; everything
 * else — prose, untagged fences, json / text / html blocks —
 * is ordinary text (e.g. a prompt the user is meant to copy),
 * never code to run. Shell languages run through the same
 * privileged command executor as the permission itself;
 * JavaScript / TypeScript / Python run through the code
 * workspace's snippet runner. The sender's switch is
 * re-checked here on every run, and the real outcome is
 * appended to the stored reply (the same section style as
 * applyHostActions), so it stays in the room history and the
 * agent sees what happened on its next turn. */

type FencedBlock = { lang: string; code: string };

/** Extracts the fenced code blocks of a message, in order.
 * An unclosed trailing fence is not a block. The client parses
 * with identical rules, so a blockIndex means the same block
 * on both sides. */
function parseFencedBlocks(content: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let current: { lang: string; lines: string[] } | null = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (current == null) {
      const m = /^```([^`]*)$/.exec(line.trim());
      if (m) {
        current = {
          lang: (m[1] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "",
          lines: [],
        };
      }
    } else if (line.trim() === "```") {
      blocks.push({ lang: current.lang, code: current.lines.join("\n") });
      current = null;
    } else {
      current.lines.push(line);
    }
  }
  return blocks;
}

type RunnableTarget =
  | { kind: "shell" }
  | { kind: "code"; language: string; fileName: string };

/** Which runner a fenced block's language tag maps to, or null
 * when the block is not runnable code. The alias cases mirror
 * the client's SNIPPET_CODE_LANGS: agents (Doubao especially)
 * tag the same code py3 / nodejs / jsx / tsx at least as often
 * as the canonical names, and a block whose tag is missing
 * here gets no run button at all — the user's "代码无法点运行". */
function runnableTargetFor(lang: string): RunnableTarget | null {
  switch (lang) {
    case "bash":
    case "sh":
    case "shell":
    case "zsh":
      return { kind: "shell" };
    case "javascript":
    case "js":
    case "node":
    case "nodejs":
    case "node.js":
    case "mjs":
    case "cjs":
      return { kind: "code", language: "javascript", fileName: "main.js" };
    case "jsx":
      return { kind: "code", language: "javascript", fileName: "main.jsx" };
    case "typescript":
    case "ts":
      return { kind: "code", language: "typescript", fileName: "main.ts" };
    case "tsx":
      return { kind: "code", language: "typescript", fileName: "main.tsx" };
    case "python":
    case "python3":
    case "py":
    case "py3":
      return { kind: "code", language: "python", fileName: "main.py" };
    default:
      return null;
  }
}

/* ---------------- 代码快捷运行 (quick-run history) ----------------
 * The quick-run box at the top of the 代码 pane runs the newest
 * code recognised in the chat: every listQuickCode call first
 * re-scans the newest finished assistant replies for runnable
 * fenced blocks (parseFencedBlocks + runnableTargetFor — the
 * exact rules the chat's own code panels use) and records the
 * ones not yet recorded, newest message / last block first.
 * A singleton watermark (code_quick_state) remembers the
 * newest block ever recorded, so pruning can never make an
 * old block look new again; manual
 * rows come from addQuickCode when the user runs code they
 * typed into the box. The table never holds more than the
 * newest 10 rows — pruneQuickCode deletes the rest on every
 * write, as the user asked （超过10条的删除）. */

const quickCodeItem = z.object({
id: z.number(),
language: z.string(),
code: z.string(),
source: z.string(),
sourceLabel: z.string(),
createdAt: z.string(),
});
const quickCodeListResponse = z.object({
items: z.array(quickCodeItem),
});

async function pruneQuickCode(ctx: Ctx): Promise<void> {
const db = ctx.db<typeof schema>();
const keep = await db
.select({ id: schema.codeQuickRuns.id })
.from(schema.codeQuickRuns)
.orderBy(desc(schema.codeQuickRuns.id))
.limit(10);
const keepIds = new Set(keep.map((r) => r.id));
const all = await db
.select({ id: schema.codeQuickRuns.id })
.from(schema.codeQuickRuns);
for (const row of all) {
if (!keepIds.has(row.id)) {
await db
.delete(schema.codeQuickRuns)
.where(eq(schema.codeQuickRuns.id, row.id));
}
}
}

async function syncQuickCodeFromChat(ctx: Ctx): Promise<void> {
const db = ctx.db<typeof schema>();
// The watermark is the dedupe record, NOT the history rows:
// pruning deletes old rows, and a block whose row was pruned
// must never be re-recorded as new (it would jump to the top
// of the list and replace the genuinely newest code).
const stateRows = await db
.select()
.from(schema.codeQuickState)
.where(eq(schema.codeQuickState.id, 1));
let wmMessage = stateRows[0]?.lastMessageId ?? 0;
let wmBlock = stateRows[0]?.lastBlockIndex ?? -1;
if (!stateRows[0]) {
// First run of the watermark: if history rows were recorded
// before it existed, seed the watermark from the newest one
// instead of re-recording everything already listed.
const existing = await db
.select({
messageId: schema.codeQuickRuns.messageId,
blockIndex: schema.codeQuickRuns.blockIndex,
})
.from(schema.codeQuickRuns)
.where(eq(schema.codeQuickRuns.source, "chat"));
for (const r of existing) {
if (r.messageId == null) continue;
if (
r.messageId > wmMessage ||
(r.messageId === wmMessage && r.blockIndex > wmBlock)
) {
wmMessage = r.messageId;
wmBlock = r.blockIndex;
}
}
}
const msgs = await db
.select()
.from(schema.messages)
.where(
and(eq(schema.messages.role, "assistant"), eq(schema.messages.streaming, 0)),
)
.orderBy(desc(schema.messages.id))
.limit(50);
if (msgs.length === 0) return;
// Candidates newest first: newest message first, and inside
// one message the LAST runnable block is its newest code.
// Only blocks past the watermark are candidates at all.
type Candidate = {
messageId: number;
blockIndex: number;
language: string;
code: string;
conversationId: number;
};
const candidates: Candidate[] = [];
for (const m of msgs) {
if (m.id < wmMessage) break;
if (!m.content.includes("```")) continue;
const blocks = parseFencedBlocks(m.content);
for (let bi = blocks.length - 1; bi >= 0; bi--) {
if (m.id === wmMessage && bi <= wmBlock) continue;
const block = blocks[bi];
if (!block) continue;
const target = runnableTargetFor(block.lang);
if (!target || !block.code.trim()) continue;
candidates.push({
messageId: m.id,
blockIndex: bi,
language: target.kind === "shell" ? "bash" : target.language,
code: block.code,
conversationId: m.conversationId,
});
}
}
// Insert oldest first so row ids ascend with recency and the
// newest candidate ends up as the newest history row; then
// advance the watermark past every candidate (candidates are
// newest-first, so the first one is the high-water mark).
let inserted = false;
for (const c of [...candidates].reverse()) {
let label = "";
try {
const convs = await db
.select({ title: schema.conversations.title })
.from(schema.conversations)
.where(eq(schema.conversations.id, c.conversationId));
label = convs[0]?.title ?? "";
} catch {
label = "";
}
await db.insert(schema.codeQuickRuns).values({
language: c.language,
code: c.code,
source: "chat",
sourceLabel: label,
messageId: c.messageId,
blockIndex: c.blockIndex,
});
inserted = true;
}
if (inserted) {
await pruneQuickCode(ctx);
const top = candidates[0];
if (top) {
if (stateRows[0]) {
await db
.update(schema.codeQuickState)
.set({ lastMessageId: top.messageId, lastBlockIndex: top.blockIndex })
.where(eq(schema.codeQuickState.id, 1));
} else {
await db.insert(schema.codeQuickState).values({
id: 1,
lastMessageId: top.messageId,
lastBlockIndex: top.blockIndex,
});
}
}
}
}

async function loadQuickCodeList(
ctx: Ctx,
): Promise<z.infer<typeof quickCodeListResponse>> {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeQuickRuns)
.orderBy(desc(schema.codeQuickRuns.id))
.limit(10);
return {
items: rows.map((r) => ({
id: r.id,
language: r.language,
code: r.code,
source: r.source === "manual" ? "manual" : "chat",
sourceLabel: r.sourceLabel,
createdAt: safeIso(r.createdAt),
})),
};
}

const runMessageCodeResult = z.object({
  ok: z.boolean(),
  // ran = the block really executed; noted = an outcome section
  // was appended to the stored message (the client then just
  // refetches instead of also showing the error inline).
  ran: z.boolean(),
  noted: z.boolean(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  error: z.string(),
  conversationId: z.number(),
});

const sendResult = z.object({
  ok: z.boolean(),
  // silent = the conversation's agent deliberately did not reply
  // (disabled or API not configured). The user message is saved; the
  // client shows the reason as a muted notice with no retry button.
  silent: z.boolean(),
  error: z.string().nullable(),
  userMessage: messageOut.nullable(),
  assistantMessage: messageOut.nullable(),
  // Every reply produced for this send — more than one in a group
  // chat, where each member agent answers in turn. assistantMessage
  // stays the first reply for callers that only need one.
  assistantMessages: z.array(messageOut),
});


function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}
function strField(v: unknown): string {
  return typeof v === "string" ? v : "";
}

type PioneerRow = typeof schema.pioneerState.$inferSelect;

/** Loads the Pioneer singleton row, creating it on first use. */
async function loadPioneerRow(ctx: Ctx): Promise<PioneerRow> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.pioneerState)
    .where(eq(schema.pioneerState.id, 1));
  const existing = rows[0];
  if (existing) return existing;
  await db.insert(schema.pioneerState).values({ id: 1 });
  const again = await db
    .select()
    .from(schema.pioneerState)
    .where(eq(schema.pioneerState.id, 1));
  const row = again[0];
  if (!row) throw new Error("loadPioneerRow: failed to create Pioneer state row");
  return row;
}

const okResponse = z.object({ ok: z.literal(true) });

// --- Pioneer VPN (the user's own account, official-client protocol) ---
// The user supplied the official Windows installer (PioneerV3.0.24.exe)
// and asked for its login + server selection to live in this space
// instead of installing the app. The protocol below was recovered from
// that installer and verified live on 2026-11-17:
//   - Pioneer.dat inside the installer is an AES-128-CBC encrypted host
//     list (key/IV sit in plaintext in Pioneer.exe beside the decrypt
//     routine); it names the API hosts below plus a CloudFront hostget
//     URL for dynamic updates.
//   - Every call carries headers did (device id) / lang / os / version /
//     User-Agent: Pioneer/<version>, plus token once logged in.
//   - Responses are {Status, Ret, Message, Data}; Data is base64
//     AES-128-CBC (same key/IV) encrypted JSON. POST bodies are the
//     same envelope: {"Data": "<encrypted JSON>"}.
//   - POST /api/login {type:2, userName, password, deviceId} is the
//     account login (a wrong password returns the server's real
//     "api.account_or_password_wrong"); type 1 is the device anonymous
//     login and is NOT used here. The login Data carries userinfo
//     fields (userNumber, userType, email, dueTime, accessToken).
//   - GET /api/server with the token returns the region list:
//     {vip: [{country_id, country_name, country_icon, country_sort}]}
//     — regions only, no node addresses.
//   - POST /api/connect {type: 1, country_id, deviceId} is the call
//     the official client makes when a region is picked ("Connect:
//     requesting node from API..."); it returns that region's node
//     (connectid / name / country plus the node config: host, port,
//     protocol, credentials). Verified live 2026-11-17 with an
//     anonymous free token: the payload shape is accepted and the
//     call is gated by account entitlement ("您的使用时间已过期，
//     请升级高级会员"), so a successful node response can only be
//     observed with the user's own entitled account.
// Credentials, the session token and the raw node config live ONLY in
// the settings row on the server; getState exposes the username, a
// hasPassword flag, the account facts Pioneer itself returned and the
// node's display facts (name / host / resolved IPs / port / protocol)
// — never the password, token or node credentials. Selecting a server
// fetches and stores its node info and, when the node is a Trojan
// node, really establishes the tunnel for it (see the tunnel section
// below): a local proxy daemon routes through the selected node and
// the panel shows the exit IP verified through that tunnel.
//
// Facts established live on 2026-11-17 (anonymous device token):
// GET /api/server returns exactly ONE group ("vip") of 20 regions and
// each entry carries only country_id / country_name / country_icon /
// country_sort — there is no second group, no pagination and no
// sub-line field, so the 20 regions are all Pioneer offers this
// account type; sub-lines can only appear inside a /api/connect
// response for one region. The space's own egress without the tunnel
// (the platform datacenter proxy) measured US / Colorado / Sedalia at
// that time; with a tunnel connected, requests sent through the local
// proxy daemon exit at the selected node instead, which is what the
// panel's verified exit IP reports.
const PIONEER_HOSTS = [
  "https://app.genershake.com",
  "https://app.bestmodes.com",
  "https://letssaubpub.azureedge.net",
];
const PIONEER_VERSION = "3.0.24";

type PioneerServerEntry = { id: number; name: string; icon: string };

// The AES-128-CBC cipher itself runs in the privileged layer (action
// code may not import node:crypto); these wrappers are the envelope.
async function pioneerEncryptJson(ctx: Ctx, value: unknown): Promise<string | null> {
  const r = await ctx.executePrivileged(privileged.pioneerEncrypt, { text: JSON.stringify(value) });
  return r.ok ? r.text : null;
}

async function pioneerDecryptJson(ctx: Ctx, b64: string): Promise<Record<string, unknown> | null> {
  const r = await ctx.executePrivileged(privileged.pioneerDecrypt, { text: b64 });
  if (!r.ok) return null;
  try {
    return asRecord(JSON.parse(r.text));
  } catch {
    return null;
  }
}

function parsePioneerServers(raw: string | undefined | null): PioneerServerEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is { id?: unknown; name?: unknown; icon?: unknown } =>
          typeof e === "object" && e !== null,
      )
      .map((e) => ({
        id: typeof e.id === "number" ? e.id : 0,
        name: typeof e.name === "string" ? e.name : "",
        icon: typeof e.icon === "string" ? e.icon : "",
      }))
      .filter((e) => e.name !== "");
  } catch {
    return [];
  }
}

function pioneerErrorText(message: string): string {
  if (message === "api.account_or_password_wrong") return "帐号或密码不正确（Pioneer 服务器返回）";
  return message;
}

type PioneerCallResult =
  | { ok: true; data: Record<string, unknown> | null; host: string }
  | { ok: false; error: string; tokenProblem: boolean };

// One real call to Pioneer's API in the official client's protocol.
// Hosts are tried in order (the user's custom address first when set);
// a host that answers with a Pioneer business failure (wrong password,
// expired token) decides the outcome — that answer is not retried
// against another host, only unreachable/unparseable hosts fall through.
async function pioneerCall(
  ctx: Ctx,
  opts: {
    path: string;
    method: "GET" | "POST";
    deviceId: string;
    token?: string;
    payload?: Record<string, unknown>;
    customHost?: string;
    timeoutMs?: number;
  },
): Promise<PioneerCallResult> {
  const hosts: string[] = [];
  const custom = (opts.customHost ?? "").trim().replace(/\/+$/, "");
  if (custom && /^https:\/\//i.test(custom)) hosts.push(custom);
  for (const h of PIONEER_HOSTS) if (!hosts.includes(h)) hosts.push(h);
  let lastError = "无法连接 Pioneer 服务器";
  for (const host of hosts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
    try {
      const headers: Record<string, string> = {
        "User-Agent": `Pioneer/${PIONEER_VERSION}`,
        Accept: "application/json",
        did: opts.deviceId,
        lang: "zh-CN",
        os: "win",
        version: PIONEER_VERSION,
      };
      if (opts.token) headers.token = opts.token;
      let body: string | undefined;
      if (opts.method === "POST") {
        headers["Content-Type"] = "application/json";
        const enc = await pioneerEncryptJson(ctx, opts.payload ?? {});
        if (enc === null) return { ok: false, error: "请求加密失败", tokenProblem: false };
        body = JSON.stringify({ Data: enc });
      }
      const res = await fetch(`${host}${opts.path}`, {
        method: opts.method,
        headers,
        body,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let envelope: Record<string, unknown> | null = null;
      try {
        envelope = asRecord(JSON.parse(text));
      } catch {
        envelope = null;
      }
      if (!envelope) {
        lastError = `${host} 返回了无法解析的响应（HTTP ${res.status}）`;
        continue;
      }
      const status = strField(envelope.Status);
      const message = strField(envelope.Message);
      if (status !== "success") {
        return {
          ok: false,
          error: pioneerErrorText(message || `Pioneer 服务器返回失败（HTTP ${res.status}）`),
          tokenProblem: /token/i.test(message),
        };
      }
      const rawData = envelope.Data;
      let data: Record<string, unknown> | null = null;
      if (typeof rawData === "string" && rawData !== "") {
        data = await pioneerDecryptJson(ctx, rawData);
        if (!data) {
          return { ok: false, error: "Pioneer 服务器返回的数据无法解密（协议可能已变更）", tokenProblem: false };
        }
      } else if (rawData && typeof rawData === "object") {
        data = asRecord(rawData);
      }
      return { ok: true, data, host };
    } catch (e) {
      lastError =
        e instanceof Error && e.name === "AbortError"
          ? `${host} 请求超时（20 秒）`
          : `${host} 网络错误，无法连接`;
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError, tokenProblem: false };
}

async function ensurePioneerDeviceId(ctx: Ctx): Promise<string> {
  const s = await loadPioneerRow(ctx);
  if (s && s.deviceId.trim()) return s.deviceId.trim();
  const generated = await ctx.executePrivileged(privileged.randomUuid, {});
  const id = generated.uuid;
  const db = ctx.db<typeof schema>();
  await db.update(schema.pioneerState).set({ deviceId: id }).where(eq(schema.pioneerState.id, 1));
  return id;
}

// Real account login against Pioneer's API. On success the session
// token and the account facts the server itself returned are stored
// server-side; on failure the server's real error is stored and shown.
async function pioneerDoLogin(
  ctx: Ctx,
  username: string,
  password: string,
): Promise<{ ok: true; account: string; userType: string; dueTime: string } | { ok: false; error: string }> {
  const deviceId = await ensurePioneerDeviceId(ctx);
  const s = await loadPioneerRow(ctx);
  const r = await pioneerCall(ctx, {
    path: "/api/login",
    method: "POST",
    deviceId,
    customHost: s?.customHost ?? "",
    payload: { type: 2, userName: username, password, deviceId },
  });
  const db = ctx.db<typeof schema>();
  if (!r.ok) {
    await db
      .update(schema.pioneerState)
      .set({ status: "error", error: r.error, token: "" })
      .where(eq(schema.pioneerState.id, 1));
    await pioneerLog(ctx, "login", `登录失败：${r.error}`);
    return { ok: false, error: r.error };
  }
  const token = strField(r.data?.accessToken);
  if (!token) {
    const error = "Pioneer 服务器未返回登录令牌（协议可能已变更）";
    await db
      .update(schema.pioneerState)
      .set({ status: "error", error: error, token: "" })
      .where(eq(schema.pioneerState.id, 1));
    await pioneerLog(ctx, "login", `登录失败：${error}`);
    return { ok: false, error };
  }
  const account = strField(r.data?.email) || strField(r.data?.userNumber) || username;
  const userType = strField(r.data?.userType);
  const dueTime = strField(r.data?.dueTime);
  await db
    .update(schema.pioneerState)
    .set({
      token: token,
      account: account,
      userType: userType,
      dueTime: dueTime,
      status: "logged_in",
      error: "",
      host: r.host,
    })
    .where(eq(schema.pioneerState.id, 1));
  await pioneerLog(ctx, "login", `登录成功：帐号 ${account}${userType ? `（${userType}）` : ""}`);
  return { ok: true, account, userType, dueTime };
}

// Fetches the region/server list with the stored session token and
// stores the real list. When the token has expired and credentials are
// saved, it logs in once more in the background and retries.
async function pioneerFetchAndStoreServers(
  ctx: Ctx,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const db = ctx.db<typeof schema>();
  let s = await loadPioneerRow(ctx);
  if (!s || !s.token.trim()) {
    if (s && s.username.trim() && s.password) {
      const login = await pioneerDoLogin(ctx, s.username.trim(), s.password);
      if (!login.ok) return { ok: false, error: login.error };
      s = await loadPioneerRow(ctx);
    } else {
      return { ok: false, error: "尚未登录 Pioneer 帐号" };
    }
  }
  if (!s) return { ok: false, error: "尚未登录 Pioneer 帐号" };
  const deviceId = await ensurePioneerDeviceId(ctx);
  let r = await pioneerCall(ctx, {
    path: "/api/server",
    method: "GET",
    deviceId,
    token: s.token.trim(),
    customHost: s.customHost,
  });
  if (!r.ok && r.tokenProblem && s.username.trim() && s.password) {
    const login = await pioneerDoLogin(ctx, s.username.trim(), s.password);
    if (login.ok) {
      const s2 = await loadPioneerRow(ctx);
      if (s2) {
        r = await pioneerCall(ctx, {
          path: "/api/server",
          method: "GET",
          deviceId,
          token: s2.token.trim(),
          customHost: s2.customHost,
        });
      }
    }
  }
  if (!r.ok) {
    await db.update(schema.pioneerState).set({ error: r.error }).where(eq(schema.pioneerState.id, 1));
    await pioneerLog(ctx, "servers", `服务器列表识别失败：${r.error}`);
    return { ok: false, error: r.error };
  }
  const entries: PioneerServerEntry[] = [];
  if (r.data) {
    for (const value of Object.values(r.data)) {
      if (!Array.isArray(value)) continue;
      const items = value
        .map((v) => asRecord(v))
        .filter((v): v is Record<string, unknown> => v !== null && typeof v.country_name === "string")
        .map((v) => ({
          id: typeof v.country_id === "number" ? v.country_id : 0,
          name: strField(v.country_name),
          icon: strField(v.country_icon),
          sort: typeof v.country_sort === "number" ? v.country_sort : 0,
        }))
        .sort((a, b) => b.sort - a.sort);
      for (const it of items) entries.push({ id: it.id, name: it.name, icon: it.icon });
    }
  }
  await db
    .update(schema.pioneerState)
    .set({
      servers: JSON.stringify(entries),
      serversAt: new Date(),
      error: "",
      host: r.host,
      // Legacy per-region probe columns (feature removed): keep them
      // cleared so no stale probe data lingers from earlier versions.
    })
    .where(eq(schema.pioneerState.id, 1));
  await pioneerLog(ctx, "servers", `服务器列表已识别：共 ${entries.length} 个地区`);
  return { ok: true, count: entries.length };
}

// --- Pioneer node selection (/api/connect) ---
// The region list carries no addresses; the concrete node (host / IP /
// port / protocol) only comes back from /api/connect for one region.
// The raw response is stored server-side only (it contains the node's
// credentials); what leaves the server is the extracted display info.

type PioneerNodeInfo = {
  countryId: number;
  name: string;
  country: string;
  protocol: string;
  host: string;
  port: number;
  sni: string;
  ips: string[];
};

const PIONEER_LINK_SCHEMES = ["vless://", "vmess://", "trojan://", "ss://", "hysteria2://", "hy2://", "tuic://"];

// Flattens a decoded Pioneer payload into [lowercased key, value] pairs
// (nested plain objects and object arrays included, depth-limited) so
// the node fields can be found wherever the response nests them.
function pioneerFlatten(
  value: unknown,
  depth: number,
  out: Array<[string, unknown]>,
): void {
  if (depth > 4 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) pioneerFlatten(item, depth + 1, out);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push([k.toLowerCase(), v]);
    if (v !== null && typeof v === "object") pioneerFlatten(v, depth + 1, out);
  }
}

function pioneerFirstField(
  pairs: Array<[string, unknown]>,
  keys: string[],
): string {
  for (const key of keys) {
    for (const [k, v] of pairs) {
      if (k !== key) continue;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return "";
}

// Extracts the display facts of one node from a /api/connect response:
// the node's own name/country plus its concrete address. A share link
// (vless:// / vmess:// / trojan:// / ss:// …) anywhere in the payload
// is parsed for protocol/host/port; plain host/port/protocol fields
// fill the gaps. Credential values (uuid / password / secret) are
// never copied into the result.
function extractPioneerNode(
  data: Record<string, unknown>,
  countryId: number,
): PioneerNodeInfo {
  const pairs: Array<[string, unknown]> = [];
  pioneerFlatten(data, 0, pairs);
  const info: PioneerNodeInfo = {
    countryId,
    name: strField(data.name),
    country: strField(data.country),
    protocol: "",
    host: "",
    port: 0,
    sni: "",
    ips: [],
  };
  let link = "";
  for (const [, v] of pairs) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (PIONEER_LINK_SCHEMES.some((s) => t.toLowerCase().startsWith(s))) {
      link = t;
      break;
    }
  }
  if (link.toLowerCase().startsWith("vmess://")) {
    try {
      const json = JSON.parse(
        Buffer.from(link.slice("vmess://".length).split("#")[0] ?? "", "base64").toString("utf8"),
      ) as Record<string, unknown>;
      info.protocol = "vmess";
      info.host = strField(json.add) || strField(json.host);
      info.port = typeof json.port === "number" ? json.port : Number(strField(json.port)) || 0;
      if (!info.name) info.name = strField(json.ps);
      info.sni = strField(json.sni) || strField(json.host);
    } catch {
      info.protocol = "vmess";
    }
  } else if (link) {
    try {
      const u = new URL(link);
      info.protocol = u.protocol.replace(/:$/, "");
      info.host = u.hostname;
      info.port = u.port ? Number(u.port) : 0;
      info.sni =
        u.searchParams.get("sni") || u.searchParams.get("peer") || info.sni;
      if (!info.name && u.hash) info.name = decodeURIComponent(u.hash.slice(1));
    } catch {
      // Unparseable link: fall through to the plain fields below.
    }
  }
  if (!info.host) {
    info.host = pioneerFirstField(pairs, ["host", "ip", "address", "server", "domain", "endpoint", "hostname", "add"]);
  }
  if (!info.port) {
    const p = pioneerFirstField(pairs, ["port", "server_port", "serverport"]);
    info.port = p ? Number(p) || 0 : 0;
  }
  if (!info.protocol) {
    info.protocol = pioneerFirstField(pairs, ["protocol", "scheme", "method"]);
  }
  if (!info.sni) {
    info.sni = pioneerFirstField(pairs, ["sni", "servername", "server_name"]);
  }
  if (!info.name) info.name = pioneerFirstField(pairs, ["ps", "remark", "remarks", "title"]);
  return info;
}

function parsePioneerNodeInfo(raw: string | undefined | null): PioneerNodeInfo | null {
  if (!raw) return null;
  try {
    const p = asRecord(JSON.parse(raw));
    if (!p) return null;
    return {
      countryId: typeof p.countryId === "number" ? p.countryId : 0,
      name: strField(p.name),
      country: strField(p.country),
      protocol: strField(p.protocol),
      host: strField(p.host),
      port: typeof p.port === "number" ? p.port : 0,
      sni: strField(p.sni),
      ips: Array.isArray(p.ips) ? p.ips.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// Resolves a node hostname to its concrete IPs through public
// DNS-over-HTTPS (dns.google, then Cloudflare). IP literals pass
// through unchanged; an unresolvable host yields an empty list and
// the UI shows the hostname alone — nothing is invented.
async function pioneerResolveIps(host: string): Promise<string[]> {
  const h = host.trim();
  if (!h) return [];
  if (isIpLiteral(h)) return [h];
  const providers = [
    (name: string, type: string) =>
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    (name: string, type: string) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  for (const make of providers) {
    try {
      const ips: string[] = [];
      for (const type of ["A", "AAAA"]) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(make(h, type), {
            headers: { Accept: "application/dns-json" },
            signal: ctrl.signal,
          });
          if (!res.ok) continue;
          const body = asRecord(await res.json().catch(() => null));
          const answers = Array.isArray(body?.Answer) ? body.Answer : [];
          for (const a of answers) {
            const rec = asRecord(a);
            const data = strField(rec?.data);
            if (data && isIpLiteral(data) && !ips.includes(data)) ips.push(data);
          }
        } finally {
          clearTimeout(timer);
        }
      }
      if (ips.length > 0) return ips.slice(0, 4);
    } catch {
      continue;
    }
  }
  return [];
}

// Selects one region server-side: stores the selection, then makes
// the real /api/connect call the official client makes for it and
// stores the returned node (raw JSON server-side only, extracted
// display facts for the page). Pioneer's real refusal (e.g. the
// account's membership does not cover connecting) is stored and
// returned as-is; the selection itself still stands.
async function pioneerSelectAndStoreNode(
  ctx: Ctx,
  countryId: number,
): Promise<{ ok: true; node: PioneerNodeInfo } | { ok: false; error: string }> {
  const db = ctx.db<typeof schema>();
  let s = await loadPioneerRow(ctx);
  if (!s || !s.token.trim()) {
    if (s && s.username.trim() && s.password) {
      const login = await pioneerDoLogin(ctx, s.username.trim(), s.password);
      if (!login.ok) return { ok: false, error: login.error };
      s = await loadPioneerRow(ctx);
    } else {
      return { ok: false, error: "尚未登录 Pioneer 帐号" };
    }
  }
  if (!s) return { ok: false, error: "尚未登录 Pioneer 帐号" };
  const selected = parsePioneerServers(s.servers).find((e) => e.id === countryId);
  const selectedName = selected?.name ?? "";
  await db
    .update(schema.pioneerState)
    .set({ selectedId: countryId, selectedName: selectedName })
    .where(eq(schema.pioneerState.id, 1));
  const deviceId = await ensurePioneerDeviceId(ctx);
  let r = await pioneerCall(ctx, {
    path: "/api/connect",
    method: "POST",
    deviceId,
    token: s.token.trim(),
    customHost: s.customHost,
    payload: { type: 1, country_id: countryId, deviceId },
  });
  if (!r.ok && r.tokenProblem && s.username.trim() && s.password) {
    const login = await pioneerDoLogin(ctx, s.username.trim(), s.password);
    if (login.ok) {
      const s2 = await loadPioneerRow(ctx);
      if (s2) {
        r = await pioneerCall(ctx, {
          path: "/api/connect",
          method: "POST",
          deviceId,
          token: s2.token.trim(),
          customHost: s2.customHost,
          payload: { type: 1, country_id: countryId, deviceId },
        });
      }
    }
  }
  if (!r.ok) {
    await db
      .update(schema.pioneerState)
      .set({ nodeJson: "", nodeInfo: "", nodeError: r.error, nodeAt: null })
      .where(eq(schema.pioneerState.id, 1));
    return { ok: false, error: r.error };
  }
  if (!r.data) {
    const error = "Pioneer 服务器未返回节点数据（协议可能已变更）";
    await db
      .update(schema.pioneerState)
      .set({ nodeJson: "", nodeInfo: "", nodeError: error, nodeAt: null })
      .where(eq(schema.pioneerState.id, 1));
    return { ok: false, error };
  }
  const info = extractPioneerNode(r.data, countryId);
  if (!info.name) info.name = selectedName;
  if (!info.country) info.country = selectedName;
  info.ips = await pioneerResolveIps(info.host);
  await db
    .update(schema.pioneerState)
    .set({
      nodeJson: JSON.stringify(r.data),
      nodeInfo: JSON.stringify(info),
      nodeError: "",
      nodeAt: new Date(),
    })
    .where(eq(schema.pioneerState.id, 1));
  return { ok: true, node: info };
}

// --- Pioneer Trojan tunnel (established on server selection) ---
// Selecting a region now goes one step further than node-info
// retrieval: when the node Pioneer returns is a Trojan node, the
// server starts a real local proxy daemon (privileged layer, loopback
// port 19351) that speaks the trojan protocol over TLS to that node,
// and immediately verifies the tunnel by fetching the exit IP through
// it (ipinfo.io, ipwho.is fallback). The verified exit is stored and
// shown in the panel. The trojan password is extracted here from the
// server-side-only raw node config and handed only to the privileged
// daemon — it is never stored in the tunnel status record and never
// returned to the client. A node that is not Trojan (or carries no
// usable password) yields an honest "unsupported" state, not a fake
// connection.

type PioneerTunnelState = {
  state: string;
  protocol: string;
  nodeHost: string;
  nodePort: number;
  error: string;
  exitIp: string;
  exitCountry: string;
  exitRegion: string;
  exitCity: string;
  checkedAt: string;
};

const pioneerTunnelSchema = z.object({
  state: z.string(),
  protocol: z.string(),
  nodeHost: z.string(),
  nodePort: z.number(),
  error: z.string(),
  exitIp: z.string(),
  exitCountry: z.string(),
  exitRegion: z.string(),
  exitCity: z.string(),
  checkedAt: z.string(),
});

function emptyPioneerTunnel(): PioneerTunnelState {
  return {
    state: "",
    protocol: "",
    nodeHost: "",
    nodePort: 0,
    error: "",
    exitIp: "",
    exitCountry: "",
    exitRegion: "",
    exitCity: "",
    checkedAt: "",
  };
}

function parsePioneerTunnel(raw: string | undefined | null): PioneerTunnelState | null {
  if (!raw) return null;
  try {
    const p = asRecord(JSON.parse(raw));
    if (!p) return null;
    const t: PioneerTunnelState = {
      state: strField(p.state),
      protocol: strField(p.protocol),
      nodeHost: strField(p.nodeHost),
      nodePort: typeof p.nodePort === "number" ? p.nodePort : 0,
      error: strField(p.error),
      exitIp: strField(p.exitIp),
      exitCountry: strField(p.exitCountry),
      exitRegion: strField(p.exitRegion),
      exitCity: strField(p.exitCity),
      checkedAt: strField(p.checkedAt),
    };
    return t.state ? t : null;
  } catch {
    return null;
  }
}

// Extracts the Trojan connection parameters from the raw /api/connect
// payload. Prefers a trojan:// share link (password in the userinfo);
// otherwise falls back to plain password/host/port fields when the
// node's protocol is trojan. Returns null when no usable password or
// address exists.
function extractPioneerTrojan(
  data: Record<string, unknown> | null,
  info: PioneerNodeInfo | null,
): { host: string; port: number; password: string; sni: string } | null {
  if (!data) return null;
  const pairs: Array<[string, unknown]> = [];
  pioneerFlatten(data, 0, pairs);
  for (const [, v] of pairs) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t.toLowerCase().startsWith("trojan://")) continue;
    try {
      const u = new URL(t);
      const password = decodeURIComponent(u.username);
      const host = u.hostname || info?.host || "";
      const port = u.port ? Number(u.port) : info?.port || 0;
      if (!password || !host || !port) return null;
      return {
        host,
        port,
        password,
        sni: u.searchParams.get("sni") || u.searchParams.get("peer") || info?.sni || "",
      };
    } catch {
      return null;
    }
  }
  const protocol = (info?.protocol ?? "").toLowerCase();
  if (protocol && protocol !== "trojan") return null;
  const password = pioneerFirstField(pairs, ["password", "pass", "passwd", "pwd"]);
  const host = info?.host || "";
  const port = info?.port || 0;
  if (!password || !host || !port) return null;
  return { host, port, password, sni: info?.sni ?? "" };
}

async function pioneerStoreTunnel(ctx: Ctx, t: PioneerTunnelState): Promise<void> {
  const db = ctx.db<typeof schema>();
  await db
    .update(schema.pioneerState)
    .set({
      tunnelJson: JSON.stringify(t),
      tunnelAt: new Date(),
      ...(t.exitIp
        ? {
            exitJson: JSON.stringify({
              ip: t.exitIp,
              country: t.exitCountry,
              region: t.exitRegion,
              city: t.exitCity,
              via: "trojan-tunnel",
            }),
            exitAt: new Date(),
          }
        : {}),
    })
    .where(eq(schema.pioneerState.id, 1));
}

// Fetches the real exit IP THROUGH the running tunnel. ipinfo.io
// first, ipwho.is as fallback; both answers are parsed tolerantly and
// a failure returns the real error of the last attempt.
async function pioneerFetchExitViaTunnel(
  ctx: Ctx,
): Promise<
  | { ok: true; ip: string; country: string; region: string; city: string }
  | { ok: false; error: string }
> {
  const attempts: Array<{
    url: string;
    timeoutMs: number;
    parse: (rec: Record<string, unknown>) => { ip: string; country: string; region: string; city: string } | null;
  }> = [
    {
      url: "https://ipinfo.io/json",
      timeoutMs: 15000,
      parse: (rec) => {
        const ip = strField(rec.ip);
        if (!ip) return null;
        return { ip, country: strField(rec.country), region: strField(rec.region), city: strField(rec.city) };
      },
    },
    {
      url: "https://ipwho.is/",
      timeoutMs: 12000,
      parse: (rec) => {
        if (rec.success === false) return null;
        const ip = strField(rec.ip);
        if (!ip) return null;
        return { ip, country: strField(rec.country), region: strField(rec.region), city: strField(rec.city) };
      },
    },
  ];
  let lastError = "经隧道查询出口 IP 失败";
  for (const a of attempts) {
    const r = await ctx.executePrivileged(privileged.pioneerTunnelFetch, {
      url: a.url,
      timeoutMs: a.timeoutMs,
    });
    if (!r.ok) {
      lastError = r.error || `经隧道访问 ${a.url} 失败`;
      continue;
    }
    try {
      const rec = asRecord(JSON.parse(r.body));
      const parsed = rec ? a.parse(rec) : null;
      if (parsed) return { ok: true, ...parsed };
      lastError = `${a.url} 的返回中没有出口 IP`;
    } catch {
      lastError = `${a.url} 的返回无法解析`;
    }
  }
  return { ok: false, error: lastError };
}

// Establishes (or re-establishes) the Trojan tunnel for the currently
// stored node and verifies the exit through it. Every outcome —
// connected, unsupported protocol, start failure, verification
// failure — is stored in the settings row and returned as-is.
async function pioneerEstablishTunnel(ctx: Ctx): Promise<PioneerTunnelState> {
  const s = await loadPioneerRow(ctx);
  const t = emptyPioneerTunnel();
  const info = parsePioneerNodeInfo(s?.nodeInfo);
  t.protocol = info?.protocol ?? "";
  t.nodeHost = info?.host ?? "";
  t.nodePort = info?.port ?? 0;
  let data: Record<string, unknown> | null = null;
  if (s?.nodeJson) {
    try {
      data = asRecord(JSON.parse(s.nodeJson));
    } catch {
      data = null;
    }
  }
  if (!data || !info) {
    t.state = "error";
    t.error = "尚未获取到节点信息，无法建立隧道";
    await pioneerStoreTunnel(ctx, t);
    await pioneerLog(ctx, "connect", `隧道未建立：${t.error}`);
    return t;
  }
  const trojan = extractPioneerTrojan(data, info);
  if (!trojan) {
    t.state = "unsupported";
    t.error = info.protocol
      ? `该节点的协议为「${info.protocol}」，不是 Trojan，或节点数据中没有可用的连接密码，本次无法为其建立 Trojan 隧道`
      : "节点数据中没有找到可用的 Trojan 连接配置（密码或地址缺失），无法建立隧道";
    await pioneerStoreTunnel(ctx, t);
    await pioneerLog(ctx, "connect", `隧道未建立：${t.error}`);
    return t;
  }
  t.protocol = "trojan";
  t.nodeHost = trojan.host;
  t.nodePort = trojan.port;
  const started = await ctx.executePrivileged(privileged.pioneerTunnelStart, {
    host: trojan.host,
    port: trojan.port,
    password: trojan.password,
    sni: trojan.sni,
  });
  if (!started.ok || !started.running) {
    t.state = "error";
    t.error = started.error || "隧道启动失败";
    await pioneerStoreTunnel(ctx, t);
    await pioneerLog(ctx, "connect", `隧道未建立：${t.error}`);
    return t;
  }
  const exit = await pioneerFetchExitViaTunnel(ctx);
  t.checkedAt = new Date().toISOString();
  if (!exit.ok) {
    t.state = "error";
    t.error = `隧道进程已启动，但经隧道验证出口失败：${exit.error}`;
    await pioneerStoreTunnel(ctx, t);
    await pioneerLog(ctx, "connect", `隧道未建立：${t.error}`);
    return t;
  }
  t.state = "connected";
  t.exitIp = exit.ip;
  t.exitCountry = exit.country;
  t.exitRegion = exit.region;
  t.exitCity = exit.city;
  t.error = "";
  await pioneerStoreTunnel(ctx, t);
  await pioneerLog(
    ctx,
    "connect",
    `已连接${s?.selectedName ? ` ${s.selectedName}` : ""}：隧道建立，出口 IP ${exit.ip}${exit.country ? `（${exit.country}${exit.city ? ` · ${exit.city}` : ""}）` : ""}`,
  );
  return t;
}

// Stops the tunnel daemon (best effort) and clears the stored tunnel
// and exit records. Used when the node selection is gone (logout, or
// Pioneer refused a new selection) so no stale tunnel keeps claiming
// an exit that no longer matches the selection.
async function pioneerStopTunnelAndClear(ctx: Ctx): Promise<void> {
  try {
    await ctx.executePrivileged(privileged.pioneerTunnelStop, {});
  } catch {
    // best effort only; the stored state is cleared regardless
  }
  const db = ctx.db<typeof schema>();
  await db
    .update(schema.pioneerState)
    .set({ tunnelJson: "", tunnelAt: null, exitJson: "", exitAt: null })
    .where(eq(schema.pioneerState.id, 1));
}

const pioneerNodeSchema = z.object({
  countryId: z.number(),
  name: z.string(),
  country: z.string(),
  protocol: z.string(),
  host: z.string(),
  port: z.number(),
  sni: z.string(),
  ips: z.array(z.string()),
});

const pioneerSelectResponse = z.object({
  ok: z.boolean(),
  error: z.string(),
  node: pioneerNodeSchema.nullable(),
  tunnel: pioneerTunnelSchema.nullable(),
});

const pioneerStateResponse = z.object({
  username: z.string(),
  hasPassword: z.boolean(),
  loggedIn: z.boolean(),
  account: z.string(),
  userType: z.string(),
  dueTime: z.string(),
  status: z.string(),
  error: z.string(),
  host: z.string(),
  customHost: z.string(),
  servers: z.array(
    z.object({ id: z.number(), name: z.string(), icon: z.string() }),
  ),
  serversUpdatedAt: z.string().nullable(),
  selectedId: z.number(),
  selectedName: z.string(),
  node: pioneerNodeSchema.nullable(),
  nodeError: z.string(),
  nodeAt: z.string().nullable(),
  tunnel: pioneerTunnelSchema.nullable(),
  globalMode: z.boolean(),
});

// Shapes a stored Pioneer row into the panel state the client
// reads. Shared by pioneerGetState and the entry detection, which
// returns the corrected state in the same shape.
function pioneerStateOut(s: PioneerRow): z.infer<typeof pioneerStateResponse> {
  return {
    username: s.username,
    hasPassword: s.password !== "",
    loggedIn: s.status === "logged_in" && s.token.trim() !== "",
    account: s.account,
    userType: s.userType,
    dueTime: s.dueTime,
    status: s.status,
    error: s.error,
    host: s.host,
    customHost: s.customHost,
    servers: parsePioneerServers(s.servers),
    serversUpdatedAt: s.serversAt ? s.serversAt.toISOString() : null,
    selectedId: s.selectedId,
    selectedName: s.selectedName,
    node: parsePioneerNodeInfo(s.nodeInfo),
    nodeError: s.nodeError,
    nodeAt: s.nodeAt ? s.nodeAt.toISOString() : null,
    tunnel: parsePioneerTunnel(s.tunnelJson),
    globalMode: s.globalMode === 1,
  };
}

// --- VPN log （连接日志） ---
// One row per real Pioneer event, pruned to the newest 100 rows.
// Logging is best-effort by design: a failed log write must never
// break the action that produced the event.
const PIONEER_LOG_KEEP = 100;

// The version page shows at most the 50 most recent recorded updates.
const VERSION_HISTORY_LIMIT = 50;

// The VPN log panel displays at most the 10 most recent events
// (storage keeps more; only the display is capped).
const PIONEER_LOG_DISPLAY = 10;

async function pioneerLog(ctx: Ctx, kind: string, message: string): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    await db.insert(schema.pioneerLogs).values({
      kind,
      message: message.slice(0, 500),
    });
    const newest = await db
      .select({ id: schema.pioneerLogs.id })
      .from(schema.pioneerLogs)
      .orderBy(desc(schema.pioneerLogs.id))
      .limit(PIONEER_LOG_KEEP + 1);
    if (newest.length > PIONEER_LOG_KEEP) {
      const keep = new Set(newest.slice(0, PIONEER_LOG_KEEP).map((r) => r.id));
      const all = await db
        .select({ id: schema.pioneerLogs.id })
        .from(schema.pioneerLogs);
      for (const row of all) {
        if (!keep.has(row.id)) {
          await db
            .delete(schema.pioneerLogs)
            .where(eq(schema.pioneerLogs.id, row.id));
        }
      }
    }
  } catch {
    // best effort only — the event itself already happened
  }
}

// --- Global mode （全局模式） routing ---
// When global mode is on AND the Pioneer tunnel is verified
// connected, agent requests (provider API calls, the web-token
// adapters, reply-media downloads, the web-page reader tool) go
// through the tunnel daemon's local proxy (127.0.0.1:19352, the
// port privileged.ts fixes for it) via the runtime fetch's
// per-request proxy option — the same fetch, so streaming replies
// keep streaming. The daemon in turn reaches the selected node
// through the host egress, exactly as it does for the panel's own
// tunnel fetches. When global mode is on but the tunnel is down,
// requests stay direct — never silently: the route refresh writes
// that fact to the VPN log and the panel shows 未生效. Pioneer's
// own control channel (login / server / connect), the purity
// test's deliberately-direct lookups and internal blob reads are
// NOT agent requests and never route.
//
// The fetch wrappers below receive no ctx, so the route is a
// module-level cache refreshed by every action that can start
// agent traffic (sendMessage, retryReply, testAgentConnection,
// verifyWebToken, detectDoubaoModels, runDueTriggers) and updated
// immediately by the Pioneer actions that change the tunnel or
// the switch itself.
const TUNNEL_PROXY_URL = "http://127.0.0.1:19352";

let agentRouteCache: {
  proxy: string | null;
  globalMode: boolean;
  tunnelConnected: boolean;
} = { proxy: null, globalMode: false, tunnelConnected: false };

async function refreshAgentRoute(ctx: Ctx): Promise<void> {
  try {
    const s = await loadPioneerRow(ctx);
    const tunnel = parsePioneerTunnel(s.tunnelJson);
    const tunnelConnected = !!tunnel && tunnel.state === "connected";
    const globalMode = s.globalMode === 1;
    const was = agentRouteCache;
    agentRouteCache = {
      proxy: globalMode && tunnelConnected ? TUNNEL_PROXY_URL : null,
      globalMode,
      tunnelConnected,
    };
    if (globalMode && tunnelConnected && !was.proxy) {
      await pioneerLog(
        ctx,
        "global",
        `全局模式生效：智能体请求改经 VPN 隧道发送（${s.selectedName || "已连接节点"}，出口 IP ${tunnel?.exitIp || "未知"}）`,
      );
    } else if (globalMode && !tunnelConnected && !(was.globalMode && !was.tunnelConnected)) {
      await pioneerLog(
        ctx,
        "global",
        "全局模式已开启，但 VPN 隧道未连接，智能体请求仍为直连",
      );
    } else if (!globalMode && was.proxy) {
      await pioneerLog(ctx, "global", "全局模式已关闭，智能体请求恢复直连");
    }
  } catch {
    // a failed refresh keeps the previous route and never breaks
    // the caller's real work
  }
}

/** fetch() for agent traffic: identical to fetch, except that
 * while the global-mode route is active the request is sent
 * through the Pioneer tunnel's local proxy. Loopback / private
 * targets (a user's own local model server) always stay direct —
 * the tunnel could never reach them. */
function agentFetch(url: string, init?: RequestInit): Promise<Response> {
  const proxy = agentRouteCache.proxy;
  if (!proxy) return fetch(url, init);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (!host || isPrivateHost(host)) return fetch(url, init);
  return fetch(url, { ...init, proxy } as RequestInit);
}

// --- Added agents: provider APIs, same implementation as the
// multi-agent collaborative space's seats ---
// An added agent replies only through a real HTTPS call to its own
// configured provider (OpenAI-compatible chat completions). A seat
// whose API is incomplete, or that is disabled, stays silent — the
// send path reports the reason and stores no fabricated reply. The
// API key is stored only in the agents table on the server; every
// action response carries hasApiKey instead of the key itself.

type AgentRow = typeof schema.agents.$inferSelect;

// Known vendor API bases → provider id, mirroring the client catalogue
// (same table as the collaborative space).
const PROVIDER_BASE_IDS: Record<string, string> = {
  "https://api.openai.com/v1": "openai",
  "https://generativelanguage.googleapis.com/v1beta/openai": "gemini",
  "https://api.anthropic.com/v1": "anthropic",
  "https://api.deepseek.com/v1": "deepseek",
  "https://dashscope.aliyuncs.com/compatible-mode/v1": "qwen",
  "https://api.moonshot.cn/v1": "kimi",
  "https://open.bigmodel.cn/api/paas/v4": "zhipu",
  "https://openrouter.ai/api/v1": "openrouter",
  "https://api.siliconflow.cn/v1": "siliconflow",
  "https://api.x.ai/v1": "xai",
  "https://api.mistral.ai/v1": "mistral",
};

// Best available "release recency" score for a model id (same helper
// as the collaborative space): an embedded date wins, otherwise a
// version tuple parsed from the name. Used only to order a freshly
// fetched model list newest → oldest.
function modelRecency(id: string): [number, number, number] {
  const lower = id.toLowerCase();
  const ymd = lower.match(/(20\d{2})(0[1-9]|1[0-2])([0-3]\d)/);
  if (ymd) return [Number(ymd[1]) * 10000 + Number(ymd[2]) * 100 + Number(ymd[3]), 0, 0];
  const ym = lower.match(/(20\d{2})[-_.](0[1-9]|1[0-2])/);
  if (ym) return [Number(ym[1]) * 10000 + Number(ym[2]) * 100, 0, 0];
  const ver = lower.match(/(\d+)\.(\d+)/);
  if (ver) return [0, Number(ver[1]), Number(ver[2])];
  const major = lower.match(/[-_v](\d+)(?=$|[-_.])/);
  if (major) return [0, Number(major[1]), 0];
  return [0, 0, 0];
}

function sortModelsNewestFirst(
  items: { id: string; created: number }[],
): string[] {
  return items
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => {
      if (a.created !== b.created) return b.created - a.created;
      const ra = modelRecency(a.id);
      const rb = modelRecency(b.id);
      for (let k = 0; k < 3; k++) {
        const d = (rb[k] ?? 0) - (ra[k] ?? 0);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    })
    .map((it) => it.id);
}

// Like fetchProviderModels, but on failure it reports what the
// provider actually said (HTTP status + its own error message,
// sanitized) so the settings panel can show the real reason instead
// of a generic line — the brief for 测试连接 explicitly asks for the
// provider's real error.
async function fetchProviderModelsDetailed(
  base: string,
  key: string | null,
): Promise<{ models: string[] } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await agentFetch(`${base}/models`, {
      signal: controller.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body: unknown = await res.json();
        const err =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error?: { message?: unknown } | string }).error
            : undefined;
        if (typeof err === "string") detail = sanitizeProviderErrorText(err);
        else if (err && typeof err.message === "string")
          detail = sanitizeProviderErrorText(err.message);
      } catch {
        // non-JSON error body; status alone is the real answer
      }
      return {
        error: `接口返回 ${res.status}${detail ? `：${detail}` : ""}`,
      };
    }
    const body: unknown = await res.json();
    const data =
      typeof body === "object" && body !== null && "data" in body
        ? (body as { data?: unknown }).data
        : undefined;
    if (!Array.isArray(data)) return { error: "接口未返回模型列表" };
    const items: { id: string; created: number }[] = [];
    for (const entry of data) {
      if (typeof entry === "object" && entry !== null && "id" in entry) {
        const e = entry as { id?: unknown; created?: unknown };
        if (typeof e.id === "string" && e.id !== "") {
          items.push({
            id: e.id,
            created: typeof e.created === "number" ? e.created : 0,
          });
        }
      }
    }
    if (items.length === 0) return { error: "接口返回的模型列表为空" };
    return { models: [...new Set(sortModelsNewestFirst(items))].slice(0, 600) };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "请求超时（20 秒），接口无响应" };
    }
    return { error: "网络错误，无法连接该地址" };
  } finally {
    clearTimeout(timer);
  }
}

// Third-party API gateways append their own promotional text to the
// error messages they return; strip promotional segments (bracketed
// ad blocks, group/contact invites, URLs, bare QQ numbers) before the
// text is shown. Same filter as the collaborative space.
function sanitizeProviderErrorText(raw: string): string {
  let s = raw;
  s = s.replace(/【[^】]*】/g, (m) =>
    /(QQ|群|咨询|客服|微信|公众号|加群|交流|推广)/i.test(m) ? "" : m,
  );
  s = s.replace(/\[[^\]]*\]/g, (m) =>
    /(QQ|群|咨询|客服|微信|公众号|加群|交流|推广)/i.test(m) ? "" : m,
  );
  s = s.replace(/(欢迎)?加入\s*QQ\s*群[^，。；、！？\s]*/gi, "");
  s = s.replace(/QQ\s*群\s*(咨询)?\s*[：:]?\s*\d{5,}/g, "");
  s = s.replace(/QQ\s*[：:]?\s*\d{5,}/g, "");
  s = s.replace(/(微信|公众号)\s*[：:]?\s*[A-Za-z0-9_-]{4,}/g, "");
  s = s.replace(/https?:\/\/\S+/gi, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[，。；、：:\s]+/, "").replace(/[，。；、\s]+$/, "").trim();
  return s.slice(0, 120);
}

// Per-agent thinking level （思考强度）, set inside each agent's own
// settings — same wording as the collaborative space. "默认" adds no
// extra instruction.
function thinkingInstruction(level: string): string {
  switch (level) {
    case "关闭":
      return "思考程度：关闭。不要展开思考或分析过程，直接简短给出结论，1 句即可。";
    case "低":
      return "思考程度：低。只做简单思考，回复简洁，抓住要点，1-2 句。";
    case "中":
      return "思考程度：中。适度思考后再回复，条理清晰，可分点说明。";
    case "高":
      return "思考程度：高。深入思考，全面分析利弊与细节后再回复，内容充分、有依据。";
    default:
      return "";
  }
}

async function loadAgentDisplay(
  ctx: Ctx,
  db: Db,
  agentId: number | null,
): Promise<AgentDisplay | null> {
  if (agentId == null) return null;
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  const a = rows[0];
  if (!a) return null;
  return {
    name: a.name || "智能体",
    color: a.color,
    glyph: a.glyph || (a.name || "智").slice(0, 2),
    avatarUrl: await resolveAvatarUrl(ctx, a.avatarBlobKey),
    provider: a.provider,
    connectionType: a.connectionType,
    configured: isAgentConfigured(a),
  };
}

// An added agent counts as configured when it can actually reply:
// for an API agent, a complete API address + key + model; for a
// DeepSeek web agent, a stored token whose login is verified.
function isAgentConfigured(a: AgentRow): boolean {
  if (a.connectionType === "web") {
    return a.webToken.trim() !== "" && a.webStatus === "logged_in";
  }
  return (
    a.apiBase.trim() !== "" && a.apiKey.trim() !== "" && a.model.trim() !== ""
  );
}

/** One content part of a multimodal API message: the OpenAI-style
 * shape vision models take — a text part and/or an image_url part
 * whose URL is the picture's own data URI. */
type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string | AgentContentPart[];
};

// Builds the OpenAI-style message list for one agent reply: what goes
// into the system message is ONLY what the user configured — the
// agent's own system prompt, the global custom instructions and
// skills the user enabled, its role line, its thinking level — plus
// the granted-file data the user switched on (which is labelled as
// system-attached data, not user speech). Nothing else is added:
// in particular no model-identity line is appended — the user never
// typed one, and agents were reciting it back as if the user had
// said it. Asked what model it is, an agent answers from its own
// knowledge like it would anywhere else.
/** An agent's standing instructions: its system prompt with the
 * legacy long-term-memory text folded in. The two used to be
 * separate settings fields; the user judged a hand-written
 * "memory" field a duplicate of the system prompt, so there is
 * now ONE field （系统指令） — the settings panels write the
 * combined text into system_prompt and clear memory, and this
 * helper keeps rows saved before the merge behaving identically
 * (their memory text still applies, appended to the prompt,
 * until the settings are next saved). For web-token agents the
 * official account's own memory is separate again: it lives in
 * the account's官网 conversations, which each room now keeps
 * fixed (see web_remote_conversations). */
function standingInstructions(systemPrompt: string, memory: string): string {
  return [systemPrompt.trim(), memory.trim()]
    .filter((s) => s !== "")
    .join("\n\n");
}

/** How members of a shared room should treat each other's lines
 * — the framing every multi-agent product converges on (one
 * shared transcript, clear speaker attribution, build on what
 * was said instead of re-litigating it). Without it, a member
 * receiving the flattened transcript tends to treat the other
 * members' real statements as text the user pasted in and asks
 * for clarification about them, or repeats the question and the
 * answers already given. Injected only when the history really
 * contains another member's reply. */
const ROOM_CONDUCT =
  "【共同对话说明】这个房间里除了你还有其他智能体成员，记录中其他成员的发言是他们在这个房间里真实说过的话，不是用户粘贴、引用或虚构的文本，不要质疑这些发言的来源，也不要就他们已经说清楚的事情再向用户提问澄清。直接在他们发言的基础上往下推进：不要复述用户的问题，不要重复别人已经给出的答案，只补充你自己的新信息、新角度或结论；有不同意见时直接说清分歧点，不要把问题重新抛回给用户。";

function buildAgentChatMessages(
  agent: AgentRow,
  history: MessageRow[],
  nameOf: NameOf = (agentId) => (agentId == null ? "Muse" : "智能体"),
  filesContext = "",
  globalInstructions = "",
  stageContext = "",
  chatImage: ChatImage | null = null,
): ChatMsg[] {
  const parts: string[] = [];
  const standing = standingInstructions(agent.systemPrompt, agent.memory);
  if (standing) parts.push(standing);
  if (globalInstructions)
    parts.push(
      `用户为这个空间里的所有智能体设定的全局自定义指令（对每个智能体都生效，请遵守）：\n${globalInstructions}`,
    );
  // Shared-room conduct: only when another member has actually
  // spoken in this room's history (a solo room needs no such
  // framing).
  if (history.some((r) => r.role === "assistant" && r.agentId !== agent.id))
    parts.push(ROOM_CONDUCT);
  if (stageContext) parts.push(stageContext);
  if (agent.role.trim()) parts.push(`你的角色：${agent.role.trim()}`);
  if (filesContext) parts.push(filesContext);
  const hostCtx = buildHostPermissionContext(hostPermsOf(agent), false);
  if (hostCtx) parts.push(hostCtx);
  const ti = thinkingInstruction(agent.thinking);
  if (ti) parts.push(ti);
  const msgs: ChatMsg[] = [];
  if (parts.length > 0) msgs.push({ role: "system", content: parts.join("\n") });
  for (const row of history) {
    const body = row.content
      ? row.content
      : row.imageBlobKey
        ? row.fileMime && row.fileMime.startsWith("video/")
          ? "（发送了一段视频）"
          : row.fileMime && row.fileMime.startsWith("audio/")
            ? "（发送了一段音频）"
            : row.fileMime && !row.fileMime.startsWith("image/")
              ? `（发送了文件：${row.fileName ?? "文件"}）`
              : "（发送了一张图片）"
        : "";
    if (!body) continue;
    if (row.role === "user") {
      // The turn that carries the room's current picture goes out
      // as a REAL multimodal message — the user's words as a text
      // part and the picture itself as an image_url data-URI part
      // — not as the "（发送了一张图片）" text placeholder. Only
      // that one turn is multimodal: older picture turns stay
      // text context, so a non-vision model is only ever asked to
      // look at the picture the user is actually asking about.
      if (chatImage && row.id === chatImage.messageId) {
        msgs.push({
          role: "user",
          content: [
            {
              type: "text",
              text: row.content ? row.content : "（用户发送了这张图片）",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${chatImage.mimeType};base64,${chatImage.dataBase64}`,
              },
            },
          ],
        });
        continue;
      }
      msgs.push({ role: "user", content: body });
    } else if (row.agentId === agent.id) {
      msgs.push({ role: "assistant", content: body });
    } else {
      // Another group member's message: context for this agent, not
      // its own words — presented as an incoming line with the
      // speaker's name attached.
      msgs.push({ role: "user", content: `${nameOf(row.agentId)}：${body}` });
    }
  }
  return msgs;
}

// The provider's id for a configured API base: the stored provider
// field wins (it is what the user picked in the settings), the
// known-base table is the fallback for agents whose provider field
// is stale or 自定义 with a recognised address.
function providerIdOf(agent: AgentRow, base: string): string {
  if (agent.provider && agent.provider !== "custom") return agent.provider;
  return PROVIDER_BASE_IDS[base] ?? agent.provider ?? "custom";
}

// Native reasoning / thinking fields for one agent's thinking level,
// in the dialect that provider's own API documents — the major
// vendors all expose a thinking-strength control on their official
// APIs now, each under its own name:
//   OpenAI / OpenRouter / xAI / Gemini (OpenAI-compatible layer):
//     reasoning_effort low|medium|high （关闭 → minimal where the
//     API accepts it)
//   Anthropic (Claude): thinking { type, budget_tokens } — the
//     budget grows with the level and is capped below the reply's
//     own token ceiling, as Anthropic requires budget < max_tokens
//   通义千问 (DashScope compatible mode): enable_thinking +
//     thinking_budget
//   智谱 GLM / DeepSeek / Kimi: thinking { type: enabled|disabled }
//     (DeepSeek and Kimi additionally accept reasoning_effort)
//   Mistral / 硅基流动 / 豆包 / 混元 / 文心 and unknown gateways:
//     reasoning_effort, the most widely accepted spelling
// "默认" sends nothing at all. The system-prompt instruction from
// thinkingInstruction stays in place for every provider as the
// fallback, and callExternalAgent retries once without any of
// these fields (or the advanced parameters) when a provider
// rejects them with a 400/422, so a strict gateway can never turn
// a working agent silent just because it dislikes an extra field.
function reasoningFields(
  providerId: string,
  thinking: string,
  outputCeiling: number,
): Record<string, unknown> {
  if (thinking === "默认") return {};
  const effort =
    thinking === "低"
      ? "low"
      : thinking === "中"
        ? "medium"
        : thinking === "高"
          ? "high"
          : null;
  const budget = Math.max(
    1024,
    Math.min(
      thinking === "低" ? 2048 : thinking === "中" ? 8192 : 24576,
      outputCeiling - 512,
    ),
  );
  switch (providerId) {
    case "anthropic":
      return thinking === "关闭"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled", budget_tokens: budget } };
    case "qwen":
      return thinking === "关闭"
        ? { enable_thinking: false }
        : { enable_thinking: true, thinking_budget: budget };
    case "zhipu":
      return { thinking: { type: thinking === "关闭" ? "disabled" : "enabled" } };
    case "deepseek":
      return thinking === "关闭"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled" }, ...(effort ? { reasoning_effort: effort } : {}) };
    case "kimi":
      return thinking === "关闭"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled" }, ...(effort ? { reasoning_effort: effort } : {}) };
    case "xai":
      // Grok's API accepts low|medium|high only — no minimal/off.
      return effort ? { reasoning_effort: effort } : {};
    case "openai":
    case "openrouter":
    case "gemini":
      return thinking === "关闭"
        ? { reasoning_effort: "minimal" }
        : effort
          ? { reasoning_effort: effort }
          : {};
    default:
      return effort ? { reasoning_effort: effort } : {};
  }
}

// --- Built-in tools for API agents （工具调用） ---
// When an agent's toolMode is set, the chat-completions request
// carries these three function definitions plus tool_choice. They
// are tools this server can REALLY execute — no tool is offered
// that has nothing behind it:
//   get_current_time — the server's current date/time (UTC and
//     Asia/Shanghai, the user's timezone)
//   calculate — arithmetic over a small safe expression parser
//     (no eval: numbers, + - * / % ^, parentheses, and a fixed
//     set of math functions/constants)
//   fetch_web_page — GET one public http(s) page and return its
//     readable text; loopback / private-network addresses are
//     refused, so a model cannot be talked into probing the
//     server's own services (the Pioneer tunnel daemon included)
// The model only ever DECIDES to call; execution happens here,
// the result goes back as a tool message, and the model answers
// from it. At most MAX_TOOL_ROUNDS tool rounds per reply.
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "获取当前日期和时间（包含星期）。当问题涉及今天、现在、日期或时间时调用。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description:
        "计算一个算术表达式并返回精确结果。支持 + - * / % ^、括号，以及 sqrt、abs、floor、ceil、round、sin、cos、tan、log、exp 和常量 pi、e。需要精确计算时调用，不要自己心算。",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "要计算的算术表达式，如 (128 * 1.13) / 7 或 sqrt(2) + pi",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_web_page",
      description:
        "打开一个公开网页并返回它的正文文本（已去掉标签）。当用户给出网址、或需要查看某个页面的实际内容时调用。只能访问公开的 http/https 地址，本机和内网地址会被拒绝。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的完整网址，含 http:// 或 https://" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
] as const;

// The host-permission tools: offered to an API agent ONLY while
// the matching per-agent switch is on (run_linux_command ←
// can_exec_linux; the three file tools ← can_edit_files). They
// execute for real in the privileged layer (see the host
// permissions section above for scope and refusals), and
// executeAgentTool re-checks the switch on every call.
const HOST_TOOLS = [
  {
    type: "function",
    function: {
      name: "run_linux_command",
      description:
        "在这台 Linux 主机上真的执行一条命令并返回退出码和输出。工作目录是 ~/workspace，单条最长 30 秒，输出有上限。当用户要求执行命令、查看系统状态或处理文件时调用。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的完整命令，如 ls -la 或 df -h",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_host_files",
      description:
        "列出这台主机一个目录下的文件和子目录。范围限 ~/workspace、~/memory、/tmp。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "目录的绝对路径，如 /home/hatch/workspace",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_host_file",
      description:
        "读取这台主机上一个文本文件的真实内容。范围限 ~/workspace、~/memory、/tmp 下的文本文件；敏感凭证路径会被拒绝。改文件前先用它读原文。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的绝对路径" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_host_file",
      description:
        "把完整新内容真的写入这台主机上的一个文本文件（不存在则新建，父目录自动创建，原文件会被整份覆盖）。范围限 ~/workspace、~/memory、/tmp。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的绝对路径" },
          content: { type: "string", description: "文件的完整新内容" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
] as const;

const MAX_TOOL_ROUNDS = 5;

/** A tiny recursive-descent arithmetic parser for the calculate
 * tool — deliberately NOT eval: anything that is not a number, a
 * known operator/function/constant or parentheses is an error. */
function evaluateExpression(src: string): number {
  let pos = 0;
  const peek = () => src[pos] ?? "";
  const skipWs = () => {
    while (pos < src.length && /\s/.test(src[pos] ?? "")) pos++;
  };
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      skipWs();
      const c = peek();
      if (c === "+") {
        pos++;
        v += parseTerm();
      } else if (c === "-") {
        pos++;
        v -= parseTerm();
      } else return v;
    }
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      skipWs();
      const c = peek();
      if (c === "*") {
        pos++;
        v *= parseFactor();
      } else if (c === "/") {
        pos++;
        const d = parseFactor();
        if (d === 0) throw new Error("除数不能为 0");
        v /= d;
      } else if (c === "%") {
        pos++;
        const d = parseFactor();
        if (d === 0) throw new Error("除数不能为 0");
        v %= d;
      } else return v;
    }
  }
  function parseFactor(): number {
    const base = parseUnary();
    skipWs();
    if (peek() === "^") {
      pos++;
      return Math.pow(base, parseFactor());
    }
    return base;
  }
  function parseUnary(): number {
    skipWs();
    if (peek() === "-") {
      pos++;
      return -parseUnary();
    }
    if (peek() === "+") {
      pos++;
      return parseUnary();
    }
    return parseAtom();
  }
  function parseAtom(): number {
    skipWs();
    if (peek() === "(") {
      pos++;
      const v = parseExpr();
      skipWs();
      if (peek() !== ")") throw new Error("括号不匹配");
      pos++;
      return v;
    }
    const rest = src.slice(pos);
    const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      pos += num[0].length;
      return Number(num[0]);
    }
    const ident = /^[A-Za-z]+/.exec(rest);
    if (ident) {
      const name = ident[0].toLowerCase();
      pos += ident[0].length;
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      const fns: Record<string, (x: number) => number> = {
        sqrt: Math.sqrt,
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        log: Math.log,
        exp: Math.exp,
      };
      const fn = fns[name];
      if (!fn) throw new Error(`不支持的函数或常量：${ident[0]}`);
      skipWs();
      if (peek() !== "(") throw new Error(`函数 ${ident[0]} 后需要括号`);
      pos++;
      const arg = parseExpr();
      skipWs();
      if (peek() !== ")") throw new Error("括号不匹配");
      pos++;
      return fn(arg);
    }
    throw new Error(`无法解析的表达式：${src.slice(0, 60)}`);
  }
  const v = parseExpr();
  skipWs();
  if (pos < src.length) throw new Error(`无法解析的表达式：${src.slice(0, 60)}`);
  if (!Number.isFinite(v)) throw new Error("计算结果不是有限数值");
  return v;
}

/** Whether a URL points at the machine itself or a private
 * network — the fetch_web_page tool refuses those outright. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal"))
    return true;
  if (h === "::1" || h === "::") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** Executes one built-in tool call for an API agent and returns
 * the result text that goes back to the model. Failures are
 * returned as honest error text (the model can then say so),
 * never thrown and never fabricated. */
async function executeAgentTool(
  ctx: Ctx,
  name: string,
  argsJson: string,
  perms: HostPerms = { exec: false, edit: false },
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(argsJson || "{}");
    if (typeof parsed === "object" && parsed !== null)
      args = parsed as Record<string, unknown>;
  } catch {
    return "工具参数不是合法的 JSON，无法执行。";
  }
  if (name === "get_current_time") {
    const now = new Date();
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);
    return `当前时间：北京时间（Asia/Shanghai）${fmt("Asia/Shanghai")}；UTC ${fmt("UTC")}。`;
  }
  if (name === "calculate") {
    const expr = typeof args.expression === "string" ? args.expression : "";
    if (!expr.trim()) return "缺少要计算的表达式。";
    if (expr.length > 200) return "表达式太长，无法计算。";
    try {
      const v = evaluateExpression(expr);
      const rounded = Math.abs(v) < 1e15 ? Math.round(v * 1e10) / 1e10 : v;
      return `${expr} = ${rounded}`;
    } catch (e) {
      return `计算失败：${e instanceof Error ? e.message : "表达式无效"}`;
    }
  }
  if (name === "fetch_web_page") {
    const raw = typeof args.url === "string" ? args.url.trim() : "";
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return "网址格式不正确，无法打开。";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "只支持 http/https 网址。";
    if (isPrivateHost(url.hostname))
      return "该地址是本机或内网地址，出于安全原因不能访问。";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await agentFetch(url.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          Accept: "text/html, text/plain;q=0.9, */*;q=0.5",
        },
      });
      if (!res.ok) return `打开失败：对方返回 HTTP ${res.status}。`;
      const finalUrl = new URL(res.url || raw);
      if (isPrivateHost(finalUrl.hostname))
        return "该网址跳转到了本机或内网地址，已停止访问。";
      const rawText = await res.text();
      const ctype = res.headers.get("content-type") ?? "";
      let text: string;
      if (ctype.includes("html") || /^\s*<!doctype html/i.test(rawText)) {
        const title =
          /<title[^>]*>([^<]*)<\/title>/i.exec(rawText)?.[1]?.trim() ?? "";
        text = rawText
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
        if (title) text = `标题：${title}\n${text}`;
      } else if (
        ctype.startsWith("text/") ||
        ctype.includes("json") ||
        ctype.includes("xml")
      ) {
        text = rawText.trim();
      } else {
        return `该网址的内容类型是 ${ctype || "未知"}，不是可读的文本网页，无法提取正文。`;
      }
      if (!text) return "页面打开了，但没有提取到正文内容。";
      const CAP = 8000;
      return (
        `网址：${finalUrl.toString()}\n` +
        (text.length > CAP
          ? `${text.slice(0, CAP)}\n…（正文共 ${text.length} 字，已截断到前 ${CAP} 字）`
          : text)
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError")
        return "打开超时（15 秒），没有拿到页面内容。";
      return "打开失败：网络错误，没有拿到页面内容。";
    } finally {
      clearTimeout(timer);
    }
  }
  if (name === "run_linux_command") {
    if (!perms.exec)
      return "该智能体没有开启「执行 Linux 命令」权限，命令未执行。请如实告诉用户：需要在这个智能体的设置里打开该权限。";
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (!command) return "缺少要执行的命令。";
    const r = await ctx.executePrivileged(privileged.execLinuxCommand, {
      command,
      timeoutSecs: 30,
    });
    const out = [r.stdout.trim(), r.stderr.trim()]
      .filter((s) => s !== "")
      .join("\n");
    return `命令：${command}\n退出码：${r.exitCode}${r.timedOut ? "（超时被终止）" : ""}${r.error ? `\n${r.error}` : ""}${out ? `\n输出：\n${out}` : "\n（无输出）"}`;
  }
  if (name === "list_host_files") {
    if (!perms.edit)
      return "该智能体没有开启「编辑主机文件」权限，无法列出主机文件。请如实告诉用户：需要在这个智能体的设置里打开该权限。";
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return "缺少目录路径。";
    const r = await ctx.executePrivileged(privileged.hostListDir, { path });
    if (!r.ok) return `列出失败：${r.error}`;
    if (r.entries.length === 0) return `${path} 是空目录。`;
    return (
      `${path} 下共 ${r.entries.length} 项：\n` +
      r.entries
        .map((e) => `${e.isDir ? "[目录]" : "[文件]"} ${e.name}${e.isDir ? "" : `（${e.size} 字节）`}`)
        .join("\n")
    );
  }
  if (name === "read_host_file") {
    if (!perms.edit)
      return "该智能体没有开启「编辑主机文件」权限，无法读取主机文件。请如实告诉用户：需要在这个智能体的设置里打开该权限。";
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return "缺少文件路径。";
    const r = await ctx.executePrivileged(privileged.hostReadFile, { path });
    if (!r.ok) return `读取失败：${r.error}`;
    return `文件 ${path} 的内容${r.truncated ? "（过长，已截断）" : ""}：\n${r.content}`;
  }
  if (name === "write_host_file") {
    if (!perms.edit)
      return "该智能体没有开启「编辑主机文件」权限，无法写入主机文件。请如实告诉用户：需要在这个智能体的设置里打开该权限。";
    const path = typeof args.path === "string" ? args.path.trim() : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!path) return "缺少文件路径。";
    const r = await ctx.executePrivileged(privileged.hostWriteFile, {
      path,
      content,
    });
    if (!r.ok) return `写入失败：${r.error}`;
    return `已写入文件 ${path}（${r.bytes} 字节）。`;
  }
  return `未知的工具：${name}`;
}

/** One accumulated tool call from a (possibly streamed) completion. */
type ToolCallAcc = { id: string; name: string; args: string };

/** Splits a chat-completions content value into its text and
 * any generated media it carries. Content is usually a plain
 * string; multimodal models may answer with a PARTS array —
 * text parts plus image parts (an image_url object whose URL
 * is an https link or an inline data: URI, or a b64_json
 * payload). The parts are the model's structured output, not
 * prose, so media found here is a generated file, exactly like
 * a web reply's media blocks. */
function extractContentParts(content: unknown): {
  text: string;
  media: WebMediaItem[];
} {
  if (typeof content === "string") return { text: content, media: [] };
  if (!Array.isArray(content)) return { text: "", media: [] };
  let text = "";
  const media: WebMediaItem[] = [];
  for (const part of content) {
    const p = asRecord(part);
    if (!p) continue;
    const type = typeof p.type === "string" ? p.type : "";
    if (type === "text" && typeof p.text === "string") {
      text += p.text;
      continue;
    }
    if (typeof p.b64_json === "string" && p.b64_json) {
      media.push({
        kind: "image",
        url: `data:image/png;base64,${p.b64_json}`,
      });
      continue;
    }
    if (type === "image_url" || type === "image" || type === "output_image") {
      const url =
        (typeof asRecord(p.image_url)?.url === "string"
          ? (asRecord(p.image_url)?.url as string)
          : "") ||
        (typeof p.url === "string" ? p.url : "");
      if (url.startsWith("https://") || url.startsWith("data:"))
        media.push({ kind: "image", url });
      continue;
    }
  }
  return { text, media };
}

/** Parses a non-streamed chat-completions JSON body into its text
 * content, any generated media the reply carried, plus any tool
 * calls the model wants executed. */
function parseJsonCompletion(body: unknown): {
  content: string;
  toolCalls: ToolCallAcc[];
  media: WebMediaItem[];
} {
  const choices =
    typeof body === "object" && body !== null && "choices" in body
      ? (body as { choices?: unknown }).choices
      : undefined;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const message =
    typeof firstChoice === "object" && firstChoice !== null && "message" in firstChoice
      ? (firstChoice as { message?: unknown }).message
      : undefined;
  const rec = asRecord(message);
  const parts = extractContentParts(rec?.content);
  let content = parts.text;
  const media: WebMediaItem[] = [...parts.media];
  // Audio-output models answer in message.audio: a base64
  // payload plus its transcript (the transcript is the text
  // when the reply carries no separate content).
  const audio = asRecord(rec?.audio);
  if (audio && typeof audio.data === "string" && audio.data) {
    const fmt = typeof audio.format === "string" ? audio.format : "wav";
    const mime =
      fmt === "mp3"
        ? "audio/mpeg"
        : fmt === "flac"
          ? "audio/flac"
          : fmt === "opus"
            ? "audio/opus"
            : "audio/wav";
    media.push({ kind: "audio", url: `data:${mime};base64,${audio.data}` });
    if (!content && typeof audio.transcript === "string")
      content = audio.transcript;
  }
  // Media fields some gateways attach to the message itself
  // (an images array, a generated file object): harvested from
  // the message's structured fields, never from its prose.
  if (rec) {
    const rest: Record<string, unknown> = { ...rec };
    delete rest.content;
    delete rest.audio;
    media.push(
      ...collectMediaFromValue(rest, {
        skipKeys: ["tool_calls", "reasoning_content", "refusal"],
      }),
    );
  }
  const toolCalls: ToolCallAcc[] = [];
  if (Array.isArray(rec?.tool_calls)) {
    for (const tc of rec.tool_calls) {
      const t = asRecord(tc);
      const fn = asRecord(t?.function);
      if (fn && typeof fn.name === "string" && fn.name) {
        toolCalls.push({
          id: typeof t?.id === "string" ? t.id : "",
          name: fn.name,
          args: typeof fn.arguments === "string" ? fn.arguments : "",
        });
      }
    }
  }
  const seen = new Set<string>();
  return {
    content,
    toolCalls,
    media: media.filter((m) =>
      seen.has(m.url) ? false : (seen.add(m.url), true),
    ),
  };
}

/** Consumes a streamed (SSE) chat-completions response: content
 * deltas are accumulated and reported through onPartial as they
 * arrive; tool-call deltas are reassembled by index. Returns the
 * same shape as parseJsonCompletion. */
async function parseStreamCompletion(
  res: Response,
  onPartial?: (partial: string) => void | Promise<void>,
): Promise<{ content: string; toolCalls: ToolCallAcc[]; media: WebMediaItem[] }> {
  if (!res.body) throw new Error("流式响应没有内容");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const bag = new MediaBag();
  const callsByIndex = new Map<number, ToolCallAcc>();
  const handleData = async (data: string) => {
    if (data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // a non-JSON keep-alive line — ignore
    }
    const choices = asRecord(parsed)?.choices;
    const first = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const delta = asRecord(first?.delta) ?? asRecord(first?.message);
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      if (onPartial) await onPartial(content);
    } else if (Array.isArray(delta.content)) {
      // A streamed parts array: text parts stream in, image
      // parts are collected as generated media.
      const parts = extractContentParts(delta.content);
      if (parts.text) {
        content += parts.text;
        if (onPartial) await onPartial(content);
      }
      bag.add(parts.media);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const rawTc of delta.tool_calls) {
        const tc = asRecord(rawTc);
        if (!tc) continue;
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const acc = callsByIndex.get(idx) ?? { id: "", name: "", args: "" };
        if (typeof tc.id === "string" && tc.id) acc.id = tc.id;
        const fn = asRecord(tc.function);
        if (fn) {
          if (typeof fn.name === "string" && fn.name) acc.name = fn.name;
          if (typeof fn.arguments === "string") acc.args += fn.arguments;
        }
        callsByIndex.set(idx, acc);
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) await handleData(line.slice(5).trim());
      nl = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) await handleData(tail.slice(5).trim());
  const toolCalls = [...callsByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c)
    .filter((c) => c.name);
  return { content, toolCalls, media: bag.items };
}

/** The sink a streaming reply writes its partial text into: the
 * first chunk inserts the reply's message row already flagged
 * streaming, later chunks update it (throttled — partials are the
 * full text so far, so skipped writes lose nothing), complete()
 * swaps in the final processed text and clears the flag, and
 * discard() removes the row when the reply failed or stayed
 * silent, so a half-written bubble never survives a failure. */
type StreamSink = {
  onPartial: (partial: string) => Promise<void>;
  complete: (finalText: string) => Promise<MessageRow | null>;
  discard: () => Promise<void>;
};

function createStreamSink(
  db: Db,
  conversationId: number,
  agentId: number | null,
): StreamSink {
  let rowId: number | null = null;
  let lastWriteAt = 0;
  let chain: Promise<void> = Promise.resolve();
  const onPartial = (partial: string): Promise<void> => {
    chain = chain
      .then(async () => {
        if (!partial) return;
        const now = Date.now();
        if (rowId != null && now - lastWriteAt < 350) return;
        lastWriteAt = now;
        if (rowId == null) {
          const inserted = await db
            .insert(schema.messages)
            .values({
              conversationId,
              role: "assistant",
              agentId,
              content: partial,
              streaming: 1,
            })
            .returning();
          rowId = inserted[0]?.id ?? null;
        } else {
          await db
            .update(schema.messages)
            .set({ content: partial })
            .where(eq(schema.messages.id, rowId));
        }
      })
      .catch(() => {
        // a failed partial write must not break the reply itself;
        // the final text is written by complete() regardless
      });
    return chain;
  };
  return {
    onPartial,
    complete: async (finalText: string) => {
      await chain;
      if (rowId == null) return null;
      await db
        .update(schema.messages)
        .set({ content: finalText, streaming: 0 })
        .where(eq(schema.messages.id, rowId));
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, rowId));
      return rows[0] ?? null;
    },
    discard: async () => {
      await chain;
      if (rowId == null) return;
      await db
        .delete(schema.messages)
        .where(eq(schema.messages.id, rowId));
      rowId = null;
    },
  };
}

// Real call to the agent's own provider (OpenAI-compatible chat
// completions) — same implementation as the collaborative space's
// callExternalApi, minus its group-discussion extras.
async function callExternalAgent(
  ctx: Ctx,
  agent: AgentRow,
  history: MessageRow[],
  nameOf?: NameOf,
  filesContext = "",
  globalInstructions = "",
  onPartial?: (partial: string) => void | Promise<void>,
  stageContext = "",
  chatImage: ChatImage | null = null,
): Promise<
  | { ok: true; text: string; media?: WebMediaItem[] }
  | { ok: false; error: string }
> {
  const base = agent.apiBase.trim().replace(/\/+$/, "");
  const key = agent.apiKey.trim();
  const model = agent.model.trim();
  if (!base || !key || !model) {
    return { ok: false, error: "未配置真实 API（缺地址、Key 或模型）" };
  }
  if (!/^https:\/\//i.test(base)) {
    return { ok: false, error: "API 地址必须以 https:// 开头" };
  }
  const chatMessages = buildAgentChatMessages(
    agent,
    history,
    nameOf,
    filesContext,
    globalInstructions,
    stageContext,
    chatImage,
  );
  const streaming = agent.streamEnabled === 1;
  const timeoutMs = streaming ? 120_000 : 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The request body: core fields always; the agent's advanced
  // parameters （高级 API 参数）, the provider-native reasoning
  // fields, streaming and tools only when set. max_completion_tokens,
  // when set, REPLACES max_tokens (that is its purpose for reasoning
  // models). buildBody(false) is the bare core body used by the
  // one retry below.
  // No space-side ceiling on the reply length, by the user's
  // explicit request: the agent's own 最大输出 Token setting is
  // sent as configured, however large; only the provider's own
  // limits apply.
  const maxTokens = Math.max(agent.maxTokens, 1);
  const maxCompletion =
    agent.maxCompletionTokens != null
      ? Math.max(agent.maxCompletionTokens, 1)
      : null;
  const stopList = agent.stopSequences
    .split(/[\n,，、]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, 4);
  const providerId = providerIdOf(agent, base);
  // The wire message list: starts as the built history; tool
  // rounds append the assistant's tool calls and their results.
  type WireMsg = Record<string, unknown>;
  const workMsgs: WireMsg[] = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const buildBody = (
    withExtras: boolean,
    msgs: WireMsg[],
  ): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model,
      messages: msgs,
      temperature: agent.temperature,
      ...(maxCompletion != null
        ? { max_completion_tokens: maxCompletion }
        : { max_tokens: maxTokens }),
    };
    if (!withExtras) return body;
    if (agent.topP != null) body.top_p = agent.topP;
    if (agent.frequencyPenalty != null)
      body.frequency_penalty = agent.frequencyPenalty;
    if (agent.presencePenalty != null)
      body.presence_penalty = agent.presencePenalty;
    if (agent.seed != null) body.seed = agent.seed;
    if (stopList.length > 0) body.stop = stopList;
    if (agent.responseFormat === "json_object" || agent.responseFormat === "text")
      body.response_format = { type: agent.responseFormat };
    Object.assign(
      body,
      reasoningFields(providerId, agent.thinking, maxCompletion ?? maxTokens),
    );
    if (streaming) body.stream = true;
    // The tool list is per agent: the three built-in tools ride
    // on toolMode, the host-permission tools ride on their own
    // switches — each host tool is offered only while its switch
    // is on, independently of toolMode. When only host tools are
    // in play, tool_choice is 'auto' (the model decides).
    const perms = hostPermsOf(agent);
    const tools: unknown[] = [];
    if (agent.toolMode !== "") tools.push(...AGENT_TOOLS);
    if (perms.exec)
      tools.push(...HOST_TOOLS.filter((t) => t.function.name === "run_linux_command"));
    if (perms.edit)
      tools.push(...HOST_TOOLS.filter((t) => t.function.name !== "run_linux_command"));
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = agent.toolMode !== "" ? agent.toolMode : "auto";
    }
    return body;
  };
  const hasExtras =
    agent.topP != null ||
    agent.frequencyPenalty != null ||
    agent.presencePenalty != null ||
    agent.seed != null ||
    stopList.length > 0 ||
    agent.responseFormat !== "" ||
    streaming ||
    agent.toolMode !== "" ||
    agent.canExecLinux === 1 ||
    agent.canEditFiles === 1 ||
    Object.keys(
      reasoningFields(providerId, agent.thinking, maxCompletion ?? maxTokens),
    ).length > 0;
  // Once a strict provider rejects the extras with a 400/422, the
  // rest of this reply (tool rounds included) uses the bare body.
  let extrasDropped = false;
  const post = (msgs: WireMsg[]) =>
    agentFetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildBody(!extrasDropped, msgs)),
    });
  // One completion round: posts, applies the drop-extras retry on
  // the first 400/422, and parses the answer (SSE when streaming
  // is live, plain JSON otherwise — a gateway that ignores the
  // stream flag and answers JSON is handled too).
  const completionRound = async (
    msgs: WireMsg[],
  ): Promise<
    | { ok: true; content: string; toolCalls: ToolCallAcc[]; media: WebMediaItem[] }
    | { ok: false; error: string }
  > => {
    let res = await post(msgs);
    if ((res.status === 400 || res.status === 422) && hasExtras && !extrasDropped) {
      extrasDropped = true;
      res = await post(msgs);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body: unknown = await res.json();
        const err =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error?: { message?: unknown } }).error
            : undefined;
        if (err && typeof err.message === "string")
          detail = sanitizeProviderErrorText(err.message);
      } catch {
        // non-JSON error body; status alone is enough
      }
      return { ok: false, error: `API 返回 ${res.status}${detail ? `：${detail}` : ""}` };
    }
    const useStream =
      streaming &&
      !extrasDropped &&
      (res.headers.get("content-type") ?? "").includes("text/event-stream");
    if (useStream) {
      const parsed = await parseStreamCompletion(res, onPartial);
      return {
        ok: true,
        content: parsed.content,
        toolCalls: parsed.toolCalls,
        media: parsed.media,
      };
    }
    const body: unknown = await res.json();
    const parsed = parseJsonCompletion(body);
    return {
      ok: true,
      content: parsed.content,
      toolCalls: parsed.toolCalls,
      media: parsed.media,
    };
  };
  try {
    for (let round = 0; ; round++) {
      const r = await completionRound(workMsgs);
      if (!r.ok) return r;
      if (r.toolCalls.length === 0) {
        const text = r.content.trim();
        // A media-only reply (a generated image or audio with
        // no prose) is a real reply, not an empty one.
        if (!text && !r.media.length)
          return { ok: false, error: "API 返回了空内容" };
        return { ok: true, text, media: r.media.length ? r.media : undefined };
      }
      if (round >= MAX_TOOL_ROUNDS) {
        return {
          ok: false,
          error: `模型连续调用工具超过 ${MAX_TOOL_ROUNDS} 轮，已停止`,
        };
      }
      // Execute every requested tool for real and feed the results
      // back, then let the model continue from them.
      workMsgs.push({
        role: "assistant",
        content: r.content ? r.content : null,
        tool_calls: r.toolCalls.map((tc, i) => ({
          id: tc.id || `call_${round}_${i}`,
          type: "function",
          function: { name: tc.name, arguments: tc.args || "{}" },
        })),
      });
      for (const [i, tc] of r.toolCalls.entries()) {
        const result = await executeAgentTool(
          ctx,
          tc.name,
          tc.args || "{}",
          hostPermsOf(agent),
        );
        workMsgs.push({
          role: "tool",
          tool_call_id: tc.id || `call_${round}_${i}`,
          content: result,
        });
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `API 调用超时（${timeoutMs / 1000} 秒）` };
    }
    return { ok: false, error: "API 调用失败：网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

// --- DeepSeek web agents (connection_type = "web") ---
// A web agent does NOT use the official DeepSeek API. It replays the
// private web API of chat.deepseek.com with the user's own logged-in
// web session, following the protocol documented at
// https://github.com/rizxfrog/CLIProxyAPI-Plus/blob/HEAD/docs/deepseek-web.md
// (consulted 2026-11-17): GET /api/v0/users/current (validate) ->
// POST /api/v0/chat_session/create -> POST /api/v0/chat/create_pow_challenge
// + a local DeepSeekHashV1 solver (Keccak-f[1600] rounds 1..23, rate 136,
// separator 0x06) -> POST /api/v0/chat/completion with the
// x-ds-pow-response header, whose patch-style SSE stream is parsed back
// into the reply text (THINK fragments excluded). The credential is the
// web page's userToken from Local Storage after the user signs in on the
// official site — sign-in, captcha and verification happen on DeepSeek's
// own page; this space never asks for the account password. The token is
// server-side only (agents.web_token): no action ever returns it, and
// listAgents exposes only {webStatus, webAccount, webError}. DeepSeek
// answers HTTP 200 with a nonzero business code on failure, so every web
// call checks the body code, not just HTTP status; auth failures flip
// the agent to expired (HTTP 401 / business 40001/40003) or blocked
// (HTTP 403) with DeepSeek's real message.
// The token is short-lived with no refresh token, so expiry is a normal,
// honestly reported state. This is an unofficial route that may break
// when DeepSeek changes its web interface and may violate DeepSeek's
// terms / risk the account — the settings UI says so plainly.
const DS_WEB_BASE = "https://chat.deepseek.com";

function unwrapDeepseekToken(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(t);
      const rec = asRecord(parsed);
      const v = strField(rec?.value);
      if (v) return v.trim();
    } catch {
      // not JSON — fall through and use the raw string
    }
  }
  return t;
}

function dsWebHeaders(token: string): Record<string, string> {
  return {
    Accept: "*/*",
    Authorization: `Bearer ${token}`,
    Origin: DS_WEB_BASE,
    Referer: `${DS_WEB_BASE}/`,
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "x-client-bundle-id": "com.deepseek.chat",
    "x-client-platform": "web",
    "x-client-version": "2.4.0",
    "x-client-locale": "zh_CN",
  };
}

function dsBizData(root: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!root) return null;
  const data = asRecord(root.data);
  const biz = asRecord(data?.biz_data) ?? asRecord(root.biz_data);
  return biz ?? data;
}

function dsErrorMessage(root: Record<string, unknown> | null, fallback: string): string {
  if (!root) return fallback;
  const msg = strField(root.msg) || strField(root.message);
  const code = typeof root.code === "number" ? root.code : null;
  if (msg) return code !== null && code !== 0 ? `${msg}（业务码 ${code}）` : msg;
  if (code !== null && code !== 0) return `DeepSeek 返回业务码 ${code}`;
  return fallback;
}

function dsFindField(value: unknown, keys: string[], depth: number): string {
  if (depth > 4 || typeof value !== "object" || value === null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = dsFindField(item, keys, depth + 1);
      if (hit) return hit;
    }
    return "";
  }
  const rec = value as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(rec)) {
    const hit = dsFindField(v, keys, depth + 1);
    if (hit) return hit;
  }
  return "";
}

type DsWebFailure = { ok: false; error: string; kind: "expired" | "blocked" | "error" };
type DsValidateResult =
  | {
      ok: true;
      accessToken: string;
      /** Display label for the account (a name, a masked-able
       * email, …) as the site reports it; may be ''. */
      account: string;
      /** The account's STABLE identity as the site reports it,
       * when the validator can get one stronger than the display
       * label (Doubao: the numeric user_id embedded in the page
       * served for the credential). Used — hashed — for the
       * cross-agent account-collision guard (see
       * recordWebIdentity); never displayed, never returned by an
       * action. Absent = fall back to `account` as the identity. */
      accountId?: string;
    }
  | DsWebFailure;

// One real validation call: GET /api/v0/users/current with the token.
// Returns the short access token DeepSeek itself returns (falling back
// to the userToken, which is byte-identical per the protocol doc) and
// the account facts present in the response. No success is faked: HTTP
// blocks (e.g. a CloudFront 403 page), business-code failures and
// network errors all come back as the real error.
async function dsValidateToken(rawToken: string): Promise<DsValidateResult> {
  const token = unwrapDeepseekToken(rawToken);
  if (!token) return { ok: false, error: "令牌为空", kind: "expired" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const init: RequestInit = {
    method: "GET",
    headers: dsWebHeaders(token),
    signal: ctrl.signal,
  };
  try {
    const res = await agentFetch(`${DS_WEB_BASE}/api/v0/users/current`, init);
    const text = await res.text();
    let root: Record<string, unknown> | null = null;
    try {
      root = asRecord(JSON.parse(text));
    } catch {
      root = null;
    }
    if (!res.ok || !root) {
      const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      return {
        ok: false,
        error: `DeepSeek 验证请求返回 HTTP ${res.status}${snippet ? `：${snippet}` : ""}`,
        kind: res.status === 401 ? "expired" : res.status === 403 ? "blocked" : "error",
      };
    }
    const code = typeof root.code === "number" ? root.code : 0;
    if (code !== 0) {
      return {
        ok: false,
        error: dsErrorMessage(root, "DeepSeek 拒绝了该令牌"),
        kind: code === 40003 || code === 40001 ? "expired" : "error",
      };
    }
    const biz = dsBizData(root);
    const accessToken = strField(biz?.token) || token;
    const account =
      dsFindField(biz, ["email"], 0) ||
      dsFindField(biz, ["mobile", "phone"], 0) ||
      dsFindField(biz, ["nickname", "nick_name", "user_name", "name"], 0);
    return { ok: true, accessToken, account };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "DeepSeek 验证请求超时（30 秒）", kind: "error" };
    }
    return { ok: false, error: "网络错误，无法连接 DeepSeek（chat.deepseek.com）", kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

async function dsCallJson(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<{ ok: true; root: Record<string, unknown> } | DsWebFailure> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const init: RequestInit = {
    method: "POST",
    headers: { ...dsWebHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: ctrl.signal,
  };
  try {
    const res = await agentFetch(`${DS_WEB_BASE}${path}`, init);
    const text = await res.text();
    let root: Record<string, unknown> | null = null;
    try {
      root = asRecord(JSON.parse(text));
    } catch {
      root = null;
    }
    if (!res.ok || !root) {
      const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      return {
        ok: false,
        error: `DeepSeek ${path} 返回 HTTP ${res.status}${snippet ? `：${snippet}` : ""}`,
        kind: res.status === 401 ? "expired" : res.status === 403 ? "blocked" : "error",
      };
    }
    const code = typeof root.code === "number" ? root.code : 0;
    if (code !== 0) {
      return {
        ok: false,
        error: dsErrorMessage(root, `DeepSeek ${path} 调用失败`),
        kind: code === 40003 || code === 40001 ? "expired" : "error",
      };
    }
    return { ok: true, root };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `DeepSeek ${path} 请求超时（30 秒）`, kind: "error" };
    }
    return { ok: false, error: "网络错误，无法连接 DeepSeek（chat.deepseek.com）", kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

// --- DeepSeekHashV1 PoW solver (ported from the documented protocol) ---
// Keccak-f[1600] on 32-bit lane halves (plain-number arithmetic): a
// BigInt version of the same algorithm was verified equivalent but
// far too slow for difficulty ~144000 inside an action call.
const DS_RC32 = new Uint32Array([
0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b, 0x00000000, 0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000, 0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000, 0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
]);
const DS_ROT: number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
  41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const DS_RATE = 136;

function dsKeccakF1600(s: Uint32Array): void {
  const C = new Uint32Array(10);
  const R = new Uint32Array(50);
  for (let round = 1; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      const i = 2 * x;
      C[i] = (s[i] ?? 0) ^ (s[i + 10] ?? 0) ^ (s[i + 20] ?? 0) ^ (s[i + 30] ?? 0) ^ (s[i + 40] ?? 0);
      C[i + 1] = (s[i + 1] ?? 0) ^ (s[i + 11] ?? 0) ^ (s[i + 21] ?? 0) ^ (s[i + 31] ?? 0) ^ (s[i + 41] ?? 0);
    }
    for (let x = 0; x < 5; x++) {
      const nIdx = 2 * ((x + 1) % 5);
      const nLo = C[nIdx] ?? 0;
      const nHi = C[nIdx + 1] ?? 0;
      // delta = C[x-1] ^ rotl(C[x+1], 1)
      const rLo = (nLo << 1) | (nHi >>> 31);
      const rHi = (nHi << 1) | (nLo >>> 31);
      const dLo = (C[2 * ((x + 4) % 5)] ?? 0) ^ rLo;
      const dHi = (C[2 * ((x + 4) % 5) + 1] ?? 0) ^ rHi;
      for (let y = 0; y < 5; y++) {
        const idx = 2 * (x + 5 * y);
        s[idx] = (s[idx] ?? 0) ^ dLo;
        s[idx + 1] = (s[idx + 1] ?? 0) ^ dHi;
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const source = x + 5 * y;
        const destination = y + 5 * ((2 * x + 3 * y) % 5);
        const lo = s[2 * source] ?? 0;
        const hi = s[2 * source + 1] ?? 0;
        const n = DS_ROT[source] ?? 0;
        let rLo = lo, rHi = hi;
        if (n === 32) { rLo = hi; rHi = lo; }
        else if (n > 32) { const m = n - 32; rLo = (hi << m) | (lo >>> (32 - m)); rHi = (lo << m) | (hi >>> (32 - m)); }
        else if (n > 0) { rLo = (lo << n) | (hi >>> (32 - n)); rHi = (hi << n) | (lo >>> (32 - n)); }
        R[2 * destination] = rLo;
        R[2 * destination + 1] = rHi;
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const index = 2 * (x + 5 * y);
        const aLo = R[2 * ((x + 1) % 5 + 5 * y)] ?? 0;
        const aHi = R[2 * ((x + 1) % 5 + 5 * y) + 1] ?? 0;
        const bLo = R[2 * ((x + 2) % 5 + 5 * y)] ?? 0;
        const bHi = R[2 * ((x + 2) % 5 + 5 * y) + 1] ?? 0;
        s[index] = (R[index] ?? 0) ^ (~aLo & bLo);
        s[index + 1] = (R[index + 1] ?? 0) ^ (~aHi & bHi);
      }
    }
    s[0] = (s[0] ?? 0) ^ (DS_RC32[2 * round] ?? 0);
    s[1] = (s[1] ?? 0) ^ (DS_RC32[2 * round + 1] ?? 0);
  }
}

function dsXorBytes(s: Uint32Array, block: Uint8Array, offset: number, len: number): void {
  for (let i = 0; i < len; i++) {
    const b = block[offset + i] ?? 0;
    const lane = i >> 3;
    const pos = i & 7;
    if (pos < 4) s[2 * lane] = (s[2 * lane] ?? 0) ^ (b << (8 * pos));
    else s[2 * lane + 1] = (s[2 * lane + 1] ?? 0) ^ (b << (8 * (pos - 4)));
  }
}

function dsDigest(message: Uint8Array): Uint8Array {
  const s = new Uint32Array(50);
  let offset = 0;
  while (message.length - offset >= DS_RATE) {
    dsXorBytes(s, message, offset, DS_RATE);
    dsKeccakF1600(s);
    offset += DS_RATE;
  }
  const rest = message.length - offset;
  const block = new Uint8Array(DS_RATE);
  block.set(message.subarray(offset));
  block[rest] = (block[rest] ?? 0) ^ 0x06;
  block[DS_RATE - 1] = (block[DS_RATE - 1] ?? 0) ^ 0x80;
  dsXorBytes(s, block, 0, DS_RATE);
  dsKeccakF1600(s);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lane = i >> 3;
    const pos = i & 7;
    const word = pos < 4 ? (s[2 * lane] ?? 0) : (s[2 * lane + 1] ?? 0);
    out[i] = (word >>> (8 * (pos & 3))) & 0xff;
  }
  return out;
}

function dsSolvePow(challenge: { algorithm: string; challenge: string; salt: string; difficulty: number; expireAt: number }): number | null {
  if (challenge.algorithm !== "DeepSeekHashV1") return null;
  if (!challenge.difficulty || challenge.difficulty <= 0) return null;
  const wantHex = challenge.challenge.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wantHex)) return null;
  const want = new Uint8Array(32);
  for (let i = 0; i < 32; i++) want[i] = parseInt(wantHex.slice(i * 2, i * 2 + 2), 16);
  const prefix = `${challenge.salt}_${challenge.expireAt}_`;
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < challenge.difficulty; nonce++) {
    const digest = dsDigest(encoder.encode(prefix + String(nonce)));
    let same = true;
    for (let i = 0; i < 32; i++) if (digest[i] !== want[i]) { same = false; break; }
    if (same) return nonce;
  }
  return null;
}

// Parses DeepSeek's patch-style SSE stream into the reply text. THINK
// fragments (reasoning) are excluded; only ANSWER/RESPONSE content and
// its APPEND increments are collected. The reply's own message_id is
// captured alongside (from the response object the stream opens
// with): it is the parent_message_id a continued session's next
// completion must name. 0 = the stream carried no id.
function dsParseSse(text: string): { text: string; messageId: number } {
  let content = "";
  let messageId = 0;
  let currentThinking = false;
  const fragmentThinking = new Map<number, boolean>();
  const handleFragments = (value: unknown) => {
    const items = Array.isArray(value) ? value : asRecord(value) ? [value] : [];
    items.forEach((raw, idx) => {
      const frag = asRecord(raw);
      if (!frag) return;
      const typeName = typeof frag.type === "string" ? frag.type.toUpperCase() : "";
      const fragId = typeof frag.id === "number" ? frag.id : idx;
      if (typeName === "THINK") {
        fragmentThinking.set(fragId, true);
        currentThinking = true;
        return;
      }
      if (typeName === "RESPONSE" || typeName === "ANSWER") {
        fragmentThinking.set(fragId, false);
        currentThinking = false;
      }
      const fragContent = strField(frag.content);
      if (fragContent && fragmentThinking.get(fragId) !== true && typeName !== "THINK") {
        content += fragContent;
      }
    });
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let data: Record<string, unknown> | null = null;
    try {
      data = asRecord(JSON.parse(payload));
    } catch {
      continue;
    }
    if (!data) continue;
    const v = data.v;
    const p = typeof data.p === "string" ? data.p : "";
    if (typeof data.message_id === "number" && data.message_id > 0)
      messageId = data.message_id;
    if (p === "response/message_id" && typeof v === "number" && v > 0)
      messageId = v;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const resp = asRecord(asRecord(v)?.response);
      if (resp) {
        if (typeof resp.message_id === "number" && resp.message_id > 0)
          messageId = resp.message_id;
        handleFragments(resp.fragments);
        continue;
      }
    }
    if (p === "response/fragments") {
      handleFragments(v);
      continue;
    }
    if (typeof v === "string") {
      if (p === "response/status" || p === "response/search_status") continue;
      const fragMatch = /^response\/fragments\/(\d+)\/content$/.exec(p);
      if (fragMatch) {
        const fragId = Number(fragMatch[1]);
        if (fragmentThinking.get(fragId) === true) continue;
        content += v;
        continue;
      }
      if (p && p !== "response/fragments/-1/content" && !p.endsWith("/content")) continue;
      if (!currentThinking) content += v;
    }
  }
  return { text: content.trim(), messageId };
}

/** The DeepSeek web request options for one agent, from its saved
 * web settings (agents.web_mode / web_thinking / web_search — the
 * web UI's own controls: 模式 model_type default=快速/expert=专家，
 * 深度思考 thinking_enabled, 智能搜索 search_enabled; the three are
 * independent). While web_mode was never set (''), the legacy
 * model-string derivation applies so agents saved before these
 * settings existed keep behaving as they did. */
function dsWebOptions(agent: AgentRow): { modelType: string; thinkingEnabled: boolean; searchEnabled: boolean } {
  if (agent.webMode === "default" || agent.webMode === "expert") {
    return {
      modelType: agent.webMode,
      thinkingEnabled: agent.webThinking === 1,
      searchEnabled: agent.webSearch === 1,
    };
  }
  const lower = agent.model.trim().toLowerCase();
  return {
    modelType: lower.includes("pro") || lower.includes("expert") ? "expert" : "default",
    thinkingEnabled:
      agent.webThinking === 1 ||
      lower.includes("reasoner") ||
      lower.includes("r1") ||
      lower.includes("think") ||
      lower.includes("reason"),
    searchEnabled: agent.webSearch === 1 || lower.includes("search"),
  };
}

/* ---- 豆包 model menu: the account's own detected catalog ----
 * Like an API agent's /models list, but for the web product:
 * Doubao's servers embed the account's model menu config
 * (menuConfV2) in the /chat page they serve for the account's
 * Cookie — the very data the official web client renders its
 * composer model menu from. The space reads THAT (see
 * fetchDoubaoMenu / detectDoubaoModels), so the models, their
 * wire keys, mode groups （对话 mode_id "1" / 工作任务 "3"),
 * model_extra_params, per-model 推理强度 levels and the
 * membership gate (subscribe_config.need_upgrade — set on Pro
 * for accounts without a 豆包 membership, which is exactly why
 * Pro "cannot be used" for such an account) all come from the
 * account itself, not from a list hardcoded here. Measured on
 * the user's real account 2026-11-19: 15 menu models — 对话：
 * 快速 "0" / 专家 "3"; 工作任务： 自动 "9" （小额免费）, 豆包
 * 2.1 Lite "seed-lite-7b", 豆包 2.1 Pro "5" (need_upgrade
 * true for this account), plus ten person-* third-party models
 * with their own extra params (memory_profile "300k_230",
 * total_window_size "300000") and per-model reasoning levels
 * (some up to 6 极高 / 7 最高， Qwen/GLM with gaps). Until an
 * account is detected, the built-in fallback below (Doubao's
 * own five models in their standing config shape) stands in. */

type DoubaoMenuModel = {
  /** model_item_key, verbatim string (never parsed to number). */
  key: string;
  /** The site's own display name for the model. */
  name: string;
  /** The mode group the model belongs to: "1" 对话 / "3" 工作任务. */
  modeId: string;
  /** The config's agent_mode for that group (2 chat / 1 task). */
  agentMode: number;
  /** The site's own tag texts （小额免费 / 0.65x / …), in order. */
  tags: string[];
  /** model_extra_params exactly as the config carries them. */
  extraParams: Record<string, string>;
  /** This model's own 推理强度 levels, from its
   * reasoning_effort_config — per model, NOT one shared set. */
  levels: { level: number; name: string }[];
  defaultLevel: number;
  /** The config's subscribe_config.need_upgrade: the site
   * itself marks this model as needing a membership upgrade
   * for this account. */
  needUpgrade: boolean;
};
type DoubaoMenu = { models: DoubaoMenuModel[] };

const doubaoMenuModelSchema = z.object({
  key: z.string(),
  name: z.string(),
  modeId: z.string(),
  agentMode: z.number(),
  tags: z.array(z.string()),
  extraParams: z.record(z.string(), z.string()),
  levels: z.array(z.object({ level: z.number(), name: z.string() })),
  defaultLevel: z.number(),
  needUpgrade: z.boolean(),
});
const doubaoMenuSchema = z.object({
  models: z.array(doubaoMenuModelSchema),
});

const DOUBAO_LEVELS_345: { level: number; name: string }[] = [
  { level: 3, name: "低" },
  { level: 4, name: "中" },
  { level: 5, name: "高" },
];

/** The fallback catalog used until the account's own menu has
 * been detected: Doubao's own five models with the config
 * values the site serves for them (measured from the real
 * account page, 2026-11-19). Pro is marked needUpgrade here
 * because the site's standing positioning gates it behind a
 * membership （工作任务的订阅模型）; the detected per-account
 * flag replaces this the moment识别 runs, so a member account
 * sees Pro as callable with its own real config. */
const DOUBAO_FALLBACK_MENU: DoubaoMenu = {
  models: [
    { key: "0", name: "快速", modeId: "1", agentMode: 2, tags: [], extraParams: {}, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
    { key: "3", name: "专家", modeId: "1", agentMode: 2, tags: [], extraParams: {}, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
    { key: "9", name: "自动", modeId: "3", agentMode: 1, tags: ["小额免费"], extraParams: { total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
    { key: "seed-lite-7b", name: "豆包 2.1 Lite", modeId: "3", agentMode: 1, tags: ["限时优惠 0.01x"], extraParams: { memory_profile: "256k", total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: false },
    { key: "5", name: "豆包 2.1 Pro", modeId: "3", agentMode: 1, tags: ["0.65x"], extraParams: { total_window_size: "256000" }, levels: DOUBAO_LEVELS_345, defaultLevel: 3, needUpgrade: true },
  ],
};

/** Extracts the balanced-brace JSON value that follows
 * `"key":` in a page's embedded bootstrap data (the values are
 * plain JSON objects embedded in the HTML, with \uXXXX escapes
 * JSON.parse handles). Returns null when absent or unparseable. */
function extractEmbeddedJson(text: string, key: string): unknown {
  const at = text.indexOf(`"${key}"`);
  if (at < 0) return null;
  const start = text.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Normalises one raw menu item from the account config into a
 * DoubaoMenuModel (icon blobs and other render-only fields are
 * dropped; everything the wire needs is kept verbatim). */
function doubaoMenuModelFrom(
  raw: unknown,
  modeId: string,
  agentMode: number,
): DoubaoMenuModel | null {
  const r = asRecord(raw);
  if (!r) return null;
  const key = typeof r.model_item_key === "string" ? r.model_item_key : "";
  const name = typeof r.name === "string" ? r.name : "";
  if (!key || !name) return null;
  const tags: string[] = [];
  if (Array.isArray(r.tag_list)) {
    for (const t of r.tag_list) {
      const tr = asRecord(t);
      if (tr && typeof tr.text === "string" && tr.text) tags.push(tr.text);
    }
  }
  const extraParams: Record<string, string> = {};
  const ep = asRecord(r.model_extra_params);
  if (ep) {
    for (const [k, v] of Object.entries(ep)) {
      if (typeof v === "string") extraParams[k] = v;
    }
  }
  let levels: { level: number; name: string }[] = [];
  let defaultLevel = 3;
  const rc = asRecord(r.reasoning_effort_config);
  if (rc) {
    if (Array.isArray(rc.option_list)) {
      for (const o of rc.option_list) {
        const or_ = asRecord(o);
        if (or_ && typeof or_.level === "number" && typeof or_.name === "string")
          levels.push({ level: or_.level, name: or_.name });
      }
    }
    if (typeof rc.default_level === "number") defaultLevel = rc.default_level;
  }
  if (!levels.length) levels = DOUBAO_LEVELS_345.map((l) => ({ ...l }));
  if (!levels.some((l) => l.level === defaultLevel))
    defaultLevel = levels[0]?.level ?? 3;
  const sub = asRecord(r.subscribe_config);
  return {
    key,
    name,
    modeId,
    agentMode,
    tags,
    extraParams,
    levels,
    defaultLevel,
    needUpgrade: sub?.need_upgrade === true,
  };
}

/** Parses the account's model menu out of the /chat page HTML:
 * menuConfV2's mode groups first (each group carries its
 * mode_id / agent_mode and its own model list), falling back
 * to the flat action-bar menu (modeSelectData) whose items
 * carry their mode as default_mode. Null when the page holds
 * no parseable menu (logged-out page, protocol change). */
function parseDoubaoMenu(pageHtml: string): DoubaoMenu | null {
  const models: DoubaoMenuModel[] = [];
  const conf = asRecord(extractEmbeddedJson(pageHtml, "menuConfV2"));
  const modeList = asRecord(conf?.mode_list);
  const groups = Array.isArray(modeList?.item_list) ? modeList.item_list : [];
  for (const g of groups) {
    const gr = asRecord(g);
    if (!gr) continue;
    const modeId = typeof gr.mode_id === "string" ? gr.mode_id : "";
    const agentMode = typeof gr.agent_mode === "number" ? gr.agent_mode : 0;
    const list = asRecord(gr.model_list);
    const items = Array.isArray(list?.item_list) ? list.item_list : [];
    for (const item of items) {
      const m = doubaoMenuModelFrom(item, modeId, agentMode);
      if (m && !models.some((x) => x.key === m.key)) models.push(m);
    }
  }
  if (models.length) return { models };
  const sel = asRecord(extractEmbeddedJson(pageHtml, "modeSelectData"));
  const cfg = asRecord(sel?.modeSelectConfig);
  const flat = Array.isArray(cfg?.menu_item_list) ? cfg.menu_item_list : [];
  for (const item of flat) {
    const ir = asRecord(item);
    const m = doubaoMenuModelFrom(
      item,
      typeof ir?.default_mode === "string" ? ir.default_mode : "",
      typeof ir?.agent_mode === "number" ? ir.agent_mode : 0,
    );
    if (m && !models.some((x) => x.key === m.key)) models.push(m);
  }
  return models.length ? { models } : null;
}

/** Fetches the /chat page for this Cookie and parses the
 * account's own model menu out of it — the识别 step behind
 * detectDoubaoModels. Failures report what the site actually
 * did (HTTP status / login redirect / unparseable page). */
async function fetchDoubaoMenu(
  token: string,
): Promise<{ menu: DoubaoMenu } | { error: string }> {
  let res: { status: number; url: string; text: string };
  try {
    res = await webFetchText("https://www.doubao.com/chat/", {
      headers: doubaoHeaders(token),
    });
  } catch (e) {
    return { error: webNetFailure("豆包", e).error };
  }
  if (res.status !== 200)
    return { error: `豆包页面返回 HTTP ${res.status}，没能读取账号的模型菜单` };
  if (res.url.includes("passport") || res.text.includes("passport/login"))
    return { error: "豆包网页未处于登录状态（Cookie 已失效），无法识别模型菜单" };
  const menu = parseDoubaoMenu(res.text);
  if (!menu)
    return {
      error:
        "豆包页面里没有找到模型菜单配置（页面结构可能已变更），这次没有识别到可用模型",
    };
  return { menu };
}

/** The agent's effective model catalog: its detected account
 * menu when one is stored and parses, else the fallback. */
function doubaoMenuOf(agent: AgentRow): DoubaoMenu {
  if (agent.webMenuJson) {
    try {
      const parsed = doubaoMenuSchema.safeParse(JSON.parse(agent.webMenuJson));
      if (parsed.success && parsed.data.models.length) return parsed.data;
    } catch {
      // fall through to the fallback catalog
    }
  }
  return DOUBAO_FALLBACK_MENU;
}

/** Legacy webModel values → wire keys, for agents whose pick
 * was saved before webModelKey existed. */
const DOUBAO_LEGACY_KEY_BY_MODEL: Record<string, string> = {
  "": "9",
  "doubao-2.1-lite": "seed-lite-7b",
  "doubao-2.1-pro": "5",
};
/** Wire keys → the legacy webModel projection of the same pick
 * (keys with no legacy counterpart project to null: webModel
 * then keeps its previous value and stays inert, because every
 * read path prefers webModelKey). */
const DOUBAO_LEGACY_MODEL_BY_KEY: Record<string, string> = {
  "9": "",
  "seed-lite-7b": "doubao-2.1-lite",
  "5": "doubao-2.1-pro",
};

/** The wire key of an agent's current model pick: webModelKey
 * when set, else the legacy webModel resolved to its key. */
function doubaoSelectedKey(agent: {
  webModelKey: string;
  webModel: string;
}): string {
  if (agent.webModelKey) return agent.webModelKey;
  return DOUBAO_LEGACY_KEY_BY_MODEL[agent.webModel] ?? "9";
}

/** The numeric 推理强度 level a stored webReasoning means for
 * one model: numeric strings are the level itself, the legacy
 * names map 低 3 / 中 4 / 高 5, and anything else (including
 * never-picked '') falls back to the model's own default level
 * from the account config. A stored level the model does not
 * offer also falls back — the wire only ever carries levels
 * the account config lists for that model. */
function doubaoReasoningLevel(
  reasoning: string,
  entry: DoubaoMenuModel,
): number {
  let level: number | null = null;
  if (/^\d+$/.test(reasoning)) level = Number(reasoning);
  else if (reasoning === "low") level = 3;
  else if (reasoning === "medium") level = 4;
  else if (reasoning === "high") level = 5;
  if (level != null && entry.levels.some((l) => l.level === level))
    return level;
  return entry.defaultLevel;
}

/** Normalises a submitted legacy webModel value: only Doubao
 * agents keep one, and only the three legacy values survive. */
function cleanDoubaoWebModel(provider: string, value: string): string {
  if (provider !== "doubao") return "";
  return ["", "doubao-2.1-lite", "doubao-2.1-pro"].includes(value)
    ? value
    : "";
}

/** Normalises a submitted model KEY (webModelKey): only Doubao
 * agents keep one. Legacy menu values are accepted and mapped
 * to their wire keys; any other value must look like a wire key
 * (the menu's own keys are numeric strings, seed-* slugs and
 * person-* slugs) — membership gating and catalog membership
 * are enforced by the save actions, which know the account's
 * detected menu. */
function cleanDoubaoModelKey(provider: string, value: string): string {
  if (provider !== "doubao") return "";
  const v = value.trim();
  if (v === "doubao-2.1-lite") return "seed-lite-7b";
  if (v === "doubao-2.1-pro") return "5";
  return /^[A-Za-z0-9][A-Za-z0-9\-_]*$/.test(v) && v.length <= 64 ? v : "";
}

/** Normalises a submitted 推理强度： the legacy level names or
 * a numeric level string from the detected menu's per-model
 * levels ("3".."7"). Anything else stores ''. */
function cleanDoubaoWebReasoning(provider: string, value: string): string {
  if (provider !== "doubao") return "";
  if (value === "low" || value === "medium" || value === "high")
    return value;
  return /^[3-7]$/.test(value) ? value : "";
}

/** Whether the classic fallback bodies' use_deep_think summary
 * （存量 webMode 'expert' / 'fast') is on for a selection — the
 * single rule every save path applies before storing webMode.
 * It mirrors the wire gate doubaoWireSelection derives from
 * the same pick: 快速 (key "0") is a no-CoT route and never
 * deep-thinks; any other model deep-thinks at 推理强度 中
 * (level 4) and above; a never-picked level ('') keeps the
 * fallback (the summary the agent already had), so saving an
 * unrelated option never silently changes how the agent
 * answers. */
function doubaoDeepThinkSummary(
  key: string,
  reasoning: string,
  fallbackExpert: boolean,
): boolean {
  if (key === "0") return false;
  if (/^\d+$/.test(reasoning)) return Number(reasoning) >= 4;
  if (reasoning === "medium" || reasoning === "high") return true;
  if (reasoning === "low") return false;
  return fallbackExpert;
}

/** The wire selection chatDoubao's NEW-protocol body sends for
 * one Doubao agent, resolved from the account's OWN detected
 * menu catalog (see the catalog block above) plus the agent's
 * pick (a model_item_key + a 推理强度）.
 *
 * Why this shape — researched 2026-11-19 from two independent
 * reverse captures of Doubao's current clients (Hu410/Doubao2api,
 * web pc 3.38.5, Sep 2026; Wahwayhale/dsh-connect-doubao,
 * desktop, Nov 2026), measured on the user's real account the
 * same day, and completed by reading the account's own served
 * menu config (menuConfV2) later that day:
 *   - The selection is a bundle inside `option`: model_item_key
 *     in THREE places (conversation_init_ext, model_config,
 *     aggregate_params — writing only one is silently ignored),
 *     the picked model's own mode_id ("1" for the 对话 models
 *     快速 / 专家， "3" for the 工作任务 models), and the model's
 *     own model_extra_params exactly as the account config
 *     carries them (task models: total_window_size; Lite also
 *     memory_profile "256k"; third-party models: "300k_230" /
 *     "300000"). The previous implementation hardcoded mode_id
 *     "3" and a fixed extra-params shape for every pick, and
 *     offered none of the 对话 models at all.
 *   - 推理强度 is per model: reasoning_effort is the level the
 *     account config lists FOR THAT MODEL （低 3 / 中 4 / 高 5
 *     for Doubao's own models; third-party models add 极高 6 /
 *     最高 7 and some skip levels), defaulting to the model's
 *     own default_level when nothing was picked.
 *   - need_deep_think (int in option, mirrored as a string in
 *     ext.use_deep_think) is the thinking gate: level 中 (4) and
 *     above → 3, below → 0; 快速 (key "0") is a no-CoT route and
 *     always sends 0 (measured: with the gate at 3 and a
 *     thinking-capable key, the reply stream carries a
 *     block_type 10040 thinking phase; on the 快速 route it
 *     never does). parseDoubaoStream keeps the thinking blocks
 *     out of the saved answer text.
 *   - The bundle rides the CHAT route (agent_mode 2): the
 *     工作任务 route itself (agent_mode 1) does NOT run over
 *     this token connection (three body variants were each
 *     answered with only 「出了点问题，请稍后重试。」 — the task
 *     environment lives in Doubao's own client/cloud runtime),
 *     so 工作任务 models are selected with their full official
 *     bundle on the route that can run.
 * Honest limit (also measured, by the desktop project): in
 * chat mode Doubao's server does not validate model_item_key,
 * and no response field proves which checkpoint answered —
 * whether a 工作任务 key actually routes to that model for a
 * given account is Doubao's server-side decision, gated by
 * the account's entitlements (the config itself flags Pro
 * with need_upgrade for accounts without a membership, and
 * the space refuses to store such a pick). What this bundle
 * guarantees is that the selection the user picked is
 * transmitted in full, in the official client's own format,
 * with the account config's own parameters — and that the
 * thinking gate's effect is real and observable in the
 * stream. The UI copy states the limit. */
function doubaoWireSelection(
  menu: DoubaoMenu,
  key: string,
  reasoning: string,
): {
  itemKey: string;
  modeId: string;
  effort: number;
  gate: number;
  extraParams: Record<string, string>;
} {
  const found =
    menu.models.find((m) => m.key === key) ??
    DOUBAO_FALLBACK_MENU.models.find((m) => m.key === key);
  const entry: DoubaoMenuModel = found ?? {
    // A key no catalog knows (the menu changed since the pick
    // was stored): still send the pick itself, with the task
    // mode's standing params, rather than silently swapping
    // the user's model for another one.
    key,
    name: key,
    modeId: "3",
    agentMode: 1,
    tags: [],
    extraParams: { total_window_size: "256000" },
    levels: DOUBAO_LEVELS_345,
    defaultLevel: 3,
    needUpgrade: false,
  };
  const effort = doubaoReasoningLevel(reasoning, entry);
  const gate = entry.key === "0" ? 0 : effort >= 4 ? 3 : 0;
  return {
    itemKey: entry.key,
    modeId: entry.modeId || "3",
    effort,
    gate,
    extraParams: entry.extraParams,
  };
}

async function dsMarkWebStatus(
  ctx: Ctx,
  agentId: number,
  status: "expired" | "blocked",
  error: string,
): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    await db
      .update(schema.agents)
      .set({ webStatus: status, webError: error })
      .where(eq(schema.agents.id, agentId));
  } catch {
    // best effort — the reply error itself is already reported
  }
}

/** Masks an account label for display: DeepSeek's own response may
 * already mask it (then it is kept as-is); a raw email or mobile is
 * masked here so the full identifier is never shown or stored in
 * the display field. */
function maskWebAccount(account: string): string {
  const a = account.trim();
  if (!a || a.includes("*")) return a;
  const email = /^([^@\s]+)@([^@\s]+)$/.exec(a);
  if (email) {
    const local = email[1] ?? "";
    const masked =
      local.length > 4
        ? `${local.slice(0, 2)}*****${local.slice(-2)}`
        : local.length > 1
          ? `${local.slice(0, 1)}*****${local.slice(-1)}`
          : "*****";
    return `${masked}@${email[2] ?? ""}`;
  }
  if (/^\d{7,}$/.test(a)) return `${a.slice(0, 3)}*****${a.slice(-2)}`;
  return a;
}

async function dsMarkWebLoggedIn(ctx: Ctx, agentId: number, account: string): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    await db
      .update(schema.agents)
      .set({ webStatus: "logged_in", webAccount: maskWebAccount(account), webError: "" })
      .where(eq(schema.agents.id, agentId));
  } catch {
    // best effort — the login state is re-verified on every call
  }
}

/* ---- Web-agent account identity guard ----
 * The failure this guards against (reported 2026-11-20, verified
 * live the same day): two Doubao agents whose stored Cookie
 * bundles BOTH made doubao.com report the same account
 * （知梦方生， user_id 1739863714432276) — the second bundle had
 * been copied from a browser session still sitting on the first
 * account, so every chat with either agent landed in that one
 * account's官网 history. The send paths were already per-agent
 * (each agent's own Cookie, device id, conversation mapping);
 * what was missing is that the space never RECORDED which
 * account a credential actually belongs to, never COMPARED it
 * across agents, and never noticed when it changed — so a wrong
 * or swapped credential was indistinguishable from a right one.
 *
 * The guard, applied uniformly to every web-token site:
 *  - Whenever a credential is verified (verifyWebToken,
 *    refreshWebIdentities, DeepSeek's per-reply validation), the
 *    identity the SITE reports for it (accountId when the
 *    validator has one, else the account label) and the
 *    credential itself are hashed (provider-scoped SHA-256) and
 *    stored on the agent row (webIdentityHash /
 *    webCredentialHash). Only hashes are stored and compared;
 *    neither hash is ever returned by an action.
 *  - findWebIdentityCollisions names every OTHER web agent of
 *    the same site whose stored identity or credential hash
 *    matches. Two agents resolving to one account is the exact
 *    reported failure, so a collision is surfaced (verify
 *    response + a persistent settings-panel warning fed by
 *    listAgents) — but a STORED collision never blocks a send
 *    on its own (revised 2026-11-21 at the user's direction:
 *    judge by the CURRENT check, not by an old record).
 *    produceReply, on seeing a stored collision, first
 *    re-validates the involved credentials LIVE against the
 *    site (resolveCollisionLive) and only refuses the send when
 *    that live check CONFIRMS both credentials currently
 *    resolve to the same account id. A live check that shows
 *    different accounts clears the collision (the fresh
 *    identities are recorded) and the send proceeds; a live
 *    check that cannot be completed (network failure, the site
 *    reporting no identity) does NOT count as a collision and
 *    the send proceeds too — the send itself then surfaces
 *    whatever the site really answers.
 *  - Identity itself is always the SITE's session-scoped
 *    answer for the agent's OWN credential, never a shared or
 *    inferred value: for Doubao it is the passport account-info
 *    endpoint asked with that agent's own Cookie (see
 *    doubaoAccountInfo). The earlier Doubao source — user_id
 *    numbers scraped from the /chat page HTML — was removed
 *    after it produced a false same-account reading for two
 *    different accounts (the page embeds other entities' ids).
 *  - When an agent's recorded identity CHANGES (a different
 *    account's credential was pasted over it), the old account's
 *    account-bound state is dropped before anything else can use
 *    it: the stored官网 conversation continuations for that
 *    agent (web_remote_conversations — continuing one under a
 *    different account's credential would post into the old
 *    account's conversation or fail confusingly) and, for
 *    Doubao, the detected model menu + selection (they are the
 *    old account's own config). The next send then starts fresh
 *    under the new account.
 *  - Doubao and DeepSeek additionally assert identity AT SEND
 *    TIME (their send paths already re-read the account from the
 *    site on every send): a live identity that contradicts the
 *    recorded one stops the send with an explicit error instead
 *    of silently messaging as the wrong account. */

/** The Chinese site label for a web provider id, for
 * user-facing sentences (the client keeps its own copy in
 * WEB_SITES; this is the server's, used by the identity guard's
 * warnings). Falls back to the provider id itself. */
const WEB_SITE_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  qwen: "千问",
  doubao: "豆包",
  hunyuan: "元宝",
  zhipu: "智谱清言",
  mistral: "Mistral",
  wenxin: "文心一言",
};

function webSiteLabel(provider: string): string {
  return WEB_SITE_LABELS[provider] ?? provider;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The identity string one verification vouches for: the stable
 * account id when the validator produced one, else the account
 * label it reported, else "" (the site reported nothing usable —
 * no identity is recorded then, and a previously recorded one is
 * kept rather than erased by a weaker reading). */
function webIdentityString(v: {
  accountId?: string;
  account: string;
}): string {
  return (v.accountId ?? "").trim() || v.account.trim();
}

async function webIdentityHash(
  provider: string,
  identity: string,
): Promise<string> {
  const id = identity.trim();
  if (!id) return "";
  return sha256Hex(`web-identity\n${provider}\n${id}`);
}

async function webCredentialHash(
  provider: string,
  credential: string,
): Promise<string> {
  const c = credential.trim();
  if (!c) return "";
  return sha256Hex(`web-credential\n${provider}\n${c}`);
}

/** Records one successful verification's identity + credential
 * hashes on the agent row and enforces the identity-change
 * cleanup. `agent` is the row as loaded BEFORE this verification
 * (its stored hashes are the previous facts). Returns the
 * effective hashes after recording plus whether the account
 * identity changed. Best effort throughout: a bookkeeping
 * failure must never fail the verification or the reply that
 * carried it. */
async function recordWebIdentity(
  db: Db,
  agent: AgentRow,
  identityRaw: string,
  storedCredential: string,
): Promise<{
  identityHash: string;
  credentialHash: string;
  identityChanged: boolean;
}> {
  const identityHash =
    (await webIdentityHash(agent.provider, identityRaw)) ||
    agent.webIdentityHash;
  const credentialHash =
    (await webCredentialHash(agent.provider, storedCredential)) ||
    agent.webCredentialHash;
  const identityChanged =
    identityHash !== "" &&
    agent.webIdentityHash !== "" &&
    identityHash !== agent.webIdentityHash;
  try {
    if (
      identityHash !== agent.webIdentityHash ||
      credentialHash !== agent.webCredentialHash
    ) {
      await db
        .update(schema.agents)
        .set({ webIdentityHash: identityHash, webCredentialHash: credentialHash })
        .where(eq(schema.agents.id, agent.id));
    }
    if (identityChanged) {
      // The credential now belongs to a DIFFERENT account than
      // the state on this agent was accumulated under: drop the
      // old account's官网 conversation continuations (every
      // provider that keeps them — Doubao and DeepSeek today)
      // and, for Doubao, the old account's detected menu +
      // selection, so nothing from the old account is carried
      // into the new one.
      await clearWebRemoteForAgent(db, agent.provider, agent.id);
      if (agent.provider === "doubao") {
        await db
          .update(schema.agents)
          .set({
            webMenuJson: "",
            webMenuAt: null,
            webModelKey: "",
            webModel: "",
            webReasoning: "",
          })
          .where(eq(schema.agents.id, agent.id));
      }
    }
  } catch {
    // bookkeeping only — see the header comment
  }
  return { identityHash, credentialHash, identityChanged };
}

/** Every OTHER web agent of the same site whose recorded account
 * identity or credential matches this one's — the collision set
 * the settings panel warns about. Matching is hash equality
 * only; empty hashes never collide (an unrecorded identity is
 * unknown, not shared). */
async function findWebIdentityCollisions(
  db: Db,
  self: {
    id: number;
    provider: string;
    webIdentityHash: string;
    webCredentialHash: string;
  },
): Promise<{ id: number; name: string }[]> {
  if (!self.webIdentityHash && !self.webCredentialHash) return [];
  try {
    const rows = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        provider: schema.agents.provider,
        webIdentityHash: schema.agents.webIdentityHash,
        webCredentialHash: schema.agents.webCredentialHash,
      })
      .from(schema.agents)
      .where(eq(schema.agents.connectionType, "web"));
    return rows
      .filter(
        (r) =>
          r.id !== self.id &&
          r.provider === self.provider &&
          ((self.webIdentityHash !== "" &&
            r.webIdentityHash === self.webIdentityHash) ||
            (self.webCredentialHash !== "" &&
              r.webCredentialHash === self.webCredentialHash)),
      )
      .map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

/** The user-facing collision warning shared by verifyWebToken
 * and refreshWebIdentities: names the other agent(s), the shared
 * account as the site reported it, and the concrete fix. The
 * wording states the measured fact — the site itself resolves
 * both credentials to this one account — not a guess about which
 * paste went wrong. */
function webIdentityCollisionWarning(
  siteLabel: string,
  accountLabel: string,
  others: { name: string }[],
): string {
  const names = others.map((o) => `「${o.name || "未命名智能体"}」`).join("、");
  return (
    `账号冲突：这个${siteLabel}凭证经官网核对，实际登录的账号与${names}的是同一个账号` +
    `${accountLabel ? `（${accountLabel}）` : ""}——两个智能体共用这一个账号，给谁发的消息都会进入这同一个账号的官网历史。` +
    `空间不会凭旧记录拦你：每次发送前都会向官网实时复核，只有当次复核确认仍是同一个账号时才会拦下那一条；` +
    `复核查到是两个账号会自动解除冲突、恢复发送，复核查不到结果时也不会按冲突拦截。` +
    `如果它们本应是两个账号，说明其中一份凭证是从仍停在这个账号的浏览器会话里复制的：` +
    `请在目标账号的浏览器里先确认${siteLabel}当前登录的就是目标账号，再复制那个会话的凭证，粘贴到对应智能体重新验证。`
  );
}

/** Live-validates ONE web agent's stored credential against
 * its own site, exactly like verifyWebToken does (same
 * validators, same per-site alignment data, Gemini's rotated
 * token persisted), and records the outcome the same way:
 * status/account on a definitive answer, the account identity
 * + credential hashes via recordWebIdentity, and webCheckedAt
 * stamped whenever the site gave a definitive answer (a
 * transport failure proves nothing and stamps nothing).
 * Returns whether a live identity was actually established —
 * false means this check could not judge the account at all,
 * which callers must treat as "unknown", never as a collision. */
async function liveRecheckWebIdentity(
  db: Db,
  agent: AgentRow,
): Promise<{
  judged: boolean;
  identityHash: string;
  credentialHash: string;
}> {
  const unjudged = {
    judged: false,
    identityHash: agent.webIdentityHash,
    credentialHash: agent.webCredentialHash,
  };
  const token = agent.webToken.trim();
  const validator =
    agent.provider === "deepseek"
      ? dsValidateToken
      : WEB_VALIDATORS[agent.provider];
  if (!token || !validator) return unjudged;
  const v =
    agent.provider === "qwen"
      ? await validateQwen(token, {
          cookie: agent.webCookie,
          ua: agent.webUserAgent,
        })
      : await validator(token);
  if (v.ok) {
    const account = maskWebAccount(v.account);
    const storedCredential =
      agent.provider === "gemini" && v.accessToken ? v.accessToken : token;
    await db
      .update(schema.agents)
      .set({
        webStatus: "logged_in",
        webAccount: account,
        webError: "",
        webCheckedAt: new Date(),
        ...(v.accountId ? { webAccountId: v.accountId } : {}),
        ...(agent.provider === "gemini" &&
        v.accessToken &&
        v.accessToken !== token
          ? { webToken: v.accessToken }
          : {}),
      })
      .where(eq(schema.agents.id, agent.id));
    const recorded = await recordWebIdentity(
      db,
      agent,
      webIdentityString(v),
      storedCredential,
    );
    return {
      // A validation that reports no identity at all cannot
      // judge sameness either — the recorded hashes then just
      // carry the old facts forward.
      judged: recorded.identityHash !== "",
      identityHash: recorded.identityHash,
      credentialHash: recorded.credentialHash,
    };
  }
  if (v.kind === "error") {
    // Transport-level failure: nothing was proven either way.
    await db
      .update(schema.agents)
      .set({
        webError: v.error,
        ...(agent.webStatus === "" ? { webStatus: "error" } : {}),
      })
      .where(eq(schema.agents.id, agent.id));
    return unjudged;
  }
  // A definitive refusal (expired / blocked): the credential is
  // dead, so it cannot currently resolve to ANY account — there
  // is no live same-account fact to enforce. The send path
  // reports the dead credential with its own real error.
  await db
    .update(schema.agents)
    .set({
      webStatus: v.kind,
      webError: v.error,
      webAccount: "",
      webCheckedAt: new Date(),
    })
    .where(eq(schema.agents.id, agent.id));
  return unjudged;
}

/** The send-time collision decision (see the guard header):
 * given the agent about to send and the same-site agents its
 * STORED hashes collide with, re-check every involved
 * credential LIVE and decide from the live facts alone.
 * "confirmed" — every involved credential was live-judged and
 * at least one other agent still resolves to the same account
 * identity as the sender: the send is refused. Anything else
 * ("cleared" / "unconfirmed") lets the send proceed: different
 * live accounts clear the collision by recording the fresh
 * identities, and an unjudgeable check never counts as a
 * collision. As a final step the sender's row is refreshed
 * onto `agent` so the send continues with the facts just
 * measured (rotated tokens, fresh identity hash). */
async function resolveCollisionLive(
  db: Db,
  agent: AgentRow,
  collisions: { id: number; name: string }[],
): Promise<"confirmed" | "cleared" | "unconfirmed"> {
  const self = await liveRecheckWebIdentity(db, agent);
  if (!self.judged) {
    await refreshAgentRow(db, agent);
    return "unconfirmed";
  }
  let sawUnjudged = false;
  let confirmedWith: { id: number; name: string }[] = [];
  for (const other of collisions) {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, other.id));
    const otherRow = rows[0];
    if (!otherRow) continue;
    const live = await liveRecheckWebIdentity(db, otherRow);
    if (!live.judged) {
      sawUnjudged = true;
      continue;
    }
    if (
      live.identityHash !== "" &&
      live.identityHash === self.identityHash
    ) {
      confirmedWith.push(other);
    }
  }
  await refreshAgentRow(db, agent);
  if (confirmedWith.length) return "confirmed";
  return sawUnjudged ? "unconfirmed" : "cleared";
}

/** Copies the agent row's current stored state back onto an
 * in-memory row object (after a live re-check may have updated
 * the token, status, account and identity hashes). */
async function refreshAgentRow(db: Db, agent: AgentRow): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agent.id));
    if (rows[0]) Object.assign(agent, rows[0]);
  } catch {
    // best effort — the send proceeds with the row it had
  }
}

// The web endpoint takes ONE prompt string (no roles), so the reply
// context is flattened with explicit speaker labels: the system
// preamble built by buildAgentChatMessages (the agent's own system
// prompt, the global custom instructions, its role, granted-file
// context, thinking level) verbatim, then the conversation with the
// user's turns labelled 用户：, this agent's own past replies marked
// 【你之前的回复】 and other members' lines 【名称 的发言】 — the same
// attribution the API path gets from real roles.
function buildWebPrompt(
  agent: AgentRow,
  history: MessageRow[],
  nameOf: NameOf | undefined,
  filesContext = "",
  globalInstructions = "",
  stageContext = "",
): string {
  const labelOf: NameOf =
    nameOf ?? ((agentId) => (agentId == null ? "Muse" : "智能体"));
  const msgs = buildAgentChatMessages(agent, history, labelOf, filesContext, globalInstructions, stageContext);
  const parts: string[] = [];
  const systemContent =
    msgs[0]?.role === "system" && typeof msgs[0].content === "string"
      ? msgs[0].content
      : "";
  if (systemContent)
    parts.push(
      `【系统设定 — 由系统附带，不是用户在对话中输入的消息，不要把这些内容说成是用户讲过的话】\n${systemContent}`,
    );
  for (const row of history) {
    const body = row.content
      ? row.content
      : row.imageBlobKey
        ? row.fileMime && row.fileMime.startsWith("video/")
          ? "（发送了一段视频）"
          : row.fileMime && row.fileMime.startsWith("audio/")
            ? "（发送了一段音频）"
            : row.fileMime && !row.fileMime.startsWith("image/")
              ? `（发送了文件：${row.fileName ?? "文件"}）`
              : "（发送了一张图片）"
        : "";
    if (!body) continue;
    if (row.role === "user") parts.push(`用户：${body}`);
    else if (row.agentId === agent.id) parts.push(`【你之前的回复】${body}`);
    else parts.push(`【${labelOf(row.agentId)} 的发言】${body}`);
  }
  return parts.filter((s) => s.trim() !== "").join("\n\n");
}

/** The message_id of the last message in one DeepSeek chat
 * session, read back from DeepSeek's own history endpoint. Used
 * when the completion stream did not carry the new reply's id:
 * a continued session's next completion must name that id as
 * parent_message_id. 0 = unknown (session gone, empty, or the
 * endpoint changed) — the caller then starts fresh. */
async function dsFetchLastMessageId(
  accessToken: string,
  sessionId: string,
): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await agentFetch(
      `${DS_WEB_BASE}/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`,
      { method: "GET", headers: dsWebHeaders(accessToken), signal: ctrl.signal },
    );
    if (!res.ok) return 0;
    const root = asRecord(JSON.parse(await res.text()));
    if (!root || (typeof root.code === "number" && root.code !== 0)) return 0;
    const biz = dsBizData(root);
    const list = Array.isArray(biz?.chat_messages)
      ? biz.chat_messages
      : Array.isArray(biz?.messages)
        ? biz.messages
        : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = asRecord(list[i]);
      const id = typeof m?.message_id === "number" ? m.message_id : 0;
      if (id > 0) return id;
    }
    return 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

type DsCompleteResult =
  | { ok: true; text: string; messageId: number }
  | {
      ok: false;
      error: string;
      /** True when the failure came from the completion call
       * itself (HTTP rejection, business-code refusal, empty
       * reply) — the session may be dead. PoW-stage and network
       * failures are not the session's fault and leave this
       * unset, so the caller keeps the stored mapping. */
      sessionSuspect?: boolean;
    };

// One real DeepSeek web reply for an agent: validate -> continue
// the room's stored官网 session (or create one) -> PoW challenge
// + local solve -> completion (SSE) -> parse. Every failure
// returns DeepSeek's real error and flips the stored login state
// when the failure is an auth/risk one; nothing is fabricated.
// Conversation reuse is per space room, exactly like Doubao's:
// each room keeps ONE fixed conversation on chat.deepseek.com
// (web_remote_conversations, provider "deepseek"), later replies
// continue it with only the new turns and the last reply's
// message_id as parent, and a new room starts a new官网
// conversation. The session is NOT deleted afterwards — it is
// the user's own account history, visible on the official site,
// and the account's own memory rides along with it. Only when
// the stored conversation refuses a continuation (expired,
// deleted on the site, or the pasted token now belongs to
// another account) is the mapping dropped and a fresh官网
// conversation started with the full prompt. Clearing a room's
// messages drops the mapping too (clearConversation), so the
// next reply there starts a new官网 conversation.
async function callDeepseekWeb(
  ctx: Ctx,
  db: Db,
  conversationId: number,
  agent: AgentRow,
  history: MessageRow[],
  nameOf?: NameOf,
  filesContext = "",
  globalInstructions = "",
  stageContext = "",
  chatImage: ChatImage | null = null,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const rawToken = agent.webToken.trim();
  if (!rawToken) return { ok: false, error: "尚未登录 DeepSeek 网页版（未保存令牌）" };
  const validated = await dsValidateToken(rawToken);
  if (!validated.ok) {
    if (validated.kind !== "error")
      await dsMarkWebStatus(ctx, agent.id, validated.kind, validated.error);
    return { ok: false, error: `DeepSeek 网页版令牌验证失败：${validated.error}` };
  }
  // Send-time account assertion (see recordWebIdentity):
  // DeepSeek re-validates on every reply, so the account behind
  // the token is read live here. If it contradicts the identity
  // recorded for this agent, the token now belongs to another
  // account than the one its stored官网 conversations were
  // accumulated under — record the new identity (which drops
  // the old account's conversation mappings) and stop THIS
  // reply with the fact, instead of silently continuing the old
  // account's conversations under a different account.
  const liveIdentity = webIdentityString(validated);
  const liveIdentityHash = await webIdentityHash("deepseek", liveIdentity);
  if (
    agent.webIdentityHash !== "" &&
    liveIdentityHash !== "" &&
    liveIdentityHash !== agent.webIdentityHash
  ) {
    await recordWebIdentity(db, agent, liveIdentity, rawToken);
    return {
      ok: false,
      error:
        `DeepSeek 网页版这次没有发送：这个令牌现在实际登录的账号（${validated.account || "官网未报出账号名"}），` +
        `与该智能体此前记录的账号不一致——账号身份已按官网现状更新，它名下旧账号的官网对话续接已清除。` +
        `为避免消息发进错误账号的历史，本次已停发；请在该智能体的设置里重新「验证登录」确认当前账号无误后再发。`,
    };
  }
  await recordWebIdentity(db, agent, liveIdentity, rawToken);
  await dsMarkWebLoggedIn(ctx, agent.id, validated.account);
  const accessToken = validated.accessToken;

  // A picture on this turn rides DeepSeek's own vision upload
  // (see dsUploadImageFile) BEFORE any completion is attempted:
  // the completion then names the uploaded file in ref_file_ids
  // with model_type "vision". An upload DeepSeek does not
  // confirm ends the reply with its real reason — the message
  // is never silently re-sent as text only.
  let vision: { refFileIds: string[] } | null = null;
  if (chatImage) {
    const uploaded = await dsUploadImageFile(ctx, agent, accessToken, chatImage);
    if (!uploaded.ok) return { ok: false, error: uploaded.error };
    vision = { refFileIds: [uploaded.fileId] };
  }

  const remote = await loadWebRemote(db, "deepseek", conversationId, agent.id);
  if (remote) {
    let parentId = remote.lastMessageIndex > 0 ? remote.lastMessageIndex : 0;
    if (!parentId)
      parentId = await dsFetchLastMessageId(accessToken, remote.remoteConversationId);
    if (parentId > 0) {
      const delta = buildWebDeltaPrompt(
        agent,
        history,
        nameOf,
        filesContext,
        globalInstructions,
        stageContext,
      );
      const continued = await dsCompleteInSession(
        ctx,
        agent,
        accessToken,
        remote.remoteConversationId,
        parentId,
        delta,
        vision,
      );
      if (continued.ok) {
        let nextId = continued.messageId;
        if (!nextId)
          nextId = await dsFetchLastMessageId(accessToken, remote.remoteConversationId);
        if (nextId > 0) {
          await saveWebRemote(db, "deepseek", conversationId, agent.id, {
            remoteConversationId: remote.remoteConversationId,
            localConversationId: "",
            lastSectionId: "",
            lastMessageIndex: nextId,
          });
        } else {
          // The reply succeeded but its message id could not be
          // learned: keeping the mapping would fork the官网
          // conversation on the next reply, so drop it — the
          // next reply starts a fresh官网 conversation instead.
          await clearWebRemote(db, conversationId, agent.id);
        }
        return { ok: true, text: continued.text };
      }
      if (!continued.sessionSuspect) return continued;
      // The stored官网 conversation refused the continuation:
      // drop the mapping and fall through to a fresh one.
      await clearWebRemote(db, conversationId, agent.id);
    } else {
      // The stored session is gone or unreadable on DeepSeek's
      // side — drop the stale mapping and start fresh below.
      await clearWebRemote(db, conversationId, agent.id);
    }
  }

  const sessionRes = await dsCallJson("/api/v0/chat_session/create", accessToken, {});
  if (!sessionRes.ok) {
    if (sessionRes.kind !== "error")
      await dsMarkWebStatus(ctx, agent.id, sessionRes.kind, sessionRes.error);
    return { ok: false, error: `DeepSeek 网页版创建会话失败：${sessionRes.error}` };
  }
  const sessionBiz = dsBizData(sessionRes.root);
  const sessionObj = asRecord(sessionBiz?.chat_session);
  const sessionId = strField(sessionObj?.id);
  if (!sessionId) return { ok: false, error: "DeepSeek 网页版未返回会话编号（接口可能已变更）" };
  const prompt = buildWebPrompt(agent, history, nameOf, filesContext, globalInstructions, stageContext);
  const fresh = await dsCompleteInSession(ctx, agent, accessToken, sessionId, null, prompt, vision);
  if (!fresh.ok) return fresh;
  let firstId = fresh.messageId;
  if (!firstId) firstId = await dsFetchLastMessageId(accessToken, sessionId);
  // The mapping is stored even when the first reply's id stayed
  // unknown (lastMessageIndex 0): the next reply resolves the
  // parent from the history endpoint, and only an unresolvable
  // session is dropped then.
  await saveWebRemote(db, "deepseek", conversationId, agent.id, {
    remoteConversationId: sessionId,
    localConversationId: "",
    lastSectionId: "",
    lastMessageIndex: firstId,
  });
  return { ok: true, text: fresh.text };
}

/** One DeepSeek PoW response for one target path: fetch that
 * path's challenge, solve it locally, and return the base64
 * x-ds-pow-response header value. The completion endpoint and
 * the file-upload endpoint each gate on their OWN challenge
 * (target_path binds them), so every gated call solves its own.
 * Failures carry the same wording the completion path has
 * always reported. */
async function dsPowResponse(
  ctx: Ctx,
  agent: AgentRow,
  accessToken: string,
  targetPath: string,
): Promise<{ ok: true; pow: string } | { ok: false; error: string }> {
  const challengeRes = await dsCallJson("/api/v0/chat/create_pow_challenge", accessToken, {
    target_path: targetPath,
  });
  if (!challengeRes.ok) {
    if (challengeRes.kind !== "error")
      await dsMarkWebStatus(ctx, agent.id, challengeRes.kind, challengeRes.error);
    return { ok: false, error: `DeepSeek 网页版获取 PoW 挑战失败：${challengeRes.error}` };
  }
  const challengeBiz = dsBizData(challengeRes.root);
  const challengeObj = asRecord(challengeBiz?.challenge);
  const challenge = {
    algorithm: strField(challengeObj?.algorithm),
    challenge: strField(challengeObj?.challenge),
    salt: strField(challengeObj?.salt),
    signature: strField(challengeObj?.signature),
    difficulty: typeof challengeObj?.difficulty === "number" ? challengeObj.difficulty : 0,
    expireAt: typeof challengeObj?.expire_at === "number" ? challengeObj.expire_at : 0,
    targetPath: strField(challengeObj?.target_path) || targetPath,
  };
  if (!challenge.challenge) {
    return { ok: false, error: "DeepSeek 网页版未返回 PoW 挑战（接口可能已变更）" };
  }
  const answer = dsSolvePow(challenge);
  if (answer === null) {
    return { ok: false, error: "DeepSeek 网页版 PoW 挑战求解失败（难度过高或算法已变更）" };
  }
  const pow = Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.targetPath,
    }),
    "utf8",
  ).toString("base64");
  return { ok: true, pow };
}

/** Uploads ONE chat picture to DeepSeek's web file service, the
 * way the official web client's vision flow does it (documented
 * by the HydraHub / deepseek-api protocol notes): POST
 * /api/v0/file/upload_file as multipart with its own PoW and
 * the x-model-type: vision header (without that header DeepSeek
 * treats the picture as a document to OCR and the file ends in
 * CONTENT_EMPTY), then poll GET /api/v0/file/fetch_files until
 * the file reaches SUCCESS. Returns the file id the completion
 * then names in ref_file_ids. Every failure is DeepSeek's real
 * answer — an upload that cannot be confirmed never degrades
 * into a text-only send. */
async function dsUploadImageFile(
  ctx: Ctx,
  agent: AgentRow,
  accessToken: string,
  image: ChatImage,
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const pow = await dsPowResponse(ctx, agent, accessToken, "/api/v0/file/upload_file");
  if (!pow.ok) return pow;
  const bytes = base64ToBytes(image.dataBase64);
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: image.mimeType }),
    image.fileName || "image.png",
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await agentFetch(`${DS_WEB_BASE}/api/v0/file/upload_file`, {
      method: "POST",
      headers: {
        ...dsWebHeaders(accessToken),
        "x-ds-pow-response": pow.pow,
        "x-model-type": "vision",
      },
      body: form,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let root: Record<string, unknown> | null = null;
    try {
      root = asRecord(JSON.parse(text));
    } catch {
      root = null;
    }
    if (!res.ok || !root) {
      const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      if (res.status === 401)
        await dsMarkWebStatus(ctx, agent.id, "expired", `HTTP 401：${snippet}`);
      else if (res.status === 403)
        await dsMarkWebStatus(ctx, agent.id, "blocked", `HTTP 403：${snippet}`);
      return {
        ok: false,
        error: `DeepSeek 网页版图片上传返回 HTTP ${res.status}${snippet ? `：${snippet}` : ""}`,
      };
    }
    const code = typeof root.code === "number" ? root.code : 0;
    if (code !== 0) {
      const error = dsErrorMessage(root, "DeepSeek 网页版拒绝了图片上传");
      if (code === 40003 || code === 40001)
        await dsMarkWebStatus(ctx, agent.id, "expired", error);
      return { ok: false, error: `DeepSeek 网页版图片上传失败：${error}` };
    }
    const biz = dsBizData(root);
    const fileId =
      strField(biz?.id) ||
      strField(biz?.file_id) ||
      strField(asRecord(biz?.file)?.id) ||
      strField(asRecord(biz?.file)?.file_id);
    if (!fileId)
      return { ok: false, error: "DeepSeek 网页版图片上传未返回文件编号（接口可能已变更）" };
    // Poll the file's processing state until DeepSeek itself
    // calls it SUCCESS — the completion refuses a file that is
    // still being processed.
    let lastStatus = "";
    for (let i = 0; i < 12; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2500));
      const pollRes = await agentFetch(
        `${DS_WEB_BASE}/api/v0/file/fetch_files?file_ids=${encodeURIComponent(fileId)}`,
        { method: "GET", headers: dsWebHeaders(accessToken), signal: ctrl.signal },
      );
      if (!pollRes.ok) continue;
      let pollRoot: Record<string, unknown> | null = null;
      try {
        pollRoot = asRecord(JSON.parse(await pollRes.text()));
      } catch {
        pollRoot = null;
      }
      if (!pollRoot) continue;
      const pollBiz = dsBizData(pollRoot);
      const files = Array.isArray(pollBiz?.files) ? pollBiz.files : [];
      const mine =
        files.map((f) => asRecord(f)).find((f) => f && (strField(f.id) === fileId || strField(f.file_id) === fileId)) ??
        (files.length === 1 ? asRecord(files[0]) : null);
      const status = strField(mine?.status) || strField(mine?.state);
      if (status) lastStatus = status;
      if (/^success$/i.test(status)) return { ok: true, fileId };
      if (/fail|error|empty|reject/i.test(status))
        return {
          ok: false,
          error: `DeepSeek 网页版没能处理这张图片（文件状态：${status}），图片没有发给它`,
        };
    }
    return {
      ok: false,
      error: `DeepSeek 网页版图片处理超时${lastStatus ? `（最后状态：${lastStatus}）` : ""}，图片没有发给它`,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      return { ok: false, error: "DeepSeek 网页版图片上传超时（60 秒）" };
    return { ok: false, error: "DeepSeek 网页版图片上传失败：网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

/** One completion inside an existing DeepSeek chat session:
 * PoW challenge + local solve -> completion (SSE) -> parse.
 * parentMessageId null starts the session's first message;
 * otherwise the completion continues from that message. The
 * session is left exactly as DeepSeek keeps it — never deleted.
 * When `vision` is set, the completion is a vision turn: it
 * carries model_type "vision" and the uploaded file ids in
 * ref_file_ids, exactly as the official client's image sends
 * do; the agent's thinking switch still applies, search does
 * not combine with vision in the official client and is off. */
async function dsCompleteInSession(
  ctx: Ctx,
  agent: AgentRow,
  accessToken: string,
  sessionId: string,
  parentMessageId: number | null,
  prompt: string,
  vision: { refFileIds: string[] } | null = null,
): Promise<DsCompleteResult> {
  const powRes = await dsPowResponse(ctx, agent, accessToken, "/api/v0/chat/completion");
  if (!powRes.ok) return { ok: false, error: powRes.error };
  const powResponse = powRes.pow;
  const options = dsWebOptions(agent);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  const init: RequestInit = {
    method: "POST",
    headers: {
      ...dsWebHeaders(accessToken),
      "Content-Type": "application/json",
      "x-ds-pow-response": powResponse,
      "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
    },
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: parentMessageId,
      model_type: vision ? "vision" : options.modelType,
      prompt,
      ref_file_ids: vision ? vision.refFileIds : [],
      thinking_enabled: options.thinkingEnabled,
      search_enabled: vision ? false : options.searchEnabled,
      action: null,
      preempt: false,
    }),
    signal: ctrl.signal,
  };
  try {
    const res = await agentFetch(`${DS_WEB_BASE}/api/v0/chat/completion`, init);
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      if (res.status === 401)
        await dsMarkWebStatus(ctx, agent.id, "expired", `HTTP 401：${snippet}`);
      else if (res.status === 403)
        await dsMarkWebStatus(ctx, agent.id, "blocked", `HTTP 403：${snippet}`);
      return { ok: false, error: `DeepSeek 网页版回复请求返回 HTTP ${res.status}${snippet ? `：${snippet}` : ""}`, sessionSuspect: true };
    }
    // A JSON (non-SSE) body here is a business failure, not a stream.
    if (!text.includes("data:")) {
      let root: Record<string, unknown> | null = null;
      try {
        root = asRecord(JSON.parse(text));
      } catch {
        root = null;
      }
      const code = root && typeof root.code === "number" ? root.code : 0;
      if (root && code !== 0) {
        const error = dsErrorMessage(root, "DeepSeek 网页版回复失败");
        if (code === 40003 || code === 40001)
          await dsMarkWebStatus(ctx, agent.id, "expired", error);
        return { ok: false, error: `DeepSeek 网页版回复失败：${error}`, sessionSuspect: true };
      }
      return { ok: false, error: "DeepSeek 网页版返回了无法解析的回复（接口可能已变更）", sessionSuspect: true };
    }
    const parsed = dsParseSse(text);
    if (!parsed.text)
      return { ok: false, error: "DeepSeek 网页版返回了空回复", sessionSuspect: true };
    return { ok: true, text: parsed.text, messageId: parsed.messageId };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "DeepSeek 网页版回复超时（90 秒）" };
    }
    return { ok: false, error: "DeepSeek 网页版调用失败：网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- web-token sites beyond DeepSeek ----
 * Every mainstream AI's web product is a DIFFERENT private
 * protocol: a different place the login token lives (a localStorage
 * value, a session endpoint's accessToken, a cookie), a different
 * validation call and a different chat call. Each adapter below
 * implements its own site's real shape — nothing is shared between
 * sites except the transport helpers and the result types, and
 * nothing is faked: a site that cannot be validated or answered
 * returns its real error, and the two known structural limits are
 * stated in the open (文心一言's chat calls are signed by page
 * JavaScript — acs-token — which cannot be reproduced server-side,
 * so its chat reports exactly that instead of inventing a call).
 * Tokens are credentials of the user's own web accounts: stored
 * server-side only, never returned, never logged. */
const WEB_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/** The kinds of generated media a reply can carry. */
type ReplyMediaKind = "image" | "video" | "audio" | "file";

/** One piece of media an agent's reply carried (a generated
 * image, video, audio clip or file): the site's own file URL,
 * exactly as the site's response named it (an API reply may
 * instead carry the bytes inline as a data: URI). The reply
 * pipeline downloads the bytes into the space's blob store
 * before the reply is saved — the URL itself is only a fallback
 * shown to the user when a download fails, never the stored
 * form. `name` is the file's own name when the site provides
 * one (files); `referer` is the origin the site's CDN expects
 * when downloading (Doubao's wants doubao.com, the default). */
type WebMediaItem = {
  kind: ReplyMediaKind;
  url: string;
  name?: string;
  referer?: string;
};

/* ---- shared reply-media harvesting ----
 * Every web product (and multimodal API models) delivers
 * generated media as structured payload NEXT TO the reply text:
 * an image-info object with size variants, a video-info object
 * with a vid and play URLs, an audio/file object with a named
 * URL field, or a bare media URL inside a non-text structure.
 * collectMediaFromValue walks such a structure and returns the
 * media it finds, under the same honesty rules the Doubao
 * parser established: text content is never scanned (a URL the
 * model merely TYPES in its prose is not a generated file —
 * callers keep prose out by construction or via skipKeys), an
 * image-info object collapses to ONE item (its best variant),
 * images inside an object that itself carries a video are that
 * video's poster and are dropped, results dedupe by URL and
 * cap at 8. */
const MEDIA_IMAGE_URL_RE = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:[?~#]|$)/i;
const MEDIA_VIDEO_URL_RE = /\.(?:mp4|mov|webm|m3u8|mkv)(?:[?~#]|$)/i;
const MEDIA_AUDIO_URL_RE = /\.(?:mp3|wav|m4a|aac|ogg|opus|flac)(?:[?~#]|$)/i;
const MEDIA_FILE_URL_RE =
  /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt|md|json)(?:[?~#]|$)/i;

function mediaKindForUrlString(u: string): ReplyMediaKind | null {
  if (MEDIA_VIDEO_URL_RE.test(u)) return "video";
  if (MEDIA_AUDIO_URL_RE.test(u)) return "audio";
  if (MEDIA_IMAGE_URL_RE.test(u)) return "image";
  if (MEDIA_FILE_URL_RE.test(u)) return "file";
  return null;
}

/** URL-bearing field names in media payloads, with the kind the
 * field name itself proves (null = decide by the URL's own
 * extension or the surrounding key's hint). */
const MEDIA_URL_KEYS: Record<string, ReplyMediaKind | null> = {
  url: null,
  main_url: null,
  play_url: null,
  src: null,
  download_url: "file",
  video_url: "video",
  image_url: "image",
  audio_url: "audio",
  file_url: "file",
  imageUrl: "image",
  videoUrl: "video",
  audioUrl: "audio",
  fileUrl: "file",
};

function firstMediaUrlOf(rec: Record<string, unknown> | null): string {
  if (!rec) return "";
  for (const key of [
    "url",
    "main_url",
    "play_url",
    "download_url",
    "video_url",
    "image_url",
    "audio_url",
    "file_url",
  ]) {
    const v = rec[key];
    if (typeof v === "string" && v.startsWith("https://")) return v;
  }
  return "";
}

function mediaKeyHint(key: string): ReplyMediaKind | undefined {
  if (/audio|voice|music|song/i.test(key)) return "audio";
  if (/video/i.test(key)) return "video";
  if (/image|picture|photo/i.test(key)) return "image";
  if (/file|attachment|document/i.test(key)) return "file";
  return undefined;
}

/** Field names whose values are page/UI furniture — a site
 * icon, a logo, a loading spinner glyph — never a file the
 * model generated. A URL sitting under one of these keys is
 * not harvested as media whatever its extension says. */
const MEDIA_ICON_KEY_RE = /icon|logo|favicon|sprite/i;

function collectMediaFromValue(
  value: unknown,
  opts?: { skipKeys?: string[] },
): WebMediaItem[] {
  const skip = new Set([
    "text_block",
    "brief",
    "poster",
    "cover",
    // Doubao structures that are NOT generated media (measured
    // on a real captured stream, 2026-11-21): the transient
    // "正在搜索" loading block (its tool icons were harvested
    // as «generated pictures» next to a pure-text reply), the
    // web-search result block (its own icons likewise; the
    // results themselves are parsed into the reply text as
    // 参考链接 by the Doubao extras reader), the inline
    // citation annotations (also parsed into 参考链接), and
    // the follow-up suggestion payloads (parsed into
    // 你还可以问）. Other sites do not use these key names.
    "loading_block",
    "search_query_result_block",
    "meta_info",
    "sp_v2",
    "suggest_questions",
    "suggest_questions_v2",
    ...(opts?.skipKeys ?? []),
  ]);
  const rec = (
    v: unknown,
    depth: number,
    hint: ReplyMediaKind | undefined,
  ): WebMediaItem[] => {
    if (depth > 6 || v == null) return [];
    if (typeof v === "string") {
      const u = v.trim();
      if (!u.startsWith("https://") || /favicon|sprite/i.test(u)) return [];
      const kind = mediaKindForUrlString(u) ?? hint ?? null;
      return kind ? [{ kind, url: u }] : [];
    }
    if (Array.isArray(v))
      return v.flatMap((item) => rec(item, depth + 1, hint));
    if (typeof v !== "object") return [];
    const r = v as Record<string, unknown>;
    // An image-info object contributes ONE item (its best
    // variant), not one per size.
    const ori = asRecord(r.image_ori);
    const preview = asRecord(r.image_preview);
    const thumb = asRecord(r.image_thumb);
    if (ori || preview || thumb) {
      const u =
        firstMediaUrlOf(ori) ||
        firstMediaUrlOf(preview) ||
        firstMediaUrlOf(thumb);
      return u ? [{ kind: "image", url: u }] : [];
    }
    // A video-info object (a vid plus play URLs): its own image
    // fields are the poster, so the video alone is returned.
    if (typeof r.vid === "string" && r.vid) {
      const u =
        firstMediaUrlOf(r) ||
        firstMediaUrlOf(asRecord(r.video)) ||
        firstMediaUrlOf(asRecord(r.play_info));
      if (u) return [{ kind: "video", url: u }];
    }
    const fileName =
      typeof r.file_name === "string" && r.file_name
        ? r.file_name
        : typeof r.filename === "string" && r.filename
          ? r.filename
          : "";
    let ownVideo = false;
    const out: WebMediaItem[] = [];
    for (const [k, val] of Object.entries(r)) {
      if (skip.has(k)) continue;
      // An icon/logo field's subtree (the URL string itself, or
      // an image-info object holding the icon's variants) is
      // page furniture, never generated media.
      if (MEDIA_ICON_KEY_RE.test(k)) continue;
      const keyHint = mediaKeyHint(k) ?? hint;
      if (typeof val === "string" && k in MEDIA_URL_KEYS) {
        const u = val.trim();
        if (u.startsWith("https://") && !/favicon|sprite/i.test(u)) {
          const kind =
            MEDIA_URL_KEYS[k] ?? mediaKindForUrlString(u) ?? keyHint ?? null;
          if (kind) {
            if (kind === "video") ownVideo = true;
            out.push({
              kind,
              url: u,
              ...(kind === "file" && fileName ? { name: fileName } : {}),
            });
            continue;
          }
        }
      }
      out.push(...rec(val, depth + 1, keyHint));
    }
    // Images gathered inside an object that itself carries a
    // video are that video's poster/cover, not separate pictures.
    if (ownVideo) return out.filter((m) => m.kind !== "image");
    return out;
  };
  const seen = new Set<string>();
  const items: WebMediaItem[] = [];
  for (const m of rec(value, 0, undefined)) {
    if (seen.has(m.url) || items.length >= 8) continue;
    seen.add(m.url);
    items.push(m);
  }
  return items;
}

/** Accumulates harvested media across a streamed reply's many
 * events: dedupes by URL and caps the reply at 8 items. */
class MediaBag {
  items: WebMediaItem[] = [];
  private seen = new Set<string>();
  add(found: WebMediaItem[]): void {
    for (const m of found) {
      if (this.seen.has(m.url) || this.items.length >= 8) continue;
      this.seen.add(m.url);
      this.items.push(m);
    }
  }
  get list(): WebMediaItem[] | undefined {
    return this.items.length ? this.items : undefined;
  }
}

type WebChatResult =
  | {
      ok: true;
      text: string;
      media?: WebMediaItem[];
      /** A refreshed credential the site handed back during the
       * call (Gemini's rotated __Secure-1PSIDTS, folded into the
       * stored token's own paste shape): the dispatch persists
       * it as the agent's new web token, so the login survives
       * the site's rotation instead of decaying into a false
       * "expired". Only Gemini sets it. */
      refreshedToken?: string;
    }
  | { ok: false; error: string; kind: "expired" | "blocked" | "error" };

async function webFetchText(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ status: number; text: string; url: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await agentFetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, text: await res.text(), url: res.url };
  } finally {
    clearTimeout(timer);
  }
}

/** webFetchText plus the response's Set-Cookie values. The one
 * caller that needs them is Gemini: Google rotates the
 * short-lived __Secure-1PSIDTS through Set-Cookie on ordinary
 * responses, and a rotation the space fails to capture leaves
 * the stored token reading "expired" while the user's browser
 * session is still alive. */
async function webFetchFull(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ status: number; text: string; url: string; setCookies: string[] }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await agentFetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let setCookies: string[] = [];
    const headers = res.headers as Headers & {
      getSetCookie?: () => string[];
    };
    if (typeof headers.getSetCookie === "function") {
      try {
        setCookies = headers.getSetCookie();
      } catch {
        setCookies = [];
      }
    }
    if (!setCookies.length) {
      const single = res.headers.get("set-cookie");
      if (single) setCookies = [single];
    }
    return { status: res.status, text, url: res.url, setCookies };
  } finally {
    clearTimeout(timer);
  }
}

function webJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function webSnippet(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Cookie header for cookie-based sites: a full pasted Cookie
 * string is used as-is; a bare value becomes the site's primary
 * session cookie. */
function webCookieHeader(token: string, primaryName: string): string {
  const t = token.trim();
  if (t.includes("=")) return t;
  return `${primaryName}=${t}`;
}

function webHttpFailure(
  site: string,
  status: number,
  text: string,
): DsWebFailure {
  return {
    ok: false,
    error: `${site} 网页请求返回 HTTP ${status}${webSnippet(text) ? `：${webSnippet(text)}` : ""}`,
    kind: status === 401 ? "expired" : status === 403 ? "blocked" : "error",
  };
}

/** The REAL reason a thrown error happened, as one line: the
 * error's own name + message, its `code` when it carries one
 * (undici / Node system errors do), and the `cause` chain
 * unwrapped up to three levels — a failed fetch reports only
 * "TypeError: fetch failed" on the surface, while the actual
 * reason (ECONNREFUSED, UND_ERR_…, a DNS failure, an invalid
 * header value) lives in `cause`. Nothing here can contain a
 * credential: header-validation errors name the header, never
 * its value, and network causes carry OS-level text only. */
function describeThrownError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur != null; depth++) {
    if (cur instanceof Error) {
      const code = (cur as { code?: unknown }).code;
      parts.push(
        `${cur.name}: ${cur.message}${typeof code === "string" && code ? ` [${code}]` : ""}`,
      );
      cur = (cur as { cause?: unknown }).cause;
    } else if (typeof cur === "string") {
      parts.push(cur);
      break;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" ← 原因：");
}

function webNetFailure(site: string, e: unknown): DsWebFailure {
  const detail = describeThrownError(e);
  if (e instanceof Error && e.name === "AbortError")
    return {
      ok: false,
      error: `${site} 网页请求超时（${detail}）`,
      kind: "error",
    };
  // The underlying error is part of the message on purpose: a
  // bare "网络错误，无法连接 X" swallowed exactly the fact needed
  // to tell a local failure (invalid header, refused connection,
  // a pre-fetch exception) from a remote one.
  return {
    ok: false,
    error: `网络错误，无法连接 ${site}（底层错误：${detail}）`,
    kind: "error",
  };
}

/* ---- ChatGPT (chatgpt.com) ----
 * Token: the accessToken shown by chatgpt.com/api/auth/session.
 * Validate: GET /backend-api/me. Chat: the sentinel
 * chat-requirements token, then POST /backend-api/conversation
 * (SSE). When the requirements answer demands a proof-of-work or a
 * Turnstile check, that is reported as-is — it is a real gate of
 * the web product, not something to bypass silently. */
async function validateChatgpt(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText("https://chatgpt.com/backend-api/me", {
      headers: { Authorization: `Bearer ${token.trim()}`, "User-Agent": WEB_UA },
    });
    if (res.status !== 200) return webHttpFailure("ChatGPT", res.status, res.text);
    const root = webJson(res.text);
    const account =
      dsFindField(root, ["email"], 0) || dsFindField(root, ["name"], 0);
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("ChatGPT", e);
  }
}

/** Uploads ONE chat picture through ChatGPT web's own files
 * flow (the three-step handshake the official client performs,
 * documented by the ChatGPTWeb protocol notes): register the
 * file at POST /backend-api/files (use_case "multimodal", with
 * the picture's real width/height), PUT the bytes to the
 * returned pre-signed upload_url (an Azure blob URL — the
 * x-ms-blob-type header is part of that contract), then notify
 * POST /backend-api/files/{id}/upload-complete (older clients
 * name the same step /uploaded; a 404/405 there falls back to
 * it). Returns the file id the conversation message then
 * points at with an image_asset_pointer part. */
async function chatgptUploadImage(
  headers: Record<string, string>,
  image: ChatImage,
): Promise<
  | { ok: true; fileId: string; width: number; height: number; size: number }
  | DsWebFailure
> {
  const bytes = base64ToBytes(image.dataBase64);
  const size = imageSizeFromBytes(bytes);
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const created = await webFetchText("https://chatgpt.com/backend-api/files", {
    method: "POST",
    headers,
    body: JSON.stringify({
      file_name: image.fileName || "image.png",
      file_size: bytes.length,
      use_case: "multimodal",
      ...(width && height ? { width, height } : {}),
    }),
  });
  if (created.status !== 200)
    return { ...webHttpFailure("ChatGPT", created.status, created.text) };
  const createdRoot = webJson(created.text);
  const fileId = strField(createdRoot?.file_id) || strField(createdRoot?.id);
  const uploadUrl = strField(createdRoot?.upload_url);
  if (!fileId || !uploadUrl)
    return { ok: false, error: "ChatGPT 网页端图片上传未返回文件编号或上传地址（接口可能已变更）", kind: "error" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const put = await agentFetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": image.mimeType,
      },
      body: bytes.slice().buffer as ArrayBuffer,
      signal: ctrl.signal,
    });
    if (!put.ok)
      return {
        ok: false,
        error: `ChatGPT 网页端图片上传失败：存储端返回 HTTP ${put.status}`,
        kind: "error",
      };
  } catch (e) {
    return { ...webNetFailure("ChatGPT", e) };
  } finally {
    clearTimeout(timer);
  }
  let done = await webFetchText(
    `https://chatgpt.com/backend-api/files/${fileId}/upload-complete`,
    { method: "POST", headers, body: JSON.stringify({}) },
  );
  if (done.status === 404 || done.status === 405) {
    done = await webFetchText(
      `https://chatgpt.com/backend-api/files/${fileId}/uploaded`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
  }
  if (done.status !== 200)
    return { ...webHttpFailure("ChatGPT", done.status, done.text) };
  return { ok: true, fileId, width, height, size: bytes.length };
}

async function chatChatgpt(
  token: string,
  prompt: string,
  _deviceId?: string,
  _webOpts?: { mode?: string; search?: boolean },
  image?: ChatImage | null,
): Promise<WebChatResult> {
  const t = token.trim();
  const headers = {
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
    "User-Agent": WEB_UA,
    Origin: "https://chatgpt.com",
    Referer: "https://chatgpt.com/",
  };
  try {
    const reqRes = await webFetchText(
      "https://chatgpt.com/backend-api/sentinel/chat-requirements",
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    if (reqRes.status !== 200)
      return { ...webHttpFailure("ChatGPT", reqRes.status, reqRes.text) };
    const reqRoot = webJson(reqRes.text);
    const requirementsToken = strField(reqRoot?.token);
    if (!requirementsToken) {
      const pow = asRecord(reqRoot?.proofofwork);
      if (pow?.required === true)
        return {
          ok: false,
          error: "ChatGPT 网页端这次要求工作量证明（PoW）验证，服务端暂时无法自动完成，请稍后再试",
          kind: "blocked",
        };
      return {
        ok: false,
        error: "ChatGPT 网页端未返回会话许可（接口可能已变更或账号需要额外验证）",
        kind: "error",
      };
    }
    // A picture on this turn is uploaded through ChatGPT's own
    // files flow first; the message then carries it as an
    // image_asset_pointer part inside a multimodal_text content
    // (the official client's shape), with the same file listed
    // in the message metadata's attachments. An upload ChatGPT
    // does not confirm ends the reply with its real reason —
    // the message is never re-sent as text only.
    let messageContent: Record<string, unknown> = {
      content_type: "text",
      parts: [prompt],
    };
    let messageMetadata: Record<string, unknown> = {};
    if (image) {
      const up = await chatgptUploadImage(headers, image);
      if (!up.ok) return { ...up };
      messageContent = {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "image_asset_pointer",
            asset_pointer: `file-service://${up.fileId}`,
            size_bytes: up.size,
            width: up.width,
            height: up.height,
          },
          prompt,
        ],
      };
      messageMetadata = {
        attachments: [
          {
            id: up.fileId,
            size: up.size,
            name: image.fileName || "image.png",
            mimeType: image.mimeType,
            width: up.width,
            height: up.height,
          },
        ],
      };
    }
    const res = await webFetchText(
      "https://chatgpt.com/backend-api/conversation",
      {
        method: "POST",
        headers: {
          ...headers,
          Accept: "text/event-stream",
          "openai-sentinel-chat-requirements-token": requirementsToken,
        },
        body: JSON.stringify({
          action: "next",
          messages: [
            {
              id: crypto.randomUUID(),
              author: { role: "user" },
              create_time: Date.now() / 1000,
              content: messageContent,
              metadata: messageMetadata,
            },
          ],
          parent_message_id: crypto.randomUUID(),
          model: "auto",
          timezone_offset_min: -new Date().getTimezoneOffset(),
          history_and_training_disabled: true,
          conversation_mode: { kind: "primary_assistant" },
          supports_buffering: true,
        }),
      },
      90_000,
    );
    if (res.status !== 200)
      return { ...webHttpFailure("ChatGPT", res.status, res.text) };
    let full = "";
    let appended = "";
    // Generated media rides in the message's parts as NON-string
    // asset pointers (a generated picture is an
    // image_asset_pointer part, a produced file a file asset):
    // the pointer names a file-service id, not a URL, so the ids
    // are collected here and resolved to download URLs below.
    const assetFiles = new Map<string, "image" | "file">();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const data = webJson(payload);
      if (!data) continue;
      const message = asRecord(data.message);
      const content = asRecord(message?.content);
      const parts = Array.isArray(content?.parts) ? content.parts : [];
      const partText = parts.filter((p) => typeof p === "string").join("");
      if (asRecord(message?.author)?.role === "assistant") {
        if (partText) full = partText;
        for (const p of parts) {
          const part = asRecord(p);
          if (!part) continue;
          const pointer =
            typeof part.asset_pointer === "string" ? part.asset_pointer : "";
          const fileId =
            /^file-service:\/\/([A-Za-z0-9_-]+)/.exec(pointer)?.[1] ?? "";
          if (fileId)
            assetFiles.set(
              fileId,
              part.content_type === "image_asset_pointer" ? "image" : "file",
            );
        }
      }
      if (typeof data.v === "string" && typeof data.p === "string" && data.p.includes("/content/parts/"))
        appended += data.v;
    }
    const media: WebMediaItem[] = [];
    for (const [fileId, kind] of [...assetFiles].slice(0, 4)) {
      try {
        const dl = await webFetchText(
          `https://chatgpt.com/backend-api/files/${fileId}/download`,
          { headers },
        );
        if (dl.status !== 200) continue;
        const downloadUrl = strField(webJson(dl.text)?.download_url);
        if (downloadUrl)
          media.push({ kind, url: downloadUrl, referer: "https://chatgpt.com/" });
      } catch {
        // an unresolvable asset is simply left out of the reply
      }
    }
    const text = (full || appended).trim();
    if (!text && !media.length)
      return { ok: false, error: "ChatGPT 网页端返回了空回复", kind: "error" };
    return { ok: true, text, media: media.length ? media : undefined };
  } catch (e) {
    return { ...webNetFailure("ChatGPT", e) };
  }
}

/* ---- Claude (claude.ai) ----
 * Token: the sessionKey cookie. Validate: GET /api/organizations
 * (+ /api/account for the email). Chat: create a conversation in
 * the first organization, POST its completion (SSE of
 * {"completion": …} fragments), then delete the conversation. */
function claudeHeaders(token: string): Record<string, string> {
  return {
    Cookie: webCookieHeader(token, "sessionKey"),
    "User-Agent": WEB_UA,
    Accept: "application/json",
    Origin: "https://claude.ai",
    Referer: "https://claude.ai/",
  };
}

async function claudeOrgId(token: string): Promise<{ orgId: string } | DsWebFailure> {
  const res = await webFetchText("https://claude.ai/api/organizations", {
    headers: claudeHeaders(token),
  });
  if (res.status !== 200) return webHttpFailure("Claude", res.status, res.text);
  let orgs: unknown = null;
  try {
    orgs = JSON.parse(res.text);
  } catch {
    orgs = null;
  }
  const first = Array.isArray(orgs) ? asRecord(orgs[0]) : null;
  const orgId = strField(first?.uuid);
  if (!orgId)
    return { ok: false, error: "Claude 网页端未返回组织信息（令牌可能已失效）", kind: "expired" };
  return { orgId };
}

async function validateClaude(token: string): Promise<DsValidateResult> {
  try {
    const org = await claudeOrgId(token);
    if ("ok" in org && org.ok === false) return org;
    let account = "";
    try {
      const acc = await webFetchText("https://claude.ai/api/account", {
        headers: claudeHeaders(token),
      });
      if (acc.status === 200)
        account =
          dsFindField(webJson(acc.text), ["email_address", "email"], 0) ||
          dsFindField(webJson(acc.text), ["display_name", "name"], 0);
    } catch {
      // account label is a nicety; the org check already proved login
    }
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("Claude", e);
  }
}

async function chatClaude(
  token: string,
  prompt: string,
  _deviceId?: string,
  _webOpts?: { mode?: string; search?: boolean },
  image?: ChatImage | null,
): Promise<WebChatResult> {
  try {
    const org = await claudeOrgId(token);
    if ("ok" in org && org.ok === false) return { ...org };
    const orgId = (org as { orgId: string }).orgId;
    const created = await webFetchText(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
      {
        method: "POST",
        headers: { ...claudeHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      },
    );
    if (created.status !== 200 && created.status !== 201)
      return { ...webHttpFailure("Claude", created.status, created.text) };
    const convId = strField(webJson(created.text)?.uuid);
    if (!convId)
      return { ok: false, error: "Claude 网页端未返回会话编号（接口可能已变更）", kind: "error" };
    const cleanup = async () => {
      try {
        await webFetchText(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}`,
          { method: "DELETE", headers: claudeHeaders(token) },
        );
      } catch {
        // best-effort cleanup only
      }
    };
    // A picture on this turn is uploaded into THIS conversation
    // through Claude web's own wiggle upload (POST
    // /api/organizations/{org}/conversations/{conv}/wiggle/upload-file,
    // multipart; images skip the convert_document step documents
    // need), and the completion then names the returned
    // file_uuid in its files array — the official client's
    // shape. An upload Claude does not confirm ends the reply
    // with its real reason; nothing is re-sent as text only.
    let fileUuids: string[] = [];
    if (image) {
      const bytes = base64ToBytes(image.dataBase64);
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes.slice().buffer as ArrayBuffer], { type: image.mimeType }),
        image.fileName || "image.png",
      );
      const up = await webFetchText(
        `https://claude.ai/api/organizations/${orgId}/conversations/${convId}/wiggle/upload-file`,
        {
          method: "POST",
          headers: { ...claudeHeaders(token), Accept: "*/*" },
          body: form,
        },
        60_000,
      );
      if (up.status !== 200 && up.status !== 201) {
        await cleanup();
        return { ...webHttpFailure("Claude", up.status, up.text) };
      }
      const upRoot = webJson(up.text);
      const fileUuid =
        strField(upRoot?.file_uuid) || strField(upRoot?.uuid) || strField(upRoot?.id);
      if (!fileUuid) {
        await cleanup();
        return {
          ok: false,
          error: "Claude 网页端图片上传未返回文件编号（接口可能已变更）",
          kind: "error",
        };
      }
      fileUuids = [fileUuid];
    }
    const res = await webFetchText(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
      {
        method: "POST",
        headers: {
          ...claudeHeaders(token),
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          prompt,
          parent_message_uuid: crypto.randomUUID(),
          timezone: "Asia/Shanghai",
          attachments: [],
          files: fileUuids,
        }),
      },
      90_000,
    );
    if (res.status !== 200) {
      await cleanup();
      return { ...webHttpFailure("Claude", res.status, res.text) };
    }
    let text = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = webJson(trimmed.slice(5).trim());
      if (!data) continue;
      if (typeof data.completion === "string") text += data.completion;
      const delta = asRecord(data.delta);
      if (data.type === "content_block_delta" && typeof delta?.text === "string")
        text += delta.text;
      // Any non-text structure an event carries (a file or media
      // block) is harvested; the prose fields themselves are
      // excluded by name.
      bag.add(
        collectMediaFromValue(data, { skipKeys: ["completion", "text"] }),
      );
    }
    await cleanup();
    const out = text.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "Claude 网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("Claude", e) };
  }
}

/* ---- Gemini (gemini.google.com) ----
 * Token: the __Secure-1PSID + __Secure-1PSIDTS cookies — pasted
 * as "psid|psidts", as a bare PSID, or as a full Cookie string.
 * Validate + chat bootstrap from the /app page itself (its
 * session token only exists in the logged-in page); chat posts
 * to the BardFrontendService StreamGenerate endpoint the page
 * uses. Two adaptations keep a pasted login working the way the
 * real web client keeps it:
 *  - The page's "at" session token is read from SNlM0e with
 *    thykhd as fallback: Google renamed the WIZ_global_data key,
 *    and current pages may carry only the new name — a bootstrap
 *    that insists on SNlM0e reads a live login as logged out.
 *  - __Secure-1PSIDTS is short-lived and Google rotates it (via
 *    Set-Cookie on ordinary responses, and on demand through
 *    accounts.google.com/RotateCookies — the web client's own
 *    keep-alive, which every maintained unofficial client also
 *    performs). The bootstrap captures Set-Cookie rotations, and
 *    when the stored pair is no longer recognised it makes ONE
 *    rotation call and retries before reporting the login
 *    expired. A rotated value is handed back (the validator's
 *    accessToken, the chat result's refreshedToken) so the
 *    caller persists it; without that, a verified login decays
 *    into "expired" while the browser session is still alive. */

type GeminiCookies = { psid: string; psidts: string; header: string };

function geminiPairHeader(psid: string, psidts: string): string {
  return psidts
    ? `__Secure-1PSID=${psid}; __Secure-1PSIDTS=${psidts}`
    : `__Secure-1PSID=${psid}`;
}

/** Parses every paste shape the settings panel accepts into the
 * cookie pair plus the Cookie header to send. A full Cookie
 * string is sent as pasted (it may carry the wider .google.com
 * jar, which is also what reaches a non-default signed-in
 * account); the pair is still extracted from it so a rotation
 * can be folded back into the string. A leading "Cookie:" label
 * (copied from a network panel's request headers) is stripped. */
function parseGeminiToken(token: string): GeminiCookies {
  let t = token.trim();
  if (/^cookie\s*:/i.test(t)) t = t.replace(/^cookie\s*:/i, "").trim();
  if (t.includes("=")) {
    const grab = (name: string) =>
      new RegExp(`(?:^|[;,\\s])${name}=([^;,]+)`).exec(t)?.[1]?.trim() ?? "";
    return {
      psid: grab("__Secure-1PSID"),
      psidts: grab("__Secure-1PSIDTS"),
      header: t,
    };
  }
  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  if (t.includes("|")) {
    const [psid = "", psidts = ""] = t.split("|").map(unquote);
    return { psid, psidts, header: geminiPairHeader(psid, psidts) };
  }
  const bare = unquote(t);
  return { psid: bare, psidts: "", header: geminiPairHeader(bare, "") };
}

/** The stored token with a rotated PSIDTS folded back in, kept
 * in the shape the user pasted: a Cookie string gets its
 * 1PSIDTS value replaced (or appended when it had none), the
 * pipe form is re-joined, a bare PSID gains the TS beside it. */
function geminiTokenWithPsidts(token: string, psidts: string): string {
  const t = token.trim();
  if (!psidts) return t;
  if (/__Secure-1PSIDTS=/.test(t))
    return t.replace(/(__Secure-1PSIDTS=)[^;,]+/, `$1${psidts}`);
  if (t.includes("=")) return `${t}; __Secure-1PSIDTS=${psidts}`;
  if (t.includes("|")) {
    const [psid = ""] = t.split("|").map((s) => s.trim());
    return `${psid}|${psidts}`;
  }
  return `${t}|${psidts}`;
}

function psidtsFromSetCookies(setCookies: string[]): string {
  for (const line of setCookies) {
    const v = /__Secure-1PSIDTS=([^;,]+)/.exec(line)?.[1]?.trim();
    if (v) return v;
  }
  return "";
}

/** One PSIDTS rotation, the web client's own keep-alive call:
 * POST accounts.google.com/RotateCookies; the NEW
 * __Secure-1PSIDTS arrives as a Set-Cookie on the response.
 * Returns the new value, or "" when Google did not rotate
 * (session dead, or the call itself failed) — callers read ""
 * as "no refresh happened", never as success. */
async function geminiRotatePsidts(cookieHeader: string): Promise<string> {
  try {
    const res = await webFetchFull(
      "https://accounts.google.com/RotateCookies",
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "User-Agent": WEB_UA,
          "Content-Type": "application/json",
          Origin: "https://accounts.google.com",
        },
        body: '[000,"-0000000000000000000"]',
      },
      20_000,
    );
    if (res.status !== 200) return "";
    return psidtsFromSetCookies(res.setCookies);
  } catch {
    return "";
  }
}

type GeminiBootstrap = {
  at: string;
  bl: string;
  sid: string;
  account: string;
  /** The page's upload tokens (WIZ_global_data qKIAYe / Ylro7b):
   * the Scotty resumable upload to content-push.googleapis.com
   * names them as Push-ID / X-Client-Pctx. Either may be '' when
   * the page did not carry it — the upload then uses the web
   * client's long-standing fallback values. */
  pushId: string;
  pctx: string;
  /** The Cookie header that actually authenticated (after any
   * rotation), for the chat call that follows. */
  header: string;
  /** The PSIDTS in effect after any rotation. */
  psidts: string;
  /** The stored token with a rotated PSIDTS folded in, when the
   * effective PSIDTS differs from the stored one — the caller
   * persists it so the login survives the rotation. */
  refreshedToken: string;
};

async function geminiBootstrap(
  token: string,
): Promise<GeminiBootstrap | DsWebFailure> {
  const parsed = parseGeminiToken(token);
  const load = async (header: string) => {
    const res = await webFetchFull("https://gemini.google.com/app", {
      headers: { Cookie: header, "User-Agent": WEB_UA },
    });
    const grab = (key: string) =>
      new RegExp(`"${key}":"([^"]+)"`).exec(res.text)?.[1] ?? "";
    return {
      res,
      // SNlM0e is the long-standing key, thykhd the name current
      // pages use for the same token — accept either.
      at: grab("SNlM0e") || grab("thykhd"),
      bl: grab("cfb2h"),
      sid: grab("FdrFJe"),
      pushId: grab("qKIAYe"),
      pctx: grab("Ylro7b"),
      account: /[\w.+-]+@[\w-]+\.[\w.]+/.exec(res.text)?.[0] ?? "",
      rotated: psidtsFromSetCookies(res.setCookies),
    };
  };
  let attempt = await load(parsed.header);
  if (attempt.res.status === 403)
    return webHttpFailure("Gemini", attempt.res.status, attempt.res.text);
  let header = parsed.header;
  let effectiveTs = parsed.psidts;
  // A fresh PSIDTS may already have arrived with this response.
  if (attempt.rotated && attempt.rotated !== effectiveTs)
    effectiveTs = attempt.rotated;
  if (!attempt.at && parsed.psid) {
    // The stored pair was not recognised: rotate the PSIDTS
    // once and retry with the fresh value before calling the
    // login expired — exactly the web client's recovery.
    const rotated = await geminiRotatePsidts(parsed.header);
    if (rotated && rotated !== parsed.psidts) {
      header = geminiTokenWithPsidts(parsed.header, rotated);
      effectiveTs = rotated;
      attempt = await load(header);
      if (attempt.res.status === 403)
        return webHttpFailure("Gemini", attempt.res.status, attempt.res.text);
      if (attempt.rotated && attempt.rotated !== effectiveTs)
        effectiveTs = attempt.rotated;
    }
  }
  if (attempt.res.url.includes("accounts.google.com") || !attempt.at)
    return {
      ok: false,
      error:
        "Gemini 网页未处于登录状态（Cookie 已失效或不完整，需要 __Secure-1PSID 和 __Secure-1PSIDTS 两个值）",
      kind: "expired",
    };
  return {
    at: attempt.at,
    bl: attempt.bl,
    sid: attempt.sid,
    account: attempt.account,
    pushId: attempt.pushId,
    pctx: attempt.pctx,
    header,
    psidts: effectiveTs,
    refreshedToken:
      effectiveTs && effectiveTs !== parsed.psidts
        ? geminiTokenWithPsidts(token, effectiveTs)
        : "",
  };
}

async function validateGemini(token: string): Promise<DsValidateResult> {
  try {
    const boot = await geminiBootstrap(token);
    if ("ok" in boot && boot.ok === false) return boot;
    const b = boot as GeminiBootstrap;
    if (!b.at)
      return { ok: false, error: "Gemini 网页未返回会话令牌（页面结构可能已变更）", kind: "error" };
    // accessToken carries the (possibly rotated) token back so
    // verifyWebToken can persist the fresh PSIDTS.
    return { ok: true, accessToken: b.refreshedToken || token.trim(), account: b.account };
  } catch (e) {
    return webNetFailure("Gemini", e);
  }
}

/** Gemini serves its generated images from Google's user-content
 * image CDN (lh3.googleusercontent.com) with extensionless URLs,
 * so the generic extension-based collector cannot recognise
 * them; inside a reply candidate (whose text parts the caller
 * blanks out first), a URL on that host is a generated image. */
function collectGeminiImageUrls(value: unknown): WebMediaItem[] {
  const out: WebMediaItem[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v == null || out.length >= 8) return;
    if (typeof v === "string") {
      if (v.startsWith("https://lh3.googleusercontent.com/"))
        out.push({ kind: "image", url: v, referer: "https://gemini.google.com/" });
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typeof v === "object")
      for (const item of Object.values(v as Record<string, unknown>))
        walk(item, depth + 1);
  };
  walk(value, 0);
  return out;
}

/** Uploads ONE chat picture to Gemini's own storage, the web
 * client's Scotty resumable-upload flow (documented by the
 * gemini-web2api multimodal notes): POST
 * content-push.googleapis.com/upload/ with X-Goog-Upload-Command
 * "start" (Push-ID / X-Client-Pctx from the /app page's
 * WIZ_global_data, X-Tenant-Id "bard-storage") returns an
 * X-Goog-Upload-URL session; POSTing the bytes there with
 * "upload, finalize" returns the file reference
 * (/contrib_service/ttl_1d/…) the StreamGenerate message then
 * carries. Any step Google refuses ends with its real status —
 * the picture is never re-sent as text. */
async function geminiUploadImage(
  boot: GeminiBootstrap,
  image: ChatImage,
): Promise<{ ok: true; fileRef: string } | DsWebFailure> {
  const bytes = base64ToBytes(image.dataBase64);
  const pushId = boot.pushId || "feeds/mcudyrk2a4khkz";
  const pctx = boot.pctx || "CgcSBWjK7pYx";
  try {
    const start = await agentFetch("https://content-push.googleapis.com/upload/", {
      method: "POST",
      headers: {
        Cookie: boot.header,
        "User-Agent": WEB_UA,
        "Push-ID": pushId,
        "X-Tenant-Id": "bard-storage",
        "X-Client-Pctx": pctx,
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": image.mimeType,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: "",
    });
    if (start.status !== 200)
      return webHttpFailure("Gemini", start.status, await start.text());
    const uploadUrl =
      start.headers.get("x-goog-upload-url") ?? start.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl)
      return { ok: false, error: "Gemini 网页端图片上传未返回上传地址（接口可能已变更）", kind: "error" };
    const done = await agentFetch(uploadUrl, {
      method: "POST",
      headers: {
        "User-Agent": WEB_UA,
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "Content-Type": "application/octet-stream",
      },
      body: bytes.slice().buffer as ArrayBuffer,
    });
    const ref = (await done.text()).trim();
    if (done.status !== 200)
      return webHttpFailure("Gemini", done.status, ref);
    if (!ref.startsWith("/"))
      return { ok: false, error: "Gemini 网页端图片上传未返回文件引用（接口可能已变更）", kind: "error" };
    return { ok: true, fileRef: ref };
  } catch (e) {
    return webNetFailure("Gemini", e);
  }
}

async function chatGemini(
  token: string,
  prompt: string,
  _deviceId?: string,
  _webOpts?: { mode?: string; search?: boolean },
  image?: ChatImage | null,
): Promise<WebChatResult> {
  try {
    const boot = await geminiBootstrap(token);
    if ("ok" in boot && boot.ok === false) return { ...boot };
    const b = boot as GeminiBootstrap;
    // With a picture, the message slot carries the uploaded
    // file reference in its attachment slot — [prompt, 0, null,
    // [[null, null, fileRef]], null, null, 0] — the shape the
    // web client's own image sends use; text-only turns keep
    // the established minimal [prompt] slot untouched.
    let messageSlot: unknown = [prompt];
    if (image) {
      const up = await geminiUploadImage(b, image);
      if (!up.ok) return { ...up };
      messageSlot = [prompt, 0, null, [[null, null, up.fileRef]], null, null, 0];
    }
    const inner = JSON.stringify([messageSlot, null, null]);
    const form = new URLSearchParams();
    form.set("f.req", JSON.stringify([null, inner]));
    form.set("at", b.at);
    const reqid = Math.floor(100000 + Math.random() * 900000);
    const res = await webFetchFull(
      `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${encodeURIComponent(b.bl)}&f.sid=${encodeURIComponent(b.sid)}&hl=zh-CN&_reqid=${reqid}&rt=c`,
      {
        method: "POST",
        headers: {
          Cookie: b.header,
          "User-Agent": WEB_UA,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Origin: "https://gemini.google.com",
          Referer: "https://gemini.google.com/app",
        },
        body: form.toString(),
      },
      90_000,
    );
    // The generate response itself may rotate the PSIDTS once
    // more; the newest value wins and rides back for the caller
    // to persist.
    const postRotated = psidtsFromSetCookies(res.setCookies);
    const refreshedToken =
      postRotated && postRotated !== b.psidts
        ? geminiTokenWithPsidts(token, postRotated)
        : b.refreshedToken;
    if (res.status !== 200)
      return { ...webHttpFailure("Gemini", res.status, res.text) };
    let best = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("[")) continue;
      let arr: unknown = null;
      try {
        arr = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        const rec = asRecord(entry);
        const payload =
          rec && typeof rec[2] === "string" ? (rec[2] as string) : "";
        if (!payload) continue;
        let innerJson: unknown = null;
        try {
          innerJson = JSON.parse(payload);
        } catch {
          continue;
        }
        const candidates = asRecord(innerJson)?.[4];
        if (!Array.isArray(candidates)) continue;
        for (const cand of candidates) {
          const parts = asRecord(cand)?.[1];
          if (!Array.isArray(parts)) continue;
          const joined = parts.filter((p) => typeof p === "string").join("");
          if (joined.length > best.length) best = joined;
          // A non-string part is a media part, not prose.
          for (const p of parts)
            if (typeof p !== "string") bag.add(collectMediaFromValue(p));
          // Generated media (an Imagen picture, a video) rides
          // in the candidate's OTHER slots, not in its text
          // parts: harvest the candidate with the text parts
          // blanked out, so prose is never scanned.
          if (Array.isArray(cand)) {
            const clone = [...cand];
            if (clone.length > 1) clone[1] = [];
            bag.add(collectMediaFromValue(clone));
            bag.add(collectGeminiImageUrls(clone));
          }
        }
      }
    }
    const out = best.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "Gemini 网页端返回了空回复", kind: "error" };
    return {
      ok: true,
      text: out,
      media: bag.list,
      ...(refreshedToken ? { refreshedToken } : {}),
    };
  } catch (e) {
    return { ...webNetFailure("Gemini", e) };
  }
}

/* ---- Grok (grok.com) ----
 * Token: the sso cookie (or a full Cookie string). Validate: the
 * conversation list endpoint. Chat: POST /rest/app-chat/
 * conversations/new, whose NDJSON stream carries the reply in
 * result.response.token fragments (thinking fragments excluded).
 * grok.com sits behind Cloudflare: a 403 here is reported as
 * 被拦截， honestly. */
function grokHeaders(token: string): Record<string, string> {
  return {
    Cookie: webCookieHeader(token, "sso"),
    "User-Agent": WEB_UA,
    Accept: "application/json",
    Origin: "https://grok.com",
    Referer: "https://grok.com/",
  };
}

async function validateGrok(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText(
      "https://grok.com/rest/app-chat/conversations?pageSize=1",
      { headers: grokHeaders(token) },
    );
    if (res.status !== 200) return webHttpFailure("Grok", res.status, res.text);
    if (!webJson(res.text) && !res.text.trim().startsWith("["))
      return { ok: false, error: "Grok 网页端未返回预期的登录数据（令牌可能已失效）", kind: "expired" };
    return { ok: true, accessToken: token.trim(), account: "" };
  } catch (e) {
    return webNetFailure("Grok", e);
  }
}

async function chatGrok(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const res = await webFetchText(
      "https://grok.com/rest/app-chat/conversations/new",
      {
        method: "POST",
        headers: { ...grokHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          temporary: true,
          message: prompt,
          fileAttachments: [],
          imageAttachments: [],
          disableSearch: false,
          // Image generation stays available, as in Grok's own
          // web UI: when the reply generates a picture, its
          // attachment arrives in the stream and is harvested
          // below instead of vanishing.
          enableImageGeneration: true,
          returnImageBytes: false,
          returnRawGrokInXaiRequest: false,
          enableImageStreaming: false,
          imageGenerationCount: 2,
          forceConcise: false,
          toolOverrides: {},
          enableSideBySide: true,
          sendFinalMetadata: true,
          isReasoning: false,
          webpageUrls: [],
          disableTextFollowUps: false,
          responseMetadata: {},
          inputTypeOverride: 0,
          modelName: "grok-4",
          modelMode: "MODEL_MODE_AUTO",
        }),
      },
      90_000,
    );
    if (res.status !== 200)
      return { ...webHttpFailure("Grok", res.status, res.text) };
    let text = "";
    let finalMessage = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      const data = webJson(trimmed);
      const response = asRecord(asRecord(data?.result)?.response);
      if (!response) continue;
      if (typeof response.token === "string" && response.isThinking !== true)
        text += response.token;
      const modelResponse = asRecord(response.modelResponse);
      if (typeof modelResponse?.message === "string" && modelResponse.message)
        finalMessage = modelResponse.message;
      // Generated media arrives as attachment structures on the
      // response object (imageAttachment and friends); the
      // prose fields are excluded by name.
      bag.add(
        collectMediaFromValue(response, { skipKeys: ["token", "message"] }),
      );
    }
    const out = (text || finalMessage).trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "Grok 网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("Grok", e) };
  }
}

/* ---- Kimi (kimi.moonshot.cn) ----
 * Token: the accessToken JWT from localStorage. Validate:
 * GET /api/user. Chat: create a chat, then its completion/stream
 * SSE (event "cmpl" carries text increments). */
function kimiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    "Content-Type": "application/json",
    "User-Agent": WEB_UA,
    Origin: "https://kimi.moonshot.cn",
    Referer: "https://kimi.moonshot.cn/",
  };
}

async function validateKimi(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText("https://kimi.moonshot.cn/api/user", {
      headers: kimiHeaders(token),
    });
    if (res.status !== 200) return webHttpFailure("Kimi", res.status, res.text);
    const root = webJson(res.text);
    const account =
      dsFindField(root, ["email"], 0) || dsFindField(root, ["name", "nickname"], 0);
    if (!root)
      return { ok: false, error: "Kimi 网页端未返回账号数据（令牌可能已失效）", kind: "expired" };
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("Kimi", e);
  }
}

async function chatKimi(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const created = await webFetchText("https://kimi.moonshot.cn/api/chat", {
      method: "POST",
      headers: kimiHeaders(token),
      body: JSON.stringify({ name: "未命名会话", is_example: false }),
    });
    if (created.status !== 200)
      return { ...webHttpFailure("Kimi", created.status, created.text) };
    const chatId = dsFindField(webJson(created.text), ["id"], 0);
    if (!chatId)
      return { ok: false, error: "Kimi 网页端未返回会话编号（接口可能已变更）", kind: "error" };
    const res = await webFetchText(
      `https://kimi.moonshot.cn/api/chat/${chatId}/completion/stream`,
      {
        method: "POST",
        headers: { ...kimiHeaders(token), Accept: "text/event-stream" },
        body: JSON.stringify({
          kimiplus_id: "kimi",
          messages: [{ role: "user", content: prompt }],
          option: { thinking: false },
          refs: [],
          scene_labels: [],
        }),
      },
      90_000,
    );
    if (res.status !== 200)
      return { ...webHttpFailure("Kimi", res.status, res.text) };
    let text = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = webJson(trimmed.slice(5).trim());
      if (!data) continue;
      if (data.event === "cmpl" && typeof data.text === "string") text += data.text;
      // Non-text events (a generated image, an attached file)
      // are harvested with the prose field excluded by name.
      bag.add(collectMediaFromValue(data, { skipKeys: ["text"] }));
    }
    const out = text.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "Kimi 网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("Kimi", e) };
  }
}

/* ---- 千问 (chat.qwen.ai) ----
 * Token: the Bearer access token from localStorage (key
 * "token"). Validate: the chat list. Chat: create a chat, then
 * /api/chat/completions (SSE with answer-phase deltas), then
 * delete the chat.
 * Adaptations to how the site is actually called today:
 *  - Every call carries Alibaba's Baxia anti-bot headers
 *    (bx-v / bx-umidtoken / bx-ua), like the site's own web
 *    client: bx-v is the Baxia SDK version, bx-umidtoken is
 *    issued by Alibaba's WUM endpoint, bx-ua is the documented
 *    base64 browser-fingerprint blob. They are generated once
 *    and cached for a few minutes, as the client library does.
 *  - The newer /api/v2 POST endpoints answer this server's
 *    egress with the Aliyun WAF challenge page even with full
 *    Baxia headers (verified 2026-11-20 from this environment:
 *    v2 POST → 16 KB aliyun_waf HTML, while the v1 endpoints
 *    still serve the API with proper auth responses), so the
 *    adapter stays on the v1 endpoints and recognises the WAF
 *    page as 被拦截 if it ever appears there.
 *  - The paste mistake this site's users actually make — the
 *    browser Cookie string (which carries refresh_token, a
 *    REFRESH credential) instead of the localStorage token — is
 *    named with its fix instead of surfacing as generic expiry:
 *    no access token exists inside a Cookie string, and Qwen's
 *    refresh endpoints cannot exchange it (verified earlier:
 *    they answer HTTP 500 to every input shape).
 *  - Full-credential alignment (the console one-click export):
 *    the settings panel tells the user to run one console line
 *    on the logged-in chat.qwen.ai page —
 *    copy(JSON.stringify({ token: localStorage.getItem('token'),
 *    cookie: document.cookie, ua: navigator.userAgent })) —
 *    and paste the whole JSON here. parseQwenPaste splits it
 *    into the access token (stored as webToken), the full
 *    Cookie string (agents.webCookie) and the browser UA
 *    (agents.webUserAgent), and every validate/chat call then
 *    sends all three aligned — Bearer + Cookie header + the
 *    captured UA instead of the generic server UA — because
 *    Qwen's risk control binds the session to the UA and the
 *    session cookies, and a mismatch presents as a 401 that
 *    looks like expiry. When the Cookie string itself carries
 *    a token= pair that differs from the localStorage token,
 *    the Cookie's value wins (the two can fall out of sync;
 *    the Cookie is what the site's own requests actually
 *    carry). Verified live 2026-11-20 with a real captured
 *    bundle: Bearer-only and Bearer+Cookie+UA both reach the
 *    API and are judged on the token (that capture's token had
 *    genuinely expired — its JWT lived 15 minutes, iat→exp —
 *    and the API answered its own {"error":"Token has expired,
 *    please log in again."}), while Cookie-only gets the SPA
 *    shell, so the Bearer token stays the credential and the
 *    Cookie/UA are the alignment around it. The third check
 *    from the user's list — egress IP — cannot be aligned from
 *    here: the space's server egress is what it is, and no
 *    header changes it; the honest error surfaces when Qwen
 *    refuses. */

const QWEN_BAXIA_VERSION = "2.5.36";
/* The cache is keyed by the User-Agent the headers were
 * generated for: the bx-ua blob is a browser fingerprint and
 * the bx-umidtoken is issued against the requesting client, so
 * one cached set belongs to ONE browser identity. Two 千问
 * agents whose captured browser UAs differ must not share one
 * fingerprint set — the same cross-account sharing class as the
 * Doubao device-id incident — so a cache entry is only reused
 * for the exact UA it was minted under. */
let qwenBaxiaCache: {
  ua: string;
  headers: Record<string, string>;
  at: number;
} | null = null;

function qwenRandomString(len: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length] ?? "A";
  return out;
}

/** The bx-ua fingerprint blob, in the documented
 * encodeBaxiaToken shape: "<version digits>!" + base64 of the
 * fingerprint JSON (platform, language, cores, memory, timezone
 * offset — UTC+8 for this user — screen, WebGL renderer prefix,
 * canvas hash, audio fingerprint, timestamp, nonce). The canvas
 * field uses a random string, the documented fallback where no
 * MD5 is available. */
function qwenBaxiaUa(): string {
  const renderers = [
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  ];
  const data = {
    p: "Win32",
    l: "zh-CN",
    hc: 8,
    dm: 8,
    to: -480,
    sw: 1920 + Math.floor(Math.random() * 200),
    sh: 1080 + Math.floor(Math.random() * 100),
    cd: 24,
    pr: 1,
    wf: (renderers[Math.floor(Math.random() * renderers.length)] ?? "").slice(0, 20),
    cf: qwenRandomString(32),
    af: 124.04347527516074 + (Math.random() - 0.5) * 0.002,
    ts: Date.now(),
    r: Math.random(),
  };
  return `${QWEN_BAXIA_VERSION.replace(/\./g, "")}!${Buffer.from(JSON.stringify(data), "utf8").toString("base64")}`;
}

/** The three Baxia headers, generated once and cached for four
 * minutes (the client library's own cache TTL). bx-umidtoken is
 * the token Alibaba's WUM service issues — it arrives both as
 * the response's etag and inside the body's wu('…') call; the
 * documented fallback ('T2gA' + 40 random chars) covers a failed
 * fetch. A WUM outage must never break the chat call itself, so
 * every failure path lands on the fallback. */
async function qwenBaxiaHeaders(
  ua: string = WEB_UA,
): Promise<Record<string, string>> {
  if (
    qwenBaxiaCache &&
    qwenBaxiaCache.ua === ua &&
    Date.now() - qwenBaxiaCache.at < 4 * 60_000
  )
    return qwenBaxiaCache.headers;
  let umid = "";
  try {
    const res = await webFetchText(
      "https://sg-wum.alibaba.com/w/wu.json",
      { headers: { "User-Agent": ua } },
      10_000,
    );
    umid =
      /wu\('([^']+)'\)/.exec(res.text)?.[1] ??
      /__fycb\('([^']+)'\)/.exec(res.text)?.[1] ??
      "";
  } catch {
    umid = "";
  }
  if (!umid) umid = `T2gA${qwenRandomString(40)}`;
  const headers = {
    "bx-v": QWEN_BAXIA_VERSION,
    "bx-umidtoken": umid,
    "bx-ua": qwenBaxiaUa(),
  };
  qwenBaxiaCache = { ua, headers, at: Date.now() };
  return headers;
}

/** The aligned credential set around a 千问 token: the full
 * Cookie string and the browser User-Agent captured with it by
 * the console one-click export (agents.webCookie /
 * webUserAgent). Both optional — a bare-token paste leaves them
 * empty and the call falls back to the generic UA and no Cookie
 * header, exactly the pre-bundle behaviour. */
type QwenCreds = { cookie?: string; ua?: string };

async function qwenHeaders(
  token: string,
  creds?: QwenCreds,
): Promise<Record<string, string>> {
  const ua =
    creds?.ua && creds.ua.startsWith("Mozilla/") ? creds.ua : WEB_UA;
  return {
    Authorization: `Bearer ${token.trim()}`,
    "Content-Type": "application/json",
    "User-Agent": ua,
    Origin: "https://chat.qwen.ai",
    Referer: "https://chat.qwen.ai/",
    source: "web",
    ...(creds?.cookie ? { Cookie: creds.cookie } : {}),
    ...(await qwenBaxiaHeaders(ua)),
  };
}

/** Normalises a pasted 千问 token the way DeepSeek's paste is
 * normalised for its own storage shape: a JSON wrapper carrying
 * the token, a "Bearer " prefix, or surrounding quotes (all
 * shapes a DevTools copy can arrive in) are stripped down to the
 * bare access token. A Cookie string is NOT reshaped — it holds
 * no access token; qwenTokenShapeError names that case. */
function normalizeQwenToken(raw: string): string {
  let t = raw.trim();
  if (!t) return "";
  if (t.startsWith("{")) {
    try {
      const rec = asRecord(JSON.parse(t));
      const v =
        strField(rec?.token) ||
        strField(rec?.access_token) ||
        strField(rec?.value);
      if (v) return v.trim();
    } catch {
      // not JSON — fall through and use the raw string
    }
  }
  t = t.replace(/^Bearer\s+/i, "").trim();
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"'))
    t = t.slice(1, -1).trim();
  return t;
}

/** The value of one `name=value` pair inside a Cookie string
 * ('' when the pair is absent). */
function cookiePairValue(cookie: string, name: string): string {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

/** Splits a 千问 paste into its three credential parts. The
 * expected shape is the console one-click export — a JSON
 * object { token, cookie, ua } — but a bare token (any of the
 * shapes normalizeQwenToken already handled) and a bare Cookie
 * string are recognised too. Priority rule (the user's first
 * alignment check): when the Cookie string carries a token=
 * pair that differs from the localStorage token, the Cookie's
 * value is the effective token — the two can fall out of sync
 * and the Cookie is what the site's own requests carry. A bare
 * Cookie string yields cookie with token '' unless it carries
 * that pair; verifyWebToken names that case instead of storing
 * the Cookie as a token. */
function parseQwenPaste(raw: string): { token: string; cookie: string; ua: string } {
  const out = { token: "", cookie: "", ua: "" };
  const t = raw.trim();
  if (!t) return out;
  if (t.startsWith("{")) {
    try {
      const rec = asRecord(JSON.parse(t));
      if (rec) {
        out.token = (
          strField(rec.token) ||
          strField(rec.access_token) ||
          strField(rec.value)
        ).trim();
        out.cookie = (
          strField(rec.cookie) || strField(rec.cookies)
        ).trim();
        out.ua = (
          strField(rec.ua) ||
          strField(rec.userAgent) ||
          strField(rec.user_agent)
        ).trim();
        if (out.token || out.cookie || out.ua) {
          const fromCookie = out.cookie
            ? cookiePairValue(out.cookie, "token")
            : "";
          if (fromCookie && fromCookie !== out.token) out.token = fromCookie;
          out.token = normalizeQwenToken(out.token);
          return out;
        }
      }
    } catch {
      // not JSON — fall through to the bare shapes
    }
  }
  if (t.includes("=") && t.includes(";")) {
    out.cookie = t;
    out.token = cookiePairValue(t, "token");
    return out;
  }
  out.token = normalizeQwenToken(t);
  return out;
}

/** Non-null when the paste is the browser Cookie string rather
 * than the localStorage access token (see the block comment):
 * the failure names the exact fix instead of a generic expiry. */
function qwenTokenShapeError(token: string): DsWebFailure | null {
  const t = token.trim();
  if (/refresh_token/.test(t) || (t.includes("=") && t.includes(";")))
    return {
      ok: false,
      error:
        "粘贴的是 chat.qwen.ai 的浏览器 Cookie（里面是 refresh_token 刷新凭证），不是访问令牌：请在该站按 F12 打开「控制台」，运行设置说明里的一行命令导出整段凭证 JSON 再粘贴（或在「应用 → 本地存储」里复制 token 一项的值）",
      kind: "expired",
    };
  return null;
}

/** The failure a 千问 response body itself states, or null when
 * the body is a normal API payload: the Aliyun WAF challenge
 * page (a 风控 interception, not a token problem), or the JSON
 * envelope with success:false (its own code/message — the
 * "unauthorized" code is the expired case). An SSE stream
 * matches neither and passes through. */
function qwenApiFailure(text: string): DsWebFailure | null {
  if (text.includes("aliyun_waf"))
    return {
      ok: false,
      error:
        "千问网页请求被阿里云 WAF 风控拦截（返回的是验证页，不是接口数据），这不是令牌失效；请稍后再试",
      kind: "blocked",
    };
  const root = webJson(text);
  // The plain error shape the API answers auth failures with
  // (HTTP 401 + {"error":"Token has expired, please log in
  // again."} — verified live 2026-11-20): Qwen's own words are
  // the message, and an "expired" wording is the expired kind.
  if (root && typeof root.error === "string" && root.error) {
    if (/expired/i.test(root.error))
      return {
        ok: false,
        error: `千问网页端拒绝了该令牌：${root.error}（这个访问令牌有效期很短——实测约 15 分钟——过期后在浏览器控制台重新运行一行命令导出整段凭证再粘贴即可）`,
        kind: "expired",
      };
    return {
      ok: false,
      error: `千问网页端返回错误：${root.error}`,
      kind: "error",
    };
  }
  if (root && root.success === false) {
    const data = asRecord(root.data);
    const code = strField(data?.code);
    const details =
      strField(data?.details) || strField(root.message) || code;
    if (code === "unauthorized")
      return {
        ok: false,
        error: `千问网页端拒绝了该令牌${details ? `：${details}` : ""}`,
        kind: "expired",
      };
    return {
      ok: false,
      error: `千问网页端返回错误${details ? `：${details}` : ""}`,
      kind: "error",
    };
  }
  return null;
}

async function validateQwen(
  token: string,
  creds?: QwenCreds,
): Promise<DsValidateResult> {
  const shapeError = qwenTokenShapeError(token);
  if (shapeError) return shapeError;
  try {
    const res = await webFetchText(
      "https://chat.qwen.ai/api/chats/?page=1&page_size=1",
      { headers: await qwenHeaders(token, creds) },
    );
    const failure = qwenApiFailure(res.text);
    if (failure) return failure;
    if (res.status !== 200) return webHttpFailure("千问", res.status, res.text);
    if (!webJson(res.text))
      return { ok: false, error: "千问网页端未返回预期数据（令牌可能已失效）", kind: "expired" };
    return { ok: true, accessToken: token.trim(), account: "" };
  } catch (e) {
    return webNetFailure("千问", e);
  }
}

async function chatQwen(
  token: string,
  prompt: string,
  creds?: QwenCreds,
): Promise<WebChatResult> {
  const shapeError = qwenTokenShapeError(token);
  if (shapeError) return { ...shapeError };
  try {
    const headers = await qwenHeaders(token, creds);
    const created = await webFetchText("https://chat.qwen.ai/api/chats/new", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "New Chat",
        models: ["qwen3-max"],
        chat_mode: "normal",
        chat_type: "t2t",
        timestamp: Date.now(),
      }),
    });
    const createFailure = qwenApiFailure(created.text);
    if (createFailure) return { ...createFailure };
    if (created.status !== 200)
      return { ...webHttpFailure("千问", created.status, created.text) };
    const chatId = strField(asRecord(webJson(created.text)?.data)?.id);
    if (!chatId)
      return { ok: false, error: "千问网页端未返回会话编号（接口可能已变更）", kind: "error" };
    const cleanup = async () => {
      try {
        await webFetchText(`https://chat.qwen.ai/api/chats/${chatId}`, {
          method: "DELETE",
          headers,
        });
      } catch {
        // best-effort cleanup only
      }
    };
    const res = await webFetchText(
      `https://chat.qwen.ai/api/chat/completions?chat_id=${chatId}`,
      {
        method: "POST",
        headers: { ...headers, Accept: "text/event-stream" },
        body: JSON.stringify({
          stream: true,
          incremental_output: true,
          chat_type: "t2t",
          messages: [
            {
              fid: crypto.randomUUID(),
              parentId: null,
              childrenIds: [],
              role: "user",
              content: prompt,
              user_action: "chat",
              files: [],
              timestamp: Math.floor(Date.now() / 1000),
              models: ["qwen3-max"],
              chat_type: "t2t",
              feature_config: {
                thinking_enabled: false,
                output_schema: "phase",
                research_mode: "normal",
                auto_search: false,
                thinking_mode: "Fast",
                thinking_budget: 8192,
                auto_thinking: false,
              },
              extra: {},
              sub_chat_type: "t2t",
              parent_id: null,
            },
          ],
          chat_id: chatId,
          chat_mode: "normal",
          model: "qwen3-max",
          parent_id: null,
        }),
      },
      90_000,
    );
    const sendFailure = qwenApiFailure(res.text);
    if (sendFailure) {
      await cleanup();
      return { ...sendFailure };
    }
    if (res.status !== 200) {
      await cleanup();
      return { ...webHttpFailure("千问", res.status, res.text) };
    }
    let text = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const data = webJson(payload);
      const choices = Array.isArray(data?.choices) ? data.choices : [];
      const delta = asRecord(asRecord(choices[0])?.delta);
      if (
        typeof delta?.content === "string" &&
        (delta.phase === "answer" || delta.phase === undefined)
      )
        text += delta.content;
      // Media the reply carries outside its prose (an image
      // result, a produced file) rides in the payload's other
      // fields; the content fields are excluded by name.
      if (data)
        bag.add(collectMediaFromValue(data, { skipKeys: ["content"] }));
    }
    await cleanup();
    const out = text.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "千问网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("千问", e) };
  }
}

/* ---- 豆包 (www.doubao.com) ----
 * Token: the site's Cookie string (session cookies). Validate:
 * the /chat page itself must render in the logged-in state. Chat:
 * POST /chat/completion (SSE). The request is built to mirror the
 * browser's own call as closely as a server can: the query carries
 * the real client parameters (aid / version / platform), the
 * device and session identifiers are recovered from the pasted
 * Cookie itself (msToken, the ttwid-derived device id, the
 * flow_user_country region) and from the /chat page the site
 * serves for that Cookie (device_id / web_id / tea_uuid embedded
 * in its bootstrap data), instead of the empty placeholders and
 * hard-coded CN region an earlier version sent. device_id in
 * practice appears in neither source (it lives in the browser's
 * local storage), so the user can store their browser's real
 * device_id on the agent (agents.web_device_id, filled in from
 * the settings panel); a stored value wins over anything scraped.
 * The DIRECT chat route (chatDoubao below) does not try to
 * mirror the browser's signed call: it uses the
 * reverse-engineered token-only protocol. It is the ONLY
 * Doubao route — the real-browser relay that briefly sat in
 * front of it was removed at the user's explicit direction
 * (「豆包不要真实网页代发」). Its shark verification refusal
 * (bound to the direct sending environment, proven by control
 * tests) is then the honest result. When Doubao refuses a
 * call, its REAL response — HTTP status, its own error
 * code/message, a body snippet — is what gets reported, never
 * a generic guess. */
/* The Doubao request fingerprint, aligned with the user's own
 * browser (Windows Edge 157) exactly as captured from their real
 * browser's doubao.com requests on 2026-11-19 and proven
 * end-to-end the same day in the Doubao test space (21:13, a real
 * reply through this exact alignment): Edge user agent + client
 * hints, agw-js-conv: str, the browser's accept-language, and
 * doubao.com Origin/Referer. Doubao's shark risk control judges
 * the request's environment, so every Doubao call this space
 * makes (validation page read, menu read, parameter recovery and
 * the completion attempts) carries this one fingerprint instead
 * of the generic Linux WEB_UA the other sites use. */
const DOUBAO_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
/* The app/version pins and the region fallback, from the same
 * capture. These are DEFAULTS only: the region actually sent
 * comes from the sending agent's OWN Cookie (flow_user_country,
 * see doubaoRequestParams) and the version numbers from the
 * /chat page served for that Cookie, with these constants as
 * the fallback when a source yields nothing.
 *
 * There is deliberately NO device-identifier constant here any
 * more. An earlier version pinned web_id / tea_uuid for EVERY
 * Doubao agent to the FIRST account's browser web id
 * (7709538793523873295) and fell back to the FIRST account's
 * device_id (7709538820468164150) whenever an agent had none
 * stored — so a second Doubao agent sent the first account's
 * device identifiers together with its own Cookie, exactly the
 * cross-account mismatch Doubao's shark risk control judges
 * (and a plausible contributor to the earlier send failures
 * that were chased as network errors). Device identifiers are
 * per-account facts: buildDoubaoSendPlan now takes web_id /
 * tea_uuid and device_id ONLY from the sending agent's own
 * sources (its Cookie's ttwid, the page served for its Cookie,
 * and the device number stored on that agent alone), and omits
 * a parameter entirely when no own source yields it — another
 * agent's value is never substituted. */
const DOUBAO_STABLE_REGION = "TW";
const DOUBAO_STABLE_VERSION_CODE = "20800";
const DOUBAO_STABLE_PC_VERSION = "3.46.5";

/* ---- Doubao Cookie cleaning + per-field validation ----
 * Ported from the Doubao test space (dou-bao-ce-shi-kong-jian),
 * where this exact cleaning is part of the route that provably
 * sends. A raw pasted Cookie can carry invisible characters
 * (zero-width spaces, BOM, control chars, stray newlines) that
 * make the Cookie header itself illegal: undici then rejects
 * the fetch BEFORE any network traffic ("Header 'Cookie' has
 * invalid value"), which used to surface here as a 0-byte
 * "network error" with the real reason swallowed. Before a
 * send, invisible characters are stripped field by field, then
 * each field is validated on its own: the name must be a plain
 * token and the value must fit in a single header line
 * (Latin-1). Fields that still fail are reported BY NAME (the
 * value is never recorded anywhere) and the send is aborted —
 * see chatDoubao. doubaoHeaders applies the cleaned string for
 * every other Doubao call (login check, the /chat page read),
 * so no call site can put the raw paste on the wire. */
const HEADER_INVISIBLE_CHARS = /[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g;
const COOKIE_NAME_OK = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function checkDoubaoCookie(raw: string): {
  cleaned: string;
  invalidFields: string[];
} {
  const fields: { name: string; value: string }[] = [];
  const invalidFields: string[] = [];
  for (const part of raw.split(";")) {
    const eqIdx = part.indexOf("=");
    const rawName = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
    const rawValue = eqIdx >= 0 ? part.slice(eqIdx + 1) : "";
    const name = rawName.replace(HEADER_INVISIBLE_CHARS, "").trim();
    const value = rawValue.replace(HEADER_INVISIBLE_CHARS, "").trim();
    if (!name) continue;
    // Header values are byte strings: anything above Latin-1
    // makes the whole Cookie header unsendable.
    const valueOk = ![...value].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
    if (!COOKIE_NAME_OK.test(name) || !valueOk) {
      if (!invalidFields.includes(name)) invalidFields.push(name);
      continue;
    }
    if (!fields.some((f) => f.name === name)) fields.push({ name, value });
  }
  return {
    cleaned: fields.map((f) => `${f.name}=${f.value}`).join("; "),
    invalidFields,
  };
}

function doubaoHeaders(token: string): Record<string, string> {
  return {
    Cookie: checkDoubaoCookie(token).cleaned,
    "User-Agent": DOUBAO_BROWSER_UA,
    Origin: "https://www.doubao.com",
    Referer: "https://www.doubao.com/chat/",
    "agw-js-conv": "str",
    "sec-ch-ua":
      '"Not-A.Brand";v="99", "Microsoft Edge";v="157", "Chromium";v="157"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  };
}

/** One cookie's value out of a pasted Cookie header string. */
function cookieValue(cookie: string, name: string): string {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

/** The first capture of `re` in `text`, or "". */
function firstMatch(text: string, re: RegExp): string {
  return re.exec(text)?.[1] ?? "";
}

/** Normalises a user-supplied web device id (Doubao's device_id):
 * the user may paste the bare number, or a whole request URL /
 * header dump containing `device_id=…` — the number is extracted
 * either way. Anything that is not a plausible device id (10–25
 * digits) becomes "" — a wrong value is never sent. */
function cleanWebDeviceId(raw: string): string {
  const fromParam = /device_id=(\d{10,25})/.exec(raw)?.[1];
  if (fromParam) return fromParam;
  const digits = raw.replace(/\D/g, "");
  return /^\d{10,25}$/.test(digits) ? digits : "";
}

/** The request parameters of the browser's own Doubao call, as
 * far as they can be recovered server-side. Sources, in order:
 * the pasted Cookie (msToken rides in it; flow_user_country is
 * the account's real region; ttwid embeds the web device id) and
 * the /chat page served for that Cookie (its bootstrap data
 * embeds device_id / web_id / tea_uuid / version numbers). The
 * version defaults are the web client's current public version
 * numbers, captured from a real logged-in browser request
 * (version_code 20800, pc_version 3.46.5); page-embedded values
 * win for the version numbers. For the identity values the
 * Cookie's own evidence wins: a device_id the user stored on
 * the agent (from their own browser) beats the page scrape,
 * and the web id decoded from the Cookie's ttwid beats the
 * page's "web_id" match (measured unreliable — see the webId
 * assignment below). device_id / web_id stay empty only when
 * no own source yields one — they are never invented and never
 * borrowed from another agent. */
async function doubaoRequestParams(
  token: string,
  storedDeviceId = "",
): Promise<{
  deviceId: string;
  webId: string;
  versionCode: string;
  pcVersion: string;
  region: string;
  msToken: string;
  fp: string;
  /** The account id Doubao's passport account-info endpoint
   * reports for THIS Cookie (see doubaoAccountInfo), '' when
   * the endpoint gave no definitive answer. chatDoubao compares
   * it against the sending agent's recorded identity before any
   * attempt — the send-time arm of the account-collision guard.
   * Never scraped from the /chat page: the page embeds other
   * entities' user ids, which once made two different accounts
   * read as one. */
  accountId: string;
}> {
  const cookie = token.trim();
  const msToken = cookieValue(cookie, "msToken");
  // The browser sends its fingerprint as the fp query parameter;
  // it is the Cookie's s_v_web_id value.
  const fp = cookieValue(cookie, "s_v_web_id");
  const country = cookieValue(cookie, "flow_user_country").toUpperCase();
  // The account's real region is TW (its Cookie says so and the
  // user's own browser capture confirms region=TW); the fallback
  // is that same TW, not CN — a CN fallback was one of the
  // fingerprint mismatches the test-space alignment removed.
  const region = /^[A-Z]{2}$/.test(country) ? country : DOUBAO_STABLE_REGION;
  // ttwid is "1|<web id>|<issued at>|<signature>": its second
  // field is the web id the browser sends as web_id / tea_uuid.
  const ttwid = cookieValue(cookie, "ttwid");
  let webId = "";
  try {
    webId = decodeURIComponent(ttwid).split("|")[1] ?? "";
    if (!/^\d{10,}$/.test(webId)) webId = "";
  } catch {
    webId = "";
  }
  let deviceId = cleanWebDeviceId(storedDeviceId);
  let versionCode = DOUBAO_STABLE_VERSION_CODE;
  let pcVersion = DOUBAO_STABLE_PC_VERSION;
  // The account identity of THIS Cookie, from the passport
  // account-info endpoint only (see doubaoAccountInfo) — the
  // /chat page below is read for device / version recovery and
  // never for identity.
  let accountId = "";
  const info = await doubaoAccountInfo(cookie);
  if (info?.state === "ok") accountId = info.accountId;
  try {
    const page = await webFetchText("https://www.doubao.com/chat/", {
      headers: doubaoHeaders(cookie),
    });
    if (page.status === 200) {
      // Bootstrap data in the page is often embedded double-escaped
      // (\"device_id\":\"…\"), so the patterns tolerate backslashes.
      deviceId =
        deviceId ||
        firstMatch(page.text, /\\?"device_id\\?"\s*:\s*\\?"?(\d{10,})/) ||
        firstMatch(page.text, /\\?"deviceId\\?"\s*:\s*\\?"?(\d{10,})/) ||
        firstMatch(page.text, /[?&]device_id=(\d{10,})/);
      // The ttwid-derived web id (from THIS agent's own Cookie)
      // wins over the page scrape: the value the page's first
      // "web_id" match carries is NOT reliable — measured live
      // 2026-11-20 with two Doubao agents in the space, each
      // agent's page scrape returned a number equal to a
      // device_id (agent 15's page yielded 7709538820468164150,
      // agent 26's yielded 7709690590367991346), while the
      // ttwid is the identifier ByteDance issued for exactly
      // this cookie's browser session (and the value the proven
      // sends carried). The scrape stays only as the fallback
      // for a Cookie whose ttwid yields nothing.
      webId =
        webId ||
        firstMatch(page.text, /\\?"web_id\\?"\s*:\s*\\?"?(\d{10,})/) ||
        firstMatch(page.text, /\\?"tea_uuid\\?"\s*:\s*\\?"?(\d{10,})/);
      versionCode =
        firstMatch(page.text, /\\?"version_code\\?"\s*:\s*\\?"?(\d{3,})/) || versionCode;
      pcVersion =
        firstMatch(page.text, /\\?"pc_version\\?"\s*:\s*\\?"(\d+\.\d+\.\d+)\\?"/) || pcVersion;
    }
  } catch {
    // The completion call is still attempted with the
    // Cookie-derived values; its own result is reported as-is.
  }
  return { deviceId, webId, versionCode, pcVersion, region, msToken, fp, accountId };
}

/** A short, honest digest of what Doubao's completion endpoint
 * actually returned, for the failure message: HTTP status, byte
 * size, any error code/message the body itself carries, and a
 * plain-text snippet. Nothing here is inferred beyond the body. */
function doubaoResponseDigest(
  status: number,
  text: string,
  apiError: string,
): string {
  const parts = [`HTTP ${status}`, `${text.length} 字节`];
  if (apiError) parts.push(`接口错误：${apiError}`);
  const snippet = webSnippet(text);
  if (snippet) parts.push(`返回片段：${snippet}`);
  return parts.join("；");
}

/** One Cookie's OWN account identity, from Doubao's passport
 * account-info endpoint — the session-scoped API the official
 * web client itself calls to learn who is logged in:
 * GET /passport/account/info/v2/?aid=497858 with the Cookie
 * answers for THE SESSION THAT COOKIE BELONGS TO (user_id +
 * display name in `data`), and for an anonymous / dead session
 * it answers user_id 0 with error_code 13 (会话过期）. Probed
 * live from the sandbox on 2026-11-21: no Cookie at all returns
 * exactly that session-expired body, so a positive answer is
 * the account of the Cookie that was sent — never a site-wide
 * value, never another agent's.
 *
 * This endpoint is the ONLY source of Doubao account identity
 * (verification, the send plan's accountId, the collision
 * guard). The previous source — scraping `user_id` numbers out
 * of the /chat page HTML and anchoring on the first
 * `screen_name` — was unsound: the page embeds other entities'
 * ids and names (the built-in bot's own user object among
 * them), so two DIFFERENT accounts' pages could yield the SAME
 * scraped id/name pair (in production both Doubao agents'
 * pages yielded user_id 3537549997904156 / 用户8771319557785
 * while their Cookies, device ids and web ids all differed) —
 * a false same-account reading no page heuristic can rule out.
 * The page scrape survives only for device / version recovery
 * in doubaoRequestParams, never for identity.
 *
 * Returns null when the endpoint gave no definitive answer
 * (transport failure, non-JSON, an unexpected shape): the
 * caller then treats the identity as UNKNOWN — and an unknown
 * identity never forms a collision. */
async function doubaoAccountInfo(
  token: string,
): Promise<
  | { state: "ok"; accountId: string; account: string }
  | { state: "expired"; error: string }
  | null
> {
  try {
    const res = await webFetchText(
      "https://www.doubao.com/passport/account/info/v2/?aid=497858",
      { headers: doubaoHeaders(token) },
    );
    if (res.status === 403)
      return { state: "expired", error: "豆包网页请求被拦截（HTTP 403）" };
    const root = webJson(res.text);
    const data = asRecord(root?.data);
    if (!root || !data) return null;
    const uidRaw = data.user_id;
    const uid =
      typeof uidRaw === "number" && Number.isFinite(uidRaw) && uidRaw > 0
        ? String(Math.trunc(uidRaw))
        : typeof uidRaw === "string" && /^\d+$/.test(uidRaw) && uidRaw !== "0"
          ? uidRaw
          : "";
    if (uid) {
      const account =
        (typeof data.screen_name === "string" && data.screen_name) ||
        (typeof data.name === "string" && data.name) ||
        (typeof data.nickname === "string" && data.nickname) ||
        "";
      return { state: "ok", accountId: uid, account };
    }
    // No user id: the endpoint's own verdict is that this
    // session is not logged in (error_code 13 会话过期 when
    // anonymous — probed live). Any other no-id shape is
    // unexpected rather than an expiry proof.
    const code = typeof data.error_code === "number" ? data.error_code : 0;
    if (code !== 0 || root.message === "error") {
      const desc =
        typeof data.description === "string" && data.description
          ? data.description
          : "会话过期，请重新登录";
      return { state: "expired", error: `豆包网页未处于登录状态（${desc}）` };
    }
    return null;
  } catch {
    return null;
  }
}

async function validateDoubao(token: string): Promise<DsValidateResult> {
  // Identity + login state come from the passport account-info
  // endpoint, asked with THIS agent's own Cookie (see
  // doubaoAccountInfo). Only when that endpoint gives no
  // definitive answer does the /chat page decide the LOGIN
  // state alone — and then no account id is reported at all,
  // so the collision guard records nothing from a page scrape.
  const info = await doubaoAccountInfo(token);
  if (info?.state === "ok") {
    return {
      ok: true,
      accessToken: token.trim(),
      account: info.account,
      accountId: info.accountId,
    };
  }
  if (info?.state === "expired") {
    return { ok: false, error: info.error, kind: "expired" };
  }
  try {
    const res = await webFetchText("https://www.doubao.com/chat/", {
      headers: doubaoHeaders(token),
    });
    if (res.status === 403) return webHttpFailure("豆包", res.status, res.text);
    if (res.url.includes("passport") || res.text.includes("passport/login"))
      return { ok: false, error: "豆包网页未处于登录状态（Cookie 已失效）", kind: "expired" };
    if (
      res.text.includes("user_unique_id") ||
      res.text.includes("\"is_login\":true") ||
      res.text.includes("screen_name")
    ) {
      const account =
        /"screen_name":"([^"]+)"/.exec(res.text)?.[1] ??
        /"nickname":"([^"]+)"/.exec(res.text)?.[1] ??
        "";
      return {
        ok: true,
        accessToken: token.trim(),
        account,
        accountId: "",
      };
    }
    return {
      ok: false,
      error: "豆包网页未返回可确认的登录信息（请粘贴登录状态下的完整 Cookie）",
      kind: "error",
    };
  } catch (e) {
    return webNetFailure("豆包", e);
  }
}

/** Parses one Doubao completion response (named-event SSE, or a
 * plain JSON body when the call was refused outright) into the
 * assistant's reply text plus the site's own stream error, if
 * any. Handles the current protocol's content_block / patch_op
 * block updates and msg_finish_attr brief, and the legacy
 * event_data/message shape as a fallback.
 *
 * Media: a reply that generates media carries it in the answer
 * blocks as a NON-text block (an image-info object with
 * image_ori / image_preview / image_thumb variants — the same
 * shape as the conversation-cover object in Doubao's SSE_ACK —
 * a video-info object with a vid and play URLs, or an audio /
 * file object with its own URL fields). The text-only reader
 * this replaces dropped those blocks entirely, so a generated
 * picture existed in the官网 conversation but never reached the
 * space. Blocks are therefore also harvested for media (see
 * harvestMedia below) and the caller downloads the bytes into
 * the space's own storage. */
/* ---- Doubao reply extras: links & follow-up options ----
 * A Doubao reply carries more than its answer text (all shapes
 * below measured on a real captured stream, 2026-11-21):
 * - 联网搜索 references ride in a block_type 10025 block whose
 *   content.search_query_result_block.results[] holds one card
 *   per source ({text_card: {title, url, …}}), and the answer's
 *   inline citations ride on the text blocks themselves as
 *   meta_info[] entries whose `info` JSON names {title,
 *   website_name, url}.
 * - Follow-up question chips （你还可以问） ride in the patch
 *   payloads' ext.sp_v2 — a JSON STRING holding
 *   [{suggest_type: 1, content: "…？", …}] — with
 *   answer_finish_attr.has_suggest merely flagging their
 *   presence; some shapes instead carry suggest_questions /
 *   suggest_questions_v2 arrays of strings or {question}
 *   objects.
 * None of that is generated media (the media collector now
 * skips those structures outright — their tool icons were
 * being harvested as «generated pictures» next to pure-text
 * replies). The reader below turns them into plain-text
 * sections appended to the reply, so everything Doubao sent
 * is visible in the space: 参考链接 (numbered, title + URL)
 * and 你还可以问 (the suggestion chips as lines). */
type DoubaoExtras = {
  links: { title: string; url: string }[];
  suggestions: string[];
};

function collectDoubaoExtras(root: unknown): DoubaoExtras {
  const links: { title: string; url: string }[] = [];
  const linkSeen = new Set<string>();
  const suggestions: string[] = [];
  const suggSeen = new Set<string>();
  const pushLink = (title: string, url: string): void => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || linkSeen.has(u) || links.length >= 12)
      return;
    linkSeen.add(u);
    links.push({ title: title.trim().slice(0, 120), url: u });
  };
  const pushSuggestion = (raw: string): void => {
    const q = raw.trim();
    if (!q || suggSeen.has(q) || suggestions.length >= 6) return;
    suggSeen.add(q);
    suggestions.push(q);
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > 14 || node == null) return;
    if (typeof node === "string") {
      const s = node.trim();
      if ((s.startsWith("{") || s.startsWith("[")) && s.length > 2) {
        try {
          walk(JSON.parse(s) as unknown, depth + 1);
        } catch {
          // not JSON — an ordinary string, nothing to extract
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const r = node as Record<string, unknown>;
    // Web-search results: every card in the results list that
    // names a title + URL is one reference link.
    const sqr = asRecord(r.search_query_result_block);
    if (sqr && Array.isArray(sqr.results)) {
      for (const item of sqr.results) {
        const rec = asRecord(item);
        if (!rec) continue;
        for (const card of Object.values(rec)) {
          const c = asRecord(card);
          if (c && typeof c.title === "string" && typeof c.url === "string")
            pushLink(c.title, c.url);
        }
      }
    }
    // Inline citations on a block: meta_info entries whose info
    // (a JSON string or an object) names the cited page.
    if (Array.isArray(r.meta_info)) {
      for (const item of r.meta_info) {
        const infoRaw = asRecord(item)?.info;
        const info =
          typeof infoRaw === "string" ? webJson(infoRaw) : asRecord(infoRaw);
        if (info && typeof info.url === "string") {
          const title =
            typeof info.title === "string" && info.title
              ? info.title
              : typeof info.website_name === "string"
                ? info.website_name
                : "";
          pushLink(title, info.url);
        }
      }
    }
    // One follow-up suggestion entry (an sp_v2 element).
    if (typeof r.suggest_type === "number" && typeof r.content === "string")
      pushSuggestion(r.content);
    // Suggestion arrays in their plainer shapes.
    for (const key of ["suggest_questions", "suggest_questions_v2"]) {
      const arr = r[key];
      if (!Array.isArray(arr)) continue;
      for (const q of arr) {
        if (typeof q === "string") pushSuggestion(q);
        else {
          const qr = asRecord(q);
          const t = qr?.question ?? qr?.content ?? qr?.text;
          if (typeof t === "string") pushSuggestion(t);
        }
      }
    }
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(root, 0);
  return { links, suggestions };
}

function mergeDoubaoExtras(into: DoubaoExtras, found: DoubaoExtras): void {
  const seenLinks = new Set(into.links.map((l) => l.url));
  for (const l of found.links) {
    if (seenLinks.has(l.url) || into.links.length >= 12) continue;
    seenLinks.add(l.url);
    into.links.push(l);
  }
  const seenSugg = new Set(into.suggestions);
  for (const q of found.suggestions) {
    if (seenSugg.has(q) || into.suggestions.length >= 6) continue;
    seenSugg.add(q);
    into.suggestions.push(q);
  }
}

/** The extras as plain-text sections appended to a reply.
 * Links the reply text already names (by exact URL) are not
 * repeated; suggestions the text already contains are likewise
 * skipped. Returns "" when there is nothing to add. */
function doubaoExtrasSections(
  extras: DoubaoExtras,
  existingText: string,
): string {
  const flat = existingText.replace(/\s+/g, "");
  let out = "";
  const links = extras.links.filter(
    (l) => !flat.includes(l.url.replace(/\s+/g, "")),
  );
  if (links.length) {
    const lines = links.map((l, i) =>
      l.title ? `${i + 1}. ${l.title}\n${l.url}` : `${i + 1}. ${l.url}`,
    );
    out += `\n\n参考链接：\n${lines.join("\n")}`;
  }
  const sugg = extras.suggestions.filter(
    (q) => !flat.includes(q.replace(/\s+/g, "")),
  );
  if (sugg.length) out += `\n\n你还可以问：\n${sugg.map((q) => `· ${q}`).join("\n")}`;
  return out;
}

function parseDoubaoStream(body: string): {
  text: string;
  apiError: string;
  conversationId: string;
  sectionId: string;
  media: WebMediaItem[];
  /** True when the stream's error carries a shark risk-control
   * decision of type "verify": Doubao is demanding an interactive
   * human verification (captcha) for this send, NOT reporting a
   * plain rate limit — the 710022004 error_msg says "rate
   * limited" either way, so only the decision payload tells the
   * two apart (measured live 2026-11-19, see chatDoubao). */
  verifyChallenge: boolean;
  verifyScene: string;
  /** Doubao's own error code as a number (from a STREAM_ERROR
   * payload's error_code, or any payload's code), null when the
   * stream carried none. The guidance log records it as a
   * number instead of re-parsing apiError's string form. */
  errorCode: number | null;
  /** How many candidate reply-text segments the parsers fed in
   * (block fragments + message-structure segments): 0 with a
   * non-empty response is the signature of a format the parser
   * does not understand — the guidance log's unparsed line. */
  candidateCount: number;
  /** How many SSE data payloads the stream carried. */
  payloadCount: number;
} {
  const blockText = new Map<string, string>();
  const blockOrder: string[] = [];
  const looseTexts: string[] = [];
  const media: WebMediaItem[] = [];
  const mediaSeen = new Set<string>();
  // The reply's non-text extras (search references, inline
  // citations, follow-up suggestions), collected per payload
  // and appended to the assembled text at the end.
  const extras: DoubaoExtras = { links: [], suggestions: [] };
  let brief = "";
  let legacy = "";
  let apiError = "";
  let errorCode: number | null = null;
  let payloadCount = 0;
  let conversationId = "";
  let sectionId = "";
  /* ---- message-structure extraction (ported from the Doubao
   * test space, where it was proven end-to-end on 2026-11-19) --
   * Reply text is also delivered as whole MESSAGE objects under
   * an event's data.message: the text lives in
   * message.content_block[].content.text_block.text, with the
   * same blocks again inside the JSON string in message.content
   * (its `blocks` array) as a second channel for the same text.
   * Segments are grouped by message_id and de-duplicated: the
   * same segment arriving via content_block AND the content
   * string counts once, a fuller snapshot replaces the stored
   * text, and only a genuinely new tail is appended. A message
   * the user themselves sent — user_type 1, or a message_id the
   * stream's SSE_ACK listed as a question_id — is an echo of the
   * question, never a reply, and is skipped. The question ids
   * are pre-scanned from the whole body so an echo that arrives
   * before its ACK is still recognised. */
  const questionIds = new Set<string>();
  for (const m of body.matchAll(/"question_id"\s*:\s*"([^"]+)"/g)) {
    if (m[1]) questionIds.add(m[1]);
  }
  const messageTexts = new Map<string, string>();
  let messageCandidates = 0;
  const feedMessageText = (key: string, t: string): void => {
    if (!t) return;
    const cur = messageTexts.get(key);
    if (cur === undefined) {
      messageTexts.set(key, t);
      messageCandidates += 1;
      return;
    }
    if (t === cur) return;
    if (t.startsWith(cur)) {
      messageTexts.set(key, t);
      messageCandidates += 1;
      return;
    }
    if (cur.startsWith(t) || cur.endsWith(t)) return;
    messageTexts.set(key, cur + t);
    messageCandidates += 1;
  };
  const walkMessage = (
    node: unknown,
    depth: number,
    msg: { key: string; isUser: boolean } | null,
    orphanKey: string,
  ): void => {
    if (depth > 14 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const s = node.trim();
      if (s.startsWith("{") || s.startsWith("[")) {
        const parsed = (() => {
          try {
            return JSON.parse(s) as unknown;
          } catch {
            return undefined;
          }
        })();
        if (parsed !== undefined) walkMessage(parsed, depth + 1, msg, orphanKey);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walkMessage(item, depth + 1, msg, orphanKey);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // A STREAM_ERROR payload (or any nested object) carrying
      // error_code / error_msg is a rejection with that code —
      // recorded as such wherever it sits, never left to be
      // misread as an unparsed reply.
      if (
        errorCode === null &&
        typeof obj.error_code === "number" &&
        obj.error_code !== 0
      ) {
        errorCode = obj.error_code;
        if (!apiError) {
          const msgText =
            typeof obj.error_msg === "string" ? obj.error_msg : "";
          apiError = `${obj.error_code}${msgText.trim() ? ` ${msgText.trim()}` : ""}`.slice(0, 160);
        }
      }
      let curMsg = msg;
      const rawMessageId =
        typeof obj.message_id === "string" && obj.message_id !== ""
          ? obj.message_id
          : null;
      if (
        rawMessageId !== null &&
        ("content_block" in obj || "content" in obj || "content_type" in obj)
      ) {
        curMsg = {
          key: rawMessageId,
          isUser: obj.user_type === 1 || questionIds.has(rawMessageId),
        };
      }
      if (typeof obj.block_type === "number" && curMsg && !curMsg.isUser) {
        const blockContent = asRecord(obj.content);
        const textBlock = asRecord(blockContent?.text_block);
        if (typeof textBlock?.text === "string" && textBlock.text) {
          feedMessageText(curMsg.key, textBlock.text);
        }
      }
      // A message content string of the {"text": …} shape (the
      // blocks shape is handled by the string recursion above,
      // which re-enters this walk with the same message context).
      if (typeof obj.content === "string" && curMsg && !curMsg.isUser) {
        const parsedContent = webJson(obj.content);
        if (typeof parsedContent?.text === "string" && parsedContent.text) {
          feedMessageText(curMsg.key, parsedContent.text);
        }
      }
      for (const value of Object.values(obj)) {
        walkMessage(value, depth + 1, curMsg, orphanKey);
      }
    }
  };
  /** Collects generated media from one answer block's content
   * via the shared collector (text_block text and the finish
   * brief are never scanned — a URL the model merely TYPES in
   * its answer is not a generated file). Images, videos, audio
   * and files are all harvested; the block-level merge below
   * still drops a video block's poster images. */
  const harvestMedia = (into: WebMediaItem[], value: unknown) => {
    for (const m of collectMediaFromValue(value)) {
      if (into.some((x) => x.url === m.url)) continue;
      if (media.length + into.length >= 8) continue;
      into.push(m);
    }
  };
  /** Merges one block's harvested media into the reply's list:
   * when a block carries a video, image items from that same
   * block are its poster/cover, not separate generated pictures,
   * so they are dropped. */
  const mergeBlockMedia = (found: WebMediaItem[]) => {
    const hasVideo = found.some((m) => m.kind === "video");
    for (const m of found) {
      if (hasVideo && m.kind === "image") continue;
      if (mediaSeen.has(m.url) || media.length >= 8) continue;
      mediaSeen.add(m.url);
      media.push(m);
    }
  };
  // The官网 conversation this reply belongs to: Doubao's stream
  // carries conversation_id (and the section id) on its notify /
  // finish payloads and inside message objects. It is dug out of
  // every payload (bounded-depth scan, numeric-string values
  // only — an echoed "" or "0" is not an id) so the caller can
  // store it and CONTINUE this same conversation next time
  // instead of opening a new one per reply.
  const noteIds = (value: unknown, depth: number) => {
    if (depth > 5 || typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) noteIds(item, depth + 1);
      return;
    }
    const rec = value as Record<string, unknown>;
    const cid = rec.conversation_id;
    if (
      !conversationId &&
      typeof cid === "string" &&
      /^\d{6,}$/.test(cid.trim())
    )
      conversationId = cid.trim();
    const sid = rec.section_id ?? rec.last_section_id;
    if (typeof sid === "string" && /^\d{6,}$/.test(sid.trim()))
      sectionId = sid.trim();
    for (const v of Object.values(rec)) noteIds(v, depth + 1);
  };
  const noteError = (rec: Record<string, unknown> | null) => {
    if (!rec || apiError) return;
    const code = rec.error_code ?? rec.code ?? rec.status_code;
    const msg = rec.error_msg ?? rec.message ?? rec.msg;
    if (typeof code === "number" && code !== 0) {
      if (errorCode === null) errorCode = code;
      apiError = `${code}${typeof msg === "string" && msg.trim() ? ` ${msg.trim()}` : ""}`.slice(0, 160);
    }
    else if (typeof code === "string" && code && code !== "0" && typeof msg === "string" && msg.trim())
      apiError = `${code} ${msg.trim()}`.slice(0, 160);
  };
  // The shark risk decision rides inside the error payload as a
  // JSON STRING in a `decision` field (STREAM_ERROR's extra, or
  // the classic channel's error_detail.ext). A bounded scan like
  // noteIds finds it wherever in the payload it sits; only a
  // decision whose type is "verify" is a human-verification
  // demand — other decisions (or none) leave the flags unset.
  let verifyChallenge = false;
  let verifyScene = "";
  const noteDecision = (value: unknown, depth: number) => {
    if (verifyChallenge || depth > 6 || typeof value !== "object" || value === null)
      return;
    if (Array.isArray(value)) {
      for (const item of value) noteDecision(item, depth + 1);
      return;
    }
    const rec = value as Record<string, unknown>;
    const d = rec.decision;
    if (typeof d === "string" && d) {
      const parsed = webJson(d);
      if (parsed && parsed.type === "verify") {
        verifyChallenge = true;
        verifyScene =
          typeof parsed.verify_scene === "string" ? parsed.verify_scene : "";
      }
    }
    for (const v of Object.values(rec)) noteDecision(v, depth + 1);
  };
  // Thinking turns (the deep-think routes the model menu now
  // really selects) stream their reasoning inside a block_type
  // 10040 container: the reasoning fragments are ordinary 10000
  // text blocks whose parent_id is the container's id. They are
  // the model's scratchpad, not its answer, so their text is
  // kept out of the assembled reply (the answer blocks carry no
  // such parent). In practice Doubao delivers only a "正在思考"
  // summary there, but the guard keeps any real reasoning text
  // from leaking into the saved reply either way.
  const thinkingContainers = new Set<string>();
  const blockParent = new Map<string, string>();
  const noteBlock = (block: unknown) => {
    const b = asRecord(block);
    if (!b) return;
    if (b.block_type === 10040 && typeof b.block_id === "string" && b.block_id)
      thinkingContainers.add(b.block_id);
    if (
      typeof b.block_id === "string" &&
      b.block_id &&
      typeof b.parent_id === "string" &&
      b.parent_id
    )
      blockParent.set(b.block_id, b.parent_id);
    const content = asRecord(b.content);
    const tb = asRecord(content?.text_block);
    const t = typeof tb?.text === "string" ? tb.text : "";
    const id = typeof b.block_id === "string" ? b.block_id : "";
    if (!id) {
      if (t) looseTexts.push(t);
      else if (!tb && content) {
        const found: WebMediaItem[] = [];
        harvestMedia(found, content);
        mergeBlockMedia(found);
      }
      return;
    }
    if (!blockText.has(id)) {
      blockText.set(id, "");
      blockOrder.push(id);
    }
    if (!t) {
      // A block with no text is where generated media lives
      // (image / video blocks): harvest its content for media
      // instead of dropping the block as the text-only reader
      // did. Text blocks are never harvested — a URL typed in
      // prose is not a generated file.
      if (!tb && content) {
        const found: WebMediaItem[] = [];
        harvestMedia(found, content);
        mergeBlockMedia(found);
      }
      return;
    }
    // Doubao's current protocol streams a block's text as APPEND
    // deltas: every fragment carries patch_type 1 and only its own
    // few new characters, so the block's full text is the
    // concatenation of all its fragments. (Replacing the block
    // text with each fragment — the previous behaviour — kept
    // only the LAST fragment, which is why replies were saved as
    // a couple of characters like "。" or "吗？": the final delta.
    // Concatenating a real captured stream's fragments
    // reproduces the site's own msg_finish_attr brief exactly.)
    // A fragment explicitly marked patch_type 2 is a snapshot
    // and replaces the block text instead.
    if (b.patch_type === 2) blockText.set(id, t);
    else blockText.set(id, (blockText.get(id) ?? "") + t);
  };
  const noteBlocks = (value: unknown) => {
    if (Array.isArray(value)) for (const b of value) noteBlock(b);
  };
  const takeText = (value: unknown) => {
    const rec = asRecord(value);
    if (rec && typeof rec.text === "string" && rec.text) legacy += rec.text;
  };
  const takeContent = (raw: unknown) => {
    if (typeof raw === "string" && raw) {
      const parsed = webJson(raw);
      if (parsed) takeText(parsed);
      else legacy += raw;
    } else if (Array.isArray(raw)) {
      for (const item of raw) takeText(item);
    } else if (raw && typeof raw === "object") {
      takeText(raw);
    }
  };
  const takeMessage = (message: Record<string, unknown> | null) => {
    if (!message) return;
    // The user's own echo never counts as a reply on this legacy
    // path either: user_type 1, or a message_id the SSE_ACK
    // listed as a question_id. (The message's content_block text
    // proper is collected by walkMessage above, under the same
    // exclusion.)
    const mid = typeof message.message_id === "string" ? message.message_id : "";
    if (message.user_type === 1 || (mid !== "" && questionIds.has(mid))) return;
    // A message object is an echo (FULL_MSG_NOTIFY carries the
    // USER's own message in this shape): its content_block must
    // NOT be collected as answer blocks — the assistant's answer
    // blocks arrive at the payload's top level (content /
    // patch_op), never inside a message object.
    takeContent(message.content);
    if (message.content_block) takeContent(message.content_block);
  };
  const handlePayload = (data: Record<string, unknown>) => {
    noteError(data);
    noteDecision(data, 0);
    noteIds(data, 0);
    mergeDoubaoExtras(extras, collectDoubaoExtras(data));
    // The message-structure pass over the same payload: any
    // data.message (here, or nested inside event_data's JSON
    // string, which the walk parses as it goes) contributes its
    // content_block / content-string text, de-duplicated per
    // message and echo-free.
    walkMessage(data, 0, null, "payload");
    const content = asRecord(data.content);
    if (content) noteBlocks(content.content_block);
    if (Array.isArray(data.patch_op)) {
      for (const op of data.patch_op) {
        const pv = asRecord(asRecord(op)?.patch_value);
        if (pv) noteBlocks(pv.content_block);
      }
    }
    const finishAttr = asRecord(data.msg_finish_attr);
    if (finishAttr && typeof finishAttr.brief === "string" && finishAttr.brief)
      brief = finishAttr.brief;
    // The finish payload can also carry the generated media
    // itself (the brief is skipped by the harvester).
    if (finishAttr) {
      const found: WebMediaItem[] = [];
      harvestMedia(found, finishAttr);
      mergeBlockMedia(found);
    }
    const eventData =
      typeof data.event_data === "string"
        ? webJson(data.event_data)
        : asRecord(data.event_data);
    noteError(eventData);
    noteDecision(eventData, 0);
    if (eventData) mergeDoubaoExtras(extras, collectDoubaoExtras(eventData));
    takeMessage(asRecord(eventData?.message) ?? asRecord(data.message));
  };
  for (const chunk of body.split(/\r?\n\r?\n/)) {
    let payload = "";
    for (const line of chunk.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("data:")) payload += t.slice(5).trim();
    }
    if (!payload || payload === "[DONE]") continue;
    const data = webJson(payload);
    if (data) {
      payloadCount += 1;
      handlePayload(data);
    }
  }
  if (!blockOrder.length && !legacy && !apiError) {
    const root = webJson(body);
    if (root) {
      payloadCount += 1;
      handlePayload(root);
    }
  }
  const v2 =
    blockOrder
      .filter((id) => {
        const parent = blockParent.get(id);
        return !(parent && thinkingContainers.has(parent));
      })
      .map((id) => blockText.get(id) ?? "")
      .join("") + looseTexts.join("");
  let text = (v2.trim() ? v2 : legacy).trim();
  // The message-structure text joins the same cross-check: it is
  // the same reply delivered in whole-message form. When one
  // form contains the other, the fuller one wins; when neither
  // contains the other they are different deliveries of the same
  // stream and the longer (more complete) one is kept — the
  // same rule the brief cross-check below already applies.
  const messageJoined = [...messageTexts.values()].join("").trim();
  if (messageJoined) {
    if (!text) text = messageJoined;
    else if (messageJoined !== text) {
      const flat = (s: string) => s.replace(/\s+/g, "");
      if (
        flat(messageJoined).includes(flat(text)) ||
        flat(text).includes(flat(messageJoined))
      ) {
        if (messageJoined.length > text.length) text = messageJoined;
      } else if (messageJoined.length > text.length) {
        text = messageJoined;
      }
    }
  }
  // Cross-check against the site's own finish brief: it is the
  // same reply flattened to one line. If the assembled text is
  // only a fragment of it (the signature of a stream-shape change
  // breaking the block assembly again), the brief is the fuller
  // truth and wins; a complete assembly is never a strict
  // substring-shorter copy of the brief, so it is kept as-is.
  const briefText = brief.trim();
  if (briefText) {
    if (!text) text = briefText;
    else if (
      briefText.length > text.length &&
      briefText.replace(/\s+/g, "").includes(text.replace(/\s+/g, ""))
    )
      text = briefText;
  }
  // Everything else Doubao attached to the reply — the search
  // references / inline citations and the follow-up suggestion
  // chips — joins the text as its own sections, so nothing the
  // site sent is silently dropped (or, as before, misread as
  // generated pictures).
  const extrasText = doubaoExtrasSections(extras, text);
  if (extrasText) text = text ? text + extrasText : extrasText.trim();
  if (!conversationId) {
    const m = /"conversation_id"\s*:\s*"(\d{6,})"/.exec(body);
    if (m) conversationId = m[1] ?? "";
  }
  if (!sectionId) {
    const m = /"(?:last_)?section_id"\s*:\s*"(\d{6,})"/.exec(body);
    if (m) sectionId = m[1] ?? "";
  }
  // Candidate segments: every block fragment the block assembly
  // fed on (plus id-less loose fragments), plus every segment
  // the message-structure pass fed.
  let blockFragments = looseTexts.length;
  for (const id of blockOrder) if (blockText.get(id)) blockFragments += 1;
  const candidateCount = blockFragments + messageCandidates;
  return {
    text,
    apiError,
    conversationId,
    sectionId,
    media,
    verifyChallenge,
    verifyScene,
    errorCode,
    candidateCount,
    payloadCount,
  };
}

type DoubaoAttemptResult = {
  label: string;
  status: number;
  text: string;
  apiError: string;
  raw: string;
  /** Generated media (images / videos) the reply's blocks
   * carried, as the site's own file URLs. */
  media: WebMediaItem[];
  /** The官网 conversation / section ids Doubao's response itself
   * named ('' when the response carried none). */
  conversationId: string;
  sectionId: string;
  /** The shark verify-challenge flags parseDoubaoStream read out
   * of this attempt's error payload (see there). */
  verifyChallenge: boolean;
  verifyScene: string;
  /** Doubao's own error code as a number (null when the response
   * carried none) and the parser's counts, for the guidance
   * log. On a non-200 response the code is read from the raw
   * body when it carries one. */
  errorCode: number | null;
  candidateCount: number;
  payloadCount: number;
};

/** One token-only Doubao completion attempt: a plain server-side
 * POST with the stored Cookie — no browser, no page-JavaScript
 * signature. Every outcome is the site's real response. */
async function doubaoAttempt(
  label: string,
  url: string,
  token: string,
  body: unknown,
): Promise<DoubaoAttemptResult> {
  const res = await webFetchText(
    url,
    {
      method: "POST",
      headers: {
        ...doubaoHeaders(token),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    },
    90_000,
  );
  if (res.status !== 200) {
    // A refused call can still carry Doubao's own error body
    // (a plain JSON {"code":…,"msg":…} or an SSE STREAM_ERROR):
    // parse it for the code so the record names the real
    // rejection instead of a bare HTTP status.
    const refused = parseDoubaoStream(res.text);
    return {
      label,
      status: res.status,
      text: "",
      apiError: refused.apiError,
      raw: res.text,
      media: [],
      conversationId: "",
      sectionId: "",
      verifyChallenge: refused.verifyChallenge,
      verifyScene: refused.verifyScene,
      errorCode: refused.errorCode,
      candidateCount: 0,
      payloadCount: refused.payloadCount,
    };
  }
  const parsed = parseDoubaoStream(res.text);
  return {
    label,
    status: res.status,
    text: parsed.text,
    apiError: parsed.apiError,
    raw: res.text,
    media: parsed.media,
    conversationId: parsed.conversationId,
    sectionId: parsed.sectionId,
    verifyChallenge: parsed.verifyChallenge,
    verifyScene: parsed.verifyScene,
    errorCode: parsed.errorCode,
    candidateCount: parsed.candidateCount,
    payloadCount: parsed.payloadCount,
  };
}

/* Doubao chat, reverse-engineered token-only route — the ONLY
 * Doubao route since the user directed the real-browser relay
 * removed (「豆包不要真实网页代发」). Built 2026-11-19 from the
 * reverse work below; the relay sat in front of it for part of
 * that day and is gone again at the user's word.
 *
 * What the reverse work established (see DATA-PLAN.md for the
 * sources): Doubao's current web client (PC 3.41.x) speaks a NEW
 * unified protocol on POST /chat/completion — client_meta /
 * messages[].content_block / option / ext — and independent
 * reverse projects that captured the real client found this
 * endpoint answers WITHOUT any a_bogus signature; attaching the
 * old signer output is what now trips the 710022004 risk control,
 * while a stale or fabricated msToken trips 710022002, so the
 * first attempts send neither. The pure a_bogus algorithm ported
 * from Douyin does not transfer (Doubao's frontierSign is a
 * different, JSVMP-protected program), so no fake signature is
 * generated here either.
 *
 * Attempt order (aligned 2026-11-19, late, with the Doubao
 * test space's proven end-to-end route; SWAPPED 2026-11-20):
 * the test space's plain new-unified-protocol body —
 * client_meta + content_block + option + ext, bot_id
 * 7338286299411103781, use_deep_think false / "0", no model
 * bundle, no extra option fields — combined with the
 * browser-aligned fingerprint (see doubaoHeaders and the
 * stable query identifiers in buildDoubaoSendPlan) returned a
 * real reply there at 21:13 on 2026-11-19. The original order
 * sent that plain body FIRST and the selection bundle only
 * when it failed — and since the plain body almost always
 * succeeded, the bundle never went out: both Doubao agents'
 * last-send records showed exactly one plain attempt with
 * use_deep_think / need_net_search false despite saved model /
 * effort / search selections, i.e. the model switch was a
 * no-op. The order is now:
 *   1. the new unified protocol WITH the full selection bundle
 *      (the account-menu pick sent the site's own way), so the
 *      chat window's model switch is what actually goes out;
 *   2. the test space's plain body, exactly that shape (the
 *      room's conversation-reuse ids ride in client_meta as
 *      before), unsigned, no msToken in the URL, no a_bogus —
 *      tried only when the bundle attempt fails for a
 *      non-verification reason.
 * The two older classic-body attempts are GONE: the classic
 * protocol is proven to answer 710020202 "common invalid param"
 * against the current web client (test space, 2026-11-19), so
 * the samantha channel attempt and the classic-with-msToken
 * attempt were deleted rather than kept as fallbacks that can
 * only produce that error. A shark verify decision stops the
 * chain at once (every channel sits behind the same gate —
 * never fire the remaining attempt after one). The first
 * attempt that yields reply text wins; if none does, the
 * failure quotes EVERY attempt's real result — the site's own
 * error code/message and HTTP status — never a generic guess.
 *
 * The 710022004 diagnosis (measured live 2026-11-19, in two
 * rounds). Round one (after the user asked whether their
 * Cookie had changed): the stored Cookie's login fields
 * (sessionid / sid_tt / uid_tt / passport_csrf_token /
 * s_v_web_id) are byte-identical to a fresh paste from the
 * user's own browser — only rotating fields (msToken / ttwid /
 * tt_scid) differ — login verification and the account-menu
 * read both succeed with it, and saving the fresh Cookie
 * changed nothing (the refusal came back byte-identical, 1053
 * bytes). Round two (after the user reported that posting on
 * the Doubao web page itself gets replies with NO verification
 * prompt): two control sends with a DIFFERENT, freshly created
 * throwaway account's Cookie the user supplied for testing —
 * an account that had never sent through this space. Its very
 * first server-side send was refused with the same verify
 * decision and a byte-identical 1053-byte response; a second
 * send that additionally carried that account's real
 * device_id (recovered from the Cookie's own embedded token)
 * was refused byte-identically again. The decision's region
 * reads "cn" while the account's own region is TW: shark is
 * judging the REQUEST's environment, not the account. So the
 * verify decision (verify_scene "doubao_message_web", subtype
 * "semantic_reasoning") is bound to this server-side sending
 * channel — datacenter egress IP, a plain HTTP client's
 * fingerprint, no page-JavaScript signature — and NOT to the
 * account, the Cookie's freshness, the stored官网
 * conversation, or a missing device_id. The user's own
 * browser and the official app present the genuine browser
 * environment from the user's own network and are never
 * challenged, exactly as the user reported; nothing the user
 * does there (posting, completing a verification that never
 * appears) can clear the server channel's decision, and the
 * error copy no longer suggests it. When an attempt carries that
 * decision, chatDoubao stops firing the remaining attempts
 * (all channels sit behind the same shark gate, and each
 * refused send is another risk event), does NOT blame or drop
 * the room's stored官网 conversation, and returns kind
 * "blocked" so the agent's stored web status shows the real
 * state （被网页端拦截） instead of a stale 已登录. The old
 * "等几分钟到半小时就会恢复" guidance only ever described a
 * plain rate limit and is kept for a 710022004 that carries
 * NO verify decision.
 *
 * Conversation reuse (per space room): when webOpts.session
 * carries the room's stored官网 conversation, both attempts
 * CONTINUE it (same conversation_id / local_conversation_id,
 * need_create_conversation false) and the caller sends only the
 * new turns; the response's conversation_id (or the continued
 * one) comes back in the result's `remote` so the caller can
 * store/refresh the mapping. When a continued conversation fails
 * on every attempt the result is flagged reusedFailed and the
 * caller drops the mapping and retries once fresh with the full
 * prompt. */
/** One room's stored官网 conversation for one web agent (see
 * the web_remote_conversations schema comment): the ids the next
 * reply in that room continues with. Doubao fills every field;
 * DeepSeek uses remoteConversationId (its chat_session_id) and
 * lastMessageIndex (the message_id of its last reply there —
 * the parent_message_id the next completion continues from),
 * leaving the Doubao-only fields empty. */
type WebRemoteState = {
  remoteConversationId: string;
  localConversationId: string;
  lastSectionId: string;
  lastMessageIndex: number;
  /** Doubao only: the web_tab_id of this room's官网
   * conversation (see the schema comment). DeepSeek never sets
   * it; older stored rows read back ''. */
  webTabId?: string;
};

/** One Doubao send's guidance-log facts (see the doubao_send_logs
 * schema comment): computed by chatDoubao from the attempts it
 * actually ran and persisted by its caller, which owns the db
 * handle and the agent id. summary is a capped excerpt of the
 * decisive attempt's raw response — never the whole body, and
 * never anything derived from the Cookie. */
type DoubaoGuidanceLogEntry = {
  outcome: string;
  httpStatus: number | null;
  responseBytes: number;
  errorCode: number | null;
  errorMsg: string;
  hasVerify: boolean;
  hasShark: boolean;
  candidateCount: number;
  payloadCount: number;
  summary: string;
};

/** Backwards-compatible alias: Doubao's chat result predates the
 * shared state type. */
type DoubaoRemoteState = WebRemoteState;

type DoubaoChatResult = WebChatResult & {
  /** The官网 conversation state after a successful reply, when
   * an id is known (returned by Doubao, or the one continued). */
  remote?: DoubaoRemoteState;
  /** True when this call was continuing a stored conversation
   * and every attempt failed — the caller drops the mapping and
   * retries once with a fresh conversation + the full prompt.
 *
 * The 0-byte network_error diagnosis (2026-11-19, late): every
 * desktop send was dying with httpStatus null / 0 bytes in ~2s
 * while the test space, on the same Cookie and egress, replied
 * twice in the same window — and Doubao's own refusals always
 * arrive as HTTP 200 + an SSE error payload, so the request
 * never reached Doubao: something threw locally, before or at
 * the fetch, and the single outer catch replaced it with the
 * fixed "网络错误，无法连接 豆包" sentence (webNetFailure
 * discarded name/message/cause entirely). Three gaps versus
 * the test space were closed: (1) the Cookie now goes through
 * the test space's per-field cleaning + validation
 * (checkDoubaoCookie) before anything is built — a value with
 * invisible/control or above-Latin-1 characters makes undici
 * reject the fetch pre-send, and such a field now aborts the
 * send BY NAME (outcome cookie_invalid) instead of dying
 * anonymously; doubaoHeaders sends the cleaned string for
 * every other Doubao call too. (2) webNetFailure now embeds
 * describeThrownError (name + message + code + the cause
 * chain) for every web agent, Doubao included. (3) chatDoubao
 * tracks the phase it had reached and the elapsed time, and
 * its catch records all of it in the failure message and the
 * guidance log, so the next failure names its own layer. Both
 * routes use the same global fetch with no proxy dispatcher —
 * the test space never had one either; the user's browser
 * capture went through THEIR local proxy, which is their
 * machine's route, not this server's. */
  reusedFailed?: boolean;
  /** The send's full record JSON (see doubaoSendRecordJson),
   * stored on the agent row by the caller for the settings
   * panel's 发送数据诊断. */
  sentRecordJson?: string;
  /** The send's guidance-log entry (see DoubaoGuidanceLogEntry),
   * persisted by the caller into doubao_send_logs for the
   * settings panel's 指导日志. Absent only when the send died
   * before any attempt could be summarised. */
  guidanceLog?: DoubaoGuidanceLogEntry;
  /** The web_tab_id this send used (Doubao): the stored one when
   * continuing a conversation, a fresh UUID for a new one. The
   * caller stores it with the refreshed remote mapping. */
  webTabId?: string;
};

async function loadWebRemote(
  db: Db,
  provider: string,
  conversationId: number,
  agentId: number,
): Promise<WebRemoteState | null> {
  try {
    const rows = await db
      .select()
      .from(schema.webRemoteConversations)
      .where(
        and(
          eq(schema.webRemoteConversations.conversationId, conversationId),
          eq(schema.webRemoteConversations.agentId, agentId),
          eq(schema.webRemoteConversations.provider, provider),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.remoteConversationId) return null;
    return {
      remoteConversationId: row.remoteConversationId,
      localConversationId: row.localConversationId,
      lastSectionId: row.lastSectionId,
      lastMessageIndex: row.lastMessageIndex,
      webTabId: row.webTabId,
    };
  } catch {
    return null;
  }
}

async function saveWebRemote(
  db: Db,
  provider: string,
  conversationId: number,
  agentId: number,
  state: WebRemoteState,
): Promise<void> {
  try {
    const existing = await db
      .select({ id: schema.webRemoteConversations.id })
      .from(schema.webRemoteConversations)
      .where(
        and(
          eq(schema.webRemoteConversations.conversationId, conversationId),
          eq(schema.webRemoteConversations.agentId, agentId),
          eq(schema.webRemoteConversations.provider, provider),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(schema.webRemoteConversations)
        .set({
          remoteConversationId: state.remoteConversationId,
          localConversationId: state.localConversationId,
          lastSectionId: state.lastSectionId,
          lastMessageIndex: state.lastMessageIndex,
          // Only Doubao states carry a tab id; a state without
          // one (DeepSeek) leaves the stored value untouched.
          ...(state.webTabId !== undefined
            ? { webTabId: state.webTabId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.webRemoteConversations.id, existing[0].id));
    } else {
      await db.insert(schema.webRemoteConversations).values({
        conversationId,
        agentId,
        provider,
        remoteConversationId: state.remoteConversationId,
        localConversationId: state.localConversationId,
        lastSectionId: state.lastSectionId,
        lastMessageIndex: state.lastMessageIndex,
        webTabId: state.webTabId ?? "",
      });
    }
  } catch {
    // best effort — the reply itself already succeeded; the next
    // reply simply starts a fresh官网 conversation again.
  }
}

async function clearWebRemote(
  db: Db,
  conversationId: number,
  agentId?: number,
): Promise<void> {
  try {
    await db
      .delete(schema.webRemoteConversations)
      .where(
        agentId != null
          ? and(
              eq(schema.webRemoteConversations.conversationId, conversationId),
              eq(schema.webRemoteConversations.agentId, agentId),
            )
          : eq(schema.webRemoteConversations.conversationId, conversationId),
      );
  } catch {
    // best effort cleanup only
  }
}

/** Drops EVERY stored官网 conversation of one web agent (all
 * rooms). Its one remaining caller is the account-identity
 * guard: when the agent's recorded account identity changed
 * (recordWebIdentity), the continuations belong to the OLD
 * account, and continuing one under the new account's
 * credential would post into the old account's conversation.
 * A Doubao model-selection change deliberately does NOT call
 * this (the v78 behaviour, restored 2026-11-21 at the user's
 * direction): rooms keep their same官网 conversation across
 * selection saves, even though a mid-conversation switch may
 * then not take effect — same window first. */
async function clearWebRemoteForAgent(
  db: Db,
  provider: string,
  agentId: number,
): Promise<void> {
  try {
    await db
      .delete(schema.webRemoteConversations)
      .where(
        and(
          eq(schema.webRemoteConversations.agentId, agentId),
          eq(schema.webRemoteConversations.provider, provider),
        ),
      );
  } catch {
    // best effort cleanup only
  }
}

/** The prompt for CONTINUING a room's existing官网 conversation
 * (Doubao and DeepSeek alike): that conversation already holds
 * everything up to the agent's last reply there, so only what
 * came after it is sent — the new user turns (and, in a group
 * room, other members' lines the agent has not seen), with the
 * same speaker labels as the full prompt. Falls back to the
 * full prompt when the agent has not replied in this room yet
 * (nothing to continue from). */
function buildWebDeltaPrompt(
  agent: AgentRow,
  history: MessageRow[],
  nameOf: NameOf | undefined,
  filesContext = "",
  globalInstructions = "",
  stageContext = "",
): string {
  let lastOwn = -1;
  history.forEach((row, i) => {
    if (row.role === "assistant" && row.agentId === agent.id) lastOwn = i;
  });
  if (lastOwn < 0)
    return buildWebPrompt(agent, history, nameOf, filesContext, globalInstructions, stageContext);
  const labelOf: NameOf =
    nameOf ?? ((agentId) => (agentId == null ? "Muse" : "智能体"));
  const parts: string[] = [];
  // The continued官网 conversation already holds the system
  // context from its first message, but two pieces of standing
  // state must stay live in it: the agent's system instructions
  // (the user can edit them at any time, and the edit must take
  // effect on the next reply — not only in rooms where a fresh
  // 官网 conversation happens to start) and the per-round
  // stage-owner note. Both ride along with the new turns as a
  // system note.
  const standing = standingInstructions(agent.systemPrompt, agent.memory);
  if (standing)
    parts.push(
      `【系统提示】你的系统指令（最新版本，以此为准）：${standing}`,
    );
  if (stageContext) parts.push(`【系统提示】${stageContext}`);
  for (const row of history.slice(lastOwn + 1)) {
    const body = row.content
      ? row.content
      : row.imageBlobKey
        ? row.fileMime && row.fileMime.startsWith("video/")
          ? "（发送了一段视频）"
          : row.fileMime && row.fileMime.startsWith("audio/")
            ? "（发送了一段音频）"
            : row.fileMime && !row.fileMime.startsWith("image/")
              ? `（发送了文件：${row.fileName ?? "文件"}）`
              : "（发送了一张图片）"
        : "";
    if (!body) continue;
    if (row.role === "user") parts.push(`用户：${body}`);
    else parts.push(`【${labelOf(row.agentId)} 的发言】${body}`);
  }
  const delta = parts.filter((s) => s.trim() !== "").join("\n\n");
  return delta || buildWebPrompt(agent, history, nameOf, filesContext, globalInstructions, stageContext);
}

/** One planned Doubao send: everything a single attempt will
 * put on the wire. buildDoubaoSendPlan builds the whole plan —
 * chatDoubao sends it, and getDoubaoSendData shows it in the
 * agent's settings, so what the settings display is built by
 * the same code that sends. */
type DoubaoPlannedAttempt = {
  label: string;
  url: string;
  body: unknown;
};

type DoubaoSendPlan = {
  attempts: DoubaoPlannedAttempt[];
  /** The request-parameter facts the settings diagnostics show:
   * where each recovered parameter came from and whether the
   * optional ones are present. deviceId itself is a device
   * identifier (already shown in the settings form), never a
   * credential; the Cookie's VALUES are never part of a plan. */
  params: {
    region: string;
    deviceId: string;
    deviceIdSource: string;
    /** The account id the官网 page served for this agent's own
     * Cookie reports ('' when unread): shown in the 发送数据诊断
     * so the user can compare two Doubao agents' accounts
     * directly — after the 2026-11-20 incident both agents'
     * diagnostics would have shown the SAME id here, which is
     * exactly the fact that was previously invisible. Not a
     * credential; it is the account's public numeric id. */
    accountId: string;
    webIdPresent: boolean;
    /** The web_id / tea_uuid value the URL actually carries:
     * recovered from THIS agent's own Cookie (ttwid) or the
     * page served for it — NOT the device_id, and never another
     * agent's web id. '' when no own source yielded one (the
     * URL then omits both parameters). */
    webId: string;
    msTokenPresent: boolean;
    fpPresent: boolean;
    versionCode: string;
    pcVersion: string;
  };
  /** The model selection in force for this send, as resolved
   * from the account's menu catalog. */
  selection: {
    modelKey: string;
    modeId: string;
    effort: number;
    gate: number;
    search: boolean;
  };
  localConversationId: string;
  reuse: boolean;
  /** The web_tab_id the attempts' URLs carry: the stored one
   * when continuing a conversation, a fresh UUID for a new one. */
  webTabId: string;
  /** Send-time account assertion (see recordWebIdentity): true
   * when the caller supplied the agent's recorded identity hash
   * AND the account id the官网 page just reported for this
   * Cookie hashes to something different. chatDoubao refuses to
   * send at all in that case — the credential no longer belongs
   * to the account this agent was verified as, and sending
   * would silently post as another account. False whenever
   * either side has no identity to compare (nothing recorded
   * yet, or the page read yielded no account id). */
  identityMismatch: boolean;
};

async function buildDoubaoSendPlan(
  token: string,
  prompt: string,
  storedDeviceId = "",
  webOpts: {
    menu?: DoubaoMenu;
    modelKey?: string;
    reasoning?: string;
    search?: boolean;
    session?: DoubaoRemoteState | null;
    /** The sending agent's recorded account-identity hash
     * (agents.webIdentityHash), supplied by produceReply: the
     * plan asserts the live account id recovered from this
     * Cookie's own官网 page against it (plan.identityMismatch).
     * Absent/'' = nothing recorded, no assertion. */
    expectedIdentityHash?: string;
  } = {},
): Promise<DoubaoSendPlan> {
  // Doubao's own web options (NOT DeepSeek's set): the
  // model-menu selection — a model_item_key resolved against
  // the account's own detected menu catalog, plus the
  // 推理强度 level — resolved by doubaoWireSelection into the
  // wire bundle (model_item_key ×3 + the model's own mode_id
  // and model_extra_params + reasoning_effort + the
  // need_deep_think thinking gate). The bundle rides in the
  // FIRST attempt's body (order swapped 2026-11-20: previously
  // the plain body went first and succeeded almost every time,
  // so the selection bundle never reached the wire and the
  // model switch silently did nothing — the saved selections
  // of both Doubao agents showed use_deep_think /
  // need_net_search false in their last-send records). The
  // Doubao test space's proven plain body (no bundle, no
  // search/deep-think flags — see plainBody below) is now only
  // the fallback, tried when the bundle attempt fails for a
  // non-verification reason. 联网搜索 (webSearch) therefore
  // takes effect through the first attempt's body, exactly
  // like the model pick.
  const sel = doubaoWireSelection(
    webOpts.menu ?? DOUBAO_FALLBACK_MENU,
    webOpts.modelKey ?? "9",
    webOpts.reasoning ?? "",
  );
  const netSearch = webOpts.search === true;
  // Conversation reuse: when the caller passes the room's
  // stored官网 conversation, this reply CONTINUES it — the
  // bodies carry its conversation_id, keep its
  // local_conversation_id, and ask for no new conversation;
  // the prompt the caller built is then only the new turns.
  // Without a stored conversation the bodies create one, and
  // the response's own conversation_id is returned so the
  // caller can store it for the room.
  const reuse =
    webOpts.session && webOpts.session.remoteConversationId
      ? webOpts.session
      : null;
  const localConversationId =
    reuse?.localConversationId || `local_${Date.now()}`;
  const p = await doubaoRequestParams(token, storedDeviceId);
  // Send-time account assertion: the account id Doubao's
  // passport account-info endpoint just reported for THIS
  // Cookie, hashed the same way
  // recordWebIdentity hashes it at verification time, must
  // equal the identity recorded for the sending agent. A
  // mismatch means the credential's account is no longer the
  // account this agent was verified as (the session was
  // switched to another account, or a different account's
  // Cookie was stored without re-verifying) — chatDoubao then
  // stops before the first attempt instead of posting as the
  // wrong account.
  const liveIdentityHash = await webIdentityHash("doubao", p.accountId);
  const identityMismatch =
    !!webOpts.expectedIdentityHash &&
    liveIdentityHash !== "" &&
    liveIdentityHash !== webOpts.expectedIdentityHash;
  // The query parameters, aligned with the user's real browser
  // (the test space's proven set) — but every account-bound
  // value is THIS agent's own, recovered by doubaoRequestParams
  // from this agent's Cookie and the page served for it: region
  // from its flow_user_country, version numbers from its page
  // (the captured 20800 / 3.46.5 remain only as that function's
  // defaults), web_id / tea_uuid from its own ttwid / page
  // (web_id and tea_uuid are the same value, and it is NOT the
  // device_id), device_id from the number stored on THIS agent
  // or scraped from THIS account's page. A value no own source
  // yields is OMITTED from the URL — never filled with another
  // Doubao agent's identifiers (an earlier version pinned
  // web_id / tea_uuid to the first account's and fell back to
  // its device_id; with two Doubao agents in the space that
  // mixed two accounts' data on the wire). No a_bogus and no
  // msToken in the URL: the proven direct route needs neither
  // (msToken / fp presence is still REPORTED in the plan
  // params below, from the Cookie, for diagnostics).
  const deviceId = p.deviceId;
  const webTabId = reuse?.webTabId || crypto.randomUUID();
  const baseParams: Record<string, string> = {
    aid: "497858",
    real_aid: "497858",
    device_platform: "web",
    doubao_device_platform: "web",
    language: "zh",
    pkg_type: "release_version",
    version_code: p.versionCode,
    pc_version: p.pcVersion,
    doubao_pc_version: p.pcVersion,
    region: p.region,
    sys_region: p.region,
    samantha_web: "1",
    web_platform: "browser",
    "use-olympus-account": "1",
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(p.webId ? { web_id: p.webId, tea_uuid: p.webId } : {}),
    web_tab_id: webTabId,
  };
  const query = new URLSearchParams(baseParams);

  // The plain body: the Doubao test space's proven new unified
  // protocol body, the exact shape that returned a real reply
  // there (client_meta + content_block + option + ext, bot_id
  // 7338286299411103781, use_deep_think false / "0",
  // need_net_search false / "0", no model bundle, no extra
  // option fields). The only desktop difference is inside
  // client_meta: a continued room conversation keeps its ids
  // (conversation_id / last_section_id / last_message_index and
  // the stored local_conversation_id), where the single-room
  // test space always started from "" / 0.
  const plainBody = {
    client_meta: {
      local_conversation_id: localConversationId,
      conversation_id: reuse?.remoteConversationId ?? "",
      bot_id: "7338286299411103781",
      last_section_id: reuse?.lastSectionId ?? "",
      last_message_index: reuse?.lastMessageIndex ?? 0,
    },
    messages: [
      {
        local_message_id: crypto.randomUUID(),
        content_block: [
          {
            block_type: 10000,
            content: { text_block: { text: prompt } },
            block_id: crypto.randomUUID(),
          },
        ],
      },
    ],
    option: {
      send_message_scene: "",
      create_time_ms: Date.now(),
      collect_id: "",
      is_audio: false,
      answer_with_suggest: false,
      need_create_conversation: !reuse,
      conversation_mode: 1,
      use_deep_think: false,
      need_net_search: false,
    },
    ext: {
      use_deep_think: "0",
      need_net_search: "0",
    },
  };
  // The new unified protocol body WITH the model selection
  // bundle (see doubaoWireSelection for the evidence): the
  // chat route (agent_mode 2 — the 工作任务 route, agent_mode
  // 1, does not run over this token connection), the menu
  // pick's model_item_key in all three option locations with
  // the MODEL'S OWN mode_id from the account config ("1" for
  // the 对话 models 快速 / 专家， "3" for the 工作任务 models),
  // the model's own model_extra_params, reasoning_effort as
  // int + strings, and the thinking gate from the 推理强度
  // level. This is the body shape measured live on the user's
  // account in the model-selection round: gate 3 → the reply
  // stream carries a thinking phase; gate 0 → it does not.
  const bundleBody = {
    client_meta: {
      local_conversation_id: localConversationId,
      conversation_id: reuse?.remoteConversationId ?? "",
      bot_id: "7338286299411103781",
      last_section_id: reuse?.lastSectionId ?? "",
      last_message_index: reuse?.lastMessageIndex ?? 0,
      local_permissions: [],
    },
    messages: [
      {
        local_message_id: crypto.randomUUID(),
        content_block: [
          {
            block_type: 10000,
            content: { text_block: { text: prompt } },
            block_id: crypto.randomUUID(),
            parent_id: "",
          },
        ],
      },
    ],
    option: {
      send_message_scene: "",
      create_time_ms: Date.now(),
      collect_id: "",
      is_audio: false,
      answer_with_suggest: false,
      need_create_conversation: !reuse,
      conversation_mode: 1,
      agent_mode: 2,
      need_deep_think: sel.gate,
      conversation_init_ext: {
        model_item_key: sel.itemKey,
        reasoning_effort: String(sel.effort),
        mode_id: sel.modeId,
      },
      model_config: {
        model_item_key: sel.itemKey,
        model_extra_params: sel.extraParams,
        reasoning_effort: sel.effort,
      },
      aggregate_params: {
        conversation_mode: "1",
        mode_id: sel.modeId,
        model_item_key: sel.itemKey,
        agent_mode: "2",
        reasoning_effort: String(sel.effort),
        provider_id: "",
      },
      message_storage_type: 0,
      need_net_search: netSearch,
    },
    ext: {
      use_deep_think: String(sel.gate),
      need_net_search: netSearch ? "1" : "0",
      collection_id: "",
    },
  };

  const chatUrl = `https://www.doubao.com/chat/completion?${query.toString()}`;
  return {
    attempts: [
      { label: "新统一协议直连（带模型选择包，免签名）", url: chatUrl, body: bundleBody },
      { label: "新统一协议直连（plain 请求体，免签名）", url: chatUrl, body: plainBody },
    ],
    params: {
      region: p.region,
      deviceId,
      accountId: p.accountId,
      deviceIdSource: cleanWebDeviceId(storedDeviceId)
        ? "设置里保存的设备号（本智能体自己的）"
        : p.deviceId
          ? "从本账号的官网页面恢复"
          : "未取得（不带 device_id 发送，绝不套用其他智能体的设备号）",
      webIdPresent: p.webId !== "",
      webId: p.webId,
      msTokenPresent: p.msToken !== "",
      fpPresent: p.fp !== "",
      versionCode: p.versionCode,
      pcVersion: p.pcVersion,
    },
    selection: {
      modelKey: sel.itemKey,
      modeId: sel.modeId,
      effort: sel.effort,
      gate: sel.gate,
      search: netSearch,
    },
    localConversationId,
    reuse: reuse != null,
    webTabId,
    identityMismatch,
  };
}

/** The model selection AS CARRIED BY one request body that
 * actually went out, read back out of the body itself — null
 * when the body carries no selection bundle (the plain body).
 * Reading it from the sent body, not from the plan, is what
 * makes the recorded fact "this selection really left": the
 * plan's selection and the wire's selection parted ways once
 * already (the pre-2026-11-20 order sent the plain body first
 * while the saved selection said otherwise). */
function doubaoBodySelection(body: unknown): {
  modelKey: string;
  modeId: string;
  effort: number;
  gate: number;
  search: boolean;
} | null {
  if (!body || typeof body !== "object") return null;
  const opt = (body as { option?: unknown }).option;
  if (!opt || typeof opt !== "object") return null;
  const o = opt as Record<string, unknown>;
  const rec = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const mc = rec(o.model_config);
  const cie = rec(o.conversation_init_ext);
  const agg = rec(o.aggregate_params);
  const key = mc?.model_item_key ?? cie?.model_item_key ?? agg?.model_item_key;
  if (typeof key !== "string" || key === "") return null;
  const modeId = agg?.mode_id ?? cie?.mode_id;
  const effortRaw = mc?.reasoning_effort ?? cie?.reasoning_effort;
  const effortNum =
    typeof effortRaw === "number"
      ? effortRaw
      : typeof effortRaw === "string"
        ? Number.parseInt(effortRaw, 10)
        : NaN;
  return {
    modelKey: key,
    modeId: typeof modeId === "string" ? modeId : "",
    effort: Number.isFinite(effortNum) ? effortNum : 0,
    gate: typeof o.need_deep_think === "number" ? o.need_deep_think : 0,
    search: o.need_net_search === true,
  };
}

/** The full record of one Doubao send, as stored on the agent
 * row (agents.web_last_send_json) and shown by
 * getDoubaoSendData: the plan facts plus, per attempt actually
 * run, the exact URL + body that went out and the site's real
 * response digest. Bodies are capped so a very long history
 * prompt cannot bloat the row; the cap is recorded when hit.
 * Alongside the plan's selection it persists `sentSelection`:
 * the selection that ACTUALLY went out, read back from the
 * ran attempts' own bodies by doubaoBodySelection — whether
 * any ran attempt carried the bundle at all, which attempt
 * (0-based into attempts) carried it first, which attempt got
 * the reply, and the selection values that body carried (all
 * null when no ran attempt carried the bundle). The settings
 * diagnostics render their 「本次实际发出的选择」 line from
 * these persisted facts instead of inferring them from the
 * recorded bodies, so the line survives body truncation and
 * says "never sent" for a fallback-only send. Records written
 * before this field existed simply lack it; the panel falls
 * back to reading the bodies for those. */
function doubaoSendRecordJson(
  plan: DoubaoSendPlan,
  ran: {
    attempt: DoubaoPlannedAttempt;
    result: DoubaoAttemptResult | null;
  }[],
  outcome: string,
): string {
  const cap = (body: unknown): { bodyJson: string; truncated: boolean } => {
    const json = JSON.stringify(body);
    if (json.length <= 60000) return { bodyJson: json, truncated: false };
    return { bodyJson: json.slice(0, 60000), truncated: true };
  };
  const sentSelections = ran.map(({ attempt }) =>
    doubaoBodySelection(attempt.body),
  );
  const bundleIdx = sentSelections.findIndex((s) => s != null);
  const bundleSel = bundleIdx >= 0 ? sentSelections[bundleIdx] : null;
  const hitIdx = ran.findIndex(
    ({ result }) => result != null && Boolean(result.text || result.media.length),
  );
  return JSON.stringify({
    at: Date.now(),
    outcome,
    reuse: plan.reuse,
    params: plan.params,
    selection: plan.selection,
    sentSelection: {
      carried: bundleSel != null,
      attemptIndex: bundleIdx >= 0 ? bundleIdx : null,
      hitAttemptIndex: hitIdx >= 0 ? hitIdx : null,
      modelKey: bundleSel ? bundleSel.modelKey : null,
      modeId: bundleSel ? bundleSel.modeId : null,
      effort: bundleSel ? bundleSel.effort : null,
      gate: bundleSel ? bundleSel.gate : null,
      search: bundleSel ? bundleSel.search : null,
    },
    attempts: ran.map(({ attempt, result }, i) => {
      const { bodyJson, truncated } = cap(attempt.body);
      return {
        label: attempt.label,
        url: attempt.url,
        bodyJson,
        bodyTruncated: truncated,
        carriedSelection: sentSelections[i] != null,
        status: result ? result.status : 0,
        apiError: result ? result.apiError : "",
        responseBytes: result ? result.raw.length : 0,
        verifyChallenge: result ? result.verifyChallenge : false,
        verifyScene: result ? result.verifyScene : "",
        gotReply: result ? Boolean(result.text || result.media.length) : false,
      };
    }),
  });
}

/** Builds one send's guidance-log entry from the attempts that
 * actually ran: the decisive attempt (the one that replied, the
 * one that carried the verify decision, or the last one) gives
 * the status / size / error / parser counts; the verify / shark
 * flags scan every attempt's raw response. The summary is the
 * decisive response's first 4096 characters — an excerpt, never
 * the whole body. */
function doubaoGuidanceEntry(
  outcome: string,
  attempts: DoubaoAttemptResult[],
  decisive: DoubaoAttemptResult | null,
): DoubaoGuidanceLogEntry {
  const allRaw = attempts.map((a) => a.raw).join("\n").toLowerCase();
  const errParts = (decisive?.apiError ?? "").split(/\s+/);
  return {
    outcome,
    httpStatus: decisive ? decisive.status : null,
    responseBytes: decisive
      ? new TextEncoder().encode(decisive.raw).length
      : 0,
    errorCode: decisive ? decisive.errorCode : null,
    errorMsg:
      decisive && decisive.errorCode !== null
        ? errParts.slice(1).join(" ").slice(0, 200)
        : (decisive?.apiError ?? "").slice(0, 200),
    hasVerify:
      allRaw.includes("verify") || attempts.some((a) => a.verifyChallenge),
    hasShark: allRaw.includes("shark"),
    candidateCount: decisive ? decisive.candidateCount : 0,
    payloadCount: decisive ? decisive.payloadCount : 0,
    summary: decisive ? decisive.raw.slice(0, 4096) : "",
  };
}

async function chatDoubao(
  token: string,
  prompt: string,
  storedDeviceId = "",
  webOpts: {
    menu?: DoubaoMenu;
    modelKey?: string;
    reasoning?: string;
    search?: boolean;
    session?: DoubaoRemoteState | null;
    expectedIdentityHash?: string;
  } = {},
): Promise<DoubaoChatResult> {
  // Phase + timing are tracked OUTSIDE the try so the catch can
  // say WHERE the send died (preparation before any fetch, a
  // specific attempt's fetch, …) and how long it took — the two
  // facts that separate "never reached Doubao" from "Doubao
  // refused", which the old single fixed message erased.
  const sendStartedAt = Date.now();
  let phase = "发送前准备（清洗 Cookie、组装请求）";
  // Cookie cleaning + per-field validation first (the test
  // space's proven step, ported with checkDoubaoCookie): a
  // field whose value cannot legally sit in a header makes
  // undici reject the fetch before it is sent, so the send is
  // aborted here with the field NAMED instead of dying later
  // as an unexplained 0-byte network error.
  const cookieCheck = checkDoubaoCookie(token);
  if (cookieCheck.invalidFields.length > 0) {
    const detail =
      `没有发出：保存的 Cookie 里有字段含非法字符，无法放进请求头：${cookieCheck.invalidFields.join("、")}。` +
      `请重新从豆包网页复制一份完整的 Cookie 保存到这个智能体，再发一条。`;
    return {
      ok: false,
      error: detail,
      kind: "error",
      guidanceLog: {
        outcome: "cookie_invalid",
        httpStatus: null,
        responseBytes: 0,
        errorCode: null,
        errorMsg: detail.slice(0, 200),
        hasVerify: false,
        hasShark: false,
        candidateCount: 0,
        payloadCount: 0,
        summary: detail.slice(0, 4096),
      } satisfies DoubaoGuidanceLogEntry,
    };
  }
  const cleanToken = cookieCheck.cleaned;
  try {
    phase = "发送前准备（读取官网页面参数、组装请求体与模型选择包）";
    const plan = await buildDoubaoSendPlan(cleanToken, prompt, storedDeviceId, webOpts);
    if (plan.identityMismatch) {
      // The account this Cookie currently resolves to is NOT
      // the account this agent was verified as: nothing is
      // sent. Posting anyway would put the message in another
      // account's history — the exact failure the identity
      // guard exists to prevent — so the send stops here with
      // the fact and the fix, and the room's stored官网
      // conversation is left untouched (reusedFailed false).
      const detail =
        `没有发出：豆包官网这次返回的实际登录账号，与该智能体保存凭证时验证的账号不一致——` +
        `这份凭证现在指向的是另一个账号（官网页面报出的账号 ID ${plan.params.accountId || "未知"}）。` +
        `为避免消息发到错误账号的历史里，本次已停发。请打开该智能体的设置重新「验证登录」：` +
        `验证会按官网现在的实际账号更新记录；如果它本应是另一个账号，请从那个账号的浏览器会话重新复制 Cookie 再验证。`;
      return {
        ok: false,
        error: detail,
        kind: "error",
        reusedFailed: false,
        sentRecordJson: doubaoSendRecordJson(plan, [], "identity_mismatch"),
        guidanceLog: {
          outcome: "identity_mismatch",
          httpStatus: null,
          responseBytes: 0,
          errorCode: null,
          errorMsg: detail.slice(0, 200),
          hasVerify: false,
          hasShark: false,
          candidateCount: 0,
          payloadCount: 0,
          summary: detail.slice(0, 4096),
        } satisfies DoubaoGuidanceLogEntry,
        webTabId: plan.webTabId,
      };
    }
    const reuse =
      webOpts.session && webOpts.session.remoteConversationId
        ? webOpts.session
        : null;
    const ran: {
      attempt: DoubaoPlannedAttempt;
      result: DoubaoAttemptResult | null;
    }[] = [];
    let hit: DoubaoAttemptResult | null = null;
    for (const attempt of plan.attempts) {
      // A shark verify decision ends the chain early: every
      // channel sits behind the same risk gate, so the remaining
      // attempts would only be refused too — and each refused
      // send is another risk event on the account.
      if (ran.some((r) => r.result?.verifyChallenge)) break;
      phase = `发送请求（${attempt.label}）`;
      const r = await doubaoAttempt(attempt.label, attempt.url, cleanToken, attempt.body);
      ran.push({ attempt, result: r });
      // A media-only reply (a generated picture or video with
      // little or no prose) is a real reply: before media was
      // harvested, an empty text here read as "no reply" and the
      // attempt — image and all — was thrown away.
      if (r.text || r.media.length) {
        hit = r;
        break;
      }
    }
    const attempts = ran
      .map((r) => r.result)
      .filter((r): r is DoubaoAttemptResult => r != null);
    if (hit) {
      const remoteId = hit.conversationId || reuse?.remoteConversationId || "";
      return {
        ok: true,
        text: hit.text,
        media: hit.media.length ? hit.media : undefined,
        remote: remoteId
          ? {
              remoteConversationId: remoteId,
              localConversationId: plan.localConversationId,
              lastSectionId: hit.sectionId || reuse?.lastSectionId || "",
              lastMessageIndex: (reuse?.lastMessageIndex ?? 0) + 2,
              webTabId: plan.webTabId,
            }
          : undefined,
        sentRecordJson: doubaoSendRecordJson(plan, ran, "ok"),
        guidanceLog: doubaoGuidanceEntry("replied", attempts, hit),
        webTabId: plan.webTabId,
      };
    }

    const lines = attempts.map((a) => {
      const digest = doubaoResponseDigest(a.status, a.raw, a.apiError);
      return `${a.label} — ${digest}`;
    });
    const verify = attempts.find((a) => a.verifyChallenge);
    if (verify) {
      // The stored官网 conversation is not at fault — the shark
      // gate refused the send itself — so reusedFailed stays
      // false: the caller must not drop the mapping or retry
      // fresh against an active verification demand.
      return {
        ok: false,
        error:
          `豆包这次没有返回回复：豆包的风控（shark）对这次发送下发了真人验证要求` +
          `（decision type=verify${verify.verifyScene ? `，场景 ${verify.verifyScene}` : ""}），` +
          `错误码 710022004 虽然写着 rate limited，实际是风控验证、不是普通限流、也不是 Cookie 过期。` +
          `下一步：请在你自己的浏览器里打开豆包网页版、完成它给出的验证，然后换一份新鲜的 Cookie 保存到空间里，再发一条试试——不要连发，每次被拒的发送都是一次新的风控判定。` +
          `空间不会反复试发：这次识别出验证要求后已经只发一次就停下。发送的指纹与请求体已经和你的浏览器对齐（见设置里的「发送数据诊断」与「指导日志」），验证何时解除由豆包决定。` +
          `要用豆包的模型，也可以改用火山方舟 API 型的豆包智能体（官方接口，不走网页通道）。真实结果 — ${lines.join("；")}。`,
        kind: "blocked",
        reusedFailed: false,
        sentRecordJson: doubaoSendRecordJson(plan, ran, "blocked"),
        guidanceLog: doubaoGuidanceEntry("blocked", attempts, verify),
        webTabId: plan.webTabId,
      };
    }
    const rateLimited = attempts.some((a) => a.apiError.includes("710022004"));
    const guidance = rateLimited
      ? "其中 710022004 是豆包的风控限流：短时间内发送太频繁时它会拒绝生成，通常等几分钟到半小时、期间不要连发就会恢复；这不是令牌过期。"
      : "这两条都是只用你保存的 Cookie 的服务端直连（真浏览器代发已按你的要求停用），请求体都是新统一协议：第一条带当前的模型选择包（模型键、mode_id、推理强度、联网搜索按官网格式写全），聊天框里的模型切换靠它生效；第二条是和豆包测试空间完全一致的 plain 请求体，只作回退。如果全都被拒，说明豆包又改了协议或对这个账号/IP 加强了风控；每次实际发出的完整数据和豆包的真实返回都记在豆包智能体设置的「发送数据诊断」里、「指导日志」里有每次的结果和下一步建议，可以在那里逐项核对。";
    // A reply-shaped failure: an attempt that came back HTTP 200
    // with response content but no error code and no parseable
    // text is "unparsed" (the format likely changed); anything
    // else is a plain rejection carrying Doubao's own code.
    const lastAttempt = attempts[attempts.length - 1] ?? null;
    const unparsed =
      !rateLimited &&
      attempts.length > 0 &&
      attempts.every(
        (a) => a.errorCode === null && !a.apiError && a.status === 200,
      );
    return {
      ok: false,
      error: `豆包这次没有返回回复。两条直连的真实结果 — ${lines.join("；")}。${guidance}`,
      kind: "error",
      reusedFailed: reuse != null,
      sentRecordJson: doubaoSendRecordJson(plan, ran, "error"),
      guidanceLog: doubaoGuidanceEntry(
        unparsed ? "unparsed" : "rejected",
        attempts,
        lastAttempt,
      ),
      webTabId: plan.webTabId,
    };
  } catch (e) {
    // The underlying error is recorded VERBATIM (name, message
    // and the cause chain via webNetFailure/describeThrownError),
    // together with the phase the send had reached and the
    // elapsed time — never again only the fixed "网络错误"
    // sentence, which made a pre-fetch local exception
    // indistinguishable from a remote refusal.
    const failure = webNetFailure("豆包", e);
    const detail =
      `${failure.error}｜出错阶段：${phase}｜耗时 ${Date.now() - sendStartedAt}ms` +
      `（豆包的服务端拦截都会返回 HTTP 200 加错误载荷；0 字节、无 HTTP 状态说明请求没有到达豆包，问题出在本地这一段）`;
    return {
      ok: false,
      error: detail,
      kind: failure.kind,
      guidanceLog: {
        outcome: "network_error",
        httpStatus: null,
        responseBytes: 0,
        errorCode: null,
        errorMsg: detail.slice(0, 200),
        hasVerify: false,
        hasShark: false,
        candidateCount: 0,
        payloadCount: 0,
        summary: detail.slice(0, 4096),
      } satisfies DoubaoGuidanceLogEntry,
    };
  }
}

/* ---- 元宝 (yuanbao.tencent.com) ----
 * Token: the site's Cookie string. Validate: GET /api/user/info.
 * Chat: create a conversation, then POST /api/chat/{id} (SSE of
 * {"type":"text","msg":…} fragments) with the default assistant. */
function yuanbaoHeaders(token: string): Record<string, string> {
  return {
    Cookie: token.trim(),
    "User-Agent": WEB_UA,
    Origin: "https://yuanbao.tencent.com",
    Referer: "https://yuanbao.tencent.com/",
    "x-source": "web",
  };
}

async function validateYuanbao(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText("https://yuanbao.tencent.com/api/user/info", {
      headers: yuanbaoHeaders(token),
    });
    if (res.status !== 200) return webHttpFailure("元宝", res.status, res.text);
    const root = webJson(res.text);
    if (!root)
      return { ok: false, error: "元宝网页端未返回账号数据（Cookie 可能已失效）", kind: "expired" };
    const account =
      dsFindField(root, ["nickName", "nickname", "userName", "name"], 0) ||
      dsFindField(root, ["userId", "uin"], 0);
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("元宝", e);
  }
}

async function chatYuanbao(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const created = await webFetchText("https://yuanbao.tencent.com/api/conversation", {
      method: "POST",
      headers: { ...yuanbaoHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "naQivTmsDa" }),
    });
    if (created.status !== 200)
      return { ...webHttpFailure("元宝", created.status, created.text) };
    const createdRoot = webJson(created.text);
    const convId =
      strField(asRecord(createdRoot?.data)?.id) || strField(createdRoot?.id);
    if (!convId)
      return { ok: false, error: "元宝网页端未返回会话编号（接口可能已变更）", kind: "error" };
    const res = await webFetchText(
      `https://yuanbao.tencent.com/api/chat/${convId}`,
      {
        method: "POST",
        headers: {
          ...yuanbaoHeaders(token),
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          chatModelId: "hunyuan_gpt",
          modelId: "hunyuan_gpt",
          agentId: "naQivTmsDa",
          messages: [
            { role: "user", content: [{ type: "text", text: prompt }] },
          ],
          supportFunctions: ["openAutoSearch"],
        }),
      },
      90_000,
    );
    if (res.status !== 200)
      return { ...webHttpFailure("元宝", res.status, res.text) };
    let text = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = webJson(trimmed.slice(5).trim());
      if (!data) continue;
      if (data.type === "text" && typeof data.msg === "string") text += data.msg;
      // Non-text events (a generated image, a speech/audio
      // payload, a file) are harvested with the prose field
      // excluded by name.
      bag.add(collectMediaFromValue(data, { skipKeys: ["msg"] }));
    }
    const out = text.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "元宝网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("元宝", e) };
  }
}

/* ---- 智谱清言 (chatglm.cn) ----
 * Token: the JWT from localStorage. Validate: the conversation
 * list. Chat: POST /chatglm/backend-api/assistant/stream with the
 * default GLM assistant; its SSE chunks carry cumulative part
 * snapshots, so the longest text wins. */
const ZHIPU_ASSISTANT_ID = "65940acff94777010aa6b796";

function zhipuHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    "Content-Type": "application/json",
    "User-Agent": WEB_UA,
    Origin: "https://chatglm.cn",
    Referer: "https://chatglm.cn/main/alltoolsdetail",
  };
}

async function validateZhipu(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText(
      "https://chatglm.cn/chatglm/backend-api/conversation/list",
      {
        method: "POST",
        headers: zhipuHeaders(token),
        body: JSON.stringify({ assistant_id: ZHIPU_ASSISTANT_ID, page: 1, page_size: 1 }),
      },
    );
    if (res.status !== 200) return webHttpFailure("智谱清言", res.status, res.text);
    const root = webJson(res.text);
    if (!root || (typeof root.code === "number" && root.code !== 0))
      return {
        ok: false,
        error: dsErrorMessage(root, "智谱清言拒绝了该令牌"),
        kind: "expired",
      };
    const account = dsFindField(root, ["nickname", "user_name", "name"], 0);
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("智谱清言", e);
  }
}

async function chatZhipu(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const res = await webFetchText(
      "https://chatglm.cn/chatglm/backend-api/assistant/stream",
      {
        method: "POST",
        headers: { ...zhipuHeaders(token), Accept: "text/event-stream" },
        body: JSON.stringify({
          assistant_id: ZHIPU_ASSISTANT_ID,
          conversation_id: "",
          app_version: "0.0.1",
          platform: "web",
          messages: [
            { role: "user", content: [{ type: "text", text: prompt }] },
          ],
        }),
      },
      90_000,
    );
    if (res.status !== 200)
      return { ...webHttpFailure("智谱清言", res.status, res.text) };
    let best = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = webJson(trimmed.slice(5).trim());
      if (!data) continue;
      const parts = Array.isArray(data.parts) ? data.parts : [];
      for (const part of parts) {
        const content = asRecord(part)?.content;
        if (!Array.isArray(content)) continue;
        const joined = content
          .map((c) => (typeof asRecord(c)?.text === "string" ? (asRecord(c)?.text as string) : ""))
          .join("");
        if (joined.length > best.length) best = joined;
      }
      // Non-text content entries (a CogView image entry, a file
      // entry) are harvested from the parts with the prose
      // fields excluded by name.
      if (parts.length)
        bag.add(collectMediaFromValue(parts, { skipKeys: ["text"] }));
    }
    const out = best.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "智谱清言网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("智谱清言", e) };
  }
}

/* ---- Mistral / Le Chat (chat.mistral.ai) ----
 * Token: the site's Cookie string (NextAuth session). Validate:
 * GET /api/auth/session — the standard NextAuth endpoint, which
 * returns the user object only in the logged-in state. Chat:
 * POST /api/chat/completions (OpenAI-shaped; JSON or SSE). */
function mistralHeaders(token: string): Record<string, string> {
  return {
    Cookie: token.trim(),
    "User-Agent": WEB_UA,
    Origin: "https://chat.mistral.ai",
    Referer: "https://chat.mistral.ai/chat",
  };
}

async function validateMistral(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText("https://chat.mistral.ai/api/auth/session", {
      headers: mistralHeaders(token),
    });
    if (res.status !== 200) return webHttpFailure("Mistral", res.status, res.text);
    const root = webJson(res.text);
    const user = asRecord(root?.user);
    const account = strField(user?.email) || strField(user?.name);
    if (!user)
      return { ok: false, error: "Mistral 网页未处于登录状态（Cookie 已失效）", kind: "expired" };
    return { ok: true, accessToken: token.trim(), account };
  } catch (e) {
    return webNetFailure("Mistral", e);
  }
}

async function chatMistral(
  token: string,
  prompt: string,
  _deviceId?: string,
  _webOpts?: { mode?: string; search?: boolean },
  image?: ChatImage | null,
): Promise<WebChatResult> {
  try {
    // Mistral's web completion takes OpenAI-shaped messages, so
    // a picture rides it as a standard image_url part carrying
    // the picture's own data URI, beside the text part — the
    // same channel the official client uses for image sends.
    // Text-only turns keep the plain string content untouched.
    const userContent: string | unknown[] = image
      ? [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
          },
        ]
      : prompt;
    const res = await webFetchText("https://chat.mistral.ai/api/chat/completions", {
      method: "POST",
      headers: {
        ...mistralHeaders(token),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (res.status !== 200)
      return { ...webHttpFailure("Mistral", res.status, res.text) };
    if (!res.text.includes("data:")) {
      const root = webJson(res.text);
      const choices = Array.isArray(root?.choices) ? root.choices : [];
      const content = asRecord(asRecord(choices[0])?.message)?.content;
      // Content may be a string or a parts array (a generated
      // image arrives as an image part, as in the API shape).
      const parts = extractContentParts(content);
      if (parts.text.trim() || parts.media.length)
        return {
          ok: true,
          text: parts.text.trim(),
          media: parts.media.length ? parts.media : undefined,
        };
      return { ok: false, error: "Mistral 网页端返回了无法解析的回复（接口可能已变更）", kind: "error" };
    }
    let text = "";
    const bag = new MediaBag();
    for (const line of res.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const data = webJson(payload);
      const choices = Array.isArray(data?.choices) ? data.choices : [];
      const delta = asRecord(asRecord(choices[0])?.delta);
      if (typeof delta?.content === "string") text += delta.content;
      else if (Array.isArray(delta?.content)) {
        const parts = extractContentParts(delta.content);
        text += parts.text;
        bag.add(parts.media);
      }
    }
    const out = text.trim();
    if (!out && !bag.items.length)
      return { ok: false, error: "Mistral 网页端返回了空回复", kind: "error" };
    return { ok: true, text: out, media: bag.list };
  } catch (e) {
    return { ...webNetFailure("Mistral", e) };
  }
}

/* ---- 文心一言 (chat.baidu.com) ----
 * Token: the Baidu Cookie string (BDUSS…). Validate: the chat
 * page must render in the logged-in state. Chat is the structural
 * exception: Baidu signs every conversation call with an
 * acs-token produced by page JavaScript, which a server cannot
 * reproduce — the chat path states this plainly instead of
 * inventing a call or a reply. */
async function validateWenxin(token: string): Promise<DsValidateResult> {
  try {
    const res = await webFetchText("https://chat.baidu.com/", {
      headers: { Cookie: token.trim(), "User-Agent": WEB_UA },
    });
    if (res.status === 403) return webHttpFailure("文心一言", res.status, res.text);
    if (res.url.includes("passport.baidu.com"))
      return { ok: false, error: "文心一言网页未处于登录状态（Cookie 已失效）", kind: "expired" };
    if (
      res.text.includes("\"isLogin\":true") ||
      res.text.includes("isLogin\": true") ||
      res.text.includes("user-name")
    ) {
      const account = /"userName":"([^"]+)"/.exec(res.text)?.[1] ?? "";
      return { ok: true, accessToken: token.trim(), account };
    }
    return {
      ok: false,
      error: "文心一言网页未返回可确认的登录信息（请粘贴登录状态下的完整 Cookie）",
      kind: "error",
    };
  } catch (e) {
    return webNetFailure("文心一言", e);
  }
}

async function chatWenxin(): Promise<WebChatResult> {
  return {
    ok: false,
    error:
      "文心一言网页端的每次对话请求都由页面 JavaScript 生成签名（acs-token），服务端无法复现该签名，因此暂时无法代发消息；令牌本身已保存在服务端，登录验证可用",
    kind: "error",
  };
}

/* Dispatch by the web agent's provider id (its site). DeepSeek is
 * deliberately not in these tables: it keeps its own richer path
 * (callDeepseekWeb) with per-reply validation and per-room官网
 * conversation reuse. */
const WEB_VALIDATORS: Record<string, (token: string) => Promise<DsValidateResult>> = {
  chatgpt: validateChatgpt,
  claude: validateClaude,
  gemini: validateGemini,
  grok: validateGrok,
  kimi: validateKimi,
  qwen: validateQwen,
  doubao: validateDoubao,
  hunyuan: validateYuanbao,
  zhipu: validateZhipu,
  mistral: validateMistral,
  wenxin: validateWenxin,
};

const WEB_CHATTERS: Record<
  string,
  (
    token: string,
    prompt: string,
    deviceId?: string,
    webOpts?: { mode?: string; search?: boolean },
    // The turn's picture, for the adapters whose site has a
    // real upload channel (ChatGPT / Claude / Gemini / Mistral);
    // the others never receive one — produceReply's image gate
    // refuses the turn for them before dispatch.
    image?: ChatImage | null,
  ) => Promise<WebChatResult>
> = {
  chatgpt: chatChatgpt,
  claude: chatClaude,
  gemini: chatGemini,
  grok: chatGrok,
  kimi: chatKimi,
  // 千问's third parameter is its aligned credential set
  // (QwenCreds), not a device id: the reply path calls
  // chatQwen directly with the agent's stored Cookie/UA, and
  // this entry only keeps the table complete for bare calls.
  qwen: (token, prompt) => chatQwen(token, prompt),
  doubao: chatDoubao,
  hunyuan: chatYuanbao,
  zhipu: chatZhipu,
  mistral: chatMistral,
  wenxin: chatWenxin,
};

/** Marks a web agent's login freshly proven (status + cleared
 * error) without touching its stored account label. */
async function dsMarkWebOk(ctx: Ctx, agentId: number): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    await db
      .update(schema.agents)
      .set({ webStatus: "logged_in", webError: "" })
      .where(eq(schema.agents.id, agentId));
  } catch {
    // best effort — the reply itself already proved the login
  }
}

/** Media a web agent generated in its reply, downloaded into
 * the space's own blob store — the shape a message row's
 * attachment fields carry. */
type StoredReplyMedia = {
  blobKey: string;
  fileName: string;
  fileSize: number;
  fileMime: string;
};

const REPLY_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

/** Extension → MIME for reply media whose download answered a
 * generic content type: the file's own extension decides what
 * it is, exactly as the URL named it. */
const MEDIA_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m3u8: "application/x-mpegURL",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

function replyMediaExt(
  mime: string,
  kind: ReplyMediaKind,
  name?: string,
): string {
  const sub = (mime.split("/")[1] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (sub && sub !== "octet-stream") return sub === "jpeg" ? "jpg" : sub;
  const fromName = name ? /\.([a-z0-9]{1,8})$/i.exec(name)?.[1] : undefined;
  if (fromName) return fromName.toLowerCase();
  return kind === "image"
    ? "png"
    : kind === "video"
      ? "mp4"
      : kind === "audio"
        ? "mp3"
        : "bin";
}

/** Whether a downloaded payload's real type matches what the
 * reply claimed it was. Images, videos and audio must really be
 * of their family; a file may be any real type — but never an
 * HTML error page in disguise. */
function replyMediaTypeOk(kind: ReplyMediaKind, mime: string): boolean {
  if (!mime || mime === "text/html") return false;
  if (kind === "image") return mime.startsWith("image/");
  if (kind === "video")
    return mime.startsWith("video/") || mime === "application/x-mpegURL";
  if (kind === "audio") return mime.startsWith("audio/");
  return true;
}

function sanitizeReplyFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Downloads the media a reply carried (a generated picture,
 * video, audio clip or file) into the space's blob store. Each
 * item is fetched from the site's own URL (or decoded from the
 * data: URI an API reply carried inline); a failed, oversize or
 * wrong-type download never fails the reply itself — the item
 * lands in `failed` and the caller appends the site's original
 * URL to the reply text so the user can still open the file. */
async function storeReplyMedia(
  ctx: Ctx,
  items: WebMediaItem[],
): Promise<{ stored: StoredReplyMedia[]; failed: WebMediaItem[] }> {
  const stored: StoredReplyMedia[] = [];
  const failed: WebMediaItem[] = [];
  const counts: Record<ReplyMediaKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    file: 0,
  };
  for (const item of items.slice(0, 8)) {
    try {
      let bytes: Uint8Array;
      let mime = "";
      if (item.url.startsWith("data:")) {
        const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(item.url);
        if (!m || !m[2]) throw new Error("unsupported data URI");
        mime = (m[1] ?? "").trim().toLowerCase();
        const buf = Buffer.from(m[3] ?? "", "base64");
        if (buf.byteLength === 0 || buf.byteLength > REPLY_MEDIA_MAX_BYTES)
          throw new Error("unacceptable size");
        bytes = new Uint8Array(buf);
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        try {
          const res = await agentFetch(item.url, {
            headers: {
              "User-Agent": WEB_UA,
              Referer: item.referer ?? "https://www.doubao.com/",
            },
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          mime = (res.headers.get("content-type") ?? "")
            .split(";")[0]
            ?.trim()
            .toLowerCase() ?? "";
          const buf = await res.arrayBuffer();
          if (buf.byteLength === 0 || buf.byteLength > REPLY_MEDIA_MAX_BYTES)
            throw new Error("unacceptable size");
          bytes = new Uint8Array(buf);
        } finally {
          clearTimeout(timer);
        }
      }
      // The reply's own type must check out against the payload.
      // When the CDN answers a generic type, the URL's (or the
      // file's own name's) extension decides; anything else
      // fails honestly instead of storing a disguised error page.
      if (!replyMediaTypeOk(item.kind, mime)) {
        const ext =
          /\.(png|jpe?g|webp|gif|bmp|avif|mp4|mov|webm|mkv|m3u8|mp3|wav|m4a|aac|ogg|opus|flac|pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|md|csv|json)(?:[?~#]|$)/i
            .exec(item.url)?.[1]
            ?.toLowerCase() ??
          (item.name
            ? /\.([a-z0-9]{1,8})$/i.exec(item.name)?.[1]?.toLowerCase() ?? ""
            : "");
        mime = (ext && MEDIA_EXT_MIME[ext]) || "";
      }
      if (!replyMediaTypeOk(item.kind, mime))
        throw new Error("unexpected content type");
      const ext = replyMediaExt(mime, item.kind, item.name);
      const n = ++counts[item.kind];
      let fileName: string;
      if (item.kind === "image")
        fileName = `生成的图片${n > 1 ? n : ""}.${ext}`;
      else if (item.kind === "video")
        fileName = `生成的视频${n > 1 ? n : ""}.${ext}`;
      else if (item.kind === "audio")
        fileName = `生成的音频${n > 1 ? n : ""}.${ext}`;
      else {
        const named = item.name ? sanitizeReplyFileName(item.name) : "";
        fileName =
          named && /\.[a-z0-9]{1,8}$/i.test(named)
            ? named
            : named
              ? `${named}.${ext}`
              : `生成的文件${n > 1 ? n : ""}.${ext}`;
      }
      const blobKey = `chat-media/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}.${ext}`;
      await ctx.blobs.put(blobKey, bytes, { contentType: mime });
      stored.push({
        blobKey,
        fileName,
        fileSize: bytes.byteLength,
        fileMime: mime,
      });
    } catch {
      failed.push(item);
    }
  }
  return { stored, failed };
}

/** Stores a reply's harvested media and returns the reply text
 * plus the stored attachments. A media item whose download
 * failed is named honestly in the text (with the site's
 * original URL when there is one) — nothing pretends the media
 * arrived when it did not. */
async function attachReplyMedia(
  ctx: Ctx,
  label: string,
  text: string,
  media: WebMediaItem[] | undefined,
): Promise<{ text: string; media?: StoredReplyMedia[] }> {
  if (!media || !media.length) return { text };
  const got = await storeReplyMedia(ctx, media);
  let out = text;
  for (const f of got.failed) {
    const what =
      f.kind === "image"
        ? "一张图片"
        : f.kind === "video"
          ? "一段视频"
          : f.kind === "audio"
            ? "一段音频"
            : "一个文件";
    out += `${out ? "\n" : ""}（${label}生成的${what}没能下载到空间${
      f.url.startsWith("data:") ? "" : `，原文件：${f.url}`
    }）`;
  }
  return { text: out, media: got.stored.length ? got.stored : undefined };
}

/** Inserts one reply outcome's message rows: the text row first
 * (skipped for a media-only reply, so no empty bubble is saved),
 * then one row per stored media item carrying its blob as the
 * message attachment. Returns the rows in display order. */
async function insertReplyRows(
  db: Db,
  conversationId: number,
  outcome: {
    text: string;
    agentId: number | null;
    media?: StoredReplyMedia[];
  },
): Promise<MessageRow[]> {
  const rows: MessageRow[] = [];
  const media = outcome.media ?? [];
  if (outcome.text || !media.length) {
    const inserted = await db
      .insert(schema.messages)
      .values({
        conversationId,
        role: "assistant",
        agentId: outcome.agentId,
        content: outcome.text,
      })
      .returning();
    if (inserted[0]) rows.push(inserted[0]);
  }
  for (const m of media) {
    const inserted = await db
      .insert(schema.messages)
      .values({
        conversationId,
        role: "assistant",
        agentId: outcome.agentId,
        content: "",
        imageBlobKey: m.blobKey,
        fileName: m.fileName,
        fileSize: m.fileSize,
        fileMime: m.fileMime,
      })
      .returning();
    if (inserted[0]) rows.push(inserted[0]);
  }
  return rows;
}

/* ---- 豆包异步媒体补收 (async Doubao media collection) ----
 * Doubao generates videos asynchronously: the send's reply only
 * announces the generation ("正在为你生成视频…"), and the
 * finished video is pushed into the same官网 conversation
 * minutes to tens of minutes later as a NEW assistant message.
 * The space only ever read the send's own stream, so that later
 * message — and its video — never arrived here, and asking the
 * model to "send it again" does not help (it cannot re-attach a
 * finished generation to a new reply). The fix reads the
 * conversation back: when a Doubao reply looks like a video
 * generation start, a pending watch is registered
 * (doubao_pending_media) with a snapshot of the官网
 * conversation's current message ids; the space's existing
 * 15-minute schedule (runDueTriggers) then polls the
 * conversation history through Doubao's own history endpoint —
 * POST /im/chain/single, cmd 3100, the exact call the official
 * web client makes when it loads a conversation (response:
 * downlink_body.pull_singe_chain_downlink_body.messages,
 * newest first; endpoint shape cross-checked against the
 * open-source doubao-cli / doubao-nomark protocol notes and
 * verified live on the user's own account in the sandbox on
 * 2026-11-20, where the history of a real room contained
 * exactly such a late video message at index 11 whose space
 * mapping had stopped at index 8). The first new assistant
 * message carrying media is downloaded through the normal
 * reply-media path (attachReplyMedia + insertReplyRows), so
 * the video lands in the room as the agent's own message. A
 * watch expires after 2 hours; registration, collection and
 * expiry are written to the agent's guidance log
 * (doubao_send_logs outcomes collect_registered / collected /
 * collect_expired) so the settings panel shows what happened. */

type DoubaoPendingRow = typeof schema.doubaoPendingMedia.$inferSelect;

const DOUBAO_PENDING_TTL_MS = 2 * 60 * 60 * 1000;

/** Inserts one guidance-log row for a Doubao agent and prunes
 * the log to its newest 20 rows — the same write
 * persistDoubaoSend performs per send, shared with the async
 * collection's own entries. Diagnostic only: never throws. */
async function insertDoubaoGuidanceLog(
  db: Db,
  agentId: number,
  g: DoubaoGuidanceLogEntry,
): Promise<void> {
  try {
    await db.insert(schema.doubaoSendLogs).values({
      agentId,
      outcome: g.outcome,
      httpStatus: g.httpStatus,
      responseBytes: g.responseBytes,
      errorCode: g.errorCode,
      errorMsg: g.errorMsg,
      hasVerify: g.hasVerify ? 1 : 0,
      hasShark: g.hasShark ? 1 : 0,
      candidateCount: g.candidateCount,
      payloadCount: g.payloadCount,
      summary: g.summary,
    });
    const kept = await db
      .select({ id: schema.doubaoSendLogs.id })
      .from(schema.doubaoSendLogs)
      .where(eq(schema.doubaoSendLogs.agentId, agentId))
      .orderBy(desc(schema.doubaoSendLogs.id))
      .limit(20);
    const keptIds = new Set(kept.map((r) => r.id));
    const all = await db
      .select({ id: schema.doubaoSendLogs.id })
      .from(schema.doubaoSendLogs)
      .where(eq(schema.doubaoSendLogs.agentId, agentId));
    for (const row of all) {
      if (!keptIds.has(row.id)) {
        await db
          .delete(schema.doubaoSendLogs)
          .where(eq(schema.doubaoSendLogs.id, row.id));
      }
    }
  } catch {
    // the log is diagnostic only
  }
}

/** Reads one Doubao官网 conversation's newest messages through
 * the site's own history endpoint (see the section comment).
 * Returns the raw message records, newest first, or the site's
 * real refusal. The Cookie is used only as the request header —
 * never returned, never logged. */
async function fetchDoubaoHistoryMessages(
  token: string,
  storedDeviceId: string,
  remoteConversationId: string,
): Promise<
  | { ok: true; messages: Record<string, unknown>[] }
  | { ok: false; error: string }
> {
  const check = checkDoubaoCookie(token);
  if (check.invalidFields.length > 0)
    return {
      ok: false,
      error: `保存的 Cookie 有字段含非法字符：${check.invalidFields.join("、")}`,
    };
  const clean = check.cleaned;
  try {
    const p = await doubaoRequestParams(clean, storedDeviceId);
    const query = new URLSearchParams({
      aid: "497858",
      real_aid: "497858",
      device_platform: "web",
      doubao_device_platform: "web",
      language: "zh",
      pkg_type: "release_version",
      version_code: p.versionCode,
      pc_version: p.pcVersion,
      doubao_pc_version: p.pcVersion,
      region: p.region,
      sys_region: p.region,
      samantha_web: "1",
      web_platform: "browser",
      "use-olympus-account": "1",
      ...(p.deviceId ? { device_id: p.deviceId } : {}),
      ...(p.webId ? { web_id: p.webId, tea_uuid: p.webId } : {}),
    });
    const res = await webFetchText(
      `https://www.doubao.com/im/chain/single?${query.toString()}`,
      {
        method: "POST",
        headers: {
          ...doubaoHeaders(clean),
          "Content-Type": "application/json; encoding=utf-8",
        },
        body: JSON.stringify({
          cmd: 3100,
          uplink_body: {
            pull_singe_chain_uplink_body: {
              conversation_id: remoteConversationId,
              anchor_index: 0,
              direction: 3,
              limit: 50,
              ext: {},
            },
          },
          sequence_id: crypto.randomUUID(),
          channel: 2,
          version: "1",
        }),
      },
    );
    if (res.status !== 200)
      return { ok: false, error: `豆包历史接口返回 HTTP ${res.status}` };
    const root = webJson(res.text);
    if (!root) return { ok: false, error: "豆包历史接口返回的内容不是 JSON" };
    const code = typeof root.status_code === "number" ? root.status_code : null;
    if (code !== 0)
      return {
        ok: false,
        error: `豆包历史接口拒绝（status_code ${code ?? "未知"}${typeof root.status_desc === "string" && root.status_desc ? `：${root.status_desc}` : ""}）`,
      };
    const pull = asRecord(
      asRecord(root.downlink_body)?.pull_singe_chain_downlink_body,
    );
    const raw = Array.isArray(pull?.messages) ? pull.messages : [];
    const messages = raw
      .map((m) => asRecord(m))
      .filter((m): m is Record<string, unknown> => m != null);
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: webNetFailure("豆包", e).error };
  }
}

/** A history message's position in its官网 conversation
 * (index_in_conv arrives as a string). 0 = unreadable. */
function doubaoHistoryIndex(m: Record<string, unknown>): number {
  const n = Number(m.index_in_conv);
  return Number.isFinite(n) ? n : 0;
}

/** The readable text of one history message: its content_block
 * text blocks in order (thinking-container blocks excluded,
 * exactly like the stream parser), with the content string's
 * {"text": …} shape and the message's own brief as fallbacks.
 * The message's non-text extras (search references, inline
 * citations, follow-up suggestions) are appended as the same
 * sections the stream parser appends, so a message collected
 * through the history channel reads the same as one collected
 * live. */
function doubaoHistoryText(m: Record<string, unknown>): string {
  const blocks = Array.isArray(m.content_block) ? m.content_block : [];
  const thinking = new Set<string>();
  for (const b of blocks) {
    const br = asRecord(b);
    if (br?.block_type === 10040 && typeof br.block_id === "string" && br.block_id)
      thinking.add(br.block_id);
  }
  let text = "";
  for (const b of blocks) {
    const br = asRecord(b);
    if (!br) continue;
    const parent = typeof br.parent_id === "string" ? br.parent_id : "";
    if (parent && thinking.has(parent)) continue;
    const tb = asRecord(asRecord(br.content)?.text_block);
    if (typeof tb?.text === "string") text += tb.text;
  }
  if (!text.trim() && typeof m.content === "string" && m.content) {
    const parsed = webJson(m.content);
    if (typeof parsed?.text === "string") text = parsed.text;
  }
  if (!text.trim() && typeof m.brief === "string") text = m.brief;
  text = text.trim();
  const extrasText = doubaoExtrasSections(collectDoubaoExtras(m), text);
  if (extrasText) text = text ? text + extrasText : extrasText.trim();
  return text;
}

/** The generated media one history message carries. Two
 * channels, merged and de-duplicated by URL: (1) a deep walk
 * for video objects — a creation's video sits ~7 levels down
 * (content_block → content → creation_block → creations →
 * video), below the shared collector's depth, and carries the
 * finished file as download_url next to its vid; (2) the
 * shared collectMediaFromValue for the shallower shapes
 * (image blocks and the like). When a message carries a video,
 * its image items are the video's cover and are dropped — the
 * same rule the stream parser applies per block. */
function doubaoHistoryMedia(
  m: Record<string, unknown>,
): WebMediaItem[] {
  const found: WebMediaItem[] = [];
  const seen = new Set<string>();
  const push = (item: WebMediaItem): void => {
    if (seen.has(item.url) || found.length >= 8) return;
    seen.add(item.url);
    found.push(item);
  };
  const skipKeys = new Set(["regen_msg_list", "regen_messages", "suggest_questions", "suggest_questions_v2"]);
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const it of node) walk(it, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.vid === "string" && rec.vid) {
      const u = firstMediaUrlOf(rec);
      if (u) push({ kind: "video", url: u });
    }
    for (const [k, v] of Object.entries(rec)) {
      if (skipKeys.has(k)) continue;
      walk(v, depth + 1);
    }
  };
  walk(m, 0);
  for (const item of collectMediaFromValue(m)) push(item);
  if (found.some((x) => x.kind === "video"))
    return found.filter((x) => x.kind === "video");
  return found;
}

/** Whether a Doubao reply starts an async video generation:
 * the reply itself already carrying a video settles it (no
 * watch needed); otherwise either the reply announces a video
 * being generated / queued / delivered shortly, or the user
 * asked for a generated video and the reply talks about the
 * video without attaching it. */
function looksLikeVideoGenerationStart(
  userText: string,
  replyText: string,
  media: WebMediaItem[] | undefined,
): boolean {
  if (media?.some((m) => m.kind === "video")) return false;
  const reply = replyText ?? "";
  if (!reply.includes("视频")) return false;
  if (
    /(正在生成|生成中|开始生成|制作中|渲染中|生成好了|排队|稍后|预计|分钟)/.test(reply)
  )
    return true;
  const user = userText ?? "";
  return /(生成|做一个|做个|制作|创建|帮我).{0,10}视频|视频生成/.test(user);
}

/** Registers (or refreshes) the pending async-media watch for
 * one room + Doubao agent after a video-generation reply: the
 * baseline is a snapshot of the官网 conversation taken right
 * now — every message id currently there, plus whether its
 * newest assistant message (the announcement itself) already
 * carries media. Best effort throughout: a failed snapshot
 * still registers the watch, with an empty baseline the polls
 * then judge newness by message create_time instead. */
async function registerDoubaoPendingMedia(
  ctx: Ctx,
  db: Db,
  agent: AgentRow,
  conversationId: number,
  remoteConversationId: string,
): Promise<void> {
  try {
    const snap = await fetchDoubaoHistoryMessages(
      agent.webToken,
      agent.webDeviceId,
      remoteConversationId,
    );
    let baselineIds: string[] = [];
    let lastAssistantId = "";
    let lastAssistantMedia = false;
    if (snap.ok) {
      baselineIds = snap.messages
        .map((m) => (typeof m.message_id === "string" ? m.message_id : ""))
        .filter(Boolean)
        .slice(0, 50);
      const lastAssistant = snap.messages.find((m) => m.user_type === 2);
      if (lastAssistant) {
        lastAssistantId =
          typeof lastAssistant.message_id === "string"
            ? lastAssistant.message_id
            : "";
        lastAssistantMedia = doubaoHistoryMedia(lastAssistant).length > 0;
      }
    }
    const now = new Date();
    const existing = await db
      .select()
      .from(schema.doubaoPendingMedia)
      .where(
        and(
          eq(schema.doubaoPendingMedia.conversationId, conversationId),
          eq(schema.doubaoPendingMedia.agentId, agent.id),
          eq(schema.doubaoPendingMedia.status, "pending"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(schema.doubaoPendingMedia)
        .set({
          remoteConversationId,
          baselineIds: JSON.stringify(baselineIds),
          baselineLastAssistantId: lastAssistantId,
          baselineLastAssistantMedia: lastAssistantMedia ? 1 : 0,
          checks: 0,
          lastError: "",
          createdAt: now,
          updatedAt: now,
        })
        .where(eq(schema.doubaoPendingMedia.id, existing[0].id));
    } else {
      await db.insert(schema.doubaoPendingMedia).values({
        conversationId,
        agentId: agent.id,
        remoteConversationId,
        baselineIds: JSON.stringify(baselineIds),
        baselineLastAssistantId: lastAssistantId,
        baselineLastAssistantMedia: lastAssistantMedia ? 1 : 0,
      });
    }
    const convRows = await db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    const roomTitle = convRows[0]?.title ?? "";
    await insertDoubaoGuidanceLog(db, agent.id, {
      outcome: "collect_registered",
      httpStatus: null,
      responseBytes: 0,
      errorCode: null,
      errorMsg: "",
      hasVerify: false,
      hasShark: false,
      candidateCount: 0,
      payloadCount: snap.ok ? snap.messages.length : 0,
      summary:
        `房间「${roomTitle}」这条回复说视频正在生成，视频本身不在这条回复里（豆包是异步生成、稍后才把成品推送到同一个官网对话）。` +
        `已登记自动补收：空间每 15 分钟去这个官网对话查一次新消息，视频一到就下载存进这个房间，最长等 2 小时。` +
        (snap.ok
          ? `登记时官网对话里已有 ${snap.messages.length} 条消息，已记下作为基线，之后只收新推送的。`
          : `登记时的基线快照没读到（${snap.error}），轮询改按消息时间判断新旧。`),
    });
    void ctx;
  } catch {
    // registration is best effort — the reply itself already
    // succeeded and must not fail because a watch could not be
    // registered.
  }
}

/** One polling pass over the pending Doubao async-media
 * watches (at most five, oldest first), driven by
 * runDueTriggers on the space's 15-minute schedule. Each watch:
 * expired past 2 hours; otherwise its官网 conversation's
 * history is read once and the first NEW assistant message
 * carrying media is collected into the room. Every outcome is
 * recorded on the watch row (and, for collection / expiry, in
 * the agent's guidance log) — nothing fails silently, and a
 * failed check simply waits for the next pass. */
async function pollDoubaoPendingMedia(
  ctx: Ctx,
  db: Db,
): Promise<{ id: number; status: string; error: string | null }[]> {
  const results: { id: number; status: string; error: string | null }[] = [];
  let rows: DoubaoPendingRow[] = [];
  try {
    rows = await db
      .select()
      .from(schema.doubaoPendingMedia)
      .where(eq(schema.doubaoPendingMedia.status, "pending"))
      .orderBy(asc(schema.doubaoPendingMedia.createdAt))
      .limit(5);
  } catch {
    return results;
  }
  for (const row of rows) {
    const finish = async (
      status: string,
      error: string | null,
      patch?: Partial<DoubaoPendingRow>,
    ): Promise<void> => {
      try {
        await db
          .update(schema.doubaoPendingMedia)
          .set({
            ...(patch ?? {}),
            ...(status !== "pending" ? { status } : {}),
            lastError: error ?? "",
            updatedAt: new Date(),
          })
          .where(eq(schema.doubaoPendingMedia.id, row.id));
      } catch {
        // bookkeeping only
      }
      results.push({ id: row.id, status, error });
    };
    try {
      const convRows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, row.conversationId));
      const conv = convRows[0];
      if (!conv) {
        await db
          .delete(schema.doubaoPendingMedia)
          .where(eq(schema.doubaoPendingMedia.id, row.id));
        results.push({ id: row.id, status: "gone", error: "房间已被删除" });
        continue;
      }
      const agentRows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, row.agentId));
      const agent = agentRows[0];
      if (!agent) {
        await db
          .delete(schema.doubaoPendingMedia)
          .where(eq(schema.doubaoPendingMedia.id, row.id));
        results.push({ id: row.id, status: "gone", error: "智能体已被删除" });
        continue;
      }
      if (Date.now() - row.createdAt.getTime() > DOUBAO_PENDING_TTL_MS) {
        await finish("expired", "等待超过 2 小时，官网仍未推送可补收的媒体", {
          checks: row.checks + 1,
        });
        await insertDoubaoGuidanceLog(db, agent.id, {
          outcome: "collect_expired",
          httpStatus: null,
          responseBytes: 0,
          errorCode: null,
          errorMsg: "",
          hasVerify: false,
          hasShark: false,
          candidateCount: 0,
          payloadCount: row.checks + 1,
          summary: `房间「${conv.title}」登记的视频补收等了 2 小时（共检查 ${row.checks + 1} 次），官网对话里始终没有出现带媒体的新消息，已停止补收。可以在豆包官网打开这个对话确认视频是否生成成功；空间这边不会再自动收了。`,
        });
        continue;
      }
      if (!agent.webToken.trim()) {
        await finish("pending", "尚未保存豆包 Cookie，无法读取官网对话", {
          checks: row.checks + 1,
        });
        continue;
      }
      // The room's CURRENT官网 conversation wins over the id
      // stored at registration (a model switch or a failed
      // continuation may have replaced it since).
      const remote =
        (await loadWebRemote(db, "doubao", row.conversationId, agent.id))
          ?.remoteConversationId || row.remoteConversationId;
      const hist = await fetchDoubaoHistoryMessages(
        agent.webToken,
        agent.webDeviceId,
        remote,
      );
      if (!hist.ok) {
        await finish("pending", hist.error, { checks: row.checks + 1 });
        continue;
      }
      let baselineIds: string[] = [];
      try {
        const parsed: unknown = JSON.parse(row.baselineIds);
        if (Array.isArray(parsed))
          baselineIds = parsed.filter(
            (x): x is string => typeof x === "string",
          );
      } catch {
        baselineIds = [];
      }
      const baselineSet = new Set(baselineIds);
      const candidates = hist.messages
        .filter((m) => {
          if (m.user_type !== 2) return false;
          const mid = typeof m.message_id === "string" ? m.message_id : "";
          if (baselineSet.size > 0) {
            if (!baselineSet.has(mid)) return true;
            // The announcement message itself, if it has since
            // gained media in place.
            return (
              mid !== "" &&
              mid === row.baselineLastAssistantId &&
              row.baselineLastAssistantMedia !== 1
            );
          }
          // No baseline snapshot: only messages created after
          // the watch was registered count as new.
          const t = Number(m.create_time);
          if (!Number.isFinite(t) || t <= 0) return false;
          const ms = t > 1e12 ? t : t * 1000;
          return ms >= row.createdAt.getTime() - 2000;
        })
        .sort((a, b) => doubaoHistoryIndex(a) - doubaoHistoryIndex(b));
      let settled = false;
      for (const cand of candidates) {
        const media = doubaoHistoryMedia(cand);
        if (!media.length) continue;
        const withMedia = await attachReplyMedia(
          ctx,
          agent.name || "豆包",
          doubaoHistoryText(cand),
          media,
        );
        if (!withMedia.media?.length) {
          // The media is there on the site but its download
          // failed: keep the watch open so the next pass
          // retries with a fresh history read (fresh URLs).
          await finish(
            "pending",
            "已在官网对话找到新媒体，但下载失败，下一轮重试",
            { checks: row.checks + 1 },
          );
          settled = true;
          break;
        }
        await insertReplyRows(db, row.conversationId, {
          text: withMedia.text,
          agentId: agent.id,
          media: withMedia.media,
        });
        await touchConversation(db, row.conversationId);
        await finish("collected", null, { checks: row.checks + 1 });
        const kinds = withMedia.media.map((x) =>
          x.fileMime.startsWith("video/")
            ? "视频"
            : x.fileMime.startsWith("image/")
              ? "图片"
              : x.fileMime.startsWith("audio/")
                ? "音频"
                : "文件",
        );
        await insertDoubaoGuidanceLog(db, agent.id, {
          outcome: "collected",
          httpStatus: null,
          responseBytes: 0,
          errorCode: null,
          errorMsg: "",
          hasVerify: false,
          hasShark: false,
          candidateCount: candidates.length,
          payloadCount: hist.messages.length,
          summary: `房间「${conv.title}」：豆包后来推送到官网对话的${kinds.join("、")}已下载存进这个房间（登记后第 ${row.checks + 1} 次检查收到）。`,
        });
        settled = true;
        break;
      }
      if (!settled)
        await finish("pending", null, { checks: row.checks + 1 });
    } catch (e) {
      await finish(
        "pending",
        e instanceof Error ? e.message : "补收检查出错",
        { checks: row.checks + 1 },
      );
    }
  }
  return results;
}

type ReplyOutcome =
  | {
      status: "ok";
      text: string;
      agentId: number | null;
      media?: StoredReplyMedia[];
    }
  | { status: "silent"; error: string }
  | { status: "error"; error: string };

/** Produces the reply for one conversation: Muse via the platform
 * channel, an added agent via its own provider API. A disabled or
 * unconfigured agent is "silent" — no reply is fabricated for it. */
async function produceReply(
  ctx: Ctx,
  db: Db,
  agentId: number | null,
  // The conversation the reply belongs to. Replies are produced
  // per conversation and may run concurrently across rooms; for
  // Doubao it also keys the real-browser relay's per-room
  // browser profile (conv-<id>).
  conversationId: number,
  history: MessageRow[],
  // The picture on the turn being answered, when it carries one:
  // every speaker receives it through its own image channel
  // (Muse vision, API image part, the site's own upload) —
  // never as a text placeholder. See ChatImage.
  chatImage: ChatImage | null,
  nameOf?: NameOf,
  onPartial?: (partial: string) => void | Promise<void>,
  // The room's stage-owner note for THIS speaker (see
  // produceGroupReplies): empty when no owner is in force.
  stageContext = "",
): Promise<ReplyOutcome> {
  // The files the user has granted agents access to (per-file
  // switches in the files column) ride along with every reply, and
  // any file-edit blocks in the reply are applied before it is
  // stored or shown.
  const filesContext = await buildAgentFilesContext(ctx, db);
  // The global custom instructions ride along with every reply too,
  // for Muse and for added agents alike. So do the enabled skills
  // that apply to this agent (技能 page of the space settings): they
  // are appended to the same instruction channel, after the global
  // custom instructions.
  const globalOnly = await loadCustomInstructions(db);
  const skillsContext = await loadSkillsContext(db, agentId);
  const globalInstructions = [globalOnly, skillsContext]
    .filter((s) => s.trim())
    .join("\n\n");
  if (agentId == null) {
    const muse = await loadMuseSettings(db);
    if (muse.enabled !== 1) {
      return {
        status: "silent",
        error: `${muse.name.trim() || "Muse"}已停用，不会回复`,
      };
    }
    try {
      const raw = await generateReply(
        ctx,
        history,
        chatImage,
        nameOf,
        filesContext,
        globalInstructions,
        stageContext,
        buildHostPermissionContext(hostPermsOf(muse), true),
      );
      const applied = await applyFileEdits(ctx, db, raw);
      const hosted = await applyHostActions(ctx, applied.text, hostPermsOf(muse));
      return { status: "ok", text: hosted, agentId: null };
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : "Muse 回复失败，请重试",
      };
    }
  }
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  const agent = rows[0];
  if (!agent) return { status: "silent", error: "该智能体已被删除，不会回复" };
  const label = agent.name || "该智能体";
  if (agent.enabled !== 1)
    return { status: "silent", error: `${label}已停用，不会回复` };
  if (agent.connectionType === "web") {
    // Web-token agent (any site): no token → silent (nobody home);
    // a token already known dead → an honest error naming the fix;
    // anything else goes through the site's real web call, which
    // reports the site's real result. DeepSeek keeps its own path
    // (per-reply validation + per-room官网 conversation reuse);
    // every other site
    // dispatches through WEB_CHATTERS by provider id.
    if (agent.webToken.trim() === "")
      return {
        status: "silent",
        error: `${label}尚未登录网页版（未粘贴令牌），保持沉默`,
      };
    if (agent.webStatus === "expired")
      return {
        status: "error",
        error: `${label}的网页令牌已过期，请在它的设置里重新粘贴新令牌并验证登录`,
      };
    // Image-turn gate: this turn carries a picture, and only the
    // sites in WEB_IMAGE_PROVIDERS (plus DeepSeek's own vision
    // path) can receive one through their own upload channel.
    // Doubao is NOT exempted: its token channel is text-only and
    // its web version cannot open external links, so the
    // public-image-host relay that briefly carried its pictures
    // was removed at the user's direction (2026-11-21). For
    // every site without a real image channel the turn is
    // refused HERE with the real reason — the picture is never
    // flattened into a text placeholder and sent as if the
    // agent had seen it.
    if (
      chatImage &&
      agent.provider !== "deepseek" &&
      !WEB_IMAGE_PROVIDERS.has(agent.provider)
    )
      return { status: "error", error: webImageGateError(label, agent.provider) };
    // Account-collision gate (see recordWebIdentity), judged
    // LIVE (revised 2026-11-21 at the user's direction — never
    // block on a stored record alone): a stored collision only
    // triggers a fresh re-validation of every involved
    // credential against the site, right now, each with its own
    // credential (resolveCollisionLive). The send is refused
    // ONLY when that live check confirms the credentials
    // currently resolve to the same account; when the live
    // check shows different accounts the fresh identities are
    // recorded (which clears the stored collision everywhere)
    // and the send proceeds, and when the live check cannot
    // judge (network failure, no identity reported, a dead
    // credential) it does not count as a collision either — the
    // send proceeds and surfaces the site's real answer.
    // Agents whose identity was never recorded never collide
    // here.
    const collisions = await findWebIdentityCollisions(db, agent);
    if (collisions.length) {
      const verdict = await resolveCollisionLive(db, agent, collisions);
      if (verdict === "confirmed") {
        return {
          status: "error",
          error:
            `本次没有发送（发送前刚向官网实时复核过）。` +
            webIdentityCollisionWarning(
              webSiteLabel(agent.provider),
              maskWebAccount(agent.webAccount),
              collisions,
            ),
        };
      }
    }
    // Web agents have no function-calling channel: their host
    // permissions ride the block protocol — the instructions join
    // the reply context here, and applyHostActions executes any
    // blocks the reply carries, for real, below.
    const hostBlockCtx = buildHostPermissionContext(hostPermsOf(agent), true);
    const webContext = hostBlockCtx
      ? filesContext
        ? `${filesContext}\n\n${hostBlockCtx}`
        : hostBlockCtx
      : filesContext;
    const chatter = WEB_CHATTERS[agent.provider];
    if (agent.provider === "deepseek" || !chatter) {
      const wr = await callDeepseekWeb(
        ctx,
        db,
        conversationId,
        agent,
        history,
        nameOf,
        webContext,
        globalInstructions,
        stageContext,
        chatImage,
      );
      if (!wr.ok) return { status: "error", error: wr.error };
      const appliedWeb = await applyFileEdits(ctx, db, wr.text);
      const hostedWeb = await applyHostActions(
        ctx,
        appliedWeb.text,
        hostPermsOf(agent),
      );
      return { status: "ok", text: hostedWeb, agentId: agent.id };
    }
    const prompt = buildWebPrompt(
      agent,
      history,
      nameOf,
      webContext,
      globalInstructions,
      stageContext,
    );
    // Doubao sends through the token-only direct route
    // (chatDoubao) — the real-browser relay was removed at the
    // user's explicit direction (「豆包不要真实网页代发」), so
    // this direct route is the ONLY Doubao route now. Every
    // other site dispatches through WEB_CHATTERS as before.
    let sr: WebChatResult & {
      remote?: DoubaoRemoteState;
      reusedFailed?: boolean;
      sentRecordJson?: string;
      guidanceLog?: DoubaoGuidanceLogEntry;
      webTabId?: string;
    };
    if (agent.provider === "doubao") {
      // Per-room官网 conversation reuse: this room's stored
      // Doubao conversation is continued with only the new turns
      // (delta prompt) — no new conversation on the site, no
      // re-sending the whole history. Only when continuing fails
      // (the stored conversation expired, got rate-limited or is
      // stuck) is the mapping dropped and the reply retried once
      // with a fresh conversation and the full prompt; the fresh
      // conversation's id then replaces the mapping. Different
      // rooms hold different mappings and never share one.
      const remote = await loadWebRemote(db, "doubao", conversationId, agent.id);
      // No image relay here: an image turn for Doubao never
      // reaches this branch — the image-turn gate above refuses
      // it, because Doubao's token channel is text-only and its
      // web version cannot open external links (the public-host
      // relay was removed at the user's direction, 2026-11-21).
      const doubaoOpts = {
        menu: doubaoMenuOf(agent),
        modelKey: doubaoSelectedKey(agent),
        reasoning: agent.webReasoning,
        search: agent.webSearch === 1,
        // The send-time account assertion's recorded side (see
        // buildDoubaoSendPlan): the identity this agent was
        // verified as. '' = never recorded (pre-guard agent) —
        // no assertion until a verification records one.
        expectedIdentityHash: agent.webIdentityHash,
      };
      // Every Doubao send lands one guidance-log row (see
      // doubao_send_logs): the caller persists each chatDoubao
      // call's entry as it completes — including the fresh retry
      // below, which is a second send with its own entry.
      const persistDoubaoSend = async (
        result: WebChatResult & {
          sentRecordJson?: string;
          guidanceLog?: DoubaoGuidanceLogEntry;
        },
      ): Promise<void> => {
        // The send's full record (exactly what was sent, per
        // attempt, and what the site answered) is kept on the
        // agent row for the settings panel's 发送数据诊断 —
        // best effort, never allowed to fail the reply itself.
        if (result.sentRecordJson) {
          try {
            await db
              .update(schema.agents)
              .set({ webLastSendJson: result.sentRecordJson })
              .where(eq(schema.agents.id, agent.id));
          } catch {
            // diagnostics only
          }
        }
        if (result.guidanceLog)
          await insertDoubaoGuidanceLog(db, agent.id, result.guidanceLog);
      };
      sr = await chatDoubao(
        agent.webToken.trim(),
        remote
          ? buildWebDeltaPrompt(agent, history, nameOf, webContext, globalInstructions, stageContext)
          : prompt,
        agent.webDeviceId,
        { ...doubaoOpts, session: remote },
      );
      await persistDoubaoSend(sr);
      if (!sr.ok && remote && sr.reusedFailed) {
        await clearWebRemote(db, conversationId, agent.id);
        sr = await chatDoubao(agent.webToken.trim(), prompt, agent.webDeviceId, {
          ...doubaoOpts,
          session: null,
        });
        await persistDoubaoSend(sr);
      }
      if (sr.ok && sr.remote) {
        await saveWebRemote(db, "doubao", conversationId, agent.id, sr.remote);
      }
      if (sr.ok) {
        // Async video: the reply may only ANNOUNCE a video
        // generation — the finished video is pushed into the
        // same官网 conversation later as a new message this
        // stream never sees. Register the pending watch that
        // runDueTriggers polls (see pollDoubaoPendingMedia).
        const remoteId =
          sr.remote?.remoteConversationId ?? remote?.remoteConversationId ?? "";
        const lastUser = [...history]
          .reverse()
          .find((r) => r.role === "user");
        if (
          remoteId &&
          looksLikeVideoGenerationStart(lastUser?.content ?? "", sr.text, sr.media)
        ) {
          await registerDoubaoPendingMedia(
            ctx,
            db,
            agent,
            conversationId,
            remoteId,
          );
        }
      }
    } else if (agent.provider === "qwen") {
      // 千问 sends its full aligned credential set — Bearer
      // token + the captured Cookie + the captured browser UA —
      // not the bare token (see the 千问 adapter comment).
      sr = await chatQwen(agent.webToken.trim(), prompt, {
        cookie: agent.webCookie,
        ua: agent.webUserAgent,
      });
    } else {
      // The picture (when this turn carries one and the site is
      // image-capable — the gate above has already refused the
      // rest) rides as the chatter's fifth argument; each
      // adapter uploads it through its site's own flow.
      sr = await chatter(
        agent.webToken.trim(),
        prompt,
        agent.webDeviceId,
        undefined,
        chatImage,
      );
    }
    if (!sr.ok) {
      if (sr.kind !== "error")
        await dsMarkWebStatus(ctx, agent.id, sr.kind, sr.error);
      return { status: "error", error: sr.error };
    }
    await dsMarkWebOk(ctx, agent.id);
    // A refreshed credential the site handed back with the reply
    // (Gemini's rotated __Secure-1PSIDTS, folded into the stored
    // token's paste shape) replaces the stored token, so the
    // login survives the rotation instead of decaying into a
    // false "expired" before the next reply.
    if (sr.refreshedToken && sr.refreshedToken !== agent.webToken) {
      try {
        await db
          .update(schema.agents)
          .set({ webToken: sr.refreshedToken })
          .where(eq(schema.agents.id, agent.id));
      } catch {
        // best effort — the next verify re-derives the rotation
      }
    }
    const appliedSite = await applyFileEdits(ctx, db, sr.text);
    const hostedSite = await applyHostActions(
      ctx,
      appliedSite.text,
      hostPermsOf(agent),
    );
    // Generated media the reply carried (any site's pictures,
    // videos, audio or files): download the bytes into the
    // space's own storage now, while the site's signed URLs are
    // fresh, so the reply's message rows can carry them as real
    // attachments.
    const withMedia = await attachReplyMedia(
      ctx,
      label,
      hostedSite,
      sr.media,
    );
    return {
      status: "ok",
      text: withMedia.text,
      agentId: agent.id,
      media: withMedia.media,
    };
  }
  if (!isAgentConfigured(agent))
    return {
      status: "silent",
      error: `${label}尚未配置好 API（地址、Key 或模型不完整），保持沉默`,
    };
  const r = await callExternalAgent(
    ctx,
    agent,
    history,
    nameOf,
    filesContext,
    globalInstructions,
    onPartial,
    stageContext,
    chatImage,
  );
  if (!r.ok) return { status: "error", error: r.error };
  const applied = await applyFileEdits(ctx, db, r.text);
  // An API model that answers with host blocks instead of tool
  // calls gets the same real execution as the block route.
  const hostedApi = await applyHostActions(ctx, applied.text, hostPermsOf(agent));
  // Media a multimodal API model generated in its reply (image
  // parts, an audio payload, a file) is stored exactly like web
  // replies' media, so it lands as real message attachments.
  const withMedia = await attachReplyMedia(ctx, label, hostedApi, r.media);
  return {
    status: "ok",
    text: withMedia.text,
    agentId: agent.id,
    media: withMedia.media,
  };
}

/* ---------------- group membership ---------------- */

/** The agent members of one group: whether Muse is in, plus the
 * added agents' ids in the order they were added, and each member's
 * per-group enabled switch. The user is always a member and is not
 * represented here. */
async function loadGroupMembers(
  db: Db,
  conversationId: number,
): Promise<{
  muse: boolean;
  museEnabled: boolean;
  agentIds: number[];
  disabledAgentIds: number[];
}> {
  const rows = await db
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.conversationId, conversationId))
    .orderBy(asc(schema.groupMembers.id));
  const museRow = rows.find((r) => r.agentId == null);
  return {
    muse: museRow != null,
    museEnabled: museRow ? museRow.enabled === 1 : false,
    agentIds: rows
      .map((r) => r.agentId)
      .filter((x): x is number => x != null),
    disabledAgentIds: rows
      .filter((r) => r.agentId != null && r.enabled !== 1)
      .map((r) => r.agentId)
      .filter((x): x is number => x != null),
  };
}

const groupMembersOut = z.object({
  museMember: z.boolean(),
  agentIds: z.array(z.number()),
  museEnabled: z.boolean(),
  disabledAgentIds: z.array(z.number()),
});

function toGroupMembersOut(m: {
  muse: boolean;
  museEnabled: boolean;
  agentIds: number[];
  disabledAgentIds: number[];
}): z.infer<typeof groupMembersOut> {
  return {
    museMember: m.muse,
    agentIds: m.agentIds,
    museEnabled: m.museEnabled,
    disabledAgentIds: m.disabledAgentIds,
  };
}

type GroupReplyResult =
  | { status: "ok"; rows: MessageRow[] }
  | { status: "silent"; error: string }
  | { status: "error"; error: string };

/**
 * Produces the replies for one user message in a group chat: every
 * agent member answers in turn (Muse first, then the added agents
 * in join order), each seeing the replies already given in this
 * round. A group with no agent members stays silent — nobody is in
 * it to reply. Members that are disabled or unconfigured are skipped
 * silently; if nobody manages a reply, the first real error (or the
 * silence reason) is reported.
 */
async function produceGroupReplies(
  ctx: Ctx,
  db: Db,
  conversationId: number,
  chatImage: ChatImage | null,
): Promise<GroupReplyResult> {
  const members = await loadGroupMembers(db, conversationId);
  const targets: (number | null)[] = [];
  if (members.muse && members.museEnabled) targets.push(null);
  for (const id of members.agentIds) {
    if (!members.disabledAgentIds.includes(id)) targets.push(id);
  }
  if (targets.length === 0) {
    const hasMembers = members.muse || members.agentIds.length > 0;
    return {
      status: "silent",
      error: hasMembers
        ? "群里的智能体成员都已被关掉，不会回复。把聊天框顶部某个智能体的开关打开即可恢复。"
        : "这里目前只有你，还没有智能体成员，不会收到回复。点聊天框顶部成员行末尾的「添加智能体」把智能体加进来吧。",
    };
  }
  const nameOf = await loadNameOf(db);
  // The room's stage owner （阶段负责人）, when one is designated
  // AND is among this round's speakers: the owner leads the
  // stage, so it speaks first, and every speaker's context names
  // the arrangement — the owner is told to coordinate and wrap
  // up, the others to cover their own part without duplicating
  // the coordination. An owner who is not an enabled member of
  // this room has no effect.
  const convRows = await db
    .select({ stageOwner: schema.conversations.stageOwner })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  const ownerKey = (convRows[0]?.stageOwner ?? "").trim();
  const ownerTarget: number | null | undefined =
    ownerKey === ""
      ? undefined
      : ownerKey === "muse"
        ? null
        : (/^\d+$/.test(ownerKey) ? Number(ownerKey) : undefined);
  const ownerActive =
    ownerTarget !== undefined &&
    targets.some((t) => t === ownerTarget);
  if (ownerActive) {
    targets.sort((a, b) =>
      a === ownerTarget ? -1 : b === ownerTarget ? 1 : 0,
    );
  }
  const ownerName = ownerActive ? nameOf(ownerTarget ?? null) : "";
  const stageContextFor = (target: number | null): string => {
    if (!ownerActive) return "";
    if (target === ownerTarget)
      return `【阶段负责人】你是这个房间当前阶段的负责人。这一轮由你先发言：先回应用户，明确这一阶段的目标和分工，并给出你负责的那一部分；其他成员会接着补充各自的部分，不要替他们把话说完。`;
    return `【阶段负责人】这个房间当前阶段的负责人是「${ownerName}」。这一轮负责人会先发言统筹；你负责自己擅长的部分，配合负责人，不要和负责人重复统筹。`;
  };
  const rows: MessageRow[] = [];
  const errors: string[] = [];
  const silents: string[] = [];
  for (const target of targets) {
    const history = await loadHistory(db, conversationId);
    // A streaming API agent writes its reply into a placeholder
    // row chunk by chunk (the sink); on success that row becomes
    // the reply, on failure/silence it is removed again. For
    // non-streaming members the sink never fires and the reply
    // is inserted whole, exactly as before.
    const sink = createStreamSink(db, conversationId, target);
    const outcome = await produceReply(
      ctx,
      db,
      target,
      conversationId,
      history,
      // EVERY member receives the turn's picture through its
      // own image channel — not only Muse. A member whose
      // channel cannot take a picture answers with the honest
      // gate error while the others still reply.
      chatImage,
      nameOf,
      sink.onPartial,
      stageContextFor(target),
    );
    if (outcome.status === "ok") {
      const streamed = await sink.complete(outcome.text);
      if (streamed) {
        rows.push(streamed);
        // The streamed row carries the text; the reply's media
        // rows still have to be inserted behind it.
        if (outcome.media?.length)
          rows.push(
            ...(await insertReplyRows(db, conversationId, {
              text: "",
              agentId: target,
              media: outcome.media,
            })),
          );
        continue;
      }
      rows.push(...(await insertReplyRows(db, conversationId, outcome)));
    } else if (outcome.status === "error") {
      await sink.discard();
      errors.push(outcome.error);
    } else {
      await sink.discard();
      silents.push(outcome.error);
    }
  }
  if (rows.length > 0) return { status: "ok", rows };
  if (errors.length > 0)
    return { status: "error", error: errors[0] ?? "回复失败，请重试" };
  return {
    status: "silent",
    error: silents[0] ?? "群成员都没有回复",
  };
}

/* ---------------- user profile ---------------- */

// The user's own name as recorded for them; the profile row is
// created lazily with it so 「我」 shows their name from first open.
const DEFAULT_PROFILE_NAME = "智成肖";

// ---------------- monitoring engine ----------------
// Every checker reads its REAL source through the privileged
// web fetch (product page, Stooq / Eastmoney quote endpoints,
// public FX & crypto APIs, GitHub / App Store version APIs, the
// watched page itself, or a Bing results page for the research
// types) and — where the source is unstructured HTML — extracts
// the value with the platform inference channel. A checker that
// cannot establish a value returns status 'not_found' or
// 'error' with the real reason; nothing is ever estimated.

type MonitorRow = typeof schema.monitors.$inferSelect;

interface CheckOutcome {
  status: "ok" | "not_found" | "error";
  valueNum: number | null;
  valueText: string;
  source: string;
  detail: string;
}

function parseMonitorConfig(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function configNum(
  config: Record<string, unknown>,
  key: string,
): number | null {
  const v = config[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchPageRaw(
  ctx: Ctx,
  url: string,
  maxBytes = 3145728,
  charset = "utf-8",
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
  error: string;
}> {
  const r = await ctx.executePrivileged(privileged.fetchWebPage, {
    url,
    maxBytes,
    timeoutMs: 25000,
    method: "GET",
    body: "",
    bodyBase64: "",
    contentType: "",
    headers: [],
    cookies: [],
    userAgent: "",
    secChUaMobile: "",
    secChUaPlatform: "",
    ignoreCertErrors: false,
  });
  if (r.status === 0 && !r.bodyBase64) {
    return {
      ok: false,
      status: 0,
      text: "",
      finalUrl: url,
      error: r.error || "网络请求失败",
    };
  }
  let text = "";
  try {
    const bin = atob(r.bodyBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    text = new TextDecoder(charset as "utf-8").decode(bytes);
  } catch {
    text = "";
  }
  return {
    ok: r.ok,
    status: r.status,
    text,
    finalUrl: r.finalUrl || url,
    error: r.error,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function fnvHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

async function checkProduct(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const page = await fetchPageRaw(ctx, monitor.target);
  if (!page.ok) {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: hostOf(monitor.target),
      detail: page.error || `HTTP ${page.status}`,
    };
  }
  const text = stripHtml(page.text).slice(0, 14000);
  const r = await ctx.inference.complete(
    `下面是商品页面「${monitor.target}」的文本。请提取该商品当前的售价。若页面里找不到明确的售价（例如需要登录、页面为空、只有列表价区间无法确定），found 填 false，绝不猜测价格。\n\n${text}`,
    {
      schema: z.object({
        found: z.boolean(),
        price: z.number().nullable(),
        currency: z.string(),
        title: z.string(),
        inStock: z.boolean().nullable(),
      }),
      timeout_secs: 60,
    },
  );
  if (!r.found || r.price == null) {
    return {
      status: "not_found",
      valueNum: null,
      valueText: "",
      source: hostOf(monitor.target),
      detail: "页面已打开，但没有从页面中确认到明确售价",
    };
  }
  return {
    status: "ok",
    valueNum: r.price,
    valueText: `${r.currency || "¥"} ${r.price}${r.title ? ` · ${r.title}` : ""}`,
    source: hostOf(monitor.target),
    detail:
      r.inStock === null
        ? ""
        : r.inStock
          ? "页面显示有货"
          : "页面显示缺货/下架",
  };
}

async function checkStock(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const symbol = monitor.target.trim();
  const isCn = /^\d{6}$/.test(symbol);
  const cnPrefix = /^[569]/.test(symbol) ? "sh" : /^[48]/.test(symbol) ? "bj" : "sz";
  // Primary: Tencent's quote endpoint (qt.gtimg.cn), verified
  // reachable from this server for both A-shares and US tickers.
  // One GBK line, tilde-separated: 1 = name, 3 = latest price,
  // 4 = previous close, 32 = change %.
  const tencentSymbol = isCn
    ? `${cnPrefix}${symbol}`
    : `us${symbol.toUpperCase().replace(/\..*$/, "")}`;
  const page = await fetchPageRaw(
    ctx,
    `https://qt.gtimg.cn/q=${tencentSymbol}`,
    65536,
    "gbk",
  );
  const line = /="([^"]*)"/.exec(page.text)?.[1] ?? "";
  const fields = line.split("~");
  const price = Number(fields[3]);
  if (fields.length > 30 && Number.isFinite(price) && price > 0) {
    const pct = Number(fields[32]);
    const name = fields[1] || symbol;
    const cur = isCn ? "¥" : "$";
    return {
      status: "ok",
      valueNum: price,
      valueText: `${name} ${cur}${price.toFixed(2)}${Number.isFinite(pct) ? `（${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%）` : ""}`,
      source: "腾讯行情",
      detail: Number.isFinite(pct) ? `changePct:${pct}` : "",
    };
  }
  // Fallback: Yahoo Finance's chart API meta block.
  const yahooSymbol = isCn
    ? `${symbol}.${cnPrefix === "sh" ? "SS" : "SZ"}`
    : symbol.toUpperCase();
  const y = await fetchPageRaw(
    ctx,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
    65536,
  );
  try {
    const data = JSON.parse(y.text) as {
      chart?: {
        result?: {
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
            longName?: string;
            shortName?: string;
          };
        }[];
      };
    };
    const meta = data.chart?.result?.[0]?.meta;
    const yp = meta?.regularMarketPrice;
    if (meta && typeof yp === "number" && yp > 0) {
      const prev = meta.chartPreviousClose ?? meta.previousClose;
      const pct =
        typeof prev === "number" && prev > 0
          ? ((yp - prev) / prev) * 100
          : null;
      const name = meta.longName ?? meta.shortName ?? symbol;
      const cur =
        meta.currency === "CNY" ? "¥" : meta.currency === "USD" ? "$" : "";
      return {
        status: "ok",
        valueNum: yp,
        valueText: `${name} ${cur}${yp.toFixed(2)}${pct !== null ? `（${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%）` : ""}${meta.currency && !cur ? ` ${meta.currency}` : ""}`,
        source: "Yahoo Finance",
        detail: pct !== null ? `changePct:${pct}` : "",
      };
    }
  } catch {
    // fall through to the honest not-found below
  }
  return {
    status: "not_found",
    valueNum: null,
    valueText: "",
    source: "腾讯行情 / Yahoo Finance",
    detail: `没有查到 ${symbol} 的行情（请确认代码：A 股填 6 位数字，美股填 AAPL 这类代码）`,
  };
}

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  XRP: "ripple",
  ADA: "cardano",
  USDT: "tether",
  BNB: "binancecoin",
  LTC: "litecoin",
  DOT: "polkadot",
  TRX: "tron",
  LINK: "chainlink",
};

async function checkRate(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const parts = monitor.target.toUpperCase().split(/[\/\s]+/).filter(Boolean);
  const base = parts[0] ?? "";
  const quote = parts[1] ?? "USD";
  const config = parseMonitorConfig(monitor.configJson);
  const pairKind =
    config.pairKind === "crypto" || CRYPTO_IDS[base] ? "crypto" : "fx";
  if (pairKind === "crypto") {
    const id = CRYPTO_IDS[base];
    if (!id) {
      return {
        status: "not_found",
        valueNum: null,
        valueText: "",
        source: "CoinGecko",
        detail: `暂不支持币种 ${base}（支持 BTC/ETH/SOL/DOGE/XRP/ADA/USDT/BNB/LTC/DOT/TRX/LINK）`,
      };
    }
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${quote.toLowerCase()}`;
    const page = await fetchPageRaw(ctx, url, 65536);
    try {
      const data = JSON.parse(page.text) as Record<
        string,
        Record<string, number>
      >;
      const price = data[id]?.[quote.toLowerCase()];
      if (typeof price !== "number") {
        return {
          status: "not_found",
          valueNum: null,
          valueText: "",
          source: "CoinGecko",
          detail: `没有查到 ${base}/${quote} 的价格`,
        };
      }
      return {
        status: "ok",
        valueNum: price,
        valueText: `${base}/${quote} ${price}`,
        source: "CoinGecko",
        detail: "",
      };
    } catch {
      return {
        status: "error",
        valueNum: null,
        valueText: "",
        source: "CoinGecko",
        detail: page.error || "价格数据解析失败",
      };
    }
  }
  const url = `https://api.exchangerate-api.com/v4/latest/${encodeURIComponent(base)}`;
  const page = await fetchPageRaw(ctx, url, 131072);
  try {
    const data = JSON.parse(page.text) as {
      rates?: Record<string, number>;
      date?: string;
    };
    const rate = data.rates?.[quote];
    if (typeof rate !== "number") {
      return {
        status: "not_found",
        valueNum: null,
        valueText: "",
        source: "ExchangeRate API",
        detail: `没有查到 ${base}/${quote} 的汇率（请确认币种代码）`,
      };
    }
    return {
      status: "ok",
      valueNum: rate,
      valueText: `${base}/${quote} ${rate}`,
      source: "ExchangeRate API",
      detail: data.date ? `汇率日期 ${data.date}` : "",
    };
  } catch {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "ExchangeRate API",
      detail: page.error || "汇率数据解析失败",
    };
  }
}

async function checkWebChange(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const page = await fetchPageRaw(ctx, monitor.target);
  if (!page.ok) {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: hostOf(monitor.target),
      detail: page.error || `HTTP ${page.status}`,
    };
  }
  const text = stripHtml(page.text);
  const hash = fnvHash(text);
  const config = parseMonitorConfig(monitor.configJson);
  const keyword =
    typeof config.keyword === "string" ? config.keyword.trim() : "";
  const keywordFound = keyword ? text.includes(keyword) : null;
  return {
    status: "ok",
    valueNum: null,
    valueText: keyword
      ? keywordFound
        ? `关键词「${keyword}」已出现 · 指纹 ${hash}`
        : `未出现关键词「${keyword}」 · 指纹 ${hash}`
      : `内容指纹 ${hash}`,
    source: hostOf(monitor.target),
    detail: `hash:${hash}${keyword ? ` kw:${keywordFound ? 1 : 0}` : ""}`,
  };
}

async function checkAppVersion(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const target = monitor.target.trim();
  if (target.includes("/")) {
    const url = `https://api.github.com/repos/${target}/releases/latest`;
    const page = await fetchPageRaw(ctx, url, 262144);
    try {
      const data = JSON.parse(page.text) as {
        tag_name?: string;
        name?: string;
        published_at?: string;
      };
      const version = data.tag_name || data.name || "";
      if (!version) {
        return {
          status: "not_found",
          valueNum: null,
          valueText: "",
          source: "GitHub",
          detail: `仓库 ${target} 没有查到正式发布版本`,
        };
      }
      return {
        status: "ok",
        valueNum: null,
        valueText: `${target} 最新版 ${version}`,
        source: "GitHub Releases",
        detail: data.published_at ? `发布于 ${data.published_at.slice(0, 10)}` : "",
      };
    } catch {
      return {
        status: "error",
        valueNum: null,
        valueText: "",
        source: "GitHub",
        detail: page.error || "版本数据解析失败",
      };
    }
  }
  const lookup = /^\d+$/.test(target)
    ? `id=${target}`
    : `bundleId=${encodeURIComponent(target)}`;
  const url = `https://itunes.apple.com/lookup?${lookup}&country=cn`;
  const page = await fetchPageRaw(ctx, url, 262144);
  try {
    const data = JSON.parse(page.text) as {
      results?: {
        version?: string;
        trackName?: string;
        currentVersionReleaseDate?: string;
      }[];
    };
    const app = data.results?.[0];
    if (!app?.version) {
      return {
        status: "not_found",
        valueNum: null,
        valueText: "",
        source: "App Store",
        detail: `没有查到应用 ${target}（请填 App Store 数字 ID 或 bundleId）`,
      };
    }
    return {
      status: "ok",
      valueNum: null,
      valueText: `${app.trackName ?? target} 最新版 ${app.version}`,
      source: "App Store",
      detail: app.currentVersionReleaseDate
        ? `发布于 ${app.currentVersionReleaseDate.slice(0, 10)}`
        : "",
    };
  } catch {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "App Store",
      detail: page.error || "版本数据解析失败",
    };
  }
}

async function checkResearch(
  ctx: Ctx,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const queryByType: Record<string, string> = {
    ticket: `${monitor.target} 门票 售票 有票`,
    travel: `${monitor.target} 价格`,
    social: `${monitor.target} 最新动态 更新`,
  };
  const query = queryByType[monitor.type];
  if (!query) {
    // A monitor whose type has been retired (the 红果短剧
    // "drama" type went away with that feature) records an
    // honest offline result instead of being silently checked
    // as some other kind of monitor.
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "监控中心",
      detail: "这种监控类型已下线，不再检查",
    };
  }
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const page = await fetchPageRaw(ctx, searchUrl);
  if (!page.ok || !page.text) {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "必应搜索",
      detail: page.error || "搜索页面打开失败",
    };
  }
  const text = stripHtml(page.text).slice(0, 14000);
  const askByType: Record<string, string> = {
    ticket:
      "请只根据搜索结果判断这个演出/景点/活动现在是否能买到票。只有结果里明确显示在售/有票/可预订才算 available=true，明确售罄/无票填 false，无法判断填 null。latestInfo 用一句话写清依据（如「大麦显示在售，票价 380 元起」）；没有任何可靠信息时 found=false，绝不编造。",
    travel:
      "请只根据搜索结果提取这个航班/酒店的当前最低价格。只有结果里明确写了价格才填 price（数字，元）并在 latestInfo 里写清是哪家/哪程的价格；没有明确价格时 found=false，绝不编造价格。",
    social:
      "请只根据搜索结果判断这个社交账号的最新动态：最近一次更新/发帖是什么时间、内容大致是什么。只有结果里明确有该账号的动态才算查到，latestInfo 用一句话写清（如「11 月 20 日发布了新视频」）；没有明确信息时 found=false，绝不编造动态。",
  };
  const r = await ctx.inference.complete(
    `${askByType[monitor.type] ?? askByType.social}\n\n监控目标：「${monitor.target}」\n\n搜索结果文本：\n${text}`,
    {
      schema: z.object({
        found: z.boolean(),
        latestInfo: z.string(),
        price: z.number().nullable(),
        available: z.boolean().nullable(),
      }),
      timeout_secs: 60,
    },
  );
  if (!r.found || !r.latestInfo.trim()) {
    return {
      status: "not_found",
      valueNum: null,
      valueText: "",
      source: "必应搜索",
      detail: "搜索结果里没有查到明确的最新信息",
    };
  }
  return {
    status: "ok",
    valueNum: monitor.type === "travel" ? r.price : null,
    valueText: r.latestInfo.trim(),
    source: "必应搜索",
    detail:
      monitor.type === "ticket"
        ? `avail:${r.available === null ? "?" : r.available ? 1 : 0}`
        : "",
  };
}

/**
 * A check delegated to a user-designated in-space agent.
 * Muse (the model) sends the agent the monitor's conditions
 * as one self-contained brief; the agent queries on its own
 * and its reply comes back HERE — it is never written into any
 * chat room and never reaches the user directly. Muse then
 * reads the reply and distills it into the check outcome, so
 * what the user sees (the recorded value, the alerts) is
 * always Muse's summary of the agent's report.
 */
async function checkViaAgent(
  ctx: Ctx,
  db: Db,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, monitor.agentId ?? 0));
  const agent = agentRows[0];
  if (!agent) {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "指定智能体",
      detail: "指定的智能体已被删除，无法执行这次检查；请在监控编辑里改回 Muse 执行或换一个智能体",
    };
  }
  const label = agent.name || "智能体";
  const typeLabels: Record<string, string> = {
    product: "商品价格",
    stock: "股票走势",
    webchange: "网页内容变化",
    rate: "汇率 / 加密货币",
    travel: "航班 / 酒店价格",
    appversion: "应用版本",
    ticket: "票务有货",
    social: "社交账号更新",
  };
  const cfg = parseMonitorConfig(monitor.configJson);
  const rules: string[] = [];
  const targetPrice = configNum(cfg, "targetPrice");
  if (targetPrice !== null) rules.push(`价格降到 ${targetPrice} 或以下时算触发`);
  const changePct = configNum(cfg, "changePct");
  if (changePct !== null) rules.push(`单次涨跌幅超过 ${changePct}% 时算触发`);
  const above = configNum(cfg, "above");
  if (above !== null) rules.push(`数值高于 ${above} 时算触发`);
  const below = configNum(cfg, "below");
  if (below !== null) rules.push(`数值低于 ${below} 时算触发`);
  if (typeof cfg.keyword === "string" && cfg.keyword)
    rules.push(`页面出现关键词「${cfg.keyword}」时算触发`);
  const brief = [
    "【监控查询任务】这是 Muse 发起的一次监控检查。请你独立完成查询，然后把结果发回给 Muse —— 不要直接联系用户，也不要把结果发到任何聊天里。",
    `监控名称：${monitor.title}`,
    `监控类型：${typeLabels[monitor.type] ?? monitor.type}`,
    `监控目标：${monitor.target}`,
    rules.length
      ? `触发条件：${rules.join("；")}`
      : "触发条件：无特定阈值，记录目标的最新数值 / 状态即可；有明显变化时在结论里说明。",
    "请通过你能用的方式查询目标的最新情况，回复时明确给出：1）查到的最新值或最新状态；2）数据来源（网站 / 页面 / 接口名）；3）一句结论（是否达到触发条件）。查不到就明确说查不到并说明原因 —— 绝不要编造数值、日期或来源。",
  ].join("\n");
  const nameOf = await loadNameOf(db);
  const outcome = await produceReply(
    ctx,
    db,
    agent.id,
    0,
    [triggerInstructionRow(0, brief)],
    null,
    nameOf,
  );
  if (outcome.status !== "ok") {
    return {
      status: "error",
      valueNum: null,
      valueText: "",
      source: `智能体「${label}」`,
      detail: outcome.error || "智能体没有给出查询结果",
    };
  }
  const raw = outcome.text.trim();
  const excerpt = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
  // Muse (the model) summarizes the agent's report into the
  // structured check outcome; only this summary is recorded
  // and shown, with the agent's own words kept in the detail
  // for audit.
  const r = await ctx.inference.complete(
    `下面是监控智能体对一次监控查询的回复。请只根据这段回复提炼检查结果：found 表示它是否真的查到了目标的最新数值或状态（明确查到才填 true；含糊、推测、查不到都填 false）。valueNum 只在回复里有明确数字数值时填（如价格、汇率、版本号不要填），否则填 null。valueText 用一句简短的话写它查到的最新值 / 状态原文要点。summary 用一句话给出结论（是否达到触发条件、或未查到的原因）。绝不补充回复里没有的数值或事实。\n\n监控：「${monitor.title}」（目标：${monitor.target}）\n\n智能体回复：\n${raw.slice(0, 6000)}`,
    {
      schema: z.object({
        found: z.boolean(),
        valueNum: z.number().nullable(),
        valueText: z.string(),
        summary: z.string(),
      }),
      timeout_secs: 60,
    },
  );
  const source = `智能体「${label}」查询 · Muse 汇总`;
  if (!r.found) {
    return {
      status: "not_found",
      valueNum: null,
      valueText: "",
      source,
      detail: `${r.summary}（智能体原话：${excerpt}）`,
    };
  }
  return {
    status: "ok",
    valueNum: r.valueNum,
    valueText: r.valueText.trim() || r.summary,
    source,
    detail: `结论：${r.summary}（智能体原话：${excerpt}）`,
  };
}

async function runChecker(
  ctx: Ctx,
  db: Db,
  monitor: MonitorRow,
): Promise<CheckOutcome> {
  // A designated agent runs the check instead of the built-in
  // checkers; with no agent designated, Muse (the model)
  // runs it directly through the type checkers below.
  if (monitor.agentId != null) return checkViaAgent(ctx, db, monitor);
  switch (monitor.type) {
    case "product":
      return checkProduct(ctx, monitor);
    case "stock":
      return checkStock(ctx, monitor);
    case "rate":
      return checkRate(ctx, monitor);
    case "webchange":
      return checkWebChange(ctx, monitor);
    case "appversion":
      return checkAppVersion(ctx, monitor);
    default:
      return checkResearch(ctx, monitor);
  }
}

/** Runs one check end to end: reads the previous successful
 * check, performs the check, records it, refreshes the
 * monitor's current-value fields, and applies the alert rules
 * (threshold crossings, target price reached, content/version/
 * update changes, tickets becoming available). Returns the
 * outcome plus the alert messages that fired. */
async function performMonitorCheck(
  ctx: Ctx,
  db: Db,
  monitor: MonitorRow,
): Promise<CheckOutcome & { alerts: string[] }> {
  const prevRows = await db
    .select()
    .from(schema.monitorChecks)
    .where(
      and(
        eq(schema.monitorChecks.monitorId, monitor.id),
        eq(schema.monitorChecks.status, "ok"),
      ),
    )
    .orderBy(desc(schema.monitorChecks.id))
    .limit(1);
  const prev = prevRows[0];
  let outcome: CheckOutcome;
  try {
    outcome = await runChecker(ctx, db, monitor);
  } catch (e) {
    outcome = {
      status: "error",
      valueNum: null,
      valueText: "",
      source: "",
      detail: e instanceof Error ? e.message : "检查失败",
    };
  }
  await db.insert(schema.monitorChecks).values({
    monitorId: monitor.id,
    status: outcome.status,
    valueNum: outcome.valueNum,
    valueText: outcome.valueText,
    source: outcome.source,
    detail: outcome.detail,
  });
  await db
    .update(schema.monitors)
    .set({
      lastCheckedAt: new Date(),
      lastStatus: outcome.status,
      lastValueNum: outcome.valueNum,
      lastValueText: outcome.valueText,
      lastSource: outcome.source,
      updatedAt: new Date(),
    })
    .where(eq(schema.monitors.id, monitor.id));

  const alerts: string[] = [];
  if (outcome.status === "ok") {
    const config = parseMonitorConfig(monitor.configJson);
    const targetPrice = configNum(config, "targetPrice");
    const changePct = configNum(config, "changePct");
    const above = configNum(config, "above");
    const below = configNum(config, "below");
    const prevNum = prev?.valueNum ?? null;
    const newNum = outcome.valueNum;
    if (newNum !== null) {
      if (
        targetPrice !== null &&
        (monitor.type === "product" || monitor.type === "travel") &&
        newNum <= targetPrice &&
        (prevNum === null || prevNum > targetPrice)
      ) {
        alerts.push(
          `「${monitor.title}」已降到目标价：现价 ${newNum}（目标 ${targetPrice}）`,
        );
      }
      if (prevNum !== null && prevNum > 0) {
        const pct = ((newNum - prevNum) / prevNum) * 100;
        if (changePct !== null && Math.abs(pct) >= changePct) {
          alerts.push(
            `「${monitor.title}」${pct >= 0 ? "上涨" : "下跌"} ${Math.abs(pct).toFixed(2)}%：${prevNum} → ${newNum}`,
          );
        }
      }
      if (
        above !== null &&
        newNum >= above &&
        (prevNum === null || prevNum < above)
      ) {
        alerts.push(`「${monitor.title}」已升到 ${newNum}，超过阈值 ${above}`);
      }
      if (
        below !== null &&
        newNum <= below &&
        (prevNum === null || prevNum > below)
      ) {
        alerts.push(`「${monitor.title}」已降到 ${newNum}，低于阈值 ${below}`);
      }
    }
    if (
      prev &&
      outcome.valueText &&
      prev.valueText !== outcome.valueText
    ) {
      if (monitor.type === "webchange") {
        const prevHash = /hash:([0-9a-f]+)/.exec(prev.detail)?.[1];
        const newHash = /hash:([0-9a-f]+)/.exec(outcome.detail)?.[1];
        const prevKw = /kw:(\d)/.exec(prev.detail)?.[1];
        const newKw = /kw:(\d)/.exec(outcome.detail)?.[1];
        if (newKw === "1" && prevKw !== "1") {
          alerts.push(`「${monitor.title}」监控的关键词已经出现`);
        } else if (prevHash && newHash && prevHash !== newHash) {
          alerts.push(`「${monitor.title}」的网页内容发生变化`);
        }
      } else if (monitor.type === "appversion") {
        alerts.push(`「${monitor.title}」发布了新版本：${outcome.valueText}`);
      } else if (monitor.type === "social") {
        alerts.push(`「${monitor.title}」有新动态：${outcome.valueText}`);
      } else if (monitor.type === "ticket") {
        const prevAvail = /avail:(\d|\?)/.exec(prev.detail)?.[1];
        const newAvail = /avail:(\d|\?)/.exec(outcome.detail)?.[1];
        if (newAvail === "1" && prevAvail !== "1") {
          alerts.push(`「${monitor.title}」现在有票了：${outcome.valueText}`);
        }
      }
    }
  }
  for (const message of alerts) {
    await db.insert(schema.monitorAlerts).values({
      monitorId: monitor.id,
      message,
    });
  }
  ctx.invalidateQueries();
  return { ...outcome, alerts };
}


// ---------------- ledger engine ----------------
// Money is integer cents everywhere; balances are computed
// from the transaction rows on every read, never stored.

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonths(dateStr: string, months: number): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const dim = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, dim));
  return first.toISOString().slice(0, 10);
}

function advanceRecurringDate(dateStr: string, frequency: string): string {
  switch (frequency) {
    case "daily":
      return shiftDate(dateStr, 1);
    case "weekly":
      return shiftDate(dateStr, 7);
    case "yearly":
      return shiftMonths(dateStr, 12);
    default:
      return shiftMonths(dateStr, 1);
  }
}

/** Materializes due recurring entries: for every active
 * recurring row whose next date has arrived, writes the real
 * transaction (dated on its scheduled day) and advances the
 * schedule. Returns how many transactions were created. */
async function materializeRecurring(db: Db): Promise<number> {
  const today = todayInTaipei();
  const rows = await db
    .select()
    .from(schema.ledgerRecurring)
    .where(eq(schema.ledgerRecurring.active, 1));
  let created = 0;
  for (const r of rows) {
    let next = r.nextOn;
    let guard = 0;
    while (next && next <= today && guard < 200) {
      await db.insert(schema.ledgerTransactions).values({
        kind: r.kind,
        accountId: r.accountId,
        categoryId: r.categoryId,
        amountCents: r.amountCents,
        note: r.note,
        occurredOn: next,
        recurringId: r.id,
      });
      created += 1;
      guard += 1;
      next = advanceRecurringDate(next, r.frequency);
    }
    if (next !== r.nextOn) {
      await db
        .update(schema.ledgerRecurring)
        .set({ nextOn: next, updatedAt: new Date() })
        .where(eq(schema.ledgerRecurring.id, r.id));
    }
  }
  return created;
}

async function ledgerBalances(db: Db): Promise<Map<number, number>> {
  const accounts = await db.select().from(schema.ledgerAccounts);
  const txs = await db.select().from(schema.ledgerTransactions);
  const map = new Map<number, number>(
    accounts.map((a) => [a.id, a.initialBalanceCents]),
  );
  for (const t of txs) {
    if (t.kind === "income") {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amountCents);
    } else if (t.kind === "expense") {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) - t.amountCents);
    } else {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) - t.amountCents);
      if (t.toAccountId != null) {
        map.set(
          t.toAccountId,
          (map.get(t.toAccountId) ?? 0) + t.amountCents,
        );
      }
    }
  }
  return map;
}

/** All descendant category ids of a category (including itself). */
function categorySubtreeIds(
  categories: { id: number; parentId: number | null }[],
  rootId: number,
): Set<number> {
  const out = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId != null && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

const LEDGER_CATEGORY_SEED: {
  kind: "income" | "expense";
  name: string;
  children: string[];
}[] = [
  { kind: "expense", name: "餐饮", children: ["早餐", "午餐", "晚餐", "零食饮品", "请客吃饭"] },
  { kind: "expense", name: "交通", children: ["公交地铁", "打车", "机票火车", "加油充电", "停车过路"] },
  { kind: "expense", name: "购物", children: ["日用品", "服饰鞋包", "数码电器", "美妆个护", "家居用品"] },
  { kind: "expense", name: "居住", children: ["房租", "房贷", "水电燃气", "物业", "宽带"] },
  { kind: "expense", name: "娱乐", children: ["电影演出", "游戏", "旅游", "运动健身", "订阅会员"] },
  { kind: "expense", name: "医疗", children: ["药品", "门诊", "体检", "保险"] },
  { kind: "expense", name: "教育", children: ["书籍", "课程培训", "考试认证"] },
  { kind: "expense", name: "通讯", children: ["话费", "流量网络"] },
  { kind: "expense", name: "人情", children: ["红包", "礼物", "请客送礼"] },
  { kind: "expense", name: "其他支出", children: [] },
  { kind: "income", name: "工资", children: [] },
  { kind: "income", name: "奖金", children: [] },
  { kind: "income", name: "兼职", children: [] },
  { kind: "income", name: "投资收益", children: [] },
  { kind: "income", name: "退款", children: [] },
  { kind: "income", name: "其他收入", children: [] },
];

async function ensureLedgerCategories(db: Db): Promise<void> {
  let state = await db
    .select()
    .from(schema.ledgerState)
    .where(eq(schema.ledgerState.id, 1));
  if (state.length === 0) {
    await db.insert(schema.ledgerState).values({ id: 1, seeded: 0 });
    state = await db
      .select()
      .from(schema.ledgerState)
      .where(eq(schema.ledgerState.id, 1));
  }
  if (state[0] && state[0].seeded === 1) return;
  let sort = 0;
  for (const cat of LEDGER_CATEGORY_SEED) {
    const inserted = await db
      .insert(schema.ledgerCategories)
      .values({ name: cat.name, kind: cat.kind, sort: sort++ })
      .returning();
    const parent = inserted[0];
    if (!parent) continue;
    let childSort = 0;
    for (const childName of cat.children) {
      await db.insert(schema.ledgerCategories).values({
        parentId: parent.id,
        name: childName,
        kind: cat.kind,
        sort: childSort++,
      });
    }
  }
  await db
    .update(schema.ledgerState)
    .set({ seeded: 1 })
    .where(eq(schema.ledgerState.id, 1));
}

// ---- CSV / XLSX export helpers ----

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal stored (uncompressed) ZIP — enough for a valid
 * XLSX package. */
function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number) =>
    new Uint8Array([
      v & 0xff,
      (v >> 8) & 0xff,
      (v >> 16) & 0xff,
      (v >> 24) & 0xff,
    ]);
  const join = (parts: Uint8Array[]) => {
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    chunks.push(local, f.data);
    central.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(f.data.length),
        u32(f.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += local.length + f.data.length;
  }
  const centralStart = offset;
  const centralBytes = join(central);
  chunks.push(centralBytes);
  chunks.push(
    join([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralBytes.length),
      u32(centralStart),
      u16(0),
    ]),
  );
  return join(chunks);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Builds a genuine .xlsx workbook (one sheet of inline-string
 * cells) from string rows and returns it as base64. */
function buildXlsxBase64(rows: string[][], sheetName: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const sheetRows = rows
    .map(
      (r) =>
        `<row>${r
          .map(
            (c) =>
              `<c t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const enc = new TextEncoder();
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
      ),
    },
  ];
  return bytesToBase64(zipStored(files));
}


/** Shared export row builder for CSV / XLSX: header + one row
 * per transaction in range, amounts as plain yuan numbers. */
async function ledgerExportRows(
  db: Db,
  from: string | null,
  to: string | null,
): Promise<string[][]> {
  const accounts = await db.select().from(schema.ledgerAccounts);
  const categories = await db.select().from(schema.ledgerCategories);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const txs = (await db.select().from(schema.ledgerTransactions))
    .filter(
      (t) =>
        (!from || t.occurredOn >= from) && (!to || t.occurredOn <= to),
    )
    .sort((a, b) =>
      a.occurredOn === b.occurredOn
        ? a.id - b.id
        : a.occurredOn.localeCompare(b.occurredOn),
    );
  const rows: string[][] = [
    ["日期", "类型", "金额", "账户", "转入账户", "分类", "子分类", "备注"],
  ];
  for (const t of txs) {
    const cat = t.categoryId != null ? catById.get(t.categoryId) : undefined;
    const parent =
      cat?.parentId != null ? catById.get(cat.parentId) : undefined;
    rows.push([
      t.occurredOn,
      t.kind === "income" ? "收入" : t.kind === "expense" ? "支出" : "转账",
      (t.amountCents / 100).toFixed(2),
      accName.get(t.accountId) ?? "",
      t.toAccountId != null ? (accName.get(t.toAccountId) ?? "") : "",
      parent ? parent.name : (cat?.name ?? ""),
      parent ? (cat?.name ?? "") : "",
      t.note,
    ]);
  }
  return rows;
}

type ProfileRow = typeof schema.userProfile.$inferSelect;

/** Column widths are stored in pixels; anything missing or out
 * of range falls back into the sane band (defaults 264 / 280). */
function clampColumnWidth(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** The 菜单栏 height is stored in pixels with 0 meaning
 * "automatic" (size to content): 0 passes through untouched,
 * any other value is clamped into the 120–560 band. */
function clampMenuHeight(value: number | null | undefined): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  if (n <= 0) return 0;
  return Math.min(560, Math.max(120, n));
}

async function loadProfile(db: Db): Promise<ProfileRow> {
  const rows = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.id, 1));
  const existing = rows[0];
  if (existing) return existing;
  await db.insert(schema.userProfile).values({
    id: 1,
    name: DEFAULT_PROFILE_NAME,
    glyph: "",
    color: "#b9bec7",
  });
  const again = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.id, 1));
  const row = again[0];
  if (!row) throw new Error("loadProfile: failed to create profile row");
  return row;
}

/** The user's global custom instructions (trimmed; "" = none in
 * effect). They live on the profile row and apply to every agent
 * in the space — Muse and every added agent — on top of each
 * agent's own system prompt. While the 自定义指令 enable switch is
 * off, the saved text stays stored but this returns "" so no reply
 * is affected by it. Loaded once per reply round in produceReply
 * and threaded into both reply paths. */
async function loadCustomInstructions(db: Db): Promise<string> {
  const p = await loadProfile(db);
  if (p.customInstructionsEnabled !== 1) return "";
  return p.customInstructions.trim();
}

/* ---------------- skills ---------------- */

type SkillRow = typeof schema.skills.$inferSelect;

const skillFileOut = z.object({
  id: z.number(),
  name: z.string(),
  size: z.number().nullable(),
  mime: z.string().nullable(),
});

const skillOut = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  enabled: z.boolean(),
  scope: z.string(),
  // For scope 'selected': whether Muse is picked, plus the picked
  // added agents' ids. Empty while scope is 'all'.
  museAssigned: z.boolean(),
  agentIds: z.array(z.number()),
  // Files attached into this skill from its own edit page (the
  // 添加文件 upload dialog). Metadata only — the decoded text
  // rides along server-side in the reply context, never listed.
  files: z.array(skillFileOut),
});

type SkillOut = z.infer<typeof skillOut>;

async function skillToOut(db: Db, skill: SkillRow): Promise<SkillOut> {
  const links = await db
    .select()
    .from(schema.agentSkills)
    .where(eq(schema.agentSkills.skillId, skill.id))
    .orderBy(asc(schema.agentSkills.id));
  const fileRows = await db
    .select({
      id: schema.skillFiles.id,
      name: schema.skillFiles.name,
      size: schema.skillFiles.size,
      mime: schema.skillFiles.mime,
    })
    .from(schema.skillFiles)
    .where(eq(schema.skillFiles.skillId, skill.id))
    .orderBy(asc(schema.skillFiles.id));
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    enabled: skill.enabled === 1,
    scope: skill.scope,
    museAssigned: links.some((l) => l.agentId == null),
    agentIds: links
      .map((l) => l.agentId)
      .filter((v): v is number => v != null),
    files: fileRows,
  };
}

/** Replaces a skill's agent picks (used by create/update). */
async function saveSkillAssignments(
  db: Db,
  skillId: number,
  museAssigned: boolean,
  agentIds: number[],
): Promise<void> {
  await db
    .delete(schema.agentSkills)
    .where(eq(schema.agentSkills.skillId, skillId));
  const validAgents = await db.select().from(schema.agents);
  const validIds = new Set(validAgents.map((a) => a.id));
  const statements: BatchItem<"sqlite">[] = [];
  if (museAssigned) {
    statements.push(
      db
        .insert(schema.agentSkills)
        .values({ skillId, agentId: null }),
    );
  }
  for (const id of [...new Set(agentIds)]) {
    if (!validIds.has(id)) continue;
    statements.push(
      db.insert(schema.agentSkills).values({ skillId, agentId: id }),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/** The instruction blocks of every enabled skill that applies to
 * one agent (agentId null = Muse), formatted for injection into
 * that agent's reply context. "" when no skill applies. Loaded per
 * reply in produceReply, exactly like the global custom
 * instructions, and threaded through the same channel. */
async function loadSkillsContext(
  db: Db,
  agentId: number | null,
): Promise<string> {
  const rows = await db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.enabled, 1))
    .orderBy(asc(schema.skills.id));
  if (rows.length === 0) return "";
  const blocks: string[] = [];
  for (const s of rows) {
    let applies = true;
    if (s.scope === "selected") {
      const links = await db
        .select()
        .from(schema.agentSkills)
        .where(eq(schema.agentSkills.skillId, s.id));
      applies =
        agentId == null
          ? links.some((l) => l.agentId == null)
          : links.some((l) => l.agentId === agentId);
    }
    if (!applies) continue;
    // The skill's attached files (added from the skill's own edit
    // page) are part of the skill: their text joins the block so
    // the agent works from the file contents too, capped per file
    // and per skill so a big attachment cannot crowd out the chat.
    let block = `【技能：${s.name}】\n${s.instructions.trim()}`;
    const files = await db
      .select()
      .from(schema.skillFiles)
      .where(eq(schema.skillFiles.skillId, s.id))
      .orderBy(asc(schema.skillFiles.id));
    let budget = 24000;
    for (const f of files) {
      if (budget <= 0) break;
      const text = f.content.trim();
      if (!text) continue;
      const cap = Math.min(12000, budget);
      const shown =
        text.length > cap
          ? `${text.slice(0, cap)}\n…（文件内容过长，已截断）`
          : text;
      block += `\n\n【技能「${s.name}」的附属文件：${f.name}】\n${shown}`;
      budget -= shown.length;
    }
    blocks.push(block);
  }
  if (blocks.length === 0) return "";
  return (
    "用户为你启用了以下技能。处理相关请求时，请按每个技能的指令执行：\n\n" +
    blocks.join("\n\n")
  );
}

const agentOut = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  color: z.string(),
  glyph: z.string(),
  enabled: z.boolean(),
  provider: z.string(),
  apiBase: z.string(),
  hasApiKey: z.boolean(),
  model: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  // Advanced API parameters; null / '' = not set (not sent).
  topP: z.number().nullable(),
  frequencyPenalty: z.number().nullable(),
  presencePenalty: z.number().nullable(),
  seed: z.number().nullable(),
  stopSequences: z.string(),
  responseFormat: z.string(),
  maxCompletionTokens: z.number().nullable(),
  // Streaming output switch and tool-calling mode ('' = tools
  // not offered; 'auto' / 'required' / 'none' = tool_choice).
  streamEnabled: z.boolean(),
  toolMode: z.string(),
  // Host permissions （主机权限）: the per-agent switches for
  // really executing Linux commands / editing host files.
  canExecLinux: z.boolean(),
  canEditFiles: z.boolean(),
  thinking: z.string(),
  systemPrompt: z.string(),
  // The agent's own long-term memory, returned so the settings
  // form can show and edit it. Unlike the API key this is not a
  // credential — it is content the agent itself works from.
  memory: z.string(),
  note: z.string(),
  sortOrder: z.number(),
  connectionType: z.string(),
  webStatus: z.string(),
  webAccount: z.string(),
  webError: z.string(),
  // Account-collision guard (see recordWebIdentity): the names
  // of OTHER web agents of the same site whose recorded account
  // identity or credential matches this agent's — i.e. the site
  // itself resolves both agents' credentials to one account, so
  // chats with either land in that account's history. '' when
  // the agent's account is uniquely its own (or not yet
  // recorded). Only names are exposed — never the hashes.
  webIdentityCollision: z.string(),
  // The account id the site itself reported for this agent's
  // own credential at the last definitive check ('' = the site
  // reported none), when that check happened (null = never),
  // and how many cookie fields the stored credential carries
  // (0 for bare-token sites) — the settings panel's 账号核对
  // block shows all three so the user can see, per agent, what
  // the site actually said about ITS credential and when.
  webAccountId: z.string(),
  webCheckedAt: z.string().nullable(),
  webCookieFields: z.number(),
  // The stored web device id (Doubao's device_id), '' when not
  // filled in. Not a credential — returned so the settings form
  // can show and edit it.
  webDeviceId: z.string(),
  // Credential-bundle alignment （千问's console one-click
  // export): whether a full Cookie string is stored alongside
  // the token — the Cookie itself is a credential and is NEVER
  // returned, only this boolean — and the browser User-Agent
  // stored with it ('' = none), returned because a UA is not a
  // credential and the settings panel shows it for the user's
  // own alignment check.
  webCookieSet: z.boolean(),
  webUserAgent: z.string(),
  // The web product's own chat options (web agents only), each
  // site with its own set — see the schema comment. DeepSeek:
  // webMode 'default' 快速 / 'expert' 专家， webThinking 深度思考，
  // webSearch 智能搜索. 豆包： webSearch 联网搜索 plus the
  // model-menu selection below; its webMode is the derived
  // deep-think summary ('fast' / 'expert') kept for the classic
  // fallback bodies, and webThinking is unused.
  webMode: z.string(),
  webThinking: z.boolean(),
  webSearch: z.boolean(),
  // The site's model-menu selection （豆包 only; '' for every
  // other site): webModel is the picked chat model ('' = 自动，
  // 'doubao-2.1-lite', 'doubao-2.1-pro' — the menu's third-party
  // work-mode models are never stored), webReasoning the menu's
  // 推理强度 ('' = never picked, 'low' | 'medium' | 'high').
  // webMode above is kept derived from these two at save time.
  webModel: z.string(),
  webReasoning: z.string(),
  // The picked model's wire key (model_item_key from the
  // account's own menu config; '' = never picked by key, the
  // legacy webModel above then carries the pick). Any model in
  // the detected menu can be picked by key — the 对话 models
  // （快速 / 专家）, the 工作任务 models, and the third-party
  // person-* models alike.
  webModelKey: z.string(),
  // The account's own detected Doubao model menu (null = never
  // detected; the client then shows the built-in fallback list
  // and offers 识别可用模型）. needUpgrade is the site config's
  // own membership gate for this account.
  webMenu: doubaoMenuSchema.nullable(),
  webMenuAt: z.string().nullable(),
  // Whether the agent is successfully set up (API agent: address +
  // key + model complete; web agent: token stored and login
  // verified). Together with the vendor preset glyph/colour this
  // decides whether the avatar shows the vendor's official logo.
  configured: z.boolean(),
  avatarUrl: z.string().nullable(),
  conversationId: z.number().nullable(),
  preview: z.string(),
  previewAt: z.string().nullable(),
});

function toAgentOut(
  a: AgentRow,
  conversationId: number | null,
  preview: string,
  previewAt: string | null,
  avatarUrl: string | null,
  webIdentityCollision = "",
): z.infer<typeof agentOut> {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    color: a.color,
    glyph: a.glyph,
    enabled: a.enabled === 1,
    provider: a.provider,
    apiBase: a.apiBase,
    hasApiKey: a.apiKey.trim() !== "",
    model: a.model,
    temperature: a.temperature,
    maxTokens: a.maxTokens,
    topP: a.topP,
    frequencyPenalty: a.frequencyPenalty,
    presencePenalty: a.presencePenalty,
    seed: a.seed,
    stopSequences: a.stopSequences,
    responseFormat: a.responseFormat,
    maxCompletionTokens: a.maxCompletionTokens,
    streamEnabled: a.streamEnabled === 1,
    toolMode: a.toolMode,
    canExecLinux: a.canExecLinux === 1,
    canEditFiles: a.canEditFiles === 1,
    thinking: a.thinking,
    systemPrompt: a.systemPrompt,
    memory: a.memory,
    note: a.note,
    sortOrder: a.sortOrder,
    connectionType: a.connectionType,
    webStatus: a.webStatus,
    webAccount: a.webAccount,
    webError: a.webError,
    webIdentityCollision,
    webAccountId: a.webAccountId,
    webCheckedAt: a.webCheckedAt ? a.webCheckedAt.toISOString() : null,
    webCookieFields: a.webToken.includes(";")
      ? a.webToken
          .split(";")
          .filter((p) => p.includes("=") && p.split("=")[0]?.trim() !== "")
          .length
      : 0,
    webDeviceId: a.webDeviceId,
    webCookieSet: a.webCookie.trim() !== "",
    webUserAgent: a.webUserAgent,
    webMode: a.webMode,
    webThinking: a.webThinking === 1,
    webSearch: a.webSearch === 1,
    webModel: a.webModel,
    webReasoning: a.webReasoning,
    webModelKey: a.webModelKey,
    webMenu: (() => {
      if (!a.webMenuJson) return null;
      try {
        const parsed = doubaoMenuSchema.safeParse(JSON.parse(a.webMenuJson));
        return parsed.success && parsed.data.models.length
          ? parsed.data
          : null;
      } catch {
        return null;
      }
    })(),
    webMenuAt: a.webMenuAt ? a.webMenuAt.toISOString() : null,
    configured: isAgentConfigured(a),
    avatarUrl,
    conversationId,
    preview,
    previewAt,
  };
}

// The settings fields shared by createAgent / updateAgent — the same
// field set as the collaborative space's seat settings.
const agentSettingsInput = z.object({
  name: z.string().trim().max(40),
  role: z.string().trim().max(60),
  color: z.string().trim().max(20),
  glyph: z.string().trim().max(8),
  enabled: z.boolean(),
  provider: z.string().trim().max(40),
  apiBase: z.string().trim().max(300),
  apiKey: z.string().max(1000),
  model: z.string().trim().max(120),
  temperature: z.number().min(0).max(2),
  // No upper bound, by the user's explicit request: reply length
  // is bounded only by what the user sets here and the provider's
  // own limits.
  maxTokens: z.number().int().min(1),
  // Advanced API parameters （高级 API 参数）: every one is
  // optional — null / '' means "do not send this parameter".
  // .default keeps older callers (which predate these fields)
  // valid; the settings form always sends them explicitly.
  topP: z.number().min(0).max(1).nullable().default(null),
  frequencyPenalty: z.number().min(-2).max(2).nullable().default(null),
  presencePenalty: z.number().min(-2).max(2).nullable().default(null),
  seed: z.number().int().min(-2147483648).max(2147483647).nullable().default(null),
  stopSequences: z.string().max(500).default(""),
  responseFormat: z.enum(["", "text", "json_object"]).default(""),
  maxCompletionTokens: z
    .number()
    .int()
    .min(1)
    .nullable()
    .default(null),
  // Streaming output （流式输出）: the request carries stream:true
  // and the reply appears chunk by chunk. Tool calling （工具调用）:
  // '' offers no tools; 'auto' / 'required' / 'none' go out as
  // tool_choice with the space's built-in tool set. Both default
  // to off so older callers stay valid.
  streamEnabled: z.boolean().default(false),
  toolMode: z.enum(["", "auto", "required", "none"]).default(""),
  // Host permissions: both default off so older callers stay
  // valid; the settings panel sends them explicitly.
  canExecLinux: z.boolean().default(false),
  canEditFiles: z.boolean().default(false),
  thinking: z.enum(["默认", "关闭", "低", "中", "高"]),
  systemPrompt: z.string().max(4000),
  // The agent's own long-term memory （长期记忆）: kept across
  // all of this agent's conversations and injected into this
  // agent's reply context only. Defaults to '' so older callers
  // stay valid.
  memory: z.string().max(8000).default(""),
  // The user's private, display-only note about the agent. It is
  // stored with the settings and returned for the agent list row;
  // it must never be threaded into any prompt or API call.
  note: z.string().trim().max(200),
  // 'api' (default) uses the provider fields above; 'web' is a
  // web-token route (DeepSeek and the other supported sites), whose
  // credential is managed only by verifyWebToken — it is never part
  // of this payload.
  connectionType: z.enum(["api", "web"]).default("api"),
  // The browser device id for a web-token site whose chat endpoint
  // requires one (Doubao's device_id): copied by the user from
  // their own browser's request URL, stored server-side and sent
  // with that site's chat calls. '' = not filled in. The handler
  // normalises it (a pasted URL is accepted; the number is
  // extracted). Defaults to '' so older callers stay valid.
  webDeviceId: z.string().max(2000).default(""),
  // The web product's own chat options (web agents only; ignored
  // for API agents). Per site: DeepSeek webMode 'default'|'expert'
  // with webThinking （深度思考） / webSearch （智能搜索） as
  // independent switches; 豆包 webSearch （联网搜索） plus the
  // model-menu selection below (its webMode input only feeds the
  // derived deep-think summary's fallback). Defaults keep older
  // callers valid and match each site's web defaults.
  webMode: z.enum(["", "default", "expert", "fast"]).default(""),
  webThinking: z.boolean().default(false),
  webSearch: z.boolean().default(false),
  // The site's model-menu selection （豆包 only): the picked
  // model — by wire key (webModelKey, any model from the
  // account's detected menu) or by the legacy webModel value —
  // and the 推理强度 (a legacy level name or a numeric level
  // string). The handlers normalise all three (only Doubao
  // keeps them) and re-derive the stored webMode from the
  // resolved pick, so the menu, the settings panel and the
  // adapter never disagree.
  webModel: z.string().max(40).default(""),
  webModelKey: z.string().max(64).default(""),
  webReasoning: z.string().max(10).default(""),
  ...avatarFields,
});

/**
 * Takes the next default-group number from the persistent counter
 * and advances it. The counter only moves forward, so a number freed
 * by deleting a group is never reused. If the counter row is missing
 * (a database that predates it), it is rebuilt from the highest
 * 「群聊N」 title still present, plus one.
 */
async function takeNextGroupNumber(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.groupNumberCounter)
    .where(eq(schema.groupNumberCounter.id, 1));
  let row = rows[0];
  if (!row) {
    const groups = await db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.kind, "group"));
    let max = 0;
    for (const g of groups) {
      const m = /^群聊(\d+)$/.exec(g.title.trim());
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }
    await db
      .insert(schema.groupNumberCounter)
      .values({ id: 1, nextNumber: max + 1 });
    const again = await db
      .select()
      .from(schema.groupNumberCounter)
      .where(eq(schema.groupNumberCounter.id, 1));
    row = again[0];
    if (!row) throw new Error("takeNextGroupNumber: counter unavailable");
  }
  const n = row.nextNumber;
  await db
    .update(schema.groupNumberCounter)
    .set({ nextNumber: n + 1 })
    .where(eq(schema.groupNumberCounter.id, 1));
  return n;
}

/* ---------------- standing triggers （定时 / 事件触发） ---------------- */

type TriggerRow = typeof schema.agentTriggers.$inferSelect;

/** A synthetic history row carrying a trigger's instruction into
 * one reply as its final "user" turn. It is never stored as a
 * message: the instruction is the standing order the user wrote
 * for this trigger, rendered as the immediate ask of this one
 * execution, on top of the room's real history. */
function triggerInstructionRow(
  conversationId: number,
  content: string,
): MessageRow {
  return {
    id: 0,
    conversationId,
    role: "user",
    agentId: null,
    content,
    streaming: 0,
    imageBlobKey: null,
    fileName: null,
    fileSize: null,
    fileMime: null,
    agentAccess: 0,
    createdAt: new Date(),
  };
}

/**
 * Runs one trigger once: the trigger's agent produces a real reply
 * in the trigger's room (its full normal context — own long-term
 * memory, global instructions, skills, granted files) with the
 * trigger instruction as the immediate ask, and a successful reply
 * is stored as that agent's message in the room. The outcome —
 * including silence (agent disabled / unconfigured) and errors —
 * is recorded on the trigger row so the settings page shows what
 * really happened instead of a trigger quietly doing nothing.
 */
async function executeTrigger(
  ctx: Ctx,
  db: Db,
  trigger: TriggerRow,
  leadIn: string,
): Promise<{ status: "ok" | "silent" | "error"; error: string | null }> {
  const startedAt = new Date();
  const finish = async (
    status: "ok" | "silent" | "error",
    error: string | null,
  ): Promise<{ status: "ok" | "silent" | "error"; error: string | null }> => {
    await db
      .update(schema.agentTriggers)
      .set({
        lastRunAt: startedAt,
        lastStatus: status,
        lastError: error ?? "",
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTriggers.id, trigger.id));
    return { status, error };
  };
  const convRows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, trigger.conversationId));
  const conv = convRows[0];
  if (!conv) return finish("error", "目标房间已被删除");
  const history = await loadHistory(db, trigger.conversationId);
  history.push(
    triggerInstructionRow(
      trigger.conversationId,
      `${leadIn}${trigger.instruction.trim()}`,
    ),
  );
  const nameOf = await loadNameOf(db);
  const outcome = await produceReply(
    ctx,
    db,
    trigger.agentId,
    trigger.conversationId,
    history,
    null,
    nameOf,
  );
  if (outcome.status !== "ok") return finish(outcome.status, outcome.error);
  const inserted = await insertReplyRows(db, trigger.conversationId, outcome);
  if (!inserted[0]) return finish("error", "触发回复保存失败");
  // A trigger message is real content in the room: a room that was
  // still provisional (never sent in) becomes a saved room, the
  // same moment a first user message would save it.
  if (conv.provisional === 1) {
    await db
      .update(schema.conversations)
      .set({ provisional: 0 })
      .where(eq(schema.conversations.id, trigger.conversationId));
  }
  await touchConversation(db, trigger.conversationId);
  return finish("ok", null);
}

/**
 * Fires the 'room_new_message' event triggers watching one room
 * after the user posted there. A trigger whose agent is already a
 * member of the room never fires — members reply through
 * membership (and a member switched off in the room stays off).
 * At most three event agents answer one message. This is
 * background work riding on the user's send: any failure is
 * recorded on the trigger rows and never breaks the send itself.
 */
async function fireRoomMessageEventTriggers(
  ctx: Ctx,
  db: Db,
  conversationId: number,
): Promise<void> {
  try {
    const triggers = await db
      .select()
      .from(schema.agentTriggers)
      .where(
        and(
          eq(schema.agentTriggers.conversationId, conversationId),
          eq(schema.agentTriggers.kind, "event"),
          eq(schema.agentTriggers.eventType, "room_new_message"),
          eq(schema.agentTriggers.enabled, 1),
        ),
      )
      .orderBy(asc(schema.agentTriggers.id));
    if (triggers.length === 0) return;
    const members = await loadGroupMembers(db, conversationId);
    const memberKeys = new Set<string>(
      members.agentIds.map((id) => String(id)),
    );
    if (members.muse) memberKeys.add("muse");
    let fired = 0;
    for (const t of triggers) {
      if (fired >= 3) break;
      const key = t.agentId == null ? "muse" : String(t.agentId);
      if (memberKeys.has(key)) continue;
      fired += 1;
      await executeTrigger(
        ctx,
        db,
        t,
        "【事件触发：这个房间刚收到用户的新消息】",
      );
    }
  } catch {
    // Background work: never break the user's own send.
  }
}

const triggerOut = z.object({
  id: z.number(),
  agentId: z.number().nullable(),
  agentName: z.string(),
  conversationId: z.number(),
  roomTitle: z.string(),
  kind: z.string(),
  name: z.string(),
  instruction: z.string(),
  enabled: z.boolean(),
  intervalMinutes: z.number(),
  eventType: z.string(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string(),
  lastError: z.string(),
});

const triggerInput = z.object({
  agentId: z.number().int().positive().nullable().default(null),
  conversationId: z.number().int().positive(),
  kind: z.enum(["schedule", "event"]),
  name: z.string().trim().max(60),
  instruction: z.string().trim().min(1).max(2000),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(10080).default(60),
  eventType: z.enum(["", "room_new_message"]).default(""),
});

async function toTriggerOut(
  db: Db,
  t: TriggerRow,
  nameOf: NameOf,
): Promise<z.infer<typeof triggerOut>> {
  const convRows = await db
    .select({ title: schema.conversations.title })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, t.conversationId));
  return {
    id: t.id,
    agentId: t.agentId,
    agentName: nameOf(t.agentId),
    conversationId: t.conversationId,
    roomTitle: convRows[0]?.title ?? "（房间已删除）",
    kind: t.kind,
    name: t.name,
    instruction: t.instruction,
    enabled: t.enabled === 1,
    intervalMinutes: t.intervalMinutes,
    eventType: t.eventType,
    lastRunAt: t.lastRunAt ? t.lastRunAt.toISOString() : null,
    lastStatus: t.lastStatus,
    lastError: t.lastError,
  };
}

/** Validates a trigger payload's targets: the room must exist and
 * a non-Muse agent must exist. Throws the user-facing reason. */
async function assertTriggerTargets(
  db: Db,
  agentId: number | null,
  conversationId: number,
): Promise<void> {
  const convRows = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (!convRows[0]) throw new Error("目标房间不存在");
  if (agentId != null) {
    const agentRows = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId));
    if (!agentRows[0]) throw new Error("目标智能体不存在");
  }
}

/* ---------------- 账号导入 (Chrome extension bundle) ----------------
 * The space's companion Chrome extension runs on the site the
 * user is logged into and exports EVERYTHING the browser holds
 * for that site: all cookies via chrome.cookies (HttpOnly
 * included — the class no in-page script can read), the page's
 * localStorage / sessionStorage, the browser UA, and, on
 * chatgpt.com, the accessToken from /api/auth/session. The user
 * pastes (or file-picks) that JSON on the 设置 → 账号导入 page;
 * the two actions below parse it and apply it.
 *
 * parseCredentialImport is the single derivation: bundle JSON →
 * { provider, token (the webToken to store), cookie (the full
 * Cookie header), userAgent, deviceId, warnings }. Each site's
 * credential shape mirrors what its validator/chat adapter
 * already expects (see the per-site blocks above):
 *   deepseek  webToken = the localStorage user token (unwrapped)
 *   chatgpt   webToken = the session accessToken the extension
 *             fetched from /api/auth/session in the page
 *   claude    webToken = the sessionKey cookie's bare value
 *   gemini    webToken = the full Cookie header (its parser
 *             extracts __Secure-1PSID / 1PSIDTS and folds
 *             rotations back into the same string)
 *   grok / hunyuan / mistral / wenxin / doubao
 *             webToken = the full Cookie header
 *   kimi / zhipu
 *             webToken = the JWT found in local/session storage
 *   qwen      webToken + webCookie + webUserAgent, split exactly
 *             like parseQwenPaste (a Cookie token= pair wins)
 *   doubao    additionally: device_id recovered from storage
 *             when the site kept one there
 * A paste that is NOT an extension bundle is still understood:
 * a 千问 console-export JSON, a bare Cookie string, or a bare
 * token — provider '' then, and applyImportBundle interprets it
 * against the agent the user picked. Secrets are never returned:
 * parseImportBundle answers with counts, key NAMES and masked
 * previews only, and the raw bundle is stored server-side only
 * (agents.web_import_json), never echoed by any action. */

const IMPORT_DOMAIN_PROVIDERS: [string, string][] = [
  ["chat.deepseek.com", "deepseek"],
  ["deepseek.com", "deepseek"],
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["claude.ai", "claude"],
  ["gemini.google.com", "gemini"],
  ["grok.com", "grok"],
  ["kimi.moonshot.cn", "kimi"],
  ["kimi.com", "kimi"],
  ["moonshot.cn", "kimi"],
  ["chat.qwen.ai", "qwen"],
  ["qwen.ai", "qwen"],
  ["tongyi.aliyun.com", "qwen"],
  ["doubao.com", "doubao"],
  ["yuanbao.tencent.com", "hunyuan"],
  ["chatglm.cn", "zhipu"],
  ["chat.mistral.ai", "mistral"],
  ["mistral.ai", "mistral"],
  ["chat.baidu.com", "wenxin"],
  ["yiyan.baidu.com", "wenxin"],
];

function importProviderForHost(host: string): string {
  const h = host.trim().toLowerCase();
  if (!h) return "";
  for (const [domain, provider] of IMPORT_DOMAIN_PROVIDERS) {
    if (h === domain || h.endsWith(`.${domain}`)) return provider;
  }
  return "";
}

type ImportCookie = { name: string; value: string; httpOnly: boolean };

type ImportExtraction = {
  isBundle: boolean;
  provider: string;
  domain: string;
  url: string;
  userAgent: string;
  cookieHeader: string;
  cookies: ImportCookie[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  token: string;
  tokenSource: string;
  deviceId: string;
  warnings: string[];
  error: string;
};

function emptyExtraction(): ImportExtraction {
  return {
    isBundle: false,
    provider: "",
    domain: "",
    url: "",
    userAgent: "",
    cookieHeader: "",
    cookies: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
    token: "",
    tokenSource: "",
    deviceId: "",
    warnings: [],
    error: "",
  };
}

function storageRecord(v: unknown): Record<string, string> {
  const rec = asRecord(v);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

/** A JWT-shaped value (header.payload.signature, base64url) —
 * the shape Kimi / 智谱 / 千问 keep their access token in. */
function looksLikeJwt(v: string): boolean {
  const t = v.trim();
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);
}

/** Finds a site's Bearer token inside captured storage: exact
 * key names first, then any value that parses as (or contains)
 * a JWT. JSON-wrapped values ({"value": "…"}) are unwrapped. */
function findStorageToken(
  stores: Record<string, string>[],
  keys: string[],
): { token: string; source: string } {
  for (const store of stores) {
    for (const key of keys) {
      const raw = store[key];
      if (raw && raw.trim()) {
        const unwrapped = unwrapDeepseekToken(raw);
        return { token: unwrapped, source: `本地存储 ${key}` };
      }
    }
  }
  for (const store of stores) {
    for (const [key, raw] of Object.entries(store)) {
      const v = (raw ?? "").trim();
      if (!v) continue;
      if (looksLikeJwt(v)) return { token: v, source: `本地存储 ${key}` };
      if (v.startsWith("{")) {
        try {
          const rec = asRecord(JSON.parse(v));
          const inner =
            strField(rec?.value) || strField(rec?.token) ||
            strField(rec?.accessToken) || strField(rec?.access_token);
          if (inner && looksLikeJwt(inner))
            return { token: inner.trim(), source: `本地存储 ${key}` };
        } catch {
          // not JSON — not a token carrier
        }
      }
    }
  }
  return { token: "", source: "" };
}

/** device_id recovery for Doubao: a `device_id=…` pair inside
 * any captured storage value, or a storage key that IS the id. */
function findStorageDeviceId(stores: Record<string, string>[]): string {
  for (const store of stores) {
    for (const [key, raw] of Object.entries(store)) {
      if (/device/i.test(key)) {
        const cleaned = cleanWebDeviceId(raw ?? "");
        if (cleaned) return cleaned;
      }
      const fromValue = cleanWebDeviceId(raw ?? "");
      if (fromValue && /device_id/.test(raw ?? "")) return fromValue;
    }
  }
  return "";
}

function parseCredentialImport(rawInput: string): ImportExtraction {
  const out = emptyExtraction();
  const raw = rawInput.trim();
  if (!raw) {
    out.error = "内容为空：请粘贴扩展导出的 JSON，或直接粘贴 Cookie / 令牌";
    return out;
  }
  let parsed: Record<string, unknown> | null = null;
  if (raw.startsWith("{")) {
    try {
      parsed = asRecord(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  const isBundle =
    parsed !== null &&
    (Array.isArray(parsed.cookies) ||
      asRecord(parsed.localStorage) !== null ||
      typeof parsed.cookieHeader === "string" ||
      typeof parsed.domain === "string");
  if (parsed && !isBundle) {
    // The 千问 console one-click export { token, cookie, ua }.
    const q = parseQwenPaste(raw);
    if (q.token || q.cookie || q.ua) {
      out.provider = "qwen";
      out.token = q.token;
      out.tokenSource = q.token ? "千问凭证 JSON 的 token" : "";
      out.cookieHeader = q.cookie;
      out.userAgent = q.ua;
      if (!q.token)
        out.warnings.push(
          "这段 JSON 里没有访问令牌（只有 Cookie / UA）：令牌在 chat.qwen.ai 的本地存储中，用扩展在该站抓取可一次拿全",
        );
      return out;
    }
    out.error =
      "这段 JSON 不是扩展导出的数据，也不是千问的整段凭证 JSON，无法识别";
    return out;
  }
  if (!parsed) {
    // Bare paste: a Cookie string or a bare token. The provider
    // stays unknown; applyImportBundle reads it against the
    // agent the user picked.
    if (raw.includes("=") && raw.includes(";")) {
      out.cookieHeader = raw;
      out.token = raw;
      out.tokenSource = "粘贴的 Cookie 字符串";
      out.warnings.push(
        "这是直接粘贴的 Cookie（不是扩展导出）：网页粘贴拿不到 HttpOnly 的 Cookie，个别站点可能缺关键字段；用扩展抓取最完整",
      );
    } else {
      out.token = raw;
      out.tokenSource = "粘贴的令牌";
    }
    return out;
  }
  // ---- extension bundle ----
  out.isBundle = true;
  out.url = strField(parsed.url);
  out.domain = strField(parsed.domain);
  let host = out.domain;
  if (!host && out.url) {
    try {
      host = new URL(out.url).hostname;
    } catch {
      host = "";
    }
  }
  if (!host) host = strField(asRecord(parsed.extra)?.hostname ?? "");
  out.domain = host;
  out.provider = importProviderForHost(host);
  out.userAgent =
    strField(parsed.userAgent) || strField(asRecord(parsed.extra)?.userAgent ?? "");
  const cookieRows = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  for (const row of cookieRows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const name = strField(rec.name);
    if (!name) continue;
    out.cookies.push({
      name,
      value: typeof rec.value === "string" ? rec.value : "",
      httpOnly: rec.httpOnly === true,
    });
  }
  const seenCookie = new Set<string>();
  const headerParts: string[] = [];
  for (const c of out.cookies) {
    if (seenCookie.has(c.name)) continue;
    seenCookie.add(c.name);
    headerParts.push(`${c.name}=${c.value}`);
  }
  out.cookieHeader =
    strField(parsed.cookieHeader) || headerParts.join("; ");
  const ls = storageRecord(parsed.localStorage);
  const ss = storageRecord(parsed.sessionStorage);
  out.localStorageKeys = Object.keys(ls);
  out.sessionStorageKeys = Object.keys(ss);
  const extra = asRecord(parsed.extra) ?? {};
  const cookieOf = (name: string) =>
    out.cookies.find((c) => c.name === name)?.value ?? "";
  if (!out.provider) {
    out.warnings.push(
      `没有识别出 ${host || "这个地址"} 对应哪个已支持的网页智能体：仍可手动选择目标智能体导入（将按完整 Cookie 保存）`,
    );
    out.token = out.cookieHeader;
    out.tokenSource = out.cookieHeader ? "完整 Cookie" : "";
    return out;
  }
  switch (out.provider) {
    case "deepseek": {
      const found = findStorageToken([ls, ss], [
        "userToken",
        "token",
        "accessToken",
        "access_token",
      ]);
      out.token = found.token ? unwrapDeepseekToken(found.token) : "";
      out.tokenSource = found.source;
      if (!out.token)
        out.warnings.push(
          "没有在本地存储里找到 DeepSeek 的登录令牌：请确认扩展是在已登录的 chat.deepseek.com 页面上抓取的",
        );
      break;
    }
    case "chatgpt": {
      const fromExtra = strField(extra.chatgptAccessToken);
      const found = findStorageToken([ls, ss], ["accessToken", "access_token"]);
      out.token = fromExtra || found.token;
      out.tokenSource = fromExtra
        ? "扩展在页面内读取的 /api/auth/session"
        : found.source;
      if (!out.token)
        out.warnings.push(
          "没有拿到 ChatGPT 的 accessToken：扩展在 chatgpt.com 页面内读取 /api/auth/session 失败时会出现这种情况，请确认页面已登录后重新抓取",
        );
      break;
    }
    case "claude": {
      out.token = cookieOf("sessionKey");
      out.tokenSource = out.token ? "Cookie sessionKey" : "";
      if (!out.token)
        out.warnings.push("Cookie 里没有 sessionKey：请确认是在已登录的 claude.ai 页面上抓取的");
      break;
    }
    case "gemini": {
      const psid = cookieOf("__Secure-1PSID");
      const psidts = cookieOf("__Secure-1PSIDTS");
      out.token = out.cookieHeader;
      out.tokenSource = "完整 Cookie（含 __Secure-1PSID / 1PSIDTS）";
      if (!psid)
        out.warnings.push("Cookie 里没有 __Secure-1PSID：请确认是在已登录的 gemini.google.com 页面上抓取的");
      else if (!psidts)
        out.warnings.push("Cookie 里没有 __Secure-1PSIDTS：登录可能很快过期，建议在 Gemini 页面停留片刻后重新抓取");
      break;
    }
    case "qwen": {
      const lsToken = (ls["token"] ?? "").trim();
      const fromCookie = out.cookieHeader
        ? cookiePairValue(out.cookieHeader, "token")
        : "";
      out.token = normalizeQwenToken(
        fromCookie && fromCookie !== lsToken ? fromCookie : lsToken,
      );
      out.tokenSource = out.token
        ? fromCookie && fromCookie !== lsToken
          ? "Cookie 中的 token"
          : "本地存储 token"
        : "";
      if (!out.token)
        out.warnings.push(
          "没有找到千问的访问令牌（本地存储 token 与 Cookie token 都为空）：请确认是在已登录的 chat.qwen.ai 页面上抓取的。注意该令牌有效期约 15 分钟，抓取后请尽快导入验证",
        );
      break;
    }
    case "kimi": {
      const found = findStorageToken([ls, ss], [
        "accessToken",
        "access_token",
        "token",
      ]);
      out.token = found.token;
      out.tokenSource = found.source;
      if (!out.token)
        out.warnings.push("没有在本地存储里找到 Kimi 的访问令牌：请确认是在已登录的 Kimi 页面上抓取的");
      break;
    }
    case "zhipu": {
      const found = findStorageToken([ls, ss], [
        "chatglm_token",
        "accessToken",
        "access_token",
        "token",
      ]);
      out.token = found.token;
      out.tokenSource = found.source;
      if (!out.token)
        out.warnings.push("没有在本地存储里找到智谱清言的访问令牌：请确认是在已登录的 chatglm.cn 页面上抓取的");
      break;
    }
    case "doubao": {
      out.token = out.cookieHeader;
      out.tokenSource = "完整 Cookie";
      out.deviceId = findStorageDeviceId([ls, ss]);
      if (!out.cookieHeader)
        out.warnings.push("没有抓到任何 Cookie：请确认是在已登录的 doubao.com 页面上抓取的");
      if (!out.deviceId)
        out.warnings.push(
          "本地存储里没有找到 device_id（它常只出现在官网请求网址里）：可留空，空间会从 Cookie 与官网页面恢复其余参数；发送仍失败时再到该智能体设置里手动补填",
        );
      break;
    }
    default: {
      // grok / hunyuan / mistral / wenxin: the credential IS the
      // full Cookie header.
      out.token = out.cookieHeader;
      out.tokenSource = "完整 Cookie";
      if (!out.cookieHeader)
        out.warnings.push("没有抓到任何 Cookie：请确认是在目标网站已登录的页面上抓取的");
      break;
    }
  }
  return out;
}

/** Masked one-line preview of a secret for the import page:
 * length plus first/last 3 chars — enough to recognise WHICH
 * credential it is, never enough to use it. */
function maskSecretPreview(v: string): string {
  const t = v.trim();
  if (!t) return "";
  if (t.length <= 10) return `共 ${t.length} 字符`;
  return `${t.slice(0, 3)}…${t.slice(-3)}（共 ${t.length} 字符）`;
}

const importPreviewResponse = z.object({
  ok: z.boolean(),
  error: z.string(),
  isBundle: z.boolean(),
  provider: z.string(),
  siteLabel: z.string(),
  domain: z.string(),
  url: z.string(),
  cookieCount: z.number(),
  httpOnlyCount: z.number(),
  cookieNames: z.array(z.string()),
  localStorageKeys: z.array(z.string()),
  sessionStorageKeys: z.array(z.string()),
  tokenFound: z.boolean(),
  tokenPreview: z.string(),
  tokenSource: z.string(),
  cookieLength: z.number(),
  userAgent: z.string(),
  deviceId: z.string(),
  warnings: z.array(z.string()),
  agents: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      provider: z.string(),
      webStatus: z.string(),
      matches: z.boolean(),
    }),
  ),
});

const importApplyResponse = z.object({
  ok: z.boolean(),
  status: z.string(),
  account: z.string(),
  error: z.string(),
  identityWarning: z.string(),
  provider: z.string(),
  siteLabel: z.string(),
  appliedToken: z.boolean(),
  appliedCookie: z.boolean(),
  appliedUserAgent: z.boolean(),
  appliedDeviceId: z.boolean(),
  storedBundle: z.boolean(),
});

/* ---------------- 创作 (prompt notebook) ----------------
 * The 创作 workspace's GENERATION was removed at the user's
 * direction on 2026-11-21: the workspace no longer holds
 * members, generation settings or a generated feed, and no
 * action here generates anything. What remains is the
 * prompt notebook (prompt_notes, see the list/create/update/
 * delete actions at the end of the Actions map): the user's
 * own hand-written prompt records with a style-reference
 * field. The creation_* tables stay in the schema — rows the
 * user already generated are their data and are not deleted;
 * they are simply no longer read or written. */


/** Decodes the blob key out of a blob URL the client holds
 * (./blobs/<base64url of the key>, possibly with a query or
 * fragment): the one validation every blob-bytes action shares.
 * Returns "" for anything that is not a plausible key. */
function blobKeyFromUrl(url: string): string {
  const marker = "/blobs/";
  const idx = url.lastIndexOf(marker);
  if (idx < 0) return "";
  const encoded = (url.slice(idx + marker.length) ?? "").split(/[?#]/)[0];
  let key = "";
  try {
    const b64 = (encoded ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    key = atob(padded);
  } catch {
    key = "";
  }
  if (!key || key.startsWith("/") || key.includes("..")) return "";
  return key;
}

/* ---------------- 代码 / 图像 workspaces ----------------
 * Helpers for the two workspaces added 2026-11-21 under 创作
 * in the left rail. The 代码 actions themselves sit at the end
 * of the Actions map (next to the prompt-note actions); the
 * agent read/modify wiring lives in buildAgentFilesContext /
 * applyFileEdits above. */

/** Decodes a base64 payload into bytes (the shape every image
 * upload in this space already travels in). */
function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Reads an image's pixel size straight from its bytes (PNG
// IHDR, JPEG SOF, WebP VP8/VP8L/VP8X headers). Used to record
// each image part's ACTUAL size — at upload when the client
// could not measure it, and after an agent edit, whose returned
// image may be a different size from the crop it replaced.
// Returns null when the header is not recognised.
function imageSizeFromBytes(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const u8 = (i: number) => bytes[i] ?? 0;
  const u16be = (i: number) => (u8(i) << 8) | u8(i + 1);
  const u32be = (i: number) =>
    ((u8(i) << 24) | (u8(i + 1) << 16) | (u8(i + 2) << 8) | u8(i + 3)) >>> 0;
  const u24le = (i: number) => u8(i) | (u8(i + 1) << 8) | (u8(i + 2) << 16);
  try {
    // PNG: 8-byte signature, IHDR width/height at 16/20.
    if (
      bytes.length > 24 &&
      u8(0) === 0x89 &&
      u8(1) === 0x50 &&
      u8(2) === 0x4e &&
      u8(3) === 0x47
    ) {
      const width = u32be(16);
      const height = u32be(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // JPEG: walk the marker segments to a Start-Of-Frame.
    if (bytes.length > 4 && u8(0) === 0xff && u8(1) === 0xd8) {
      let i = 2;
      while (i + 4 < bytes.length) {
        if (u8(i) !== 0xff) {
          i += 1;
          continue;
        }
        const marker = u8(i + 1);
        if (marker === 0xd9 || marker === 0xda) break;
        const len = u16be(i + 2);
        if (len < 2) break;
        if (
          marker >= 0xc0 &&
          marker <= 0xc3 &&
          marker !== 0xc4 &&
          i + 9 < bytes.length
        ) {
          const height = u16be(i + 5);
          const width = u16be(i + 7);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        i += 2 + len;
      }
      return null;
    }
    // WebP: RIFF container; the first chunk decides the layout.
    if (
      bytes.length > 30 &&
      u8(0) === 0x52 &&
      u8(1) === 0x49 &&
      u8(2) === 0x46 &&
      u8(3) === 0x46 &&
      u8(8) === 0x57 &&
      u8(9) === 0x45 &&
      u8(10) === 0x42 &&
      u8(11) === 0x50
    ) {
      const chunk = String.fromCharCode(u8(12), u8(13), u8(14), u8(15));
      if (chunk === "VP8X") {
        return { width: u24le(24) + 1, height: u24le(27) + 1 };
      }
      if (chunk === "VP8L" && bytes.length > 25) {
        const b = (u8(21) | (u8(22) << 8) | (u8(23) << 16) | (u8(24) << 24)) >>> 0;
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8 " && bytes.length > 30) {
        const width = ((u8(27) << 8) | u8(26)) & 0x3fff;
        const height = ((u8(29) << 8) | u8(28)) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : null;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

const imagePartOut = z.object({
  id: z.number(),
  idx: z.number(),
  row: z.number(),
  col: z.number(),
  url: z.string(),
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  edited: z.boolean(),
  editAgent: z.string(),
  editInstruction: z.string(),
  updatedAt: z.string(),
});

const imageProjectOut = z.object({
  id: z.number(),
  name: z.string(),
  originalUrl: z.string(),
  // The agent-produced whole-image copy (edit / watermark
  // removal), when one exists: the detail view shows this copy
  // and split cuts it; originalUrl always stays the pristine
  // upload.
  editedUrl: z.string().nullable(),
  editedMime: z.string().nullable(),
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  rows: z.number(),
  cols: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  parts: z.array(imagePartOut),
});

type ImagePartRow = typeof schema.imageParts.$inferSelect;
type ImageProjectRow = typeof schema.imageProjects.$inferSelect;

// Best-effort byte size of a stored blob for rows written
// before sizes were recorded; null when the store cannot say.
async function blobSizeOrNull(ctx: Ctx, key: string): Promise<number | null> {
  try {
    const head = (await ctx.blobs.head(key)) as
      | { size?: number; contentType?: string }
      | null;
    return typeof head?.size === "number" && head.size >= 0
      ? head.size
      : null;
  } catch {
    return null;
  }
}

async function toImagePartOut(
  ctx: Ctx,
  row: ImagePartRow,
): Promise<z.infer<typeof imagePartOut>> {
  return {
    id: row.id,
    idx: row.idx,
    row: row.row,
    col: row.col,
    url: await ctx.blobs.getUrl(row.blobKey),
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes ?? (await blobSizeOrNull(ctx, row.blobKey)),
    edited: row.edited === 1,
    editAgent: row.editAgent,
    editInstruction: row.editInstruction,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toImageProjectOut(
  ctx: Ctx,
  db: Db,
  row: ImageProjectRow,
): Promise<z.infer<typeof imageProjectOut>> {
  const partRows = await db
    .select()
    .from(schema.imageParts)
    .where(eq(schema.imageParts.projectId, row.id))
    .orderBy(asc(schema.imageParts.idx));
  const parts: z.infer<typeof imagePartOut>[] = [];
  for (const p of partRows) parts.push(await toImagePartOut(ctx, p));
  return {
    id: row.id,
    name: row.name,
    originalUrl: await ctx.blobs.getUrl(row.originalBlobKey),
    editedUrl: row.editedBlobKey
      ? await ctx.blobs.getUrl(row.editedBlobKey)
      : null,
    editedMime: row.editedMime,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes:
      row.sizeBytes ?? (await blobSizeOrNull(ctx, row.originalBlobKey)),
    rows: row.rows,
    cols: row.cols,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    parts,
  };
}

/**
 * One real image edit through an API agent's own provider:
 * POST {base}/images/edits as multipart form data containing
 * ONLY the single part's bytes, the instruction as the prompt,
 * and the agent's configured model. The provider's answer is
 * either a b64_json payload or a URL to download (through the
 * same agentFetch route the chat calls use). Any refusal —
 * HTTP error, no image in the answer, a non-image payload —
 * comes back as the reason, with the provider's own message
 * sanitized the same way chat errors are.
 */
async function editImageViaProviderApi(args: {
  base: string;
  key: string;
  model: string;
  bytes: Uint8Array;
  mime: string;
  instruction: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const form = new FormData();
    const ext = args.mime === "image/jpeg" ? "jpg" : "png";
    form.append(
      "image",
      new Blob([args.bytes.slice().buffer as ArrayBuffer], {
        type: args.mime,
      }),
      `part.${ext}`,
    );
    form.append("prompt", args.instruction);
    form.append("model", args.model);
    form.append("n", "1");
    const res = await agentFetch(`${args.base}/images/edits`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${args.key}` },
      body: form,
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body: unknown = await res.json();
        const err =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error?: { message?: unknown } }).error
            : undefined;
        if (err && typeof err.message === "string")
          detail = sanitizeProviderErrorText(err.message);
      } catch {
        // non-JSON error body; the status alone is the reason
      }
      return {
        ok: false,
        error: `图片编辑接口返回 ${res.status}${detail ? `：${detail}` : ""}。这一份没有改动。`,
      };
    }
    const body: unknown = await res.json().catch(() => null);
    const data =
      typeof body === "object" && body !== null && "data" in body
        ? (body as { data?: unknown }).data
        : undefined;
    const first = Array.isArray(data) ? data[0] : undefined;
    const rec =
      typeof first === "object" && first !== null
        ? (first as Record<string, unknown>)
        : null;
    if (!rec) {
      return {
        ok: false,
        error: "图片编辑接口没有返回图片（这个模型可能不支持改图）。这一份没有改动。",
      };
    }
    if (typeof rec.b64_json === "string" && rec.b64_json) {
      const bytes = base64ToBytes(rec.b64_json);
      if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) {
        return { ok: false, error: "接口返回的图片无效。这一份没有改动。" };
      }
      return { ok: true, bytes, mime: "image/png" };
    }
    if (typeof rec.url === "string" && rec.url) {
      const imgRes = await agentFetch(rec.url, {
        signal: controller.signal,
      }).catch(() => null);
      if (!imgRes || !imgRes.ok) {
        return { ok: false, error: "接口返回的图片地址下载失败。这一份没有改动。" };
      }
      const mime = imgRes.headers.get("content-type") ?? "";
      if (!mime.startsWith("image/")) {
        return { ok: false, error: "接口返回的不是图片。这一份没有改动。" };
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      if (buf.length === 0 || buf.length > 16 * 1024 * 1024) {
        return { ok: false, error: "接口返回的图片无效。这一份没有改动。" };
      }
      return { ok: true, bytes: buf, mime };
    }
    return {
      ok: false,
      error: "图片编辑接口没有返回图片（这个模型可能不支持改图）。这一份没有改动。",
    };
  } catch (err) {
    return {
      ok: false,
      error: `修图请求失败：${err instanceof Error ? err.message : "网络错误"}。这一份没有改动。`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The fixed instruction behind the 图像 workspace's 一键去水印
 * button: one tap sends exactly this to the chosen agent through
 * the same dispatcher as a typed edit instruction. */
const WATERMARK_PROMPT =
  "请去除这张图片上的所有水印（包括文字水印、标志水印和半透明水印），用周围的画面自然补全被水印遮挡的部分；除水印之外，图片的其他内容、构图、颜色和尺寸都保持不变，不要添加任何新元素。";

/**
 * Second real image-edit channel for an API agent: a multimodal
 * chat completion carrying the image itself as an image_url
 * data-URI part next to the instruction. Providers whose
 * /images/edits endpoint is missing or refuses often still edit
 * through chat (the reply's structured image parts are harvested
 * by parseJsonCompletion, exactly like generated reply media in
 * chat). Any answer without an image part is a failure with the
 * model's own words as the reason.
 */
async function editImageViaChatApi(args: {
  base: string;
  key: string;
  model: string;
  bytes: Uint8Array;
  mime: string;
  instruction: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; error: string }
> {
  if (args.bytes.length > 8 * 1024 * 1024) {
    return { ok: false, error: "图片过大，对话通道未尝试" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const dataUri = `data:${args.mime};base64,${bytesToBase64(args.bytes)}`;
    const res = await agentFetch(`${args.base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.key}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${args.instruction}\n请直接返回修改后的图片本身，不要只用文字说明。`,
              },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body: unknown = await res.json();
        const err =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error?: { message?: unknown } }).error
            : undefined;
        if (err && typeof err.message === "string")
          detail = sanitizeProviderErrorText(err.message);
      } catch {
        // non-JSON error body; the status alone is the reason
      }
      return {
        ok: false,
        error: `对话接口返回 ${res.status}${detail ? `：${detail}` : ""}`,
      };
    }
    const body: unknown = await res.json().catch(() => null);
    const parsed = parseJsonCompletion(body);
    let img = parsed.media.find((m) => m.kind === "image");
    if (!img) {
      // Some providers deliver the requested image as a Markdown
      // image link inside the reply text instead of a structured
      // part. This channel exists for exactly one purpose —
      // getting the edited image back — so such a link, when the
      // reply carries one, is the model's delivery of that image:
      // it is downloaded and verified as a real image below
      // before anything is replaced. (The chat pipeline keeps its
      // stricter structured-parts-only rule; this is not chat.)
      const md = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/.exec(parsed.content);
      const bare = md
        ? null
        : /(https:\/\/[^\s)]+?\.(?:png|jpe?g|webp)(?:\?[^\s)]*)?)/i.exec(
            parsed.content,
          );
      const url = md?.[1] ?? bare?.[1];
      if (url) img = { kind: "image", url };
    }
    if (!img) {
      const said = parsed.content.trim().slice(0, 160);
      return {
        ok: false,
        error: said
          ? `模型只回复了文字：「${said}」`
          : "模型没有返回图片",
      };
    }
    if (img.url.startsWith("data:")) {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(img.url);
      if (!m || !m[1] || !m[2])
        return { ok: false, error: "模型返回的图片数据无效" };
      const bytes = base64ToBytes(m[2]);
      if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024)
        return { ok: false, error: "模型返回的图片无效" };
      return { ok: true, bytes, mime: m[1].toLowerCase() };
    }
    const imgRes = await agentFetch(img.url, {
      signal: controller.signal,
    }).catch(() => null);
    if (!imgRes || !imgRes.ok)
      return { ok: false, error: "模型返回的图片地址下载失败" };
    const mime = imgRes.headers.get("content-type") ?? "";
    if (!mime.startsWith("image/"))
      return { ok: false, error: "模型返回的不是图片" };
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (buf.length === 0 || buf.length > 16 * 1024 * 1024)
      return { ok: false, error: "模型返回的图片无效" };
    return { ok: true, bytes: buf, mime };
  } catch (err) {
    return {
      ok: false,
      error: `对话改图请求失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

type ImageEditAttempt =
  | { ok: true; bytes: Uint8Array; mime: string; agentName: string }
  | { ok: false; reason: string; agentName: string };

/**
 * The one dispatcher behind every agent image operation in the
 * 图像 workspace (typed edits and 一键去水印 alike). EVERY agent
 * may be chosen — Muse, API agents and web-token agents alike;
 * each is tried through its own real channel, and an agent whose
 * channel cannot produce edited pixels simply produces no edit,
 * with the real reason (its own reply included where it made
 * one). Nothing is fabricated: a replacement happens only when
 * actual image bytes came back from the agent's own provider.
 *
 * - API agents: the provider's /images/edits endpoint first,
 *   then a multimodal chat completion carrying the image.
 * - Muse: the image is really sent to the platform vision
 *   channel and Muse answers about it — but that channel
 *   returns text only, so its answer is reported and nothing is
 *   replaced.
 * - Web-token agents: the request is really sent through the
 *   site's own chat channel with an explicit note that the image
 *   file itself cannot ride that channel; whatever the agent
 *   answers is reported, and nothing is replaced (it never saw
 *   the original pixels, so any picture it generated would not
 *   be an edit of this one). DeepSeek web agents are the one
 *   exception: their channel is bound to chat-room conversations
 *   and has no standalone send, so no call is placed.
 */
async function attemptImageEditWithAgent(
  ctx: Ctx,
  db: Db,
  agentId: number | null,
  bytes: Uint8Array,
  mime: string,
  instruction: string,
): Promise<ImageEditAttempt> {
  if (agentId == null) {
    const muse = await loadMuseSettings(db);
    const museName = muse.name.trim() || "Muse";
    if (muse.enabled !== 1)
      return { ok: false, reason: `${museName}已停用，不会工作`, agentName: museName };
    if (mime !== "image/jpeg" && mime !== "image/png") {
      return {
        ok: false,
        reason: `${museName}的通道只能查看 JPG / PNG 图片，这张是 ${mime}，没能发给它。`,
        agentName: museName,
      };
    }
    if (bytes.length > 6 * 1024 * 1024) {
      return {
        ok: false,
        reason: `图片过大（超过 6MB），${museName}的通道这次没能接收。`,
        agentName: museName,
      };
    }
    try {
      const result = await ctx.inference.complete(
        `用户请你处理附带的图片，要求是：${instruction}`,
        {
          system:
            "你是这个空间里的智能体 Muse。用户通过图像区把一张图片发给你，请你按要求修改。你在这个通道里能看图、能回复文字，但无法生成或返回图片文件。请先看图，再用一两句中文如实回复：你能不能直接交回修改后的图片；不能的话说明原因，并可以简要指出图中需要处理的位置。不要声称已经改好。",
          schema: z.object({ reply: z.string() }),
          timeout_secs: 120,
          images: [
            {
              dataBase64: bytesToBase64(bytes),
              mimeType: mime as "image/jpeg" | "image/png",
            },
          ],
        },
      );
      const said = result.reply.trim().slice(0, 300);
      return {
        ok: false,
        reason: `${museName}看过这张图后回复：${said || "（没有给出文字回复）"}——它在这个通道里只能回复文字、返回不了修改后的图片，所以没有替换。`,
        agentName: museName,
      };
    } catch (e) {
      return {
        ok: false,
        reason: `${museName}这次没有回复：${e instanceof Error ? e.message : "调用失败"}`,
        agentName: museName,
      };
    }
  }
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  const agent = agentRows[0];
  if (!agent)
    return { ok: false, reason: "这个智能体不存在，可能已被删除", agentName: "智能体" };
  const agentName = agent.name || "智能体";
  if (agent.enabled !== 1)
    return { ok: false, reason: `${agentName}已停用，不会工作`, agentName };
  if (agent.connectionType === "web") {
    if (agent.webToken.trim() === "")
      return {
        ok: false,
        reason: `${agentName}尚未登录网页版（未粘贴令牌），保持沉默，不会处理图片`,
        agentName,
      };
    if (agent.webStatus === "expired")
      return {
        ok: false,
        reason: `${agentName}的网页令牌已过期，请在它的设置里重新粘贴新令牌并验证登录`,
        agentName,
      };
    if (agent.provider === "deepseek") {
      return {
        ok: false,
        reason: `${agentName}是 DeepSeek 网页版：它的图片通道接在聊天房间里（在聊天框里发图它能看图回复），图像区的改图通道还没有接它，所以这次没有把图片发给它，它不会改图。`,
        agentName,
      };
    }
    // Sites with a real upload channel (ChatGPT / Claude /
    // Gemini / Mistral) receive the picture ITSELF here, exactly
    // like in a chat room, and are asked to hand back the
    // modified image; a returned image becomes the edit below.
    // Every other web provider keeps the honest text-only note:
    // it is told plainly that no picture was attached.
    const imageCapable = WEB_IMAGE_PROVIDERS.has(agent.provider);
    const editImage: ChatImage | null = imageCapable
      ? {
          dataBase64: bytesToBase64(bytes),
          mimeType: mime,
          fileName: fallbackFileName(mime),
          messageId: 0,
        }
      : null;
    const prompt = imageCapable
      ? `【图像区图片处理请求】随这条消息附带了一张图片，请按下面的要求修改这张图片，并把修改后的图片作为回复生成出来。要求是：${instruction}`
      : `【图像区图片处理请求】用户请你修改一张图片，要求是：${instruction}\n` +
        `重要说明：这个通道只能发送文字，图片文件本身没有附带，你看不到这张原图。` +
        `如果你在看不到原图的情况下无法完成修改，请直接如实说明你需要原图或无法修改，不要虚构修改结果。`;
    let sr: WebChatResult;
    try {
      if (agent.provider === "qwen") {
        sr = await chatQwen(agent.webToken.trim(), prompt, {
          cookie: agent.webCookie,
          ua: agent.webUserAgent,
        });
      } else if (agent.provider === "doubao") {
        sr = await chatDoubao(agent.webToken.trim(), prompt, agent.webDeviceId, {
          menu: doubaoMenuOf(agent),
          modelKey: doubaoSelectedKey(agent),
          reasoning: agent.webReasoning,
          search: agent.webSearch === 1,
        });
      } else {
        const chatter = WEB_CHATTERS[agent.provider];
        if (!chatter)
          return {
            ok: false,
            reason: `${agentName}的网页版通道暂不支持发送请求，这次没有发给它。`,
            agentName,
          };
        sr = await chatter(
          agent.webToken.trim(),
          prompt,
          agent.webDeviceId,
          undefined,
          editImage,
        );
      }
    } catch (e) {
      return {
        ok: false,
        reason: `${agentName}这次请求失败：${e instanceof Error ? e.message : "网络错误"}`,
        agentName,
      };
    }
    if (!sr.ok) {
      if (sr.kind !== "error")
        await dsMarkWebStatus(ctx, agent.id, sr.kind, sr.error);
      return {
        ok: false,
        reason: `${agentName}没有完成这次请求：${sr.error}`,
        agentName,
      };
    }
    await dsMarkWebOk(ctx, agent.id);
    if (sr.refreshedToken && sr.refreshedToken !== agent.webToken) {
      try {
        await db
          .update(schema.agents)
          .set({ webToken: sr.refreshedToken })
          .where(eq(schema.agents.id, agent.id));
      } catch {
        // best effort, same as the chat path
      }
    }
    const said = sr.text.trim().slice(0, 240);
    if (imageCapable) {
      // The agent received the picture itself; a picture it
      // generated back IS the edit — download its bytes (the
      // same data:/URL handling storeReplyMedia uses) and hand
      // them to the caller as the replacement image.
      const pic = (sr.media ?? []).find((m) => m.kind === "image");
      if (pic) {
        try {
          let picBytes: Uint8Array | null = null;
          let picMime = "";
          if (pic.url.startsWith("data:")) {
            const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(pic.url);
            if (m && m[2]) {
              picMime = (m[1] ?? "").trim().toLowerCase();
              const buf = Buffer.from(m[3] ?? "", "base64");
              if (buf.byteLength > 0 && buf.byteLength <= REPLY_MEDIA_MAX_BYTES)
                picBytes = new Uint8Array(buf);
            }
          } else {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 60_000);
            try {
              const res = await agentFetch(pic.url, {
                headers: {
                  "User-Agent": WEB_UA,
                  Referer: pic.referer ?? "https://chatgpt.com/",
                },
                signal: ctrl.signal,
              });
              if (res.ok) {
                picMime = (res.headers.get("content-type") ?? "")
                  .split(";")[0]
                  ?.trim()
                  .toLowerCase() ?? "";
                const buf = await res.arrayBuffer();
                if (buf.byteLength > 0 && buf.byteLength <= REPLY_MEDIA_MAX_BYTES)
                  picBytes = new Uint8Array(buf);
              }
            } finally {
              clearTimeout(timer);
            }
          }
          if (picBytes && picMime.startsWith("image/"))
            return { ok: true, bytes: picBytes, mime: picMime, agentName };
        } catch {
          // fall through to the honest no-replacement reason
        }
      }
      return {
        ok: false,
        reason:
          `${agentName}收到了这张图片并回复了：${said || "（没有文字回复）"}` +
          `但它这次没有返回修改后的图片，所以没有替换图片。`,
        agentName,
      };
    }
    return {
      ok: false,
      reason:
        `${agentName}回复了：${said || "（没有文字回复）"}` +
        `它通过网页版通道没有收到图片文件本身，所以这次没有替换图片。` +
        (sr.media?.length
          ? "它另外生成的图片不是基于这张原图的修改，未采用。"
          : ""),
      agentName,
    };
  }
  const base = agent.apiBase.trim().replace(/\/+$/, "");
  const key = agent.apiKey.trim();
  if (!base || !key)
    return {
      ok: false,
      reason: `${agentName}还没有配置 API 地址和密钥，无法处理图片`,
      agentName,
    };
  if (!agent.model.trim())
    return {
      ok: false,
      reason: `${agentName}还没有设置模型，无法处理图片`,
      agentName,
    };
  const model = agent.model.trim();
  const viaEdits = await editImageViaProviderApi({
    base,
    key,
    model,
    bytes,
    mime,
    instruction,
  });
  if (viaEdits.ok) return { ok: true, bytes: viaEdits.bytes, mime: viaEdits.mime, agentName };
  const viaChat = await editImageViaChatApi({
    base,
    key,
    model,
    bytes,
    mime,
    instruction,
  });
  if (viaChat.ok) return { ok: true, bytes: viaChat.bytes, mime: viaChat.mime, agentName };
  const strip = (s: string) => s.replace(/。?这一份没有改动。?$/, "");
  return {
    ok: false,
    reason: `已把图片发给${agentName}：图片编辑接口——${strip(viaEdits.error)}；对话改图——${viaChat.error}。图片没有改动。`,
    agentName,
  };
}

const imageAgentEditResponse = z.object({
  ok: z.boolean(),
  replaced: z.boolean(),
  reason: z.string(),
  part: imagePartOut.nullable(),
  project: imageProjectOut.nullable(),
});

/**
 * Runs one agent image operation on one target of a 图像 project
 * — exactly one grid part (partId set) or the whole current image
 * (partId null) — through attemptImageEditWithAgent, and stores a
 * returned image in exactly that target's place: a part replaces
 * only its own blob (edited bookkeeping like before); a whole
 * image becomes the project's edited copy while the pristine
 * upload stays untouched. The other target's bytes are never read
 * for sending and never modified.
 */
async function runAgentImageEdit(
  ctx: Ctx,
  args: {
    projectId: number;
    partId: number | null;
    agentId: number | null;
    instruction: string;
    recordInstruction: string;
  },
): Promise<z.infer<typeof imageAgentEditResponse>> {
  const db = ctx.db<typeof schema>();
  const projRows = await db
    .select()
    .from(schema.imageProjects)
    .where(eq(schema.imageProjects.id, args.projectId));
  const project = projRows[0];
  const fail = async (
    reason: string,
  ): Promise<z.infer<typeof imageAgentEditResponse>> => {
    let part: z.infer<typeof imagePartOut> | null = null;
    if (args.partId != null) {
      const pr = await db
        .select()
        .from(schema.imageParts)
        .where(eq(schema.imageParts.id, args.partId));
      if (pr[0]) part = await toImagePartOut(ctx, pr[0]);
    }
    return {
      ok: false,
      replaced: false,
      reason,
      part,
      project: project ? await toImageProjectOut(ctx, db, project) : null,
    };
  };
  if (!project) return fail("这张图不存在，可能已被删除");
  let part: ImagePartRow | null = null;
  if (args.partId != null) {
    const partRows = await db
      .select()
      .from(schema.imageParts)
      .where(eq(schema.imageParts.id, args.partId));
    part = partRows[0] ?? null;
    if (!part || part.projectId !== project.id)
      return fail("选中的这一份不存在，请重新切分后再试");
  }
  // Read ONLY the target's bytes — the whole image when no part
  // is chosen, exactly the chosen part when one is. Nothing else
  // about the project leaves the space in this call.
  const sourceKey = part
    ? part.blobKey
    : (project.editedBlobKey ?? project.originalBlobKey);
  const read = await ctx.executePrivileged(privileged.readBlobBytes, {
    key: sourceKey,
  });
  if (!read.ok) return fail(read.error || "读取图片失败，请重试");
  const srcBytes = base64ToBytes(read.dataBase64);
  const srcMime =
    read.contentType || (part ? part.mime : (project.editedMime ?? project.mime)) || "image/png";
  const attempt = await attemptImageEditWithAgent(
    ctx,
    db,
    args.agentId,
    srcBytes,
    srcMime,
    args.instruction,
  );
  if (!attempt.ok) return fail(attempt.reason);
  const ext =
    attempt.mime === "image/jpeg"
      ? "jpg"
      : attempt.mime === "image/webp"
        ? "webp"
        : "png";
  const editedSize = imageSizeFromBytes(attempt.bytes);
  if (part) {
    const newKey = `image-parts/${project.id}/${part.id}-edited-${Date.now()}.${ext}`;
    await ctx.blobs.put(newKey, attempt.bytes, { contentType: attempt.mime });
    await db
      .update(schema.imageParts)
      .set({
        blobKey: newKey,
        mime: attempt.mime,
        width: editedSize?.width ?? null,
        height: editedSize?.height ?? null,
        sizeBytes: attempt.bytes.length,
        edited: 1,
        editAgent: attempt.agentName,
        editInstruction: args.recordInstruction,
        updatedAt: new Date(),
      })
      .where(eq(schema.imageParts.id, part.id));
    if (part.blobKey.startsWith("image-parts/")) {
      await ctx.blobs.delete(part.blobKey).catch(() => undefined);
    }
  } else {
    const newKey = `image-projects/${project.id}-edited-${Date.now()}.${ext}`;
    await ctx.blobs.put(newKey, attempt.bytes, { contentType: attempt.mime });
    await db
      .update(schema.imageProjects)
      .set({
        editedBlobKey: newKey,
        editedMime: attempt.mime,
        width: editedSize?.width ?? project.width,
        height: editedSize?.height ?? project.height,
        sizeBytes: attempt.bytes.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.imageProjects.id, project.id));
    if (project.editedBlobKey) {
      await ctx.blobs.delete(project.editedBlobKey).catch(() => undefined);
    }
  }
  await db
    .update(schema.imageProjects)
    .set({ updatedAt: new Date() })
    .where(eq(schema.imageProjects.id, project.id));
  ctx.invalidateQueries();
  const freshProj = await db
    .select()
    .from(schema.imageProjects)
    .where(eq(schema.imageProjects.id, project.id));
  const updatedProject = freshProj[0];
  let updatedPart: z.infer<typeof imagePartOut> | null = null;
  if (part) {
    const freshPart = await db
      .select()
      .from(schema.imageParts)
      .where(eq(schema.imageParts.id, part.id));
    if (freshPart[0]) updatedPart = await toImagePartOut(ctx, freshPart[0]);
  }
  return {
    ok: true,
    replaced: true,
    reason: "",
    part: updatedPart,
    project: updatedProject
      ? await toImageProjectOut(ctx, db, updatedProject)
      : null,
  };
}

const codeFileOut = z.object({
id: z.number(),
name: z.string(),
path: z.string(),
isFolder: z.boolean(),
language: z.string(),
content: z.string(),
agentAccess: z.boolean(),
createdAt: z.string(),
updatedAt: z.string(),
});

type CodeFileRow = typeof schema.codeFiles.$inferSelect;

function toCodeFileOut(r: CodeFileRow): z.infer<typeof codeFileOut> {
return {
id: r.id,
name: r.name,
path: r.path || r.name,
isFolder: r.isFolder === 1,
language: r.language,
content: r.content,
agentAccess: r.agentAccess === 1,
createdAt: r.createdAt.toISOString(),
updatedAt: r.updatedAt.toISOString(),
};
}

async function saveCodeVersion(
db: Db,
file: CodeFileRow,
source: string,
note: string,
): Promise<void> {
await db.insert(schema.codeVersions).values({
fileId: file.id,
content: file.content,
name: file.name,
language: file.language,
source,
note,
});
}

/** Recursively inserts one prompt-tag seed tree (used by the
 * first-read seeding in getPromptTree and by resetPromptTree's
 * restore of the initial state). */
async function insertPromptSeed(
db: Db,
seed: PromptTagSeed,
parentId: number | null,
sort: number,
): Promise<void> {
const inserted = await db
.insert(schema.promptTags)
.values({ parentId, label: seed.label, value: seed.value, sort })
.returning();
const row = inserted[0];
if (!row) throw new Error("标签初始化失败，请重试");
const children = seed.children ?? [];
for (let i = 0; i < children.length; i++) {
const child = children[i];
if (child) await insertPromptSeed(db, child, row.id, i);
}
}

/** The sidebar menu's entry keys, in the built-in default order:
 * the three sections, then the workspace entries that hang under
 * 智能体 in the default layout. The user's long-press-drag order
 * is stored on the profile row as a JSON array of these keys. */
const MENU_ORDER_KEYS = [
"agents",
"creation",
"code",
"image",
"browser",
"vault",
"monitor",
"ledger",
"files",
"vpn",
] as const;

/** Sanitizes a stored/requested menu order: known keys only,
 * no duplicates, and any key the list is missing (e.g. an entry
 * added after the user saved an order) appended in the default
 * order — so the result always names every entry exactly once. */
function sanitizeMenuOrder(raw: unknown): string[] {
const out: string[] = [];
if (Array.isArray(raw)) {
for (const v of raw) {
if (
typeof v === "string" &&
(MENU_ORDER_KEYS as readonly string[]).includes(v) &&
!out.includes(v)
) {
out.push(v);
}
}
}
for (const k of MENU_ORDER_KEYS) {
if (!out.includes(k)) out.push(k);
}
return out;
}

function parseMenuOrder(stored: string): string[] {
try {
return sanitizeMenuOrder(JSON.parse(stored || "[]") as unknown);
} catch {
return sanitizeMenuOrder([]);
}
}

/* ---------------- password vault helpers ---------------- */

/** The vault's fixed category keys, in the pane's group order:
 * the list is sorted by this order first （按类型排序）, then
 * favorites, then most recently updated. */
const VAULT_CATEGORIES = [
"website",
"email",
"social",
"finance",
"shopping",
"work",
"game",
"other",
] as const;

function vaultCategoryOf(v: string): string {
  return (VAULT_CATEGORIES as readonly string[]).includes(v) ? v : "other";
}

/** Hostname of a URL or bare domain text ('' when unparseable). */
function vaultDomainOf(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
      .hostname.toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Best-effort category for a browser-captured credential, from
 * the site's domain keywords; the user can re-file it in the
 * pane at any time. No keyword match = 网站登录 (website). */
function classifyVaultDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (/(^|\.)(gmail|outlook|hotmail|yahoo|icloud|qq|163|126|sina|foxmail)\.|mail\./.test(d))
    return "email";
  if (/bank|pay|alipay|paypal|stripe|unionpay|credit|finance|证券|银行/.test(d))
    return "finance";
  if (/facebook|instagram|twitter|x\.com|weibo|wechat|telegram|discord|tiktok|douyin|xiaohongshu|bilibili|zhihu/.test(d))
    return "social";
  if (/taobao|tmall|jd\.|pinduoduo|amazon|ebay|shopee|shop|mall/.test(d))
    return "shopping";
  if (/steam|epicgames|playstation|xbox|nintendo|game|miyoushe|hoyolab/.test(d))
    return "game";
  if (/github|gitlab|notion|slack|figma|office|docs\.|drive\.|dropbox/.test(d))
    return "work";
  return "website";
}

type VaultStateRow = typeof schema.vaultState.$inferSelect;

/** Loads the vault preferences singleton, creating it on first use. */
async function loadVaultState(db: Db): Promise<VaultStateRow> {
  const rows = await db
    .select()
    .from(schema.vaultState)
    .where(eq(schema.vaultState.id, 1));
  const existing = rows[0];
  if (existing) return existing;
  await db.insert(schema.vaultState).values({ id: 1 });
  const again = await db
    .select()
    .from(schema.vaultState)
    .where(eq(schema.vaultState.id, 1));
  const row = again[0];
  if (!row) throw new Error("loadVaultState: failed to create vault state row");
  return row;
}

/** Records one browser request into the 抓包 (capture) table —
 * the requests this server makes for the in-space browser.
 * Called only when the browser pane supplied a capture id;
 * old rows are pruned to the newest 2000 globally. */
async function recordBrowserCapture(
  ctx: Ctx,
  rec: {
    capId: string;
    method: string;
    url: string;
    kind: string;
    status: number;
    size: number;
    durationMs: number;
    contentType: string;
    reqHeaders: [string, string][];
    resHeaders: [string, string][];
    reqBody: string;
    resBody: string;
    timings: unknown;
  },
): Promise<void> {
  if (!rec.capId) return;
  try {
    const db = ctx.db<typeof schema>();
    await db.insert(schema.browserCapture).values({
      capId: rec.capId,
      ts: Date.now(),
      method: rec.method,
      url: rec.url.slice(0, 4000),
      kind: rec.kind,
      status: rec.status,
      size: rec.size,
      durationMs: rec.durationMs,
      contentType: rec.contentType.slice(0, 200),
      reqHeaders: JSON.stringify(rec.reqHeaders),
      resHeaders: JSON.stringify(rec.resHeaders),
      reqBody: rec.reqBody.slice(0, 65536),
      resBody: rec.resBody.slice(0, 65536),
      timings: rec.timings ? JSON.stringify(rec.timings) : "",
    });
    await db.run(
      sql`DELETE FROM browser_capture WHERE id NOT IN (SELECT id FROM browser_capture ORDER BY id DESC LIMIT 2000)`,
    );
  } catch {
    // Capture is observability, never a reason to fail the
    // request it describes.
  }
}

/* ---------------- in-space browser cookie jar ----------------
 * The browser's cookies live server-side (browser_cookies):
 * every server fetch for the browser is seeded with the jar
 * and every hop's Set-Cookie is folded back into it, so a site
 * the user logs into inside the space stays logged in — the
 * frame itself runs on an opaque origin and can never hold
 * real cookies of its own. */

/** Loads the whole jar as privileged-fetch seed records
 * (expired rows are skipped; the jar is one user's browser,
 * so it stays small). */
async function loadBrowserCookieJar(
  ctx: Ctx,
): Promise<
  { domain: string; name: string; value: string; path: string; secure: boolean }[]
> {
  try {
    // 兼容设置 → 启用 Cookie / 持久化会话 off: the jar is
    // never sent — pages browse cookieless until it is on.
    const compat = await loadBrowserCompatSettings(ctx);
    if (!compat.cookiesEnabled) return [];
    const db = ctx.db<typeof schema>();
    const now = Date.now();
    const rows = await db.select().from(schema.browserCookies).limit(500);
    return rows
      .filter((r) => r.expiresAt == null || r.expiresAt > now)
      .map((r) => ({
        domain: r.domain,
        name: r.name,
        value: r.value,
        path: r.path || "/",
        secure: r.secure === 1,
      }));
  } catch {
    return [];
  }
}

function browserDefaultCookiePath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const idx = pathname.lastIndexOf("/");
  return idx <= 0 ? "/" : pathname.slice(0, idx);
}

/** Parses one raw Set-Cookie value against the URL of the hop
 * that sent it. Returns null for values without a name. */
function parseSetCookieValue(
  raw: string,
  requestUrl: string,
): {
  domain: string;
  name: string;
  value: string;
  path: string;
  expiresAt: number | null;
  secure: boolean;
  httpOnly: boolean;
  remove: boolean;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  const parts = raw.split(";");
  const first = (parts[0] ?? "").trim();
  const eqIdx = first.indexOf("=");
  if (eqIdx <= 0) return null;
  const name = first.slice(0, eqIdx).trim();
  if (!name) return null;
  const value = first.slice(eqIdx + 1).trim();
  let domain = parsed.hostname.toLowerCase();
  let path = browserDefaultCookiePath(parsed.pathname || "/");
  let expiresAt: number | null = null;
  let secure = false;
  let httpOnly = false;
  let remove = false;
  let maxAgeSeen = false;
  for (const attrRaw of parts.slice(1)) {
    const attr = attrRaw.trim();
    const aeq = attr.indexOf("=");
    const an = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
    const av = aeq >= 0 ? attr.slice(aeq + 1).trim() : "";
    if (an === "domain" && av) domain = av.replace(/^\./, "").toLowerCase();
    else if (an === "path" && av.startsWith("/")) path = av;
    else if (an === "secure") secure = true;
    else if (an === "httponly") httpOnly = true;
    else if (an === "max-age") {
      const n = Number(av);
      if (Number.isFinite(n)) {
        maxAgeSeen = true;
        if (n <= 0) remove = true;
        else expiresAt = Date.now() + n * 1000;
      }
    } else if (an === "expires" && !maxAgeSeen) {
      const t = Date.parse(av);
      if (Number.isFinite(t)) {
        expiresAt = t;
        if (t <= Date.now()) remove = true;
      }
    }
  }
  return { domain, name, value, path, expiresAt, secure, httpOnly, remove };
}

/** Persists the Set-Cookie values a privileged fetch collected
 * (grouped by hop URL) into the jar. Never throws: cookie
 * bookkeeping must not fail the page load it belongs to. */
async function persistBrowserSetCookies(
  ctx: Ctx,
  setCookies: { url: string; values: string[] }[],
): Promise<void> {
  if (setCookies.length === 0) return;
  // Cookie switch off: Set-Cookie is dropped, never stored.
  try {
    const compat = await loadBrowserCompatSettings(ctx);
    if (!compat.cookiesEnabled) return;
  } catch {
    return;
  }
  try {
    const db = ctx.db<typeof schema>();
    for (const hop of setCookies) {
      for (const raw of hop.values) {
        const c = parseSetCookieValue(raw, hop.url);
        if (!c) continue;
        const existing = await db
          .select()
          .from(schema.browserCookies)
          .where(
            and(
              eq(schema.browserCookies.domain, c.domain),
              eq(schema.browserCookies.name, c.name),
              eq(schema.browserCookies.path, c.path),
            ),
          );
        const row = existing[0];
        if (c.remove) {
          if (row) {
            await db
              .delete(schema.browserCookies)
              .where(eq(schema.browserCookies.id, row.id));
          }
          continue;
        }
        if (row) {
          await db
            .update(schema.browserCookies)
            .set({
              value: c.value,
              expiresAt: c.expiresAt,
              secure: c.secure ? 1 : 0,
              httpOnly: c.httpOnly ? 1 : 0,
              updatedAt: Date.now(),
            })
            .where(eq(schema.browserCookies.id, row.id));
        } else {
          await db.insert(schema.browserCookies).values({
            domain: c.domain,
            name: c.name,
            value: c.value,
            path: c.path,
            expiresAt: c.expiresAt,
            secure: c.secure ? 1 : 0,
            httpOnly: c.httpOnly ? 1 : 0,
            updatedAt: Date.now(),
          });
        }
      }
    }
  } catch {
    // see docstring
  }
}

/** The document.cookie string a page at `urlStr` may see:
 * matching, unexpired, non-HttpOnly jar cookies. HttpOnly
 * cookies never leave the server — the page's own scripts
 * must not read them, exactly like a real browser. */
async function browserPageCookieString(
  ctx: Ctx,
  urlStr: string,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return "";
  }
  try {
    const compat = await loadBrowserCompatSettings(ctx);
    if (!compat.cookiesEnabled) return "";
    const db = ctx.db<typeof schema>();
    const now = Date.now();
    const host = url.hostname.toLowerCase();
    const path = url.pathname || "/";
    const rows = await db.select().from(schema.browserCookies).limit(500);
    const byName = new Map<string, string>();
    for (const r of rows) {
      if (r.httpOnly === 1) continue;
      if (r.expiresAt != null && r.expiresAt <= now) continue;
      if (r.secure === 1 && url.protocol !== "https:") continue;
      if (host !== r.domain && !host.endsWith(`.${r.domain}`)) continue;
      if (!path.startsWith(r.path || "/")) continue;
      byName.set(r.name, r.value);
    }
    return [...byName.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  } catch {
    return "";
  }
}

/** Stored localStorage items for one page origin, used to seed
 * the in-page storage shim before the page's scripts run. */
async function loadBrowserPageStorage(
  ctx: Ctx,
  urlStr: string,
): Promise<{ key: string; value: string }[]> {
  let origin = "";
  try {
    origin = new URL(urlStr).origin;
  } catch {
    return [];
  }
  if (!origin || origin === "null") return [];
  try {
    // 持久化会话 is part of the same Cookie switch: off =
    // no stored page storage is seeded either.
    const compat = await loadBrowserCompatSettings(ctx);
    if (!compat.cookiesEnabled) return [];
    const db = ctx.db<typeof schema>();
    const rows = await db
      .select()
      .from(schema.browserPageStorage)
      .where(eq(schema.browserPageStorage.origin, origin))
      .limit(200);
    return rows.map((r) => ({ key: r.key, value: r.value }));
  } catch {
    return [];
  }
}

// ---------------- 浏览器设备模式 (browser device mode) -------
// The identity the in-space browser presents to websites,
// chosen in 浏览器 → 设置 → 设备模式： 'desktop' （电脑）,
// 'android' （安卓） or 'ios' （苹果）. One profile drives three
// things that must agree with each other: the User-Agent and
// Sec-CH-UA hints on every server-side fetch (page loads and
// the in-page network bridge alike), and the navigator
// identity the injected bootstrap shows the page's own
// scripts. Before this existed the fetch claimed a desktop
// Mac while the page's scripts still saw the phone's real
// navigator — sites that branch on the script-visible UA
// (mobile app-guide overlays, mobile redirects) flashed their
// desktop page for an instant and then covered it with a
// black mobile overlay. The profiles are fixed strings: a
// page can never supply or influence them.
type BrowserDeviceMode = "desktop" | "android" | "ios";
type BrowserDeviceProfile = {
  ua: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  navPlatform: string;
  maxTouchPoints: number;
  // navigator.userAgentData as the real device's browser
  // would expose it; null = the property does not exist
  // (iOS Safari has no UA-CH API).
  uaData: { mobile: boolean; platform: string } | null;
};
const BROWSER_DEVICE_PROFILES: Record<BrowserDeviceMode, BrowserDeviceProfile> = {
  desktop: {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    navPlatform: "Win32",
    maxTouchPoints: 0,
    uaData: { mobile: false, platform: "Windows" },
  },
  android: {
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    navPlatform: "Linux armv8l",
    maxTouchPoints: 5,
    uaData: { mobile: true, platform: "Android" },
  },
  ios: {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    secChUaMobile: "",
    secChUaPlatform: "",
    navPlatform: "iPhone",
    maxTouchPoints: 5,
    uaData: null,
  },
};

/** 操作一 compat UA: the standard desktop Chrome identity the
 * user asked the space browser to present — Linux x86_64,
 * Chrome 131. It is the one-click preset in 浏览器 → 设置 →
 * 兼容设置 and the value migration 0076 stores on an existing
 * settings row; a fresh install with no row yet also resolves
 * to it (see loadBrowserCompatSettings defaults), so the fix
 * is already applied before the user ever opens the panel. */
const BROWSER_RECOMMENDED_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type BrowserCompatSettings = {
  deviceMode: BrowserDeviceMode;
  customUserAgent: string;
  effectiveUserAgent: string;
  cookiesEnabled: boolean;
  ignoreCertErrors: boolean;
  profile: BrowserDeviceProfile;
};

/** Derives the full device profile for a custom UA string:
 * the UA itself is used verbatim on the wire and in
 * navigator; platform / touch / UA-CH hints follow what the
 * string claims (Linux desktop for the recommended UA), so
 * the three views of the identity never contradict. */
function profileForCustomUa(
  ua: string,
  base: BrowserDeviceProfile,
): BrowserDeviceProfile {
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  let platform = base.uaData?.platform ?? "Windows";
  let navPlatform = base.navPlatform;
  let secPlatform = base.secChUaPlatform;
  if (/Android/i.test(ua)) {
    platform = "Android";
    navPlatform = "Linux armv8l";
    secPlatform = '"Android"';
  } else if (/iPhone|iPad/i.test(ua)) {
    return {
      ua,
      secChUaMobile: "",
      secChUaPlatform: "",
      navPlatform: "iPhone",
      maxTouchPoints: 5,
      uaData: null,
    };
  } else if (/Linux/i.test(ua)) {
    platform = "Linux";
    navPlatform = "Linux x86_64";
    secPlatform = '"Linux"';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    platform = "macOS";
    navPlatform = "MacIntel";
    secPlatform = '"macOS"';
  } else if (/Windows/i.test(ua)) {
    platform = "Windows";
    navPlatform = "Win32";
    secPlatform = '"Windows"';
  }
  const chromeMajor = /Chrome\/(\d+)/.exec(ua)?.[1];
  return {
    ua,
    secChUaMobile: isMobile ? "?1" : "?0",
    secChUaPlatform: secPlatform,
    navPlatform,
    maxTouchPoints: isMobile ? 5 : 0,
    uaData: { mobile: isMobile, platform },
    ...(chromeMajor ? {} : {}),
  };
}

/** Loads the full browser compat settings (0076): device
 * mode + custom UA + Cookie/持久化会话 switch + 忽略证书错误
 * switch. No stored row yet = the 操作一 applied state:
 * recommended desktop Chrome UA, cookies on, cert errors
 * ignored — a fresh space already browses the fixed way. */
async function loadBrowserCompatSettings(
  ctx: Ctx,
): Promise<BrowserCompatSettings> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.browserState)
    .where(eq(schema.browserState.id, 1));
  const row = rows[0];
  const deviceMode: BrowserDeviceMode =
    row?.deviceMode === "android" || row?.deviceMode === "ios"
      ? row.deviceMode
      : "desktop";
  const base = BROWSER_DEVICE_PROFILES[deviceMode];
  if (!row) {
    const profile = profileForCustomUa(BROWSER_RECOMMENDED_UA, base);
    return {
      deviceMode,
      customUserAgent: BROWSER_RECOMMENDED_UA,
      effectiveUserAgent: BROWSER_RECOMMENDED_UA,
      cookiesEnabled: true,
      ignoreCertErrors: true,
      profile,
    };
  }
  const customUserAgent = (row.customUserAgent ?? "").trim();
  const profile = customUserAgent
    ? profileForCustomUa(customUserAgent, base)
    : base;
  return {
    deviceMode,
    customUserAgent,
    effectiveUserAgent: profile.ua,
    cookiesEnabled: row.cookiesEnabled !== 0,
    ignoreCertErrors: row.ignoreCertErrors === 1,
    profile,
  };
}

async function loadBrowserDeviceMode(ctx: Ctx): Promise<BrowserDeviceMode> {
  return (await loadBrowserCompatSettings(ctx)).deviceMode;
}

/** Decodes the HTML entities that matter for readable text
 * (named basics + numeric forms); unknown entities are left
 * as-is rather than dropped. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const n = Number.parseInt(dec, 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/** 纯文本模式 extraction: reduces one fetched HTML page to
 * plain readable text plus its links. Every script, style,
 * noscript, iframe, svg and form is removed outright — in
 * text mode JavaScript is disabled, so nothing of the page
 * ever runs; block-level tags become line breaks so the
 * text keeps its paragraph shape. Links are collected in
 * document order (resolved against the final URL, http/https
 * only, de-duplicated by URL, capped at 200) so the shell
 * can still offer navigation without any page markup. */
function htmlToPlainText(
  rawHtml: string,
  baseUrl: string,
): {
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
} {
  let work = rawHtml;
  // Links first, before any tag stripping.
  const links: { text: string; url: string }[] = [];
  const seenLinks = new Set<string>();
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(work)) !== null) {
    const href = decodeHtmlEntities(
      (am[1] ?? am[2] ?? am[3] ?? "").trim(),
    );
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    let abs = "";
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(abs) || seenLinks.has(abs)) continue;
    seenLinks.add(abs);
    const label = decodeHtmlEntities(
      (am[4] ?? "").replace(/<[^>]*>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    links.push({ text: label, url: abs });
    if (links.length >= 200) break;
  }
  // Drop everything that is not readable text.
  work = work
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ");
  // Block structure → line breaks; list items get a bullet.
  work = work
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(
      /<\/(p|div|section|article|header|footer|main|h1|h2|h3|h4|h5|h6|li|tr|blockquote|pre|table|ul|ol|figure|figcaption)>/gi,
      "\n\n",
    )
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]*>/g, "");
  let text = decodeHtmlEntities(work);
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const CAP = 120000;
  const truncated = text.length > CAP;
  if (truncated) text = text.slice(0, CAP);
  return { text, links, truncated };
}



/** The bootstrap injected into <head> of every page the
 * in-space browser renders, BEFORE any of the page's own
 * scripts (the body interceptor arrives too late for this).
 * The frame runs on an opaque origin, where a modern site's
 * boot sequence dies three deaths: localStorage/sessionStorage
 * throw, document.cookie is empty, and fetch/XHR go out
 * cross-origin without cookies and are refused. The bootstrap
 * removes all three:
 *  - Web Storage is shimmed with a store seeded from the
 *    server's per-origin rows; changes are reported to the
 *    shell and persisted server-side.
 *  - document.cookie is shimmed over the jar's non-HttpOnly
 *    cookies for the page's origin; writes are reported to
 *    the shell and folded into the server-side jar.
 *  - fetch and XMLHttpRequest are relayed through the shell
 *    to fetchBrowserResource, which runs them server-side
 *    with the cookie jar — the site's API calls behave as if
 *    the page were open in a real browser on its own origin.
 *  - history.pushState/replaceState failures (an opaque
 *    origin cannot take the page's URLs) are swallowed so SPA
 *    routers do not crash on navigation.
 *  - navigator presents the browser's chosen device mode
 *    （电脑 / 安卓 / 苹果） so the page's scripts agree with
 *    the identity the server fetched the page under.
 * WebSocket and EventSource are NOT relayed (no honest way to
 * tunnel them through this channel); sites that hard-require
 * them still fail, and the tab shows the real error. */
function browserBootstrapScript(
  pageUrl: string,
  cookieString: string,
  storageItems: { key: string; value: string }[],
  device: BrowserDeviceProfile,
): string {
  const storageObj: Record<string, string> = {};
  for (const it of storageItems) storageObj[it.key] = it.value;
  const seedJson = JSON.stringify(storageObj).replace(/</g, "\\u003c");
  const cookieJson = JSON.stringify(cookieString).replace(/</g, "\\u003c");
  const urlJson = JSON.stringify(pageUrl).replace(/</g, "\\u003c");
  const uaJson = JSON.stringify(device.ua).replace(/</g, "\\u003c");
  const navPlatformJson = JSON.stringify(device.navPlatform).replace(/</g, "\\u003c");
  const uaDataJson = JSON.stringify(device.uaData).replace(/</g, "\\u003c");
  // UA-CH brand/full versions follow the UA's own Chrome
  // version (126 for the built-in profiles, 131 for the
  // recommended compat UA) so navigator.userAgentData never
  // contradicts navigator.userAgent.
  const chromeVer = /Chrome\/(\d+)(?:\.([\d.]*))?/.exec(device.ua);
  const brandMajor = chromeVer?.[1] ?? "126";
  const brandFull = chromeVer?.[2] ? `${brandMajor}.${chromeVer[2]}` : `${brandMajor}.0.0.0`;
  const brandMajorJson = JSON.stringify(brandMajor);
  const brandFullJson = JSON.stringify(brandFull);
  const js =
    "(function(){" +
    "var PAGE_URL=" + urlJson + ";" +
    "var PAGE_ORIGIN='';try{PAGE_ORIGIN=new URL(PAGE_URL).origin;}catch(e){}" +
    "var SEED_STORAGE=" + seedJson + ";" +
    "var SEED_COOKIE=" + cookieJson + ";" +
    // ---------- Web Storage shim ----------
    "function makeStore(seed,persist){" +
    "var m=new Map();try{var o=seed||{};for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k))m.set(String(k),String(o[k]));}}catch(e){}" +
    "var saveT=null;" +
    "function save(){if(!persist)return;if(saveT)return;saveT=setTimeout(function(){saveT=null;try{var items=[];m.forEach(function(v,kk){items.push({key:kk,value:v});});parent.postMessage({__museBrowser:'storage',origin:PAGE_ORIGIN,items:items.slice(0,200)},'*');}catch(e){}},700);}" +
    "var store={};" +
    "Object.defineProperty(store,'length',{get:function(){return m.size;}});" +
    "store.getItem=function(k){k=String(k);return m.has(k)?m.get(k):null;};" +
    "store.setItem=function(k,v){m.set(String(k),String(v));save();};" +
    "store.removeItem=function(k){m.delete(String(k));save();};" +
    "store.clear=function(){m.clear();save();};" +
    "store.key=function(i){var ks=[];m.forEach(function(v,kk){ks.push(kk);});return i>=0&&i<ks.length?ks[i]:null;};" +
    "return store;}" +
    "try{Object.defineProperty(window,'localStorage',{value:makeStore(SEED_STORAGE,true),configurable:true,writable:true});}catch(e){}" +
    "try{Object.defineProperty(window,'sessionStorage',{value:makeStore({},false),configurable:true,writable:true});}catch(e){}" +
    // ---------- document.cookie shim ----------
    "try{" +
    "var ckMap=new Map();" +
    "(function(){var s=SEED_COOKIE||'';if(!s)return;s.split(';').forEach(function(p){var i=p.indexOf('=');if(i>0){ckMap.set(p.slice(0,i).trim(),p.slice(i+1).trim());}});})();" +
    "Object.defineProperty(Document.prototype,'cookie',{" +
    "configurable:true," +
    "get:function(){var out=[];ckMap.forEach(function(v,k){out.push(k+'='+v);});return out.join('; ');}," +
    "set:function(v){var s=String(v);var first=s.split(';')[0];var i=first.indexOf('=');if(i>0){var n=first.slice(0,i).trim();var val=first.slice(i+1).trim();var expired=false;var rest=s.slice(first.length);var ma=/;\\s*max-age=(-?\\d+)/i.exec(rest);if(ma&&Number(ma[1])<=0)expired=true;var ex=/;\\s*expires=([^;]+)/i.exec(rest);if(ex){var t=Date.parse(ex[1]);if(isFinite(t)&&t<=Date.now())expired=true;}if(expired)ckMap.delete(n);else ckMap.set(n,val);}" +
    "try{parent.postMessage({__museBrowser:'setCookie',url:PAGE_URL,value:s},'*');}catch(e){}" +
    "}});" +
    "}catch(e){}" +
    // ---------- history crash guard ----------
    "try{var ohp=history.pushState.bind(history);history.pushState=function(){try{return ohp.apply(null,arguments);}catch(e){}};}catch(e){}" +
    "try{var ohr=history.replaceState.bind(history);history.replaceState=function(){try{return ohr.apply(null,arguments);}catch(e){}};}catch(e){}" +
    // ---------- device identity (navigator) ----------
    // The page's scripts must see the SAME device the server
    // claimed when fetching (浏览器设置 → 设备模式）: a site
    // that branches on navigator.userAgent — mobile app-guide
    // overlays, mobile redirects, player selection — otherwise
    // takes the mobile branch over a desktop-fetched page and
    // covers it with a black overlay after the first paint.
    "try{" +
    "var DEV_UA=" + uaJson + ",DEV_PLAT=" + navPlatformJson + ",DEV_TOUCH=" + String(device.maxTouchPoints) + ",DEV_UAD=" + uaDataJson + ";" +
    "function devDef(prop,val){try{Object.defineProperty(window.navigator,prop,{get:function(){return val;},configurable:true});}catch(e){}}" +
    "devDef('userAgent',DEV_UA);" +
    "devDef('appVersion',DEV_UA.replace(/^Mozilla\\//,''));" +
    "devDef('platform',DEV_PLAT);" +
    "devDef('maxTouchPoints',DEV_TOUCH);" +
    "if(DEV_UAD){var devBrands=[{brand:'Chromium',version:" + brandMajorJson + "},{brand:'Google Chrome',version:" + brandMajorJson + "},{brand:'Not-A.Brand',version:'99'}];" +
    "devDef('userAgentData',{brands:devBrands,mobile:!!DEV_UAD.mobile,platform:String(DEV_UAD.platform||''),getHighEntropyValues:function(hints){var out={brands:devBrands,mobile:!!DEV_UAD.mobile,platform:String(DEV_UAD.platform||'')};try{if(Array.isArray(hints)){if(hints.indexOf('architecture')>=0)out.architecture=DEV_UAD.mobile?'arm':'x86';if(hints.indexOf('bitness')>=0)out.bitness='64';if(hints.indexOf('model')>=0)out.model='';if(hints.indexOf('platformVersion')>=0)out.platformVersion='';if(hints.indexOf('uaFullVersion')>=0)out.uaFullVersion=" + brandFullJson + ";if(hints.indexOf('fullVersionList')>=0)out.fullVersionList=devBrands;if(hints.indexOf('wow64')>=0)out.wow64=false;}}catch(e){}return Promise.resolve(out);},toJSON:function(){return{brands:devBrands,mobile:!!DEV_UAD.mobile,platform:String(DEV_UAD.platform||'')};}});" +
    "}else{devDef('userAgentData',undefined);}" +
    "}catch(e){}" +
    // ---------- network bridge ----------
    "var netSeq=0;var netPending={};" +
    "window.addEventListener('message',function(e){var d=e.data;if(!d||typeof d!=='object')return;if(d.__museBrowserNet&&typeof d.id==='string'){var p=netPending[d.id];if(p){delete netPending[d.id];p(d);}}});" +
    "function b64enc(buf){var b=new Uint8Array(buf);var s='';for(var i=0;i<b.length;i+=32768){s+=String.fromCharCode.apply(null,b.subarray(i,Math.min(b.length,i+32768)));}return btoa(s);}" +
    "function b64dec(s){var bin=atob(s||'');var b=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b;}" +
    "function netSend(req){return new Promise(function(resolve){var id='n'+(++netSeq)+'-'+Date.now();netPending[id]=resolve;try{var msg={__museBrowser:'net',id:id};for(var k in req)msg[k]=req[k];msg.pageUrl=PAGE_URL;parent.postMessage(msg,'*');}catch(e){delete netPending[id];resolve({networkError:'请求发送失败'});return;}setTimeout(function(){if(netPending[id]){delete netPending[id];resolve({networkError:'请求超时'});}},95000);});}" +
    "function headersToArray(h){var out=[];try{if(!h)return out;if(typeof Headers!=='undefined'&&h instanceof Headers){h.forEach(function(v,k){out.push([k,v]);});}else if(Array.isArray(h)){for(var i=0;i<h.length;i++){if(h[i]&&h[i].length>=2)out.push([String(h[i][0]),String(h[i][1])]);}}else if(typeof h==='object'){for(var k in h){if(Object.prototype.hasOwnProperty.call(h,k))out.push([k,String(h[k])]);}}}catch(e){}return out;}" +
    "function bodyToPayload(body){if(body==null)return Promise.resolve({body:'',bodyBase64:'',contentType:''});" +
    "if(typeof body==='string')return Promise.resolve({body:body,bodyBase64:'',contentType:''});" +
    "if(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams)return Promise.resolve({body:body.toString(),bodyBase64:'',contentType:'application/x-www-form-urlencoded;charset=UTF-8'});" +
    "if(typeof FormData!=='undefined'&&body instanceof FormData){var params=new URLSearchParams();try{body.forEach(function(v,k){params.append(k,typeof v==='string'?v:'');});}catch(e){}return Promise.resolve({body:params.toString(),bodyBase64:'',contentType:'application/x-www-form-urlencoded;charset=UTF-8'});}" +
    "if(typeof Blob!=='undefined'&&body instanceof Blob){return body.arrayBuffer().then(function(ab){return{body:'',bodyBase64:b64enc(ab),contentType:body.type||''};},function(){return{body:'',bodyBase64:'',contentType:''};});}" +
    "if(body instanceof ArrayBuffer)return Promise.resolve({body:'',bodyBase64:b64enc(body),contentType:''});" +
    "if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(body))return Promise.resolve({body:'',bodyBase64:b64enc(body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)),contentType:''});" +
    "return Promise.resolve({body:String(body),bodyBase64:'',contentType:''});}" +
    "function hasCt(hdrs){for(var i=0;i<hdrs.length;i++){if(hdrs[i][0].toLowerCase()==='content-type')return true;}return false;}" +
    "var origFetch=(typeof window.fetch==='function')?window.fetch.bind(window):null;" +
    "window.fetch=function(input,init){init=init||{};var reqP;" +
    "if(typeof Request!=='undefined'&&input instanceof Request){var srcReq=input;var bp=(init.body!=null)?bodyToPayload(init.body):(srcReq.body?srcReq.clone().arrayBuffer().then(function(ab){return{body:'',bodyBase64:ab&&ab.byteLength?b64enc(ab):'',contentType:''};},function(){return{body:'',bodyBase64:'',contentType:''};}):Promise.resolve({body:'',bodyBase64:'',contentType:''}));" +
    "reqP=bp.then(function(p){return{url:srcReq.url,method:String(init.method||srcReq.method||'GET'),headers:headersToArray(init.headers||srcReq.headers),payload:p};});" +
    "}else{reqP=bodyToPayload(init.body!=null?init.body:null).then(function(p){return{url:String(input),method:String(init.method||'GET'),headers:headersToArray(init.headers),payload:p};});}" +
    "return reqP.then(function(r){var absUrl;try{absUrl=new URL(r.url,document.baseURI).href;}catch(e){absUrl=r.url;}" +
    "if(!/^https?:\\/\\//i.test(absUrl)){if(origFetch)return origFetch(input,init);return Promise.reject(new TypeError('fetch 不可用'));}" +
    "var hdrs=r.headers.slice();if(r.payload.contentType&&!hasCt(hdrs))hdrs.push(['content-type',r.payload.contentType]);" +
    "return netSend({method:r.method.toUpperCase(),url:absUrl,headers:hdrs,body:r.payload.body,bodyBase64:r.payload.bodyBase64}).then(function(res){" +
    "if(!res||res.networkError)throw new TypeError('Network request failed'+(res&&res.networkError?': '+res.networkError:''));" +
    "var bytes=b64dec(res.bodyBase64||'');var respHeaders=new Headers();(res.headers||[]).forEach(function(h){try{respHeaders.append(h[0],h[1]);}catch(e){}});" +
    "var status=(typeof res.status==='number'&&res.status>=200&&res.status<=599)?res.status:502;" +
    "var nullBody=(status===204||status===205||status===304);" +
    "var resp=new Response(nullBody?null:bytes,{status:status,statusText:res.statusText||'',headers:respHeaders});" +
    "try{Object.defineProperty(resp,'url',{value:res.finalUrl||absUrl});}catch(e){}" +
    "try{Object.defineProperty(resp,'redirected',{value:!!res.redirected});}catch(e){}" +
    "return resp;});});};" +
    // ---------- XMLHttpRequest relay ----------
    "function MuseXHR(){this.readyState=0;this.status=0;this.statusText='';this.responseText='';this.response=null;this.responseXML=null;this.responseType='';this.timeout=0;this.withCredentials=true;this.__headers=[];this.__resHeaders=[];this.__resRaw='';this.__listeners={};this.__method='GET';this.__url='';this.__aborted=false;this.upload={addEventListener:function(){},removeEventListener:function(){},onprogress:null,onload:null,onerror:null,onabort:null,onloadend:null,onloadstart:null,ontimeout:null};}" +
    "MuseXHR.prototype.open=function(m,u){this.__method=String(m||'GET').toUpperCase();try{this.__url=new URL(String(u),document.baseURI).href;}catch(e){this.__url=String(u);}this.readyState=1;this.__fire('readystatechange');};" +
    "MuseXHR.prototype.setRequestHeader=function(n,v){this.__headers.push([String(n),String(v)]);};" +
    "MuseXHR.prototype.getAllResponseHeaders=function(){return this.__resRaw||'';};" +
    "MuseXHR.prototype.getResponseHeader=function(n){var ln=String(n).toLowerCase();for(var i=0;i<this.__resHeaders.length;i++){if(this.__resHeaders[i][0].toLowerCase()===ln)return this.__resHeaders[i][1];}return null;};" +
    "MuseXHR.prototype.addEventListener=function(t,f){if(typeof f==='function'){(this.__listeners[t]=this.__listeners[t]||[]).push(f);}};" +
    "MuseXHR.prototype.removeEventListener=function(t,f){var l=this.__listeners[t];if(l)this.__listeners[t]=l.filter(function(x){return x!==f;});};" +
    "MuseXHR.prototype.__fire=function(t){var ev;try{ev=new ProgressEvent(t);}catch(e){ev={type:t};}ev.target=this;ev.currentTarget=this;var l=(this.__listeners[t]||[]).slice();for(var i=0;i<l.length;i++){try{l[i].call(this,ev);}catch(e){}}var on=this['on'+t];if(typeof on==='function'){try{on.call(this,ev);}catch(e){}}};" +
    "MuseXHR.prototype.abort=function(){this.__aborted=true;this.status=0;this.readyState=4;this.__fire('readystatechange');this.__fire('abort');this.__fire('loadend');};" +
    "MuseXHR.prototype.send=function(body){var self=this;bodyToPayload(body==null?null:body).then(function(p){if(self.__aborted)return;var hdrs=self.__headers.slice();if(p.contentType&&!hasCt(hdrs))hdrs.push(['content-type',p.contentType]);" +
    "netSend({method:self.__method,url:self.__url,headers:hdrs,body:p.body,bodyBase64:p.bodyBase64}).then(function(res){if(self.__aborted)return;" +
    "if(!res||res.networkError){self.status=0;self.readyState=4;self.__fire('readystatechange');self.__fire('error');self.__fire('loadend');return;}" +
    "self.status=res.status;self.statusText=res.statusText||'';self.__resHeaders=res.headers||[];self.__resRaw=self.__resHeaders.map(function(h){return h[0]+': '+h[1];}).join('\\r\\n')+(self.__resHeaders.length?'\\r\\n':'');" +
    "var bytes=b64dec(res.bodyBase64||'');var ct=(self.getResponseHeader('content-type')||'').toLowerCase();" +
    "self.readyState=2;self.__fire('readystatechange');self.readyState=3;self.__fire('readystatechange');" +
    "var rt=self.responseType||'';" +
    "if(rt==='arraybuffer'){self.response=bytes.buffer;}" +
    "else if(rt==='blob'){self.response=new Blob([bytes],{type:ct});}" +
    "else{var tx='';try{tx=new TextDecoder('utf-8').decode(bytes);}catch(e){tx='';}" +
    "if(rt==='json'){self.responseText=tx;try{self.response=JSON.parse(tx);}catch(e){self.response=null;}}" +
    "else if(rt==='document'){self.responseText=tx;try{self.responseXML=new DOMParser().parseFromString(tx,'text/xml');}catch(e){self.responseXML=null;}self.response=self.responseXML;}" +
    "else{self.responseText=tx;self.response=tx;}}" +
    "self.readyState=4;self.__fire('readystatechange');self.__fire('load');self.__fire('loadend');});});};" +
    "try{window.XMLHttpRequest=MuseXHR;}catch(e){}" +
    "})();";
  return `<script>${js}</script>`;
}

function base64ByteLength(b64: string): number {
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}



// ---------------- 虚拟位置 helpers ----------------
const vlocOutSchema = z.object({
  enabled: z.boolean(),
  label: z.string(),
  country: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  recent: z.array(
    z.object({
      label: z.string(),
      country: z.string(),
      lat: z.number(),
      lon: z.number(),
    }),
  ),
  exitIp: z.string(),
  exitCountry: z.string(),
  exitCity: z.string(),
  exitLat: z.number().nullable(),
  exitLon: z.number().nullable(),
  exitMeasuredAt: z.string(),
  exitError: z.string(),
});

type VlocRow = typeof schema.virtualLocationState.$inferSelect;
function toVlocOut(row: VlocRow | undefined): z.infer<typeof vlocOutSchema> {
  let recent: { label: string; country: string; lat: number; lon: number }[] = [];
  if (row?.recentJson) {
    try {
      const parsed = JSON.parse(row.recentJson) as unknown;
      if (Array.isArray(parsed)) {
        recent = parsed
          .filter(
            (r): r is { label: string; country: string; lat: number; lon: number } =>
              !!r &&
              typeof r === "object" &&
              typeof (r as { lat?: unknown }).lat === "number" &&
              typeof (r as { lon?: unknown }).lon === "number",
          )
          .map((r) => ({
            label: String(r.label ?? ""),
            country: String(r.country ?? ""),
            lat: r.lat,
            lon: r.lon,
          }));
      }
    } catch {
      recent = [];
    }
  }
  return {
    enabled: row?.enabled === 1,
    label: row?.label ?? "",
    country: row?.country ?? "",
    lat: row?.lat ?? null,
    lon: row?.lon ?? null,
    recent,
    exitIp: row?.exitIp ?? "",
    exitCountry: row?.exitCountry ?? "",
    exitCity: row?.exitCity ?? "",
    exitLat: row?.exitLat ?? null,
    exitLon: row?.exitLon ?? null,
    exitMeasuredAt: row?.exitMeasuredAt ? row.exitMeasuredAt.toISOString() : "",
    exitError: row?.exitError ?? "",
  };
}

async function loadVlocRow(ctx: Ctx): Promise<VlocRow | undefined> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.virtualLocationState)
    .where(eq(schema.virtualLocationState.id, 1));
  return rows[0];
}


// Validates a Google Maps API key FOR REAL against the Map
// Tiles API: a Photorealistic 3D Tiles root-tileset request.
// Only an HTTP 200 with a parseable tileset counts as valid;
// every failure maps Google's own error to a readable reason
// (invalid key / Map Tiles API not enabled / billing not
// enabled / quota). Nothing is cached as success without this.
async function validateGoogleMapsKey(
  ctx: Ctx,
  key: string,
): Promise<{ ok: boolean; reason: string }> {
  let status = 0;
  let text = "";
  let fetchError = "";
  try {
    const r = await ctx.executePrivileged(privileged.fetchWebPage, {
      url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
      maxBytes: 1048576,
      timeoutMs: 20000,
      method: "GET",
      body: "",
      bodyBase64: "",
      contentType: "",
      headers: [],
      cookies: [],
      userAgent: "",
      secChUaMobile: "",
      secChUaPlatform: "",
    ignoreCertErrors: false,
    });
    status = r.status;
    fetchError = r.error;
    try {
      const bin = atob(r.bodyBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      text = new TextDecoder().decode(bytes);
    } catch {
      text = "";
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "连接 Google 失败",
    };
  }
  if (status === 200) {
    try {
      const parsed = JSON.parse(text) as { root?: unknown };
      if (parsed && typeof parsed === "object" && "root" in parsed) {
        return { ok: true, reason: "" };
      }
    } catch {
      // fall through to the failure mapping below
    }
    return {
      ok: false,
      reason: "Google 返回了 200 但不是有效的 3D Tiles 数据，连接未建立",
    };
  }
  let gStatus = "";
  let gMessage = "";
  try {
    const parsed = JSON.parse(text) as {
      error?: { status?: string; message?: string };
    };
    gStatus = parsed.error?.status ?? "";
    gMessage = parsed.error?.message ?? "";
  } catch {
    // non-JSON error body: use the HTTP status below
  }
  const hay = `${gStatus} ${gMessage}`.toLowerCase();
  if (
    status === 400 ||
    hay.includes("api key not valid") ||
    hay.includes("api_key_invalid")
  ) {
    return {
      ok: false,
      reason:
        "Key 无效：Google 不认这个 API Key（请检查是否粘贴完整、是否复制错）",
    };
  }
  if (hay.includes("billing")) {
    return {
      ok: false,
      reason:
        "未开通计费：这个 Google Cloud 项目还没有绑定结算账号，Map Tiles API 需要先开通计费",
    };
  }
  if (
    hay.includes("has not been used") ||
    hay.includes("is disabled") ||
    hay.includes("permission_denied") ||
    hay.includes("api not enabled")
  ) {
    return {
      ok: false,
      reason:
        "未开通 Map Tiles API：请在 Google Cloud 控制台为这个项目启用 Map Tiles API 后重试",
    };
  }
  if (status === 429 || hay.includes("resource_exhausted") || hay.includes("quota")) {
    return {
      ok: false,
      reason:
        "配额超限：这个 Key 的 Map Tiles API 配额已用完，等配额恢复或提升配额后再试",
    };
  }
  if (status === 403) {
    return {
      ok: false,
      reason: `Google 拒绝了请求（403）${gMessage ? `：${gMessage.slice(0, 200)}` : ""}`,
    };
  }
  if (status === 0) {
    return {
      ok: false,
      reason: fetchError || "连接 Google Map Tiles API 失败（网络或服务不可达）",
    };
  }
  return {
    ok: false,
    reason: `验证失败（HTTP ${status}）${gMessage ? `：${gMessage.slice(0, 200)}` : ""}`,
  };
}

const gkeyOutSchema = z.object({
  saved: z.boolean(),
  last4: z.string(),
  status: z.string(),
  error: z.string(),
  checkedAt: z.string(),
});

function toGkeyOut(row: VlocRow | undefined): z.infer<typeof gkeyOutSchema> {
  return {
    saved: !!row?.gkeyEnc,
    last4: row?.gkeyLast4 ?? "",
    status: row?.gkeyStatus ?? "",
    error: row?.gkeyError ?? "",
    checkedAt: row?.gkeyCheckedAt ? row.gkeyCheckedAt.toISOString() : "",
  };
}

export const Actions = {
  listConversations: defineAction({
    description:
      "Lists saved chat conversations, newest activity first, each with its latest message preview. Provisional rooms (freshly opened via compose or an agent row, nothing sent in them yet) are never listed: a room only appears here once the user's first message has saved it. Long-abandoned provisional rooms are swept away.",
    request: z.object({}),
    response: z.object({
      conversations: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          kind: z.enum(["direct", "group"]),
          agentId: z.number().nullable(),
          memberBased: z.boolean(),
          memberAgentIds: z.array(z.number()),
          museMember: z.boolean(),
          // The room's stage owner （阶段负责人）: '' = nobody,
          // 'muse' = Muse, otherwise the decimal agent id.
          stageOwner: z.string(),
          iconColor: z.string(),
          iconGlyph: z.string(),
          avatarUrl: z.string().nullable(),
          preview: z.string(),
          previewAt: z.string().nullable(),
          updatedAt: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      await ensureStarterConversation(db);
      // Sweep provisional rooms abandoned long ago (e.g. left behind
      // by a page refresh, where the client could no longer discard
      // them itself): still provisional and untouched for hours means
      // nothing was ever sent in them, so they are deleted outright
      // and leave no empty record behind.
      const staleCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const stale = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.provisional, 1),
            lt(schema.conversations.updatedAt, staleCutoff),
          ),
        );
      for (const s of stale) {
        const userMsgs = await db
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, s.id),
              eq(schema.messages.role, "user"),
            ),
          )
          .limit(1);
        if (userMsgs.length > 0) continue;
        await db
          .delete(schema.messages)
          .where(eq(schema.messages.conversationId, s.id));
        await db
          .delete(schema.groupMembers)
          .where(eq(schema.groupMembers.conversationId, s.id));
        await db
          .delete(schema.agentTriggers)
          .where(eq(schema.agentTriggers.conversationId, s.id));
        await db
          .delete(schema.conversations)
          .where(eq(schema.conversations.id, s.id));
      }
      const convs = await db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updatedAt));
      const out = [];
      for (const conv of convs) {
        // Provisional rooms are not saved conversations yet: they
        // stay out of every list (recent chats included) until the
        // user's first message in them flips the flag off.
        if (conv.provisional === 1) continue;
        const last = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, conv.id))
          .orderBy(desc(schema.messages.id))
          .limit(1);
        const lastMsg = last[0];
        const memberRows = await db
          .select({ agentId: schema.groupMembers.agentId })
          .from(schema.groupMembers)
          .where(eq(schema.groupMembers.conversationId, conv.id));
        out.push({
          id: conv.id,
          title: conv.title,
          kind: conv.kind,
          agentId: conv.agentId,
          memberBased: conv.memberBased === 1,
          memberAgentIds: memberRows
            .map((m) => m.agentId)
            .filter((x): x is number => x != null),
          museMember: memberRows.some((m) => m.agentId == null),
          stageOwner: conv.stageOwner,
          iconColor: conv.iconColor,
          iconGlyph: conv.iconGlyph,
          avatarUrl: await resolveAvatarUrl(ctx, conv.avatarBlobKey),
          preview: lastMsg
            ? lastMsg.content || attachmentPreview(lastMsg)
            : "",
          previewAt: lastMsg ? lastMsg.createdAt.toISOString() : null,
          updatedAt: conv.updatedAt.toISOString(),
        });
      }
      return { conversations: out };
    },
  }),

  createConversation: defineAction({
    description:
      "Creates a new chat room and returns its id. Every chat window is the same kind of room (member-based, group-style). With memberBased=true and no agentId (the sidebar compose button) the room starts with only the user in it: no agent member, no greeting, completely empty, titled 「新对话」, and replies come only from agents later added through the member panel. With an agentId the room starts with that agent already a member (switched on), titled with the agent's name. With neither it is a room with Muse as its member, seeded with one short greeting. The compose and agent branches create the room as provisional: it is only saved (listed, numbered) once the user sends something in it; the client deletes it if the user leaves without sending.",
    request: z.object({
      agentId: z.number().int().positive().nullable().default(null),
      memberBased: z.boolean().default(false),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.memberBased && args.agentId == null) {
        const inserted = await db
          .insert(schema.conversations)
          .values({
            title: "新对话",
            kind: "direct",
            memberBased: 1,
            provisional: 1,
          })
          .returning({ id: schema.conversations.id });
        const conv = inserted[0];
        if (!conv)
          throw new Error("createConversation: insert returned no rows");
        ctx.invalidateQueries();
        return { id: conv.id };
      }
      if (args.agentId != null) {
        const rows = await db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, args.agentId));
        const agent = rows[0];
        if (!agent) throw new Error("createConversation: agent not found");
        const inserted = await db
          .insert(schema.conversations)
          .values({
            title: agent.name || "智能体",
            kind: "direct",
            agentId: agent.id,
            memberBased: 1,
            provisional: 1,
          })
          .returning({ id: schema.conversations.id });
        const conv = inserted[0];
        if (!conv)
          throw new Error("createConversation: insert returned no rows");
        await db.insert(schema.groupMembers).values({
          conversationId: conv.id,
          agentId: agent.id,
        });
        ctx.invalidateQueries();
        return { id: conv.id };
      }
      const inserted = await db
        .insert(schema.conversations)
        .values({ title: "Muse", memberBased: 1 })
        .returning({ id: schema.conversations.id });
      const conv = inserted[0];
      if (!conv) throw new Error("createConversation: insert returned no rows");
      await db.insert(schema.groupMembers).values({
        conversationId: conv.id,
        agentId: null,
      });
      await db.insert(schema.messages).values({
        conversationId: conv.id,
        role: "assistant",
        content: GREETING,
      });
      ctx.invalidateQueries();
      return { id: conv.id };
    },
  }),

  openAgentRoom: defineAction({
    description:
      "Opens a brand-new room for chatting with one agent (agentId null = Muse, the fixed platform agent). Every call creates a fresh room — it never reopens a previous room with that agent; earlier rooms stay reachable from the recent-chats list. The new room is a member-based room titled with the agent's current name, the agent already a member and switched on, no greeting — and it is provisional: it is only saved (listed) once the user sends something in it, and the client deletes it if the user leaves without sending.",
    request: z.object({
      agentId: z.number().int().positive().nullable().default(null),
    }),
    response: z.object({ id: z.number(), created: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let agentName: string;
      if (args.agentId != null) {
        const rows = await db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, args.agentId));
        const agent = rows[0];
        if (!agent) throw new Error("openAgentRoom: agent not found");
        agentName = agent.name || "智能体";
      } else {
        const s = await loadMuseSettings(db);
        agentName = s.name || "Muse";
      }
      const inserted = await db
        .insert(schema.conversations)
        .values({
          title: agentName,
          kind: "direct",
          agentId: args.agentId,
          memberBased: 1,
          provisional: 1,
        })
        .returning({ id: schema.conversations.id });
      const conv = inserted[0];
      if (!conv) throw new Error("openAgentRoom: insert returned no rows");
      await db.insert(schema.groupMembers).values({
        conversationId: conv.id,
        agentId: args.agentId,
      });
      ctx.invalidateQueries();
      return { id: conv.id, created: true };
    },
  }),

  createGroup: defineAction({
    description:
      "Creates a new group conversation and returns its id. No name is required: with no name (or a blank one) the group is auto-named 「群聊N」 from a persistent counter that only moves forward — max existing number + 1, and a deleted group's number is never reused. The group starts with only the user in it — no agent is a member and nothing is seeded; agents join later through setGroupMember from the group chat's member panel.",
    request: z.object({
      name: z.string().trim().max(60).optional().default(""),
    }),
    response: z.object({ id: z.number(), title: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let title = args.name.trim();
      if (!title) {
        title = `群聊${await takeNextGroupNumber(db)}`;
      }
      const inserted = await db
        .insert(schema.conversations)
        .values({ title, kind: "group" })
        .returning({ id: schema.conversations.id });
      const conv = inserted[0];
      if (!conv) throw new Error("createGroup: insert returned no rows");
      ctx.invalidateQueries();
      return { id: conv.id, title };
    },
  }),

  updateGroupSettings: defineAction({
    description:
      "Saves one room's name and icon (colour + glyph, or an uploaded avatar image stored as a blob — an image takes priority over colour/glyph, removeAvatar restores them) from the room settings panel, opened by tapping the room's avatar in a list or at the top of its chat. Every chat window is a room now, so any conversation can be renamed this way. Both empty icon fields restore the default room avatar. Saving marks the title user-set: membership changes no longer auto-rename the room afterwards. The same save also carries the room's stage owner （阶段负责人） when the caller sends stageOwner ('' = nobody, 'muse' = Muse, otherwise a member agent's decimal id): the owner must currently be a member of the room, anything else is stored as '' — while the field is absent from the payload the stored owner is kept untouched.",
    request: z.object({
      conversationId: z.number().int().positive(),
      title: z.string().trim().min(1).max(60),
      iconColor: z.string().trim().max(20),
      iconGlyph: z.string().trim().max(4),
      stageOwner: z.string().trim().max(20).optional(),
      ...avatarFields,
    }),
    response: z.object({
      id: z.number(),
      title: z.string(),
      iconColor: z.string(),
      iconGlyph: z.string(),
      stageOwner: z.string(),
      avatarUrl: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      const conv = rows[0];
      if (!conv)
        throw new Error("updateGroupSettings: conversation not found");
      const avatarBlobKey = await applyAvatarChange(
        ctx,
        conv.avatarBlobKey,
        args.avatarImage,
        args.removeAvatar,
        "groups",
      );
      // The stage owner must be a current member of the room:
      // 'muse' needs a Muse member row, a numeric id needs that
      // agent's member row — anything else is stored as ''.
      let stageOwner = conv.stageOwner;
      if (args.stageOwner !== undefined) {
        stageOwner = "";
        if (args.stageOwner === "muse" || /^\d+$/.test(args.stageOwner)) {
          const members = await loadGroupMembers(db, args.conversationId);
          if (args.stageOwner === "muse") {
            if (members.muse) stageOwner = "muse";
          } else if (members.agentIds.includes(Number(args.stageOwner))) {
            stageOwner = args.stageOwner;
          }
        }
      }
      await db
        .update(schema.conversations)
        .set({
          title: args.title,
          iconColor: args.iconColor,
          iconGlyph: args.iconGlyph,
          avatarBlobKey,
          stageOwner,
          titleAuto: 0,
        })
        .where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return {
        id: args.conversationId,
        title: args.title,
        iconColor: args.iconColor,
        iconGlyph: args.iconGlyph,
        stageOwner,
        avatarUrl: await resolveAvatarUrl(ctx, avatarBlobKey),
      };
    },
  }),

  getProfile: defineAction({
    description:
      "Returns the user's own profile (display name, avatar glyph, avatar colour, whether message bubbles show their time, whether a tone plays on new replies, whether swipe-gesture navigation is on, the appearance preferences: theme mode, text size level, long-line wrapping, whether the sidebar menu tiles pack tightly together, and the global custom instructions with their enable switch) shown as the fixed 「我」 entry in the agent list. The row is created on first read with the user's name.",
    request: z.object({}),
    response: z.object({
      name: z.string(),
      glyph: z.string(),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      showTime: z.boolean(),
      soundOn: z.boolean(),
      gestureControl: z.boolean(),
      gesturePinchZoom: z.boolean(),
      gestureDoubleTapZoom: z.boolean(),
      gestureTwoFingerSwipe: z.boolean(),
      gestureLongPressMenu: z.boolean(),
      gestureThreeFingerSwipe: z.boolean(),
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
      menuTight: z.boolean(),
      recentTight: z.boolean(),
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
      columnResize: z.boolean(),
      railWidth: z.number(),
      listWidth: z.number(),
      recentHeight: z.number(),
      menuHeight: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const p = await loadProfile(db);
      return {
        name: p.name,
        glyph: p.glyph,
        color: p.color,
        avatarUrl: await resolveAvatarUrl(ctx, p.avatarBlobKey),
        showTime: p.showTime === 1,
        soundOn: p.soundOn === 1,
        gestureControl: p.gestureControl === 1,
        gesturePinchZoom: p.gesturePinchZoom === 1,
        gestureDoubleTapZoom: p.gestureDoubleTapZoom === 1,
        gestureTwoFingerSwipe: p.gestureTwoFingerSwipe === 1,
        gestureLongPressMenu: p.gestureLongPressMenu === 1,
        gestureThreeFingerSwipe: p.gestureThreeFingerSwipe === 1,
        themeMode: (["system", "light", "dark"].includes(p.themeMode)
          ? p.themeMode
          : "system") as "system" | "light" | "dark",
        fontScale: Math.min(5, Math.max(1, p.fontScale || 3)),
        codeWrap: p.codeWrap === 1,
        menuTight: p.menuTight === 1,
        recentTight: p.recentTight === 1,
        customInstructions: p.customInstructions,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
        columnResize: p.columnResize === 1,
        railWidth: clampColumnWidth(p.railWidth, 264, 200, 480),
        listWidth: clampColumnWidth(p.listWidth, 280, 220, 520),
        recentHeight: clampColumnWidth(p.recentHeight, 320, 140, 640),
        menuHeight: clampMenuHeight(p.menuHeight),
      };
    },
  }),

  setAppearance: defineAction({
    description:
      "Saves the appearance preferences from the 外观 and 间距 pages of the space settings: the colour theme mode ('system' follows the device, 'light' / 'dark' force a mode), the UI text size level (1–5, 3 is the default size), whether long lines in messages and text previews wrap, whether the sidebar menu tiles pack tightly against each other at their own width (menuTight, the 间距 page's 菜单栏 switch) instead of stretching evenly across the rail, and whether the 最近聊天 rows pack compactly (recentTight, the 间距 page's 最近聊天栏 switch). The two spacing switches are fully independent: each is stored in its own profile column and changing one never changes the other栏. Stored on the user's profile row alongside the other display preferences.",
    request: z.object({
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number().int().min(1).max(5),
      codeWrap: z.boolean(),
      menuTight: z.boolean(),
      recentTight: z.boolean(),
    }),
    response: z.object({
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
      menuTight: z.boolean(),
      recentTight: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await loadProfile(db);
      await db
        .update(schema.userProfile)
        .set({
          themeMode: args.themeMode,
          fontScale: args.fontScale,
          codeWrap: args.codeWrap ? 1 : 0,
          menuTight: args.menuTight ? 1 : 0,
          recentTight: args.recentTight ? 1 : 0,
        })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return {
        themeMode: args.themeMode,
        fontScale: args.fontScale,
        codeWrap: args.codeWrap,
        menuTight: args.menuTight,
        recentTight: args.recentTight,
      };
    },
  }),

  setGestureControl: defineAction({
    description:
      "Turns swipe-gesture navigation on or off (the 手势控制 switch in the space settings panel). While on, a right swipe in the space goes back to the previous screen. Stored on the user's profile row alongside the other display preferences.",
    request: z.object({
      enabled: z.boolean(),
    }),
    response: z.object({
      gestureControl: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await loadProfile(db);
      await db
        .update(schema.userProfile)
        .set({ gestureControl: args.enabled ? 1 : 0 })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return { gestureControl: args.enabled };
    },
  }),

  setGestureOption: defineAction({
    description:
      "Turns ONE of the additional gestures on or off (each has its own switch on the 手势控制 page of the space settings, all off by default, each completely inert while off): pinchZoom = two-finger pinch scales chat text, images and canvases (size remembered per surface); doubleTapZoom = double-tap toggles a surface between zoomed and normal; twoFingerSwipe = a two-finger horizontal swipe switches conversation; longPressMenu = a long press on a conversation row opens its action menu; threeFingerSwipe = a three-finger horizontal swipe switches section. Stored on the user's profile row; the original right-swipe-back switch (setGestureControl) is separate and unchanged.",
    request: z.object({
      gesture: z.enum([
        "pinchZoom",
        "doubleTapZoom",
        "twoFingerSwipe",
        "longPressMenu",
        "threeFingerSwipe",
      ]),
      enabled: z.boolean(),
    }),
    response: z.object({
      gesturePinchZoom: z.boolean(),
      gestureDoubleTapZoom: z.boolean(),
      gestureTwoFingerSwipe: z.boolean(),
      gestureLongPressMenu: z.boolean(),
      gestureThreeFingerSwipe: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await loadProfile(db);
      const v = args.enabled ? 1 : 0;
      const patch =
        args.gesture === "pinchZoom"
          ? { gesturePinchZoom: v }
          : args.gesture === "doubleTapZoom"
            ? { gestureDoubleTapZoom: v }
            : args.gesture === "twoFingerSwipe"
              ? { gestureTwoFingerSwipe: v }
              : args.gesture === "longPressMenu"
                ? { gestureLongPressMenu: v }
                : { gestureThreeFingerSwipe: v };
      await db
        .update(schema.userProfile)
        .set(patch)
        .where(eq(schema.userProfile.id, 1));
      const p = await loadProfile(db);
      ctx.invalidateQueries();
      return {
        gesturePinchZoom: p.gesturePinchZoom === 1,
        gestureDoubleTapZoom: p.gestureDoubleTapZoom === 1,
        gestureTwoFingerSwipe: p.gestureTwoFingerSwipe === 1,
        gestureLongPressMenu: p.gestureLongPressMenu === 1,
        gestureThreeFingerSwipe: p.gestureThreeFingerSwipe === 1,
      };
    },
  }),

  setColumnLayout: defineAction({
    description:
      "Saves the column-resize preferences from the 窗口大小 page of the space settings and from every long-press edge drag: whether drag-to-resize is enabled, the two column widths in pixels (rail 200–480, list 220–520, clamped), the 菜单栏 height in pixels (menuHeight: 0 = automatic/size-to-content, otherwise 120–560, clamped) set by long-press dragging the boundary strip between the 菜单栏 and the 最近聊天栏 inside the sidebar, and the legacy 最近聊天栏 height in pixels (140–640, clamped, kept for backward compatibility — the recent-chats region itself is no longer placed by a fixed height: it sits in flow directly below the menu's current height and fills the rest of the sidebar). Stored on the user's profile row alongside the other display preferences; the sizes apply whether or not the switch is on — the switch only controls whether the drag handles appear.",
    request: z.object({
      enabled: z.boolean(),
      railWidth: z.number().int().min(200).max(480),
      listWidth: z.number().int().min(220).max(520),
      recentHeight: z.number().int().min(140).max(640),
      menuHeight: z.number().int().min(0).max(560),
    }),
    response: z.object({
      columnResize: z.boolean(),
      railWidth: z.number(),
      listWidth: z.number(),
      recentHeight: z.number(),
      menuHeight: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await loadProfile(db);
      await db
        .update(schema.userProfile)
        .set({
          columnResize: args.enabled ? 1 : 0,
          railWidth: args.railWidth,
          listWidth: args.listWidth,
          recentHeight: args.recentHeight,
          menuHeight: clampMenuHeight(args.menuHeight),
        })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return {
        columnResize: args.enabled,
        railWidth: args.railWidth,
        listWidth: args.listWidth,
        recentHeight: args.recentHeight,
        menuHeight: clampMenuHeight(args.menuHeight),
      };
    },
  }),

  getWorkspaceState: defineAction({
    description:
      "Returns the workspace state snapshot (one JSON document, empty string when none was ever saved): the client's saved layout, open section/pane/conversation, scroll positions, unsent drafts, browser tabs, per-pane pinch-zoom scales, prompt-canvas state, code-pane tabs/buffers and drawing-pad layers, so re-entering the space — on any device — restores everything as it was left. Password plaintext is never part of this snapshot.",
    request: z.object({}),
    response: z.object({
      state: z.string(),
      updatedAt: z.number(),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.workspaceState)
        .where(eq(schema.workspaceState.id, 1));
      const row = rows[0];
      return {
        state: row?.state ?? "",
        updatedAt: row?.updatedAt ?? 0,
      };
    },
  }),

  saveWorkspaceState: defineAction({
    description:
      "Saves the workspace state snapshot (the whole JSON document, replaced each time; the client debounces writes and shrinks the document — drawing layers first, then code buffers — when it would exceed the size cap). Stored server-side so the restore works across devices.",
    request: z.object({
      state: z.string().max(8000000),
    }),
    response: z.object({
      ok: z.literal(true),
      updatedAt: z.number(),
    }),
    handler: async (ctx, args): Promise<{ ok: true; updatedAt: number }> => {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      await db
        .insert(schema.workspaceState)
        .values({ id: 1, state: args.state, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.workspaceState.id,
          set: { state: args.state, updatedAt: now },
        });
      return { ok: true, updatedAt: now };
    },
  }),

  updateProfile: defineAction({
    description:
      "Saves the user's own profile (display name, avatar glyph, avatar colour, bubble-time visibility, new-reply tone). The name labels the user's messages and their group membership everywhere in the space.",
    request: z.object({
      name: z.string().trim().min(1).max(40),
      glyph: z.string().trim().max(4),
      color: z.string().trim().max(20),
      showTime: z.boolean(),
      soundOn: z.boolean(),
      ...avatarFields,
    }),
    response: z.object({
      name: z.string(),
      glyph: z.string(),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      showTime: z.boolean(),
      soundOn: z.boolean(),
      gestureControl: z.boolean(),
      gesturePinchZoom: z.boolean(),
      gestureDoubleTapZoom: z.boolean(),
      gestureTwoFingerSwipe: z.boolean(),
      gestureLongPressMenu: z.boolean(),
      gestureThreeFingerSwipe: z.boolean(),
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
      menuTight: z.boolean(),
      recentTight: z.boolean(),
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
      columnResize: z.boolean(),
      railWidth: z.number(),
      listWidth: z.number(),
      recentHeight: z.number(),
      menuHeight: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const p = await loadProfile(db);
      const avatarBlobKey = await applyAvatarChange(
        ctx,
        p.avatarBlobKey,
        args.avatarImage,
        args.removeAvatar,
        "profile",
      );
      await db
        .update(schema.userProfile)
        .set({
          name: args.name,
          glyph: args.glyph,
          color: args.color || "#b9bec7",
          avatarBlobKey,
          showTime: args.showTime ? 1 : 0,
          soundOn: args.soundOn ? 1 : 0,
        })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return {
        name: args.name,
        glyph: args.glyph,
        color: args.color || "#b9bec7",
        avatarUrl: await resolveAvatarUrl(ctx, avatarBlobKey),
        showTime: args.showTime,
        soundOn: args.soundOn,
        gestureControl: p.gestureControl === 1,
        gesturePinchZoom: p.gesturePinchZoom === 1,
        gestureDoubleTapZoom: p.gestureDoubleTapZoom === 1,
        gestureTwoFingerSwipe: p.gestureTwoFingerSwipe === 1,
        gestureLongPressMenu: p.gestureLongPressMenu === 1,
        gestureThreeFingerSwipe: p.gestureThreeFingerSwipe === 1,
        themeMode: (["system", "light", "dark"].includes(p.themeMode)
          ? p.themeMode
          : "system") as "system" | "light" | "dark",
        fontScale: Math.min(5, Math.max(1, p.fontScale || 3)),
        codeWrap: p.codeWrap === 1,
        menuTight: p.menuTight === 1,
        recentTight: p.recentTight === 1,
        customInstructions: p.customInstructions,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
        columnResize: p.columnResize === 1,
        railWidth: clampColumnWidth(p.railWidth, 264, 200, 480),
        listWidth: clampColumnWidth(p.listWidth, 280, 220, 520),
        recentHeight: clampColumnWidth(p.recentHeight, 320, 140, 640),
        menuHeight: clampMenuHeight(p.menuHeight),
      };
    },
  }),

  getCustomInstructions: defineAction({
    description:
      "Returns the user's global custom instructions (the 自定义指令 page of the space settings): one standing instruction that applies to every agent in the space — Muse and every added agent — unlike each agent's own system prompt, which only affects that one agent, plus whether its enable switch is on. Empty string means none is set; while the switch is off the text is kept but has no effect on replies.",
    request: z.object({}),
    response: z.object({
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const p = await loadProfile(db);
      return {
        customInstructions: p.customInstructions,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
      };
    },
  }),

  setCustomInstructions: defineAction({
    description:
      "Saves the user's global custom instructions from the 自定义指令 page of the space settings. The text is stored on the user's profile row and, while the enable switch is on, injected into every agent's reply context (Muse via the platform channel and every added agent via its own API), on top of each agent's own system prompt. Saving an empty text clears the global instruction; the enable switch is not changed by saving text.",
    request: z.object({
      text: z.string().max(4000),
    }),
    response: z.object({
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const p = await loadProfile(db);
      await db
        .update(schema.userProfile)
        .set({ customInstructions: args.text })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return {
        customInstructions: args.text,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
      };
    },
  }),

  setCustomInstructionsEnabled: defineAction({
    description:
      "Turns the global custom instructions on or off (the 启用自定义指令 switch on the 自定义指令 page of the space settings). While off, the saved instruction text stays stored on the user's profile row but is not injected into any agent's replies; turning it back on restores its effect without re-entering the text.",
    request: z.object({
      enabled: z.boolean(),
    }),
    response: z.object({
      customInstructionsEnabled: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await loadProfile(db);
      await db
        .update(schema.userProfile)
        .set({ customInstructionsEnabled: args.enabled ? 1 : 0 })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return { customInstructionsEnabled: args.enabled };
    },
  }),

  listSkills: defineAction({
    description:
      "Lists every skill on the 技能 page of the space settings (name, description, full instructions, enabled flag, scope, the files attached into each skill, and — for selected-scope skills — which agents it is assigned to: museAssigned plus added-agent ids), oldest first. The list starts empty; skills exist only when the user creates them.",
    request: z.object({}),
    response: z.object({
      skills: z.array(skillOut),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.skills)
        .orderBy(asc(schema.skills.id));
      const skills: SkillOut[] = [];
      for (const row of rows) skills.push(await skillToOut(db, row));
      return { skills };
    },
  }),

  createSkill: defineAction({
    description:
      "Creates a skill from the 技能 page's 创建 form (name, description, instructions). New skills start enabled; scope 'all' applies to every agent in the space, scope 'selected' applies only to the picked agents (museAssigned = Muse, agentIds = added agents). An enabled, applicable skill's instructions are injected into that agent's reply context.",
    request: z.object({
      name: z.string().trim().min(1).max(60),
      description: z.string().max(500),
      instructions: z.string().trim().min(1).max(20000),
      scope: z.enum(["all", "selected"]),
      museAssigned: z.boolean(),
      agentIds: z.array(z.number()),
    }),
    response: z.object({
      skill: skillOut,
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const inserted = await db
        .insert(schema.skills)
        .values({
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          enabled: 1,
          scope: args.scope,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("创建技能失败，请重试");
      await saveSkillAssignments(
        db,
        row.id,
        args.museAssigned,
        args.agentIds,
      );
      ctx.invalidateQueries();
      return { skill: await skillToOut(db, row) };
    },
  }),

  addSkillFile: defineAction({
    description:
      "Attaches one uploaded file INTO an existing skill (the 添加文件 button on that skill's own edit page opens the 上传文件 dialog; the upload lands on this skill only and never creates a new skill). The client sends the file's decoded text; the text is stored with the skill and, while the skill is enabled and applies to an agent, joins the skill's instructions in that agent's reply context. Returns the skill with its updated file list.",
    request: z.object({
      skillId: z.number(),
      fileName: z.string().min(1).max(200),
      size: z.number().nullable(),
      mime: z.string().max(120).nullable(),
      text: z.string().min(1).max(100000),
    }),
    response: z.object({
      skill: skillOut,
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.id, args.skillId));
      const skill = rows[0];
      if (!skill) throw new Error("该技能已被删除，无法添加文件");
      await db.insert(schema.skillFiles).values({
        skillId: skill.id,
        name: args.fileName,
        size: args.size,
        mime: args.mime,
        content: args.text,
      });
      ctx.invalidateQueries();
      return { skill: await skillToOut(db, skill) };
    },
  }),

  removeSkillFile: defineAction({
    description:
      "Removes one attached file from a skill (the 移除 button next to a file on the skill's edit page). The file's text immediately stops being part of that skill's reply context. Returns the skill with its updated file list.",
    request: z.object({
      skillId: z.number(),
      fileId: z.number(),
    }),
    response: z.object({
      skill: skillOut,
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.skillFiles)
        .where(
          and(
            eq(schema.skillFiles.id, args.fileId),
            eq(schema.skillFiles.skillId, args.skillId),
          ),
        );
      const rows = await db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.id, args.skillId));
      const skill = rows[0];
      if (!skill) throw new Error("该技能已被删除");
      ctx.invalidateQueries();
      return { skill: await skillToOut(db, skill) };
    },
  }),

  updateSkill: defineAction({
    description:
      "Saves edits to one skill from its edit page on the 技能 page: name, description, instructions, the enabled switch, and its scope/agent assignment. A disabled skill stays stored but is injected into no agent's replies; re-enabling restores its effect.",
    request: z.object({
      id: z.number(),
      name: z.string().trim().min(1).max(60),
      description: z.string().max(500),
      instructions: z.string().trim().min(1).max(20000),
      enabled: z.boolean(),
      scope: z.enum(["all", "selected"]),
      museAssigned: z.boolean(),
      agentIds: z.array(z.number()),
    }),
    response: z.object({
      skill: skillOut,
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const updated = await db
        .update(schema.skills)
        .set({
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          enabled: args.enabled ? 1 : 0,
          scope: args.scope,
          updatedAt: new Date(),
        })
        .where(eq(schema.skills.id, args.id))
        .returning();
      const row = updated[0];
      if (!row) throw new Error("该技能已被删除");
      await saveSkillAssignments(
        db,
        row.id,
        args.museAssigned,
        args.agentIds,
      );
      ctx.invalidateQueries();
      return { skill: await skillToOut(db, row) };
    },
  }),

  deleteSkill: defineAction({
    description:
      "Deletes one skill, its agent assignments and its attached files (the 删除技能 button on the skill's edit page). The skill immediately stops being injected into any agent's replies.",
    request: z.object({
      id: z.number(),
    }),
    response: z.object({
      ok: z.literal(true),
    }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.agentSkills)
        .where(eq(schema.agentSkills.skillId, args.id));
      await db
        .delete(schema.skillFiles)
        .where(eq(schema.skillFiles.skillId, args.id));
      await db
        .delete(schema.skills)
        .where(eq(schema.skills.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listTriggers: defineAction({
    description:
      "Lists the standing triggers （定时 / 事件触发） from the 触发 page of the space settings: each trigger's agent (null = Muse), target room, kind (schedule = fires on its interval; event = fires when the user posts in its room and the agent is not a member there), instruction, enabled switch, and the last execution's real outcome.",
    request: z.object({}),
    response: z.object({ triggers: z.array(triggerOut) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agentTriggers)
        .orderBy(asc(schema.agentTriggers.id));
      const nameOf = await loadNameOf(db);
      const out: z.infer<typeof triggerOut>[] = [];
      for (const t of rows) out.push(await toTriggerOut(db, t, nameOf));
      return { triggers: out };
    },
  }),

  createTrigger: defineAction({
    description:
      "Creates one standing trigger: an agent (agentId null = Muse) that will speak in one room either on a schedule (kind 'schedule', every intervalMinutes) or on an event (kind 'event', eventType 'room_new_message' — the user posts in that room and the agent is not a member of it). The instruction is what the agent is asked to do when the trigger fires.",
    request: triggerInput,
    response: z.object({ trigger: triggerOut }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertTriggerTargets(db, args.agentId, args.conversationId);
      const inserted = await db
        .insert(schema.agentTriggers)
        .values({
          agentId: args.agentId,
          conversationId: args.conversationId,
          kind: args.kind,
          name: args.name,
          instruction: args.instruction,
          enabled: args.enabled ? 1 : 0,
          intervalMinutes: args.intervalMinutes,
          eventType: args.kind === "event" ? args.eventType : "",
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("createTrigger: insert returned no rows");
      ctx.invalidateQueries();
      return { trigger: await toTriggerOut(db, row, await loadNameOf(db)) };
    },
  }),

  updateTrigger: defineAction({
    description:
      "Saves one standing trigger's fields (agent, room, kind, name, instruction, enabled switch, interval / event type) from the 触发 page's editor. Editing does not clear the recorded last-run outcome.",
    request: triggerInput.extend({
      id: z.number().int().positive(),
    }),
    response: z.object({ trigger: triggerOut }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agentTriggers)
        .where(eq(schema.agentTriggers.id, args.id));
      if (!rows[0]) throw new Error("updateTrigger: trigger not found");
      await assertTriggerTargets(db, args.agentId, args.conversationId);
      await db
        .update(schema.agentTriggers)
        .set({
          agentId: args.agentId,
          conversationId: args.conversationId,
          kind: args.kind,
          name: args.name,
          instruction: args.instruction,
          enabled: args.enabled ? 1 : 0,
          intervalMinutes: args.intervalMinutes,
          eventType: args.kind === "event" ? args.eventType : "",
          updatedAt: new Date(),
        })
        .where(eq(schema.agentTriggers.id, args.id));
      const again = await db
        .select()
        .from(schema.agentTriggers)
        .where(eq(schema.agentTriggers.id, args.id));
      const row = again[0];
      if (!row) throw new Error("updateTrigger: trigger vanished");
      ctx.invalidateQueries();
      return { trigger: await toTriggerOut(db, row, await loadNameOf(db)) };
    },
  }),

  deleteTrigger: defineAction({
    description:
      "Deletes one standing trigger permanently. The agent and the room are untouched; only the standing rule goes away.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.agentTriggers)
        .where(eq(schema.agentTriggers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  runDueTriggers: defineAction({
    description:
      "Executes every enabled schedule trigger whose interval has elapsed since its last run (a never-run trigger is due immediately), at most five per call, each producing a real reply from its agent in its room and recording the outcome on the trigger row. Driven by the space's 15-minute artifact schedule; event triggers are not run here — they fire inside sendMessage. The same pass also polls the pending Doubao async-media watches (doubao_pending_media, at most five): each watch's官网 conversation history is read once and a later-pushed video (or other media) is downloaded into its room; results are returned as mediaPolls.",
    request: z.object({}),
    response: z.object({
      ran: z.number(),
      results: z.array(
        z.object({
          id: z.number(),
          status: z.string(),
          error: z.string().nullable(),
        }),
      ),
      mediaPolls: z.array(
        z.object({
          id: z.number(),
          status: z.string(),
          error: z.string().nullable(),
        }),
      ),
    }),
    privileged: [
      privileged.execLinuxCommand,
      privileged.hostListDir,
      privileged.hostReadFile,
      privileged.hostWriteFile,
    ],
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      await refreshAgentRoute(ctx);
      const rows = await db
        .select()
        .from(schema.agentTriggers)
        .where(
          and(
            eq(schema.agentTriggers.kind, "schedule"),
            eq(schema.agentTriggers.enabled, 1),
          ),
        )
        .orderBy(asc(schema.agentTriggers.id));
      const now = Date.now();
      const due = rows.filter(
        (t) =>
          !t.lastRunAt ||
          now - t.lastRunAt.getTime() >= t.intervalMinutes * 60_000,
      );
      const results: { id: number; status: string; error: string | null }[] =
        [];
      for (const t of due.slice(0, 5)) {
        const r = await executeTrigger(ctx, db, t, "【定时触发】");
        results.push({ id: t.id, status: r.status, error: r.error });
      }
      // Doubao async-media collection rides the same 15-minute
      // pass: a video Doubao pushed into a watched官网
      // conversation after its announcement reply is downloaded
      // into the room here.
      let mediaPolls: { id: number; status: string; error: string | null }[] =
        [];
      try {
        mediaPolls = await pollDoubaoPendingMedia(ctx, db);
      } catch {
        mediaPolls = [];
      }
      if (results.length > 0 || mediaPolls.length > 0)
        ctx.invalidateQueries();
      return { ran: results.length, results, mediaPolls };
    },
  }),

  getMuseSettings: defineAction({
    description:
      "Returns Muse's own editable settings (display name, role, avatar colour, enabled, thinking level, extra system prompt, legacy long-term memory text, and the user's private display-only note about Muse). Muse's model and API channel are fixed platform facts and are not part of the settings. The note is only ever shown in the agent list; it is never part of any prompt. The legacy memory text is no longer a separate settings field: the panel folds it into the system prompt, and the reply context combines both until it is saved there.",
    request: z.object({}),
    response: z.object({
      name: z.string(),
      role: z.string(),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      enabled: z.boolean(),
      canExecLinux: z.boolean(),
      canEditFiles: z.boolean(),
      thinking: z.string(),
      systemPrompt: z.string(),
      memory: z.string(),
      note: z.string(),
      sortOrder: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const s = await loadMuseSettings(db);
      return {
        name: s.name,
        role: s.role,
        color: s.color,
        avatarUrl: await resolveAvatarUrl(ctx, s.avatarBlobKey),
        enabled: s.enabled === 1,
        canExecLinux: s.canExecLinux === 1,
        canEditFiles: s.canEditFiles === 1,
        thinking: s.thinking,
        systemPrompt: s.systemPrompt,
        memory: s.memory,
        note: s.note,
        sortOrder: s.sortOrder,
      };
    },
  }),

  updateMuseSettings: defineAction({
    description:
      "Saves Muse's own settings (display name, role, avatar colour, enabled, thinking level, extra system prompt, legacy long-term memory text, and the user's private display-only note). The name relabels Muse in conversation lists, message bubbles and group transcripts; disabling makes Muse stay silent like a disabled agent. Model and API stay fixed. The note is stored for display in the agent list only — it is never injected into any prompt or reply context. The memory field is legacy: the settings panel folds any saved memory text into the system prompt and stores '' here; the reply context combines the two columns either way.",
    request: z.object({
      name: z.string().trim().min(1).max(40),
      role: z.string().trim().max(60),
      color: z.string().trim().max(20),
      enabled: z.boolean(),
      canExecLinux: z.boolean().default(false),
      canEditFiles: z.boolean().default(false),
      thinking: z.enum(["默认", "关闭", "低", "中", "高"]),
      systemPrompt: z.string().max(4000),
      memory: z.string().max(8000).default(""),
      note: z.string().trim().max(200),
      ...avatarFields,
    }),
    response: z.object({
      name: z.string(),
      role: z.string(),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      enabled: z.boolean(),
      canExecLinux: z.boolean(),
      canEditFiles: z.boolean(),
      thinking: z.string(),
      systemPrompt: z.string(),
      memory: z.string(),
      note: z.string(),
      sortOrder: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await loadMuseSettings(db);
      const avatarBlobKey = await applyAvatarChange(
        ctx,
        s.avatarBlobKey,
        args.avatarImage,
        args.removeAvatar,
        "muse",
      );
      await db
        .update(schema.museSettings)
        .set({
          name: args.name,
          role: args.role,
          color: args.color || "#2f6bff",
          avatarBlobKey,
          enabled: args.enabled ? 1 : 0,
          canExecLinux: args.canExecLinux ? 1 : 0,
          canEditFiles: args.canEditFiles ? 1 : 0,
          thinking: args.thinking,
          systemPrompt: args.systemPrompt,
          memory: args.memory,
          note: args.note,
        })
        .where(eq(schema.museSettings.id, 1));
      if (args.name !== s.name) {
        // Rooms still carrying Muse's automatic title (the starter
        // room and solo Muse rooms, titled with the old name) follow
        // the rename; a room the user renamed keeps its own name.
        await db
          .update(schema.conversations)
          .set({ title: args.name })
          .where(
            and(
              eq(schema.conversations.titleAuto, 1),
              eq(schema.conversations.title, s.name),
              isNull(schema.conversations.agentId),
            ),
          );
      }
      ctx.invalidateQueries();
      return {
        name: args.name,
        role: args.role,
        color: args.color || "#2f6bff",
        avatarUrl: await resolveAvatarUrl(ctx, avatarBlobKey),
        enabled: args.enabled,
        canExecLinux: args.canExecLinux,
        canEditFiles: args.canEditFiles,
        thinking: args.thinking,
        systemPrompt: args.systemPrompt,
        memory: args.memory,
        note: args.note,
        sortOrder: s.sortOrder,
      };
    },
  }),

  listGroupMembers: defineAction({
    description:
      "Returns the agent members of one group (or member-based) conversation: whether Muse is a member, the member added agents' ids in join order, and each member's per-group enabled switch. The user is always a member and is not listed.",
    request: z.object({ conversationId: z.number().int().positive() }),
    response: groupMembersOut,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const members = await loadGroupMembers(db, args.conversationId);
      return toGroupMembersOut(members);
    },
  }),

  setGroupMember: defineAction({
    description:
      "Adds an agent to a group (or member-based 「新建对话」) conversation or removes it (agentId null = Muse, the fixed platform agent). A newly added member starts enabled. Only enabled member agents reply; the user is always a member and cannot be removed. Returns the conversation's updated member set.",
    request: z.object({
      conversationId: z.number().int().positive(),
      agentId: z.number().int().positive().nullable().default(null),
      member: z.boolean(),
    }),
    response: groupMembersOut,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const convRows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      const conv = convRows[0];
      if (!conv || (conv.kind !== "group" && conv.memberBased !== 1))
        throw new Error("setGroupMember: group conversation not found");
      if (args.agentId != null) {
        const agentRows = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(eq(schema.agents.id, args.agentId));
        if (agentRows.length === 0)
          throw new Error("setGroupMember: agent not found");
      }
      const match =
        args.agentId == null
          ? and(
              eq(schema.groupMembers.conversationId, args.conversationId),
              isNull(schema.groupMembers.agentId),
            )
          : and(
              eq(schema.groupMembers.conversationId, args.conversationId),
              eq(schema.groupMembers.agentId, args.agentId),
            );
      if (args.member) {
        const existing = await db
          .select({ id: schema.groupMembers.id })
          .from(schema.groupMembers)
          .where(match);
        if (existing.length === 0) {
          await db.insert(schema.groupMembers).values({
            conversationId: args.conversationId,
            agentId: args.agentId,
          });
        }
      } else {
        await db.delete(schema.groupMembers).where(match);
      }
      // While the room's title is still its automatic default, a
      // membership change keeps it in sync with the title scheme:
      // no agent members → 「新对话」, exactly one → that agent's
      // name, several → 「群聊N」 from the never-reused counter (an
      // existing 「群聊N」 title is kept as it is).
      if (conv.titleAuto === 1) {
        const now = await loadGroupMembers(db, args.conversationId);
        const count = (now.muse ? 1 : 0) + now.agentIds.length;
        let nextTitle: string | null = null;
        if (count === 0) {
          nextTitle = "新对话";
        } else if (count === 1) {
          if (now.muse) {
            const s = await loadMuseSettings(db);
            nextTitle = s.name || "Muse";
          } else {
            const onlyId = now.agentIds[0];
            const aRows =
              onlyId != null
                ? await db
                    .select({ name: schema.agents.name })
                    .from(schema.agents)
                    .where(eq(schema.agents.id, onlyId))
                : [];
            nextTitle = aRows[0]?.name || "智能体";
          }
        } else if (!/^群聊\d+$/.test(conv.title)) {
          // A provisional room consumes no number yet — numbers are
          // only taken when a room is actually saved. It carries the
          // unnumbered placeholder until its first message lands.
          nextTitle =
            conv.provisional === 1
              ? "群聊"
              : `群聊${await takeNextGroupNumber(db)}`;
        }
        if (nextTitle && nextTitle !== conv.title) {
          await db
            .update(schema.conversations)
            .set({ title: nextTitle })
            .where(eq(schema.conversations.id, args.conversationId));
        }
      }
      // No blanket ctx.invalidateQueries() here: it would make the
      // client refetch EVERY active query (rooms, agents, messages,
      // files, VPN state) after a single membership tap, which on
      // the user's phone read as the tap taking forever. The
      // callers apply this response to their member cache directly
      // and invalidate only the conversation list (a membership
      // change can auto-rename the room).
      const members = await loadGroupMembers(db, args.conversationId);
      return toGroupMembersOut(members);
    },
  }),

  setGroupMemberEnabled: defineAction({
    description:
      "Flips one member agent's per-group switch (the toggle row at the top of a group chat): a switched-off member stays in the group but never replies there; switching it back on restores its replies. The state is stored on the membership row, so it survives reloads. agentId null toggles Muse's membership switch. Returns the conversation's updated member set.",
    request: z.object({
      conversationId: z.number().int().positive(),
      agentId: z.number().int().positive().nullable().default(null),
      enabled: z.boolean(),
    }),
    response: groupMembersOut,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const match =
        args.agentId == null
          ? and(
              eq(schema.groupMembers.conversationId, args.conversationId),
              isNull(schema.groupMembers.agentId),
            )
          : and(
              eq(schema.groupMembers.conversationId, args.conversationId),
              eq(schema.groupMembers.agentId, args.agentId),
            );
      const existing = await db
        .select({ id: schema.groupMembers.id })
        .from(schema.groupMembers)
        .where(match);
      if (existing.length === 0)
        throw new Error("setGroupMemberEnabled: not a member of this conversation");
      await db
        .update(schema.groupMembers)
        .set({ enabled: args.enabled ? 1 : 0 })
        .where(match);
      // No blanket ctx.invalidateQueries(): see setGroupMember —
      // the caller applies this response to its member cache.
      const members = await loadGroupMembers(db, args.conversationId);
      return toGroupMembersOut(members);
    },
  }),

  listFiles: defineAction({
    description:
      "Lists every file in the space, newest first: files uploaded directly in the files column (source 'upload') and files sent in chats (source 'chat', with the conversation they came from). Each entry carries its per-file agent-access switch state and whether it is a readable text file.",
    request: z.object({}),
    response: z.object({
      files: z.array(
        z.object({
          id: z.number(),
          source: z.enum(["upload", "chat"]),
          name: z.string(),
          size: z.number().nullable(),
          mimeType: z.string().nullable(),
          url: z.string().nullable(),
          isImage: z.boolean(),
          isText: z.boolean(),
          agentAccess: z.boolean(),
          createdAt: z.string(),
          conversationId: z.number().nullable(),
          conversationTitle: z.string(),
          conversationKind: z.enum(["direct", "group"]),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const files: {
        id: number;
        source: "upload" | "chat";
        name: string;
        size: number | null;
        mimeType: string | null;
        url: string | null;
        isImage: boolean;
        isText: boolean;
        agentAccess: boolean;
        createdAt: string;
        conversationId: number | null;
        conversationTitle: string;
        conversationKind: "direct" | "group";
      }[] = [];
      const uploads = await db
        .select()
        .from(schema.spaceFiles)
        .orderBy(desc(schema.spaceFiles.id));
      for (const f of uploads) {
        let url: string | null = null;
        try {
          url = await ctx.blobs.getUrl(f.blobKey);
        } catch {
          url = null;
        }
        files.push({
          id: f.id,
          source: "upload",
          name: f.name || "未命名文件",
          size: f.size,
          mimeType: f.mime,
          url,
          isImage: f.mime ? f.mime.startsWith("image/") : false,
          isText: isTextFile(f.name, f.mime),
          // Images sit outside the agent-access system: always
          // reported off, whatever a stale stored flag says.
          agentAccess: isImageMime(f.mime) ? false : f.agentAccess === 1,
          createdAt: safeIso(f.createdAt),
          conversationId: null,
          conversationTitle: "",
          conversationKind: "direct",
        });
      }
      const rows = await db
        .select()
        .from(schema.messages)
        .where(isNotNull(schema.messages.imageBlobKey))
        .orderBy(desc(schema.messages.id));
      const convs = await db.select().from(schema.conversations);
      const convById = new Map(convs.map((c) => [c.id, c]));
      for (const row of rows) {
        let url: string | null = null;
        try {
          url = row.imageBlobKey
            ? await ctx.blobs.getUrl(row.imageBlobKey)
            : null;
        } catch {
          url = null;
        }
        const conv = convById.get(row.conversationId);
        const name = row.fileName ?? fallbackFileName(row.fileMime);
        files.push({
          id: row.id,
          source: "chat",
          name,
          size: row.fileSize,
          mimeType: row.fileMime,
          url,
          isImage: row.fileMime
            ? row.fileMime.startsWith("image/")
            : true,
          isText: isTextFile(name, row.fileMime),
          agentAccess: isImageMime(row.fileMime)
            ? false
            : row.agentAccess === 1,
          createdAt: safeIso(row.createdAt),
          conversationId: row.conversationId,
          conversationTitle: conv?.title ?? "Muse",
          conversationKind: conv?.kind ?? "direct",
        });
      }
      files.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return { files };
    },
  }),

  uploadFiles: defineAction({
    description:
      "Uploads one or more files directly into the space's file list (the files column's upload entry). Bytes are stored as blobs; text files also keep a decoded copy for preview and agent access. New uploads start with agent access off. Returns per-file results so partial failures are reported honestly.",
    request: z.object({
      files: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            mimeType: z.string().max(120).default(""),
            dataBase64: z.string().max(15_000_000),
            size: z.number().int().nonnegative(),
          }),
        )
        .min(1)
        .max(10),
    }),
    response: z.object({
      uploaded: z.array(z.object({ id: z.number(), name: z.string() })),
      failed: z.array(z.object({ name: z.string(), error: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const uploaded: { id: number; name: string }[] = [];
      const failed: { name: string; error: string }[] = [];
      for (const f of args.files) {
        try {
          const binary = atob(f.dataBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          if (bytes.length > 10 * 1024 * 1024) {
            failed.push({ name: f.name, error: "文件不能超过 10MB" });
            continue;
          }
          const blobKey = `uploads/${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          await ctx.blobs.put(blobKey, bytes, {
            contentType: f.mimeType || "application/octet-stream",
          });
          const inserted = await db
            .insert(schema.spaceFiles)
            .values({
              name: f.name,
              size: bytes.length,
              mime: f.mimeType || null,
              blobKey,
              agentAccess: 0,
            })
            .returning({ id: schema.spaceFiles.id });
          const row = inserted[0];
          if (!row) throw new Error("uploadFiles: insert returned no rows");
          if (isTextFile(f.name, f.mimeType || null)) {
            await storeFileText(db, blobKey, bytes);
          }
          uploaded.push({ id: row.id, name: f.name });
        } catch {
          failed.push({ name: f.name, error: "上传失败，请重试" });
        }
      }
      ctx.invalidateQueries();
      return { uploaded, failed };
    },
  }),

  setFileAgentAccess: defineAction({
    description:
      "Flips one file's agent-access switch (source 'upload' = a files-column upload, 'chat' = a file sent in a chat). On = agents may browse the file (text files: read its content and save edits back; other types: name/type/size only). Off = the file is invisible to agents. The state is stored server-side and persists. Image files are outside this system: the call clears any stale flag on them and reports access off.",
    request: z.object({
      source: z.enum(["upload", "chat"]),
      id: z.number().int().positive(),
      access: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true), agentAccess: z.boolean() }),
    handler: async (
      ctx,
      args,
    ): Promise<{ ok: true; agentAccess: boolean }> => {
      const db = ctx.db<typeof schema>();
      if (args.source === "upload") {
        const rows = await db
          .select({ mime: schema.spaceFiles.mime })
          .from(schema.spaceFiles)
          .where(eq(schema.spaceFiles.id, args.id));
        const isImage = isImageMime(rows[0]?.mime);
        await db
          .update(schema.spaceFiles)
          .set({ agentAccess: isImage ? 0 : args.access ? 1 : 0 })
          .where(eq(schema.spaceFiles.id, args.id));
        ctx.invalidateQueries();
        return { ok: true, agentAccess: isImage ? false : args.access };
      }
      const rows = await db
        .select({ fileMime: schema.messages.fileMime })
        .from(schema.messages)
        .where(eq(schema.messages.id, args.id));
      const isImage = isImageMime(rows[0]?.fileMime);
      await db
        .update(schema.messages)
        .set({ agentAccess: isImage ? 0 : args.access ? 1 : 0 })
        .where(eq(schema.messages.id, args.id));
      ctx.invalidateQueries();
      return { ok: true, agentAccess: isImage ? false : args.access };
    },
  }),

  deleteFile: defineAction({
    description:
      "Deletes one file from the space's file list. An upload is removed entirely (row, blob, captured text). A chat file's message is deleted along with its blob, so the file disappears from its conversation too.",
    request: z.object({
      source: z.enum(["upload", "chat"]),
      id: z.number().int().positive(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await deleteOneFile(ctx, db, args.source, args.id);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteFiles: defineAction({
    description:
      "Batch-deletes files picked in the files column's manage mode. Each item is deleted exactly like the single-file delete (uploads lose row/blob/text; chat files lose their message and blob). Returns how many files were actually removed.",
    request: z.object({
      items: z
        .array(
          z.object({
            source: z.enum(["upload", "chat"]),
            id: z.number().int().positive(),
          }),
        )
        .min(1)
        .max(200),
    }),
    response: z.object({ ok: z.literal(true), deleted: z.number() }),
    handler: async (
      ctx,
      args,
    ): Promise<{ ok: true; deleted: number }> => {
      const db = ctx.db<typeof schema>();
      let deleted = 0;
      for (const item of args.items) {
        if (await deleteOneFile(ctx, db, item.source, item.id)) deleted++;
      }
      ctx.invalidateQueries();
      return { ok: true, deleted };
    },
  }),

  setFilesAgentAccess: defineAction({
    description:
      "Batch-flips the agent-access switch for several files at once (the files column's manage mode: grant or revoke agent access for the whole selection). Same per-file semantics as the single switch. Image files are skipped entirely — they sit outside the access system — and are not counted as updated.",
    request: z.object({
      items: z
        .array(
          z.object({
            source: z.enum(["upload", "chat"]),
            id: z.number().int().positive(),
          }),
        )
        .min(1)
        .max(200),
      access: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true), updated: z.number() }),
    handler: async (
      ctx,
      args,
    ): Promise<{ ok: true; updated: number }> => {
      const db = ctx.db<typeof schema>();
      let updated = 0;
      for (const item of args.items) {
        if (item.source === "upload") {
          const rows = await db
            .select({ mime: schema.spaceFiles.mime })
            .from(schema.spaceFiles)
            .where(eq(schema.spaceFiles.id, item.id));
          if (isImageMime(rows[0]?.mime)) continue;
          await db
            .update(schema.spaceFiles)
            .set({ agentAccess: args.access ? 1 : 0 })
            .where(eq(schema.spaceFiles.id, item.id));
        } else {
          const rows = await db
            .select({ fileMime: schema.messages.fileMime })
            .from(schema.messages)
            .where(eq(schema.messages.id, item.id));
          if (isImageMime(rows[0]?.fileMime)) continue;
          await db
            .update(schema.messages)
            .set({ agentAccess: args.access ? 1 : 0 })
            .where(eq(schema.messages.id, item.id));
        }
        updated++;
      }
      ctx.invalidateQueries();
      return { ok: true, updated };
    },
  }),

  getPreviewImageData: defineAction({
    description:
      "Returns one stored image's PREVIEW bytes as base64 for the client's preview loader: a downscaled JPEG generated once on the server and cached beside the blob store (variant 'thumb' caps the longest side at 360px, 'full' at 1440px), so a multi-megabyte original no longer crosses the actions channel on every view. The client passes the blob URL it already holds (./blobs/<base64url of the blob key>); the key is decoded here and the preview is produced by the privileged readBlobPreview handler (ctx.blobs has no byte read, and the URL getUrl returns is a client-relative path the server cannot fetch). This channel exists because the user's phone webview has refused every client-side route to the blob bytes across three builds (direct <img>, blob: object URL, data: URL built from a client fetch) while action responses load fine there. Errors are thrown with the real reason so the preview surfaces land in their retryable failed state.",
    request: z.object({
      url: z.string().min(1).max(2000),
      variant: z.enum(["thumb", "full"]).default("full"),
    }),
    response: z.object({ dataBase64: z.string(), mimeType: z.string() }),
    privileged: [privileged.readBlobPreview],
    handler: async (
      ctx,
      args,
    ): Promise<{ dataBase64: string; mimeType: string }> => {
      const key = blobKeyFromUrl(args.url);
      if (!key) throw new Error("图片地址无效，无法预览");
      const r = await ctx.executePrivileged(privileged.readBlobPreview, {
        key,
        maxDim: args.variant === "thumb" ? 360 : 1440,
      });
      if (!r.ok) throw new Error(r.error || "图片读取失败");
      return { dataBase64: r.dataBase64, mimeType: r.contentType };
    },
  }),

  getOriginalFileData: defineAction({
    description:
      "Returns one stored file's ORIGINAL bytes as base64 for a download the user explicitly tapped (the image preview's download button, the file detail's 下载文件 button). The bytes travel over the actions channel — the channel this webview reliably loads — because the blob route cannot serve as a download: its responses carry CSP sandbox headers, so pointing an <a download> at the blob URL saved nothing on the user's phone (reported 2026-11-21 for AI-generated images). The client rebuilds a Blob from these bytes and saves it via the system share sheet on touch devices, falling back to a same-document object URL when the share is unavailable or its user activation expired during the fetch. The privileged reader caps files at 64MB — the same cap the reply-media store accepts, so anything the space stored can be downloaded back — and reports the real reason when a blob is gone.",
    request: z.object({
      url: z.string().min(1).max(2000),
    }),
    response: z.object({ dataBase64: z.string(), mimeType: z.string() }),
    privileged: [privileged.readBlobBytes],
    handler: async (
      ctx,
      args,
    ): Promise<{ dataBase64: string; mimeType: string }> => {
      const key = blobKeyFromUrl(args.url);
      if (!key) throw new Error("文件地址无效，无法下载");
      const r = await ctx.executePrivileged(privileged.readBlobBytes, {
        key,
      });
      if (!r.ok) throw new Error(r.error || "文件读取失败");
      return { dataBase64: r.dataBase64, mimeType: r.contentType };
    },
  }),

  prewarmImagePreviews: defineAction({
    description:
      "Pre-generates the cached preview JPEGs (360px thumb + 1440px full) for EVERY image already in the space's blob store, so opening an image-heavy room never waits on first-open generation and preview traffic never crowds the shared actions channel — the diagnosed cause of the group member panel's slow 加入 and the 加载失败 timeouts (a first-open 3.7MB original otherwise generates on demand in the same channel the 加入 request queues behind). Idempotent: images whose previews already exist are counted as cached and left byte-identical; GIF/SVG keep their passthrough and are skipped. Runs once against the real data after this build ships, and can be re-run any time; images uploaded later still generate their preview on first view and cache it the same way.",
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
      generated: z.number(),
      cached: z.number(),
      skipped: z.number(),
      failed: z.number(),
    }),
    privileged: [privileged.prewarmBlobPreviews],
    handler: async (
      ctx,
    ): Promise<{
      ok: true;
      generated: number;
      cached: number;
      skipped: number;
      failed: number;
    }> => {
      const r = await ctx.executePrivileged(privileged.prewarmBlobPreviews, {});
      if (!r.ok) throw new Error(r.error || "预览图预生成失败");
      return {
        ok: true as const,
        generated: r.generated,
        cached: r.cached,
        skipped: r.skipped,
        failed: r.failed,
      };
    },
  }),

  detectDoubaoModels: defineAction({
    description:
      "Identifies the models a Doubao web-token agent's account can actually call, the way an API agent's 测试连接 reads the provider's /models list: it fetches the /chat page Doubao's servers serve for the agent's stored Cookie and parses the account's own model-menu config (menuConfV2) out of it — every model with its wire key, mode group （对话 / 工作任务）, the site's tags, its own model_extra_params, its own 推理强度 levels, and the membership gate the config itself sets (subscribe_config.need_upgrade, e.g. Pro for an account without a 豆包 membership). The parsed catalog is stored on the agent (web_menu_json / web_menu_at) and drives the model menu in the settings panel and the chat toolbar, and the adapter's wire bundle at send time. agentId 0 resolves to the space's Doubao web agent only when exactly one exists; with two or more it is refused, so one account's menu can never be stored on another agent by ambiguity. Failures return the site's real outcome — nothing is invented when the page cannot be read.",
    request: z.object({ agentId: z.number().int().min(0) }),
    response: z.object({
      ok: z.literal(true),
      agentId: z.number(),
      menu: doubaoMenuSchema,
      menuAt: z.string(),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: true;
      agentId: number;
      menu: DoubaoMenu;
      menuAt: string;
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.agents);
      await refreshAgentRoute(ctx);
      let agent = rows.find((a) => a.id === args.agentId);
      if (args.agentId === 0) {
        // agentId 0 is the legacy "the space's Doubao agent"
        // shorthand. With TWO Doubao web agents in the space it
        // is ambiguous — silently resolving to the first would
        // detect (and store) one account's menu for a caller who
        // may mean the other — so it only resolves when exactly
        // one Doubao web agent exists.
        const doubaoAgents = rows.filter(
          (a) => a.provider === "doubao" && a.connectionType === "web",
        );
        if (doubaoAgents.length > 1) {
          throw new Error(
            "空间里有多个豆包网页版智能体，必须指定要识别哪一个的 agentId（不指定会认到第一个，可能把一个账号的模型菜单写到另一个智能体上）",
          );
        }
        agent = doubaoAgents[0];
      }
      if (!agent) throw new Error("detectDoubaoModels: agent not found");
      if (agent.provider !== "doubao" || agent.connectionType !== "web") {
        throw new Error("只有豆包网页版智能体有可识别的账号模型菜单");
      }
      const token = agent.webToken.trim();
      if (!token) {
        throw new Error("尚未保存豆包登录令牌，先粘贴 Cookie 并验证登录后再识别");
      }
      const fetched = await fetchDoubaoMenu(token);
      if ("error" in fetched) throw new Error(fetched.error);
      const menuAt = new Date();
      await db
        .update(schema.agents)
        .set({
          webMenuJson: JSON.stringify(fetched.menu),
          webMenuAt: menuAt,
        })
        .where(eq(schema.agents.id, agent.id));
      ctx.invalidateQueries();
      return {
        ok: true as const,
        agentId: agent.id,
        menu: fetched.menu,
        menuAt: menuAt.toISOString(),
      };
    },
  }),

  getDoubaoSendData: defineAction({
    description:
      "Returns everything the space actually sends to Doubao for one web-token Doubao agent, for the settings panel's 发送数据诊断: the stored Cookie's field NAMES (never its values) with the login-critical fields flagged present/missing; the send plan the SAME builder chatDoubao sends with (per attempt: label, full URL with query parameters, full request body — built with a placeholder message text, since the real body carries the room's current prompt); the model selection and recovered request parameters (region, the account id the官网 page served for this agent's Cookie reports, device_id and its source, web_id / msToken / fp presence, client versions); and the last real send's stored record verbatim (web_last_send_json: per attempt the exact URL + body that went out and the site's real response digest, plus the record's sentSelection — the selection that actually went out, read back from the ran attempts' own bodies at send time: whether any attempt carried the bundle, which attempt carried it, which attempt got the reply, and the values that body carried). Nothing is sent to Doubao by this action except the /chat page read doubaoRequestParams already makes when recovering parameters.",
    request: z.object({ agentId: z.number().int().positive() }),
    response: z.object({
      ok: z.literal(true),
      webStatus: z.string(),
      webError: z.string(),
      cookieFieldCount: z.number(),
      cookieFields: z.array(z.string()),
      loginFields: z.array(
        z.object({ name: z.string(), present: z.boolean() }),
      ),
      plan: z.object({
        params: z.object({
          region: z.string(),
          deviceId: z.string(),
          deviceIdSource: z.string(),
          // The account id the官网 page served for this agent's
          // Cookie reports — two Doubao agents showing the SAME
          // id here are, by the site's own account, one account.
          accountId: z.string(),
          webIdPresent: z.boolean(),
          webId: z.string(),
          msTokenPresent: z.boolean(),
          fpPresent: z.boolean(),
          versionCode: z.string(),
          pcVersion: z.string(),
        }),
        selection: z.object({
          modelKey: z.string(),
          modeId: z.string(),
          effort: z.number(),
          gate: z.number(),
          search: z.boolean(),
        }),
        attempts: z.array(
          z.object({
            label: z.string(),
            url: z.string(),
            bodyJson: z.string(),
          }),
        ),
      }),
      lastSendJson: z.string(),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: true;
      webStatus: string;
      webError: string;
      cookieFieldCount: number;
      cookieFields: string[];
      loginFields: { name: string; present: boolean }[];
      plan: {
        params: DoubaoSendPlan["params"];
        selection: DoubaoSendPlan["selection"];
        attempts: { label: string; url: string; bodyJson: string }[];
      };
      lastSendJson: string;
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) throw new Error("getDoubaoSendData: agent not found");
      if (agent.provider !== "doubao" || agent.connectionType !== "web") {
        throw new Error("只有豆包网页版智能体有发送数据诊断");
      }
      const token = agent.webToken.trim();
      if (!token) {
        throw new Error("尚未保存豆包登录 Cookie，没有可展示的发送数据");
      }
      const cookieFields = token
        .split(";")
        .map((part) => part.slice(0, part.indexOf("=")).trim())
        .filter(Boolean);
      const loginNames = [
        "sessionid",
        "sid_tt",
        "sessionid_ss",
        "uid_tt",
        "passport_csrf_token",
        "s_v_web_id",
        "msToken",
        "ttwid",
      ];
      const loginFields = loginNames.map((name) => ({
        name,
        present: cookieValue(token, name) !== "",
      }));
      const plan = await buildDoubaoSendPlan(
        token,
        "（示例：这里是发送时填入的本次消息内容）",
        agent.webDeviceId,
        {
          menu: doubaoMenuOf(agent),
          modelKey: doubaoSelectedKey(agent),
          reasoning: agent.webReasoning,
          search: agent.webSearch === 1,
          session: null,
        },
      );
      return {
        ok: true as const,
        webStatus: agent.webStatus,
        webError: agent.webError,
        cookieFieldCount: cookieFields.length,
        cookieFields,
        loginFields,
        plan: {
          params: plan.params,
          selection: plan.selection,
          attempts: plan.attempts.map((a) => ({
            label: a.label,
            url: a.url,
            bodyJson: JSON.stringify(a.body),
          })),
        },
        lastSendJson: agent.webLastSendJson,
      };
    },
  }),

  getDoubaoSendLog: defineAction({
    description:
      "Returns the newest 20 Doubao guidance-log entries for one web-token Doubao agent, for the settings panel's 指导日志 next to 发送数据诊断: per send the time, outcome (replied / rejected / unparsed / blocked / network_error / cookie_invalid / identity_mismatch), HTTP status, response byte count, Doubao's own error code/message, verify/shark flags, the parser's candidate-text count and payload count, a capped response summary the panel can expand, and a plain-language guidance line derived from the recorded outcome and error code that says what to do next. The same log also carries the async-video collection's entries (collect_registered / collected / collect_expired). A network_error entry's recorded message is the underlying thrown error verbatim (name, message, cause chain, the phase the send had reached and the elapsed time), not a fixed sentence. The log is written by the send path itself (one row per send, pruned to 20); the Cookie is never part of it — no field of this action touches it.",
    request: z.object({ agentId: z.number().int().positive() }),
    response: z.object({
      ok: z.literal(true),
      entries: z.array(
        z.object({
          id: z.number(),
          at: z.string(),
          outcome: z.string(),
          httpStatus: z.number().nullable(),
          responseBytes: z.number(),
          errorCode: z.number().nullable(),
          errorMsg: z.string(),
          hasVerify: z.boolean(),
          hasShark: z.boolean(),
          candidateCount: z.number(),
          payloadCount: z.number(),
          summary: z.string(),
          guidance: z.string(),
        }),
      ),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: true;
      entries: {
        id: number;
        at: string;
        outcome: string;
        httpStatus: number | null;
        responseBytes: number;
        errorCode: number | null;
        errorMsg: string;
        hasVerify: boolean;
        hasShark: boolean;
        candidateCount: number;
        payloadCount: number;
        summary: string;
        guidance: string;
      }[];
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) throw new Error("getDoubaoSendLog: agent not found");
      if (agent.provider !== "doubao" || agent.connectionType !== "web") {
        throw new Error("只有豆包网页版智能体有指导日志");
      }
      // The plain-language next step for one recorded send,
      // derived only from its recorded outcome + error code —
      // the same mapping the settings panel has always needed
      // next to the raw error codes.
      const guidanceFor = (e: {
        outcome: string;
        errorCode: number | null;
        errorMsg: string;
      }): string => {
        if (e.errorCode === 710022004)
          return "风控验证：请在自己浏览器里完成验证、换一份新鲜 Cookie 再发一条，不要连发";
        if (e.errorCode === 710020202)
          return "参数无效：请求体或指纹需对照当前网页版";
        if (e.errorCode === 710012001)
          return "登录已过期：请重新粘贴 Cookie";
        if (e.outcome === "replied") return "正常";
        if (e.outcome === "blocked")
          return "风控验证：请在自己浏览器里完成验证、换一份新鲜 Cookie 再发一条，不要连发";
        if (e.outcome === "unparsed")
          return "豆包回了内容但没解析出来：可能是返回格式变了，请看诊断摘要";
        if (e.outcome === "cookie_invalid")
          return "Cookie 有字段含非法字符、这次根本没发出：按记录里点名的字段，重新从豆包网页复制一份完整 Cookie 保存后再发";
        if (e.outcome === "identity_mismatch")
          return "账号不一致、这次根本没发出：这份 Cookie 现在指向的账号与该智能体验证时记录的账号不同。打开该智能体设置重新验证登录确认当前账号；若本应是另一个账号，从那个账号的浏览器会话重新复制 Cookie 再验证";
        if (e.outcome === "network_error")
          // The recorded errorMsg IS the underlying error
          // (name/message/cause + the phase reached + elapsed
          // time) since the error-swallowing fix — surface it
          // in the guidance line itself, not a generic retry.
          return e.errorMsg
            ? `请求没到达豆包：${e.errorMsg.slice(0, 160)}`
            : "网络出错：请稍后再发一条";
        if (e.outcome === "rejected")
          return "豆包拒绝了这次发送：错误码和原文见本条记录，请看诊断摘要";
        if (e.outcome === "collect_registered")
          return "已登记自动补收：空间每 15 分钟去官网对话查一次，视频一到就自动下载存进房间，最长等 2 小时";
        if (e.outcome === "collected")
          return "官网后来推送的媒体已下载存进对应房间，去房间里就能看到";
        if (e.outcome === "collect_expired")
          return "等了 2 小时官网仍未推送可补收的媒体，已停止补收；可以去豆包官网打开这个对话确认视频是否生成成功";
        return "请看诊断摘要";
      };
      const logs = await db
        .select()
        .from(schema.doubaoSendLogs)
        .where(eq(schema.doubaoSendLogs.agentId, args.agentId))
        .orderBy(desc(schema.doubaoSendLogs.id))
        .limit(20);
      return {
        ok: true as const,
        entries: logs.map((row) => ({
          id: row.id,
          at: row.createdAt.toISOString(),
          outcome: row.outcome,
          httpStatus: row.httpStatus,
          responseBytes: row.responseBytes,
          errorCode: row.errorCode,
          errorMsg: row.errorMsg,
          hasVerify: row.hasVerify === 1,
          hasShark: row.hasShark === 1,
          candidateCount: row.candidateCount,
          payloadCount: row.payloadCount,
          summary: row.summary,
          guidance: guidanceFor(row),
        })),
      };
    },
  }),

  getFileContent: defineAction({
    description:
      "Returns a text file's content for the files column preview (uploads and chat files alike). Non-text files and files whose content cannot be read return available:false with the reason — nothing is fabricated.",
    request: z.object({
      source: z.enum(["upload", "chat"]),
      id: z.number().int().positive(),
    }),
    response: z.object({
      available: z.boolean(),
      content: z.string().nullable(),
      truncated: z.boolean(),
      reason: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let name = "";
      let mime: string | null = null;
      let blobKey: string | null = null;
      if (args.source === "upload") {
        const rows = await db
          .select()
          .from(schema.spaceFiles)
          .where(eq(schema.spaceFiles.id, args.id));
        const f = rows[0];
        if (f) {
          name = f.name;
          mime = f.mime;
          blobKey = f.blobKey;
        }
      } else {
        const rows = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.id, args.id));
        const m = rows[0];
        if (m) {
          name = m.fileName ?? fallbackFileName(m.fileMime);
          mime = m.fileMime;
          blobKey = m.imageBlobKey;
        }
      }
      if (!blobKey) {
        return {
          available: false,
          content: null,
          truncated: false,
          reason: "文件不存在",
        };
      }
      if (!isTextFile(name, mime)) {
        return {
          available: false,
          content: null,
          truncated: false,
          reason: "这个文件不是文本类型，无法直接查看内容",
        };
      }
      const content = await readFileText(ctx, db, blobKey);
      if (content == null) {
        return {
          available: false,
          content: null,
          truncated: false,
          reason: "这个文件的内容暂时无法读取",
        };
      }
      const CAP = 100_000;
      return {
        available: true,
        content: content.slice(0, CAP),
        truncated: content.length > CAP,
        reason: null,
      };
    },
  }),

  listMessages: defineAction({
    description: "Lists all messages of one conversation, oldest first.",
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ messages: z.array(messageOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await loadHistory(db, args.conversationId);
      // Each assistant message is labelled with its own sender (in a
      // group, different members answer different messages).
      const displayCache = new Map<number, AgentDisplay | null>();
      const messages = [];
      for (const row of rows) {
        let display: AgentDisplay | null = null;
        if (row.role === "assistant" && row.agentId != null) {
          if (!displayCache.has(row.agentId)) {
            displayCache.set(
              row.agentId,
              await loadAgentDisplay(ctx, db, row.agentId),
            );
          }
          display = displayCache.get(row.agentId) ?? null;
        }
        messages.push(await toMessageOut(ctx, row, display));
      }
      return { messages };
    },
  }),

  runMessageCodeBlock: defineAction({
    description:
      "Runs one detected code block from an assistant message on this host for real, when the user taps the message's 「在本机运行」 button: the block is re-extracted from the stored message by index, the sender agent's 「执行 Linux 命令」 permission is re-checked, shell blocks run as Linux commands and JavaScript/TypeScript/Python blocks run as snippets; the real outcome is appended to the stored message and returned.",
    request: z.object({
      messageId: z.number().int().positive(),
      blockIndex: z.number().int().nonnegative(),
    }),
    response: runMessageCodeResult,
    privileged: [privileged.execLinuxCommand, privileged.runCodeSnippet],
    handler: async (
      ctx,
      args,
    ): Promise<z.infer<typeof runMessageCodeResult>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, args.messageId));
      const row = rows[0];
      const base = {
        ok: false,
        ran: false,
        noted: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        timedOut: false,
        conversationId: row?.conversationId ?? 0,
      };
      if (!row || row.role !== "assistant") {
        return { ...base, error: "这条消息不存在或不是智能体的回复" };
      }
      // The sender's own switch decides, exactly like the block
      // protocol: an agent (or Muse) without the exec
      // permission never gets its printed code run.
      let perms: HostPerms;
      if (row.agentId != null) {
        const arows = await db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, row.agentId));
        const a = arows[0];
        if (!a) return { ...base, error: "发送这条消息的智能体已不存在" };
        perms = hostPermsOf(a);
      } else {
        perms = hostPermsOf(await loadMuseSettings(db));
      }
      const block = parseFencedBlocks(row.content)[args.blockIndex];
      const target = block ? runnableTargetFor(block.lang) : null;
      if (!block || !target) {
        return { ...base, error: "没有找到可运行的代码块" };
      }
      const appendOutcome = async (section: string): Promise<void> => {
        await db
          .update(schema.messages)
          .set({ content: `${row.content}\n\n${section}` })
          .where(eq(schema.messages.id, row.id));
      };
      if (!perms.exec) {
        await appendOutcome(
          "—— 本机运行结果 ——\n未运行：该智能体没有开启「执行 Linux 命令」权限。",
        );
        return {
          ...base,
          noted: true,
          error: "该智能体没有开启「执行 Linux 命令」权限，未运行",
        };
      }
      let result: {
        ok: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        error: string;
      };
      let heading: string;
      if (target.kind === "shell") {
        result = await ctx.executePrivileged(privileged.execLinuxCommand, {
          command: block.code,
          timeoutSecs: 30,
        });
        heading = `命令：${block.code}`;
      } else {
        result = await ctx.executePrivileged(privileged.runCodeSnippet, {
          language: target.language,
          code: block.code,
          fileName: target.fileName,
        });
        heading = `代码（${target.language}）：\n${block.code}`;
      }
      const out = [result.stdout.trim(), result.stderr.trim()]
        .filter((s) => s !== "")
        .join("\n");
      await appendOutcome(
        `—— 本机运行结果 ——\n${heading}\n退出码：${result.exitCode}${result.timedOut ? "（超时被终止）" : ""}${result.error ? `\n${result.error}` : ""}${out ? `\n输出：\n${out}` : "\n（无输出）"}`,
      );
      return {
        ok: result.ok,
        ran: true,
        noted: true,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        error: result.error,
        conversationId: row.conversationId,
      };
    },
  }),

  sendMessage: defineAction({
    description:
      "Saves the user's message (text and/or one attachment — an image or a generic file), asks Muse for a real reply with full history context, saves and returns both messages. On reply failure returns ok:false with the saved user message so the client can offer retry. Saving this first user message is also what makes a provisional room permanent (and takes its 「群聊N」 number if its title is still the placeholder).",
    request: z.object({
      conversationId: z.number().int().positive(),
      // No length cap on the message text, by the user's explicit
      // request: long pasted code must send in full. (The composer
      // textarea takes its limits from this schema via FIELDS, so
      // it is uncapped too.)
      text: z.string().default(""),
      image: z
        .object({
          dataBase64: z.string(),
          mimeType: z.string(),
          fileName: z.string().max(200).optional(),
          size: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .default(null),
      file: z
        .object({
          dataBase64: z.string(),
          mimeType: z.string(),
          fileName: z.string().min(1).max(200),
          size: z.number().int().nonnegative(),
        })
        .nullable()
        .default(null),
    }),
    response: sendResult,
    privileged: [
      privileged.execLinuxCommand,
      privileged.hostListDir,
      privileged.hostReadFile,
      privileged.hostWriteFile,
    ],
    handler: async (
      ctx,
      args,
    ): Promise<z.infer<typeof sendResult>> => {
      const db = ctx.db<typeof schema>();
      await refreshAgentRoute(ctx);
      const text = args.text.trim();
      if (!text && !args.image && !args.file) {
        return {
          ok: false,
          silent: false,
          error: "消息不能为空",
          userMessage: null,
          assistantMessage: null,
          assistantMessages: [],
        };
      }
      if (args.image && args.file) {
        return {
          ok: false,
          silent: false,
          error: "一次只能发送一个附件",
          userMessage: null,
          assistantMessage: null,
          assistantMessages: [],
        };
      }

      let imageBlobKey: string | null = null;
      let fileName: string | null = null;
      let fileSize: number | null = null;
      let fileMime: string | null = null;
      // The turn's picture as a ChatImage, built once the user
      // row exists (its id keys the picture to its own turn).
      let chatImage: ChatImage | null = null;
      const attachment = args.image ?? args.file;
      if (attachment) {
        if (
          args.image &&
          attachment.mimeType !== "image/jpeg" &&
          attachment.mimeType !== "image/png"
        ) {
          return {
            ok: false,
            silent: false,
            error: "仅支持 JPG 或 PNG 图片",
            userMessage: null,
            assistantMessage: null,
            assistantMessages: [],
          };
        }
        const binary = atob(attachment.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const folder = args.image ? "chat-images" : "chat-files";
        imageBlobKey = `${folder}/${args.conversationId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
        await ctx.blobs.put(imageBlobKey, bytes, {
          contentType: attachment.mimeType || "application/octet-stream",
        });
        fileName = attachment.fileName ?? fallbackFileName(attachment.mimeType);
        fileSize = bytes.length;
        fileMime = attachment.mimeType || "application/octet-stream";
        // Text files keep a decoded copy so the files column can
        // preview them and agents can read/edit them when granted.
        if (isTextFile(fileName, fileMime)) {
          await storeFileText(db, imageBlobKey, bytes);
        }
      }

      const insertedUser = await db
        .insert(schema.messages)
        .values({
          conversationId: args.conversationId,
          role: "user",
          content: text,
          imageBlobKey,
          fileName,
          fileSize,
          fileMime,
        })
        .returning();
      const userRow = insertedUser[0];
      if (!userRow) throw new Error("sendMessage: user insert returned no rows");
      if (args.image) {
        chatImage = {
          dataBase64: args.image.dataBase64,
          mimeType: args.image.mimeType,
          fileName: fileName ?? fallbackFileName(args.image.mimeType),
          messageId: userRow.id,
        };
      }
      await touchConversation(db, args.conversationId);
      const userMessage = await toMessageOut(ctx, userRow);

      const convRows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      const conv = convRows[0];

      // The first user message is what saves a provisional room:
      // flip the flag so the room joins every list from now on, and
      // if its automatic title is still the unnumbered placeholder,
      // take its real 「群聊N」 number now — a room number is only
      // ever consumed by a room that actually gets saved.
      if (conv && conv.provisional === 1) {
        const patch: { provisional: number; title?: string } = {
          provisional: 0,
        };
        if (conv.titleAuto === 1 && conv.title === "群聊") {
          patch.title = `群聊${await takeNextGroupNumber(db)}`;
        }
        await db
          .update(schema.conversations)
          .set(patch)
          .where(eq(schema.conversations.id, conv.id));
      }

      // Group chat (and member-based 「新建对话」 conversations):
      // every agent member replies in turn; one with no agent
      // members stays silent.
      if (conv?.kind === "group" || conv?.memberBased === 1) {
        const group = await produceGroupReplies(
          ctx,
          db,
          args.conversationId,
          chatImage,
        );
        // Event triggers watching this room fire on the new user
        // message (their agents are not members — members just
        // replied through membership above).
        await fireRoomMessageEventTriggers(ctx, db, args.conversationId);
        if (group.status !== "ok") {
          ctx.invalidateQueries();
          return {
            ok: false,
            silent: group.status === "silent",
            error: group.error,
            userMessage,
            assistantMessage: null,
            assistantMessages: [],
          };
        }
        await touchConversation(db, args.conversationId);
        ctx.invalidateQueries();
        const outs: z.infer<typeof messageOut>[] = [];
        for (const row of group.rows) {
          outs.push(
            await toMessageOut(
              ctx,
              row,
              await loadAgentDisplay(ctx, db, row.agentId),
            ),
          );
        }
        return {
          ok: true,
          silent: false,
          error: null,
          userMessage,
          assistantMessage: outs[0] ?? null,
          assistantMessages: outs,
        };
      }

      const history = await loadHistory(db, args.conversationId);
      const sink = createStreamSink(
        db,
        args.conversationId,
        conv?.agentId ?? null,
      );
      const outcome = await produceReply(
        ctx,
        db,
        conv?.agentId ?? null,
        args.conversationId,
        history,
        chatImage,
        await loadNameOf(db),
        sink.onPartial,
      );
      if (outcome.status !== "ok") {
        await sink.discard();
        await fireRoomMessageEventTriggers(ctx, db, args.conversationId);
        ctx.invalidateQueries();
        return {
          ok: false,
          silent: outcome.status === "silent",
          error: outcome.error,
          userMessage,
          assistantMessage: null,
          assistantMessages: [],
        };
      }
      let replyRows: MessageRow[] = [];
      const streamedRow = await sink.complete(outcome.text);
      if (streamedRow) {
        replyRows = [streamedRow];
        if (outcome.media?.length)
          replyRows.push(
            ...(await insertReplyRows(db, args.conversationId, {
              text: "",
              agentId: outcome.agentId,
              media: outcome.media,
            })),
          );
      } else {
        replyRows = await insertReplyRows(db, args.conversationId, outcome);
      }
      const assistantRow = replyRows[0] ?? null;
      if (!assistantRow)
        throw new Error("sendMessage: assistant insert returned no rows");
      // Event triggers watching this room fire on the new user
      // message, after the room's own reply is in.
      await fireRoomMessageEventTriggers(ctx, db, args.conversationId);
      await touchConversation(db, args.conversationId);
      ctx.invalidateQueries();
      const display = await loadAgentDisplay(ctx, db, outcome.agentId);
      const assistantMessages: z.infer<typeof messageOut>[] = [];
      for (const row of replyRows) {
        assistantMessages.push(await toMessageOut(ctx, row, display));
      }
      return {
        ok: true,
        silent: false,
        error: null,
        userMessage,
        assistantMessage: assistantMessages[0] ?? null,
        assistantMessages,
      };
    },
  }),

  retryReply: defineAction({
    description:
      "Regenerates the reply when the conversation's last message is an unanswered user message (used after a failed send). Routes to Muse or to the conversation's own agent exactly like sendMessage.",
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({
      ok: z.boolean(),
      silent: z.boolean(),
      error: z.string().nullable(),
      assistantMessage: messageOut.nullable(),
    }),
    privileged: [
      privileged.execLinuxCommand,
      privileged.hostListDir,
      privileged.hostReadFile,
      privileged.hostWriteFile,
      // A retried image turn re-reads the picture's bytes from
      // its stored blob, so the retry carries the image again.
      privileged.readBlobBytes,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await refreshAgentRoute(ctx);
      const history = await loadHistory(db, args.conversationId);
      const lastMsg = history[history.length - 1];
      if (!lastMsg || lastMsg.role !== "user") {
        return {
          ok: false,
          silent: false,
          error: "没有待回复的消息",
          assistantMessage: null,
        };
      }
      // Retrying an image turn re-sends the picture itself: its
      // bytes are read back from the stored blob, so a retry
      // after a failed image send does not silently degrade
      // into a text-only retry.
      const chatImage = await loadLatestChatImage(ctx, history);
      const convRows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      const conv = convRows[0];
      if (conv?.kind === "group" || conv?.memberBased === 1) {
        const group = await produceGroupReplies(ctx, db, args.conversationId, chatImage);
        if (group.status !== "ok") {
          return {
            ok: false,
            silent: group.status === "silent",
            error: group.error,
            assistantMessage: null,
          };
        }
        await touchConversation(db, args.conversationId);
        ctx.invalidateQueries();
        const first = group.rows[0];
        return {
          ok: true,
          silent: false,
          error: null,
          assistantMessage: first
            ? await toMessageOut(
                ctx,
                first,
                await loadAgentDisplay(ctx, db, first.agentId),
              )
            : null,
        };
      }
      const sink = createStreamSink(
        db,
        args.conversationId,
        conv?.agentId ?? null,
      );
      const outcome = await produceReply(
        ctx,
        db,
        conv?.agentId ?? null,
        args.conversationId,
        history,
        chatImage,
        await loadNameOf(db),
        sink.onPartial,
      );
      if (outcome.status !== "ok") {
        await sink.discard();
        return {
          ok: false,
          silent: outcome.status === "silent",
          error: outcome.error,
          assistantMessage: null,
        };
      }
      let row = await sink.complete(outcome.text);
      if (row) {
        // The streamed row carries the text; insert the reply's
        // media rows behind it as well.
        if (outcome.media?.length)
          await insertReplyRows(db, args.conversationId, {
            text: "",
            agentId: outcome.agentId,
            media: outcome.media,
          });
      } else {
        const inserted = await insertReplyRows(db, args.conversationId, outcome);
        row = inserted[0] ?? null;
      }
      if (!row) throw new Error("retryReply: insert returned no rows");
      await touchConversation(db, args.conversationId);
      ctx.invalidateQueries();
      return {
        ok: true,
        silent: false,
        error: null,
        assistantMessage: await toMessageOut(
          ctx,
          row,
          await loadAgentDisplay(ctx, db, outcome.agentId),
        ),
      };
    },
  }),

  clearConversation: defineAction({
    description: "Deletes all messages in one conversation, leaving it empty.",
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.messages)
        .where(eq(schema.messages.conversationId, args.conversationId));
      // A cleared room also drops its web-conversation mappings:
      // the next reply starts a fresh官网 conversation with the
      // full (new) context, like starting a new chat on the site.
      await clearWebRemote(db, args.conversationId);
      // Any pending Doubao async-media watch belonged to the
      // cleared官网 conversation too — it can never collect
      // into a fresh one, so it goes with the messages.
      await db
        .delete(schema.doubaoPendingMedia)
        .where(
          eq(schema.doubaoPendingMedia.conversationId, args.conversationId),
        );
      await touchConversation(db, args.conversationId);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  renameConversation: defineAction({
    description:
      "Renames one conversation (the 重命名 entry in a recent-chat row's long-press menu). Title only — the room's icon is untouched. Renaming marks the title user-set, so membership changes no longer auto-rename the room afterwards.",
    request: z.object({
      conversationId: z.number().int().positive(),
      title: z.string().trim().min(1).max(60),
    }),
    response: z.object({ id: z.number(), title: z.string() }),
    handler: async (
      ctx,
      args,
    ): Promise<{ id: number; title: string }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      if (!rows[0])
        throw new Error("renameConversation: conversation not found");
      await db
        .update(schema.conversations)
        .set({ title: args.title, titleAuto: 0 })
        .where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return { id: args.conversationId, title: args.title };
    },
  }),

  deleteConversation: defineAction({
    description:
      "Deletes one conversation and all of its messages permanently (the swipe-to-delete action in the list). Works for Muse chats, added-agent chats and group chats.",
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.messages)
        .where(eq(schema.messages.conversationId, args.conversationId));
      await db
        .delete(schema.groupMembers)
        .where(eq(schema.groupMembers.conversationId, args.conversationId));
      await db
        .delete(schema.webRemoteConversations)
        .where(
          eq(schema.webRemoteConversations.conversationId, args.conversationId),
        );
      await db
        .delete(schema.agentTriggers)
        .where(eq(schema.agentTriggers.conversationId, args.conversationId));
      await db
        .delete(schema.doubaoPendingMedia)
        .where(eq(schema.doubaoPendingMedia.conversationId, args.conversationId));
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listAgents: defineAction({
    description:
      "Lists the user-added agents (Muse is fixed and not in this list) with their settings for the settings form — the API key itself is never returned, only hasApiKey — plus each agent's latest conversation id and message preview.",
    request: z.object({}),
    response: z.object({ agents: z.array(agentOut) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .orderBy(asc(schema.agents.id));
      const out: z.infer<typeof agentOut>[] = [];
      for (const a of rows) {
        // The row preview comes from the agent's most recent room
        // that actually has messages — a freshly opened provisional
        // room (nothing sent yet) must not blank out the preview of
        // the last real chat.
        const convs = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.agentId, a.id))
          .orderBy(desc(schema.conversations.updatedAt))
          .limit(10);
        let conv = convs[0];
        let preview = "";
        let previewAt: string | null = null;
        for (const candidate of convs) {
          const last = await db
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.conversationId, candidate.id))
            .orderBy(desc(schema.messages.id))
            .limit(1);
          const lastMsg = last[0];
          if (lastMsg) {
            conv = candidate;
            preview = lastMsg.content || attachmentPreview(lastMsg);
            previewAt = lastMsg.createdAt.toISOString();
            break;
          }
        }
        // Account-collision guard (see recordWebIdentity):
        // computed in memory from the rows already loaded — the
        // names of other same-site web agents whose recorded
        // account identity or credential hash equals this one's.
        const collisionNames =
          a.connectionType === "web" &&
          (a.webIdentityHash !== "" || a.webCredentialHash !== "")
            ? rows
                .filter(
                  (r) =>
                    r.id !== a.id &&
                    r.connectionType === "web" &&
                    r.provider === a.provider &&
                    ((a.webIdentityHash !== "" &&
                      r.webIdentityHash === a.webIdentityHash) ||
                      (a.webCredentialHash !== "" &&
                        r.webCredentialHash === a.webCredentialHash)),
                )
                .map((r) => r.name)
                .join("、")
            : "";
        out.push(
          toAgentOut(
            a,
            conv?.id ?? null,
            preview,
            previewAt,
            await resolveAvatarUrl(ctx, a.avatarBlobKey),
            collisionNames,
          ),
        );
      }
      return { agents: out };
    },
  }),

  createAgent: defineAction({
    description:
      "Adds a new agent with the collaborative space's seat settings (name, role, enabled, provider, API base, API key, model, temperature, max tokens, thinking level, system prompt) plus the advanced API parameters (topP, frequency/presence penalties, seed, stop sequences, response format, max completion tokens — null/empty means the parameter is not sent) and the streaming switch / tool-calling mode (streamEnabled, toolMode). For web-token agents it also stores that site's own web chat options (webMode / webThinking / webSearch — DeepSeek: 快速/专家 mode + 深度思考 + 智能搜索 switches; 豆包： 快速/专家 mode + 联网搜索 switch), which the site's chat adapter sends with every reply. The legacy memory field is still accepted for compatibility: the settings panel folds any saved memory text into the system prompt (there is no separate long-term-memory field any more) and stores '' here; the reply context combines the two columns either way. The key is stored server-side only. Also creates the agent's first room — a provisional member-based room with the agent already a member, saved only once the user sends something in it — and returns both ids.",
    request: agentSettingsInput,
    response: z.object({ id: z.number(), conversationId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const name = args.name || "未命名智能体";
      const avatarBlobKey = await applyAvatarChange(
        ctx,
        null,
        args.avatarImage,
        args.removeAvatar,
        "agents",
      );
      // The model-menu selection （豆包 only) is normalised and
      // the stored webMode re-derived from it, so a fresh agent's
      // mode already matches the menu it was created with.
      let webModel = cleanDoubaoWebModel(args.provider, args.webModel);
      const webModelKey = cleanDoubaoModelKey(args.provider, args.webModelKey);
      // When the pick came in by key, webModel stores that key's
      // legacy projection (when it has one) so the two columns
      // never describe different models.
      if (webModelKey && DOUBAO_LEGACY_MODEL_BY_KEY[webModelKey] !== undefined)
        webModel = DOUBAO_LEGACY_MODEL_BY_KEY[webModelKey] as string;
      const webReasoning = cleanDoubaoWebReasoning(
        args.provider,
        args.webReasoning,
      );
      const webMode =
        args.provider === "doubao"
          ? doubaoDeepThinkSummary(
              webModelKey ||
                (DOUBAO_LEGACY_KEY_BY_MODEL[webModel] ?? "9"),
              webReasoning,
              args.webMode === "expert",
            )
            ? "expert"
            : "fast"
          : args.webMode;
      const inserted = await db
        .insert(schema.agents)
        .values({
          name,
          role: args.role,
          color: args.color || "#5d6a82",
          glyph: args.glyph || name.slice(0, 2),
          avatarBlobKey,
          enabled: args.enabled ? 1 : 0,
          provider: args.provider || "custom",
          apiBase: args.apiBase,
          apiKey: args.apiKey,
          model: args.model,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          topP: args.topP,
          frequencyPenalty: args.frequencyPenalty,
          presencePenalty: args.presencePenalty,
          seed: args.seed,
          stopSequences: args.stopSequences,
          responseFormat: args.responseFormat,
          maxCompletionTokens: args.maxCompletionTokens,
          streamEnabled: args.streamEnabled ? 1 : 0,
          toolMode: args.toolMode,
          canExecLinux: args.canExecLinux ? 1 : 0,
          canEditFiles: args.canEditFiles ? 1 : 0,
          thinking: args.thinking,
          systemPrompt: args.systemPrompt,
          memory: args.memory,
          note: args.note,
          connectionType: args.connectionType,
          webDeviceId: cleanWebDeviceId(args.webDeviceId),
          webMode,
          webThinking: args.webThinking ? 1 : 0,
          webSearch: args.webSearch ? 1 : 0,
          webModel,
          webReasoning,
          webModelKey,
        })
        .returning({ id: schema.agents.id });
      const agent = inserted[0];
      if (!agent) throw new Error("createAgent: insert returned no rows");
      const convInserted = await db
        .insert(schema.conversations)
        .values({
          title: name,
          kind: "direct",
          agentId: agent.id,
          memberBased: 1,
          provisional: 1,
        })
        .returning({ id: schema.conversations.id });
      const conv = convInserted[0];
      if (!conv) throw new Error("createAgent: conversation insert failed");
      await db.insert(schema.groupMembers).values({
        conversationId: conv.id,
        agentId: agent.id,
      });
      ctx.invalidateQueries();
      return { id: agent.id, conversationId: conv.id };
    },
  }),

  updateAgent: defineAction({
    description:
      "Saves one added agent's settings (same field set as createAgent). An empty apiKey field keeps the previously saved key — the key is never sent back to the client, so the form cannot echo it; a non-empty value replaces it. Renaming also retitles the agent's rooms whose titles are still automatic defaults (a room the user renamed keeps its name).",
    request: agentSettingsInput.extend({
      agentId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const existing = rows[0];
      if (!existing) throw new Error("updateAgent: agent not found");
      const name = args.name || existing.name || "未命名智能体";
      const avatarBlobKey = await applyAvatarChange(
        ctx,
        existing.avatarBlobKey,
        args.avatarImage,
        args.removeAvatar,
        "agents",
      );
      // The model-menu selection （豆包 only) is normalised and
      // the stored webMode re-derived from it (fallback: the mode
      // this save submitted), keeping menu, panel and adapter in
      // agreement. Other providers keep no menu selection.
      let webModel = cleanDoubaoWebModel(args.provider, args.webModel);
      const webModelKey = cleanDoubaoModelKey(args.provider, args.webModelKey);
      // When the pick came in by key, webModel stores that key's
      // legacy projection (when it has one) so the two columns
      // never describe different models.
      if (webModelKey && DOUBAO_LEGACY_MODEL_BY_KEY[webModelKey] !== undefined)
        webModel = DOUBAO_LEGACY_MODEL_BY_KEY[webModelKey] as string;
      const webReasoning = cleanDoubaoWebReasoning(
        args.provider,
        args.webReasoning,
      );
      const resolvedKey =
        webModelKey || (DOUBAO_LEGACY_KEY_BY_MODEL[webModel] ?? "9");
      const webMode =
        args.provider === "doubao"
          ? doubaoDeepThinkSummary(
              resolvedKey,
              webReasoning,
              args.webMode === "expert",
            )
            ? "expert"
            : "fast"
          : args.webMode;
      // A pick the account's own menu config marks as needing a
      // membership upgrade is refused, with the site's own gate
      // as the reason — saving it would promise a model the
      // account cannot call.
      if (args.provider === "doubao" && args.connectionType === "web") {
        const entry = doubaoMenuOf(existing).models.find(
          (m) => m.key === resolvedKey,
        );
        if (entry?.needUpgrade) {
          throw new Error(
            `「${entry.name}」需要开通豆包会员才能用——这是你账号的官网菜单配置里标明的（该模型带「需升级」标记），空间没有保存这个选择`,
          );
        }
      }
      // A Doubao selection save NEVER drops the agent's stored
      // 官网 conversations (the v78 behaviour, restored at the
      // user's direction on 2026-11-21): keeping each room on
      // its SAME官网 conversation outranks making the switch
      // take effect. The selection bundle still rides on the
      // first attempt of every send, but Doubao consumes the
      // selection at conversation creation, so inside an
      // existing conversation the site may keep answering with
      // the model that conversation was created with — a
      // mid-conversation switch is not guaranteed, and the UI
      // copy says exactly that.
      await db
        .update(schema.agents)
        .set({
          name,
          role: args.role,
          color: args.color || existing.color,
          glyph: args.glyph || name.slice(0, 2),
          avatarBlobKey,
          enabled: args.enabled ? 1 : 0,
          provider: args.provider || "custom",
          apiBase: args.apiBase,
          apiKey: args.apiKey.trim() !== "" ? args.apiKey : existing.apiKey,
          model: args.model,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          topP: args.topP,
          frequencyPenalty: args.frequencyPenalty,
          presencePenalty: args.presencePenalty,
          seed: args.seed,
          stopSequences: args.stopSequences,
          responseFormat: args.responseFormat,
          maxCompletionTokens: args.maxCompletionTokens,
          streamEnabled: args.streamEnabled ? 1 : 0,
          toolMode: args.toolMode,
          canExecLinux: args.canExecLinux ? 1 : 0,
          canEditFiles: args.canEditFiles ? 1 : 0,
          thinking: args.thinking,
          systemPrompt: args.systemPrompt,
          memory: args.memory,
          note: args.note,
          connectionType: args.connectionType,
          webDeviceId: cleanWebDeviceId(args.webDeviceId),
          webMode,
          webThinking: args.webThinking ? 1 : 0,
          webSearch: args.webSearch ? 1 : 0,
          webModel,
          webReasoning,
          webModelKey,
        })
        .where(eq(schema.agents.id, args.agentId));
      await db
        .update(schema.conversations)
        .set({ title: name })
        .where(
          and(
            eq(schema.conversations.agentId, args.agentId),
            eq(schema.conversations.titleAuto, 1),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateAgentWebOptions: defineAction({
    description:
      "Saves only one web-token agent's web chat options (webMode / webThinking / webSearch, plus 豆包's model-menu selection webModelKey / webReasoning) from the chat window's web toolbar under the composer — the quick switch that mirrors that site's own web UI (DeepSeek: 快速/专家 mode plus independent 深度思考 and 智能搜索 switches; 豆包： the account's own model menu — every model its detected menu lists, with that model's own 推理强度 levels — and its 联网搜索 switch). The values land on the same agents-table fields the settings panel edits, so the toolbar and the settings panel always show the same saved state, and the site's chat adapter reads them on the next reply. For 豆包 the adapter builds the request's real selection bundle from the pick resolved against the account's detected menu catalog (see doubaoWireSelection), the stored webMode is still re-derived alongside as the classic fallback bodies' deep-think summary (see doubaoDeepThinkSummary), a pick the account's own config marks as needing a membership upgrade is refused with that reason. Saving a selection NEVER drops the agent's stored官网 conversations: every room keeps continuing its same官网 conversation (the same-window priority the user chose on 2026-11-21 over guaranteed switching). The new selection bundle still rides on the first attempt of every send, but Doubao consumes the selection at conversation creation, so inside an existing conversation a switch may not take effect — the site can keep answering with the model that conversation was created with; conversations created after the switch carry it from their first message. API agents are rejected: they have no web options and show no toolbar.",
    request: z.object({
      agentId: z.number().int().positive(),
      webMode: z.enum(["", "default", "expert", "fast"]),
      webThinking: z.boolean(),
      webSearch: z.boolean(),
      webModel: z.string().max(40).default(""),
      webModelKey: z.string().max(64).default(""),
      webReasoning: z.string().max(10).default(""),
    }),
    response: z.object({
      ok: z.literal(true),
      webMode: z.string(),
      webThinking: z.boolean(),
      webSearch: z.boolean(),
      webModel: z.string(),
      webModelKey: z.string(),
      webReasoning: z.string(),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: true;
      webMode: string;
      webThinking: boolean;
      webSearch: boolean;
      webModel: string;
      webModelKey: string;
      webReasoning: string;
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) throw new Error("updateAgentWebOptions: agent not found");
      if (agent.connectionType !== "web") {
        throw new Error("该智能体是 API 方式，没有网页版选项");
      }
      // Each site accepts only its own mode values — a mode from
      // another site's switch must never be stored on this agent.
      const allowedModes: Record<string, string[]> = {
        deepseek: ["default", "expert"],
        doubao: ["fast", "expert"],
      };
      const allowed = allowedModes[agent.provider];
      let webMode = agent.webMode;
      if (allowed) {
        if (!allowed.includes(args.webMode)) {
          throw new Error("这个模式不属于该站点的网页版选项");
        }
        webMode = args.webMode;
      }
      // 豆包 has no standalone thinking toggle (专家 IS its
      // thinking mode), so its webThinking is always stored off;
      // sites without a search switch keep their stored value
      // untouched by ignoring the flag the client did not show.
      const webThinking =
        agent.provider === "deepseek" ? args.webThinking : agent.provider === "doubao" ? false : agent.webThinking === 1;
      const webSearch =
        agent.provider === "deepseek" || agent.provider === "doubao"
          ? args.webSearch
          : agent.webSearch === 1;
      // 豆包's model menu: the pick is a wire key into the
      // account's OWN detected menu (or the fallback catalog
      // before detection). Any model the account's menu lists
      // may be stored — the 对话 models, the 工作任务 models and
      // the third-party person-* models alike; the adapter
      // resolves the full bundle (mode_id, extra params,
      // reasoning levels) from that same catalog at send time.
      // Two refusals, both honest: a key the account's menu
      // does not list at all, and a model the account's own
      // config marks as needing a membership upgrade
      // (need_upgrade — Pro for accounts without a 豆包
      // membership), which the account cannot actually call.
      // The stored webMode is re-derived from the resolved
      // pick as the classic bodies' deep-think summary.
      let webModel = agent.webModel;
      let webModelKey = agent.webModelKey;
      let webReasoning = agent.webReasoning;
      if (agent.provider === "doubao") {
        const key = cleanDoubaoModelKey(
          "doubao",
          args.webModelKey || args.webModel,
        );
        if (!key) throw new Error("这个模型不在豆包的模型菜单里");
        const entry = doubaoMenuOf(agent).models.find((m) => m.key === key);
        if (!entry) {
          throw new Error(
            "这个模型不在该账号的豆包菜单里（可能菜单已更新，点「识别可用模型」刷新后再选）",
          );
        }
        if (entry.needUpgrade) {
          throw new Error(
            `「${entry.name}」需要开通豆包会员才能用——这是你账号的官网菜单配置里标明的（该模型带「需升级」标记），空间没有保存这个选择`,
          );
        }
        webModelKey = key;
        webModel = DOUBAO_LEGACY_MODEL_BY_KEY[key] ?? webModel;
        webReasoning = cleanDoubaoWebReasoning("doubao", args.webReasoning);
        webMode = doubaoDeepThinkSummary(key, webReasoning, webMode === "expert")
          ? "expert"
          : "fast";
      }
      await db
        .update(schema.agents)
        .set({
          webMode,
          webThinking: webThinking ? 1 : 0,
          webSearch: webSearch ? 1 : 0,
          webModel,
          webModelKey,
          webReasoning,
        })
        .where(eq(schema.agents.id, args.agentId));
      // A Doubao selection save NEVER drops the agent's stored
      // 官网 conversations (the v78 behaviour, restored at the
      // user's direction on 2026-11-21): keeping each room on
      // its SAME官网 conversation — the same window on the
      // site — outranks making the switch take effect. The new
      // selection bundle still rides on the first attempt of
      // every send, but Doubao consumes the selection at
      // conversation creation (conversation_init_ext) and does
      // not promise to honour a mid-conversation switch, so
      // inside an existing conversation the site may keep
      // answering with the model that conversation was created
      // with; a conversation created after the switch carries
      // the new selection from its first message. The settings
      // and toolbar copy state this trade-off plainly.
      ctx.invalidateQueries();
      return {
        ok: true as const,
        webMode,
        webThinking,
        webSearch,
        webModel,
        webModelKey,
        webReasoning,
      };
    },
  }),

  reorderAgents: defineAction({
    description:
      "Saves the agent list's display order (from the long-press drag reorder in the second column): the full ordered list of entries, agentId null meaning Muse. Each entry's position is stored as its sort_order on the shared Muse/agents scale, so the order survives reloads and re-entry.",
    request: z.object({
      items: z
        .array(z.object({ agentId: z.number().int().positive().nullable() }))
        .min(1)
        .max(200),
    }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      const seenAgents = new Set<number>();
      let museSeen = false;
      for (const item of args.items) {
        if (item.agentId == null) {
          if (museSeen) throw new Error("reorderAgents: Muse listed twice");
          museSeen = true;
        } else {
          if (seenAgents.has(item.agentId))
            throw new Error("reorderAgents: duplicate agent in order");
          seenAgents.add(item.agentId);
        }
      }
      const existing = await db
        .select({ id: schema.agents.id })
        .from(schema.agents);
      const existingIds = new Set(existing.map((r) => r.id));
      for (const id of seenAgents) {
        if (!existingIds.has(id))
          throw new Error("reorderAgents: unknown agent in order");
      }
      const statements: BatchItem<"sqlite">[] = args.items.map(
        (item, index) => {
          const sortOrder = (index + 1) * 10;
          return item.agentId == null
            ? db
                .update(schema.museSettings)
                .set({ sortOrder })
                .where(eq(schema.museSettings.id, 1))
            : db
                .update(schema.agents)
                .set({ sortOrder })
                .where(eq(schema.agents.id, item.agentId));
        },
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  verifyWebToken: defineAction({
    description:
      "Saves (when a new one is pasted) and verifies one web-token agent's login token with a real call to its own site's web API (the validator for the agent's provider/site — DeepSeek, ChatGPT, Claude, Gemini, Grok, Kimi, 千问, 豆包, 元宝, 智谱清言, Mistral or 文心一言 — each with its own endpoint and token shape). The token is stored server-side only and never returned; the response carries only the resulting login state: ok, status (logged_in / expired / blocked / error / ''), the masked account label and the honest failure reason. A successful verification also records the account identity the site itself reports for the credential (see recordWebIdentity: provider-scoped hashes of the identity and of the credential, never returned), clears the agent's account-bound state when the identity changed (stored官网 conversation continuations, a Doubao agent's detected menu), and returns identityWarning when another agent of the same site now resolves to the SAME account — the site itself says both credentials belong to one account, so chats with either agent land in that account's history. An empty token verifies the already-stored one. For 千问 the paste may be the console one-click credential bundle (a JSON object with token, cookie and ua): the three parts are stored separately server-side and every verify/chat call then sends them aligned (Bearer + Cookie header + the captured browser User-Agent); a Cookie token= pair, when present and different, wins over the bundle's token field.",
    request: z.object({
      agentId: z.number().int().positive(),
      // 32768: 千问's paste is the whole console-export JSON
      // (token + full Cookie + UA), which runs well past a bare
      // token's length once the ssxmod cookies are in it.
      token: z.string().max(32768).default(""),
    }),
    response: z.object({
      ok: z.boolean(),
      status: z.string(),
      account: z.string(),
      error: z.string(),
      // Account-collision warning (see recordWebIdentity): ''
      // when this agent's verified account identity is uniquely
      // its own; otherwise a plain-language statement that the
      // site itself resolves this credential and another agent's
      // to the SAME account, with the fix. Also carries the
      // identity-change note when this verification replaced the
      // agent's account (its old account-bound state was
      // cleared).
      identityWarning: z.string(),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: boolean;
      status: string;
      account: string;
      error: string;
      identityWarning: string;
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) throw new Error("verifyWebToken: agent not found");
      if (agent.connectionType !== "web") {
        return {
          ok: false,
          status: agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error: "该智能体不是网页令牌登录方式",
          identityWarning: "",
        };
      }
      // DeepSeek's paste may be the raw localStorage JSON wrapper
      // and 千问's may arrive with a Bearer prefix, surrounding
      // quotes or its own JSON wrapper; both are normalised to
      // the bare token before storing. Every other site's token
      // is stored exactly as pasted.
      // 千问's paste may instead be the console one-click bundle
      // ({ token, cookie, ua }): parseQwenPaste splits it, the
      // token is stored as the web token and the Cookie / UA
      // alongside it (webCookie / webUserAgent), so this
      // verification — and every later chat call — sends the
      // full aligned credential set.
      const qwenPaste =
        agent.provider === "qwen" ? parseQwenPaste(args.token) : null;
      const pasted =
        agent.provider === "deepseek"
          ? unwrapDeepseekToken(args.token)
          : agent.provider === "qwen"
            ? (qwenPaste?.token ?? "")
            : args.token.trim();
      if (qwenPaste && args.token.trim() && !pasted) {
        // The paste carried alignment data but no access token
        // (a bare Cookie string, or a bundle whose token field
        // was empty): keep the Cookie / UA it did carry, then
        // name the exact fix instead of a generic expiry.
        if (qwenPaste.cookie || qwenPaste.ua) {
          await db
            .update(schema.agents)
            .set({
              ...(qwenPaste.cookie ? { webCookie: qwenPaste.cookie } : {}),
              ...(qwenPaste.ua ? { webUserAgent: qwenPaste.ua } : {}),
            })
            .where(eq(schema.agents.id, args.agentId));
          ctx.invalidateQueries();
        }
        return {
          ok: false,
          status: agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error:
            "粘贴内容里没有访问令牌（只有 Cookie / UA）：访问令牌不在 Cookie 里，它在 chat.qwen.ai 的本地存储中。请在该站按 F12 打开「控制台」，运行设置说明里的一行命令，把导出的整段 JSON 粘贴进来",
          identityWarning: "",
        };
      }
      if (pasted) {
        await db
          .update(schema.agents)
          .set({
            webToken: pasted,
            ...(qwenPaste?.cookie ? { webCookie: qwenPaste.cookie } : {}),
            ...(qwenPaste?.ua ? { webUserAgent: qwenPaste.ua } : {}),
          })
          .where(eq(schema.agents.id, args.agentId));
      }
      await refreshAgentRoute(ctx);
      const token = pasted || agent.webToken.trim();
      if (!token) {
        return { ok: false, status: agent.webStatus, account: maskWebAccount(agent.webAccount), error: "请先粘贴令牌", identityWarning: "" };
      }
      const validator =
        agent.provider === "deepseek"
          ? dsValidateToken
          : WEB_VALIDATORS[agent.provider];
      if (!validator) {
        return {
          ok: false,
          status: agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error: "该站点暂不支持网页令牌验证",
          identityWarning: "",
        };
      }
      const v =
        agent.provider === "qwen"
          ? await validateQwen(token, {
              cookie: qwenPaste?.cookie || agent.webCookie,
              ua: qwenPaste?.ua || agent.webUserAgent,
            })
          : await validator(token);
      if (v.ok) {
        const account = maskWebAccount(v.account);
        await db
          .update(schema.agents)
          .set({
            webStatus: "logged_in",
            webAccount: account,
            webError: "",
            webCheckedAt: new Date(),
            ...(v.accountId ? { webAccountId: v.accountId } : {}),
            // Gemini's validator hands the token back with any
            // rotated __Secure-1PSIDTS folded in: persist it, or
            // the stored login decays at the next rotation while
            // the browser session is still alive.
            ...(agent.provider === "gemini" &&
            v.accessToken &&
            v.accessToken !== token
              ? { webToken: v.accessToken }
              : {}),
          })
          .where(eq(schema.agents.id, args.agentId));
        // Account-identity guard (see recordWebIdentity): the
        // credential that is now stored is the one just verified
        // (for Gemini, the rotated token the validator handed
        // back is what gets stored, so it is what gets hashed).
        const storedCredential =
          agent.provider === "gemini" && v.accessToken
            ? v.accessToken
            : token;
        const recorded = await recordWebIdentity(
          db,
          agent,
          webIdentityString(v),
          storedCredential,
        );
        const collisions = await findWebIdentityCollisions(db, {
          id: agent.id,
          provider: agent.provider,
          webIdentityHash: recorded.identityHash,
          webCredentialHash: recorded.credentialHash,
        });
        const warnings: string[] = [];
        if (collisions.length) {
          warnings.push(
            webIdentityCollisionWarning(
              webSiteLabel(agent.provider),
              account,
              collisions,
            ),
          );
        }
        if (recorded.identityChanged) {
          warnings.push(
            "注意：这个智能体的账号已变更为当前验证的账号，它名下旧账号的官网对话续接" +
              "（以及豆包的已识别模型菜单）已清除，下一次发送会按新账号重新开始，不会把旧账号的对话用新账号续发。",
          );
        }
        ctx.invalidateQueries();
        return {
          ok: true,
          status: "logged_in",
          account,
          error: "",
          identityWarning: warnings.join("\n"),
        };
      }
      if (v.kind === "error") {
        // A transport-level failure proves nothing about the token:
        // keep a previously verified login state, record the reason.
        await db
          .update(schema.agents)
          .set({
            webError: v.error,
            ...(agent.webStatus === "" ? { webStatus: "error" } : {}),
          })
          .where(eq(schema.agents.id, args.agentId));
        ctx.invalidateQueries();
        return {
          ok: false,
          status: agent.webStatus === "" ? "error" : agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error: v.error,
          identityWarning: "",
        };
      }
      await db
        .update(schema.agents)
        .set({ webStatus: v.kind, webError: v.error, webAccount: "", webCheckedAt: new Date() })
        .where(eq(schema.agents.id, args.agentId));
      ctx.invalidateQueries();
      return { ok: false, status: v.kind, account: "", error: v.error, identityWarning: "" };
    },
  }),

  refreshWebIdentities: defineAction({
    description:
      "Re-validates EVERY web-token agent's stored credential against its own site (the same validators verifyWebToken uses, with each agent's own stored alignment data — 千问's saved Cookie/UA bundle included, and Gemini's rotated token persisted exactly as verifyWebToken persists it), records each credential's account identity on the agent row (see recordWebIdentity: a provider-scoped hash of the identity the site itself reports for that credential, plus a hash of the credential), clears account-bound state for any agent whose account identity changed since it was last recorded (its stored官网 conversation continuations, and a Doubao agent's detected menu), and reports per agent: the resulting login status, the masked account label, whether an identity is now recorded, whether it changed, and the names of same-site agents it now collides with (the site resolves both credentials to the SAME account, so chats with either land in that one account's history) with the shared warning text. No credential is changed (beyond Gemini's own rotation persistence) and no chat message is sent. Exists so agents configured before the identity guard shipped get their identities recorded — and any existing same-account collision surfaced — without waiting for a manual re-verification.",
    request: z.object({}),
    response: z.object({
      results: z.array(
        z.object({
          agentId: z.number(),
          name: z.string(),
          provider: z.string(),
          status: z.string(),
          account: z.string(),
          accountId: z.string(),
          identityRecorded: z.boolean(),
          identityChanged: z.boolean(),
          collisionWith: z.array(z.string()),
          warning: z.string(),
        }),
      ),
    }),
    handler: async (
      ctx,
    ): Promise<{
      results: {
        agentId: number;
        name: string;
        provider: string;
        status: string;
        account: string;
        accountId: string;
        identityRecorded: boolean;
        identityChanged: boolean;
        collisionWith: string[];
        warning: string;
      }[];
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.connectionType, "web"));
      await refreshAgentRoute(ctx);
      type RefreshResult = {
        agentId: number;
        name: string;
        provider: string;
        status: string;
        account: string;
        accountId: string;
        identityRecorded: boolean;
        identityChanged: boolean;
        collisionWith: string[];
        warning: string;
      };
      const results: RefreshResult[] = [];
      // The identity facts in force after this pass, per agent —
      // collisions are computed over THESE (not the pre-pass
      // rows), so two agents verified in the same pass already
      // see each other.
      const effective = new Map<
        number,
        { identityHash: string; credentialHash: string }
      >();
      for (const agent of rows) {
        const base: RefreshResult = {
          agentId: agent.id,
          name: agent.name,
          provider: agent.provider,
          status: agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          accountId: agent.webAccountId,
          identityRecorded: agent.webIdentityHash !== "",
          identityChanged: false,
          collisionWith: [],
          warning: "",
        };
        effective.set(agent.id, {
          identityHash: agent.webIdentityHash,
          credentialHash: agent.webCredentialHash,
        });
        const token = agent.webToken.trim();
        const validator =
          agent.provider === "deepseek"
            ? dsValidateToken
            : WEB_VALIDATORS[agent.provider];
        if (!token || !validator) {
          results.push(base);
          continue;
        }
        const v =
          agent.provider === "qwen"
            ? await validateQwen(token, {
                cookie: agent.webCookie,
                ua: agent.webUserAgent,
              })
            : await validator(token);
        if (v.ok) {
          const account = maskWebAccount(v.account);
          const storedCredential =
            agent.provider === "gemini" && v.accessToken
              ? v.accessToken
              : token;
          await db
            .update(schema.agents)
            .set({
              webStatus: "logged_in",
              webAccount: account,
              webError: "",
              webCheckedAt: new Date(),
              ...(v.accountId ? { webAccountId: v.accountId } : {}),
              ...(agent.provider === "gemini" &&
              v.accessToken &&
              v.accessToken !== token
                ? { webToken: v.accessToken }
                : {}),
            })
            .where(eq(schema.agents.id, agent.id));
          const recorded = await recordWebIdentity(
            db,
            agent,
            webIdentityString(v),
            storedCredential,
          );
          effective.set(agent.id, {
            identityHash: recorded.identityHash,
            credentialHash: recorded.credentialHash,
          });
          results.push({
            ...base,
            status: "logged_in",
            account,
            accountId: v.accountId || base.accountId,
            identityRecorded:
              recorded.identityHash !== "" || recorded.credentialHash !== "",
            identityChanged: recorded.identityChanged,
          });
        } else if (v.kind === "error") {
          // Same rule as verifyWebToken: a transport failure
          // proves nothing about the token — keep the verified
          // state, record the reason.
          await db
            .update(schema.agents)
            .set({
              webError: v.error,
              ...(agent.webStatus === "" ? { webStatus: "error" } : {}),
            })
            .where(eq(schema.agents.id, agent.id));
          results.push({
            ...base,
            status: agent.webStatus === "" ? "error" : agent.webStatus,
          });
        } else {
          await db
            .update(schema.agents)
            .set({ webStatus: v.kind, webError: v.error, webAccount: "", webCheckedAt: new Date() })
            .where(eq(schema.agents.id, agent.id));
          results.push({ ...base, status: v.kind, account: "" });
        }
      }
      for (const r of results) {
        const selfEff = effective.get(r.agentId);
        if (!selfEff) continue;
        const others = results.filter((o) => {
          if (o.agentId === r.agentId || o.provider !== r.provider)
            return false;
          const oEff = effective.get(o.agentId);
          if (!oEff) return false;
          return (
            (selfEff.identityHash !== "" &&
              oEff.identityHash === selfEff.identityHash) ||
            (selfEff.credentialHash !== "" &&
              oEff.credentialHash === selfEff.credentialHash)
          );
        });
        r.collisionWith = others.map((o) => o.name);
        if (others.length) {
          r.warning = webIdentityCollisionWarning(
            webSiteLabel(r.provider),
            r.account,
            others,
          );
        }
      }
      ctx.invalidateQueries();
      return { results };
    },
  }),

  saveWebDeviceId: defineAction({
    description:
      "Stores the browser device id (Doubao's device_id) on ONE web-token agent, chosen by agentId — the value the user copied from their own browser's request URL for that agent's account, where it appears as device_id=… in the URL. That agent's chat calls then carry it as the device_id parameter. Device ids are per-account: this action updates only the named agent and never any other agent of the same site (an earlier provider-wide version wrote one browser's device_id onto every Doubao agent, mixing two accounts' data). The value is normalised (a pasted full URL is accepted and the number extracted; anything that is not 10–25 digits is rejected with ok:false). Returns how many agents were updated (0 or 1) and the stored value.",
    request: z.object({
      agentId: z.number().int().positive(),
      deviceId: z.string().max(2000),
    }),
    response: z.object({
      ok: z.boolean(),
      updated: z.number(),
      deviceId: z.string(),
      error: z.string(),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: boolean;
      updated: number;
      deviceId: string;
      error: string;
    }> => {
      const cleaned = cleanWebDeviceId(args.deviceId);
      if (!cleaned) {
        return {
          ok: false,
          updated: 0,
          deviceId: "",
          error: "没有识别出有效的 device_id（应为 10–25 位数字）",
        };
      }
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({
          id: schema.agents.id,
          connectionType: schema.agents.connectionType,
        })
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) {
        return {
          ok: false,
          updated: 0,
          deviceId: "",
          error: "智能体不存在",
        };
      }
      if (agent.connectionType !== "web") {
        return {
          ok: false,
          updated: 0,
          deviceId: "",
          error: "该智能体不是网页令牌登录方式，没有设备号可存",
        };
      }
      // Only this one agent's row is written — a second agent of
      // the same site keeps its own device id untouched.
      await db
        .update(schema.agents)
        .set({ webDeviceId: cleaned })
        .where(eq(schema.agents.id, agent.id));
      ctx.invalidateQueries();
      return { ok: true, updated: 1, deviceId: cleaned, error: "" };
    },
  }),

  ensureCatalogAgents: defineAction({
    description:
      "Creates the web-token agents the user asked to have in the list — one per mainstream AI web product (DeepSeek·网页, GPT, Claude, Gemini, Grok, 千问, 豆包, 元宝, Kimi, 智谱, Mistral, 文心一言) — each connectionType 'web' with its site as provider, its own glyph and colour, and its first provisional room, exactly like createAgent. No token is stored for any of them: each stays silent and shows 尚未登录 until the user pastes that site's web login token in its settings and it verifies. Idempotent: a site already present (an agent with the same provider as a web agent, or with the same name) is skipped and nothing is duplicated. The pre-existing API-mode DeepSeek agent is untouched.",
    request: z.object({}),
    response: z.object({ created: z.array(z.string()) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const all = await db
        .select({
          id: schema.agents.id,
          name: schema.agents.name,
          provider: schema.agents.provider,
          connectionType: schema.agents.connectionType,
        })
        .from(schema.agents)
        .orderBy(asc(schema.agents.id));
      const sites: { name: string; provider: string; glyph: string; color: string; model: string; webMode?: string }[] = [
        { name: "DeepSeek·网页", provider: "deepseek", glyph: "DS", color: "#4d6bfe", model: "deepseek-chat", webMode: "default" },
        { name: "GPT", provider: "chatgpt", glyph: "◎", color: "#10a37f", model: "" },
        { name: "Claude", provider: "claude", glyph: "✳", color: "#d97757", model: "" },
        { name: "Gemini", provider: "gemini", glyph: "✦", color: "#4796e3", model: "" },
        { name: "Grok", provider: "grok", glyph: "𝕏", color: "#4a4a52", model: "" },
        { name: "千问", provider: "qwen", glyph: "☁", color: "#6c3df0", model: "" },
        { name: "豆包", provider: "doubao", glyph: "豆", color: "#1664ff", model: "", webMode: "fast" },
        { name: "元宝", provider: "hunyuan", glyph: "元", color: "#0052d9", model: "" },
        { name: "Kimi", provider: "kimi", glyph: "☾", color: "#3b3f4a", model: "" },
        { name: "智谱", provider: "zhipu", glyph: "智", color: "#2f6fed", model: "" },
        { name: "Mistral", provider: "mistral", glyph: "M", color: "#ff7000", model: "" },
        { name: "文心一言", provider: "wenxin", glyph: "文", color: "#2932e1", model: "" },
      ];
      const created: string[] = [];
      for (const site of sites) {
        const exists = all.some(
          (a) =>
            a.name === site.name ||
            (a.provider === site.provider && a.connectionType === "web"),
        );
        if (exists) continue;
        const inserted = await db
          .insert(schema.agents)
          .values({
            name: site.name,
            role: "",
            color: site.color,
            glyph: site.glyph,
            enabled: 1,
            provider: site.provider,
            apiBase: "",
            apiKey: "",
            model: site.model,
            temperature: 0.7,
            maxTokens: 4096,
            thinking: "默认",
            systemPrompt: "",
            note: "",
            connectionType: "web",
            webMode: site.webMode ?? "",
          })
          .returning({ id: schema.agents.id });
        const agent = inserted[0];
        if (!agent) throw new Error("ensureCatalogAgents: insert failed");
        const convInserted = await db
          .insert(schema.conversations)
          .values({
            title: site.name,
            kind: "direct",
            agentId: agent.id,
            memberBased: 1,
            provisional: 1,
          })
          .returning({ id: schema.conversations.id });
        const conv = convInserted[0];
        if (!conv) throw new Error("ensureCatalogAgents: room insert failed");
        await db.insert(schema.groupMembers).values({
          conversationId: conv.id,
          agentId: agent.id,
        });
        all.push({
          id: agent.id,
          name: site.name,
          provider: site.provider,
          connectionType: "web",
        });
        created.push(site.name);
      }
      if (created.length > 0) ctx.invalidateQueries();
      return { created };
    },
  }),

  deleteAgent: defineAction({
    description:
      "Deletes one added agent permanently (the 删除智能体 button in the agent settings panel, behind a confirmation): the agent row, every conversation that belongs to it with all of their messages, the agent's own messages inside shared rooms that stay, its room memberships, and its skill assignments. Muse is not an agents-table row and can never be deleted through this action.",
    request: z.object({ agentId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.agentId, args.agentId));
      for (const conv of convs) {
        await db
          .delete(schema.messages)
          .where(eq(schema.messages.conversationId, conv.id));
        await db
          .delete(schema.groupMembers)
          .where(eq(schema.groupMembers.conversationId, conv.id));
      }
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.agentId, args.agentId));
      // The agent's own replies inside shared rooms: the rooms
      // themselves belong to the user and stay, but nothing the
      // deleted agent said may linger in them.
      await db
        .delete(schema.messages)
        .where(eq(schema.messages.agentId, args.agentId));
      await db
        .delete(schema.groupMembers)
        .where(eq(schema.groupMembers.agentId, args.agentId));
      await db
        .delete(schema.agentSkills)
        .where(eq(schema.agentSkills.agentId, args.agentId));
      await db
        .delete(schema.webRemoteConversations)
        .where(eq(schema.webRemoteConversations.agentId, args.agentId));
      await db
        .delete(schema.agentTriggers)
        .where(eq(schema.agentTriggers.agentId, args.agentId));
      await db
        .delete(schema.doubaoPendingMedia)
        .where(eq(schema.doubaoPendingMedia.agentId, args.agentId));
      await db
        .delete(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  testAgentConnection: defineAction({
    description:
      "Tests an agent form's API connection with a real GET {base}/models call (same implementation as the collaborative space): reachability, latency, whether the configured model is in the returned list, and the full list for the form's model dropdown. An empty form key falls back to the agent's saved key when agentId is given; the key is never returned.",
    request: z.object({
      agentId: z.number().int().positive().nullable().default(null),
      apiBase: z.string().max(300),
      apiKey: z.string().max(1000),
      model: z.string().max(120),
    }),
    response: z.object({
      ok: z.boolean(),
      detail: z.string(),
      latencyMs: z.number(),
      modelFound: z.boolean().nullable(),
      modelCount: z.number(),
      models: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let key = args.apiKey.trim();
      if (!key && args.agentId !== null) {
        const rows = await db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, args.agentId));
        key = rows[0] ? rows[0].apiKey.trim() : "";
      }
      const base = args.apiBase.trim().replace(/\/+$/, "");
      if (!base || !key) {
        return {
          ok: false,
          detail: !base
            ? "未填写 API 地址"
            : "没有可用的 API Key（表单为空且未保存过 Key）",
          latencyMs: 0,
          modelFound: null,
          modelCount: 0,
          models: [],
        };
      }
      if (!/^https:\/\//i.test(base)) {
        return {
          ok: false,
          detail: "API 地址必须以 https:// 开头",
          latencyMs: 0,
          modelFound: null,
          modelCount: 0,
          models: [],
        };
      }
      await refreshAgentRoute(ctx);
      const started = Date.now();
      const result = await fetchProviderModelsDetailed(base, key);
      const latencyMs = Date.now() - started;
      if ("error" in result) {
        return {
          ok: false,
          detail: `连接失败：${result.error}`,
          latencyMs,
          modelFound: null,
          modelCount: 0,
          models: [],
        };
      }
      const models = result.models;
      const model = args.model.trim();
      const modelFound = model ? models.includes(model) : null;
      return {
        ok: true,
        detail:
          modelFound === false
            ? `连接成功，接口返回 ${models.length} 个模型，但当前填写的模型「${model}」不在其中，发送时会失败`
            : `连接成功，接口返回 ${models.length} 个模型${modelFound ? "，当前模型在列表中" : ""}`,
        latencyMs,
        modelFound,
        modelCount: models.length,
        models,
      };
    },
  }),

  pioneerGetState: defineAction({
    description:
      "Returns the Pioneer VPN panel state for this space: login status and the account facts Pioneer itself returned, the stored region list, the current selection and node display facts, and the tunnel state with its tunnel-verified exit. The password, session token and raw node config never leave the server.",
    request: z.object({}),
    response: pioneerStateResponse,
    handler: async (ctx): Promise<z.infer<typeof pioneerStateResponse>> => {
      const s = await loadPioneerRow(ctx);
      return pioneerStateOut(s);
    },
  }),

pioneerDetectOnEntry: defineAction({
description: "The once-per-entry Pioneer proxy check: when the stored tunnel state claims the proxy is connected, that claim is verified against reality before it is shown again — the local tunnel daemon must actually be running for the stored node, and the real exit IP must answer through the tunnel. A claim that fails either check is corrected in storage to the real offline state (with the reason kept on the record and an entry in the VPN log), so the panel and the sidebar show offline instead of the previous session's online state; a claim that passes gets its verified exit and check time refreshed. When the stored state does not claim connected, nothing is probed and the stored state is returned as-is. The tunnel is never silently re-established here — reconnecting stays the user's own tap on a region.",
request: z.object({}),
response: z.object({
checked: z.boolean(),
online: z.boolean(),
state: pioneerStateResponse,
}),
privileged: [privileged.pioneerTunnelStatus, privileged.pioneerTunnelFetch],
handler: async (ctx): Promise<{ checked: boolean; online: boolean; state: z.infer<typeof pioneerStateResponse> }> => {
const s = await loadPioneerRow(ctx);
const stored = parsePioneerTunnel(s.tunnelJson);
if (!stored || stored.state !== "connected") {
return { checked: false, online: false, state: pioneerStateOut(s) };
}
const info = parsePioneerNodeInfo(s.nodeInfo);
const status = await ctx.executePrivileged(privileged.pioneerTunnelStatus, {});
const daemonOk = status.running && !!info && status.host === info.host && status.port === info.port;
const db = ctx.db<typeof schema>();
const markOffline = async (t: PioneerTunnelState) => {
await pioneerStoreTunnel(ctx, t);
await db
.update(schema.pioneerState)
.set({ exitJson: "", exitAt: null })
.where(eq(schema.pioneerState.id, 1));
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
const fresh = await loadPioneerRow(ctx);
return { checked: true, online: false, state: pioneerStateOut(fresh) };
};
if (!daemonOk) {
const t: PioneerTunnelState = { ...stored };
t.state = "error";
t.error = "进入空间时检测到隧道已不在运行，上次显示的在线状态已过期，当前为离线。重新点选地区即可连接。";
t.exitIp = "";
t.exitCountry = "";
t.exitRegion = "";
t.exitCity = "";
t.checkedAt = new Date().toISOString();
await pioneerLog(ctx, "connect", "进入空间时检测：上次记录为已连接，但隧道已不在运行，已按离线显示");
return await markOffline(t);
}
const exit = await pioneerFetchExitViaTunnel(ctx);
const t: PioneerTunnelState = { ...stored };
t.checkedAt = new Date().toISOString();
if (exit.ok) {
t.state = "connected";
t.exitIp = exit.ip;
t.exitCountry = exit.country;
t.exitRegion = exit.region;
t.exitCity = exit.city;
t.error = "";
await pioneerStoreTunnel(ctx, t);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
const fresh = await loadPioneerRow(ctx);
return { checked: true, online: true, state: pioneerStateOut(fresh) };
}
t.state = "error";
t.error = `进入空间时检测：隧道进程在运行，但经隧道验证出口失败（${exit.error}），当前按离线显示。重新点选地区即可连接。`;
t.exitIp = "";
t.exitCountry = "";
t.exitRegion = "";
t.exitCity = "";
await pioneerLog(ctx, "connect", `进入空间时检测：隧道出口验证失败，已按离线显示（${exit.error}）`);
return await markOffline(t);
},
}),

pioneerLogin: defineAction({
description: "Logs in to the user's Pioneer VPN account with a real call to Pioneer's own API, using the official client's protocol. The username/password are saved server-side only (the password is never returned), the session token stays server-side, and on success the server/region list Pioneer returns is fetched and stored immediately. Failures return Pioneer's real error and mark nothing logged in.",
request: z.object({
username: z.string().max(200).default(""),
password: z.string().max(500).default(""),
customHost: z.string().max(300).default(""),
}),
response: z.object({
ok: z.boolean(),
account: z.string(),
userType: z.string(),
dueTime: z.string(),
serverCount: z.number(),
detail: z.string(),
error: z.string(),
}),
privileged: [privileged.pioneerEncrypt, privileged.pioneerDecrypt, privileged.randomUuid],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const s = await loadPioneerRow(ctx);
const username = args.username.trim() !== "" ? args.username.trim() : (s?.username ?? "");
const password = args.password !== "" ? args.password : (s?.password ?? "");
const customHost = args.customHost.trim().replace(/\/+$/, "");
const fail = (error: string) => ({ ok: false, account: "", userType: "", dueTime: "", serverCount: 0, detail: "", error });
if (!username) return fail("请先填写 Pioneer 帐号（邮箱）");
if (!password) return fail("请先填写 Pioneer 帐号密码");
if (customHost && !/^https:\/\//i.test(customHost)) return fail("自定义服务地址必须以 https:// 开头");
await db
.update(schema.pioneerState)
.set({ username: username, password: password, customHost: customHost })
.where(eq(schema.pioneerState.id, 1));
const login = await pioneerDoLogin(ctx, username, password);
if (!login.ok) {
ctx.invalidateQueries();
return fail(login.error);
}
const servers = await pioneerFetchAndStoreServers(ctx);
ctx.invalidateQueries();
return {
ok: true,
account: login.account,
userType: login.userType,
dueTime: login.dueTime,
serverCount: servers.ok ? servers.count : 0,
detail: servers.ok
? `已登录 Pioneer 帐号 ${login.account}，并识别到 ${servers.count} 个地区服务器`
: `已登录 Pioneer 帐号 ${login.account}，但服务器列表识别失败：${servers.error}`,
error: "",
};
},
}),

pioneerFetchServers: defineAction({
description: "Re-fetches the Pioneer server/region list with the stored session token (silently logging in again with the saved credentials when the token has expired) and stores the real list Pioneer returns.",
request: z.object({}),
response: z.object({ ok: z.boolean(), count: z.number(), error: z.string() }),
privileged: [privileged.pioneerEncrypt, privileged.pioneerDecrypt, privileged.randomUuid],
handler: async (ctx): Promise<{ ok: boolean; count: number; error: string }> => {
const r = await pioneerFetchAndStoreServers(ctx);
ctx.invalidateQueries();
return r.ok ? { ok: true, count: r.count, error: "" } : { ok: false, count: 0, error: r.error };
},
}),

pioneerSelectServer: defineAction({
description: "Selects one Pioneer region server: stores the selection server-side, then makes the real /api/connect call the official Pioneer client makes for that region and stores the returned node — the raw node config stays server-side; the response carries only the node's display facts (name, host, resolved IPs, port, protocol). When the node is a Trojan node it then really establishes the tunnel (local proxy daemon speaking trojan over TLS to the node) and verifies the real exit IP through it; the tunnel outcome (connected with the verified exit, or the real failure / unsupported-protocol reason) is returned and stored. When Pioneer refuses (e.g. the account's membership does not cover connecting), its real error is returned and stored, any previous tunnel is stopped, and nothing is fabricated.",
request: z.object({ countryId: z.number().int().positive() }),
response: pioneerSelectResponse,
privileged: [privileged.pioneerEncrypt, privileged.pioneerDecrypt, privileged.randomUuid, privileged.pioneerTunnelStart, privileged.pioneerTunnelStop, privileged.pioneerTunnelFetch],
handler: async (ctx, args): Promise<z.infer<typeof pioneerSelectResponse>> => {
const r = await pioneerSelectAndStoreNode(ctx, args.countryId);
if (!r.ok) {
await pioneerStopTunnelAndClear(ctx);
await pioneerLog(ctx, "connect", `连接失败：${r.error}`);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: false, error: r.error, node: null, tunnel: null };
}
const tunnel = await pioneerEstablishTunnel(ctx);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: true, error: "", node: r.node, tunnel };
},
}),

pioneerDisconnectServer: defineAction({
description: "Disconnects the currently selected Pioneer server without logging out: stops the local tunnel daemon, clears the stored tunnel/exit records, and clears the stored server selection and node info server-side. The Pioneer session (token, account facts, server list, saved credentials) is kept, so another region can be connected with one tap. This is the disconnect counterpart of pioneerSelectServer — the panel toggles between the two when the selected region is tapped again.",
request: z.object({}),
response: okResponse,
privileged: [privileged.pioneerTunnelStop],
handler: async (ctx): Promise<z.infer<typeof okResponse>> => {
const before = await loadPioneerRow(ctx);
await pioneerStopTunnelAndClear(ctx);
const db = ctx.db<typeof schema>();
await db
.update(schema.pioneerState)
.set({
selectedId: 0,
selectedName: "",
nodeJson: "",
nodeInfo: "",
nodeError: "",
nodeAt: null,
})
.where(eq(schema.pioneerState.id, 1));
await pioneerLog(ctx, "disconnect", `已断开服务器${before.selectedName ? ` ${before.selectedName}` : ""}，隧道已停止`);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: true as const };
},
}),

pioneerSwitchNode: defineAction({
description: "Switches to another node within the currently selected Pioneer region. Whether Pioneer supports requesting a specific node was verified live on 2026-11-17 with the user's entitled account: /api/connect returns the assigned node (name like tw01/tw02/tw03 plus a numeric nodeid) but ignores every requested-node field tried (nodeid as number and as string, node_id, nodeId, id, node name, with and without group), rotating the assignment on every call, and /api/server carries no node list at all — so a specific node cannot be requested. What does work is reconnecting: each fresh /api/connect call is assigned a (usually different) node. This action stops the current tunnel, makes a fresh /api/connect call for the stored selected region, stores the newly assigned node server-side (raw config never returned), re-establishes the Trojan tunnel for it and verifies the real exit IP, returning exactly what Pioneer assigned — it never claims the user picked the node.",
request: z.object({}),
response: pioneerSelectResponse,
privileged: [privileged.pioneerEncrypt, privileged.pioneerDecrypt, privileged.randomUuid, privileged.pioneerTunnelStart, privileged.pioneerTunnelStop, privileged.pioneerTunnelFetch],
handler: async (ctx): Promise<z.infer<typeof pioneerSelectResponse>> => {
const s = await loadPioneerRow(ctx);
const countryId = s?.selectedId ?? 0;
if (!countryId) {
return { ok: false, error: "尚未连接任何服务器，请先在列表中点击一个地区连接", node: null, tunnel: null };
}
await pioneerStopTunnelAndClear(ctx);
const r = await pioneerSelectAndStoreNode(ctx, countryId);
if (!r.ok) {
await pioneerLog(ctx, "connect", `换节点失败：${r.error}`);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: false, error: r.error, node: null, tunnel: null };
}
const tunnel = await pioneerEstablishTunnel(ctx);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: true, error: "", node: r.node, tunnel };
},
}),

pioneerRefreshTunnelExit: defineAction({
description: "Re-checks the Pioneer Trojan tunnel live: if the local proxy daemon is not running it is re-established for the stored node, then the real exit IP is fetched through the tunnel (ipinfo.io, ipwho.is fallback) and stored. Returns the tunnel state exactly as measured — a failed check stores and returns the real failure, never a stale or invented exit.",
request: z.object({}),
response: z.object({ ok: z.boolean(), tunnel: pioneerTunnelSchema.nullable() }),
privileged: [privileged.pioneerTunnelStart, privileged.pioneerTunnelStop, privileged.pioneerTunnelStatus, privileged.pioneerTunnelFetch],
handler: async (ctx): Promise<{ ok: boolean; tunnel: PioneerTunnelState | null }> => {
const s = await loadPioneerRow(ctx);
const stored = parsePioneerTunnel(s?.tunnelJson);
if (!s || !s.nodeJson || !parsePioneerNodeInfo(s.nodeInfo)) {
return { ok: false, tunnel: stored };
}
const status = await ctx.executePrivileged(privileged.pioneerTunnelStatus, {});
const infoForMatch = parsePioneerNodeInfo(s.nodeInfo);
if (!status.running || !infoForMatch || status.host !== infoForMatch.host || status.port !== infoForMatch.port) {
const t = await pioneerEstablishTunnel(ctx);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: t.state === "connected", tunnel: t };
}
const exit = await pioneerFetchExitViaTunnel(ctx);
const t = stored ?? emptyPioneerTunnel();
const info = parsePioneerNodeInfo(s.nodeInfo);
if (!t.protocol) t.protocol = info?.protocol ?? "";
if (!t.nodeHost) t.nodeHost = info?.host ?? "";
if (!t.nodePort) t.nodePort = info?.port ?? 0;
t.checkedAt = new Date().toISOString();
if (exit.ok) {
t.state = "connected";
t.exitIp = exit.ip;
t.exitCountry = exit.country;
t.exitRegion = exit.region;
t.exitCity = exit.city;
t.error = "";
} else {
t.state = "error";
t.error = `隧道进程正在运行，但经隧道验证出口失败：${exit.error}${status.lastError ? `；隧道最近错误：${status.lastError}` : ""}`;
}
await pioneerStoreTunnel(ctx, t);
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: t.state === "connected", tunnel: t };
},
}),

pioneerTestIpPurity: defineAction({
description: "Tests the purity of the current exit IP, connected or not: when the Pioneer tunnel is verified connected the lookup is made THROUGH the tunnel for the tunnel exit IP; when nothing is connected the lookup is made directly (no tunnel) for this space's own direct egress IP, and the result states which exit was tested (exitKind / exitLabel). Only really measurable items are returned: exit IP and its /24 (or /48) segment, geolocation, timezone + UTC offset, ISP / org / ASN, IP type and native-IP judgement from the proxy / hosting / mobile flags ip-api.com actually publishes (ipwho.is as a partial fallback), a risk score and grade computed by one transparent formula from those flags (proxy +70, hosting +35, mobile +10, base 5; missing deciding flags → score null, shown as 未评估， never invented), and an IPv6 probe through the same channel against the AAAA-only endpoints api6.ipify.org / v6.ident.me (a real answer proves IPv6 support and yields the exit IPv6 address; no answer = 不支持）. Items no real source can measure (Tor / crawler / abuse / attack records, per-app scores) are not returned at all. When every lookup fails it returns ok:false with the real reason.",
request: z.object({}),
response: z.object({
ok: z.boolean(),
error: z.string(),
result: z
.object({
ip: z.string(),
exitKind: z.enum(["tunnel", "direct"]),
exitLabel: z.string(),
country: z.string(),
countryCode: z.string(),
region: z.string(),
city: z.string(),
isp: z.string(),
org: z.string(),
asn: z.string(),
asname: z.string(),
timezone: z.string(),
lat: z.number().nullable(),
lon: z.number().nullable(),
ipType: z.string(),
proxy: z.boolean().nullable(),
hosting: z.boolean().nullable(),
mobile: z.boolean().nullable(),
verdict: z.string(),
riskScore: z.number().nullable(),
riskGrade: z.string(),
riskLabel: z.string(),
nativeIp: z.boolean().nullable(),
ipSegment: z.string(),
tzOffsetSec: z.number().nullable(),
ipv6Supported: z.boolean(),
ipv6Address: z.string(),
basis: z.array(z.string()),
source: z.string(),
checkedAt: z.string(),
})
.nullable(),
}),
privileged: [privileged.pioneerTunnelFetch],
handler: async (ctx) => {
const s = await loadPioneerRow(ctx);
const stored = parsePioneerTunnel(s?.tunnelJson);
// The test works in both states: with a verified tunnel it tests the
// tunnel exit IP through the tunnel; with nothing connected it tests
// this space's direct egress IP with plain (non-tunnel) requests —
// ip-api.com / ipwho.is describe the requesting egress when no
// address is given, so the direct exit IP comes from the response
// itself, never from a guess.
const tunnelConnected =
!!stored && stored.state === "connected" && !!stored.exitIp;
const exitKind: "tunnel" | "direct" = tunnelConnected ? "tunnel" : "direct";
const exitLabel = tunnelConnected
? `隧道出口${s?.selectedName ? ` · ${s.selectedName.replace(/^中国/, "")}` : ""}`
: "直连出口（未连接 VPN）";
let ip = tunnelConnected ? (stored?.exitIp ?? "") : "";
const checkedAt = new Date().toISOString();
const fetchText = async (
url: string,
timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string; error: string }> => {
if (tunnelConnected) {
return await ctx.executePrivileged(privileged.pioneerTunnelFetch, {
url,
timeoutMs,
});
}
try {
const res = await fetch(url, {
signal: AbortSignal.timeout(timeoutMs),
});
const body = await res.text();
return {
ok: res.ok,
status: res.status,
body: body.slice(0, 200000),
error: res.ok ? "" : `目标站点返回 HTTP ${res.status}`,
};
} catch (e) {
return {
ok: false,
status: 0,
body: "",
error: `直连访问失败：${e instanceof Error ? e.message : "未知错误"}`,
};
}
};
const boolOrNull = (v: unknown): boolean | null =>
typeof v === "boolean" ? v : null;
const numOrNull = (v: unknown): number | null =>
typeof v === "number" && Number.isFinite(v) ? v : null;

// One transparent scoring formula over the real flags only:
// base 5, proxy +70, hosting +35, mobile +10, capped at 100. It is
// only computed when both deciding flags (proxy, hosting) are real.
function scoreFromFlags(
proxy: boolean | null,
hosting: boolean | null,
mobile: boolean | null,
): { score: number | null; grade: string; label: string } {
if (proxy === null || hosting === null)
return { score: null, grade: "", label: "未评估" };
let score = 5;
if (proxy) score += 70;
if (hosting) score += 35;
if (mobile) score += 10;
score = Math.min(100, score);
if (score <= 8) return { score, grade: "A+", label: "极低风险" };
if (score <= 26) return { score, grade: "A", label: "低风险" };
if (score <= 45) return { score, grade: "B", label: "较低风险" };
if (score <= 65) return { score, grade: "C", label: "中等风险" };
if (score <= 85) return { score, grade: "D", label: "较高风险" };
return { score, grade: "F", label: "高风险" };
}
/** The address block an exit IP belongs to: a.b.c.0/24 for IPv4,
 * the /48 prefix for IPv6 — plain arithmetic on the real address. */
function ipSegmentOf(addr: string): string {
if (addr.includes(".")) {
const parts = addr.split(".");
if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
return "";
}
if (addr.includes(":")) {
const head = addr.split("::")[0] ?? "";
const groups = head.split(":").filter((g) => g !== "");
while (groups.length < 3) groups.push("0");
return `${groups.slice(0, 3).join(":")}::/48`;
}
return "";
}

// IPv6 probe: api6.ipify.org and v6.ident.me publish AAAA-only
// endpoints, so a successful answer through the same channel
// (tunnel when connected, direct otherwise) proves this exit has
// IPv6 and returns its real IPv6 address; both failing means the
// exit shows no IPv6 (reported as 不支持， never guessed).
const probeIpv6 = async (): Promise<{
supported: boolean;
address: string;
via: string;
}> => {
const attempts: Array<{ url: string; via: string; parse: (body: string) => string }> = [
{
url: "https://api6.ipify.org?format=json",
via: "api6.ipify.org",
parse: (body) => {
try {
const r = asRecord(JSON.parse(body));
const v = r ? strField(r.ip) : "";
return v.includes(":") ? v : "";
} catch {
return "";
}
},
},
{
url: "https://v6.ident.me",
via: "v6.ident.me",
parse: (body) => {
const t = body.trim();
return t.includes(":") && /^[0-9a-fA-F:]+$/.test(t) ? t : "";
},
},
];
for (const a of attempts) {
const r = await fetchText(a.url, 8000);
if (r.ok) {
const addr = a.parse(r.body);
if (addr) return { supported: true, address: addr, via: a.via };
}
}
return { supported: false, address: "", via: "" };
};
const ipv6 = await probeIpv6();

// Primary: ip-api.com — the free source that actually reports
// proxy / hosting / mobile flags for an address. Tunnel mode asks
// about the known tunnel exit IP; direct mode asks about the
// requesting egress itself (no address in the path) and reads the
// exit IP back from the response's query field.
const IP_API_FIELDS =
"status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,asname,reverse,mobile,proxy,hosting,query";
const primary = await fetchText(
tunnelConnected
? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`
: `http://ip-api.com/json/?fields=${IP_API_FIELDS}`,
15000,
);
if (primary.ok) {
try {
const rec = asRecord(JSON.parse(primary.body));
if (rec && rec.status === "success") {
ip = strField(rec.query) || ip;
const proxy = boolOrNull(rec.proxy);
const hosting = boolOrNull(rec.hosting);
const mobile = boolOrNull(rec.mobile);
const ipType =
mobile === true
? "移动网络"
: hosting === true
? "数据中心"
: proxy === false && hosting === false
? "住宅宽带"
: "未知";
let verdict = "无法判定";
if (proxy === true) verdict = "较差";
else if (hosting === true) verdict = "一般";
else if (mobile === true) verdict = "一般";
else if (proxy === false && hosting === false) verdict = "干净";
const scored = scoreFromFlags(proxy, hosting, mobile);
const nativeIp =
hosting === true
? false
: hosting === false && proxy === false
? true
: null;
// The basis is stated exactly once, here: the three real flags
// the score and verdict are computed from. Everything else the
// flags imply (IP type, native-IP, the score itself, the verdict)
// is shown once as its own result row and is not repeated here;
// the scoring formula lives only in the section's 说明， and the
// data sources only in the section's footer line.
const basis: string[] = [
`代理标记（proxy）：${proxy === true ? "是，被识别为代理" : proxy === false ? "否" : "来源未提供"}`,
`托管机房标记（hosting）：${hosting === true ? "是，托管/机房 IP" : hosting === false ? "否" : "来源未提供"}`,
`移动网络标记（mobile）：${mobile === true ? "是" : mobile === false ? "否" : "来源未提供"}`,
];
await pioneerLog(ctx, "test", `IP 纯净度测试（${exitLabel}）：${ip}，结论 ${verdict}${scored.score !== null ? `，风险分 ${scored.score}` : ""}`);
return {
ok: true,
error: "",
result: {
ip,
exitKind,
exitLabel,
country: strField(rec.country),
countryCode: strField(rec.countryCode),
region: strField(rec.regionName) || strField(rec.region),
city: strField(rec.city),
isp: strField(rec.isp),
org: strField(rec.org),
asn: strField(rec.as),
asname: strField(rec.asname),
timezone: strField(rec.timezone),
lat: numOrNull(rec.lat),
lon: numOrNull(rec.lon),
ipType,
proxy,
hosting,
mobile,
verdict,
riskScore: scored.score,
riskGrade: scored.grade,
riskLabel: scored.label,
nativeIp,
ipSegment: ipSegmentOf(ip),
tzOffsetSec: numOrNull(rec.offset),
ipv6Supported: ipv6.supported,
ipv6Address: ipv6.address,
basis,
source: tunnelConnected
? "ip-api.com（经隧道查询隧道出口 IP）"
: "ip-api.com（直连查询当前直连出口 IP）",
checkedAt,
},
};
}
} catch {
// fall through to the fallback source
}
}

// Fallback: ipwho.is — real location / ISP / ASN, but it does not
// publish proxy or hosting flags, so the verdict stays 无法判定
// rather than guessing from missing fields.
const fallback = await fetchText(
tunnelConnected ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/",
12000,
);
if (fallback.ok) {
try {
const rec = asRecord(JSON.parse(fallback.body));
if (rec && rec.success !== false && strField(rec.ip)) {
ip = strField(rec.ip) || ip;
const conn = asRecord(rec.connection);
const tzRec = asRecord(rec.timezone);
await pioneerLog(ctx, "test", `IP 纯净度测试（${exitLabel}）：${ip}，备用来源未提供风险标记，结论无法判定`);
return {
ok: true,
error: "",
result: {
ip,
exitKind,
exitLabel,
country: strField(rec.country),
countryCode: strField(rec.country_code),
region: strField(rec.region),
city: strField(rec.city),
isp: conn ? strField(conn.isp) : "",
org: conn ? strField(conn.org) : "",
asn: conn && conn.asn != null ? `AS${String(conn.asn)}` : "",
asname: "",
timezone: tzRec ? strField(tzRec.id) : "",
lat: numOrNull(rec.latitude),
lon: numOrNull(rec.longitude),
ipType: "未知",
proxy: null,
hosting: null,
mobile: null,
verdict: "无法判定",
riskScore: null,
riskGrade: "",
riskLabel: "未评估",
nativeIp: null,
ipSegment: ipSegmentOf(ip),
tzOffsetSec: tzRec ? numOrNull(tzRec.offset) : null,
ipv6Supported: ipv6.supported,
ipv6Address: ipv6.address,
basis: [
"主来源 ip-api.com 本次未返回结果，备用来源 ipwho.is 不提供代理/托管标记字段，风险评分与纯净度结论未评估",
],
source: tunnelConnected
? "ipwho.is（经隧道查询隧道出口 IP，备用来源）"
: "ipwho.is（直连查询当前直连出口 IP，备用来源）",
checkedAt,
},
};
}
} catch {
// fall through to the honest failure below
}
}
await pioneerLog(ctx, "test", `IP 纯净度测试失败（${exitLabel}）：${primary.ok ? "主来源返回无法解析" : primary.error || "主来源访问失败"}`);
return {
ok: false,
error: `无法检测：查询${exitLabel}${ip ? ` ${ip}` : ""} 的归属信息失败（${primary.ok ? "主来源返回无法解析" : primary.error || "主来源访问失败"}），请稍后重试`,
result: null,
};
},
}),

pioneerLogout: defineAction({
description: "Logs out of Pioneer: makes a best-effort real /api/logout call with the stored token, then clears the session token, the account facts and the fetched server list server-side. With forget=true the saved username/password are cleared too; otherwise they stay (server-side only) for a one-tap re-login.",
request: z.object({ forget: z.boolean().default(false) }),
response: okResponse,
privileged: [privileged.pioneerEncrypt, privileged.pioneerDecrypt, privileged.randomUuid, privileged.pioneerTunnelStop],
handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
const db = ctx.db<typeof schema>();
const s = await loadPioneerRow(ctx);
try {
await ctx.executePrivileged(privileged.pioneerTunnelStop, {});
} catch {
// best effort: the tunnel daemon may already be gone
}
if (s && s.token.trim()) {
const deviceId = await ensurePioneerDeviceId(ctx);
await pioneerCall(ctx, {
path: "/api/logout",
method: "POST",
deviceId,
token: s.token.trim(),
customHost: s.customHost,
payload: { deviceId },
timeoutMs: 10000,
});
}
await db
.update(schema.pioneerState)
.set({
token: "",
account: "",
userType: "",
dueTime: "",
status: "",
error: "",
servers: "[]",
serversAt: null,
selectedId: 0,
selectedName: "",
nodeJson: "",
nodeInfo: "",
nodeError: "",
nodeAt: null,
tunnelJson: "",
tunnelAt: null,
exitJson: "",
exitAt: null,
...(args.forget ? { username: "", password: "" } : {}),
})
.where(eq(schema.pioneerState.id, 1));
await pioneerLog(ctx, "logout", args.forget ? "已退出登录，并清除已保存的帐号密码" : "已退出登录");
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: true as const };
},
}),

pioneerSetGlobalMode: defineAction({
description: "Turns Pioneer global mode on or off and stores the switch server-side. While on and the tunnel is verified connected, every agent request (provider API calls and web-token adapters alike) is sent through the tunnel's local proxy and exits at the selected VPN node; while on but disconnected, requests stay direct and that state is written to the VPN log and shown in the panel — it is never silently different from what the panel says. Turning it off restores direct requests immediately.",
request: z.object({ enabled: z.boolean() }),
response: z.object({ ok: z.literal(true), globalMode: z.boolean() }),
handler: async (ctx, args): Promise<{ ok: true; globalMode: boolean }> => {
const db = ctx.db<typeof schema>();
await loadPioneerRow(ctx);
await db
.update(schema.pioneerState)
.set({ globalMode: args.enabled ? 1 : 0 })
.where(eq(schema.pioneerState.id, 1));
await pioneerLog(ctx, "global", args.enabled ? "全局模式已开启" : "全局模式已关闭");
await refreshAgentRoute(ctx);
ctx.invalidateQueries();
return { ok: true as const, globalMode: args.enabled };
},
}),

pioneerGetLogs: defineAction({
description: "Returns the Pioneer VPN log for display: only the newest 10 recorded events (login, logout, server-list refreshes, connect/disconnect, tunnel outcomes, global-mode changes, purity tests), newest first, each with its real outcome. No credentials, tokens or node configs are ever part of a log row.",
request: z.object({}),
response: z.object({
logs: z.array(
z.object({
id: z.number(),
kind: z.string(),
message: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.pioneerLogs)
.orderBy(desc(schema.pioneerLogs.id))
.limit(PIONEER_LOG_DISPLAY);
return {
logs: rows.map((r) => ({
id: r.id,
kind: r.kind,
message: r.message,
createdAt: safeIso(r.createdAt),
})),
};
},
}),

pioneerClearLogs: defineAction({
description: "Clears the Pioneer VPN log (all recorded events). The VPN state itself — login, selection, tunnel, global mode — is untouched.",
request: z.object({}),
response: okResponse,
handler: async (ctx): Promise<z.infer<typeof okResponse>> => {
const db = ctx.db<typeof schema>();
await db.delete(schema.pioneerLogs);
ctx.invalidateQueries();
return { ok: true as const };
},
}),

parseImportBundle: defineAction({
    description:
      "Parses one 账号导入 paste WITHOUT storing anything: an extension export JSON (all cookies incl. HttpOnly, local/session storage, UA, site extras), a 千问 console-export JSON, a bare Cookie string or a bare token. Returns only non-secret facts for the import page's preview — the detected site, cookie/storage counts and key NAMES, whether the site's credential was found and a masked preview of it, the captured UA and any Doubao device_id, honest warnings, and the space's web-token agents with a matches flag for the detected site. No credential value is ever returned.",
    request: z.object({ raw: z.string().max(1000000) }),
    response: importPreviewResponse,
    handler: async (
      ctx,
      args,
    ): Promise<z.infer<typeof importPreviewResponse>> => {
      const db = ctx.db<typeof schema>();
      const ex = parseCredentialImport(args.raw);
      const agents = await db
        .select({
          id: schema.agents.id,
          name: schema.agents.name,
          provider: schema.agents.provider,
          webStatus: schema.agents.webStatus,
        })
        .from(schema.agents)
        .where(eq(schema.agents.connectionType, "web"))
        .orderBy(asc(schema.agents.id));
      return {
        ok: !ex.error && (ex.token !== "" || ex.cookieHeader !== ""),
        error: ex.error,
        isBundle: ex.isBundle,
        provider: ex.provider,
        siteLabel: ex.provider ? webSiteLabel(ex.provider) : "",
        domain: ex.domain,
        url: ex.url,
        cookieCount: ex.cookies.length,
        httpOnlyCount: ex.cookies.filter((c) => c.httpOnly).length,
        cookieNames: ex.cookies.map((c) => c.name).slice(0, 120),
        localStorageKeys: ex.localStorageKeys.slice(0, 120),
        sessionStorageKeys: ex.sessionStorageKeys.slice(0, 120),
        tokenFound: ex.token !== "",
        tokenPreview: maskSecretPreview(ex.token),
        tokenSource: ex.tokenSource,
        cookieLength: ex.cookieHeader.length,
        userAgent: ex.userAgent,
        deviceId: ex.deviceId,
        warnings: ex.warnings,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          provider: a.provider,
          webStatus: a.webStatus,
          matches: ex.provider !== "" && a.provider === ex.provider,
        })),
      };
    },
  }),

  applyImportBundle: defineAction({
    description:
      "Applies one 账号导入 paste to ONE chosen web-token agent: the paste is parsed exactly like parseImportBundle, split into that site's credential fields and stored server-side only (webToken; the full Cookie header in webCookie; the captured browser UA in webUserAgent; a recovered Doubao device_id in webDeviceId; and, for an extension bundle, the raw export JSON in webImportJson with its import time — no action ever returns any of it). A bundle whose detected site differs from the chosen agent's site is refused without writing anything. A non-bundle paste is interpreted against the chosen agent's site (DeepSeek unwrapping, 千问 bundle splitting, Claude sessionKey extraction). The stored credential is then verified with the site's real validator exactly like verifyWebToken — login state, masked account, account-identity recording and the same-account collision warning all behave identically — and the response reports what was stored (booleans only) plus the verification outcome.",
    request: z.object({
      raw: z.string().min(1).max(1000000),
      agentId: z.number().int().positive(),
    }),
    response: importApplyResponse,
    handler: async (
      ctx,
      args,
    ): Promise<z.infer<typeof importApplyResponse>> => {
      const db = ctx.db<typeof schema>();
      const fail = (
        error: string,
        provider = "",
      ): z.infer<typeof importApplyResponse> => ({
        ok: false,
        status: "",
        account: "",
        error,
        identityWarning: "",
        provider,
        siteLabel: provider ? webSiteLabel(provider) : "",
        appliedToken: false,
        appliedCookie: false,
        appliedUserAgent: false,
        appliedDeviceId: false,
        storedBundle: false,
      });
      const rows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.agentId));
      const agent = rows[0];
      if (!agent) return fail("智能体不存在");
      if (agent.connectionType !== "web")
        return fail("该智能体不是网页令牌登录方式，不能导入网页凭证", agent.provider);
      const ex = parseCredentialImport(args.raw);
      if (ex.error) return fail(ex.error, ex.provider);
      if (ex.provider && ex.provider !== agent.provider) {
        return fail(
          `这份数据是${webSiteLabel(ex.provider)}（${ex.domain || "未知域名"}）的，与所选智能体「${agent.name}」（${webSiteLabel(agent.provider)}）不是同一个网站，已拒绝写入，避免把一个站的凭证存进另一个站的智能体`,
          ex.provider,
        );
      }
      // Derive the fields to store. A bundle already carries
      // the per-site derivation; a bare paste is read against
      // the chosen agent's own site.
      let token = ex.token;
      let cookie = ex.cookieHeader;
      let ua = ex.userAgent;
      let deviceId = ex.deviceId;
      if (!ex.isBundle && !ex.provider) {
        if (agent.provider === "qwen") {
          const q = parseQwenPaste(args.raw);
          if (q.token) token = q.token;
          if (q.cookie) cookie = q.cookie;
          if (q.ua) ua = q.ua;
        } else if (agent.provider === "deepseek") {
          token = unwrapDeepseekToken(args.raw);
        } else if (agent.provider === "claude" && token.includes("sessionKey=")) {
          token = cookiePairValue(token, "sessionKey") || token;
        }
      }
      if (!token) {
        return fail(
          ex.warnings[0] ??
            "没有从这份数据里找到该网站可用的登录凭证：请确认是在目标网站已登录的页面上用扩展抓取的",
          agent.provider,
        );
      }
      await db
        .update(schema.agents)
        .set({
          webToken: token,
          ...(cookie ? { webCookie: cookie } : {}),
          ...(ua ? { webUserAgent: ua } : {}),
          ...(deviceId ? { webDeviceId: deviceId } : {}),
          ...(ex.isBundle
            ? { webImportJson: args.raw.trim(), webImportAt: new Date() }
            : {}),
        })
        .where(eq(schema.agents.id, agent.id));
      const applied = {
        appliedToken: true,
        appliedCookie: cookie !== "",
        appliedUserAgent: ua !== "",
        appliedDeviceId: deviceId !== "",
        storedBundle: ex.isBundle,
      };
      // Verify with the site's own validator, mirroring
      // verifyWebToken's bookkeeping (status, masked account,
      // Gemini rotation persistence, identity recording and the
      // collision warning).
      await refreshAgentRoute(ctx);
      const validator =
        agent.provider === "deepseek"
          ? dsValidateToken
          : WEB_VALIDATORS[agent.provider];
      if (!validator) {
        ctx.invalidateQueries();
        return {
          ok: true,
          status: agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error: "凭证已保存到服务端；该站点暂不支持自动验证登录，请到智能体设置里查看",
          identityWarning: "",
          provider: agent.provider,
          siteLabel: webSiteLabel(agent.provider),
          ...applied,
        };
      }
      const v =
        agent.provider === "qwen"
          ? await validateQwen(token, { cookie, ua: ua || agent.webUserAgent })
          : await validator(token);
      if (v.ok) {
        const account = maskWebAccount(v.account);
        await db
          .update(schema.agents)
          .set({
            webStatus: "logged_in",
            webAccount: account,
            webError: "",
            webCheckedAt: new Date(),
            ...(v.accountId ? { webAccountId: v.accountId } : {}),
            ...(agent.provider === "gemini" &&
            v.accessToken &&
            v.accessToken !== token
              ? { webToken: v.accessToken }
              : {}),
          })
          .where(eq(schema.agents.id, agent.id));
        const storedCredential =
          agent.provider === "gemini" && v.accessToken ? v.accessToken : token;
        const recorded = await recordWebIdentity(
          db,
          agent,
          webIdentityString(v),
          storedCredential,
        );
        const collisions = await findWebIdentityCollisions(db, {
          id: agent.id,
          provider: agent.provider,
          webIdentityHash: recorded.identityHash,
          webCredentialHash: recorded.credentialHash,
        });
        const warnings: string[] = [];
        if (collisions.length) {
          warnings.push(
            webIdentityCollisionWarning(
              webSiteLabel(agent.provider),
              account,
              collisions,
            ),
          );
        }
        if (recorded.identityChanged) {
          warnings.push(
            "注意：这个智能体的账号已变更为当前导入的账号，它名下旧账号的官网对话续接（以及豆包的已识别模型菜单）已清除，下一次发送会按新账号重新开始。",
          );
        }
        ctx.invalidateQueries();
        return {
          ok: true,
          status: "logged_in",
          account,
          error: "",
          identityWarning: warnings.join("\n"),
          provider: agent.provider,
          siteLabel: webSiteLabel(agent.provider),
          ...applied,
        };
      }
      if (v.kind === "error") {
        await db
          .update(schema.agents)
          .set({
            webError: v.error,
            ...(agent.webStatus === "" ? { webStatus: "error" } : {}),
          })
          .where(eq(schema.agents.id, agent.id));
        ctx.invalidateQueries();
        return {
          ok: false,
          status: agent.webStatus === "" ? "error" : agent.webStatus,
          account: maskWebAccount(agent.webAccount),
          error: `凭证已保存到服务端，但验证请求本身失败：${v.error}`,
          identityWarning: "",
          provider: agent.provider,
          siteLabel: webSiteLabel(agent.provider),
          ...applied,
        };
      }
      await db
        .update(schema.agents)
        .set({ webStatus: v.kind, webError: v.error, webAccount: "", webCheckedAt: new Date() })
        .where(eq(schema.agents.id, agent.id));
      ctx.invalidateQueries();
      return {
        ok: false,
        status: v.kind,
        account: "",
        error: `凭证已保存到服务端，但官网验证未通过：${v.error}`,
        identityWarning: "",
        provider: agent.provider,
        siteLabel: webSiteLabel(agent.provider),
        ...applied,
      };
    },
  }),

getCurrentVersion: defineAction({
description: "Returns ONLY the space's current version string (the newest recorded update's version, e.g. \"v81\"), or null when no update has been recorded. Deliberately loads nothing else — no titles, no change summaries, no history — so the settings list can show the version number without reading the update notes.",
request: z.object({}),
response: z.object({
current: z.object({ version: z.string() }).nullable(),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select({ version: schema.spaceVersions.version })
.from(schema.spaceVersions)
.orderBy(desc(schema.spaceVersions.id))
.limit(1);
const first = rows[0];
return { current: first ? { version: first.version } : null };
},
}),

getVersionHistory: defineAction({
description: "Returns the space's version record for the version page, loaded only when the user opens that page: the current version (the newest recorded update) plus the newest 50 recorded versions, newest-first, each with its brief change summary and date. Exactly one row exists per shipped update of the space — each update appends its own row when it ships — so the list is the space's real update history, capped at the 50 most recent entries.",
request: z.object({}),
response: z.object({
current: z
.object({ version: z.string(), title: z.string(), updatedAt: z.string() })
.nullable(),
versions: z.array(
z.object({
id: z.number(),
version: z.string(),
title: z.string(),
summary: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.spaceVersions)
.orderBy(desc(schema.spaceVersions.id))
.limit(VERSION_HISTORY_LIMIT);
const versions = rows.map((r) => ({
id: r.id,
version: r.version,
title: r.title,
summary: r.summary,
createdAt: safeIso(r.createdAt),
}));
const first = versions[0];
return {
current: first
? { version: first.version, title: first.title, updatedAt: first.createdAt }
: null,
versions,
};
},
}),

listPromptNotes: defineAction({
description:
  "Lists the 创作 prompt notebook （提示词记录）: prompts the user recorded by hand, newest first, each with its style-reference note. Purely the user's own notes — the workspace no longer generates anything.",
request: z.object({}),
response: z.object({
notes: z.array(
z.object({
id: z.number(),
title: z.string(),
content: z.string(),
style: z.string(),
createdAt: z.string(),
updatedAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.promptNotes)
.orderBy(desc(schema.promptNotes.id));
return {
notes: rows.map((r) => ({
id: r.id,
title: r.title,
content: r.content,
style: r.style,
createdAt: r.createdAt.toISOString(),
updatedAt: r.updatedAt.toISOString(),
})),
};
},
}),

createPromptNote: defineAction({
description:
  "Records one hand-written prompt in the 创作 prompt notebook （提示词记录）: an optional title, the prompt text, and an optional style-reference note （风格参考）.",
request: z.object({
title: z.string().trim().max(100),
content: z.string().trim().min(1, "提示词不能为空").max(4000),
style: z.string().trim().max(2000).default(""),
}),
response: z.object({
note: z.object({
id: z.number(),
title: z.string(),
content: z.string(),
style: z.string(),
createdAt: z.string(),
updatedAt: z.string(),
}),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const inserted = await db
.insert(schema.promptNotes)
.values({ title: args.title, content: args.content, style: args.style })
.returning();
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
return {
note: {
id: row.id,
title: row.title,
content: row.content,
style: row.style,
createdAt: row.createdAt.toISOString(),
updatedAt: row.updatedAt.toISOString(),
},
};
},
}),

updatePromptNote: defineAction({
description: "Edits one recorded prompt note's title, text and style-reference note.",
request: z.object({
id: z.number().int().positive(),
title: z.string().trim().max(100),
content: z.string().trim().min(1, "提示词不能为空").max(4000),
style: z.string().trim().max(2000).default(""),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.promptNotes)
.set({ title: args.title, content: args.content, style: args.style, updatedAt: new Date() })
.where(eq(schema.promptNotes.id, args.id));
return { ok: true };
},
}),

deletePromptNote: defineAction({
description: "Deletes one recorded prompt note.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.promptNotes)
.where(eq(schema.promptNotes.id, args.id));
return { ok: true };
},
}),

getPromptTree: defineAction({
description:
  "Returns the 创作 prompt-tag tree （提示词标签树） as a flat parent-linked list for the infinite canvas: the root 「提示词」, the professional categories, their sub-groups and the leaf tags, each leaf carrying the prompt fragment it contributes when chosen. On the very first read the canvas's initial state is seeded exactly once (guarded by prompt_tree_state, so later deletions never bring it back); after that the rows are purely the user's own. The initial state is deliberately style-only — 画风/色彩/光线/构图/镜头/画质/负面 — with no item or prop categories, exactly what resetPromptTree restores.",
request: z.object({}),
response: z.object({
tags: z.array(
z.object({
id: z.number(),
parentId: z.number().nullable(),
label: z.string(),
value: z.string(),
sort: z.number(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
let stateRows = await db
.select()
.from(schema.promptTreeState)
.where(eq(schema.promptTreeState.id, 1));
if (stateRows.length === 0) {
await db.insert(schema.promptTreeState).values({ id: 1, seeded: 0 });
stateRows = await db
.select()
.from(schema.promptTreeState)
.where(eq(schema.promptTreeState.id, 1));
}
if (stateRows[0] && stateRows[0].seeded !== 1) {
await insertPromptSeed(db, PROMPT_TAG_INITIAL_ROOT, null, 0);
await db
.update(schema.promptTreeState)
.set({ seeded: 1 })
.where(eq(schema.promptTreeState.id, 1));
}
const rows = await db
.select()
.from(schema.promptTags)
.orderBy(asc(schema.promptTags.sort), asc(schema.promptTags.id));
return {
tags: rows.map((r) => ({
id: r.id,
parentId: r.parentId,
label: r.label,
value: r.value,
sort: r.sort,
})),
};
},
}),

createPromptTag: defineAction({
description:
  "Adds one tag under an existing prompt-tag node on the 创作 canvas (the double-click editor's 添加子标签）: a display label and the prompt fragment it contributes when chosen. It lands after its existing siblings.",
request: z.object({
parentId: z.number().int().positive(),
label: z.string().trim().min(1, "标签名称不能为空").max(60),
value: z.string().trim().max(500).default(""),
}),
response: z.object({
tag: z.object({
id: z.number(),
parentId: z.number().nullable(),
label: z.string(),
value: z.string(),
sort: z.number(),
}),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const siblings = await db
.select()
.from(schema.promptTags)
.where(eq(schema.promptTags.parentId, args.parentId));
const inserted = await db
.insert(schema.promptTags)
.values({
parentId: args.parentId,
label: args.label,
value: args.value,
sort: siblings.length,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("添加失败，请重试");
return {
tag: {
id: row.id,
parentId: row.parentId,
label: row.label,
value: row.value,
sort: row.sort,
},
};
},
}),

updatePromptTag: defineAction({
description:
  "Edits one prompt tag on the 创作 canvas (the double-click editor): its display label and the prompt fragment it contributes when chosen.",
request: z.object({
id: z.number().int().positive(),
label: z.string().trim().min(1, "标签名称不能为空").max(60),
value: z.string().trim().max(500).default(""),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.promptTags)
.set({ label: args.label, value: args.value, updatedAt: new Date() })
.where(eq(schema.promptTags.id, args.id));
return { ok: true };
},
}),

deletePromptTag: defineAction({
description:
  "Deletes one prompt tag on the 创作 canvas together with its whole branch (every descendant). The root 「提示词」 node itself cannot be deleted.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db.select().from(schema.promptTags);
const target = rows.find((r) => r.id === args.id);
if (!target) return { ok: true };
if (target.parentId === null) {
throw new Error("根标签不能删除");
}
const doomed = new Set<number>([args.id]);
let grew = true;
while (grew) {
grew = false;
for (const r of rows) {
if (
r.parentId !== null &&
doomed.has(r.parentId) &&
!doomed.has(r.id)
) {
doomed.add(r.id);
grew = true;
}
}
}
const statements: BatchItem<"sqlite">[] = [...doomed].map((id) =>
db.delete(schema.promptTags).where(eq(schema.promptTags.id, id)),
);
const [first, ...rest] = statements;
if (first) await db.batch([first, ...rest]);
return { ok: true };
},
}),

resetPromptTree: defineAction({
description:
  "Restores the 创作 prompt-tag canvas to its initial state （一键初始状态）: every current tag — built-in and user-added alike — is deleted and the built-in initial set is seeded fresh. The initial set is style-only by the user's instruction: 画风 (mediums, animation/photography styles, art movements, textures), 色彩， 光线， 构图， 镜头， 画质细节 and 负面提示词 — no subject, outfit, scene or other item/prop categories. The seeded marker stays set, so the tree afterwards is the user's to edit as usual.",
request: z.object({}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db.select().from(schema.promptTags);
// Delete deepest-first so no row outlives its parent mid-batch.
const depthOf = new Map<number, number>();
const byId = new Map(rows.map((r) => [r.id, r] as const));
const depth = (id: number): number => {
const cached = depthOf.get(id);
if (cached !== undefined) return cached;
const row = byId.get(id);
const d =
!row || row.parentId === null || !byId.has(row.parentId)
? 0
: depth(row.parentId) + 1;
depthOf.set(id, d);
return d;
};
const ordered = [...rows].sort((a, b) => depth(b.id) - depth(a.id));
if (ordered.length > 0) {
const statements: BatchItem<"sqlite">[] = ordered.map((r) =>
db.delete(schema.promptTags).where(eq(schema.promptTags.id, r.id)),
);
const [first, ...rest] = statements;
if (first) await db.batch([first, ...rest]);
}
await insertPromptSeed(db, PROMPT_TAG_INITIAL_ROOT, null, 0);
const stateRows = await db
.select()
.from(schema.promptTreeState)
.where(eq(schema.promptTreeState.id, 1));
if (stateRows.length === 0) {
await db.insert(schema.promptTreeState).values({ id: 1, seeded: 1 });
} else if (stateRows[0] && stateRows[0].seeded !== 1) {
await db
.update(schema.promptTreeState)
.set({ seeded: 1 })
.where(eq(schema.promptTreeState.id, 1));
}
return { ok: true };
},
}),

getMenuOrder: defineAction({
description:
  "Returns the sidebar menu's entry order for the long-press-drag rearrangement: the user's saved order from their profile row, sanitized so every known menu key (agents / creation / code / image / browser / vault / monitor / ledger / files / vpn) appears exactly once — unknown keys dropped, entries added since the order was saved appended in the default order. Empty stored value = the built-in default order.",
request: z.object({}),
response: z.object({ order: z.array(z.string()) }),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const p = await loadProfile(db);
return { order: parseMenuOrder(p.menuOrder) };
},
}),

setMenuOrder: defineAction({
description:
  "Saves the sidebar menu's entry order after the user long-press-drags entries into place. The list is sanitized the same way reads are (known keys only, no duplicates, missing keys appended in default order) and stored as JSON on the user's profile row; the sanitized order is returned.",
request: z.object({
order: z.array(z.string().max(20)).max(20),
}),
response: z.object({ order: z.array(z.string()) }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
await loadProfile(db);
const order = sanitizeMenuOrder(args.order);
await db
.update(schema.userProfile)
.set({ menuOrder: JSON.stringify(order) })
.where(eq(schema.userProfile.id, 1));
ctx.invalidateQueries();
return { order };
},
}),

listBrowserCapture: defineAction({
description:
  "Lists the 抓包 (capture) records for one browser tab (capId = the pane instance + tab): the requests this server made for the in-space browser (page fetches and downloads), newest last, with the full detail payload (headers, bodies, timing segments) for the capture panel. Requests the page made on its own are reported by the page's probe directly to the shell and never stored here.",
request: z.object({
capId: z.string().trim().min(1).max(120),
}),
response: z.object({
entries: z.array(
z.object({
id: z.number(),
ts: z.number(),
method: z.string(),
url: z.string(),
kind: z.string(),
status: z.number(),
size: z.number(),
durationMs: z.number(),
contentType: z.string(),
reqHeaders: z.string(),
resHeaders: z.string(),
reqBody: z.string(),
resBody: z.string(),
timings: z.string(),
}),
),
}),
privileged: [],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.browserCapture)
.where(eq(schema.browserCapture.capId, args.capId))
.orderBy(asc(schema.browserCapture.id))
.limit(300);
return {
entries: rows.map((r) => ({
id: r.id,
ts: r.ts,
method: r.method,
url: r.url,
kind: r.kind,
status: r.status,
size: r.size,
durationMs: r.durationMs,
contentType: r.contentType,
reqHeaders: r.reqHeaders,
resHeaders: r.resHeaders,
reqBody: r.reqBody,
resBody: r.resBody,
timings: r.timings,
})),
};
},
}),

clearBrowserCapture: defineAction({
description:
  "Clears the stored 抓包 (capture) records for one browser tab (the panel's 清空 button). Only that tab's server-side records are deleted.",
request: z.object({
capId: z.string().trim().min(1).max(120),
}),
response: z.object({ ok: z.literal(true) }),
privileged: [],
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.browserCapture)
.where(eq(schema.browserCapture.capId, args.capId));
return { ok: true };
},
}),

getBrowserDeviceMode: defineAction({
description:
  "Returns the in-space browser's device mode （设备模式）: 'desktop' （电脑）, 'android' （安卓） or 'ios' （苹果） — the device identity the browser presents to websites, stored server-side.",
request: z.object({}),
response: z.object({
deviceMode: z.enum(["desktop", "android", "ios"]),
}),
handler: async (ctx) => {
const mode = await loadBrowserDeviceMode(ctx);
return { deviceMode: mode };
},
}),

setBrowserDeviceMode: defineAction({
description:
  "Sets the in-space browser's device mode （设备模式）: 'desktop' （电脑）, 'android' （安卓） or 'ios' （苹果）. Stored server-side; page loads after the change fetch and render under the new identity (the browser shell reloads the current page).",
request: z.object({
mode: z.enum(["desktop", "android", "ios"]),
}),
response: z.object({
deviceMode: z.enum(["desktop", "android", "ios"]),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const now = Date.now();
const existing = await db
.select()
.from(schema.browserState)
.where(eq(schema.browserState.id, 1));
if (existing[0]) {
await db
.update(schema.browserState)
.set({ deviceMode: args.mode, updatedAt: now })
.where(eq(schema.browserState.id, 1));
} else {
await db
.insert(schema.browserState)
.values({ id: 1, deviceMode: args.mode, updatedAt: now });
}
ctx.invalidateQueries();
return { deviceMode: args.mode };
},
}),

getBrowserCompatSettings: defineAction({
description:
  "Returns the in-space browser's 兼容设置 (browser → 设置）: the custom User-Agent (empty = the device mode's built-in UA), the effective UA actually sent, the recommended standard desktop Chrome UA preset, the 启用 Cookie / 持久化会话 switch and the 忽略证书错误 switch — all stored server-side. With no stored row yet the 操作一 applied state is returned (recommended UA, both switches on).",
request: z.object({}),
response: z.object({
deviceMode: z.enum(["desktop", "android", "ios"]),
customUserAgent: z.string(),
effectiveUserAgent: z.string(),
recommendedUserAgent: z.string(),
cookiesEnabled: z.boolean(),
ignoreCertErrors: z.boolean(),
}),
handler: async (ctx) => {
const compat = await loadBrowserCompatSettings(ctx);
return {
deviceMode: compat.deviceMode,
customUserAgent: compat.customUserAgent,
effectiveUserAgent: compat.effectiveUserAgent,
recommendedUserAgent: BROWSER_RECOMMENDED_UA,
cookiesEnabled: compat.cookiesEnabled,
ignoreCertErrors: compat.ignoreCertErrors,
};
},
}),

setBrowserCompatSettings: defineAction({
description:
  "Saves the in-space browser's 兼容设置： any of customUserAgent (trimmed, ≤600 chars; empty clears the override back to the device mode's UA), cookiesEnabled （启用 Cookie / 持久化会话 — off means no cookies are sent, stored or shown to pages and no page storage is seeded or saved) and ignoreCertErrors （忽略证书错误 — browser fetches then skip TLS verification through the privileged layer). Omitted fields keep their stored values. Stored server-side on the browser_state singleton; the browser shell reloads the current page after a save so the new identity/switches apply immediately.",
request: z.object({
customUserAgent: z.string().max(600).optional(),
cookiesEnabled: z.boolean().optional(),
ignoreCertErrors: z.boolean().optional(),
}),
response: z.object({
deviceMode: z.enum(["desktop", "android", "ios"]),
customUserAgent: z.string(),
effectiveUserAgent: z.string(),
recommendedUserAgent: z.string(),
cookiesEnabled: z.boolean(),
ignoreCertErrors: z.boolean(),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const now = Date.now();
const existing = await db
.select()
.from(schema.browserState)
.where(eq(schema.browserState.id, 1));
const cur = await loadBrowserCompatSettings(ctx);
const next = {
deviceMode: cur.deviceMode,
customUserAgent:
args.customUserAgent !== undefined
? args.customUserAgent.trim()
: cur.customUserAgent,
cookiesEnabled:
args.cookiesEnabled !== undefined
? args.cookiesEnabled
: cur.cookiesEnabled,
ignoreCertErrors:
args.ignoreCertErrors !== undefined
? args.ignoreCertErrors
: cur.ignoreCertErrors,
};
if (existing[0]) {
await db
.update(schema.browserState)
.set({
customUserAgent: next.customUserAgent,
cookiesEnabled: next.cookiesEnabled ? 1 : 0,
ignoreCertErrors: next.ignoreCertErrors ? 1 : 0,
updatedAt: now,
})
.where(eq(schema.browserState.id, 1));
} else {
await db.insert(schema.browserState).values({
id: 1,
deviceMode: next.deviceMode,
customUserAgent: next.customUserAgent,
cookiesEnabled: next.cookiesEnabled ? 1 : 0,
ignoreCertErrors: next.ignoreCertErrors ? 1 : 0,
updatedAt: now,
});
}
ctx.invalidateQueries();
const compat = await loadBrowserCompatSettings(ctx);
return {
deviceMode: compat.deviceMode,
customUserAgent: compat.customUserAgent,
effectiveUserAgent: compat.effectiveUserAgent,
recommendedUserAgent: BROWSER_RECOMMENDED_UA,
cookiesEnabled: compat.cookiesEnabled,
ignoreCertErrors: compat.ignoreCertErrors,
};
},
}),

fetchBrowserPage: defineAction({
description:
  "Loads one web page for the in-space browser （内置浏览器）: the page is fetched server-side (GET, or POST with a serialized form body when a page form is submitted) and its HTML is returned rewritten for in-space rendering — a <base> pointing at the real origin (so images and styles load), meta-refresh tags converted into an in-space navigation after their delay, and a small interceptor injected that (a) reports link clicks, window.open / target=_blank opens and form submits (GET and POST) back to the browser shell, so every jump navigates INSIDE the space — same tab for links and forms, a new in-space tab for popups and _blank links — and never out to the device's browser; (b) detects the page's video/audio element, reports its playback state to the shell (for the background mini player), executes the shell's play/pause commands, registers Media Session handlers and re-asserting playback when the page is hidden while background play is on, and — for video — draws the media control bar (play/pause, seek, time, volume, rate, picture-in-picture, fullscreen, background-play toggle and a download button) as an overlay ON the video element inside the page, not in the browser chrome; the download button posts the video's address back so the shell downloads it through downloadBrowserFile (blob:/m3u8 streaming sources are refused with the real reason); (c) reports credentials typed into a login form (username + password + page URL) so the shell can offer to save them into the 密码本， and fills a saved credential back into the form on the shell's fill command; (d) applies the shell's per-tab 仅视频 (video-only) mode on command — images and background images are suppressed by an injected stylesheet, ad/popup/widget-patterned and fixed-overlay elements without a video are hidden (tracked so disabling restores them exactly), new popups via window.open are blocked, and a mutation observer keeps the mode applied to elements the page adds later; and (e) while the shell's 双指缩放 gesture is on, forwards two-finger pinch gestures performed over the page itself to the shell, which zooms the whole browser pane (the page area's touches never reach the shell otherwise). Non-HTML content comes back flagged (isHtml=false) so the shell can offer it as a download instead. Fetch failures and HTTP errors return ok=false with the site's real reason — the browser shows it in place and never falls back on its own. With textMode=true （纯文本模式） the page is instead reduced server-side to plain text with JavaScript fully disabled: no script of the page is kept, returned or executed, no bootstrap/interceptor is injected, and the response carries plainText (the page's readable text, scripts/styles/markup stripped) plus textLinks (the page's links, resolved absolute) for the shell to render as a plain-text view. The fetch runs with the browser's server-side cookie jar (seeded from browser_cookies, every redirect hop's Set-Cookie persisted back), so logins survive across pages; and a bootstrap script is injected into <head> ahead of the page's own scripts that shims Web Storage and document.cookie from the server-side rows and relays the page's fetch/XMLHttpRequest through the shell to fetchBrowserResource — without it, modern API-driven sites cannot boot at all in the frame's opaque origin (storage throws, API calls are refused cross-origin, no cookies). Every fetch (this page load and the bridge alike) presents the browser's stored device mode （设备模式： 电脑 desktop / 安卓 android / 苹果 ios) — its User-Agent and client hints on the wire, and the same identity in the bootstrap's navigator — so a site serves and renders one consistent device version.",
request: z.object({
url: z.string().trim().min(1).max(4000),
// A page form submitted with POST: method + its serialized
// urlencoded body are forwarded to the privileged fetch so the
// submit really happens and the result page renders in-space.
method: z.enum(["GET", "POST"]).default("GET"),
body: z.string().max(262144).default(""),
contentType: z.string().max(200).default(""),
// The browser pane's capture id ("<instance>:<tabId>") for
// the 抓包 panel: when present, this fetch is recorded into
// the capture table under that id.
capId: z.string().trim().max(120).default(""),
// 纯文本模式 (text mode): true = JavaScript is disabled for
// this load — the page's HTML is reduced to plain text plus
// its links server-side and nothing of the page is executed.
textMode: z.boolean().default(false),
}),
response: z.object({
ok: z.boolean(),
status: z.number(),
finalUrl: z.string(),
title: z.string(),
html: z.string(),
contentType: z.string(),
isHtml: z.boolean(),
truncated: z.boolean(),
error: z.string(),
// 纯文本模式 results: plainText is the page's readable text
// with every script/style/markup stripped (empty outside
// text mode); textLinks are the page's links in document
// order; textMode echoes which mode produced this response.
plainText: z.string(),
textLinks: z.array(z.object({ text: z.string(), url: z.string() })),
textMode: z.boolean(),
}),
privileged: [privileged.fetchWebPage],
handler: async (ctx, args) => {
let parsed: URL;
try {
parsed = new URL(args.url);
} catch {
return { ok: false, status: 0, finalUrl: args.url, title: "", html: "", contentType: "", isHtml: false, truncated: false, error: "地址无效", plainText: "", textLinks: [], textMode: args.textMode };
}
if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
return { ok: false, status: 0, finalUrl: args.url, title: "", html: "", contentType: "", isHtml: false, truncated: false, error: "只支持 http / https 地址", plainText: "", textLinks: [], textMode: args.textMode };
}
const cookieJar = await loadBrowserCookieJar(ctx);
const compat = await loadBrowserCompatSettings(ctx);
const deviceProfile = compat.profile;
const r = await ctx.executePrivileged(privileged.fetchWebPage, {
url: parsed.toString(),
maxBytes: 3145728,
timeoutMs: 25000,
method: args.method,
body: args.body,
bodyBase64: "",
contentType: args.contentType,
// A typed-address navigation in a real Chrome carries the
// Sec-Fetch navigation trio and upgrade-insecure-requests;
// gateways that fingerprint the document request itself
// (again ByteDance's among them) treat their absence as a
// non-browser caller. A replayed form POST is a same-origin
// navigation instead of a fresh typed one.
headers:
args.method === "POST"
? [
["sec-fetch-dest", "document"],
["sec-fetch-mode", "navigate"],
["sec-fetch-site", "same-origin"],
["upgrade-insecure-requests", "1"],
]
: [
["sec-fetch-dest", "document"],
["sec-fetch-mode", "navigate"],
["sec-fetch-site", "none"],
["sec-fetch-user", "?1"],
["upgrade-insecure-requests", "1"],
],
cookies: cookieJar,
userAgent: deviceProfile.ua,
secChUaMobile: deviceProfile.secChUaMobile,
secChUaPlatform: deviceProfile.secChUaPlatform,
    ignoreCertErrors: compat.ignoreCertErrors,
});
await persistBrowserSetCookies(ctx, r.setCookies ?? []);
const captureBase = {
capId: args.capId,
method: args.method,
url: r.finalUrl || parsed.toString(),
kind: "document",
durationMs: r.durationMs,
reqHeaders: r.requestHeaders,
resHeaders: r.responseHeaders,
reqBody: args.method === "POST" ? args.body : "",
timings: r.timings,
};
if (r.status === 0) {
await recordBrowserCapture(ctx, {
...captureBase,
status: 0,
size: 0,
contentType: "",
resBody: "",
});
return { ok: false, status: 0, finalUrl: parsed.toString(), title: "", html: "", contentType: "", isHtml: false, truncated: false, error: r.error || "网络请求失败", plainText: "", textLinks: [], textMode: args.textMode };
}
if (r.status >= 400) {
await recordBrowserCapture(ctx, {
...captureBase,
status: r.status,
size: base64ByteLength(r.bodyBase64),
contentType: r.contentType,
resBody: "",
});
return { ok: false, status: r.status, finalUrl: r.finalUrl || parsed.toString(), title: "", html: "", contentType: r.contentType, isHtml: false, truncated: false, error: r.error || `网站返回 HTTP ${r.status}`, plainText: "", textLinks: [], textMode: args.textMode };
}
const ct = (r.contentType || "").toLowerCase();
const isHtml =
ct.includes("text/html") || ct.includes("application/xhtml") || ct === "";
if (!isHtml) {
await recordBrowserCapture(ctx, {
...captureBase,
status: r.status,
size: base64ByteLength(r.bodyBase64),
contentType: r.contentType,
resBody: "",
});
return { ok: true, status: r.status, finalUrl: r.finalUrl || parsed.toString(), title: "", html: "", contentType: r.contentType, isHtml: false, truncated: r.truncated, error: "", plainText: "", textLinks: [], textMode: args.textMode };
}
// Decode the body with the page's own charset when declared.
let bytes: Uint8Array;
try {
const bin = atob(r.bodyBase64);
bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
} catch {
return { ok: false, status: r.status, finalUrl: r.finalUrl || parsed.toString(), title: "", html: "", contentType: r.contentType, isHtml: true, truncated: r.truncated, error: "页面内容解码失败", plainText: "", textLinks: [], textMode: args.textMode };
}
const charsetMatch = /charset=([\w-]+)/i.exec(ct);
let html: string;
try {
html = new TextDecoder((charsetMatch?.[1] ?? "utf-8") as "utf-8").decode(bytes);
} catch {
html = new TextDecoder("utf-8").decode(bytes);
}
const finalUrl = r.finalUrl || parsed.toString();
const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
const title = (titleMatch?.[1] ?? "")
.replace(/&amp;/g, "&")
.replace(/&lt;/g, "<")
.replace(/&gt;/g, ">")
.replace(/&quot;/g, '"')
.replace(/&#39;/g, "'")
.replace(/\s+/g, " ")
.trim()
.slice(0, 200);
// The capture panel's response-body preview: the page's own
// HTML exactly as fetched, before any rewriting below.
const captureResBody = html.slice(0, 65536);
// 纯文本模式 (text mode, JavaScript disabled): the page is
// reduced to its readable text + links right here and
// returned as data — no bootstrap, no interceptor, no page
// script is kept or executed anywhere.
if (args.textMode) {
const extracted = htmlToPlainText(html, finalUrl);
await recordBrowserCapture(ctx, {
...captureBase,
status: r.status,
size: base64ByteLength(r.bodyBase64),
contentType: r.contentType,
resBody: captureResBody,
});
return {
ok: true,
status: r.status,
finalUrl,
title,
html: "",
contentType: r.contentType,
isHtml: true,
truncated: r.truncated || extracted.truncated,
error: "",
plainText: extracted.text,
textLinks: extracted.links,
textMode: true,
};
}
// Meta-refresh: the tag itself is stripped (left in, it would
// navigate the frame out of the space), but a refresh that
// names a target URL is a jump the page intends — it is
// converted into an in-space navigation after its delay,
// posted by a small timer script injected with the interceptor.
let refreshScript = "";
{
const tagMatch =
/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(html);
const contentMatch = tagMatch
? /content\s*=\s*["']([^"']*)["']/i.exec(tagMatch[0])
: null;
const parts = (contentMatch?.[1] ?? "").split(";");
const delaySec = Math.min(
30,
Math.max(0, Number.parseFloat((parts[0] ?? "0").trim()) || 0),
);
const urlPart = parts
.slice(1)
.join(";")
.trim()
.replace(/^url\s*=\s*/i, "")
.replace(/^["']|["']$/g, "")
.trim();
if (urlPart) {
try {
const target = new URL(urlPart, finalUrl).toString();
refreshScript = `<script>setTimeout(function(){try{parent.postMessage({__museBrowser:'nav',url:${JSON.stringify(target)}},'*');}catch(e){}},${Math.round(delaySec * 1000)});</script>`;
} catch {
// unparseable refresh target: the tag is simply stripped
}
}
}
html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
const interceptor =
"<script>(function(){" +
"function abs(u){try{return new URL(u,document.baseURI).href;}catch(e){return null;}}" +
"document.addEventListener('click',function(e){" +
"var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;" +
"if(!a)return;" +
"var href=abs(a.getAttribute('href'));" +
"if(!href)return;" +
"if(href.indexOf('http://')!==0&&href.indexOf('https://')!==0)return;" +
"e.preventDefault();" +
"var dl=a.hasAttribute('download')||/\\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|mp3|mp4|dmg|apk|exe|tar|gz)(\\?|#|$)/i.test(href);" +
"if(dl){parent.postMessage({__museBrowser:'download',url:href},'*');return;}" +
// A link that asks for a new window (target=_blank) opens a
// new tab INSIDE the space browser; every other link
// navigates the same tab. Nothing ever leaves the space.
"var tgt=(a.getAttribute('target')||'').toLowerCase();" +
"parent.postMessage({__museBrowser:tgt==='_blank'?'open':'nav',url:href},'*');" +
"},true);" +
// window.open: the sandboxed frame cannot open real popups,
// so a script-driven open is reported to the shell, which
// opens it as a new in-space tab. (仅视频 mode replaces this
// with its own blocker and restores this one on exit.)
"window.open=function(u){try{if(u){var h=abs(String(u));if(h&&(h.indexOf('http://')===0||h.indexOf('https://')===0)){parent.postMessage({__museBrowser:'open',url:h},'*');}}}catch(e){}return null;};" +
"document.addEventListener('submit',function(e){" +
"var f=e.target;var method=(f.method||'GET').toUpperCase();" +
"e.preventDefault();" +
"try{var spw=f.querySelector?f.querySelector('input[type=\"password\"]'):null;if(spw)reportCred(spw);}catch(err){}" +
"var url=new URL(f.action||document.baseURI,document.baseURI);" +
"if(method==='GET'){new FormData(f).forEach(function(v,k){if(typeof v==='string')url.searchParams.set(k,v);});parent.postMessage({__museBrowser:'nav',url:url.href},'*');return;}" +
// POST submits are real jumps too: the fields are serialized
// urlencoded (file inputs cannot cross — their names are
// sent empty) and the shell replays the submit through the
// server fetch, rendering the result in the same tab.
"var params=new URLSearchParams();new FormData(f).forEach(function(v,k){params.append(k,typeof v==='string'?v:'');});" +
"parent.postMessage({__museBrowser:'formpost',url:url.href,body:params.toString()},'*');" +
"},true);" +
// ---- media: detection, state reports, shell commands ----
"var mediaEl=null,wantPlay=false,bgKeep=true,lastKey='',lastSent=0;" +
"function pickMedia(){var vids=document.querySelectorAll('video');for(var i=0;i<vids.length;i++){var v=vids[i];if(v.currentSrc||v.getAttribute('src')||v.querySelector('source'))return v;}if(vids.length)return vids[0];var auds=document.querySelectorAll('audio');for(var j=0;j<auds.length;j++){var a=auds[j];if(a.currentSrc||a.getAttribute('src'))return a;}return auds.length?auds[0]:null;}" +
"function mediaState(){if(!mediaEl)return{hasMedia:false};var d=mediaEl.duration;return{hasMedia:true,isVideo:mediaEl.tagName==='VIDEO',playing:!mediaEl.paused&&!mediaEl.ended,currentTime:mediaEl.currentTime||0,duration:(typeof d==='number'&&isFinite(d))?d:0,volume:mediaEl.volume,muted:!!mediaEl.muted,rate:mediaEl.playbackRate||1,src:mediaEl.currentSrc||''};}" +
"function sendMedia(force){var s=mediaState();var key=[s.hasMedia,s.playing,Math.round(s.currentTime||0),Math.round(s.duration||0),s.muted,s.volume,s.rate].join('|');var now=Date.now();if(!force&&key===lastKey&&now-lastSent<900)return;lastKey=key;lastSent=now;parent.postMessage({__museBrowser:'media',state:s},'*');vbDraw();}" +
"function bindMedia(el){if(mediaEl===el)return;mediaEl=el;if(!el){sendMedia(true);return;}try{el.setAttribute('playsinline','');el.setAttribute('webkit-playsinline','');}catch(e){}" +
"['play','pause','ended','loadedmetadata','durationchange','volumechange','ratechange','seeked'].forEach(function(ev){el.addEventListener(ev,function(){if(ev==='play')wantPlay=true;if(ev==='pause'&&!bgKeep)wantPlay=false;sendMedia(true);});});" +
"el.addEventListener('timeupdate',function(){sendMedia(false);});" +
"try{if('mediaSession' in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:document.title||'网页媒体'});navigator.mediaSession.setActionHandler('play',function(){el.play();});navigator.mediaSession.setActionHandler('pause',function(){el.pause();});navigator.mediaSession.setActionHandler('seekbackward',function(){try{el.currentTime=Math.max(0,el.currentTime-10);}catch(e){}});navigator.mediaSession.setActionHandler('seekforward',function(){try{el.currentTime=Math.min(el.duration||0,el.currentTime+10);}catch(e){}});}}catch(e){}" +
"sendMedia(true);vbBind();}" +
"function scanMedia(){bindMedia(pickMedia());}" +
// ---- in-page media control bar: the media buttons live ON
// the playing video's own frame (an overlay glued to the
// video element inside the page), never in the browser
// chrome. Play/pause, seek, time, mute, rate, download,
// picture-in-picture, fullscreen and the background-play
// toggle all sit on this bar; it fades out while playing
// and comes back on any touch/hover over the video.
"var vbar=null,vbHideTimer=null,vbSeeking=false;" +
"var VB_PLAY=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='currentColor'><path d='M8 5.5v13l11-6.5z'/></svg>\";" +
"var VB_PAUSE=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='currentColor'><rect x='6' y='5' width='4' height='14' rx='1'/><rect x='14' y='5' width='4' height='14' rx='1'/></svg>\";" +
"var VB_VOL=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 5L6 9H3v6h3l5 4z' fill='currentColor' stroke='none'/><path d='M15.5 8.5a5 5 0 0 1 0 7'/><path d='M18.5 5.5a9.4 9.4 0 0 1 0 13'/></svg>\";" +
"var VB_VOLOFF=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 5L6 9H3v6h3l5 4z' fill='currentColor' stroke='none'/><path d='M16 9l6 6M22 9l-6 6'/></svg>\";" +
"var VB_DL=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 4v11m0 0l-4-4m4 4l4-4'/><path d='M5 20h14'/></svg>\";" +
"var VB_PIP=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><rect x='3' y='5' width='18' height='14' rx='2'/><rect x='12.5' y='11.5' width='6' height='4.5' rx='1' fill='currentColor' stroke='none'/></svg>\";" +
"var VB_FS=\"<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/></svg>\";" +
"function vbFmt(s){if(typeof s!=='number'||!isFinite(s)||s<0)s=0;s=Math.floor(s);var m=Math.floor(s/60),ss=s%60,h=Math.floor(m/60);return h>0?(h+':'+('0'+(m%60)).slice(-2)+':'+('0'+ss).slice(-2)):(m+':'+('0'+ss).slice(-2));}" +
"function vbBuild(){if(vbar||!document.body)return;vbar=document.createElement('div');vbar.id='__muse_vbar';" +
"vbar.style.cssText='position:fixed;z-index:2147483647;display:none;align-items:center;gap:3px;padding:5px 6px;background:rgba(17,17,19,0.86);border-radius:10px;color:#fff;font-family:-apple-system,system-ui,sans-serif;box-sizing:border-box;box-shadow:0 4px 16px rgba(0,0,0,0.35);opacity:0;pointer-events:none;transition:opacity .18s ease;';" +
"vbar.innerHTML='<button type=button data-act=play aria-label=\"播放或暂停\"></button><input data-act=seek type=range min=0 max=1000 value=0 aria-label=\"播放进度\" style=\"flex:1;min-width:36px;height:26px;accent-color:#2f6bff;margin:0;\"><span data-role=time style=\"font-size:11px;white-space:nowrap;padding:0 1px;\">0:00 / 0:00</span><button type=button data-act=mute aria-label=\"静音\"></button><button type=button data-act=rate aria-label=\"播放速度\">1×</button><button type=button data-act=dl aria-label=\"下载视频\"></button><button type=button data-act=pip aria-label=\"画中画\"></button><button type=button data-act=fs aria-label=\"全屏\"></button><button type=button data-act=bg aria-label=\"后台播放\"></button>';" +
"var bs=vbar.querySelectorAll('button');for(var i=0;i<bs.length;i++){var b=bs[i];var act=b.getAttribute('data-act');b.style.cssText='display:flex;align-items:center;justify-content:center;height:30px;border:0;background:rgba(255,255,255,0.08);color:#fff;border-radius:7px;padding:0;cursor:pointer;flex:none;'+((act==='rate'||act==='bg')?'width:auto;padding:0 7px;font-size:11px;':'width:30px;');}" +
"vbar.querySelector('button[data-act=dl]').innerHTML=VB_DL;vbar.querySelector('button[data-act=pip]').innerHTML=VB_PIP;vbar.querySelector('button[data-act=fs]').innerHTML=VB_FS;" +
"document.body.appendChild(vbar);" +
"vbar.addEventListener('pointerdown',function(e){e.stopPropagation();vbShow();});" +
"vbar.addEventListener('click',function(e){e.stopPropagation();var b=e.target&&e.target.closest?e.target.closest('button'):null;if(!b)return;vbAct(b.getAttribute('data-act'));});" +
"var sk=vbar.querySelector('input[data-act=seek]');sk.addEventListener('pointerdown',function(e){e.stopPropagation();});" +
"sk.addEventListener('input',function(){if(!mediaEl)return;vbSeeking=true;var d=mediaEl.duration;if(isFinite(d)&&d>0){try{mediaEl.currentTime=(Number(sk.value)/1000)*d;}catch(err){}}});" +
"sk.addEventListener('change',function(){vbSeeking=false;sendMedia(true);});}" +
"function vbAct(act){if(!mediaEl)return;try{" +
"if(act==='play'){if(mediaEl.paused||mediaEl.ended){wantPlay=true;var pr=mediaEl.play();if(pr&&pr.catch)pr.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'播放被页面或浏览器拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}else{wantPlay=false;mediaEl.pause();}}" +
"else if(act==='mute'){mediaEl.muted=!mediaEl.muted;}" +
"else if(act==='rate'){var rs=[1,1.25,1.5,2,0.5];var ri=rs.indexOf(mediaEl.playbackRate);mediaEl.playbackRate=rs[(ri+1)%rs.length];}" +
"else if(act==='dl'){var src=mediaEl.currentSrc||'';if(!src||src.indexOf('blob:')===0){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'这个视频是流式分片播放，没有单个视频文件可以下载'},'*');}else if(/\\.m3u8(\\?|#|$)/i.test(src)){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'这个视频是 m3u8 流媒体，没有单个视频文件可以下载'},'*');}else{parent.postMessage({__museBrowser:'download',url:src},'*');}}" +
"else if(act==='pip'){if(document.pictureInPictureElement){document.exitPictureInPicture();}else if(mediaEl.requestPictureInPicture){var pp=mediaEl.requestPictureInPicture();if(pp&&pp.catch)pp.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'画中画被拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}else{parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'当前环境不支持画中画'},'*');}}" +
"else if(act==='fs'){if(mediaEl.requestFullscreen){var fp=mediaEl.requestFullscreen();if(fp&&fp.catch)fp.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'全屏被拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}else if(mediaEl.webkitEnterFullscreen){mediaEl.webkitEnterFullscreen();}else{parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'当前环境不支持全屏'},'*');}}" +
"else if(act==='bg'){parent.postMessage({__museBrowser:'bgToggle'},'*');}" +
"sendMedia(true);vbShow();}catch(err){}}" +
"function vbPos(){if(!vbar||!mediaEl||mediaEl.tagName!=='VIDEO')return;var r=mediaEl.getBoundingClientRect();if(r.width<140||r.height<60||r.bottom<0||r.top>window.innerHeight){vbar.style.display='none';return;}vbar.style.display='flex';var lx=Math.max(2,r.left+8);vbar.style.left=lx+'px';vbar.style.width=Math.max(120,Math.min(r.width-16,window.innerWidth-lx-2))+'px';vbar.style.bottom=Math.max(2,window.innerHeight-r.bottom+8)+'px';}" +
"function vbDraw(){if(!vbar)return;if(!mediaEl||mediaEl.tagName!=='VIDEO'){vbar.style.display='none';return;}" +
"var pb=vbar.querySelector('button[data-act=play]');if(pb)pb.innerHTML=(mediaEl.paused||mediaEl.ended)?VB_PLAY:VB_PAUSE;" +
"var mb=vbar.querySelector('button[data-act=mute]');if(mb)mb.innerHTML=(mediaEl.muted||mediaEl.volume===0)?VB_VOLOFF:VB_VOL;" +
"var rb=vbar.querySelector('button[data-act=rate]');if(rb)rb.textContent=(mediaEl.playbackRate||1)+'×';" +
"var bg=vbar.querySelector('button[data-act=bg]');if(bg){bg.textContent=bgKeep?'后台开':'后台关';bg.style.background=bgKeep?'rgba(52,199,89,0.4)':'rgba(255,255,255,0.08)';}" +
"var tm=vbar.querySelector('span[data-role=time]');if(tm)tm.textContent=vbFmt(mediaEl.currentTime)+' / '+vbFmt(mediaEl.duration);" +
"if(!vbSeeking){var sk2=vbar.querySelector('input[data-act=seek]');var dd=mediaEl.duration;if(sk2)sk2.value=(isFinite(dd)&&dd>0)?String(Math.round((mediaEl.currentTime/dd)*1000)):'0';}" +
"vbPos();}" +
"function vbShow(){if(!vbar||!mediaEl||mediaEl.tagName!=='VIDEO')return;vbPos();if(vbar.style.display==='none')return;vbar.style.opacity='1';vbar.style.pointerEvents='auto';if(vbHideTimer)clearTimeout(vbHideTimer);if(!mediaEl.paused){vbHideTimer=setTimeout(vbHide,2600);}}" +
"function vbHide(){if(!vbar)return;if(mediaEl&&!mediaEl.paused){vbar.style.opacity='0';vbar.style.pointerEvents='none';}}" +
"function vbBind(){if(!mediaEl||mediaEl.tagName!=='VIDEO'){if(vbar)vbar.style.display='none';return;}vbBuild();if(!vbar)return;if(!mediaEl.__vbBound){mediaEl.__vbBound=true;mediaEl.addEventListener('pointerdown',function(){vbShow();});mediaEl.addEventListener('mousemove',function(){vbShow();});mediaEl.addEventListener('play',function(){vbShow();});mediaEl.addEventListener('pause',function(){vbShow();});}vbDraw();vbShow();}" +
"document.addEventListener('scroll',function(){vbPos();},true);" +
"window.addEventListener('resize',function(){vbPos();});" +
"document.addEventListener('fullscreenchange',function(){vbPos();});" +
// ---- pinch forwarding: while the shell's 双指缩放 gesture
// is on, a two-finger pinch performed over the page itself
// is reported to the shell (the frame swallows touches, so
// the shell's own handlers never see them); the shell zooms
// the whole browser pane with the reported ratio.
"var pinchOn=false,pinchStart=0,pinchEngaged=false,pinchLast=1;" +
"function pinchDist(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}" +
"document.addEventListener('touchstart',function(e){if(!pinchOn||e.touches.length!==2)return;pinchStart=pinchDist(e.touches);pinchEngaged=false;pinchLast=1;parent.postMessage({__museBrowser:'pinch',phase:'start'},'*');},{passive:true});" +
"document.addEventListener('touchmove',function(e){if(!pinchOn||e.touches.length!==2||pinchStart<=0)return;var d=pinchDist(e.touches);if(!pinchEngaged&&Math.abs(d-pinchStart)<6)return;pinchEngaged=true;e.preventDefault();var r=d/pinchStart;if(Math.abs(r-pinchLast)>0.004){pinchLast=r;parent.postMessage({__museBrowser:'pinch',phase:'move',ratio:r},'*');}},{passive:false});" +
"function pinchEndH(e){if(e.touches.length<2){if(pinchEngaged){parent.postMessage({__museBrowser:'pinch',phase:'end',ratio:pinchLast},'*');}pinchStart=0;pinchEngaged=false;}}" +
"document.addEventListener('touchend',pinchEndH);" +
"document.addEventListener('touchcancel',pinchEndH);" +
"if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',scanMedia);}else{scanMedia();}" +
"try{new MutationObserver(function(){scanMedia();}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
"setInterval(function(){if(mediaEl){sendMedia(false);vbPos();}},2000);" +
"document.addEventListener('visibilitychange',function(){if(document.hidden&&bgKeep&&wantPlay&&mediaEl&&mediaEl.paused){var p=mediaEl.play();if(p&&p.catch)p.catch(function(){});}});" +
// ---- credentials: report typed logins, accept fill commands ----
"var credTimer=null,lastCred='';" +
"function findUserField(pw){var scope=pw.form||document;var inputs=scope.querySelectorAll('input');var best=null;for(var i=0;i<inputs.length;i++){var inp=inputs[i];if(inp===pw)continue;var t=(inp.type||'text').toLowerCase();if(t==='text'||t==='email'||t==='tel'){var ac=(inp.getAttribute('autocomplete')||'').toLowerCase();if(ac.indexOf('user')>=0||ac.indexOf('email')>=0)return inp;if(!best)best=inp;}}return best;}" +
"function reportCred(pw){if(!pw||!pw.value)return;var uf=findUserField(pw);var user=uf?uf.value:'';var key=user+'\\n'+pw.value;if(key===lastCred)return;lastCred=key;parent.postMessage({__museBrowser:'credential',username:user,password:pw.value,url:document.baseURI},'*');}" +
"document.addEventListener('focusout',function(e){var t=e.target;if(t&&t.tagName==='INPUT'&&(t.type||'').toLowerCase()==='password')reportCred(t);},true);" +
"document.addEventListener('input',function(e){var t=e.target;if(!t||t.tagName!=='INPUT'||(t.type||'').toLowerCase()!=='password')return;if(credTimer)clearTimeout(credTimer);credTimer=setTimeout(function(){reportCred(t);},1600);},true);" +
// ---- video-only mode （仅视频）: keep text + video, hide the rest ----
"var voOn=false,voHidden=[],voObserver=null,voStyle=null,voOrigOpen=window.open;" +
"var voPat=/(^|[-_\\s])(ad|ads|advert|advertisement|popup|pop|banner|widget|promo|sponsor|cookie|subscribe|newsletter)([-_\\s]|$)/i;" +
"function voHide(el){for(var i=0;i<voHidden.length;i++){if(voHidden[i].el===el)return;}voHidden.push({el:el,prev:el.style.getPropertyValue('display'),prio:el.style.getPropertyPriority('display')});el.style.setProperty('display','none','important');}" +
"function voHasVideo(el){return el.tagName==='VIDEO'||!!el.querySelector('video');}" +
"function voSweep(){if(!voOn)return;var all=document.querySelectorAll('[class],[id]');for(var i=0;i<all.length;i++){var el=all[i];var tag=(el.className&&typeof el.className==='string'?el.className:'')+' '+(el.id||'');if(voPat.test(tag)&&!voHasVideo(el))voHide(el);}var bodyEls=document.body?document.body.querySelectorAll('*'):[];for(var j=0;j<bodyEls.length;j++){var e2=bodyEls[j];try{var pos=getComputedStyle(e2).position;if((pos==='fixed')&&!voHasVideo(e2)&&e2!==mediaEl&&e2.id!=='__muse_vbar')voHide(e2);}catch(err){}}}" +
"function voApply(){if(voOn)return;voOn=true;voStyle=document.createElement('style');voStyle.id='__muse_vo_style';voStyle.textContent='img,picture,svg,canvas,iframe,embed,object{display:none!important}*{-webkit-background-image:none!important;background-image:none!important}video{display:block!important;visibility:visible!important}';" +
"(document.head||document.documentElement).appendChild(voStyle);window.open=function(){return null;};" +
"voSweep();try{voObserver=new MutationObserver(function(){voSweep();});voObserver.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}}" +
"function voRemove(){if(!voOn)return;voOn=false;if(voStyle){voStyle.remove();voStyle=null;}for(var i=0;i<voHidden.length;i++){var h=voHidden[i];try{if(h.prev){h.el.style.setProperty('display',h.prev,h.prio||'');}else{h.el.style.removeProperty('display');}}catch(e){}}voHidden=[];if(voObserver){voObserver.disconnect();voObserver=null;}window.open=voOrigOpen;}" +
"window.addEventListener('message',function(e){var d=e.data;if(!d||typeof d!=='object')return;" +
"if(d.__museBrowserCmd==='videoOnly'){if(d.enabled){voApply();}else{voRemove();}return;}" +
"if(d.__museBrowserCmd==='fill'){var pws=document.querySelectorAll('input[type=\"password\"]');if(!pws.length){parent.postMessage({__museBrowser:'fillResult',ok:false,reason:'这个页面没有密码输入框'},'*');return;}var pw=pws[0];var uf=findUserField(pw);function setVal(el,val){if(!el||typeof val!=='string'||!val)return;try{var proto=Object.getPrototypeOf(el);var setter=Object.getOwnPropertyDescriptor(proto,'value');if(setter&&setter.set){setter.set.call(el,val);}else{el.value=val;}}catch(err){el.value=val;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}if(uf&&d.username)setVal(uf,d.username);setVal(pw,d.password||'');parent.postMessage({__museBrowser:'fillResult',ok:true,reason:''},'*');return;}" +
"if(d.__museBrowserCmd==='setBackground'){bgKeep=!!d.enabled;vbDraw();return;}" +
"if(d.__museBrowserCmd==='pinchZoom'){pinchOn=!!d.enabled;return;}" +
"if(d.__museBrowserCmd==='capture'){capOn=!!d.enabled;if(capOn)capStart();return;}" +
"if(d.__museBrowserCmd==='geo'){geoOn=!!d.enabled&&typeof d.lat==='number'&&typeof d.lon==='number';if(geoOn){geoLat=d.lat;geoLon=d.lon;geoNotify();}return;}" +
"if(d.__museBrowserCmd==='media'){if(!mediaEl)scanMedia();if(!mediaEl){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'页面里还没有可控制的媒体'},'*');return;}var act=d.action;try{" +
"if(act==='play'){wantPlay=true;var pr=mediaEl.play();if(pr&&pr.catch)pr.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'播放被页面或浏览器拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}" +
"else if(act==='pause'){wantPlay=false;mediaEl.pause();}" +
"else if(act==='seek'&&typeof d.value==='number'){mediaEl.currentTime=d.value;}" +
"else if(act==='volume'&&typeof d.value==='number'){mediaEl.volume=Math.min(1,Math.max(0,d.value));mediaEl.muted=false;}" +
"else if(act==='mute'){mediaEl.muted=!mediaEl.muted;}" +
"else if(act==='rate'&&typeof d.value==='number'){mediaEl.playbackRate=d.value;}" +
"else if(act==='pip'){if(mediaEl.tagName!=='VIDEO'){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'只有视频可以画中画'},'*');}else if(document.pictureInPictureElement){document.exitPictureInPicture();}else if(mediaEl.requestPictureInPicture){var pp=mediaEl.requestPictureInPicture();if(pp&&pp.catch)pp.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'画中画被拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}else{parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'当前环境不支持画中画'},'*');}}" +
"else if(act==='fullscreen'){if(mediaEl.requestFullscreen){var fp=mediaEl.requestFullscreen();if(fp&&fp.catch)fp.catch(function(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'全屏被拒绝'+(err&&err.message?('：'+err.message):'')},'*');});}else if(mediaEl.webkitEnterFullscreen){mediaEl.webkitEnterFullscreen();}else{parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:'当前环境不支持全屏'},'*');}}" +
"sendMedia(true);}catch(err){parent.postMessage({__museBrowser:'mediaResult',ok:false,reason:String(err&&err.message?err.message:err)},'*');}}" +
"});" +
"var capOn=false,capSeq=0,capStarted=false,capSeen={};" +
"function capTrunc(s,n){s=String(s==null?'':s);return s.length>n?s.slice(0,n):s;}" +
"function capHdrObj(h){var o=[];try{h.forEach(function(v,k){o.push({name:k,value:capTrunc(v,500)});});}catch(e){}return o;}" +
"function capPost(e){try{parent.postMessage({__museBrowser:'capture',entry:e},'*');}catch(err){}}" +
"function capUpd(id,patch){try{parent.postMessage({__museBrowser:'captureUpdate',id:id,patch:patch},'*');}catch(err){}}" +
"function capType(ct){ct=(ct||'').toLowerCase();if(ct.indexOf('text/html')===0)return 'document';if(ct.indexOf('javascript')>=0||ct.indexOf('ecmascript')>=0)return 'script';if(ct.indexOf('text/css')===0)return 'stylesheet';if(ct.indexOf('image/')===0)return 'image';if(ct.indexOf('video/')===0||ct.indexOf('audio/')===0)return 'media';if(ct.indexOf('font')>=0||ct.indexOf('woff')>=0)return 'font';if(ct.indexOf('json')>=0)return 'xhr';return 'other';}" +
"function capStart(){if(capStarted)return;capStarted=true;" +
"if(window.fetch){var of=window.fetch;window.fetch=function(input,init){var url='',method='GET',rh=[],rb='';try{url=typeof input==='string'?input:(input&&input.url)||'';method=(init&&init.method)||(input&&input.method)||'GET';if(init&&typeof init.body==='string')rb=init.body;if(init&&init.headers){try{new Headers(init.headers).forEach(function(v,k){rh.push({name:k,value:capTrunc(v,500)});});}catch(e){}}}catch(e){}" +
"var cid='p'+(++capSeq)+'-'+Date.now();var t0=performance.now();if(capOn)capPost({cid:cid,ts:Date.now(),method:String(method).toUpperCase(),url:abs(url)||url,type:'fetch',status:null,size:null,durationMs:null,requestHeaders:rh,responseHeaders:[],requestBody:capTrunc(rb,32768),responseBody:'',timings:null,error:''});" +
"return of.apply(this,arguments).then(function(res){try{var dur=Math.round(performance.now()-t0);var ct='';try{ct=res.headers.get('content-type')||'';}catch(e){}var cl=null;try{cl=res.headers.get('content-length');}catch(e){}capUpd(cid,{status:res.status,durationMs:dur,responseHeaders:capHdrObj(res.headers),type:capType(ct),size:cl?parseInt(cl,10):null});if(/json|text|xml|javascript/.test(ct)){res.clone().text().then(function(tx){capUpd(cid,{responseBody:capTrunc(tx,32768),size:new Blob([tx]).size});},function(){});}}catch(e){}return res;},function(err){try{capUpd(cid,{status:0,durationMs:Math.round(performance.now()-t0),error:String(err&&err.message?err.message:err)});}catch(e){}throw err;});};}" +
"var OX=window.XMLHttpRequest;if(OX&&!OX.__museCap){var oo=OX.prototype.open,os=OX.prototype.send,osh=OX.prototype.setRequestHeader;" +
"OX.prototype.open=function(m,u){this.__cap={m:String(m||'GET').toUpperCase(),u:abs(u)||String(u||''),h:[],rb:'',t0:0,id:'p'+(++capSeq)+'-'+Date.now()};return oo.apply(this,arguments);};" +
"OX.prototype.setRequestHeader=function(k,v){try{if(this.__cap)this.__cap.h.push({name:k,value:capTrunc(v,500)});}catch(e){}return osh.apply(this,arguments);};" +
"OX.prototype.send=function(body){var x=this,c=x.__cap;if(c){c.t0=performance.now();if(typeof body==='string')c.rb=body;if(capOn)capPost({cid:c.id,ts:Date.now(),method:c.m,url:c.u,type:'xhr',status:null,size:null,durationMs:null,requestHeaders:c.h,responseHeaders:[],requestBody:capTrunc(c.rb,32768),responseBody:'',timings:null,error:''});" +
"x.addEventListener('load',function(){try{var hd=[];var raw=x.getAllResponseHeaders()||'';raw.trim().split(/[\\r\\n]+/).forEach(function(line){var i=line.indexOf(':');if(i>0)hd.push({name:line.slice(0,i).trim(),value:capTrunc(line.slice(i+1),500)});});var patch={status:x.status,durationMs:Math.round(performance.now()-c.t0),responseHeaders:hd,type:capType(x.getResponseHeader('content-type')||'')};try{if(x.responseType===''||x.responseType==='text'){patch.responseBody=capTrunc(x.responseText||'',32768);patch.size=new Blob([x.responseText||'']).size;}}catch(err){}capUpd(c.id,patch);}catch(err){}});" +
"x.addEventListener('error',function(){capUpd(c.id,{status:0,durationMs:Math.round(performance.now()-c.t0),error:'网络错误'});});" +
"x.addEventListener('abort',function(){capUpd(c.id,{status:0,durationMs:Math.round(performance.now()-c.t0),error:'已取消'});});}" +
"return os.apply(this,arguments);};OX.__museCap=true;}" +
"var OW=window.WebSocket;if(OW&&!OW.__museCap){var NW=function(u,p){var ws=p?new OW(u,p):new OW(u);var id='p'+(++capSeq)+'-'+Date.now();var frames=[];var t0=Date.now();if(capOn)capPost({cid:id,ts:t0,method:'WS',url:String(u),type:'websocket',status:null,size:null,durationMs:null,requestHeaders:[],responseHeaders:[],requestBody:'',responseBody:'',timings:null,error:'',frames:[]});" +
"var osend=ws.send.bind(ws);ws.send=function(d){try{var s=typeof d==='string'?d:'[binary '+((d&&d.byteLength)||(d&&d.size)||0)+' B]';frames.push({dir:'out',ts:Date.now(),size:typeof d==='string'?new Blob([d]).size:((d&&d.byteLength)||0),preview:capTrunc(s,2000)});if(frames.length>100)frames.shift();capUpd(id,{frames:frames.slice(),size:frames.reduce(function(a,f){return a+f.size;},0)});}catch(e){}return osend(d);};" +
"ws.addEventListener('message',function(ev){try{var d=ev.data;var s=typeof d==='string'?d:'[binary '+((d&&d.byteLength)||(d&&d.size)||0)+' B]';frames.push({dir:'in',ts:Date.now(),size:typeof d==='string'?new Blob([d]).size:((d&&d.byteLength)||0),preview:capTrunc(s,2000)});if(frames.length>100)frames.shift();capUpd(id,{frames:frames.slice(),status:101,size:frames.reduce(function(a,f){return a+f.size;},0)});}catch(e){}});" +
"ws.addEventListener('open',function(){capUpd(id,{status:101});});" +
"ws.addEventListener('close',function(ev){capUpd(id,{durationMs:Date.now()-t0,error:ev&&ev.code?('close '+ev.code):''});});" +
"return ws;};NW.prototype=OW.prototype;NW.CONNECTING=OW.CONNECTING;NW.OPEN=OW.OPEN;NW.CLOSING=OW.CLOSING;NW.CLOSED=OW.CLOSED;NW.__museCap=true;window.WebSocket=NW;}" +
"try{var po=new PerformanceObserver(function(list){list.getEntries().forEach(function(en){try{if(!capOn)return;var it=en.initiatorType||'';if(it==='fetch'||it==='xmlhttprequest')return;var key=en.name+'|'+Math.round(en.startTime);if(capSeen[key])return;capSeen[key]=1;var tm=null;if(en.domainLookupEnd||en.connectEnd||en.responseStart){tm={dnsMs:en.domainLookupStart!=null&&en.domainLookupEnd?Math.max(0,Math.round(en.domainLookupEnd-en.domainLookupStart)):null,connectMs:en.connectStart!=null&&en.connectEnd?Math.max(0,Math.round(en.connectEnd-en.connectStart)):null,tlsMs:en.secureConnectionStart?Math.max(0,Math.round(en.connectEnd-en.secureConnectionStart)):null,waitMs:en.requestStart!=null&&en.responseStart?Math.max(0,Math.round(en.responseStart-en.requestStart)):null,receiveMs:en.responseEnd&&en.responseStart?Math.max(0,Math.round(en.responseEnd-en.responseStart)):null};}" +
"var tp=it==='img'?'image':it==='css'?'stylesheet':it==='script'?'script':it==='link'?'stylesheet':it==='video'||it==='audio'?'media':it==='iframe'||it==='subdocument'?'document':'other';" +
"capPost({cid:'p'+(++capSeq)+'-'+Date.now(),ts:Math.round(performance.timeOrigin+en.startTime),method:'GET',url:en.name,type:tp,status:null,size:en.transferSize||en.encodedBodySize||null,durationMs:Math.round(en.duration),requestHeaders:[],responseHeaders:[],requestBody:'',responseBody:'',timings:tm,error:''});}catch(err){}});});po.observe({entryTypes:['resource']});}catch(e){}" +
"}" +
"var geoOn=false,geoLat=0,geoLon=0,geoWatchers={},geoWatchSeq=0;" +
"function geoPos(){return {coords:{latitude:geoLat,longitude:geoLon,accuracy:30,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()};}" +
"function geoNotify(){for(var gid in geoWatchers){try{geoWatchers[gid](geoPos());}catch(e){}}}" +
"try{if(navigator.geolocation){var ogcp=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);var ogwp=navigator.geolocation.watchPosition.bind(navigator.geolocation);var ogcw=navigator.geolocation.clearWatch.bind(navigator.geolocation);" +
"navigator.geolocation.getCurrentPosition=function(ok,err,opts){if(geoOn){if(ok)setTimeout(function(){try{ok(geoPos());}catch(e){}},0);return;}return ogcp(ok,err,opts);};" +
"navigator.geolocation.watchPosition=function(ok,err,opts){if(geoOn){var wid=++geoWatchSeq;geoWatchers[wid]=ok;if(ok)setTimeout(function(){try{ok(geoPos());}catch(e){}},0);return wid;}return ogwp(ok,err,opts);};" +
"navigator.geolocation.clearWatch=function(wid){if(geoWatchers[wid]){delete geoWatchers[wid];return;}return ogcw(wid);};}}catch(e){}" +
"})();</script>";
// The head bootstrap goes in with the <base> tag, ahead of
// every script of the page itself: it shims Web Storage and
// document.cookie from the server-side jar/storage rows and
// relays the page's fetch/XHR through the shell, which is
// what lets modern (API-driven, login-gated) sites boot and
// stay logged in inside the space at all.
const pageCookies = await browserPageCookieString(ctx, finalUrl);
const pageStorage = await loadBrowserPageStorage(ctx, finalUrl);
const bootstrap = browserBootstrapScript(finalUrl, pageCookies, pageStorage, deviceProfile);
const baseTag = `<base href="${finalUrl.replace(/"/g, "&quot;")}">`;
if (/<head[^>]*>/i.test(html)) {
html = html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}${bootstrap}`);
} else if (/<html[^>]*>/i.test(html)) {
html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}${bootstrap}</head>`);
} else {
html = `<head>${baseTag}${bootstrap}</head>${html}`;
}
if (/<\/body>/i.test(html)) {
html = html.replace(/<\/body>/i, `${interceptor}${refreshScript}</body>`);
} else {
html = `${html}${interceptor}${refreshScript}`;
}
await recordBrowserCapture(ctx, {
...captureBase,
status: r.status,
size: base64ByteLength(r.bodyBase64),
contentType: r.contentType,
resBody: captureResBody,
});
return {
ok: true,
status: r.status,
finalUrl,
title,
html,
contentType: r.contentType,
isHtml: true,
truncated: r.truncated,
error: "",
plainText: "",
textLinks: [],
textMode: false,
};
},
}),

recordBrowserVisit: defineAction({
description:
  "Records one page visit in the in-space browser's history (pruned to the newest 500). Consecutive visits to the same URL update the existing row's title and time instead of piling up duplicates.",
request: z.object({
url: z.string().trim().min(1).max(4000),
title: z.string().trim().max(300).default(""),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const existing = await db
.select()
.from(schema.browserHistory)
.orderBy(desc(schema.browserHistory.id))
.limit(1);
const last = existing[0];
if (last && last.url === args.url) {
await db
.update(schema.browserHistory)
.set({ title: args.title || last.title, visitedAt: new Date() })
.where(eq(schema.browserHistory.id, last.id));
} else {
await db
.insert(schema.browserHistory)
.values({ url: args.url, title: args.title });
const rows = await db
.select({ id: schema.browserHistory.id })
.from(schema.browserHistory)
.orderBy(desc(schema.browserHistory.id))
.limit(501);
const cutoff = rows[500];
if (cutoff) {
await db
.delete(schema.browserHistory)
.where(lt(schema.browserHistory.id, cutoff.id));
}
}
return { ok: true };
},
}),

listBrowserHistory: defineAction({
description: "Lists the in-space browser's history, newest first (up to 200).",
request: z.object({}),
response: z.object({
items: z.array(
z.object({
id: z.number(),
url: z.string(),
title: z.string(),
visitedAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.browserHistory)
.orderBy(desc(schema.browserHistory.id))
.limit(200);
return {
items: rows.map((r) => ({
id: r.id,
url: r.url,
title: r.title,
visitedAt: r.visitedAt.toISOString(),
})),
};
},
}),

clearBrowserHistory: defineAction({
description: "Clears the in-space browser's whole history.",
request: z.object({}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db.delete(schema.browserHistory);
return { ok: true };
},
}),

listBrowserBookmarks: defineAction({
description: "Lists the in-space browser's bookmarks （收藏夹）, newest first.",
request: z.object({}),
response: z.object({
items: z.array(
z.object({
id: z.number(),
url: z.string(),
title: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.browserBookmarks)
.orderBy(desc(schema.browserBookmarks.id));
return {
items: rows.map((r) => ({
id: r.id,
url: r.url,
title: r.title,
createdAt: r.createdAt.toISOString(),
})),
};
},
}),

toggleBrowserBookmark: defineAction({
description:
  "Toggles one URL in the in-space browser's bookmarks: bookmarked when absent, removed when present. Returns the resulting state.",
request: z.object({
url: z.string().trim().min(1).max(4000),
title: z.string().trim().max(300).default(""),
}),
response: z.object({ bookmarked: z.boolean() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.browserBookmarks)
.where(eq(schema.browserBookmarks.url, args.url));
const existing = rows[0];
if (existing) {
await db
.delete(schema.browserBookmarks)
.where(eq(schema.browserBookmarks.id, existing.id));
return { bookmarked: false };
}
await db
.insert(schema.browserBookmarks)
.values({ url: args.url, title: args.title });
return { bookmarked: true };
},
}),

downloadBrowserFile: defineAction({
description:
  "Downloads one file for the in-space browser: fetched server-side (24MB cap), logged in the browser's download list, and returned as base64 so the client can save it to the device. Failures return the real reason; nothing is ever handed off to an external browser.",
request: z.object({
url: z.string().trim().min(1).max(4000),
// The browser pane's capture id, as in fetchBrowserPage:
// when present, this download is recorded for the 抓包 panel.
capId: z.string().trim().max(120).default(""),
}),
response: z.object({
ok: z.boolean(),
name: z.string(),
mime: z.string(),
size: z.number(),
dataBase64: z.string(),
error: z.string(),
}),
privileged: [privileged.fetchWebPage],
handler: async (ctx, args) => {
const fail = (error: string) => ({
ok: false,
name: "",
mime: "",
size: 0,
dataBase64: "",
error,
});
let parsed: URL;
try {
parsed = new URL(args.url);
} catch {
return fail("地址无效");
}
if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
return fail("只支持 http / https 地址");
}
const cookieJar = await loadBrowserCookieJar(ctx);
const compat = await loadBrowserCompatSettings(ctx);
const deviceProfile = compat.profile;
const r = await ctx.executePrivileged(privileged.fetchWebPage, {
url: parsed.toString(),
maxBytes: 25165824,
timeoutMs: 45000,
method: "GET",
body: "",
bodyBase64: "",
contentType: "",
headers: [],
cookies: cookieJar,
userAgent: deviceProfile.ua,
secChUaMobile: deviceProfile.secChUaMobile,
secChUaPlatform: deviceProfile.secChUaPlatform,
    ignoreCertErrors: compat.ignoreCertErrors,
});
await persistBrowserSetCookies(ctx, r.setCookies ?? []);
await recordBrowserCapture(ctx, {
capId: args.capId,
method: "GET",
url: r.finalUrl || parsed.toString(),
kind: "download",
status: r.status,
size: base64ByteLength(r.bodyBase64),
durationMs: r.durationMs,
contentType: r.contentType,
reqHeaders: r.requestHeaders,
resHeaders: r.responseHeaders,
reqBody: "",
// A body preview only when the payload is text-shaped;
// binaries stay unpreviewed rather than mangled.
resBody: /^(text\/|application\/(json|xml|javascript|xhtml))/.test(
(r.contentType || "").toLowerCase(),
)
? (() => {
try {
const bin = atob(r.bodyBase64.slice(0, 87380));
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder("utf-8").decode(bytes).slice(0, 65536);
} catch {
return "";
}
})()
: "",
timings: r.timings,
});
if (!r.ok) return fail(r.error || "下载失败");
if (r.truncated) return fail("文件超过 24MB 上限，未下载");
let size = 0;
try {
size = atob(r.bodyBase64).length;
} catch {
size = 0;
}
let name = "";
try {
name = decodeURIComponent(
(parsed.pathname.split("/").pop() ?? "").trim(),
);
} catch {
name = (parsed.pathname.split("/").pop() ?? "").trim();
}
if (!name) name = "下载文件";
const db = ctx.db<typeof schema>();
await db.insert(schema.browserDownloads).values({
url: args.url,
name,
size,
});
ctx.invalidateQueries();
return {
ok: true,
name,
mime: r.contentType || "application/octet-stream",
size,
dataBase64: r.bodyBase64,
error: "",
};
},
}),

listBrowserDownloads: defineAction({
description: "Lists the in-space browser's download log, newest first (up to 200).",
request: z.object({}),
response: z.object({
items: z.array(
z.object({
id: z.number(),
url: z.string(),
name: z.string(),
size: z.number(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.browserDownloads)
.orderBy(desc(schema.browserDownloads.id))
.limit(200);
return {
items: rows.map((r) => ({
id: r.id,
url: r.url,
name: r.name,
size: r.size,
createdAt: r.createdAt.toISOString(),
})),
};
},
}),

deleteBrowserBookmark: defineAction({
description:
  "Removes one bookmark from the in-space browser's 收藏夹 by id — the direct delete the bookmarks list's per-row button calls (no need to open the page and un-star it).",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.browserBookmarks)
.where(eq(schema.browserBookmarks.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

deleteBrowserDownload: defineAction({
description:
  "Removes one entry from the in-space browser's download log by id (the file itself was already saved to the device when it downloaded; this deletes the record).",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.browserDownloads)
.where(eq(schema.browserDownloads.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

clearBrowserDownloads: defineAction({
description: "Clears the in-space browser's whole download log.",
request: z.object({}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db.delete(schema.browserDownloads);
ctx.invalidateQueries();
return { ok: true };
},
}),

fetchBrowserResource: defineAction({
description:
  "Runs one page-issued request (fetch / XMLHttpRequest from a page inside the in-space browser) server-side: the page's frame lives on an opaque origin, so its own network calls would be refused cross-origin and carry no cookies — the injected bootstrap relays them here instead. The request runs with the browser's server-side cookie jar (seeded before, Set-Cookie from every redirect hop persisted after), and the response (status, headers without set-cookie, body as base64, final URL after redirects) goes back to the page. Transport failures return ok=false with the real reason, which the page sees as a network error. Bodies are capped at 8MB.",
request: z.object({
url: z.string().trim().min(1).max(4000),
method: z
.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
.default("GET"),
headers: z
.array(z.tuple([z.string().max(200), z.string().max(8192)]))
.max(80)
.default([]),
body: z.string().max(262144).default(""),
bodyBase64: z.string().max(8388608).default(""),
capId: z.string().trim().max(120).default(""),
// The URL of the page issuing the request (the bootstrap
// reports its own PAGE_URL): a real browser stamps every
// fetch/XHR with that page as Referer (and its origin as
// Origin on non-GET), and risk-control gateways — 红果's
// included — refuse API calls that arrive with neither. The
// handler fills those two headers (plus the Sec-Fetch trio)
// from this value when the page did not set them itself.
pageUrl: z.string().trim().max(4000).default(""),
}),
response: z.object({
ok: z.boolean(),
status: z.number(),
statusText: z.string(),
headers: z.array(z.tuple([z.string(), z.string()])),
bodyBase64: z.string(),
finalUrl: z.string(),
redirected: z.boolean(),
error: z.string(),
}),
privileged: [privileged.fetchWebPage],
handler: async (ctx, args) => {
const fail = (error: string) => ({
ok: false,
status: 0,
statusText: "",
headers: [] as [string, string][],
bodyBase64: "",
finalUrl: args.url,
redirected: false,
error,
});
let parsed: URL;
try {
parsed = new URL(args.url);
} catch {
return fail("地址无效");
}
if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
return fail("只支持 http / https 地址");
}
const cookieJar = await loadBrowserCookieJar(ctx);
const compat = await loadBrowserCompatSettings(ctx);
const deviceProfile = compat.profile;
// Browser-stamped headers the page itself cannot set: a real
// Chrome attaches Referer (the page's URL), Origin (non-GET)
// and the Sec-Fetch trio to every fetch/XHR it runs. The
// relay used to send none of them, so API gateways that check
// request provenance (ByteDance's among them) saw a headless
// caller and refused — the page booted, its data calls died,
// and the app sat on its black splash. Fill them from the
// reported page URL, never overriding a header the page set.
const relayHeaders: [string, string][] = [...args.headers];
{
const hasHeader = (name: string) =>
relayHeaders.some(([n]) => n.toLowerCase() === name);
let page: URL | null = null;
try {
page = args.pageUrl ? new URL(args.pageUrl) : null;
} catch {
page = null;
}
if (page && (page.protocol === "http:" || page.protocol === "https:")) {
if (!hasHeader("referer")) relayHeaders.push(["referer", page.toString()]);
if (args.method !== "GET" && args.method !== "HEAD" && !hasHeader("origin")) {
relayHeaders.push(["origin", page.origin]);
}
if (!hasHeader("sec-fetch-mode")) relayHeaders.push(["sec-fetch-mode", "cors"]);
if (!hasHeader("sec-fetch-dest")) relayHeaders.push(["sec-fetch-dest", "empty"]);
if (!hasHeader("sec-fetch-site")) {
relayHeaders.push([
"sec-fetch-site",
page.origin === parsed.origin ? "same-origin" : "cross-site",
]);
}
}
}
const r = await ctx.executePrivileged(privileged.fetchWebPage, {
url: parsed.toString(),
maxBytes: 8388608,
timeoutMs: 60000,
method: args.method,
body: args.body,
bodyBase64: args.bodyBase64,
contentType: "",
headers: relayHeaders,
cookies: cookieJar,
userAgent: deviceProfile.ua,
secChUaMobile: deviceProfile.secChUaMobile,
secChUaPlatform: deviceProfile.secChUaPlatform,
    ignoreCertErrors: compat.ignoreCertErrors,
});
await persistBrowserSetCookies(ctx, r.setCookies ?? []);
await recordBrowserCapture(ctx, {
capId: args.capId,
method: args.method,
url: r.finalUrl || parsed.toString(),
kind: "fetch",
status: r.status,
size: base64ByteLength(r.bodyBase64),
durationMs: r.durationMs,
contentType: r.contentType,
reqHeaders: r.requestHeaders,
resHeaders: r.responseHeaders,
reqBody: args.body ? args.body.slice(0, 65536) : "",
resBody: /^(text\/|application\/(json|xml|javascript|xhtml))/.test(
(r.contentType || "").toLowerCase(),
)
? (() => {
try {
const bin = atob(r.bodyBase64.slice(0, 87380));
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder("utf-8").decode(bytes).slice(0, 65536);
} catch {
return "";
}
})()
: "",
timings: r.timings,
});
if (r.status === 0) {
return fail(r.error || "网络请求失败");
}
const STATUS_TEXT: Record<number, string> = {
200: "OK",
201: "Created",
202: "Accepted",
204: "No Content",
301: "Moved Permanently",
302: "Found",
304: "Not Modified",
307: "Temporary Redirect",
308: "Permanent Redirect",
400: "Bad Request",
401: "Unauthorized",
403: "Forbidden",
404: "Not Found",
405: "Method Not Allowed",
408: "Request Timeout",
409: "Conflict",
410: "Gone",
422: "Unprocessable Entity",
429: "Too Many Requests",
500: "Internal Server Error",
502: "Bad Gateway",
503: "Service Unavailable",
504: "Gateway Timeout",
};
// set-cookie never reaches the page (browsers hide it too —
// the jar already has it); content-length is dropped because
// the relayed body is re-framed by the in-page Response.
const headers = (r.responseHeaders ?? []).filter(
([n]) =>
n.toLowerCase() !== "set-cookie" &&
n.toLowerCase() !== "content-length",
);
return {
ok: true,
status: r.status,
statusText: STATUS_TEXT[r.status] ?? "",
headers,
bodyBase64: r.bodyBase64,
finalUrl: r.finalUrl || parsed.toString(),
redirected: (r.finalUrl || parsed.toString()) !== parsed.toString(),
error: "",
};
},
}),

saveBrowserPageCookies: defineAction({
description:
  "Stores one document.cookie write from a page inside the in-space browser into the server-side cookie jar: the injected cookie shim reports the raw set-string plus the page URL, and it is parsed and stored with the same rules as a Set-Cookie header (expiry deletes). Fire-and-forget from the shell.",
request: z.object({
url: z.string().trim().min(1).max(4000),
value: z.string().max(8192),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
await persistBrowserSetCookies(ctx, [
{ url: args.url, values: [args.value] },
]);
return { ok: true };
},
}),

setBrowserPageStorage: defineAction({
description:
  "Replaces the stored localStorage snapshot for one page origin in the in-space browser: the injected storage shim reports the origin's full item set after changes, and the rows here are what the next load of that origin is seeded with. Items are capped (200 keys, 256-char keys, 64KB values).",
request: z.object({
origin: z.string().trim().min(1).max(500),
items: z
.array(
z.object({
key: z.string().min(1).max(256),
value: z.string().max(65536),
}),
)
.max(200),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
let origin = "";
try {
origin = new URL(args.origin).origin;
} catch {
return { ok: true };
}
if (!origin || origin === "null") return { ok: true };
// 持久化会话 off (Cookie switch): snapshots are not stored.
const compat = await loadBrowserCompatSettings(ctx);
if (!compat.cookiesEnabled) return { ok: true };
const db = ctx.db<typeof schema>();
const existing = await db
.select()
.from(schema.browserPageStorage)
.where(eq(schema.browserPageStorage.origin, origin));
const existingByKey = new Map(existing.map((r) => [r.key, r]));
const incomingKeys = new Set(args.items.map((i) => i.key));
const now = Date.now();
for (const item of args.items) {
const row = existingByKey.get(item.key);
if (row) {
if (row.value !== item.value) {
await db
.update(schema.browserPageStorage)
.set({ value: item.value, updatedAt: now })
.where(eq(schema.browserPageStorage.id, row.id));
}
} else {
await db.insert(schema.browserPageStorage).values({
origin,
key: item.key,
value: item.value,
updatedAt: now,
});
}
}
for (const row of existing) {
if (!incomingKeys.has(row.key)) {
await db
.delete(schema.browserPageStorage)
.where(eq(schema.browserPageStorage.id, row.id));
}
}
return { ok: true };
},
}),

listVaultEntries: defineAction({
description:
  "Lists the 密码本 (password vault) entries WITHOUT any password: each entry's title, site URL/domain, username, category, notes, source (manual 手动 / auto 浏览器自动保存）, favorite flag, password length (so the pane can render its mask) and timestamps, plus the vault's auto-save setting. Sorted by category in the fixed type order （按类型排序）: website 网站登录 / email 邮箱 / social 社交 / finance 银行金融 / shopping 购物支付 / work 工作 / game 游戏 / other 其他， favorites first inside a category, then most recently updated. The plain password never travels with the list — revealVaultPassword returns one entry's password at a time.",
request: z.object({}),
response: z.object({
autoSave: z.boolean(),
entries: z.array(
z.object({
id: z.number(),
title: z.string(),
url: z.string(),
domain: z.string(),
username: z.string(),
category: z.string(),
notes: z.string(),
source: z.string(),
favorite: z.boolean(),
passwordLength: z.number(),
lastUsedAt: z.string().nullable(),
createdAt: z.string(),
updatedAt: z.string(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const state = await loadVaultState(db);
const rows = await db.select().from(schema.vaultEntries);
const order = new Map<string, number>(
VAULT_CATEGORIES.map((c, i) => [c, i] as const),
);
const sorted = [...rows].sort((a, b) => {
const ca = order.get(vaultCategoryOf(a.category)) ?? 99;
const cb = order.get(vaultCategoryOf(b.category)) ?? 99;
if (ca !== cb) return ca - cb;
if (a.favorite !== b.favorite) return b.favorite - a.favorite;
return b.updatedAt.getTime() - a.updatedAt.getTime();
});
type VaultEntryOut = {
id: number;
title: string;
url: string;
domain: string;
username: string;
category: string;
notes: string;
source: string;
favorite: boolean;
passwordLength: number;
lastUsedAt: string | null;
createdAt: string;
updatedAt: string;
};
const entries: VaultEntryOut[] = [];
for (const r of sorted) {
let len = 0;
if (r.passwordEnc) {
const dec = await ctx.executePrivileged(privileged.vaultDecrypt, {
text: r.passwordEnc,
});
if (dec.ok) len = dec.text.length;
}
entries.push({
id: r.id,
title: r.title,
url: r.url,
domain: r.domain,
username: r.username,
category: vaultCategoryOf(r.category),
notes: r.notes,
source: r.source === "auto" ? "auto" : "manual",
favorite: r.favorite === 1,
passwordLength: len,
lastUsedAt: r.lastUsedAt ? safeIso(r.lastUsedAt) : null,
createdAt: safeIso(r.createdAt),
updatedAt: safeIso(r.updatedAt),
});
}
return { autoSave: state.autoSave === 1, entries };
},
privileged: [privileged.vaultDecrypt],
}),

createVaultEntry: defineAction({
description:
  "Saves one password into the 密码本： a title, the site URL, the username, the plain password (encrypted server-side with AES-256-GCM before it is stored — the plain text is never written to the database), a category, notes, and the source ('manual' from the vault pane's own form, 'auto' when the in-space browser captured it and the user confirmed the save prompt). When an entry with the same domain + username already exists, its password/title/url are updated instead and the result says updated=true, so auto-saving the same login twice never piles up duplicates.",
request: z.object({
title: z.string().trim().max(120).default(""),
url: z.string().trim().max(2000).default(""),
username: z.string().trim().max(300),
password: z.string().min(1, "密码不能为空").max(1000),
category: z.string().trim().max(20).default(""),
notes: z.string().trim().max(1000).default(""),
source: z.enum(["manual", "auto"]).default("manual"),
}),
response: z.object({ id: z.number(), updated: z.boolean() }),
privileged: [privileged.vaultEncrypt],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const domain = vaultDomainOf(args.url);
const category =
args.category && (VAULT_CATEGORIES as readonly string[]).includes(args.category)
? args.category
: classifyVaultDomain(domain);
const enc = await ctx.executePrivileged(privileged.vaultEncrypt, {
text: args.password,
});
if (!enc.ok) throw new Error(enc.error || "密码加密失败，未保存");
const title =
args.title ||
(domain ? domain.replace(/^www\./, "") : "") ||
args.username;
if (domain && args.username) {
const existing = await db
.select()
.from(schema.vaultEntries)
.where(eq(schema.vaultEntries.domain, domain));
const dupe = existing.find((r) => r.username === args.username);
if (dupe) {
await db
.update(schema.vaultEntries)
.set({
title,
url: args.url || dupe.url,
passwordEnc: enc.text,
updatedAt: new Date(),
})
.where(eq(schema.vaultEntries.id, dupe.id));
ctx.invalidateQueries();
return { id: dupe.id, updated: true };
}
}
const inserted = await db
.insert(schema.vaultEntries)
.values({
title,
url: args.url,
domain,
username: args.username,
passwordEnc: enc.text,
category,
notes: args.notes,
source: args.source,
})
.returning({ id: schema.vaultEntries.id });
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
ctx.invalidateQueries();
return { id: row.id, updated: false };
},
}),

updateVaultEntry: defineAction({
description:
  "Edits one 密码本 entry: title, site URL, username, category, notes and favorite flag are replaced with the given values; the password is re-encrypted and replaced only when a non-empty new password is supplied — an empty password field keeps the stored one, exactly like the agent API-key forms.",
request: z.object({
id: z.number().int().positive(),
title: z.string().trim().max(120).default(""),
url: z.string().trim().max(2000).default(""),
username: z.string().trim().max(300),
password: z.string().max(1000).default(""),
category: z.string().trim().max(20).default("website"),
notes: z.string().trim().max(1000).default(""),
favorite: z.boolean().default(false),
}),
response: z.object({ ok: z.literal(true) }),
privileged: [privileged.vaultEncrypt],
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const patch: Partial<typeof schema.vaultEntries.$inferInsert> = {
title: args.title,
url: args.url,
domain: vaultDomainOf(args.url),
username: args.username,
category: vaultCategoryOf(args.category),
notes: args.notes,
favorite: args.favorite ? 1 : 0,
updatedAt: new Date(),
};
if (args.password) {
const enc = await ctx.executePrivileged(privileged.vaultEncrypt, {
text: args.password,
});
if (!enc.ok) throw new Error(enc.error || "密码加密失败，未保存");
patch.passwordEnc = enc.text;
}
await db
.update(schema.vaultEntries)
.set(patch)
.where(eq(schema.vaultEntries.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

deleteVaultEntry: defineAction({
description: "Deletes one 密码本 entry permanently (its encrypted password goes with it).",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.vaultEntries)
.where(eq(schema.vaultEntries.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

revealVaultPassword: defineAction({
description:
  "Returns ONE 密码本 entry's plain password, decrypted server-side — the only way a password ever leaves the vault. Called only when the user taps 显示 / 复制密码 / 填充 for that entry; it also stamps the entry's last-used time. A missing entry or a decryption failure returns ok=false with the real reason instead of a password.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({
ok: z.boolean(),
password: z.string(),
username: z.string(),
error: z.string(),
}),
privileged: [privileged.vaultDecrypt],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.vaultEntries)
.where(eq(schema.vaultEntries.id, args.id));
const row = rows[0];
if (!row) return { ok: false, password: "", username: "", error: "这条密码记录不存在" };
const dec = await ctx.executePrivileged(privileged.vaultDecrypt, {
text: row.passwordEnc,
});
if (!dec.ok) {
return { ok: false, password: "", username: row.username, error: dec.error || "解密失败" };
}
await db
.update(schema.vaultEntries)
.set({ lastUsedAt: new Date() })
.where(eq(schema.vaultEntries.id, args.id));
ctx.invalidateQueries();
return { ok: true, password: dec.text, username: row.username, error: "" };
},
}),

setVaultAutoSave: defineAction({
description:
  "Sets the 密码本's 自动保存 switch: while on, the in-space browser offers to save credentials typed into a page's login form (each save still needs the user's confirmation on the prompt — nothing is saved silently); while off, the browser does not ask at all.",
request: z.object({ enabled: z.boolean() }),
response: z.object({ autoSave: z.boolean() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
await loadVaultState(db);
await db
.update(schema.vaultState)
.set({ autoSave: args.enabled ? 1 : 0, updatedAt: new Date() })
.where(eq(schema.vaultState.id, 1));
ctx.invalidateQueries();
return { autoSave: args.enabled };
},
}),

listMonitors: defineAction({
description:
  "Lists the 监控中心 monitors with each one's latest real value, source and last check time, who runs its checks (agentId null = Muse the model itself; otherwise the designated in-space agent, with its name), plus the newest in-space alerts and the unread alert count (the sidebar badge).",
request: z.object({}),
response: z.object({
monitors: z.array(
z.object({
id: z.number(),
type: z.string(),
title: z.string(),
target: z.string(),
agentId: z.number().nullable(),
agentName: z.string(),
config: z.record(z.string(), z.unknown()),
frequencyMinutes: z.number(),
active: z.boolean(),
lastCheckedAt: z.string().nullable(),
lastStatus: z.string(),
lastValueNum: z.number().nullable(),
lastValueText: z.string(),
lastSource: z.string(),
createdAt: z.string(),
}),
),
alerts: z.array(
z.object({
id: z.number(),
monitorId: z.number(),
monitorTitle: z.string(),
message: z.string(),
isRead: z.boolean(),
createdAt: z.string(),
}),
),
unreadAlerts: z.number(),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.monitors)
.orderBy(desc(schema.monitors.id));
const alertRows = await db
.select()
.from(schema.monitorAlerts)
.orderBy(desc(schema.monitorAlerts.id))
.limit(50);
const titleOf = new Map(rows.map((m) => [m.id, m.title]));
const agentRows = await db
.select({ id: schema.agents.id, name: schema.agents.name })
.from(schema.agents);
const agentNameOf = new Map(agentRows.map((a) => [a.id, a.name]));
return {
monitors: rows.map((m) => ({
id: m.id,
type: m.type,
title: m.title,
target: m.target,
agentId: m.agentId ?? null,
agentName: m.agentId != null ? (agentNameOf.get(m.agentId) ?? "") : "",
config: parseMonitorConfig(m.configJson),
frequencyMinutes: m.frequencyMinutes,
active: m.active === 1,
lastCheckedAt: m.lastCheckedAt ? m.lastCheckedAt.toISOString() : null,
lastStatus: m.lastStatus,
lastValueNum: m.lastValueNum,
lastValueText: m.lastValueText,
lastSource: m.lastSource,
createdAt: m.createdAt.toISOString(),
})),
alerts: alertRows.map((a) => ({
id: a.id,
monitorId: a.monitorId,
monitorTitle: titleOf.get(a.monitorId) ?? "监控",
message: a.message,
isRead: a.isRead === 1,
createdAt: a.createdAt.toISOString(),
})),
unreadAlerts: alertRows.filter((a) => a.isRead === 0).length,
};
},
}),

createMonitor: defineAction({
description:
  "Creates one monitor in the 监控中心： a type (product 商品价格 / stock 股票 / webchange 网页内容变化 / rate 汇率与加密货币 / travel 航班酒店价格 / appversion 应用版本 / ticket 票务有货 / social 社交账号更新）, a title, the target (URL / ticker / pair / name or query), type-specific thresholds in config, and the check frequency in minutes. agentId picks who runs the checks: omit or null for Muse (the model itself, the default); an in-space agent's id makes Muse delegate each check to that agent and summarize its report. Nothing is checked until the first run — no value is ever prefilled or invented.",
request: z.object({
type: z.enum(["product", "stock", "webchange", "rate", "travel", "appversion", "ticket", "social"]),
title: z.string().trim().min(1, "名称不能为空").max(100),
target: z.string().trim().min(1, "监控目标不能为空").max(2000),
config: z.record(z.string(), z.unknown()).default({}),
frequencyMinutes: z.number().int().min(30).max(43200).default(1440),
agentId: z.number().int().positive().nullable().default(null),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
if (args.agentId != null) {
const found = await db
.select({ id: schema.agents.id })
.from(schema.agents)
.where(eq(schema.agents.id, args.agentId));
if (!found[0]) throw new Error("指定的智能体不存在");
}
const inserted = await db
.insert(schema.monitors)
.values({
type: args.type,
title: args.title,
target: args.target,
agentId: args.agentId ?? null,
configJson: JSON.stringify(args.config ?? {}),
frequencyMinutes: args.frequencyMinutes,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("创建失败，请重试");
return { id: row.id };
},
}),

updateMonitor: defineAction({
description: "Edits one monitor's title, target, thresholds, frequency, active switch and who runs its checks (agentId null = Muse the model itself; an agent id delegates checks to that agent).",
request: z.object({
id: z.number().int().positive(),
title: z.string().trim().min(1).max(100),
target: z.string().trim().min(1).max(2000),
config: z.record(z.string(), z.unknown()).default({}),
frequencyMinutes: z.number().int().min(30).max(43200),
active: z.boolean(),
agentId: z.number().int().positive().nullable().default(null),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
if (args.agentId != null) {
const found = await db
.select({ id: schema.agents.id })
.from(schema.agents)
.where(eq(schema.agents.id, args.agentId));
if (!found[0]) throw new Error("指定的智能体不存在");
}
await db
.update(schema.monitors)
.set({
title: args.title,
target: args.target,
agentId: args.agentId ?? null,
configJson: JSON.stringify(args.config ?? {}),
frequencyMinutes: args.frequencyMinutes,
active: args.active ? 1 : 0,
updatedAt: new Date(),
})
.where(eq(schema.monitors.id, args.id));
return { ok: true };
},
}),

deleteMonitor: defineAction({
description: "Deletes one monitor together with its check history and alerts.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db.batch([
db.delete(schema.monitorChecks).where(eq(schema.monitorChecks.monitorId, args.id)),
db.delete(schema.monitorAlerts).where(eq(schema.monitorAlerts.monitorId, args.id)),
db.delete(schema.monitors).where(eq(schema.monitors.id, args.id)),
]);
return { ok: true };
},
}),

listMonitorChecks: defineAction({
description: "Lists one monitor's check history, newest first — the real recorded values the history curve draws from.",
request: z.object({
monitorId: z.number().int().positive(),
limit: z.number().int().min(1).max(200).default(60),
}),
response: z.object({
checks: z.array(
z.object({
id: z.number(),
status: z.string(),
valueNum: z.number().nullable(),
valueText: z.string(),
source: z.string(),
detail: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.monitorChecks)
.where(eq(schema.monitorChecks.monitorId, args.monitorId))
.orderBy(desc(schema.monitorChecks.id))
.limit(args.limit);
return {
checks: rows.map((r) => ({
id: r.id,
status: r.status,
valueNum: r.valueNum,
valueText: r.valueText,
source: r.source,
detail: r.detail,
createdAt: r.createdAt.toISOString(),
})),
};
},
}),

markMonitorAlertsRead: defineAction({
description: "Marks every monitor alert as read (clears the 监控 sidebar badge).",
request: z.object({}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.monitorAlerts)
.set({ isRead: 1 })
.where(eq(schema.monitorAlerts.isRead, 0));
return { ok: true };
},
}),

runMonitorCheck: defineAction({
description:
  "Runs one monitor's check right now. By default Muse (the model) checks the real source directly (the product page itself, Stooq/Eastmoney for stocks, public rate APIs, GitHub/App Store for versions, the watched page for content changes, web search for ticket/travel/social updates); when the monitor designates an in-space agent, Muse sends that agent the monitor's conditions, the agent queries and reports back to Muse, and Muse's summary is what gets recorded. Either way the check is recorded in history, the monitor's current value is updated, and an in-space alert is written when a threshold or change rule fires. A source that yields nothing records 未查到 with the reason — never an invented value.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({
status: z.string(),
valueText: z.string(),
source: z.string(),
detail: z.string(),
alerts: z.array(z.string()),
}),
privileged: [privileged.fetchWebPage],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.monitors)
.where(eq(schema.monitors.id, args.id));
const monitor = rows[0];
if (!monitor) throw new Error("监控不存在");
const result = await performMonitorCheck(ctx, db, monitor);
return {
status: result.status,
valueText: result.valueText,
source: result.source,
detail: result.detail,
alerts: result.alerts,
};
},
}),

runDueMonitorChecks: defineAction({
description:
  "The scheduled sweep (hourly): runs every active monitor whose check frequency has elapsed since its last check, and materializes any due 记账本 recurring entries. Returns how many monitors were checked and how many alerts fired.",
request: z.object({}),
response: z.object({
checked: z.number(),
alerts: z.number(),
recurringCreated: z.number(),
}),
privileged: [privileged.fetchWebPage],
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.monitors)
.where(eq(schema.monitors.active, 1));
const now = Date.now();
let checked = 0;
let alerts = 0;
for (const m of rows) {
const last = m.lastCheckedAt ? m.lastCheckedAt.getTime() : 0;
if (now - last < m.frequencyMinutes * 60000) continue;
const result = await performMonitorCheck(ctx, db, m);
checked += 1;
alerts += result.alerts.length;
}
const recurringCreated = await materializeRecurring(db);
ctx.invalidateQueries();
return { checked, alerts, recurringCreated };
},
}),

listLedgerAccounts: defineAction({
description:
  "Lists the 记账本 accounts (cash / bank / credit card / e-wallet / other, user-defined) with each balance computed live from its initial balance plus every transaction — balances are never stored, so edits can never leave them stale. Also returns total assets across non-archived accounts.",
request: z.object({}),
response: z.object({
accounts: z.array(
z.object({
id: z.number(),
name: z.string(),
kind: z.string(),
initialBalanceCents: z.number(),
note: z.string(),
archived: z.boolean(),
balanceCents: z.number(),
}),
),
totalAssetsCents: z.number(),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const balances = await ledgerBalances(db);
const rows = await db
.select()
.from(schema.ledgerAccounts)
.orderBy(asc(schema.ledgerAccounts.sort), asc(schema.ledgerAccounts.id));
const accounts = rows.map((a) => ({
id: a.id,
name: a.name,
kind: a.kind,
initialBalanceCents: a.initialBalanceCents,
note: a.note,
archived: a.archived === 1,
balanceCents: balances.get(a.id) ?? a.initialBalanceCents,
}));
return {
accounts,
totalAssetsCents: accounts
.filter((a) => !a.archived)
.reduce((sum, a) => sum + a.balanceCents, 0),
};
},
}),

createLedgerAccount: defineAction({
description: "Creates one ledger account with a name, a kind (cash/bank/credit/wallet/other) and its opening balance in cents.",
request: z.object({
name: z.string().trim().min(1, "账户名称不能为空").max(60),
kind: z.enum(["cash", "bank", "credit", "wallet", "other"]).default("cash"),
initialBalanceCents: z.number().int().min(-100000000000).max(100000000000).default(0),
note: z.string().trim().max(200).default(""),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const count = await db.select().from(schema.ledgerAccounts);
const inserted = await db
.insert(schema.ledgerAccounts)
.values({
name: args.name,
kind: args.kind,
initialBalanceCents: args.initialBalanceCents,
note: args.note,
sort: count.length,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("创建失败，请重试");
return { id: row.id };
},
}),

updateLedgerAccount: defineAction({
description: "Edits one ledger account (name, kind, opening balance, note, archived).",
request: z.object({
id: z.number().int().positive(),
name: z.string().trim().min(1).max(60),
kind: z.enum(["cash", "bank", "credit", "wallet", "other"]),
initialBalanceCents: z.number().int().min(-100000000000).max(100000000000),
note: z.string().trim().max(200).default(""),
archived: z.boolean(),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.ledgerAccounts)
.set({
name: args.name,
kind: args.kind,
initialBalanceCents: args.initialBalanceCents,
note: args.note,
archived: args.archived ? 1 : 0,
updatedAt: new Date(),
})
.where(eq(schema.ledgerAccounts.id, args.id));
return { ok: true };
},
}),

deleteLedgerAccount: defineAction({
description: "Deletes one ledger account. Refused while the account still has transactions — those must be deleted first, so money history is never silently orphaned.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const txs = await db
.select({ id: schema.ledgerTransactions.id })
.from(schema.ledgerTransactions)
.where(
or(
eq(schema.ledgerTransactions.accountId, args.id),
eq(schema.ledgerTransactions.toAccountId, args.id),
),
)
.limit(1);
if (txs.length > 0) {
throw new Error("该账户下还有账目，请先删除它的账目再删除账户");
}
await db
.delete(schema.ledgerAccounts)
.where(eq(schema.ledgerAccounts.id, args.id));
return { ok: true };
},
}),

listLedgerCategories: defineAction({
description:
  "Lists the ledger's two-level category tree (income and expense, each with subcategories). The standard starter tree is seeded once on first read; afterwards the rows are purely the user's own — fully customizable, never re-seeded.",
request: z.object({}),
response: z.object({
categories: z.array(
z.object({
id: z.number(),
parentId: z.number().nullable(),
name: z.string(),
kind: z.string(),
sort: z.number(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
await ensureLedgerCategories(db);
const rows = await db
.select()
.from(schema.ledgerCategories)
.orderBy(asc(schema.ledgerCategories.sort), asc(schema.ledgerCategories.id));
return {
categories: rows.map((c) => ({
id: c.id,
parentId: c.parentId,
name: c.name,
kind: c.kind,
sort: c.sort,
})),
};
},
}),

createLedgerCategory: defineAction({
description: "Creates a ledger category, or a subcategory when parentId is given (the kind follows the parent).",
request: z.object({
name: z.string().trim().min(1, "分类名称不能为空").max(40),
kind: z.enum(["income", "expense"]).default("expense"),
parentId: z.number().int().positive().nullable().default(null),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
await ensureLedgerCategories(db);
let kind = args.kind;
if (args.parentId != null) {
const parents = await db
.select()
.from(schema.ledgerCategories)
.where(eq(schema.ledgerCategories.id, args.parentId));
const parent = parents[0];
if (!parent) throw new Error("上级分类不存在");
if (parent.parentId != null) throw new Error("子分类下不能再加子分类");
kind = parent.kind;
}
const siblings = await db
.select()
.from(schema.ledgerCategories)
.where(
args.parentId != null
? eq(schema.ledgerCategories.parentId, args.parentId)
: isNull(schema.ledgerCategories.parentId),
);
const inserted = await db
.insert(schema.ledgerCategories)
.values({ name: args.name, kind, parentId: args.parentId, sort: siblings.length })
.returning();
const row = inserted[0];
if (!row) throw new Error("创建失败，请重试");
return { id: row.id };
},
}),

updateLedgerCategory: defineAction({
description: "Renames one ledger category.",
request: z.object({
id: z.number().int().positive(),
name: z.string().trim().min(1).max(40),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.ledgerCategories)
.set({ name: args.name, updatedAt: new Date() })
.where(eq(schema.ledgerCategories.id, args.id));
return { ok: true };
},
}),

deleteLedgerCategory: defineAction({
description: "Deletes one ledger category. Refused while it has subcategories or is referenced by transactions, budgets or recurring entries.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const children = await db
.select({ id: schema.ledgerCategories.id })
.from(schema.ledgerCategories)
.where(eq(schema.ledgerCategories.parentId, args.id))
.limit(1);
if (children.length > 0) throw new Error("该分类下还有子分类，请先删除子分类");
const used =
(await db.select({ id: schema.ledgerTransactions.id }).from(schema.ledgerTransactions).where(eq(schema.ledgerTransactions.categoryId, args.id)).limit(1)).length > 0 ||
(await db.select({ id: schema.ledgerBudgets.id }).from(schema.ledgerBudgets).where(eq(schema.ledgerBudgets.categoryId, args.id)).limit(1)).length > 0 ||
(await db.select({ id: schema.ledgerRecurring.id }).from(schema.ledgerRecurring).where(eq(schema.ledgerRecurring.categoryId, args.id)).limit(1)).length > 0;
if (used) throw new Error("该分类已被账目、预算或定期收支使用，不能删除");
await db
.delete(schema.ledgerCategories)
.where(eq(schema.ledgerCategories.id, args.id));
return { ok: true };
},
}),

listLedgerTransactions: defineAction({
description:
  "Lists ledger transactions with the pane's filters (search text over note/category/account names, kind, account, category including its subcategories, month or date range), newest first, plus the filtered income/expense totals. Amounts are integer cents; dates are the user's own YYYY-MM-DD.",
request: z.object({
search: z.string().trim().max(100).default(""),
kind: z.enum(["income", "expense", "transfer"]).nullable().default(null),
accountId: z.number().int().positive().nullable().default(null),
categoryId: z.number().int().positive().nullable().default(null),
month: z.string().regex(/^\d{4}-\d{2}$/).nullable().default(null),
from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
limit: z.number().int().min(1).max(1000).default(300),
}),
response: z.object({
transactions: z.array(
z.object({
id: z.number(),
kind: z.string(),
accountId: z.number(),
toAccountId: z.number().nullable(),
categoryId: z.number().nullable(),
amountCents: z.number(),
note: z.string(),
occurredOn: z.string(),
attachmentUrl: z.string().nullable(),
attachmentName: z.string(),
recurringId: z.number().nullable(),
createdAt: z.string(),
}),
),
incomeCents: z.number(),
expenseCents: z.number(),
count: z.number(),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.ledgerTransactions)
.orderBy(desc(schema.ledgerTransactions.occurredOn), desc(schema.ledgerTransactions.id));
const categories = await db.select().from(schema.ledgerCategories);
const catName = new Map(categories.map((c) => [c.id, c.name]));
const accounts = await db.select().from(schema.ledgerAccounts);
const accName = new Map(accounts.map((a) => [a.id, a.name]));
const catFilter =
args.categoryId != null
? categorySubtreeIds(categories, args.categoryId)
: null;
const search = args.search.toLowerCase();
const filtered = rows.filter((t) => {
if (args.kind && t.kind !== args.kind) return false;
if (
args.accountId != null &&
t.accountId !== args.accountId &&
t.toAccountId !== args.accountId
)
return false;
if (catFilter && (t.categoryId == null || !catFilter.has(t.categoryId)))
return false;
if (args.month && !t.occurredOn.startsWith(args.month)) return false;
if (args.from && t.occurredOn < args.from) return false;
if (args.to && t.occurredOn > args.to) return false;
if (search) {
const hay = `${t.note} ${t.categoryId != null ? (catName.get(t.categoryId) ?? "") : ""} ${accName.get(t.accountId) ?? ""}`.toLowerCase();
if (!hay.includes(search)) return false;
}
return true;
});
const incomeCents = filtered
.filter((t) => t.kind === "income")
.reduce((s, t) => s + t.amountCents, 0);
const expenseCents = filtered
.filter((t) => t.kind === "expense")
.reduce((s, t) => s + t.amountCents, 0);
const page = filtered.slice(0, args.limit);
const transactions = await Promise.all(
page.map(async (t) => ({
id: t.id,
kind: t.kind,
accountId: t.accountId,
toAccountId: t.toAccountId,
categoryId: t.categoryId,
amountCents: t.amountCents,
note: t.note,
occurredOn: t.occurredOn,
attachmentUrl: await resolveAvatarUrl(ctx, t.attachmentBlobKey),
attachmentName: t.attachmentName,
recurringId: t.recurringId,
createdAt: t.createdAt.toISOString(),
})),
);
return { transactions, incomeCents, expenseCents, count: filtered.length };
},
}),

createLedgerTransaction: defineAction({
description:
  "Records one ledger transaction exactly as entered: income, expense or transfer, amount in cents, the user's own date, category, note and an optional receipt image attachment. Nothing about the amount or date is inferred or adjusted.",
request: z.object({
kind: z.enum(["income", "expense", "transfer"]),
accountId: z.number().int().positive(),
toAccountId: z.number().int().positive().nullable().default(null),
categoryId: z.number().int().positive().nullable().default(null),
amountCents: z.number().int().min(1, "金额必须大于 0").max(100000000000),
note: z.string().trim().max(500).default(""),
occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD"),
attachment: z
.object({ dataBase64: z.string().max(8000000), mimeType: z.enum(["image/jpeg", "image/png"]), name: z.string().max(200).default("") })
.nullable()
.default(null),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
if (args.kind === "transfer") {
if (args.toAccountId == null) throw new Error("转账需要选择转入账户");
if (args.toAccountId === args.accountId) throw new Error("转出和转入账户不能相同");
}
let blobKey: string | null = null;
if (args.attachment) {
const bytes = Uint8Array.from(atob(args.attachment.dataBase64), (c) => c.charCodeAt(0));
blobKey = `ledger/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
await ctx.blobs.put(blobKey, bytes, { contentType: args.attachment.mimeType });
}
const inserted = await db
.insert(schema.ledgerTransactions)
.values({
kind: args.kind,
accountId: args.accountId,
toAccountId: args.kind === "transfer" ? args.toAccountId : null,
categoryId: args.kind === "transfer" ? null : args.categoryId,
amountCents: args.amountCents,
note: args.note,
occurredOn: args.occurredOn,
attachmentBlobKey: blobKey,
attachmentName: args.attachment?.name ?? "",
})
.returning();
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
ctx.invalidateQueries();
return { id: row.id };
},
}),

updateLedgerTransaction: defineAction({
description: "Edits one ledger transaction (kind, accounts, category, amount, date, note, attachment add/remove).",
request: z.object({
id: z.number().int().positive(),
kind: z.enum(["income", "expense", "transfer"]),
accountId: z.number().int().positive(),
toAccountId: z.number().int().positive().nullable().default(null),
categoryId: z.number().int().positive().nullable().default(null),
amountCents: z.number().int().min(1).max(100000000000),
note: z.string().trim().max(500).default(""),
occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
attachment: z
.object({ dataBase64: z.string().max(8000000), mimeType: z.enum(["image/jpeg", "image/png"]), name: z.string().max(200).default("") })
.nullable()
.default(null),
removeAttachment: z.boolean().default(false),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
if (args.kind === "transfer") {
if (args.toAccountId == null) throw new Error("转账需要选择转入账户");
if (args.toAccountId === args.accountId) throw new Error("转出和转入账户不能相同");
}
const existing = await db
.select()
.from(schema.ledgerTransactions)
.where(eq(schema.ledgerTransactions.id, args.id));
const old = existing[0];
if (!old) throw new Error("账目不存在");
let blobKey = old.attachmentBlobKey;
let attachmentName = old.attachmentName;
if (args.removeAttachment) {
blobKey = null;
attachmentName = "";
}
if (args.attachment) {
const bytes = Uint8Array.from(atob(args.attachment.dataBase64), (c) => c.charCodeAt(0));
blobKey = `ledger/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
await ctx.blobs.put(blobKey, bytes, { contentType: args.attachment.mimeType });
attachmentName = args.attachment.name;
}
await db
.update(schema.ledgerTransactions)
.set({
kind: args.kind,
accountId: args.accountId,
toAccountId: args.kind === "transfer" ? args.toAccountId : null,
categoryId: args.kind === "transfer" ? null : args.categoryId,
amountCents: args.amountCents,
note: args.note,
occurredOn: args.occurredOn,
attachmentBlobKey: blobKey,
attachmentName,
updatedAt: new Date(),
})
.where(eq(schema.ledgerTransactions.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

deleteLedgerTransaction: defineAction({
description: "Deletes one ledger transaction.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.ledgerTransactions)
.where(eq(schema.ledgerTransactions.id, args.id));
ctx.invalidateQueries();
return { ok: true };
},
}),

listLedgerBudgets: defineAction({
description:
  "Lists one month's per-category budgets with the amount actually spent in each (the category plus its subcategories), so the pane can show progress and overspend state.",
request: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
response: z.object({
budgets: z.array(
z.object({
id: z.number(),
categoryId: z.number(),
month: z.string(),
amountCents: z.number(),
spentCents: z.number(),
}),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const budgets = await db
.select()
.from(schema.ledgerBudgets)
.where(eq(schema.ledgerBudgets.month, args.month));
const categories = await db.select().from(schema.ledgerCategories);
const txs = await db
.select()
.from(schema.ledgerTransactions)
.where(eq(schema.ledgerTransactions.kind, "expense"));
const monthTxs = txs.filter((t) => t.occurredOn.startsWith(args.month));
return {
budgets: budgets.map((b) => {
const ids = categorySubtreeIds(categories, b.categoryId);
return {
id: b.id,
categoryId: b.categoryId,
month: b.month,
amountCents: b.amountCents,
spentCents: monthTxs
.filter((t) => t.categoryId != null && ids.has(t.categoryId))
.reduce((s, t) => s + t.amountCents, 0),
};
}),
};
},
}),

setLedgerBudget: defineAction({
description: "Sets (or replaces) one category's budget for one month, in cents.",
request: z.object({
categoryId: z.number().int().positive(),
month: z.string().regex(/^\d{4}-\d{2}$/),
amountCents: z.number().int().min(0).max(100000000000),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const existing = await db
.select()
.from(schema.ledgerBudgets)
.where(
and(
eq(schema.ledgerBudgets.categoryId, args.categoryId),
eq(schema.ledgerBudgets.month, args.month),
),
);
const found = existing[0];
if (found) {
await db
.update(schema.ledgerBudgets)
.set({ amountCents: args.amountCents, updatedAt: new Date() })
.where(eq(schema.ledgerBudgets.id, found.id));
return { id: found.id };
}
const inserted = await db
.insert(schema.ledgerBudgets)
.values({ categoryId: args.categoryId, month: args.month, amountCents: args.amountCents })
.returning();
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
return { id: row.id };
},
}),

deleteLedgerBudget: defineAction({
description: "Deletes one monthly category budget.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.ledgerBudgets)
.where(eq(schema.ledgerBudgets.id, args.id));
return { ok: true };
},
}),

listLedgerRecurring: defineAction({
description: "Lists the ledger's recurring income/expense rules with their next scheduled date.",
request: z.object({}),
response: z.object({
items: z.array(
z.object({
id: z.number(),
kind: z.string(),
accountId: z.number(),
categoryId: z.number().nullable(),
amountCents: z.number(),
note: z.string(),
frequency: z.string(),
startOn: z.string(),
nextOn: z.string(),
active: z.boolean(),
}),
),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.ledgerRecurring)
.orderBy(asc(schema.ledgerRecurring.nextOn));
return {
items: rows.map((r) => ({
id: r.id,
kind: r.kind,
accountId: r.accountId,
categoryId: r.categoryId,
amountCents: r.amountCents,
note: r.note,
frequency: r.frequency,
startOn: r.startOn,
nextOn: r.nextOn,
active: r.active === 1,
})),
};
},
}),

createLedgerRecurring: defineAction({
description:
  "Creates a recurring income/expense rule (daily / weekly / monthly / yearly from a start date). Due occurrences are materialized as real transactions by materializeLedgerRecurring and by the hourly sweep.",
request: z.object({
kind: z.enum(["income", "expense"]),
accountId: z.number().int().positive(),
categoryId: z.number().int().positive().nullable().default(null),
amountCents: z.number().int().min(1).max(100000000000),
note: z.string().trim().max(500).default(""),
frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}),
response: z.object({ id: z.number() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const inserted = await db
.insert(schema.ledgerRecurring)
.values({
kind: args.kind,
accountId: args.accountId,
categoryId: args.categoryId,
amountCents: args.amountCents,
note: args.note,
frequency: args.frequency,
startOn: args.startOn,
nextOn: args.startOn,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("创建失败，请重试");
return { id: row.id };
},
}),

updateLedgerRecurring: defineAction({
description: "Pauses or resumes one recurring rule.",
request: z.object({
id: z.number().int().positive(),
active: z.boolean(),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.ledgerRecurring)
.set({ active: args.active ? 1 : 0, updatedAt: new Date() })
.where(eq(schema.ledgerRecurring.id, args.id));
return { ok: true };
},
}),

deleteLedgerRecurring: defineAction({
description: "Deletes one recurring rule. Transactions it already generated stay (their recurring link is cleared).",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.ledgerTransactions)
.set({ recurringId: null })
.where(eq(schema.ledgerTransactions.recurringId, args.id));
await db
.delete(schema.ledgerRecurring)
.where(eq(schema.ledgerRecurring.id, args.id));
return { ok: true };
},
}),

materializeLedgerRecurring: defineAction({
description: "Writes any due recurring transactions (scheduled date reached) and advances their schedules. Called when the ledger opens and by the hourly sweep.",
request: z.object({}),
response: z.object({ created: z.number() }),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const created = await materializeRecurring(db);
if (created > 0) ctx.invalidateQueries();
return { created };
},
}),

getLedgerReport: defineAction({
description:
  "The monthly ledger report: income / expense / net for the month, expense and income totals rolled up per top-level category, and a per-day income/expense series for the trend chart. All computed from the real transaction rows of that month.",
request: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
response: z.object({
incomeCents: z.number(),
expenseCents: z.number(),
byCategory: z.array(
z.object({ categoryId: z.number().nullable(), name: z.string(), kind: z.string(), totalCents: z.number() }),
),
daily: z.array(
z.object({ date: z.string(), incomeCents: z.number(), expenseCents: z.number() }),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const categories = await db.select().from(schema.ledgerCategories);
const catById = new Map(categories.map((c) => [c.id, c]));
const topOf = (id: number | null): { id: number | null; name: string } => {
if (id == null) return { id: null, name: "未分类" };
let cur = catById.get(id);
if (!cur) return { id: null, name: "未分类" };
while (cur.parentId != null) {
const parent = catById.get(cur.parentId);
if (!parent) break;
cur = parent;
}
return { id: cur.id, name: cur.name };
};
const txs = (await db.select().from(schema.ledgerTransactions)).filter((t) =>
t.occurredOn.startsWith(args.month),
);
let incomeCents = 0;
let expenseCents = 0;
const catTotals = new Map<string, { categoryId: number | null; name: string; kind: string; totalCents: number }>();
const dayMap = new Map<string, { incomeCents: number; expenseCents: number }>();
for (const t of txs) {
if (t.kind === "transfer") continue;
const day = dayMap.get(t.occurredOn) ?? { incomeCents: 0, expenseCents: 0 };
if (t.kind === "income") {
incomeCents += t.amountCents;
day.incomeCents += t.amountCents;
} else {
expenseCents += t.amountCents;
day.expenseCents += t.amountCents;
}
dayMap.set(t.occurredOn, day);
const top = topOf(t.categoryId);
const key = `${t.kind}:${top.id ?? "none"}`;
const entry = catTotals.get(key) ?? { categoryId: top.id, name: top.name, kind: t.kind, totalCents: 0 };
entry.totalCents += t.amountCents;
catTotals.set(key, entry);
}
return {
incomeCents,
expenseCents,
byCategory: [...catTotals.values()].sort((a, b) => b.totalCents - a.totalCents),
daily: [...dayMap.entries()]
.map(([date, v]) => ({ date, incomeCents: v.incomeCents, expenseCents: v.expenseCents }))
.sort((a, b) => a.date.localeCompare(b.date)),
};
},
}),

getLedgerYearReport: defineAction({
description: "The yearly ledger report: per-month income/expense series plus the year's per-category totals, computed from the real rows.",
request: z.object({ year: z.string().regex(/^\d{4}$/) }),
response: z.object({
incomeCents: z.number(),
expenseCents: z.number(),
months: z.array(
z.object({ month: z.string(), incomeCents: z.number(), expenseCents: z.number() }),
),
byCategory: z.array(
z.object({ categoryId: z.number().nullable(), name: z.string(), kind: z.string(), totalCents: z.number() }),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const categories = await db.select().from(schema.ledgerCategories);
const catById = new Map(categories.map((c) => [c.id, c]));
const topOf = (id: number | null): { id: number | null; name: string } => {
if (id == null) return { id: null, name: "未分类" };
let cur = catById.get(id);
if (!cur) return { id: null, name: "未分类" };
while (cur.parentId != null) {
const parent = catById.get(cur.parentId);
if (!parent) break;
cur = parent;
}
return { id: cur.id, name: cur.name };
};
const txs = (await db.select().from(schema.ledgerTransactions)).filter((t) =>
t.occurredOn.startsWith(args.year),
);
const monthMap = new Map<string, { incomeCents: number; expenseCents: number }>();
for (let m = 1; m <= 12; m++) {
monthMap.set(`${args.year}-${String(m).padStart(2, "0")}`, { incomeCents: 0, expenseCents: 0 });
}
let incomeCents = 0;
let expenseCents = 0;
const catTotals = new Map<string, { categoryId: number | null; name: string; kind: string; totalCents: number }>();
for (const t of txs) {
if (t.kind === "transfer") continue;
const entry = monthMap.get(t.occurredOn.slice(0, 7));
if (t.kind === "income") {
incomeCents += t.amountCents;
if (entry) entry.incomeCents += t.amountCents;
} else {
expenseCents += t.amountCents;
if (entry) entry.expenseCents += t.amountCents;
}
const top = topOf(t.categoryId);
const key = `${t.kind}:${top.id ?? "none"}`;
const cat = catTotals.get(key) ?? { categoryId: top.id, name: top.name, kind: t.kind, totalCents: 0 };
cat.totalCents += t.amountCents;
catTotals.set(key, cat);
}
return {
incomeCents,
expenseCents,
months: [...monthMap.entries()].map(([month, v]) => ({ month, incomeCents: v.incomeCents, expenseCents: v.expenseCents })),
byCategory: [...catTotals.values()].sort((a, b) => b.totalCents - a.totalCents),
};
},
}),

exportLedgerCsv: defineAction({
description: "Exports ledger transactions as a CSV document (UTF-8 with BOM, opens directly in Excel) over an optional date range.",
request: z.object({
from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}),
response: z.object({ filename: z.string(), content: z.string() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await ledgerExportRows(db, args.from, args.to);
const lines = rows.map((r) => r.map(csvEscape).join(","));
return {
filename: `记账本导出-${args.from ?? "全部"}-${args.to ?? ""}.csv`,
content: `\uFEFF${lines.join("\r\n")}`,
};
},
}),

exportLedgerExcel: defineAction({
description: "Exports ledger transactions as a genuine .xlsx workbook (built server-side) over an optional date range, returned as base64 for the client to save.",
request: z.object({
from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}),
response: z.object({ filename: z.string(), dataBase64: z.string() }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await ledgerExportRows(db, args.from, args.to);
return {
filename: `记账本导出-${args.from ?? "全部"}-${args.to ?? ""}.xlsx`,
dataBase64: buildXlsxBase64(rows, "账目"),
};
},
}),

importLedgerCsv: defineAction({
description:
  "Imports transactions from a CSV in this ledger's export format （日期，类型，金额，账户，分类，子分类，备注 as headers): each row becomes a transaction in the chosen default account unless its 账户 column names an existing account; categories match by name (created rows are never invented — rows whose category does not exist are reported back as errors and skipped).",
request: z.object({
csv: z.string().min(1).max(4000000),
accountId: z.number().int().positive(),
}),
response: z.object({
imported: z.number(),
skipped: z.number(),
errors: z.array(z.string()),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
await ensureLedgerCategories(db);
const categories = await db.select().from(schema.ledgerCategories);
const accounts = await db.select().from(schema.ledgerAccounts);
const accByName = new Map(accounts.map((a) => [a.name, a.id]));
const parsed = parseCsv(args.csv);
const header = parsed[0] ?? [];
const colOf = (name: string) => header.findIndex((h) => h.trim() === name);
const ci = {
date: colOf("日期"),
kind: colOf("类型"),
amount: colOf("金额"),
account: colOf("账户"),
category: colOf("分类"),
sub: colOf("子分类"),
note: colOf("备注"),
};
let imported = 0;
let skipped = 0;
const errors: string[] = [];
if (ci.date < 0 || ci.kind < 0 || ci.amount < 0) {
return { imported: 0, skipped: 0, errors: ["CSV 缺少必需的表头：日期、类型、金额"] };
}
for (let i = 1; i < parsed.length; i++) {
const row = parsed[i];
if (!row) continue;
const get = (idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");
const date = get(ci.date);
const kindText = get(ci.kind);
const amountText = get(ci.amount);
const fail = (msg: string) => {
skipped += 1;
if (errors.length < 10) errors.push(`第 ${i + 1} 行：${msg}`);
};
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
fail(`日期「${date}」格式不正确`);
continue;
}
const kind = kindText === "收入" ? "income" : kindText === "支出" ? "expense" : null;
if (!kind) {
fail(`类型「${kindText}」不支持导入（仅收入/支出）`);
continue;
}
const amount = Number(amountText);
if (!Number.isFinite(amount) || amount <= 0) {
fail(`金额「${amountText}」不正确`);
continue;
}
let accountId = args.accountId;
const accName = get(ci.account);
if (accName && accByName.has(accName)) {
accountId = accByName.get(accName) ?? args.accountId;
}
let categoryId: number | null = null;
const catName = get(ci.category);
const subName = get(ci.sub);
if (catName) {
const parent = categories.find((c) => c.parentId == null && c.name === catName && c.kind === kind);
if (!parent) {
fail(`分类「${catName}」不存在`);
continue;
}
categoryId = parent.id;
if (subName) {
const child = categories.find((c) => c.parentId === parent.id && c.name === subName);
if (!child) {
fail(`子分类「${catName}/${subName}」不存在`);
continue;
}
categoryId = child.id;
}
}
await db.insert(schema.ledgerTransactions).values({
kind,
accountId,
categoryId,
amountCents: Math.round(amount * 100),
note: get(ci.note),
occurredOn: date,
});
imported += 1;
}
ctx.invalidateQueries();
return { imported, skipped, errors };
},
}),


listCodeFiles: defineAction({
description:
  "Lists the 代码 workspace project: every file and folder of the project tree (path + isFolder), newest first. Each file carries its own agent-access switch (default off): only files whose switch is on are ever shown to chat agents, and their edits arrive as diff proposals the user accepts or rejects.",
request: z.object({}),
response: z.object({ files: z.array(codeFileOut) }),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeFiles)
.orderBy(asc(schema.codeFiles.path));
return { files: rows.map(toCodeFileOut) };
},
}),

createCodeFile: defineAction({
description: "Creates one entry of the 代码 project tree: a code file (path, language label, code text) or a folder (isFolder). A file's agent-access switch starts off. Creating a file also writes its first version snapshot.",
request: z.object({
name: z.string().trim().max(200),
path: z.string().trim().max(500).default(""),
language: z.string().trim().max(40).default(""),
content: z.string().max(500000).default(""),
isFolder: z.boolean().default(false),
}),
response: z.object({ file: codeFileOut }),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const path = (args.path || args.name).trim();
if (!path) throw new Error("名称不能为空");
const displayName = args.isFolder
? path
: path.split("/").filter(Boolean).pop() || args.name || path;
const inserted = await db
.insert(schema.codeFiles)
.values({
name: displayName,
path,
language: args.isFolder ? "" : args.language,
content: args.isFolder ? "" : args.content,
isFolder: args.isFolder ? 1 : 0,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
if (!args.isFolder) await saveCodeVersion(db, row, "create", "创建文件");
return { file: toCodeFileOut(row) };
},
}),

updateCodeFile: defineAction({
description: "Saves edits to one 代码 file (name/path, language label, code text) and writes a version snapshot of the new content, so any earlier state can be restored from the version history.",
request: z.object({
id: z.number().int().positive(),
name: z.string().trim().max(200),
path: z.string().trim().max(500).default(""),
language: z.string().trim().max(40).default(""),
content: z.string().max(500000),
source: z.string().max(20).default("save"),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const path = (args.path || args.name).trim();
const displayName = path.split("/").filter(Boolean).pop() || args.name;
await db
.update(schema.codeFiles)
.set({
name: displayName,
path,
language: args.language,
content: args.content,
updatedAt: new Date(),
})
.where(eq(schema.codeFiles.id, args.id));
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, args.id));
const row = rows[0];
if (row) await saveCodeVersion(db, row, args.source || "save", "");
return { ok: true };
},
}),

renameCodePath: defineAction({
description: "Renames one 代码 project path. Renaming a folder rewrites the path prefix of everything inside it; renaming a file changes only that file. Names and version history are preserved.",
request: z.object({
id: z.number().int().positive(),
newPath: z.string().trim().min(1).max(500),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, args.id));
const row = rows[0];
if (!row) throw new Error("这份代码不存在，可能已被删除");
const oldPath = row.path || row.name;
const newPath = args.newPath.trim();
if (oldPath === newPath) return { ok: true };
if (row.isFolder === 1) {
const all = await db.select().from(schema.codeFiles);
for (const r of all) {
const rp = r.path || r.name;
if (rp === oldPath || rp.startsWith(oldPath + "/")) {
const np = newPath + rp.slice(oldPath.length);
await db
.update(schema.codeFiles)
.set({
path: np,
name: r.isFolder === 1 ? np : np.split("/").filter(Boolean).pop() || np,
updatedAt: new Date(),
})
.where(eq(schema.codeFiles.id, r.id));
}
}
} else {
await db
.update(schema.codeFiles)
.set({
path: newPath,
name: newPath.split("/").filter(Boolean).pop() || newPath,
updatedAt: new Date(),
})
.where(eq(schema.codeFiles.id, row.id));
}
return { ok: true };
},
}),

deleteCodeFile: defineAction({
description: "Deletes one 代码 entry. Deleting a folder also deletes everything inside it, plus the deleted files' version snapshots and AI proposals.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, args.id));
const row = rows[0];
if (row) {
let ids = [row.id];
if (row.isFolder === 1) {
const prefix = (row.path || row.name) + "/";
const all = await db.select().from(schema.codeFiles);
ids = all
.filter((r) => {
const rp = r.path || r.name;
return rp === (row.path || row.name) || rp.startsWith(prefix);
})
.map((r) => r.id);
}
for (const fid of ids) {
await db.delete(schema.codeVersions).where(eq(schema.codeVersions.fileId, fid));
await db.delete(schema.codeAiProposals).where(eq(schema.codeAiProposals.fileId, fid));
await db.delete(schema.codeFiles).where(eq(schema.codeFiles.id, fid));
}
}
return { ok: true };
},
}),

setCodeFileAccess: defineAction({
description:
  "Sets one 代码 file's own agent-access switch. On: the file's content rides along with agent replies (agents can read it; their edits arrive as diff proposals for the user to accept or reject). Off (the default): no agent sees it at all.",
request: z.object({
id: z.number().int().positive(),
access: z.boolean(),
}),
response: z.object({ ok: z.literal(true), agentAccess: z.boolean() }),
handler: async (
ctx,
args,
): Promise<{ ok: true; agentAccess: boolean }> => {
const db = ctx.db<typeof schema>();
await db
.update(schema.codeFiles)
.set({ agentAccess: args.access ? 1 : 0 })
.where(eq(schema.codeFiles.id, args.id));
return { ok: true, agentAccess: args.access };
},
}),

searchCodeFiles: defineAction({
description: "Full-text search across every 代码 file's path and content: returns each matching file with the matching line numbers and line excerpts, so the client can jump straight to a hit.",
request: z.object({ query: z.string().trim().min(1).max(200) }),
response: z.object({
hits: z.array(
z.object({
fileId: z.number(),
path: z.string(),
line: z.number(),
text: z.string(),
}),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.isFolder, 0));
const q = args.query.toLowerCase();
const hits: { fileId: number; path: string; line: number; text: string }[] = [];
for (const r of rows) {
const path = r.path || r.name;
if (path.toLowerCase().includes(q)) {
hits.push({ fileId: r.id, path, line: 1, text: path });
}
const lines = r.content.split("\n");
for (let i = 0; i < lines.length && hits.length < 500; i++) {
const lineText = lines[i] ?? "";
if (lineText.toLowerCase().includes(q)) {
hits.push({ fileId: r.id, path, line: i + 1, text: lineText.slice(0, 300) });
}
}
}
return { hits };
},
}),

importCodeFiles: defineAction({
description: "Imports a batch of code files into the 代码 project (from the client's file/folder picker or a project JSON export): each entry becomes a file at its path, with a version snapshot. Existing files at the same path are overwritten and keep their history.",
request: z.object({
files: z
.array(
z.object({
path: z.string().trim().min(1).max(500),
language: z.string().trim().max(40).default(""),
content: z.string().max(500000),
}),
)
.min(1)
.max(200),
}),
response: z.object({ ok: z.literal(true), imported: z.number() }),
handler: async (ctx, args): Promise<{ ok: true; imported: number }> => {
const db = ctx.db<typeof schema>();
let imported = 0;
for (const f of args.files) {
const existing = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.path, f.path));
const found = existing.find((r) => r.isFolder === 0);
const displayName = f.path.split("/").filter(Boolean).pop() || f.path;
if (found) {
await db
.update(schema.codeFiles)
.set({ name: displayName, language: f.language, content: f.content, updatedAt: new Date() })
.where(eq(schema.codeFiles.id, found.id));
const rows = await db.select().from(schema.codeFiles).where(eq(schema.codeFiles.id, found.id));
if (rows[0]) await saveCodeVersion(db, rows[0], "import", "导入覆盖");
} else {
const inserted = await db
.insert(schema.codeFiles)
.values({ name: displayName, path: f.path, language: f.language, content: f.content })
.returning();
if (inserted[0]) await saveCodeVersion(db, inserted[0], "import", "导入");
}
imported++;
}
return { ok: true, imported };
},
}),

listCodeVersions: defineAction({
description: "Lists one 代码 file's version history, newest first: every save's snapshot (content, source, time), for the history panel and rollback.",
request: z.object({ fileId: z.number().int().positive() }),
response: z.object({
versions: z.array(
z.object({
id: z.number(),
content: z.string(),
source: z.string(),
note: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeVersions)
.where(eq(schema.codeVersions.fileId, args.fileId))
.orderBy(desc(schema.codeVersions.id))
.limit(100);
return {
versions: rows.map((r) => ({
id: r.id,
content: r.content,
source: r.source,
note: r.note,
createdAt: r.createdAt.toISOString(),
})),
};
},
}),

rollbackCodeVersion: defineAction({
description: "Restores one 代码 file to a chosen version snapshot. The rollback itself is written as a new version, so the state being left is not lost.",
request: z.object({
fileId: z.number().int().positive(),
versionId: z.number().int().positive(),
}),
response: z.object({ ok: z.literal(true), content: z.string() }),
handler: async (ctx, args): Promise<{ ok: true; content: string }> => {
const db = ctx.db<typeof schema>();
const vrows = await db
.select()
.from(schema.codeVersions)
.where(eq(schema.codeVersions.id, args.versionId));
const v = vrows[0];
if (!v || v.fileId !== args.fileId) throw new Error("这个版本不存在");
await db
.update(schema.codeFiles)
.set({ content: v.content, updatedAt: new Date() })
.where(eq(schema.codeFiles.id, args.fileId));
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, args.fileId));
const row = rows[0];
if (row) await saveCodeVersion(db, row, "rollback", `回退到版本 #${v.id}`);
return { ok: true, content: v.content };
},
}),

proposeCodeEditWithAi: defineAction({
description: "Asks Muse (the platform inference channel) to revise one 代码 file following the user's instruction, and stores the result as a PENDING diff proposal — the file itself is not changed until the user accepts the proposal in the diff view. Only files whose agent-access switch is on may be sent to the AI this way; with the switch off the action refuses, so a private file is never sent anywhere.",
request: z.object({
fileId: z.number().int().positive(),
instruction: z.string().trim().min(1, "请先写明想让 AI 怎么改").max(2000),
}),
response: z.object({
proposal: z.object({
id: z.number(),
fileId: z.number(),
originalContent: z.string(),
proposedContent: z.string(),
instruction: z.string(),
source: z.string(),
status: z.string(),
createdAt: z.string(),
}),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, args.fileId));
const file = rows[0];
if (!file || file.isFolder === 1) throw new Error("这份代码不存在，可能已被删除");
if (file.agentAccess !== 1) {
throw new Error("这份代码的智能体开关是关的。先在文件树里打开它的开关，AI 才能读到并修改它。");
}
const result = await ctx.inference.complete(
`文件路径：${file.path || file.name}\n语言：${file.language || "未指定"}\n\n用户的修改要求：\n${args.instruction}\n\n当前完整内容：\n${file.content}`,
{
system:
" 你是一位资深工程师。按用户的修改要求改写这份代码，只输出改好后的完整文件内容：不要解释、不要 markdown 代码围栏、不要省略任何未改动的部分，保持原有风格与缩进。".trim(),
schema: z.object({ content: z.string() }),
timeout_secs: 120,
},
);
let proposed = result.content ?? "";
// Strip an accidental code fence the model may still add.
proposed = proposed.replace(/^```[a-zA-Z0-9_-]*\n/, "").replace(/\n```\s*$/, "");
const inserted = await db
.insert(schema.codeAiProposals)
.values({
fileId: file.id,
originalContent: file.content,
proposedContent: proposed,
instruction: args.instruction,
source: "code-pane",
status: "pending",
})
.returning();
const row = inserted[0];
if (!row) throw new Error("生成修改提案失败，请重试");
return {
proposal: {
id: row.id,
fileId: row.fileId,
originalContent: row.originalContent,
proposedContent: row.proposedContent,
instruction: row.instruction,
source: row.source,
status: row.status,
createdAt: row.createdAt.toISOString(),
},
};
},
}),

listCodeProposals: defineAction({
description: "Lists the 代码 workspace's AI edit proposals (optionally only one file's), newest first, with original and proposed content for the diff view.",
request: z.object({ fileId: z.number().int().positive().optional() }),
response: z.object({
proposals: z.array(
z.object({
id: z.number(),
fileId: z.number(),
originalContent: z.string(),
proposedContent: z.string(),
instruction: z.string(),
source: z.string(),
status: z.string(),
createdAt: z.string(),
}),
),
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = args.fileId
? await db
.select()
.from(schema.codeAiProposals)
.where(eq(schema.codeAiProposals.fileId, args.fileId))
.orderBy(desc(schema.codeAiProposals.id))
.limit(50)
: await db
.select()
.from(schema.codeAiProposals)
.orderBy(desc(schema.codeAiProposals.id))
.limit(50);
return {
proposals: rows.map((r) => ({
id: r.id,
fileId: r.fileId,
originalContent: r.originalContent,
proposedContent: r.proposedContent,
instruction: r.instruction,
source: r.source,
status: r.status,
createdAt: r.createdAt.toISOString(),
})),
};
},
}),

resolveCodeProposal: defineAction({
description: "Accepts or rejects one pending AI edit proposal. Accepting writes the proposed content into the file and snapshots it as an 'ai' version; rejecting changes nothing. Either way the proposal leaves the pending state.",
request: z.object({
id: z.number().int().positive(),
accept: z.boolean(),
}),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.codeAiProposals)
.where(eq(schema.codeAiProposals.id, args.id));
const proposal = rows[0];
if (!proposal) throw new Error("这份提案不存在");
if (proposal.status !== "pending") throw new Error("这份提案已经处理过了");
await db
.update(schema.codeAiProposals)
.set({ status: args.accept ? "accepted" : "rejected", updatedAt: new Date() })
.where(eq(schema.codeAiProposals.id, args.id));
if (args.accept) {
await db
.update(schema.codeFiles)
.set({ content: proposal.proposedContent, updatedAt: new Date() })
.where(eq(schema.codeFiles.id, proposal.fileId));
const frows = await db
.select()
.from(schema.codeFiles)
.where(eq(schema.codeFiles.id, proposal.fileId));
if (frows[0]) await saveCodeVersion(db, frows[0], "ai", proposal.instruction.slice(0, 100));
}
return { ok: true };
},
}),

runCodeFile: defineAction({
description: "Runs one 代码 file (or an unsaved buffer of it) and returns the real terminal output: JavaScript/TypeScript run with bun, Python with python3, Shell files run as bash commands through the same executor as the host-permission channel, all with a 10-second timeout. HTML/CSS are refused here — the client previews them live instead. Errors come back verbatim so the client can locate the failing line.",
request: z.object({
language: z.string().trim().max(40),
fileName: z.string().trim().max(200).default("main.js"),
content: z.string().max(500000),
}),
response: z.object({
ok: z.boolean(),
exitCode: z.number(),
stdout: z.string(),
stderr: z.string(),
timedOut: z.boolean(),
error: z.string(),
}),
privileged: [privileged.runCodeSnippet, privileged.execLinuxCommand],
handler: async (ctx, args) => {
const lang = args.language.trim().toLowerCase();
if (lang === "shell" || lang === "bash" || lang === "sh" || lang === "zsh") {
return await ctx.executePrivileged(privileged.execLinuxCommand, {
command: args.content,
timeoutSecs: 10,
});
}
return await ctx.executePrivileged(privileged.runCodeSnippet, {
language: args.language,
code: args.content,
fileName: args.fileName,
});
},
}),

listQuickCode: defineAction({
description:
  "Lists the 代码 workspace's 快捷运行 (quick-run) history, newest first, at most 10 entries. Before answering it re-scans the newest finished assistant replies for runnable fenced code blocks (the same detection rules as the chat's own code panels) and records any block not yet recorded as a 'chat' entry — so the newest code recognised in the chat is always the first entry and auto-fills the quick-run editor; entries the user typed into the quick-run box are 'manual'. The history is pruned to the newest 10 on every write; older entries are deleted.",
request: z.object({}),
response: quickCodeListResponse,
handler: async (ctx): Promise<z.infer<typeof quickCodeListResponse>> => {
await syncQuickCodeFromChat(ctx);
return await loadQuickCodeList(ctx);
},
}),

addQuickCode: defineAction({
description:
  "Records one code snippet the user typed or pasted into the 代码 workspace's 快捷运行 box as a 'manual' history entry (an entry identical in language + code to the current newest one is not duplicated), prunes the history to the newest 10, and returns the refreshed list.",
request: z.object({
language: z.string().trim().min(1).max(40),
code: z.string().trim().min(1, "代码不能为空").max(100000),
}),
response: quickCodeListResponse,
handler: async (ctx, args): Promise<z.infer<typeof quickCodeListResponse>> => {
const db = ctx.db<typeof schema>();
const newest = await db
.select()
.from(schema.codeQuickRuns)
.orderBy(desc(schema.codeQuickRuns.id))
.limit(1);
const top = newest[0];
if (!top || top.language !== args.language || top.code !== args.code) {
await db.insert(schema.codeQuickRuns).values({
language: args.language,
code: args.code,
source: "manual",
sourceLabel: "",
messageId: null,
blockIndex: -1,
});
await pruneQuickCode(ctx);
}
return await loadQuickCodeList(ctx);
},
}),

deleteQuickCode: defineAction({
description:
  "Deletes one entry from the 代码 workspace's 快捷运行 (quick-run) history by id and returns the refreshed list. A deleted chat-recognised entry is NOT re-recorded by later scans: the sync watermark already sits past every recorded block, so only genuinely newer chat code can enter the list again.",
request: z.object({
id: z.number().int().positive(),
}),
response: quickCodeListResponse,
handler: async (ctx, args): Promise<z.infer<typeof quickCodeListResponse>> => {
const db = ctx.db<typeof schema>();
await db
.delete(schema.codeQuickRuns)
.where(eq(schema.codeQuickRuns.id, args.id));
return await loadQuickCodeList(ctx);
},
}),

clearQuickCode: defineAction({
description:
  "Clears the whole 快捷运行 (quick-run) history — every chat-recognised and manual entry — and returns the empty refreshed list. The chat-sync watermark is deliberately kept, so already-recognised chat code does not flood back on the next read; only code recognised after the clear enters the list again.",
request: z.object({}),
response: quickCodeListResponse,
handler: async (ctx): Promise<z.infer<typeof quickCodeListResponse>> => {
const db = ctx.db<typeof schema>();
await db.delete(schema.codeQuickRuns);
return await loadQuickCodeList(ctx);
},
}),


listImageProjects: defineAction({
description:
  "Lists the 图像 workspace projects, newest first: each project's original image (never modified) plus its current grid parts, with per-part edited flags and the agent/instruction that produced an edit.",
request: z.object({}),
response: z.object({
projects: z.array(imageProjectOut),
}),
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.imageProjects)
.orderBy(desc(schema.imageProjects.id));
const projects = [];
for (const row of rows) {
projects.push(await toImageProjectOut(ctx, db, row));
}
return { projects };
},
}),

museDraw: defineAction({
description:
  "Asks Muse (the platform inference channel) to turn the user's drawing request into vector strokes for the 图像 workspace's drawing canvas: a list of polylines on a 0–1000 coordinate square, each with a hex colour and a brush width. The client replays the strokes onto the canvas one by one, so the picture appears drawn live; the strokes are sanitized and clamped here (at most 60 strokes, 80 points each, coordinates 0–1000, width 1–40, non-hex colours replaced with black). Nothing is stored — the canvas keeps the result like any hand-drawn work.",
request: z.object({
prompt: z.string().trim().min(1).max(500),
}),
response: z.object({
strokes: z.array(
z.object({
color: z.string(),
width: z.number(),
points: z.array(z.object({ x: z.number(), y: z.number() })),
}),
),
}),
handler: async (ctx, args) => {
const drawSchema = z.object({
strokes: z.array(
z.object({
color: z.string(),
width: z.number(),
points: z.array(z.object({ x: z.number(), y: z.number() })),
}),
),
});
const result = await ctx.inference.complete(
`请把下面这个画面拆解成一笔一画的线条画：${args.prompt}`,
{
system:
  "你是一位在 1000×1000 画布上作画的画师，坐标原点在左上角，x 向右、y 向下，范围都是 0 到 1000。你只能用折线笔触作画：每一笔是一串连续的点（points），配上颜色 color（#RRGGBB 十六进制）和笔尖粗细 width（2 到 24）。请用轮廓线加少量内部细节把画面画得清楚可辨：一共用 12 到 40 笔，每笔 6 到 40 个点，点要沿着线条走向均匀分布、线条平滑。先画主体轮廓，再补细节和不同颜色的部分。不要画文字。只输出笔触数据。",
schema: drawSchema,
timeout_secs: 120,
},
);
const clampNum = (v: number, min: number, max: number) =>
Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const strokes = result.strokes
.slice(0, 60)
.map((s) => ({
color: /^#[0-9a-fA-F]{6}$/.test(s.color.trim())
? s.color.trim().toLowerCase()
: "#191919",
width: clampNum(Math.round(s.width), 1, 40),
points: s.points
.slice(0, 80)
.map((p) => ({
x: Math.round(clampNum(p.x, 0, 1000)),
y: Math.round(clampNum(p.y, 0, 1000)),
}))
.filter((p, i, arr) => i === 0 || p.x !== arr[i - 1]?.x || p.y !== arr[i - 1]?.y),
}))
.filter((s) => s.points.length >= 2);
if (strokes.length === 0) {
throw new Error("Muse 这次没有画出可用的线条，请换个说法再试");
}
return { strokes };
},
}),

createImageProject: defineAction({
description:
  "Stores one image in the 图像 workspace (an upload, or a hand-drawn canvas exported as PNG) as a new project. The stored original is never modified; splitting and single-part edits work on derived copies.",
request: z.object({
name: z.string().trim().max(100).default(""),
image: z.object({ dataBase64: z.string(), mimeType: z.string() }),
width: z.number().int().positive().max(100000).nullable().default(null),
height: z.number().int().positive().max(100000).nullable().default(null),
}),
response: z.object({
project: imageProjectOut,
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
if (
args.image.mimeType !== "image/jpeg" &&
args.image.mimeType !== "image/png" &&
args.image.mimeType !== "image/webp"
) {
throw new Error("仅支持 JPG、PNG 或 WebP 图片");
}
const bytes = base64ToBytes(args.image.dataBase64);
if (bytes.length === 0) throw new Error("图片内容为空");
if (bytes.length > 12 * 1024 * 1024) throw new Error("图片过大（上限 12MB）");
const ext =
args.image.mimeType === "image/jpeg"
? "jpg"
: args.image.mimeType === "image/webp"
? "webp"
: "png";
const key = `image-projects/${Date.now()}-${Math.random()
.toString(36)
.slice(2, 10)}.${ext}`;
await ctx.blobs.put(key, bytes, { contentType: args.image.mimeType });
const parsedSize =
args.width && args.height ? null : imageSizeFromBytes(bytes);
const inserted = await db
.insert(schema.imageProjects)
.values({
name: args.name,
originalBlobKey: key,
mime: args.image.mimeType,
width: args.width ?? parsedSize?.width ?? null,
height: args.height ?? parsedSize?.height ?? null,
sizeBytes: bytes.length,
})
.returning();
const row = inserted[0];
if (!row) throw new Error("保存失败，请重试");
ctx.invalidateQueries();
return { project: await toImageProjectOut(ctx, db, row) };
},
}),

deleteImageProject: defineAction({
description:
  "Deletes one 图像 workspace project: its original image, every grid part, and the rows. Other projects are untouched.",
request: z.object({ id: z.number().int().positive() }),
response: z.object({ ok: z.literal(true) }),
handler: async (ctx, args): Promise<{ ok: true }> => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, args.id));
const project = rows[0];
if (project) {
const parts = await db
.select()
.from(schema.imageParts)
.where(eq(schema.imageParts.projectId, project.id));
for (const p of parts) {
await ctx.blobs.delete(p.blobKey).catch(() => undefined);
}
await db
.delete(schema.imageParts)
.where(eq(schema.imageParts.projectId, project.id));
await ctx.blobs.delete(project.originalBlobKey).catch(() => undefined);
if (project.editedBlobKey) {
await ctx.blobs.delete(project.editedBlobKey).catch(() => undefined);
}
await db
.delete(schema.imageProjects)
.where(eq(schema.imageProjects.id, project.id));
}
ctx.invalidateQueries();
return { ok: true };
},
}),

splitImageProject: defineAction({
description:
  "Splits one 图像 project's current whole image into a rows × cols grid of parts (the user's chosen counts): the source is the agent-produced edited copy when one exists, otherwise the pristine upload, and it is only read either way; each part is stored as its own blob. Re-splitting replaces the current parts with fresh crops of that same current image, discarding earlier per-part edits.",
request: z.object({
projectId: z.number().int().positive(),
rows: z.number().int().min(1).max(6),
cols: z.number().int().min(1).max(6),
}),
response: z.object({
project: imageProjectOut,
}),
privileged: [privileged.splitBlobImage],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, args.projectId));
const project = rows[0];
if (!project) throw new Error("这张图不存在，可能已被删除");
const r = await ctx.executePrivileged(privileged.splitBlobImage, {
key: project.editedBlobKey ?? project.originalBlobKey,
rows: args.rows,
cols: args.cols,
});
if (!r.ok) throw new Error(r.error || "切分失败，请重试");
if (r.tiles.length !== args.rows * args.cols)
throw new Error("切分失败，请重试");
// Replace the old parts (rows and blobs) with the fresh crops.
const oldParts = await db
.select()
.from(schema.imageParts)
.where(eq(schema.imageParts.projectId, project.id));
for (const p of oldParts) {
await ctx.blobs.delete(p.blobKey).catch(() => undefined);
}
await db
.delete(schema.imageParts)
.where(eq(schema.imageParts.projectId, project.id));
const stamp = Date.now();
for (let i = 0; i < r.tiles.length; i++) {
const tile = r.tiles[i];
if (!tile) continue;
const row = Math.floor(i / args.cols);
const col = i % args.cols;
const key = `image-parts/${project.id}/${i}-${stamp}.png`;
const tileBytes = base64ToBytes(tile.dataBase64);
await ctx.blobs.put(key, tileBytes, {
contentType: tile.contentType || "image/png",
});
await db.insert(schema.imageParts).values({
projectId: project.id,
idx: i,
row,
col,
blobKey: key,
mime: tile.contentType || "image/png",
width: tile.width > 0 ? tile.width : null,
height: tile.height > 0 ? tile.height : null,
sizeBytes: tileBytes.length,
});
}
await db
.update(schema.imageProjects)
.set({
rows: args.rows,
cols: args.cols,
width: r.width > 0 ? r.width : project.width,
height: r.height > 0 ? r.height : project.height,
updatedAt: new Date(),
})
.where(eq(schema.imageProjects.id, project.id));
ctx.invalidateQueries();
const fresh = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, project.id));
const updated = fresh[0];
if (!updated) throw new Error("切分失败，请重试");
return { project: await toImageProjectOut(ctx, db, updated) };
},
}),

editImagePartWithAgent: defineAction({
description:
  "Sends ONE target of a 图像 project — exactly the chosen grid part (partId set), or the whole current image (partId null) — to the chosen agent for editing with the user's instruction, through that agent's own real channel (attemptImageEditWithAgent): every agent may be chosen, Muse and web-token agents included, not only API agents. Only actual image bytes returned by the agent replace the target (a part replaces only its own grid position; a whole image becomes the project's edited copy, the pristine upload untouched); agents whose channel cannot return edited pixels produce no replacement and the response carries the real reason, including the agent's own reply where it made one.",
request: z.object({
projectId: z.number().int().positive(),
partId: z.number().int().positive().nullable(),
agentId: z.number().int().positive().nullable(),
instruction: z.string().trim().min(1, "请先写修改要求").max(2000),
}),
response: imageAgentEditResponse,
privileged: [privileged.readBlobBytes],
handler: async (ctx, args) => {
return await runAgentImageEdit(ctx, {
projectId: args.projectId,
partId: args.partId,
agentId: args.agentId,
instruction: args.instruction,
recordInstruction: args.instruction,
});
},
}),

removeImageWatermark: defineAction({
description:
  "One-click watermark removal for a 图像 project target — exactly the chosen grid part (partId set) or the whole current image (partId null): sends only that target to the chosen agent with the fixed watermark-removal instruction (WATERMARK_PROMPT) through the same all-agents dispatcher as editImagePartWithAgent. A returned image replaces exactly that target; an agent that cannot edit images produces no replacement and the response says why.",
request: z.object({
projectId: z.number().int().positive(),
partId: z.number().int().positive().nullable(),
agentId: z.number().int().positive().nullable(),
}),
response: imageAgentEditResponse,
privileged: [privileged.readBlobBytes],
handler: async (ctx, args) => {
return await runAgentImageEdit(ctx, {
projectId: args.projectId,
partId: args.partId,
agentId: args.agentId,
instruction: WATERMARK_PROMPT,
recordInstruction: "一键去水印",
});
},
}),

saveImageEdit: defineAction({
description:
  "Saves the user's own manual edit from the 图像 workspace's in-place PS-style editor (adjustments, crop, rotate/flip, brush, text — all rendered on-device; only the finished pixels arrive here). With partId it replaces exactly that grid part, with the same bookkeeping as an agent edit (edited flag set, editor recorded as 手动编辑， the operation summary as the note) and touches nothing else. Without partId it stores the edited whole image as the project's edited copy (edited_blob_key / edited_mime): the pristine upload under original_blob_key is never modified, the edited copy is what the detail view shows and what a later split cuts, and the project's width/height/size fields move to the edited image's real values.",
request: z.object({
projectId: z.number().int().positive(),
partId: z.number().int().positive().nullable(),
image: z.object({ dataBase64: z.string(), mimeType: z.string() }),
note: z.string().trim().max(200).default(""),
}),
response: z.object({
project: imageProjectOut,
}),
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
if (
args.image.mimeType !== "image/jpeg" &&
args.image.mimeType !== "image/png" &&
args.image.mimeType !== "image/webp"
) {
throw new Error("仅支持 JPG、PNG 或 WebP 图片");
}
const bytes = base64ToBytes(args.image.dataBase64);
if (bytes.length === 0) throw new Error("图片内容为空");
if (bytes.length > 12 * 1024 * 1024) throw new Error("图片过大（上限 12MB）");
const projRows = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, args.projectId));
const project = projRows[0];
if (!project) throw new Error("这张图不存在，可能已被删除");
const size = imageSizeFromBytes(bytes);
const ext =
args.image.mimeType === "image/jpeg"
? "jpg"
: args.image.mimeType === "image/webp"
? "webp"
: "png";
if (args.partId != null) {
const partRows = await db
.select()
.from(schema.imageParts)
.where(eq(schema.imageParts.id, args.partId));
const part = partRows[0];
if (!part || part.projectId !== project.id)
throw new Error("选中的这一份不存在，请重新切分后再试");
const newKey = `image-parts/${project.id}/${part.id}-manual-${Date.now()}.${ext}`;
await ctx.blobs.put(newKey, bytes, { contentType: args.image.mimeType });
await db
.update(schema.imageParts)
.set({
blobKey: newKey,
mime: args.image.mimeType,
width: size?.width ?? null,
height: size?.height ?? null,
sizeBytes: bytes.length,
edited: 1,
editAgent: "手动编辑",
editInstruction: args.note || "手动编辑",
updatedAt: new Date(),
})
.where(eq(schema.imageParts.id, part.id));
if (part.blobKey.startsWith("image-parts/")) {
await ctx.blobs.delete(part.blobKey).catch(() => undefined);
}
await db
.update(schema.imageProjects)
.set({ updatedAt: new Date() })
.where(eq(schema.imageProjects.id, project.id));
} else {
const newKey = `image-projects/${project.id}-edited-${Date.now()}.${ext}`;
await ctx.blobs.put(newKey, bytes, { contentType: args.image.mimeType });
await db
.update(schema.imageProjects)
.set({
editedBlobKey: newKey,
editedMime: args.image.mimeType,
width: size?.width ?? project.width,
height: size?.height ?? project.height,
sizeBytes: bytes.length,
updatedAt: new Date(),
})
.where(eq(schema.imageProjects.id, project.id));
if (project.editedBlobKey) {
await ctx.blobs.delete(project.editedBlobKey).catch(() => undefined);
}
}
ctx.invalidateQueries();
const fresh = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, project.id));
const updated = fresh[0];
if (!updated) throw new Error("保存失败，请重试");
return { project: await toImageProjectOut(ctx, db, updated) };
},
}),

restoreImageProjectOriginal: defineAction({
description:
  "Drops a 图像 project's manual whole-image edit: deletes the edited copy and recomputes the project's width/height/size fields from the pristine uploaded original (read back through the privileged blob reader), which was never modified. Grid parts are separate rows and are not touched.",
request: z.object({
projectId: z.number().int().positive(),
}),
response: z.object({
project: imageProjectOut,
}),
privileged: [privileged.readBlobBytes],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, args.projectId));
const project = rows[0];
if (!project) throw new Error("这张图不存在，可能已被删除");
if (project.editedBlobKey) {
await ctx.blobs.delete(project.editedBlobKey).catch(() => undefined);
let w = project.width;
let h = project.height;
let sz = project.sizeBytes;
const read = await ctx.executePrivileged(privileged.readBlobBytes, {
key: project.originalBlobKey,
});
if (read.ok) {
const origBytes = base64ToBytes(read.dataBase64);
const s = imageSizeFromBytes(origBytes);
if (s) {
w = s.width;
h = s.height;
}
sz = origBytes.length;
}
await db
.update(schema.imageProjects)
.set({
editedBlobKey: null,
editedMime: null,
width: w,
height: h,
sizeBytes: sz,
updatedAt: new Date(),
})
.where(eq(schema.imageProjects.id, project.id));
}
ctx.invalidateQueries();
const fresh = await db
.select()
.from(schema.imageProjects)
.where(eq(schema.imageProjects.id, args.projectId));
const updated = fresh[0];
if (!updated) throw new Error("这张图不存在，可能已被删除");
return { project: await toImageProjectOut(ctx, db, updated) };
},
}),


getVirtualLocation: defineAction({
description:
  "Returns the 虚拟位置 state for the proxy center: the user's virtual location (enabled flag, label, country, coordinates, recent picks) and — on separate fields, never merged — the exit-IP geolocation as last measured from this server's exit IP.",
request: z.object({}),
response: vlocOutSchema,
handler: async (ctx) => {
const row = await loadVlocRow(ctx);
return toVlocOut(row);
},
}),

setVirtualLocation: defineAction({
description:
  "Saves the 虚拟位置： the enable switch and/or a picked location (label, country, latitude, longitude). A picked location is also pushed onto the recent-picks list (deduped, newest first, max 8). Everything persists server-side across exits and devices.",
request: z.object({
enabled: z.boolean().optional(),
label: z.string().trim().max(80).optional(),
country: z.string().trim().max(80).optional(),
lat: z.number().min(-90).max(90).optional(),
lon: z.number().min(-180).max(180).optional(),
}),
response: vlocOutSchema,
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const existing = await loadVlocRow(ctx);
const cur = toVlocOut(existing);
const hasPick = args.lat !== undefined && args.lon !== undefined;
const next = {
enabled: args.enabled !== undefined ? (args.enabled ? 1 : 0) : existing?.enabled ?? 0,
label: hasPick ? (args.label ?? cur.label) : cur.label,
country: hasPick ? (args.country ?? cur.country) : cur.country,
lat: hasPick ? (args.lat as number) : cur.lat,
lon: hasPick ? (args.lon as number) : cur.lon,
};
let recent = cur.recent;
if (hasPick) {
const entry = {
label: next.label || "自定义位置",
country: next.country,
lat: next.lat as number,
lon: next.lon as number,
};
recent = [
entry,
...recent.filter(
(r) => Math.abs(r.lat - entry.lat) > 0.0001 || Math.abs(r.lon - entry.lon) > 0.0001,
),
].slice(0, 8);
}
await db
.insert(schema.virtualLocationState)
.values({
id: 1,
enabled: next.enabled,
label: next.label,
country: next.country,
lat: next.lat,
lon: next.lon,
recentJson: JSON.stringify(recent),
updatedAt: new Date(),
})
.onConflictDoUpdate({
target: schema.virtualLocationState.id,
set: {
enabled: next.enabled,
label: next.label,
country: next.country,
lat: next.lat,
lon: next.lon,
recentJson: JSON.stringify(recent),
updatedAt: new Date(),
},
});
ctx.invalidateQueries();
const fresh = await loadVlocRow(ctx);
return toVlocOut(fresh);
},
}),

refreshExitIpLocation: defineAction({
description:
  "Measures the 出口 IP 归属地 for real: asks ip-api.com (from this server, so the answer describes THIS server's exit IP) and stores the result on the virtual-location state row's separate exit fields. The virtual location is never touched by this. A failed lookup stores the real error instead of a guess.",
request: z.object({}),
response: vlocOutSchema,
privileged: [privileged.fetchWebPage],
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const set: {
updatedAt: Date;
exitIp?: string;
exitCountry?: string;
exitCity?: string;
exitLat?: number | null;
exitLon?: number | null;
exitMeasuredAt?: Date;
exitError?: string;
} = { updatedAt: new Date() };
try {
const r = await ctx.executePrivileged(privileged.fetchWebPage, {
url: "http://ip-api.com/json/?fields=status,message,country,city,lat,lon,query",
maxBytes: 262144,
timeoutMs: 12000,
method: "GET",
body: "",
bodyBase64: "",
contentType: "",
headers: [],
cookies: [],
userAgent: "",
secChUaMobile: "",
secChUaPlatform: "",
    ignoreCertErrors: false,
});
if (!r.ok) throw new Error(r.error || "查询出口 IP 失败");
const bin = atob(r.bodyBase64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
status?: string;
message?: string;
country?: string;
city?: string;
lat?: number;
lon?: number;
query?: string;
};
if (parsed.status !== "success") {
throw new Error(parsed.message || "ip-api 未能定位出口 IP");
}
set.exitIp = parsed.query ?? "";
set.exitCountry = parsed.country ?? "";
set.exitCity = parsed.city ?? "";
set.exitLat = typeof parsed.lat === "number" ? parsed.lat : null;
set.exitLon = typeof parsed.lon === "number" ? parsed.lon : null;
set.exitMeasuredAt = new Date();
set.exitError = "";
} catch (e) {
set.exitError = e instanceof Error ? e.message : "查询出口 IP 失败";
}
const existing = await loadVlocRow(ctx);
if (!existing) {
await db.insert(schema.virtualLocationState).values({ id: 1, updatedAt: new Date() });
await db
.update(schema.virtualLocationState)
.set(set)
.where(eq(schema.virtualLocationState.id, 1));
} else {
await db
.update(schema.virtualLocationState)
.set(set)
.where(eq(schema.virtualLocationState.id, 1));
}
ctx.invalidateQueries();
const fresh = await loadVlocRow(ctx);
return toVlocOut(fresh);
},
}),


getGoogleMapsKeyState: defineAction({
description:
  "Returns the Google Maps API key state for the 虚拟位置 globe: whether a key is saved (encrypted server-side; the key itself is NEVER returned here), its last 4 characters for the mask, and the last real Map Tiles API validation result.",
request: z.object({}),
response: gkeyOutSchema,
handler: async (ctx) => {
const row = await loadVlocRow(ctx);
return toGkeyOut(row);
},
}),

saveGoogleMapsKey: defineAction({
description:
  "Saves the user's Google Maps API key for the globe's Google data mode. The key is validated FOR REAL first (a Photorealistic 3D Tiles root request to tile.googleapis.com); only a passing key is stored (AES-256-GCM encrypted) as connected — a failing key is stored as not-connected with Google's real reason, or refused outright when Google says the key itself is invalid. The key never appears in any response.",
request: z.object({
key: z.string().trim().min(10, "Key 太短，不像有效的 Google Maps API Key").max(300),
}),
response: z.object({
ok: z.boolean(),
reason: z.string(),
state: gkeyOutSchema,
}),
privileged: [privileged.fetchWebPage, privileged.vaultEncrypt],
handler: async (ctx, args) => {
const db = ctx.db<typeof schema>();
const check = await validateGoogleMapsKey(ctx, args.key);
const enc = await ctx.executePrivileged(privileged.vaultEncrypt, {
text: args.key,
});
if (!enc.ok) {
return {
ok: false,
reason: enc.error || "Key 加密保存失败",
state: toGkeyOut(await loadVlocRow(ctx)),
};
}
const set = {
gkeyEnc: enc.text,
gkeyLast4: args.key.slice(-4),
gkeyStatus: check.ok ? "ok" : "error",
gkeyError: check.ok ? "" : check.reason,
gkeyCheckedAt: new Date(),
updatedAt: new Date(),
};
const existing = await loadVlocRow(ctx);
if (!existing) {
await db.insert(schema.virtualLocationState).values({ id: 1, updatedAt: new Date() });
}
await db
.update(schema.virtualLocationState)
.set(set)
.where(eq(schema.virtualLocationState.id, 1));
ctx.invalidateQueries();
return {
ok: check.ok,
reason: check.ok ? "" : check.reason,
state: toGkeyOut(await loadVlocRow(ctx)),
};
},
}),

testGoogleMapsKey: defineAction({
description:
  "Re-validates the saved Google Maps API key against the Map Tiles API (Photorealistic 3D Tiles root request) and updates the stored status with the real result.",
request: z.object({}),
response: z.object({
ok: z.boolean(),
reason: z.string(),
state: gkeyOutSchema,
}),
privileged: [privileged.fetchWebPage, privileged.vaultDecrypt],
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const row = await loadVlocRow(ctx);
if (!row?.gkeyEnc) {
return { ok: false, reason: "还没有保存 Key", state: toGkeyOut(row) };
}
const dec = await ctx.executePrivileged(privileged.vaultDecrypt, {
text: row.gkeyEnc,
});
if (!dec.ok || !dec.text) {
return { ok: false, reason: "保存的 Key 解密失败，请清除后重新保存", state: toGkeyOut(row) };
}
const check = await validateGoogleMapsKey(ctx, dec.text);
await db
.update(schema.virtualLocationState)
.set({
gkeyStatus: check.ok ? "ok" : "error",
gkeyError: check.ok ? "" : check.reason,
gkeyCheckedAt: new Date(),
updatedAt: new Date(),
})
.where(eq(schema.virtualLocationState.id, 1));
ctx.invalidateQueries();
return {
ok: check.ok,
reason: check.ok ? "" : check.reason,
state: toGkeyOut(await loadVlocRow(ctx)),
};
},
}),

clearGoogleMapsKey: defineAction({
description: "Clears the saved Google Maps API key server-side; the globe falls back to the free public map data.",
request: z.object({}),
response: gkeyOutSchema,
handler: async (ctx) => {
const db = ctx.db<typeof schema>();
const existing = await loadVlocRow(ctx);
if (existing) {
await db
.update(schema.virtualLocationState)
.set({
gkeyEnc: "",
gkeyLast4: "",
gkeyStatus: "",
gkeyError: "",
gkeyCheckedAt: null,
updatedAt: new Date(),
})
.where(eq(schema.virtualLocationState.id, 1));
}
ctx.invalidateQueries();
return toGkeyOut(await loadVlocRow(ctx));
},
}),

getGoogleMapsKeyForGlobe: defineAction({
description:
  "Returns the decrypted Google Maps API key to the user's own globe session, ONLY when its stored validation status is ok — loading Google tiles from the browser requires the key on the tile requests (that is how the Google Maps platform works); the settings UI itself only ever shows the masked form. Returns an empty key when not connected.",
request: z.object({}),
response: z.object({ key: z.string() }),
privileged: [privileged.vaultDecrypt],
handler: async (ctx) => {
const row = await loadVlocRow(ctx);
if (!row?.gkeyEnc || row.gkeyStatus !== "ok") return { key: "" };
const dec = await ctx.executePrivileged(privileged.vaultDecrypt, {
text: row.gkeyEnc,
});
if (!dec.ok || !dec.text) return { key: "" };
return { key: dec.text };
},
}),

} satisfies ActionsModule;
