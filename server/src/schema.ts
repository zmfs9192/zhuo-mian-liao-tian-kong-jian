// Drizzle schema for this space: chat conversations and their messages.
// Muse is the fixed platform agent; the user can add further agents,
// each backed by its own provider API configuration (same settings
// shape as the multi-agent collaborative space's seats). A conversation
// with agent_id NULL belongs to Muse; otherwise it is a 1:1 chat with
// that agent. The API key lives only in this server-side table and is
// never returned by any action.

import {
integer,
real,
sqliteTable,
text,
type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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
  // Host permissions （主机权限）, granted per agent by the user in
  // the agent settings — both default OFF and are independent:
  // canExecLinux lets this agent really run Linux commands on
  // this host (API agents via the run_linux_command tool, web /
  // platform agents via the LINUX_CMD block protocol — see
  // actions.ts); canEditFiles lets it list / read / write text
  // files on the host under ~/workspace, ~/memory and /tmp
  // (sensitive paths — ssh/aws/gnupg keys, .env, the vault key —
  // are refused in the privileged layer). This is the HOST
  // filesystem, distinct from the per-file agent_access switches
  // in the files column, which govern the space's own files.
  canExecLinux: integer("can_exec_linux").notNull().default(0),
  canEditFiles: integer("can_edit_files").notNull().default(0),
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
  // Account-identity guard for web-token agents (added after the
  // two-Doubao-agents-one-account incident): when a credential is
  // verified, the site ITSELF reports which account it belongs to
  // (Doubao: the user_id embedded in the /chat page it serves for
  // that Cookie; other sites: the account id/label their own API
  // returns). A SHA-256 hash of that identity (provider-scoped) is
  // stored here, plus a hash of the credential itself. Neither
  // hash is ever returned by an action; they exist so the space
  // can (a) detect two agents of the same site whose credentials
  // resolve to the SAME account — the silent failure behind the
  // incident, where the second agent's pasted Cookie bundle had
  // been copied from a browser session still sitting on the first
  // account — warn about it persistently, and enforce it ONLY on
  // a live re-check: since 2026-11-21 a stored collision never
  // blocks a send by itself; each send first re-validates the
  // involved credentials against the site and is refused only
  // when that live check confirms the same account (a check
  // that cannot judge never counts as a collision), and (b) notice when
  // one agent's account identity CHANGES, at which point the old
  // account's stored官网 conversation continuations (and a Doubao
  // agent's detected menu, which is account-specific) are dropped
  // instead of being carried into the new account. '' = never
  // recorded (the site reported no identity, or not yet verified
  // since this guard shipped).
  webIdentityHash: text("web_identity_hash").notNull().default(""),
  webCredentialHash: text("web_credential_hash").notNull().default(""),
  // When the site last gave a DEFINITIVE answer about this
  // credential (a verification, the identity refresh, or the
  // live re-check a send runs when a stored collision is on
  // record): the settings panel shows it next to webAccount so
  // the user can see the account label they are looking at is
  // what the site reported at that moment, not an old record.
  // NULL = never definitively checked. A transport failure does
  // not set it — a failed check proves nothing about the account.
  webCheckedAt: integer("web_checked_at", { mode: "timestamp_ms" }),
  // The account id the site itself reported for this credential
  // at the last definitive check (Doubao: the user_id its
  // passport account-info endpoint returns for THIS agent's own
  // Cookie; other sites: their validator's account id when they
  // expose one). '' = the site reported no id (the guard then
  // works from the label hash alone, and an unknown identity
  // never forms a collision). Stored unhashed because the
  // settings panel shows it to the user — it is their own
  // account's id on their own agent.
  webAccountId: text("web_account_id").notNull().default(""),
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
  // The FULL credential bundle captured by the space's Chrome
  // extension （账号导入）: the extension's export JSON verbatim —
  // every cookie (HttpOnly included), localStorage,
  // sessionStorage, the browser UA and any site-specific extra
  // (e.g. ChatGPT's session accessToken) — stored ONLY here on
  // the server when the user imports through the 账号导入 page.
  // No action ever returns it; the derived fields (webToken /
  // webCookie / webUserAgent / webDeviceId) are what the chat
  // adapters actually send, and this raw copy keeps everything
  // the extension captured available for a future re-derivation
  // without asking the user to re-capture. '' = never imported
  // through the extension page. webImportAt is when it landed.
  webImportJson: text("web_import_json").notNull().default(""),
  webImportAt: integer("web_import_at", { mode: "timestamp_ms" }),
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
  // outcome mapping. The async-video collection writes three
  // outcomes of its own into the same log: 'collect_registered'
  // (a reply announced a video generation; a pending watch was
  // registered), 'collected' (the later-pushed media was
  // downloaded into the room) and 'collect_expired' (2 hours
  // without a collectable message; the watch stopped). A network_error row's error_msg / summary
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
  // Menu spacing (the 间距 page of the space settings): while
  // menuTight is on, the sidebar menu tiles lay out at their
  // own content width packed against each other (a few px
  // apart) instead of being stretched evenly across the rail,
  // so neighbouring icons sit tight together with no large
  // blank margins at the edges. Off (default) = the even
  // full-width grid, unchanged.
  menuTight: integer("menu_tight").notNull().default(0),
  // Recent-chats spacing (the 间距 page of the space settings):
  // the 最近聊天栏's OWN tight-spacing switch, fully independent
  // of menuTight above — while on, recent-chat rows pack
  // compactly (smaller padding and gaps); while off they keep
  // their roomy spacing. Changing either switch never touches
  // the other栏's spacing. Off (default) = the roomy rows.
  recentTight: integer("recent_tight").notNull().default(0),
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
  // Column resizing (the 窗口大小 page of the space settings):
  // while columnResize is on, the desktop layout shows drag
  // handles on the right edges of the sidebar （菜单栏） and the
  // second column （智能体列表栏）, and dragging them stores the
  // two widths here (pixels, clamped server-side). The widths
  // apply whether or not the switch is on; the switch only
  // controls whether the handles appear. Defaults are the
  // long-standing fixed widths (264 / 280).
  columnResize: integer("column_resize").notNull().default(0),
  railWidth: integer("rail_width").notNull().default(264),
  listWidth: integer("list_width").notNull().default(280),
  // The 最近聊天栏's own size: it lives INSIDE the sidebar under
  // the nav, so its independent dimension is its height — while
  // resizing is on, a horizontal drag handle above the 最近聊天
  // header sets how tall the recent-chats region is (pixels,
  // clamped 140–640, default 320). While off, the region simply
  // fills the sidebar's remaining height as before.
  recentHeight: integer("recent_height").notNull().default(320),
  // The 菜单栏's own height inside the sidebar (pixels, clamped
  // 120–560): set by long-press dragging the boundary strip
  // between the 菜单栏 and the 最近聊天栏. 0 = automatic — the
  // menu sizes to its content (capped at 58% of the sidebar).
  // The 最近聊天栏 is NOT positioned from a stored coordinate:
  // it always sits in flow directly below the menu's current
  // height and fills the remaining sidebar height, so a stored
  // recent height no longer places it; recent_height above is
  // kept only for backward compatibility with older saves.
  menuHeight: integer("menu_height").notNull().default(0),
  // The sidebar menu's custom order (the user long-press-drags
  // menu entries to rearrange them): a JSON array of menu keys
  // (agents / creation / code / image / browser / monitor /
  // ledger / files / vpn). Empty = the built-in default order;
  // reads sanitize it (unknown keys dropped, missing keys
  // appended in default order), so a menu entry added later
  // still appears for users with a saved order.
  menuOrder: text("menu_order").notNull().default(""),
  // The additional gestures (the 手势控制 page of the space
  // settings): each has its OWN switch, stored here, all off by
  // default, and each is completely inert while its switch is
  // off. They sit alongside — and independent of — the original
  // gestureControl switch (right-swipe back), which is unchanged.
  // Pinch zoom scales chat text, images and canvases (the size
  // is remembered per surface); double-tap zoom toggles a
  // surface between zoomed and normal; a two-finger horizontal
  // swipe switches conversation; a long press opens the row
  // menu; a three-finger horizontal swipe switches section.
  gesturePinchZoom: integer("gesture_pinch_zoom").notNull().default(0),
  gestureDoubleTapZoom: integer("gesture_double_tap_zoom")
    .notNull()
    .default(0),
  gestureTwoFingerSwipe: integer("gesture_two_finger_swipe")
    .notNull()
    .default(0),
  gestureLongPressMenu: integer("gesture_long_press_menu")
    .notNull()
    .default(0),
  gestureThreeFingerSwipe: integer("gesture_three_finger_swipe")
    .notNull()
    .default(0),
});

// The workspace state snapshot (singleton row, id = 1): one JSON
// document holding everything the client needs to restore the
// space exactly as the user left it — window layout (pane zoom
// scales; column widths and the menu order live on the profile
// row), the open section / workspace pane / current conversation,
// scroll positions, unsent composer drafts per conversation, the
// browser's open tabs, the prompt canvas's chosen tags and view,
// the code pane's open tabs and unsaved buffers, and the drawing
// pad's unsaved layers. Written (debounced) by the client
// whenever any of it changes and read once on entry, so leaving
// and re-entering — on any device — restores the same state.
// Password plaintext NEVER enters this snapshot: the vault keeps
// its own AES-256-GCM storage and the browser tabs store only
// URLs, never page content or typed credentials.
export const workspaceState = sqliteTable("workspace_state", {
  id: integer("id").primaryKey(),
  state: text("state").notNull().default(""),
  updatedAt: integer("updated_at").notNull().default(0),
});

// Free proxies （免费代理）: the proxies that passed THIS
// server's own live test in the latest refresh round — and
// only those. Every refresh replaces the whole table with the
// new round's passers, so a proxy that has died disappears on
// its own. Columns carry exactly what was measured or what the
// source reported: protocol, country (name + code as reported),
// the latency OUR test measured, the anonymity level the
// source reported ('' = unreported), a transparent confidence
// score computed from those real fields, the source names that
// listed it, and when our test last passed it.
export const freeProxies = sqliteTable("free_proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  protocol: text("protocol").notNull().default("http"),
  host: text("host").notNull().default(""),
  port: integer("port").notNull().default(0),
  country: text("country").notNull().default(""),
  countryCode: text("country_code").notNull().default(""),
  latencyMs: integer("latency_ms").notNull().default(0),
  anonymity: text("anonymity").notNull().default(""),
  confidence: integer("confidence").notNull().default(0),
  sources: text("sources").notNull().default(""),
  lastCheckedAt: integer("last_checked_at").notNull().default(0),
});

// Free-proxy state (singleton row, id = 1). DORMANT: the
// free-proxy feature was removed at the user's request
// (2026-11-21) — no pane, no actions, no scheduled refresh,
// and the in-space browser no longer routes through it. The
// free_proxies / free_proxy_state tables stay in place as
// dormant data, like the removed 红果/办公 tables before them.
export const freeProxyState = sqliteTable("free_proxy_state", {
  id: integer("id").primaryKey(),
  activeKey: text("active_key").notNull().default(""),
  refreshedAt: integer("refreshed_at").notNull().default(0),
  testedCount: integer("tested_count").notNull().default(0),
  passedCount: integer("passed_count").notNull().default(0),
});

// Browser capture （抓包） records: the network requests the
// IN-SPACE BROWSER itself makes, recorded where they happen —
// the server-side page fetches and downloads the browser shell
// asks this server for. capId ties rows to one browser pane
// instance + tab ("<session>:<tabId>") so the capture panel
// shows the current tab's traffic only. Requests the fetched
// page makes on its own (subresources, fetch/XHR) never pass
// through this server; the page's injected probe reports those
// to the shell directly and they are NOT stored here. Nothing
// about the device's or other apps' traffic exists in this
// table — it cannot be seen from here at all.
export const browserCapture = sqliteTable("browser_capture", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capId: text("cap_id").notNull().default(""),
  ts: integer("ts").notNull().default(0),
  method: text("method").notNull().default("GET"),
  url: text("url").notNull().default(""),
  kind: text("kind").notNull().default("document"),
  status: integer("status").notNull().default(0),
  size: integer("size").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  contentType: text("content_type").notNull().default(""),
  // Detail-view payloads (migration 0065), JSON/text as
  // recorded: request headers, response headers (name/value
  // pair arrays), the request body (form posts), a capped
  // response-body preview, and the timing segments object —
  // each exactly what was measured or received, empty when
  // the fetch could not produce it.
  reqHeaders: text("req_headers").notNull().default(""),
  resHeaders: text("res_headers").notNull().default(""),
  reqBody: text("req_body").notNull().default(""),
  resBody: text("res_body").notNull().default(""),
  timings: text("timings").notNull().default(""),
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
  // Muse's own host permissions — the same two switches the
  // added agents carry (see the agents table): executing Linux
  // commands and editing host files, both off by default and
  // granted per agent in its settings panel.
  canExecLinux: integer("can_exec_linux").notNull().default(0),
  canEditFiles: integer("can_edit_files").notNull().default(0),
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
// Pending async-media collections for Doubao （视频补收）: one
// row per (room, Doubao agent) where a reply announced a video
// generation but the video itself was not in that reply —
// Doubao generates videos asynchronously and pushes the finished
// video into the same官网 conversation minutes to tens of
// minutes later as a NEW assistant message, which the send-time
// stream never sees. The row snapshots the官网 conversation's
// message ids at registration time (baseline_ids JSON); the
// space's 15-minute runDueTriggers polls the conversation's
// history (POST /im/chain/single) and collects the first new
// assistant message carrying media into the room through the
// normal reply-media path. status: 'pending' → 'collected'
// (media stored in the room) or 'expired' (2 hours without a
// collectable message). last_error records the most recent
// poll's real failure so a stuck row says why.
export const doubaoPendingMedia = sqliteTable("doubao_pending_media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id),
  remoteConversationId: text("remote_conversation_id").notNull().default(""),
  // JSON array of the官网 message ids present when the watch
  // was registered. Empty = the registration snapshot fetch
  // failed; polls then fall back to comparing message
  // create_time against the row's created_at.
  baselineIds: text("baseline_ids").notNull().default("[]"),
  // The newest assistant message at registration (the
  // announcement reply itself): if it later gains media in
  // place, that media is collectable too.
  baselineLastAssistantId: text("baseline_last_assistant_id").notNull().default(""),
  baselineLastAssistantMedia: integer("baseline_last_assistant_media")
    .notNull()
    .default(0),
  status: text("status").notNull().default("pending"),
  checks: integer("checks").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The space's own version record: exactly one row per shipped
// update of this space, appended by the update itself (the seed
// migration backfilled the history from the space's documented
// update log; every later update adds its own row the same way).
// The newest row is the 当前版本 shown in the settings list; the
// settings version page lists every row newest-first with its
// brief change summary. Rows are never edited or deleted — the
// table is the space's update history, not a settings store.
export const spaceVersions = sqliteTable("space_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Display label of the version, e.g. "v74".
  version: text("version").notNull().default(""),
  // Short headline of what the update was.
  title: text("title").notNull().default(""),
  // Brief summary of the update's changes (one or two lines).
  summary: text("summary").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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

// ---------------- 创作 (prompt notebook) ----------------
// The 创作 workspace's GENERATION was removed at the user's
// direction on 2026-11-21: the workspace is now only the prompt
// notebook (prompt_notes below) — hand-written prompt records
// with a style-reference field, nothing generated. The
// creation_members / creation_messages / creation_images /
// creation_settings tables stay in the schema untouched: rows
// the user generated earlier are their data and are not
// deleted; no code reads or writes them any more.

// Who is in the creation workspace. A row with agent_id NULL
// means Muse (the fixed platform agent), a row with an agent_id
// means that added agent — the same convention as group_members.
export const creationMembers = sqliteTable("creation_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").references(() => agents.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row of the creation feed. A user row is one prompt the user
// sent (params_json snapshots the generation settings it went out
// with); an assistant row is ONE member's result for one prompt:
// its generated images live in creation_images, and when the
// generation failed the row carries the real failure reason in
// error (and no images) — a member that cannot generate never
// produces a fake picture. params_json on an assistant row
// snapshots the settings AS APPLIED to that member (its resolved
// model included), so the caption under a result says what
// actually generated it.
export const creationMessages = sqliteTable("creation_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  agentId: integer("agent_id").references(() => agents.id),
  content: text("content").notNull().default(""),
  error: text("error").notNull().default(""),
  paramsJson: text("params_json").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The generated images of one creation assistant message. The
// bytes live in ctx.blobs under blob_key; width / height are the
// pixel size the provider actually returned when it could be
// read (b64 payloads are measured on decode), else NULL.
export const creationImages = sqliteTable("creation_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id")
    .notNull()
    .references(() => creationMessages.id),
  blobKey: text("blob_key").notNull(),
  mime: text("mime").notNull().default("image/png"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The creation composer's generation settings (singleton row,
// id = 1): they persist server-side so the pane reopens with the
// settings the user last used. ratio is one of the composer's
// aspect-ratio keys ('1:1', '3:2', '2:3', '4:3', '3:4', '16:9',
// '9:16'); size_tier is the requested long edge in pixels (1024 /
// 1536 / 2048); count is how many images each member generates
// (1–4); quality is passed through to providers that accept one
// ('' = not sent, the provider's own default applies); model is
// an optional image-model override for API members ('' = each
// agent's own configured model); negative_prompt is sent only
// when non-empty.
export const creationSettings = sqliteTable("creation_settings", {
  id: integer("id").primaryKey(),
  ratio: text("ratio").notNull().default("1:1"),
  sizeTier: integer("size_tier").notNull().default(1024),
  count: integer("count").notNull().default(1),
  quality: text("quality").notNull().default(""),
  model: text("model").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The prompt notebook （提示词记录） — since 2026-11-21 the
// whole content of the 创作 workspace: prompts the user records
// by hand, each with a title, the prompt text, and a
// style-reference note （风格参考） describing the look the
// prompt aims at. Purely the user's own notes: nothing here is
// generated or sent anywhere; the pane offers copy-to-clipboard
// so a recorded prompt can be pasted into any chat.
export const promptNotes = sqliteTable("prompt_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  style: text("style").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The prompt-tag tree （提示词标签树） behind the 创作 infinite
// canvas: a professional prompt structure stored as a flat
// parent-linked tree. The single root row (parent_id NULL) is
// 「提示词」; its children are the top-level categories （主体 /
// 外貌 / 服饰 / 动作姿态 / 场景 / 时间天气 / 构图 / 镜头 / 光线 /
// 色彩 / 风格 / 画质细节 / 负面提示词）, each with sub-groups and
// leaf tags. A node's `value` is the prompt fragment the tag
// contributes when chosen on the canvas (usually the English
// prompt text); `label` is the display name. The built-in
// taxonomy is seeded once (see prompt_tree_state) from
// promptTagsData.ts at the user's explicit request for a
// complete initial tag set; afterwards every row is the user's
// own — double-click edits, added children and deletions all
// persist here and are never re-seeded or overwritten.
export const promptTags = sqliteTable("prompt_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id").references(
    (): AnySQLiteColumn => promptTags.id,
  ),
  label: text("label").notNull().default(""),
  value: text("value").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton (id = 1) bookkeeping for the prompt-tag tree: whether
// the built-in taxonomy has been seeded. Kept apart from the tag
// rows themselves so a user who deletes every tag does not get
// the built-ins back on the next read.
export const promptTreeState = sqliteTable("prompt_tree_state", {
  id: integer("id").primaryKey(),
  seeded: integer("seeded").notNull().default(0),
});

// ---------------- 内置浏览器 (in-space browser) ----------------
// The space's own browser （左侧栏「浏览器」): pages are fetched
// server-side and rendered inside the space, and every web link
// in the space (chat replies, files, anywhere) opens here in a
// new tab instead of the device's browser. History, bookmarks
// and the download log persist server-side; open tabs and their
// per-tab back/forward stacks are client state.

export const browserHistory = sqliteTable("browser_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().default(""),
  title: text("title").notNull().default(""),
  visitedAt: integer("visited_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const browserBookmarks = sqliteTable("browser_bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().default(""),
  title: text("title").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const browserDownloads = sqliteTable("browser_downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().default(""),
  name: text("name").notNull().default(""),
  size: integer("size").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The in-space browser's cookie jar (migration 0070): cookies
// that sites set through the space's server-side fetches are
// kept here, per cookie domain, and sent back on later fetches
// for matching hosts — this is what lets a site stay logged in
// inside the space across pages and visits. Values live only
// server-side; the page itself only ever sees its non-HttpOnly
// cookies through the injected document.cookie shim. expiresAt
// is epoch ms; NULL = session cookie (kept until the jar entry
// is replaced or the row is pruned by an expired write).
export const browserCookies = sqliteTable("browser_cookies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  domain: text("domain").notNull().default(""),
  name: text("name").notNull().default(""),
  value: text("value").notNull().default(""),
  path: text("path").notNull().default("/"),
  expiresAt: integer("expires_at"),
  secure: integer("secure").notNull().default(0),
  httpOnly: integer("http_only").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

// Per-origin Web Storage (localStorage) for pages in the
// in-space browser (migration 0070): the frame runs on an
// opaque origin where real localStorage throws, so the
// injected bootstrap keeps an in-page store seeded from these
// rows and reports changes back; without this, most modern
// sites crash at boot before they can render anything.
export const browserPageStorage = sqliteTable("browser_page_storage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  origin: text("origin").notNull().default(""),
  key: text("key").notNull().default(""),
  value: text("value").notNull().default(""),
  updatedAt: integer("updated_at").notNull().default(0),
});

// The in-space browser's own settings (migration 0074,
// compat columns added in 0076), singleton (id = 1).
// deviceMode is the device identity the browser presents to
// websites — 'desktop' （电脑）, 'android' （安卓） or 'ios'
// （苹果）: the server-side page fetches send that device's
// User-Agent and client hints, and the injected bootstrap
// makes the page's own scripts see the same identity through
// navigator, so a site serves and renders its 电脑版 /
// 安卓版 / 苹果版 consistently instead of mixing a desktop
// fetch with the phone's real navigator (which made some sites
// flash their page and then cover it with a mobile app-guide
// black overlay). customUserAgent (0076), when non-empty,
// overrides the device profile's User-Agent on every fetch
// and in the bootstrap's navigator — the 操作一 compat fix
// stores the standard desktop Chrome UA there. cookiesEnabled
// (0076) gates the whole server-side cookie jar + persisted
// page storage: off = no cookies are sent, stored or shown to
// pages. ignoreCertErrors (0076) makes the privileged fetch
// skip TLS certificate verification for browser loads, for
// sites whose broken/expired cert otherwise fails the load
// outright (black / error page).
export const browserState = sqliteTable("browser_state", {
  id: integer("id").primaryKey(),
  deviceMode: text("device_mode").notNull().default("desktop"),
  customUserAgent: text("custom_user_agent").notNull().default(""),
  cookiesEnabled: integer("cookies_enabled").notNull().default(1),
  ignoreCertErrors: integer("ignore_cert_errors").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

// ---------------- 监控 (monitoring center) ----------------
// Professional monitoring: each monitor watches one target on
// its own schedule — a product page's price, a stock, a 红果
// short drama's updates, a web page's content, an FX/crypto
// rate, flight/hotel prices, an app's latest version, ticket
// availability, a social account's updates. Every check writes
// one monitor_checks row (the history the curves draw from)
// with the REAL value found and its source; a check that finds
// nothing records status 'not_found' with the reason — values
// are never invented. Threshold/change rules that fire write a
// monitor_alerts row, which is the in-space reminder (sidebar
// badge + the pane's alerts section).
export const monitors = sqliteTable("monitors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // 'product' | 'stock' | 'webchange' | 'rate' |
  // 'travel' | 'appversion' | 'ticket' | 'social'
  type: text("type").notNull().default(""),
  title: text("title").notNull().default(""),
  // The watched target: a URL (product/webchange), a ticker
  // (stock), a pair (rate), a name/query (travel/ticket/
  // social), a repo or app id (appversion).
  target: text("target").notNull().default(""),
  // Who runs the check: NULL = Muse, the model itself (the
  // built-in checkers); otherwise the id of the in-space agent
  // the user designated — Muse sends it the monitor's
  // conditions, it queries and reports back to Muse, and
  // Muse's summary is what reaches the user.
  agentId: integer("agent_id"),
  // Type-specific thresholds: { targetPrice?, changePct?,
  // above?, below?, keyword? }.
  configJson: text("config_json").notNull().default("{}"),
  frequencyMinutes: integer("frequency_minutes").notNull().default(1440),
  active: integer("active").notNull().default(1),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  // '' | 'ok' | 'not_found' | 'error'
  lastStatus: text("last_status").notNull().default(""),
  lastValueNum: real("last_value_num"),
  lastValueText: text("last_value_text").notNull().default(""),
  lastSource: text("last_source").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const monitorChecks = sqliteTable("monitor_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id),
  status: text("status").notNull().default(""),
  valueNum: real("value_num"),
  valueText: text("value_text").notNull().default(""),
  source: text("source").notNull().default(""),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const monitorAlerts = sqliteTable("monitor_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id),
  message: text("message").notNull().default(""),
  isRead: integer("is_read").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------- 记账本 (ledger) ----------------
// The professional ledger: multiple accounts, income / expense
// / transfer transactions, a two-level category tree, monthly
// per-category budgets, recurring entries, notes and receipt
// attachments. Money is stored as integer cents so balances
// never drift; dates are the user's own 'YYYY-MM-DD' strings.
// Everything lives only in this space's database — nothing is
// shared anywhere. Balances are always computed from the rows,
// never stored, so an edited or deleted transaction can never
// leave a stale balance behind.
export const ledgerAccounts = sqliteTable("ledger_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  // 'cash' | 'bank' | 'credit' | 'wallet' | 'other'
  kind: text("kind").notNull().default("cash"),
  initialBalanceCents: integer("initial_balance_cents")
    .notNull()
    .default(0),
  note: text("note").notNull().default(""),
  archived: integer("archived").notNull().default(0),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ledgerCategories = sqliteTable("ledger_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id").references(
    (): AnySQLiteColumn => ledgerCategories.id,
  ),
  name: text("name").notNull().default(""),
  kind: text("kind", { enum: ["income", "expense"] })
    .notNull()
    .default("expense"),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ledgerTransactions = sqliteTable("ledger_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["income", "expense", "transfer"] })
    .notNull()
    .default("expense"),
  accountId: integer("account_id")
    .notNull()
    .references(() => ledgerAccounts.id),
  toAccountId: integer("to_account_id").references(
    () => ledgerAccounts.id,
  ),
  categoryId: integer("category_id").references(
    () => ledgerCategories.id,
  ),
  amountCents: integer("amount_cents").notNull().default(0),
  note: text("note").notNull().default(""),
  occurredOn: text("occurred_on").notNull().default(""),
  attachmentBlobKey: text("attachment_blob_key"),
  attachmentName: text("attachment_name").notNull().default(""),
  recurringId: integer("recurring_id").references(
    () => ledgerRecurring.id,
  ),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ledgerBudgets = sqliteTable("ledger_budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => ledgerCategories.id),
  // 'YYYY-MM'
  month: text("month").notNull().default(""),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ledgerRecurring = sqliteTable("ledger_recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["income", "expense"] })
    .notNull()
    .default("expense"),
  accountId: integer("account_id")
    .notNull()
    .references(() => ledgerAccounts.id),
  categoryId: integer("category_id").references(
    () => ledgerCategories.id,
  ),
  amountCents: integer("amount_cents").notNull().default(0),
  note: text("note").notNull().default(""),
  // 'daily' | 'weekly' | 'monthly' | 'yearly'
  frequency: text("frequency").notNull().default("monthly"),
  startOn: text("start_on").notNull().default(""),
  nextOn: text("next_on").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton (id = 1): whether the standard starter category
// tree has been seeded (same once-only rule as the prompt-tag
// tree — a user who deletes categories never gets them back).
export const ledgerState = sqliteTable("ledger_state", {
  id: integer("id").primaryKey(),
  seeded: integer("seeded").notNull().default(0),
});

// The VPN Cat pane's saved preferences (singleton, id = 1):
// the country the user last picked and the plan they are
// looking at. VPN Cat (vpncat.net, seller SAFDAR NETWORK
// SMC-PRIVATE LIMITED) has NO public API and NO account system
// — connections are anonymous per-device inside its own app —
// so this row stores preferences only. It is never a connection
// state: the space cannot establish a VPN Cat tunnel and never
// claims one exists.
export const vpncatState = sqliteTable("vpncat_state", {
  id: integer("id").primaryKey(),
  country: text("country").notNull().default(""),
  // 'free' | 'premium'
  plan: text("plan").notNull().default("free"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The 代码 workspace (added 2026-11-21): code documents the user
// writes and keeps in the space. Each document carries its OWN
// access switch (agent_access, default OFF): while off, no agent
// sees the document at all; while on, its content rides along
// with every agent reply (the same context channel as
// access-granted files) and an agent the user explicitly asks to
// modify it can save the new content back through the FILE_EDIT
// protocol with ref=code:<id>. The content is plain text stored
// on the row (code is text; no blob needed).
export const codeFiles = sqliteTable("code_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  language: text("language").notNull().default(""),
  content: text("content").notNull().default(""),
  // Full project path of this entry, e.g. "src/components/App.tsx"
  // or "src/components" for a folder. name stays the display /
  // legacy field and is kept equal to the last path segment for
  // files (the full path for folders created before paths existed
  // is backfilled by migration 0054). '' = derive from name.
  path: text("path").notNull().default(""),
  // 1 = this row is a folder node of the project tree (content
  // is empty and meaningless); 0 = a regular code file.
  isFolder: integer("is_folder").notNull().default(0),
  agentAccess: integer("agent_access").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The 图像 workspace (added 2026-11-21): one row per image the
// user uploads or draws in the space. The original bytes live in
// ctx.blobs under original_blob_key and are never modified; the
// user may split the image into a rows × cols grid of parts
// (image_parts), and only ONE chosen target — the whole image or
// exactly one part — is ever sent to the chosen agent (any agent,
// through its own channel); the other parts are never uploaded
// and never touched, and an edited part replaces only its own
// grid position.
export const imageProjects = sqliteTable("image_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  originalBlobKey: text("original_blob_key").notNull(),
  // A whole-image result produced by an agent operation (an
  // edit or watermark removal on the unsplit image), stored as a
  // SEPARATE blob: the detail view shows it and split cuts it,
  // while the pristine upload above is never modified and can be
  // restored at any time (restoring just clears these two columns
  // and deletes the edited blob).
  editedBlobKey: text("edited_blob_key"),
  editedMime: text("edited_mime"),
  mime: text("mime").notNull().default("image/png"),
  width: integer("width"),
  height: integer("height"),
  sizeBytes: integer("size_bytes"),
  rows: integer("rows").notNull().default(1),
  cols: integer("cols").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One grid part of an image project. blob_key points at the
// part's CURRENT bytes: the untouched crop of the original until
// an AI edit replaces exactly this part (edited = 1 then, with
// the agent's name and the instruction kept for the record).
// idx is the row-major position (row * cols + col).
export const imageParts = sqliteTable("image_parts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => imageProjects.id),
  idx: integer("idx").notNull(),
  row: integer("row").notNull(),
  col: integer("col").notNull(),
  blobKey: text("blob_key").notNull(),
  mime: text("mime").notNull().default("image/png"),
  // The part's own pixel size and byte size, recorded when the
  // part is cut (exact crop size) and refreshed when an agent
  // edit replaces it (the returned image's real size) — the
  // detail view reassembles the parts at these actual sizes
  // instead of forcing every part into a uniform tile.
  width: integer("width"),
  height: integer("height"),
  sizeBytes: integer("size_bytes"),
  edited: integer("edited").notNull().default(0),
  editAgent: text("edit_agent").notNull().default(""),
  editInstruction: text("edit_instruction").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});


// Version history of one code file: one snapshot row per save
// (manual save, accepted AI proposal, rollback, chat-agent edit
// acceptance). Rollback restores a snapshot's content as a NEW
// version, so history is append-only and never rewritten.
export const codeVersions = sqliteTable("code_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id")
    .notNull()
    .references(() => codeFiles.id),
  content: text("content").notNull().default(""),
  name: text("name").notNull().default(""),
  language: text("language").notNull().default(""),
  // 'create' | 'save' | 'ai' | 'rollback' | 'import'
  source: text("source").notNull().default("save"),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// AI edit proposals for code files: an AI (the code pane's own
// Muse channel, or a chat agent through the FILE_EDIT protocol)
// never overwrites a code file directly any more — it creates
// ---------------- 密码本 (password vault) ----------------
// Passwords the user saves in the space: added by hand in the
// 密码本 pane, or captured from the in-space browser (only after
// the user confirms the save prompt — the browser reports what
// was typed in a page's login form, the pane asks, and only a
// confirmed save lands here). password_enc is NEVER the plain
// password: it is the AES-256-GCM ciphertext produced by the
// privileged vaultEncrypt handler (key in a server-side file
// beside the artifact, never in this database and never sent to
// the client). List actions return no password at all — not even
// masked beyond its length; the plain text leaves the server
// only through revealVaultPassword, one entry at a time, when
// the user taps 显示/复制/填充 for that entry. category is one
// of the fixed type keys (website / email / social / finance /
// shopping / work / game / other) the pane groups and sorts by;
// source is 'manual' or 'auto' (browser-captured).
export const vaultEntries = sqliteTable("vault_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default(""),
  url: text("url").notNull().default(""),
  domain: text("domain").notNull().default(""),
  username: text("username").notNull().default(""),
  passwordEnc: text("password_enc").notNull().default(""),
  category: text("category").notNull().default("website"),
  notes: text("notes").notNull().default(""),
  // 'manual' | 'auto'
  source: text("source").notNull().default("manual"),
  favorite: integer("favorite").notNull().default(0),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton (id = 1) vault preferences: auto_save is the
// 自动保存 switch — while on, the in-space browser offers to
// save credentials typed into a page's login form (each save
// still needs the user's tap on the prompt; nothing is ever
// saved silently). While off the browser does not even ask.
export const vaultState = sqliteTable("vault_state", {
  id: integer("id").primaryKey(),
  autoSave: integer("auto_save").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// one of these rows with the full proposed content. The user
// reviews it in the diff view and accepts (the file is updated
// and a version snapshot is written) or rejects (nothing
// changes). status: 'pending' | 'accepted' | 'rejected'.
// ---------------- 雷神加速器 (Leigod, proxy center) ----------------
// Singleton (id = 1). Leigod has NO public API: its web login is
// gated by a Geetest captcha, so the space cannot sign in with a
// password directly. What genuinely works is the account_token
// the official web client issues after the user signs in on
// leigod.com (valid ~7 days): with it the server can call
// webapi.leigod.com's /api/user/info (account + remaining time +
// pause status), /api/user/pause and /api/user/recover. The
// token is stored AES-256-GCM encrypted (same vault scheme as
// the password book); the plaintext never reaches the client
// after the login call. Actual game acceleration runs over
// Leigod's own client protocol and game lines, which the space
// does not have — the pane says so instead of faking a session.
export const leigodState = sqliteTable("leigod_state", {
  id: integer("id").primaryKey(),
  accountLabel: text("account_label").notNull().default(""),
  tokenEnc: text("token_enc").notNull().default(""),
  // The last /api/user/info payload (JSON, token stripped) so
  // the pane can show the account state the server last saw.
  lastInfoJson: text("last_info_json").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------- 红果短剧 (Hongguo short dramas) ----------------
// The user's own 追剧 list: titles they follow, the genre they
// filed each under, the official hongguoduanju.com link when
// they saved one, their own progress note (看到第几集 — typed by
// the user, never scraped or invented), a favorite flag, and an
// optional link to a 监控中心 monitor (type 'drama') that watches
// the drama for new episodes. Hongguo has no public API, so the
// catalog itself is browsed on the official web version inside
// the space browser; this table only stores what the user saved.
export const hongguoItems = sqliteTable("hongguo_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default(""),
  genre: text("genre").notNull().default("其他"),
  url: text("url").notNull().default(""),
  progress: text("progress").notNull().default(""),
  favorite: integer("favorite").notNull().default(0),
  monitorId: integer("monitor_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------- 办公 (office center) ----------------
// Files of the space's own office suite: kind 'doc' | 'sheet' |
// 'slides', a name, and the document content as JSON text (doc:
// {html}; sheet: {cells, formats, merges}; slides: {slides}).
// Everything is stored only in this space's database; export to
// real .docx/.xlsx/.pptx/.pdf/.csv happens in the privileged
// converter, and imports parse the real formats back into this
// JSON. This is a self-built, format-compatible editor — not
// Microsoft 365 and not WPS (the pane says so plainly).
export const officeFiles = sqliteTable("office_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull().default("doc"),
  name: text("name").notNull().default(""),
  content: text("content").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------- 虚拟位置 (virtual location, proxy center) --
// Singleton (id = 1). The user's in-space virtual location:
// while enabled, the space's own location surfaces (and the
// in-space browser's geolocation answers) use these coordinates
// instead of the real ones. It changes NOTHING outside the
// space: not the phone's system location, not other apps, and
// not the exit IP's geolocation — the exit-IP fields below are
// measured independently (ip-api lookup of this server's exit
// IP) and displayed on their own row so the two can never be
// confused. recentJson: [{label, country, lat, lon, ts}].
export const virtualLocationState = sqliteTable("virtual_location_state", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  label: text("label").notNull().default(""),
  country: text("country").notNull().default(""),
  lat: real("lat"),
  lon: real("lon"),
  recentJson: text("recent_json").notNull().default("[]"),
  exitIp: text("exit_ip").notNull().default(""),
  exitCountry: text("exit_country").notNull().default(""),
  exitCity: text("exit_city").notNull().default(""),
  exitLat: real("exit_lat"),
  exitLon: real("exit_lon"),
  exitMeasuredAt: integer("exit_measured_at", { mode: "timestamp_ms" }),
  exitError: text("exit_error").notNull().default(""),
  // The user's own Google Maps API key for the globe's Google
  // data mode: AES-256-GCM encrypted (vault scheme), only the
  // last 4 characters kept in plain sight for the mask display.
  // gkeyStatus is the last REAL validation result against the
  // Map Tiles API ('ok' | 'error' | ''), with Google's own
  // reason in gkeyError — never a self-declared success.
  gkeyEnc: text("gkey_enc").notNull().default(""),
  gkeyLast4: text("gkey_last4").notNull().default(""),
  gkeyStatus: text("gkey_status").notNull().default(""),
  gkeyError: text("gkey_error").notNull().default(""),
  gkeyCheckedAt: integer("gkey_checked_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// The 代码 workspace's 快捷运行 (quick-run) history (0077): the
// newest code the chat recognised — a runnable fenced block in
// an assistant reply, detected with the same rules as the
// chat's own code panels — plus code the user typed into the
// quick-run box itself. The quick-run editor auto-fills with
// the newest row and is replaced when a newer one lands; the
// table is pruned to the newest 10 rows on every write, older
// rows are deleted. source is 'chat' | 'manual'; chat rows
// remember their message + block index so re-scans never
// duplicate them; source_label names where a chat row came
// from (the room title) for the history dropdown.
export const codeQuickRuns = sqliteTable("code_quick_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  language: text("language").notNull().default(""),
  code: text("code").notNull().default(""),
  source: text("source").notNull().default("chat"),
  sourceLabel: text("source_label").notNull().default(""),
  messageId: integer("message_id"),
  blockIndex: integer("block_index").notNull().default(-1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton (id = 1) sync watermark for the quick-run chat
// scan: the (message_id, block_index) of the newest chat code
// block ever recorded. Dedupe cannot rely on the history rows
// themselves — pruning deletes old rows, and a pruned block
// would otherwise be re-recorded as "new" on the next scan
// and churn the top of the list. Only blocks past this
// watermark are ever inserted.
export const codeQuickState = sqliteTable("code_quick_state", {
  id: integer("id").primaryKey(),
  lastMessageId: integer("last_message_id").notNull().default(0),
  lastBlockIndex: integer("last_block_index").notNull().default(-1),
});

export const codeAiProposals = sqliteTable("code_ai_proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id")
    .notNull()
    .references(() => codeFiles.id),
  originalContent: text("original_content").notNull().default(""),
  proposedContent: text("proposed_content").notNull().default(""),
  instruction: text("instruction").notNull().default(""),
  // 'code-pane' (the pane's AI assistant) | 'chat' (a chat agent)
  source: text("source").notNull().default("code-pane"),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
