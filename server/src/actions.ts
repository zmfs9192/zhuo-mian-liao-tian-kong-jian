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
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { privileged } from "@space/privileged";
import * as schema from "./schema";

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
    (filesContext ? `\n\n${filesContext}` : "");
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
  if (uploads.length === 0 && chatRows.length === 0) return "";
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
  const lines: string[] = [
    "【系统附带的文件资料 — 不是用户在对话中输入的消息，不要把这些内容说成是用户讲过的话】用户在文件栏里打开了下面这些文件的访问开关，授权你浏览它们。没有列出的文件你看不到，不要假装知道它们的内容。",
  ];
  if (textParts.length > 0) {
    lines.push(
      "",
      "可以读取和修改的文本文件：",
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
      "修改文件的规则：只有当用户明确要求你修改某个文本文件时，才在回复的最后附上修改块（标记必须原样，不要改动），把修改后的完整文件内容放在标记之间：",
      "[[[FILE_EDIT ref=upload:文件编号]]]",
      "修改后的完整文件内容",
      "[[[/FILE_EDIT]]]",
      "ref 用上面方括号里给出的编号（upload:… 或 chat:…）。系统会把修改保存回文件，并从显示给用户的回复里移除修改块。用户没有要求修改时不要输出修改块；不要修改上面没有列出的文件。",
    );
  }
  return lines.join("\n");
}

const FILE_EDIT_RE =
  /\[\[\[FILE_EDIT ref=(upload|chat):(\d+)\]\]\]\r?\n?([\s\S]*?)\r?\n?\[\[\[\/FILE_EDIT\]\]\]/g;

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
    const source = match[1] as "upload" | "chat";
    const id = Number(match[2]);
    const newContent = match[3] ?? "";
    let blobKey: string | null = null;
    let name = "";
    let mime: string | null = null;
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

// --- VPN log （连接日志） ---
// One row per real Pioneer event, pruned to the newest 100 rows.
// Logging is best-effort by design: a failed log write must never
// break the action that produced the event.
const PIONEER_LOG_KEEP = 100;

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

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

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
  name: string,
  argsJson: string,
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
  agent: AgentRow,
  history: MessageRow[],
  nameOf?: NameOf,
  filesContext = "",
  globalInstructions = "",
  onPartial?: (partial: string) => void | Promise<void>,
  stageContext = "",
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
  const maxTokens = Math.min(Math.max(agent.maxTokens, 1), 32768);
  const maxCompletion =
    agent.maxCompletionTokens != null
      ? Math.min(Math.max(agent.maxCompletionTokens, 1), 131072)
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
    if (agent.toolMode !== "") {
      body.tools = AGENT_TOOLS;
      body.tool_choice = agent.toolMode;
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
        const result = await executeAgentTool(tc.name, tc.args || "{}");
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
type DsValidateResult = { ok: true; accessToken: string; account: string } | DsWebFailure;

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
  if (msgs[0]?.role === "system")
    parts.push(
      `【系统设定 — 由系统附带，不是用户在对话中输入的消息，不要把这些内容说成是用户讲过的话】\n${msgs[0].content}`,
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
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const rawToken = agent.webToken.trim();
  if (!rawToken) return { ok: false, error: "尚未登录 DeepSeek 网页版（未保存令牌）" };
  const validated = await dsValidateToken(rawToken);
  if (!validated.ok) {
    if (validated.kind !== "error")
      await dsMarkWebStatus(ctx, agent.id, validated.kind, validated.error);
    return { ok: false, error: `DeepSeek 网页版令牌验证失败：${validated.error}` };
  }
  await dsMarkWebLoggedIn(ctx, agent.id, validated.account);
  const accessToken = validated.accessToken;

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
  const fresh = await dsCompleteInSession(ctx, agent, accessToken, sessionId, null, prompt);
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

/** One completion inside an existing DeepSeek chat session:
 * PoW challenge + local solve -> completion (SSE) -> parse.
 * parentMessageId null starts the session's first message;
 * otherwise the completion continues from that message. The
 * session is left exactly as DeepSeek keeps it — never deleted. */
async function dsCompleteInSession(
  ctx: Ctx,
  agent: AgentRow,
  accessToken: string,
  sessionId: string,
  parentMessageId: number | null,
  prompt: string,
): Promise<DsCompleteResult> {
  const challengeRes = await dsCallJson("/api/v0/chat/create_pow_challenge", accessToken, {
    target_path: "/api/v0/chat/completion",
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
    targetPath: strField(challengeObj?.target_path) || "/api/v0/chat/completion",
  };
  if (!challenge.challenge) {
    return { ok: false, error: "DeepSeek 网页版未返回 PoW 挑战（接口可能已变更）" };
  }
  const answer = dsSolvePow(challenge);
  if (answer === null) {
    return { ok: false, error: "DeepSeek 网页版 PoW 挑战求解失败（难度过高或算法已变更）" };
  }
  const powResponse = Buffer.from(
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
      model_type: options.modelType,
      prompt,
      ref_file_ids: [],
      thinking_enabled: options.thinkingEnabled,
      search_enabled: options.searchEnabled,
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

function collectMediaFromValue(
  value: unknown,
  opts?: { skipKeys?: string[] },
): WebMediaItem[] {
  const skip = new Set([
    "text_block",
    "brief",
    "poster",
    "cover",
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

async function chatChatgpt(token: string, prompt: string): Promise<WebChatResult> {
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
              content: { content_type: "text", parts: [prompt] },
              metadata: {},
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

async function chatClaude(token: string, prompt: string): Promise<WebChatResult> {
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
          files: [],
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

async function chatGemini(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const boot = await geminiBootstrap(token);
    if ("ok" in boot && boot.ok === false) return { ...boot };
    const b = boot as GeminiBootstrap;
    const inner = JSON.stringify([[prompt], null, null]);
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
let qwenBaxiaCache: { headers: Record<string, string>; at: number } | null =
  null;

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
  if (qwenBaxiaCache && Date.now() - qwenBaxiaCache.at < 4 * 60_000)
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
  qwenBaxiaCache = { headers, at: Date.now() };
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
  return { deviceId, webId, versionCode, pcVersion, region, msToken, fp };
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

async function validateDoubao(token: string): Promise<DsValidateResult> {
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
      return { ok: true, accessToken: token.trim(), account };
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
 * test space's proven end-to-end route): the test space's plain
 * new-unified-protocol body — client_meta + content_block +
 * option + ext, bot_id 7338286299411103781, use_deep_think false
 * / "0", no model bundle, no extra option fields — combined
 * with the browser-aligned fingerprint (see doubaoHeaders and
 * the stable query identifiers in buildDoubaoSendPlan) returned
 * a real reply there at 21:13 the same day, so:
 *   1. the test space's plain body, exactly that shape (the
 *      room's conversation-reuse ids ride in client_meta as
 *      before), unsigned, no msToken in the URL, no a_bogus;
 *   2. the new unified protocol WITH the full selection bundle
 *      (the account-menu pick sent the site's own way), so the
 *      chat window's model switch keeps working — tried when
 *      the plain body fails for a non-verification reason.
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
 * carries the room's stored官网 conversation, all three attempts
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
 * rooms). Used when the agent's Doubao model-menu selection
 * changes: the mode bundle that actually routes the model is
 * sent in full only when a conversation is CREATED (the
 * continuation form omits the conversation_mode markers), and
 * no source has ever verified a mid-conversation model switch
 * being honoured — so a changed selection starts each room's
 * next reply from a fresh官网 conversation created under the
 * new selection, instead of silently continuing the old one
 * and leaving the user with the impression the switch did
 * nothing (the reported bug). */
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
  } = {},
): Promise<DoubaoSendPlan> {
  // Doubao's own web options (NOT DeepSeek's set): the
  // model-menu selection — a model_item_key resolved against
  // the account's own detected menu catalog, plus the
  // 推理强度 level — resolved by doubaoWireSelection into the
  // wire bundle (model_item_key ×3 + the model's own mode_id
  // and model_extra_params + reasoning_effort + the
  // need_deep_think thinking gate). The bundle rides ONLY in
  // the second attempt's body; the first attempt is the Doubao
  // test space's proven plain body, byte-shape identical to it
  // (no bundle, no search/deep-think flags — see plainBody
  // below). 联网搜索 (webSearch) therefore takes effect through
  // the second attempt's body, exactly like the model pick.
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
      { label: "新统一协议直连（plain 请求体，免签名）", url: chatUrl, body: plainBody },
      { label: "新统一协议直连（带模型选择包，免签名）", url: chatUrl, body: bundleBody },
    ],
    params: {
      region: p.region,
      deviceId,
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
  };
}

/** The full record of one Doubao send, as stored on the agent
 * row (agents.web_last_send_json) and shown by
 * getDoubaoSendData: the plan facts plus, per attempt actually
 * run, the exact URL + body that went out and the site's real
 * response digest. Bodies are capped so a very long history
 * prompt cannot bloat the row; the cap is recorded when hit. */
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
  return JSON.stringify({
    at: Date.now(),
    outcome,
    reuse: plan.reuse,
    params: plan.params,
    selection: plan.selection,
    attempts: ran.map(({ attempt, result }) => {
      const { bodyJson, truncated } = cap(attempt.body);
      return {
        label: attempt.label,
        url: attempt.url,
        bodyJson,
        bodyTruncated: truncated,
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
      : "这两条都是只用你保存的 Cookie 的服务端直连（真浏览器代发已按你的要求停用），请求体都是新统一协议：第一条是和豆包测试空间完全一致的 plain 请求体，第二条带当前的模型选择包，聊天框里的模型切换靠它生效。如果全都被拒，说明豆包又改了协议或对这个账号/IP 加强了风控；每次实际发出的完整数据和豆包的真实返回都记在豆包智能体设置的「发送数据诊断」里、「指导日志」里有每次的结果和下一步建议，可以在那里逐项核对。";
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

async function chatMistral(token: string, prompt: string): Promise<WebChatResult> {
  try {
    const res = await webFetchText("https://chat.mistral.ai/api/chat/completions", {
      method: "POST",
      headers: {
        ...mistralHeaders(token),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [{ role: "user", content: prompt }],
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
  lastImage: { dataBase64: string; mimeType: string } | null,
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
        lastImage,
        nameOf,
        filesContext,
        globalInstructions,
        stageContext,
      );
      const applied = await applyFileEdits(ctx, db, raw);
      return { status: "ok", text: applied.text, agentId: null };
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
    const chatter = WEB_CHATTERS[agent.provider];
    if (agent.provider === "deepseek" || !chatter) {
      const wr = await callDeepseekWeb(
        ctx,
        db,
        conversationId,
        agent,
        history,
        nameOf,
        filesContext,
        globalInstructions,
        stageContext,
      );
      if (!wr.ok) return { status: "error", error: wr.error };
      const appliedWeb = await applyFileEdits(ctx, db, wr.text);
      return { status: "ok", text: appliedWeb.text, agentId: agent.id };
    }
    const prompt = buildWebPrompt(
      agent,
      history,
      nameOf,
      filesContext,
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
      const doubaoOpts = {
        menu: doubaoMenuOf(agent),
        modelKey: doubaoSelectedKey(agent),
        reasoning: agent.webReasoning,
        search: agent.webSearch === 1,
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
        if (result.guidanceLog) {
          try {
            const g = result.guidanceLog;
            await db.insert(schema.doubaoSendLogs).values({
              agentId: agent.id,
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
            // Keep only the newest 20 rows for this agent.
            const kept = await db
              .select({ id: schema.doubaoSendLogs.id })
              .from(schema.doubaoSendLogs)
              .where(eq(schema.doubaoSendLogs.agentId, agent.id))
              .orderBy(desc(schema.doubaoSendLogs.id))
              .limit(20);
            const keptIds = new Set(kept.map((r) => r.id));
            const all = await db
              .select({ id: schema.doubaoSendLogs.id })
              .from(schema.doubaoSendLogs)
              .where(eq(schema.doubaoSendLogs.agentId, agent.id));
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
      };
      sr = await chatDoubao(
        agent.webToken.trim(),
        remote
          ? buildWebDeltaPrompt(agent, history, nameOf, filesContext, globalInstructions, stageContext)
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
    } else if (agent.provider === "qwen") {
      // 千问 sends its full aligned credential set — Bearer
      // token + the captured Cookie + the captured browser UA —
      // not the bare token (see the 千问 adapter comment).
      sr = await chatQwen(agent.webToken.trim(), prompt, {
        cookie: agent.webCookie,
        ua: agent.webUserAgent,
      });
    } else {
      sr = await chatter(agent.webToken.trim(), prompt, agent.webDeviceId);
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
    // Generated media the reply carried (any site's pictures,
    // videos, audio or files): download the bytes into the
    // space's own storage now, while the site's signed URLs are
    // fresh, so the reply's message rows can carry them as real
    // attachments.
    const withMedia = await attachReplyMedia(
      ctx,
      label,
      appliedSite.text,
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
    agent,
    history,
    nameOf,
    filesContext,
    globalInstructions,
    onPartial,
    stageContext,
  );
  if (!r.ok) return { status: "error", error: r.error };
  const applied = await applyFileEdits(ctx, db, r.text);
  // Media a multimodal API model generated in its reply (image
  // parts, an audio payload, a file) is stored exactly like web
  // replies' media, so it lands as real message attachments.
  const withMedia = await attachReplyMedia(ctx, label, applied.text, r.media);
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
  lastImage: { dataBase64: string; mimeType: string } | null,
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
      target === null ? lastImage : null,
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

type ProfileRow = typeof schema.userProfile.$inferSelect;

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
    thinking: a.thinking,
    systemPrompt: a.systemPrompt,
    memory: a.memory,
    note: a.note,
    sortOrder: a.sortOrder,
    connectionType: a.connectionType,
    webStatus: a.webStatus,
    webAccount: a.webAccount,
    webError: a.webError,
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
  maxTokens: z.number().int().min(1).max(32768),
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
    .max(131072)
    .nullable()
    .default(null),
  // Streaming output （流式输出）: the request carries stream:true
  // and the reply appears chunk by chunk. Tool calling （工具调用）:
  // '' offers no tools; 'auto' / 'required' / 'none' go out as
  // tool_choice with the space's built-in tool set. Both default
  // to off so older callers stay valid.
  streamEnabled: z.boolean().default(false),
  toolMode: z.enum(["", "auto", "required", "none"]).default(""),
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
      "Returns the user's own profile (display name, avatar glyph, avatar colour, whether message bubbles show their time, whether a tone plays on new replies, whether swipe-gesture navigation is on, the appearance preferences: theme mode, text size level, long-line wrapping, and the global custom instructions with their enable switch) shown as the fixed 「我」 entry in the agent list. The row is created on first read with the user's name.",
    request: z.object({}),
    response: z.object({
      name: z.string(),
      glyph: z.string(),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      showTime: z.boolean(),
      soundOn: z.boolean(),
      gestureControl: z.boolean(),
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
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
        themeMode: (["system", "light", "dark"].includes(p.themeMode)
          ? p.themeMode
          : "system") as "system" | "light" | "dark",
        fontScale: Math.min(5, Math.max(1, p.fontScale || 3)),
        codeWrap: p.codeWrap === 1,
        customInstructions: p.customInstructions,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
      };
    },
  }),

  setAppearance: defineAction({
    description:
      "Saves the appearance preferences from the 外观 page of the space settings: the colour theme mode ('system' follows the device, 'light' / 'dark' force a mode), the UI text size level (1–5, 3 is the default size) and whether long lines in messages and text previews wrap. Stored on the user's profile row alongside the other display preferences.",
    request: z.object({
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number().int().min(1).max(5),
      codeWrap: z.boolean(),
    }),
    response: z.object({
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
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
        })
        .where(eq(schema.userProfile.id, 1));
      ctx.invalidateQueries();
      return {
        themeMode: args.themeMode,
        fontScale: args.fontScale,
        codeWrap: args.codeWrap,
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
      themeMode: z.enum(["system", "light", "dark"]),
      fontScale: z.number(),
      codeWrap: z.boolean(),
      customInstructions: z.string(),
      customInstructionsEnabled: z.boolean(),
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
        themeMode: (["system", "light", "dark"].includes(p.themeMode)
          ? p.themeMode
          : "system") as "system" | "light" | "dark",
        fontScale: Math.min(5, Math.max(1, p.fontScale || 3)),
        codeWrap: p.codeWrap === 1,
        customInstructions: p.customInstructions,
        customInstructionsEnabled: p.customInstructionsEnabled === 1,
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
      "Executes every enabled schedule trigger whose interval has elapsed since its last run (a never-run trigger is due immediately), at most five per call, each producing a real reply from its agent in its room and recording the outcome on the trigger row. Driven by the space's 15-minute artifact schedule; event triggers are not run here — they fire inside sendMessage.",
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
    }),
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
      if (results.length > 0) ctx.invalidateQueries();
      return { ran: results.length, results };
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
          agentAccess: f.agentAccess === 1,
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
          agentAccess: row.agentAccess === 1,
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
      "Flips one file's agent-access switch (source 'upload' = a files-column upload, 'chat' = a file sent in a chat). On = agents may browse the file (text files: read its content and save edits back; other types: name/type/size only). Off = the file is invisible to agents. The state is stored server-side and persists.",
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
        await db
          .update(schema.spaceFiles)
          .set({ agentAccess: args.access ? 1 : 0 })
          .where(eq(schema.spaceFiles.id, args.id));
      } else {
        await db
          .update(schema.messages)
          .set({ agentAccess: args.access ? 1 : 0 })
          .where(eq(schema.messages.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true, agentAccess: args.access };
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
      "Batch-flips the agent-access switch for several files at once (the files column's manage mode: grant or revoke agent access for the whole selection). Same per-file semantics as the single switch.",
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
          await db
            .update(schema.spaceFiles)
            .set({ agentAccess: args.access ? 1 : 0 })
            .where(eq(schema.spaceFiles.id, item.id));
        } else {
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
      const marker = "/blobs/";
      const idx = args.url.lastIndexOf(marker);
      if (idx < 0) throw new Error("图片地址无效，无法预览");
      const encoded = (args.url.slice(idx + marker.length) ?? "").split(
        /[?#]/,
      )[0];
      let key = "";
      try {
        const b64 = (encoded ?? "").replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        key = atob(padded);
      } catch {
        key = "";
      }
      if (!key || key.startsWith("/") || key.includes("..")) {
        throw new Error("图片地址无效，无法预览");
      }
      const r = await ctx.executePrivileged(privileged.readBlobPreview, {
        key,
        maxDim: args.variant === "thumb" ? 360 : 1440,
      });
      if (!r.ok) throw new Error(r.error || "图片读取失败");
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
      "Returns everything the space actually sends to Doubao for one web-token Doubao agent, for the settings panel's 发送数据诊断: the stored Cookie's field NAMES (never its values) with the login-critical fields flagged present/missing; the send plan the SAME builder chatDoubao sends with (per attempt: label, full URL with query parameters, full request body — built with a placeholder message text, since the real body carries the room's current prompt); the model selection and recovered request parameters (region, device_id and its source, web_id / msToken / fp presence, client versions); and the last real send's stored record verbatim (web_last_send_json: per attempt the exact URL + body that went out and the site's real response digest). Nothing is sent to Doubao by this action except the /chat page read doubaoRequestParams already makes when recovering parameters.",
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
      "Returns the newest 20 Doubao guidance-log entries for one web-token Doubao agent, for the settings panel's 指导日志 next to 发送数据诊断: per send the time, outcome (replied / rejected / unparsed / blocked / network_error / cookie_invalid), HTTP status, response byte count, Doubao's own error code/message, verify/shark flags, the parser's candidate-text count and payload count, a capped response summary the panel can expand, and a plain-language guidance line derived from the recorded outcome and error code that says what to do next. A network_error entry's recorded message is the underlying thrown error verbatim (name, message, cause chain, the phase the send had reached and the elapsed time), not a fixed sentence. The log is written by the send path itself (one row per send, pruned to 20); the Cookie is never part of it — no field of this action touches it.",
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

  sendMessage: defineAction({
    description:
      "Saves the user's message (text and/or one attachment — an image or a generic file), asks Muse for a real reply with full history context, saves and returns both messages. On reply failure returns ok:false with the saved user message so the client can offer retry. Saving this first user message is also what makes a provisional room permanent (and takes its 「群聊N」 number if its title is still the placeholder).",
    request: z.object({
      conversationId: z.number().int().positive(),
      text: z.string().max(4000).default(""),
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
      let lastImage: { dataBase64: string; mimeType: string } | null = null;
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
        if (args.image) lastImage = args.image;
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
          lastImage,
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
        lastImage,
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
      const convRows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId));
      const conv = convRows[0];
      if (conv?.kind === "group" || conv?.memberBased === 1) {
        const group = await produceGroupReplies(ctx, db, args.conversationId, null);
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
        null,
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
        out.push(
          toAgentOut(
            a,
            conv?.id ?? null,
            preview,
            previewAt,
            await resolveAvatarUrl(ctx, a.avatarBlobKey),
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
      // A changed Doubao model-menu selection drops the agent's
      // stored官网 conversations, so the next reply in every
      // room starts a fresh one under the new selection (the
      // mode bundle is a creation-time routing input — see
      // clearWebRemoteForAgent).
      if (
        args.provider === "doubao" &&
        (existing.webModel !== webModel ||
          existing.webModelKey !== webModelKey ||
          existing.webReasoning !== webReasoning)
      ) {
        await clearWebRemoteForAgent(db, "doubao", args.agentId);
      }
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
      "Saves only one web-token agent's web chat options (webMode / webThinking / webSearch, plus 豆包's model-menu selection webModelKey / webReasoning) from the chat window's web toolbar under the composer — the quick switch that mirrors that site's own web UI (DeepSeek: 快速/专家 mode plus independent 深度思考 and 智能搜索 switches; 豆包： the account's own model menu — every model its detected menu lists, with that model's own 推理强度 levels — and its 联网搜索 switch). The values land on the same agents-table fields the settings panel edits, so the toolbar and the settings panel always show the same saved state, and the site's chat adapter reads them on the next reply. For 豆包 the adapter builds the request's real selection bundle from the pick resolved against the account's detected menu catalog (see doubaoWireSelection), the stored webMode is still re-derived alongside as the classic fallback bodies' deep-think summary (see doubaoDeepThinkSummary), a pick the account's own config marks as needing a membership upgrade is refused with that reason, and an actual selection change drops the agent's stored官网 conversations so the next reply starts a fresh one under the new selection. API agents are rejected: they have no web options and show no toolbar.",
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
      const selectionChanged =
        agent.provider === "doubao" &&
        (agent.webModelKey !== webModelKey ||
          agent.webModel !== webModel ||
          agent.webReasoning !== webReasoning);
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
      // A changed Doubao model-menu selection drops the agent's
      // stored官网 conversations, so the next reply in every
      // room starts a fresh one under the new selection (the
      // mode bundle is a creation-time routing input — see
      // clearWebRemoteForAgent). Toggling 联网搜索 alone does
      // not count: the search flag rides on every message.
      if (selectionChanged) {
        await clearWebRemoteForAgent(db, "doubao", agent.id);
      }
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
      "Saves (when a new one is pasted) and verifies one web-token agent's login token with a real call to its own site's web API (the validator for the agent's provider/site — DeepSeek, ChatGPT, Claude, Gemini, Grok, Kimi, 千问, 豆包, 元宝, 智谱清言, Mistral or 文心一言 — each with its own endpoint and token shape). The token is stored server-side only and never returned; the response carries only the resulting login state: ok, status (logged_in / expired / blocked / error / ''), the masked account label and the honest failure reason. An empty token verifies the already-stored one. For 千问 the paste may be the console one-click credential bundle (a JSON object with token, cookie and ua): the three parts are stored separately server-side and every verify/chat call then sends them aligned (Bearer + Cookie header + the captured browser User-Agent); a Cookie token= pair, when present and different, wins over the bundle's token field.",
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
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      ok: boolean;
      status: string;
      account: string;
      error: string;
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
        return { ok: false, status: agent.webStatus, account: maskWebAccount(agent.webAccount), error: "请先粘贴令牌" };
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
        ctx.invalidateQueries();
        return { ok: true, status: "logged_in", account, error: "" };
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
        };
      }
      await db
        .update(schema.agents)
        .set({ webStatus: v.kind, webError: v.error, webAccount: "" })
        .where(eq(schema.agents.id, args.agentId));
      ctx.invalidateQueries();
      return { ok: false, status: v.kind, account: "", error: v.error };
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
description: "Returns the Pioneer VPN log: the newest 100 recorded events (login, logout, server-list refreshes, connect/disconnect, tunnel outcomes, global-mode changes, purity tests), newest first, each with its real outcome. No credentials, tokens or node configs are ever part of a log row.",
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
.limit(PIONEER_LOG_KEEP);
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
} satisfies ActionsModule;
