'use strict';
/** 桌面工具箱 — preload：只暴露白名单 IPC 给渲染层。 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('toolbox', {
  getOverview: () => ipcRenderer.invoke('get-overview'),
  // 工具管理（winget）
  wingetSearch: (q) => ipcRenderer.invoke('winget-search', q),
  wingetUpgrades: () => ipcRenderer.invoke('winget-upgrades'),
  wingetInstall: (id, meta) => ipcRenderer.invoke('winget-install', id, meta),
  // 2026-11-28-12：工具箱内安装的软件（台账 + 便携版 + 视频引擎），
  // 供已安装页与软件页共用；meta 里的 key/name/kind 用于装成功后记台账。
  toolboxAppsList: () => ipcRenderer.invoke('toolbox-apps-list'),
  toolboxAppsOpen: (key) => ipcRenderer.invoke('toolbox-apps-open', key),
  toolboxAppsUninstall: (key) => ipcRenderer.invoke('toolbox-apps-uninstall', key),
  toolboxAppsRemove: (key) => ipcRenderer.invoke('toolbox-apps-remove', key),
  installedOpenDir: (id) => ipcRenderer.invoke('installed-open-dir', id),
  installedMoveToTools: (id) => ipcRenderer.invoke('installed-move-to-tools', id),
  // 2026-11-27-2：视频引擎干净列表（主进程 tools-installed-extra；已安装页
  // 平时走 toolbox-apps-list，这里的干净列表是自测的引擎出口）
  toolsInstalledExtra: () => ipcRenderer.invoke('tools-installed-extra'),
  // 2026-11-27-2：管理员权限检测（主进程 tools-check-admin，返回 {isAdmin, method, detail}）
  toolsCheckAdmin: () => ipcRenderer.invoke('tools-check-admin'),
  // 2026-11-26-7：应用官方图标
  getInstalledIcon: (id) => ipcRenderer.invoke('tools-get-installed-icon', id),
  getDiscoverIcon: (row) => ipcRenderer.invoke('tools-get-discover-icon', row),
  wingetUpgradeOne: (id) => ipcRenderer.invoke('winget-upgrade-one', id),
  wingetUpgradeAll: () => ipcRenderer.invoke('winget-upgrade-all'),
  wingetExport: () => ipcRenderer.invoke('winget-export'),
  wingetImport: () => ipcRenderer.invoke('winget-import'),
  wingetInstalledOne: (id) => ipcRenderer.invoke('winget-installed-one', id),
  prereqStatus: () => ipcRenderer.invoke('prereq-status'),
  prereqInstall: (keys) => ipcRenderer.invoke('prereq-install', keys),
  wingetDeps: (id) => ipcRenderer.invoke('winget-deps', id),
  installDepsAndPackage: (id, deps, meta) => ipcRenderer.invoke('install-deps-and-package', id, deps, meta),
  githubReleaseDeps: (o, r, t) => ipcRenderer.invoke('github-release-deps', o, r, t),
  githubInstallWithDeps: (u, n, deps, repo, tag) => ipcRenderer.invoke('github-install-with-deps', u, n, deps, repo, tag),
  githubInstalledUpdates: () => ipcRenderer.invoke('github-installed-updates'),
  // GitHub
  githubStatus: () => ipcRenderer.invoke('github-status'),
  githubSetToken: (t) => ipcRenderer.invoke('github-set-token', t),
  githubClearToken: () => ipcRenderer.invoke('github-clear-token'),
  githubReleases: (o, r) => ipcRenderer.invoke('github-releases', o, r),
  githubInstallAsset: (u, n, repo, tag) => ipcRenderer.invoke('github-install-asset', u, n, repo, tag),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // 播放器（集成 VLC）
  vlcStatus: () => ipcRenderer.invoke('vlc-status'),
  vlcDownload: () => ipcRenderer.invoke('vlc-download'),
  vlcLaunch: () => ipcRenderer.invoke('vlc-launch'),
  // 浏览器（2026-11-28-2：便携版 Chromium 已删除，内嵌浏览器常驻可用）
  // v1.4.0：应用列表、默认应用、界面内设置
  playerApps: () => ipcRenderer.invoke('player-apps'),
  browserApps: () => ipcRenderer.invoke('browser-apps'),
  launchPlayer: (kind, target) => ipcRenderer.invoke('launch-player', kind, target),
  launchBrowserApp: (kind, url) => ipcRenderer.invoke('launch-browser-app', kind, url),
  pickMedia: () => ipcRenderer.invoke('pick-media'),
  vlcPlay: (target) => ipcRenderer.invoke('vlc-play', target),
  browserOpenUrl: (kind, url) => ipcRenderer.invoke('browser-open-url', kind, url),
  vlcGetPrefs: () => ipcRenderer.invoke('vlc-get-prefs'),
  vlcSetPrefs: (patch) => ipcRenderer.invoke('vlc-set-prefs', patch),
  // 窗口与系统（2026-11-26-3）：自定义标题栏按钮与窗口状态
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowStatus: () => ipcRenderer.invoke('window-status'),
  // 2026-11-28-4：界面缩放（webFrame 整页缩放，布局随窗口重排；
  // 范围 0.8–1.5，由渲染层读写配置 uiZoom 后调用）。
  setZoomFactor: (z) => { try { const v = Math.min(1.5, Math.max(0.8, Number(z) || 1)); webFrame.setZoomFactor(v); return { ok: true, zoom: v }; } catch (e) { return { ok: false, error: e.message || String(e) }; } },
  getZoomFactor: () => { try { return { ok: true, zoom: webFrame.getZoomFactor() }; } catch (e) { return { ok: false, error: e.message || String(e) }; } },
  // 设置
  getConfig: () => ipcRenderer.invoke('get-config'),
  // 2026-11-27-2：代码热更新——只手动检查与下载改动的文件，不自动更新
  updateStatus: () => ipcRenderer.invoke('update-status'),
  updateCheck: (opts) => ipcRenderer.invoke('update-check', opts || {}),
  updateApply: () => ipcRenderer.invoke('update-apply'),
  // 2026-11-27-4：自选本机文件更新（opts 可带 {file, confirmDowngrade}，
  // 降级确认后带上次选中的 file 再调，不用重新选文件）与一键发布到仓库
  updateFromLocalFile: (opts) => ipcRenderer.invoke('update-from-local-file', opts || {}),
  publishStatus: () => ipcRenderer.invoke('publish-status'),
  publishLocal: () => ipcRenderer.invoke('publish-local'),
  // 2026-11-27-11：发布新版本（版本 +1 后 git 提交推送；opts 可带 {dryRun}）
  publishNewVersion: (opts) => ipcRenderer.invoke('publish-new-version', opts || {}),
  // 2026-11-27-11：统一嗅探——读当前站点的 cookie（只进内存展示，不落盘）
  sniffAuthCookies: (url, partition) => ipcRenderer.invoke('sniff-auth-cookies', url, partition),
  // 2026-11-27-11：请求日志详情（点一条时才取）与嗅探历史（本机落盘）
  sniffReqDetail: (id) => ipcRenderer.invoke('sniff-req-detail', id),
  sniffHistorySave: (entry) => ipcRenderer.invoke('sniff-history-save', entry),
  sniffHistoryList: () => ipcRenderer.invoke('sniff-history-list'),
  sniffHistoryGet: (id) => ipcRenderer.invoke('sniff-history-get', id),
  sniffHistoryDelete: (id) => ipcRenderer.invoke('sniff-history-delete', id),
  rollbackInfo: () => ipcRenderer.invoke('update-rollback-info'),
  rollback: () => ipcRenderer.invoke('update-rollback'),
  // 2026-11-27-4：壁纸选择（只返回路径，落盘由渲染层经 set-config 写 wallpaperPath）
  selectWallpaper: () => ipcRenderer.invoke('select-wallpaper'),
  updateRestart: () => ipcRenderer.invoke('update-restart'),
  updateOpenReleases: () => ipcRenderer.invoke('update-open-releases'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  pickDir: () => ipcRenderer.invoke('pick-dir'),
  openToolsDir: () => ipcRenderer.invoke('open-tools-dir'),
  // 工具箱本地功能：智能体 / 创作 / 代码 / 图像 / 监控 / 记账本 / 注册 / 文件 / 代理
  agentsList: () => ipcRenderer.invoke('agents-list'),
  agentSave: (a) => ipcRenderer.invoke('agent-save', a),
  agentDelete: (id) => ipcRenderer.invoke('agent-delete', id),
  // 2026-11-27-10：技能管理（本地 skills.json）
  skillsList: () => ipcRenderer.invoke('skills-list'),
  skillSave: (s) => ipcRenderer.invoke('skill-save', s),
  skillDelete: (id) => ipcRenderer.invoke('skill-delete', id),
  skillToggle: (id, enabled) => ipcRenderer.invoke('skill-toggle', id, enabled),
  // 2026-11-26-7：多账号管理
  accountsList: () => ipcRenderer.invoke('accounts-list'),
  accountSave: (a) => ipcRenderer.invoke('account-save', a),
  accountDelete: (id) => ipcRenderer.invoke('account-delete', id),
  accountOpen: (id) => ipcRenderer.invoke('account-open', id),
  accountClose: () => ipcRenderer.invoke('account-close'),
  accountRegisterBegin: (id) => ipcRenderer.invoke('account-register-begin', id),
  accountRegisterDone: (id) => ipcRenderer.invoke('account-register-done', id),
  accountRegisterCancel: (id) => ipcRenderer.invoke('account-register-cancel', id),
  // 2026-11-28-7：复制账号密钥值（值只在主进程写剪贴板）
  accountCopySecret: (id) => ipcRenderer.invoke('account-copy-secret', id),
  // 2026-11-28-7：菜单分离为独立窗口
  menuDetachOpen: () => ipcRenderer.invoke('menu-detach-open'),
  menuDetachClose: () => ipcRenderer.invoke('menu-detach-close'),
  menuNavigate: (key) => ipcRenderer.invoke('menu-navigate', key),
  menuPinToggle: () => ipcRenderer.invoke('menu-pin-toggle'),
  // 2026-11-27-3：账号登录严格认证指纹（主进程读 Cookie，只回是否命中）
  browserLoginCheck: (url) => ipcRenderer.invoke('browser-login-check', url),
  browserLoginIgnore: (req) => ipcRenderer.invoke('browser-login-ignore', req),
  browserLoginIgnored: (host) => ipcRenderer.invoke('browser-login-ignored', host),
  // 2026-11-27-3：外部协议（mailto:）用户确认后才打开
  externalProtocolOpen: (url) => ipcRenderer.invoke('external-protocol-open', url),
  agentChats: () => ipcRenderer.invoke('agent-chats'),
  agentChatGet: (id) => ipcRenderer.invoke('agent-chat-get', id),
  agentChatNew: (agentId) => ipcRenderer.invoke('agent-chat-new', agentId),
  agentChatSend: (chatId, content) => ipcRenderer.invoke('agent-chat-send', chatId, content),
  // 2026-11-28-2：重新生成（只重调模型）、停止流式输出、轻量
  // 连接探测（GET /models）。
  agentChatRegenerate: (chatId) => ipcRenderer.invoke('agent-chat-regenerate', chatId),
  agentChatStop: (chatId) => ipcRenderer.invoke('agent-chat-stop', chatId),
  agentModelsTest: (agentId) => ipcRenderer.invoke('agent-models', agentId),
  agentComplete: (agentId, system, text) => ipcRenderer.invoke('agent-complete', agentId, system, text),
  agentWebVerify: (agentId) => ipcRenderer.invoke('agent-web-verify', agentId),
  // 2026-11-26-6：视频嗅探 / 下载
  videoDownload: (req) => ipcRenderer.invoke('video-download', req),
  // 2026-11-28-5：手机远程（局域网直连 + Tailscale）
  phoneRemoteStatus: () => ipcRenderer.invoke('phone-remote-status'),
  phoneRemoteSetEnabled: (enabled) => ipcRenderer.invoke('phone-remote-set-enabled', !!enabled),
  phoneRemoteAllowPair: () => ipcRenderer.invoke('phone-remote-allow-pair'),
  phoneRemoteRevoke: (id) => ipcRenderer.invoke('phone-remote-revoke', id),
  phoneRemoteSetDangerous: (key, enabled) => ipcRenderer.invoke('phone-remote-set-dangerous', key, !!enabled),
  phoneRemoteTailscale: () => ipcRenderer.invoke('phone-remote-tailscale'),
  // 2026-11-28-4：视频引擎安装入口（嗅探下载时引擎未装可一键装）。
  videoEngineDownload: (engine) => ipcRenderer.invoke('video-engine-download', engine),
  // 2026-11-26-6：Pioneer
  pioneerStatus: () => ipcRenderer.invoke('pioneer-status'),
  pioneerLogin: (creds) => ipcRenderer.invoke('pioneer-login', creds),
  pioneerLogout: () => ipcRenderer.invoke('pioneer-logout'),
  pioneerRegions: () => ipcRenderer.invoke('pioneer-regions'),
  pioneerConnect: (req) => ipcRenderer.invoke('pioneer-connect', req),
  pioneerDisconnect: () => ipcRenderer.invoke('pioneer-disconnect'),
  pioneerLogs: () => ipcRenderer.invoke('pioneer-logs'),
  // 2026-11-28-4：IP 纯净度检测（启发式评估 + 按 IP 永久记忆）与已存记录。
  pioneerIpPurity: (opts) => ipcRenderer.invoke('pioneer-ip-purity', opts || {}),
  pioneerIpPurityGet: () => ipcRenderer.invoke('pioneer-ip-purity-get'),
  // 2026-11-26-6：监控提醒
  monitorsList: () => ipcRenderer.invoke('monitors-list'),
  monitorSave: (m) => ipcRenderer.invoke('monitor-save', m),
  monitorDelete: (id) => ipcRenderer.invoke('monitor-delete', id),
  monitorRun: (id) => ipcRenderer.invoke('monitor-run', id),
  // 2026-11-26-6：提示词模板
  promptsList: () => ipcRenderer.invoke('prompts-list'),
  promptSave: (p) => ipcRenderer.invoke('prompt-save', p),
  promptDelete: (id) => ipcRenderer.invoke('prompt-delete', id),
  // 2026-11-26-6：图片上传 / 改图
  imageUpload: () => ipcRenderer.invoke('image-upload'),
  imageEdit: (req) => ipcRenderer.invoke('image-edit', req),
  agentTriggerSave: (agentId, trigger) => ipcRenderer.invoke('agent-trigger-save', agentId, trigger),
  agentTriggerDelete: (agentId, triggerId) => ipcRenderer.invoke('agent-trigger-delete', agentId, triggerId),
  agentTriggerRun: (agentId, triggerId) => ipcRenderer.invoke('agent-trigger-run', agentId, triggerId),
  creationList: () => ipcRenderer.invoke('creation-list'),
  creationSave: (item) => ipcRenderer.invoke('creation-save', item),
  creationDelete: (id) => ipcRenderer.invoke('creation-delete', id),
  snippetsList: () => ipcRenderer.invoke('snippets-list'),
  snippetSave: (item) => ipcRenderer.invoke('snippet-save', item),
  snippetDelete: (id) => ipcRenderer.invoke('snippet-delete', id),
  imageGenerate: (prompt, size) => ipcRenderer.invoke('image-generate', prompt, size),
  imagesList: () => ipcRenderer.invoke('images-list'),
  monitorStatus: () => ipcRenderer.invoke('monitor-status'),
  registerList: () => ipcRenderer.invoke('register-list'),
  registerAdd: (item) => ipcRenderer.invoke('register-add', item),
  registerDelete: (id) => ipcRenderer.invoke('register-delete', id),
  registerClear: () => ipcRenderer.invoke('register-clear'),
  registerPlatformsList: () => ipcRenderer.invoke('register-platforms-list'),
  registerPlatformAdd: (item) => ipcRenderer.invoke('register-platform-add', item),
  registerPlatformDelete: (id) => ipcRenderer.invoke('register-platform-delete', id),
  filesListDir: (dir) => ipcRenderer.invoke('files-list-dir', dir),
  filesOpenPath: (p) => ipcRenderer.invoke('files-open-path', p),
  filesTrashPath: (p) => ipcRenderer.invoke('files-trash-path', p),
  filesMkdir: (dir, name) => ipcRenderer.invoke('files-mkdir', dir, name),
  proxyTest: () => ipcRenderer.invoke('proxy-test'),
  proxyLogList: () => ipcRenderer.invoke('proxy-log-list'),
  proxyIpCheck: () => ipcRenderer.invoke('proxy-ip-check'),
  codeRun: (req) => ipcRenderer.invoke('code-run', req),
  codeInterpreters: () => ipcRenderer.invoke('code-interpreters'),
  eventTriggerStatus: () => ipcRenderer.invoke('event-trigger-status'),
  tunStatus: () => ipcRenderer.invoke('tun-status'),
  tunInstall: () => ipcRenderer.invoke('tun-install'),
  tunStart: () => ipcRenderer.invoke('tun-start'),
  tunStop: () => ipcRenderer.invoke('tun-stop'),
  registerMailtmFetch: () => ipcRenderer.invoke('register-mailtm-fetch'),
  selfcheckStatus: () => ipcRenderer.invoke('selfcheck-status'),
  selfcheckInstall: (key) => ipcRenderer.invoke('selfcheck-install', key),
  // v1.6.0：智能体工具调用确认
  agentToolConfirm: (id, approved) => ipcRenderer.invoke('agent-tool-confirm', id, approved),
  agentToolPending: () => ipcRenderer.invoke('agent-tool-pending'),
  // v1.6.0：工具来源自定义 + 从本机已装程序导入
  sourcesCustomList: () => ipcRenderer.invoke('sources-custom-list'),
  sourcesCustomAdd: (src) => ipcRenderer.invoke('sources-custom-add', src),
  sourcesCustomDelete: (id) => ipcRenderer.invoke('sources-custom-delete', id),
  sourcesCustomToggle: (id, enabled) => ipcRenderer.invoke('sources-custom-toggle', id, enabled),
  sourcesCustomRegisterWinget: (id) => ipcRenderer.invoke('sources-custom-register-winget', id),
  sourcesImportInstalled: () => ipcRenderer.invoke('sources-import-installed'),
  sourcesImportedList: () => ipcRenderer.invoke('sources-imported-list'),
  // v1.6.0：插件系统
  pluginsList: () => ipcRenderer.invoke('plugins-list'),
  pluginInstallFolder: () => ipcRenderer.invoke('plugin-install-folder'),
  pluginInstallGithub: (ownerRepo) => ipcRenderer.invoke('plugin-install-github', ownerRepo),
  pluginEnable: (id, enabled) => ipcRenderer.invoke('plugin-enable', id, enabled),
  pluginDelete: (id) => ipcRenderer.invoke('plugin-delete', id),
  pluginPagePath: (id) => ipcRenderer.invoke('plugin-page-path', id),
  pluginCall: (id, method, args, confirmed) => ipcRenderer.invoke('plugin-call', id, method, args, confirmed),
  // v1.6.0：本地数据备份与同步
  backupExport: (opts) => ipcRenderer.invoke('backup-export', opts || {}),
  // 2026-11-27-4：backupImport 接受 {password}，加密备份真解密；
  // 未给密码且备份加密时返回 needsPassword，由渲染层弹密码框。
  backupImport: (opts) => ipcRenderer.invoke('backup-import', opts || {}),
  backupImportPassword: (file, password) => ipcRenderer.invoke('backup-import-password', file, password),
  syncSetFolder: () => ipcRenderer.invoke('sync-set-folder'),
  syncExport: (opts) => ipcRenderer.invoke('sync-export', opts || {}),
  syncList: () => ipcRenderer.invoke('sync-list'),
  syncImport: (file) => ipcRenderer.invoke('sync-import', file),
  syncImportPassword: (file, password) => ipcRenderer.invoke('sync-import-password', file, password),
  // 事件
  on: (channel, cb) => {
    const allowed = ['winget-job', 'component-progress', 'update-progress', 'publish-progress', 'test-goto', 'window-state', 'video-engine-progress', 'video-download-progress', 'embedded-browser-open', 'ctx-translate', 'ctx-open-link', 'external-protocol-ask', 'agent-chat-delta', 'screen-translate-result', 'menu-detached', 'menu-navigate'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  // 2026-11-28-6：屏幕实时翻译（框选 → 视觉轮巡 → 浮窗）
  screenTranslateStart: () => ipcRenderer.invoke('screen-translate-start'),
  screenTranslateSelect: (rect) => ipcRenderer.invoke('screen-translate-select', rect),
  screenTranslateCancel: () => ipcRenderer.invoke('screen-translate-cancel'),
  screenTranslateRetry: () => ipcRenderer.invoke('screen-translate-retry'),
  screenTranslateClose: () => ipcRenderer.invoke('screen-translate-close'),
  screenTranslateActive: () => ipcRenderer.invoke('screen-translate-active'),
  screenTranslateResize: (size) => ipcRenderer.invoke('screen-translate-resize', size),
  screenTranslateStatus: () => ipcRenderer.invoke('screen-translate-status'),
  // 2026-11-27-2：浏览器视频嗅探——主进程接 session webRequest 监听到
  // 视频流后发 browser-media-found，payload {url, type, pageUrl}，
  // type 如 'm3u8'|'mp4'|'dash'。无事件时不报错、不影响浏览器。
  onBrowserMedia: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('browser-media-found', (_e, payload) => cb(payload));
  },
  // 2026-11-27-11：统一嗅探——媒体元数据（大小/Content-Type）与登录态
  // （Cookie/请求头令牌）。值只进渲染层内存，打码显示，不落盘、不上报。
  onBrowserMediaMeta: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('browser-media-meta', (_e, payload) => cb(payload));
  },
  onBrowserAuth: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('browser-auth-found', (_e, payload) => cb(payload));
  },
  // 2026-11-27-11：统一嗅探——HAR 式请求日志（点一条时详情才另取）。
  onBrowserReqLog: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('browser-req-log', (_e, payload) => cb(payload));
  },
});
