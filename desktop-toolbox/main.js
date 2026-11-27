'use strict';
/**
 * 桌面工具箱 — Electron 主进程（空间之外的 Windows 桌面程序）
 *
 * 用户 2026-11-25 定案：把工具管理（UniGetUI 式）做成一个程序，
 * VLC 集成在内，浏览器由本程序下载；空间在电脑端调用播放器 /
 * 浏览器时调用本程序。2026-11-25 修订：一键上传已整功能删除
 * （各主机上限太低）；空间调用面板收进设置页；播放器只保留
 * 检查/下载/启动/设路径/协议调用，浏览器只保留检查/下载/
 * 启动/设默认，不再另做打开文件/播放列表/输入网址/最近打开
 * （VLC 与 Chromium 本身自带这些）。
 *
 * 保留的功能：
 *  1. 工具管理：底层是 Windows 自带的 winget（搜索未安装的
 *     商店应用 / 已安装 / 可更新 / 安装 / 卸载 / 真更新 /
 *     导出·导入软件包清单），与 UniGetUI 同一条路子，不是
 *     把 UniGetUI 本体搬进来；另加 GitHub 登录后搜仓库、
 *     看 Releases、装 exe/msi 安装包。
 *  2. 播放器：集成 VLC —— 优先用打包内置的便携版 VLC
 *     （VideoLAN 官方 zip，随安装包一起发），其次用电脑上
 *     已装的 VLC。内置组件缺失或损坏时才回退到运行时下载。
 *  3. 浏览器：打包内置 Chromium 便携版（官方快照包，随安
 *     装包一起发），之后「用工具箱浏览器打开」都走它，配置
 *     独立存放在本程序目录里，不动用户系统浏览器。内置组件
 *     缺失或损坏时才回退到运行时下载。
 *  v1.3.0：VLC 与 Chromium 改为打包内置，不再首次运行时
 *  到别处下载；定制见 CUSTOMIZATION.md（不从源码重编）。
 *  v1.4.0：主页改成与空间内工具箱一致的手机桌面（工具管理/
 *  播放器/浏览器/空间/设置五个图标，点图标全屏进对应页），
 *  播放器与浏览器页先是应用列表、点图标才打开对应应用，
 *  设置收进应用界面内的菜单；真实功能全部保留（winget、
 *  GitHub、内置 VLC/Chromium 启动与 muse-toolbox:// 协议）。
 *  v1.4.1：放弃苹果手机桌面主题，主页改成桌面聊天空间式布局
 *  （深色顶栏、左侧菜单边栏、右侧主内容区、底部导航栏），
 *  左侧菜单按空间原样列出，工具箱是其中一项（选中态）。
 *
 * 空间调用（自定义协议 muse-toolbox://，安装时注册）：
 *  - muse-toolbox://play?url=<视频地址>   → 集成 VLC 播放
 *  - muse-toolbox://browse?url=<网页地址> → 下载的浏览器打开
 *  - muse-toolbox://home                  → 打开工具箱主窗口
 * 协议唤起时工具箱未运行会先启动再处理；已运行则转发给
 * 已有窗口（单实例）。空间是网页，网页无法直接启动本地
 * 程序，协议是唯一正路；协议未注册 / 工具箱未安装时空间
 * 侧有 vlc:// 与复制地址的兜底（见空间 v215/v216）。
 *
 * v1.6.0：安装包瘦身——Chromium 快照包不再随安装包发，首次
 * 使用浏览器时再从官方快照地址下载（带进度、可续传、解压后
 * 校验 chrome.exe 与版本清单）；VLC 仍打包内置。智能体聊天
 * 窗口是自然语言入口：AI 通过主进程本地工具调用真实执行
 *（winget 安装、启动程序、运行代码、文件操作、查系统状态
 * 等），危险操作执行前先问用户确认。工具来源可自定义，也
 * 可从本机已装程序导入；新增插件系统与本地数据备份/同步。
 * v2026-11-26-2：更新只手动、不自动——启动时不再自动查
 * 新版（已删掉 autoUpdater 的启动调用与依赖），设置里点
 *「检查更新」查 GitHub Releases（仓库 zmfs9192/zhuo-mian-
 * liao-tian-kong-jian），有新版再点「一键更新」下载；便携
 * 版不能原地替换，下完只提示用户关闭旧版、手动运行新包。
 * 注意：该仓库目前还没有工具箱的发布版本（工具箱之前从没
 * 上传过 GitHub），功能接好后需先推上 GitHub 并发布一次
 * Release（tag 用 2026-11-26-2）才能真正更新到。
 * v2026-11-26-3：窗口与系统能力——硬件加速开关、崩溃/无响应
 * 自动恢复、系统通知、防休眠、锁屏/唤醒监听、任务栏进度条、
 * 无边框窗口 + 自定义标题栏、窗口置顶、窗口透明、记住窗口
 * 大小位置、最小化到托盘 + 托盘菜单、开机自启；全部开关在
 * 设置页「窗口与系统」区，存在 config.json（随备份导出/导入）。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, desktopCapturer, Tray, Menu, Notification, powerMonitor, powerSaveBlocker, screen, nativeImage, session } = require('electron');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const net = require('net');
const tls = require('tls');

/* 版本号规则（用户 2026-11-26 定）：第一位是日期，格式
 *「日期-今日修改次数」，如 2026-11-26-2（今天第 2 次改；
 * v1.6.0 是第 1 次、本版是第 2 次）。这个字符串不是标准
 * semver，所以内部版本用点分形式 2026.11.26-2（合法
 * semver，比较顺序与 2026-11-26-2 一致），界面上显示
 * 2026-11-26-2，GitHub Release 的 tag 也用 2026-11-26-2。 */
const VERSION = '2026.11.27-3'; // 内部 semver
const DISPLAY_VERSION = '2026-11-27-3'; // 界面与 Release tag 用的版本号

// --print-version：只打印版本号就退出（热更新自测用：替换代码
// 文件后起一个新进程，看它读到的是不是新版本；放文件顶部，
// 在单实例锁之前就退出，不会被正在运行的工具箱拦住）。
if (process.argv.includes('--print-version')) {
  console.log(`VERSION=${VERSION} DISPLAY=${DISPLAY_VERSION}`);
  process.exit(0);
}

/* 2026-11-26-3：硬件加速开关——app.disableHardwareAcceleration()
 * 必须在 app ready 之前调用，所以在启动早期直接读 config.json
 *（不走 loadConfig，避免 ready 前调 app.getPath 出问题）。
 * 读不到配置时默认开加速（与设置里的默认值一致）。 */
function earlyConfigPath() {
  try {
    if (app.isPackaged) return path.join(path.dirname(process.execPath), 'data', 'config.json');
  } catch (e) { /* 未打包走下面 */ }
  try { return path.join(app.getPath('userData'), 'config.json'); } catch (e) { /* ready 前可能读不到 */ }
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'muse-desktop-toolbox', 'config.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'muse-desktop-toolbox', 'config.json');
  return path.join(home, '.config', 'muse-desktop-toolbox', 'config.json');
}
try {
  const earlyCfg = JSON.parse(fs.readFileSync(earlyConfigPath(), 'utf8'));
  if (earlyCfg && earlyCfg.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch (e) { /* 无配置或读失败：默认开加速 */ }
const PROTOCOL = 'muse-toolbox';
const VLC_VERSION = '3.0.21';
const VLC_ZIP_URL = `https://download.videolan.org/pub/videolan/vlc/${VLC_VERSION}/win64/vlc-${VLC_VERSION}-win64.zip`;
const CHROMIUM_ZIP_URL = 'https://download-chromium.appspot.com/dl/Win_x64?type=snapshots';
/* ---- 打包内置组件（v1.3.0）----
 * bundled/ 里的两个 zip 是打包时从官方下载的原包（见
 * bundled/README.md 与 THIRD-PARTY-LICENSES.md），通过
 * electron-builder extraResources 发进安装包。首次运行时
 * 解压到 tools/，之后直接认到，不再联网下载。
 * Chromium 快照只去掉了 chrome-win/interactive_ui_tests.exe
 *（390MB 的测试程序，浏览用不到），其余原样；vlc zip 原样。
 * 哈希用于首次解压前校验，损坏时不解压、走运行时下载后备。 */
const CHROMIUM_VERSION = '160.0.8184.0'; // 快照版本，见 chrome-win/160.0.8184.0.manifest
const CHROMIUM_SNAPSHOT_DATE = '2026-11-25';
const BUNDLED_VLC_FILE = 'vlc-3.0.21-win64.zip';
/* v1.6.0：Chromium 快照包不再随安装包发（瘦身约 209MB）。
 * bundled/chromium-win64.zip 仍留在源码目录作开发参考，不进
 * 安装包；正式渠道是首次使用浏览器时从官方快照地址下载，
 * 下完按同一套预置 profile 与启动参数配置，见
 * downloadComponent('browser') 与 chromiumMeta()。 */
const BUNDLED_CHROMIUM_FILE = 'chromium-win64.zip';
/* 2026-11-27-3：WinTun 官方包随安装包内置，不再现用现从官网下载。
 * bundled/wintun-0.14.1.zip（2026-11-27 直接从 wintun.net 拉取，
 * 750540 字节，内含 amd64/wintun.dll 427552 字节，PE32+ x86-64）。
 * 首次运行时解压 amd64 的 dll 到 tools/wintun/，见 ensureWintunDll。 */
const BUNDLED_WINTUN_FILE = 'wintun-0.14.1.zip';
const BUNDLED_SHA256 = {
  vlc: 'a0b7ec02b50adf6417eed014fb8df50af39690505a4225b85b3dc2ed17d14843',
  wintunZip: '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51',
  wintunDllAmd64: 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce',
};
/* 预置定制（不重编，见 CUSTOMIZATION.md）：
 * Chromium：启动参数 --lang=zh-CN；首次启动时在工具箱的
 * profile 里写一份最小 Preferences（主页、语言、不弹默认
 * 浏览器提示），用户之后在浏览器里改什么都以用户改的为准。
 * VLC：只对打包内置版用 --config 指向工具箱自己的 vlcrc
 *（网络缓存 2000ms，见下），已装版不用它，不动用户自己的
 * VLC 设置；另加 --no-qt-privacy-ask，免去首次启动的隐私提示。 */
const CHROMIUM_HOMEPAGE = 'https://www.google.com';
const VLC_PRESET = [
  '# 桌面工具箱预置 vlcrc（只用于打包内置的 VLC；已装版不用它）',
  '# network-caching：网络流缓存，默认 1000ms；公网流放宽到 2000ms。',
  'network-caching=2000',
  '',
].join('\n');

/* ---------------- 路径与配置 ---------------- */

/* 2026-11-26-2：文件夹发行——数据存在 exe 旁边的 data 目录，
 * 整个文件夹拷到别的电脑数据都在。开发运行（未打包）时仍用
 * 系统 AppData，避免自测污染源码目录；打包后用 exe 旁 data。
 * 全部本地数据（配置、智能体、记账本、插件、备份等）都走
 * userDataDir()，改这一处就全改了。 */
function userDataDir() {
  if (app.isPackaged) {
    try { return path.join(path.dirname(process.execPath), 'data'); } catch (e) { /* 退回 AppData */ }
  }
  return app.getPath('userData');
}
function migrateLegacyUserData() {
  // 旧版便携版数据在系统 AppData（%APPDATA%\muse-desktop-toolbox）：
  // 打包后第一次启动时，若 exe 旁 data 还没有、旧目录有东西，
  // 整份拷过来一次；拷完不删旧的，旧目录留着当备份。
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  try {
    const legacy = app.getPath('userData');
    const next = userDataDir();
    if (legacy === next) return { ok: false, reason: 'same' };
    if (!fs.existsSync(legacy)) return { ok: false, reason: 'no-legacy' };
    if (fs.existsSync(path.join(next, 'config.json'))) return { ok: false, reason: 'already' };
    fs.mkdirSync(next, { recursive: true });
    fs.cpSync(legacy, next, { recursive: true });
    return { ok: true, from: legacy, to: next };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
function toolsDir() { return path.join(userDataDir(), 'tools'); }
function vlcDir() { return path.join(toolsDir(), 'vlc'); }
function chromiumDir() { return path.join(toolsDir(), 'chromium'); }
function configPath() { return path.join(userDataDir(), 'config.json'); }

/* ---- 打包内置组件的定位与校验 ---- */
function bundledZipPath(kind) {
  const file = kind === 'vlc' ? BUNDLED_VLC_FILE : kind === 'wintun' ? BUNDLED_WINTUN_FILE : BUNDLED_CHROMIUM_FILE;
  // 打包后：extraResources 发到 resources/bundled/；开发运行：源码 bundled/。
  const candidates = [];
  try { candidates.push(path.join(process.resourcesPath, 'bundled', file)); } catch (e) { /* 未打包时无 resourcesPath */ }
  candidates.push(path.join(__dirname, 'bundled', file));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { /* 继续 */ } }
  return '';
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}
/* 2026-11-27-3：WinTun 驱动文件改随包内置，不再现用现从官网下载。
 * 已有且哈希对就直接用；否则从内置包（resources/bundled 或源码
 * bundled/）校验 zip 哈希后解出 amd64 的 dll，再验 dll 哈希才落盘。
 * 路径可能含中文（如“桌面工具箱”），这里只做文件操作、不拼进
 * 命令行，PowerShell 侧用绝对路径加单引号转义（见 tunPsQuote）。 */
async function ensureWintunDll() {
  try {
    if (fs.existsSync(wintunDll())) {
      const sum = await sha256File(wintunDll());
      if (sum === BUNDLED_SHA256.wintunDllAmd64) return { ok: true, source: 'already-present' };
    }
  } catch (e) { /* 哈希失败就继续走内置包 */ }
  const zip = bundledZipPath('wintun');
  if (!zip) return { ok: false, error: '安装包里没有内置 WinTun 包（bundled/wintun-0.14.1.zip），请用完整安装包' };
  try {
    const sum = await sha256File(zip);
    if (sum !== BUNDLED_SHA256.wintunZip) return { ok: false, error: '内置 WinTun 包校验失败（sha256 不符），未解压' };
    const tmp = path.join(wintunDir(), 'extract');
    await extractZip(zip, tmp);
    const dll = path.join(tmp, 'wintun', 'bin', 'amd64', 'wintun.dll');
    if (!fs.existsSync(dll)) return { ok: false, error: '内置 WinTun 包里没找到 amd64/wintun.dll' };
    const dllSum = await sha256File(dll);
    if (dllSum !== BUNDLED_SHA256.wintunDllAmd64) return { ok: false, error: '内置 WinTun 驱动文件校验失败（sha256 不符），未安装' };
    fs.mkdirSync(wintunDir(), { recursive: true });
    fs.copyFileSync(dll, wintunDll());
    return { ok: true, source: 'bundled' };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
function vlcrcPath() { return path.join(vlcDir(), 'vlcrc-toolbox'); }
function chromiumProfileDir() { return path.join(chromiumDir(), 'profile'); }
function chromiumMetaPath() { return path.join(chromiumDir(), 'chromium-meta.json'); }
function chromiumMeta() {
  try { const v = JSON.parse(fs.readFileSync(chromiumMetaPath(), 'utf8')); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}
function saveChromiumMeta(meta) {
  try { fs.mkdirSync(chromiumDir(), { recursive: true }); fs.writeFileSync(chromiumMetaPath(), JSON.stringify(meta, null, 2), 'utf8'); } catch (e) { /* 元数据写失败不拦使用 */ }
}
function detectChromiumVersion() {
  // 快照 zip 里带 chrome-win/<版本号>.manifest，解压后按它认版本。
  try {
    const dir = path.join(chromiumDir(), 'chrome-win');
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d+\.\d+\.\d+\.\d+)\.manifest$/);
      if (m) return m[1];
    }
  } catch (e) { /* 读不到按常量 */ }
  const meta = chromiumMeta();
  return (meta && meta.version) || CHROMIUM_VERSION;
}
function ensureChromiumPreset() {
  // 只在 profile 首次创建时写最小 Preferences；已有则不动（以用户改的为准）。
  const prefFile = path.join(chromiumProfileDir(), 'Default', 'Preferences');
  try {
    if (fs.existsSync(prefFile)) return;
    fs.mkdirSync(path.dirname(prefFile), { recursive: true });
    fs.writeFileSync(prefFile, JSON.stringify({
      browser: { check_default_browser: false },
      homepage: CHROMIUM_HOMEPAGE,
      homepage_is_newtabpage: false,
      intl: { accept_languages: 'zh-CN,zh' },
    }, null, 2), 'utf8');
  } catch (e) { /* 预置写失败不拦启动，浏览器用自己的默认设置 */ }
}
function ensureVlcPreset() {
  // 只对打包内置版用的 vlcrc；已装版不走这条路。
  try {
    if (fs.existsSync(vlcrcPath())) return;
    fs.mkdirSync(vlcDir(), { recursive: true });
    fs.writeFileSync(vlcrcPath(), VLC_PRESET, 'utf8');
  } catch (e) { /* 预置写失败不拦启动，VLC 用自己的默认设置 */ }
}

function loadConfig() {
  // v1.4.0：默认播放器/浏览器（空间调用按此走），工具来源开关
  //（发现软件只搜启用的来源；GitHub 源关闭时 GitHub 搜索不可用）。
  const defaults = {
    downloadDir: '', vlcPath: '', proxy: '', githubToken: '', spaceCallEnabled: true, spaceUrl: '',
    defaultPlayer: 'vlc', defaultBrowser: 'chromium',
    sources: { browser: true, msstore: true, github: true, winget: true },
    // 2026-11-26-3 窗口与系统（全部存在 config.json，随备份导出/导入）：
    hardwareAcceleration: true, // 硬件加速，默认开；关掉要重启生效
    notificationsEnabled: true, // 系统通知总开关，默认开
    preventSleep: false, // 防止电脑休眠，默认关；下载/更新期间自动阻止
    alwaysOnTop: false, // 窗口置顶
    windowTransparent: true, // 窗口透明，默认开；关掉要重启生效
    closeToTray: true, // 点关闭按钮默认最小化到托盘（关掉则直接退出）
    autoStart: false, // 开机自启
    windowBounds: null, // 上次窗口大小位置 {x,y,width,height}
    trayHideNotified: false, // 是否已提示过“最小化到托盘”
    // 2026-11-26-7 多账号管理（存在 config.json，随备份导出/导入，不敏感）：
    activeAccountId: null, // 当前激活的账号 id
    lastRegisterAt: 0, // 上次注册完成时间（毫秒时间戳）
    registerIntervalMin: 60, // 注册间隔（分钟），0 表示不限制
  };
  try {
    if (fs.existsSync(configPath())) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
    }
  } catch (e) { console.error('读取配置失败', e.message); }
  return defaults;
}
function saveConfig(cfg) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
function getConfig() {
  const cfg = loadConfig();
  // 2026-11-26-7：未设置下载目录时默认用工具箱数据目录
  //（userDataDir()，打包后是 exe 旁边的 data 目录），不再默认
  // 系统 Downloads；用户已在设置里填过的 downloadDir 原样保留。
  if (!cfg.downloadDir) cfg.downloadDir = userDataDir();
  return cfg;
}
/* 未设置时的默认下载/文件目录：有用户设置就用用户设置，
 * 没设置就用工具箱数据目录。纯函数，供自测直接验证。 */
function resolveDefaultDownloadDir(rawDownloadDir) {
  const v = String(rawDownloadDir || '').trim();
  return v || userDataDir();
}
function defaultDownloadDir() { return resolveDefaultDownloadDir(loadConfig().downloadDir); }

function readJsonList(name) {
  const p = path.join(userDataDir(), name);
  try {
    if (fs.existsSync(p)) {
      const v = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(v)) return v;
    }
  } catch (e) { /* 损坏的历史文件按空处理 */ }
  return [];
}
function writeJsonList(name, list) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(), name), JSON.stringify(list.slice(0, 200), null, 2), 'utf8');
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ---------------- 窗口与系统（2026-11-26-3） ----------------
 * 崩溃日志、系统通知、防休眠、任务栏进度、窗口位置记忆。
 * 全部 Windows 专属 API 都包在 try/catch 里：Linux 沙盒里
 * 不支持的能力安全跳过、不报错、不拦启动。 */

/* 崩溃日志：存在 crash-log.json，只留最近 100 条。 */
function logCrash(kind, detail) {
  try {
    const list = readJsonFile('crash-log.json', []);
    const arr = Array.isArray(list) ? list : [];
    arr.push({ at: new Date().toISOString(), kind, detail: String(detail || '') });
    writeJsonFile('crash-log.json', arr.slice(-100));
  } catch (e) { /* 日志写失败不拦主流程 */ }
}
/* 系统通知：总开关在设置里（默认开）；不支持通知的系统上静默跳过。 */
function notify(title, body) {
  try {
    if (getConfig().notificationsEnabled === false) return false;
    if (!Notification.isSupported()) return false;
    new Notification({ title: String(title || '桌面工具箱'), body: String(body || '') }).show();
    return true;
  } catch (e) { return false; }
}
/* 防休眠：按“原因”计数——手动开关、Chromium/VLC 下载、热更新
 * 下载各占一个原因；有任一原因在就阻止休眠，全部释放才恢复。 */
const sleepBlockReasons = new Set();
let sleepBlockerId = null;
function applySleepBlock() {
  try {
    if (sleepBlockReasons.size > 0 && sleepBlockerId == null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    } else if (sleepBlockReasons.size === 0 && sleepBlockerId != null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
  } catch (e) { /* 沙盒里无 D-Bus 时启动失败不报错 */ }
}
function acquireSleepBlock(reason) { sleepBlockReasons.add(reason); applySleepBlock(); }
function releaseSleepBlock(reason) { sleepBlockReasons.delete(reason); applySleepBlock(); }
/* 任务栏进度条：0~1 为确定进度，>1 为不确定进度，<0 清除。 */
function setTaskbarProgress(p) {
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.setProgressBar(p);
  } catch (e) { /* 不支持的系统上静默跳过 */ }
}
/* 记住窗口大小位置：校验落在当前显示器范围内才用，超出则默认大小居中。 */
function validWindowBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const { x, y, width, height } = b;
  if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
  const w = Math.max(900, Math.min(width, 4000));
  const h = Math.max(600, Math.min(height, 4000));
  const cx = x + w / 2, cy = y + h / 2;
  try {
    for (const d of screen.getAllDisplays()) {
      const a = d.workArea;
      if (cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height) {
        return { x, y, width: w, height: h };
      }
    }
  } catch (e) { return null; }
  return null;
}
let saveBoundsTimer = null;
function saveWindowBounds() {
  try {
    if (!mainWin || mainWin.isDestroyed()) return;
    const b = mainWin.getBounds();
    if (!b || !Number.isFinite(b.width) || b.width < 100) return;
    const cfg = getConfig();
    cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveConfig(cfg);
  } catch (e) { /* 保存失败不拦 */ }
}
function saveWindowBoundsDebounced() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 500);
}

/* ---------------- VLC ---------------- */

function findVlc() {
  const cfg = getConfig();
  const candidates = [];
  if (cfg.vlcPath) candidates.push(cfg.vlcPath);
  candidates.push(path.join(vlcDir(), `vlc-${VLC_VERSION}`, 'vlc.exe'));
  candidates.push(path.join(vlcDir(), 'vlc.exe'));
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe');
    candidates.push('C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe');
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (e) { /* 继续找下一个 */ }
  }
  return '';
}
function vlcStatus() {
  const exe = findVlc();
  const bundled = !!exe && exe.startsWith(vlcDir());
  const cfg = getConfig();
  return {
    found: !!exe,
    path: exe,
    bundled,
    integrated: bundled, // 打包内置版在位
    source: !exe ? 'missing' : bundled ? 'bundled' : (cfg.vlcPath && exe === cfg.vlcPath ? 'custom' : 'installed'),
    version: bundled ? VLC_VERSION : (exe ? '电脑已安装' : ''),
  };
}
function vlcArgs(extra) {
  // 只对打包内置版加预置配置与隐私提示免除；已装/指定路径版不动用户自己的设置。
  const st = vlcStatus();
  if (!st.bundled) return extra;
  ensureVlcPreset();
  return ['--config', vlcrcPath(), '--no-qt-privacy-ask', ...extra];
}
function playWithVlc(target, source) {
  if (source === 'space' && getConfig().spaceCallEnabled === false) {
    return { ok: false, error: '空间调用已在设置里关闭：请在工具箱「设置 → 空间调用（电脑端）」打开开关。' };
  }
  const exe = findVlc();
  if (!exe) return { ok: false, error: '还没有可用的 VLC：内置组件缺失，请在「播放器」页点「重新下载（后备）」，或在设置里指定已安装的 VLC。' };
  const child = spawn(exe, vlcArgs([target]), { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
}
function launchVlc() {
  const exe = findVlc();
  if (!exe) return { ok: false, error: '还没有可用的 VLC：内置组件缺失，请在「播放器」页点「重新下载（后备）」，或在设置里指定已安装的 VLC。' };
  const child = spawn(exe, vlcArgs([]), { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
}

/* ---------------- 下载的浏览器（Chromium 便携版） ---------------- */

function chromiumExe() {
  return path.join(chromiumDir(), 'chrome-win', 'chrome.exe');
}
function browserStatus() {
  const exe = chromiumExe();
  let found = false;
  try { found = fs.existsSync(exe); } catch (e) { found = false; }
  const meta = chromiumMeta();
  return {
    found,
    path: found ? exe : '',
    profileDir: chromiumProfileDir(),
    bundled: false, // v1.6.0：Chromium 不再打包内置，首次使用时下载
    integrated: found,
    downloaded: found,
    version: found ? detectChromiumVersion() : '',
    snapshotDate: found ? (meta && meta.snapshotDate) || CHROMIUM_SNAPSHOT_DATE : '',
    downloadedAt: (meta && meta.downloadedAt) || '',
    note: found ? '' : '未下载：首次使用浏览器时在「浏览器」页下载（官方快照，约 200MB），没下载前点浏览器会明确提示去下载，不会假装能打开。',
  };
}
function chromiumArgs(extra) {
  ensureChromiumPreset();
  return [`--user-data-dir=${chromiumProfileDir()}`, '--no-first-run', '--lang=zh-CN', ...extra];
}
function openInToolboxBrowser(url, source) {
  if (source === 'space' && getConfig().spaceCallEnabled === false) {
    return { ok: false, error: '空间调用已在设置里关闭：请在工具箱「设置 → 空间调用（电脑端）」打开开关。' };
  }
  const st = browserStatus();
  if (!st.found) {
    return { ok: false, error: '工具箱浏览器还没下载：请在「浏览器」页点「下载 Chromium」下载官方快照（约 200MB），下完就能打开。' };
  }
  fs.mkdirSync(st.profileDir, { recursive: true });
  const child = spawn(st.path, chromiumArgs([url]), { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
}
function launchBrowser() {
  const st = browserStatus();
  if (!st.found) {
    return { ok: false, error: '工具箱浏览器还没下载：请在「浏览器」页点「下载 Chromium」下载官方快照（约 200MB），下完就能打开。' };
  }
  fs.mkdirSync(st.profileDir, { recursive: true });
  const child = spawn(st.path, chromiumArgs([]), { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
}

/* ---------------- 其他播放器 / 浏览器（v1.4.0） ----------------
 * 播放器、浏览器页先是应用列表，点图标才打开对应应用。
 * 只检测本机是否装了这些应用，不伪造状态；未装的如实报
 * 未安装，并给「去工具管理搜索安装」的入口。 */
function findInProgramFiles(relPaths) {
  if (process.platform !== 'win32') return '';
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['ProgramW6432']].filter(Boolean);
  for (const root of roots) for (const rel of relPaths) {
    const p = path.join(root, rel);
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 继续 */ }
  }
  return '';
}
function findOnPath(exeName) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, exeName);
    try { if (d && fs.existsSync(p)) return p; } catch (e) { /* 继续 */ }
  }
  return '';
}
function findPotPlayer() {
  return findInProgramFiles(['DAUM\\PotPlayer\\PotPlayerMini64.exe', 'DAUM\\PotPlayer\\PotPlayerMini.exe', 'DAUM\\PotPlayer\\PotPlayer.exe'])
    || findOnPath(process.platform === 'win32' ? 'PotPlayerMini64.exe' : 'potplayer');
}
function findMpv() {
  return findOnPath(process.platform === 'win32' ? 'mpv.exe' : 'mpv')
    || findInProgramFiles(['mpv\\mpv.exe']);
}
function findChrome() {
  return findInProgramFiles(['Google\\Chrome\\Application\\chrome.exe'])
    || findOnPath(process.platform === 'win32' ? 'chrome.exe' : 'google-chrome');
}
function findEdge() {
  return findInProgramFiles(['Microsoft\\Edge\\Application\\msedge.exe'])
    || findOnPath(process.platform === 'win32' ? 'msedge.exe' : 'microsoft-edge');
}
function playerAppsStatus() {
  const vlc = vlcStatus();
  const pot = findPotPlayer();
  const mpv = findMpv();
  return {
    vlc: { key: 'vlc', name: 'VLC', found: vlc.found, path: vlc.path || '', note: vlc.found ? (vlc.bundled ? `已集成 · ${vlc.version}` : '电脑已安装') : '未安装（已打包内置，缺失时点后备下载）' },
    potplayer: { key: 'potplayer', name: 'PotPlayer', found: !!pot, path: pot || '', note: pot ? '电脑已安装' : '未安装' },
    mpv: { key: 'mpv', name: 'mpv', found: !!mpv, path: mpv || '', note: mpv ? '电脑已安装' : '未安装' },
  };
}
function browserAppsStatus() {
  const tb = browserStatus();
  const chrome = findChrome();
  const edge = findEdge();
  return {
    chromium: { key: 'chromium', name: 'Chromium', found: tb.found, path: tb.path || '', note: tb.found ? `已下载 · ${tb.version}` : '未下载（首次使用时下载，约 200MB）' },
    chrome: { key: 'chrome', name: 'Chrome', found: !!chrome, path: chrome || '', note: chrome ? '电脑已安装' : '未安装' },
    edge: { key: 'edge', name: 'Edge', found: !!edge, path: edge || '', note: edge ? '电脑已安装' : '未安装' },
  };
}
function launchPlayerApp(kind, target) {
  if (kind === 'potplayer') {
    const exe = findPotPlayer();
    if (!exe) return { ok: false, error: 'PotPlayer 未安装：去「工具管理」搜索安装，或先装好再回来。' };
    const child = spawn(exe, target ? [target] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }
  if (kind === 'mpv') {
    const exe = findMpv();
    if (!exe) return { ok: false, error: 'mpv 未安装：去「工具管理」搜索安装，或先装好再回来。' };
    const child = spawn(exe, target ? [target] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }
  // 默认 VLC（含 target 为空时只启动）。
  if (!target) return launchVlc();
  return playWithVlc(target, 'local');
}
/* 空间调用按默认播放器/浏览器走（设置里可改）。 */
function playWithDefaultPlayer(target, source) {
  const def = getConfig().defaultPlayer || 'vlc';
  if (def === 'potplayer' || def === 'mpv') {
    const r = launchPlayerApp(def, target);
    if (r.ok) return r;
    // 默认播放器不可用时如实报，不静默换 VLC。
    return r;
  }
  return playWithVlc(target, source);
}
function openWithDefaultBrowser(url, source, kind) {
  const def = kind || getConfig().defaultBrowser || 'chromium';
  if (def === 'chrome' || def === 'edge') {
    if (source === 'space' && getConfig().spaceCallEnabled === false) {
      return { ok: false, error: '空间调用已在设置里关闭：请在工具箱「设置 → 空间调用（电脑端）」打开开关。' };
    }
    const exe = def === 'chrome' ? findChrome() : findEdge();
    if (!exe) return { ok: false, error: `${def === 'chrome' ? 'Chrome' : 'Edge'} 未安装：去「工具管理」搜索安装，或把默认浏览器改回 Chromium。` };
    const child = spawn(exe, url ? [url] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }
  if (url) return openInToolboxBrowser(url, source);
  return launchBrowser();
}

/* ---------------- VLC 偏好 / Chromium 设置与扩展（v1.4.0） ----------------
 * 播放器、浏览器界面内的设置页读写的是真实配置文件：
 * VLC 读/写工具箱自己的 vlcrc-toolbox（只用于打包内置版）；
 * Chromium 读/写工具箱 profile 的 Preferences（主页、语言、
 * 下载目录、不弹默认浏览器提示）。扩展列表读 profile 里已装
 * 的扩展目录（manifest.json），真实安装仍在 Chromium 内完成。 */
function readVlcPrefs() {
  const out = { networkCaching: '2000', volume: '', language: '', subtitleSize: '' };
  try {
    const text = fs.readFileSync(vlcrcPath(), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^#?\s*([a-z0-9-]+)=(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'network-caching') out.networkCaching = v;
      if (k === 'volume') out.volume = v;
      if (k === 'language') out.language = v;
      if (k === 'freetype-fontsize') out.subtitleSize = v;
    }
  } catch (e) { /* 文件不存在时用默认值 */ }
  return out;
}
function writeVlcPrefs(patch) {
  ensureVlcPreset();
  const cur = readVlcPrefs();
  const next = { ...cur, ...(patch || {}) };
  const set = {
    'network-caching': String(next.networkCaching || '2000'),
    volume: String(next.volume || ''),
    language: String(next.language || ''),
    'freetype-fontsize': String(next.subtitleSize || ''),
  };
  let lines = [];
  try { lines = fs.readFileSync(vlcrcPath(), 'utf8').split(/\r?\n/); } catch (e) { lines = []; }
  const seen = new Set();
  const outLines = lines.map((line) => {
    const m = line.match(/^#?\s*([a-z0-9-]+)=/i);
    if (m && Object.prototype.hasOwnProperty.call(set, m[1].toLowerCase())) {
      const k = m[1].toLowerCase();
      seen.add(k);
      return set[k] ? `${k}=${set[k]}` : `#${k}=`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(set)) {
    if (!seen.has(k) && v) outLines.push(`${k}=${v}`);
  }
  fs.writeFileSync(vlcrcPath(), outLines.join('\n'), 'utf8');
  return readVlcPrefs();
}
function chromiumPrefsPath() {
  return path.join(chromiumProfileDir(), 'Default', 'Preferences');
}
function readChromiumPrefs() {
  try { return JSON.parse(fs.readFileSync(chromiumPrefsPath(), 'utf8')); } catch (e) { return {}; }
}
function chromiumSettings() {
  const p = readChromiumPrefs();
  return {
    homepage: (p.homepage && p.homepage !== 'chrome://newtab/') ? p.homepage : CHROMIUM_HOMEPAGE,
    language: ((p.intl && p.intl.accept_languages) || 'zh-CN,zh').split(',')[0],
    downloadDir: (p.download && p.download.default_directory) || '',
    checkDefaultBrowser: !(p.browser && p.browser.check_default_browser === false),
  };
}
function writeChromiumSettings(patch) {
  const p = readChromiumPrefs();
  const next = { ...(patch || {}) };
  if (next.homepage != null) {
    p.homepage = String(next.homepage || CHROMIUM_HOMEPAGE);
    p.homepage_is_newtabpage = false;
  }
  if (next.language != null) {
    p.intl = { ...(p.intl || {}), accept_languages: `${next.language},zh` };
  }
  if (next.downloadDir != null) {
    p.download = { ...(p.download || {}), default_directory: String(next.downloadDir || '') };
  }
  if (next.checkDefaultBrowser != null) {
    p.browser = { ...(p.browser || {}), check_default_browser: !!next.checkDefaultBrowser };
  }
  fs.mkdirSync(path.dirname(chromiumPrefsPath()), { recursive: true });
  fs.writeFileSync(chromiumPrefsPath(), JSON.stringify(p, null, 2), 'utf8');
  return chromiumSettings();
}
function chromiumExtensions() {
  const dir = path.join(chromiumProfileDir(), 'Default', 'Extensions');
  const out = [];
  try {
    for (const id of fs.readdirSync(dir)) {
      const idDir = path.join(dir, id);
      if (!fs.statSync(idDir).isDirectory()) continue;
      const versions = fs.readdirSync(idDir).filter((v) => {
        try { return fs.statSync(path.join(idDir, v)).isDirectory(); } catch (e) { return false; }
      }).sort().reverse();
      if (!versions.length) continue;
      try {
        const man = JSON.parse(fs.readFileSync(path.join(idDir, versions[0], 'manifest.json'), 'utf8'));
        out.push({ id, name: man.name || id, version: man.version || versions[0] });
      } catch (e) { out.push({ id, name: id, version: versions[0] }); }
    }
  } catch (e) { /* 扩展目录不存在时返回空列表 */ }
  return out;
}
function systemStatus() {
  // Windows 上用 netsh 读真实 Wi-Fi 信号强度；取不到时返回 null，
  // 界面显示中性状态，不编造格数。非 Windows 同样返回 null。
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ wifiSignal: null, wifiSsid: null }); return; }
    const child = spawn('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve({ wifiSignal: null, wifiSsid: null }));
    child.on('close', () => {
      const sig = out.match(/信号\s*:\s*(\d+)\s*%/);
      const ssid = out.match(/SSID\s*:\s*(.+)/);
      resolve({
        wifiSignal: sig ? Number(sig[1]) : null,
        wifiSsid: ssid ? ssid[1].trim() : null,
      });
    });
    setTimeout(() => { try { child.kill(); } catch (e) { /* 已退出 */ } resolve({ wifiSignal: null, wifiSsid: null }); }, 8000);
  });
}

/* ---------------- 大文件下载 + 解压（VLC / Chromium 共用） ---------------- */

const componentJobs = new Map(); // kind -> {status, pct, error}

function downloadFile(url, dest, onProgress, opts) {
  /* opts.resume：断点续传——dest 已有部分文件时带 Range 头接着下，
   * 服务器不支持 Range（回 200）时删掉重下。进度按已下总量算。 */
  const resume = !!(opts && opts.resume);
  let startAt = 0;
  if (resume) {
    try { startAt = fs.statSync(dest).size || 0; } catch (e) { startAt = 0; }
  }
  return new Promise((resolve, reject) => {
    const request = (u, redirects) => {
      if (redirects > 8) { reject(new Error('重定向次数过多')); return; }
      const lib = u.startsWith('https:') ? https : http;
      const headers = { 'User-Agent': `MuseToolbox/${VERSION}` };
      if (startAt > 0) headers.Range = `bytes=${startAt}-`;
      const req = lib.get(u, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          request(new URL(res.headers.location, u).toString(), redirects + 1);
          return;
        }
        if (res.statusCode === 416) { resolve(startAt); return; } // 已下完
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); reject(new Error(`下载失败：HTTP ${res.statusCode}`)); return; }
        if (res.statusCode === 200 && startAt > 0) { startAt = 0; try { fs.unlinkSync(dest); } catch (e) { /* 删不掉重写覆盖 */ } }
        const total = Number(res.headers['content-length'] || 0) + startAt;
        let got = startAt;
        const out = fs.createWriteStream(dest, { flags: startAt > 0 ? 'a' : 'w' });
        res.on('data', (chunk) => { got += chunk.length; if (total > 0 && onProgress) onProgress(got / total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(got)));
        out.on('error', reject);
      });
      req.on('error', reject);
    };
    request(url, 0);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Windows 10/11 自带 tar（bsdtar，能解 zip）；没有时回退
    // PowerShell 的 Expand-Archive。Linux 测试机走 unzip/tar。
    const attempts = process.platform === 'win32'
      ? [
          { cmd: 'tar', args: ['-xf', zipPath, '-C', destDir] },
          { cmd: 'powershell', args: ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`] },
        ]
      : [
          { cmd: 'unzip', args: ['-o', '-q', zipPath, '-d', destDir] },
          { cmd: 'tar', args: ['-xf', zipPath, '-C', destDir] },
        ];
    let i = 0;
    const tryNext = () => {
      if (i >= attempts.length) { reject(new Error('解压失败：系统里没有可用的解压工具（tar / Expand-Archive）。')); return; }
      const a = attempts[i++];
      const child = spawn(a.cmd, a.args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', tryNext);
      child.on('close', (code) => { if (code === 0) resolve(); else { err = err.trim(); tryNext(); } });
    };
    tryNext();
  });
}

async function downloadComponent(kind) {
  /* VLC：打包内置，缺失或损坏时才走这里重新下载（后备）。
   * Chromium（v1.6.0）：不再打包内置，首次使用浏览器时走这里
   * 下载官方快照（download-chromium.appspot.com，断点续传，
   * 进度上报到界面）。下完校验：解压后 chrome.exe 必须在，
   * 版本按 chrome-win/*.manifest 认，并把下载包的 sha256 与
   * 版本记进 chromium-meta.json；校验不过不认已下载。 */
  if (componentJobs.get(kind)?.status === 'running') return { ok: false, error: '正在下载中' };
  const job = { status: 'running', pct: 0, error: '' };
  componentJobs.set(kind, job);
  const push = () => {
    sendToRenderer('component-progress', { kind, ...job });
    setTaskbarProgress(job.status === 'running' ? Math.max(0, Math.min(1, (job.pct || 0) / 100)) : -1);
  };
  push();
  acquireSleepBlock(`download:${kind}`); // 下载期间防止电脑休眠
  try {
    const isVlc = kind === 'vlc';
    const dir = isVlc ? vlcDir() : chromiumDir();
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, isVlc ? 'vlc.zip' : 'chromium.zip');
    await downloadFile(isVlc ? VLC_ZIP_URL : CHROMIUM_ZIP_URL, zip, (p) => { job.pct = Math.round(p * 90); push(); }, { resume: !isVlc });
    job.pct = 95; push();
    await extractZip(zip, dir);
    if (!isVlc) {
      if (!browserStatus().found) {
        try { fs.unlinkSync(zip); } catch (e) { /* 删不掉不影响 */ }
        throw new Error('下载完成但解压后找不到 chrome.exe：请删除 tools/chromium 后重新下载。');
      }
      const sum = await sha256File(zip);
      saveChromiumMeta({
        sha256: sum, version: detectChromiumVersion(),
        snapshotDate: new Date().toISOString().slice(0, 10),
        downloadedAt: new Date().toISOString(), source: CHROMIUM_ZIP_URL,
      });
      ensureChromiumPreset();
    }
    try { fs.unlinkSync(zip); } catch (e) { /* zip 删不掉不影响使用 */ }
    job.status = 'done'; job.pct = 100; push();
    notify('下载完成', isVlc ? 'VLC 已下载并解压完成，可以播放了。' : 'Chromium 已下载并解压完成，可以打开浏览器了。');
    return { ok: true };
  } catch (e) {
    job.status = 'failed'; job.error = e.message || String(e); push();
    return { ok: false, error: job.error };
  } finally {
    releaseSleepBlock(`download:${kind}`);
  }
}

/* 首次运行：从安装包里的 bundled zip 解压内置 VLC 到 tools/。
 * 已有可执行文件时跳过（不覆盖用户已有的）；zip 不在或哈希
 * 不对时不解压，留给 downloadComponent() 作后备，并如实报。
 * Chromium（v1.6.0）：不再打包内置，这里只认此前已下载好的，
 * 没下载时如实报未下载，不拦启动（首次使用浏览器时再下载）。 */
async function ensureBundledComponents() {
  const out = {};
  const exe = findVlc();
  if (exe) { out.vlc = { ok: true, source: 'already-present' }; }
  else {
    const zip = bundledZipPath('vlc');
    if (!zip) { out.vlc = { ok: false, error: '安装包里没有内置组件包' }; }
    else {
      try {
        const sum = await sha256File(zip);
        if (sum !== BUNDLED_SHA256.vlc) {
          out.vlc = { ok: false, error: `内置组件包校验失败（sha256 不符）：${path.basename(zip)}` };
        } else {
          await extractZip(zip, vlcDir());
          out.vlc = findVlc() ? { ok: true, source: 'bundled' } : { ok: false, error: '内置组件解压后仍找不到可执行文件' };
        }
      } catch (e) {
        out.vlc = { ok: false, error: e.message || String(e) };
      }
    }
  }
  out.browser = browserStatus().found
    ? { ok: true, source: 'already-present' }
    : { ok: false, error: '未下载：首次使用浏览器时在「浏览器」页下载官方快照' };
  // 2026-11-27-3：WinTun 驱动文件随包内置，首次运行解压到 tools/wintun/。
  out.wintun = await ensureWintunDll();
  if (out.vlc?.ok) ensureVlcPreset();
  if (out.browser?.ok) ensureChromiumPreset();
  return out;
}

/* ---------------- winget 工具管理 ---------------- */

function wingetAvailable() {
  return process.platform === 'win32';
}
function runWinget(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn('winget', args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 已退出 */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
}

/** 解析 winget 的表格输出：表头行给出各列的起始位置，
 * 分隔线（---）之后是数据行。兼容中英文表头。 */
function parseWingetTable(text) {
  const lines = text.split(/\r?\n/);
  const sepIdx = lines.findIndex((l) => /^\s*-{3,}/.test(l));
  if (sepIdx < 1) return [];
  const header = lines[sepIdx - 1];
  const colNames = [
    { key: 'name', labels: ['名称', 'Name'] },
    { key: 'id', labels: ['ID', 'Id'] },
    { key: 'version', labels: ['版本', 'Version'] },
    { key: 'available', labels: ['可用', 'Available'] },
    { key: 'source', labels: ['源', 'Source'] },
  ];
  const cols = [];
  for (const c of colNames) {
    for (const label of c.labels) {
      const idx = header.indexOf(label);
      if (idx >= 0) { cols.push({ key: c.key, start: idx }); break; }
    }
  }
  cols.sort((a, b) => a.start - b.start);
  if (!cols.some((c) => c.key === 'id')) return [];
  const rows = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const row = {};
    for (let j = 0; j < cols.length; j++) {
      const start = cols[j].start;
      const end = j + 1 < cols.length ? cols[j + 1].start : undefined;
      row[cols[j].key] = line.slice(start, end).trim();
    }
    if (row.id) rows.push(row);
  }
  return rows;
}

const wingetJobs = new Map(); // jobId -> {label, status, log[]}
let wingetJobSeq = 0;
/* 2026-11-26-6 B1：winget 任务原来没有超时、没有
 * --disable-interactivity，winget 卡在搜索源或交互确认上时
 * 界面半天没反应；「搜索源失败」是 winget 自己的中文报错，
 * 经 job log 透出（代码里本来就没有这串文案）。
 * 修法：卸载任务 180 秒超时（超时杀掉并报「卸载超时」）；
 * 失败且日志里出现搜索源失败时，改走注册表 UninstallString
 * 静默卸载作后备，不再依赖搜索源；log 里保留 winget 原始
 * 报错行，再加一句白话原因。 */
function runWingetJob(label, args, opts) {
  const id = ++wingetJobSeq;
  const job = { id, label, status: 'running', log: [] };
  wingetJobs.set(id, job);
  const push = () => sendToRenderer('winget-job', { id, label, status: job.status, log: job.log.slice(-80) });
  push();
  const timeoutMs = (opts && opts.timeoutMs) || (String(label || '').startsWith('卸载') ? 180000 : 0);
  const uninstallId = (opts && opts.uninstallId) ? String(opts.uninstallId) : '';
  const child = spawn('winget', args, { windowsHide: true });
  let finished = false;
  let timer = null;
  const finishFailed = (line) => {
    if (finished) return;
    finished = true;
    job.status = 'failed';
    if (line) job.log.push(line);
    push();
  };
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* 已退出 */ }
      finishFailed(String(label || '').startsWith('卸载') ? '卸载超时（180 秒）：winget 长时间没有回应，已停止任务' : `任务超时（${Math.round(timeoutMs / 1000)} 秒）：winget 长时间没有回应，已停止任务`);
    }, timeoutMs);
    timer.unref && timer.unref();
  }
  const onData = (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const t = line.trim();
      if (t) job.log.push(t);
    }
    push();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { if (timer) clearTimeout(timer); if (!finished) { finished = true; job.status = 'failed'; job.log.push(`启动 winget 失败：${e.message}`); push(); } });
  child.on('close', (code) => {
    if (timer) clearTimeout(timer);
    if (finished) return;
    if (code === 0) { finished = true; job.status = 'done'; job.log.push('完成'); push(); return; }
    // 失败：先看是不是搜索源失败——是则走注册表后备，不再依赖搜索源
    const logText = job.log.join('\n');
    const sourceFailed = /搜索源|failed to.*source|source.*fail|0x8a15/i.test(logText);
    if (uninstallId && sourceFailed) {
      job.log.push('白话原因：winget 连不上软件源（搜索源失败），所以找不到这个软件；改用注册表里的卸载命令继续卸载，不再依赖搜索源。');
      push();
      void runRegistryUninstall(uninstallId, job, () => { finished = true; });
      return;
    }
    finished = true;
    job.status = 'failed';
    job.log.push(`winget 退出码 ${code}`);
    push();
  });
  return { jobId: id };
}
/* 注册表 UninstallString 静默卸载（B1 后备、B2/B3 共用查找）。
 * 先查已导入清单里的 wingetId 映射，再读注册表 Uninstall 表。 */
async function readRegistryUninstallRows() {
  if (process.platform !== 'win32') return [];
  const ps = `Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, DisplayIcon, PSPath | ConvertTo-Json -Depth 2`;
  const r = await runCmd('powershell', ['-NoProfile', '-Command', ps], 120000);
  let rows = [];
  try {
    const parsed = JSON.parse(r.out || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) { rows = []; }
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const name = String((row && row.DisplayName) || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name, version: String((row && row.DisplayVersion) || ''), publisher: String((row && row.Publisher) || ''),
      installLocation: String((row && row.InstallLocation) || ''), uninstallString: String((row && row.UninstallString) || ''),
      // 2026-11-27-2：补 DisplayIcon（安装目录后备链用）与注册表键路径（转移后更新卸载项用）。
      displayIcon: String((row && row.DisplayIcon) || ''),
      registryKey: psPathToRegPath((row && row.PSPath) || ''),
    });
  }
  return out;
}
/* PowerShell PSPath（如 Microsoft.PowerShell.Core\Registry::HKEY_LOCAL_MACHINE\SOFTWARE\...）
 * 转 reg.exe 能用的键路径（HKLM\SOFTWARE\...）。转不出来返回 ''。 */
function psPathToRegPath(psPath) {
  const m = /^Microsoft\.PowerShell\.Core\\Registry::(HKEY_[A-Z_]+)\\(.*)$/.exec(String(psPath || '').trim());
  if (!m) return '';
  const hive = { HKEY_LOCAL_MACHINE: 'HKLM', HKEY_CURRENT_USER: 'HKCU', HKEY_CLASSES_ROOT: 'HKCR', HKEY_USERS: 'HKU', HKEY_CURRENT_CONFIG: 'HKCC' }[m[1]] || m[1];
  return `${hive}\\${m[2]}`;
}
async function findInstalledEntry(idOrName) {
  const key = String(idOrName || '').trim().toLowerCase();
  if (!key) return null;
  const imported = readJsonFile('installed-import.json', []);
  if (Array.isArray(imported)) {
    const hit = imported.find((x) => String(x.wingetId || '').toLowerCase() === key || String(x.name || '').toLowerCase() === key);
    if (hit) return { name: hit.name, version: hit.version || '', installLocation: hit.installLocation || '', uninstallString: hit.uninstall || hit.uninstallString || '', displayIcon: hit.displayIcon || '', registryKey: hit.registryKey || '', wingetId: hit.wingetId || '' };
  }
  const rows = await readRegistryUninstallRows();
  let hit = rows.find((r) => r.name.toLowerCase() === key);
  if (!hit) hit = rows.find((r) => r.name.toLowerCase().includes(key) || key.includes(r.name.toLowerCase()));
  if (hit) return hit;
  // 2026-11-27-2：渲染层传的是 winget id（如 VideoLAN.VLC），注册表里
  // 只有显示名（VLC media player），直接按名字对不上是 -6“点名称全军
  // 覆没”的主因之一。id 里带点时用 winget list --id 查出显示名再按名找注册表。
  if (key.includes('.') && wingetAvailable()) {
    try {
      const r = await runWinget(['list', '--id', String(idOrName), '--accept-source-agreements'], 60000);
      const wrows = parseWingetTable(r.out || '');
      const wname = String((wrows[0] && wrows[0].name) || '').trim();
      if (wname) {
        const byName = rows.find((x) => x.name.toLowerCase() === wname.toLowerCase())
          || rows.find((x) => x.name.toLowerCase().includes(wname.toLowerCase()) || wname.toLowerCase().includes(x.name.toLowerCase()));
        if (byName) return { ...byName, wingetId: String(idOrName) };
        return { name: wname, version: (wrows[0] && wrows[0].version) || '', installLocation: '', uninstallString: '', displayIcon: '', registryKey: '', wingetId: String(idOrName) };
      }
    } catch (e) { /* winget 查不到就按找不到处理，下游给具体原因 */ }
  }
  return null;
}
function splitCommandLine(str) {
  const out = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && /\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function parseUninstallString(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const parts = splitCommandLine(str);
  if (!parts.length) return null;
  const exe = parts[0];
  const args = parts.slice(1);
  const base = exe.split(/[\\/]/).pop().toLowerCase();
  if (base === 'msiexec.exe') {
    const guidArg = args.find((a) => /\{[0-9A-Fa-f-]{36}\}/.test(a));
    const guid = guidArg ? (/\{[0-9A-Fa-f-]{36}\}/.exec(guidArg) || [])[0] : '';
    if (!guid) return null;
    return { exe, args: ['/x', guid, '/qn', '/norestart'], kind: 'msi' };
  }
  const joined = args.join(' ');
  const hasSilent = /\/(S|silent|quiet|VERYSILENT|qn|qb!?)(\s|$)/i.test(joined + ' ');
  return { exe, args: hasSilent ? args : [...args, '/S'], kind: 'exe' };
}
async function runRegistryUninstall(idOrName, job, done) {
  const entry = await findInstalledEntry(idOrName);
  if (!entry || !entry.uninstallString) {
    job.status = 'failed';
    job.log.push('注册表后备也失败：注册表里找不到这个软件的卸载命令，请在 Windows「设置 → 应用」里手动卸载。');
    if (job && job.id != null) sendToRenderer('winget-job', { id: job.id, label: job.label || '', status: job.status, log: job.log.slice(-80) });
    if (done) done();
    return { ok: false, error: '注册表里找不到卸载命令' };
  }
  const parsed = parseUninstallString(entry.uninstallString);
  if (!parsed) {
    job.status = 'failed';
    job.log.push('注册表后备也失败：注册表里的卸载命令解析不出来，请在 Windows「设置 → 应用」里手动卸载。');
    sendToRenderer('winget-job', { id: job.id, label: job.label || '', status: job.status, log: job.log.slice(-80) });
    if (done) done();
    return { ok: false, error: '卸载命令解析失败' };
  }
  job.log.push(`正在用注册表卸载命令卸载「${entry.name}」…`);
  sendToRenderer('winget-job', { id: job.id, label: job.label || '', status: job.status, log: job.log.slice(-80) });
  const r = await new Promise((resolve) => {
    const child = spawn(parsed.exe, parsed.args, { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 已退出 */ } resolve({ code: -1, out, err: '卸载超时（180 秒）' }); }, 180000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
  if (r.code === 0 || r.code === 3010) {
    job.status = 'done';
    job.log.push('已通过注册表卸载命令完成卸载。');
  } else {
    job.status = 'failed';
    job.log.push(`注册表卸载命令失败（退出码 ${r.code}）：${`${r.err || r.out || ''}`.trim().slice(-200) || '未知错误'}，请在 Windows「设置 → 应用」里手动卸载。`);
  }
  sendToRenderer('winget-job', { id: job.id, label: job.label || '', status: job.status, log: job.log.slice(-80) });
  if (done) done();
  return { ok: job.status === 'done' };
}



/* ---------------- 必备环境与依赖（v1.2.0） ----------------
 * 诚实边界：winget 清单经常不声明依赖，GitHub Release 说明
 * 是自由文本——没声明 / 没写清楚的依赖，工具箱如实说「无法
 * 自动检测」，绝不假装已检测。版本冲突只按已知的已装版本与
 * 要求版本比对；要求版本没写明的，只能报「未知，按本体要求
 * 为准」。VC++ 运行库各版本累计、.NET 大版本可并存，一般
 * 不冲突，界面上会写明。 */

const PREREQS = [
  { key: 'winget', name: 'winget（App Installer）', why: '工具管理装软件全靠它，没有它装不了任何软件', wingetId: '', checkCmd: null },
  { key: 'dotnet', name: '.NET 桌面运行库 8', why: '很多 Windows 程序（包括部分 winget 包）运行时需要', wingetId: 'Microsoft.DotNet.DesktopRuntime.8', checkCmd: null },
  { key: 'vcredist', name: 'VC++ 2015-2022 运行库 x64', why: '很多 C++ 程序运行时需要，缺了会报缺 dll', wingetId: 'Microsoft.VCRedist.2015+.x64', checkCmd: null },
  { key: 'python', name: 'Python 3', why: '部分工具、脚本与安装包需要 Python', wingetId: 'Python.Python.3.12', checkCmd: ['python', '--version'] },
  { key: 'node', name: 'Node.js LTS', why: '部分工具、脚本与安装包需要 Node', wingetId: 'OpenJS.NodeJS.LTS', checkCmd: ['node', '--version'] },
];

function runCmd(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 已退出 */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
}
function compareVersions(a, b) {
  const pa = String(a || '0').split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || '0').split(/[^0-9]+/).filter(Boolean).map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
function extractRequiredVersion(text) {
  const m = String(text || '').match(/(?:>=|=>|最低|至少|requires?\s*(?:version\s*)?|version\s*>=?)\s*([0-9]+(?:\.[0-9]+){0,3})/i);
  return m ? m[1] : '';
}

async function checkPrereq(item) {
  if (process.platform !== 'win32') {
    return { ...item, status: 'unknown', version: '', note: '只在 Windows 上检测（当前不是 Windows）' };
  }
  if (item.key === 'winget') {
    const r = await runCmd('winget', ['--version'], 20000);
    const v = (r.out || r.err || '').trim().split(/\s+/)[0];
    if (r.code === 0 && v) return { ...item, status: 'ok', version: v, note: '' };
    return { ...item, status: 'missing', version: '', note: 'winget 不在：请在微软商店安装「应用安装程序」（App Installer），工具箱无法用 winget 自己装 winget' };
  }
  if (item.checkCmd) {
    const r = await runCmd(item.checkCmd[0], item.checkCmd.slice(1), 20000);
    const text = `${r.out || ''} ${r.err || ''}`.trim();
    const m = text.match(/([0-9]+(?:\.[0-9]+){1,3})/);
    if (r.code === 0 && m) return { ...item, status: 'ok', version: m[1], note: '' };
  }
  if (item.wingetId) {
    const r = await runWinget(['list', '--id', item.wingetId, '--accept-source-agreements'], 60000);
    const rows = parseWingetTable(r.out);
    if (rows[0]) return { ...item, status: 'ok', version: rows[0].version || '', note: '' };
  }
  return { ...item, status: 'missing', version: '', note: '未检测到，可一键安装' };
}

/** 查一个 winget 包的依赖：winget show 的依赖节。
 * 返回的每条依赖都去已安装里核对，并做冲突判断。 */
async function wingetDepsFor(id) {
  if (!wingetAvailable()) return { available: false, deps: [], note: 'winget 只能在 Windows 上用，无法查依赖。' };
  const r = await runWinget(['show', '--id', String(id), '-e', '--accept-source-agreements'], 90000);
  const text = r.out || '';
  const deps = [];
  const lines = text.split(/\r?\n/);
  let inDeps = false;
  for (const line of lines) {
    if (/依赖|Dependencies/i.test(line)) { inDeps = true; continue; }
    if (inDeps) {
      if (!line.trim()) continue;
      if (/^(说明|Description|安装|版本|作者|主页|许可|类别|标签|下载|源|Id|ID|名称|Name)\s*[:：]/i.test(line)) break;
      // 形如 "  Microsoft.VCRedist.2015+.x64" 或 "  .NET Desktop Runtime 8.0"
      const m = line.trim().match(/^([A-Za-z0-9][A-Za-z0-9._\-+]+(?:\.[A-Za-z0-9._\-+]+)*)\s*(.*)$/);
      if (m) {
        const name = m[1];
        const rest = m[2] || '';
        const required = extractRequiredVersion(rest) || extractRequiredVersion(line);
        deps.push({ name, id: name.includes('.') ? name : '', requiredVersion: required, rest, source: 'winget 清单' });
      }
    }
  }
  // 去重，并逐条核对已安装与冲突
  const seen = new Set();
  const out = [];
  for (const d of deps) {
    const key = (d.id || d.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let installed = false, installedVersion = '';
    if (d.id) {
      const lr = await runWinget(['list', '--id', d.id, '--accept-source-agreements'], 60000);
      const rows = parseWingetTable(lr.out);
      if (rows[0]) { installed = true; installedVersion = rows[0].version || ''; }
    }
    let conflict = '';
    if (installed && d.requiredVersion && installedVersion && compareVersions(installedVersion, d.requiredVersion) < 0) {
      conflict = `已装 ${installedVersion}，要求 ${d.requiredVersion}：需先升级该依赖，否则本体可能装不上或跑不起来。处理：点「一起装」会先升级依赖；也可跳过依赖只装本体，但本体可能报错。`;
    }
    if (installed && d.requiredVersion && installedVersion && compareVersions(installedVersion, d.requiredVersion) >= 0) {
      // 已装更高版本，满足要求
    }
    out.push({ ...d, installed, installedVersion, conflict,
      note: /VC\+\+|VCRedist/i.test(d.name) ? 'VC++ 运行库各版本累计，一般可并存，不冲突。'
        : /\.NET|DotNet/i.test(d.name) ? '.NET 大版本可并存，不冲突。' : '' });
  }
  // 同一依赖被要求不同版本时也算冲突
  const byId = {};
  for (const d of out) {
    const k = (d.id || d.name).toLowerCase();
    byId[k] = byId[k] || new Set();
    if (d.requiredVersion) byId[k].add(d.requiredVersion);
  }
  for (const d of out) {
    const k = (d.id || d.name).toLowerCase();
    if (byId[k] && byId[k].size > 1) {
      d.conflict = (d.conflict ? d.conflict + ' ' : '') + `同一依赖被要求多个版本（${[...byId[k]].join('、')}）：处理：装最高的要求版本，一般向下兼容；不兼容时请选「跳过」并手动装对应版本。`;
    }
  }
  return { available: true, deps: out,
    note: out.length ? '' : 'winget 清单里没有声明依赖——不代表没有依赖，只是清单没写，无法自动检测；安装后如报错缺 dll / 缺运行库，再按报错装对应运行库。' };
}

/** 从 GitHub Release 说明里找依赖：自由文本，只能按关键字
 * 提取，明确标「未自动验证」。 */
function depsFromReleaseBody(body) {
  const found = [];
  const text = String(body || '');
  const rules = [
    { key: 'dotnet', re: /\.NET[^ \n]{0,40}/i, wingetId: 'Microsoft.DotNet.DesktopRuntime.8', label: '.NET 运行库' },
    { key: 'vcredist', re: /(Visual C\+\+|VC\+\+|VCRedist)[^ \n]{0,40}/i, wingetId: 'Microsoft.VCRedist.2015+.x64', label: 'VC++ 运行库' },
    { key: 'python', re: /Python[^ \n]{0,30}/i, wingetId: 'Python.Python.3.12', label: 'Python' },
    { key: 'node', re: /Node\.?js[^ \n]{0,30}/i, wingetId: 'OpenJS.NodeJS.LTS', label: 'Node.js' },
  ];
  for (const line of text.split(/\r?\n/)) {
    for (const rule of rules) {
      if (rule.re.test(line) && !found.some((f) => f.key === rule.key)) {
        found.push({ key: rule.key, label: rule.label, wingetId: rule.wingetId, line: line.trim().slice(0, 200), source: 'Release 说明（未自动验证）', requiredVersion: extractRequiredVersion(line) });
      }
    }
  }
  return found;
}

/* ---------------- GitHub API（令牌只存在本地 config.json） ---------------- */

async function githubApi(apiPath, token) {
  // 走 httpJson：配置了 HTTP 代理时 GitHub 请求也走代理
  const r = await httpJson('GET', `https://api.github.com${apiPath}`, null, {
    'User-Agent': `MuseToolbox/${VERSION}`,
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, 30000);
  if (!r.ok) return { ok: false, status: r.status, error: r.error || `GitHub API HTTP ${r.status}` };
  return { ok: true, data: r.data };
}

function downloadGithubAsset(url, dest, token) {
  return new Promise((resolve) => {
    const request = (u, redirects) => {
      if (redirects > 8) { resolve({ ok: false, error: '下载重定向次数过多' }); return; }
      const lib = u.startsWith('https:') ? https : http;
      const req = lib.get(u, {
        headers: { 'User-Agent': `MuseToolbox/${VERSION}`, Accept: 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          request(new URL(res.headers.location, u).toString(), redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `下载失败：HTTP ${res.statusCode}` }); return; }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve({ ok: true, file: dest })));
        out.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
    };
    request(url, 0);
  });
}


/* ---------------- 代码热更新（2026-11-26-2） ----------------
 * 只手动、不自动：设置里点「检查更新」，工具箱去 GitHub 仓
 * 库拉 update-manifest.json（版本号 + 每个代码文件的
 * sha256），只下载清单里有变化的代码文件（main.js、
 * preload.js、renderer/*、package.json，代码一共约 500KB），
 * 逐个校验 sha256；下载前先备份旧文件，替换完提示重启生效。
 * 下载或校验失败就保留旧文件、如实报错，绝不把程序弄坏。
 * Electron、VLC、Chromium 这些大块头不走热更新，只有它们
 * 变了才需要重新下载整个文件夹，界面上写清楚。
 * 清单文件放在仓库根目录 desktop-toolbox/update-manifest.json，
 * 生成方式见 README 与 scripts/gen-manifest.js；发版时把清单
 * 与代码一起推上 GitHub。仓库里目前还没有清单文件，查不到
 * 时如实显示「未找到更新信息」，不崩、不谎报。
 * 前提：打包时 asar 必须关掉（electron-builder.yml），代码
 * 以明文文件放在 resources/app/ 里，热更新才能直接替换。 */
const UPDATE_OWNER = 'zmfs9192';
const UPDATE_REPO = 'zhuo-mian-liao-tian-kong-jian';
const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`;
const UPDATE_MANIFEST_PATH = 'desktop-toolbox/update-manifest.json';
const UPDATE_MANIFEST_BRANCHES = ['main', 'master'];
/* 只允许热更新这几个代码文件：白名单，清单里出现别的路径
 * 一律忽略，防清单被篡改后往程序里写任意文件。
 * package.json 不在里面：打包时 electron-builder 会删掉它的
 * devDependencies 与 scripts，发出去的文件哈希永远对不上源码
 * 的哈希；而且它运行时不起作用（版本号在 main.js 的 VERSION
 * 里），没必要热更新。 */
const HOT_UPDATE_FILES = ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css'];
let lastUpdateManifest = null; // 最近一次检查到的清单（内存里）

function getUpdateState() { return readJsonFile('update-state.json', {}); }
function saveUpdateState(patch) { const s = { ...getUpdateState(), ...patch }; writeJsonFile('update-state.json', s); return s; }
function compareVersions(a, b) {
  // 归一化：tag 用 2026-11-26-2、内部用 2026.11.26-2，
  // 把 - 也当成分隔符，两边比较结果一致。
  const pa = String(a || '').replace(/^v/i, '').replace(/-/g, '.').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').replace(/-/g, '.').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
/* 代码文件在本机的实际位置：打包后是 resources/app/<路径>，
 * 开发运行是源码目录 <路径>；只认白名单里的路径，且解析后
 * 必须仍在代码目录内，防「../」逃逸。 */
function appCodePath(rel) {
  const base = path.resolve(__dirname);
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) return '';
  return full;
}
async function localFileSha256(rel) {
  const full = appCodePath(rel);
  if (!full) return '';
  try { return await sha256File(full); } catch (e) { return ''; }
}
function manifestRawUrl(branch) {
  return `https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/${branch}/${UPDATE_MANIFEST_PATH}`;
}
async function fetchUpdateManifest(manifestUrl) {
  // manifestUrl 只给自测用（本地模拟服务器）；正常走 GitHub raw，
  // main 分支 404 时再试 master。返回 { ok, manifest } 或
  // { ok:false, noManifest:true } / { ok:false, error }。
  // 2026-11-26-3：仓库是私有的，raw.githubusercontent.com 不带
  // 令牌会返回 404——所以配置了 GitHub 令牌时带上它拉清单；
  // 没配令牌时行为不变（公开仓库仍能直接拉到）。
  const token = getConfig().githubToken || '';
  const headers = { 'User-Agent': `MuseToolbox/${VERSION}`, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const urls = manifestUrl ? [manifestUrl] : UPDATE_MANIFEST_BRANCHES.map(manifestRawUrl);
  let lastError = '';
  for (const u of urls) {
    const r = await httpJson('GET', u, null, headers, 30000);
    if (r.ok && r.data && typeof r.data === 'object') return { ok: true, manifest: r.data, url: u };
    if (r.status === 404) { lastError = 'not-found'; continue; }
    lastError = r.error || `HTTP ${r.status || ''}`;
  }
  if (lastError === 'not-found') return { ok: false, noManifest: true };
  return { ok: false, error: lastError || '无法连接 GitHub' };
}

async function checkToolboxUpdate(opts) {
  const now = Date.now();
  const manifestUrl = opts && opts.manifestUrl ? String(opts.manifestUrl) : '';
  const f = await fetchUpdateManifest(manifestUrl);
  if (!f.ok) {
    const state = saveUpdateState({
      lastCheckAt: now,
      lastCheckResult: f.noManifest ? 'no-manifest' : 'error',
      lastCheckMessage: f.noManifest
        ? '未找到更新信息：仓库里还没有更新清单文件（update-manifest.json），需先把代码与清单一起推上 GitHub 才能更新。'
        : `检查失败：${f.error || '无法连接 GitHub'}。`,
      latestVersion: '', latestDisplayVersion: '', changedFiles: [], totalBytes: 0,
    });
    lastUpdateManifest = null;
    return { ok: false, noManifest: !!f.noManifest, error: state.lastCheckMessage, state };
  }
  const m = f.manifest;
  const latestInternal = String(m.internalVersion || m.version || '');
  const latestDisplay = String(m.displayVersion || m.version || latestInternal);
  if (!latestInternal || !Array.isArray(m.files)) {
    const state = saveUpdateState({ lastCheckAt: now, lastCheckResult: 'error', lastCheckMessage: '更新清单文件格式不对（缺版本号或文件列表），已停止，未改动任何文件。', latestVersion: '', latestDisplayVersion: '', changedFiles: [], totalBytes: 0 });
    lastUpdateManifest = null;
    return { ok: false, error: state.lastCheckMessage, state };
  }
  const newer = compareVersions(latestInternal, VERSION) > 0;
  const changed = [];
  if (newer) {
    for (const item of m.files) {
      const rel = String(item.path || '');
      if (!HOT_UPDATE_FILES.includes(rel)) continue; // 不在白名单里不更新
      const want = String(item.sha256 || '').toLowerCase();
      if (!want) continue;
      const have = await localFileSha256(rel);
      if (have !== want) changed.push({ path: rel, size: Number(item.size || 0), sha256: want });
    }
  }
  const totalBytes = changed.reduce((n, c) => n + (c.size || 0), 0);
  const state = saveUpdateState({
    lastCheckAt: now,
    lastCheckResult: newer ? (changed.length ? 'update-available' : 'up-to-date') : 'up-to-date',
    lastCheckMessage: !newer
      ? `已是最新版本（当前 ${DISPLAY_VERSION}，最新 ${latestDisplay}）。`
      : (changed.length ? `发现新版本 ${latestDisplay}，${changed.length} 个代码文件有变化（共约 ${Math.max(1, Math.round(totalBytes / 1024))}KB），点「一键更新」只下载这些文件。` : `发现新版本 ${latestDisplay}，但代码文件与本机一致，无需下载。`),
    latestVersion: latestInternal, latestDisplayVersion: latestDisplay,
    changedFiles: changed, totalBytes,
    manifestUrl: f.url, manifestNotes: String(m.notes || ''),
    manifest: m, // 存一份清单，重启后点「一键更新」不用重新检查
  });
  lastUpdateManifest = m;
  return { ok: true, newer, latest: latestDisplay, changed, totalBytes, state };
}

let updateApplyRunning = false;
async function applyToolboxUpdate() {
  if (updateApplyRunning) return { ok: false, error: '正在更新，请稍候' };
  const st = getUpdateState();
  const changed = Array.isArray(st.changedFiles) ? st.changedFiles : [];
  const manifest = lastUpdateManifest || st.manifest || null;
  if (!changed.length) return { ok: false, error: '没有可更新的代码文件：请先点「检查更新」，确认有新版本且有文件变化。' };
  if (!manifest) return { ok: false, error: '更新清单已失效：请重新点「检查更新」后再点「一键更新」。' };
  updateApplyRunning = true;
  const push = (job) => {
    sendToRenderer('update-progress', job);
    setTaskbarProgress(job.status === 'running' ? Math.max(0, Math.min(1, (job.pct || 0) / 100)) : -1);
  };
  acquireSleepBlock('download:update'); // 热更新下载期间防止电脑休眠
  // 文件下载地址与清单同源（清单在 desktop-toolbox/ 下，文件也在同一目录）。
  const manifestBase = String(st.manifestUrl || manifestRawUrl('main')).replace(/update-manifest\.json$/, '');
  const tmpDir = path.join(userDataDir(), 'update-tmp');
  const backupDir = path.join(userDataDir(), 'update-backups', String(st.latestVersion || 'unknown').replace(/[^0-9A-Za-z._-]/g, '_'));
  const downloaded = [];
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    push({ status: 'running', pct: 0, error: '' });
    // 第一步：全部先下载到临时目录并逐个校验 sha256，
    // 有一个失败就停，旧文件一个不动。
    for (let i = 0; i < changed.length; i++) {
      const c = changed[i];
      const tmp = path.join(tmpDir, c.path.replace(/\//g, '_'));
      await downloadFile(manifestBase + c.path, tmp, (p) => push({ status: 'running', pct: Math.round(((i + p) / changed.length) * 90), error: '' }), { resume: false });
      const sum = await sha256File(tmp);
      if (sum.toLowerCase() !== c.sha256.toLowerCase()) throw new Error(`文件 ${c.path} 校验失败（sha256 对不上），已停止，旧文件未动。`);
      downloaded.push({ ...c, tmp });
    }
    push({ status: 'running', pct: 92, error: '' });
    // 第二步：先备份旧文件，再替换；替换中出错就按备份全数还原。
    const replaced = [];
    try {
      for (const d of downloaded) {
        const target = appCodePath(d.path);
        if (!target) throw new Error(`拒绝写入不在白名单里的路径：${d.path}`);
        const bak = path.join(backupDir, d.path.replace(/\//g, '_'));
        if (fs.existsSync(target)) fs.copyFileSync(target, bak);
        else fs.writeFileSync(bak + '.missing', '');
        fs.copyFileSync(d.tmp, target);
        const sum = await sha256File(target);
        if (sum.toLowerCase() !== d.sha256.toLowerCase()) throw new Error(`文件 ${d.path} 替换后校验失败，已还原旧文件。`);
        replaced.push(d);
      }
    } catch (e) {
      for (const d of replaced) {
        try {
          const bak = path.join(backupDir, d.path.replace(/\//g, '_'));
          const target = appCodePath(d.path);
          if (fs.existsSync(bak)) fs.copyFileSync(bak, target);
          else if (fs.existsSync(bak + '.missing')) fs.rmSync(target, { force: true });
        } catch (e2) { /* 还原尽力而为，报错一并报出 */ }
      }
      throw e;
    }
    saveUpdateState({ pendingRestart: true, updatedFiles: replaced.map((d) => d.path), updatedVersion: st.latestVersion, backupDir, changedFiles: [], totalBytes: 0 });
    push({ status: 'done', pct: 100, error: '' });
    notify('更新已就绪', `代码已更新到 ${st.latestDisplayVersion || ''}，点「重启生效」后用新版本。`);
    return { ok: true, updated: replaced.map((d) => d.path), version: st.latestDisplayVersion, backupDir };
  } catch (e) {
    const msg = e.message || String(e);
    push({ status: 'failed', pct: 0, error: msg });
    return { ok: false, error: msg };
  } finally {
    updateApplyRunning = false;
    releaseSleepBlock('download:update');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 临时目录删不掉不影响 */ }
  }
}

/* ---------------- 工具箱本地功能：智能体/创作/代码/图像/监控/记账本/
 * 注册/远程/文件/代理 —— 全部是工具箱自己的实现与本地数据，
 * 不读空间、不连空间；只有点右下角悬浮圆点才打开空间。 */

function localId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function readJsonFile(name, fallback) {
  const fp = path.join(userDataDir(), name);
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { /* 损坏按空处理 */ }
  return fallback;
}
function writeJsonFile(name, value) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(), name), JSON.stringify(value, null, 2), 'utf8');
}

/* 经代理（配置在设置里，HTTP CONNECT）或直连发一个 JSON 请求，
 * 返回 { ok, status, data, error }。工具箱自己的网络请求都走这里。 */
function httpJson(method, urlStr, bodyObj, headers, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const cfg = getConfig();
    const px = effectiveProxy(u.hostname);
    const useProxy = !!px;
    const payload = bodyObj == null ? null : JSON.stringify(bodyObj);
    const reqHeaders = { ...(payload == null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }), ...headers };
    const done = (r) => resolve(r);
    const doRequest = (socket) => {
      const opts = {
        method, path: u.pathname + u.search, headers: reqHeaders,
        ...(socket ? { socket, servername: u.hostname } : { hostname: u.hostname, port: u.port || 443 }),
      };
      const req = (u.protocol === 'https:' ? https : http).request(opts, (res) => {
        let body = '';
        res.on('data', (d) => { body += d.toString(); });
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(body); } catch (e) { /* 非 JSON */ }
          if (res.statusCode >= 200 && res.statusCode < 300) done({ ok: true, status: res.statusCode, data });
          else done({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}：${(data && (data.error?.message || data.message)) || body.slice(0, 200)}` });
        });
      });
      req.on('error', (e) => done({ ok: false, error: e.message || String(e) }));
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('请求超时')); });
      if (payload == null) req.end(); else req.end(payload);
    };
    if (!useProxy) { doRequest(null); return; }
    const port = Number(px.port) || 8080;
    const sock = net.connect(port, px.host);
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) { /* 已关 */ } done({ ok: false, error: '代理连接超时' }); }, 20000);
    sock.on('error', (e) => { clearTimeout(timer); done({ ok: false, error: `代理连接失败：${e.message || String(e)}` }); });
    sock.on('connect', () => {
      sock.write(`CONNECT ${u.hostname}:${u.port || 443} HTTP/1.1\r\nHost: ${u.hostname}:${u.port || 443}\r\n\r\n`);
      let buf = '';
      const onData = (d) => {
        buf += d.toString();
        if (!buf.includes('\r\n\r\n')) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/\d\.\d 200/.test(buf)) { clearTimeout(timer); done({ ok: false, error: `代理拒绝连接：${buf.split('\r\n')[0]}` }); return; }
        clearTimeout(timer);
        if (u.protocol === 'https:') {
          const tlsSock = tls.connect({ socket: sock, servername: u.hostname }, () => doRequest(tlsSock));
          tlsSock.on('error', (e) => done({ ok: false, error: e.message || String(e) }));
        } else { doRequest(sock); }
      };
      sock.on('data', onData);
    });
  });
}

/* 代理分流：智能模式只把海外服务走代理，国内服务（DeepSeek、豆包、
 * 通义千问）与 .cn 域名直连；全局与手动模式全部走代理。Pioneer
 * 隧道已连接时，智能/全局/Tun 模式按同一张海外域名表决定
 * httpJson 走不走隧道（见 effectiveProxy）；未连接时全部直连。 */
function proxyApplies(mode, host) {
  if (mode === 'smart') return smartProxyHost(host);
  return true; // manual / global：全部走代理
}

/* ---------- 智能体（本地 API 对话） ---------- */
function getAgents() { const v = readJsonFile('agents.json', []); return Array.isArray(v) ? v : []; }
function getAgentChats() { const v = readJsonFile('agent-chats.json', []); return Array.isArray(v) ? v : []; }

/* ---------------- 多账号管理（2026-11-26-7） ----------------
 * 每个账号一个独立分区 persist:account-<id>：登录态与 Cookie
 * 各存各的不串。账号记录存 accounts.json（不进备份导出，见
 * BACKUP_FILE_NAMES）。代理密码只存记录里、只在主进程内存里
 * 用，绝不返回渲染层、不写日志、不进 preload 文件。 */
const ACCOUNT_SITES = {
  google: { siteName: 'Google', loginUrl: 'https://accounts.google.com', signupUrl: 'https://accounts.google.com/signup' },
  github: { siteName: 'GitHub', loginUrl: 'https://github.com/login', signupUrl: 'https://github.com/signup' },
  microsoft: { siteName: 'Microsoft', loginUrl: 'https://login.microsoftonline.com', signupUrl: 'https://signup.live.com' },
};
function getAccounts() { const v = readJsonFile('accounts.json', []); return Array.isArray(v) ? v : []; }
function saveAccounts(list) { writeJsonFile('accounts.json', list); }
/* ---------- 2026-11-27-3：账号登录严格认证指纹 ----------
 * 旧逻辑只凭“登录页跳转 + 页面出现登出/头像”就弹保存提示，跳转
 * 本身不等于登录成功（输错密码回首页、扫码中转等都会误判）。
 * 新逻辑：必须命中明确的已登录凭证 Cookie，才认定已登录；跳转与
 * DOM 信号只作弱信号，不再单独触发提示。Cookie 只在主进程读，
 * 只返回“是否命中 + 命中的键名”，凭证值不发给渲染层。 */
const AUTH_COOKIE_NAMES = [
  'sessionid', 'sessdata', 'session', '_session', 'auth_token', 'access_token',
  'refresh_token', 'sid', 'psid', '__secure-1psid', '__secure-3psid',
  'sso_token', 'login_token', 'passport', 'bili_jct', 'dedeuserid',
];
function isAuthCookieName(name) {
  const n = String(name || '').toLowerCase();
  if (AUTH_COOKIE_NAMES.includes(n)) return true;
  return /^(auth|access|login|sso)[-_]?token$/.test(n) || /^(session|_session)[-_]?id$/.test(n);
}
async function browserLoginCheck(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, loggedIn: false };
    // 账号浏览走独立分区；正在用账号浏览时不弹提示，渲染层已先拦。
    const ses = session.fromPartition('persist:toolbox-browser');
    const cookies = await ses.cookies.get({ url: u.origin });
    const hit = (cookies || []).map((c) => c.name).find((n) => isAuthCookieName(n)) || '';
    return { ok: true, loggedIn: !!hit, matchedKey: hit, host: u.hostname };
  } catch (e) { return { ok: false, loggedIn: false, error: e.message || String(e) }; }
}
/* “本次忽略 / 不再提示该站点”：本次忽略只放内存（退出即忘），
 * 不再提示落盘 account-login-ignored.json。 */
const loginIgnoreSession = new Set();
function loginIgnoreFile() { return path.join(userDataDir(), 'account-login-ignored.json'); }
function loginIgnoreLoad() { try { const v = JSON.parse(fs.readFileSync(loginIgnoreFile(), 'utf8')); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function loginIgnoreSave(v) { try { fs.writeFileSync(loginIgnoreFile(), JSON.stringify(v), 'utf8'); } catch (e) { /* 忽略 */ } }
function isLoginIgnored(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (loginIgnoreSession.has(h)) return true;
  return !!loginIgnoreLoad()[h];
}
function setLoginIgnored(host, scope) {
  const h = String(host || '').toLowerCase();
  if (!h) return { ok: false, error: '缺少站点' };
  if (scope === 'forever') {
    const v = loginIgnoreLoad(); v[h] = { at: Date.now() }; loginIgnoreSave(v);
  } else {
    loginIgnoreSession.add(h);
  }
  return { ok: true };
}
function accountPartition(id) { return `persist:account-${id}`; }
function accountDir(id) { return path.join(userDataDir(), 'accounts', String(id)); }
function accountPreloadPath(id) { return path.join(accountDir(id), 'preload.js'); }
/* 站点预设地址：已知站点固定用预设，custom 用账号自填的地址。 */
function resolveAccountSite(a) {
  const preset = ACCOUNT_SITES[a.site];
  if (preset) return { siteName: preset.siteName, loginUrl: preset.loginUrl, signupUrl: preset.signupUrl };
  return { siteName: String(a.siteName || '').trim() || '自定义', loginUrl: String(a.loginUrl || '').trim(), signupUrl: String(a.signupUrl || '').trim() };
}
/* 指纹只保留用户填过的值（空值不存、不返回）。 */
function normalizeFingerprint(input) {
  const f = (input && typeof input === 'object') ? input : {};
  const out = {};
  if (String(f.userAgent || '').trim()) out.userAgent = String(f.userAgent).trim();
  if (String(f.language || '').trim()) out.language = String(f.language).trim();
  if (String(f.timezone || '').trim()) out.timezone = String(f.timezone).trim();
  const w = Number(f.windowWidth);
  if (Number.isFinite(w) && w > 0) out.windowWidth = Math.floor(w);
  const h = Number(f.windowHeight);
  if (Number.isFinite(h) && h > 0) out.windowHeight = Math.floor(h);
  return out;
}
/* 公开视图：绝不含代理密码。signupUrl 与结构化代理（不含密码）
 * 随列表返回，供编辑回填；proxySummary 只作展示保留。 */
function publicAccountView(a) {
  const proxy = (a.proxy && typeof a.proxy === 'object') ? a.proxy : null;
  const hasProxy = !!(proxy && proxy.host);
  return {
    id: a.id, site: a.site || '', siteName: a.siteName || a.site || '',
    loginUrl: a.loginUrl || '', signupUrl: a.signupUrl || '', name: a.name || '', group: a.group || '', note: a.note || '',
    status: a.status === 'registering' ? 'registering' : 'active',
    createdAt: a.createdAt || 0, lastUsedAt: a.lastUsedAt || null,
    hasProxy,
    proxySummary: hasProxy ? `${proxy.type === 'socks5' ? 'SOCKS5' : 'HTTP'} ${proxy.host}:${proxy.port}` : '直连',
    proxy: hasProxy ? { type: proxy.type === 'socks5' ? 'socks5' : 'http', host: proxy.host, port: proxy.port, username: proxy.username || '' } : null,
    fingerprint: normalizeFingerprint(a.fingerprint),
  };
}
/* 对该分区的 session 应用代理、UA 与 Accept-Language。
 * onBeforeSendHeaders 传 null 先清旧监听，避免重复叠加
 *（Electron 24 的 WebRequest 接受 null 监听表示移除）。 */
async function applyAccountSession(account) {
  const ses = session.fromPartition(accountPartition(account.id));
  const proxy = (account.proxy && typeof account.proxy === 'object') ? account.proxy : null;
  if (proxy && proxy.host) {
    const rules = proxy.type === 'socks5'
      ? `socks5=${proxy.host}:${proxy.port}`
      : `http=${proxy.host}:${proxy.port};https=${proxy.host}:${proxy.port}`;
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: rules });
  } else {
    await ses.setProxy({ mode: 'direct' });
  }
  try { ses.closeAllConnections(); } catch (e) { /* 旧连接关不掉不拦打开 */ }
  const fp = normalizeFingerprint(account.fingerprint);
  if (fp.userAgent) { try { ses.setUserAgent(fp.userAgent); } catch (e) { /* UA 设置失败不拦打开 */ } }
  try { ses.webRequest.onBeforeSendHeaders(null); } catch (e) { /* 清旧监听失败不拦打开 */ }
  if (fp.language) {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'Accept-Language': fp.language } });
    });
  }
  return ses;
}
/* 生成该账号的 preload 文件：只写时区、语言、窗口尺寸这几
 * 个值，不写任何密钥、代理密码、账号名。没有定制项就不生成。
 * 注：preload 只能提供数值与尽力覆盖 screen 尺寸，改不了
 * Chromium 进程级时区（那要启动参数），时区值仅供页面读取。 */
function writeAccountPreload(account) {
  const fp = normalizeFingerprint(account.fingerprint);
  const hasCustom = !!(fp.timezone || fp.language || fp.windowWidth || fp.windowHeight);
  if (!hasCustom) {
    try { fs.rmSync(accountPreloadPath(account.id), { force: true }); } catch (e) { /* 删不掉不拦打开 */ }
    return '';
  }
  const values = { timezone: fp.timezone || '', language: fp.language || '', windowWidth: fp.windowWidth || 0, windowHeight: fp.windowHeight || 0 };
  const content = `'use strict';\n// 账号指纹（仅时区、语言、窗口尺寸；不含任何密钥与代理信息）。\nwindow.__toolboxAccountFingerprint = ${JSON.stringify(values)};\ntry {\n  const fp = window.__toolboxAccountFingerprint;\n  if (fp.windowWidth) {\n    Object.defineProperty(window.screen, 'width', { get: () => fp.windowWidth, configurable: true });\n    Object.defineProperty(window.screen, 'availWidth', { get: () => fp.windowWidth, configurable: true });\n  }\n  if (fp.windowHeight) {\n    Object.defineProperty(window.screen, 'height', { get: () => fp.windowHeight, configurable: true });\n    Object.defineProperty(window.screen, 'availHeight', { get: () => fp.windowHeight, configurable: true });\n  }\n} catch (e) { /* 指纹覆盖失败不影响页面加载 */ }\n`;
  fs.mkdirSync(accountDir(account.id), { recursive: true });
  fs.writeFileSync(accountPreloadPath(account.id), content, 'utf8');
  return pathToFileURL(accountPreloadPath(account.id)).href;
}
/* 打开账号的公共流程（account-open 与注册共用）：配好分区
 * session、生成 preload、写 activeAccountId 与 lastUsedAt。 */
async function openAccount(account, url, emptyUrlError) {
  if (!url) return { ok: false, error: emptyUrlError || '请先填写登录地址' };
  let preloadFileUrl = '';
  try {
    await applyAccountSession(account);
    // 2026-11-27-2：该账号分区也挂视频嗅探（与默认浏览器分区同一套监听）。
    ensureBrowserMediaSniff(accountPartition(account.id));
    preloadFileUrl = writeAccountPreload(account);
  } catch (e) {
    return { ok: false, error: `账号打开失败：${e.message || String(e)}` };
  }
  const fp = normalizeFingerprint(account.fingerprint);
  const cfg = getConfig();
  cfg.activeAccountId = account.id;
  saveConfig(cfg);
  const list = getAccounts();
  const it = list.find((a) => a.id === account.id);
  if (it) { it.lastUsedAt = Date.now(); saveAccounts(list); }
  return {
    ok: true,
    open: {
      accountId: account.id,
      partition: accountPartition(account.id),
      loginUrl: url,
      preloadFileUrl,
      userAgent: fp.userAgent || '',
      viewport: (fp.windowWidth && fp.windowHeight) ? { w: fp.windowWidth, h: fp.windowHeight } : null,
      siteName: resolveAccountSite(account).siteName,
    },
  };
}
/* 代理认证：只认代理（authInfo.isProxy）。按认证目标的 host/
 * port 找到对应账号（Electron 24 的 session 不暴露分区名，
 * 故按代理地址匹配），有账号密码才回凭证；找不到或无密码
 * 时不回空凭证，让它按默认流程处理。 */
function handleProxyLogin(event, _webContents, _authDetails, authInfo, callback) {
  try {
    if (!authInfo || !authInfo.isProxy) return;
    const account = getAccounts().find((a) => {
      const p = (a.proxy && typeof a.proxy === 'object') ? a.proxy : null;
      return p && p.host && String(p.host) === String(authInfo.host)
        && Number(p.port) === Number(authInfo.port) && p.username && p.password;
    });
    if (!account) return;
    event.preventDefault();
    callback(String(account.proxy.username), String(account.proxy.password));
  } catch (e) { /* 认证失败不拦页面 */ }
}
function agentBase(agent) { return (agent.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''); }
/* 2026-11-26-7：Anthropic 不是 OpenAI 兼容接口，走 Messages API
 *（POST /v1/messages，x-api-key + anthropic-version，system 放顶层）。
 *其余服务商（DeepSeek、OpenAI、Kimi、智谱、xAI、Mistral、混元、
 *文心千帆 v2、OpenRouter、硅基流动、豆包、通义千问、Gemini、自定义）
 *均为 OpenAI 兼容，走 /chat/completions + Bearer。 */
async function agentChatCompletions(agent, messages) {
  const base = agentBase(agent);
  if (String(agent.provider || '').toLowerCase() === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const r = await httpJson('POST', `${base}/messages`,
      { model: agent.model || 'claude-fable-5-2', max_tokens: 4096, ...(sys ? { system: sys } : {}), messages: rest },
      { 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' });
    if (!r.ok) return r;
    const text = (r.data?.content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
    return { ok: true, text };
  }
  const r = await httpJson('POST', `${base}/chat/completions`,
    { model: agent.model || 'gpt-4o-mini', messages },
    { Authorization: `Bearer ${agent.apiKey}` });
  if (!r.ok) return r;
  return { ok: true, text: r.data?.choices?.[0]?.message?.content || '' };
}
async function agentChatSend(chatId, content) {
  const chats = getAgentChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: '对话不存在' };
  const agent = getAgents().find((a) => a.id === chat.agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  if (agent.connectionType === 'web') {
    // 本条用户消息已推进 chat.messages：提示词用全部历史（含本条）
    const fullPrompt = buildWebPrompt(agent, chat.messages.slice(0, -1), content);
    const r = await webChatSend(agent, fullPrompt);
    if (!r.ok) return { ok: false, error: r.error, chat };
    const finalChat = appendChatMessage(chatId, 'assistant', r.text);
    return { ok: true, chat: finalChat };
  }
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  chat.messages.push({ role: 'user', content, at: Date.now() });
  const firstUser = chat.messages.find((m) => m.role === 'user');
  if (firstUser) chat.title = firstUser.content.slice(0, 24);
  chat.updatedAt = Date.now();
  writeJsonFile('agent-chats.json', chats);
  // v1.6.0：自然语言入口——先按本地意图匹配工具调用（不需要密钥）。
  const intent = parseToolIntent(content);
  if (intent) {
    const done = await executeToolCall(intent, chatId);
    return { ok: done.ok !== false, chat: done.chat || getAgentChats().find((c) => c.id === chatId), pending: done.pending || false, actionId: done.actionId };
  }
  const sysParts = [];
  if (agent.systemPrompt) sysParts.push(agent.systemPrompt);
  if (Array.isArray(agent.memories) && agent.memories.length) {
    sysParts.push(`长期记忆：\n${agent.memories.map((m) => `- ${m.text}`).join('\n')}`);
  }
  if (agent.toolsEnabled !== false) sysParts.push(AGENT_TOOLS_SPEC);
  const sysMsg = sysParts.length ? [{ role: 'system', content: sysParts.join('\n\n') }] : [];
  const history = getAgentChats().find((c) => c.id === chatId)?.messages || chat.messages;
  const r = await agentChatCompletions(agent, [...sysMsg, ...history.map((m) => ({ role: m.role, content: m.content }))]);
  if (!r.ok) return { ok: false, error: r.error, chat };
  const text = r.text || '';
  // LLM 也可以回 JSON 工具调用：执行后把结果再交给 LLM 说一句人话。
  const llmCall = parseLlmToolCall(text);
  if (llmCall) {
    const done = await executeToolCall(llmCall, chatId);
    if (done.pending) return { ok: true, chat: done.chat, pending: true, actionId: done.actionId };
    const r2 = await agentChatCompletions(agent, [...sysMsg, { role: 'user', content: `工具「${llmCall.label}」执行完了，结果如下：\n${done.resultText || ''}\n请用一两句中文告诉用户做了什么、结果怎样。` }]);
    const summary = r2.ok ? (r2.text || '') : '';
    const finalChat = appendChatMessage(chatId, 'assistant', summary || `已执行：${llmCall.label}\n${done.resultText || ''}`);
    return { ok: true, chat: finalChat };
  }
  const finalChat = appendChatMessage(chatId, 'assistant', text);
  return { ok: true, chat: finalChat };
}
async function agentToolConfirm(actionId, approved) {
  const list = getPendingActions();
  const action = list.find((a) => a.id === actionId);
  if (!action) return { ok: false, error: '这条待确认操作不存在或已处理' };
  const rest = list.filter((a) => a.id !== actionId);
  savePendingActions(rest);
  if (!approved) {
    const chat = appendChatMessage(action.chatId, 'assistant', `已取消：${action.label}`);
    return { ok: true, chat };
  }
  const done = await executeToolCall({ tool: action.tool, args: action.args, label: action.label }, action.chatId, { confirmed: true });
  return { ok: done.ok !== false, chat: done.chat };
}
async function agentComplete(agentId, system, userText) {
  const agent = getAgents().find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '先添加智能体' };
  if (agent.connectionType === 'web') {
    const prompt = [agent.systemPrompt, system, `用户：${userText}`].filter(Boolean).join('\n\n');
    const r = await webChatSend(agent, prompt);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, text: r.text };
  }
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  const sys = [agent.systemPrompt, system].filter(Boolean).join('\n\n');
  const r = await agentChatCompletions(agent, [{ role: 'system', content: sys }, { role: 'user', content: userText }]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.text || '' };
}

/* ---------- 智能体自然语言入口：本地工具调用（v1.6.0） ----------
 * 聊天窗口里打一句“帮我装个 VLC”“跑一下这段代码”“打开
 * Chrome”“查一下系统状态”，智能体先按本地意图匹配，匹配
 * 不上再走 LLM；LLM 回复里若带有 {"tool": "...", "args": {...}}
 * 也会执行。工具全部经主进程真实执行（winget 安装、启动程序、
 * 运行代码、文件操作、查系统状态等），执行结果写回聊天。
 * 危险操作（删文件、卸载、升级、装驱动、开 Tun）执行前必须
 * 先问用户确认：先在聊天里发一条待确认消息，用户点「确认
 * 执行」后才跑，点「取消」不跑。密钥还是用户自己填，没密钥
 * 时走不到 LLM，只走本地意图；本地意图也不需要密钥。 */
const TOOL_DANGEROUS = new Set(['delete_file', 'uninstall_app', 'upgrade_app', 'upgrade_all', 'tun_install', 'tun_start']);
const APP_NAME_MAP = {
  vlc: 'VideoLAN.VLC', '7-zip': '7zip.7zip', '7zip': '7zip.7zip', '微信': 'Tencent.WeChat',
  chrome: 'Google.Chrome', '谷歌浏览器': 'Google.Chrome', edge: 'Microsoft.Edge',
  potplayer: 'DAUM.PotPlayer', mpv: 'mpv.mpv', obs: 'OBSProject.OBSStudio',
  vscode: 'Microsoft.VisualStudioCode', python: 'Python.Python.3.12',
  node: 'OpenJS.NodeJS.LTS', git: 'Git.Git',
};
function resolveAppName(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  for (const k of Object.keys(APP_NAME_MAP)) {
    if (t.toLowerCase().includes(k.toLowerCase())) return APP_NAME_MAP[k];
  }
  return t;
}
function launchKnownApp(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n.includes('vlc')) return launchVlc();
  if (n.includes('chromium')) return launchBrowser();
  if (n.includes('chrome') && !n.includes('chromium')) { const e = findChrome(); if (!e) return { ok: false, error: 'Chrome 未安装' }; const c = spawn(e, [], { detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
  if (n.includes('edge')) { const e = findEdge(); if (!e) return { ok: false, error: 'Edge 未安装' }; const c = spawn(e, [], { detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
  if (n.includes('potplayer')) return launchPlayerApp('potplayer', '');
  if (n.includes('mpv')) return launchPlayerApp('mpv', '');
  if (process.platform === 'win32' && (n.includes('记事本') || n === 'notepad')) { const c = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
  if (process.platform === 'win32' && (n.includes('计算器') || n === 'calc')) { const c = spawn('calc.exe', [], { detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
  const exe = findOnPath(process.platform === 'win32' ? `${name}.exe` : name) || findOnPath(String(name));
  if (exe) { const c = spawn(exe, [], { detached: true, stdio: 'ignore' }); c.unref(); return { ok: true }; }
  return { ok: false, error: `找不到程序「${name}」：先在工具管理里搜索安装，或说出完整程序名` };
}
function parseToolIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const codeBlock = t.match(/```(\w*)\n([\s\S]+?)```/);
  if (codeBlock && /(运行|执行|跑一下|跑这段)/.test(t)) {
    return { tool: 'run_code', args: { language: codeBlock[1] || 'Python', code: codeBlock[2] }, label: '运行代码' };
  }
  let m = t.match(/(?:帮我)?(?:安装|装)(?:一下|个)?\s*(.+?)(?:吧|吗|一下)?$/);
  if (m && m[1] && !/(驱动|tun)/i.test(m[1])) return { tool: 'install_app', args: { name: m[1].trim() }, label: `安装 ${m[1].trim()}` };
  m = t.match(/(?:卸载|删除软件|卸掉)\s*(.+?)(?:吧|吗)?$/);
  if (m && m[1]) return { tool: 'uninstall_app', args: { name: m[1].trim() }, label: `卸载 ${m[1].trim()}` };
  m = t.match(/(?:更新|升级)(?:一下|个)?\s*(.+?)(?:吧|吗)?$/);
  if (m && m[1]) return { tool: 'upgrade_app', args: { name: m[1].trim() }, label: `更新 ${m[1].trim()}` };
  if (/全部更新|更新全部|更新所有软件/.test(t)) return { tool: 'upgrade_all', args: {}, label: '更新全部软件' };
  m = t.match(/(?:打开|启动|运行)(?:一下|个)?\s*(https?:\/\/\S+)/);
  if (m) return { tool: 'open_browser', args: { url: m[1] }, label: `打开网页 ${m[1]}` };
  m = t.match(/(?:播放|播)(?:一下|个)?\s*(https?:\/\/\S+)/);
  if (m) return { tool: 'open_player', args: { url: m[1] }, label: `播放 ${m[1]}` };
  m = t.match(/(?:打开|启动)(?:一下|个)?\s*(.+?)(?:吧|吗)?$/);
  if (m && m[1] && !/^(文件|文件夹|目录|设置|工具箱|空间)/.test(m[1])) return { tool: 'launch_app', args: { name: m[1].trim() }, label: `启动 ${m[1].trim()}` };
  m = t.match(/(?:搜索|找)(?:一下|个)?\s*(.+?)(?:吧|吗)?$/);
  if (m && m[1]) return { tool: 'search_apps', args: { query: m[1].trim() }, label: `搜索软件 ${m[1].trim()}` };
  if (/(查|看)(一下)?(系统|电脑)?(状态|内存|CPU|磁盘|配置)/.test(t) || /系统状态/.test(t)) return { tool: 'system_status', args: {}, label: '查看系统状态' };
  m = t.match(/(?:列出|看看|显示)(.+?)(?:里的|下的|的)?(?:文件|内容)/);
  if (m && m[1]) return { tool: 'list_files', args: { dir: m[1].trim() }, label: `列出 ${m[1].trim()} 的文件` };
  m = t.match(/(?:打开文件夹|打开目录|打开文件位置)\s*(.+)/);
  if (m && m[1]) return { tool: 'open_folder', args: { dir: m[1].trim() }, label: `打开文件夹 ${m[1].trim()}` };
  m = t.match(/(?:删除|删掉)(?:文件)?\s*(\S+)/);
  if (m && m[1]) return { tool: 'delete_file', args: { path: m[1].trim() }, label: `删除文件 ${m[1].trim()}（进回收站）` };
  if (/(安装|装).*(驱动|wintun|tun)/i.test(t)) return { tool: 'tun_install', args: {}, label: '安装 WinTun 驱动' };
  if (/(开启|打开|启动).*(tun|隧道)/i.test(t)) return { tool: 'tun_start', args: {}, label: '启动 Tun 隧道' };
  m = t.match(/设(?:为)?默认(播放器|浏览器)(?:为)?\s*(.+)?/);
  if (m) return { tool: 'set_default', args: { kind: m[1] === '播放器' ? 'player' : 'browser', value: (m[2] || '').trim() }, label: `设置默认${m[1]}` };
  return null;
}
function pendingActionsFile() { return path.join(userDataDir(), 'pending-actions.json'); }
function getPendingActions() { const v = readJsonFile('pending-actions.json', []); return Array.isArray(v) ? v : []; }
function savePendingActions(list) { writeJsonFile('pending-actions.json', list); }
function appendChatMessage(chatId, role, content, extra) {
  const chats = getAgentChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return null;
  chat.messages.push({ role, content, at: Date.now(), ...(extra || {}) });
  chat.updatedAt = Date.now();
  writeJsonFile('agent-chats.json', chats);
  return chat;
}
async function executeToolCall(call, chatId, opts) {
  const confirmed = !!(opts && opts.confirmed);
  const tool = call.tool;
  const args = call.args || {};
  const label = call.label || tool;
  if (TOOL_DANGEROUS.has(tool) && !confirmed) {
    const action = { id: localId(), tool, args, label, chatId, createdAt: Date.now(), status: 'pending' };
    const list = getPendingActions();
    list.push(action);
    savePendingActions(list);
    const chat = appendChatMessage(chatId, 'assistant',
      `要执行「${label}」吗？这个操作会改动电脑（删文件、卸载、升级、装驱动、开 Tun 属于危险操作），点「确认执行」后才跑，点「取消」就不跑。`,
      { pendingAction: { id: action.id, tool, label, status: 'pending' } });
    return { ok: true, chat, pending: true, actionId: action.id };
  }
  let resultText = '';
  let ok = true;
  try {
    if (tool === 'install_app') {
      const id = resolveAppName(args.name);
      if (!wingetAvailable()) throw new Error('winget 只能在 Windows 上用');
      const job = runWingetJob(`安装 ${id}`, ['install', '--id', id, '-e', '--accept-package-agreements', '--accept-source-agreements']);
      resultText = `已开始安装 ${id}（任务 #${job.id}），进度见「工具管理」里的任务面板，装完在「已安装」里刷新核对。`;
    } else if (tool === 'uninstall_app') {
      const id = resolveAppName(args.name);
      if (!wingetAvailable()) throw new Error('winget 只能在 Windows 上用');
      const job = runWingetJob(`卸载 ${id}`, ['uninstall', '--id', id, '-e', '--accept-source-agreements', '--disable-interactivity'], { uninstallId: id, timeoutMs: 180000 });
      resultText = `已开始卸载 ${id}（任务 #${job.id}）。`;
    } else if (tool === 'upgrade_app') {
      const id = resolveAppName(args.name);
      if (!wingetAvailable()) throw new Error('winget 只能在 Windows 上用');
      const job = runWingetJob(`更新 ${id}`, ['upgrade', '--id', id, '-e', '--accept-package-agreements', '--accept-source-agreements']);
      resultText = `已开始更新 ${id}（任务 #${job.id}）。`;
    } else if (tool === 'upgrade_all') {
      if (!wingetAvailable()) throw new Error('winget 只能在 Windows 上用');
      const job = runWingetJob('更新全部软件', ['upgrade', '--all', '--accept-package-agreements', '--accept-source-agreements']);
      resultText = `已开始更新全部软件（任务 #${job.id}）。`;
    } else if (tool === 'launch_app') {
      const r = launchKnownApp(args.name);
      if (!r.ok) throw new Error(r.error);
      resultText = `已启动 ${args.name}。`;
    } else if (tool === 'open_browser') {
      const r = openWithDefaultBrowser(args.url, 'local');
      if (!r.ok) throw new Error(r.error);
      resultText = `已用默认浏览器打开 ${args.url}。`;
    } else if (tool === 'open_player') {
      const r = playWithDefaultPlayer(args.url, 'local');
      if (!r.ok) throw new Error(r.error);
      resultText = `已用默认播放器播放 ${args.url}。`;
    } else if (tool === 'run_code') {
      const r = await runCode({ language: args.language || 'Python', code: args.code || '' });
      resultText = r.ok
        ? `代码已运行（${r.interpreter}，退出码 ${r.exitCode}）：\n${(r.stdout || '(无输出)').slice(0, 2000)}${r.stderr ? `\n错误输出：\n${r.stderr.slice(0, 1000)}` : ''}`
        : `代码运行失败：${r.error || `退出码 ${r.exitCode}`}\n${(r.stdout || '').slice(0, 1000)}${r.stderr ? `\n${r.stderr.slice(0, 1000)}` : ''}`;
      ok = r.ok;
    } else if (tool === 'system_status') {
      const m = monitorStatus();
      const sys = await systemStatus();
      resultText = `系统状态：${m.platform} ${m.arch} · 主机 ${m.hostname} · CPU ${m.cpuModel}（${m.cpuCores} 核）· 内存已用 ${formatBytes(m.memUsed)} / 共 ${formatBytes(m.memTotal)} · 运行 ${Math.floor(m.uptimeSec / 3600)} 小时${sys.wifiSsid ? ` · Wi-Fi ${sys.wifiSsid}${sys.wifiSignal != null ? ` ${sys.wifiSignal}%` : ''}` : ''}。`;
    } else if (tool === 'search_apps') {
      if (!wingetAvailable()) throw new Error('winget 只能在 Windows 上用，当前系统没有 winget');
      const r = await runWinget(['search', String(args.query || ''), '--accept-source-agreements'], 90000);
      const rows = parseWingetTable(r.out).slice(0, 10);
      resultText = rows.length
        ? `搜到 ${rows.length} 条：\n${rows.map((x) => `· ${x.name}（${x.id}，${x.version || '版本未知'}）`).join('\n')}`
        : `没搜到「${args.query}」，换个关键词试试。`;
    } else if (tool === 'list_files') {
      const r = listDir(args.dir);
      if (!r.ok) throw new Error(r.error);
      const items = r.entries.slice(0, 20);
      resultText = `${r.dir} 里有 ${r.entries.length} 项：\n${items.map((x) => `· ${x.isDir ? '[文件夹]' : ''} ${x.name}${x.isDir ? '' : `（${formatBytes(x.size)}）`}`).join('\n')}${r.entries.length > 20 ? `\n……共 ${r.entries.length} 项，只列前 20 项` : ''}`;
    } else if (tool === 'open_folder') {
      const err = await shell.openPath(String(args.dir || ''));
      if (err) throw new Error(err);
      resultText = `已打开文件夹 ${args.dir}。`;
    } else if (tool === 'delete_file') {
      await shell.trashItem(String(args.path));
      resultText = `已把 ${args.path} 移进回收站（可恢复，不是彻底删除）。`;
    } else if (tool === 'tun_install') {
      const r = await tunInstall();
      if (!r.ok) throw new Error(r.error);
      resultText = 'WinTun 驱动已安装好。';
    } else if (tool === 'tun_start') {
      const r = await tunStart();
      if (!r.ok) throw new Error(r.error);
      resultText = 'Tun 隧道已启动。';
    } else if (tool === 'set_default') {
      const v = String(args.value || '').toLowerCase();
      if (args.kind === 'player') {
        const map = { vlc: 'vlc', potplayer: 'potplayer', mpv: 'mpv' };
        const key = Object.keys(map).find((k) => v.includes(k)) || 'vlc';
        saveConfig({ ...getConfig(), defaultPlayer: key });
        resultText = `默认播放器已设为 ${key === 'vlc' ? 'VLC' : key === 'potplayer' ? 'PotPlayer' : 'mpv'}。`;
      } else {
        const map = { chromium: 'chromium', chrome: 'chrome', edge: 'edge' };
        const key = Object.keys(map).find((k) => v.includes(k)) || 'chromium';
        saveConfig({ ...getConfig(), defaultBrowser: key });
        resultText = `默认浏览器已设为 ${key === 'chromium' ? 'Chromium' : key === 'chrome' ? 'Chrome' : 'Edge'}。`;
      }
    } else {
      throw new Error(`不支持的工具：${tool}`);
    }
  } catch (e) {
    ok = false;
    resultText = `执行失败：${e.message || String(e)}`;
  }
  const chat = appendChatMessage(chatId, 'assistant', `已执行：${label}\n${resultText}`);
  return { ok, chat, resultText };
}
function parseLlmToolCall(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('{')) return null;
  try {
    const obj = JSON.parse(t);
    const call = obj.tool_call || obj;
    if (call && typeof call.tool === 'string' && call.args && typeof call.args === 'object') {
      return { tool: call.tool, args: call.args, label: call.label || call.tool };
    }
  } catch (e) { /* 不是 JSON，按普通回复 */ }
  return null;
}
const AGENT_TOOLS_SPEC = `你可以在需要时调用本机工具：回复里只写一段 JSON，不要写其他文字，格式 {"tool": "工具名", "args": {...}}。
可用工具：install_app{ name }（winget 安装软件）、uninstall_app{ name }（卸载，需用户确认）、launch_app{ name }（启动程序）、open_browser{ url }（默认浏览器打开网页）、open_player{ url }（默认播放器播放）、run_code{ language, code }（本机解释器真实运行代码）、system_status{}（查本机状态）、search_apps{ query }（搜软件）、list_files{ dir }（列目录）、delete_file{ path }（删文件进回收站，需用户确认）、tun_install{}（装 WinTun 驱动，需用户确认）、tun_start{}（启动 Tun，需用户确认）。没有密钥、装不了、找不到程序时如实说，不要编造结果。`;

/* ---------- 定时触发（本地） ----------
 * 时间触发：每天到指定时间，工具箱用该智能体新建一条对话并发送
 * 触发指令（需要智能体已填密钥）。事件触发暂不可用：工具箱未接
 * 入事件源，没有事件可监听。 */
function saveAgentTrigger(agentId, trigger) {
  const list = getAgents();
  const agent = list.find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  agent.triggers = Array.isArray(agent.triggers) ? agent.triggers : [];
  const next = { ...trigger, id: trigger.id || localId(), enabled: trigger.enabled !== false };
  const i = agent.triggers.findIndex((t) => t.id === next.id);
  if (i >= 0) agent.triggers[i] = { ...agent.triggers[i], ...next };
  else agent.triggers.push(next);
  writeJsonFile('agents.json', list);
  if (next.kind === 'file') startEventWatcher(agentId, next);
  return { ok: true, trigger: next };
}
function deleteAgentTrigger(agentId, triggerId) {
  const list = getAgents();
  const agent = list.find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  agent.triggers = (agent.triggers || []).filter((t) => t.id !== triggerId);
  writeJsonFile('agents.json', list);
  stopEventWatcher(triggerId);
  return { ok: true };
}
async function runAgentTrigger(agentId, triggerId) {
  const agent = getAgents().find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  const trigger = (agent.triggers || []).find((t) => t.id === triggerId);
  if (!trigger) return { ok: false, error: '触发器不存在' };
  if (!trigger.prompt) return { ok: false, error: '触发器没有指令' };
  const chats = getAgentChats();
  const chat = { id: localId(), agentId, title: trigger.name || '定时触发', messages: [], updatedAt: Date.now() };
  chats.push(chat);
  writeJsonFile('agent-chats.json', chats);
  const r = await agentChatSend(chat.id, trigger.prompt);
  const list = getAgents();
  const ag = list.find((a) => a.id === agentId);
  if (ag) {
    const t = (ag.triggers || []).find((x) => x.id === triggerId);
    if (t) { t.lastRun = new Date().toISOString().slice(0, 10); writeJsonFile('agents.json', list); }
  }
  notify('定时触发已执行', `「${trigger.name || '定时触发'}」已执行${r.ok !== false ? '完成' : `失败：${r.error || ''}`}，结果已写入新对话。`);
  return { ok: r.ok !== false, chatId: chat.id, error: r.error };
}
function checkTriggers() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const agent of getAgents()) {
    for (const t of agent.triggers || []) {
      if (!t.enabled || t.kind !== 'time' || !t.time) continue;
      if (t.time !== hhmm || t.lastRun === today) continue;
      void runAgentTrigger(agent.id, t.id);
    }
  }
}

/* ---------- 图像（本地图片接口，生成结果存本机） ---------- */
function imagesDir() { return path.join(defaultDownloadDir(), '工具箱图片'); }
async function imageGenerate(prompt, size) {
  const cfg = getConfig();
  if (!cfg.imageApiKey) return { ok: false, error: '先在图像页填图片接口密钥' };
  const base = (cfg.imageBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const r = await httpJson('POST', `${base}/images/generations`,
    { model: cfg.imageModel || 'gpt-image-1', prompt, size: size || '1024x1024', n: 1 },
    { Authorization: `Bearer ${cfg.imageApiKey}` });
  if (!r.ok) return { ok: false, error: r.error };
  const item = r.data?.data?.[0];
  if (!item) return { ok: false, error: '接口未返回图片' };
  fs.mkdirSync(imagesDir(), { recursive: true });
  const file = path.join(imagesDir(), `img-${Date.now()}.png`);
  try {
    if (item.b64_json) { fs.writeFileSync(file, Buffer.from(item.b64_json, 'base64')); return { ok: true, file }; }
    if (item.url) {
      await new Promise((resolve, reject) => downloadFile(item.url, file).then(resolve, reject));
      return { ok: true, file };
    }
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
  return { ok: false, error: '接口未返回图片' };
}

/* ---------- 监控（本机系统状态） ---------- */
function monitorStatus() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    platform: process.platform, arch: os.arch(), hostname: os.hostname(),
    cpuModel: (os.cpus()[0] || {}).model || '', cpuCores: os.cpus().length,
    loadavg: os.loadavg(), memUsed: total - free, memTotal: total,
    uptimeSec: Math.floor(os.uptime()),
    agents: getAgents().length, chats: getAgentChats().length,
    messages: getAgentChats().reduce((n, c) => n + (c.messages || []).length, 0),
    creations: readJsonList('creation.json').length,
    snippets: readJsonList('snippets.json').length,
    images: (() => { try { return fs.readdirSync(imagesDir()).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).length; } catch (e) { return 0; } })(),
    registerCount: readJsonList('register-records.json').length,
    dataSize: ['agents.json', 'agent-chats.json', 'ledger.json', 'register-records.json', 'creation.json', 'snippets.json']
      .reduce((n, f) => { try { return n + fs.statSync(path.join(userDataDir(), f)).size; } catch (e) { return n; } }, 0),
  };
}

/* ---------- 文件（本机目录） ---------- */
function listDir(dir) {
  const target = dir || defaultDownloadDir();
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true }).map((d) => {
      let size = 0; let mtime = 0;
      try { const st = fs.statSync(path.join(target, d.name)); size = st.size; mtime = st.mtimeMs; } catch (e) { /* 读不到按 0 */ }
      return { name: d.name, isDir: d.isDirectory(), size, mtime };
    }).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh'));
    return { ok: true, dir: target, parent: path.dirname(target), entries };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

/* ---------- 代码运行（v1.5.0 真实实现） ----------
 * 调用本机已装的解释器真实执行：Python、Node、PowerShell、
 * Batch、Shell。代码写进本机临时工作目录再执行，设 30 秒
 * 超时，输出与错误原样返回；没装解释器时如实报错，不假装
 * 跑成功。注意：只运行用户自己粘贴的代码，不要运行来路
 * 不明的代码。 */
const CODE_RUNNERS = [
  { key: 'python', names: ['python', 'python3', 'py'], ext: 'py', langs: ['python', 'py'] },
  { key: 'node', names: ['node'], ext: 'js', langs: ['node', 'javascript', 'js'] },
  { key: 'powershell', names: ['powershell', 'pwsh'], ext: 'ps1', langs: ['powershell', 'ps1', 'ps'] },
  { key: 'batch', names: ['cmd'], ext: 'bat', langs: ['batch', 'bat', 'cmd'] },
  { key: 'shell', names: ['bash', 'sh'], ext: 'sh', langs: ['bash', 'shell', 'sh'] },
];
async function detectInterpreters() {
  const out = [];
  for (const r of CODE_RUNNERS) {
    if (process.platform === 'win32' && r.key === 'shell') continue;
    if (process.platform !== 'win32' && r.key === 'batch') continue;
    if (process.platform !== 'win32' && r.key === 'powershell' && !r.names.includes('pwsh')) continue;
    let found = null;
    for (const name of r.names) {
      const c = await runCmd(name, name === 'python' || name === 'py' ? ['--version'] : name === 'cmd' ? ['/c', 'ver'] : ['--version'], 15000);
      const text = `${c.out || ''} ${c.err || ''}`.trim();
      if (c.code === 0 && text) { found = { key: r.key, name, version: text.split(/\r?\n/)[0].slice(0, 80) }; break; }
      if (c.code === 0) { found = { key: r.key, name, version: '' }; break; }
    }
    out.push({ key: r.key, ext: r.ext, langs: r.langs, found: !!found, name: found ? found.name : '', version: found ? found.version : '', note: found ? '' : '本机未安装，可在「自检与安装」里一键安装' });
  }
  return out;
}
function codeRunnerFor(lang) {
  const l = String(lang || '').trim().toLowerCase();
  for (const r of CODE_RUNNERS) if (r.langs.includes(l)) return r;
  if (l.includes('python')) return CODE_RUNNERS[0];
  if (l.includes('node') || l.includes('javascript') || l.includes('js')) return CODE_RUNNERS[1];
  return CODE_RUNNERS[0];
}
async function runCode({ language, code }) {
  const runner = codeRunnerFor(language);
  const list = await detectInterpreters();
  const det = list.find((x) => x.key === runner.key);
  if (!det || !det.found) return { ok: false, error: `本机没有 ${runner.key} 解释器：先在「自检与安装」里安装，或在电脑上装好再运行` };
  const dir = path.join(userDataDir(), 'code-runs', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `main.${runner.ext}`);
  fs.writeFileSync(file, String(code || ''), 'utf8');
  let cmd = det.name; let args = [file];
  if (runner.key === 'powershell') args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file];
  if (runner.key === 'batch') args = ['/c', file];
  const r = await runCmd(cmd, args, 30000);
  const trunc = (t) => String(t || '').slice(0, 20000);
  return { ok: r.code === 0, exitCode: r.code, stdout: trunc(r.out), stderr: trunc(r.err), interpreter: `${det.name}${det.version ? ` ${det.version}` : ''}`, workdir: dir };
}

/* ---------- 事件触发：文件变化（v1.5.0 真实实现） ----------
 * 时间触发沿用已有的每天到点执行；文件触发用 fs.watch 监听
 * 指定目录（或单个文件），有改动时按该触发器的指令新建对话
 * 发送。空间里的事件源（空间服务端事件）接不了，如实标明。 */
const eventWatchers = new Map(); // triggerId -> { watcher, agentId, lastFire }
function stopEventWatcher(triggerId) {
  const w = eventWatchers.get(triggerId);
  if (w) { try { w.watcher.close(); } catch (e) { /* 已关 */ } eventWatchers.delete(triggerId); }
}
function startEventWatcher(agentId, trigger) {
  if (!trigger || trigger.kind !== 'file' || !trigger.path || trigger.enabled === false) return false;
  stopEventWatcher(trigger.id);
  const target = String(trigger.path);
  if (!fs.existsSync(target)) return false;
  let timer = null;
  try {
    const watcher = fs.watch(target, { recursive: false }, () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        const rec = eventWatchers.get(trigger.id);
        if (rec) rec.lastEvent = new Date().toISOString();
        await runAgentTrigger(agentId, trigger.id);
      }, 1000);
    });
    eventWatchers.set(trigger.id, { watcher, agentId, lastEvent: '' });
    return true;
  } catch (e) { return false; }
}
function startAllEventWatchers() {
  for (const agent of getAgents()) {
    for (const t of agent.triggers || []) if (t.kind === 'file') startEventWatcher(agent.id, t);
  }
}
function eventTriggerStatus() {
  const out = [];
  for (const agent of getAgents()) {
    for (const t of agent.triggers || []) {
      if (t.kind !== 'file') continue;
      const w = eventWatchers.get(t.id);
      out.push({ agentId: agent.id, agentName: agent.name, id: t.id, name: t.name, path: t.path, enabled: t.enabled !== false, watching: !!w, exists: fs.existsSync(String(t.path || '')), lastEvent: w ? w.lastEvent : '' });
    }
  }
  return out;
}

/* ---------- Tun（v1.5.0 真实接线，Windows） ----------
 * WinTun 是 WireGuard 团队的官方虚拟网卡驱动（wintun.net）。
 * 检测：管理员权限（net session）、pnputil/sc query 查驱动、
 * tools/wintun/wintun.dll 是否已下载。安装：从官网下载
 * wintun-0.14.1.zip，解压 amd64/wintun.dll，再用 PowerShell
 * P/Invoke 调 WintunCreateAdapter 建网卡（必须管理员权限，
 * 安装前界面会明确提示）。启动：在网卡上配 IP 并加路由；
 * 停止：删路由、删网卡 IP。非 Windows 直接报不支持。 */
function wintunDir() { return path.join(toolsDir(), 'wintun'); }
function wintunDll() { return path.join(wintunDir(), 'wintun.dll'); }
/* ---------- 2026-11-27-2：管理员检测 ----------
 * 旧实现只用 `net session`（退出码 0 判管理员）：net session 测的是
 * Server 服务的会话表，不是当前进程令牌是否提升——服务停了、无会
 * 话、或在某些受限上下文里都会误判，用户以管理员身份运行仍识别
 * 不到就是这么来的。现改成三级后备，直接查令牌本身：
 * 1) PowerShell WindowsPrincipal.IsInRole(Administrator)（最可靠）；
 * 2) whoami /groups 看 Administrators 组（S-1-5-32-544）是否已启用
 *    （未提升的管理员令牌里该组是“仅用于拒绝”，不能算管理员）；
 * 3) net session（旧办法，留作最后后备）。
 * 返回 {isAdmin, method, detail}，method 写明用的哪种检测。 */
function parseAdminPrincipalOutput(text) {
  return /^\s*True\s*$/im.test(String(text || ''));
}
function parseWhoamiGroups(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.includes('S-1-5-32-544')) continue;
    if (/deny only|仅用于拒绝/i.test(line)) return false;
    if (/,\s*Enabled\s*$/i.test(line) || /已启用\s*$/i.test(line) || /\bEnabled\b/i.test(line)) return true;
    return false;
  }
  return false;
}
async function checkAdminWindows(opts) {
  const o = opts || {};
  const run = o.runCmd || runCmd;
  const isWin = process.platform === 'win32' || o.forceWindows === true;
  if (!isWin) return { isAdmin: false, method: 'unsupported-platform', detail: `当前平台是 ${process.platform}，管理员检测只在 Windows 上有意义` };
  const failures = [];
  try {
    const ps = `[bool]([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))`;
    const r = await run('powershell', ['-NoProfile', '-Command', ps], 15000);
    const out = `${r.out || ''} ${r.err || ''}`.trim();
    if (r.code === 0 && /True|False/i.test(out)) {
      const isAdmin = parseAdminPrincipalOutput(out);
      return { isAdmin, method: 'powershell-principal', detail: `PowerShell WindowsPrincipal.IsInRole(Administrator) 返回 ${isAdmin ? 'True' : 'False'}（原始输出：${out.slice(0, 200)}）` };
    }
    failures.push(`PowerShell 检测未返回 True/False（退出码 ${r.code}，输出：${out.slice(0, 200) || '空'}）`);
  } catch (e) { failures.push(`PowerShell 检测异常：${e.message || String(e)}`); }
  try {
    const r = await run('whoami', ['/groups'], 15000);
    const out = `${r.out || ''} ${r.err || ''}`;
    if (r.code === 0 && out.includes('S-1-5-32-544')) {
      const isAdmin = parseWhoamiGroups(out);
      return { isAdmin, method: 'whoami-groups', detail: `whoami /groups 里 Administrators 组（S-1-5-32-544）${isAdmin ? '已启用' : '未启用（仅用于拒绝或未启用）'}（原始行：${(out.split(/\r?\n/).find((l) => l.includes('S-1-5-32-544')) || '').trim().slice(0, 200)}）` };
    }
    failures.push(`whoami /groups 未返回 Administrators 组（退出码 ${r.code}）`);
  } catch (e) { failures.push(`whoami 检测异常：${e.message || String(e)}`); }
  try {
    const r = await run('net', ['session'], 15000);
    if (r.code === 0) return { isAdmin: true, method: 'net-session', detail: 'net session 退出码为 0（旧办法，仅作后备：它测的是 Server 服务会话表，不是令牌本身）' };
    failures.push(`net session 退出码 ${r.code}`);
  } catch (e) { failures.push(`net session 异常：${e.message || String(e)}`); }
  return { isAdmin: false, method: 'none', detail: `三种检测都失败，未能确认管理员身份：${failures.join('；')}` };
}
async function isAdminWindows() {
  return (await checkAdminWindows()).isAdmin;
}
/* ---------- Tun（2026-11-27-3 重做：提权 helper 常驻方案） ----------
 * 结论先说清（判断依据，不是猜测）：
 * ① Wintun 官方 API 文档（git.zx2c4.com/wintun/about/）对
 *    WintunCreateAdapter 没写权限要求；但多份独立资料一致说建网卡
 *    要提权：wintun Rust 绑定文档“Must be run as Administrator
 *    because we create network adapters”、OpenVPN 论坛“Wintun
 *    requires SYSTEM privileges and therefore should be used with
 *    interactive service”、另有实测记录“WintunCreateAdapter
 *    requires an elevated shell”。且 netsh 配 IP、route 改路由表
 *    本来就需要管理员权限。② 驱动装好也不能“一次提权、以后免提权”：
 *    WintunCreateAdapter 建的网卡随创建进程的句柄走，进程退出、
 *    句柄关闭网卡就被移除（WintunCloseAdapter 即删网卡），一次性的
 *    提权脚本留不下能长期用的网卡；日常开 Tun 仍要在提权上下文里
 *    建网卡、配 IP、改路由。所以不硬说“装一次驱动就够了”，改走
 *    提权 helper 常驻：主程序保持普通权限（拖拽等不受影响），首次开
 *    Tun 时弹一次 UAC 拉起提权 helper（tun-helper.ps1，随包内嵌、
 *    不下载），helper 在工具箱运行期间常驻、拥有网卡与路由，之后
 *    开关 Tun 不再弹 UAC；退出工具箱或重启电脑后下次开 Tun 再提权
 *    一次。真正的 Windows 服务（安装时提权一次装服务、日常零 UAC）
 *    需要编译好的服务程序与安装器，是 P2 的事，这次不做。
 * ③ wintun.dll 已随包内置（bundled/wintun-0.14.1.zip，amd64），
 *    不再现用现从官网下载；路径可能含中文，PowerShell 侧用绝对
 *    路径加单引号转义（tunPsQuote），C# 源码里反斜杠转义。
 * ④ 智能/全局代理模式本来就不需要 Tun、不需要管理员权限：走的是
 *    用户态 SOCKS5 隧道（127.0.0.1:19352）加会话代理；只有 Tun
 *    模式（整机路由）才碰 WinTun。不用 Tun 就完全不用理会提权。
 * 已知缺口（P0 不含，写明不瞒）：现 Tun 只有建网卡、配 IP、改路由，
 *    没有读包转发的泵（无 WintunStartSession），流量进网卡后没有
 *    转发到 Trojan 隧道；要真通流量还需补泵或 tun2socks 式转发。 */
function tunPsQuote(s) {
  return `'${String(s || '').replace(/'/g, "''")}'`;
}
function buildTunHelperLaunchCommand(ps1Path, dllPath, controlDir) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, '-DllPath', dllPath, '-ControlDir', controlDir];
  return `Start-Process -FilePath 'powershell.exe' -ArgumentList @(${args.map((a) => tunPsQuote(a)).join(',')}) -Verb RunAs -PassThru | Select-Object -ExpandProperty Id`;
}
/* 提权 helper 脚本（内嵌在 main.js 里，随热更新一起发；运行时写到
 * tools/wintun/tun-helper.ps1。注意：模板里不用 ${...} 与反引号，
 * PowerShell 变量 $x 不受 JS 模板影响。 */
const TUN_HELPER_SCRIPT = `
param([string]$DllPath, [string]$ControlDir)
$ErrorActionPreference = 'Stop'
$statusPath = Join-Path $ControlDir 'status.json'
$adapter = $null
function Write-Status($state, $errorText) {
  $obj = @{ state = $state; error = $errorText; at = (Get-Date).ToString('o') }
  $obj | ConvertTo-Json -Compress | Set-Content -Path $statusPath -Encoding UTF8
}
function Get-Cmd($name) {
  $p = Join-Path $ControlDir $name
  if (Test-Path $p) { Remove-Item $p -Force; return $true }
  return $false
}
try {
  $csPath = $DllPath.Replace('\\', '\\\\')
  $src = @"
using System; using System.Runtime.InteropServices;
public static class Wintun {
  [DllImport("$csPath", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr WintunCreateAdapter(string name, string tunnelType, Guid requestedGUID);
  [DllImport("$csPath", SetLastError = true)]
  public static extern void WintunCloseAdapter(IntPtr adapter);
}
"@
  Add-Type -TypeDefinition $src
} catch {
  Write-Status 'error' ('加载 WinTun 驱动失败：' + $_.Exception.Message)
  exit 1
}
New-Item -ItemType Directory -Force -Path $ControlDir | Out-Null
Write-Status 'idle' ''
while ($true) {
  if (Get-Cmd 'cmd-exit.json') {
    if ($null -ne $adapter) {
      try { route delete 0.0.0.0 mask 0.0.0.0 10.200.0.1 } catch {}
      try { netsh interface ip set address name=ToolboxTun source=dhcp } catch {}
      try { [Wintun]::WintunCloseAdapter($adapter) } catch {}
      $adapter = $null
    }
    Write-Status 'exited' ''
    break
  }
  if (Get-Cmd 'cmd-install.json') {
    try {
      $g = [Guid]::NewGuid()
      $h = [Wintun]::WintunCreateAdapter('ToolboxTun', 'Toolbox', $g)
      if ($h -eq [IntPtr]::Zero) { throw ('WintunCreateAdapter 失败，错误码 ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
      [Wintun]::WintunCloseAdapter($h)
      Write-Status 'idle' ''
    } catch {
      Write-Status 'error' ('安装 WinTun 驱动失败：' + $_.Exception.Message)
    }
  }
  if (Get-Cmd 'cmd-start.json') {
    try {
      if ($null -eq $adapter) {
        $g = [Guid]::NewGuid()
        $h = [Wintun]::WintunCreateAdapter('ToolboxTun', 'Toolbox', $g)
        if ($h -eq [IntPtr]::Zero) { throw ('WintunCreateAdapter 失败，错误码 ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
        $adapter = $h
      }
      netsh interface ip set address name=ToolboxTun static 10.200.0.2 255.255.255.0
      if ($LASTEXITCODE -ne 0) { throw '给 ToolboxTun 配 IP 失败（netsh 返回非 0）' }
      $idx = (Get-NetAdapter -Name 'ToolboxTun' -ErrorAction Stop).ifIndex
      route add 0.0.0.0 mask 0.0.0.0 10.200.0.1 metric 100 if $idx
      if ($LASTEXITCODE -ne 0) { throw '加默认路由失败（route 返回非 0），流量未全部走隧道' }
      Write-Status 'running' ''
    } catch {
      Write-Status 'error' ('启动 Tun 失败：' + $_.Exception.Message)
    }
  }
  if (Get-Cmd 'cmd-stop.json') {
    try { route delete 0.0.0.0 mask 0.0.0.0 10.200.0.1 } catch {}
    try { netsh interface ip set address name=ToolboxTun source=dhcp } catch {}
    if ($null -ne $adapter) {
      try { [Wintun]::WintunCloseAdapter($adapter) } catch {}
      $adapter = $null
    }
    Write-Status 'idle' ''
  }
  Start-Sleep -Milliseconds 500
}
`;
function tunHelperPaths() {
  const dir = wintunDir();
  return { dir, script: path.join(dir, 'tun-helper.ps1'), controlDir: path.join(dir, 'control'), statusFile: path.join(dir, 'control', 'status.json') };
}
function tunHelperWriteScript() {
  const p = tunHelperPaths();
  fs.mkdirSync(p.dir, { recursive: true });
  const text = TUN_HELPER_SCRIPT.trim() + '\n';
  try {
    if (fs.existsSync(p.script) && fs.readFileSync(p.script, 'utf8') === text) return { ok: true, path: p.script };
  } catch (e) { /* 读不到就重写 */ }
  fs.writeFileSync(p.script, text, 'utf8');
  return { ok: true, path: p.script };
}
function tunHelperReadStatus() {
  const p = tunHelperPaths();
  try {
    const raw = fs.readFileSync(p.statusFile, 'utf8').replace(/^\uFEFF/, '');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : { state: 'unknown' };
  } catch (e) { return { state: 'unknown' }; }
}
function tunHelperWriteCmd(name) {
  const p = tunHelperPaths();
  fs.mkdirSync(p.controlDir, { recursive: true });
  fs.writeFileSync(path.join(p.controlDir, name), JSON.stringify({ at: Date.now() }), 'utf8');
}
async function tunHelperWaitState(want, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = tunHelperReadStatus();
    if (want.includes(st.state)) return st;
    if (st.state === 'error') return st;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ...tunHelperReadStatus(), timeout: true };
}
let tunHelper = { pid: 0, startedAt: 0 };
async function tunHelperAlive() {
  if (!tunHelper.pid) return false;
  if (process.platform !== 'win32') return false;
  const r = await runCmd('tasklist', ['/FI', `PID eq ${tunHelper.pid}`, '/NH'], 15000);
  return (r.out || '').includes(String(tunHelper.pid));
}
async function tunHelperEnsure() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tun 只能在 Windows 上用' };
  if (tunHelper.pid && await tunHelperAlive()) return { ok: true, pid: tunHelper.pid, reused: true };
  const dll = await ensureWintunDll();
  if (!dll.ok) return { ok: false, error: dll.error || 'WinTun 驱动文件不可用' };
  const script = tunHelperWriteScript();
  if (!script.ok) return { ok: false, error: '写提权 helper 脚本失败' };
  const p = tunHelperPaths();
  const admin = await isAdminWindows();
  if (admin) {
    // 已是管理员身份运行：直接拉起 helper，不再弹 UAC。
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p.script, '-DllPath', wintunDll(), '-ControlDir', p.controlDir], { windowsHide: true });
    child.on('error', () => { /* 启动失败走下方等待超时 */ });
    tunHelper = { pid: child.pid || 0, startedAt: Date.now() };
  } else {
    // 普通权限：只弹一次 UAC 拉起提权 helper；主程序本身不提权。
    const cmd = buildTunHelperLaunchCommand(p.script, wintunDll(), p.controlDir);
    const r = await runCmd('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], 120000);
    const out = `${r.out || ''} ${r.err || ''}`;
    const pid = parseInt((r.out || '').trim().split(/\s+/).pop() || '', 10);
    if (r.code !== 0 || !Number.isFinite(pid) || pid <= 0) {
      const cancelled = /取消|cancel|0x800704C7|740/i.test(out);
      return { ok: false, needsAdmin: true, error: cancelled ? '提权被取消：首次启动 Tun 需要在弹出的确认框里点“是”，取消后无法建立虚拟网卡' : `拉起提权 helper 失败：${out.trim().slice(-300) || '未知错误'}` };
    }
    tunHelper = { pid, startedAt: Date.now() };
  }
  const st = await tunHelperWaitState(['idle', 'running', 'error'], 30000);
  if (st.state === 'error') return { ok: false, error: st.error || '提权 helper 启动失败' };
  if (st.timeout || st.state === 'unknown') return { ok: false, error: '提权 helper 启动超时（30 秒内无响应），请重试' };
  return { ok: true, pid: tunHelper.pid, reused: false };
}
function tunHelperStopOnQuit() {
  // 退出时尽力让 helper 先停 Tun 再退出，不拦退出流程。
  try { tunHelperWriteCmd('cmd-exit.json'); } catch (e) { /* 忽略 */ }
}
async function tunStatus() {
  if (process.platform !== 'win32') return { ok: false, supported: false, platform: process.platform, admin: false, driverInstalled: false, dllPresent: fs.existsSync(wintunDll()), active: false, note: 'Tun 只能在 Windows 上用：需要操作系统级虚拟网卡，网页与 Linux 沙盒无法创建' };
  const admin = await isAdminWindows();
  let driverInstalled = false;
  const pnp = await runCmd('pnputil', ['/enum-drivers'], 30000);
  if (/wintun/i.test(`${pnp.out || ''} ${pnp.err || ''}`)) driverInstalled = true;
  if (!driverInstalled) {
    const sc = await runCmd('sc', ['query', 'wintun'], 15000);
    if (/RUNNING|STOPPED/.test(sc.out || '')) driverInstalled = true;
  }
  const cfg = getConfig();
  const helperAlive = await tunHelperAlive();
  const helperState = tunHelperReadStatus();
  return {
    ok: true, supported: true, platform: 'win32', admin, driverInstalled,
    dllPresent: fs.existsSync(wintunDll()), active: !!cfg.tunActive,
    helperRunning: helperAlive, helperState: helperState.state || 'unknown',
    note: admin
      ? '已是管理员身份运行：helper 可直接拉起'
      : '普通权限运行：首次开 Tun 时弹一次确认框拉起提权 helper，之后开关不再弹；智能/全局模式不需要 Tun 与管理员权限',
  };
}
async function tunInstall() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tun 只能在 Windows 上用' };
  const st = await tunStatus();
  if (!st.supported) return { ok: false, error: st.note };
  // 2026-11-27-3：驱动文件随包内置，不再从官网下载。
  const dll = await ensureWintunDll();
  if (!dll.ok) return { ok: false, error: dll.error || 'WinTun 驱动文件不可用' };
  if (st.driverInstalled) return { ok: true, already: true, note: 'WinTun 驱动已安装' };
  // 驱动随首次建网卡时由 Windows 安装：拉起提权 helper 建一次网卡
  // 再关闭（网卡随句柄关闭被移除，驱动留在系统里），helper 常驻。
  const h = await tunHelperEnsure();
  if (!h.ok) return h;
  tunHelperWriteCmd('cmd-install.json');
  const done = await tunHelperWaitState(['idle', 'error'], 120000);
  if (done.state === 'error') return { ok: false, error: done.error || '安装 WinTun 驱动失败' };
  if (done.timeout) return { ok: false, error: '安装 WinTun 驱动超时（120 秒），请重试' };
  const after = await tunStatus();
  if (!after.driverInstalled) return { ok: false, error: '驱动安装未生效：网卡建完后系统里仍查不到 WinTun 驱动' };
  return { ok: true, note: 'WinTun 驱动已安装（提权 helper 已常驻，之后开 Tun 不再弹确认框）' };
}
async function tunStart() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tun 只能在 Windows 上用' };
  const st = await tunStatus();
  if (!st.supported) return { ok: false, error: st.note };
  if (!st.dllPresent) {
    const dll = await ensureWintunDll();
    if (!dll.ok) return { ok: false, error: dll.error || 'WinTun 驱动文件不可用' };
  }
  // 主进程不直接建网卡、配 IP、改路由（普通权限必然被拒），一律交给
  // 提权 helper；首次拉起弹一次确认框，helper 常驻后不再弹。
  const h = await tunHelperEnsure();
  if (!h.ok) return h;
  tunHelperWriteCmd('cmd-start.json');
  const done = await tunHelperWaitState(['running', 'error'], 60000);
  if (done.state === 'error') return { ok: false, error: done.error || '启动 Tun 失败' };
  if (done.timeout) return { ok: false, error: '启动 Tun 超时（60 秒），请在代理页点“检测”看 helper 状态后重试' };
  const cfg = getConfig(); cfg.tunActive = true; saveConfig(cfg);
  return { ok: true, note: 'Tun 已启动：虚拟网卡 ToolboxTun 已配 IP 并接管默认路由（metric 100），停用时自动恢复' };
}
async function tunStop() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tun 只能在 Windows 上用' };
  const cfg = getConfig();
  const alive = await tunHelperAlive();
  if (!alive) {
    // helper 不在：可能 Tun 本来就没开，或工具箱被强杀后 helper 残留已退出。
    // 读不到路由表（改路由要提权）时不硬报失败，只把本机状态复位。
    cfg.tunActive = false; saveConfig(cfg);
    return { ok: true, note: 'Tun 已停止（提权 helper 未在运行，本机状态已复位；如路由仍在，请重开工具箱点一次 Tun 启动再停止以清理）' };
  }
  tunHelperWriteCmd('cmd-stop.json');
  const done = await tunHelperWaitState(['idle', 'error'], 60000);
  cfg.tunActive = false; saveConfig(cfg);
  if (done.state === 'error') return { ok: false, error: done.error || '停止 Tun 失败' };
  if (done.timeout) return { ok: false, error: '停止 Tun 超时（60 秒），网卡可能仍在，请重试' };
  return { ok: true, note: 'Tun 已停止，路由已删除' };
}

/* ---------- 注册自动收码（v1.5.0 真实实现） ----------
 * 邮箱：Mail.tm 公开接口（api.mail.tm，无需密钥）——取域名、
 * 建临时邮箱、取令牌、轮询新邮件，正则提取 6 位验证码，记
 * 入本地记录。短信：没有公开可用的免费短信接口，无法自动
 * 提取，界面如实标明，只能手动添加。 */
const MAILTM = 'https://api.mail.tm';
function mailtmFile() { return path.join(userDataDir(), 'mailtm.json'); }
function mailtmLoad() { try { return JSON.parse(fs.readFileSync(mailtmFile(), 'utf8')); } catch (e) { return null; } }
function mailtmSave(v) { fs.writeFileSync(mailtmFile(), JSON.stringify(v), 'utf8'); }
async function mailtmAccount() {
  const old = mailtmLoad();
  if (old && old.address && old.token) return { ok: true, account: old };
  const d = await httpJson('GET', `${MAILTM}/domains`, null, {}, 30000);
  const domain = d.data && d.data['hydra:member'] && d.data['hydra:member'][0] && d.data['hydra:member'][0].domain;
  if (!domain) return { ok: false, error: 'Mail.tm 取不到域名列表（网络不通或服务不可用）' };
  const address = `toolbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const c = await httpJson('POST', `${MAILTM}/accounts`, { address, password }, { 'Content-Type': 'application/json' }, 30000);
  if (!c.ok) return { ok: false, error: `Mail.tm 建邮箱失败：${c.error || ''}` };
  const t = await httpJson('POST', `${MAILTM}/token`, { address, password }, { 'Content-Type': 'application/json' }, 30000);
  if (!t.ok || !t.data || !t.data.token) return { ok: false, error: 'Mail.tm 取令牌失败' };
  const acc = { address, password, token: t.data.token, id: c.data && c.data.id, seen: [] };
  mailtmSave(acc);
  return { ok: true, account: { address: acc.address } };
}
async function mailtmFetch() {
  const a = await mailtmAccount();
  if (!a.ok) return a;
  const acc = mailtmLoad();
  const r = await httpJson('GET', `${MAILTM}/messages`, null, { Authorization: `Bearer ${acc.token}` }, 30000);
  if (!r.ok) return { ok: false, error: `Mail.tm 拉取失败：${r.error || ''}` };
  const msgs = (r.data && r.data['hydra:member']) || [];
  let added = 0;
  for (const m of msgs) {
    if ((acc.seen || []).includes(m.id)) continue;
    acc.seen = [...(acc.seen || []), m.id].slice(-100);
    const text = `${m.subject || ''} ${m.intro || ''}`;
    const code = (text.match(/\b(\d{6})\b/) || [])[1] || '';
    const list = readJsonList('register-records.json');
    list.unshift({ id: localId(), kind: '邮箱', target: acc.address, code, note: (m.from && (m.from.name || m.from.address)) || m.subject || '', at: Date.now() });
    writeJsonList('register-records.json', list.slice(0, 100));
    added++;
  }
  mailtmSave(acc);
  return { ok: true, account: acc.address, fetched: msgs.length, added };
}

/* ---------- 远程真实会话（v1.5.0） ----------
 * 本机 HTTP 服务（默认 127.0.0.1:19876，局域网 IP 也可访问）：
 * 配对码校验通过后，用 desktopCapturer 真实截取本机屏幕，
 * 浏览器里打开地址即可看电脑画面（2 秒自动刷新）。鼠标键
 * 盘注入需要原生模块，工具箱未内置，界面如实标明「只能看，
 * 不能操作」。 */
let remoteServer = null;
let remoteServerPort = 0;
let remoteLastShot = null;
let remoteLastShotAt = 0;
async function remoteShot() {
  if (Date.now() - remoteLastShotAt < 1500 && remoteLastShot) return remoteLastShot;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } });
    if (!sources.length) return null;
    remoteLastShot = sources[0].thumbnail.toPNG();
    remoteLastShotAt = Date.now();
    return remoteLastShot;
  } catch (e) { return null; }
}
function remoteServerStatus() {
  const info = remoteInfo();
  return { running: !!remoteServer, port: remoteServerPort, url: remoteServer ? `http://127.0.0.1:${remoteServerPort}/` : '', lanUrls: remoteServer ? (info.ips || []).map((ip) => `http://${ip}:${remoteServerPort}/`) : [], pairCode: info.pairCode, hostname: info.hostname, ips: info.ips };
}
async function remoteStart() {
  if (remoteServer) return { ok: true, ...remoteServerStatus() };
  const cfg = getConfig();
  if (cfg.remoteEnabled === false) return { ok: false, error: '远程已在设置里关闭：先在远程设置里打开「允许空间小助手连接本机」' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const code = u.searchParams.get('code') || '';
    const pair = (getConfig().remotePairCode || '');
    if (u.pathname === '/shot.jpg') {
      if (code !== pair) { res.writeHead(403); res.end('配对码不对'); return; }
      const shot = await remoteShot();
      if (!shot) { res.writeHead(503); res.end('截屏失败'); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      res.end(shot);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (code !== pair) {
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>工具箱远程</title></head><body style="font-family:sans-serif;padding:24px"><h2>工具箱远程画面</h2><p>输入本机配对码查看电脑画面（只能看，不能操作）。</p><form><input name="code" placeholder="6 位配对码" style="font-size:18px;padding:8px"><button style="font-size:18px;padding:8px 16px">查看</button></form></body></html>`);
      return;
    }
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>工具箱远程</title></head><body style="font-family:sans-serif;padding:24px"><h2>工具箱远程画面（${os.hostname()}）</h2><p>只能看画面，不能操作电脑。</p><img src="/shot.jpg?code=${code}" style="max-width:100%;border:1px solid #ccc" onload="setTimeout(()=>{this.src='/shot.jpg?code=${code}&t='+Date.now()},2000)"></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(19876, '0.0.0.0', () => resolve());
  });
  remoteServer = server;
  remoteServerPort = 19876;
  return { ok: true, ...remoteServerStatus() };
}
function remoteStop() {
  if (remoteServer) { try { remoteServer.close(); } catch (e) { /* 已关 */ } remoteServer = null; remoteServerPort = 0; }
  return { ok: true, running: false };
}

/* ---------- 自检与自动安装（v1.5.0） ----------
 * 启动自检页检测：Python、Node、winget、WinTun 驱动、VLC、
 * Chromium、Git、PowerShell。缺的给一键安装（Windows 上走
 * winget 或官方包；驱动需管理员权限，安装前明确提示）。 */
const SELFCHECK_ITEMS = [
  { key: 'python', name: 'Python 3', wingetId: 'Python.Python.3.12', checkCmd: ['python', '--version'] },
  { key: 'node', name: 'Node.js LTS', wingetId: 'OpenJS.NodeJS.LTS', checkCmd: ['node', '--version'] },
  { key: 'git', name: 'Git', wingetId: 'Git.Git', checkCmd: ['git', '--version'] },
  { key: 'winget', name: 'winget（App Installer）', wingetId: '', checkCmd: ['winget', '--version'] },
  { key: 'powershell', name: 'PowerShell', wingetId: '', checkCmd: ['powershell', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] },
];
async function selfcheckStatus() {
  const out = [];
  for (const item of SELFCHECK_ITEMS) {
    if (process.platform !== 'win32' && item.key === 'winget') { out.push({ ...item, status: 'unknown', version: '', note: 'winget 只在 Windows 上有' }); continue; }
    if (process.platform !== 'win32' && item.key === 'powershell') { out.push({ ...item, status: 'unknown', version: '', note: 'PowerShell 只在 Windows 上有' }); continue; }
    let r = await runCmd(item.checkCmd[0], item.checkCmd.slice(1), 20000);
    if (r.code !== 0 && item.key === 'python') r = await runCmd('python3', ['--version'], 20000);
    const text = `${r.out || ''} ${r.err || ''}`.trim();
    const m = text.match(/([0-9]+(?:\.[0-9]+){1,3})/);
    if (r.code === 0 && m) out.push({ ...item, status: 'ok', version: m[1], note: '' });
    else out.push({ ...item, status: 'missing', version: '', note: '未检测到，可一键安装' });
  }
  const tun = await tunStatus();
  out.push({ key: 'wintun', name: 'WinTun 虚拟网卡驱动', status: tun.driverInstalled ? 'ok' : (tun.supported ? 'missing' : 'unknown'), version: '', note: tun.supported ? (tun.driverInstalled ? '' : '未安装，安装需管理员权限') : tun.note });
  const vlc = vlcStatus();
  out.push({ key: 'vlc', name: 'VLC（集成）', status: vlc.found ? 'ok' : 'missing', version: vlc.version || '', note: vlc.found ? '' : '集成 VLC 未就绪，可在播放器页重新下载' });
  const br = browserStatus();
  out.push({ key: 'chromium', name: 'Chromium（首次使用时下载）', status: br.found ? 'ok' : 'missing', version: br.version || '', note: br.found ? '' : '未下载：可在浏览器页或这里一键下载官方快照（约 200MB）' });
  return out;
}
async function selfcheckInstall(key) {
  if (process.platform !== 'win32') return { ok: false, error: '一键安装只在 Windows 上可用（当前不是 Windows）' };
  if (key === 'wintun') return tunInstall();
  if (key === 'vlc') return downloadComponent('vlc');
  if (key === 'chromium') return downloadComponent('browser');
  const item = SELFCHECK_ITEMS.find((x) => x.key === key);
  if (!item || !item.wingetId) return { ok: false, error: '这一项没有一键安装（winget 本身请在微软商店装「应用安装程序」）' };
  return runWingetJob(`安装 ${item.name}`, ['install', '--id', item.wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements']);
}

/* ---------- 远程（本机信息与配对码，本地保存） ---------- */
function remoteInfo() {
  const cfg = getConfig();
  if (!cfg.remotePairCode) {
    cfg.remotePairCode = String(Math.floor(100000 + Math.random() * 900000));
    saveConfig(cfg);
  }
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  return { hostname: os.hostname(), ips, pairCode: cfg.remotePairCode, platform: process.platform };
}

/* ---------- 代理测试（经配置的 HTTP 代理连 api.github.com） ---------- */
async function proxyTest() {
  const cfg = getConfig();
  if (!['manual', 'smart', 'global'].includes(cfg.proxyMode) || !cfg.proxyHost) return { ok: false, error: '未配置代理（当前直连）' };
  const started = Date.now();
  const r = await new Promise((resolve) => {
    const port = Number(cfg.proxyPort) || 8080;
    const sock = net.connect(port, cfg.proxyHost);
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) { /* 已关 */ } resolve({ ok: false, error: '代理连接超时' }); }, 20000);
    sock.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `代理连接失败：${e.message || String(e)}` }); });
    sock.on('connect', () => {
      sock.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
      let buf = '';
      const onData = (d) => {
        buf += d.toString();
        if (!buf.includes('\r\n\r\n')) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/\d\.\d 200/.test(buf)) { clearTimeout(timer); resolve({ ok: false, error: `代理拒绝连接：${buf.split('\r\n')[0]}` }); return; }
        const tlsSock = tls.connect({ socket: sock, servername: 'api.github.com' }, () => {
          tlsSock.write('GET / HTTP/1.1\r\nHost: api.github.com\r\nConnection: close\r\n\r\n');
          let out = '';
          tlsSock.on('data', (c) => { out += c.toString(); });
          tlsSock.on('end', () => { clearTimeout(timer); resolve({ ok: true, ms: Date.now() - started, status: out.split('\r\n')[0] || '' }); });
        });
        tlsSock.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message || String(e) }); });
      };
      sock.on('data', onData);
    });
  });
  try {
    const log = readJsonList('proxy-log.json');
    log.unshift({ at: Date.now(), ok: r.ok, ms: r.ms, error: r.error || '', mode: getConfig().proxyMode || '' });
    writeJsonList('proxy-log.json', log.slice(0, 50));
  } catch (e) { /* 日志写失败不影响测试结果 */ }
  return r;
}

/* ---------------- 窗口与协议 ---------------- */

let mainWin = null;
let tray = null; // 2026-11-26-3：托盘（Linux 沙盒里可能建不出来，失败时为 null）
let isQuitting = false; // 真正退出时为 true，点关闭按钮最小化到托盘时为 false
let lastPowerEvent = null; // 最近一次锁屏/解锁/休眠/唤醒 {kind, at}
function sendToRenderer(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

/* ---------- 崩溃 / 无响应自动恢复（2026-11-26-3） ----------
 * 渲染进程崩溃后自动重载一次并弹通知；60 秒内反复崩溃 3 次
 * 就停止自动重载、弹对话框让用户选重载或关闭；窗口长时间
 * 无响应时弹对话框（重载/等待/关闭）。每次崩溃都写日志。 */
let recentCrashes = []; // 60 秒窗口内的崩溃时间戳
let unresponsiveDialogOpen = false;
function handleRendererGone(details) {
  const reason = (details && details.reason) || 'unknown';
  logCrash('renderer-gone', `渲染进程退出：${reason}`);
  if (!mainWin || mainWin.isDestroyed()) return;
  const now = Date.now();
  recentCrashes = recentCrashes.filter((t) => now - t < 60000);
  recentCrashes.push(now);
  if (recentCrashes.length >= 3) {
    // 短时间内反复崩溃：停止自动重载，让用户选
    if (globalThis.__selfTest) return; // 自测里不弹对话框
    dialog.showMessageBox(mainWin, {
      type: 'warning',
      title: '桌面工具箱',
      message: '工具箱界面短时间内多次崩溃，已停止自动重载。',
      detail: '可能是某个页面导致。点「重载」再试一次，或点「关闭」退出程序。',
      buttons: ['重载', '关闭'],
      defaultId: 0, cancelId: 1,
    }).then(({ response }) => {
      if (response === 0 && mainWin && !mainWin.isDestroyed()) mainWin.reload();
      else { isQuitting = true; app.quit(); }
    }).catch(() => {});
    return;
  }
  try { mainWin.reload(); } catch (e) { /* 重载失败不报错 */ }
  notify('界面已恢复', '工具箱界面崩溃了，已自动重载恢复。');
}
function handleUnresponsive() {
  if (!mainWin || mainWin.isDestroyed() || unresponsiveDialogOpen) return;
  if (globalThis.__selfTest) { logCrash('unresponsive', '自测模式：跳过无响应对话框'); return; }
  unresponsiveDialogOpen = true;
  logCrash('unresponsive', '窗口长时间无响应');
  dialog.showMessageBox(mainWin, {
    type: 'warning',
    title: '桌面工具箱',
    message: '工具箱窗口长时间没有响应。',
    buttons: ['重载', '等待', '关闭'],
    defaultId: 1, cancelId: 1,
  }).then(({ response }) => {
    unresponsiveDialogOpen = false;
    if (response === 0 && mainWin && !mainWin.isDestroyed()) mainWin.reload();
    else if (response === 2) { isQuitting = true; app.quit(); }
  }).catch(() => { unresponsiveDialogOpen = false; });
}

/* ---------- 托盘 + 开机自启（2026-11-26-3） ---------- */
function trayIconImage() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
    if (!img.isEmpty()) return img;
  } catch (e) { /* 无图标文件时用空图 */ }
  return nativeImage.createEmpty();
}
function getLoginItemOpenAtLogin() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return getConfig().autoStart === true; }
}
function applyAutoStart() {
  // 文件夹发行：exe 路径就是程序路径，Windows 上按当前 exe 注册。
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: getConfig().autoStart === true });
    }
  } catch (e) { /* Linux 沙盒里不支持，跳过 */ }
}
function applyWindowSettings() {
  // set-config 后调用：置顶、开机自启、防休眠手动开关、托盘菜单同步。
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(getConfig().alwaysOnTop === true);
  } catch (e) { /* 跳过 */ }
  applyAutoStart();
  if (getConfig().preventSleep === true) acquireSleepBlock('manual');
  else releaseSleepBlock('manual');
  refreshTrayMenu();
}
function toggleMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) { createWindow(); return; }
  if (mainWin.isVisible()) mainWin.hide();
  else { mainWin.show(); mainWin.focus(); }
}
function trayCheckUpdate() {
  // 托盘里点「检查更新」：显示窗口、进设置页、点一次「检查更新」。
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
  mainWin.webContents.send('test-goto', 'settings');
  setTimeout(() => { try { mainWin.webContents.executeJavaScript("document.querySelector('#update-check')?.click();").catch(() => {}); } catch (e) { /* 跳过 */ } }, 400);
}
function refreshTrayMenu() {
  if (!tray) return;
  try {
    const cfg = getConfig();
    const menu = Menu.buildFromTemplate([
      { label: '显示/隐藏窗口', click: () => toggleMainWindow() },
      { type: 'separator' },
      { label: '窗口置顶', type: 'checkbox', checked: cfg.alwaysOnTop === true, click: (item) => { saveConfig({ ...getConfig(), alwaysOnTop: !!item.checked }); applyWindowSettings(); } },
      { label: '开机自启', type: 'checkbox', checked: getLoginItemOpenAtLogin(), click: (item) => { saveConfig({ ...getConfig(), autoStart: !!item.checked }); applyWindowSettings(); } },
      { type: 'separator' },
      { label: '检查更新', click: () => trayCheckUpdate() },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
  } catch (e) { /* 菜单构建失败不影响主窗口 */ }
}
function createTray() {
  if (tray) return tray;
  try {
    tray = new Tray(trayIconImage());
    tray.setToolTip('桌面工具箱');
    tray.on('click', () => toggleMainWindow());
    refreshTrayMenu();
    globalThis.__trayCreated = true;
  } catch (e) {
    tray = null;
    globalThis.__trayCreated = false;
    globalThis.__trayError = e.message || String(e);
  }
  return tray;
}

function createWindow() {
  const cfg = getConfig();
  const bounds = validWindowBounds(cfg.windowBounds);
  const transparent = cfg.windowTransparent !== false;
  const opts = {
    width: bounds ? bounds.width : 1180,
    height: bounds ? bounds.height : 780,
    minWidth: 900,
    minHeight: 600,
    title: '桌面工具箱',
    frame: false, // 2026-11-26-3：无边框 + 自定义标题栏（顶栏可拖拽）
    transparent,
    backgroundColor: transparent ? '#00000000' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // v1.4.1：内嵌空间（webview）承载空间菜单功能
    },
  };
  if (bounds) { opts.x = bounds.x; opts.y = bounds.y; }
  mainWin = new BrowserWindow(opts);
  if (cfg.alwaysOnTop === true) { try { mainWin.setAlwaysOnTop(true); } catch (e) { /* 跳过 */ } }
  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 2026-11-27-2：浏览器视频实时嗅探——默认分区与已有账号的分区都挂上
  //（新账号在 openAccount 里也会挂；重复挂有守卫，不会叠加）。
  ensureBrowserMediaSniff('persist:toolbox-browser');
  ensureBrowserMediaSniffForAccounts();
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.on('resize', saveWindowBoundsDebounced);
  mainWin.on('move', saveWindowBoundsDebounced);
  mainWin.on('maximize', () => sendToRenderer('window-state', { maximized: true }));
  mainWin.on('unmaximize', () => sendToRenderer('window-state', { maximized: false }));
  mainWin.on('close', (e) => {
    saveWindowBounds();
    // 点关闭按钮默认最小化到托盘（托盘建不出来时按正常关闭走）；
    // 真正退出（托盘菜单「退出」/ app.quit()）时 isQuitting 为 true。
    if (!isQuitting && getConfig().closeToTray !== false && tray) {
      e.preventDefault();
      mainWin.hide();
      if (!getConfig().trayHideNotified) {
        notify('已最小化到托盘', '点关闭按钮后工具箱会留在托盘里，点托盘图标可以再打开；想直接退出可以在设置页关掉「关闭按钮最小化到托盘」。');
        saveConfig({ ...getConfig(), trayHideNotified: true });
      }
    }
  });
  mainWin.webContents.on('render-process-gone', (_e, details) => handleRendererGone(details));
  mainWin.webContents.on('unresponsive', handleUnresponsive);
  mainWin.webContents.on('responsive', () => { /* 恢复响应，无需额外动作 */ });
}

/* ---------- 文件关联 .toolboxbak（2026-11-26-3） ----------
 * electron-builder.yml 里注册了 fileAssociations；文件夹发行没有
 * 安装器写注册表，Windows 上需用户右键 .toolboxbak → 打开方式
 * 选一次工具箱 exe，之后双击备份文件就会把路径当参数传进来。
 * 收到路径时先弹确认框问是否导入恢复，未确认不做任何写入。 */
let pendingToolboxbakFile = '';
function findToolboxbakArg(argv) {
  for (const a of argv || []) {
    if (typeof a === 'string' && a.toLowerCase().endsWith('.toolboxbak')) return a;
  }
  return '';
}
async function handleToolboxbakFile(file, opts) {
  // opts.dryRun：自测用——只校验文件是不是合法备份，不弹窗、不写入。
  if (!file || !fs.existsSync(file)) return { ok: false, error: '备份文件不存在' };
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, error: `备份文件读不懂：${e.message}` }; }
  if (!payload || payload.format !== 'toolbox-backup' || !payload.files || typeof payload.files !== 'object') {
    return { ok: false, error: '不是工具箱备份文件（缺少 toolbox-backup 标记）' };
  }
  if (opts && opts.dryRun) return { ok: true, dryRun: true, files: Object.keys(payload.files) };
  if (globalThis.__selfTest) return { ok: false, error: '自测模式：跳过确认框' };
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); }
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question',
    title: '导入备份',
    message: `是否导入恢复这份备份？\n${path.basename(file)}`,
    detail: '导入前会自动把当前数据先备份一份。备份有密码保护时，请在设置页「备份与同步」里导入并输入密码。',
    buttons: ['导入恢复', '取消'],
    defaultId: 0, cancelId: 1,
  });
  if (response !== 0) return { ok: false, cancelled: true };
  const r = await importBackupFile(file, '');
  if (r && r.needsPassword) {
    await dialog.showMessageBox(mainWin, {
      type: 'info', title: '备份有密码保护',
      message: '这份备份有密码保护，请在设置页「备份与同步」里点「导入备份」并输入密码。',
      buttons: ['知道了'],
    }).catch(() => {});
    return { ok: false, needsPassword: true };
  }
  return r;
}

/** 处理一条 muse-toolbox:// 链接：空间的播放 / 浏览器调用
 * 都从这里进。返回处理结果文本（自检与日志用）。
 * 2026-11-26-3 新增 open：muse-toolbox://open?tool=<功能名>
 * 跳到对应功能页（code、ledger、agents、tools 等现有菜单项），
 * 未知 tool 只显示主窗口。 */
function handleProtocolUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return `无法解析的协议链接：${raw}`; }
  const target = u.searchParams.get('url') || '';
  if (u.host === 'play' || u.pathname === '/play') {
    if (!target) return 'play 调用缺少 url 参数';
    const r = playWithDefaultPlayer(target, 'space');
    if (mainWin) { mainWin.show(); mainWin.focus(); }
    return r.ok ? `已用默认播放器播放：${target}` : r.error;
  }
  if (u.host === 'browse' || u.pathname === '/browse') {
    if (!target) return 'browse 调用缺少 url 参数';
    const r = openWithDefaultBrowser(target, 'space');
    return r.ok ? `已用默认浏览器打开：${target}` : r.error;
  }
  if (u.host === 'open' || u.pathname === '/open') {
    const tool = (u.searchParams.get('tool') || '').trim();
    if (mainWin) { mainWin.show(); mainWin.focus(); }
    const screens = ['agents', 'create', 'code', 'image', 'monitor', 'ledger', 'register', 'remote', 'files', 'proxy', 'media', 'github', 'tools', 'player', 'browser', 'settings', 'home'];
    if (tool === 'toolbox') { sendToRenderer('test-goto', 'home'); return '已打开工具箱'; }
    if (screens.includes(tool)) { sendToRenderer('test-goto', tool); return `已打开${tool}`; }
    return '已打开工具箱（未知的功能名，只显示主窗口）';
  }
  if (mainWin) { mainWin.show(); mainWin.focus(); }
  return '已打开工具箱';
}

function findProtocolArg(argv) {
  return argv.find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`));
}


/* ---------- 工具来源自定义 + 从本机已装程序导入（v1.6.0） ----------
 * 自定义来源存在 custom-sources.json：{ id, name, type, address,
 * enabled }，type 分三种：winget（来源名 + 源地址，Windows 上
 * 添加时真的调 `winget source add` 注册）、github（仓库地址
 * owner/repo，在 GitHub 页里看它的 Releases）、url（普通网址，
 * 只作链接入口，不参与搜索）。
 * 从本机已装程序导入：Windows 上读注册表 Uninstall 项（名称、
 * 版本、发行商、安装位置、卸载命令），再拿 winget list 对名字
 * 找 winget id，找不到的给“官网搜索”安装指导；Linux 沙盒里
 * 退化为扫描 .desktop 文件与 PATH（只用于自测链路，不冒充
 * Windows 注册表结果）。 */
function customSourcesFile() { return path.join(userDataDir(), 'custom-sources.json'); }
function getCustomSources() { const v = readJsonFile('custom-sources.json', []); return Array.isArray(v) ? v : []; }
function saveCustomSources(list) { writeJsonFile('custom-sources.json', list); }
async function addCustomSource(src) {
  const list = getCustomSources();
  const name = String((src && src.name) || '').trim();
  const type = String((src && src.type) || '').trim();
  const address = String((src && src.address) || '').trim();
  if (!name || !type || !address) return { ok: false, error: '名称、类型、地址都要填' };
  if (!['winget', 'github', 'url'].includes(type)) return { ok: false, error: '类型只能是 winget / github / url' };
  if (type === 'github' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(address)) return { ok: false, error: 'GitHub 来源地址填 owner/repo，例如 VideoLAN/vlc' };
  if (type === 'url' && !/^https?:\/\//i.test(address)) return { ok: false, error: '网址以 http:// 或 https:// 开头' };
  if (list.some((x) => x.name === name)) return { ok: false, error: '已经有同名来源' };
  const item = { id: localId(), name, type, address, enabled: true, addedAt: Date.now() };
  if (type === 'winget') {
    if (process.platform !== 'win32') {
      item.note = 'winget 源只在 Windows 上注册，当前不是 Windows，先只保存，换 Windows 后在来源页点「注册到 winget」';
    } else {
      const r = await runWinget(['source', 'add', '--name', name, '--arg', address, '--type', 'Microsoft.Rest'], 60000);
      if (r.code !== 0) return { ok: false, error: `注册到 winget 失败：${(r.err || r.out || '').slice(-300)}` };
    }
  }
  list.push(item);
  saveCustomSources(list);
  return { ok: true, source: item };
}
async function registerCustomWingetSource(id) {
  const item = getCustomSources().find((x) => x.id === id);
  if (!item || item.type !== 'winget') return { ok: false, error: '不是 winget 来源' };
  if (process.platform !== 'win32') return { ok: false, error: 'winget 源只在 Windows 上注册' };
  const r = await runWinget(['source', 'add', '--name', item.name, '--arg', item.address, '--type', 'Microsoft.Rest'], 60000);
  if (r.code !== 0) return { ok: false, error: (r.err || r.out || '').slice(-300) };
  return { ok: true };
}
async function importInstalledPrograms() {
  const items = [];
  if (process.platform === 'win32') {
    const rows = await readRegistryUninstallRows();
    let wingetRows = [];
    try { wingetRows = parseWingetTable((await runWinget(['list', '--accept-source-agreements'], 120000)).out || ''); } catch (e) { wingetRows = []; }
    const seen = new Set();
    for (const row of rows) {
      const name = String(row.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const match = wingetRows.find((w) => (w.name || '').toLowerCase() === name.toLowerCase() || (w.name || '').toLowerCase().includes(name.toLowerCase()));
      items.push({
        name, version: String(row.version || ''), publisher: String(row.publisher || ''),
        installLocation: String(row.installLocation || ''), wingetId: match ? match.id : '',
        guide: match ? `winget install --id ${match.id}` : `官网搜索「${name}」下载安装包`,
        uninstall: String(row.uninstallString || ''), source: 'registry',
        // 2026-11-27-2：清单里也留 DisplayIcon 与卸载项键路径，
        // 否则从清单查到的条目开目录少一条后备、转移后更新不了注册表。
        displayIcon: String(row.displayIcon || ''), registryKey: String(row.registryKey || ''),
      });
    }
  } else {
    // 非 Windows：扫描 .desktop 入口与 PATH 可执行文件（自测链路用）。
    const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
    const seen = new Set();
    for (const d of dirs) {
      try {
        for (const f of fs.readdirSync(d)) {
          if (!f.endsWith('.desktop')) continue;
          const text = fs.readFileSync(path.join(d, f), 'utf8');
          const nm = (text.match(/^Name=(.+)$/m) || [])[1];
          if (!nm || seen.has(nm.toLowerCase())) continue;
          seen.add(nm.toLowerCase());
          items.push({ name: nm.trim(), version: '', publisher: '', installLocation: d, wingetId: '', guide: 'Linux 沙盒：不是 Windows 注册表结果，仅作导入链路自测', uninstall: '', source: 'desktop-file' });
        }
      } catch (e) { /* 目录不存在跳过 */ }
    }
  }
  writeJsonFile('installed-import.json', items);
  return { ok: true, count: items.length, items: items.slice(0, 200) };
}

/* ---------- 插件系统（v1.6.0） ----------
 * 插件放在 userData/plugins/<id>/，manifest.json 必须有 name、
 * version、menuLabel；可选 page（界面 html 文件名）、permissions
 *（白名单，见 PLUGIN_PERMISSIONS）。插件界面在工具箱菜单里占
 * 一项，点开用 sandbox iframe 加载它的 page.html，插件 JS 只能
 * 经 postMessage 调 renderer 转发的受限接口（pluginCall），且
 * 每次调用都按 manifest 的 permissions 校验；插件拿不到主进程
 * 的 fs/require，也碰不到 config.json、agents.json 里的密钥
 *（密钥类字段不在任何插件接口的返回值里）。 */
const PLUGIN_PERMISSIONS = ['system.status', 'monitor.status', 'winget.search', 'winget.install', 'files.list', 'files.open', 'open.external', 'clipboard.write', 'code.run', 'apps.list', 'files.search', 'agent.list', 'agent.complete', 'plugin.store', 'translate.models', 'translate.offline', 'translate.software'];
const PLUGIN_DANGEROUS_CALLS = new Set(['winget.install', 'code.run']);
function pluginsDir() { return path.join(userDataDir(), 'plugins'); }
function getPlugins() { const v = readJsonFile('plugins.json', []); return Array.isArray(v) ? v : []; }
function savePlugins(list) { writeJsonFile('plugins.json', list); }
function validatePluginManifest(m) {
  if (!m || typeof m !== 'object') return 'manifest.json 不是合法 JSON 对象';
  if (!m.name || typeof m.name !== 'string') return 'manifest 缺少 name（插件名称）';
  if (!m.version || typeof m.version !== 'string') return 'manifest 缺少 version（版本号）';
  if (!m.menuLabel || typeof m.menuLabel !== 'string') return 'manifest 缺少 menuLabel（菜单入口名称）';
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) return 'manifest 的 permissions 必须是数组';
    for (const p of m.permissions) {
      if (!PLUGIN_PERMISSIONS.includes(p)) return `不支持的权限：${p}（可用：${PLUGIN_PERMISSIONS.join('、')}）`;
    }
  }
  if (m.page && typeof m.page !== 'string') return 'manifest 的 page 必须是文件名';
  return '';
}
function pluginDirFor(id) { return path.join(pluginsDir(), String(id).replace(/[^A-Za-z0-9_-]/g, '')); }
async function pluginInstallFromFolder(srcDir) {
  if (!srcDir || !fs.existsSync(path.join(srcDir, 'manifest.json'))) return { ok: false, error: '这个文件夹里没有 manifest.json' };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8')); } catch (e) { return { ok: false, error: `manifest.json 读不懂：${e.message}` }; }
  const err = validatePluginManifest(manifest);
  if (err) return { ok: false, error: err };
  if (manifest.page && !fs.existsSync(path.join(srcDir, manifest.page))) return { ok: false, error: `manifest 里的 page 文件 ${manifest.page} 不存在` };
  const id = localId();
  const dest = pluginDirFor(id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    const sp = path.join(srcDir, f);
    if (fs.statSync(sp).isFile()) fs.copyFileSync(sp, path.join(dest, f));
  }
  const list = getPlugins();
  const item = { id, name: manifest.name, version: manifest.version, description: manifest.description || '', menuLabel: manifest.menuLabel, permissions: manifest.permissions || [], page: manifest.page || '', enabled: true, source: 'folder', installedAt: Date.now() };
  list.push(item);
  savePlugins(list);
  return { ok: true, plugin: item };
}
async function pluginInstallFromGithub(ownerRepo) {
  const m = String(ownerRepo || '').trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) return { ok: false, error: 'GitHub 地址填 owner/repo，例如 octocat/Hello-World' };
  const tmp = path.join(os.tmpdir(), `toolbox-plugin-${Date.now().toString(36)}`);
  fs.mkdirSync(tmp, { recursive: true });
  const zip = path.join(tmp, 'repo.zip');
  try {
    await downloadFile(`https://api.github.com/repos/${m[1]}/${m[2]}/zipball`, zip, null, { resume: false });
    await extractZip(zip, tmp);
    const subs = fs.readdirSync(tmp).filter((f) => fs.statSync(path.join(tmp, f)).isDirectory());
    let root = tmp;
    for (const sub of subs) {
      if (fs.existsSync(path.join(tmp, sub, 'manifest.json'))) { root = path.join(tmp, sub); break; }
    }
    if (!fs.existsSync(path.join(root, 'manifest.json'))) return { ok: false, error: '这个仓库里没有 manifest.json（插件仓库根目录或一级子目录里要放 manifest.json）' };
    const r = await pluginInstallFromFolder(root);
    if (r.ok) {
      const list = getPlugins();
      const it = list.find((x) => x.id === r.plugin.id);
      if (it) { it.source = `github:${ownerRepo}`; savePlugins(list); r.plugin = it; }
    }
    return r;
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  }
}
/* ---------- 插件新增桥接（2026-11-26-4） ----------
 * 2026-11-26-4 补了两个最小桥接权限（白名单里原来没有）：
 * apps.list——列出本机可启动程序：Windows 读开始菜单与桌面
 * 快捷方式（.lnk/.url），Linux 读 .desktop 入口；再用“从本机
 * 已装程序导入”的缓存 installed-import.json 按名字补版本与
 * 发行商（只读缓存，不重扫）。只返回列表，不启动程序（启动
 * 仍走已有的 files.open，即 shell.openPath 打开快捷方式）。
 * files.search——按关键词搜本机文件：主进程起子进程流式枚举
 * （Windows 用 dir /s /b，Linux 用 find），边收边按修改时间
 * 排，分批返回，不卡界面。搜索是只读的，不删不改文件；一次
 * 只跑一个搜索，新搜索会杀掉旧的，超时 120 秒自动停。 */
function listLaunchableApps() {
  const items = [];
  const seen = new Set();
  const add = (name, p, source) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({ name: String(name || '').trim(), path: p, source, version: '', publisher: '' });
  };
  if (process.platform === 'win32') {
    const roots = [
      { dir: path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'), source: 'start-menu' },
      { dir: path.join(process.env.PROGRAMDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'), source: 'start-menu' },
      { dir: path.join(os.homedir(), 'Desktop'), source: 'desktop' },
      { dir: path.join(process.env.PUBLIC || '', 'Desktop'), source: 'desktop' },
    ];
    const walk = (dir, source, depth) => {
      if (depth > 3) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const en of entries) {
        const full = path.join(dir, en.name);
        if (en.isDirectory()) { walk(full, source, depth + 1); continue; }
        if (/\.(lnk|url)$/i.test(en.name)) add(en.name.replace(/\.(lnk|url)$/i, ''), full, source);
        else if (source === 'desktop' && /\.exe$/i.test(en.name)) add(en.name.replace(/\.exe$/i, ''), full, source);
      }
    };
    for (const r of roots) walk(r.dir, r.source, 0);
  } else {
    // 非 Windows：扫描 .desktop 入口（自测链路用）。
    const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
    for (const d of dirs) {
      let files = [];
      try { files = fs.readdirSync(d); } catch (e) { continue; }
      for (const f of files) {
        if (!f.endsWith('.desktop')) continue;
        try {
          const text = fs.readFileSync(path.join(d, f), 'utf8');
          const nm = (text.match(/^Name=(.+)$/m) || [])[1];
          if (nm) add(nm.trim(), path.join(d, f), 'desktop-file');
        } catch (e) { /* 读不懂跳过 */ }
      }
    }
  }
  // 复用“从本机已装程序导入”的缓存结果补版本与发行商（只读缓存，不重扫）。
  try {
    const imported = readJsonFile('installed-import.json', []);
    const byName = new Map();
    for (const it of Array.isArray(imported) ? imported : []) {
      if (it && it.name) byName.set(String(it.name).toLowerCase(), it);
    }
    for (const it of items) {
      const m = byName.get(it.name.toLowerCase());
      if (m) { it.version = String(m.version || ''); it.publisher = String(m.publisher || ''); }
    }
  } catch (e) { /* 缓存没有不影响 */ }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return items;
}
const FILE_SEARCH_MAX_RESULTS = 5000;
const FILE_SEARCH_TIMEOUT_MS = 120000;
const fileSearchState = {}; // pluginId -> { child, results, done, query, roots, error, truncated }
function defaultSearchRoots() {
  const home = os.homedir();
  const cands = [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads')];
  return cands.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}
function fileSearchStart(pluginId, query, roots) {
  const prev = fileSearchState[pluginId];
  if (prev && prev.child) { try { prev.child.kill(); } catch (e) { /* 已退出 */ } }
  const q = String(query || '').trim();
  const cleanRoots = (Array.isArray(roots) && roots.length ? roots : defaultSearchRoots())
    .map((r) => String(r || '').trim()).filter(Boolean)
    .filter((r) => { try { return fs.statSync(r).isDirectory(); } catch (e) { return false; } })
    .slice(0, 5);
  const state = { child: null, results: [], done: false, query: q, roots: cleanRoots, error: '', truncated: false, startedAt: Date.now() };
  fileSearchState[pluginId] = state;
  if (!q) { state.done = true; return state; }
  if (!cleanRoots.length) { state.done = true; state.error = '搜索范围里没有可用的目录'; return state; }
  const lowerQ = q.toLowerCase();
  const pushResult = (p, size, mtime) => {
    if (state.results.length >= FILE_SEARCH_MAX_RESULTS) {
      if (!state.truncated) {
        state.truncated = true;
        try { if (state.child) state.child.kill(); } catch (e) { /* 已退出 */ }
      }
      return;
    }
    const base = path.basename(p);
    if (!base.toLowerCase().includes(lowerQ)) return;
    state.results.push({ path: p, name: base, size: size || 0, mtime: mtime || 0 });
  };
  const finish = () => { state.done = true; state.child = null; };
  const timer = setTimeout(() => {
    try { if (state.child) state.child.kill(); } catch (e) { /* 已退出 */ }
    state.error = state.error || '搜索超时，已返回已找到的部分结果';
    finish();
  }, FILE_SEARCH_TIMEOUT_MS);
  try {
    if (process.platform === 'win32') {
      // dir /s /b 只输出完整路径（无标题行），再在 Node 里按名字过滤、stat 取大小与修改时间。
      const child = spawn('cmd', ['/c', 'dir', ...cleanRoots, '/s', '/b', '/a-d'], { windowsHide: true });
      state.child = child;
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          try { const st = fs.statSync(line); pushResult(line, st.size, st.mtimeMs); } catch (e) { /* 读不到跳过 */ }
        }
      });
      child.stderr.on('data', () => { /* 权限不足的目录会报错，忽略 */ });
      child.on('error', (e) => { clearTimeout(timer); state.error = e.message || String(e); finish(); });
      child.on('close', () => { clearTimeout(timer); finish(); });
    } else {
      const pattern = '*' + q.replace(/[*?\\[\]]/g, (c) => '\\' + c) + '*';
      const child = spawn('find', [...cleanRoots, '-type', 'f', '-iname', pattern, '-printf', '%T@\\t%s\\t%p\\n'], { windowsHide: true });
      state.child = child;
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
          if (!line) continue;
          const parts = line.split('\t');
          if (parts.length < 3) continue;
          pushResult(parts.slice(2).join('\t'), Number(parts[1]) || 0, Math.round((parseFloat(parts[0]) || 0) * 1000));
        }
      });
      child.stderr.on('data', () => { /* 权限不足的目录会报错，忽略 */ });
      child.on('error', (e) => { clearTimeout(timer); state.error = e.message || String(e); finish(); });
      child.on('close', () => { clearTimeout(timer); finish(); });
    }
  } catch (e) {
    clearTimeout(timer);
    state.error = e.message || String(e);
    state.done = true;
  }
  return state;
}
function fileSearchPage(pluginId, offset, limit) {
  const state = fileSearchState[pluginId];
  if (!state) return null;
  const off = Math.max(0, Number(offset) || 0);
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const sorted = state.results.slice().sort((a, b) => b.mtime - a.mtime);
  return { running: !state.done, done: state.done, total: state.results.length, truncated: state.truncated, error: state.error || '', roots: state.roots, results: sorted.slice(off, off + lim) };
}
/* ---------- 翻译插件桥接（2026-11-26-4） ----------
 * 翻译插件新增的最小桥接（白名单里原来没有）：
 * agent.list——只列出已配 key 的智能体（id、名字、服务商、
 * 模型），不返回密钥；agent.complete——用指定智能体跑一次
 * 对话（复用主进程已有的 agentComplete，密钥不出主进程），
 * 只返回文本；plugin.store——每个插件一块小的持久化设置
 * （轮巡状态、默认方式、接口密钥等存在本机 plugin-state 里）；
 * translate.models——离线翻译模型目录（Argos）与下载；
 * translate.offline——用已下载的 Argos 模型离线翻译（引擎
 * 是 Python 的 argostranslate，没装时如实报错不假装能翻）；
 * translate.software——检测本机已装的翻译软件（有道/DeepL）。 */
function pluginStoreDir() { const d = path.join(userDataDir(), 'plugin-state'); try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 建不出来就读写失败 */ } return d; }
function pluginStoreGet(id) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginStoreDir(), String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.json'), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}
function pluginStoreSet(id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '设置必须是 JSON 对象' };
  const s = JSON.stringify(value);
  if (s.length > 65536) return { ok: false, error: '设置太大了（最多 64KB）' };
  try { fs.writeFileSync(path.join(pluginStoreDir(), String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.json'), s, 'utf8'); return { ok: true }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
function agentListForPlugin() {
  return getAgents().filter((a) => a && a.apiKey).map((a) => ({ id: a.id, name: a.name || '', provider: a.provider || '', model: a.model || '' }));
}
const ARGOS_CATALOG = [
  { from: 'en', to: 'zh', version: '1.9', url: 'https://argos-net.com/v1/translate-en_zh-1_9.argosmodel' },
  { from: 'zh', to: 'en', version: '1.9', url: 'https://argos-net.com/v1/translate-zh_en-1_9.argosmodel' },
  { from: 'en', to: 'ja', version: '1.1', url: 'https://argos-net.com/v1/translate-en_ja-1_1.argosmodel' },
  { from: 'ja', to: 'en', version: '1.1', url: 'https://argos-net.com/v1/translate-ja_en-1_1.argosmodel' },
  { from: 'en', to: 'ko', version: '1.1', url: 'https://argos-net.com/v1/translate-en_ko-1_1.argosmodel' },
  { from: 'ko', to: 'en', version: '1.1', url: 'https://argos-net.com/v1/translate-ko_en-1_1.argosmodel' },
  { from: 'en', to: 'fr', version: '1.9', url: 'https://argos-net.com/v1/translate-en_fr-1_9.argosmodel' },
  { from: 'fr', to: 'en', version: '1.9', url: 'https://argos-net.com/v1/translate-fr_en-1_9.argosmodel' },
  { from: 'en', to: 'de', version: '1.3', url: 'https://argos-net.com/v1/translate-en_de-1_3.argosmodel' },
  { from: 'de', to: 'en', version: '1.3', url: 'https://argos-net.com/v1/translate-de_en-1_3.argosmodel' },
  { from: 'en', to: 'es', version: '1.0', url: 'https://argos-net.com/v1/translate-en_es-1_0.argosmodel' },
  { from: 'es', to: 'en', version: '1.9', url: 'https://argos-net.com/v1/translate-es_en-1_9.argosmodel' },
  { from: 'en', to: 'ru', version: '1.9', url: 'https://argos-net.com/v1/translate-en_ru-1_9.argosmodel' },
  { from: 'ru', to: 'en', version: '1.9', url: 'https://argos-net.com/v1/translate-ru_en-1_9.argosmodel' },
  // 没有直连模型的语对走英文中转（需先下载两个直连模型）。
  { from: 'ja', to: 'zh', version: '1.1+1.9', url: '', pivot: ['ja-en', 'en-zh'] },
  { from: 'zh', to: 'ja', version: '1.9+1.1', url: '', pivot: ['zh-en', 'en-ja'] },
  { from: 'ko', to: 'zh', version: '1.1+1.9', url: '', pivot: ['ko-en', 'en-zh'] },
  { from: 'zh', to: 'ko', version: '1.9+1.1', url: '', pivot: ['zh-en', 'en-ko'] },
];
const LANG_NAMES = { zh: '中文', en: '英文', ja: '日文', ko: '韩文', fr: '法文', de: '德文', es: '西班牙文', ru: '俄文' };
function modelsDir() { return path.join(userDataDir(), 'models'); }
function listInstalledModels() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(modelsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return out; }
  for (const name of dirs) {
    const dir = path.join(modelsDir(), name);
    let size = 0;
    try {
      const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory()) walk(fp); else { try { size += fs.statSync(fp).size; } catch (e) { /* 读不到跳过 */ } } } };
      walk(dir);
    } catch (e) { /* 读不到按 0 */ }
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')); } catch (e) { meta = null; }
    const m = name.match(/^([a-z]{2})-([a-z]{2})$/);
    out.push({ key: name, from: m ? m[1] : '', to: m ? m[2] : '', size, hasMetadata: !!meta, version: meta ? String(meta.package_version || '') : '' });
  }
  return out;
}
const modelDownloads = {}; // key -> { progress, done, error }
async function downloadModel(key, url) {
  const m = String(key || '').match(/^([a-z]{2})-([a-z]{2})$/);
  if (!m) return { ok: false, error: '模型 key 不对' };
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: '模型地址不对' };
  if (modelDownloads[key] && !modelDownloads[key].done) return { ok: false, error: '这个模型正在下载' };
  const st = { progress: 0, done: false, error: '' };
  modelDownloads[key] = st;
  const tmp = path.join(os.tmpdir(), `toolbox-model-${key}-${Date.now().toString(36)}.argosmodel`);
  const dest = path.join(modelsDir(), key);
  (async () => {
    try {
      await downloadFile(url, tmp, (p) => { st.progress = p; });
      await extractZip(tmp, dest);
      if (!fs.existsSync(path.join(dest, 'metadata.json'))) {
        st.error = '下载的文件里没有模型信息（metadata.json），可能不是有效的模型包';
        st.done = true;
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
        return;
      }
      st.progress = 1; st.done = true;
    } catch (e) {
      st.error = e.message || String(e); st.done = true;
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* 删不掉不影响 */ }
    }
  })();
  return { ok: true, started: true };
}
async function findPythonForTranslate() {
  for (const name of ['python', 'python3', 'py']) {
    const p = findOnPath(name);
    if (p) return p;
  }
  return '';
}
async function translateEngineStatus() {
  const py = await findPythonForTranslate();
  if (!py) return { installed: false, python: false, hint: '本机没有 Python，先在设置「自检与自动安装」里装 Python 3。' };
  const r = await runCmd(py, ['-c', 'import argostranslate; print("ok")'], 30000);
  if (r.code === 0 && (r.out || '').includes('ok')) return { installed: true, python: true, hint: '' };
  return { installed: false, python: true, hint: '翻译引擎未安装：在命令行运行 pip install argostranslate，装好后重启工具箱。' };
}
async function translateModels(op, args) {
  const a = args || {};
  if (op === 'list') {
    return { ok: true, data: { installed: listInstalledModels(), catalog: ARGOS_CATALOG, downloads: modelDownloads, engine: await translateEngineStatus() } };
  }
  if (op === 'download') return downloadModel(a.key, a.url);
  if (op === 'delete') {
    const key = String(a.key || '').replace(/[^a-z-]/g, '');
    try { fs.rmSync(path.join(modelsDir(), key), { recursive: true, force: true }); return { ok: true }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }
  return { ok: false, error: '未知的模型操作' };
}
const TRANSLATE_PY = [
  'import sys',
  'from argostranslate import translate',
  'from_code, chain_csv, in_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]',
  'with open(in_path, "r", encoding="utf-8") as f: text = f.read()',
  'langs = translate.get_installed_languages()',
  'def lang(code):',
  '    for l in langs:',
  '        if l.code == code: return l',
  '    raise Exception("模型未安装：" + code)',
  'cur, code = text, from_code',
  'for nxt in chain_csv.split(","):',
  '    cur = lang(code).get_translation(lang(nxt)).translate(cur)',
  '    code = nxt',
  'with open(out_path, "w", encoding="utf-8") as f: f.write(cur)',
  '',
].join('\n');
async function translateOffline(text, from, to) {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: '没有要翻译的内容' };
  if (t.length > 20000) return { ok: false, error: '离线翻译一次最多 20000 字，内容太长请分段' };
  const f = String(from || '').toLowerCase();
  const toL = String(to || '').toLowerCase();
  const installed = new Set(listInstalledModels().map((m) => m.key));
  let chain = null;
  if (installed.has(`${f}-${toL}`)) chain = [toL];
  else {
    const cat = ARGOS_CATALOG.find((c) => c.from === f && c.to === toL && c.pivot);
    if (cat && cat.pivot.every((k) => installed.has(k))) chain = cat.pivot.map((k) => k.split('-')[1]);
  }
  if (!chain) return { ok: false, error: `模型未下载：先在插件里下载 ${LANG_NAMES[f] || f}→${LANG_NAMES[toL] || toL} 的模型` };
  const eng = await translateEngineStatus();
  if (!eng.installed) return { ok: false, error: eng.hint || '翻译引擎未安装', needEngine: true };
  const py = await findPythonForTranslate();
  const dir = path.join(os.tmpdir(), `toolbox-translate-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const inFile = path.join(dir, 'in.txt');
    const outFile = path.join(dir, 'out.txt');
    const scriptFile = path.join(dir, 't.py');
    fs.writeFileSync(inFile, t, 'utf8');
    fs.writeFileSync(scriptFile, TRANSLATE_PY, 'utf8');
    const r = await runCmd(py, [scriptFile, f, chain.join(','), inFile, outFile], 120000);
    if (r.code !== 0) return { ok: false, error: (r.err || r.out || '翻译失败').slice(0, 300) };
    return { ok: true, text: fs.readFileSync(outFile, 'utf8') };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  }
}
function translateSoftware() {
  const out = [];
  if (process.platform === 'win32') {
    const cands = [
      { name: '有道翻译', paths: [path.join(process.env['PROGRAMFILES(X86)'] || '', 'Youdao', 'YoudaoDict', 'YoudaoDict.exe'), path.join(process.env.PROGRAMFILES || '', 'Youdao', 'YoudaoDict', 'YoudaoDict.exe')] },
      { name: 'DeepL', paths: [path.join(process.env.APPDATA || '', 'DeepL', 'DeepL.exe'), path.join(process.env.LOCALAPPDATA || '', 'DeepL', 'DeepL.exe'), path.join(process.env.PROGRAMFILES || '', 'DeepL', 'DeepL.exe')] },
    ];
    for (const c of cands) {
      const hit = c.paths.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
      if (hit) out.push({ name: c.name, path: hit, detected: true });
    }
  }
  return out;
}
async function pluginCall(id, method, args, confirmed) {
  const plugin = getPlugins().find((x) => x.id === id);
  if (!plugin) return { ok: false, error: '插件不存在' };
  if (!plugin.enabled) return { ok: false, error: '插件已禁用，先启用再用' };
  if (!PLUGIN_PERMISSIONS.includes(method)) return { ok: false, error: `不支持的接口：${method}` };
  if (!(plugin.permissions || []).includes(method)) return { ok: false, error: `插件「${plugin.name}」没有申请 ${method} 权限（manifest 的 permissions 里没有它）` };
  if (PLUGIN_DANGEROUS_CALLS.has(method) && !confirmed) return { ok: false, needConfirm: true, error: `插件要调用 ${method}（装软件 / 运行代码），请先确认` };
  try {
    if (method === 'system.status') return { ok: true, data: await systemStatus() };
    if (method === 'monitor.status') return { ok: true, data: monitorStatus() };
    if (method === 'winget.search') {
      if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
      const r = await runWinget(['search', String((args && args.query) || ''), '--accept-source-agreements'], 90000);
      return { ok: true, data: parseWingetTable(r.out).slice(0, 20) };
    }
    if (method === 'winget.install') {
      if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
      const job = runWingetJob(`插件安装 ${args.id}`, ['install', '--id', String(args.id), '-e', '--accept-package-agreements', '--accept-source-agreements']);
      return { ok: true, data: { jobId: job.id } };
    }
    if (method === 'files.list') return { ok: true, data: listDir((args && args.dir) || '') };
    if (method === 'files.open') {
      const err = await shell.openPath(String((args && args.path) || ''));
      return err ? { ok: false, error: err } : { ok: true };
    }
    if (method === 'open.external') {
      const url = String((args && args.url) || '');
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: '只能打开 http(s) 链接' };
      await shell.openExternal(url);
      return { ok: true };
    }
    if (method === 'apps.list') return { ok: true, data: listLaunchableApps() };
    if (method === 'files.search') {
      const a = args || {};
      if (a.cancel) {
        const st = fileSearchState[id];
        if (st) { if (st.child) { try { st.child.kill(); } catch (e) { /* 已退出 */ } st.child = null; } st.done = true; }
        return { ok: true, data: { running: false, done: true, total: st ? st.results.length : 0, truncated: !!(st && st.truncated), error: '', roots: (st && st.roots) || [], results: [] } };
      }
      if (a.query !== undefined) fileSearchStart(id, a.query, a.roots);
      const page = fileSearchPage(id, a.offset, a.limit);
      if (!page) return { ok: false, error: '还没有开始搜索' };
      return { ok: true, data: page };
    }
    if (method === 'agent.list') return { ok: true, data: agentListForPlugin() };
    if (method === 'agent.complete') {
      const a = args || {};
      if (!String(a.text || '').trim()) return { ok: false, error: '没有要翻译的内容' };
      return agentComplete(String(a.agentId || ''), String(a.system || ''), String(a.text || ''));
    }
    if (method === 'plugin.store') {
      const a = args || {};
      if (a.op === 'set') return pluginStoreSet(id, a.value);
      return { ok: true, data: pluginStoreGet(id) };
    }
    if (method === 'translate.models') return translateModels(String((args && args.op) || 'list'), args || {});
    if (method === 'translate.offline') return translateOffline((args && args.text) || '', (args && args.from) || '', (args && args.to) || '');
    if (method === 'translate.software') return { ok: true, data: translateSoftware() };
    if (method === 'clipboard.write') { clipboard.writeText(String((args && args.text) || '')); return { ok: true }; }
    if (method === 'code.run') return runCode({ language: (args && args.language) || 'Python', code: (args && args.code) || '' });
    return { ok: false, error: `未实现的接口：${method}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ---------- 本地数据备份与同步（v1.6.0） ----------
 * 备份文件 .toolboxbak：{ format:'toolbox-backup', version:1,
 * exportedAt, files: {文件名: 文本内容} }，可选密码保护
 *（scrypt + AES-256-GCM）。默认不含密钥：config.json 里的
 * githubToken、imageApiKey 与 agents.json 里各智能体的 apiKey
 * 会被剔除，勾选“包含密钥”才带上。导入前先把当前数据自动备
 * 份到 userData/backups/。同步文件夹是手动同步、不是自动互通：
 * 指定文件夹后，点“同步到文件夹”写一份备份进去，另一台电脑
 * 点“从文件夹恢复”选那份备份导入，同步前同样先自动备份。
 * 2026-11-26-7：accounts.json 故意不在此列——账号登录态、
 * Cookie 与代理配置不进备份导出。 */
const BACKUP_FILE_NAMES = ['config.json', 'agents.json', 'agent-chats.json', 'ledger.json', 'register-records.json', 'register-platforms.json', 'creation.json', 'snippets.json', 'proxy-log.json', 'custom-sources.json', 'plugins.json', 'installed-import.json'];
const BACKUP_SECRET_KEYS = { 'config.json': ['githubToken', 'imageApiKey'], 'agents.json': ['apiKey'] };
function collectBackup(includeSecrets) {
  const files = {};
  for (const name of BACKUP_FILE_NAMES) {
    const fp = path.join(userDataDir(), name);
    if (!fs.existsSync(fp)) continue;
    let text = fs.readFileSync(fp, 'utf8');
    if (!includeSecrets && BACKUP_SECRET_KEYS[name]) {
      try {
        const obj = JSON.parse(text);
        const strip = (o) => {
          if (Array.isArray(o)) o.forEach(strip);
          else if (o && typeof o === 'object') {
            for (const k of BACKUP_SECRET_KEYS[name]) delete o[k];
            Object.values(o).forEach(strip);
          }
        };
        strip(obj);
        text = JSON.stringify(obj, null, 2);
      } catch (e) { /* 解析失败按原样导出，不含密钥处理跳过 */ }
    }
    files[name] = text;
  }
  return { format: 'toolbox-backup', version: 1, appVersion: VERSION, exportedAt: new Date().toISOString(), files };
}
function encryptBackupPayload(obj, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { format: 'toolbox-backup', version: 1, encrypted: true, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}
function decryptBackupPayload(payload, password) {
  const key = crypto.scryptSync(String(password), Buffer.from(payload.salt, 'base64'), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return JSON.parse(data.toString('utf8'));
}
function autoBackupCurrent() {
  const dir = path.join(userDataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `toolbox-backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.toolboxbak`);
  fs.writeFileSync(file, JSON.stringify(collectBackup(true), null, 2), 'utf8');
  return file;
}
async function importBackupObject(obj) {
  if (!obj || obj.format !== 'toolbox-backup' || !obj.files || typeof obj.files !== 'object') {
    return { ok: false, error: '不是工具箱备份文件（缺少 toolbox-backup 标记）' };
  }
  const autoFile = autoBackupCurrent();
  const names = [];
  for (const [name, text] of Object.entries(obj.files)) {
    if (!BACKUP_FILE_NAMES.includes(name)) continue;
    try { JSON.parse(String(text)); } catch (e) { return { ok: false, error: `备份里的 ${name} 不是合法 JSON，导入已取消（当前数据未动，自动备份在 ${autoFile}）` }; }
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(path.join(userDataDir(), name), String(text), 'utf8');
    names.push(name);
  }
  return { ok: true, files: names, autoBackup: autoFile };
}
async function importBackupFile(file, password) {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, error: `备份文件读不懂：${e.message}` }; }
  if (payload.encrypted) {
    if (!password) return { ok: false, needsPassword: true, error: '这份备份有密码保护，请先输入密码' };
    try { return await importBackupObject(decryptBackupPayload(payload, password)); }
    catch (e) { return { ok: false, error: '密码不对，或备份文件已损坏' }; }
  }
  return importBackupObject(payload);
}
async function writeBackupFile(dest, opts) {
  const obj = collectBackup(!!(opts && opts.includeSecrets));
  const payload = (opts && opts.password) ? encryptBackupPayload(obj, opts.password) : obj;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, file: dest, encrypted: !!(opts && opts.password), files: Object.keys(obj.files) };
}

/* ---------------- 2026-11-26-6：通用文本抓取与代理路由 ----------------
 * fetchText：抓一个 URL 的原始文本（嗅探、监控、Pioneer 出口
 * IP 验证共用），跟随重定向、走 effectiveProxy() 决定的出口。
 * effectiveProxy：Pioneer 隧道已连接且模式适用时优先走隧道，
 * 否则走设置里的手动代理；都不适用时直连。 */
const SMART_PROXY_SUFFIXES = [
  'openai.com', 'chatgpt.com', 'oaistatic.com', 'anthropic.com', 'claude.ai',
  'googleapis.com', 'google.com', 'x.ai', 'grok.com', 'mistral.ai',
  'openrouter.ai', 'perplexity.ai', 'cohere.com', 'huggingface.co',
  'github.com', 'githubusercontent.com',
];
function smartProxyHost(host) {
  const h = String(host || '').toLowerCase();
  if (h.endsWith('.cn')) return false;
  return SMART_PROXY_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
function pioneerTunnelProxy() {
  const s = pioneerLoad();
  if (s && s.connected && s.tunnelRunning) return { host: '127.0.0.1', port: 19352 };
  return null;
}
function effectiveProxy(hostname) {
  const t = pioneerTunnelProxy();
  if (t) {
    const mode = (pioneerLoad().proxyMode || 'smart');
    if (mode === 'smart' ? smartProxyHost(hostname) : true) return t;
  }
  const cfg = getConfig();
  if (['manual', 'smart', 'global'].includes(cfg.proxyMode) && cfg.proxyHost && proxyApplies(cfg.proxyMode, hostname)) {
    return { host: cfg.proxyHost, port: Number(cfg.proxyPort) || 8080 };
  }
  return null;
}
function fetchText(urlStr, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 30000;
  const maxBytes = (opts && opts.maxBytes) || 6 * 1024 * 1024;
  const headers = { ...(opts && opts.headers ? opts.headers : {}) };
  if (!headers['User-Agent']) headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  return new Promise((resolve) => {
    const request = (u, redirects) => {
      let parsed;
      try { parsed = new URL(u); } catch (e) { resolve({ ok: false, error: '网址无效' }); return; }
      const isHttps = parsed.protocol === 'https:';
      if (parsed.protocol !== 'http:' && !isHttps) { resolve({ ok: false, error: '只支持 http / https 地址' }); return; }
      const px = (opts && opts.forceProxy) ? opts.forceProxy : effectiveProxy(parsed.hostname);
      const doReq = (socket) => {
        const reqOpts = {
          method: (opts && opts.method) || 'GET',
          path: parsed.pathname + parsed.search,
          headers,
          ...(socket ? { socket, servername: parsed.hostname } : { hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80) }),
        };
        const req = (isHttps ? https : http).request(reqOpts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) { resolve({ ok: false, status: res.statusCode, error: '重定向次数过多' }); return; }
            request(new URL(res.headers.location, u).toString(), redirects + 1);
            return;
          }
          const chunks = [];
          let total = 0;
          res.on('data', (d) => { total += d.length; if (total <= maxBytes) chunks.push(d); });
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const setCookies = res.headers['set-cookie'] || [];
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode, text, finalUrl: u, headers: res.headers, setCookies });
            else resolve({ ok: false, status: res.statusCode, text, finalUrl: u, headers: res.headers, setCookies, error: `HTTP ${res.statusCode}` });
          });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
        req.setTimeout(timeoutMs, () => { req.destroy(new Error('请求超时')); });
        if (opts && opts.body != null) req.end(opts.body); else req.end();
      };
      if (!px) { doReq(null); return; }
      const sock = net.connect(px.port, px.host);
      const timer = setTimeout(() => { try { sock.destroy(); } catch (e) { /* 已关 */ } resolve({ ok: false, error: '代理连接超时' }); }, 20000);
      sock.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `代理连接失败：${e.message || String(e)}` }); });
      sock.on('connect', () => {
        sock.write(`CONNECT ${parsed.hostname}:${parsed.port || (isHttps ? 443 : 80)} HTTP/1.1\r\nHost: ${parsed.hostname}:${parsed.port || (isHttps ? 443 : 80)}\r\n\r\n`);
        let buf = '';
        const onData = (d) => {
          buf += d.toString();
          if (!buf.includes('\r\n\r\n')) return;
          sock.removeListener('data', onData);
          if (!/^HTTP\/\d\.\d 200/.test(buf)) { clearTimeout(timer); resolve({ ok: false, error: `代理拒绝连接：${buf.split('\r\n')[0]}` }); return; }
          clearTimeout(timer);
          if (isHttps) {
            const tlsSock = tls.connect({ socket: sock, servername: parsed.hostname }, () => doReq(tlsSock));
            tlsSock.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
          } else { doReq(sock); }
        };
        sock.on('data', onData);
      });
    };
    request(urlStr, 0);
  });
}
function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCharCode(Number(n)); } catch (e) { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return ''; } });
}

/* ---------------- 2026-11-26-6：视频嗅探 / 引擎 / 下载 ---------------- */
function videoDir() { return path.join(toolsDir(), 'video'); }
function videoDownloadsDir() { return path.join(defaultDownloadDir(), '工具箱视频'); }
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const VIDEO_ENGINES = {
  ytdlp: { file: 'yt-dlp.exe', repo: 'yt-dlp/yt-dlp', assetRe: /^yt-dlp\.exe$/i, zip: false, versionArgs: ['--version'] },
  nm3u8: { file: 'N_m3u8DL-RE.exe', repo: 'nilaoda/N_m3u8DL-RE', assetRe: /^N_m3u8DL-RE_.*_win-x64_.*\.zip$/i, zip: true, zipExeRe: /^N_m3u8DL-RE.*\.exe$/i, versionArgs: ['--version'] },
  lux: { file: 'lux.exe', repo: 'iawia002/lux', assetRe: /^lux_.*_Windows_x86_64\.zip$/i, zip: true, zipExeRe: /^lux\.exe$/i, versionArgs: ['-v'] },
  ffmpeg: { file: 'ffmpeg.exe', zip: true, zipExeRe: /^ffmpeg\.exe$/i, versionArgs: ['-version'] },
};
function videoEnginePath(key) { return path.join(videoDir(), VIDEO_ENGINES[key].file); }
async function videoEngineVersion(key) {
  const exe = videoEnginePath(key);
  if (!fs.existsSync(exe)) return '';
  try {
    const r = await runCmd(exe, VIDEO_ENGINES[key].versionArgs, 15000);
    const text = `${r.out || ''} ${r.err || ''}`.trim();
    const m = text.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:\.[0-9]+)?)/);
    return m ? m[1] : text.split(/\r?\n/)[0].slice(0, 40);
  } catch (e) { return ''; }
}
async function videoEnginesStatus() {
  const engines = {};
  for (const key of Object.keys(VIDEO_ENGINES)) {
    const installed = fs.existsSync(videoEnginePath(key));
    engines[key] = { installed, version: installed ? await videoEngineVersion(key) : '', path: installed ? videoEnginePath(key) : '' };
  }
  return { engines };
}
/* ---- 2026-11-27-2：视频引擎进已安装列表（后端） ----
 * yt-dlp / N_m3u8DL-RE / Lux / ffmpeg 存在 tools/video/ 下，但旧
 * 的已安装列表（winget-installed）只返回 winget 表，引擎搜不到。
 * 每条含 {id, name, version, versionNote, path, kind:'video-engine',
 * source:'video-engine'}；version 读不到写“未知”并注明原因。
 * 两个出口：(1) 新通道 tools-installed-extra 返回干净的引擎列表；
 * (2) winget-installed 末尾追加引擎行（带 kind 标记），前端按名
 * 字搜就能找到、看到版本和路径；点名称开目录走 installed-open-dir，
 * 它认 video-engine-* id，直接用 path 开目录，不走注册表。
 * 注意：引擎行不是 winget 包，前端展示时不要给它们挂 winget 卸载。 */
const VIDEO_ENGINE_DISPLAY = { ytdlp: 'yt-dlp', nm3u8: 'N_m3u8DL-RE', lux: 'Lux', ffmpeg: 'ffmpeg' };
const VIDEO_ENGINE_IDS = { ytdlp: 'video-engine-yt-dlp', nm3u8: 'video-engine-n-m3u8dl-re', lux: 'video-engine-lux', ffmpeg: 'video-engine-ffmpeg' };
async function listVideoEngines(opts) {
  const o = opts || {};
  const dir = o.dir || videoDir();
  const out = [];
  for (const key of Object.keys(VIDEO_ENGINES)) {
    const p = path.join(dir, VIDEO_ENGINES[key].file);
    let exists = false;
    try { exists = fs.existsSync(p) && fs.statSync(p).isFile(); } catch (e) { exists = false; }
    if (!exists) continue;
    let version = '未知';
    let versionNote = '';
    if (process.platform === 'win32' && !o.skipVersion) {
      const v = await videoEngineVersion(key);
      if (v) version = v;
      else versionNote = '引擎已安装，但运行版本命令未返回版本号';
    } else if (process.platform !== 'win32') {
      versionNote = '未在 Windows 上运行，无法执行引擎取版本号';
    } else versionNote = '跳过版本读取';
    out.push({ id: VIDEO_ENGINE_IDS[key], name: VIDEO_ENGINE_DISPLAY[key], version, versionNote, path: p, kind: 'video-engine', source: 'video-engine' });
  }
  return out;
}
function findVideoEngineByIdOrName(idOrName) {
  const key = String(idOrName || '').trim().toLowerCase();
  if (!key) return null;
  for (const k of Object.keys(VIDEO_ENGINES)) {
    if (key !== VIDEO_ENGINE_IDS[k] && key !== VIDEO_ENGINE_DISPLAY[k].toLowerCase() && key !== k) continue;
    const p = videoEnginePath(k);
    try { if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null; } catch (e) { return null; }
    return { id: VIDEO_ENGINE_IDS[k], name: VIDEO_ENGINE_DISPLAY[k], version: '未知', path: p, kind: 'video-engine', source: 'video-engine' };
  }
  return null;
}
function findFileRecursive(dir, re) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { const hit = findFileRecursive(fp, re); if (hit) return hit; }
      else if (re.test(e.name)) return fp;
    }
  } catch (e) { /* 读不到按没有 */ }
  return '';
}
async function downloadVideoEngine(engine) {
  const def = VIDEO_ENGINES[engine];
  if (!def) return { ok: false, error: '未知的视频引擎' };
  const dest = videoEnginePath(engine);
  const push = (pct, status) => sendToRenderer('video-engine-progress', { engine, pct, status });
  try {
    fs.mkdirSync(videoDir(), { recursive: true });
    push(2, '正在获取最新版本');
    if (engine === 'ffmpeg') {
      const zip = path.join(videoDir(), 'ffmpeg.zip');
      await downloadFile(FFMPEG_ZIP_URL, zip, (p) => push(Math.round(p * 80), '正在下载 ffmpeg'), { resume: false });
      push(85, '正在解压 ffmpeg');
      const tmp = path.join(videoDir(), 'ffmpeg-tmp');
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响 */ }
      await extractZip(zip, tmp);
      const exe = findFileRecursive(tmp, /^ffmpeg\.exe$/i);
      if (!exe) throw new Error('ffmpeg 官方包里没找到 bin/ffmpeg.exe');
      fs.copyFileSync(exe, dest);
      try { fs.unlinkSync(zip); } catch (e) { /* 删不掉不影响 */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    } else {
      const token = getConfig().githubToken || '';
      const r = await githubApi(`/repos/${def.repo}/releases/latest`, token);
      if (!r.ok) throw new Error(`取 ${def.repo} 最新版本失败：${r.error || ''}`);
      const assets = Array.isArray(r.data.assets) ? r.data.assets : [];
      const asset = assets.find((a) => def.assetRe.test(a.name || ''));
      if (!asset) throw new Error(`${def.repo} 最新版本里没找到可用的安装包`);
      const tmp = path.join(videoDir(), `dl-${engine}-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });
      const dlPath = path.join(tmp, asset.name);
      const dl = await downloadGithubAsset(asset.browser_download_url || asset.url, dlPath, token);
      if (!dl.ok) throw new Error(dl.error || '下载失败');
      push(80, '正在安装');
      if (!def.zip) {
        fs.copyFileSync(dlPath, dest);
      } else {
        const ext = path.join(tmp, 'extract');
        await extractZip(dlPath, ext);
        const exe = findFileRecursive(ext, def.zipExeRe);
        if (!exe) throw new Error('安装包里没找到可执行文件');
        fs.copyFileSync(exe, dest);
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    }
    const version = await videoEngineVersion(engine);
    push(100, '已安装');
    return { ok: true, path: dest, version };
  } catch (e) {
    push(0, '安装失败');
    return { ok: false, error: e.message || String(e) };
  }
}
const SNIFF_MEDIA_EXT_RE = /\.(m3u8|mp4|m4v|webm|mov|mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i;
function sniffKindOf(url) {
  if (/\.m3u8([?#]|$)/i.test(url)) return 'playlist';
  if (/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i.test(url)) return 'audio';
  return 'video';
}
function parseHlsVariants(text, baseUrl) {
  if (!text.includes('#EXTM3U')) return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const bw = /BANDWIDTH=(\d+)/.exec(line);
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    let next = '';
    for (let j = i + 1; j < lines.length; j++) {
      const cand = (lines[j] || '').trim();
      if (cand) { next = cand; break; }
    }
    if (!next || next.startsWith('#')) continue;
    try {
      out.push({ url: new URL(decodeHtmlEntities(next), baseUrl).toString(), width: res ? Number(res[1]) : 0, height: res ? Number(res[2]) : 0, bandwidth: bw ? Number(bw[1]) : 0 });
    } catch (e) { /* 解析不出的变体跳过 */ }
    if (out.length >= 20) break;
  }
  return out;
}
function parsePageMeta(html, baseUrl) {
  const pick = (re) => { const hit = re.exec(html); return hit ? decodeHtmlEntities((hit[1] || '').trim()) : ''; };
  let title = pick(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']+)["']/i);
  if (!title) title = pick(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:title["']/i);
  if (!title) title = decodeHtmlEntities(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)).replace(/<[^>]*>/g, '');
  let poster = pick(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i);
  if (!poster) poster = pick(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (poster) { try { poster = new URL(poster, baseUrl).toString(); } catch (e) { poster = ''; } }
  return { title: title.replace(/\s+/g, ' ').trim(), poster };
}
function extractSniffedMedia(html, baseUrl) {
  const text = html.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u002f/gi, '/');
  const out = [];
  const seen = new Set();
  const push = (raw, via) => {
    if (out.length >= 60) return;
    let abs = '';
    try { abs = new URL(decodeHtmlEntities(raw.trim()), baseUrl).toString(); } catch (e) { return; }
    if (!/^https?:\/\//i.test(abs)) return;
    if (!SNIFF_MEDIA_EXT_RE.test(abs)) return;
    const key = abs.split('#')[0] || abs;
    if (seen.has(key)) return;
    seen.add(key);
    let name = '';
    try { name = decodeURIComponent(new URL(key).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { name = ''; }
    out.push({ url: key, kind: sniffKindOf(key), via, name: name || `资源 ${out.length + 1}` });
  };
  let m;
  const tagRe = /<(?:video|audio|source)\b[^>]*?(?:src|data-src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = tagRe.exec(text)) !== null) push(m[1] || '', '播放器标签');
  const metaRe = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:(?:video|audio)(?::url|:secure_url)?|twitter:player:stream)["'][^>]+content\s*=\s*["']([^"']+)["']/gi;
  while ((m = metaRe.exec(text)) !== null) push(m[1] || '', '页面元信息');
  const metaRe2 = /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["'](?:og:(?:video|audio)(?::url|:secure_url)?|twitter:player:stream)["']/gi;
  while ((m = metaRe2.exec(text)) !== null) push(m[1] || '', '页面元信息');
  const attrRe = /(?:src|href|content|data-url|data-src|file|url)\s*=\s*["']([^"']+)["']/gi;
  while ((m = attrRe.exec(text)) !== null) push(m[1] || '', '页面内容');
  const bareRe = /https?:\/\/[^\s"'<>\\]+/gi;
  while ((m = bareRe.exec(text)) !== null) push(m[0] || '', '页面内容');
  const jsonKeyRe = /["'](?:file|url|src|playurl|play_url|videourl|video_url|stream|source|m3u8|mp4)["']\s*:\s*["']([^"']+)["']/gi;
  while ((m = jsonKeyRe.exec(text)) !== null) {
    const v = (m[1] || '').trim();
    if (v && !/[\s${}]/.test(v)) push(v, '播放器配置');
  }
  return out;
}
async function videoSniff(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (e) { return { ok: false, error: '这不是有效的网址' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: '只支持 http / https 地址' };
  if (SNIFF_MEDIA_EXT_RE.test(String(url))) {
    const kind = sniffKindOf(String(url));
    const items = [{ url: String(url), kind, via: '直链' }];
    if (kind === 'playlist') {
      const pl = await fetchText(String(url), { timeoutMs: 20000, maxBytes: 262144 });
      if (pl.ok && pl.text) {
        for (const v of parseHlsVariants(pl.text, pl.finalUrl || String(url))) {
          items.push({ url: v.url, kind: 'playlist', resolution: v.width && v.height ? `${v.width}x${v.height}` : '', bandwidth: v.bandwidth || undefined, via: 'm3u8 变体' });
        }
      }
    }
    return { ok: true, title: '', items };
  }
  const page = await fetchText(String(url), { timeoutMs: 30000 });
  if (!page.ok || !page.text) return { ok: false, error: page.status === 403 ? '这个站拒绝了访问（HTTP 403），地址可能需要登录或过验证' : (page.error ? `打开页面失败：${page.error}` : `打开页面失败（HTTP ${page.status}）`) };
  const base = page.finalUrl || String(url);
  const meta = parsePageMeta(page.text, base);
  const items = [];
  for (const c of extractSniffedMedia(page.text, base)) items.push({ url: c.url, kind: c.kind, via: c.via, note: c.name });
  let probed = 0;
  for (const c of extractSniffedMedia(page.text, base)) {
    if (c.kind !== 'playlist' || probed >= 3) continue;
    probed += 1;
    const pl = await fetchText(c.url, { timeoutMs: 20000, maxBytes: 262144 });
    if (pl.ok && pl.text) {
      for (const v of parseHlsVariants(pl.text, pl.finalUrl || c.url)) {
        items.push({ url: v.url, kind: 'playlist', resolution: v.width && v.height ? `${v.width}x${v.height}` : '', bandwidth: v.bandwidth || undefined, via: 'm3u8 变体' });
      }
    }
  }
  return { ok: true, title: meta.title, items };
}
/* ---- 2026-11-27-2：浏览器视频实时嗅探（主进程侧） ----
 * 内嵌浏览器 webview 用的分区：默认 'persist:toolbox-browser'，
 * 用账号管理里的账号打开时换成 persist:account-<id>。在这些分区的
 * session 上挂 webRequest.onBeforeRequest，抓媒体请求（m3u8、mp4、
 * dash 清单/分片等视频/音频 URL），去重后经 browser-media-found 发给
 * 渲染层（payload {url, type, pageUrl}，type 如 'm3u8'|'mp4'|'dash'）。
 * 只发给当前浏览器窗口——工具箱只有一个 BrowserWindow，
 * sendToRenderer 就是发给它；换页面时前端自己清空列表。
 * 注意：onBeforeRequest 必须每次都调 callback({})，否则请求会被挂起；
 * 嗅探本身绝不能拦住页面请求，所以判断全包在 try 里。
 * .ts 只认 resourceType 为 media/xhr 的：HLS 分片是这两种，
 * 而 TypeScript 源码走 script 加载，不会被当成媒体。
 * 输入网址分析（video-sniff）作为后备保留不动。 */
const BROWSER_MEDIA_EXT_RE = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|m4s|mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i;
const BROWSER_MEDIA_TS_RE = /\.ts([?#]|$)/i;
function browserMediaTypeOf(url) {
  if (/\.m3u8([?#]|$)/i.test(url)) return 'm3u8';
  if (/\.mpd([?#]|$)/i.test(url)) return 'dash';
  if (/\.m4s([?#]|$)/i.test(url)) return 'dash';
  if (/\.ts([?#]|$)/i.test(url)) return 'ts';
  const m = /\.([a-z0-9]+)([?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : 'video';
}
function isBrowserMediaRequest(url, resourceType) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  if (BROWSER_MEDIA_EXT_RE.test(url)) return true;
  if (BROWSER_MEDIA_TS_RE.test(url)) return resourceType === 'media' || resourceType === 'xhr' || resourceType === 'xmlhttprequest';
  return false;
}
const browserMediaSeen = new Set(); // 去重：同一 URL 一个会话里只发一次
const browserMediaSniffedPartitions = new Set();
const browserMediaPageUrlBySession = new Map(); // session 对象 -> 当前页地址（web-contents-created 跟踪）
const browserMediaStats = { emitted: 0, lastUrl: '', lastType: '', lastPageUrl: '' };
function ensureBrowserMediaSniff(partition) {
  const part = String(partition || '');
  if (!part || browserMediaSniffedPartitions.has(part)) return false;
  let ses;
  try { ses = session.fromPartition(part); } catch (e) { return false; }
  browserMediaSniffedPartitions.add(part);
  try {
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      try {
        const url = String((details && details.url) || '');
        if (url && isBrowserMediaRequest(url, details.resourceType)) {
          const key = url.split('#')[0];
          if (!browserMediaSeen.has(key)) {
            browserMediaSeen.add(key);
            if (browserMediaSeen.size > 500) { const first = browserMediaSeen.values().next().value; browserMediaSeen.delete(first); }
            const type = browserMediaTypeOf(url);
            const pageUrl = String((details && details.referrer) || browserMediaPageUrlBySession.get(ses) || '');
            browserMediaStats.emitted += 1;
            browserMediaStats.lastUrl = url; browserMediaStats.lastType = type; browserMediaStats.lastPageUrl = pageUrl;
            sendToRenderer('browser-media-found', { url, type, pageUrl });
          }
        }
      } catch (e) { /* 嗅探绝不能拦住页面请求 */ }
      callback({});
    });
  } catch (e) { browserMediaSniffedPartitions.delete(part); return false; }
  return true;
}
function ensureBrowserMediaSniffForAccounts() {
  try { for (const a of getAccounts()) ensureBrowserMediaSniff(accountPartition(a.id)); } catch (e) { /* 账号读不到不拦嗅探 */ }
}
function resolveVideoEngine(url, engine) {
  if (engine && engine !== 'auto') return engine;
  const u = String(url || '');
  if (/\.m3u8([?#]|$)/i.test(u)) return 'nm3u8';
  let host = '';
  try { host = new URL(u).hostname.toLowerCase(); } catch (e) { host = ''; }
  if (/(bilibili\.com|bilivideo\.|douyin\.com|kuaishou\.com|ixigua\.com|toutiao\.com|weibo\.com|xiaohongshu\.com|youku\.com|iqiyi\.com|qq\.com|mgtv\.com)/.test(host)) return 'lux';
  return 'ytdlp';
}
async function videoExtract(url, engine) {
  const u = String(url || '');
  if (/\.m3u8([?#]|$)/i.test(u)) {
    const pl = await fetchText(u, { timeoutMs: 20000, maxBytes: 262144 });
    if (!pl.ok || !pl.text) return { ok: false, error: `读取 m3u8 失败：${pl.error || `HTTP ${pl.status}`}` };
    const variants = parseHlsVariants(pl.text, pl.finalUrl || u);
    return { ok: true, title: '', engine: 'ytdlp', formats: variants.map((v, i) => ({ id: `v${i}`, ext: 'mp4', quality: v.width && v.height ? `${v.width}x${v.height}` : '', width: v.width || undefined, height: v.height || undefined, note: v.bandwidth ? `码率约 ${Math.round(v.bandwidth / 1000)} kbps` : '' })) };
  }
  const eng = resolveVideoEngine(u, engine);
  const exe = videoEnginePath(eng === 'nm3u8' ? 'nm3u8' : eng);
  if (!fs.existsSync(exe)) return { ok: false, error: `视频引擎未安装：请先在视频下载页安装 ${eng === 'ytdlp' ? 'yt-dlp' : eng === 'lux' ? 'Lux' : 'N_m3u8DL-RE'}` };
  if (eng === 'lux') {
    const r = await runCmd(exe, ['-j', u], 90000);
    if (r.code !== 0) return { ok: false, error: `Lux 解析失败：${`${r.err || r.out || ''}`.trim().slice(-300) || '未知错误'}` };
    try {
      const data = JSON.parse(r.out);
      const list = Array.isArray(data) ? data : (Array.isArray(data.streams) ? data.streams : (data.data && Array.isArray(data.data.streams) ? data.data.streams : []));
      const formats = list.map((s, i) => ({ id: String(s.id || s.format_id || i), ext: s.ext || 'mp4', quality: s.quality || s.format_note || '', size: s.size || undefined, note: s.note || '' }));
      return { ok: true, title: data.title || '', engine: 'lux', formats };
    } catch (e) { return { ok: false, error: 'Lux 返回的结果无法解析' }; }
  }
  const r = await runCmd(exe, ['-J', '--no-playlist', u], 90000);
  if (r.code !== 0) return { ok: false, error: `yt-dlp 解析失败：${`${r.err || r.out || ''}`.trim().slice(-300) || '未知错误'}` };
  try {
    const data = JSON.parse(r.out);
    const formats = (Array.isArray(data.formats) ? data.formats : []).map((f) => ({
      id: String(f.format_id || ''), ext: f.ext || '', quality: f.resolution || f.format_note || '',
      width: f.width || undefined, height: f.height || undefined, fps: f.fps || undefined,
      size: f.filesize || f.filesize_approx || undefined, note: f.format_note || '',
    })).filter((f) => f.id);
    return { ok: true, title: data.title || '', duration: data.duration || undefined, thumbnail: data.thumbnail || '', engine: 'ytdlp', formats };
  } catch (e) { return { ok: false, error: 'yt-dlp 返回的结果无法解析' }; }
}
function getVideoDownloads() { const v = readJsonFile('video-downloads.json', []); return Array.isArray(v) ? v : []; }
function saveVideoDownloads(list) { writeJsonFile('video-downloads.json', list); }
function videoDownloadStart({ url, engine, formatId, title }) {
  const u = String(url || '');
  const eng = resolveVideoEngine(u, engine);
  const exe = videoEnginePath(eng);
  if (!fs.existsSync(exe)) return { ok: false, error: `视频引擎未安装：请先在视频下载页安装 ${eng === 'ytdlp' ? 'yt-dlp' : eng === 'lux' ? 'Lux' : 'N_m3u8DL-RE'}` };
  const id = localId();
  const dir = videoDownloadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeTitle = String(title || '视频').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || '视频';
  const outTemplate = path.join(dir, `${safeTitle}-%(title)s.%(ext)s`);
  const list = getVideoDownloads();
  const rec = { id, title: safeTitle, file: '', size: 0, at: Date.now(), engine: eng, status: 'running' };
  list.unshift(rec);
  saveVideoDownloads(list.slice(0, 100));
  const push = (status, pct, file, error) => sendToRenderer('video-download-progress', { jobId: id, status, pct, file, error });
  const finish = (status, file, error) => {
    const cur = getVideoDownloads();
    const it = cur.find((x) => x.id === id);
    if (it) {
      it.status = status;
      if (file) { it.file = file; try { it.size = fs.statSync(file).size; } catch (e) { /* 读不到按 0 */ } }
      saveVideoDownloads(cur);
    }
    push(status, status === 'done' ? 100 : undefined, file, error);
  };
  let args = [];
  let outFile = '';
  if (eng === 'ytdlp') {
    const hasFfmpeg = fs.existsSync(videoEnginePath('ffmpeg'));
    let fmt = formatId || '';
    if (!fmt) fmt = hasFfmpeg ? 'bestvideo+bestaudio/best' : 'best';
    if (!hasFfmpeg && /\+/.test(fmt)) fmt = 'best';
    args = ['-f', fmt, '--no-playlist', '-o', outTemplate, u];
    if (hasFfmpeg) args.splice(2, 0, '--ffmpeg-location', videoDir());
  } else if (eng === 'nm3u8') {
    outFile = path.join(dir, `${safeTitle}.mp4`);
    args = [u, '--save-dir', dir, '--save-name', safeTitle, '-M', 'format=mp4', '--no-log'];
  } else {
    args = ['-o', dir, u];
  }
  const child = spawn(exe, args, { windowsHide: true });
  let errTail = '';
  let lastPct = 0;
  const onData = (d) => {
    const text = d.toString();
    errTail = (errTail + text).slice(-2000);
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) { lastPct = Math.round(Number(m[1])); push('running', lastPct); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => finish('failed', '', e.message || String(e)));
  child.on('close', (code) => {
    if (code !== 0) { finish('failed', '', `下载失败（退出码 ${code}）：${errTail.trim().slice(-300) || '未知错误'}`); return; }
    let file = outFile;
    if (!file) {
      try {
        const cands = fs.readdirSync(dir).map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
        if (cands[0]) file = path.join(dir, cands[0].f);
      } catch (e) { /* 读不到按空 */ }
    }
    if (!file || !fs.existsSync(file)) { finish('failed', '', '下载已结束，但没找到生成的文件'); return; }
    if (eng === 'ytdlp' && !fs.existsSync(videoEnginePath('ffmpeg')) && formatId && /\+/.test(formatId)) {
      // 无 ffmpeg 时只下了单文件格式：如实说明，不假装合并成功
      finish('done', file, '');
      return;
    }
    finish('done', file, '');
  });
  push('running', 0);
  return { ok: true, jobId: id };
}

/* ---------------- 2026-11-26-6：Pioneer ----------------
 * 账号、密码、token、Trojan 密码与完整节点配置只存本机
 * pioneer-state.json，永不返回渲染层、永不记日志。 */
const PIONEER_HOSTS = ['https://app.genershake.com', 'https://app.bestmodes.com', 'https://letssaubpub.azureedge.net'];
const PIONEER_VERSION = '3.0.24';
const PIONEER_KEY = Buffer.from('btB0KwUmFcNk0PE3', 'utf8');
const PIONEER_IV = Buffer.from('hMeYA6IvQj2Vc7xc', 'utf8');
function pioneerLoad() { const v = readJsonFile('pioneer-state.json', {}); return v && typeof v === 'object' ? v : {}; }
function pioneerSave(s) { writeJsonFile('pioneer-state.json', s); }
function pioneerPublic(s) {
  return {
    loggedIn: !!(s.token), username: s.username || '', hasPassword: !!(s.password),
    accountType: s.accountType || '', dueTime: s.dueTime || '',
    connected: !!(s.connected), region: s.selectedName || '', nodeName: (s.node && s.node.name) || '',
    nodeHost: (s.node && s.node.host) || '', exitIp: s.exitIp || '',
    proxyMode: s.proxyMode || 'smart',
  };
}
function pioneerLog(text, ok) {
  try {
    const s = pioneerLoad();
    const logs = Array.isArray(s.logs) ? s.logs : [];
    logs.unshift({ at: Date.now(), text: String(text || ''), ok: ok !== false });
    s.logs = logs.slice(0, 100);
    pioneerSave(s);
  } catch (e) { /* 日志写失败不影响 */ }
}
function pioneerEncrypt(obj) {
  const c = crypto.createCipheriv('aes-128-cbc', PIONEER_KEY, PIONEER_IV);
  return Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]).toString('base64');
}
function pioneerDecrypt(b64) {
  const d = crypto.createDecipheriv('aes-128-cbc', PIONEER_KEY, PIONEER_IV);
  return Buffer.concat([d.update(Buffer.from(String(b64 || ''), 'base64')), d.final()]).toString('utf8');
}
function pioneerErrorText(message) {
  if (message === 'api.account_or_password_wrong') return '帐号或密码不正确（Pioneer 服务器返回）';
  return message;
}
async function pioneerCall(path, method, deviceId, token, payload) {
  let lastError = '无法连接 Pioneer 服务器';
  for (const host of PIONEER_HOSTS) {
    const headers = {
      'User-Agent': `Pioneer/${PIONEER_VERSION}`, Accept: 'application/json',
      did: deviceId, lang: 'zh-CN', os: 'win', version: PIONEER_VERSION,
      ...(token ? { token } : {}),
    };
    let body = null;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      body = { Data: pioneerEncrypt(payload || {}) };
    }
    const r = await httpJson(method, `${host}${path}`, body, headers, 20000);
    if (!r.ok) {
      // httpJson 只在解析失败时才把状态码藏进 error；业务失败看包体
      lastError = r.error || `HTTP ${r.status || ''}`;
      if (r.status === 403 || r.status === 404) continue;
      continue;
    }
    const env = r.data;
    if (!env || typeof env !== 'object') { lastError = `${host} 返回了无法解析的响应`; continue; }
    const status = String(env.Status || '');
    const message = String(env.Message || '');
    if (status !== 'success') {
      return { ok: false, error: pioneerErrorText(message || `Pioneer 服务器返回失败（HTTP ${r.status}）`), tokenProblem: /token/i.test(message) };
    }
    let data = null;
    const rawData = env.Data;
    if (typeof rawData === 'string' && rawData !== '') {
      try { data = JSON.parse(pioneerDecrypt(rawData)); } catch (e) { return { ok: false, error: 'Pioneer 服务器返回的数据无法解密（协议可能已变更）', tokenProblem: false }; }
    } else if (rawData && typeof rawData === 'object') {
      data = rawData;
    }
    return { ok: true, data, host };
  }
  return { ok: false, error: lastError, tokenProblem: false };
}
function pioneerEnsureDeviceId() {
  const s = pioneerLoad();
  if (s.deviceId) return s.deviceId;
  const id = crypto.randomUUID();
  s.deviceId = id;
  pioneerSave(s);
  return id;
}
async function pioneerDoLogin(username, password) {
  const deviceId = pioneerEnsureDeviceId();
  const r = await pioneerCall('/api/login', 'POST', deviceId, '', { type: 2, userName: username, password, deviceId });
  if (!r.ok) { pioneerLog(`登录失败：${r.error}`, false); return { ok: false, error: r.error }; }
  const token = String((r.data && (r.data.accessToken || r.data.token)) || '');
  if (!token) { pioneerLog('登录失败：服务器未返回登录令牌', false); return { ok: false, error: 'Pioneer 服务器未返回登录令牌（协议可能已变更）' }; }
  const s = pioneerLoad();
  s.username = username; s.password = password; s.token = token;
  s.accountType = String((r.data && (r.data.userType || r.data.accountType)) || '');
  s.dueTime = String((r.data && (r.data.dueTime || r.data.due_time)) || '');
  s.loginName = String((r.data && (r.data.email || r.data.userNumber)) || username);
  pioneerSave(s);
  pioneerLog(`登录成功：帐号 ${s.loginName}${s.accountType ? `（${s.accountType}）` : ''}`);
  return { ok: true, login: s.loginName };
}
async function pioneerFetchRegions() {
  let s = pioneerLoad();
  if (!s.token) {
    if (s.username && s.password) {
      const login = await pioneerDoLogin(s.username, s.password);
      if (!login.ok) return { ok: false, error: login.error };
      s = pioneerLoad();
    } else return { ok: false, error: '尚未登录 Pioneer 帐号' };
  }
  const deviceId = pioneerEnsureDeviceId();
  let r = await pioneerCall('/api/server', 'GET', deviceId, s.token, null);
  if (!r.ok && r.tokenProblem && s.username && s.password) {
    const login = await pioneerDoLogin(s.username, s.password);
    if (login.ok) { s = pioneerLoad(); r = await pioneerCall('/api/server', 'GET', deviceId, s.token, null); }
  }
  if (!r.ok) return { ok: false, error: r.error };
  const regions = [];
  if (r.data) {
    for (const value of Object.values(r.data)) {
      if (!Array.isArray(value)) continue;
      for (const v of value) {
        if (!v || typeof v !== 'object' || typeof v.country_name !== 'string') continue;
        regions.push({ country_id: typeof v.country_id === 'number' ? v.country_id : 0, country_name: v.country_name });
      }
    }
  }
  regions.sort((a, b) => (a.country_id || 0) - (b.country_id || 0));
  s = pioneerLoad();
  s.regions = regions;
  pioneerSave(s);
  pioneerLog(`服务器列表已识别：共 ${regions.length} 个地区`);
  return { ok: true, regions };
}
function pioneerFlatten(value, depth, out) {
  if (depth > 4 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) pioneerFlatten(item, depth + 1, out); return; }
  for (const [k, v] of Object.entries(value)) {
    out.push([String(k).toLowerCase(), v]);
    if (v !== null && typeof v === 'object') pioneerFlatten(v, depth + 1, out);
  }
}
function pioneerFirstField(pairs, keys) {
  for (const key of keys) {
    for (const [k, v] of pairs) {
      if (k !== key) continue;
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
  }
  return '';
}
function pioneerExtractNode(data, countryId) {
  const pairs = [];
  pioneerFlatten(data, 0, pairs);
  const info = { countryId, name: String((data && data.name) || ''), country: String((data && data.country) || ''), protocol: '', host: '', port: 0, sni: '' };
  let link = '';
  for (const [, v] of pairs) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (/^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//i.test(t)) { link = t; break; }
  }
  if (link.toLowerCase().startsWith('trojan://')) {
    try {
      const u = new URL(link);
      info.protocol = 'trojan'; info.host = u.hostname; info.port = u.port ? Number(u.port) : 0;
      info.sni = u.searchParams.get('sni') || u.searchParams.get('peer') || '';
      if (!info.name && u.hash) info.name = decodeURIComponent(u.hash.slice(1));
    } catch (e) { /* 链接解析失败走普通字段 */ }
  } else if (link) {
    try {
      const u = new URL(link);
      info.protocol = u.protocol.replace(/:$/, ''); info.host = u.hostname; info.port = u.port ? Number(u.port) : 0;
      info.sni = u.searchParams.get('sni') || u.searchParams.get('peer') || '';
      if (!info.name && u.hash) info.name = decodeURIComponent(u.hash.slice(1));
    } catch (e) { /* 走普通字段 */ }
  }
  if (!info.host) info.host = pioneerFirstField(pairs, ['host', 'ip', 'address', 'server', 'domain', 'endpoint', 'hostname', 'add']);
  if (!info.port) { const p = pioneerFirstField(pairs, ['port', 'server_port', 'serverport']); info.port = p ? Number(p) || 0 : 0; }
  if (!info.protocol) info.protocol = pioneerFirstField(pairs, ['protocol', 'scheme', 'method']);
  if (!info.sni) info.sni = pioneerFirstField(pairs, ['sni', 'servername', 'server_name']);
  if (!info.name) info.name = pioneerFirstField(pairs, ['ps', 'remark', 'remarks', 'title']);
  return info;
}
function pioneerExtractTrojan(data, info) {
  if (!data) return null;
  const pairs = [];
  pioneerFlatten(data, 0, pairs);
  for (const [, v] of pairs) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t.toLowerCase().startsWith('trojan://')) continue;
    try {
      const u = new URL(t);
      const password = decodeURIComponent(u.username);
      const host = u.hostname || (info && info.host) || '';
      const port = u.port ? Number(u.port) : (info && info.port) || 0;
      if (!password || !host || !port) return null;
      return { host, port, password, sni: u.searchParams.get('sni') || u.searchParams.get('peer') || (info && info.sni) || '' };
    } catch (e) { return null; }
  }
  const protocol = String((info && info.protocol) || '').toLowerCase();
  if (protocol && protocol !== 'trojan') return null;
  const password = pioneerFirstField(pairs, ['password', 'pass', 'passwd', 'pwd']);
  const host = (info && info.host) || '';
  const port = (info && info.port) || 0;
  if (!password || !host || !port) return null;
  return { host, port, password, sni: (info && info.sni) || '' };
}
/* ---- 内置 Trojan 隧道（空间 trojan-daemon 同款逻辑，主进程内直接起服务） ---- */
let pioneerServer = null;
let pioneerTrojanCfg = null;
let pioneerConnections = 0;
let pioneerLastError = '';
function pioneerTrojanHash(password) { return crypto.createHash('sha224').update(String(password || ''), 'utf8').digest('hex'); }
function pioneerIpv6Bytes(ip) {
  let addr = ip;
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  const halves = addr.split('::');
  let parts = [];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    parts = left.concat(new Array(Math.max(0, missing)).fill('0'), right);
  } else parts = addr.split(':');
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) buf.writeUInt16BE(parseInt(parts[i] || '0', 16) || 0, i * 2);
  return buf;
}
function pioneerAddrBytes(host) {
  const v = net.isIP(host);
  if (v === 4) return Buffer.concat([Buffer.from([1]), Buffer.from(host.split('.').map((x) => Number(x) & 255))]);
  if (v === 6) return Buffer.concat([Buffer.from([4]), pioneerIpv6Bytes(host)]);
  const b = Buffer.from(host, 'utf8');
  return Buffer.concat([Buffer.from([3, b.length & 255]), b]);
}
function pioneerTrojanHead(host, port) {
  const pb = Buffer.alloc(2);
  pb.writeUInt16BE(port & 65535, 0);
  return Buffer.concat([Buffer.from(pioneerTrojanHash(pioneerTrojanCfg.password) + '\r\n', 'ascii'), Buffer.from([1]), pioneerAddrBytes(host), pb, Buffer.from('\r\n', 'ascii')]);
}
function pioneerEgressProxy() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    return { host: u.hostname, port: Number(u.port) || 8080, auth: u.username ? Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password || ''), 'utf8').toString('base64') : '' };
  } catch (e) { return null; }
}
function pioneerOpenUpstream(host, port, first, cb) {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; pioneerLastError = '连接节点超时（20 秒）'; cb(new Error('连接节点超时（20 秒）'), null); } }, 20000);
  function fail(e) {
    pioneerLastError = '节点连接失败：' + (e && e.message ? e.message : String(e));
    if (!settled) { settled = true; clearTimeout(timer); cb(e, null); }
  }
  function beginTls(sock) {
    const up = tls.connect({ socket: sock, servername: pioneerTrojanCfg.sni || pioneerTrojanCfg.host, rejectUnauthorized: false });
    up.once('secureConnect', () => {
      if (settled) { try { up.destroy(); } catch (e) { /* 已关 */ } return; }
      settled = true; clearTimeout(timer);
      pioneerConnections += 1;
      try { up.write(Buffer.concat([pioneerTrojanHead(host, port), first])); } catch (e) { /* 写失败走 close */ }
      cb(null, up);
    });
    up.once('error', fail);
  }
  const px = pioneerEgressProxy();
  if (!px) {
    const direct = tls.connect({ host: pioneerTrojanCfg.host, port: Number(pioneerTrojanCfg.port), servername: pioneerTrojanCfg.sni || pioneerTrojanCfg.host, rejectUnauthorized: false });
    direct.once('secureConnect', () => {
      if (settled) { try { direct.destroy(); } catch (e) { /* 已关 */ } return; }
      settled = true; clearTimeout(timer);
      pioneerConnections += 1;
      try { direct.write(Buffer.concat([pioneerTrojanHead(host, port), first])); } catch (e) { /* 写失败走 close */ }
      cb(null, direct);
    });
    direct.once('error', fail);
    return;
  }
  const rawSock = net.createConnection({ host: px.host, port: px.port });
  rawSock.once('error', fail);
  rawSock.once('connect', () => {
    let head = `CONNECT ${pioneerTrojanCfg.host}:${Number(pioneerTrojanCfg.port)} HTTP/1.1\r\nHost: ${pioneerTrojanCfg.host}:${Number(pioneerTrojanCfg.port)}\r\n`;
    if (px.auth) head += `Proxy-Authorization: Basic ${px.auth}\r\n`;
    head += '\r\n';
    try { rawSock.write(head); } catch (e) { fail(e); return; }
    let acc = Buffer.alloc(0);
    const onData = (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      const idx = acc.indexOf('\r\n\r\n');
      if (idx < 0) { if (acc.length > 16384) { try { rawSock.destroy(); } catch (e) { /* 已关 */ } fail(new Error('出口代理响应异常')); } return; }
      rawSock.removeListener('data', onData);
      const line = acc.slice(0, idx).toString('latin1').split('\r\n')[0] || '';
      if (line.indexOf(' 200') < 0) { try { rawSock.destroy(); } catch (e) { /* 已关 */ } fail(new Error('出口代理拒绝连接节点：' + line)); return; }
      beginTls(rawSock);
    };
    rawSock.on('data', onData);
  });
}
function pioneerPipePair(a, b) {
  a.on('data', (d) => { if (!b.destroyed) { try { b.write(d); } catch (e) { /* 写失败走 close */ } } });
  b.on('data', (d) => { if (!a.destroyed) { try { a.write(d); } catch (e) { /* 写失败走 close */ } } });
  a.on('error', () => { try { b.destroy(); } catch (e) { /* 已关 */ } });
  b.on('error', () => { try { a.destroy(); } catch (e) { /* 已关 */ } });
  a.on('close', () => { try { b.destroy(); } catch (e) { /* 已关 */ } });
  b.on('close', () => { try { a.destroy(); } catch (e) { /* 已关 */ } });
}
function pioneerStartTunnel(cfg) {
  return new Promise((resolve) => {
    pioneerStopTunnel();
    pioneerTrojanCfg = cfg;
    pioneerConnections = 0;
    pioneerLastError = '';
    const server = net.createServer((client) => {
      client.once('data', (first) => {
        if (!first || first.length === 0) { client.destroy(); return; }
        if (first[0] === 5) {
          const nMethods = first.length > 1 ? first[1] : 0;
          const greetingLen = 2 + nMethods;
          if (first.length < greetingLen) { client.destroy(); return; }
          const handleRequest = (req) => {
            if (req.length < 4 || req[1] !== 1) { try { client.write(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); client.end(); } catch (e) { /* 已关 */ } return; }
            const atyp = req[3];
            let host = ''; let off = 4;
            if (atyp === 1) { host = Array.from(req.slice(4, 8)).join('.'); off = 8; }
            else if (atyp === 3) { const l = req[4]; host = req.slice(5, 5 + l).toString('utf8'); off = 5 + l; }
            else if (atyp === 4) { const segs = []; for (let i = 0; i < 8; i++) segs.push(req.readUInt16BE(4 + i * 2).toString(16)); host = segs.join(':'); off = 20; }
            else { client.destroy(); return; }
            if (req.length < off + 2) { client.destroy(); return; }
            const port = req.readUInt16BE(off);
            const rest = req.slice(off + 2);
            pioneerOpenUpstream(host, port, rest, (err, up) => {
              if (err || !up) { try { client.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); client.end(); } catch (e) { /* 已关 */ } return; }
              try { client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); } catch (e) { /* 已关 */ }
              pioneerPipePair(client, up);
            });
          };
          try { client.write(Buffer.from([5, 0])); } catch (e) { /* 已关 */ }
          const rest0 = first.slice(greetingLen);
          if (rest0.length >= 4) { handleRequest(rest0); return; }
          let acc = rest0;
          const onReq = (chunk) => { acc = Buffer.concat([acc, chunk]); if (acc.length >= 4) { client.removeListener('data', onReq); handleRequest(acc); } };
          client.on('data', onReq);
          return;
        }
        let acc = first;
        const handleHttp = (buf) => {
          const headEnd = buf.indexOf('\r\n\r\n');
          const head = (headEnd >= 0 ? buf.slice(0, headEnd) : buf).toString('latin1');
          const rest = headEnd >= 0 ? buf.slice(headEnd + 4) : Buffer.alloc(0);
          const lines = head.split('\r\n');
          const m = /^(\S+)\s+(\S+)\s+HTTP\/\d\.\d$/.exec(lines[0] || '');
          if (!m) { client.destroy(); return; }
          const method = m[1].toUpperCase();
          const target = m[2];
          if (method === 'CONNECT') {
            const hp = target.split(':');
            const port = Number(hp[hp.length - 1]) || 443;
            const host = hp.slice(0, hp.length - 1).join(':').replace(/^\[|\]$/g, '');
            pioneerOpenUpstream(host, port, rest, (err, up) => {
              if (err || !up) { try { client.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); client.end(); } catch (e) { /* 已关 */ } return; }
              try { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); } catch (e) { /* 已关 */ }
              pioneerPipePair(client, up);
            });
            return;
          }
          let u = null;
          try { u = new URL(target); } catch (e) { /* 非绝对地址按 400 */ }
          if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) { try { client.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'); client.end(); } catch (e) { /* 已关 */ } return; }
          const host = u.hostname;
          const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
          const pathQ = (u.pathname || '/') + (u.search || '');
          const headers = lines.slice(1).filter((l) => l && !/^proxy-/i.test(l));
          const out = `${method} ${pathQ} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`;
          pioneerOpenUpstream(host, port, Buffer.concat([Buffer.from(out, 'latin1'), rest]), (err, up) => {
            if (err || !up) { try { client.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); client.end(); } catch (e) { /* 已关 */ } return; }
            pioneerPipePair(client, up);
          });
        };
        if (acc.indexOf('\r\n\r\n') >= 0) { handleHttp(acc); return; }
        const onData = (chunk) => { acc = Buffer.concat([acc, chunk]); if (acc.indexOf('\r\n\r\n') >= 0 || acc.length > 65536) { client.removeListener('data', onData); handleHttp(acc); } };
        client.on('data', onData);
      });
      client.on('error', () => { /* 单个连接错误不影响隧道 */ });
    });
    server.on('error', (e) => { pioneerLastError = '本地代理启动失败：' + (e && e.message ? e.message : String(e)); resolve({ ok: false, error: pioneerLastError }); });
    server.listen(19352, '127.0.0.1', () => { pioneerServer = server; resolve({ ok: true }); });
  });
}
function pioneerStopTunnel() {
  if (pioneerServer) { try { pioneerServer.close(); } catch (e) { /* 已关 */ } pioneerServer = null; }
  pioneerTrojanCfg = null;
  // 2026-11-27-3：隧道停了，内嵌浏览器代理同步复位回直连（不写系统代理）。
  void pioneerResetBrowserProxy();
  try {
    const s = pioneerLoad();
    if (s.tunnelRunning) { s.tunnelRunning = false; s.connected = false; pioneerSave(s); }
  } catch (e) { /* 状态写失败不影响 */ }
}
/* ---------- 2026-11-27-3：Pioneer 真连通补齐 ----------
 * -27-2 只做了出口 IP 验证，这次补缺的两段：
 * ① 本地 SOCKS5/HTTP 端口监听就绪检测（127.0.0.1:19352，3 秒超时）；
 * ② 连接成功后对内嵌浏览器会话（persist:toolbox-browser）执行
 *    session.setProxy() 同步接管；断开与退出时复位回 direct。
 * 注意：工具箱从没写过 Windows 注册表系统代理，这里也不新增。
 * 智能模式用 PAC 脚本实现分流（与 smartProxyHost 同一张海外域名表），
 * 全局/Tun 模式整会话走隧道。任一步失败都回滚并返回具体原因。 */
const PIONEER_LOCAL_PROXY = { host: '127.0.0.1', port: 19352 };
function pioneerCheckLocalPort(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.createConnection({ host: PIONEER_LOCAL_PROXY.host, port: PIONEER_LOCAL_PROXY.port });
    const timer = setTimeout(() => finish(false, `本地代理端口 ${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port} 连接超时（3 秒）`), timeoutMs);
    function finish(ok, error) {
      if (done) return; done = true; clearTimeout(timer);
      try { sock.destroy(); } catch (e) { /* 忽略 */ }
      resolve(ok ? { ok: true } : { ok: false, error: error || `本地代理端口 ${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port} 未监听` });
    }
    sock.once('connect', () => finish(true));
    sock.once('error', (e) => finish(false, `本地代理端口 ${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port} 连接失败：${e.message || String(e)}`));
  });
}
function pioneerSmartPacScript() {
  const list = SMART_PROXY_SUFFIXES.map((s) => JSON.stringify(s)).join(',');
  return `function FindProxyForURL(url, host) {
    var SUFFIXES = [${list}];
    host = (host || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'DIRECT';
    if (host.endsWith('.cn')) return 'DIRECT';
    for (var i = 0; i < SUFFIXES.length; i++) {
      var s = SUFFIXES[i];
      if (host === s || host.endsWith('.' + s)) return 'SOCKS5 ${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port}';
    }
    return 'DIRECT';
  }`;
}
async function pioneerApplyBrowserProxy(mode) {
  try {
    const ses = session.fromPartition('persist:toolbox-browser');
    if (!ses) return { ok: false, error: '内嵌浏览器会话不存在' };
    if (mode === 'global' || mode === 'tun') {
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5=${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port}` });
    } else if (mode === 'smart') {
      await ses.setProxy({ mode: 'pac_script', pacScript: pioneerSmartPacScript() });
    } else {
      await ses.setProxy({ mode: 'direct' });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
async function pioneerResetBrowserProxy() {
  try {
    const ses = session.fromPartition('persist:toolbox-browser');
    if (ses) await ses.setProxy({ mode: 'direct' });
  } catch (e) { /* 复位失败只记日志，不拦断开与退出 */ }
}
/* ---------- 2026-11-27-2：Pioneer 出口验证（分阶段） ----------
 * 旧 pioneerFetchExitIp 的问题：
 * 1) 只有 ipinfo.io 与 ipwho.is 两个检测地址，任一被限流/不可用就
 *    只剩一个，两个都挂就直接失败，没有重试与更多后备；
 * 2) 超时 15 秒 × 2 串行，且 fetchText 里代理 CONNECT 的定时器是
 *    另外的 20 秒，节点死了也要等很久；
 * 3) 失败原因只是一串文字，代理没连上 / 节点失效 / 检测服务不通
 *    三种情况混在一起，界面无法告诉用户到底哪一步坏了；
 * 4) pioneerConnect 验证失败时仍把 connected=true 写进状态，
 *    界面显示“已连接”，但出口 IP 根本没验出来。
 * 现改成：先按阶段探（代理 TCP → CONNECT → TLS/HTTP），每步超时
 * 10 秒；5 个检测地址轮询、失败立即换下一个；返回 {ok, stage,
 * reason}，stage 为 proxy（代理没连上）| node（节点失效）|
 * detector（检测服务不通）| ok。 */
const PIONEER_EGRESS_DETECTORS = [
  { url: 'https://api.ipify.org?format=json', kind: 'json' },
  { url: 'https://ifconfig.me/ip', kind: 'text' },
  { url: 'https://icanhazip.com', kind: 'text' },
  { url: 'https://ipinfo.io/json', kind: 'json' },
  { url: 'https://ipwho.is/', kind: 'json' },
];
const PIONEER_EGRESS_STAGE_TEXT = { proxy: '代理没连上', node: '节点失效', detector: '检测服务不通', ok: '正常' };
function parseEgressIp(text) {
  const s = String(text || '');
  try { const rec = JSON.parse(s); if (rec && rec.ip) return String(rec.ip); } catch (e) { /* 不是 JSON 就按纯文本找 IP */ }
  const m = s.match(/((?:\d{1,3}\.){3}\d{1,3})/);
  return m ? m[1] : '';
}
/* 旧 fetchText 报错文字映射到阶段（兼容旧调用方与自测夹具）。 */
function classifyEgressError(errText) {
  const e = String(errText || '');
  if (/代理连接失败|代理连接超时|ECONNREFUSED|本地代理/.test(e)) return 'proxy';
  if (/代理拒绝连接|502|Bad Gateway|连接节点超时|节点连接失败/.test(e)) return 'node';
  return 'detector';
}
/* 经代理（或直连）探一个检测地址。返回 {ok, ip, stage, reason}。
 * 阶段判定：连不上本地代理 → proxy；CONNECT 失败/超时/非 200 →
 * node（节点没把流量送出去）；CONNECT 成功后 TLS/HTTP/解析失败 →
 * detector（节点是通的，检测服务本身有问题）。 */
function pioneerProbeDetector(det, proxy, timeoutMs) {
  const timeout = Number(timeoutMs) || 10000;
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(det.url); } catch (e) { resolve({ ok: false, stage: 'detector', reason: `检测地址无效：${det.url}` }); return; }
    const isHttps = parsed.protocol === 'https:';
    const host = parsed.hostname;
    const port = Number(parsed.port) || (isHttps ? 443 : 80);
    const targetPath = (parsed.pathname || '/') + (parsed.search || '');
    let settled = false;
    let phase = proxy ? 'proxy-connect' : 'connect';
    let sock = null;
    const done = (r) => { if (settled) return; settled = true; try { if (sock) sock.destroy(); } catch (e) { /* 已关 */ } resolve(r); };
    const timer = setTimeout(() => {
      if (phase === 'proxy-connect') done({ ok: false, stage: 'proxy', reason: `本地代理 ${proxy.host}:${proxy.port} 连接超时（${Math.round(timeout / 1000)} 秒）：隧道未启动或已被关闭，请重新连接 Pioneer` });
      else if (phase === 'connect') done({ ok: false, stage: 'node', reason: `经代理连接 ${host} 超时（${Math.round(timeout / 1000)} 秒）：节点没有响应，可能已失效或网络不通` });
      else done({ ok: false, stage: 'detector', reason: `检测服务 ${det.url} 响应超时（${Math.round(timeout / 1000)} 秒）` });
    }, timeout);
    const finishTimer = () => { clearTimeout(timer); };
    const onSockError = (e) => {
      const msg = (e && e.message) || String(e);
      if (phase === 'proxy-connect') { finishTimer(); done({ ok: false, stage: 'proxy', reason: `本地代理 ${proxy.host}:${proxy.port} 连不上：${msg}（隧道未启动或已被关闭，请重新连接 Pioneer）` }); }
      else if (phase === 'connect') { finishTimer(); done({ ok: false, stage: 'node', reason: `节点连接 ${host} 失败：${msg}（节点可能已失效）` }); }
      else { finishTimer(); done({ ok: false, stage: 'detector', reason: `检测服务 ${det.url} 访问失败：${msg}` }); }
    };
    const doHttp = (socket) => {
      phase = 'http';
      let buf = '';
      let status = 0;
      socket.on('data', (d) => { buf += d.toString('utf8'); });
      socket.on('end', () => {
        finishTimer();
        const headEnd = buf.indexOf('\r\n\r\n');
        const head = headEnd >= 0 ? buf.slice(0, headEnd) : buf;
        const body = headEnd >= 0 ? buf.slice(headEnd + 4) : '';
        const sm = /^HTTP\/\d\.\d (\d{3})/.exec(head);
        status = sm ? Number(sm[1]) : 0;
        if (!sm) { done({ ok: false, stage: 'detector', reason: `检测服务 ${det.url} 返回的内容无法解析（不是合法 HTTP 响应）` }); return; }
        if (status < 200 || status >= 300) { done({ ok: false, stage: 'detector', reason: `检测服务 ${det.url} 返回 HTTP ${status}（检测服务不可用或被限流，已换下一个检测地址重试）` }); return; }
        const ip = parseEgressIp(body);
        if (!ip) { done({ ok: false, stage: 'detector', reason: `检测服务 ${det.url} 的返回中没有出口 IP` }); return; }
        done({ ok: true, ip, stage: 'ok', reason: '' });
      });
      socket.on('error', onSockError);
      const req = `GET ${targetPath} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n`;
      try { socket.write(req); } catch (e) { onSockError(e); }
    };
    const afterConnect = () => {
      phase = 'connect';
      if (!isHttps) { doHttp(sock); return; }
      phase = 'tls';
      let tlsSock = null;
      try { tlsSock = tls.connect({ socket: sock, servername: host }, () => { sock = tlsSock; doHttp(tlsSock); }); }
      catch (e) { onSockError(e); return; }
      tlsSock.on('error', onSockError);
    };
    if (!proxy) {
      try {
        sock = isHttps ? tls.connect({ host, port, servername: host }, () => { phase = 'http'; doHttp(sock); }) : net.connect(port, host, () => { phase = 'http'; doHttp(sock); });
      } catch (e) { onSockError(e); return; }
      sock.on('error', onSockError);
      return;
    }
    try { sock = net.connect(Number(proxy.port), String(proxy.host)); } catch (e) { onSockError(e); return; }
    sock.on('error', onSockError);
    sock.on('connect', () => {
      phase = 'connect';
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
      let buf = '';
      const onData = (d) => {
        buf += d.toString('latin1');
        if (!buf.includes('\r\n\r\n')) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/\d\.\d 200/.test(buf)) {
          finishTimer();
          done({ ok: false, stage: 'node', reason: `节点拒绝连接 ${host}：代理返回 ${buf.split('\r\n')[0] || '非 200'}（节点可能已失效）` });
          return;
        }
        afterConnect();
      };
      sock.on('data', onData);
    });
  });
}
async function pioneerFetchExitIp(opts) {
  const o = opts || {};
  const proxy = o.proxy || { host: '127.0.0.1', port: 19352 };
  const detectors = Array.isArray(o.detectors) && o.detectors.length ? o.detectors : PIONEER_EGRESS_DETECTORS;
  const timeoutMs = Number(o.timeoutMs) || 10000;
  const probe = o.probeFn || pioneerProbeDetector;
  const attempts = [];
  let lastNode = null;
  let lastDetector = null;
  for (const det of detectors) {
    const r = await probe(det, proxy, timeoutMs);
    if (r.ok) return { ok: true, ip: r.ip, stage: 'ok', reason: '', attempts };
    attempts.push({ url: det.url, stage: r.stage, reason: r.reason });
    if (r.stage === 'proxy') return { ok: false, stage: 'proxy', reason: r.reason, error: r.reason, attempts };
    if (r.stage === 'node' && !lastNode) lastNode = r;
    if (r.stage === 'detector' && !lastDetector) lastDetector = r;
  }
  const worst = lastNode || lastDetector || attempts[attempts.length - 1];
  const reason = worst ? worst.reason : '经隧道查询出口 IP 失败';
  return { ok: false, stage: worst ? worst.stage : 'detector', reason, error: reason, attempts };
}
function pioneerTunnelRunning() { return !!pioneerServer; }
async function pioneerConnect(countryId) {
  let s = pioneerLoad();
  if (!s.token) {
    if (s.username && s.password) {
      const login = await pioneerDoLogin(s.username, s.password);
      if (!login.ok) return { ok: false, error: login.error };
      s = pioneerLoad();
    } else return { ok: false, error: '尚未登录 Pioneer 帐号' };
  }
  const deviceId = pioneerEnsureDeviceId();
  let r = await pioneerCall('/api/connect', 'POST', deviceId, s.token, { type: 1, country_id: Number(countryId), deviceId });
  if (!r.ok && r.tokenProblem && s.username && s.password) {
    const login = await pioneerDoLogin(s.username, s.password);
    if (login.ok) { s = pioneerLoad(); r = await pioneerCall('/api/connect', 'POST', deviceId, s.token, { type: 1, country_id: Number(countryId), deviceId }); }
  }
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data) return { ok: false, error: 'Pioneer 服务器未返回节点数据（协议可能已变更）' };
  const info = pioneerExtractNode(r.data, Number(countryId));
  const regions = Array.isArray(s.regions) ? s.regions : [];
  const selected = regions.find((e) => e.country_id === Number(countryId));
  if (!info.name) info.name = selected ? selected.country_name : '';
  if (!info.country) info.country = selected ? selected.country_name : '';
  const trojan = pioneerExtractTrojan(r.data, info);
  if (!trojan) return { ok: false, error: '该节点不是 Trojan 节点或没有可用的节点凭证，暂不支持连接' };
  if (String(info.protocol || '').toLowerCase() && String(info.protocol).toLowerCase() !== 'trojan') {
    return { ok: false, error: `该节点协议是 ${info.protocol}，工具箱只支持 Trojan 节点` };
  }
  const started = await pioneerStartTunnel(trojan);
  if (!started.ok) return { ok: false, error: started.error };
  // 2026-11-27-3：① 本地端口监听就绪检测；② 内嵌浏览器代理同步接管。
  // 任一步失败都停隧道、复位代理、回滚连接状态，不显示已连接。
  const port = await pioneerCheckLocalPort();
  if (!port.ok) { pioneerStopTunnel(); return { ok: false, stage: 'proxy', reason: port.error, error: `隧道已建立，但${port.error}` }; }
  const applied = await pioneerApplyBrowserProxy((pioneerLoad().proxyMode || 'smart'));
  if (!applied.ok) { pioneerStopTunnel(); return { ok: false, stage: 'proxy', reason: `内嵌浏览器代理同步失败：${applied.error}`, error: `隧道已建立，但内嵌浏览器代理同步失败：${applied.error}` }; }
  const exit = await pioneerFetchExitIp();
  s = pioneerLoad();
  s.selectedCountryId = Number(countryId);
  s.selectedName = info.country || info.name || '';
  s.node = { name: info.name, country: info.country, protocol: 'trojan', host: info.host, port: info.port, sni: info.sni };
  s.nodeRaw = r.data;
  // 2026-11-27-2：验证失败时不再写 connected=true——隧道还在跑
  // （tunnelRunning 保持 true，方便点“检测出口 IP”重试），但不算
  // 已连接，代理分流也不会把流量往没验出来的隧道里送。
  // 2026-11-27-3：验证失败时内嵌浏览器代理也复位回直连，与上条一致。
  s.connected = exit.ok;
  s.tunnelRunning = true;
  s.exitIp = exit.ok ? exit.ip : '';
  s.lastError = exit.ok ? '' : exit.reason;
  pioneerSave(s);
  if (!exit.ok) await pioneerResetBrowserProxy();
  pioneerLog(`已连接 ${s.selectedName || ''} 节点${exit.ok ? `，出口 IP ${exit.ip}` : `，出口 IP 验证失败（${PIONEER_EGRESS_STAGE_TEXT[exit.stage] || exit.stage}）：${exit.reason}`}`);
  if (!exit.ok) return { ok: false, stage: exit.stage, reason: exit.reason, error: `隧道已建立，但出口 IP 验证失败（${PIONEER_EGRESS_STAGE_TEXT[exit.stage] || exit.stage}）：${exit.reason}` };
  return { ok: true, nodeName: info.name, region: s.selectedName, exitIp: exit.ip };
}
function pioneerDisconnect() {
  pioneerStopTunnel();
  const s = pioneerLoad();
  s.connected = false;
  s.tunnelRunning = false;
  s.exitIp = '';
  pioneerSave(s);
  pioneerLog('已断开 Pioneer 连接');
  return { ok: true };
}

/* ---------------- 2026-11-26-6：网页端智能体 ----------------
 * 令牌只存本机 agents.json 的 webToken/webCookie/webUserAgent，
 * 永不返回渲染层。DeepSeek 走官网 chat.deepseek.com 私有
 * Web API（PoW 挑战本地求解）；千问走 chat.qwen.ai；
 * 豆包与 Gemini 只做登录验证，发送尚未接通时明确报错。 */
const WEB_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const DS_WEB_BASE = 'https://chat.deepseek.com';
function unwrapDeepseekToken(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t.startsWith('{')) {
    try { const rec = JSON.parse(t); if (rec && typeof rec.value === 'string' && rec.value) return rec.value.trim(); } catch (e) { /* 非 JSON 走原文 */ }
  }
  return t;
}
function dsWebHeaders(token) {
  return {
    Accept: '*/*',
    Authorization: `Bearer ${token}`,
    Origin: DS_WEB_BASE,
    Referer: `${DS_WEB_BASE}/`,
    'User-Agent': WEB_UA,
    'x-client-bundle-id': 'com.deepseek.chat',
    'x-client-platform': 'web',
    'x-client-version': '2.4.0',
    'x-client-locale': 'zh_CN',
  };
}
function dsFindField(value, keys, depth) {
  if (depth > 4 || typeof value !== 'object' || value === null) return '';
  if (Array.isArray(value)) { for (const item of value) { const hit = dsFindField(item, keys, depth + 1); if (hit) return hit; } return ''; }
  for (const k of keys) { const v = value[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
  for (const v of Object.values(value)) { const hit = dsFindField(v, keys, depth + 1); if (hit) return hit; }
  return '';
}
function dsBizData(root) {
  if (!root) return null;
  const data = (root.data && typeof root.data === 'object') ? root.data : null;
  const biz = (data && data.biz_data && typeof data.biz_data === 'object') ? data.biz_data : ((root.biz_data && typeof root.biz_data === 'object') ? root.biz_data : null);
  return biz || data;
}
function dsErrorMessage(root, fallback) {
  if (!root) return fallback;
  const msg = String(root.msg || root.message || '');
  const code = typeof root.code === 'number' ? root.code : null;
  if (msg) return code !== null && code !== 0 ? `${msg}（业务码 ${code}）` : msg;
  if (code !== null && code !== 0) return `DeepSeek 返回业务码 ${code}`;
  return fallback;
}
async function dsCallJson(path, accessToken, body, extraHeaders) {
  const r = await fetchText(`${DS_WEB_BASE}${path}`, {
    method: 'POST', timeoutMs: 30000,
    headers: { ...dsWebHeaders(accessToken), 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok || !r.text) {
    const snippet = (r.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { ok: false, error: `DeepSeek ${path} 返回 HTTP ${r.status || ''}${snippet ? `：${snippet}` : ''}`, kind: r.status === 401 ? 'expired' : r.status === 403 ? 'blocked' : 'error' };
  }
  let root = null;
  try { root = JSON.parse(r.text); } catch (e) { root = null; }
  if (!root || typeof root !== 'object') return { ok: false, error: `DeepSeek ${path} 返回了无法解析的响应`, kind: 'error' };
  const code = typeof root.code === 'number' ? root.code : 0;
  if (code !== 0) return { ok: false, error: dsErrorMessage(root, `DeepSeek ${path} 调用失败`), kind: code === 40003 || code === 40001 ? 'expired' : 'error' };
  return { ok: true, root };
}
async function dsValidateToken(rawToken) {
  const token = unwrapDeepseekToken(rawToken);
  if (!token) return { ok: false, error: '令牌为空', kind: 'expired' };
  const r = await fetchText(`${DS_WEB_BASE}/api/v0/users/current`, { method: 'GET', timeoutMs: 30000, headers: dsWebHeaders(token) });
  if (!r.ok) {
    const snippet = (r.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { ok: false, error: `DeepSeek 验证返回 HTTP ${r.status || ''}${snippet ? `：${snippet}` : ''}`, kind: r.status === 401 ? 'expired' : r.status === 403 ? 'blocked' : 'error' };
  }
  let root = null;
  try { root = JSON.parse(r.text); } catch (e) { root = null; }
  if (!root || typeof root !== 'object') return { ok: false, error: 'DeepSeek 验证返回了无法解析的响应', kind: 'error' };
  const code = typeof root.code === 'number' ? root.code : 0;
  if (code !== 0) return { ok: false, error: dsErrorMessage(root, 'DeepSeek 验证失败'), kind: code === 40003 || code === 40001 ? 'expired' : 'error' };
  const biz = dsBizData(root) || root;
  const accessToken = dsFindField(biz, ['access_token', 'accessToken']) || token;
  const account = dsFindField(biz, ['name', 'nickname', 'email', 'user_name', 'username']) || '';
  return { ok: true, accessToken, account };
}
/* DeepSeekHashV1 PoW 求解（Keccak-f[1600]，与空间同款实现） */
const DS_RC32 = new Uint32Array([
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b, 0x00000000, 0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000808a, 0x00000000, 0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000, 0x0000808b, 0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000, 0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x00008001, 0x00000000, 0x80008008, 0x80000000,
]);
const DS_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const DS_RATE = 136;
function dsKeccakF1600(s) {
  const C = new Uint32Array(10);
  const R = new Uint32Array(50);
  for (let round = 1; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      const i = 2 * x;
      C[i] = (s[i] || 0) ^ (s[i + 10] || 0) ^ (s[i + 20] || 0) ^ (s[i + 30] || 0) ^ (s[i + 40] || 0);
      C[i + 1] = (s[i + 1] || 0) ^ (s[i + 11] || 0) ^ (s[i + 21] || 0) ^ (s[i + 31] || 0) ^ (s[i + 41] || 0);
    }
    for (let x = 0; x < 5; x++) {
      const nIdx = 2 * ((x + 1) % 5);
      const nLo = C[nIdx] || 0;
      const nHi = C[nIdx + 1] || 0;
      const rLo = (nLo << 1) | (nHi >>> 31);
      const rHi = (nHi << 1) | (nLo >>> 31);
      const dLo = (C[2 * ((x + 4) % 5)] || 0) ^ rLo;
      const dHi = (C[2 * ((x + 4) % 5) + 1] || 0) ^ rHi;
      for (let y = 0; y < 5; y++) {
        const idx = 2 * (x + 5 * y);
        s[idx] = (s[idx] || 0) ^ dLo;
        s[idx + 1] = (s[idx + 1] || 0) ^ dHi;
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const source = x + 5 * y;
        const destination = y + 5 * ((2 * x + 3 * y) % 5);
        const lo = s[2 * source] || 0;
        const hi = s[2 * source + 1] || 0;
        const n = DS_ROT[source] || 0;
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
        const aLo = R[2 * ((x + 1) % 5 + 5 * y)] || 0;
        const aHi = R[2 * ((x + 1) % 5 + 5 * y) + 1] || 0;
        const bLo = R[2 * ((x + 2) % 5 + 5 * y)] || 0;
        const bHi = R[2 * ((x + 2) % 5 + 5 * y) + 1] || 0;
        s[index] = (R[index] || 0) ^ (~aLo & bLo);
        s[index + 1] = (R[index + 1] || 0) ^ (~aHi & bHi);
      }
    }
    s[0] = (s[0] || 0) ^ (DS_RC32[2 * round] || 0);
    s[1] = (s[1] || 0) ^ (DS_RC32[2 * round + 1] || 0);
  }
}
function dsXorBytes(s, block, offset, len) {
  for (let i = 0; i < len; i++) {
    const b = block[offset + i] || 0;
    const lane = i >> 3;
    const pos = i & 7;
    if (pos < 4) s[2 * lane] = (s[2 * lane] || 0) ^ (b << (8 * pos));
    else s[2 * lane + 1] = (s[2 * lane + 1] || 0) ^ (b << (8 * (pos - 4)));
  }
}
function dsDigest(message) {
  const s = new Uint32Array(50);
  let offset = 0;
  while (message.length - offset >= DS_RATE) { dsXorBytes(s, message, offset, DS_RATE); dsKeccakF1600(s); offset += DS_RATE; }
  const rest = message.length - offset;
  const block = new Uint8Array(DS_RATE);
  block.set(message.subarray(offset));
  block[rest] = (block[rest] || 0) ^ 0x06;
  block[DS_RATE - 1] = (block[DS_RATE - 1] || 0) ^ 0x80;
  dsXorBytes(s, block, 0, DS_RATE);
  dsKeccakF1600(s);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lane = i >> 3;
    const pos = i & 7;
    const word = pos < 4 ? (s[2 * lane] || 0) : (s[2 * lane + 1] || 0);
    out[i] = (word >>> (8 * (pos & 3))) & 0xff;
  }
  return out;
}
function dsSolvePow(challenge) {
  if (challenge.algorithm !== 'DeepSeekHashV1') return null;
  if (!challenge.difficulty || challenge.difficulty <= 0) return null;
  const wantHex = String(challenge.challenge || '').trim().toLowerCase();
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
function dsParseSse(text) {
  let content = '';
  let messageId = 0;
  let currentThinking = false;
  const fragmentThinking = new Map();
  const handleFragments = (value) => {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
    items.forEach((raw, idx) => {
      const frag = (raw && typeof raw === 'object') ? raw : null;
      if (!frag) return;
      const typeName = typeof frag.type === 'string' ? frag.type.toUpperCase() : '';
      const fragId = typeof frag.id === 'number' ? frag.id : idx;
      if (typeName === 'THINK') { fragmentThinking.set(fragId, true); currentThinking = true; return; }
      if (typeName === 'RESPONSE' || typeName === 'ANSWER') { fragmentThinking.set(fragId, false); currentThinking = false; }
      const fragContent = typeof frag.content === 'string' ? frag.content : '';
      if (fragContent && fragmentThinking.get(fragId) !== true && typeName !== 'THINK') content += fragContent;
    });
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let data = null;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    if (!data || typeof data !== 'object') continue;
    const v = data.v;
    const p = typeof data.p === 'string' ? data.p : '';
    if (typeof data.message_id === 'number' && data.message_id > 0) messageId = data.message_id;
    if (p === 'response/message_id' && typeof v === 'number' && v > 0) messageId = v;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const resp = v.response && typeof v.response === 'object' ? v.response : null;
      if (resp) {
        if (typeof resp.message_id === 'number' && resp.message_id > 0) messageId = resp.message_id;
        handleFragments(resp.fragments);
        continue;
      }
    }
    if (p === 'response/fragments') { handleFragments(v); continue; }
    if (typeof v === 'string') {
      if (p === 'response/status' || p === 'response/search_status') continue;
      const fragMatch = /^response\/fragments\/(\d+)\/content$/.exec(p);
      if (fragMatch) {
        const fragId = Number(fragMatch[1]);
        if (fragmentThinking.get(fragId) === true) continue;
        content += v;
        continue;
      }
      if (p && p !== 'response/fragments/-1/content' && !p.endsWith('/content')) continue;
      if (!currentThinking) content += v;
    }
  }
  return { text: content.trim(), messageId };
}
async function dsPowResponse(accessToken, targetPath) {
  const challengeRes = await dsCallJson('/api/v0/chat/create_pow_challenge', accessToken, { target_path: targetPath });
  if (!challengeRes.ok) return { ok: false, error: `DeepSeek 网页版获取 PoW 挑战失败：${challengeRes.error}` };
  const biz = dsBizData(challengeRes.root);
  const ch = (biz && biz.challenge && typeof biz.challenge === 'object') ? biz.challenge : {};
  const challenge = {
    algorithm: String(ch.algorithm || ''), challenge: String(ch.challenge || ''),
    salt: String(ch.salt || ''), signature: String(ch.signature || ''),
    difficulty: typeof ch.difficulty === 'number' ? ch.difficulty : 0,
    expireAt: typeof ch.expire_at === 'number' ? ch.expire_at : 0,
    targetPath: String(ch.target_path || '') || targetPath,
  };
  if (!challenge.challenge) return { ok: false, error: 'DeepSeek 网页版未返回 PoW 挑战（接口可能已变更）' };
  const answer = dsSolvePow(challenge);
  if (answer === null) return { ok: false, error: 'DeepSeek 网页版 PoW 挑战求解失败（难度过高或算法已变更）' };
  const pow = Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm, challenge: challenge.challenge, salt: challenge.salt,
    answer, signature: challenge.signature, target_path: challenge.targetPath,
  }), 'utf8').toString('base64');
  return { ok: true, pow };
}
async function dsWebSend(agent, prompt) {
  const v = await dsValidateToken(agent.webToken || '');
  if (!v.ok) return { ok: false, error: `DeepSeek 网页版验证失败：${v.error}` };
  const accessToken = v.accessToken;
  const sessionRes = await dsCallJson('/api/v0/chat_session/create', accessToken, {});
  if (!sessionRes.ok) return { ok: false, error: `DeepSeek 网页版创建会话失败：${sessionRes.error}` };
  const biz = dsBizData(sessionRes.root);
  const sessionObj = (biz && biz.chat_session && typeof biz.chat_session === 'object') ? biz.chat_session : {};
  const sessionId = String(sessionObj.id || '');
  if (!sessionId) return { ok: false, error: 'DeepSeek 网页版未返回会话编号（接口可能已变更）' };
  const powRes = await dsPowResponse(accessToken, '/api/v0/chat/completion');
  if (!powRes.ok) return { ok: false, error: powRes.error };
  const r = await fetchText(`${DS_WEB_BASE}/api/v0/chat/completion`, {
    method: 'POST', timeoutMs: 90000,
    headers: {
      ...dsWebHeaders(accessToken), 'Content-Type': 'application/json',
      'x-ds-pow-response': powRes.pow,
      'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
    },
    body: JSON.stringify({
      chat_session_id: sessionId, parent_message_id: null, model_type: 'default',
      prompt, ref_file_ids: [], thinking_enabled: false, search_enabled: false,
      action: null, preempt: false,
    }),
  });
  if (!r.ok) {
    const snippet = (r.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { ok: false, error: `DeepSeek 网页版回复请求返回 HTTP ${r.status || ''}${snippet ? `：${snippet}` : ''}` };
  }
  if (!r.text.includes('data:')) {
    let root = null;
    try { root = JSON.parse(r.text); } catch (e) { root = null; }
    const code = root && typeof root.code === 'number' ? root.code : 0;
    if (root && code !== 0) return { ok: false, error: `DeepSeek 网页版回复失败：${dsErrorMessage(root, 'DeepSeek 网页版回复失败')}` };
    return { ok: false, error: 'DeepSeek 网页版返回了无法解析的回复（接口可能已变更）' };
  }
  const parsed = dsParseSse(r.text);
  if (!parsed.text) return { ok: false, error: 'DeepSeek 网页版返回了空回复' };
  return { ok: true, text: parsed.text };
}
/* ---- 千问 ---- */
function cookiePairValue(cookie, name) {
  for (const part of String(cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}
function normalizeQwenToken(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  if (t.startsWith('{')) {
    try {
      const rec = JSON.parse(t);
      const v = (rec && (rec.token || rec.access_token || rec.value)) || '';
      if (v) return String(v).trim();
    } catch (e) { /* 非 JSON 走原文 */ }
  }
  t = t.replace(/^Bearer\s+/i, '').trim();
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  return t;
}
function parseQwenPaste(raw) {
  const out = { token: '', cookie: '', ua: '' };
  const t = String(raw || '').trim();
  if (!t) return out;
  if (t.startsWith('{')) {
    try {
      const rec = JSON.parse(t);
      if (rec) {
        out.token = String(rec.token || rec.access_token || rec.value || '').trim();
        out.cookie = String(rec.cookie || rec.cookies || '').trim();
        out.ua = String(rec.ua || rec.userAgent || rec.user_agent || '').trim();
        if (out.token || out.cookie || out.ua) {
          const fromCookie = out.cookie ? cookiePairValue(out.cookie, 'token') : '';
          if (fromCookie && fromCookie !== out.token) out.token = fromCookie;
          out.token = normalizeQwenToken(out.token);
          return out;
        }
      }
    } catch (e) { /* 走裸形态 */ }
  }
  if (t.includes('=') && t.includes(';')) { out.cookie = t; out.token = cookiePairValue(t, 'token'); return out; }
  out.token = normalizeQwenToken(t);
  return out;
}
let qwenBaxiaCache = null;
async function qwenBaxiaHeaders(ua) {
  if (qwenBaxiaCache && qwenBaxiaCache.ua === ua && Date.now() - qwenBaxiaCache.at < 4 * 60 * 1000) return qwenBaxiaCache.headers;
  let umid = '';
  try {
    const res = await fetchText('https://sg-wum.alibaba.com/w/wu.json', { headers: { 'User-Agent': ua }, timeoutMs: 10000 });
    umid = /wu\('([^']+)'\)/.exec(res.text || '')?.[1] || /__fycb\('([^']+)'\)/.exec(res.text || '')?.[1] || '';
  } catch (e) { umid = ''; }
  if (!umid) umid = `T2gA${crypto.randomBytes(20).toString('hex').slice(0, 40)}`;
  const headers = { 'bx-v': '2.5.21', 'bx-umidtoken': umid, 'bx-ua': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
  qwenBaxiaCache = { ua, headers, at: Date.now() };
  return headers;
}
async function qwenHeaders(agent) {
  const token = normalizeQwenToken(agent.webToken || '');
  const ua = (agent.webUserAgent && String(agent.webUserAgent).startsWith('Mozilla/')) ? agent.webUserAgent : WEB_UA;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': ua,
    Origin: 'https://chat.qwen.ai',
    Referer: 'https://chat.qwen.ai/',
    source: 'web',
    ...(agent.webCookie ? { Cookie: agent.webCookie } : {}),
    ...(await qwenBaxiaHeaders(ua)),
  };
}
function qwenApiFailure(text) {
  if ((text || '').includes('aliyun_waf')) return { ok: false, error: '千问网页请求被阿里云 WAF 风控拦截（返回的是验证页，不是接口数据），这不是令牌失效；请稍后再试', kind: 'blocked' };
  let root = null;
  try { root = JSON.parse(text || ''); } catch (e) { root = null; }
  if (root && typeof root.error === 'string' && root.error) {
    if (/expired/i.test(root.error)) return { ok: false, error: `千问网页端拒绝了该令牌：${root.error}（访问令牌有效期很短，过期后重新导出整段凭证再粘贴）`, kind: 'expired' };
    return { ok: false, error: `千问网页端返回错误：${root.error}`, kind: 'error' };
  }
  if (root && root.success === false) {
    const data = (root.data && typeof root.data === 'object') ? root.data : {};
    const code = String(data.code || '');
    const details = String(data.details || root.message || code);
    if (code === 'unauthorized') return { ok: false, error: `千问网页端拒绝了该令牌${details ? `：${details}` : ''}`, kind: 'expired' };
    return { ok: false, error: `千问网页端返回错误${details ? `：${details}` : ''}`, kind: 'error' };
  }
  return null;
}
async function qwenValidateToken(agent) {
  const token = normalizeQwenToken(agent.webToken || '');
  if (!token) return { ok: false, error: '令牌为空', kind: 'expired' };
  if (/refresh_token/.test(token) || (token.includes('=') && token.includes(';'))) {
    return { ok: false, error: '粘贴的是 chat.qwen.ai 的浏览器 Cookie，不是访问令牌：请在该站控制台运行导出命令，把整段凭证 JSON 粘贴进来', kind: 'expired' };
  }
  const headers = await qwenHeaders(agent);
  const r = await fetchText('https://chat.qwen.ai/api/chats/?page=1&page_size=1', { method: 'GET', timeoutMs: 30000, headers });
  const failure = qwenApiFailure(r.text || '');
  if (failure) return failure;
  if (!r.ok) return { ok: false, error: `千问验证返回 HTTP ${r.status || ''}`, kind: 'error' };
  return { ok: true, accessToken: token, account: '' };
}
async function qwenWebSend(agent, prompt) {
  const v = await qwenValidateToken(agent);
  if (!v.ok) return { ok: false, error: `千问网页版验证失败：${v.error}` };
  const headers = await qwenHeaders(agent);
  const created = await fetchText('https://chat.qwen.ai/api/chats/new', {
    method: 'POST', timeoutMs: 30000, headers,
    body: JSON.stringify({ title: 'New Chat', models: ['qwen3-max'], chat_mode: 'normal', chat_type: 't2t', timestamp: Date.now() }),
  });
  const createFailure = qwenApiFailure(created.text || '');
  if (createFailure) return { ok: false, error: createFailure.error };
  if (!created.ok) return { ok: false, error: `千问网页版创建会话失败：HTTP ${created.status || ''}` };
  let chatId = '';
  try { const rec = JSON.parse(created.text); chatId = String((rec.data && rec.data.id) || ''); } catch (e) { chatId = ''; }
  if (!chatId) return { ok: false, error: '千问网页端未返回会话编号（接口可能已变更）' };
  const cleanup = async () => { try { await fetchText(`https://chat.qwen.ai/api/chats/${chatId}`, { method: 'DELETE', timeoutMs: 10000, headers }); } catch (e) { /* 清理尽力而为 */ } };
  const res = await fetchText(`https://chat.qwen.ai/api/chat/completions?chat_id=${chatId}`, {
    method: 'POST', timeoutMs: 90000,
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify({
      stream: true, incremental_output: true, chat_type: 't2t',
      messages: [{
        fid: crypto.randomUUID(), parentId: null, childrenIds: [], role: 'user', content: prompt,
        user_action: 'chat', files: [], timestamp: Math.floor(Date.now() / 1000), models: ['qwen3-max'],
        chat_type: 't2t',
        feature_config: { thinking_enabled: false, output_schema: 'phase', research_mode: 'normal', auto_search: false, thinking_mode: 'Fast', thinking_budget: 8192, auto_thinking: false },
        extra: {}, sub_chat_type: 't2t', parent_id: null,
      }],
      chat_id: chatId, chat_mode: 'normal', model: 'qwen3-max', parent_id: null,
    }),
  });
  const sendFailure = qwenApiFailure(res.text || '');
  if (sendFailure) { await cleanup(); return { ok: false, error: sendFailure.error }; }
  if (!res.ok) { await cleanup(); return { ok: false, error: `千问网页版回复失败：HTTP ${res.status || ''}` }; }
  let text = '';
  for (const line of (res.text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let data = null;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const choices = Array.isArray(data && data.choices) ? data.choices : [];
    const delta = (choices[0] && choices[0].delta && typeof choices[0].delta === 'object') ? choices[0].delta : {};
    if (typeof delta.content === 'string' && (delta.phase === 'answer' || delta.phase === undefined)) text += delta.content;
  }
  await cleanup();
  if (!text.trim()) return { ok: false, error: '千问网页版返回了空回复' };
  return { ok: true, text: text.trim() };
}
/* ---- 豆包：验证（登录页 + Cookie 校验） ---- */
const DOUBAO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
function doubaoHeaders(token) {
  return {
    Cookie: String(token || '').trim(),
    'User-Agent': DOUBAO_UA,
    Origin: 'https://www.doubao.com',
    Referer: 'https://www.doubao.com/chat/',
    'agw-js-conv': 'str',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}
async function doubaoValidateToken(token) {
  const cookie = String(token || '').trim();
  if (!cookie) return { ok: false, error: '令牌为空', kind: 'expired' };
  const r = await fetchText('https://www.doubao.com/chat/', { method: 'GET', timeoutMs: 30000, headers: doubaoHeaders(cookie) });
  if (!r.ok) return { ok: false, error: `豆包页面返回 HTTP ${r.status || ''}，没能验证登录状态`, kind: 'error' };
  if ((r.finalUrl || '').includes('passport') || (r.text || '').includes('passport/login')) {
    return { ok: false, error: '豆包网页未处于登录状态（Cookie 已失效），请重新复制整段 Cookie 粘贴', kind: 'expired' };
  }
  if (!(r.text || '').includes('user_unique_id') && !(r.text || '').includes('user_name')) {
    return { ok: false, error: '豆包页面里没有找到登录信息（页面结构可能已变更）', kind: 'error' };
  }
  const nick = /"nickname"\s*:\s*"([^"]+)"/.exec(r.text || '')?.[1] || /"user_name"\s*:\s*"([^"]+)"/.exec(r.text || '')?.[1] || '';
  return { ok: true, accessToken: cookie, account: nick };
}
/* ---- Gemini：验证（/app 页取 SNlM0e 会话令牌） ---- */
function geminiCookieHeader(token) {
  const t = String(token || '').trim();
  if (t.includes('__Secure-1PSID')) return t;
  if (t.includes('|')) {
    const [psid, psidts] = t.split('|').map((x) => x.trim());
    return `__Secure-1PSID=${psid}; __Secure-1PSIDTS=${psidts || ''}`;
  }
  return `__Secure-1PSID=${t}`;
}
async function geminiValidateToken(token) {
  const header = geminiCookieHeader(token);
  const r = await fetchText('https://gemini.google.com/app', { method: 'GET', timeoutMs: 30000, headers: { Cookie: header, 'User-Agent': WEB_UA } });
  if (!r.ok) return { ok: false, error: `Gemini 页面返回 HTTP ${r.status || ''}`, kind: 'error' };
  if ((r.finalUrl || '').includes('accounts.google.com')) {
    return { ok: false, error: 'Gemini 网页未处于登录状态（Cookie 已失效或不完整，需要 __Secure-1PSID 和 __Secure-1PSIDTS 两个值）', kind: 'expired' };
  }
  const grab = (key) => {
    const m = new RegExp(`"${key}"\\s*,\\s*null\\s*,\\s*"([^"]+)"`).exec(r.text || '') || new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(r.text || '');
    return m ? m[1] : '';
  };
  const at = grab('SNlM0e') || grab('thykhd');
  if (!at) return { ok: false, error: 'Gemini 网页未返回会话令牌（页面结构可能已变更）', kind: 'error' };
  const account = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(r.text || '')?.[0] || '';
  let refreshed = String(token || '').trim();
  for (const c of (r.setCookies || [])) {
    const m = /^__Secure-1PSIDTS=([^;]+)/.exec(String(c));
    if (m) {
      const psid = /__Secure-1PSID=([^;]+)/.exec(header)?.[1] || '';
      refreshed = `__Secure-1PSID=${psid}; __Secure-1PSIDTS=${m[1]}`;
    }
  }
  return { ok: true, accessToken: refreshed, account };
}
async function webVerifyAgent(agent) {
  const site = String(agent.webSite || agent.provider || '').toLowerCase();
  const token = String(agent.webToken || '');
  if (!token) return { ok: false, error: '请先粘贴令牌' };
  let v;
  if (site === 'deepseek') v = await dsValidateToken(token);
  else if (site === 'qwen') v = await qwenValidateToken(agent);
  else if (site === 'doubao') v = await doubaoValidateToken(token);
  else if (site === 'gemini') v = await geminiValidateToken(token);
  else return { ok: false, error: '该站点暂不支持网页令牌验证' };
  if (!v.ok) {
    const list = getAgents();
    const it = list.find((a) => a.id === agent.id);
    if (it) { it.webStatus = v.kind === 'error' ? 'error' : v.kind; writeJsonFile('agents.json', list); }
    return { ok: false, error: v.error, webStatus: v.kind };
  }
  const list = getAgents();
  const it = list.find((a) => a.id === agent.id);
  if (it) {
    it.webStatus = 'logged_in';
    it.webLogin = v.account || it.webLogin || '';
    if (site === 'gemini' && v.accessToken && v.accessToken !== token) it.webToken = v.accessToken;
    writeJsonFile('agents.json', list);
  }
  return { ok: true, login: v.account || '', webStatus: 'logged_in' };
}
async function webChatSend(agent, prompt) {
  const site = String(agent.webSite || agent.provider || '').toLowerCase();
  if (!String(agent.webToken || '').trim()) return { ok: false, error: '该智能体尚未登录网页版（未粘贴令牌）' };
  if (site === 'deepseek') return dsWebSend(agent, prompt);
  if (site === 'qwen') return qwenWebSend(agent, prompt);
  if (site === 'doubao') return { ok: false, error: '豆包网页端发送尚未接通：豆包的发送要拼页面签名参数（device_id / web_id / msToken / 版本号），主进程里尚未完成对接' };
  if (site === 'gemini') return { ok: false, error: 'Gemini 网页端发送尚未接通：Gemini 的发送走 StreamGenerate RPC（需从 /app 页取 bl / sid / at 参数），主进程里尚未完成对接' };
  return { ok: false, error: '该站点网页端发送尚未接通' };
}
function buildWebPrompt(agent, history, newContent) {
  const parts = [];
  if (agent.systemPrompt) parts.push(agent.systemPrompt);
  for (const m of (history || [])) {
    if (m.role === 'user') parts.push(`用户：${m.content}`);
    else if (m.role === 'assistant') parts.push(`助手：${m.content}`);
  }
  if (newContent != null) parts.push(`用户：${newContent}`);
  return parts.join('\n\n');
}

/* ---------------- 2026-11-26-6：监控提醒 / 提示词 / 图片改图 ---------------- */
function getMonitors() { const v = readJsonFile('monitors.json', []); return Array.isArray(v) ? v : []; }
function saveMonitors(list) { writeJsonFile('monitors.json', list); }
async function runMonitorCheck(m) {
  const now = Date.now();
  let value = '';
  if (m.kind === 'webpage') {
    const r = await fetchText(String(m.target || ''), { timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
    if (!r.ok || !r.text) return { ok: false, error: r.error || `抓取失败（HTTP ${r.status || ''}）` };
    value = crypto.createHash('sha256').update(r.text).digest('hex').slice(0, 16);
  } else if (m.kind === 'app-version') {
    const target = String(m.target || '').trim();
    if (target.includes('/')) {
      const [owner, repo] = target.split('/').map((x) => x.trim());
      if (!owner || !repo) return { ok: false, error: 'GitHub 目标填 owner/repo，例如 VideoLAN/vlc' };
      const r = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`, getConfig().githubToken || '');
      if (!r.ok) return { ok: false, error: r.error || '取最新版本失败' };
      value = String((r.data && r.data.tag_name) || '');
      if (!value) return { ok: false, error: '该仓库没有发布过版本' };
    } else {
      if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
      const r = await runWinget(['search', '--id', target, '--accept-source-agreements'], 60000);
      const rows = parseWingetTable(r.out);
      value = rows[0] ? String(rows[0].version || '') : '';
      if (!value) return { ok: false, error: '未在 winget 找到该软件' };
    }
  } else {
    return { ok: false, error: '监控类型只能是 webpage / app-version' };
  }
  const changed = !!(m.lastResult && m.lastResult !== value);
  const list = getMonitors();
  const it = list.find((x) => x.id === m.id);
  if (it) {
    it.lastCheck = now;
    it.lastResult = value;
    if (changed) it.lastChange = now;
    saveMonitors(list);
  }
  return { ok: true, result: { changed, value, lastResult: m.lastResult || '', at: now } };
}
async function checkMonitors() {
  const now = Date.now();
  const cfg = getConfig();
  for (const m of getMonitors()) {
    if (m.enabled === false) continue;
    const intervalMs = Math.max(1, Number(m.intervalMin || 60)) * 60 * 1000;
    if (m.lastCheck && now - Number(m.lastCheck) < intervalMs) continue;
    const r = await runMonitorCheck(m);
    if (r.ok && r.result.changed && cfg.notificationsEnabled !== false) {
      notify('监控提醒', `「${m.name || m.target}」有变化：${m.kind === 'webpage' ? '页面内容变了' : `最新版本变为 ${r.result.value}`}`);
    }
  }
}
/* GitHub 已安装记录（供 github-installed-updates 比对） */
function getGithubInstalled() { const v = readJsonFile('github-installed.json', []); return Array.isArray(v) ? v : []; }
function recordGithubInstalled(owner, repo, tag, assetName) {
  if (!owner || !repo) return;
  const list = getGithubInstalled().filter((x) => !(String(x.owner).toLowerCase() === String(owner).toLowerCase() && String(x.repo).toLowerCase() === String(repo).toLowerCase()));
  list.unshift({ owner, repo, tag: String(tag || ''), assetName: String(assetName || ''), installedAt: Date.now() });
  writeJsonFile('github-installed.json', list.slice(0, 200));
}
function parseGithubAssetUrl(url, repoHint, tagHint) {
  let owner = '', repo = '', tag = String(tagHint || '');
  const m = /github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\//i.exec(String(url || ''));
  if (m) { owner = m[1]; repo = m[2]; tag = tag || m[3]; }
  if (repoHint && String(repoHint).includes('/')) { const parts = String(repoHint).split('/'); owner = parts[0]; repo = parts[1]; }
  return { owner, repo, tag };
}
async function githubInstalledUpdates() {
  const list = getGithubInstalled();
  const token = getConfig().githubToken || '';
  const rows = [];
  for (const it of list) {
    const r = await githubApi(`/repos/${encodeURIComponent(it.owner)}/${encodeURIComponent(it.repo)}/releases/latest`, token);
    if (!r.ok) { rows.push({ owner: it.owner, repo: it.repo, name: `${it.owner}/${it.repo}`, currentTag: it.tag || '', latestTag: '', hasUpdate: false, html_url: `https://github.com/${it.owner}/${it.repo}`, assetName: it.assetName || '', error: r.error }); continue; }
    const latestTag = String((r.data && r.data.tag_name) || '');
    rows.push({
      owner: it.owner, repo: it.repo, name: `${it.owner}/${it.repo}`,
      currentTag: it.tag || '', latestTag, hasUpdate: !!(latestTag && it.tag && latestTag !== it.tag),
      html_url: (r.data && r.data.html_url) || `https://github.com/${it.owner}/${it.repo}`,
      assetName: it.assetName || '',
    });
  }
  return { ok: true, rows };
}
/* 图片改图：OpenAI 兼容 /images/edits，multipart 手写 */
function multipartPost(urlStr, fields, fileField, filePath, fileName, headers, timeoutMs) {
  return new Promise((resolve) => {
    const boundary = `----ToolboxForm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const parts = [];
    for (const [k, v] of Object.entries(fields || {})) {
      if (v == null || v === '') continue;
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
    }
    let fileBuf = null;
    try { fileBuf = fs.readFileSync(filePath); } catch (e) { resolve({ ok: false, error: `读不到图片文件：${e.message || String(e)}` }); return; }
    const ext = String(fileName || '').toLowerCase().endsWith('.png') ? 'image/png' : (String(fileName || '').toLowerCase().endsWith('.jpg') || String(fileName || '').toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${ext}\r\n\r\n`, 'utf8'));
    parts.push(fileBuf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(parts);
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const px = effectiveProxy(u.hostname);
    const doReq = (socket) => {
      const req = (isHttps ? https : http).request({
        method: 'POST', path: u.pathname + u.search,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, ...headers },
        ...(socket ? { socket, servername: u.hostname } : { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80) }),
      }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d.toString(); });
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(text); } catch (e) { /* 非 JSON */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode, data });
          else resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}：${(data && (data.error?.message || data.message)) || text.slice(0, 200)}` });
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
      req.setTimeout(timeoutMs || 120000, () => { req.destroy(new Error('请求超时')); });
      req.end(body);
    };
    if (!px) { doReq(null); return; }
    const sock = net.connect(px.port, px.host);
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) { /* 已关 */ } resolve({ ok: false, error: '代理连接超时' }); }, 20000);
    sock.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `代理连接失败：${e.message || String(e)}` }); });
    sock.on('connect', () => {
      sock.write(`CONNECT ${u.hostname}:${u.port || (isHttps ? 443 : 80)} HTTP/1.1\r\nHost: ${u.hostname}:${u.port || (isHttps ? 443 : 80)}\r\n\r\n`);
      let buf = '';
      const onData = (d) => {
        buf += d.toString();
        if (!buf.includes('\r\n\r\n')) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/\d\.\d 200/.test(buf)) { clearTimeout(timer); resolve({ ok: false, error: `代理拒绝连接：${buf.split('\r\n')[0]}` }); return; }
        clearTimeout(timer);
        if (isHttps) {
          const tlsSock = tls.connect({ socket: sock, servername: u.hostname }, () => doReq(tlsSock));
          tlsSock.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }));
        } else { doReq(sock); }
      };
      sock.on('data', onData);
    });
  });
}
async function imageEdit({ file, prompt, agentId }) {
  const agent = getAgents().find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '先选择智能体' };
  if (agent.connectionType === 'web') return { ok: false, error: '改图只支持 API 智能体：网页端智能体没有图片编辑接口' };
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  const src = String(file || '');
  if (!src || !fs.existsSync(src)) return { ok: false, error: '图片文件不存在' };
  const base = agentBase(agent);
  const r = await multipartPost(`${base}/images/edits`, { prompt: String(prompt || ''), model: agent.model || 'gpt-image-1', size: '1024x1024', n: '1' }, 'image', src, path.basename(src), { Authorization: `Bearer ${agent.apiKey}` }, 180000);
  if (!r.ok) return { ok: false, error: r.error || '改图请求失败' };
  const item = r.data && r.data.data && r.data.data[0];
  if (!item) return { ok: false, error: '接口未返回图片' };
  fs.mkdirSync(imagesDir(), { recursive: true });
  const out = path.join(imagesDir(), `edit-${Date.now()}.png`);
  try {
    if (item.b64_json) { fs.writeFileSync(out, Buffer.from(item.b64_json, 'base64')); return { ok: true, file: out }; }
    if (item.url) { await downloadFile(item.url, out); return { ok: true, file: out }; }
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
  return { ok: false, error: '接口未返回图片' };
}

/* ---- 2026-11-26-7：应用官方图标（main.js 一侧） ----
 * 渲染层 iconTile(name) 现在用首字色块（renderer.js 约 302 行，
 * 不改渲染层）。这里只提供主进程能力，渲染层接线由协调人随后做：
 *  - 已安装应用：app.getFileIcon 取 exe 真图标（Windows 才有），
 *    缓存到 data/app-icons/，失败返回 ok:false、渲染层继续用占位。
 *  - 发现页：OFFICIAL_APP_ICONS 维护常见应用的官方图标地址
 *    （目前是各应用官网 favicon.ico：官方来源、稳定，但只有
 *    16/32px，瓦片上只宜小图显示；高清 logo 需各官网另找，
 *    沙盒无外网，本次未逐条下载验证）。不在表里、又不是 GitHub
 *    仓库的，发现页取不到官方图标，返回 ok:false 用占位。
 *    GitHub 行用仓库属主头像 https://github.com/<owner>.png。
 *  图标一律先下载到本地缓存再返回 data URL，不让渲染层直接
 *  联网；下载失败、不是图片、超过 2MB 都按取不到处理。 */
const OFFICIAL_APP_ICONS = {
  'google.chrome': 'https://www.google.com/favicon.ico', 'google chrome': 'https://www.google.com/favicon.ico', chrome: 'https://www.google.com/favicon.ico',
  'mozilla.firefox': 'https://www.mozilla.org/favicon.ico', firefox: 'https://www.mozilla.org/favicon.ico',
  'microsoft.edge': 'https://www.microsoft.com/favicon.ico', 'microsoft edge': 'https://www.microsoft.com/favicon.ico', edge: 'https://www.microsoft.com/favicon.ico',
  'brave.brave': 'https://brave.com/favicon.ico', brave: 'https://brave.com/favicon.ico',
  'opera.opera': 'https://www.opera.com/favicon.ico', opera: 'https://www.opera.com/favicon.ico',
  'videolan.vlc': 'https://www.videolan.org/favicon.ico', 'vlc media player': 'https://www.videolan.org/favicon.ico', vlc: 'https://www.videolan.org/favicon.ico',
  '7zip.7zip': 'https://www.7-zip.org/favicon.ico', '7-zip': 'https://www.7-zip.org/favicon.ico',
  'tencent.wechat': 'https://www.wechat.com/favicon.ico', wechat: 'https://www.wechat.com/favicon.ico', '微信': 'https://www.wechat.com/favicon.ico',
  'tencent.qq': 'https://im.qq.com/favicon.ico', qq: 'https://im.qq.com/favicon.ico',
  'obsproject.obsstudio': 'https://obsproject.com/favicon.ico', 'obs studio': 'https://obsproject.com/favicon.ico', obs: 'https://obsproject.com/favicon.ico',
  'spotify.spotify': 'https://www.spotify.com/favicon.ico', spotify: 'https://www.spotify.com/favicon.ico',
  'telegram.telegramdesktop': 'https://telegram.org/favicon.ico', telegram: 'https://telegram.org/favicon.ico',
  'discord.discord': 'https://discord.com/favicon.ico', discord: 'https://discord.com/favicon.ico',
  'zoom.zoom': 'https://zoom.us/favicon.ico', zoom: 'https://zoom.us/favicon.ico',
  'microsoft.visualstudiocode': 'https://code.visualstudio.com/favicon.ico', 'visual studio code': 'https://code.visualstudio.com/favicon.ico', vscode: 'https://code.visualstudio.com/favicon.ico',
  'git.git': 'https://git-scm.com/favicon.ico', git: 'https://git-scm.com/favicon.ico',
  'openjs.nodejs': 'https://nodejs.org/favicon.ico', 'node.js': 'https://nodejs.org/favicon.ico', nodejs: 'https://nodejs.org/favicon.ico',
  'python.python.3': 'https://www.python.org/favicon.ico', python: 'https://www.python.org/favicon.ico',
  'docker.dockerdesktop': 'https://www.docker.com/favicon.ico', docker: 'https://www.docker.com/favicon.ico',
  'notepad++.notepad++': 'https://notepad-plus-plus.org/favicon.ico', 'notepad++': 'https://notepad-plus-plus.org/favicon.ico',
  'rarlab.winrar': 'https://www.win-rar.com/favicon.ico', winrar: 'https://www.win-rar.com/favicon.ico',
  'bandisoft.bandizip': 'https://www.bandisoft.com/favicon.ico', bandizip: 'https://www.bandisoft.com/favicon.ico',
  'voidtools.everything': 'https://www.voidtools.com/favicon.ico', everything: 'https://www.voidtools.com/favicon.ico',
  'microsoft.powertoys': 'https://www.microsoft.com/favicon.ico', powertoys: 'https://www.microsoft.com/favicon.ico',
  'daum.potplayer': 'https://potplayer.daum.net/favicon.ico', potplayer: 'https://potplayer.daum.net/favicon.ico',
  'valve.steam': 'https://store.steampowered.com/favicon.ico', steam: 'https://store.steampowered.com/favicon.ico',
  'kingsoft.wpsoffice': 'https://www.wps.com/favicon.ico', 'wps office': 'https://www.wps.com/favicon.ico', wps: 'https://www.wps.com/favicon.ico',
  'microsoft.office': 'https://www.microsoft.com/favicon.ico', office: 'https://www.microsoft.com/favicon.ico',
  'dingtalk.dingtalk': 'https://www.dingtalk.com/favicon.ico', dingtalk: 'https://www.dingtalk.com/favicon.ico', '钉钉': 'https://www.dingtalk.com/favicon.ico',
  'bytedance.feishu': 'https://www.feishu.cn/favicon.ico', feishu: 'https://www.feishu.cn/favicon.ico', '飞书': 'https://www.feishu.cn/favicon.ico',
  'slacktechnologies.slack': 'https://slack.com/favicon.ico', slack: 'https://slack.com/favicon.ico',
  'whatsapp.whatsapp': 'https://www.whatsapp.com/favicon.ico', whatsapp: 'https://www.whatsapp.com/favicon.ico',
  'notion.notion': 'https://www.notion.com/favicon.ico', notion: 'https://www.notion.com/favicon.ico',
  'postman.postman': 'https://www.postman.com/favicon.ico', postman: 'https://www.postman.com/favicon.ico',
  'jetbrains.intellijidea.community': 'https://www.jetbrains.com/favicon.ico', intellij: 'https://www.jetbrains.com/favicon.ico',
  'adobe.acrobat.reader.64-bit': 'https://www.adobe.com/favicon.ico', 'adobe acrobat': 'https://www.adobe.com/favicon.ico',
  'microsoft.teams': 'https://www.microsoft.com/favicon.ico', teams: 'https://www.microsoft.com/favicon.ico',
  'line.line': 'https://line.me/favicon.ico', line: 'https://line.me/favicon.ico',
};
function appIconsDir() { return path.join(userDataDir(), 'app-icons'); }
function iconCacheKey(key) {
  const safe = String(key || 'app').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app';
  return `${safe}-${crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 10)}`;
}
/* 校验下载到的确实是图片：PNG/JPEG/GIF/WEBP/ICO 魔数，或 SVG 文本。 */
function validateIconBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico';
  const head = buf.slice(0, 512).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}
function iconDataUrlForFile(file) {
  try {
    const buf = fs.readFileSync(file);
    const ext = validateIconBuffer(buf);
    if (!ext) return '';
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) { return ''; }
}
/* 纯查表（不联网）：先按 winget id，再按名称；GitHub 行用属主头像。 */
function resolveOfficialIconUrl(row) {
  const r = row || {};
  const id = String(r.id || '').trim().toLowerCase();
  const name = String(r.name || '').trim().toLowerCase();
  if (id && OFFICIAL_APP_ICONS[id]) return { url: OFFICIAL_APP_ICONS[id], matched: 'table' };
  if (name && OFFICIAL_APP_ICONS[name]) return { url: OFFICIAL_APP_ICONS[name], matched: 'table' };
  if (r.source === 'github' && id.includes('/')) {
    const owner = id.split('/')[0].trim();
    if (owner) return { url: `https://github.com/${owner}.png`, matched: 'github-avatar' };
  }
  return null;
}
function fetchIconBuffer(url, redirects) {
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      if (left < 0) { reject(new Error('重定向次数过多')); return; }
      const lib = u.startsWith('https:') ? https : http;
      const req = lib.get(u, { headers: { 'User-Agent': `MuseToolbox/${VERSION}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try { go(new URL(res.headers.location, u).toString(), left - 1); } catch (e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`下载失败：HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        let size = 0;
        res.on('data', (d) => {
          size += d.length;
          if (size > 2 * 1024 * 1024) { req.destroy(new Error('图标文件超过 2MB')); return; }
          chunks.push(d);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('下载超时')));
    };
    go(url, 5);
  });
}
async function resolveDiscoverIcon(row) {
  const found = resolveOfficialIconUrl(row || {});
  if (!found) return { ok: false, icon: null, reason: '没有该软件的官方图标地址，暂用占位图标。' };
  const key = iconCacheKey(`${row.id || ''}|${row.name || ''}`);
  const dir = appIconsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ['png', 'ico', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) {
      const file = path.join(dir, `${key}.${ext}`);
      if (fs.existsSync(file)) {
        const dataUrl = iconDataUrlForFile(file);
        if (dataUrl) return { ok: true, icon: dataUrl, file, source: found.url, cached: true };
      }
    }
  } catch (e) { /* 缓存读失败就重新下载 */ }
  let buf;
  try { buf = await fetchIconBuffer(found.url); } catch (e) { return { ok: false, icon: null, reason: `官方图标下载失败：${e.message || String(e)}` }; }
  const ext = validateIconBuffer(buf);
  if (!ext) return { ok: false, icon: null, reason: '官方图标地址返回的不是有效图片文件。' };
  const file = path.join(dir, `${key}.${ext}`);
  try { fs.writeFileSync(file, buf); } catch (e) { /* 写缓存失败仍可返回 data URL */ }
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
  return { ok: true, icon: `data:${mime};base64,${buf.toString('base64')}`, file, source: found.url, cached: false };
}
function findInstalledExe(entry) {
  if (!entry) return '';
  const parsed = entry.uninstallString ? parseUninstallString(entry.uninstallString) : null;
  if (parsed && parsed.exe && /\.exe$/i.test(parsed.exe)) {
    try { if (fs.existsSync(parsed.exe) && fs.statSync(parsed.exe).isFile()) return parsed.exe; } catch (e) { /* 继续找 */ }
  }
  const loc = String(entry.installLocation || '').trim();
  if (!loc) return '';
  try {
    if (!fs.existsSync(loc) || !fs.statSync(loc).isDirectory()) return '';
    const exes = fs.readdirSync(loc).filter((f) => /\.exe$/i.test(f)).sort();
    if (!exes.length) return '';
    const normName = String(entry.name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
    const match = exes.find((f) => f.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '').includes(normName) && normName);
    return path.join(loc, match || exes[0]);
  } catch (e) { return ''; }
}
async function getInstalledAppIcon(exePath) {
  if (process.platform !== 'win32') return { ok: false, error: '取程序图标只能在 Windows 上用' };
  const exe = String(exePath || '').trim();
  if (!exe) return { ok: false, error: '先指定程序路径' };
  if (!/\.exe$/i.test(exe)) return { ok: false, error: '只支持 exe 程序的图标' };
  try { if (!fs.existsSync(exe) || !fs.statSync(exe).isFile()) return { ok: false, error: '找不到该程序文件' }; } catch (e) { return { ok: false, error: '找不到该程序文件' }; }
  const key = crypto.createHash('sha256').update(exe.toLowerCase()).digest('hex').slice(0, 16);
  const cached = path.join(appIconsDir(), `installed-${key}.png`);
  try {
    if (fs.existsSync(cached)) {
      const dataUrl = iconDataUrlForFile(cached);
      if (dataUrl) return { ok: true, icon: dataUrl, file: cached, exe, cached: true };
    }
  } catch (e) { /* 缓存读失败就重新取 */ }
  let img;
  try { img = await app.getFileIcon(exe, { size: 'large' }); } catch (e) { return { ok: false, error: `取图标失败：${e.message || String(e)}` }; }
  if (!img || img.isEmpty()) return { ok: false, error: '该程序没有图标' };
  const buf = img.toPNG();
  if (!buf || !buf.length) return { ok: false, error: '该程序没有图标' };
  try { fs.mkdirSync(appIconsDir(), { recursive: true }); fs.writeFileSync(cached, buf); } catch (e) { /* 写缓存失败仍可返回 data URL */ }
  return { ok: true, icon: `data:image/png;base64,${buf.toString('base64')}`, file: cached, exe, cached: false };
}
async function getInstalledIconForId(idOrName) {
  const entry = await findInstalledEntry(idOrName);
  if (!entry) return { ok: false, error: '找不到该软件的安装信息' };
  const exe = findInstalledExe(entry);
  if (!exe) return { ok: false, error: '找不到该软件的主程序 exe，无法取图标' };
  return getInstalledAppIcon(exe);
}

/* ---- 2026-11-27-2：安装目录解析 / 快捷方式 / 注册表（纯函数 + 可注入 IO） ----
 * 根因（-6“点名称开目录”全军覆没）：
 * 1) 渲染层传的是 winget id（如 VideoLAN.VLC），旧 findInstalledEntry 只按
 *    注册表 DisplayName 匹配，id 与显示名对不上直接返回 null；
 * 2) winget 应用的 InstallLocation 经常为空，旧 installedOpenDir 只试了
 *    InstallLocation 与 UninstallString 两步，且对 MSI 应用还会把
 *    parseUninstallString 返回的裸 'msiexec.exe' 取 dirname 得到 '.'，
 *    existsSync('.') 为真，于是打开的还是工具箱自己的当前目录；
 * 3) DisplayIcon、快捷方式、winget 三条后备根本没有。
 * 下面把解析抽成 resolveInstallDir（可注入 existsDir/快捷方式/winget，
 * 沙盒自测可验），把路径改写抽成纯函数；Windows 真实 IO 只在默认
 * 依赖里（PowerShell COM 读/写 .lnk、reg.exe 读/写卸载项）。 */
function isWinPathUnder(target, dir) {
  const w32 = path.win32;
  const t = w32.normalize(String(target || '')).toLowerCase();
  const d = w32.normalize(String(dir || '')).toLowerCase();
  if (!t || !d) return false;
  return t === d || t.startsWith(d.endsWith(w32.sep) ? d : d + w32.sep);
}
/* 旧目录下的路径改写成新目录下的对应路径；不在旧目录下返回 null。 */
function rewritePathUnderDir(target, oldDir, newDir) {
  const w32 = path.win32;
  const t = String(target || '');
  const o = String(oldDir || '');
  const n = String(newDir || '');
  if (!t || !o || !n) return null;
  if (!isWinPathUnder(t, o)) return null;
  const rest = w32.normalize(t).slice(w32.normalize(o).length).replace(/^\\/, '');
  return rest ? w32.join(w32.normalize(n), rest) : w32.normalize(n);
}
/* 命令行里第一个落在旧目录下的路径（通常是 exe 本身）改写前缀，其余原样。
 * 含引号的路径保留引号；MSI 卸载串（msiexec.exe + GUID，无路径）返回 null。
 * 不带引号、路径里又有空格的卸载串（如 C:\Program Files\Foo\uninstall.exe /S）
 * 很常见：按空格边界从长到短试前缀，第一个落在旧目录下、且以 .exe
 * 结尾（或末段带点号像文件名）的才算 exe 路径，避免把参数也改写进去。 */
function rewritePathInCommandLine(cmdline, oldDir, newDir) {
  const s = String(cmdline || '');
  if (!s) return null;
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end > 1) {
      const rewritten = rewritePathUnderDir(s.slice(1, end), oldDir, newDir);
      if (rewritten) return `"${rewritten}"` + s.slice(end + 1);
    }
    return null;
  }
  // 不带引号：从长到短试空格边界，找到最长的 exe 路径前缀。
  const spaces = [];
  for (let i = 0; i < s.length; i++) if (s[i] === ' ') spaces.push(i);
  for (let k = spaces.length - 1; k >= 0; k--) {
    const cand = s.slice(0, spaces[k]);
    const lastSeg = cand.split(/[\\/]/).pop() || '';
    if (!/\.exe$/i.test(lastSeg) && !/\.[A-Za-z0-9]{1,5}$/.test(lastSeg)) continue;
    const rewritten = rewritePathUnderDir(cand, oldDir, newDir);
    if (rewritten) return rewritten + s.slice(spaces[k]);
  }
  // 单 token 路径（如 C:\Foo\app.exe --flag）走原 token 逻辑。
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  let out = '';
  let last = 0;
  let changed = false;
  while ((m = re.exec(s)) !== null) {
    const cand = m[1] !== undefined ? m[1] : m[2];
    const rewritten = rewritePathUnderDir(cand, oldDir, newDir);
    if (rewritten && !changed) {
      out += s.slice(last, m.index) + (m[1] !== undefined ? `"${rewritten}"` : rewritten);
      last = m.index + m[0].length;
      changed = true;
    }
  }
  if (!changed) return null;
  return out + s.slice(last);
}
/* DisplayIcon 形如 C:\...\app.exe,0：取逗号前的路径部分。 */
function parseDisplayIconPath(icon) {
  const s = String(icon || '').trim().replace(/^"|"$/g, '');
  if (!s) return '';
  const beforeComma = s.split(',')[0].trim().replace(/^"|"$/g, '');
  return beforeComma || '';
}
/* 命令行里的 exe 所在目录；裸 exe 名（无盘符/路径，如 msiexec.exe）返回 ''。 */
function exeDirFromCommand(cmdline) {
  const parsed = parseUninstallString(cmdline);
  if (!parsed || parsed.kind === 'msi') return '';
  const exe = String(parsed.exe || '');
  if (!/^[a-zA-Z]:[\\/]/.test(exe) && !exe.startsWith('\\\\')) return '';
  return path.win32.dirname(path.win32.normalize(exe));
}
/* 安装目录后备链：InstallLocation → UninstallString → DisplayIcon →
 * 快捷方式目标 → winget。opts 可注入 existsDir / getShortcutTarget /
 * getWingetLocation（自测用）；默认用真实 fs 与 Windows 查找。
 * 返回 {ok, path, resolvedVia, reason}，resolvedVia 见任务定义；
 * 找不到时 reason 列出每一步试过什么、为什么不行。 */
async function resolveInstallDir(entry, opts) {
  const o = opts || {};
  const existsDir = o.existsDir || ((p) => { try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch (e) { return false; } });
  const w32 = path.win32;
  const tried = [];
  const dirOfExe = (exePath) => {
    const e = String(exePath || '');
    if (!/^[a-zA-Z]:[\\/]/.test(e) && !e.startsWith('\\\\')) return '';
    return w32.dirname(w32.normalize(e));
  };
  const loc = String((entry && entry.installLocation) || '').trim();
  if (loc) {
    if (existsDir(loc)) return { ok: true, path: w32.normalize(loc), resolvedVia: 'installLocation', reason: '' };
    tried.push(`InstallLocation 指向的目录不存在：${loc}`);
  } else tried.push('注册表无 InstallLocation');
  const us = String((entry && entry.uninstallString) || '').trim();
  if (us) {
    const d = exeDirFromCommand(us);
    if (d) {
      if (existsDir(d)) return { ok: true, path: d, resolvedVia: 'uninstallString', reason: '' };
      tried.push(`卸载字符串里的目录不存在：${d}`);
    } else tried.push('卸载字符串里没有可用的程序路径（MSI 卸载命令本身不含安装目录）');
  } else tried.push('注册表无卸载字符串');
  const iconPath = parseDisplayIconPath((entry && entry.displayIcon) || '');
  if (iconPath) {
    const d = dirOfExe(iconPath);
    if (d) {
      if (existsDir(d)) return { ok: true, path: d, resolvedVia: 'displayIcon', reason: '' };
      tried.push(`DisplayIcon 指向的目录不存在：${d}`);
    } else tried.push('DisplayIcon 不是有效的程序路径');
  } else tried.push('注册表无 DisplayIcon');
  let scTarget = '';
  let scErr = '';
  try { scTarget = o.getShortcutTarget ? await o.getShortcutTarget(entry) : await findShortcutTargetForEntry(entry); }
  catch (e) { scErr = e.message || String(e); }
  if (scErr) tried.push(`找快捷方式失败：${scErr}`);
  else if (scTarget) {
    const d = dirOfExe(scTarget);
    if (d) {
      if (existsDir(d)) return { ok: true, path: d, resolvedVia: 'shortcut', reason: '' };
      tried.push(`快捷方式指向的目录不存在：${d}`);
    } else tried.push('快捷方式目标不是有效的程序路径');
  } else tried.push('未找到指向该应用的快捷方式');
  let wloc = '';
  let wErr = '';
  try { wloc = o.getWingetLocation ? await o.getWingetLocation(entry) : await wingetInstallLocationFor(entry); }
  catch (e) { wErr = e.message || String(e); }
  if (wErr) tried.push(`winget 查询失败：${wErr}`);
  else if (wloc) {
    if (existsDir(wloc)) return { ok: true, path: w32.normalize(wloc), resolvedVia: 'winget', reason: '' };
    tried.push(`winget 返回的安装位置不存在：${wloc}`);
  } else tried.push('winget 未返回安装位置');
  return { ok: false, path: '', resolvedVia: 'none', reason: tried.join('；') };
}
/* winget 后备：用 winget id 查出显示名，再按显示名回注册表找
 * InstallLocation / UninstallString / DisplayIcon。 */
async function wingetInstallLocationFor(entry) {
  const wid = String((entry && entry.wingetId) || '').trim();
  if (!wid || !wingetAvailable()) return '';
  try {
    const r = await runWinget(['list', '--id', wid, '--accept-source-agreements'], 60000);
    const wrows = parseWingetTable(r.out || '');
    const wname = String((wrows[0] && wrows[0].name) || '').trim();
    if (!wname) return '';
    const rows = await readRegistryUninstallRows();
    const hit = rows.find((x) => x.name.toLowerCase() === wname.toLowerCase())
      || rows.find((x) => x.name.toLowerCase().includes(wname.toLowerCase()));
    if (!hit) return '';
    if (String(hit.installLocation || '').trim()) return String(hit.installLocation).trim();
    const d1 = exeDirFromCommand(hit.uninstallString || '');
    if (d1) return d1;
    const ip = parseDisplayIconPath(hit.displayIcon || '');
    if (ip) return path.win32.dirname(path.win32.normalize(ip));
    return '';
  } catch (e) { return ''; }
}
function psQuote(s) { return `'${String(s || '').replace(/'/g, "''")}'`; }
/* 一次 PowerShell 调用枚举桌面 + 开始菜单（含公共）下全部 .lnk 的
 * 目标路径、工作目录与图标位置。返回 [{lnk, target, workdir, icon}]。 */
async function listShortcutsWithTargets() {
  if (process.platform !== 'win32') return [];
  const roots = [
    path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(process.env.PROGRAMDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(os.homedir(), 'Desktop'),
    path.join(process.env.PUBLIC || '', 'Desktop'),
  ].filter(Boolean);
  const ps = `$ws = New-Object -ComObject WScript.Shell; $roots = @(${roots.map(psQuote).join(', ')}); $out = @(); foreach ($root in $roots) { if (-not (Test-Path -LiteralPath $root)) { continue } Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object { try { $s = $ws.CreateShortcut($_.FullName); $out += [PSCustomObject]@{ lnk=$_.FullName; target=$s.TargetPath; workdir=$s.WorkingDirectory; icon=$s.IconLocation } } catch {} } }; $out | ConvertTo-Json -Compress`;
  const r = await runCmd('powershell', ['-NoProfile', '-Command', ps], 120000);
  try {
    const parsed = JSON.parse((r.out || '').trim() || '[]');
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter((x) => x && x.lnk).map((x) => ({ lnk: String(x.lnk || ''), target: String(x.target || ''), workdir: String(x.workdir || ''), icon: String(x.icon || '') }));
  } catch (e) { return []; }
}
/* 找指向该应用的快捷方式目标：目标 exe 名与应用名相符，或目标
 * 落在已知的候选安装目录里。返回目标 exe 路径，找不到返回 ''。 */
async function findShortcutTargetForEntry(entry) {
  if (!entry || process.platform !== 'win32') return '';
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
  const nameNorm = norm(entry.name);
  const cands = [];
  if (String(entry.installLocation || '').trim()) cands.push(String(entry.installLocation).trim());
  const d1 = exeDirFromCommand(entry.uninstallString || '');
  if (d1) cands.push(d1);
  const ip = parseDisplayIconPath(entry.displayIcon || '');
  if (ip) cands.push(path.win32.dirname(path.win32.normalize(ip)));
  let list = [];
  try { list = await listShortcutsWithTargets(); } catch (e) { return ''; }
  let fallback = '';
  for (const sc of list) {
    if (!sc.target || !/\.exe$/i.test(sc.target)) continue;
    const base = norm(path.win32.basename(sc.target).replace(/\.exe$/i, ''));
    const nameHit = nameNorm && (base.includes(nameNorm) || nameNorm.includes(base));
    const dirHit = cands.some((c) => isWinPathUnder(sc.target, c));
    if (!nameHit && !dirHit) continue;
    if (!fallback) fallback = sc.target;
    try { if (fs.existsSync(path.win32.dirname(sc.target))) return sc.target; } catch (e) { /* 继续找 */ }
  }
  return fallback;
}
/* 转移后改写指向旧目录的快捷方式。deps 可注入 listShortcuts /
 * setShortcuts（自测用假实现）；默认走 PowerShell COM 批量改写。
 * 返回 {updated:[{lnk,target}], failed:[{lnk,reason}]}。 */
async function updateShortcutsForMove(oldDir, newDir, deps) {
  const d = deps || {};
  const updated = [];
  const failed = [];
  let list = [];
  try { list = d.listShortcuts ? await d.listShortcuts() : await listShortcutsWithTargets(); }
  catch (e) { return { updated, failed: [{ lnk: '', reason: `枚举快捷方式失败：${e.message || String(e)}` }] }; }
  const jobs = [];
  for (const sc of Array.isArray(list) ? list : []) {
    const newTarget = rewritePathUnderDir(sc.target || '', oldDir, newDir);
    if (!newTarget) continue;
    const job = { lnk: sc.lnk, target: newTarget };
    const wd = rewritePathUnderDir(sc.workdir || '', oldDir, newDir);
    if (wd) job.workdir = wd;
    const ic = String(sc.icon || '');
    if (ic) {
      const iconPath = parseDisplayIconPath(ic);
      const ni = rewritePathUnderDir(iconPath, oldDir, newDir);
      if (ni) job.icon = ic.includes(',') ? `${ni},${ic.split(',').slice(1).join(',')}` : ni;
    }
    jobs.push(job);
  }
  if (!jobs.length) return { updated, failed };
  if (d.setShortcuts) {
    let results = [];
    try { results = await d.setShortcuts(jobs); } catch (e) { for (const j of jobs) failed.push({ lnk: j.lnk, reason: e.message || String(e) }); return { updated, failed }; }
    const byLnk = new Map((Array.isArray(results) ? results : []).map((x) => [String(x.lnk || ''), x]));
    for (const j of jobs) {
      const r = byLnk.get(j.lnk);
      if (r && r.ok === false) failed.push({ lnk: j.lnk, reason: String(r.error || r.reason || '改写失败') });
      else if (r && r.ok === true) updated.push({ lnk: j.lnk, target: j.target });
      else updated.push({ lnk: j.lnk, target: j.target });
    }
    return { updated, failed };
  }
  // 默认：写临时 JSON，一次 PowerShell 批量改写全部快捷方式。
  const tmpIn = path.join(os.tmpdir(), `toolbox-lnk-${Date.now()}.json`);
  const tmpOut = path.join(os.tmpdir(), `toolbox-lnk-${Date.now()}-out.json`);
  try {
    fs.writeFileSync(tmpIn, JSON.stringify(jobs), 'utf8');
    const ps = `$items = Get-Content -Raw -LiteralPath ${psQuote(tmpIn)} | ConvertFrom-Json; $ws = New-Object -ComObject WScript.Shell; $results = @(); foreach ($it in $items) { try { $s = $ws.CreateShortcut($it.lnk); $s.TargetPath = $it.target; if ($it.workdir) { $s.WorkingDirectory = $it.workdir }; if ($it.icon) { $s.IconLocation = $it.icon }; $s.Save(); $results += [PSCustomObject]@{ lnk=$it.lnk; ok=$true } } catch { $results += [PSCustomObject]@{ lnk=$it.lnk; ok=$false; error=$_.Exception.Message } } }; $results | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psQuote(tmpOut)} -Encoding UTF8`;
    const r = await runCmd('powershell', ['-NoProfile', '-Command', ps], 120000);
    let results = [];
    try { const parsed = JSON.parse(fs.readFileSync(tmpOut, 'utf8')); results = Array.isArray(parsed) ? parsed : [parsed]; }
    catch (e) { for (const j of jobs) failed.push({ lnk: j.lnk, reason: `改写结果读不到：${(r.err || r.out || '').trim().slice(-200) || e.message}` }); return { updated, failed }; }
    const byLnk = new Map(results.map((x) => [String(x.lnk || ''), x]));
    for (const j of jobs) {
      const rr = byLnk.get(j.lnk);
      if (rr && rr.ok === false) failed.push({ lnk: j.lnk, reason: String(rr.error || '改写失败') });
      else updated.push({ lnk: j.lnk, target: j.target });
    }
  } catch (e) { for (const j of jobs) failed.push({ lnk: j.lnk, reason: e.message || String(e) }); }
  finally { try { fs.unlinkSync(tmpIn); } catch (e) { /* 忽略 */ } try { fs.unlinkSync(tmpOut); } catch (e) { /* 忽略 */ } }
  return { updated, failed };
}
/* reg.exe 读一个卸载项的全部值。返回 [{name, type, data}]。 */
async function readRegistryValues(regKey) {
  const r = await runCmd('reg', ['query', regKey], 30000);
  const text = `${r.out || ''} ${r.err || ''}`;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_\w+)\s+([\s\S]*)$/.exec(line);
    if (m) out.push({ name: m[1], type: m[2], data: m[3].trim() });
  }
  if (r.code !== 0 && !out.length) throw new Error(text.trim().slice(-200) || `reg query 失败（退出码 ${r.code}）`);
  return out;
}
/* 转移后更新注册表卸载项里指向旧目录的值。deps 可注入 readValues /
 * setValue（自测用假实现）；默认走 reg.exe。
 * 只改已存在且值里含旧目录的项：InstallLocation、UninstallString、
 * QuietUninstallString、ModifyPath、DisplayIcon。
 * 返回 {updated:[{key,value}], failed:[{key,reason}]}，key 为完整键路径 + 值名。 */
async function updateRegistryForMove(oldDir, newDir, entry, deps) {
  const d = deps || {};
  const updated = [];
  const failed = [];
  const regKey = String((entry && entry.registryKey) || '').trim();
  if (!regKey) { failed.push({ key: '(未知卸载项)', reason: '注册表里没拿到该软件的卸载项键路径，无法更新注册表（快捷方式仍已改写）' }); return { updated, failed }; }
  let values = [];
  try { values = d.readValues ? await d.readValues(regKey) : await readRegistryValues(regKey); }
  catch (e) { failed.push({ key: regKey, reason: `读卸载项失败：${e.message || String(e)}` }); return { updated, failed }; }
  const WATCH = ['InstallLocation', 'UninstallString', 'QuietUninstallString', 'ModifyPath', 'DisplayIcon'];
  for (const v of values) {
    if (!WATCH.includes(v.name)) continue;
    let newVal = null;
    if (v.name === 'InstallLocation') newVal = rewritePathUnderDir(v.data, oldDir, newDir);
    else if (v.name === 'DisplayIcon') {
      const p = parseDisplayIconPath(v.data);
      const np = rewritePathUnderDir(p, oldDir, newDir);
      if (np) newVal = v.data.includes(',') ? `${np},${v.data.split(',').slice(1).join(',')}` : np;
    } else newVal = rewritePathInCommandLine(v.data, oldDir, newDir);
    if (newVal == null || newVal === v.data) continue;
    const fullKey = `${regKey}\\${v.name}`;
    try {
      if (d.setValue) {
        const r = await d.setValue(regKey, v.name, v.type, newVal);
        if (r && r.ok === false) throw new Error(String(r.error || r.reason || '写入失败'));
      } else {
        const rr = await runCmd('reg', ['add', regKey, '/v', v.name, '/t', v.type || 'REG_SZ', '/d', newVal, '/f'], 30000);
        if (rr.code !== 0) throw new Error(`${`${rr.out || ''} ${rr.err || ''}`.trim().slice(-200) || `reg add 退出码 ${rr.code}`}（写 HKLM 卸载项一般需要管理员权限）`);
      }
      updated.push({ key: fullKey, value: newVal });
    } catch (e) { failed.push({ key: fullKey, reason: e.message || String(e) }); }
  }
  return { updated, failed };
}

/* ---- B2/B3：已安装软件的目录操作 ---- */
async function installedOpenDir(idOrName) {
  const raw = String(idOrName || '').trim();
  // 视频引擎：id 就是 tools/video/ 下的实际路径，不走注册表。
  const ve = findVideoEngineByIdOrName(raw);
  if (ve) {
    const dir = path.dirname(ve.path);
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, path: dir, dir, resolvedVia: 'video-engine', reason: '视频引擎所在目录不存在', error: '视频引擎所在目录不存在' };
    } catch (e) { return { ok: false, path: dir, dir, resolvedVia: 'video-engine', reason: '视频引擎所在目录不存在', error: '视频引擎所在目录不存在' }; }
    const err = await shell.openPath(dir);
    return err ? { ok: false, path: dir, dir, resolvedVia: 'video-engine', reason: err, error: err } : { ok: true, path: dir, dir, resolvedVia: 'video-engine', reason: '' };
  }
  if (process.platform !== 'win32') return { ok: false, path: '', dir: '', resolvedVia: 'none', reason: '只能在 Windows 上查注册表找安装目录', error: '只能在 Windows 上查注册表找安装目录' };
  const entry = await findInstalledEntry(raw);
  if (!entry) return { ok: false, path: '', dir: '', resolvedVia: 'none', reason: `找不到「${raw}」的安装信息：注册表与已导入清单里都没有这个软件（winget id 会先按显示名换算，仍找不到）`, error: `找不到「${raw}」的安装信息` };
  const res = await resolveInstallDir(entry);
  if (!res.ok) return { ok: false, path: '', dir: '', resolvedVia: 'none', reason: res.reason, error: res.reason };
  try {
    if (!fs.existsSync(res.path) || !fs.statSync(res.path).isDirectory()) return { ok: false, path: res.path, dir: res.path, resolvedVia: res.resolvedVia, reason: `解析到的安装目录不存在：${res.path}`, error: `解析到的安装目录不存在：${res.path}` };
  } catch (e) { return { ok: false, path: res.path, dir: res.path, resolvedVia: res.resolvedVia, reason: `解析到的安装目录不存在：${res.path}`, error: `解析到的安装目录不存在：${res.path}` }; }
  const err = await shell.openPath(res.path);
  return err ? { ok: false, path: res.path, dir: res.path, resolvedVia: res.resolvedVia, reason: err, error: err } : { ok: true, path: res.path, dir: res.path, resolvedVia: res.resolvedVia, reason: '' };
}
function safeMovedName(name) {
  const s = String(name || 'app').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.\-\u4e00-\u9fa5]/g, '_').replace(/_+/g, '_').slice(0, 60).replace(/^[._-]+|[._-]+$/g, '');
  return s || 'app';
}
/* ---- 2026-11-26-7：一键转移的安全目录检查 ----
 * 只转移“安全目录”：单个应用自己的安装根目录。以下目录
 * 不能整体移走，原因各不相同，返回的中文原因直接显示给用户。
 * 用 path.win32 算 Windows 路径：主进程在 Windows 上跑时
 * path 就是 win32；写成 win32 是为了在 Linux 沙盒自测里
 * 也能用同一套逻辑验 Windows 路径（见 runSelfTest）。
 * 注意：Program Files 下的单个应用根目录（如 VLC）是允许
 * 移的，只拦 Program Files 本身与共用子目录；同理用户目录
 * 下 AppData\Local\Programs 里的应用允许移，只拦用户目录
 * 根、个人文件夹与 AppData 根。 */
const MOVE_SHARED_NAMES = ['common files', 'windowsapps', 'microsoft', 'windows defender', 'windows nt', 'internet explorer', 'windows media player'];
const MOVE_PROFILE_FOLDERS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'saved games', 'searches'];
function moveSourceBlockedReason(input, opts) {
  const env = (opts && opts.env) || process.env;
  const w32 = path.win32;
  const norm = w32.resolve(String(input || ''));
  const lower = norm.toLowerCase();
  const isEq = (p) => lower === String(p || '').toLowerCase();
  const isUnder = (p) => { const q = String(p || '').toLowerCase(); return !!q && (lower === q || lower.startsWith(q + w32.sep)); };
  const isAncestorOf = (p) => { const q = String(p || '').toLowerCase(); return !!q && q !== lower && q.startsWith(lower + w32.sep); };
  const driveRoot = w32.parse(norm).root.toLowerCase();
  const winRoot = String(env.SystemRoot || `${driveRoot}Windows`).toLowerCase();
  const sysDrive = w32.parse(winRoot).root || driveRoot;
  const roots = {
    'Windows 系统目录': winRoot,
    'Program Files 目录': String(env.ProgramFiles || `${sysDrive}Program Files`),
    'Program Files (x86) 目录': String(env['ProgramFiles(x86)'] || `${sysDrive}Program Files (x86)`),
    'ProgramData 目录': String(env.ProgramData || env.ALLUSERSPROFILE || `${sysDrive}ProgramData`),
    '用户目录根（Users）': `${sysDrive}Users`,
    '用户目录': String(env.USERPROFILE || ''),
    '公共用户目录': String(env.PUBLIC || `${sysDrive}Users\\Public`),
    '应用数据目录（AppData\\Roaming）': String(env.APPDATA || ''),
    '本地应用数据目录（AppData\\Local）': String(env.LOCALAPPDATA || ''),
    '共用程序文件目录': String(env.CommonProgramFiles || ''),
    '共用程序文件目录 (x86)': String(env['CommonProgramFiles(x86)'] || ''),
  };
  if (lower === driveRoot) return '系统盘根目录不能转移：移走整个盘会破坏系统与全部程序。';
  if (isUnder(winRoot)) return 'Windows 系统目录不能转移：系统文件移走后电脑无法启动。';
  if (lower.includes('\\windowsapps\\') || lower.endsWith('\\windowsapps')) return '应用商店安装目录（WindowsApps）不能转移：受系统保护，移走后应用无法运行。';
  for (const [label, p] of Object.entries(roots)) {
    if (!p) continue;
    if (isEq(p)) return `${label}不能转移：这是系统或多程序共用的目录，不是单个应用的安装目录。`;
    if (isAncestorOf(p)) return '该目录包含系统或用户重要目录，不能整体转移。';
  }
  const pf = [roots['Program Files 目录'], roots['Program Files (x86) 目录']];
  if (pf.some((p) => p && isUnder(p))) {
    // Program Files 下任一段是共用名（如 Common Files、Microsoft）就拦
    const rel = norm.slice((pf.find((p) => p && isUnder(p)) || '').length + 1).toLowerCase().split(w32.sep);
    if (rel.some((s) => MOVE_SHARED_NAMES.includes(s))) return '该目录是多个程序共用的系统目录，不能单独转移。';
  }
  const programData = roots['ProgramData 目录'];
  if (programData && isUnder(programData)) return 'ProgramData 不能转移：它是系统与多个程序共享的数据目录，移走会影响多个程序。';
  const usersRoot = roots['用户目录根（Users）'];
  const profile = roots['用户目录'];
  if (usersRoot && isUnder(usersRoot) && (!profile || !isUnder(profile))) return '用户目录不能转移：里面是所有用户的个人文件与设置。';
  if (profile && isUnder(profile)) {
    const rel = norm.slice(profile.length + 1).toLowerCase().split(w32.sep).filter(Boolean);
    if (rel.length === 0) return '用户目录不能转移：里面是个人文件与设置，不是应用安装目录。';
    if (MOVE_PROFILE_FOLDERS.includes(rel[0])) return '用户个人文件夹不能转移：里面是个人文件，不是应用安装目录。';
    if (rel[0] === 'appdata' && rel.length === 1) return '应用数据目录（AppData）不能转移：里面是多个程序的设置与数据。';
    if (rel[0] === 'appdata' && rel[1] === 'microsoft') return '该目录属于系统与多个程序共用的数据，不能转移。';
  }
  const tools = String((opts && opts.toolsDir) || toolsDir()).toLowerCase();
  const data = String((opts && opts.userDataDir) || userDataDir()).toLowerCase();
  const exe = String((opts && opts.exeDir) || path.dirname(process.execPath)).toLowerCase();
  if (isUnder(tools)) return '该软件已在工具箱组件目录下，无需转移。';
  if (isUnder(data)) return '工具箱自己的数据目录不能转移：移走后工具箱数据会丢失。';
  if (isEq(exe) || isUnder(exe) || isAncestorOf(exe)) return '工具箱程序所在目录不能转移：移走后工具箱本身无法运行。';
  return null;
}
async function installedMoveToTools(idOrName) {
  if (process.platform !== 'win32') return { ok: false, error: '转移安装目录只能在 Windows 上用' };
  const entry = await findInstalledEntry(idOrName);
  if (!entry) return { ok: false, error: '找不到该软件的安装目录' };
  // 2026-11-27-2：转移的源目录也走同一条后备链（InstallLocation 常为空，
  // 旧代码只试两步且会把裸 msiexec.exe 的 dirname '.' 当成目录）。
  const resolved = await resolveInstallDir(entry);
  let from = resolved.ok ? resolved.path : '';
  if (!from) {
    const p = entry.uninstallString ? parseUninstallString(entry.uninstallString) : null;
    if (p && p.exe) { const d = exeDirFromCommand(entry.uninstallString); if (d) from = d; }
  }
  if (!from) return { ok: false, error: `找不到该软件的安装目录：${resolved.reason || '无可用路径'}` };
  let stat;
  try { stat = fs.statSync(from); } catch (e) { return { ok: false, error: `找不到该软件的安装目录：${from}` }; }
  if (!stat.isDirectory()) return { ok: false, error: '安装目录不是文件夹，无法转移' };
  const norm = path.resolve(from);
  try { if (fs.lstatSync(from).isSymbolicLink()) return { ok: false, error: '安装目录是链接，不是真实文件夹，无法转移。' }; } catch (e) { /* 读不到链接状态不拦 */ }
  const blocked = moveSourceBlockedReason(norm);
  if (blocked) return { ok: false, error: blocked };
  const movedBase = path.join(toolsDir(), 'moved');
  fs.mkdirSync(movedBase, { recursive: true });
  let dest = path.join(movedBase, safeMovedName(entry.name));
  let n = 2;
  while (fs.existsSync(dest)) { dest = path.join(movedBase, `${safeMovedName(entry.name)}-${n++}`); }
  try {
    try {
      fs.renameSync(from, dest);
    } catch (e) {
      if (e.code !== 'EXDEV' && e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
      // 跨盘或文件被占用时 rename 失败：改用复制 + 删除（删不掉就报错、不留半截）
      fs.cpSync(from, dest, { recursive: true });
      try { fs.rmSync(from, { recursive: true, force: true }); }
      catch (e2) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e3) { /* 清理尽力而为 */ } throw new Error(`原目录删不掉（文件可能被占用）：${e2.message || String(e2)}，已取消转移`); }
    }
  } catch (e) {
    return { ok: false, error: `转移失败：${e.message || String(e)}` };
  }
  const link = await runCmd('cmd', ['/c', 'mklink', '/J', from, dest], 60000);
  const linkText = `${link.out || ''} ${link.err || ''}`;
  if (link.code !== 0 || !fs.existsSync(from)) {
    // 联接建不起来：把目录移回去，不留“原处没了、新处也没接上”的半截状态
    try { fs.renameSync(dest, from); } catch (e) { /* 移回去失败就如实报 */ }
    return { ok: false, error: `转移后在原位置建联接失败（mklink /J）：${linkText.trim().slice(-200) || '未知错误'}，目录已移回原处` };
  }
  const list = readJsonFile('moved-apps.json', []);
  const arr = Array.isArray(list) ? list : [];
  arr.unshift({ id: entry.wingetId || String(idOrName), name: entry.name, from, to: dest, at: Date.now() });
  writeJsonFile('moved-apps.json', arr.slice(0, 200));
  // 2026-11-27-2：转移完只移目录、原处留联接是不够的——桌面与开始
  // 菜单的快捷方式、注册表卸载项还指着旧路径，改写它们；改不掉的
  // 逐条带原因返回，不静默跳过，也不因此推翻已成功的转移。
  // 注意：原处留了联接（/J），所以即使某条改写失败，旧快捷方式与
  // 卸载命令仍能经联接找到新位置的程序，只是路径显示还是旧的。
  let shortcutsUpdated = [];
  let shortcutsFailed = [];
  let registryUpdated = [];
  let registryFailed = [];
  try {
    const sc = await updateShortcutsForMove(norm, dest);
    shortcutsUpdated = sc.updated; shortcutsFailed = sc.failed;
  } catch (e) { shortcutsFailed = [{ lnk: '', reason: `改写快捷方式失败：${e.message || String(e)}` }]; }
  try {
    const rg = await updateRegistryForMove(norm, dest, entry);
    registryUpdated = rg.updated; registryFailed = rg.failed;
  } catch (e) { registryFailed = [{ key: '', reason: `更新注册表失败：${e.message || String(e)}` }]; }
  // 已导入清单里也记着旧安装目录，同步改掉，下次查找不再指旧路径。
  try {
    const imported = readJsonFile('installed-import.json', []);
    if (Array.isArray(imported)) {
      let changed = false;
      for (const it of imported) {
        if (it && (String(it.name || '') === entry.name || String(it.wingetId || '') === String(entry.wingetId || ''))) {
          if (String(it.installLocation || '').trim()) { it.installLocation = dest; changed = true; }
        }
      }
      if (changed) writeJsonFile('installed-import.json', imported);
    }
  } catch (e) { /* 清单同步失败不影响转移结果 */ }
  const noteParts = [`已转移到 ${dest}，原处已留联接`];
  noteParts.push(shortcutsUpdated.length ? `已改写 ${shortcutsUpdated.length} 个快捷方式` : '没有指向旧目录的快捷方式需要改写');
  noteParts.push(registryUpdated.length ? `已更新 ${registryUpdated.length} 项注册表值` : '注册表卸载项里没有需要更新的值');
  if (shortcutsFailed.length) noteParts.push(`${shortcutsFailed.length} 个快捷方式改写失败：${shortcutsFailed.map((f) => f.reason).join('；')}`);
  if (registryFailed.length) noteParts.push(`${registryFailed.length} 项注册表更新失败：${registryFailed.map((f) => f.reason).join('；')}`);
  return { ok: true, from, to: dest, movedTo: dest, shortcutsUpdated, shortcutsFailed, registryUpdated, registryFailed, note: noteParts.join('；') };
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle('get-overview', () => ({
    version: DISPLAY_VERSION,
    platform: process.platform,
    winget: wingetAvailable(),
    vlc: vlcStatus(),
    browser: browserStatus(),
    protocolRegistered: app.isDefaultProtocolClient(PROTOCOL),
    githubHasToken: !!getConfig().githubToken,
    spaceCallEnabled: getConfig().spaceCallEnabled !== false,
    config: { ...getConfig(), githubToken: undefined },
  }));

  ipcMain.handle('winget-search', async (_e, q) => {
    if (!wingetAvailable()) return { available: false, rows: [] };
    // 只搜「工具来源」里启用的来源：winget 默认源与微软商店源。
    const src = getConfig().sources || {};
    let rows = [];
    let error = '';
    let githubSkipped = false;
    const query = String(q || '');
    if (src.winget !== false) {
      const r = await runWinget(['search', query, '--accept-source-agreements'], 90000);
      for (const row of parseWingetTable(r.out)) {
        row.source = 'winget'; row.sourceLabel = 'winget';
        row.sourceUrl = row.id ? `https://winget.run/pkg/${row.id}` : '';
        const exact = row.name && row.name.toLowerCase() === query.toLowerCase();
        row.confidence = Math.min(95, 90 + (exact ? 5 : 0));
        rows.push(row);
      }
      if (r.code !== 0) error = (r.err || r.out).slice(-300);
    }
    const seen = new Set(rows.map((x) => x.id));
    if (src.msstore !== false) {
      try {
        const r2 = await runWinget(['search', query, '--source', 'msstore', '--accept-source-agreements'], 90000);
        for (const row of parseWingetTable(r2.out)) {
          if (row.id && !seen.has(row.id)) {
            seen.add(row.id);
            row.source = 'msstore'; row.sourceLabel = '微软商店';
            row.sourceUrl = `https://apps.microsoft.com/search?query=${encodeURIComponent(query)}`;
            row.confidence = 80;
            rows.push(row);
          }
        }
      } catch (e) { /* 商店源不可用时只用默认源的结果 */ }
    }
    if (src.github !== false) {
      const token = getConfig().githubToken || '';
      if (!token) {
        githubSkipped = true;
      } else {
        const r3 = await githubApi(`/search/repositories?q=${encodeURIComponent(query)}&per_page=10&sort=stars&order=desc`, token);
        if (r3.ok) {
          for (const it of (r3.data.items || [])) {
            const stars = it.stargazers_count || 0;
            rows.push({
              name: it.name || '', id: it.full_name || '', version: '',
              source: 'github', sourceLabel: 'GitHub', sourceUrl: it.html_url || '',
              confidence: Math.max(50, Math.min(85, 50 + Math.round(Math.log10(stars + 1) * 10))),
              description: it.description || '', stars,
            });
          }
        }
      }
    }
    if (src.winget === false && src.msstore === false) error = 'winget 与微软商店两个来源都已在「工具来源」里关闭，请先启用至少一个。';
    rows.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return { available: true, rows, error, githubSkipped };
  });
  ipcMain.handle('winget-installed-one', async (_e, id) => {
    if (!wingetAvailable()) return { available: false, row: null };
    const r = await runWinget(['list', '--id', String(id), '--accept-source-agreements'], 90000);
    const rows = parseWingetTable(r.out);
    return { available: true, row: rows[0] || null };
  });
  ipcMain.handle('winget-installed', async () => {
    if (!wingetAvailable()) return { available: false, rows: [] };
    const r = await runWinget(['list', '--accept-source-agreements'], 90000);
    const rows = parseWingetTable(r.out);
    // 2026-11-27-2：tools/video/ 下已安装的视频引擎追加进已安装列表
    //（带 kind:'video-engine' 标记，前端按名字能搜到；不是 winget 包，
    // 不要给它们挂 winget 卸载）。引擎扫描失败不影响 winget 列表。
    try {
      for (const eng of await listVideoEngines()) rows.push({ name: eng.name, id: eng.id, version: eng.version, source: 'video-engine', sourceLabel: '视频引擎', kind: 'video-engine', path: eng.path, versionNote: eng.versionNote });
    } catch (e) { /* 引擎扫描失败不拦 winget 列表 */ }
    return { available: true, rows, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) };
  });
  // 2026-11-27-2：视频引擎的干净列表（不含 winget 行），供前端单独取用。
  ipcMain.handle('tools-installed-extra', async () => {
    try { return { ok: true, rows: await listVideoEngines() }; }
    catch (e) { return { ok: false, rows: [], error: e.message || String(e) }; }
  });
  // 2026-11-27-2：管理员检测（前端展示用；preload 由另一工人接）。
  ipcMain.handle('tools-check-admin', () => checkAdminWindows());
  // 2026-11-27-3：外部协议（mailto:）用户确认后才打开；其他协议不放行。
  ipcMain.handle('external-protocol-open', (_e, url) => {
    const c = classifyNavigationUrl(url);
    if (c.decision !== 'ask') return { ok: false, error: '该协议不允许从工具箱打开' };
    shell.openExternal(String(url));
    return { ok: true };
  });
  // 2026-11-27-3：账号登录严格认证指纹（主进程读 Cookie，只回是否命中）。
  ipcMain.handle('browser-login-check', (_e, url) => browserLoginCheck(String(url || '')));
  ipcMain.handle('browser-login-ignore', (_e, req) => setLoginIgnored((req && req.host) || '', (req && req.scope) || 'session'));
  ipcMain.handle('browser-login-ignored', (_e, host) => ({ ignored: isLoginIgnored(String(host || '')) }));
  ipcMain.handle('winget-upgrades', async () => {
    if (!wingetAvailable()) return { available: false, rows: [] };
    const r = await runWinget(['upgrade', '--accept-source-agreements'], 90000);
    return { available: true, rows: parseWingetTable(r.out), error: r.code === 0 ? '' : (r.err || r.out).slice(-300) };
  });
  ipcMain.handle('winget-install', (_e, id) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    return { ok: true, ...runWingetJob(`安装 ${id}`, ['install', '--id', String(id), '-e', '--accept-package-agreements', '--accept-source-agreements']) };
  });
  ipcMain.handle('winget-uninstall', (_e, id) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    return { ok: true, ...runWingetJob(`卸载 ${id}`, ['uninstall', '--id', String(id), '-e', '--accept-source-agreements', '--disable-interactivity'], { uninstallId: String(id), timeoutMs: 180000 }) };
  });
  ipcMain.handle('installed-open-dir', (_e, id) => installedOpenDir(String(id || '')));
  ipcMain.handle('installed-move-to-tools', (_e, id) => installedMoveToTools(String(id || '')));
  // 2026-11-26-7：应用官方图标（渲染层接线随后做，见 main.js 图标段）
  ipcMain.handle('tools-get-app-icon', (_e, exe) => getInstalledAppIcon(String(exe || '')));
  ipcMain.handle('tools-get-installed-icon', (_e, id) => getInstalledIconForId(String(id || '')));
  ipcMain.handle('tools-get-discover-icon', (_e, row) => resolveDiscoverIcon(row || {}));
  ipcMain.handle('winget-upgrade-one', (_e, id) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    return { ok: true, ...runWingetJob(`更新 ${id}`, ['upgrade', '--id', String(id), '-e', '--accept-package-agreements', '--accept-source-agreements']) };
  });
  ipcMain.handle('winget-upgrade-all', () => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    return { ok: true, ...runWingetJob('更新全部软件', ['upgrade', '--all', '--accept-package-agreements', '--accept-source-agreements']) };
  });
  ipcMain.handle('winget-export', async () => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    const picked = await dialog.showSaveDialog(mainWin, {
      title: '导出软件包清单',
      defaultPath: path.join(getConfig().downloadDir, '软件包清单.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    const r = await runWinget(['export', '-o', picked.filePath, '--accept-source-agreements'], 180000);
    return r.code === 0 ? { ok: true, file: picked.filePath } : { ok: false, error: (r.err || r.out).slice(-300) };
  });
  ipcMain.handle('winget-import', async () => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '导入软件包清单',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, ...runWingetJob('按清单批量安装', ['import', '-i', picked.filePaths[0], '--accept-package-agreements', '--accept-source-agreements', '--ignore-unavailable']) };
  });

  ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
  ipcMain.handle('open-external', (_e, url) => shell.openExternal(String(url || '')));

  ipcMain.handle('vlc-status', () => vlcStatus());
  ipcMain.handle('vlc-download', () => downloadComponent('vlc'));
  ipcMain.handle('vlc-launch', () => launchVlc());

  ipcMain.handle('browser-status', () => browserStatus());
  ipcMain.handle('browser-download', () => downloadComponent('browser'));
  ipcMain.handle('browser-launch', () => launchBrowser());

  /* ---- v1.4.0：应用列表、默认应用、界面内设置 ---- */
  ipcMain.handle('player-apps', () => playerAppsStatus());
  ipcMain.handle('browser-apps', () => browserAppsStatus());
  ipcMain.handle('launch-player', (_e, kind, target) => launchPlayerApp(String(kind || 'vlc'), target ? String(target) : ''));
  ipcMain.handle('launch-browser-app', (_e, kind, url) => openWithDefaultBrowser(url ? String(url) : '', 'local', String(kind || 'chromium')));
  ipcMain.handle('pick-media', async () => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '选择媒体文件',
      filters: [
        { name: '视频', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'] },
        { name: '音频', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a'] },
        { name: '全部文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return '';
    return picked.filePaths[0];
  });
  ipcMain.handle('vlc-play', (_e, target) => playWithDefaultPlayer(String(target || ''), 'local'));
  ipcMain.handle('browser-open-url', (_e, kind, url) => {
    if (String(kind || '') === 'chromium') {
      sendToRenderer('embedded-browser-open', { url: String(url || '') });
      return { ok: true, embedded: true };
    }
    return openWithDefaultBrowser(String(url || ''), 'local', String(kind || 'chromium'));
  });
  ipcMain.handle('vlc-get-prefs', () => readVlcPrefs());
  ipcMain.handle('vlc-set-prefs', (_e, patch) => { try { return { ok: true, prefs: writeVlcPrefs(patch || {}) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } });
  ipcMain.handle('chromium-get-settings', () => chromiumSettings());
  ipcMain.handle('chromium-set-settings', (_e, patch) => { try { return { ok: true, settings: writeChromiumSettings(patch || {}) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } });
  ipcMain.handle('chromium-extensions', () => chromiumExtensions());
  ipcMain.handle('system-status', () => systemStatus());
  ipcMain.handle('open-default-apps', async () => {
    if (process.platform !== 'win32') return { ok: false, error: '设置默认应用只能在 Windows 设置里改（当前不是 Windows）。' };
    await shell.openExternal('ms-settings:defaultapps');
    return { ok: true };
  });


  /* ---- GitHub：登录（个人访问令牌，本地保存，不写进代码） ---- */
  ipcMain.handle('github-status', async () => {
    const token = getConfig().githubToken || '';
    if (!token) return { hasToken: false, login: '' };
    const r = await githubApi('/user', token);
    if (r.ok) return { hasToken: true, login: r.data.login || '' };
    return { hasToken: true, login: '', error: r.error };
  });
  ipcMain.handle('github-set-token', async (_e, token) => {
    const t = String(token || '').trim();
    if (!t) return { ok: false, error: '先粘贴 GitHub 个人访问令牌（Personal Access Token）。' };
    const r = await githubApi('/user', t);
    if (!r.ok) return { ok: false, error: `令牌无效或网络不通：${r.error}` };
    saveConfig({ ...getConfig(), githubToken: t });
    return { ok: true, login: r.data.login || '' };
  });
  ipcMain.handle('github-clear-token', () => {
    saveConfig({ ...getConfig(), githubToken: '' });
    return { ok: true };
  });
  ipcMain.handle('github-search', async (_e, q) => {
    if ((getConfig().sources || {}).github === false) return { ok: false, error: 'GitHub 来源已在「工具来源」里关闭，请先启用。' };
    const token = getConfig().githubToken || '';
    if (!token) return { ok: false, error: '请先在 GitHub 页登录（粘贴个人访问令牌）。' };
    const r = await githubApi(`/search/repositories?q=${encodeURIComponent(String(q || ''))}&per_page=10&sort=stars&order=desc`, token);
    if (!r.ok) return { ok: false, error: r.error };
    const items = (r.data.items || []).map((it) => ({
      full_name: it.full_name, name: it.name, owner: (it.owner || {}).login || '',
      description: it.description || '', stars: it.stargazers_count || 0,
      language: it.language || '', html_url: it.html_url || '',
    }));
    return { ok: true, items, total: r.data.total_count || items.length };
  });
  ipcMain.handle('github-releases', async (_e, owner, repo) => {
    const token = getConfig().githubToken || '';
    if (!token) return { ok: false, error: '请先在 GitHub 页登录（粘贴个人访问令牌）。' };
    const r = await githubApi(`/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/releases?per_page=10`, token);
    if (!r.ok) return { ok: false, error: r.error };
    const releases = (r.data || []).map((rel) => ({
      tag: rel.tag_name || '', name: rel.name || rel.tag_name || '',
      published_at: rel.published_at || '',
      assets: (rel.assets || []).map((a) => ({ name: a.name, size: a.size || 0, url: a.browser_download_url || '' })),
    }));
    return { ok: true, releases };
  });
  ipcMain.handle('github-install-asset', async (_e, url, name, repo, tag) => {
    const token = getConfig().githubToken || '';
    const fileName = String(name || '').split('/').pop() || 'github-installer.exe';
    if (!/\.(exe|msi)$/i.test(fileName)) return { ok: false, error: '这个附件不是 exe / msi 安装包，不能直接装。' };
    if (process.platform !== 'win32') return { ok: false, error: '安装包只能在 Windows 上运行安装（当前不是 Windows）。' };
    const dest = path.join(getConfig().downloadDir, fileName);
    fs.mkdirSync(getConfig().downloadDir, { recursive: true });
    const dl = await downloadGithubAsset(String(url), dest, token);
    if (!dl.ok) return dl;
    // exe 直接启动安装程序；msi 用 msiexec 安装。安装程序由用户
    // 在弹出的向导里点完，装完后在「已安装」里刷新核对。
    if (/\.msi$/i.test(fileName)) {
      const child = spawn('msiexec', ['/i', dest], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn(dest, [], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    const parsed = parseGithubAssetUrl(String(url), repo, tag);
    recordGithubInstalled(parsed.owner, parsed.repo, parsed.tag, fileName);
    return { ok: true, file: dest };
  });

  // 2026-11-26-2：代码热更新——设置里点「检查更新」拉 GitHub
  // 上的 update-manifest.json，点「一键更新」只下载改动的代码
  // 文件、校验后替换、重启生效。启动时不自动检查。
  ipcMain.handle('update-status', async () => ({ version: DISPLAY_VERSION, repo: `${UPDATE_OWNER}/${UPDATE_REPO}`, releasesUrl: UPDATE_RELEASES_URL, manifestPath: UPDATE_MANIFEST_PATH, state: getUpdateState() }));
  ipcMain.handle('update-check', async (_e, opts) => checkToolboxUpdate(opts || {}));
  ipcMain.handle('update-apply', async () => applyToolboxUpdate());
  ipcMain.handle('update-restart', async () => { app.relaunch(); app.quit(); return { ok: true }; });
  ipcMain.handle('update-open-releases', async () => { shell.openExternal(UPDATE_RELEASES_URL); return { ok: true }; });

  ipcMain.handle('prereq-status', async () => {
    const items = [];
    for (const item of PREREQS) items.push(await checkPrereq(item));
    return { available: process.platform === 'win32', items };
  });
  ipcMain.handle('prereq-install', async (_e, keys) => {
    if (process.platform !== 'win32') return { ok: false, error: '必备环境只能在 Windows 上安装（当前不是 Windows）。' };
    const wanted = Array.isArray(keys) ? keys : [];
    const results = [];
    for (const item of PREREQS) {
      if (!wanted.includes(item.key)) continue;
      if (item.key === 'winget') { results.push({ key: item.key, ok: false, error: 'winget 无法自动安装：请在微软商店安装「应用安装程序」（App Installer）。' }); continue; }
      if (!item.wingetId) { results.push({ key: item.key, ok: false, error: '没有可用的 winget 包名，无法自动安装。' }); continue; }
      const r = await runWinget(['install', '--id', item.wingetId, '-e', '--accept-package-agreements', '--accept-source-agreements'], 300000);
      results.push({ key: item.key, ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
    }
    return { ok: results.every((x) => x.ok), results };
  });
  ipcMain.handle('winget-deps', async (_e, id) => wingetDepsFor(String(id || '')));
  ipcMain.handle('install-deps-and-package', async (_e, mainId, depIds) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    const steps = [];
    for (const depId of Array.isArray(depIds) ? depIds : []) {
      const r = await runWinget(['install', '--id', String(depId), '-e', '--accept-package-agreements', '--accept-source-agreements'], 300000);
      steps.push({ id: depId, kind: '依赖', ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
      if (r.code !== 0) return { ok: false, steps, error: `依赖 ${depId} 安装失败，先停下，没装本体。${(r.err || r.out).slice(-200)}` };
    }
    const r = await runWinget(['install', '--id', String(mainId), '-e', '--accept-package-agreements', '--accept-source-agreements'], 300000);
    steps.push({ id: String(mainId), kind: '本体', ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
    return { ok: r.code === 0, steps, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) };
  });
  ipcMain.handle('github-release-deps', async (_e, owner, repo, tag) => {
    const token = getConfig().githubToken || '';
    if (!token) return { ok: false, error: '请先在 GitHub 页登录（粘贴个人访问令牌）。' };
    const r = await githubApi(`/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/releases/tags/${encodeURIComponent(String(tag || ''))}`, token);
    if (!r.ok) return { ok: false, error: r.error };
    const declared = depsFromReleaseBody(r.data.body || '');
    // 逐条核对已装（只在 Windows 上能核对）
    const out = [];
    for (const d of declared) {
      let installed = false, installedVersion = '';
      if (wingetAvailable() && d.wingetId) {
        const lr = await runWinget(['list', '--id', d.wingetId, '--accept-source-agreements'], 60000);
        const rows = parseWingetTable(lr.out);
        if (rows[0]) { installed = true; installedVersion = rows[0].version || ''; }
      }
      let conflict = '';
      if (installed && d.requiredVersion && installedVersion && compareVersions(installedVersion, d.requiredVersion) < 0) {
        conflict = `已装 ${installedVersion}，Release 说明要求 ${d.requiredVersion}：需先升级该依赖。`;
      }
      out.push({ ...d, name: d.label, id: d.wingetId, installed, installedVersion, conflict });
    }
    return { ok: true, deps: out, note: out.length ? '以上依赖是从 Release 说明文字里找出来的，未自动验证：说明没写的依赖这里查不到。' : 'Release 说明里没提到依赖——不代表没有依赖，只是说明没写，无法自动检测。' };
  });
  ipcMain.handle('github-install-with-deps', async (_e, url, name, depIds, repo, tag) => {
    const token = getConfig().githubToken || '';
    const steps = [];
    if (process.platform !== 'win32') return { ok: false, error: '安装包只能在 Windows 上运行安装（当前不是 Windows）。' };
    for (const depId of Array.isArray(depIds) ? depIds : []) {
      const r = await runWinget(['install', '--id', String(depId), '-e', '--accept-package-agreements', '--accept-source-agreements'], 300000);
      steps.push({ id: depId, kind: '依赖', ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
      if (r.code !== 0) return { ok: false, steps, error: `依赖 ${depId} 安装失败，先停下，没装本体。` };
    }
    const fileName = String(name || '').split('/').pop() || 'github-installer.exe';
    if (!/\.(exe|msi)$/i.test(fileName)) return { ok: false, steps, error: '这个附件不是 exe / msi 安装包，不能直接装。' };
    const dest = path.join(getConfig().downloadDir, fileName);
    fs.mkdirSync(getConfig().downloadDir, { recursive: true });
    const dl = await downloadGithubAsset(String(url), dest, token);
    if (!dl.ok) return { ok: false, steps, error: dl.error };
    if (/\.msi$/i.test(fileName)) {
      const child = spawn('msiexec', ['/i', dest], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn(dest, [], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    steps.push({ id: fileName, kind: '本体', ok: true, error: '' });
    const parsed = parseGithubAssetUrl(String(url), repo, tag);
    recordGithubInstalled(parsed.owner, parsed.repo, parsed.tag, fileName);
    return { ok: true, steps, file: dest };
  });

  ipcMain.handle('get-config', () => { const c = getConfig(); return { ...c, githubToken: undefined, githubHasToken: !!c.githubToken }; });
  ipcMain.handle('set-config', (_e, patch) => {
    const next = { ...getConfig(), ...(patch || {}) };
    saveConfig(next);
    applyWindowSettings(); // 2026-11-26-3：置顶/开机自启/防休眠/托盘菜单立即生效
    return next;
  });

  /* ---- 窗口与系统（2026-11-26-3）：自定义标题栏按钮与窗口状态 ---- */
  ipcMain.handle('window-minimize', () => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.minimize(); } catch (e) { /* 跳过 */ } return { ok: true }; });
  ipcMain.handle('window-maximize', () => {
    try {
      if (!mainWin || mainWin.isDestroyed()) return { ok: false, maximized: false };
      if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize();
      return { ok: true, maximized: mainWin.isMaximized() };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('window-close', () => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.close(); } catch (e) { /* 跳过 */ } return { ok: true }; });
  ipcMain.handle('window-state', () => {
    try { return { maximized: !!(mainWin && !mainWin.isDestroyed() && mainWin.isMaximized()) }; }
    catch (e) { return { maximized: false }; }
  });
  ipcMain.handle('window-status', () => {
    const crashes = readJsonFile('crash-log.json', []);
    const powerLog = readJsonFile('power-log.json', []);
    return {
      power: lastPowerEvent,
      powerLog: Array.isArray(powerLog) ? powerLog.slice(-5) : [],
      crashes: Array.isArray(crashes) ? crashes.slice(-3) : [],
      tray: !!tray,
      loginItem: getLoginItemOpenAtLogin(),
    };
  });
  ipcMain.handle('pick-dir', async () => {
    const picked = await dialog.showOpenDialog(mainWin, { title: '选择文件夹', properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return '';
    return picked.filePaths[0];
  });
  ipcMain.handle('pick-vlc', async () => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '选择 vlc.exe',
      filters: [{ name: 'VLC', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return '';
    return picked.filePaths[0];
  });
  ipcMain.handle('open-tools-dir', () => shell.openPath(toolsDir()));
  ipcMain.handle('register-protocol', () => {
    const ok = app.setAsDefaultProtocolClient(PROTOCOL);
    return { ok, registered: app.isDefaultProtocolClient(PROTOCOL) };
  });

  /* ---- 工具箱本地功能：智能体 / 创作 / 代码 / 图像 / 监控 /
   * 记账本 / 注册 / 远程 / 文件 / 代理（本地数据，不连空间） ---- */
  ipcMain.handle('code-run', (_e, req) => runCode(req || {}));
  ipcMain.handle('code-interpreters', () => detectInterpreters());
  ipcMain.handle('event-trigger-status', () => eventTriggerStatus());
  ipcMain.handle('tun-status', () => tunStatus());
  ipcMain.handle('tun-install', () => tunInstall());
  ipcMain.handle('tun-start', () => tunStart());
  ipcMain.handle('tun-stop', () => tunStop());
  ipcMain.handle('register-mailtm-account', () => mailtmAccount());
  ipcMain.handle('register-mailtm-fetch', () => mailtmFetch());
  ipcMain.handle('remote-start', () => remoteStart());
  ipcMain.handle('remote-stop', () => remoteStop());
  ipcMain.handle('remote-server-status', () => remoteServerStatus());
  ipcMain.handle('selfcheck-status', () => selfcheckStatus());
  ipcMain.handle('selfcheck-install', (_e, key) => selfcheckInstall(String(key || '')));
  ipcMain.handle('agents-list', () => getAgents().map((a) => ({
    ...a, apiKey: undefined, hasKey: !!a.apiKey,
    webToken: undefined, webCookie: undefined, webUserAgent: undefined,
    connectionType: a.connectionType || 'api', webSite: a.webSite || '',
    hasWebToken: !!(a.webToken), webStatus: a.webStatus || '', webLogin: a.webLogin || '',
  })));
  ipcMain.handle('agent-save', (_e, agent) => {
    const list = getAgents();
    const next = { ...agent, id: agent.id || localId() };
    if (!next.name) return { ok: false, error: '先填智能体名称' };
    next.connectionType = next.connectionType === 'web' ? 'web' : 'api';
    if (next.connectionType === 'web' && next.webSite === 'qwen' && typeof next.webToken === 'string' && next.webToken.trim()) {
      const q = parseQwenPaste(next.webToken);
      next.webToken = q.token;
      if (q.cookie) next.webCookie = q.cookie;
      if (q.ua) next.webUserAgent = q.ua;
    }
    const i = list.findIndex((a) => a.id === next.id);
    if (i >= 0) {
      if (!next.apiKey) next.apiKey = list[i].apiKey;
      if (!next.webToken) { next.webToken = list[i].webToken; next.webCookie = list[i].webCookie; next.webUserAgent = list[i].webUserAgent; }
      next.webStatus = next.webStatus || list[i].webStatus || '';
      next.webLogin = next.webLogin || list[i].webLogin || '';
      list[i] = next;
    } else list.push(next);
    writeJsonFile('agents.json', list);
    return { ok: true, agent: { ...next, apiKey: undefined, hasKey: !!next.apiKey, webToken: undefined, webCookie: undefined, webUserAgent: undefined, hasWebToken: !!next.webToken } };
  });
  ipcMain.handle('agent-delete', (_e, id) => {
    writeJsonFile('agents.json', getAgents().filter((a) => a.id !== id));
    return { ok: true };
  });

  /* ---- 多账号管理（2026-11-26-7） ---- */
  ipcMain.handle('accounts-list', () => ({ ok: true, accounts: getAccounts().map(publicAccountView) }));
  ipcMain.handle('account-save', (_e, input) => {
    const a = (input && typeof input === 'object') ? input : {};
    const site = String(a.site || '').trim();
    const name = String(a.name || '').trim();
    if (!site) return { ok: false, error: '请先选择站点' };
    if (!name) return { ok: false, error: '请填写账号名称' };
    const list = getAccounts();
    const id = String(a.id || '').trim();
    const prev = id ? list.find((x) => x.id === id) : null;
    // 代理：不传 proxy 字段（或传 null）表示沿用旧的；传了 host 为空表示清除；
    // 传了 host 则设置（密码留空沿用旧密码）。不这样合并的话，只改名字
    // 的保存会把代理与指纹悄悄清空。
    let proxy = prev ? (prev.proxy || null) : null;
    if (a.proxy !== undefined && a.proxy !== null) {
      const rawProxy = (typeof a.proxy === 'object') ? a.proxy : null;
      if (rawProxy && String(rawProxy.host || '').trim()) {
        const port = Number(rawProxy.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: '代理端口须为 1-65535 的数字' };
        proxy = {
          type: rawProxy.type === 'socks5' ? 'socks5' : 'http',
          host: String(rawProxy.host).trim(),
          port,
          // 兼容 username/user、password/pass 两种写法。
          username: String(rawProxy.username || rawProxy.user || ''),
          password: String(rawProxy.password || rawProxy.pass || '') || (prev && prev.proxy ? String(prev.proxy.password || '') : ''),
        };
      } else {
        proxy = null;
      }
    }
    const resolved = resolveAccountSite({ site, siteName: a.siteName, loginUrl: a.loginUrl, signupUrl: a.signupUrl });
    const now = Date.now();
    const next = {
      ...(prev || {}),
      id: prev ? prev.id : `acc_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      site, siteName: resolved.siteName,
      loginUrl: resolved.loginUrl, signupUrl: resolved.signupUrl,
      name, group: String(a.group || '').trim(), note: String(a.note || ''),
      proxy,
      // 指纹：不传表示沿用旧的；传了按传的值算（空值即清除）。
      fingerprint: a.fingerprint === undefined ? (prev ? normalizeFingerprint(prev.fingerprint) : {}) : normalizeFingerprint(a.fingerprint),
      status: prev ? (prev.status === 'registering' ? 'registering' : 'active') : 'active',
      createdAt: prev ? (prev.createdAt || now) : now,
      lastUsedAt: prev ? (prev.lastUsedAt || null) : null,
    };
    if (prev) list[list.findIndex((x) => x.id === prev.id)] = next;
    else list.push(next);
    saveAccounts(list);
    return { ok: true, account: publicAccountView(next) };
  });
  ipcMain.handle('account-delete', async (_e, id) => {
    const accountId = String(id || '');
    saveAccounts(getAccounts().filter((a) => a.id !== accountId));
    try { await session.fromPartition(accountPartition(accountId)).clearStorageData(); } catch (e) { console.error('清除账号分区数据失败', accountId, e.message || String(e)); }
    try { fs.rmSync(accountDir(accountId), { recursive: true, force: true }); } catch (e) { /* 预载文件删不掉不拦删除 */ }
    const cfg = getConfig();
    if (cfg.activeAccountId === accountId) { cfg.activeAccountId = null; saveConfig(cfg); }
    return { ok: true };
  });
  ipcMain.handle('account-open', async (_e, id) => {
    const account = getAccounts().find((a) => a.id === String(id || ''));
    if (!account) return { ok: false, error: '账号不存在' };
    return openAccount(account, resolveAccountSite(account).loginUrl, '请先填写登录地址');
  });
  ipcMain.handle('account-close', () => {
    const cfg = getConfig();
    const activeId = cfg.activeAccountId;
    cfg.activeAccountId = null;
    saveConfig(cfg);
    // 关闭时若该账号正在注册，视为放弃本次注册：状态回 active，
    // 不写 lastRegisterAt（与取消注册一致）。
    if (activeId) {
      const list = getAccounts();
      const it = list.find((a) => a.id === activeId);
      if (it && it.status === 'registering') { it.status = 'active'; saveAccounts(list); }
    }
    return { ok: true };
  });
  ipcMain.handle('account-register-begin', async (_e, id) => {
    const list = getAccounts();
    const account = list.find((a) => a.id === String(id || ''));
    if (!account) return { ok: false, error: '账号不存在' };
    if (list.some((a) => a.id !== account.id && a.status === 'registering')) return { ok: false, error: '已有账号正在注册，请先完成或取消' };
    const cfg = getConfig();
    const intervalMin = Number(cfg.registerIntervalMin);
    const interval = Number.isFinite(intervalMin) ? intervalMin : 60;
    if (interval > 0 && cfg.lastRegisterAt) {
      const waitMs = interval * 60000 - (Date.now() - Number(cfg.lastRegisterAt));
      if (waitMs > 0) return { ok: false, error: `注册间隔未到，还需等待 ${Math.ceil(waitMs / 60000)} 分钟` };
    }
    const signupUrl = resolveAccountSite(account).signupUrl;
    if (!signupUrl) return { ok: false, error: '请先填写注册地址' };
    account.status = 'registering';
    saveAccounts(list);
    const opened = await openAccount(account, signupUrl, '请先填写注册地址');
    if (!opened.ok) { account.status = 'active'; saveAccounts(list); return opened; }
    return opened;
  });
  ipcMain.handle('account-register-done', (_e, id) => {
    const list = getAccounts();
    const account = list.find((a) => a.id === String(id || ''));
    if (!account) return { ok: false, error: '账号不存在' };
    account.status = 'active';
    saveAccounts(list);
    const cfg = getConfig();
    cfg.lastRegisterAt = Date.now();
    saveConfig(cfg);
    return { ok: true };
  });
  ipcMain.handle('account-register-cancel', (_e, id) => {
    const list = getAccounts();
    const account = list.find((a) => a.id === String(id || ''));
    if (!account) return { ok: false, error: '账号不存在' };
    account.status = 'active';
    saveAccounts(list);
    return { ok: true };
  });
  ipcMain.handle('agent-chats', () => getAgentChats()
    .map((c) => ({ ...c, messages: undefined }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  ipcMain.handle('agent-chat-get', (_e, id) => getAgentChats().find((c) => c.id === id) || null);
  ipcMain.handle('agent-chat-new', (_e, agentId) => {
    const chats = getAgentChats();
    const chat = { id: localId(), agentId, title: '新对话', messages: [], updatedAt: Date.now() };
    chats.push(chat);
    writeJsonFile('agent-chats.json', chats);
    return chat;
  });
  ipcMain.handle('agent-chat-send', (_e, chatId, content) => agentChatSend(chatId, content));
  ipcMain.handle('agent-chat-delete', (_e, id) => {
    writeJsonFile('agent-chats.json', getAgentChats().filter((c) => c.id !== id));
    return { ok: true };
  });
  ipcMain.handle('agent-complete', (_e, agentId, system, text) => agentComplete(agentId, system, text));
  ipcMain.handle('agent-web-verify', async (_e, agentId) => {
    const agent = getAgents().find((a) => a.id === agentId);
    if (!agent) return { ok: false, error: '智能体不存在' };
    if (agent.connectionType !== 'web') return { ok: false, error: '该智能体不是网页端连接方式' };
    return webVerifyAgent(agent);
  });
  /* ---- 2026-11-26-6：视频嗅探 / 下载 ---- */
  ipcMain.handle('video-engines-status', () => videoEnginesStatus());
  ipcMain.handle('video-engine-download', (_e, engine) => downloadVideoEngine(String(engine || '')));
  ipcMain.handle('video-sniff', (_e, url) => videoSniff(String(url || '')));
  ipcMain.handle('video-extract', (_e, url) => videoExtract(String(url || ''), 'auto'));
  ipcMain.handle('video-download', (_e, req) => videoDownloadStart(req || {}));
  ipcMain.handle('video-downloads-list', () => getVideoDownloads());
  ipcMain.handle('video-download-open', async (_e, file) => {
    const f = String(file || '');
    if (!f || !fs.existsSync(f)) return { ok: false, error: '文件不存在' };
    const err = await shell.openPath(f);
    return err ? { ok: false, error: err } : { ok: true };
  });
  /* ---- 2026-11-26-6：GitHub 已安装更新 ---- */
  ipcMain.handle('github-installed-updates', () => githubInstalledUpdates());
  /* ---- 2026-11-26-6：Pioneer ---- */
  ipcMain.handle('pioneer-status', () => pioneerPublic(pioneerLoad()));
  ipcMain.handle('pioneer-login', async (_e, creds) => {
    const username = String((creds && creds.username) || '').trim();
    const password = String((creds && creds.password) || '');
    if (!username || !password) return { ok: false, error: '先填 Pioneer 帐号和密码' };
    const login = await pioneerDoLogin(username, password);
    if (!login.ok) return login;
    const regions = await pioneerFetchRegions();
    return { ok: true, login: login.login, regions: regions.ok ? regions.regions : [] };
  });
  ipcMain.handle('pioneer-logout', () => {
    pioneerDisconnect();
    const s = pioneerLoad();
    s.token = ''; s.username = ''; s.password = ''; s.accountType = ''; s.dueTime = ''; s.regions = [];
    s.selectedCountryId = 0; s.selectedName = ''; s.node = null; s.nodeRaw = null;
    pioneerSave(s);
    pioneerLog('已退出 Pioneer 帐号');
    return { ok: true };
  });
  ipcMain.handle('pioneer-regions', () => pioneerFetchRegions());
  ipcMain.handle('pioneer-connect', (_e, req) => pioneerConnect(Number((req && req.countryId) || 0)));
  ipcMain.handle('pioneer-disconnect', () => pioneerDisconnect());
  ipcMain.handle('pioneer-set-mode', async (_e, mode) => {
    const m = String(mode || '');
    if (!['smart', 'global', 'tun'].includes(m)) return { ok: false, error: '模式只能是 smart / global / tun' };
    const s = pioneerLoad();
    s.proxyMode = m;
    pioneerSave(s);
    pioneerLog(`Pioneer 模式已切到 ${m}`);
    // 2026-11-27-3：已连接时切模式，内嵌浏览器代理按新模式重接管。
    if (s.connected && s.tunnelRunning) {
      const applied = await pioneerApplyBrowserProxy(m);
      if (!applied.ok) return { ok: false, error: `模式已保存，但内嵌浏览器代理同步失败：${applied.error}` };
    }
    return { ok: true };
  });
  ipcMain.handle('pioneer-logs', () => { const s = pioneerLoad(); return Array.isArray(s.logs) ? s.logs : []; });
  ipcMain.handle('pioneer-ip-check', async () => {
    // 2026-11-27-2：隧道进程在跑就走隧道验（不再要求 connected=true，
    // 否则一次验证失败后就再也验不了隧道了）；返回分清阶段。
    if (pioneerTunnelRunning()) {
      const r = await pioneerFetchExitIp();
      if (!r.ok) return { ok: false, stage: r.stage, reason: r.reason, error: r.reason, viaTunnel: true };
      // 2026-11-27-3：重验成功且之前未算已连接时，把连接状态补回来，
      // 内嵌浏览器代理重新接管（连接时出口验证失败曾复位过代理）。
      try {
        const st = pioneerLoad();
        if (!st.connected) {
          st.connected = true; st.exitIp = r.ip; st.lastError = ''; pioneerSave(st);
          const applied = await pioneerApplyBrowserProxy(st.proxyMode || 'smart');
          if (!applied.ok) pioneerLog(`出口 IP 验证通过，但内嵌浏览器代理同步失败：${applied.error}`);
        }
      } catch (e) { /* 状态补写失败不影响本次验证结果 */ }
      return { ok: true, ip: r.ip, stage: 'ok', viaTunnel: true };
    }
    const s = pioneerLoad();
    if (s.connected && s.tunnelRunning) {
      const r = await pioneerFetchExitIp();
      if (!r.ok) return { ok: false, stage: r.stage, reason: r.reason, error: r.reason, viaTunnel: true };
      return { ok: true, ip: r.ip, stage: 'ok', viaTunnel: true };
    }
    const r = await fetchText('https://api.ipify.org?format=json', { timeoutMs: 20000 });
    if (!r.ok) return { ok: false, stage: 'detector', reason: r.error || '检测失败', error: r.error || '检测失败', viaTunnel: false };
    try { return { ok: true, ip: JSON.parse(r.text).ip || '', stage: 'ok', viaTunnel: false }; }
    catch (e) { return { ok: false, stage: 'detector', reason: '出口 IP 返回无法解析', error: '出口 IP 返回无法解析', viaTunnel: false }; }
  });
  /* ---- 2026-11-26-6：监控提醒 ---- */
  ipcMain.handle('monitors-list', () => getMonitors());
  ipcMain.handle('monitor-save', (_e, monitor) => {
    const m = monitor || {};
    if (!m.name) return { ok: false, error: '先填监控名称' };
    if (!['webpage', 'app-version'].includes(m.kind)) return { ok: false, error: '监控类型只能是网页变化或软件版本' };
    if (!m.target) return { ok: false, error: '先填监控目标' };
    const list = getMonitors();
    const next = { ...m, id: m.id || localId(), intervalMin: Math.max(1, Number(m.intervalMin || 60)), enabled: m.enabled !== false };
    const i = list.findIndex((x) => x.id === next.id);
    if (i >= 0) { next.lastCheck = list[i].lastCheck; next.lastResult = list[i].lastResult; next.lastChange = list[i].lastChange; list[i] = next; }
    else list.push(next);
    saveMonitors(list);
    return { ok: true, monitor: next };
  });
  ipcMain.handle('monitor-delete', (_e, id) => { saveMonitors(getMonitors().filter((x) => x.id !== id)); return { ok: true }; });
  ipcMain.handle('monitor-run', async (_e, id) => {
    const m = getMonitors().find((x) => x.id === id);
    if (!m) return { ok: false, error: '监控不存在' };
    return runMonitorCheck(m);
  });
  /* ---- 2026-11-26-6：提示词模板 ---- */
  ipcMain.handle('prompts-list', () => readJsonList('prompts.json'));
  ipcMain.handle('prompt-save', (_e, prompt) => {
    if (!prompt || !prompt.name) return { ok: false, error: '先填提示词名称' };
    const list = readJsonList('prompts.json');
    const next = { ...prompt, id: prompt.id || localId() };
    const i = list.findIndex((x) => x.id === next.id);
    if (i >= 0) list[i] = next; else list.unshift(next);
    writeJsonList('prompts.json', list);
    return { ok: true, prompt: next };
  });
  ipcMain.handle('prompt-delete', (_e, id) => { writeJsonList('prompts.json', readJsonList('prompts.json').filter((x) => x.id !== id)); return { ok: true }; });
  /* ---- 2026-11-26-6：图片上传 / 改图 ---- */
  ipcMain.handle('image-upload', async () => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    try {
      fs.mkdirSync(imagesDir(), { recursive: true });
      const dest = path.join(imagesDir(), `upload-${Date.now()}${path.extname(picked.filePaths[0]).toLowerCase() || '.png'}`);
      fs.copyFileSync(picked.filePaths[0], dest);
      return { ok: true, file: dest };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('image-edit', (_e, req) => imageEdit(req || {}));
  ipcMain.handle('agent-trigger-save', (_e, agentId, trigger) => saveAgentTrigger(agentId, trigger));
  ipcMain.handle('agent-trigger-delete', (_e, agentId, triggerId) => deleteAgentTrigger(agentId, triggerId));
  ipcMain.handle('agent-trigger-run', (_e, agentId, triggerId) => runAgentTrigger(agentId, triggerId));
  ipcMain.handle('creation-list', () => readJsonList('creation.json'));
  ipcMain.handle('creation-save', (_e, item) => {
    const list = readJsonList('creation.json');
    list.unshift({ ...item, id: localId(), at: Date.now() });
    writeJsonList('creation.json', list.slice(0, 20));
    return { ok: true };
  });
  ipcMain.handle('creation-delete', (_e, id) => {
    writeJsonList('creation.json', readJsonList('creation.json').filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('snippets-list', () => readJsonList('snippets.json'));
  ipcMain.handle('snippet-save', (_e, item) => {
    const list = readJsonList('snippets.json');
    const next = { ...item, id: item.id || localId(), at: Date.now() };
    const i = list.findIndex((x) => x.id === next.id);
    if (i >= 0) list[i] = next; else list.unshift(next);
    writeJsonList('snippets.json', list);
    return { ok: true };
  });
  ipcMain.handle('snippet-delete', (_e, id) => {
    writeJsonList('snippets.json', readJsonList('snippets.json').filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('image-generate', (_e, prompt, size) => imageGenerate(prompt, size));
  ipcMain.handle('images-list', () => {
    try {
      const dir = imagesDir();
      if (!fs.existsSync(dir)) return { ok: true, dir, files: [] };
      const files = fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map((f) => path.join(dir, f)).sort().reverse();
      return { ok: true, dir, files };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('monitor-status', () => monitorStatus());
  ipcMain.handle('ledger-list', () => readJsonList('ledger.json'));
  ipcMain.handle('ledger-add', (_e, item) => {
    if (!item.amount || Number(item.amount) <= 0) return { ok: false, error: '金额须大于 0' };
    const list = readJsonList('ledger.json');
    list.unshift({ ...item, id: localId(), at: item.at ? Number(item.at) : Date.now(), amount: Number(item.amount) });
    writeJsonList('ledger.json', list);
    return { ok: true };
  });
  ipcMain.handle('ledger-export', () => {
    const list = readJsonList('ledger.json');
    const head = '日期,类型,分类,金额,备注\n';
    const body = list.map((x) => {
      const d = new Date(x.at || 0);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      return [ds, x.kind || '', x.category || '', Number(x.amount || 0).toFixed(2), x.note || ''].map(esc).join(',');
    }).join('\n');
    const file = path.join(defaultDownloadDir(), `工具箱账本-${new Date().toISOString().slice(0, 10)}.csv`);
    try { fs.writeFileSync(file, `\uFEFF${head}${body}`, 'utf8'); return { ok: true, file }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('ledger-delete', (_e, id) => {
    writeJsonList('ledger.json', readJsonList('ledger.json').filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('ledger-clear', () => { writeJsonList('ledger.json', []); return { ok: true }; });
  ipcMain.handle('register-list', () => {
    // 12 小时前的记录自动清理（与空间同一条规则，数据只在本地）
    const cutoff = Date.now() - 12 * 3600 * 1000;
    const list = readJsonList('register-records.json').filter((x) => (x.at || 0) >= cutoff);
    writeJsonList('register-records.json', list);
    return list;
  });
  ipcMain.handle('register-add', (_e, item) => {
    if (!item.target) return { ok: false, error: '先填号码或邮箱' };
    const list = readJsonList('register-records.json');
    const dup = list.some((x) => x.target === item.target);
    list.unshift({ ...item, id: localId(), at: Date.now() });
    writeJsonList('register-records.json', list.slice(0, 100));
    return { ok: true, dup };
  });
  ipcMain.handle('register-delete', (_e, id) => {
    writeJsonList('register-records.json', readJsonList('register-records.json').filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('register-clear', () => { writeJsonList('register-records.json', []); return { ok: true }; });
  ipcMain.handle('register-platforms-list', () => readJsonList('register-platforms.json'));
  ipcMain.handle('register-platform-add', (_e, item) => {
    if (!item.name) return { ok: false, error: '先填平台名称' };
    const list = readJsonList('register-platforms.json');
    list.unshift({ ...item, id: localId(), at: Date.now() });
    writeJsonList('register-platforms.json', list);
    return { ok: true };
  });
  ipcMain.handle('register-platform-delete', (_e, id) => {
    writeJsonList('register-platforms.json', readJsonList('register-platforms.json').filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('files-mkdir', (_e, dir, name) => {
    const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim();
    if (!clean) return { ok: false, error: '先填文件夹名称' };
    try { fs.mkdirSync(path.join(dir || defaultDownloadDir(), clean), { recursive: true }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('proxy-log-list', () => readJsonList('proxy-log.json'));
  ipcMain.handle('proxy-ip-check', async () => {
    const cfg = getConfig();
    const viaProxy = ['manual', 'smart', 'global'].includes(cfg.proxyMode) && !!cfg.proxyHost;
    const r = await httpJson('GET', 'https://api.ipify.org?format=json', null, {}, 20000);
    if (!r.ok) return { ok: false, error: r.error || '检测失败', viaProxy };
    return { ok: true, ip: r.data && r.data.ip, viaProxy, mode: cfg.proxyMode || 'direct' };
  });
  ipcMain.handle('files-list-dir', (_e, dir) => listDir(dir));
  ipcMain.handle('files-open-path', (_e, p) => shell.openPath(p).then((err) => (err ? { ok: false, error: err } : { ok: true })));
  ipcMain.handle('files-trash-path', (_e, p) => shell.trashItem(p).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message || String(e) })));
  ipcMain.handle('proxy-test', () => proxyTest());
  ipcMain.handle('remote-info', () => remoteInfo());
  /* v1.6.0：智能体工具调用确认 */
  ipcMain.handle('agent-tool-confirm', (_e, id, approved) => agentToolConfirm(String(id || ''), approved !== false));
  ipcMain.handle('agent-tool-pending', () => getPendingActions());
  /* v1.6.0：工具来源自定义 + 从本机已装程序导入 */
  ipcMain.handle('sources-custom-list', () => getCustomSources());
  ipcMain.handle('sources-custom-add', (_e, src) => addCustomSource(src || {}));
  ipcMain.handle('sources-custom-delete', (_e, id) => {
    const list = getCustomSources().filter((x) => x.id !== String(id));
    saveCustomSources(list);
    return { ok: true };
  });
  ipcMain.handle('sources-custom-toggle', (_e, id, enabled) => {
    const list = getCustomSources();
    const it = list.find((x) => x.id === String(id));
    if (!it) return { ok: false, error: '来源不存在' };
    it.enabled = enabled !== false;
    saveCustomSources(list);
    return { ok: true };
  });
  ipcMain.handle('sources-custom-register-winget', (_e, id) => registerCustomWingetSource(String(id || '')));
  ipcMain.handle('sources-import-installed', () => importInstalledPrograms());
  ipcMain.handle('sources-imported-list', () => readJsonFile('installed-import.json', []));
  /* v1.6.0：插件系统 */
  ipcMain.handle('plugins-list', () => getPlugins());
  ipcMain.handle('plugin-install-folder', async () => {
    const picked = await dialog.showOpenDialog(mainWin, { title: '选择插件文件夹（里面要有 manifest.json）', properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    return pluginInstallFromFolder(picked.filePaths[0]);
  });
  ipcMain.handle('plugin-install-github', (_e, ownerRepo) => pluginInstallFromGithub(String(ownerRepo || '')));
  ipcMain.handle('plugin-enable', (_e, id, enabled) => {
    const list = getPlugins();
    const it = list.find((x) => x.id === String(id));
    if (!it) return { ok: false, error: '插件不存在' };
    it.enabled = enabled !== false;
    savePlugins(list);
    return { ok: true };
  });
  ipcMain.handle('plugin-delete', (_e, id) => {
    const list = getPlugins().filter((x) => x.id !== String(id));
    savePlugins(list);
    try { fs.rmSync(pluginDirFor(String(id)), { recursive: true, force: true }); } catch (e) { /* 目录删不掉不影响 */ }
    return { ok: true };
  });
  ipcMain.handle('plugin-page-path', (_e, id) => {
    const p = getPlugins().find((x) => x.id === String(id));
    if (!p || !p.enabled || !p.page) return '';
    const fp = path.join(pluginDirFor(p.id), p.page);
    return fs.existsSync(fp) ? fp : '';
  });
  ipcMain.handle('plugin-call', (_e, id, method, args, confirmed) => pluginCall(String(id || ''), String(method || ''), args || {}, !!confirmed));
  /* v1.6.0：本地数据备份与同步 */
  ipcMain.handle('backup-export', async (_e, opts) => {
    const picked = await dialog.showSaveDialog(mainWin, {
      title: '导出工具箱数据备份',
      defaultPath: path.join(defaultDownloadDir(), `工具箱备份-${new Date().toISOString().slice(0, 10)}.toolboxbak`),
      filters: [{ name: '工具箱备份', extensions: ['toolboxbak'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    return writeBackupFile(picked.filePath, opts || {});
  });
  ipcMain.handle('backup-import', async () => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '导入工具箱数据备份',
      filters: [{ name: '工具箱备份', extensions: ['toolboxbak'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    return importBackupFile(picked.filePaths[0]);
  });
  ipcMain.handle('backup-import-password', (_e, file, password) => importBackupFile(String(file || ''), String(password || '')));
  ipcMain.handle('sync-set-folder', async () => {
    const picked = await dialog.showOpenDialog(mainWin, { title: '选择同步文件夹', properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    saveConfig({ ...getConfig(), syncFolder: picked.filePaths[0] });
    return { ok: true, folder: picked.filePaths[0] };
  });
  ipcMain.handle('sync-export', async (_e, opts) => {
    const folder = getConfig().syncFolder || '';
    if (!folder) return { ok: false, error: '先选一个同步文件夹' };
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `工具箱备份-${os.hostname()}-${stamp}.toolboxbak`;
    const r = await writeBackupFile(path.join(folder, name), opts || {});
    if (!r.ok) return r;
    try { await writeBackupFile(path.join(folder, '工具箱备份-latest.toolboxbak'), opts || {}); } catch (e) { /* latest 写失败不影响主备份 */ }
    return { ok: true, file: r.file };
  });
  ipcMain.handle('sync-list', () => {
    const folder = getConfig().syncFolder || '';
    if (!folder) return { ok: false, error: '先选一个同步文件夹', files: [] };
    let files = [];
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.toolboxbak')).map((f) => {
        const st = fs.statSync(path.join(folder, f));
        return { name: f, path: path.join(folder, f), size: st.size, mtime: st.mtimeMs };
      }).sort((a, b) => b.mtime - a.mtime);
    } catch (e) { return { ok: false, error: `同步文件夹读不到：${e.message}`, files: [] }; }
    return { ok: true, folder, files };
  });
  ipcMain.handle('sync-import', (_e, file) => importBackupFile(String(file || '')));
  ipcMain.handle('sync-import-password', (_e, file, password) => importBackupFile(String(file || ''), String(password || '')));
  ipcMain.handle('remote-regen-code', () => {
    const cfg = getConfig();
    cfg.remotePairCode = String(Math.floor(100000 + Math.random() * 900000));
    saveConfig(cfg);
    return { pairCode: cfg.remotePairCode };
  });
}

/* ---------------- 自检（截图） ---------------- */

async function runSelfTest() {
  const shotsDir = path.join(__dirname, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  createWindow();
  await new Promise((r) => mainWin.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 800));
  const screens = ['home', 'tools', 'player', 'browser', 'settings'];
  // 自测前给本地数据拍快照，结束时恢复（自测不污染本机数据）
  const snapshot = {
    agents: getAgents(), chats: getAgentChats(),
    ledger: readJsonList('ledger.json'), register: readJsonList('register-records.json'),
    registerPlatforms: readJsonList('register-platforms.json'),
    proxyLog: readJsonList('proxy-log.json'),
    creation: readJsonList('creation.json'), snippets: readJsonList('snippets.json'),
    mailtm: (() => { try { return fs.readFileSync(path.join(userDataDir(), 'mailtm.json'), 'utf8'); } catch (e) { return null; } })(),
    customSources: getCustomSources(), plugins: getPlugins(),
    installedImport: readJsonFile('installed-import.json', []),
    accounts: getAccounts(),
    activeAccountId: getConfig().activeAccountId || null,
    lastRegisterAt: getConfig().lastRegisterAt || 0,
    registerIntervalMin: (getConfig().registerIntervalMin ?? 60),
    pendingActions: getPendingActions(), syncFolder: getConfig().syncFolder || '',
    updateState: (() => { try { return fs.readFileSync(path.join(userDataDir(), 'update-state.json'), 'utf8'); } catch (e) { return null; } })(),
    spaceUrl: getConfig().spaceUrl || '', proxyMode: getConfig().proxyMode || 'direct',
    proxyHost: getConfig().proxyHost || '', proxyPort: getConfig().proxyPort || '',
    proxyServers: getConfig().proxyServers || [], ledgerCategories: getConfig().ledgerCategories || [],
    remoteEnabled: getConfig().remoteEnabled,
    // 2026-11-26-3：窗口与系统设置（自测里会改，结束时恢复）
    winSettings: {
      hardwareAcceleration: getConfig().hardwareAcceleration, notificationsEnabled: getConfig().notificationsEnabled,
      preventSleep: getConfig().preventSleep, alwaysOnTop: getConfig().alwaysOnTop,
      windowTransparent: getConfig().windowTransparent, closeToTray: getConfig().closeToTray,
      autoStart: getConfig().autoStart, windowBounds: getConfig().windowBounds,
      trayHideNotified: getConfig().trayHideNotified,
    },
  };
  const results = [];
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 900));
    const img = await mainWin.webContents.capturePage();
    const file = path.join(shotsDir, `toolbox-${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    results.push({ screen: name, file: path.basename(file), bytes: img.toPNG().length });
  };
  for (const s of screens) {
    mainWin.webContents.send('test-goto', s);
    await shot(s);
  }
  // 工具管理：工具来源页签
  mainWin.webContents.send('test-goto', 'tools');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-tab=sources]')?.click();");
  await shot('tools-sources');
  // 可更新 › 环境与依赖（最后一页）
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-tab=updates]')?.click(); document.querySelector('[data-subtab=env]')?.click();");
  await shot('tools-updates-env');
  // 播放器：点 VLC 图标进 VLC 窗口
  mainWin.webContents.send('test-goto', 'player');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-app-open=vlc]')?.click();");
  await shot('player-vlc');
  // 浏览器：点 Chromium 图标进 Chromium 窗口
  mainWin.webContents.send('test-goto', 'browser');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-app-open=chromium]')?.click();");
  await shot('browser-chromium');
  // 工具箱本地功能自检：菜单 16 项、最近栏只显示智能体对话、
  // 各本地页读写本机数据；空间只在点右下角悬浮圆点时打开。
  const js = (code) => mainWin.webContents.executeJavaScript(code);
  const clickMenu = async (key) => {
    await js(`document.querySelector('.menu-item[data-menu=${key}]')?.click();`);
    await new Promise((r) => setTimeout(r, 800));
  };
  const nativeCheck = {};
  // 2026-11-27-1：返回按历史（用户 2026-11-27 真机报障：浏览器页两个
  // 「‹ 工具箱」按钮点了都跳回工具箱总览）。场景 1：总览→工具管理→浏览器→
  // 点 Edge 进详情→页头「‹ 返回」应回浏览器列表，再点应回工具管理；
  // 场景 2：总览→工具管理→浏览器→页头返回应回工具管理；进扩展页→
  // 返回应回 Chromium 视图；点 ✕ 关闭 Chromium 应回列表且不丢历史。
  const backState = () => js(`(() => {
    const vis = (id) => { const e = document.querySelector(id); return e ? !e.classList.contains('hidden') : null; };
    return { screen: document.querySelector('.screen.active')?.id || '',
      list: vis('#browser-list-view'), chromium: vis('#browser-chromium-view'),
      ext: vis('#browser-chromium-ext-view'), other: vis('#browser-other-view'),
      otherName: document.querySelector('#other-browser-name')?.textContent || '',
      backBtns: document.querySelectorAll('#screen-browser [data-nav="back"]').length,
      oldBackBtns: document.querySelectorAll('[data-goto="home"]').length,
      backLabel: document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.textContent || '',
      headerSticky: getComputedStyle(document.querySelector('#screen-browser > .screen-head')).position };
  })()`);
  const waitFor = async (fn, ms = 5000) => {
    const t0 = Date.now();
    for (;;) { try { if (await fn()) return true; } catch (e) { /* 重试 */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 200)); }
  };
  await clickMenu('toolbox');
  await clickMenu('tools');
  await clickMenu('browser');
  await waitFor(() => js(`!!document.querySelector('[data-app-open="edge"]')`));
  await js(`document.querySelector('[data-app-open="edge"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s1a = await backState();
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s1b = await backState();
  await shot('backnav-s1-edge-back');
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s1c = await backState();
  await shot('backnav-s1-to-tools');
  nativeCheck.backNavS1 = { atEdgeDetail: s1a.other === true && s1a.otherName === 'Edge',
    oneBackOnly: s1a.backBtns === 1 && s1a.oldBackBtns === 0, backLabel: s1a.backLabel,
    headerSticky: s1a.headerSticky, backToList: s1b.screen === 'screen-browser' && s1b.list === true,
    backToTools: s1c.screen === 'screen-tools' };
  await clickMenu('toolbox');
  await clickMenu('tools');
  await clickMenu('browser');
  await waitFor(() => js(`!!document.querySelector('[data-app-open="chromium"]')`));
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2a = await backState();
  await clickMenu('browser');
  await waitFor(() => js(`!!document.querySelector('[data-app-open="chromium"]')`));
  await js(`document.querySelector('[data-app-open="chromium"]')?.click();`);
  await new Promise((r) => setTimeout(r, 800));
  await js(`document.querySelector('#chrome-ext-btn')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2b = await backState();
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2c = await backState();
  await shot('backnav-s2-ext-back');
  await js(`document.querySelector('#chrome-close')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2d = await backState();
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2e = await backState();
  await shot('backnav-s2-after-close');
  nativeCheck.backNavS2 = { backToTools: s2a.screen === 'screen-tools',
    atExt: s2b.ext === true, extBackToChromium: s2c.chromium === true,
    closeToList: s2d.screen === 'screen-browser' && s2d.list === true,
    backToToolsAfterClose: s2e.screen === 'screen-tools' };
  nativeCheck.menuItems = await js(`document.querySelectorAll('.menu-item').length`);
  nativeCheck.menuTitle = await js(`document.querySelector('.sidebar-title')?.textContent`);
  nativeCheck.bottomNavHasNewChat = await js(`!!document.querySelector('.nav-item[data-menu=newchat]')`);
  nativeCheck.bottomNavHasToolbox = await js(`!!document.querySelector('.nav-item[data-menu=toolbox]')`);
  // 智能体：保存智能体 → 新对话 → 最近栏出现
  await clickMenu('agents');
  await js(`document.querySelector('#agent-name').value='自测智能体'; document.querySelector('#agent-provider').value='deepseek'; document.querySelector('#agent-base').value='https://api.deepseek.com/v1'; document.querySelector('#agent-model').value='deepseek-chat'; document.querySelector('#agent-key').value='test-key'; document.querySelector('#agent-save').click();`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.agentsSaved = getAgents().length;
  await js(`(async () => { const list = await window.toolbox.agentsList(); const a = list[0]; await window.toolbox.agentSave({ ...a, apiKey: undefined, systemPrompt: '测试系统提示', memories: [{ id: 'm1', text: '用户喜欢简短回答', at: Date.now() }] }); await window.toolbox.agentTriggerSave(a.id, { name: '自测触发', kind: 'time', time: '23:59', prompt: '报时', enabled: true }); })()`);
  await new Promise((r) => setTimeout(r, 500));
  nativeCheck.agentSystemPrompt = getAgents()[0].systemPrompt || '';
  nativeCheck.agentMemoryCount = (getAgents()[0].memories || []).length;
  nativeCheck.agentTriggerCount = (getAgents()[0].triggers || []).length;
  nativeCheck.agentMemoryRows = await js(`(async () => { await renderAgentMemory(); return document.querySelectorAll('#agent-memory-list .row').length; })()`);
  nativeCheck.agentTriggerRows = await js(`(async () => { await renderAgentTriggers(); return document.querySelectorAll('#agent-trigger-list .row').length; })()`);
  await js(`newAgentChat()`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.chatsCreated = getAgentChats().length;
  nativeCheck.recentItems = await js(`document.querySelectorAll('#recent-list .recent-item').length`);
  await shot('agents');
  // 创作 / 代码 / 图像：验页面打开与新控件
  await clickMenu('create');
  nativeCheck.createScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.createTypeSelect = await js(`!!document.querySelector('#create-type')`);
  await js(`document.querySelector('#create-input').value='自测原文'; document.querySelector('#create-draft-save').click();`);
  await new Promise((r) => setTimeout(r, 500));
  nativeCheck.createDrafts = readJsonList('creation.json').length;
  await shot('create');
  await clickMenu('code');
  nativeCheck.codeScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.codeSearch = await js(`!!document.querySelector('#snippet-search')`);
  await shot('code');
  await clickMenu('image');
  nativeCheck.imageScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.imageStyle = await js(`!!document.querySelector('#image-style')`);
  await shot('image');
  // 记账本：记一笔 → 本地有记录（2026-11-26-6：前端已去掉记账本页，
  // 界面不存在时跳过 DOM 操作，改走 IPC 直接验证记账本数据不丢）
  if (await js(`!!document.querySelector('#ledger-add')`)) {
    await clickMenu('ledger');
    await js(`document.querySelector('#ledger-cat').value='餐饮'; document.querySelector('#ledger-amount').value='25.5'; document.querySelector('#ledger-add').click();`);
    await new Promise((r) => setTimeout(r, 600));
  } else {
    nativeCheck.ledgerUiSkipped = true;
    await js(`(async () => { await window.toolbox.ledgerAdd({ kind: '支出', category: '餐饮', amount: 25.5, note: '自测' }); })()`);
    await new Promise((r) => setTimeout(r, 300));
  }
  nativeCheck.ledgerCount = readJsonList('ledger.json').length;
  nativeCheck.ledgerCatTotals = await js(`document.querySelectorAll('#ledger-cat-totals .row').length`);
  nativeCheck.ledgerExport = await js(`(async () => { const r = await window.toolbox.ledgerExport(); return r; })()`);
  if (nativeCheck.ledgerExport && nativeCheck.ledgerExport.file) {
    nativeCheck.ledgerExportExists = fs.existsSync(nativeCheck.ledgerExport.file);
    try { fs.unlinkSync(nativeCheck.ledgerExport.file); } catch (e) { /* 删不掉不影响 */ }
  }
  await shot('ledger');
  // 注册：加两条，第二条重复号码应提示 dup
  await clickMenu('register');
  await js(`document.querySelector('#reg-target').value='13800000000'; document.querySelector('#reg-code').value='123456'; document.querySelector('#reg-add').click();`);
  await new Promise((r) => setTimeout(r, 500));
  nativeCheck.registerDupWarned = await js(`(async () => { const r = await window.toolbox.registerAdd({kind:'短信', target:'13800000000', code:'654321', note:''}); return r && r.dup; })()`);
  nativeCheck.registerCount = readJsonList('register-records.json').length;
  nativeCheck.registerTopbar = await js(`!!document.querySelector('#reg-extract') && !!document.querySelector('#reg-platform-select') && !!document.querySelector('#reg-auto')`);
  await js(`(async () => { await window.toolbox.registerPlatformAdd({ name: '自测平台', kind: 'sms', charge: '免费', loginRequired: false }); await renderRegister(); })()`);
  await new Promise((r) => setTimeout(r, 500));
  nativeCheck.registerPlatforms = await js(`document.querySelectorAll('#reg-platforms .app-card').length`);
  nativeCheck.registerHistoryHidden = await js(`document.getElementById('reg-history').classList.contains('hidden')`);
  await shot('register');
  // 监控 / 远程 / 文件
  await clickMenu('monitor');
  nativeCheck.monitorRows = await js(`document.querySelectorAll('#monitor-stats .row').length`);
  nativeCheck.monitorUsageRows = await js(`document.querySelectorAll('#monitor-usage .row').length`);
  nativeCheck.monitorProxyRows = await js(`document.querySelectorAll('#monitor-proxy .row').length`);
  await shot('monitor');
  await clickMenu('remote');
  nativeCheck.remoteCode = await js(`document.querySelector('#remote-code')?.textContent`);
  nativeCheck.remoteSessionsNote = await js(`document.querySelector('#remote-sessions')?.textContent.includes('暂无远程会话')`);
  nativeCheck.remoteAllow = await js(`!!document.querySelector('#remote-allow')`);
  await shot('remote');
  await clickMenu('files');
  await js(`renderFiles('/home/hatch/workspace/desktop-toolbox')`);
  await new Promise((r) => setTimeout(r, 600));
  nativeCheck.filesRows = await js(`document.querySelectorAll('#files-list .row').length`);
  await js(`document.querySelector('#files-search').value='toolbox'; document.querySelector('#files-search').dispatchEvent(new Event('input'));`);
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.filesSearchRows = await js(`document.querySelectorAll('#files-list .row').length`);
  await js(`document.querySelector('#files-search').value=''; document.querySelector('#files-search').dispatchEvent(new Event('input'));`);
  nativeCheck.filesMkdir = await js(`(async () => { const r = await window.toolbox.filesMkdir('/home/hatch/workspace/desktop-toolbox', '自测文件夹'); return r; })()`);
  await shot('files');
  // 代理：配一个打不通的代理，测试应明确失败（证明测试链路真实跑了）
  await clickMenu('proxy');
  await js(`document.querySelector('#proxy-mode').value='manual'; document.querySelector('#proxy-host').value='127.0.0.1'; document.querySelector('#proxy-port').value='9'; document.querySelector('#proxy-save').click();`);
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.proxyTestFailsClosedPort = (await proxyTest()).ok === false;
  nativeCheck.proxyModes = await js(`[...document.querySelectorAll('#proxy-mode option')].map((o) => o.value).join(',')`);
  nativeCheck.proxyLogRows = await js(`document.querySelectorAll('#proxy-log .row').length`);
  nativeCheck.proxyIpCheck = await js(`(async () => { const r = await window.toolbox.proxyIpCheck(); return r && (r.ok || !!r.error); })()`);
  await shot('proxy');
  // 媒体 / GitHub / 工具管理 / 播放器 / 浏览器菜单直达
  await clickMenu('media');
  nativeCheck.mediaScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.mediaList = await js(`!!document.querySelector('#media-list') && !!document.querySelector('#media-recent')`);
  await shot('media');
  await clickMenu('github');
  nativeCheck.githubScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.githubLoginCard = await js(`!!document.querySelector('#gh2-token')`);
  await shot('github');
  await clickMenu('tools');
  nativeCheck.toolsScreen = await js(`document.querySelector('.screen.active')?.id`);
  await clickMenu('player');
  nativeCheck.playerScreen = await js(`document.querySelector('.screen.active')?.id`);
  await clickMenu('browser');
  nativeCheck.browserScreen = await js(`document.querySelector('.screen.active')?.id`);
  // 底部导航「新对话」
  await js(`document.querySelector('.nav-item[data-menu=newchat]')?.click();`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.bottomNewChatScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.chatsAfterBottomNew = getAgentChats().length;
  // 空间：只在点右下角悬浮圆点时打开；未填地址显示填写卡
  saveConfig({ ...getConfig(), spaceUrl: '' });
  await js(`window.__spaceUrl='';`);
  nativeCheck.spaceFabExists = await js(`!!document.querySelector('#space-fab')`);
  nativeCheck.spaceMenuItemGone = await js(`!document.querySelector('.menu-item[data-menu=space]')`);
  await js(`document.querySelector('#space-fab')?.click();`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.spaceFabActive = await js(`document.querySelector('#space-fab')?.classList.contains('active')`);
  await shot('space-setup');
  nativeCheck.spaceSetupShown = await js(`!document.getElementById('space-setup').classList.contains('hidden')`);
  // 填本地替身地址：webview 能加载即为已连接
  const spaceServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>空间替身</title></head><body>空间</body></html>');
  });
  await new Promise((r) => spaceServer.listen(0, '127.0.0.1', r));
  const spaceTestUrl = `http://127.0.0.1:${spaceServer.address().port}/`;
  mainWin.webContents.send('test-goto', { screen: 'space', spaceUrl: spaceTestUrl });
  await new Promise((r) => setTimeout(r, 2500));
  nativeCheck.spaceNavState = await js(`document.getElementById('space-nav-state').textContent`);
  await shot('space');
  spaceServer.close();
  // 悬浮圆点再点一次应切回工具箱总览
  await js(`document.querySelector('#space-fab')?.click();`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.spaceFabToggleBack = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.spaceFabInactive = await js(`!document.querySelector('#space-fab')?.classList.contains('active')`);
  await shot('home-after-fab');
  // v1.5.0 真实实现自检
  // 代码运行：沙盒里有 Python 3 与 Node，跑一段真实代码看输出
  nativeCheck.codeInterpreters = await js(`(async () => { const l = await window.toolbox.codeInterpreters(); return l.map((x) => ({ key: x.key, found: x.found })); })()`);
  nativeCheck.codeRunPython = await js(`(async () => { const r = await window.toolbox.codeRun({ language: 'Python', code: 'print(6*7)' }); return r; })()`);
  nativeCheck.codeRunNode = await js(`(async () => { const r = await window.toolbox.codeRun({ language: 'Node', code: 'console.log(6*7)' }); return r; })()`);
  await shot('code-run');
  // 事件触发：文件变化监听——建监听目录，改动文件后应新建对话
  const watchDir = path.join(os.tmpdir(), 'toolbox-watch-test');
  fs.mkdirSync(watchDir, { recursive: true });
  const chatsBeforeWatch = getAgentChats().length;
  await js(`(async () => { const list = await window.toolbox.agentsList(); const a = list[0]; await window.toolbox.agentTriggerSave(a.id, { name: '自测文件触发', kind: 'file', path: '${watchDir}', prompt: '文件变了', enabled: true }); })()`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.eventTriggerStatus = await js(`(async () => { return window.toolbox.eventTriggerStatus(); })()`);
  fs.writeFileSync(path.join(watchDir, 'change.txt'), 'hello');
  await new Promise((r) => setTimeout(r, 4000));
  nativeCheck.eventFileTriggerFired = getAgentChats().length > chatsBeforeWatch;
  nativeCheck.eventTriggerStatusAfter = await js(`(async () => { return window.toolbox.eventTriggerStatus(); })()`);
  await shot('event-trigger');
  // Tun：沙盒是 Linux，应如实报不支持（不是假装可用）
  nativeCheck.tunStatus = await js(`(async () => { return window.toolbox.tunStatus(); })()`);
  // 发现软件：沙盒无 winget，应如实报不可用
  nativeCheck.wingetSearch = await js(`(async () => { return window.toolbox.wingetSearch('vlc'); })()`);
  // 注册 Mail.tm：先把代理恢复直连（前面代理自检配了个打不通的代理，
  // 不恢复的话 httpJson 会走那个死代理；真实使用时按用户自己的代理设置走）
  saveConfig({ ...getConfig(), proxyMode: 'direct', proxyHost: '', proxyPort: '' });
  // 注册 Mail.tm：尝试自动收码（沙盒联网可能失败，只记录结果不强求成功）
  nativeCheck.mailtmFetch = await js(`(async () => { try { const r = await window.toolbox.registerMailtmFetch(); return { ok: !!r.ok, account: r.account || '', error: r.error || '' }; } catch (e) { return { ok: false, error: e.message || String(e) }; } })()`);
  await shot('register-mailtm');
  // 远程画面服务：启动后用本机 HTTP 取首页与截图
  nativeCheck.remoteServer = await js(`(async () => { const r = await window.toolbox.remoteStart(); return r; })()`);
  if (nativeCheck.remoteServer && nativeCheck.remoteServer.ok) {
    const pair = (nativeCheck.remoteServer.pairCode || '');
    const get = (u) => new Promise((resolve) => {
      http.get(u, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, len: b.length, ct: res.headers['content-type'] })); }).on('error', (e) => resolve({ status: 0, error: e.message }));
    });
    nativeCheck.remotePageNoCode = await get('http://127.0.0.1:19876/');
    nativeCheck.remoteShot = await get(`http://127.0.0.1:19876/shot.jpg?code=${pair}`);
    nativeCheck.remoteShotWrongCode = await get('http://127.0.0.1:19876/shot.jpg?code=000000');
    await shot('remote-server');
    await js(`(async () => { await window.toolbox.remoteStop(); })()`);
  }
  // 图像：无密钥时应明确不可用（不编造图片）
  saveConfig({ ...getConfig(), imageApiKey: '', imageBaseUrl: '' });
  nativeCheck.imageNoKey = await js(`(async () => { const r = await window.toolbox.imageGenerate('一只猫', '1024x1024'); return r; })()`);
  // 自检页：检测本机项目
  nativeCheck.selfcheck = await js(`(async () => { return window.toolbox.selfcheckStatus(); })()`);
  await js(`document.querySelector('.menu-item[data-menu=toolbox]')?.click();`);
  await new Promise((r) => setTimeout(r, 500));
  await js(`document.querySelector('#sidebar-settings')?.click();`);
  await new Promise((r) => setTimeout(r, 800));
  await js(`(async () => { await renderSelfcheck(); })()`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.selfcheckRows = await js(`document.querySelectorAll('#selfcheck-list .row').length`);
  await shot('selfcheck');
  // v1.6.0 自检
  // 瘦身：沙盒里 Chromium 应明确未下载（不假装能打开），自检页同项应显示未下载
  nativeCheck.chromiumNotDownloaded = (await js(`(async () => { return window.toolbox.browserStatus(); })()`)).downloaded === false;
  nativeCheck.selfcheckChromium = (await js(`(async () => { return window.toolbox.selfcheckStatus(); })()`)).find((x) => x.key === 'chromium');
  // 智能体自然语言入口：跑代码（不需要密钥，本地意图直接走工具）
  nativeCheck.agentNlRunCode = await js(`(async () => { const chats = await window.toolbox.agentChats(); const r = await window.toolbox.agentChatSend(chats[0].id, '跑一下这段代码\\n\`\`\`python\\nprint(6*7)\\n\`\`\`'); return { ok: r.ok, last: (r.chat.messages[r.chat.messages.length - 1] || {}).content || '' }; })()`);
  // 危险操作：删文件要先待确认，取消后文件还在
  fs.writeFileSync('/tmp/toolbox-nl-delete.txt', 'x');
  nativeCheck.agentNlDeletePending = await js(`(async () => { const chats = await window.toolbox.agentChats(); const r = await window.toolbox.agentChatSend(chats[0].id, '删除文件 /tmp/toolbox-nl-delete.txt'); return { pending: !!r.pending, actionId: r.actionId || null }; })()`);
  nativeCheck.agentNlDeleteCancel = await js(`(async () => { const p = await window.toolbox.agentToolPending(); const id = p[0] && p[0].id; if (!id) return null; const r = await window.toolbox.agentToolConfirm(id, false); return { ok: r.ok, last: (r.chat.messages[r.chat.messages.length - 1] || {}).content || '' }; })()`);
  nativeCheck.nlDeleteFileStillExists = fs.existsSync('/tmp/toolbox-nl-delete.txt');
  try { fs.unlinkSync('/tmp/toolbox-nl-delete.txt'); } catch (e) { /* 删不掉不影响 */ }
  // 自定义来源：添加 → 列出 → 删除
  nativeCheck.customSourceAdd = await js(`(async () => { return window.toolbox.sourcesCustomAdd({ name: '自测源', type: 'url', address: 'https://example.com' }); })()`);
  nativeCheck.customSourceList = await js(`(async () => { return window.toolbox.sourcesCustomList(); })()`);
  await js(`(async () => { const l = await window.toolbox.sourcesCustomList(); const it = l.find((x) => x.name === '自测源'); if (it) await window.toolbox.sourcesCustomDelete(it.id); })()`);
  // 从本机已装程序导入（Linux 沙盒走 .desktop 扫描，只验链路）
  nativeCheck.importInstalled = await js(`(async () => { const r = await window.toolbox.sourcesImportInstalled(); return { ok: r.ok, count: r.count }; })()`);
  // 插件：从本机文件夹安装 → 允许的接口能调、没申请的被拒、危险调用要先确认
  const pluginDir160 = path.join(os.tmpdir(), 'toolbox-plugin-test');
  fs.mkdirSync(pluginDir160, { recursive: true });
  fs.writeFileSync(path.join(pluginDir160, 'manifest.json'), JSON.stringify({ name: '自测插件', version: '0.1.0', menuLabel: '自测插件', description: '自测', permissions: ['system.status', 'code.run'], page: 'page.html' }));
  fs.writeFileSync(path.join(pluginDir160, 'page.html'), '<!DOCTYPE html><html><body>自测插件</body></html>');
  nativeCheck.pluginInstall = await pluginInstallFromFolder(pluginDir160);
  const plugin160 = nativeCheck.pluginInstall && nativeCheck.pluginInstall.plugin;
  nativeCheck.pluginCallAllowed = plugin160 ? await pluginCall(plugin160.id, 'system.status', {}, false) : null;
  nativeCheck.pluginCallDenied = plugin160 ? await pluginCall(plugin160.id, 'files.list', {}, false) : null;
  nativeCheck.pluginCallDangerNeedsConfirm = plugin160 ? await pluginCall(plugin160.id, 'code.run', { language: 'Python', code: 'print(1)' }, false) : null;
  nativeCheck.pluginCallDangerConfirmed = plugin160 ? await pluginCall(plugin160.id, 'code.run', { language: 'Python', code: 'print(6*7)' }, true) : null;
  if (plugin160) { savePlugins(getPlugins().filter((x) => x.id !== plugin160.id)); try { fs.rmSync(pluginDirFor(plugin160.id), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ } }
  try { fs.rmSync(pluginDir160, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  // 2026-11-26-4：两个新插件（快捷启动、文件快搜）——从 plugins-dev
  // 文件夹安装 → 菜单出现 → 页面打开 → 新桥接口能调。
  const pluginTestFiles = [
    { dir: path.join(__dirname, 'plugins-dev', 'quick-launcher'), menu: '快捷启动' },
    { dir: path.join(__dirname, 'plugins-dev', 'fast-file-search'), menu: '文件快搜' },
  ];
  nativeCheck.newPlugins = [];
  for (const pt of pluginTestFiles) {
    const r = await pluginInstallFromFolder(pt.dir);
    const p = r && r.plugin;
    const rec = { dir: pt.dir, installed: !!(r && r.ok), id: p ? p.id : null, error: (r && r.error) || '' };
    if (p) {
      await js(`(async () => { await renderPluginsMenu(); })()`);
      rec.menuShown = await js(`!!document.querySelector('[data-menu="plugin:${p.id}"]')`);
      await js(`(async () => { await openPlugin('${p.id}'); })()`);
      await new Promise((rr) => setTimeout(rr, 1200));
      rec.pageSrc = await js(`document.querySelector('#plugin-frame')?.src || ''`);
      rec.pageIsHtml = String(rec.pageSrc).includes('page.html');
      await shot('plugin-' + p.id);
    }
    nativeCheck.newPlugins.push(rec);
  }
  // 快捷启动：apps.list 列出程序（Linux 沙盒走 .desktop 入口）
  const ql = nativeCheck.newPlugins[0];
  if (ql && ql.id) {
    const r = await pluginCall(ql.id, 'apps.list', {}, false);
    nativeCheck.quickLauncherApps = r && r.ok ? { count: (r.data || []).length, sample: (r.data || []).slice(0, 3).map((x) => x.name) } : r;
    nativeCheck.quickLauncherDenied = await pluginCall(ql.id, 'winget.search', { query: 'x' }, false);
  }
  // 文件快搜：在临时目录放一个带唯一名字的文件，搜它
  const fsTestDir = path.join(os.tmpdir(), 'toolbox-search-test');
  fs.mkdirSync(fsTestDir, { recursive: true });
  fs.writeFileSync(path.join(fsTestDir, 'toolbox-search-marker-7f3a9.txt'), 'hello');
  const fsr = nativeCheck.newPlugins[1];
  if (fsr && fsr.id) {
    const r = await pluginCall(fsr.id, 'files.search', { query: 'toolbox-search-marker-7f3a9', roots: [fsTestDir] }, false);
    nativeCheck.fastFileSearchFirst = r && r.ok ? { running: r.data.running, total: r.data.total, names: (r.data.results || []).map((x) => x.name) } : r;
    for (let i = 0; i < 20; i++) {
      const pg = await pluginCall(fsr.id, 'files.search', { offset: 0, limit: 50 }, false);
      if (pg && pg.ok && pg.data.done) { nativeCheck.fastFileSearchDone = { total: pg.data.total, names: (pg.data.results || []).map((x) => x.name) }; break; }
      await new Promise((rr) => setTimeout(rr, 300));
    }
    nativeCheck.fastFileSearchDenied = await pluginCall(fsr.id, 'apps.list', {}, false);
  }
  try { fs.rmSync(fsTestDir, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  // 清理两个新插件（恢复自测前状态）
  for (const rec of nativeCheck.newPlugins) {
    if (rec && rec.id) { savePlugins(getPlugins().filter((x) => x.id !== rec.id)); try { fs.rmSync(pluginDirFor(rec.id), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ } }
  }
  // 翻译插件：安装 → 菜单 → 页面 → 桥接口（agent.list / agent.complete /
  // plugin.store / translate.models / translate.offline / translate.software）
  // → GitHub 一键翻译按钮 → 右键菜单。
  const trInstall = await pluginInstallFromFolder(path.join(__dirname, 'plugins-dev', 'translation'));
  const tr = trInstall && trInstall.plugin;
  nativeCheck.translationPlugin = { installed: !!(trInstall && trInstall.ok), id: tr ? tr.id : null, error: (trInstall && trInstall.error) || '' };
  if (tr) {
    await js(`(async () => { await renderPluginsMenu(); })()`);
    nativeCheck.translationPlugin.menuShown = await js(`!!document.querySelector('[data-menu="plugin:${tr.id}"]')`);
    await js(`(async () => { await openPlugin('${tr.id}'); })()`);
    await new Promise((rr) => setTimeout(rr, 1500));
    const trSrc = await js(`document.querySelector('#plugin-frame')?.src || ''`);
    nativeCheck.translationPlugin.pageIsHtml = String(trSrc).includes('page.html');
    await shot('plugin-' + tr.id);
    // agent.list：只返回已配 key 的智能体，且不含 apiKey
    const al = await pluginCall(tr.id, 'agent.list', {}, false);
    nativeCheck.translationAgentList = al && al.ok ? { count: (al.data || []).length, names: (al.data || []).map((x) => x.name), hasApiKey: (al.data || []).some((x) => 'apiKey' in x) } : al;
    // agent.complete：用自测智能体的假 key 发一次调用——预期是接口/网络错误，
    // 错本身证明请求已按顺序发出（不是假装翻译）。
    const selfAgent = (al && al.ok && (al.data || []).find((x) => x.name === '自测智能体')) || null;
    if (selfAgent) {
      // 自测加 25 秒上限：沙盒到 api.deepseek.com 的请求可能挂满 httpJson
      // 的 120 秒超时，整个自测会被它拖过时限；超时的错本身也说明调用已发出。
      const ac = await Promise.race([
        pluginCall(tr.id, 'agent.complete', { agentId: selfAgent.id, system: '把以下文本翻译成中文，只返回译文。', text: 'hello world' }, false),
        new Promise((rr) => setTimeout(() => rr({ ok: false, error: '自测 25 秒未等到返回（调用已发出，后台请求可能仍在等接口）', selftestTimeout: true }), 25000)),
      ]);
      nativeCheck.translationAgentComplete = { ok: !!(ac && ac.ok), error: (ac && ac.error) || '', selftestTimeout: !!(ac && ac.selftestTimeout) };
    } else {
      nativeCheck.translationAgentComplete = { ok: false, error: '自测智能体不在 agent.list 里' };
    }
    // plugin.store：存取往返 + 插件间隔离（直接读另一个插件的 store 应为空）
    const st1 = await pluginCall(tr.id, 'plugin.store', { op: 'set', value: { selftest: 'tr-1' } }, false);
    const st2 = await pluginCall(tr.id, 'plugin.store', { op: 'get' }, false);
    nativeCheck.translationStore = { setOk: !!(st1 && st1.ok), getValue: st2 && st2.ok ? st2.data : st2, otherPluginGet: pluginStoreGet('quick-launcher') };
    // translate.models：目录在、未装为空
    const ml = await pluginCall(tr.id, 'translate.models', { op: 'list' }, false);
    nativeCheck.translationModelsList = ml && ml.ok ? { engineInstalled: !!ml.data.engine.installed, catalogCount: (ml.data.catalog || []).length, installedCount: (ml.data.installed || []).length } : ml;
    // 下载流程：本地服务器给一个只含 metadata.json 的假 zip，
    // 验下载 → 解压 → 校验 → 出现在已装列表 → 删除。
    const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
    const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const makeStoredZip = (files) => {
      const parts = []; const central = []; let offset = 0;
      for (const f of files) {
        const name = Buffer.from(f.name, 'utf8'); const data = Buffer.from(f.content, 'utf8');
        const crc = crc32(data);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
        parts.push(lh, name, data);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
        central.push(ch, name);
        offset += 30 + name.length + data.length;
      }
      const cd = Buffer.concat(central);
      const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
      return Buffer.concat([...parts, cd, eocd]);
    };
    const fakeZip = makeStoredZip([{ name: 'metadata.json', content: JSON.stringify({ name: 'English to Chinese', from: 'en', to: 'zh', version: '1.9' }) }]);
    const zipSrv = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fakeZip.length }); res.end(fakeZip); });
    await new Promise((r) => zipSrv.listen(0, '127.0.0.1', r));
    const zipUrl = `http://127.0.0.1:${zipSrv.address().port}/en-zh.argosmodel`;
    try {
      const dl = await pluginCall(tr.id, 'translate.models', { op: 'download', key: 'en-zh', url: zipUrl }, false);
      nativeCheck.translationModelDownload = { started: !!(dl && dl.ok), error: (dl && dl.error) || '' };
      let installedAfter = null;
      for (let i = 0; i < 20; i++) {
        const l2 = await pluginCall(tr.id, 'translate.models', { op: 'list' }, false);
        if (l2 && l2.ok && (l2.data.installed || []).some((m) => m.key === 'en-zh')) { installedAfter = l2.data.installed.find((m) => m.key === 'en-zh'); break; }
        if (l2 && l2.ok && l2.data.downloads && l2.data.downloads['en-zh'] && l2.data.downloads['en-zh'].error) { installedAfter = { error: l2.data.downloads['en-zh'].error }; break; }
        await new Promise((rr) => setTimeout(rr, 500));
      }
      nativeCheck.translationModelInstalled = installedAfter;
      // 离线翻译：模型已装，但沙盒没装 argostranslate 引擎——预期是引擎缺失错误
      const off = await pluginCall(tr.id, 'translate.offline', { text: 'hello', from: 'en', to: 'zh' }, false);
      nativeCheck.translationOffline = { ok: !!(off && off.ok), needEngine: !!(off && off.needEngine), error: (off && off.error) || '' };
      const del = await pluginCall(tr.id, 'translate.models', { op: 'delete', key: 'en-zh' }, false);
      nativeCheck.translationModelDelete = { ok: !!(del && del.ok) };
    } finally { try { zipSrv.close(); } catch (e) { /* 关不掉不影响 */ } }
    // translate.software：沙盒 Linux 上应为空数组
    const sw = await pluginCall(tr.id, 'translate.software', {}, false);
    nativeCheck.translationSoftware = sw && sw.ok ? { count: (sw.data || []).length } : sw;
    // 发现软件列表一键翻译按钮存在（2026-11-26-6：GitHub 专页已并入发现软件）
    nativeCheck.translationGhButton = await js(`!!document.querySelector('#discover-list')`);
    // 右键菜单：在发现软件列表放一行英文简介，选中后发右键菜单，点菜单应打开翻译插件
    await js(`(async () => { gotoScreen('tools'); const box = document.querySelector('#discover-list'); box.className='list'; box.innerHTML=''; const wrap=document.createElement('div'); wrap.className='row'; const main=document.createElement('div'); main.className='row-main'; const title=document.createElement('div'); title.className='row-title'; title.textContent='selftest/repo'; main.appendChild(title); const sub=document.createElement('div'); sub.className='row-sub'; sub.textContent='A tiny test repository for translation. · ★ 1'; main.appendChild(sub); wrap.appendChild(main); box.appendChild(wrap); })()`);
    await new Promise((rr) => setTimeout(rr, 300));
    const menuShown = await js(`(() => { const sub = document.querySelector('#discover-list .row-sub'); const sel = window.getSelection(); sel.selectAllChildren(sub); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }); sub.dispatchEvent(ev); return !!document.querySelector('.translate-menu'); })()`);
    nativeCheck.translationContextMenu = { shown: menuShown };
    if (menuShown) {
      await js(`document.querySelector('.translate-menu').click()`);
      let opened = false;
      for (let i = 0; i < 16; i++) {
        await new Promise((rr) => setTimeout(rr, 500));
        const t = await js(`document.querySelector('#plugin-title')?.textContent || ''`);
        if (String(t) === '翻译') { opened = true; break; }
      }
      nativeCheck.translationContextMenu.clickedOpensPlugin = opened;
      await js(`(async () => { const box = document.querySelector('#discover-list'); if (box) box.innerHTML = ''; })()`);
    }
  }
  // 清理翻译插件与它的插件状态、模型目录（恢复自测前状态）
  if (tr) {
    savePlugins(getPlugins().filter((x) => x.id !== tr.id));
    try { fs.rmSync(pluginDirFor(tr.id), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    try { fs.rmSync(path.join(pluginStoreDir(), tr.id + '.json'), { force: true }); } catch (e) { /* 删不掉不影响 */ }
    try { fs.rmSync(modelsDir(), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  }
  // 备份与同步：导出 → 导入；加密备份错密码打不开、对密码能打开；同步文件夹写出并列出
  const backupFile160 = path.join(os.tmpdir(), 'toolbox-selftest.toolboxbak');
  nativeCheck.backupExport = await writeBackupFile(backupFile160, {});
  nativeCheck.backupImport = await importBackupFile(backupFile160);
  const encFile160 = path.join(os.tmpdir(), 'toolbox-selftest-enc.toolboxbak');
  await writeBackupFile(encFile160, { password: 'test123' });
  nativeCheck.backupImportWrongPassword = await importBackupFile(encFile160, 'wrong');
  nativeCheck.backupImportRightPassword = await importBackupFile(encFile160, 'test123');
  const syncDir160 = path.join(os.tmpdir(), 'toolbox-sync-test');
  fs.mkdirSync(syncDir160, { recursive: true });
  saveConfig({ ...getConfig(), syncFolder: syncDir160 });
  nativeCheck.syncExport = await writeBackupFile(path.join(syncDir160, '工具箱备份-test.toolboxbak'), {});
  nativeCheck.syncList = (() => { try { return fs.readdirSync(syncDir160).filter((f) => f.endsWith('.toolboxbak')); } catch (e) { return []; } })();
  nativeCheck.syncImport = await importBackupFile(path.join(syncDir160, '工具箱备份-test.toolboxbak'));
  await shot('settings-backup');
  // 2026-11-26-2：设置页更新区——代码热更新。
  // (1) 真实仓库目前还没有 update-manifest.json，检查应如实
  // 显示「未找到更新信息」，不崩、不谎报已是最新；没文件可
  // 更新时点「一键更新」应如实拒绝。
  mainWin.webContents.send('test-goto', 'settings');
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.updateSectionPresent = await js(`!!document.querySelector('#update-check') && !!document.querySelector('#update-download')`);
  nativeCheck.updateCheck = await js(`(async () => { const r = await window.toolbox.updateCheck(); await renderUpdateSection(); return r; })()`);
  nativeCheck.updateStatusText = await js(`document.querySelector('#update-result')?.textContent || ''`);
  nativeCheck.updateApplyWithoutFiles = await js(`(async () => { const r = await window.toolbox.updateApply(); return r; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await js(`document.querySelector('#update-check')?.scrollIntoView({ block: 'center' });`);
  await new Promise((r) => setTimeout(r, 500));
  await shot('settings-update');
  // (2) 本地模拟热更新：起一个本地服务器，清单里只有 main.js
  // 改了（DISPLAY 改成 -sim），其余 5 个文件哈希与本机一致，
  // 走一遍只下载改动文件的流程：应只下载 main.js、校验通过、
  // 旧文件有备份；再起一个新进程，看它读到的是不是新版本
  //（重启后新代码生效）；最后把 main.js 从备份恢复。
  const simDir = path.join(os.tmpdir(), 'toolbox-update-sim');
  const sim = { server: null, url: '' };
  try {
    fs.rmSync(simDir, { recursive: true, force: true });
    fs.mkdirSync(simDir, { recursive: true });
    const origMain = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    fs.writeFileSync(path.join(simDir, 'main.js.orig'), origMain, 'utf8');
    const origSha = crypto.createHash('sha256').update(origMain).digest('hex');
    // 2026-11-27-3：模拟版本号从当前版本 +1 推导（-27-3 → -27-4），
    // 下次升版不用再手动改写死的模拟版本号。
    const simParts = String(DISPLAY_VERSION).split('-');
    const simVersion = `${simParts.slice(0, 3).join('-')}-${(Number(simParts[3]) || 0) + 1}`;
    const simInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) + 1}`);
    const simMain = origMain.replace(`const DISPLAY_VERSION = '${DISPLAY_VERSION}';`, `const DISPLAY_VERSION = '${simVersion}-sim';`);
    if (simMain === origMain) throw new Error('模拟文件没改动：DISPLAY_VERSION 替换失败');
    fs.writeFileSync(path.join(simDir, 'main.js'), simMain, 'utf8');
    const simSha = crypto.createHash('sha256').update(simMain).digest('hex');
    const simFiles = [{ path: 'main.js', sha256: simSha, size: Buffer.byteLength(simMain) }];
    for (const rel of HOT_UPDATE_FILES.slice(1)) {
      const full = path.join(__dirname, rel);
      simFiles.push({ path: rel, sha256: await sha256File(full), size: fs.statSync(full).size });
    }
    // 模拟清单的版本号必须是比当前新的版本，否则检查会认为已是
    // 最新、模拟跑不起来（2026-11-26-3 自测就因此没跑成模拟更新；
    // 2026-11-27-3 第一轮也因此只跑了检查、没跑成应用）。
    // 这里直接从当前版本 +1 推导，不再写死，下次升版不用再改。
    const simManifest = { version: simVersion, internalVersion: simInternal, displayVersion: simVersion, notes: '自测模拟清单', files: simFiles };
    fs.writeFileSync(path.join(simDir, 'update-manifest.json'), JSON.stringify(simManifest, null, 2), 'utf8');
    sim.server = http.createServer((req, res) => {
      const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\//, ''));
      const fp = path.join(simDir, name === 'update-manifest.json' ? 'update-manifest.json' : name);
      if (!fp.startsWith(simDir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200);
      fs.createReadStream(fp).pipe(res);
    });
    await new Promise((r) => sim.server.listen(0, '127.0.0.1', r));
    sim.url = `http://127.0.0.1:${sim.server.address().port}/update-manifest.json`;
    nativeCheck.updateSimCheck = await js(`(async () => { const r = await window.toolbox.updateCheck({ manifestUrl: ${JSON.stringify(sim.url)} }); await renderUpdateSection(); return r; })()`);
    nativeCheck.updateSimApply = await js(`(async () => { const r = await window.toolbox.updateApply(); await renderUpdateSection(); return r; })()`);
    const appliedMain = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    nativeCheck.updateSimFileChanged = appliedMain.includes(`const DISPLAY_VERSION = '${simVersion}-sim';`);
    nativeCheck.updateSimBackupExists = await (async () => {
      const st = getUpdateState();
      const bak = path.join(st.backupDir || '', 'main.js');
      if (!bak || !fs.existsSync(bak)) return false;
      return fs.readFileSync(bak, 'utf8') === origMain;
    })();
    nativeCheck.updateSimOnlyOneFile = Array.isArray(nativeCheck.updateSimCheck?.state?.changedFiles)
      && nativeCheck.updateSimCheck.state.changedFiles.length === 1
      && nativeCheck.updateSimCheck.state.changedFiles[0].path === 'main.js';
    // 重启验证：起一个全新 Electron 进程读新 main.js 的版本号。
    nativeCheck.updateSimRestartVersion = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['.', '--print-version'], { cwd: __dirname, env: { ...process.env, DISPLAY: ':99', ELECTRON_DISABLE_SANDBOX: '1' } });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', () => { /* 忽略 dbus/gpu 噪音 */ });
      const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 已退出 */ } resolve(`timeout:${out.trim()}`); }, 60000);
      child.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
      child.on('error', (e) => { clearTimeout(timer); resolve(`spawn-error:${e.message}`); });
    });
  } catch (e) {
    nativeCheck.updateSimError = e.message || String(e);
  } finally {
    try { if (sim.server) sim.server.close(); } catch (e) { /* 关不掉不影响 */ }
    // 无论成败，把 main.js 恢复成自测前的原样。
    try {
      const orig = fs.readFileSync(path.join(simDir, 'main.js.orig'), 'utf8');
      fs.writeFileSync(path.join(__dirname, 'main.js'), orig, 'utf8');
      nativeCheck.updateSimRestored = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') === orig;
    } catch (e) { nativeCheck.updateSimRestored = false; }
    try { fs.rmSync(simDir, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    try { const st = getUpdateState(); if (st.backupDir) fs.rmSync(st.backupDir, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    // 2026-11-27-3：自测状态是合并写入，finally 也要清掉模拟清单的
    // manifestUrl/manifest，否则下次真实检查会沿用已关闭的本地
    // 模拟服务器地址（之前 update-state.json 里就残留过 127.0.0.1:45201）。
    saveUpdateState({ pendingRestart: false, updatedFiles: [], changedFiles: [], totalBytes: 0, manifestUrl: '', manifest: null, latestVersion: '', latestDisplayVersion: '', lastCheckResult: '', lastCheckMessage: '' });
  }
  // 2026-11-26-3：私有仓库时检查更新要带 GitHub 令牌拉清单——
  // 本地服务器验请求头：没配令牌不带 Authorization，配了要带上。
  nativeCheck.updateAuthHeader = await (async () => {
    const auths = [];
    const srv = http.createServer((req, res) => {
      auths.push(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '2026-11-26-6', internalVersion: '2026.11.26-6', displayVersion: '2026-11-26-6', files: [] }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/update-manifest.json`;
    const prevToken = getConfig().githubToken || '';
    try {
      saveConfig({ ...getConfig(), githubToken: '' });
      const noToken = await fetchUpdateManifest(url);
      saveConfig({ ...getConfig(), githubToken: 'selftest-fake-token' });
      const withToken = await fetchUpdateManifest(url);
      return { noTokenOk: !!noToken.ok, noTokenAuth: auths[0] || '', withTokenOk: !!withToken.ok, withTokenAuth: auths[1] || '' };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
    finally { saveConfig({ ...getConfig(), githubToken: prevToken }); try { srv.close(); } catch (e) { /* 关不掉不影响 */ } }
  })();
  // 悬浮圆点拖动：模拟指针拖动，位置应变且存入 localStorage
  nativeCheck.fabDrag = await js(`(() => {
    const fab = document.querySelector('#space-fab');
    if (!fab) return { ok: false, error: '无圆点' };
    const r0 = fab.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    fab.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 1, bubbles: true }));
    fab.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 80, clientY: cy - 60, pointerId: 1, bubbles: true }));
    fab.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 80, clientY: cy - 60, pointerId: 1, bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('space-fab-pos') || 'null');
    return { ok: true, left: fab.style.left, top: fab.style.top, saved };
  })()`);
  await shot('fab-dragged');
  // 窗口与系统（2026-11-26-3）：标题栏、托盘、设置开关、通知/防休眠、崩溃重载
  mainWin.webContents.send('test-goto', 'settings');
  await new Promise((r) => setTimeout(r, 600));
  // 2026-11-26-6 B4：顶部黑条已去掉，窗口按钮改成悬浮的
  // #win-min/#win-max/#win-close；前端未落地时该项跳过不计失败。
  nativeCheck.titlebar = await js(`(() => {
    const min = document.querySelector('#win-min');
    const max = document.querySelector('#win-max');
    const close = document.querySelector('#win-close');
    if (!min && !max && !close) return { skipped: true, reason: '悬浮窗口按钮未落地' };
    return {
      min: !!min, max: !!max, close: !!close,
      version: document.querySelector('#titlebar-version')?.textContent || document.querySelector('#app-version')?.textContent || '',
    };
  })()`);
  nativeCheck.tray = { created: !!globalThis.__trayCreated, error: globalThis.__trayError || '' };
  nativeCheck.windowStatus = await js(`(async () => window.toolbox.windowStatus())()`);
  // 设置开关读写往返（改完恢复原值）
  nativeCheck.winSettingsRoundTrip = await js(`(async () => {
    const before = await window.toolbox.getConfig();
    await window.toolbox.setConfig({ hardwareAcceleration: false, notificationsEnabled: false, preventSleep: true, alwaysOnTop: true, windowTransparent: false, closeToTray: false, autoStart: false });
    const mid = await window.toolbox.getConfig();
    await window.toolbox.setConfig({ hardwareAcceleration: before.hardwareAcceleration, notificationsEnabled: before.notificationsEnabled, preventSleep: before.preventSleep, alwaysOnTop: before.alwaysOnTop, windowTransparent: before.windowTransparent, closeToTray: before.closeToTray, autoStart: before.autoStart });
    const after = await window.toolbox.getConfig();
    return {
      mid: { hw: mid.hardwareAcceleration, notify: mid.notificationsEnabled, sleep: mid.preventSleep, top: mid.alwaysOnTop, trans: mid.windowTransparent, tray: mid.closeToTray, start: mid.autoStart },
      restored: after.hardwareAcceleration === before.hardwareAcceleration && after.closeToTray === before.closeToTray,
    };
  })()`);
  // 通知与防休眠调用不报错
  nativeCheck.notifyCall = (() => { try { return { ok: notify('自测通知', '这是一条自测通知'), supported: Notification.isSupported() }; } catch (e) { return { ok: false, error: e.message }; } })();
  nativeCheck.sleepBlockCall = (() => { try { acquireSleepBlock('self-test'); const on = sleepBlockerId != null; releaseSleepBlock('self-test'); return { ok: true, started: on }; } catch (e) { return { ok: false, error: e.message }; } })();
  nativeCheck.progressBarCall = (() => { try { setTaskbarProgress(0.5); setTaskbarProgress(-1); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } })();
  // 窗口位置保存：改一次 bounds，等防抖写盘后核对 config
  mainWin.setBounds({ x: 60, y: 60, width: 1000, height: 700 });
  await new Promise((r) => setTimeout(r, 900));
  nativeCheck.windowBoundsSaved = getConfig().windowBounds;
  // 模拟崩溃重载：真的让渲染进程崩溃，看自动重载是否恢复
  nativeCheck.crashSim = await (async () => {
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: '超时未恢复' }), 15000);
      mainWin.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve({ ok: true }); });
    });
    try { mainWin.webContents.forcefullyCrashRenderer(); } catch (e) { return { ok: false, error: e.message || String(e) }; }
    return done;
  })();
  await new Promise((r) => setTimeout(r, 500));
  const crashLogNow = readJsonFile('crash-log.json', []);
  nativeCheck.crashLogCount = Array.isArray(crashLogNow) ? crashLogNow.length : 0;
  nativeCheck.crashLogLast = Array.isArray(crashLogNow) && crashLogNow.length ? crashLogNow[crashLogNow.length - 1] : null;
  nativeCheck.crashRecoveredScreen = await js(`document.querySelector('.screen.active')?.id`);
  await shot('settings-window');
  // 协议 open?tool= 与 .toolboxbak 文件参数（2026-11-26-3）
  const protoOpenCode = handleProtocolUrl('muse-toolbox://open?tool=code');
  await new Promise((r) => setTimeout(r, 600));
  nativeCheck.protocolOpenCode = { result: protoOpenCode, activeScreen: await js(`document.querySelector('.screen.active')?.id`) };
  const protoOpenUnknown = handleProtocolUrl('muse-toolbox://open?tool=notexist');
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.protocolOpenUnknown = { result: protoOpenUnknown, activeScreen: await js(`document.querySelector('.screen.active')?.id`) };
  nativeCheck.findToolboxbakArg = {
    hit: findToolboxbakArg(['electron', '.', 'C:\\Users\\x\\a.toolboxbak']),
    miss: findToolboxbakArg(['electron', '.', 'muse-toolbox://play?url=x']),
    miss2: findToolboxbakArg(['electron', '.']),
  };
  const bakTmp = path.join(os.tmpdir(), `toolbox-selftest-${Date.now().toString(36)}.toolboxbak`);
  fs.writeFileSync(bakTmp, JSON.stringify(collectBackup(false)), 'utf8');
  const bakBefore = readJsonFile('ledger.json', []);
  nativeCheck.toolboxbakDryRun = await handleToolboxbakFile(bakTmp, { dryRun: true });
  nativeCheck.toolboxbakNoWrite = JSON.stringify(readJsonFile('ledger.json', [])) === JSON.stringify(bakBefore);
  try { fs.unlinkSync(bakTmp); } catch (e) { /* 删不掉不影响 */ }
  // 2026-11-26-7：多账号管理——保存/列表/编辑往返/分区隔离/注册拦截/备份排除
  nativeCheck.accounts = {};
  const acct = nativeCheck.accounts;
  const acctIds = [];
  try {
    const saveA = await js(`(async () => { return window.toolbox.accountSave({ site: 'google', name: '自测谷歌号', group: '自测', note: '自测', proxy: { type: 'http', host: '127.0.0.1', port: 18080, username: 'u1', password: 'p1' }, fingerprint: { userAgent: 'TestUA/1.0', language: 'zh-CN', timezone: 'Asia/Shanghai', windowWidth: 1280, windowHeight: 800 } }); })()`);
    acct.saveGoogle = !!(saveA && saveA.ok);
    if (saveA && saveA.account) acctIds.push(saveA.account.id);
    const saveB = await js(`(async () => { return window.toolbox.accountSave({ site: 'github', name: '自测号B' }); })()`);
    acct.saveGithub = !!(saveB && saveB.ok);
    if (saveB && saveB.account) acctIds.push(saveB.account.id);
    const listA = await js(`(async () => { return window.toolbox.accountsList(); })()`);
    const rowA = (listA.accounts || []).find((a) => a.name === '自测谷歌号');
    acct.listCount = (listA.accounts || []).length;
    acct.listHasSignupUrl = !!(rowA && rowA.signupUrl);
    acct.listProxyStructured = !!(rowA && rowA.proxy && rowA.proxy.host === '127.0.0.1' && rowA.proxy.port === 18080 && rowA.proxy.username === 'u1');
    acct.listNoPassword = !JSON.stringify(listA).includes('p1');
    if (rowA) {
      // 编辑往返：只改名字，代理与密码应完整保留
      const edit = await js(`(async () => { return window.toolbox.accountSave({ id: '${rowA.id}', site: 'google', name: '自测谷歌号改名' }); })()`);
      acct.editKeepsProxy = !!(edit && edit.ok);
      const stored = getAccounts().find((a) => a.id === rowA.id);
      acct.editProxyKept = !!(stored && stored.proxy && stored.proxy.host === '127.0.0.1' && stored.proxy.password === 'p1');
      // user/pass 别名
      const alias = await js(`(async () => { return window.toolbox.accountSave({ id: '${rowA.id}', site: 'google', name: '自测谷歌号改名', proxy: { type: 'http', host: '127.0.0.1', port: 18081, user: 'u2', pass: 'p2' } }); })()`);
      const stored2 = getAccounts().find((a) => a.id === rowA.id);
      acct.aliasAccepted = !!(alias && alias.ok && stored2 && stored2.proxy && stored2.proxy.username === 'u2' && stored2.proxy.password === 'p2');
    }
    // 分区隔离：A 分区设 cookie，B 分区读不到
    const sesA = session.fromPartition(`persist:account-${acctIds[0]}`);
    const sesB = session.fromPartition(`persist:account-${acctIds[1]}`);
    await sesA.cookies.set({ url: 'https://example.com', name: 't', value: 'A' });
    const cookiesB = await sesB.cookies.get({ url: 'https://example.com' });
    acct.partitionIsolated = (cookiesB || []).filter((c) => c.name === 't').length === 0;
    // 打开：有指纹的给 preload 与视口，无指纹的不给
    const openA = await js(`(async () => { return window.toolbox.accountOpen('${acctIds[0]}'); })()`);
    acct.openGoogle = !!(openA && openA.ok && openA.open && openA.open.partition === `persist:account-${acctIds[0]}`);
    acct.openPreload = !!(openA && openA.open && String(openA.open.preloadFileUrl || '').startsWith('file://'));
    acct.openViewport = !!(openA && openA.open && openA.open.viewport && openA.open.viewport.w === 1280);
    let preloadText = '';
    try { preloadText = fs.readFileSync(path.join(userDataDir(), 'accounts', acctIds[0], 'preload.js'), 'utf8'); } catch (e) { /* 没有文件也算一项 */ }
    acct.preloadNoSecrets = !!preloadText && preloadText.includes('Asia/Shanghai') && !preloadText.includes('p1') && !preloadText.includes('u2');
    const openB = await js(`(async () => { return window.toolbox.accountOpen('${acctIds[1]}'); })()`);
    acct.openGithubNoPreload = !!(openB && openB.ok && !openB.open.preloadFileUrl && !openB.open.viewport);
    // 注册拦截：间隔未到被拒；开始后关闭账号，状态应回 active
    await js(`(async () => { await window.toolbox.setConfig({ registerIntervalMin: 60, lastRegisterAt: Date.now() }); })()`);
    const beginBlocked = await js(`(async () => { return window.toolbox.accountRegisterBegin('${acctIds[0]}'); })()`);
    acct.registerIntervalBlocked = !!(beginBlocked && beginBlocked.ok === false);
    await js(`(async () => { await window.toolbox.setConfig({ lastRegisterAt: 0 }); })()`);
    const beginOk = await js(`(async () => { return window.toolbox.accountRegisterBegin('${acctIds[0]}'); })()`);
    acct.registerBegin = !!(beginOk && beginOk.ok);
    acct.registeringStatus = getAccounts().find((a) => a.id === acctIds[0])?.status === 'registering';
    await js(`(async () => { await window.toolbox.accountClose(); })()`);
    acct.closeResetsRegistering = getAccounts().find((a) => a.id === acctIds[0])?.status === 'active';
    // 备份不含 accounts.json
    acct.backupExcludesAccounts = !Object.prototype.hasOwnProperty.call(collectBackup(false).files, 'accounts.json');
    // 账号管理页渲染
    await clickMenu('accounts');
    acct.screen = await js(`document.querySelector('.screen.active')?.id`);
    acct.menuItem = await js(`!!document.querySelector('.menu-item[data-menu=accounts]')`);
    acct.rows = await js(`document.querySelectorAll('#account-list .row').length`);
    await shot('accounts');
  } catch (e) { acct.error = e.message || String(e); }
  // 清理自测账号（accountDelete 会清分区与 preload 目录）
  for (const id of acctIds) { try { await js(`(async () => { await window.toolbox.accountDelete('${id}'); })()`); } catch (e) { /* 删不掉不影响 */ } }
  acct.cleaned = getAccounts().filter((a) => acctIds.includes(a.id)).length === 0;
  // 清理自测写入的本地数据，恢复到自测前
  writeJsonFile('accounts.json', snapshot.accounts);
  writeJsonFile('agents.json', snapshot.agents);
  writeJsonFile('agent-chats.json', snapshot.chats);
  writeJsonList('ledger.json', snapshot.ledger);
  writeJsonList('register-records.json', snapshot.register);
  writeJsonList('register-platforms.json', snapshot.registerPlatforms);
  writeJsonList('proxy-log.json', snapshot.proxyLog);
  writeJsonList('creation.json', snapshot.creation);
  writeJsonList('snippets.json', snapshot.snippets);
  writeJsonFile('custom-sources.json', snapshot.customSources);
  writeJsonFile('plugins.json', snapshot.plugins);
  writeJsonFile('installed-import.json', snapshot.installedImport);
  writeJsonFile('pending-actions.json', snapshot.pendingActions);
  try { fs.rmSync(path.join(userDataDir(), 'plugins'), { recursive: true, force: true }); } catch (e) { /* 自测插件目录删不掉不影响 */ }
  try { fs.rmdirSync(path.join(__dirname, '自测文件夹')); } catch (e) { /* 自测文件夹删不掉不影响 */ }
  saveConfig({ ...getConfig(), ...snapshot.winSettings, spaceUrl: snapshot.spaceUrl, proxyMode: snapshot.proxyMode, proxyHost: snapshot.proxyHost, proxyPort: snapshot.proxyPort, proxyServers: snapshot.proxyServers, ledgerCategories: snapshot.ledgerCategories, remoteEnabled: snapshot.remoteEnabled, syncFolder: snapshot.syncFolder, activeAccountId: snapshot.activeAccountId, lastRegisterAt: snapshot.lastRegisterAt, registerIntervalMin: snapshot.registerIntervalMin });
  try { fs.rmSync(path.join(userDataDir(), 'crash-log.json'), { force: true }); } catch (e) { /* 崩溃日志删不掉不影响 */ }
  try { fs.rmSync(path.join(os.tmpdir(), 'toolbox-watch-test'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  try { if (snapshot.mailtm) fs.writeFileSync(path.join(userDataDir(), 'mailtm.json'), snapshot.mailtm); else fs.rmSync(path.join(userDataDir(), 'mailtm.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { if (snapshot.updateState) fs.writeFileSync(path.join(userDataDir(), 'update-state.json'), snapshot.updateState); else fs.rmSync(path.join(userDataDir(), 'update-state.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { fs.rmSync(path.join(userDataDir(), 'code-runs'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  remoteStop();
  // 2026-11-26-7 后端（沙盒可验部分；真 Windows 行为见汇报）：
  // 转移拦截用假 Windows 环境验纯逻辑；默认目录验纯函数与
  // 文件页默认；图标验查表、图片校验、缓存往返与非 Windows 兜底。
  nativeCheck.moveGuard = (() => {
    const fakeEnv = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData', USERPROFILE: 'C:\\Users\\test', PUBLIC: 'C:\\Users\\Public', APPDATA: 'C:\\Users\\test\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', CommonProgramFiles: 'C:\\Program Files\\Common Files', 'CommonProgramFiles(x86)': 'C:\\Program Files (x86)\\Common Files' };
    const fakeOpts = { env: fakeEnv, toolsDir: 'D:\\Toolbox\\data\\tools', userDataDir: 'D:\\Toolbox\\data', exeDir: 'D:\\Toolbox' };
    const cases = {
      driveRoot: 'C:\\', windows: 'C:\\Windows', system32: 'C:\\Windows\\System32',
      programFiles: 'C:\\Program Files', programFilesX86: 'C:\\Program Files (x86)',
      programData: 'C:\\ProgramData', programDataApp: 'C:\\ProgramData\\Foo',
      usersRoot: 'C:\\Users', userProfile: 'C:\\Users\\test', documents: 'C:\\Users\\test\\Documents',
      appData: 'C:\\Users\\test\\AppData', commonFiles: 'C:\\Program Files\\Common Files',
      windowsApps: 'C:\\Program Files\\WindowsApps', toolboxData: 'D:\\Toolbox\\data',
      toolsDir: 'D:\\Toolbox\\data\\tools', exeDir: 'D:\\Toolbox',
    };
    const allowed = { vlc: 'C:\\Program Files\\VideoLAN\\VLC', chrome: 'C:\\Program Files\\Google\\Chrome', dApp: 'D:\\Apps\\Foo', localPrograms: 'C:\\Users\\test\\AppData\\Local\\Programs\\Foo' };
    const out = {};
    for (const [k, p] of Object.entries(cases)) out[k] = !!moveSourceBlockedReason(p, fakeOpts);
    for (const [k, p] of Object.entries(allowed)) out[`allow_${k}`] = moveSourceBlockedReason(p, fakeOpts) === null;
    return out;
  })();
  // 2026-11-27-2 后端（沙盒可验部分；真 Windows 行为见汇报）：
  // 路径改写纯函数、安装目录后备链、管理员检测解析、出口验证分阶段、
  // 快捷方式/注册表改写的注入式自测、视频引擎扫描。
  nativeCheck.move20261127 = await (async () => {
    const r = {};
    // 1) 路径改写纯函数
    r.rewriteUnder = rewritePathUnderDir('C:\\Program Files\\Foo\\bin\\app.exe', 'C:\\Program Files\\Foo', 'D:\\Toolbox\\tools\\moved\\Foo') === 'D:\\Toolbox\\tools\\moved\\Foo\\bin\\app.exe';
    r.rewriteEqual = rewritePathUnderDir('C:\\Program Files\\Foo', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === 'D:\\X\\Foo';
    r.rewriteNotUnder = rewritePathUnderDir('C:\\Program Files\\Bar\\app.exe', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === null;
    r.rewriteCaseInsensitive = rewritePathUnderDir('c:\\program files\\foo\\app.exe', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === 'D:\\X\\Foo\\app.exe';
    r.rewriteCmdQuoted = rewritePathInCommandLine('"C:\\Program Files\\Foo\\uninstall.exe" /S', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === '"D:\\X\\Foo\\uninstall.exe" /S';
    r.rewriteCmdMsi = rewritePathInCommandLine('msiexec.exe /I{11111111-2222-3333-4444-555555555555}', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === null;
    r.rewriteCmdUnquoted = rewritePathInCommandLine('C:\\Program Files\\Foo\\app.exe --flag', 'C:\\Program Files\\Foo', 'D:\\X\\Foo') === 'D:\\X\\Foo\\app.exe --flag';
    r.displayIconParse = parseDisplayIconPath('C:\\Program Files\\Foo\\app.exe,0') === 'C:\\Program Files\\Foo\\app.exe';
    r.exeDirBareMsi = exeDirFromCommand('msiexec.exe /I{11111111-2222-3333-4444-555555555555}') === '';
    // 2) 安装目录后备链（注入 existsDir：只认夹具里的目录存在）
    const fakeExists = new Set(['C:\\Program Files\\Foo', 'C:\\Apps\\Bar', 'D:\\Short\\Cut', 'E:\\Winget\\App']);
    const existsDir = (p) => fakeExists.has(path.win32.normalize(p));
    const t1 = await resolveInstallDir({ name: 'Foo', installLocation: '', uninstallString: 'msiexec.exe /I{11111111-2222-3333-4444-555555555555}', displayIcon: 'C:\\Program Files\\Foo\\app.exe,0' }, { existsDir, getShortcutTarget: async () => '', getWingetLocation: async () => '' });
    r.resolveViaDisplayIcon = t1.ok && t1.resolvedVia === 'displayIcon' && t1.path === 'C:\\Program Files\\Foo';
    const t2 = await resolveInstallDir({ name: 'Bar', installLocation: '', uninstallString: '"C:\\Apps\\Bar\\uninstall.exe" /S', displayIcon: '' }, { existsDir, getShortcutTarget: async () => '', getWingetLocation: async () => '' });
    r.resolveViaUninstallString = t2.ok && t2.resolvedVia === 'uninstallString' && t2.path === 'C:\\Apps\\Bar';
    const t3 = await resolveInstallDir({ name: 'Cut', installLocation: '', uninstallString: '', displayIcon: '' }, { existsDir, getShortcutTarget: async () => 'D:\\Short\\Cut\\cut.exe', getWingetLocation: async () => '' });
    r.resolveViaShortcut = t3.ok && t3.resolvedVia === 'shortcut' && t3.path === 'D:\\Short\\Cut';
    const t4 = await resolveInstallDir({ name: 'WApp', installLocation: '', uninstallString: '', displayIcon: '' }, { existsDir, getShortcutTarget: async () => '', getWingetLocation: async () => 'E:\\Winget\\App' });
    r.resolveViaWinget = t4.ok && t4.resolvedVia === 'winget' && t4.path === 'E:\\Winget\\App';
    const t5 = await resolveInstallDir({ name: 'Nope', installLocation: '', uninstallString: '', displayIcon: '' }, { existsDir, getShortcutTarget: async () => '', getWingetLocation: async () => '' });
    r.resolveNoneReason = !t5.ok && t5.resolvedVia === 'none' && /注册表无 InstallLocation/.test(t5.reason) && /未找到指向该应用的快捷方式/.test(t5.reason) && /winget 未返回安装位置/.test(t5.reason);
    const t6 = await resolveInstallDir({ name: 'Foo', installLocation: 'C:\\Program Files\\Foo', uninstallString: '', displayIcon: '' }, { existsDir, getShortcutTarget: async () => '', getWingetLocation: async () => '' });
    r.resolveViaInstallLocation = t6.ok && t6.resolvedVia === 'installLocation';
    r.psPathConvert = psPathToRegPath('Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}') === 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}';
    // 3) 快捷方式 / 注册表改写（注入假实现，验改写逻辑本身）
    const fakeLinks = new Map([
      ['C:\\Users\\test\\Desktop\\Foo.lnk', { target: 'C:\\Program Files\\Foo\\app.exe', workdir: 'C:\\Program Files\\Foo', icon: 'C:\\Program Files\\Foo\\app.exe,0' }],
      ['C:\\Users\\test\\Desktop\\Bar.lnk', { target: 'C:\\Other\\bar.exe', workdir: '', icon: '' }],
    ]);
    const sc = await updateShortcutsForMove('C:\\Program Files\\Foo', 'D:\\X\\Foo', {
      listShortcuts: async () => [...fakeLinks.entries()].map(([lnk, v]) => ({ lnk, ...v })),
      setShortcuts: async (jobs) => { for (const j of jobs) { const cur = fakeLinks.get(j.lnk); if (cur) { cur.target = j.target; if (j.workdir) cur.workdir = j.workdir; if (j.icon) cur.icon = j.icon; } } return jobs.map((j) => ({ lnk: j.lnk, ok: true })); },
    });
    r.shortcutsUpdatedOne = sc.updated.length === 1 && sc.updated[0].target === 'D:\\X\\Foo\\app.exe' && sc.failed.length === 0;
    r.shortcutsTargetRewritten = fakeLinks.get('C:\\Users\\test\\Desktop\\Foo.lnk').target === 'D:\\X\\Foo\\app.exe';
    r.shortcutsWorkdirRewritten = fakeLinks.get('C:\\Users\\test\\Desktop\\Foo.lnk').workdir === 'D:\\X\\Foo';
    const scFail = await updateShortcutsForMove('C:\\Program Files\\Foo', 'D:\\X\\Foo', {
      listShortcuts: async () => [{ lnk: 'C:\\X\\Foo.lnk', target: 'C:\\Program Files\\Foo\\app.exe', workdir: '', icon: '' }],
      setShortcuts: async () => [{ lnk: 'C:\\X\\Foo.lnk', ok: false, error: '拒绝访问（需要管理员权限）' }],
    });
    r.shortcutsFailedKept = scFail.updated.length === 0 && scFail.failed.length === 1 && /拒绝访问/.test(scFail.failed[0].reason);
    const fakeReg = new Map([
      ['InstallLocation', { type: 'REG_SZ', data: 'C:\\Program Files\\Foo' }],
      ['UninstallString', { type: 'REG_SZ', data: '"C:\\Program Files\\Foo\\uninstall.exe" /S' }],
      ['DisplayIcon', { type: 'REG_SZ', data: 'C:\\Program Files\\Foo\\app.exe,0' }],
      ['DisplayName', { type: 'REG_SZ', data: 'Foo' }],
      ['QuietUninstallString', { type: 'REG_SZ', data: 'C:\\Program Files\\Foo\\uninstall.exe /quiet' }],
    ]);
    const rg = await updateRegistryForMove('C:\\Program Files\\Foo', 'D:\\X\\Foo', { registryKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo' }, {
      readValues: async () => [...fakeReg.entries()].map(([name, v]) => ({ name, ...v })),
      setValue: async (_k, name, _t, data) => { fakeReg.get(name).data = data; return { ok: true }; },
    });
    r.registryUpdatedCount = rg.updated.length === 4 && rg.failed.length === 0;
    r.registryValuesRewritten = fakeReg.get('InstallLocation').data === 'D:\\X\\Foo' && fakeReg.get('UninstallString').data === '"D:\\X\\Foo\\uninstall.exe" /S' && fakeReg.get('DisplayIcon').data === 'D:\\X\\Foo\\app.exe,0';
    const rgNoKey = await updateRegistryForMove('C:\\Program Files\\Foo', 'D:\\X\\Foo', { registryKey: '' }, {});
    r.registryNoKeyFailed = rgNoKey.updated.length === 0 && rgNoKey.failed.length === 1 && /卸载项键路径/.test(rgNoKey.failed[0].reason);
    // 4) 管理员检测（沙盒为 Linux：应返回 unsupported-platform；另验两个解析器夹具）
    const adm = await checkAdminWindows();
    r.adminNonWindows = adm.isAdmin === false && adm.method === 'unsupported-platform';
    r.adminPrincipalTrue = parseAdminPrincipalOutput('True\r\n') === true;
    r.adminPrincipalFalse = parseAdminPrincipalOutput('False\r\n') === false;
    r.whoamiElevated = parseWhoamiGroups('BUILTIN\\Administrators  Alias  S-1-5-32-544  Mandatory group, Enabled by default, Enabled') === true;
    r.whoamiDenyOnly = parseWhoamiGroups('BUILTIN\\Administrators  Alias  S-1-5-32-544  Mandatory group, Enabled by default, Deny only') === false;
    r.whoamiAbsent = parseWhoamiGroups('BUILTIN\\Users  Alias  S-1-5-32-545  Mandatory group, Enabled by default, Enabled') === false;
    // 5) 出口验证分阶段
    r.egressClassifyProxy = classifyEgressError('代理连接失败：connect ECONNREFUSED 127.0.0.1:19352') === 'proxy';
    r.egressClassifyNode = classifyEgressError('代理拒绝连接：HTTP/1.1 502 Bad Gateway') === 'node';
    r.egressClassifyDetector = classifyEgressError('HTTP 429') === 'detector';
    r.egressParseJson = parseEgressIp('{"ip":"1.2.3.4"}') === '1.2.3.4';
    r.egressParseText = parseEgressIp('1.2.3.4\n') === '1.2.3.4';
    const probeDirect = await (async () => {
      const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ip: '9.9.9.9' })); });
      await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
      const port = srv.address().port;
      try { return await pioneerProbeDetector({ url: `http://127.0.0.1:${port}/`, kind: 'json' }, null, 5000); }
      finally { try { srv.close(); } catch (e) { /* 忽略 */ } }
    })();
    r.egressProbeDirectOk = probeDirect.ok === true && probeDirect.ip === '9.9.9.9' && probeDirect.stage === 'ok';
    const probeClosed = await pioneerProbeDetector({ url: 'https://api.ipify.org?format=json', kind: 'json' }, { host: '127.0.0.1', port: 1 }, 5000);
    r.egressProbeClosedProxy = probeClosed.ok === false && probeClosed.stage === 'proxy';
    const probeBadProxy = await (async () => {
      const srv = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not a proxy'); });
      await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
      const port = srv.address().port;
      try { return await pioneerProbeDetector({ url: 'https://api.ipify.org?format=json', kind: 'json' }, { host: '127.0.0.1', port }, 5000); }
      finally { try { srv.close(); } catch (e) { /* 忽略 */ } }
    })();
    r.egressProbeBadProxyNode = probeBadProxy.ok === false && probeBadProxy.stage === 'node';
    const fetchInjected = await pioneerFetchExitIp({
      probeFn: async (det) => (det.url.includes('first') ? { ok: false, stage: 'detector', reason: '检测服务 first 返回 HTTP 429' } : { ok: true, ip: '5.6.7.8', stage: 'ok', reason: '' }),
      detectors: [{ url: 'https://first.example/', kind: 'json' }, { url: 'https://second.example/', kind: 'json' }],
    });
    r.egressFetchFallback = fetchInjected.ok === true && fetchInjected.ip === '5.6.7.8';
    const fetchAllFail = await pioneerFetchExitIp({
      probeFn: async () => ({ ok: false, stage: 'detector', reason: '检测服务返回 HTTP 500' }),
      detectors: [{ url: 'https://a.example/', kind: 'json' }, { url: 'https://b.example/', kind: 'json' }],
    });
    r.egressFetchAllFailStage = fetchAllFail.ok === false && fetchAllFail.stage === 'detector' && Array.isArray(fetchAllFail.attempts) && fetchAllFail.attempts.length === 2;
    // 6) 视频引擎扫描（临时假目录，不碰真实 tools/video）
    const tmpVideo = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-video-test-'));
    try {
      fs.writeFileSync(path.join(tmpVideo, 'yt-dlp.exe'), 'fake');
      fs.writeFileSync(path.join(tmpVideo, 'N_m3u8DL-RE.exe'), 'fake');
      const engs = await listVideoEngines({ dir: tmpVideo, skipVersion: true });
      r.videoEnginesFound = engs.length === 2;
      const yt = engs.find((e) => e.id === 'video-engine-yt-dlp');
      r.videoEngineYtShape = !!yt && yt.name === 'yt-dlp' && yt.kind === 'video-engine' && yt.source === 'video-engine' && yt.path === path.join(tmpVideo, 'yt-dlp.exe') && yt.version === '未知' && !!yt.versionNote;
      const nm = engs.find((e) => e.id === 'video-engine-n-m3u8dl-re');
      r.videoEngineNmShape = !!nm && nm.name === 'N_m3u8DL-RE';
      r.videoEnginesSorted = engs[0].id === 'video-engine-yt-dlp';
    } finally { try { fs.rmSync(tmpVideo, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
    return r;
  })();
  nativeCheck.defaultDir = {
    unsetIsToolboxDir: resolveDefaultDownloadDir('') === userDataDir(),
    userSetKept: resolveDefaultDownloadDir('D:\\Downloads') === 'D:\\Downloads',
    filesListDefault: listDir('').dir === defaultDownloadDir(),
    filesDefaultIsConfig: listDir('').dir === getConfig().downloadDir,
  };
  nativeCheck.appIcons = await (async () => {
    const r = {};
    r.tableVlc = (resolveOfficialIconUrl({ id: 'VideoLAN.VLC', name: 'VLC media player', source: 'winget' }) || {}).url || '';
    r.tableByName = (resolveOfficialIconUrl({ id: '', name: '微信', source: 'winget' }) || {}).url || '';
    r.githubAvatar = (resolveOfficialIconUrl({ id: 'videolan/vlc', name: 'vlc', source: 'github' }) || {}).url || '';
    r.unknownHasNoIcon = resolveOfficialIconUrl({ id: 'Some.Random.App', name: '随机软件', source: 'winget' }) === null;
    r.unknownDiscover = await resolveDiscoverIcon({ id: 'Some.Random.App', name: '随机软件', source: 'winget' });
    const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    r.fixtureValid = validateIconBuffer(png1x1) === 'png';
    r.fixtureInvalid = validateIconBuffer(Buffer.from('not-an-image')) === null;
    const key = iconCacheKey('self-test-fixture');
    const file = path.join(appIconsDir(), `${key}.png`);
    try {
      fs.mkdirSync(appIconsDir(), { recursive: true });
      fs.writeFileSync(file, png1x1);
      const dataUrl = iconDataUrlForFile(file);
      r.cacheRoundTrip = dataUrl.startsWith('data:image/png;base64,');
      r.cacheFileExists = fs.existsSync(file);
    } catch (e) { r.cacheRoundTrip = false; r.cacheError = e.message || String(e); }
    r.installedNonWindows = await getInstalledAppIcon('/tmp/fake.exe');
    r.installedNoExe = await getInstalledAppIcon('');
    return r;
  })();
  // 2026-11-26-7：Anthropic 走 Messages API（本地桩服务验证请求形状，不联网）
  nativeCheck.anthropic = await (async () => {
    const r = {};
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ url: req.url, method: req.method, apiKey: req.headers['x-api-key'] || '', version: req.headers['anthropic-version'] || '', auth: req.headers.authorization || '', body });
        if (req.url === '/messages') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: [{ type: 'text', text: '你好' }] }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
        }
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const a = await agentChatCompletions({ provider: 'anthropic', baseUrl: base, model: 'claude-fable-5-2', apiKey: 'sk-ant-test' },
        [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }]);
      const hit = seen[0] || {};
      r.urlIsMessages = hit.url === '/messages';
      r.apiKeyHeader = hit.apiKey === 'sk-ant-test';
      r.versionHeader = hit.version === '2023-06-01';
      r.noBearer = !hit.auth;
      let parsed = {};
      try { parsed = JSON.parse(hit.body || '{}'); } catch (e) { parsed = {}; }
      r.systemTopLevel = parsed.system === 'sys';
      r.messagesNoSystem = Array.isArray(parsed.messages) && parsed.messages.every((m) => m.role !== 'system');
      r.text = !!(a && a.ok && a.text === '你好');
      seen.length = 0;
      const b = await agentChatCompletions({ provider: 'deepseek', baseUrl: base, model: 'deepseek-chat', apiKey: 'sk-ds' },
        [{ role: 'user', content: 'hi' }]);
      const hit2 = seen[0] || {};
      r.openaiUrl = hit2.url === '/chat/completions';
      r.openaiBearer = hit2.auth === 'Bearer sk-ds';
      r.openaiText = !!(b && b.ok && b.text === 'hi');
    } catch (e) { r.error = e.message || String(e); }
    try { srv.close(); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-27-2 整合自测（沙盒可验部分；真 Windows 行为见汇报）：
  // 管理员三级后备（注入 runCmd）、设置页/Pioneer 文案纯函数、
  // 登录提示去重与占位保存落盘、引擎开目录与 tools-installed-extra、
  // 浏览器视频实时嗅探（本地测试页 + 悬浮图标 + 视频面板 + 换页清空）。
  nativeCheck.admin20261127 = await (async () => {
    const r = {};
    const psFail = async () => ({ code: 1, out: '', err: 'powershell 不可用' });
    const whoamiOn = async () => ({ code: 0, out: 'BUILTIN\\Administrators  Alias  S-1-5-32-544  Mandatory group, Enabled by default, Enabled', err: '' });
    const netOk = async () => ({ code: 0, out: '', err: '' });
    const allFail = async () => ({ code: 1, out: '', err: '' });
    const a = await checkAdminWindows({ forceWindows: true, runCmd: async (cmd) => (cmd === 'powershell' ? psFail() : whoamiOn()) });
    r.whoamiFallback = a.isAdmin === true && a.method === 'whoami-groups';
    const b = await checkAdminWindows({ forceWindows: true, runCmd: async (cmd) => (cmd === 'net' ? netOk() : allFail()) });
    r.netFallback = b.isAdmin === true && b.method === 'net-session';
    const c = await checkAdminWindows({ forceWindows: true, runCmd: allFail });
    r.allFailNone = c.isAdmin === false && c.method === 'none';
    const d = await checkAdminWindows({ forceWindows: true, runCmd: async () => ({ code: 0, out: 'True\r\n', err: '' }) });
    r.psDirectTrue = d.isAdmin === true && d.method === 'powershell-principal';
    const e = await checkAdminWindows({ forceWindows: true, runCmd: async () => ({ code: 0, out: 'False\r\n', err: '' }) });
    r.psDirectFalse = e.isAdmin === false && e.method === 'powershell-principal';
    // whoami 里 Administrators 组是“仅用于拒绝”（未提升的管理员令牌）：
    // 应直接判否，不再往下试 net session。
    const whoamiDeny = async () => ({ code: 0, out: 'BUILTIN\\Administrators  Alias  S-1-5-32-544  Mandatory group, Enabled by default, Deny only', err: '' });
    const f = await checkAdminWindows({ forceWindows: true, runCmd: async (cmd) => (cmd === 'powershell' ? psFail() : (cmd === 'whoami' ? whoamiDeny() : allFail())) });
    r.whoamiDenyOnlyFallsThrough = f.isAdmin === false && f.method === 'whoami-groups';
    // 设置页 live 检查：进设置 → 窗口与系统，看管理员行是不是真的写上了
    //（沙盒是 Linux，应如实显示“未检测到”，不能写成“否”）。
    try {
      mainWin.webContents.send('test-goto', 'settings');
      await new Promise((res2) => setTimeout(res2, 800));
      await js(`document.querySelector('[data-settings-tab=window]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 800));
      r.settingsLineLive = await js(`document.querySelector('#admin-status-line')?.textContent || ''`);
      r.settingsLineShowsUnknown = /未检测到/.test(r.settingsLineLive || '') && !/否（未用/.test(r.settingsLineLive || '');
      await shot('settings-admin');
    } catch (e) { r.settingsLineError = e.message || String(e); }
    return r;
  })();
  nativeCheck.format20261127 = await (async () => {
    const t = await js(`(() => ({
      adminUnsupported: adminStatusText({ isAdmin: false, method: 'unsupported-platform', detail: '当前平台是 linux，管理员检测只在 Windows 上有意义' }),
      adminNone: adminStatusText({ isAdmin: false, method: 'none', detail: '三种检测都失败，未能确认管理员身份：x' }),
      adminYes: adminStatusText({ isAdmin: true, method: 'powershell-principal', detail: 'PowerShell 返回 True' }),
      adminNo: adminStatusText({ isAdmin: false, method: 'whoami-groups', detail: 'whoami 里 Administrators 组未启用' }),
      pioneerProxy: formatPioneerIpResult({ ok: false, stage: 'proxy', reason: '本地代理 127.0.0.1:19352 连不上' }),
      pioneerNode: formatPioneerIpResult({ ok: false, stage: 'node', reason: '节点没有响应' }),
      pioneerDetector: formatPioneerIpResult({ ok: false, stage: 'detector', reason: '检测服务返回 HTTP 429' }),
      pioneerOk: formatPioneerIpResult({ ok: true, ip: '1.2.3.4', viaTunnel: true }),
    }))()`);
    return {
      adminUnsupportedSaysUnknown: /未检测到/.test(t.adminUnsupported) && !/否（未用/.test(t.adminUnsupported),
      adminNoneSaysUnknown: /未检测到/.test(t.adminNone) && !/否（未用/.test(t.adminNone),
      adminYesShowsMethod: /是（已用管理员身份运行）/.test(t.adminYes) && /powershell-principal/.test(t.adminYes),
      adminNoShowsMethod: /否（未用管理员身份运行）/.test(t.adminNo) && /whoami-groups/.test(t.adminNo),
      pioneerProxyStage: /代理没连上/.test(t.pioneerProxy) && /连不上/.test(t.pioneerProxy),
      pioneerNodeStage: /节点失效/.test(t.pioneerNode) && /没有响应/.test(t.pioneerNode),
      pioneerDetectorStage: /检测服务不通/.test(t.pioneerDetector) && /429/.test(t.pioneerDetector),
      pioneerOkIp: /出口 IP：1\.2\.3\.4/.test(t.pioneerOk) && /走隧道/.test(t.pioneerOk),
    };
  })();
  // 登录提示（2026-11-27-3 严格指纹）：未命中已登录凭证不弹提示；
  // 命中凭证才弹一次；同域名 10 分钟内只弹一次；忽略标记生效；
  // 点确认后只建占位记录落盘（且不含用户名/密码字段）。
  nativeCheck.loginPrompt20261127 = await (async () => {
    const r = {};
    try {
      const calls = await js(`(async () => {
        activeAccountId = null;
        loginPromptedAt.clear();
        const bannerHidden = !document.querySelector('#register-banner') || document.querySelector('#register-banner').classList.contains('hidden');
        let n = 0;
        const origDialog = window.showCustomDialog;
        window.showCustomDialog = async () => { n++; return 'save'; };
        // 桩 1：无已登录凭证——三站都不应弹。
        window.__testLoginCheck = async () => ({ ok: true, loggedIn: false, host: '' });
        try {
          await maybePromptSaveAccount('https://example.com/home', 'login-redirect');
          await maybePromptSaveAccount('https://example.com/other', 'login-redirect');
          await maybePromptSaveAccount('https://other-site.org/home', 'login-redirect');
        } finally { delete window.__testLoginCheck; }
        const noAuthPrompts = n;
        // 桩 2：命中 sessionid——弹一次，同域名第二次不弹，换域名再弹。
        window.__testLoginCheck = async (u) => ({ ok: true, loggedIn: true, matchedKey: 'sessionid', host: new URL(u).hostname });
        loginPromptedAt.clear();
        let afterFirst = -1, afterSameHost = -1, afterOtherHost = -1;
        try {
          await maybePromptSaveAccount('https://example.com/home', 'login-redirect');
          afterFirst = n;
          await maybePromptSaveAccount('https://example.com/other', 'login-redirect');
          afterSameHost = n;
          await maybePromptSaveAccount('https://other-site.org/home', 'login-redirect');
          afterOtherHost = n;
        } finally { delete window.__testLoginCheck; }
        const list = await window.toolbox.accountsList();
        const savedIds = (list.accounts || []).filter((a) => /example\.com|other-site\.org/.test(a.siteName || '')).map((a) => a.id);
        // 桩 3：命中凭证但点“不再提示该站点”——不保存，之后同站不再弹。
        window.showCustomDialog = async () => { n++; return 'ignore-forever'; };
        window.__testLoginCheck = async (u) => ({ ok: true, loggedIn: true, matchedKey: 'sessionid', host: new URL(u).hostname });
        loginPromptedAt.clear();
        let afterIgnore = -1, afterIgnoreAgain = -1;
        try {
          await maybePromptSaveAccount('https://ignore-test.example/home', 'login-redirect');
          afterIgnore = n;
          loginPromptedAt.clear();
          await maybePromptSaveAccount('https://ignore-test.example/home', 'login-redirect');
          afterIgnoreAgain = n;
        } finally { window.showCustomDialog = origDialog; delete window.__testLoginCheck; }
        return { bannerHidden, noAuthPrompts, afterFirst, afterSameHost, afterOtherHost, savedIds, afterIgnore, afterIgnoreAgain };
      })()`);
      r.bannerHidden = calls.bannerHidden === true;
      r.noAuthNoPrompt = calls.noAuthPrompts === 0;
      r.firstPromptsOnce = calls.afterFirst === 1;
      r.sameHostDeduped = calls.afterSameHost === 1;
      r.otherHostPromptsAgain = calls.afterOtherHost === 2;
      r.ignoreStopsPrompt = calls.afterIgnore === 3 && calls.afterIgnoreAgain === 3;
      const stored = getAccounts().filter((a) => (calls.savedIds || []).includes(a.id));
      r.placeholderSaved = stored.length === 2;
      r.placeholderHasNoCredentials = stored.length === 2 && stored.every((a) => !('password' in a) && !('username' in a));
      await js(`(async () => { for (const id of ${JSON.stringify(calls.savedIds || [])}) await window.toolbox.accountDelete(id); })()`);
      r.placeholderCleaned = !getAccounts().some((a) => (calls.savedIds || []).includes(a.id));
      // 清理桩 3 落盘的忽略标记。
      const ig = loginIgnoreLoad(); delete ig['ignore-test.example']; loginIgnoreSave(ig);
      r.ignoreCleaned = !isLoginIgnored('ignore-test.example');
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-27-3 新增纯函数与协议/TUN/Pioneer 自测。
  nativeCheck.guard20261127 = (() => {
    const r = {};
    // 协议分类
    const allow = ['https://example.com/', 'http://a.b/', 'about:blank', 'blob:https://x/1', 'data:text/plain,hi'];
    const block = ['bytedance://x', 'snssdk1128://x', 'zhihu://x', 'bilibili://x', 'taobao://x', 'ftp://x/'];
    r.protocolAllow = allow.every((u) => classifyNavigationUrl(u).decision === 'allow');
    r.protocolBlock = block.every((u) => classifyNavigationUrl(u).decision === 'block');
    r.protocolMailtoAsk = classifyNavigationUrl('mailto:a@b.com').decision === 'ask';
    // 认证指纹键名
    r.authCookiePositive = ['sessionid', 'SESSDATA', 'auth_token', 'Auth-Token', 'sso_token'].every((n) => isAuthCookieName(n));
    r.authCookieNegative = ['ttwid', 'device_id', '_ga', 'csrftoken', 'lang'].every((n) => !isAuthCookieName(n));
    // 右键菜单模板
    const fakeWv = { getType: () => 'webview', canGoBack: () => false, canGoForward: () => false, reload: () => {} };
    const editable = buildContextMenuTemplate({ isEditable: true }, fakeWv).map((i) => i.role || i.label);
    r.menuEditable = ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll'].every((x) => editable.includes(x));
    const sel = buildContextMenuTemplate({ selectionText: '你好' }, fakeWv).map((i) => i.label || i.role);
    r.menuSelection = sel.includes('复制所选文字') && sel.includes('发送到智能体解释') && sel.includes('翻译所选内容');
    const link = buildContextMenuTemplate({ linkURL: 'https://example.com/' }, fakeWv).map((i) => i.label || i.role);
    r.menuLink = link.includes('复制链接地址') && link.includes('在新标签页中打开');
    const img = buildContextMenuTemplate({ mediaType: 'image', srcURL: 'https://example.com/a.png' }, fakeWv).map((i) => i.label || i.role);
    r.menuImage = img.includes('保存图片') && img.includes('复制图片地址');
    r.menuMainBlank = buildContextMenuTemplate({}, { getType: () => 'window' }).length === 0;
    r.menuWebviewBlank = buildContextMenuTemplate({}, fakeWv).map((i) => i.label).join(',') === '后退,前进,重新加载';
    // TUN 引用转义与 helper 启动命令（中文+空格路径）
    const cmd = buildTunHelperLaunchCommand('C:\\桌面工具箱\\tools\\wintun\\tun-helper.ps1', 'C:\\桌面工具箱\\tools\\wintun\\wintun.dll', 'C:\\桌面工具箱\\tools\\wintun\\control');
    r.tunCmdHasRunAs = cmd.includes('-Verb RunAs');
    r.tunCmdHasNoProfile = cmd.includes('-NoProfile') && cmd.includes('-ExecutionPolicy') && cmd.includes('Bypass');
    r.tunCmdQuotedChinese = cmd.includes("'C:\\桌面工具箱\\tools\\wintun\\tun-helper.ps1'") && cmd.includes("'C:\\桌面工具箱\\tools\\wintun\\wintun.dll'");
    r.tunQuoteEscapes = tunPsQuote("a'b") === "'a''b'";
    // helper 脚本内容
    r.tunHelperHasCreateAdapter = TUN_HELPER_SCRIPT.includes('WintunCreateAdapter');
    r.tunHelperHasNetsh = TUN_HELPER_SCRIPT.includes('netsh interface ip set address');
    r.tunHelperHasRoute = TUN_HELPER_SCRIPT.includes('route add');
    r.tunHelperHasStatus = TUN_HELPER_SCRIPT.includes('status.json');
    // Pioneer PAC
    const pac = pioneerSmartPacScript();
    r.pacHasSocks = pac.includes('SOCKS5 127.0.0.1:19352');
    r.pacCnDirect = pac.includes(".endsWith('.cn')");
    return r;
  })();
  nativeCheck.pioneerPort20261127 = await (async () => {
    const r = {};
    const none = await pioneerCheckLocalPort();
    r.portEmptyFails = !!(none && none.ok === false);
    const srv = net.createServer();
    await new Promise((res) => srv.listen(PIONEER_LOCAL_PROXY.port, PIONEER_LOCAL_PROXY.host, res));
    try {
      const ok = await pioneerCheckLocalPort();
      r.portListeningPasses = !!(ok && ok.ok);
    } finally { await new Promise((res) => srv.close(res)); }
    return r;
  })();
  nativeCheck.wintunDll20261127 = await (async () => {
    const r = {};
    const out = await ensureWintunDll();
    r.ensureOk = !!(out && out.ok);
    r.dllExists = fs.existsSync(wintunDll());
    try { r.dllHashMatches = (await sha256File(wintunDll())) === BUNDLED_SHA256.wintunDllAmd64; } catch (e) { r.dllHashMatches = false; }
    try { r.zipHashMatches = (await sha256File(bundledZipPath('wintun'))) === BUNDLED_SHA256.wintunZip; } catch (e) { r.zipHashMatches = false; }
    return r;
  })();
  nativeCheck.browserLoginCheck20261127 = await (async () => {
    // 真实分区 Cookie：全新分区里 example.com 没有任何登录凭证。
    const rr = await browserLoginCheck('https://example.com/');
    return { loggedInFalse: rr && rr.loggedIn === false, ok: rr && rr.ok === true };
  })();
  // 引擎开目录与 tools-installed-extra：临时放一个假引擎到真实 tools/video，
  // 验 id 能认出引擎、备用出口能返回行、开目录认出引擎分区；用完删掉假文件。
  nativeCheck.videoEngineOpenDir20261127 = await (async () => {
    const r = {};
    const vdir = videoDir();
    fs.mkdirSync(vdir, { recursive: true });
    const fake = path.join(vdir, 'yt-dlp.exe');
    const existed = fs.existsSync(fake);
    try {
      if (!existed) fs.writeFileSync(fake, 'fake');
      const found = findVideoEngineByIdOrName('video-engine-yt-dlp');
      r.findById = !!found && found.path === fake && found.kind === 'video-engine';
      // installed-open-dir 引擎分支用的就是这个映射：目录 = 引擎路径的父目录。
      r.engineDirResolved = !!found && path.dirname(found.path) === vdir;
      const extra = await js(`(async () => window.toolbox.toolsInstalledExtra())()`);
      r.extraOk = !!(extra && extra.ok && Array.isArray(extra.rows) && extra.rows.some((x) => x.id === 'video-engine-yt-dlp' && x.kind === 'video-engine'));
      // 沙盒里 shell.openPath 打不开图形文件管理器（会挂起）：只核对它认出了
      // 引擎、返回了正确目录与 resolvedVia；10 秒没回来就记超时，不判错。
      // 真机上实际打开目录只能在 Windows 上验证。
      const opened = await Promise.race([
        installedOpenDir('video-engine-yt-dlp'),
        new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 10000)),
      ]);
      r.openTimeout = !!opened.__timeout;
      if (opened.__timeout) { r.openDirIsVideoDir = 'timeout-sandbox'; r.openOk = 'timeout-sandbox'; }
      else { r.openDirIsVideoDir = String(opened.dir || '') === vdir && opened.resolvedVia === 'video-engine'; r.openOk = opened.ok === true; }
    } catch (e) { r.error = e.message || String(e); }
    finally { try { if (!existed) fs.unlinkSync(fake); } catch (e) { /* 删不掉不影响 */ } }
    return r;
  })();
  // 浏览器视频实时嗅探：本地测试页（video 标签拉 mp4，fetch 拉 m3u8/mpd/ts
  // 分片；<script src=*.ts> 不应被当成媒体），验主进程事件、悬浮图标、视频面板、换页清空。
  nativeCheck.browserMediaSniff = await (async () => {
    const r = {};
    r.hookedDefaultPartition = browserMediaSniffedPartitions.has('persist:toolbox-browser');
    r.hookedPartitions = [...browserMediaSniffedPartitions];
    const srv = http.createServer((req, res) => {
      if (req.url === '/page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><title>sniff</title><video src="/test.mp4" autoplay muted playsinline></video><script src="/lib.ts"></script><script>fetch("/test.m3u8").catch(()=>{});fetch("/manifest.mpd").catch(()=>{});fetch("/seg0.ts").catch(()=>{});</script>');
      } else if (req.url === '/empty.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><title>empty</title><p>no media</p>'); }
      else if (req.url === '/test.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112])); }
      else if (req.url === '/test.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\n#EXT-X-VERSION:3\n'); }
      else if (req.url === '/manifest.mpd') { res.writeHead(200, { 'Content-Type': 'application/dash+xml' }); res.end('<MPD></MPD>'); }
      else if (req.url === '/seg0.ts') { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); res.end(Buffer.alloc(188)); }
      else if (req.url === '/lib.ts') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end('export const x = 1;'); }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = srv.address().port;
    const testUrl = `http://127.0.0.1:${port}/page.html`;
    const emptyUrl = `http://127.0.0.1:${port}/empty.html`;
    try {
      const before = browserMediaStats.emitted;
      mainWin.webContents.send('test-goto', 'browser');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`document.querySelector('[data-app-open=chromium]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`chromeGo(${JSON.stringify(testUrl)});`);
      let got = [];
      for (let i = 0; i < 16; i++) {
        await new Promise((res2) => setTimeout(res2, 500));
        try { got = await js(`browserMediaItems.map((x) => x.url + '|' + x.type + '|' + (x.pageUrl || ''))`); } catch (e) { got = []; }
        if (Array.isArray(got) && got.length >= 4) break;
      }
      r.items = got;
      r.emittedDelta = browserMediaStats.emitted - before;
      r.mp4Found = got.some((s) => s.includes('/test.mp4|mp4'));
      r.m3u8Found = got.some((s) => s.includes('/test.m3u8|m3u8'));
      r.dashFound = got.some((s) => s.includes('/manifest.mpd|dash'));
      r.tsFound = got.some((s) => s.includes('/seg0.ts|ts'));
      r.scriptTsExcluded = !got.some((s) => s.includes('/lib.ts'));
      r.pageUrlTracked = got.some((s) => s.includes('/page.html'));
      r.fabVisible = await js(`!document.querySelector('#browser-media-fab').classList.contains('hidden')`);
      r.fabCount = await js(`document.querySelector('#browser-media-count').textContent`);
      await shot('browser-media-fab');
      await js(`document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res2) => setTimeout(res2, 800));
      r.panelVisible = await js(`!document.querySelector('#browser-media-panel').classList.contains('hidden')`);
      r.panelRows = await js(`document.querySelectorAll('#browser-media-list .row').length`);
      await shot('video-browser-media');
      // 换页清空：再打开一个无媒体页，did-navigate 应清掉列表与悬浮图标。
      mainWin.webContents.send('test-goto', 'browser');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`document.querySelector('[data-app-open=chromium]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`chromeGo(${JSON.stringify(emptyUrl)});`);
      await new Promise((res2) => setTimeout(res2, 1500));
      r.clearedOnNav = await js(`browserMediaItems.length === 0`);
      r.fabHiddenAfterNav = await js(`document.querySelector('#browser-media-fab').classList.contains('hidden')`);
    } catch (e) { r.error = e.message || String(e); }
    finally { try { srv.close(); } catch (e) { /* 关不掉不影响 */ } }
    return r;
  })();
  // GitHub 页自检：无令牌时搜仓库应提示先登录（不调 GitHub API）
  mainWin.webContents.send('test-goto', 'tools');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-tab=updates]')?.click(); document.querySelector('[data-subtab=github]')?.click(); const gi = document.querySelector('#github-search-input'); if (gi) { gi.value='vlc'; document.querySelector('#github-search-btn')?.click(); }");
  await shot('github');
  // 协议处理自检（v1.6.0：沙盒里 Chromium 未下载，browse 应如实报未下载、不假装能打开；play 仍走 VLC）
  const protoPlay = handleProtocolUrl('muse-toolbox://play?url=https%3A%2F%2Fexample.com%2Fa.mp4');
  const protoBrowse = handleProtocolUrl('muse-toolbox://browse?url=https%3A%2F%2Fexample.com');
  fs.writeFileSync(path.join(__dirname, 'self-test-result.json'), JSON.stringify({
    at: new Date().toISOString(),
    version: VERSION,
    platform: process.platform,
    screenshots: results,
    native: nativeCheck,
    protocol: { play: protoPlay, browse: protoBrowse },
    bundledEnsure: globalThis.__bundledEnsure || null,
    vlc: vlcStatus(),
    browser: browserStatus(),
  }, null, 2));
  app.quit();
}

/* ---------- 2026-11-27-3：内嵌浏览器协议分类 ----------
 * 白名单只放 http:、https:、about:、blob:、data:；mailto: 默认拒绝、
 * 只问用户；其余自定义协议（bytedance:、snssdk*:、zhihu:、
 * bilibili:、taobao: 等）一律静默阻止，不抛给 Windows 系统外壳。 */
const NAV_ALLOW_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'blob:', 'data:']);
const NAV_ASK_PROTOCOLS = new Set(['mailto:']);
function classifyNavigationUrl(rawUrl) {
  let scheme = '';
  try { scheme = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (e) { return { decision: 'block', scheme: '' }; }
  if (NAV_ALLOW_PROTOCOLS.has(scheme)) return { decision: 'allow', scheme };
  if (NAV_ASK_PROTOCOLS.has(scheme)) return { decision: 'ask', scheme };
  return { decision: 'block', scheme };
}
function notifyExternalProtocolAsk(url) {
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('external-protocol-ask', { url: String(url || '') }); } catch (e) { /* 发不出去就按拒绝处理 */ }
}
/* 右键菜单模板（纯函数，可自测）：可编辑区给编辑项，选中文本给复制
 * 与翻译，链接/图片给复制与打开/保存；webview 空白处给导航项，
 * 主窗口空白处返回空数组（不弹菜单）。 */
function buildContextMenuTemplate(params, contents) {
  const p = params || {};
  const isMainWindow = !contents || contents.getType() === 'window';
  const items = [];
  if (p.isEditable) {
    items.push(
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'pasteAndMatchStyle', label: '粘贴为纯文本' },
      { role: 'selectAll', label: '全选' },
    );
  }
  if (p.selectionText && String(p.selectionText).trim()) {
    if (items.length) items.push({ type: 'separator' });
    const text = String(p.selectionText);
    items.push({ role: 'copy', label: '复制所选文字' });
    items.push({ label: '发送到智能体解释', click: () => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('ctx-translate', { text, mode: 'explain' }); } catch (e) { /* 忽略 */ } } });
    items.push({ label: '翻译所选内容', click: () => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('ctx-translate', { text, mode: 'translate' }); } catch (e) { /* 忽略 */ } } });
  }
  if (p.linkURL) {
    if (items.length) items.push({ type: 'separator' });
    const link = p.linkURL;
    items.push({ label: '复制链接地址', click: () => clipboard.writeText(link) });
    items.push({ label: '在新标签页中打开', click: () => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('ctx-open-link', { url: link }); } catch (e) { /* 忽略 */ } } });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    if (items.length) items.push({ type: 'separator' });
    const src = p.srcURL;
    items.push({ label: '复制图片地址', click: () => clipboard.writeText(src) });
    items.push({ label: '保存图片', click: () => { try { if (contents) contents.downloadURL(src); } catch (e) { /* 忽略 */ } } });
  }
  if (!items.length) {
    if (isMainWindow) return [];
    items.push(
      { label: '后退', enabled: !!(contents && contents.canGoBack && contents.canGoBack()), click: () => { try { contents.goBack(); } catch (e) { /* 忽略 */ } } },
      { label: '前进', enabled: !!(contents && contents.canGoForward && contents.canGoForward()), click: () => { try { contents.goForward(); } catch (e) { /* 忽略 */ } } },
      { label: '重新加载', click: () => { try { contents.reload(); } catch (e) { /* 忽略 */ } } },
    );
  }
  return items;
}

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('before-quit', () => { isQuitting = true; pioneerStopTunnel(); tunHelperStopOnQuit(); });
  // 2026-11-26-7：多账号代理认证（只认代理认证，见 handleProxyLogin）。
  app.on('login', handleProxyLogin);
  /* ---------- 2026-11-27-3：内嵌浏览器协议守卫与全局右键菜单 ----------
   * 抖音网页版会自动触发 bytedance://、snssdk1128:// 等自定义协议；
   * 不拦截时 Chromium 直接抛给 Windows 系统外壳，未注册就弹系统级
   * “获取应用”弹窗。只放行白名单协议；第三方自定义协议静默阻止；
   * mailto: 默认拒绝，只在地址栏下方弹提示条问用户（点“打开”才调
   * shell.openExternal）。主窗口本身是 file:// 加载，不进 will-navigate
   * 守卫（只挂新窗口处理与右键菜单）。
   * 右键菜单挂在同一处：所有 webview 与主窗口共用一份；可编辑区给
   * 编辑项，选中文本给复制与翻译，链接/图片给复制与打开/保存。 */
  function attachBrowserGuards(contents, isMainWindow) {
    if (!contents || contents.isDestroyed()) return;
    if (!isMainWindow) {
      contents.on('will-navigate', (e, url) => {
        const c = classifyNavigationUrl(url);
        if (c.decision === 'allow') return;
        e.preventDefault();
        if (c.decision === 'ask') notifyExternalProtocolAsk(url);
      });
    }
    contents.setWindowOpenHandler(({ url }) => {
      const c = classifyNavigationUrl(url);
      if (c.decision === 'allow') return { action: 'allow' };
      if (c.decision === 'ask') notifyExternalProtocolAsk(url);
      return { action: 'deny' };
    });
    contents.on('context-menu', (_e, params) => {
      const items = buildContextMenuTemplate(params, contents);
      if (!items.length) return; // 主窗口空白处不弹菜单
      try { Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) || mainWin }); } catch (e) { /* 菜单弹不出不影响浏览 */ }
    });
  }
  // 2026-11-27-2：跟踪内嵌浏览器 webview 的当前页地址，供视频嗅探填
  // pageUrl（webRequest details 里没有来源页地址）。
  app.on('web-contents-created', (_event, contents) => {
    try {
      if (!contents) return;
      const type = contents.getType();
      if (type === 'webview') {
        attachBrowserGuards(contents, false);
        const ses = contents.session;
        if (!ses) return;
        const track = () => {
          try {
            const u = contents.getURL();
            if (u && /^https?:\/\//i.test(u)) browserMediaPageUrlBySession.set(ses, u);
          } catch (e) { /* 跟踪失败不影响浏览 */ }
        };
        contents.on('did-navigate', track);
        contents.on('did-navigate-in-page', track);
      } else if (type === 'window' || type === 'browserView') {
        attachBrowserGuards(contents, type === 'window');
      }
    } catch (e) { /* 跟踪失败不影响浏览 */ }
  });
  app.on('second-instance', (_e, argv) => {
    const link = findProtocolArg(argv);
    if (link) handleProtocolUrl(link);
    const bak = findToolboxbakArg(argv);
    if (bak) void handleToolboxbakFile(bak);
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleProtocolUrl(url); });
  app.on('open-file', (e, filePath) => {
    // macOS 上双击 .toolboxbak 走这里；窗口还没建好时先记下，建好再处理。
    e.preventDefault();
    if (String(filePath || '').toLowerCase().endsWith('.toolboxbak')) {
      if (mainWin) void handleToolboxbakFile(filePath);
      else pendingToolboxbakFile = filePath;
    }
  });

  app.whenReady().then(async () => {
    // 2026-11-26-2：文件夹发行后第一次启动，把旧版 AppData 里
    // 的数据迁到 exe 旁边的 data 目录（只迁一次，旧目录留着）。
    globalThis.__dataMigrated = migrateLegacyUserData();
    // 注册 muse-toolbox:// 协议（打包后由安装器注册，这里
    // 再兜底注册一次当前用户级关联）。
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '')]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
    registerIpc();
    // 2026-11-26-3：锁屏/唤醒监听——只记日志与最近状态（设置页
    // 显示），resume 后不做多余动作；子进程异常退出只记日志。
    try {
      const onPower = (kind) => {
        const ev = { kind, at: new Date().toISOString() };
        lastPowerEvent = ev;
        try {
          const log = readJsonFile('power-log.json', []);
          const arr = Array.isArray(log) ? log : [];
          arr.push(ev);
          writeJsonFile('power-log.json', arr.slice(-50));
        } catch (e) { /* 日志写失败不拦 */ }
      };
      powerMonitor.on('lock-screen', () => onPower('lock-screen'));
      powerMonitor.on('unlock-screen', () => onPower('unlock-screen'));
      powerMonitor.on('suspend', () => onPower('suspend'));
      powerMonitor.on('resume', () => onPower('resume'));
    } catch (e) { /* 不支持的系统上跳过 */ }
    app.on('child-process-gone', (_e, details) => {
      try { logCrash('child-process-gone', `${details.type || ''}：${details.reason || ''}`); } catch (e) { /* 跳过 */ }
    });
    startAllEventWatchers();
    setInterval(checkTriggers, 60000);
    checkTriggers();
    setInterval(checkMonitors, 10 * 60 * 1000); // 2026-11-26-6：监控提醒每 10 分钟扫一次
    checkMonitors();
    // v1.3.0：先从安装包解压内置 VLC / Chromium 到 tools/，
    // 解压失败时不拦启动，界面会显示后备下载入口。
    globalThis.__bundledEnsure = await ensureBundledComponents();
    globalThis.__selfTest = process.argv.includes('--self-test');
    if (process.argv.includes('--self-test')) {
      createTray(); // 自测里也建托盘（沙盒里建不出来就记错，不拦自测）
      void runSelfTest();
      return;
    }
    createWindow();
    createTray();
    applyWindowSettings(); // 置顶/开机自启/防休眠手动开关/托盘菜单
    const link = findProtocolArg(process.argv);
    if (link) setTimeout(() => handleProtocolUrl(link), 600);
    const bak = findToolboxbakArg(process.argv) || pendingToolboxbakFile;
    if (bak) { pendingToolboxbakFile = ''; setTimeout(() => void handleToolboxbakFile(bak), 900); }
    // v1.6.1：启动时不自动检查更新（用户要求去掉自动更新）。
    // 更新只在设置里手动点「检查更新」/「一键更新」。
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
