// Drizzle schema for this space: chat conversations and their messages.
// Muse is the fixed platform agent; the user can add further agents,
// each backed by its own provider API configuration (same settings
// shape as the multi-agent collaborative space's seats). A conversation
// with agent_id NULL belongs to Muse; otherwise it is a 1:1 chat with
// that agent. The API key lives only in this server-side table and is
// never returned by any action.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default(""),
  color: text("color").notNull().default("#5d6a82"),
  glyph: text("glyph").notNull().default(""),
  // Uploaded avatar image (blob key, bytes in ctx.blobs). NULL =
  // no image: the colour + glyph avatar shows. An image, when set,
  // takes priority over colour/glyph everywhere the agent appears.
  avatarBlobKey: text("avatar_blob_key"),
  enabled: integer("enabled").notNull().default(1),
  provider: text("provider").notNull().default("custom"),
  apiBase: text("api_base").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default(""),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("max_tokens").notNull().default(4096),
  // Advanced OpenAI-compatible API parameters (the 高级 API 参数
  // section of the agent settings; API agents only — web-token
  // agents never read them). NULL / '' means "not set": the
  // parameter is left out of the request entirely, so the
  // provider's own default applies.
  topP: real("top_p"),
  frequencyPenalty: real("frequency_penalty"),
  presencePenalty: real("presence_penalty"),
  seed: integer("seed"),
  // Stop sequences as the user typed them (comma / newline
  // separated); the server splits, trims and caps at 4 entries
  // when building the request's `stop` array.
  stopSequences: text("stop_sequences").notNull().default(""),
  // '' = not set; 'json_object' / 'text' map to the request's
  // response_format { type }.
  responseFormat: text("response_format").notNull().default(""),
  // The reasoning-model replacement for max_tokens: when set,
  // the request sends max_completion_tokens INSTEAD of
  // max_tokens.
  maxCompletionTokens: integer("max_completion_tokens"),
  // Streaming output （流式输出）: 1 = the chat-completions request
  // carries stream:true and the reply is written into its message
  // row chunk by chunk while it generates, so the user watches it
  // appear instead of waiting for the whole reply. API agents
  // only; web-token agents never read it.
  streamEnabled: integer("stream_enabled").notNull().default(0),
  // Tool calling （工具调用）: '' = the request carries no tools
  // at all; 'auto' / 'required' / 'none' are sent verbatim as the
  // request's tool_choice together with the space's built-in tool
  // set (current time, calculator, web-page reader), which the
  // server really executes and feeds back to the model. API
  // agents only.
  toolMode: text("tool_mode").notNull().default(""),
  thinking: text("thinking").notNull().default("默认"),
  systemPrompt: text("system_prompt").notNull().default(""),
  // Legacy long-term memory （长期记忆） text. The settings UI
  // no longer offers it as a separate field — the user judged a
  // hand-written memory a duplicate of the system prompt — so
  // the panels fold any text saved here into system_prompt on
  // the next save and store '' here. The reply context combines
  // both columns (see standingInstructions in actions.ts), so
  // text saved before the merge keeps applying until then. For
  // web-token agents the official account's own memory is a
  // separate thing again: it lives in the account's官网
  // conversations, which each room keeps fixed (see
  // web_remote_conversations).
  memory: text("memory").notNull().default(""),
  // The user's private note about this agent, edited in the agent
  // settings form. Display-only: it is shown in the agent list row
  // in place of the empty-state subtitle and is NEVER part of any
  // prompt, reply context or external API call.
  note: text("note").notNull().default(""),
  // Position in the agent list, shared on one scale with Muse's
  // own sort_order on the muse_settings row: the list renders Muse
  // and the added agents merged by this value (long-press drag
  // reorder rewrites it). 0 = never reordered; ties break Muse
  // first, then by agent id — the historical display order.
  sortOrder: integer("sort_order").notNull().default(0),
  // How this agent is reached: 'api' = the provider API fields
  // above; 'web' = the DeepSeek web token route (chat.deepseek.com),
  // which ignores the API fields entirely.
  connectionType: text("connection_type").notNull().default("api"),
  // The DeepSeek web login token (connectionType 'web' only). Stored
  // ONLY here on the server: no action ever returns it, it is never
  // written into a message, a prompt or a log line.
  webToken: text("web_token").notNull().default(""),
  // Web login state as last verified against DeepSeek's own API:
  // '' = never verified / no token, 'logged_in', 'expired' (the web
  // API rejected the token), 'blocked' (web-side risk control),
  // 'error' (verification itself failed, e.g. network). webAccount
  // is the masked account label DeepSeek's response supports;
  // webError the honest failure reason for the settings panel.
  webStatus: text("web_status").notNull().default(""),
  webAccount: text("web_account").notNull().default(""),
  webError: text("web_error").notNull().default(""),
  // The browser device id for a web-token agent whose site's chat
  // endpoint requires one (Doubao's device_id). It lives only in
  // the browser's local storage — it is in neither the site's
  // Cookie nor the page the site serves — so the user copies it
  // from their own browser's request URL and it is stored here,
  // server-side, and sent as the device_id query parameter on
  // that site's chat calls. '' = not filled in. Unlike the web
  // token it is not a login credential, so actions return it for
  // the settings form to show and edit.
  webDeviceId: text("web_device_id").notNull().default(""),
  // The full browser Cookie string captured together with a web
  // credential bundle （千问's console one-click export carries
  // { token, cookie, ua }): the site's session/risk cookies
  // (cnaui / tfstk / isg / ssxmod…), sent as the Cookie header
  // alongside the Bearer token so the server's calls present the
  // same session the user's browser holds. Stored ONLY here on
  // the server: no action ever returns it — actions surface only
  // whether one is saved (webCookieSet) — and it is never written
  // into a message, a prompt or a log line. '' = none saved.
  webCookie: text("web_cookie").notNull().default(""),
  // The browser User-Agent captured in the same bundle: Qwen's
  // risk control binds the session to the UA that logged in, so
  // the adapter sends this exact string instead of the generic
  // server UA. A UA is not a credential (every browser sends it
  // to every site), so actions return it for the settings panel's
  // alignment check. '' = none saved: the generic UA is used.
  webUserAgent: text("web_user_agent").notNull().default(""),
  // The web product's own chat options, per site (web agents
  // only; API agents never read them). The two sites do NOT share
  // one feature set — each site's settings panel offers only its
  // own web UI's controls, and each chat adapter reads only the
  // fields its site's protocol carries:
  //   DeepSeek (chat.deepseek.com): webMode is the request's
  //     model_type — 'default' （快速模式， V4 Flash) or 'expert'
  //     （专家模式， V4 Pro); webThinking is thinking_enabled
  //     （深度思考 toggle); webSearch is search_enabled
  //     （智能搜索/联网搜索 toggle). The three are independent
  //     and combinable, exactly like the web UI's mode switch
  //     plus its two toggles.
  //   豆包 (www.doubao.com): the adapter no longer reads
  //     webMode — the request's model selection is resolved
  //     from webModelKey / webModel / webReasoning against the
  //     account's detected menu (see doubaoWireSelection).
  //     webMode is still stored for Doubao as the derived
  //     deep-think summary ('fast' / 'expert', see
  //     doubaoDeepThinkSummary) that the classic fallback bodies'
  //     use_deep_think boolean uses — the boolean now comes
  //     from the same thinking gate as the new body (see
  //     doubaoWireSelection). webSearch is the 联网搜索 switch.
  //     webThinking is unused for Doubao: its web UI has no
  //     separate thinking toggle.
  // '' webMode = never set: the adapter falls back to the site's
  // web default (DeepSeek 'default', Doubao 'fast'), with the
  // legacy model-string derivation kept for DeepSeek agents saved
  // before these columns existed (migration 0024 backfills them).
  webMode: text("web_mode").notNull().default(""),
  webThinking: integer("web_thinking").notNull().default(0),
  webSearch: integer("web_search").notNull().default(0),
  // The model-menu selection of a web product whose site has one
  // （豆包 only today): the model picked in the site's own model
  // menu — the menu behind the composer's model button on
  // doubao.com. These two columns are the LEGACY storage: webModel
  // holds '', 'doubao-2.1-lite' or 'doubao-2.1-pro' (the three
  // picks the first menu implementation offered) and webReasoning
  // the 推理强度 as '', 'low', 'medium' or 'high'. The current
  // selection lives in webModelKey / web_menu_json below (any
  // model from the account's detected menu, reasoning stored as
  // the numeric level string); the adapter resolves the legacy
  // pair through the same catalog when webModelKey was never
  // set, so picks saved before the detected menu existed keep
  // meaning exactly what they meant. webReasoning now also
  // accepts the numeric level strings ("3".."7") the detected
  // menu's per-model levels use. chatDoubao builds the request's
  // real selection bundle via doubaoWireSelection (model_item_key
  // in three option locations, the model's own mode_id and
  // model_extra_params from the account's menu config,
  // reasoning_effort, need_deep_think); the derived webMode is
  // kept alongside only as the classic fallback bodies' deep-think
  // summary. An actual change to the selection drops the agent's
  // stored官网 conversations, because the mode bundle is a
  // creation-time routing input.
  webModel: text("web_model").notNull().default(""),
  webReasoning: text("web_reasoning").notNull().default(""),
  // The picked model's wire key (model_item_key, verbatim from
  // the account's own menu config), 豆包 only. '' = never picked
  // by key: the adapter then resolves the legacy webModel above
  // ('' → 自动 "9", lite → "seed-lite-7b", pro → "5"). When set
  // it is authoritative — webModel is kept only as the legacy
  // projection of the same pick. Any model in the account's
  // detected menu can be stored here, including the 对话 models
  // （快速 "0" / 专家 "3") and the 工作任务 third-party models
  // (person-* keys) — the full selection bundle (key, mode_id,
  // model_extra_params, reasoning level) is resolved from the
  // detected catalog below at send time.
  webModelKey: text("web_model_key").notNull().default(""),
  // The account's OWN Doubao model menu, detected from the menu
  // config Doubao's servers embed in the /chat page for this
  // Cookie (menuConfV2) — the same data the official web client
  // renders its model menu from, exactly like an API agent's
  // /models list. JSON: { models: [{ key, name, modeId,
  // agentMode, tags, extraParams, levels: [{level, name}],
  // defaultLevel, needUpgrade }] }. needUpgrade is the config's
  // own subscribe_config.need_upgrade flag (Pro carries it for
  // accounts without a membership — the site itself marks the
  // model as needing an upgrade). '' = never detected: the
  // built-in fallback catalog (the site's standing menu shape)
  // is used until the user runs 识别可用模型 (the
  // detectDoubaoModels action) or it is refreshed alongside a
  // chat call's page fetch.
  webMenuJson: text("web_menu_json").notNull().default(""),
  webMenuAt: integer("web_menu_at", { mode: "timestamp_ms" }),
  // The last Doubao send's full record (豆包 only): when it
  // happened, the parameters the request carried (region,
  // device_id / web_id / msToken / fp presence and sources), the
  // model selection in force, and per attempt the exact URL +
  // request body that was sent and the site's real response
  // digest (HTTP status, its own error code/message, verify
  // flags). Written by chatDoubao on every send and shown in the
  // agent's settings （发送数据诊断）, so the user can see
  // exactly what was sent and what came back. The Cookie itself
  // is never copied into the record — only its field NAMES are
  // derived from it at read time by getDoubaoSendData.
  webLastSendJson: text("web_last_send_json").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("Muse"),
  kind: text("kind", { enum: ["direct", "group"] })
    .notNull()
    .default("direct"),
  agentId: integer("agent_id").references(() => agents.id),
  // 1 = a conversation created from 「新建对话」: it starts with only
  // the user in it (no Muse, no greeting) and replies come from the
  // group_members membership, exactly like a group chat, until agents
  // are added from the chat pane's + member panel.
  memberBased: integer("member_based").notNull().default(0),
  // A group's custom icon: colour + glyph, set from the group
  // settings panel. Both empty = the default group avatar (users
  // glyph on a soft blue tile); once either is set the avatar is a
  // coloured disc showing the glyph, or the group name's first
  // character while no glyph is set.
  iconColor: text("icon_color").notNull().default(""),
  iconGlyph: text("icon_glyph").notNull().default(""),
  // Uploaded group icon image (blob key). NULL = no image: the
  // colour/glyph (or default) group avatar shows; an image takes
  // priority over both.
  avatarBlobKey: text("avatar_blob_key"),
  // 1 while the room's title is still its automatic default
  // (「新对话」 with nobody in, the sole member agent's name, or
  // 「群聊N」 once several agents are in): membership changes keep
  // an automatic title in sync. Saving the room settings panel
  // marks the title user-set (0) and it is never auto-renamed again.
  titleAuto: integer("title_auto").notNull().default(1),
  // The room's stage owner （阶段负责人）: '' = nobody designated;
  // 'muse' = Muse; otherwise the decimal id of an added agent.
  // The owner is a room member the user picked in the room
  // settings to lead the current stage: in each reply round the
  // owner speaks first and coordinates, and the other members are
  // told who leads so they support instead of duplicating the
  // coordination (the Grok Bot guidance: one owner per stage).
  // Changing membership never rewrites this value; an owner who
  // is no longer an enabled member simply has no effect until the
  // user picks another one.
  stageOwner: text("stage_owner").notNull().default(""),
  // 1 = a provisional room: created by the compose button or by
  // tapping an agent row, but the user has not sent anything in it
  // yet. Provisional rooms are hidden from every conversation list
  // (recent chats included) and consume no 「群聊N」 number; the
  // first user message saved in the room flips this to 0 and the
  // room becomes a real, listed conversation. A provisional room
  // the user leaves without sending is deleted outright.
  provisional: integer("provisional").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The Doubao guidance log （指导日志）: one row per Doubao web
// send (one chatDoubao call, however many attempts it ran), kept
// per agent and pruned to the newest 20 rows. Each row records
// what actually happened — the outcome, the HTTP status, the
// response size in bytes, Doubao's own error code/message when it
// sent one, whether the response mentioned verify / shark, and
// how many candidate reply-text segments the parser found — plus
// a short response SUMMARY (a capped excerpt, never the whole
// body) the settings panel can expand. The plain-language
// guidance line shown next to each entry is derived from these
// fields at read time by getDoubaoSendLog, so it always matches
// the recorded facts. The Cookie is never copied into this
// table — no field of it, in whole or in part.
export const doubaoSendLogs = sqliteTable("doubao_send_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id),
  // 'replied' | 'rejected' | 'unparsed' | 'blocked' |
  // 'network_error' | 'cookie_invalid' — see chatDoubao's
  // outcome mapping. A network_error row's error_msg / summary
  // carry the underlying thrown error verbatim (name, message,
  // cause chain, phase reached, elapsed time); a cookie_invalid
  // row names the Cookie fields that failed header validation
  // (field names only — never values).
  outcome: text("outcome").notNull().default(""),
  httpStatus: integer("http_status"),
  responseBytes: integer("response_bytes").notNull().default(0),
  errorCode: integer("error_code"),
  errorMsg: text("error_msg").notNull().default(""),
  hasVerify: integer("has_verify").notNull().default(0),
  hasShark: integer("has_shark").notNull().default(0),
  candidateCount: integer("candidate_count").notNull().default(0),
  payloadCount: integer("payload_count").notNull().default(0),
  summary: text("summary").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Auto-name counter for new groups (singleton row, id = 1): the
// next N for the default group name 「群聊N」. It only ever moves
// forward, so a number freed by deleting a group is never reused
// and two groups never share a default name.
export const groupNumberCounter = sqliteTable("group_number_counter", {
  id: integer("id").primaryKey(),
  nextNumber: integer("next_number").notNull().default(1),
});

// Pioneer VPN state (singleton row, id = 1). Same shape as the
// collaborative space's Pioneer columns: credentials, session token
// and the raw node config live only here on the server; actions expose
// display facts only — never the password, token or node credentials.
export const pioneerState = sqliteTable("pioneer_state", {
  id: integer("id").primaryKey(),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  token: text("token").notNull().default(""),
  deviceId: text("device_id").notNull().default(""),
  account: text("account").notNull().default(""),
  userType: text("user_type").notNull().default(""),
  dueTime: text("due_time").notNull().default(""),
  status: text("status").notNull().default(""),
  error: text("error").notNull().default(""),
  host: text("host").notNull().default(""),
  customHost: text("custom_host").notNull().default(""),
  servers: text("servers").notNull().default("[]"),
  serversAt: integer("servers_at", { mode: "timestamp_ms" }),
  selectedId: integer("selected_id").notNull().default(0),
  selectedName: text("selected_name").notNull().default(""),
  nodeJson: text("node_json").notNull().default(""),
  nodeInfo: text("node_info").notNull().default(""),
  nodeError: text("node_error").notNull().default(""),
  nodeAt: integer("node_at", { mode: "timestamp_ms" }),
  exitJson: text("exit_json").notNull().default(""),
  exitAt: integer("exit_at", { mode: "timestamp_ms" }),
  tunnelJson: text("tunnel_json").notNull().default(""),
  tunnelAt: integer("tunnel_at", { mode: "timestamp_ms" }),
  // Global mode （全局模式）: 1 = every agent request (provider API
  // calls and the web-token adapters alike) is sent through the
  // Pioneer tunnel's local proxy instead of directly, so the
  // agents exit at the selected VPN node. Only takes effect while
  // the tunnel is verified connected; with the tunnel down the
  // requests stay direct and that fact is written to the VPN log
  // (see refreshAgentRoute in actions.ts). 0 = the historical
  // behaviour: agents always connect directly, the tunnel serves
  // only the panel's own exit/purity checks.
  globalMode: integer("global_mode").notNull().default(0),
});

// The VPN log （连接日志）: one row per real Pioneer VPN event —
// login / logout, server-list refreshes, connect and disconnect,
// tunnel establishment outcomes, global-mode changes and purity
// tests — each with the real outcome (a failure row carries the
// real reason). Written by pioneerLog in actions.ts and pruned to
// the newest 100 rows; shown in the VPN panel's 日志 section.
// Nothing is logged that did not happen, and no credential, token
// or node config is ever copied into a row.
export const pioneerLogs = sqliteTable("pioneer_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // 'login' | 'logout' | 'servers' | 'connect' | 'disconnect' |
  // 'global' | 'test'
  kind: text("kind").notNull().default(""),
  message: text("message").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The user's own profile (singleton row, id = 1): display name,
// avatar glyph and avatar colour. Shown as the fixed 「我」 entry at
// the top of the agent list; the name is what the user's messages and
// group membership are labelled with.
export const userProfile = sqliteTable("user_profile", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default(""),
  glyph: text("glyph").notNull().default(""),
  color: text("color").notNull().default("#b9bec7"),
  // Uploaded profile photo (blob key). NULL = no image: the
  // colour + glyph (or silhouette) avatar shows; an image takes
  // priority everywhere the user appears.
  avatarBlobKey: text("avatar_blob_key"),
  // Whether message bubbles show their HH:mm time.
  showTime: integer("show_time").notNull().default(1),
  // Whether a short tone plays when a new reply arrives.
  soundOn: integer("sound_on").notNull().default(0),
  // Whether swipe gestures control navigation: while on, a right
  // swipe anywhere in the space goes back to the previous screen.
  // Off by default; toggled from the space settings panel.
  gestureControl: integer("gesture_control").notNull().default(0),
  // Appearance preferences, edited on the 外观 page of the space
  // settings: the colour theme ('system' follows the device,
  // 'light' / 'dark' force a mode), the UI text size level
  // (1–5, 3 is the default size), and whether long lines in chat
  // messages and text-file previews wrap instead of scrolling
  // sideways.
  themeMode: text("theme_mode").notNull().default("system"),
  fontScale: integer("font_scale").notNull().default(3),
  codeWrap: integer("code_wrap").notNull().default(1),
  // The user's global custom instructions (the 自定义指令 page of
  // the space settings): one standing instruction that applies to
  // EVERY agent in the space — Muse and every added agent alike —
  // unlike each agent's own system prompt, which only affects that
  // one agent. Injected into every reply's system context; empty =
  // no global instruction.
  customInstructions: text("custom_instructions").notNull().default(""),
  // The 自定义指令 page's enable switch: 1 = the saved instructions
  // are injected into replies; 0 = the text is kept on the profile
  // row but treated as if none were set, until the switch is turned
  // back on. Defaults to 1 so instructions saved before the switch
  // existed keep working unchanged.
  customInstructionsEnabled: integer("custom_instructions_enabled")
    .notNull()
    .default(1),
});

// Muse's own settings (singleton row, id = 1). Muse is the fixed
// platform agent — its model and API channel cannot change — but its
// display name, role, avatar colour, thinking level, extra system
// prompt and enabled switch are user-editable, mirroring an added
// agent's settings minus the provider fields.
export const museSettings = sqliteTable("muse_settings", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default("Muse"),
  role: text("role").notNull().default(""),
  color: text("color").notNull().default("#2f6bff"),
  // Uploaded avatar image (blob key). NULL = no image: the script-m
  // mark shows; an image takes priority everywhere Muse appears.
  avatarBlobKey: text("avatar_blob_key"),
  enabled: integer("enabled").notNull().default(1),
  thinking: text("thinking").notNull().default("默认"),
  systemPrompt: text("system_prompt").notNull().default(""),
  // Muse's legacy long-term memory text: same fold-in as the
  // agents table's memory column (see there) — no separate
  // settings field any more; the reply context combines it with
  // system_prompt until the next settings save moves it there.
  memory: text("memory").notNull().default(""),
  // The user's private note about Muse, edited in Muse's settings
  // panel. Display-only, exactly like an added agent's note: shown
  // in the agent list row instead of the empty-state subtitle and
  // NEVER part of any prompt or reply context.
  note: text("note").notNull().default(""),
  // Muse's position in the agent list on the same scale as the
  // agents table's sort_order (see there). 0 = never reordered.
  sortOrder: integer("sort_order").notNull().default(0),
});

// Agent membership of a group conversation. The user is always a
// member of their own groups and needs no row; a row with agent_id
// NULL means Muse (the fixed platform agent) is a member, a row with
// an agent_id means that added agent is. A group with no rows has
// only the user in it and nobody replies there. Groups created before
// this table existed always had Muse as their agent member, so the
// 0006 migration backfills a Muse row for each of them.
export const groupMembers = sqliteTable("group_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  agentId: integer("agent_id").references(() => agents.id),
  // Per-conversation switch (the toggle row at the top of a group
  // chat): a member with enabled = 0 stays in the group but never
  // replies there until switched back on.
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  agentId: integer("agent_id"),
  content: text("content").notNull().default(""),
  // 1 while this assistant message is still being streamed in:
  // its content is the partial reply so far and grows chunk by
  // chunk until the reply completes and the flag flips to 0. A
  // row abandoned mid-stream (the generating action died) stops
  // counting as streaming after a few minutes — see toMessageOut.
  streaming: integer("streaming").notNull().default(0),
  imageBlobKey: text("image_blob_key"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileMime: text("file_mime"),
  // For messages carrying a file: 1 = the user has switched on
  // agent access for this file in the files column, so agents may
  // see it (text content included for text files) in their reply
  // context and may save edits back. 0 = invisible to agents.
  agentAccess: integer("agent_access").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Files uploaded directly in the files column (not sent in a chat).
// The bytes live in ctx.blobs under blob_key; this row is the
// file's identity in the space's file list. agent_access is the
// per-file switch: 1 = agents may browse (and, for text files,
// read and edit) this file; 0 = agents cannot see it at all.
// New uploads start at 0 — access is opt-in per file.
export const spaceFiles = sqliteTable("space_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  size: integer("size"),
  mime: text("mime"),
  blobKey: text("blob_key").notNull(),
  agentAccess: integer("agent_access").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Skills (the 技能 page of the space settings, modelled on the
// Gemini skills UI the user screenshotted): a named, reusable
// instruction set — name, one-line description, and the full
// instruction text. An enabled skill is injected into the reply
// context of the agents it applies to, on top of the global custom
// instructions and each agent's own system prompt. scope 'all'
// applies to every agent in the space; scope 'selected' applies
// only to the agents joined in agent_skills below.
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  scope: text("scope").notNull().default("all"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Which agents a 'selected'-scope skill applies to. A row with
// agent_id NULL means Muse (the fixed platform agent), a row with
// an agent_id means that added agent — the same convention as
// group_members. Rows are meaningless while the skill's scope is
// 'all' and are kept so switching scope back restores the picks.
export const agentSkills = sqliteTable("agent_skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  skillId: integer("skill_id")
    .notNull()
    .references(() => skills.id),
  agentId: integer("agent_id").references(() => agents.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Files attached INTO one specific skill (the 添加文件 button on
// that skill's own edit page opens the 上传文件 dialog; the chosen
// file lands here, on this skill only — it never creates a new
// skill). content is the file's decoded text, captured at upload
// time like file_texts below; when the skill applies to an agent,
// the file contents ride along with the skill's instructions in
// that agent's reply context, so the agent can work from them.
export const skillFiles = sqliteTable("skill_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  skillId: integer("skill_id")
    .notNull()
    .references(() => skills.id),
  name: text("name").notNull().default(""),
  size: integer("size"),
  mime: text("mime"),
  content: text("content").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Decoded text of text-type files (uploads and chat files alike),
// captured when the file enters the space. The blob store has no
// server-side byte read, so this is how previews, agent context
// and agent edits get at a text file's content; an agent edit
// rewrites both the blob bytes and this row.
export const fileTexts = sqliteTable("file_texts", {
  blobKey: text("blob_key").primaryKey(),
  content: text("content").notNull(),
});

// Standing triggers （定时 / 事件触发）: a rule that makes ONE agent
// speak in ONE room without the user sending a message there
// first. kind 'schedule' fires on an interval: the space's
// runDueTriggers action (driven by a 15-minute artifact schedule)
// executes every enabled schedule trigger whose interval has
// elapsed since its last run. kind 'event' with event_type
// 'room_new_message' fires inside sendMessage: when the user
// posts in the trigger's room and the trigger's agent is NOT a
// member of that room (members already reply through membership),
// the agent adds one reply following the trigger's instruction.
// agent_id NULL = Muse, the same convention as group_members.
// last_status / last_error record the most recent execution's
// real outcome ('ok' / 'silent' / 'error' plus the reason), so a
// trigger that cannot reply (agent disabled or unconfigured)
// says so on its settings row instead of failing silently.
export const agentTriggers = sqliteTable("agent_triggers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").references(() => agents.id),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  kind: text("kind").notNull().default("schedule"),
  name: text("name").notNull().default(""),
  instruction: text("instruction").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  // Schedule kind only: how often the trigger fires, in minutes.
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  // Event kind only: which event fires it ('room_new_message').
  eventType: text("event_type").notNull().default(""),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  lastStatus: text("last_status").notNull().default(""),
  lastError: text("last_error").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The mapping from one space room + one web agent to the SINGLE
// conversation that agent's site holds for that room （豆包 and
// DeepSeek). Both sites' web protocols are stateful: a reply can
// continue an existing官网 conversation by sending its id with
// only the new message, instead of creating a fresh conversation
// and re-sending the whole history every time. One row per
// (room, agent): different rooms never share a row, so different
// rooms never share an官网 conversation. The row is created
// from the conversation id the site's own response returns for
// the room's first reply, updated after every successful round,
// and deleted when the site refuses the stored conversation
// (expired, rate-limited or stuck) — the next reply then creates
// a fresh one and stores its id instead. Clearing a room's
// messages or deleting the room/agent deletes the row too: the
// next reply starts a new官网 conversation with the full
// context, exactly like a new chat on the site itself.
// Field use per provider: 豆包 fills every field (conversation
// id, local conversation id, section id, message index);
// DeepSeek uses remote_conversation_id for its chat_session_id
// and last_message_index for the message_id of its last reply
// in that session (the parent_message_id the next completion
// continues from), leaving the Doubao-only fields empty. Until
// this mapping existed for it, DeepSeek used a throwaway session
// per reply (created, answered, deleted), so nothing showed on
// the official site; the user asked for the fixed-conversation
// behaviour, and the account's own memory now rides along with
// these kept conversations.
export const webRemoteConversations = sqliteTable("web_remote_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id),
  provider: text("provider").notNull().default("doubao"),
  remoteConversationId: text("remote_conversation_id").notNull().default(""),
  localConversationId: text("local_conversation_id").notNull().default(""),
  lastSectionId: text("last_section_id").notNull().default(""),
  lastMessageIndex: integer("last_message_index").notNull().default(0),
  // The web_tab_id query parameter of this room's Doubao
  // conversation: generated fresh (a random UUID) when the
  // conversation is created and reused for every follow-up send
  // in the same conversation, exactly like the real web client
  // keeps one tab id per open chat tab. '' = none stored yet
  // (rows saved before this column existed): the next send
  // generates one and stores it with the refreshed mapping.
  webTabId: text("web_tab_id").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
