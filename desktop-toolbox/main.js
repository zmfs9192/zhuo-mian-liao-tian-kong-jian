'use strict';
/**
 * 桌面工具箱 — Electron 主进程（空间之外的 Windows 桌面程序）
 *
 * 用户 2026-11-25 定案：把工具管理（UniGetUI 式）做成一个程序，
 * 播放器用 VLC，浏览器由本程序下载；空间在电脑端调用播放器 /
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
 *  2. 播放器：用 VLC —— 优先用电脑上已装的 VLC；未安装时可在播放
 *     器页点后备下载，或从工具管理的推荐软件安装。2026-11-27-6 起
 *     VLC 不再随安装包内置（也不再首次运行自动解压）。
 *  3. 浏览器：2026-11-28-2 起便携版 Chromium 已删除，浏览器一律
 *     走工具箱内嵌 webview（Electron 自带 Chromium 内核），点开
 *     即用，不下载、不装外部二进制；各浏览器走各自的分区，数据
 *     与系统里的同名浏览器不互通。下载别的浏览器也一样用，可在
 *     设置里改默认浏览器。
 *  v1.3.0：VLC 与 Chromium 改为打包内置，不再首次运行时
 *  到别处下载；定制见 CUSTOMIZATION.md（不从源码重编）。
 *  v1.4.0：主页改成与空间内工具箱一致的手机桌面（工具管理/
 *  播放器/浏览器/空间/设置五个图标，点图标全屏进对应页），
 *  播放器与浏览器页先是应用列表、点图标才打开对应应用，
 *  设置收进应用界面内的菜单；真实功能全部保留（winget、
 *  GitHub、VLC/浏览器启动与 muse-toolbox:// 协议）。
 *  v1.4.1：放弃苹果手机桌面主题，主页改成桌面聊天空间式布局
 *  （深色顶栏、左侧菜单边栏、右侧主内容区、底部导航栏），
 *  左侧菜单按空间原样列出，工具箱是其中一项（选中态）。
 *
 * 2026-11-28-3：与空间彻底剥离——内嵌空间 webview、右下角
 * 空间悬浮圆点、空间地址设置、muse-toolbox:// 自定义协议、
 * 远程“允许空间小助手连接本机”全部删除；工具箱完全独立
 * 使用，空间只从浏览器用。
 *
 * v1.6.0：安装包瘦身——Chromium 快照包不再随安装包发，首次
 * 使用浏览器时再从官方快照地址下载（带进度、可续传、解压后
 * 校验 chrome.exe 与版本清单）；VLC 仍打包内置。智能体聊天
 * 窗口是自然语言入口：AI 通过主进程本地工具调用真实执行
 *（winget 安装、启动程序、运行代码、文件操作、查系统状态
 * 等），危险操作执行前先问用户确认。工具来源可自定义，也
 * 可从本机已装程序导入；新增插件系统与本地数据备份/同步。
 * 2026-11-27-6：安装包再瘦身——VLC 不再随包内置（75MB），许可
 * 证文件不再随包发；locales/ 只留 11 种语言，删 LICENSES.chromium.html；
 * dxcompiler 等 GPU 相关文件不动；wintun 仍随包内置。
 * 2026-11-27-7：exe 改英文名 DesktopToolbox.exe——中文 exe 名在用户
 * 的 Windows 上解压后不出现；产品显示名仍是桌面工具箱。
 * 2026-11-27-8：Pioneer 接管 Windows 系统代理（HKCU 注册表，智能走
 * PAC、全局/Tun 走固定代理），账号分区也同步接管；断开、退出、启动
 * 残留清理时都按接管前的旧值恢复系统代理。
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
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Tray, Menu, Notification, powerMonitor, powerSaveBlocker, screen, nativeImage, session, desktopCapturer, globalShortcut, webContents } = require('electron');
const { spawn, execFile, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const net = require('net');
const tls = require('tls');
const zlib = require('zlib'); // 2026-11-28-5：手机远程托盘图标 PNG 编码用

/* 版本号规则（用户 2026-11-26 定）：第一位是日期，格式
 *「日期-今日修改次数」，如 2026-11-26-2（今天第 2 次改；
 * v1.6.0 是第 1 次、本版是第 2 次）。这个字符串不是标准
 * semver，所以内部版本用点分形式 2026.11.26-2（合法
 * semver，比较顺序与 2026-11-26-2 一致），界面上显示
 * 2026-11-26-2，GitHub Release 的 tag 也用 2026-11-26-2。
 * ⚠ 给后来改代码的 AI：版本号规则——日期=当天、末尾每日重置为 0、
 * 当天每次修改后 +1（即每天第一次发版是 -1，如 2026-11-28-1），不要
 * 手改版本号，用 node scripts/publish.js 发版（它按此规则算新版本，
 * 日期取当天台北时间，跨天从 1 开始），见 AGENTS.md 第 3 节。 */
const VERSION = '2026.11.28-9'; // 内部 semver
const DISPLAY_VERSION = '2026-11-28-9'; // 界面与 Release tag 用的版本号

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
const VLC_VERSION = '3.0.21';
const VLC_ZIP_URL = `https://download.videolan.org/pub/videolan/vlc/${VLC_VERSION}/win64/vlc-${VLC_VERSION}-win64.zip`;
/* ---- 打包内置组件（v1.3.0）----
 * bundled/ 里的 zip 是打包时从官方下载的原包（见
 * bundled/README.md 与 THIRD-PARTY-LICENSES.md），通过
 * electron-builder extraResources 发进安装包。首次运行时
 * 解压到 tools/，之后直接认到，不再联网下载。
 * 哈希用于首次解压前校验，损坏时不解压、走运行时下载后备。
 * 2026-11-28-2：便携版 Chromium 已删除，内嵌浏览器是 Electron
 * webview，不依赖外部 Chromium 二进制；此处不再有 Chromium 包。 */
const BUNDLED_VLC_FILE = 'vlc-3.0.21-win64.zip';
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
 * VLC：只对打包内置版用 --config 指向工具箱自己的 vlcrc
 *（网络缓存 2000ms，见下），已装版不用它，不动用户自己的
 * VLC 设置；另加 --no-qt-privacy-ask，免去首次启动的隐私提示。 */
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
/* 2026-11-28-2：便携版 Chromium 已删除。旧版 data/tools/chromium/
 * 目录如残留，启动时由 cleanupPortableChromium() 清掉。
 * 2026-11-28-12：工具箱内安装的软件台账（toolbox-apps.json）——只记
 * 工具箱自己装的软件（经工具箱走 winget 装成功的记一笔，卸载后销账）。
 * 系统里用户自己装的软件不进台账，已安装/可更新只按台账 + 便携版
 * （data/tools 下的 VLC）统计，不再扫描系统安装。 */
function toolboxAppsFile() { return path.join(userDataDir(), 'toolbox-apps.json'); }
function loadToolboxApps() {
  try { const v = JSON.parse(fs.readFileSync(toolboxAppsFile(), 'utf8')); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function saveToolboxApps(list) {
  // 2026-11-28-8：裸写收口，走 writeJsonFile（临时文件 + rename）。
  try { writeJsonFile('toolbox-apps.json', list || []); return true; } catch (e) { return false; }
}
function recordToolboxApp(entry) {
  if (!entry || !entry.key) return false;
  const list = loadToolboxApps().filter((x) => String(x.key) !== String(entry.key));
  list.unshift({ key: String(entry.key), name: String(entry.name || entry.key), kind: String(entry.kind || ''), wingetId: String(entry.wingetId || ''), exe: String(entry.exe || ''), installLocation: String(entry.installLocation || ''), version: String(entry.version || ''), installedAt: Date.now() });
  return saveToolboxApps(list.slice(0, 200));
}
function removeToolboxApp(key) {
  const k = String(key || '');
  if (!k) return false;
  const list = loadToolboxApps().filter((x) => String(x.key) !== k && String(x.wingetId || '') !== k);
  return saveToolboxApps(list);
}
function configPath() { return path.join(userDataDir(), 'config.json'); }

/* ---- 打包内置组件的定位与校验 ---- */
function bundledZipPath(kind) {
  const file = kind === 'vlc' ? BUNDLED_VLC_FILE : kind === 'wintun' ? BUNDLED_WINTUN_FILE : '';
  if (!file) return '';
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
/* 2026-11-28-2：便携版 Chromium 已删除。启动时清掉旧版残留的
 * data/tools/chromium/（可执行文件与 profile），只清这一处、
 * 不碰 tools/ 下别的目录；清失败不拦启动。 */
function cleanupPortableChromium() {
  try {
    const dir = path.join(toolsDir(), 'chromium');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { /* 清失败不拦启动 */ }
}
function ensureVlcPreset() {
  // 只对打包内置版用的 vlcrc；已装版不走这条路。
  try {
    if (fs.existsSync(vlcrcPath())) return;
    fs.mkdirSync(vlcDir(), { recursive: true });
    fs.writeFileSync(vlcrcPath(), VLC_PRESET, 'utf8');
  } catch (e) { /* 预置写失败不拦启动，VLC 用自己的默认设置 */ }
}

/* ---------------- 数据迁移框架（2026-11-28-8，P0） ----------------
 * 每个 data 文件带 version 字段；读到旧格式（无 version）按迁移
 * 函数升版并写回；读到高于当前版本的先备份原文件再按默认处理，
 * 绝不静默覆盖。当前版本见各文件的 CURRENT_* 常量。 */
const CURRENT_ACCOUNTS_VERSION = 1;
const CURRENT_AGENTS_VERSION = 1;
const CURRENT_CONFIG_VERSION = 1;
/* 未知版本的数据文件：先留一份损坏副本（backupCorruptFile 会打
 * 时间戳后缀），再按默认处理；返回 true 表示已备份。 */
function backupUnknownVersionFile(name, version) {
  try {
    const fp = path.join(userDataDir(), name);
    if (fs.existsSync(fp)) backupCorruptFile(fp, name, `版本未知（v${version}，当前 v1）`);
    return true;
  } catch (e) { return false; }
}

function loadConfig() {
  // v1.4.0：默认播放器/浏览器（本地播放与浏览按此走），工具来源开关
  //（发现软件只搜启用的来源；GitHub 源关闭时 GitHub 搜索不可用）。
  const defaults = {
    version: CURRENT_CONFIG_VERSION,
    downloadDir: '', vlcPath: '', proxy: '', githubToken: '',
    defaultPlayer: 'vlc', defaultBrowser: 'chromium',
    sniffEnabled: false, // 2026-11-27-10：第 8 项，数据嗅探开关（关时小圆点不出现）
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
    // 2026-11-27-4 玻璃重构：深色模式与壁纸（B 路渲染层读写，见 2.2 节）
    theme: 'auto', // 跟随系统 / 浅色 / 深色：'auto' | 'light' | 'dark'
    wallpaperPath: '', // 自定义壁纸本地图片路径，空表示只用渐变底
    // 2026-11-28-5：手机远程（局域网直连 + Tailscale）——默认关闭，
    // 开启才监听端口；端口、配对与令牌存在 data/phone-remote.json，
    // 证书存在 data/phone-remote-cert.json，都不进仓库、不进备份。
    phoneRemote: { enabled: false },
    // 2026-11-28-6：屏幕实时翻译——浮窗行为（常驻/成功后 10 秒
    // 自动关闭）；语言方向与轮巡智能体沿用翻译插件的设置，
    // 这里不另起一套。
    screenTranslate: { autoClose: false },
  };
  try {
    if (fs.existsSync(configPath())) {
      const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        // 2026-11-28-8：config.json 带 version 字段；未知版本先备份
        // 原文件再按默认处理，不静默覆盖。无 version 的旧文件按 v0
        // 读，版本字段在下次保存时补上。
        if (typeof parsed.version === 'number' && parsed.version > CURRENT_CONFIG_VERSION) {
          backupUnknownVersionFile('config.json', parsed.version);
          return { ...defaults };
        }
        return { ...defaults, ...parsed, version: CURRENT_CONFIG_VERSION };
      }
    }
  } catch (e) { console.error('读取配置失败', e.message); }
  return defaults;
}
/* 2026-11-28-8：配置单写者队列——主进程内配置只有一份内存缓存
 *（getConfig 读缓存，不再每次读盘）；saveConfig 只更新缓存并
 * 安排一次合并写，500ms 内多次写合并成一次原子写，写操作串行，
 * 防 last-writer-wins 丢更新。退出与崩溃前调 flushConfigNow()
 * 强制落盘。直接改过 config.json 文件的测试/脚本须先调
 * invalidateConfigCache()，否则缓存仍是旧值。 */
let configCache = null;
let configFlushTimer = null;
function invalidateConfigCache() { configCache = null; }
function scheduleConfigFlush() {
  if (configFlushTimer) return; // 已有待执行的合并写，本次合并进去
  configFlushTimer = setTimeout(() => {
    configFlushTimer = null;
    flushConfigNow();
  }, 500);
}
function flushConfigNow() {
  if (configFlushTimer) { clearTimeout(configFlushTimer); configFlushTimer = null; }
  if (!configCache) return;
  try { atomicWriteFile(configPath(), JSON.stringify(configCache, null, 2)); } catch (e) { /* 写失败不拦，下次保存再试 */ }
}
function saveConfig(cfg) {
  configCache = cfg;
  scheduleConfigFlush();
  return cfg;
}
function getConfig() {
  if (!configCache) configCache = loadConfig();
  // 2026-11-26-7：未设置下载目录时默认用工具箱数据目录
  //（userDataDir()，打包后是 exe 旁边的 data 目录），不再默认
  // 系统 Downloads；用户已在设置里填过的 downloadDir 原样保留。
  if (!configCache.downloadDir) configCache.downloadDir = userDataDir();
  return configCache;
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
  } catch (e) { backupCorruptFile(p, name); }
  return [];
}
function writeJsonList(name, list) {
  atomicWriteFile(path.join(userDataDir(), name), JSON.stringify(list.slice(0, 200), null, 2));
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

/* ---------------- 诊断日志（2026-11-28-8，P0） ----------------
 * 主进程未捕获异常与未处理 Promise 拒绝落盘到 data/logs/：按天
 * 一个文件、保留 7 天、密钥与令牌脱敏（沿用嗅探“值打码、不进
 * 日志”的规矩）；只存本机，绝不进仓库、不上传。崩溃标记
 * data/logs/last-crash.json 供下次启动时提示恢复。 */
const DIAG_LOG_KEEP_DAYS = 7;
const DIAG_SECRET_KEY_RE = /(apiKey|api_key|webToken|webCookie|webUserAgent|githubToken|password|passwd|secret|token|access_token|refresh_token|authorization)\s*[:=]\s*["']?[^"'\s,}\]]+/gi;
function sanitizeDiagText(text) {
  let s = String(text || '');
  // 2026-11-28-8：Bearer 正则必须先跑——键值正则会把
  // "Authorization: Bearer xxx" 里的 Bearer 当值吃掉，后面再也
  // 匹配不到，令牌就明文残留了。
  s = s.replace(/(authorization:\s*Bearer\s+)\S+/gi, '$1••••');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9\-._~+\/]{8,}/g, '$1••••');
  s = s.replace(DIAG_SECRET_KEY_RE, '$1: ••••');
  s = s.replace(/([?&](?:token|api_key|apikey)=)[^&\s"']+/gi, '$1••••');
  return s;
}
function diagLogDir() { return path.join(userDataDir(), 'logs'); }
let diagLogPruned = false;
function diagLogPrune() {
  try {
    const dir = diagLogDir();
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - DIAG_LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const fp = path.join(dir, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { force: true }); } catch (e) { /* 删不掉不影响 */ }
    }
  } catch (e) { /* 清理失败不拦 */ }
}
function diagLogWrite(entry) {
  try {
    const dir = diagLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
    const line = JSON.stringify({ at: entry.at || new Date().toISOString(), kind: entry.kind || 'error', message: sanitizeDiagText(entry.message || ''), stack: entry.stack ? sanitizeDiagText(entry.stack) : undefined });
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    if (!diagLogPruned) { diagLogPruned = true; diagLogPrune(); }
  } catch (e) { /* 诊断日志写失败不拦主流程 */ }
}
function crashMarkerFile() { return path.join(diagLogDir(), 'last-crash.json'); }
function writeCrashMarker(entry) {
  try {
    fs.mkdirSync(diagLogDir(), { recursive: true });
    atomicWriteFile(crashMarkerFile(), JSON.stringify({ at: entry.at, kind: entry.kind, message: sanitizeDiagText(entry.message || '') }, null, 2));
  } catch (e) { /* 写失败不拦 */ }
}
function readCrashMarker() {
  try { if (fs.existsSync(crashMarkerFile())) return JSON.parse(fs.readFileSync(crashMarkerFile(), 'utf8')); } catch (e) { /* 读失败当没有 */ }
  return null;
}
function clearCrashMarker() { try { fs.rmSync(crashMarkerFile(), { force: true }); } catch (e) { /* 删不掉不影响 */ } }
function handleMainProcessError(kind, err) {
  const entry = {
    at: new Date().toISOString(), kind,
    message: (err && err.message) || String(err || ''),
    stack: (err && err.stack) || '',
  };
  try { diagLogWrite(entry); } catch (e) { /* 忽略 */ }
  try { logCrash(kind, sanitizeDiagText(entry.message)); } catch (e) { /* 忽略 */ }
  try { writeCrashMarker(entry); } catch (e) { /* 忽略 */ }
  return entry;
}
/* 主进程崩溃兜底：未捕获异常记日志 + 写崩溃标记 + 强制落盘配置
 * 后退出（异常后主进程状态已不可靠，不继续跑）；下次启动读到
 * 标记会提示恢复。未处理 Promise 拒绝只记日志，不退出。
 * 自测模式下只记日志不退出（自测要跑完并写结果）。 */
process.on('uncaughtException', (err) => {
  try { handleMainProcessError('uncaughtException', err); } catch (e) { /* 兜底本身不抛 */ }
  try { flushConfigNow(); } catch (e) { /* 忽略 */ }
  if (process.argv.includes('--self-test')) return;
  try { isQuitting = true; } catch (e) { /* 忽略 */ }
  try { app.quit(); } catch (e) { try { process.exit(1); } catch (e2) { /* 忽略 */ } }
});
process.on('unhandledRejection', (reason) => {
  try { handleMainProcessError('unhandledRejection', reason); } catch (e) { /* 兜底本身不抛 */ }
});
/* 系统通知：总开关在设置里（默认开）；不支持通知的系统上静默跳过。 */
function notify(title, body) {
  try {
    if (getConfig().notificationsEnabled === false) return false;
    if (!Notification.isSupported()) return false;
    new Notification({ title: String(title || '桌面工具箱'), body: String(body || '') }).show();
    return true;
  } catch (e) { return false; }
}
/* 防休眠：按“原因”计数——手动开关、VLC 下载、热更新
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

/* 2026-11-28-12：VLC 只认工具箱自己管理的便携版（data/tools/vlc），
 * 不再检测系统里装的 VLC，也不再读设置里的外部路径——已安装检测
 * 与可更新只统计工具箱内安装的东西。 */
function findVlc() {
  const candidates = [
    path.join(vlcDir(), `vlc-${VLC_VERSION}`, 'vlc.exe'),
    path.join(vlcDir(), 'vlc.exe'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (e) { /* 继续找下一个 */ }
  }
  return '';
}
function vlcStatus() {
  const exe = findVlc();
  const bundled = !!exe && exe.startsWith(vlcDir());
  return {
    found: !!exe,
    path: exe,
    bundled,
    integrated: bundled, // 打包内置版在位
    source: !exe ? 'missing' : 'bundled', // 2026-11-28-12：只认工具箱便携版
    version: bundled ? VLC_VERSION : '',
  };
}
function vlcArgs(extra) {
  // 只对打包内置版加预置配置与隐私提示免除；已装/指定路径版不动用户自己的设置。
  const st = vlcStatus();
  if (!st.bundled) return extra;
  ensureVlcPreset();
  return ['--config', vlcrcPath(), '--no-qt-privacy-ask', ...extra];
}
function playWithVlc(target) {
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

/* ---------------- 内嵌浏览器（2026-11-28-2：便携版 Chromium 已删除） ----------------
 * 浏览器一律走工具箱内嵌 webview（Electron 自带 Chromium 内核），
 * 不依赖任何外部 Chromium 二进制；各浏览器走各自的分区（见
 * EMBEDDED_BROWSER_PARTITIONS），数据互不相通，也与系统里装的
 * 同名浏览器不互通。 */
function launchBrowser() {
  sendToRenderer('embedded-browser-open', { url: '', kind: 'chromium' });
  return { ok: true, embedded: true };
}

/* ---------------- 其他播放器 / 浏览器（v1.4.0，2026-11-28-12 改） ----------------
 * 播放器、浏览器页先是应用列表，点图标才打开对应应用。
 * 2026-11-28-12：只认工具箱内安装的东西——便携版（VLC，看
 * data/tools 下的文件）+ 台账（toolbox-apps.json，工具箱走
 * winget 装过的）。不再扫描 Program Files / PATH / 系统注册表，
 * 系统里用户自己装的同名软件不在这里出现，也不参与可更新检测。
 * 浏览器一律走内嵌 webview（见 openWithDefaultBrowser），各浏览
 * 器用各自的分区，数据互不相通，也与系统里的同名浏览器不互通。 */
function findOnPath(exeName) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, exeName);
    try { if (d && fs.existsSync(p)) return p; } catch (e) { /* 继续 */ }
  }
  return '';
}
/* 工具箱内安装的软件清单（台账 + 便携版），供播放器/浏览器页、
 * 已安装页、软件页共用。found 只在“台账有记录且文件还在”或
 * “便携版文件在”时为真；记录在但文件已不在的，found 为 false，
 * 备注写明可卸载清理记录。 */
function toolboxAppsStatus() {
  const out = [];
  const seen = new Set();
  // 2026-11-28-4，第 8 项：VLC / Chromium 不再出现在软件页与已安装页。
  // VLC 以前是无条件拼一行（台账里另有一行时同名两行、状态还可能相反，
  // 就是“既已安装又未安装”的矛盾来源）；Chromium 是 -2 已删的便携版
  // 在台账里的残留。两者都不是默认安装项：VLC 仍在推荐软件里可装、
  // 在播放器页看得到状态，这里只列台账里真实装的软件，一行一种状态。
  for (const e of loadToolboxApps()) {
    const key = String(e.key || e.wingetId || '');
    if (!key || key === 'vlc' || key === 'chromium' || seen.has(key)) continue;
    seen.add(key);
    const exe = String(e.exe || '');
    const loc = String(e.installLocation || '');
    let found = false;
    try { found = (!!exe && fs.existsSync(exe)) || (!!loc && fs.existsSync(loc)); } catch (err) { found = false; }
    out.push({ key: String(e.key || e.wingetId || ''), name: String(e.name || e.key || ''), kind: String(e.kind || ''), source: 'toolbox-winget', wingetId: String(e.wingetId || ''), found, path: exe, installLocation: loc, version: String(e.version || ''), installedAt: e.installedAt || 0, note: found ? '工具箱已安装' : '记录在但文件已不在，可卸载清理记录' });
  }
  return out;
}
/* 台账里的可执行文件（启动用）。便携版走 vlcStatus；
 * winget 装的按记录里的 exe / 安装目录 + 已知 exe 名找。 */
const TOOLBOX_APP_EXE_NAMES = {
  chrome: ['chrome.exe'], edge: ['msedge.exe'], firefox: ['firefox.exe'],
  potplayer: ['PotPlayerMini64.exe', 'PotPlayerMini.exe', 'PotPlayer.exe'], mpv: ['mpv.exe'],
  // 2026-11-28-4，第 9 项：推荐软件新增工具类（商城式）的主程序名。
  '7zip': ['7zFM.exe'], bandizip: ['Bandizip.exe'], libreoffice: ['soffice.exe'], notion: ['Notion.exe'],
  vscode: ['Code.exe'], git: ['git-bash.exe'], telegram: ['Telegram.exe'], discord: ['Discord.exe'],
  powertoys: ['PowerToys.exe'], everything: ['Everything.exe'], geekuninstaller: ['geek.exe'],
};
function toolboxAppExe(key) {
  const k = String(key || '');
  if (k === 'vlc') return vlcStatus().path || '';
  const e = loadToolboxApps().find((x) => String(x.key) === k || String(x.wingetId || '') === k);
  if (!e) return '';
  try {
    if (e.exe && fs.existsSync(e.exe)) return e.exe;
    const loc = String(e.installLocation || '');
    if (loc && fs.existsSync(loc)) {
      for (const n of (TOOLBOX_APP_EXE_NAMES[k] || [])) {
        const p = path.join(loc, n);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch (err) { /* 读不到按未安装 */ }
  return '';
}
function playerAppsStatus() {
  const vlc = vlcStatus();
  const apps = toolboxAppsStatus();
  const pot = apps.find((a) => a.key === 'potplayer');
  const mpv = apps.find((a) => a.key === 'mpv');
  return {
    vlc: { key: 'vlc', name: 'VLC', found: vlc.found, path: vlc.path || '', note: vlc.found ? `工具箱已安装 · ${vlc.version}` : '未安装（可点后备下载，或从推荐软件安装）' },
    potplayer: { key: 'potplayer', name: 'PotPlayer', found: !!(pot && pot.found), path: (pot && pot.path) || '', note: (pot && pot.found) ? '工具箱已安装' : '未安装' },
    mpv: { key: 'mpv', name: 'mpv', found: !!(mpv && mpv.found), path: (mpv && mpv.path) || '', note: (mpv && mpv.found) ? '工具箱已安装' : '未安装' },
  };
}
function browserAppsStatus() {
  const apps = toolboxAppsStatus();
  const chrome = apps.find((a) => a.key === 'chrome');
  const edge = apps.find((a) => a.key === 'edge');
  return {
    // 2026-11-28-2：便携版 Chromium 已删除；内嵌浏览器是 Electron
    // webview，常驻可用，不再有“已下载/未下载”状态。
    chromium: { key: 'chromium', name: 'Chromium', found: true, path: '', embedded: true, note: '内嵌浏览器 · 点开即用' },
    chrome: { key: 'chrome', name: 'Chrome', found: !!(chrome && chrome.found), path: (chrome && chrome.path) || '', note: (chrome && chrome.found) ? '工具箱已安装' : '未安装' },
    edge: { key: 'edge', name: 'Edge', found: !!(edge && edge.found), path: (edge && edge.path) || '', note: (edge && edge.found) ? '工具箱已安装' : '未安装' },
  };
}
/* 从软件页/已安装页打开一个工具箱内安装的软件。
 * 浏览器一律走内嵌 webview（kind 决定分区）；播放器 spawn
 * 自己的窗口；视频引擎不是可打开的软件。 */
function toolboxOpenApp(key) {
  const k = String(key || '');
  if (k === 'chromium' || k === 'chrome' || k === 'edge') {
    sendToRenderer('embedded-browser-open', { url: '', kind: k });
    return { ok: true, embedded: true };
  }
  if (k === 'vlc' || k === 'potplayer' || k === 'mpv') return launchPlayerApp(k, '');
  // 2026-11-28-4，第 9 项：推荐软件新增的工具类 / Firefox——按台账 exe
  // 或安装目录顶层 exe 拉起；找不到可执行文件就明说，不假装打开了。
  const exe = toolboxAppExe(k) || (() => {
    const e = loadToolboxApps().find((x) => String(x.key) === k || String(x.wingetId || '') === k);
    const loc = e ? String(e.installLocation || '') : '';
    return loc ? findAppExeInDir(loc, k, e.name || '') : '';
  })();
  if (exe) {
    try { const child = spawn(exe, [], { detached: true, stdio: 'ignore' }); child.unref(); return { ok: true }; }
    catch (e2) { return { ok: false, error: `打开失败：${e2.message || String(e2)}` }; }
  }
  return { ok: false, error: '这个不是可打开的软件' };
}
/* 安装目录顶层找主程序：先按名字匹配 key/应用名，排除卸载器与
 * 安装/更新辅助程序，都没有才取第一个剩下的 exe。 */
const APP_EXE_SKIP_RE = /unins|uninstall|setup|update|helper|crash|report/i;
function findAppExeInDir(dir, key, name) {
  let files = [];
  try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.exe$/i.test(d.name)).map((d) => d.name); } catch (e) { return ''; }
  files = files.filter((n) => !APP_EXE_SKIP_RE.test(n));
  if (!files.length) return '';
  const needle = String(key || name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const named = needle ? files.find((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle)) : null;
  return path.join(dir, named || files[0]);
}
/* 从软件页/已安装页卸载一个工具箱内安装的软件（渲染层先弹确认框）。
 * 便携版（VLC）直接删工具箱管理目录（含其数据）；winget
 * 装的走 winget 卸载，成功后销台账。 */
async function toolboxUninstallApp(key) {
  const k = String(key || '');
  if (k === 'vlc') {
    try { fs.rmSync(vlcDir(), { recursive: true, force: true }); } catch (e) { return { ok: false, error: `删除失败：${e.message || String(e)}` }; }
    return { ok: true };
  }
  const entry = loadToolboxApps().find((x) => String(x.key) === k || String(x.wingetId || '') === k);
  if (!entry || !entry.wingetId) return { ok: false, error: '台账里没有这个软件，无法卸载' };
  if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
  return { ok: true, ...runWingetJob(`卸载 ${entry.wingetId}`, ['uninstall', '--id', String(entry.wingetId), '-e', '--accept-source-agreements', '--disable-interactivity'], { uninstallId: String(entry.wingetId), removeAppKey: k, timeoutMs: 180000 }) };
}
function launchPlayerApp(kind, target) {
  if (kind === 'potplayer') {
    const exe = toolboxAppExe('potplayer');
    if (!exe) return { ok: false, error: 'PotPlayer 未安装：去「工具管理 · 推荐软件」安装。' };
    const child = spawn(exe, target ? [target] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }
  if (kind === 'mpv') {
    const exe = toolboxAppExe('mpv');
    if (!exe) return { ok: false, error: 'mpv 未安装：去「工具管理 · 推荐软件」安装。' };
    const child = spawn(exe, target ? [target] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }
  // 默认 VLC（含 target 为空时只启动）。
  if (!target) return launchVlc();
  return playWithVlc(target);
}
/* 默认播放器/浏览器（设置里可改）。 */
function playWithDefaultPlayer(target) {
  const def = getConfig().defaultPlayer || 'vlc';
  if (def === 'potplayer' || def === 'mpv') {
    const r = launchPlayerApp(def, target);
    if (r.ok) return r;
    // 默认播放器不可用时如实报，不静默换 VLC。
    return r;
  }
  return playWithVlc(target);
}
/* 2026-11-28-12：工具箱内打开的浏览器一律走内嵌 webview，不再
 * spawn 系统 Chrome/Edge 的外部窗口。kind 决定分区（chromium /
 * chrome / edge 各自隔离），数据与系统里的同名浏览器不互通。 */
function openWithDefaultBrowser(url, kind) {
  const def = kind || getConfig().defaultBrowser || 'chromium';
  sendToRenderer('embedded-browser-open', { url: String(url || ''), kind: def });
  return { ok: true, embedded: true };
}

/* ---------------- VLC 偏好（v1.4.0） ----------------
 * 播放器界面内的设置页读写的是真实配置文件：
 * VLC 读/写工具箱自己的 vlcrc-toolbox（只用于打包内置版）。
 * 2026-11-28-2：便携版 Chromium 已删除，浏览器设置/扩展页随之
 * 删除；内嵌浏览器（webview）的偏好由 Electron 分区管理，不再
 * 由工具箱读写外部 profile。 */
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

/* ---------------- 大文件下载 + 解压（VLC 后备下载用） ---------------- */

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

/* 2026-11-27-4：zip 条目表（纯 Node 解析 central directory，
 * 不调外部工具）。读不到条目表时返回 null（非标准 zip，调用方
 * 自行决定是拒绝还是放行）；能读到就返回全部条目名（含目录项）。 */
function listZipEntries(zipPath) {
  try {
    const buf = fs.readFileSync(zipPath);
    // EOCD 在文件尾部（可能带注释，最多 64KB+22 字节内找）。
    const tailStart = Math.max(0, buf.length - (65557 + 22));
    let eocd = -1;
    for (let i = buf.length - 22; i >= tailStart; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const names = [];
    for (let n = 0; n < count; n++) {
      if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } catch (e) { return null; }
}
/* zip 内路径非法（绝对路径、含盘符、含 ../）时返回首个非法
 * 路径，否则返回 ''。目录项（以 / 结尾）同样检查。 */
function firstUnsafeZipEntry(names) {
  for (const raw of names || []) {
    const name = String(raw || '').replace(/\\/g, '/');
    if (!name) continue;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return raw;
    if (name.split('/').includes('..')) return raw;
  }
  return '';
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // 2026-11-27-4：先核对条目路径再解压——zip 内含 ../ 或绝对
    // 路径时直接拒绝整个包（zip-slip 防逃逸）。条目表读不到的
    // 非标准包沿用旧行为（官方原包可信），本地更新入口另行拒收。
    const entries = listZipEntries(zipPath);
    if (entries) {
      const bad = firstUnsafeZipEntry(entries);
      if (bad) { reject(new Error(`解压失败：压缩包里有非法路径（${bad}），已拒绝。`)); return; }
    }
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
  /* 2026-11-28-2：便携版 Chromium 已删除，只剩 VLC 的后备下载。
   * 内嵌浏览器不需要下载。kind 不是 'vlc' 时直接拒绝。 */
  if (kind !== 'vlc') return { ok: false, error: '该组件已不再提供下载' };
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
    const dir = vlcDir();
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'vlc.zip');
    await downloadFile(VLC_ZIP_URL, zip, (p) => { job.pct = Math.round(p * 90); push(); }, { resume: false });
    job.pct = 95; push();
    await extractZip(zip, dir);
    try { fs.unlinkSync(zip); } catch (e) { /* zip 删不掉不影响使用 */ }
    job.status = 'done'; job.pct = 100; push();
    notify('下载完成', 'VLC 已下载并解压完成，可以播放了。');
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
 * 2026-11-28-2：便携版 Chromium 已删除；启动时清掉旧版残留的
 * tools/chromium/ 目录（见 cleanupPortableChromium）。 */
async function ensureBundledComponents() {
  cleanupPortableChromium();
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
  // 2026-11-27-3：WinTun 驱动文件随包内置，首次运行解压到 tools/wintun/。
  out.wintun = await ensureWintunDll();
  if (out.vlc?.ok) ensureVlcPreset();
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
  /* 2026-11-28-12：台账挂钩——装成功记一笔（opts.recordApp），卸成功
   * 销账（opts.removeAppKey）。记账先同步落一笔（列表刷新能看到），
   * 安装目录随后异步反查补上；写台账失败不影响任务结果。 */
  const recordApp = (opts && opts.recordApp && typeof opts.recordApp === 'object') ? opts.recordApp : null;
  const removeAppKey = (opts && opts.removeAppKey) ? String(opts.removeAppKey) : '';
  const doneCb = (ok) => {
    if (!ok) return;
    try {
      if (recordApp && recordApp.key) {
        recordToolboxApp(recordApp);
        void (async () => {
          try {
            const ent = await findInstalledEntry(recordApp.wingetId || recordApp.key);
            const loc = (ent && ent.installLocation) || '';
            if (loc) recordToolboxApp({ ...recordApp, installLocation: loc, version: (ent && ent.version) || recordApp.version || '' });
          } catch (e) { /* 查不到安装目录不影响已记的台账 */ }
        })();
      }
      if (removeAppKey) removeToolboxApp(removeAppKey);
    } catch (e) { /* 台账写失败不影响任务结果 */ }
  };
  const child = spawn('winget', args, { windowsHide: true });
  let finished = false;
  let timer = null;
  const finishFailed = (line) => {
    if (finished) return;
    finished = true;
    job.status = 'failed';
    if (line) job.log.push(line);
    push();
    doneCb(false);
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
  child.on('error', (e) => { if (timer) clearTimeout(timer); if (!finished) { finished = true; job.status = 'failed'; job.log.push(`启动 winget 失败：${e.message}`); push(); doneCb(false); } });
  child.on('close', (code) => {
    if (timer) clearTimeout(timer);
    if (finished) return;
    if (code === 0) { finished = true; job.status = 'done'; job.log.push('完成'); push(); doneCb(true); return; }
    // 失败：先看是不是搜索源失败——是则走注册表后备，不再依赖搜索源
    const logText = job.log.join('\n');
    const sourceFailed = /搜索源|failed to.*source|source.*fail|0x8a15/i.test(logText);
    if (uninstallId && sourceFailed) {
      job.log.push('白话原因：winget 连不上软件源（搜索源失败），所以找不到这个软件；改用注册表里的卸载命令继续卸载，不再依赖搜索源。');
      push();
      void runRegistryUninstall(uninstallId, job, () => { finished = true; doneCb(job.status === 'done'); });
      return;
    }
    finished = true;
    job.status = 'failed';
    job.log.push(`winget 退出码 ${code}`);
    push();
    doneCb(false);
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

function runCmd(cmd, args, timeoutMs = 30000, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, cwd: (opts && opts.cwd) || undefined, env: (opts && opts.env) || process.env });
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
async function wingetDepsFor(id, source) {
  if (!wingetAvailable()) return { available: false, deps: [], note: 'winget 只能在 Windows 上用，无法查依赖。' };
  // 2026-11-28-9，第 6 项：微软商店源的包（Microsoft To Do）查依赖也要
  // 带 --source msstore，否则 winget show 找不到它。
  const showArgs = ['show', '--id', String(id), '-e', '--accept-source-agreements'];
  if (String(source || '') === 'msstore') showArgs.push('--source', 'msstore');
  const r = await runWinget(showArgs, 90000);
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

async function githubApi(apiPath, token, method, bodyObj, opts) {
  // 走 httpJson：配置了 HTTP 代理时 GitHub 请求也走代理。
  // 2026-11-27-4：method/bodyObj 供一键发布调 Contents API PUT；
  // opts.apiBase 只给自测传本地桩地址，正常调用不传。
  const m = method || 'GET';
  const base = (opts && opts.apiBase) ? String(opts.apiBase).replace(/\/$/, '') : 'https://api.github.com';
  const r = await httpJson(m, `${base}${apiPath}`, bodyObj == null ? null : bodyObj, {
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
  // 2026-11-28-9：第 1 项：清单拉取先走直连再走代理——Pioneer 开着时
  // raw.githubusercontent.com 会被 effectiveProxy 送进 127.0.0.1:19352
  // 隧道（SMART_PROXY_SUFFIXES 含 githubusercontent.com，全局模式更是
  // 全走），隧道出口到不了 GitHub 时检查就失败，而用户系统 VPN 的出口
  // 能到。所以直连优先：直连通了就走直连；直连不通（如公司内网必须走
  // 代理）再走正常代理路径；两条路都失败才报错，并写清两条路各自的原因。
  const token = getConfig().githubToken || '';
  const headers = { 'User-Agent': `MuseToolbox/${VERSION}`, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const urls = manifestUrl ? [manifestUrl] : UPDATE_MANIFEST_BRANCHES.map(manifestRawUrl);
  let lastError = '';
  for (const u of urls) {
    const direct = await httpJson('GET', u, null, headers, 30000, { proxyOverride: 'direct' });
    if (direct.ok && direct.data && typeof direct.data === 'object') return { ok: true, manifest: direct.data, url: u, via: 'direct' };
    if (direct.status === 404) { lastError = 'not-found'; continue; }
    const directErr = direct.error || `HTTP ${direct.status || ''}`;
    const viaProxy = await httpJson('GET', u, null, headers, 30000);
    if (viaProxy.ok && viaProxy.data && typeof viaProxy.data === 'object') return { ok: true, manifest: viaProxy.data, url: u, via: 'proxy' };
    if (viaProxy.status === 404) { lastError = 'not-found'; continue; }
    const proxyErr = viaProxy.error || `HTTP ${viaProxy.status || ''}`;
    lastError = `直连失败（${directErr}）；经代理也失败（${proxyErr}）`;
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
  // 2026-11-27-5：钉住的版本跳过——用户回滚过该版本，检查时不再提示它；
  // 只有比钉住版本更新的版本才再提示。
  const pinned = String(getUpdateState().pinnedVersion || '');
  const isPinned = !!pinned && compareVersions(latestInternal, pinned) === 0;
  const newer = !isPinned && compareVersions(latestInternal, VERSION) > 0;
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
    lastCheckMessage: isPinned
      ? `版本 ${latestDisplay} 已回滚并钉住，暂不提示更新。当前版本 ${DISPLAY_VERSION}。`
      : (!newer
        ? `已是最新版本（当前 ${DISPLAY_VERSION}，最新 ${latestDisplay}）。`
        : (changed.length ? `发现新版本 ${latestDisplay}，${changed.length} 个代码文件有变化（共约 ${Math.max(1, Math.round(totalBytes / 1024))}KB），点「一键更新」只下载这些文件。` : `发现新版本 ${latestDisplay}，但代码文件与本机一致，无需下载。`)),
    latestVersion: latestInternal, latestDisplayVersion: latestDisplay,
    changedFiles: changed, totalBytes,
    manifestUrl: f.url, manifestNotes: String(m.notes || ''),
    manifest: m, // 存一份清单，重启后点「一键更新」不用重新检查
  });
  lastUpdateManifest = m;
  return { ok: true, newer, latest: latestDisplay, changed, totalBytes, state };
}

let updateApplyRunning = false;
/* 2026-11-27-5：备份目录清理——update-backups/<版本>/ 只保留最近
 * 2 个版本，超了删最旧的。按目录修改时间排（最新在前）。 */
function pruneUpdateBackups(keep = 2) {
  const base = path.join(userDataDir(), 'update-backups');
  try {
    const dirs = fs.readdirSync(base).filter((d) => {
      try { return fs.statSync(path.join(base, d)).isDirectory(); } catch (e) { return false; }
    });
    dirs.sort((a, b) => fs.statSync(path.join(base, b)).mtimeMs - fs.statSync(path.join(base, a)).mtimeMs);
    for (const d of dirs.slice(keep)) {
      try { fs.rmSync(path.join(base, d), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    }
    return { ok: true, kept: dirs.slice(0, keep) };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
/* 2026-11-27-4：备份 + 替换 + 再验 + 回滚（远程一键更新与本地
 * 文件更新共用第二段）。entries: [{path, src, sha256}]，src 是
 * 已校验过 sha256 的新文件完整路径；backupDir 是本次备份目录。
 * 成功返回 {ok:true, replaced:[path...]}；失败时已替换的按备份
 * 全数还原，返回 {ok:false, error}，旧文件不动。 */
async function backupAndReplaceCodeFiles(entries, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const replaced = [];
  try {
    for (const d of entries) {
      const target = appCodePath(d.path);
      if (!target) throw new Error(`拒绝写入不在白名单里的路径：${d.path}`);
      const bak = path.join(backupDir, d.path.replace(/\//g, '_'));
      if (fs.existsSync(target)) fs.copyFileSync(target, bak);
      else fs.writeFileSync(bak + '.missing', '');
      fs.copyFileSync(d.src, target);
      const sum = await sha256File(target);
      if (sum.toLowerCase() !== String(d.sha256 || '').toLowerCase()) throw new Error(`文件 ${d.path} 替换后校验失败，已还原旧文件。`);
      replaced.push(d);
    }
    pruneUpdateBackups(2);
    return { ok: true, replaced: replaced.map((d) => d.path) };
  } catch (e) {
    for (const d of replaced) {
      try {
        const bak = path.join(backupDir, d.path.replace(/\//g, '_'));
        const target = appCodePath(d.path);
        if (fs.existsSync(bak)) fs.copyFileSync(bak, target);
        else if (fs.existsSync(bak + '.missing')) fs.rmSync(target, { force: true });
      } catch (e2) { /* 还原尽力而为，报错一并报出 */ }
    }
    return { ok: false, error: e.message || String(e) };
  }
}
/* ---------------- 回滚到上一版本（2026-11-27-5） ----------------
 * 备份目录 update-backups/<版本>/ 里装的是更新前的文件，目录名
 * 是被更新到的版本；备份里 main.js 的 VERSION 就是回滚后得到的
 * 版本。每次更新（含回滚）都会先备份当前文件，备份目录只保留
 * 最近 2 个版本（见 pruneUpdateBackups）。
 * 钉住：回滚后把被回滚掉的版本记进 update-state.json 的
 * pinnedVersion，检查更新时跳过它，否则下次检查会立刻又把坏
 * 版本拉回来；只有比钉住版本更新的版本才再提示。 */
function parseVersionFromMainJs(text) {
  const m = String(text || '').match(/^const VERSION = '([^']+)';/m);
  return m ? m[1] : '';
}
function updateBackupsBase() { return path.join(userDataDir(), 'update-backups'); }
function listRollbackBackups() {
  const base = updateBackupsBase();
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((d) => { try { return fs.statSync(path.join(base, d)).isDirectory(); } catch (e) { return false; } });
  } catch (e) { return []; }
  dirs.sort((a, b) => fs.statSync(path.join(base, b)).mtimeMs - fs.statSync(path.join(base, a)).mtimeMs);
  return dirs.map((d) => {
    const dir = path.join(base, d);
    // 备份只含本次更新有变化的文件（backupAndReplaceCodeFiles 只备份
    // entries），没在备份里的文件那次更新根本没动，回滚时保持原样。
    // 所以完整性只要求能读出回滚后版本（备份里有 main.js 且 VERSION
    // 能解析）；缺的文件列在 missing 里仅供排查。
    const backedUp = [];
    const missing = [];
    let version = '';
    for (const rel of HOT_UPDATE_FILES) {
      const f = path.join(dir, rel.replace(/\//g, '_'));
      if (fs.existsSync(f)) {
        backedUp.push(rel);
        if (rel === 'main.js' && !version) {
          try { version = parseVersionFromMainJs(fs.readFileSync(f, 'utf8')); } catch (e) { /* 读不到 */ }
        }
      } else missing.push(rel);
    }
    return { dir, name: d, version, displayVersion: displayVersionFromInternal(version), complete: !!version, backedUp, missing, mtime: fs.statSync(dir).mtimeMs };
  });
}
function rollbackInfo() {
  const st = getUpdateState();
  // 回滚前的版本以磁盘上 main.js 的 VERSION 为准（更新后即使没重启
  // 也准）；读不到时才用更新状态里的 updatedVersion。注意：state 的
  // latestVersion 是远端最新版，不是本机版本，不能拿来当回滚前版本。
  let fromVersion = '';
  try { fromVersion = parseVersionFromMainJs(fs.readFileSync(appCodePath('main.js'), 'utf8')); } catch (e) { /* 读不到 */ }
  if (!fromVersion) fromVersion = String(st.updatedVersion || '');
  const all = listRollbackBackups();
  const candidate = all.find((b) => b.complete && compareVersions(b.version, fromVersion) !== 0) || null;
  return {
    currentVersion: VERSION, currentDisplay: DISPLAY_VERSION,
    fromVersion, fromDisplay: displayVersionFromInternal(fromVersion),
    pinnedVersion: String(st.pinnedVersion || ''),
    pinnedDisplay: displayVersionFromInternal(String(st.pinnedVersion || '')),
    backups: all, candidate,
  };
}
let rollbackRunning = false;
async function rollbackToolboxUpdate() {
  if (updateApplyRunning || rollbackRunning) return { ok: false, error: '正在更新，请稍候' };
  const info = rollbackInfo();
  const cand = info.candidate;
  if (!cand) return { ok: false, error: '没有可用的备份：尚未更新过，或备份已被清理' };
  rollbackRunning = true;
  try {
    // 只恢复备份里有的文件；备份里没有的文件那次更新没动过，保持原样。
    const entries = [];
    for (const rel of HOT_UPDATE_FILES) {
      const src = path.join(cand.dir, rel.replace(/\//g, '_'));
      if (!fs.existsSync(src)) continue;
      entries.push({ path: rel, src, sha256: await sha256File(src) });
    }
    if (!entries.length) return { ok: false, error: '备份里没有可恢复的文件' };
    // 本次回滚也要先备份当前文件；备份目录用“回滚前版本-rollback”
    // 命名，避免与候选备份目录（以新版本号命名）撞名导致原备份被覆盖。
    const backupDir = path.join(userDataDir(), 'update-backups', `${String(info.fromVersion).replace(/[^0-9A-Za-z._-]/g, '_')}-rollback`);
    const rep = await backupAndReplaceCodeFiles(entries, backupDir);
    if (!rep.ok) return { ok: false, error: rep.error };
    saveUpdateState({ pendingRestart: true, updatedFiles: rep.replaced, updatedVersion: cand.version, latestVersion: cand.version, latestDisplayVersion: cand.displayVersion, backupDir, pinnedVersion: info.fromVersion, changedFiles: [], totalBytes: 0, source: 'rollback' });
    notify('已回滚', `代码已回滚到 ${cand.displayVersion}，点「重启生效」后用该版本。`);
    return { ok: true, version: cand.displayVersion, internalVersion: cand.version, restored: rep.replaced, pinnedVersion: info.fromVersion, pinnedDisplay: info.fromDisplay, backupDir };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally { rollbackRunning = false; }
}
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
    //（2026-11-27-4：抽成 backupAndReplaceCodeFiles，与本地文件更新共用。）
    const rep = await backupAndReplaceCodeFiles(downloaded.map((d) => ({ path: d.path, src: d.tmp, sha256: d.sha256 })), backupDir);
    if (!rep.ok) throw new Error(rep.error);
    saveUpdateState({ pendingRestart: true, updatedFiles: rep.replaced, updatedVersion: st.latestVersion, backupDir, changedFiles: [], totalBytes: 0, pinnedVersion: '' });
    push({ status: 'done', pct: 100, error: '' });
    notify('更新已就绪', `代码已更新到 ${st.latestDisplayVersion || ''}，点「重启生效」后用新版本。`);
    return { ok: true, updated: rep.replaced, version: st.latestDisplayVersion, backupDir };
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

/* ---------------- 自选本机文件更新（2026-11-27-4，方案 3.1 节） ----
 * zip 包格式与热更新清单同一结构：update-manifest.json +
 * 5 个代码文件。白名单外的路径忽略并在结果里写明忽略了哪几个；
 * 含 ../ 或绝对路径直接拒绝整个包。 */
async function applyLocalUpdate(zipPath, opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
  if (updateApplyRunning) return { ok: false, error: '正在更新，请稍候' };
  const file = String(zipPath || '');
  if (!file) return { ok: false, error: '没有选中更新包' };
  updateApplyRunning = true;
  const push = (job) => {
    sendToRenderer('update-progress', job);
    setTaskbarProgress(job.status === 'running' ? Math.max(0, Math.min(1, (job.pct || 0) / 100)) : -1);
    if (onProgress) { try { onProgress(job); } catch (e) { /* 忽略 */ } }
  };
  acquireSleepBlock('download:update');
  const tmpDir = path.join(userDataDir(), 'update-tmp-local');
  try {
    push({ status: 'running', pct: 5, error: '' });
    // 1) 必须是可读的 zip：条目表读不到就不是有效 zip。
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { ok: false, error: '所选文件不是有效的 zip 更新包' };
    const entries = listZipEntries(file);
    if (!entries) return { ok: false, error: '所选文件不是有效的 zip 更新包' };
    const bad = firstUnsafeZipEntry(entries);
    if (bad) return { ok: false, error: `更新包里有非法文件路径（${bad}），已拒绝整个包。` };
    // 2) 解压到临时目录（extractZip 内会再验一次条目路径）。
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await extractZip(file, tmpDir);
    } catch (e) { return { ok: false, error: `解压失败：${e.message || String(e)}` }; }
    push({ status: 'running', pct: 20, error: '' });
    // 3) 读包内清单并校验格式。
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'update-manifest.json'), 'utf8')); } catch (e) { manifest = null; }
    if (!manifest || !manifest.internalVersion || !Array.isArray(manifest.files)) {
      return { ok: false, error: '更新包里没有有效的更新清单' };
    }
    const pkgInternal = String(manifest.internalVersion);
    const pkgDisplay = String(manifest.displayVersion || manifest.version || pkgInternal);
    // 4) 版本比对（复用更新专用 compareVersions）。
    const cmp = compareVersions(pkgInternal, VERSION);
    if (cmp === 0) return { ok: false, error: '该包版本与当前版本一致，无需更新' };
    if (cmp < 0 && !o.confirmDowngrade) {
      return { ok: false, needsDowngrade: true, file, version: pkgDisplay, error: '该包版本低于当前版本，确定要降级吗？降级可能丢掉新功能' };
    }
    // 5) 逐项比对：白名单内、sha256 非空、本机 sha 不同者进 changed；
    // 白名单外忽略并写明；包里缺文件直接停。
    const ignored = [];
    const changed = [];
    const seen = new Set();
    const total = manifest.files.length;
    let i = 0;
    for (const item of manifest.files) {
      i++;
      const rel = String(item.path || '');
      if (!rel || !HOT_UPDATE_FILES.includes(rel)) { if (rel) ignored.push(rel); continue; }
      if (!appCodePath(rel)) return { ok: false, ignored, error: `更新包里有非法文件路径（${rel}），已拒绝整个包。` };
      if (seen.has(rel)) continue;
      seen.add(rel);
      const want = String(item.sha256 || '').toLowerCase();
      if (!want) continue;
      const src = path.join(tmpDir, rel);
      if (!fs.existsSync(src)) return { ok: false, ignored, error: `更新包里缺少文件 ${rel}，已停止，旧文件未动。` };
      const have = await localFileSha256(rel);
      if (have !== want) changed.push({ path: rel, size: Number(item.size || 0), sha256: want, src });
      push({ status: 'running', pct: 20 + Math.round((i / Math.max(1, total)) * 50), error: '' });
    }
    if (!changed.length) return { ok: false, ignored, error: '该包的代码文件与本机一致，无需更新' };
    // 6) 全部文件先验包内 sha256（一个对不上就停、旧文件不动）。
    for (const c of changed) {
      const sum = await sha256File(c.src);
      if (sum.toLowerCase() !== c.sha256.toLowerCase()) {
        return { ok: false, ignored, error: `文件 ${c.path} 校验失败（sha256 对不上），已停止，旧文件未动。` };
      }
    }
    push({ status: 'running', pct: 92, error: '' });
    // 7) 复用第二段：备份旧文件 → 替换 → 再验一次 → 失败全数还原。
    const backupDir = path.join(userDataDir(), 'update-backups', pkgInternal.replace(/[^0-9A-Za-z._-]/g, '_'));
    const rep = await backupAndReplaceCodeFiles(changed, backupDir);
    if (!rep.ok) return { ok: false, ignored, error: rep.error };
    saveUpdateState({ pendingRestart: true, updatedFiles: rep.replaced, updatedVersion: pkgInternal, latestVersion: pkgInternal, latestDisplayVersion: pkgDisplay, backupDir, changedFiles: [], totalBytes: 0, source: 'local-file', localFileName: path.basename(file), pinnedVersion: '' });
    push({ status: 'done', pct: 100, error: '' });
    notify('更新已就绪', `代码已更新到 ${pkgDisplay}，点「重启生效」后用新版本。`);
    return { ok: true, updated: rep.replaced, version: pkgDisplay, ignored, backupDir };
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

/* ---------------- 一键发布到仓库（2026-11-27-4，方案 3.2 节） ----
 * 发布内容写死 6 个文件：5 个热更新代码文件 + 新生成的
 * update-manifest.json。package.json、二进制组件与任何数据文件
 * 一律不发。机制用 GitHub Contents API 逐文件 PUT（先 GET 取
 * 当前 sha），失败即停、远端无回滚，文案如实写明混合状态。
 * 令牌只用 config.json 的 githubToken（Bearer），绝不经过渲染层。 */
function displayVersionFromInternal(internal) {
  // 2026.11.27-4 → 2026-11-27-4（与 scripts/gen-manifest.js 一致）。
  const parts = String(internal || '').split('.');
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}-${parts.slice(2).join('.')}`;
  return String(internal || '');
}
/* 版本同步检查（发布前置检查第 3 步；自测直接调）：
 * package.json.version 与 main.js 的 VERSION/DISPLAY_VERSION
 * 必须一致。pkgOverride 只给自测注入假 package.json 用。 */
function checkVersionSync(pkgOverride) {
  let pkgVersion = '';
  try {
    const pkg = pkgOverride || JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    pkgVersion = String(pkg.version || '');
  } catch (e) { return { ok: false, packageVersion: '', internalVersion: VERSION, displayVersion: DISPLAY_VERSION, error: 'package.json 读不到' }; }
  const ok = pkgVersion === VERSION && displayVersionFromInternal(pkgVersion) === DISPLAY_VERSION;
  return { ok, packageVersion: pkgVersion, internalVersion: VERSION, displayVersion: DISPLAY_VERSION,
    error: ok ? '' : '本地版本号不一致（package.json 与 main.js），请先同步再发布' };
}
/* 清单生成（gen-manifest.js 的逻辑搬进主进程，发布前自动生成；
 * scripts/gen-manifest.js 脚本本身保留，供发版前人工核对）。 */
function buildUpdateManifest() {
  const internal = checkVersionSync().packageVersion || VERSION;
  const display = displayVersionFromInternal(internal);
  return {
    version: display,
    internalVersion: internal,
    displayVersion: display,
    releasedAt: new Date().toISOString().slice(0, 10),
    notes: '',
    files: HOT_UPDATE_FILES.map((rel) => {
      const buf = fs.readFileSync(path.join(__dirname, rel));
      return { path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
    }),
  };
}
function mapPublishError(r) {
  if (!r) return '发布失败：网络原因';
  if (r.status === 403) return '令牌没有写权限';
  if (r.status === 404) return '仓库不存在或令牌无权访问';
  if (!r.status) return '发布失败：网络原因';
  return `发布失败：${r.error || (`HTTP ${r.status}`)}`;
}
async function publishStatus(opts) {
  const o = opts || {};
  const token = getConfig().githubToken || '';
  const localVersion = DISPLAY_VERSION;
  if (!token) return { localVersion, remoteVersion: null, canPublish: false, reason: '先在工具来源登录 GitHub', hasToken: false };
  const f = await fetchUpdateManifest(o.manifestUrl || '');
  if (f.ok) {
    const m = f.manifest || {};
    const remoteInternal = String(m.internalVersion || m.version || '');
    const remoteDisplay = String(m.displayVersion || m.version || remoteInternal);
    if (!remoteInternal) return { localVersion, remoteVersion: null, canPublish: false, reason: '仓库清单格式不对，无法比对版本', hasToken: true };
    if (compareVersions(VERSION, remoteInternal) > 0) {
      return { localVersion, remoteVersion: remoteDisplay, canPublish: true, reason: '', hasToken: true };
    }
    return { localVersion, remoteVersion: remoteDisplay, canPublish: false, reason: `本地版本 ${localVersion} 不高于仓库版本 ${remoteDisplay}，无需发布`, hasToken: true };
  }
  if (f.noManifest) return { localVersion, remoteVersion: null, canPublish: true, reason: '仓库里还没有更新清单，发布后将新建', hasToken: true };
  return { localVersion, remoteVersion: null, canPublish: false, reason: `无法读取仓库清单：${f.error || '无法连接 GitHub'}`, hasToken: true };
}
let publishRunning = false;
async function publishLocal(opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
  if (publishRunning) return { ok: false, published: [], failed: [], error: '正在发布，请稍候' };
  const token = getConfig().githubToken || '';
  if (!token) return { ok: false, published: [], failed: [], error: '先在工具来源登录 GitHub' };
  publishRunning = true;
  const apiBase = o.apiBase || '';
  const push = (job) => {
    sendToRenderer('publish-progress', job);
    if (onProgress) { try { onProgress(job); } catch (e) { /* 忽略 */ } }
  };
  const files = [...HOT_UPDATE_FILES, 'update-manifest.json'];
  const published = [];
  const mixedError = (detail) => `仓库已处于新旧混合状态：已写 ${published.join('、') || '无'}、未写 ${files.filter((f) => !published.includes(f)).join('、')}，请重新发布或手动处理`;
  try {
    // 1) 写权限探针：GET /repos/{owner}/{repo} 看 permissions.push。
    const probe = await githubApi(`/repos/${UPDATE_OWNER}/${UPDATE_REPO}`, token, 'GET', null, { apiBase });
    if (!probe.ok) return { ok: false, published, failed: files.slice(), error: mapPublishError(probe) };
    if (!probe.data || !probe.data.permissions || probe.data.permissions.push !== true) {
      return { ok: false, published, failed: files.slice(), error: '令牌没有该仓库的写权限，请换一个有写权限的令牌' };
    }
    // 2) 版本同步检查。
    const sync = checkVersionSync();
    if (!sync.ok) return { ok: false, published, failed: files.slice(), error: '本地版本号不一致（package.json 与 main.js），请先同步再发布' };
    // 3) 生成新清单，逐文件 PUT。
    const manifest = buildUpdateManifest();
    for (let i = 0; i < files.length; i++) {
      const rel = files[i];
      push({ index: i + 1, total: files.length, file: rel, status: 'publishing' });
      const content = rel === 'update-manifest.json'
        ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
        : fs.readFileSync(path.join(__dirname, rel));
      const apiPath = `/repos/${UPDATE_OWNER}/${UPDATE_REPO}/contents/desktop-toolbox/${rel.split('/').map(encodeURIComponent).join('/')}`;
      // 先取远端当前 sha（404 表示新建，不带 sha）。
      const cur = await githubApi(`${apiPath}?ref=main`, token, 'GET', null, { apiBase });
      let sha;
      if (cur.ok && cur.data && cur.data.sha) sha = String(cur.data.sha);
      else if (!cur.ok && cur.status !== 404) {
        return { ok: false, published, failed: files.slice(i), error: mixedError(mapPublishError(cur)), detail: mapPublishError(cur) };
      }
      const put = await githubApi(apiPath, token, 'PUT', { message: `桌面工具箱 ${DISPLAY_VERSION}`, content: content.toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }, { apiBase });
      if (!put.ok) {
        return { ok: false, published, failed: files.slice(i), error: mixedError(mapPublishError(put)), detail: mapPublishError(put) };
      }
      published.push(rel);
      push({ index: i + 1, total: files.length, file: rel, status: 'done' });
    }
    saveUpdateState({ lastPublishAt: new Date().toISOString(), lastPublishVersion: DISPLAY_VERSION });
    return { ok: true, published, failed: [], version: DISPLAY_VERSION };
  } catch (e) {
    const msg = e.message || String(e);
    if (published.length) return { ok: false, published, failed: files.filter((f) => !published.includes(f)), error: mixedError(msg), detail: msg };
    return { ok: false, published, failed: files.slice(), error: `发布失败：${msg}` };
  } finally {
    publishRunning = false;
  }
}

/* ---------------- 发布新版本（2026-11-27-11，第 1 项）----
 * 在更新页已有的 Contents API「发布本地版本」之外，再给一个
 * 「发布新版本（版本 +1）」：小改动后点一下，先把版本按与
 * scripts/publish.js 相同的规则升上去（日期=当天、末尾每日重置
 * 为 0、当天每次修改后 +1），再用 git 精确提交并推送到仓库。
 * 只加白名单里的文件，绝不用 git add -A。
 * 令牌只进一次性 askpass 临时文件（权限 700，用完即删），
 * 不进命令行、环境变量、日志、界面或提交内容。没装 git、
 * 不是仓库副本、没令牌时直接报原因与去处，不假装成功。 */
function nextVersionFromInternal(internal) {
  const m = String(internal || '').match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/);
  if (!m) return null;
  // 版本号规则（与 scripts/publish.js 相同）：日期=当天、末尾每日
  // 重置为 0、当天每次修改后 +1；同一天则最后一位 +1，跨天从 1 开始。
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const curDate = `${m[1]}-${m[2]}-${m[3]}`;
  const count = curDate === today ? Number(m[4]) + 1 : 1;
  return { internal: `${today.replace(/-/g, '.')}-${count}`, display: `${today}-${count}` };
}
/* git 推送（askpass 临时文件供令牌，用完即删；自测直接调）：
 * repoRoot 是仓库根目录，remoteUrl 是推送地址（https 或本地
 * bare 仓库路径，自测用后者），branch 是要推的分支。返回
 * { ok, error }，error 里绝不含令牌。 */
let lastGitAskpassDir = '';
async function gitPushRepo(repoRoot, remoteUrl, token, branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-git-askpass-'));
  lastGitAskpassDir = dir;
  try {
    const isWin = process.platform === 'win32';
    const scriptPath = path.join(dir, isWin ? 'askpass.cmd' : 'askpass.sh');
    // GitHub 细粒度令牌只含字母数字与下划线，两种写法都安全；
    // 令牌只写进这个临时文件，不进命令行、环境变量与日志。
    if (isWin) fs.writeFileSync(scriptPath, `@echo off\r\necho ${token}\r\n`, 'utf8');
    else { fs.writeFileSync(scriptPath, `#!/bin/sh\necho '${token}'\n`, 'utf8'); fs.chmodSync(scriptPath, 0o700); }
    const r = await runCmd('git', ['push', String(remoteUrl), `HEAD:${branch}`], 120000,
      { cwd: repoRoot, env: { ...process.env, GIT_ASKPASS: scriptPath, GIT_TERMINAL_PROMPT: '0' } });
    if (r.code === 0) return { ok: true, error: '' };
    const tail = `${r.err || ''} ${r.out || ''}`.trim().split('\n').filter(Boolean).slice(-2).join('；').slice(0, 200);
    if (/Invalid username|Authentication failed|403|401/i.test(tail)) return { ok: false, error: '令牌无效或已过期，请重新在工具来源登录 GitHub' };
    return { ok: false, error: tail ? `推送失败：${tail}` : '推送失败：git 没有返回原因' };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 删不掉不影响发布结果 */ }
  }
}
const GIT_PUSH_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}.git`;
let publishNewVersionRunning = false;
async function publishNewVersion(opts) {
  const o = opts || {};
  if (publishNewVersionRunning) return { ok: false, error: '正在发布新版本，请稍候' };
  // 1) git 是否可用。
  const gitVer = await runCmd('git', ['--version'], 15000);
  if (gitVer.code !== 0) return { ok: false, code: 'no-git', error: '本机没有安装 Git：请先安装 Git（https://git-scm.com），再点「发布新版本」；也可以改用更新页的「发布本地版本到仓库」（走 GitHub 接口，不用 Git）' };
  // 2) 是否仓库副本。
  const rootR = await runCmd('git', ['rev-parse', '--show-toplevel'], 15000, { cwd: __dirname });
  if (rootR.code !== 0) return { ok: false, code: 'not-repo', error: '当前安装不是仓库副本（找不到 .git）：请在仓库克隆目录里运行工具箱，或改用更新页的「发布本地版本到仓库」' };
  const repoRoot = String(rootR.out || '').trim();
  if (!repoRoot) return { ok: false, code: 'not-repo', error: '当前安装不是仓库副本（找不到 .git）：请在仓库克隆目录里运行工具箱，或改用更新页的「发布本地版本到仓库」' };
  // 3) 必须在 main 分支。
  const brR = await runCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 15000, { cwd: repoRoot });
  const branch = String(brR.out || '').trim();
  if (brR.code !== 0 || branch !== 'main') return { ok: false, code: 'not-main', error: `当前分支不是 main（是 ${branch || '未知'}），请先切到 main 再发布` };
  // 4) 令牌。
  const token = getConfig().githubToken || '';
  if (!token) return { ok: false, code: 'no-token', error: '先在工具来源登录 GitHub' };
  // 5) 磁盘上的版本号必须一致（读磁盘，不读内存里的旧 VERSION）。
  let pkgVersion = '';
  try { pkgVersion = String(JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || ''); } catch (e) { return { ok: false, error: 'package.json 读不到' }; }
  let mainSrc = '';
  try { mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'); } catch (e) { return { ok: false, error: 'main.js 读不到' }; }
  const mVer = mainSrc.match(/^const VERSION = '([^']+)';/m);
  const mDisp = mainSrc.match(/^const DISPLAY_VERSION = '([^']+)';/m);
  if (!mVer || !mDisp || mVer[1] !== pkgVersion || mDisp[1] !== displayVersionFromInternal(pkgVersion)) {
    return { ok: false, error: '本地版本号不一致（package.json 与 main.js），请先同步再发布' };
  }
  const next = nextVersionFromInternal(pkgVersion);
  if (!next) return { ok: false, error: `当前版本号格式不对：${pkgVersion}，应为 YYYY.MM.DD-N` };
  // 6) 白名单文件（只加存在的；自测记录只有已写好的才进）。
  const recordFile = `self-test-${next.display}.md`;
  const files = [...HOT_UPDATE_FILES, 'package.json', 'update-manifest.json', 'README.md', recordFile]
    .filter((f) => { try { return fs.existsSync(path.join(__dirname, f)); } catch (e) { return false; } });
  if (o.dryRun) {
    return { ok: true, dryRun: true, currentVersion: displayVersionFromInternal(pkgVersion), nextVersion: next.display, files, branch, repoRoot };
  }
  publishNewVersionRunning = true;
  // 升版前先快照三处，失败回滚；提交成功后不再回滚。
  const snap = {};
  for (const f of ['package.json', 'main.js', 'update-manifest.json']) {
    try { snap[f] = fs.readFileSync(path.join(__dirname, f)); } catch (e) { snap[f] = null; }
  }
  const restore = () => { for (const f of Object.keys(snap)) { try { if (snap[f] !== null) fs.writeFileSync(path.join(__dirname, f), snap[f]); } catch (e) { /* 恢复失败如实留在错误里 */ } } };
  try {
    // 7) 升版：package.json → main.js 两处 → 重新生成清单。
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    pkg.version = next.internal;
    fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    let nextSrc = mainSrc.replace(/^const VERSION = '[^']+';/m, `const VERSION = '${next.internal}';`);
    if (nextSrc === mainSrc) { restore(); return { ok: false, error: 'main.js 的 VERSION 替换失败，已恢复原文件' }; }
    nextSrc = nextSrc.replace(/^const DISPLAY_VERSION = '[^']+';/m, `const DISPLAY_VERSION = '${next.display}';`);
    if (nextSrc === mainSrc) { restore(); return { ok: false, error: 'main.js 的 DISPLAY_VERSION 替换失败，已恢复原文件' }; }
    fs.writeFileSync(path.join(__dirname, 'main.js'), nextSrc, 'utf8');
    fs.writeFileSync(path.join(__dirname, 'update-manifest.json'), JSON.stringify(buildUpdateManifest(), null, 2) + '\n', 'utf8');
    // 8) 精确 git add（白名单，相对仓库根目录）。
    const rels = files.map((f) => path.relative(repoRoot, path.join(__dirname, f)).split(path.sep).join('/'));
    const addR = await runCmd('git', ['add', '--', ...rels], 30000, { cwd: repoRoot });
    if (addR.code !== 0) { restore(); return { ok: false, error: `git add 失败：${String(addR.err || addR.out || '').trim().slice(0, 200) || '没有返回原因'}，已恢复版本文件` }; }
    const stagedR = await runCmd('git', ['diff', '--cached', '--quiet'], 15000, { cwd: repoRoot });
    if (stagedR.code === 0) { restore(); return { ok: false, error: '没有可发布的改动，已恢复版本文件' }; }
    // 9) 提交身份：先读仓库配置，没有再用令牌的 GitHub 账号。
    let authorName = '', authorEmail = '';
    try { authorName = String((await runCmd('git', ['config', 'user.name'], 15000, { cwd: repoRoot })).out || '').trim(); } catch (e) { /* 没有就走令牌 */ }
    try { authorEmail = String((await runCmd('git', ['config', 'user.email'], 15000, { cwd: repoRoot })).out || '').trim(); } catch (e) { /* 没有就走令牌 */ }
    if (!authorName || !authorEmail) {
      const me = await githubApi('/user', token, 'GET', null, {});
      if (me.ok && me.data && me.data.login) {
        authorName = authorName || String(me.data.login);
        authorEmail = authorEmail || `${me.data.id || ''}+${me.data.login}@users.noreply.github.com`;
      }
    }
    if (!authorName || !authorEmail) { restore(); return { ok: false, error: '请先设置 Git 提交身份（git config user.name / user.email），或确认 GitHub 令牌有效；版本文件已恢复' }; }
    const msg = `桌面工具箱 ${next.display}：发布新版本`;
    const commitR = await runCmd('git', ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'commit', '-m', msg], 30000, { cwd: repoRoot });
    if (commitR.code !== 0) { restore(); return { ok: false, error: `git commit 失败：${String(commitR.err || commitR.out || '').trim().slice(0, 200) || '没有返回原因'}，版本文件已恢复（提交未建）` }; }
    let commit = '';
    try { commit = String((await runCmd('git', ['rev-parse', 'HEAD'], 15000, { cwd: repoRoot })).out || '').trim(); } catch (e) { /* 没有不影响 */ }
    // 10) 推送（askpass 临时文件，用完即删）。提交已建，失败不回滚。
    const pushR = await gitPushRepo(repoRoot, GIT_PUSH_URL, token, 'main');
    if (!pushR.ok) return { ok: false, code: 'push-failed', commit, error: `${pushR.error}。新版本已在本地提交（${commit ? commit.slice(0, 7) : '未知'}），请稍后手动执行 git push origin main` };
    saveUpdateState({ lastPublishAt: new Date().toISOString(), lastPublishVersion: next.display });
    return { ok: true, version: next.display, commit, files, branch: 'main' };
  } catch (e) {
    try { restore(); } catch (e2) { /* 忽略 */ }
    return { ok: false, error: `发布失败：${e.message || String(e)}，版本文件已恢复` };
  } finally {
    publishNewVersionRunning = false;
  }
}

/* ---------------- 工具箱本地功能：智能体/创作/代码/图像/监控/记账本/
 * 注册/文件/代理 —— 全部是工具箱自己的实现与本地数据。 */

function localId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
/* 2026-11-28-2：数据文件原子写与损坏保护。写：先写同目录临时文件
 * 再改名替换（同文件系统内改名是原子的），写一半崩溃也不会留
 * 半截文件。读：解析失败时把损坏文件另存一份 .corrupt-<时间戳>
 * 副本再返回 fallback，同一文件每个进程只通知一次。 */
const corruptNotified = new Set();
function backupCorruptFile(fp, name, reason) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(fp, `${fp}.corrupt-${stamp}`);
  } catch (e) { /* 副本写失败不影响 */ }
  if (!corruptNotified.has(name)) {
    corruptNotified.add(name);
    // 2026-11-28-8：原因分开写——未知版本不是解析失败，别误导用户。
    const r = reason || '解析失败';
    console.error(`[数据损坏] ${name} ${r}，已保留损坏副本，改用空数据`);
    try { notify(r === '解析失败' ? '数据文件损坏' : '数据文件版本未知', `${name} ${r}，已保留副本，改用空数据（旧文件未删除）。`); } catch (e) { /* 通知失败不影响 */ }
  }
}
function atomicWriteFile(fp, text) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, fp);
}
function readJsonFile(name, fallback) {
  const fp = path.join(userDataDir(), name);
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { backupCorruptFile(fp, name); }
  return fallback;
}
function writeJsonFile(name, value) {
  atomicWriteFile(path.join(userDataDir(), name), JSON.stringify(value, null, 2));
}
/* 2026-11-28-8：写任意路径的 JSON（不在 userDataDir 根目录的也
 * 走原子写，如插件 store）；文本文件直接用 atomicWriteFile。 */
function atomicWriteJsonFile(fp, value) {
  atomicWriteFile(fp, JSON.stringify(value, null, 2));
}

/* 经代理（配置在设置里，HTTP CONNECT）或直连发一个 JSON 请求，
 * 返回 { ok, status, data, error }。工具箱自己的网络请求都走这里。
 * 2026-11-28-2：opts.proxyOverride = 'direct' 强制直连、'proxy'
 * 强制走代理（智能体抽屉的代理策略）；网络闪断（无 HTTP 状态的
 * 连接错误）重试一次再报错，400/422 的去参数重试在调用方做。 */
const NETWORK_BLIP_RE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i;
async function httpJson(method, urlStr, bodyObj, headers, timeoutMs = 120000, opts = {}) {
  const r = await httpJsonOnce(method, urlStr, bodyObj, headers, timeoutMs, opts);
  if (!r.ok && !r.status && NETWORK_BLIP_RE.test(r.error || '')) {
    return httpJsonOnce(method, urlStr, bodyObj, headers, timeoutMs, opts);
  }
  return r;
}
function httpJsonOnce(method, urlStr, bodyObj, headers, timeoutMs = 120000, opts = {}) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const cfg = getConfig();
    let px = effectiveProxy(u.hostname);
    let useProxy = !!px;
    if (opts.proxyOverride === 'direct') { useProxy = false; px = null; }
    else if (opts.proxyOverride === 'proxy' && !px) {
      px = cfg.proxyHost ? { host: cfg.proxyHost, port: Number(cfg.proxyPort) || 8080 } : null;
      useProxy = !!px;
    }
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
/* 2026-11-28-2：agents.json 带 version 字段：{version:1, updatedAt,
 * items:[...]}。旧版存的是裸数组，getAgents() 两种都认；以后升
 * 格式只改这里的版本号与兼容分支。2026-11-28-8：高于当前版本的
 * 先备份原文件再按空处理，不静默覆盖。 */
function getAgents() {
  const v = readJsonFile('agents.json', []);
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  if (v && typeof v === 'object' && typeof v.version === 'number' && v.version > CURRENT_AGENTS_VERSION) backupUnknownVersionFile('agents.json', v.version);
  return [];
}
function saveAgents(list) { writeJsonFile('agents.json', { version: CURRENT_AGENTS_VERSION, updatedAt: Date.now(), items: Array.isArray(list) ? list : [] }); }
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
  // 2026-11-28-7：网页智能体站——嗅探自动保存与手动添加的预设。
  deepseek: { siteName: 'DeepSeek', loginUrl: 'https://chat.deepseek.com', signupUrl: 'https://chat.deepseek.com/sign-up' },
  doubao: { siteName: '豆包', loginUrl: 'https://www.doubao.com/chat/', signupUrl: 'https://www.doubao.com/chat/' },
  qwen: { siteName: '通义千问', loginUrl: 'https://chat.qwen.ai', signupUrl: 'https://chat.qwen.ai' },
  gemini: { siteName: 'Gemini', loginUrl: 'https://gemini.google.com', signupUrl: 'https://gemini.google.com' },
};
/* 2026-11-28-8：accounts.json 迁移到带 version 的格式
 * {version:1, updatedAt, items:[...]}。旧版存的是裸数组，读到即
 * 升版写回；单条旧记录缺新字段时按 -16 的默认值补（kind 凭证、
 * source 手动、identity 空串），不丢数据。高于当前版本的先备份
 * 原文件再按空处理，不静默覆盖。 */
function normalizeAccountRecord(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    ...a,
    id: String(a.id || `acc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    kind: normalizeAccountKind(a.kind),
    identity: String(a.identity || '').trim().slice(0, 120),
    secret: String(a.secret || ''),
    source: String(a.source || '') === 'sniff' ? 'sniff' : 'manual',
    autoSavedAt: Number(a.autoSavedAt || 0) || 0,
  };
}
function getAccounts() {
  const v = readJsonFile('accounts.json', []);
  if (Array.isArray(v)) {
    const items = v.map(normalizeAccountRecord).filter(Boolean);
    try { writeJsonFile('accounts.json', { version: CURRENT_ACCOUNTS_VERSION, updatedAt: Date.now(), items }); } catch (e) { /* 升版写回失败不拦读 */ }
    return items;
  }
  if (v && typeof v === 'object') {
    if (v.version === CURRENT_ACCOUNTS_VERSION && Array.isArray(v.items)) return v.items.map(normalizeAccountRecord).filter(Boolean);
    if (typeof v.version === 'number' && v.version > CURRENT_ACCOUNTS_VERSION) backupUnknownVersionFile('accounts.json', v.version);
  }
  return [];
}
function saveAccounts(list) { writeJsonFile('accounts.json', { version: CURRENT_ACCOUNTS_VERSION, updatedAt: Date.now(), items: (Array.isArray(list) ? list : []).map(normalizeAccountRecord).filter(Boolean) }); }
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
    // 2026-11-27-11：统一嗅探——登录检测读到的 cookie 同时进 Cookie
    // 类别（只发渲染层内存展示，不落盘、不写日志，值由渲染层打码）。
    if (sniffEnabledFlag && Array.isArray(cookies)) {
      for (const c of cookies) {
        try { sendToRenderer('browser-auth-found', { category: 'cookie', name: String(c.name || ''), value: String(c.value || ''), sourceUrl: String(url || ''), host: u.hostname, expires: Number(c.expirationDate || 0), via: '登录检测' }); } catch (e) { /* 发不出不影响登录判断 */ }
      }
    }
    const hit = (cookies || []).map((c) => c.name).find((n) => isAuthCookieName(n)) || '';
    return { ok: true, loggedIn: !!hit, matchedKey: hit, host: u.hostname };
  } catch (e) { return { ok: false, loggedIn: false, error: e.message || String(e) }; }
}
/* “本次忽略 / 不再提示该站点”：本次忽略只放内存（退出即忘），
 * 不再提示落盘 account-login-ignored.json。 */
const loginIgnoreSession = new Set();
function loginIgnoreFile() { return path.join(userDataDir(), 'account-login-ignored.json'); }
function loginIgnoreLoad() { try { const v = JSON.parse(fs.readFileSync(loginIgnoreFile(), 'utf8')); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function loginIgnoreSave(v) { try { writeJsonFile('account-login-ignored.json', v); } catch (e) { /* 忽略 */ } }
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
/* 2026-11-28-7：账号类型 kind（credential 凭证 / password 密码 /
 * api API 密钥）与来源 source（manual 手动 / sniff 嗅探自动保存）。
 * 旧 accounts.json 没有这些字段时按 kind='credential'、
 * source='manual'、identity='' 处理，不丢旧数据。密钥值 secret
 * 只存 data/accounts.json，列表接口绝不返回原文，只给脱敏值
 * secretMasked 与 hasSecret；复制走 account-copy-secret，在主
 * 进程写剪贴板，值不经过渲染层、不写日志。 */
const ACCOUNT_KINDS = ['credential', 'password', 'api'];
function normalizeAccountKind(v) { const k = String(v || '').trim().toLowerCase(); return ACCOUNT_KINDS.includes(k) ? k : 'credential'; }
function maskAccountSecret(v) {
  const s = String(v ?? '');
  if (!s) return '';
  if (s.length > 8) return `${s.slice(0, 2)}••••${s.slice(-2)}`;
  if (s.length > 4) return `${s.slice(0, 1)}••••${s.slice(-1)}`;
  return '••••';
}
/* 公开视图：绝不含代理密码。signupUrl 与结构化代理（不含密码）
 * 随列表返回，供编辑回填；proxySummary 只作展示保留。 */
function publicAccountView(a) {
  const proxy = (a.proxy && typeof a.proxy === 'object') ? a.proxy : null;
  const hasProxy = !!(proxy && proxy.host);
  const secret = String((a && a.secret) || '');
  return {
    id: a.id, site: a.site || '', siteName: a.siteName || a.site || '',
    loginUrl: a.loginUrl || '', signupUrl: a.signupUrl || '', name: a.name || '', group: a.group || '', note: a.note || '',
    kind: normalizeAccountKind(a.kind), identity: String(a.identity || ''),
    source: String(a.source || '') === 'sniff' ? 'sniff' : 'manual',
    autoSavedAt: Number(a.autoSavedAt || 0) || 0,
    hasSecret: !!secret, secretMasked: maskAccountSecret(secret),
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
  // 2026-11-28-8：裸写收口，JS 文本走 atomicWriteFile（临时文件 + rename）。
  atomicWriteFile(accountPreloadPath(account.id), content);
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
/* 2026-11-28-2：按服务商给默认模型（保存时模型为空就按此补；
 * 匹配不上时保存直接要求填模型，不再默认发 gpt-4o-mini）。 */
function defaultModelForAgent(agent) {
  const p = String(agent.provider || '').toLowerCase();
  const base = agentBase(agent);
  if (p === 'deepseek' || /api\.deepseek\.com/i.test(base)) return 'deepseek-chat';
  if (p === 'openai' || /api\.openai\.com/i.test(base)) return 'gpt-4o-mini';
  return '';
}
/* 2026-11-28-2：智能体代理策略（抽屉字段，以前是死字段）：
 * direct 直连、proxy 走代理、global（默认）跟随全局设置。
 * httpJson/fetchText 通过 opts.proxyOverride 接收。 */
function agentProxyOverride(agent) {
  const p = String(agent.proxyPolicy || 'global');
  if (p === 'direct') return 'direct';
  if (p === 'proxy') return 'proxy';
  return null;
}
/* 温度：抽屉填了才进请求体（0-2 夹取），没填不发，由服务端默认。 */
function agentTemperature(agent) {
  const t = Number(agent.temperature);
  if (!Number.isFinite(t)) return null;
  return Math.min(2, Math.max(0, t));
}
/* 2026-11-28-2：历史截断——只取最近 N 轮（1 轮 = 用户+助手
 * 两条消息），N 取智能体 contextLength，默认 20。 */
function truncateHistoryMessages(messages, rounds) {
  const n = Number(rounds);
  const r = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(-r * 2);
}
/* 2026-11-28-2：三路共用的系统提示拼装（API 聊天、agentComplete、
 * 网页提示词同一顺序）：系统提示 → 长期记忆 → 技能（去重）→
 * 工具说明（仅 toolsEnabled 为 true 时）。 */
function buildSystemPrompt(agent, extraSystem) {
  const parts = [];
  if (agent.systemPrompt) parts.push(agent.systemPrompt);
  // 2026-11-28-9，第 5 项：长期记忆开关（agent.memoryEnabled，缺省开；
  // 关了就不随对话发给智能体，记忆本身保留在智能体上）。
  if (agent.memoryEnabled !== false && Array.isArray(agent.memories) && agent.memories.length) {
    parts.push(`长期记忆：\n${agent.memories.map((m) => `- ${m.text}`).join('\n')}`);
  }
  const skillSection = skillPromptSection(agent);
  if (skillSection) parts.push(skillSection);
  if (extraSystem) parts.push(extraSystem);
  if (agent.toolsEnabled === true) parts.push(AGENT_TOOLS_SPEC);
  return parts.join('\n\n');
}
function agentBase(agent) { return (agent.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''); }
/* 2026-11-26-7：Anthropic 不是 OpenAI 兼容接口，走 Messages API
 *（POST /v1/messages，x-api-key + anthropic-version，system 放顶层）。
 *其余服务商（DeepSeek、OpenAI、Kimi、智谱、xAI、Mistral、混元、
 *文心千帆 v2、OpenRouter、硅基流动、豆包、通义千问、Gemini、自定义）
 *均为 OpenAI 兼容，走 /chat/completions + Bearer。
 * 2026-11-28-2：模型为空直接报错（保存时已按服务商补默认或要求
 * 填）；温度进请求体；400/422 去附加参数重试一次；空回复算失败，
 * 不入库。 */
/* 2026-11-28-6：屏幕翻译——视觉消息。OpenAI 兼容接口直接用
 * image_url 内容块；Anthropic 走原生 image 内容块（base64），
 * 这里把 image_url 的 data URL 转成 Anthropic 的格式。字符串
 * 内容原样通过，不影响已有调用。 */
function visionContentForAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  const out = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') { out.push({ type: 'text', text: String(part.text || '') }); continue; }
    if (part.type === 'image_url' && part.image_url && typeof part.image_url.url === 'string') {
      const m = part.image_url.url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (m) out.push({ type: 'image', source: { type: 'base64', media_type: m[1].toLowerCase(), data: m[2] } });
    }
  }
  return out;
}
async function agentChatCompletions(agent, messages) {
  const base = agentBase(agent);
  if (!agent.model) return { ok: false, error: '先在智能体里填模型' };
  const proxyOverride = agentProxyOverride(agent);
  const temperature = agentTemperature(agent);
  if (String(agent.provider || '').toLowerCase() === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: visionContentForAnthropic(m.content) }));
    const headers = { 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' };
    const minimal = { model: agent.model, max_tokens: agent.maxTokens || 4096, ...(sys ? { system: sys } : {}), messages: rest };
    let r = await httpJson('POST', `${base}/messages`, { ...minimal, ...(temperature != null ? { temperature } : {}) }, headers, 120000, { proxyOverride });
    if (!r.ok && (r.status === 400 || r.status === 422)) r = await httpJson('POST', `${base}/messages`, minimal, headers, 120000, { proxyOverride });
    if (!r.ok) return r;
    const text = (r.data?.content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
    if (!text.trim()) return { ok: false, error: '模型返回了空内容' };
    return { ok: true, text };
  }
  const headers = { Authorization: `Bearer ${agent.apiKey}` };
  const minimal = { model: agent.model, messages };
  let r = await httpJson('POST', `${base}/chat/completions`, { ...minimal, ...(temperature != null ? { temperature } : {}) }, headers, 120000, { proxyOverride });
  if (!r.ok && (r.status === 400 || r.status === 422)) r = await httpJson('POST', `${base}/chat/completions`, minimal, headers, 120000, { proxyOverride });
  if (!r.ok) return r;
  const text = r.data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) return { ok: false, error: '模型返回了空内容' };
  return { ok: true, text };
}
/* 2026-11-28-2：流式聊天——API 路径接 SSE 流式回推，onDelta 逐块
 * 回推累计文本；渲染层据此追加显示。停止：agentChatStop(chatId)
 * 置标志后 fetchText 的 shouldStop 回调断开请求，返回已收到的
 * 部分（stopped:true）。 */
const agentStreamStop = new Set();
function agentChatStop(chatId) { agentStreamStop.add(String(chatId || '')); return { ok: true }; }
async function agentChatCompletionsStream(agent, messages, onDelta, stopKey) {
  const base = agentBase(agent);
  if (!agent.model) return { ok: false, error: '先在智能体里填模型' };
  const isAnthropic = String(agent.provider || '').toLowerCase() === 'anthropic';
  const temperature = agentTemperature(agent);
  let url, headers, body;
  if (isAnthropic) {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    url = `${base}/messages`;
    headers = { 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: agent.model, max_tokens: agent.maxTokens || 4096, ...(sys ? { system: sys } : {}), messages: rest, stream: true, ...(temperature != null ? { temperature } : {}) };
  } else {
    url = `${base}/chat/completions`;
    headers = { Authorization: `Bearer ${agent.apiKey}` };
    body = { model: agent.model, messages, stream: true, ...(temperature != null ? { temperature } : {}) };
  }
  let buf = '';
  let text = '';
  const onLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data = null;
    try { data = JSON.parse(payload); } catch (e) { return; }
    let delta = '';
    if (isAnthropic) {
      if (data.type === 'content_block_delta' && data.delta && data.delta.type === 'text_delta') delta = data.delta.text || '';
    } else {
      delta = (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) || '';
    }
    if (delta) { text += delta; if (onDelta) { try { onDelta(text); } catch (e) { /* 回调失败不影响接收 */ } } }
  };
  try {
    const r = await fetchText(url, {
      method: 'POST', timeoutMs: 120000,
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body), proxyOverride: agentProxyOverride(agent),
      shouldStop: () => agentStreamStop.has(String(stopKey || '')),
      onChunk: (chunk) => { buf += chunk; let idx; while ((idx = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, idx); buf = buf.slice(idx + 1); onLine(line); } },
    });
    if (buf.trim()) onLine(buf);
    if (r.stopped) return { ok: true, text, stopped: true };
    if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status || ''}` };
    if (!text.trim()) return { ok: false, error: '模型返回了空内容' };
    return { ok: true, text };
  } finally {
    if (stopKey) agentStreamStop.delete(String(stopKey));
  }
}
async function agentChatSend(chatId, content) {
  const chats = getAgentChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: '对话不存在' };
  const agent = getAgents().find((a) => a.id === chat.agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  // 2026-11-28-2：用户消息先落库（写库、设标题、更新 updatedAt），
  // 再按类型分流——网页分支以前在入队前就拼提示词，用户消息从
  // 未入库，还用 slice(0,-1) 丢了上一条。
  const historyBefore = chat.messages.slice();
  chat.messages.push({ role: 'user', content, at: Date.now() });
  const firstUser = chat.messages.find((m) => m.role === 'user');
  if (firstUser) chat.title = firstUser.content.slice(0, 24);
  chat.updatedAt = Date.now();
  writeJsonFile('agent-chats.json', chats);
  if (agent.connectionType === 'web') {
    const fullPrompt = buildWebPrompt(agent, historyBefore, content);
    let r;
    try {
      r = await webChatSend(agent, fullPrompt, chatId, (partial) => {
        sendToRenderer('agent-chat-delta', { chatId, text: partial });
      });
    } finally {
      agentStreamStop.delete(String(chatId));
    }
    if (!r.ok) return { ok: false, error: r.error, chat };
    const finalChat = appendChatMessage(chatId, 'assistant', r.text);
    return { ok: true, chat: finalChat, stopped: !!r.stopped };
  }
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥', chat };
  return agentChatSendModel(chat, agent, content);
}
/* 模型调取：agentChatSend 与重新生成共用——调用时聊天里已有本条
 * 用户消息，不再追加。 */
async function agentChatSendModel(chat, agent, content) {
  const chatId = chat.id;
  // v1.6.0：自然语言入口——先按本地意图匹配工具调用（不需要密钥）。
  const intent = parseToolIntent(content);
  if (intent) {
    const done = await executeToolCall(intent, chatId);
    return { ok: done.ok !== false, chat: done.chat || getAgentChats().find((c) => c.id === chatId), pending: done.pending || false, actionId: done.actionId };
  }
  const sys = buildSystemPrompt(agent);
  const sysMsg = sys ? [{ role: 'system', content: sys }] : [];
  const history = truncateHistoryMessages(getAgentChats().find((c) => c.id === chatId)?.messages || chat.messages, agent.contextLength);
  const msgs = [...sysMsg, ...history.map((m) => ({ role: m.role, content: m.content }))];
  let r;
  if (agent.streaming !== false) {
    r = await agentChatCompletionsStream(agent, msgs, (partial) => {
      sendToRenderer('agent-chat-delta', { chatId, text: partial });
    }, chatId);
  } else {
    r = await agentChatCompletions(agent, msgs);
  }
  if (!r.ok) return { ok: false, error: r.error, chat: getAgentChats().find((c) => c.id === chatId) };
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
  return { ok: true, chat: finalChat, stopped: !!r.stopped };
}
/* 2026-11-28-2：重新生成——只重调模型，不追加用户消息。把对话
 * 截到最后一条用户消息（含），丢掉其后的助手回复，再走同一条
 * 模型调取路径。 */
async function agentChatRegenerate(chatId) {
  const chats = getAgentChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: '对话不存在' };
  const agent = getAgents().find((a) => a.id === chat.agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  let lastUserIdx = -1;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    if (chat.messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return { ok: false, error: '没有可重新生成的用户消息' };
  chat.messages = chat.messages.slice(0, lastUserIdx + 1);
  chat.updatedAt = Date.now();
  writeJsonFile('agent-chats.json', chats);
  if (agent.connectionType === 'web') {
    const historyBefore = chat.messages.slice(0, -1);
    const content = chat.messages[lastUserIdx].content;
    const fullPrompt = buildWebPrompt(agent, historyBefore, content);
    let r;
    try {
      r = await webChatSend(agent, fullPrompt, chatId, (partial) => {
        sendToRenderer('agent-chat-delta', { chatId, text: partial });
      });
    } finally {
      agentStreamStop.delete(String(chatId));
    }
    if (!r.ok) return { ok: false, error: r.error, chat };
    const finalChat = appendChatMessage(chatId, 'assistant', r.text);
    return { ok: true, chat: finalChat, stopped: !!r.stopped };
  }
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥', chat };
  return agentChatSendModel(chat, agent, chat.messages[lastUserIdx].content);
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
    const prompt = [buildSystemPrompt(agent, system), `用户：${userText}`].filter(Boolean).join('\n\n');
    const r = await webChatSend(agent, prompt);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, text: r.text };
  }
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  const sys = buildSystemPrompt(agent, system);
  const r = await agentChatCompletions(agent, [{ role: 'system', content: sys }, { role: 'user', content: userText }]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.text || '' };
}
/* 2026-11-28-2：轻量连接探测——GET {base}/models，不发计费调用。
 * 校验地址 https 前缀、Key 存在、返回模型数、当前模型是否在列表中；
 * 空列表或空回复都算失败。验证类调用用 20 秒短超时。 */
async function agentModelsTest(agentId) {
  const agent = getAgents().find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  if (agent.connectionType === 'web') return { ok: false, error: '网页智能体请用“验证登录”' };
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  const base = agentBase(agent);
  if (!/^https:\/\//i.test(base)) return { ok: false, error: 'API 地址须以 https:// 开头' };
  const isAnthropic = String(agent.provider || '').toLowerCase() === 'anthropic';
  const headers = isAnthropic
    ? { 'x-api-key': agent.apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${agent.apiKey}` };
  const r = await httpJson('GET', `${base}/models`, null, headers, 20000, { proxyOverride: agentProxyOverride(agent) });
  if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status || ''}` };
  const models = (r.data && Array.isArray(r.data.data) ? r.data.data : []).map((m) => String(m.id || '')).filter(Boolean);
  if (!models.length) return { ok: false, error: '接口通了，但模型列表为空' };
  const inList = agent.model ? models.includes(agent.model) : false;
  return {
    ok: true, count: models.length, models: models.slice(0, 50),
    inList, model: agent.model || '',
    note: agent.model
      ? (inList ? `连接正常，共 ${models.length} 个模型，当前模型在列表中。` : `连接正常，共 ${models.length} 个模型，但当前模型「${agent.model}」不在列表中，请核对。`)
      : `连接正常，共 ${models.length} 个模型。`,
  };
}
/* 2026-11-28-7：智能体列表的“补齐主流网页智能体”已删除——
 * 不再一键建空壳智能体；网页智能体站的登录账号改由嗅探在
 * 检测到实际登录时自动保存进账号管理（见 accountSave 的
 * source='sniff' 与渲染层的 autoSaveSniffAccount）。 */

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
  if (n.includes('chrome') && !n.includes('chromium')) return openWithDefaultBrowser('', 'chrome');
  if (n.includes('edge')) return openWithDefaultBrowser('', 'edge');
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
  if (m && m[1] && !/^(文件|文件夹|目录|设置|工具箱)/.test(m[1])) return { tool: 'launch_app', args: { name: m[1].trim() }, label: `启动 ${m[1].trim()}` };
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
      const r = openWithDefaultBrowser(args.url);
      if (!r.ok) throw new Error(r.error);
      resultText = `已在内嵌浏览器打开 ${args.url}。`;
    } else if (tool === 'open_player') {
      const r = playWithDefaultPlayer(args.url);
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
可用工具：install_app{ name }（winget 安装软件）、uninstall_app{ name }（卸载，需用户确认）、launch_app{ name }（启动程序）、open_browser{ url }（内嵌浏览器打开网页）、open_player{ url }（默认播放器播放）、run_code{ language, code }（本机解释器真实运行代码）、system_status{}（查本机状态）、search_apps{ query }（搜软件）、list_files{ dir }（列目录）、delete_file{ path }（删文件进回收站，需用户确认）、tun_install{}（装 WinTun 驱动，需用户确认）、tun_start{}（启动 Tun，需用户确认）。没有密钥、装不了、找不到程序时如实说，不要编造结果。`;

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
  saveAgents(list);
  if (next.kind === 'file') startEventWatcher(agentId, next);
  return { ok: true, trigger: next };
}
function deleteAgentTrigger(agentId, triggerId) {
  const list = getAgents();
  const agent = list.find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
  agent.triggers = (agent.triggers || []).filter((t) => t.id !== triggerId);
  saveAgents(list);
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
    if (t) {
      // 2026-11-28-2：只在成功时记 lastRun；失败记 lastError，
      // 当天还可再触发（以前失败也记已执行，当天不再重试）。
      if (r.ok !== false) { t.lastRun = new Date().toISOString().slice(0, 10); delete t.lastError; }
      else t.lastError = String(r.error || '执行失败');
      saveAgents(list);
    }
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

/* ---------- 技能（本地技能管理，2026-11-27-10） ----------
 * 技能是可复用的指令片段，存本机 skills.json，与 agents.json /
 * agent-chats.json 同一套 JSON 文件做法。技能挂到智能体上
 * （agent.skillIds），调用时把已启用技能的指令拼进系统提示，
 * 与长期记忆、工具说明同一段 sysParts，不另起调用链。 */
function getSkills() { const v = readJsonFile('skills.json', []); return Array.isArray(v) ? v : []; }
function saveSkill(input) {
  const s = (input && typeof input === 'object') ? input : {};
  const name = String(s.name || '').trim();
  const instructions = String(s.instructions || '').trim();
  if (!name) return { ok: false, error: '先填技能名称' };
  if (!instructions) return { ok: false, error: '先填技能的指令内容' };
  const list = getSkills();
  const id = String(s.id || '').trim();
  const prev = id ? list.find((x) => x.id === id) : null;
  const next = {
    id: prev ? prev.id : localId(),
    name,
    description: String(s.description || '').trim(),
    instructions,
    enabled: s.enabled !== false,
    updatedAt: Date.now(),
  };
  if (prev) list[list.indexOf(prev)] = { ...prev, ...next };
  else list.push(next);
  writeJsonFile('skills.json', list);
  return { ok: true, skill: next };
}
function deleteSkill(id) {
  const sid = String(id || '');
  writeJsonFile('skills.json', getSkills().filter((x) => x.id !== sid));
  // 挂接清理：删掉的技能不再挂在任何智能体上。
  const agents = getAgents();
  let changed = false;
  for (const a of agents) {
    if (Array.isArray(a.skillIds) && a.skillIds.includes(sid)) { a.skillIds = a.skillIds.filter((x) => x !== sid); changed = true; }
  }
  if (changed) saveAgents(agents);
  return { ok: true };
}
function setSkillEnabled(id, enabled) {
  const list = getSkills();
  const s = list.find((x) => x.id === String(id || ''));
  if (!s) return { ok: false, error: '技能不存在' };
  s.enabled = enabled !== false;
  s.updatedAt = Date.now();
  writeJsonFile('skills.json', list);
  return { ok: true, skill: s };
}
function getAgentSkills(agent) {
  if (!agent || !Array.isArray(agent.skillIds) || !agent.skillIds.length) return [];
  const all = getSkills();
  // 2026-11-28-2：skillIds 去重，同一技能只拼一次。
  return [...new Set(agent.skillIds)].map((id) => all.find((s) => s.id === id)).filter((s) => s && s.enabled !== false);
}
function skillPromptSection(agent) {
  const skills = getAgentSkills(agent);
  if (!skills.length) return '';
  return `可用技能：\n${skills.map((s) => `- ${s.name}${s.description ? `（${s.description}）` : ''}：${s.instructions}`).join('\n')}`;
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
 * 发送。事件触发只支持本机文件变化与每天到点两种。 */
const eventWatchers = new Map(); // triggerId -> { watcher, agentId, lastFire }
function stopEventWatcher(triggerId) {
  const w = eventWatchers.get(triggerId);
  if (w) { try { w.watcher.close(); } catch (e) { /* 已关 */ } eventWatchers.delete(triggerId); }
}
/* 2026-11-27-4：退出时关掉全部文件监听（好习惯；-27-3 观察到的
 * 自测后进程不退出，经最小复现证实与 fs.watch 无关——开着或
 * 关掉监听的最小应用都能干净退出，见自测记录第 9 节）。 */
function stopAllEventWatchers() {
  for (const id of [...eventWatchers.keys()]) stopEventWatcher(id);
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
function mailtmSave(v) { writeJsonFile('mailtm.json', v); }
async function mailtmAccount(baseUrl) {
  const base = String(baseUrl || MAILTM).replace(/\/+$/, '');
  const old = mailtmLoad();
  if (old && old.address && old.token) return { ok: true, account: old };
  const d = await httpJson('GET', `${base}/domains`, null, {}, 30000);
  const domain = d.data && d.data['hydra:member'] && d.data['hydra:member'][0] && d.data['hydra:member'][0].domain;
  if (!domain) return { ok: false, error: 'Mail.tm 取不到域名列表（网络不通或服务不可用）' };
  const address = `toolbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const c = await httpJson('POST', `${base}/accounts`, { address, password }, { 'Content-Type': 'application/json' }, 30000);
  if (!c.ok) return { ok: false, error: `Mail.tm 建邮箱失败：${c.error || ''}` };
  const t = await httpJson('POST', `${base}/token`, { address, password }, { 'Content-Type': 'application/json' }, 30000);
  if (!t.ok || !t.data || !t.data.token) return { ok: false, error: 'Mail.tm 取令牌失败' };
  const acc = { address, password, token: t.data.token, id: c.data && c.data.id, seen: [] };
  mailtmSave(acc);
  return { ok: true, account: { address: acc.address } };
}
async function mailtmFetch(baseUrl) {
  const base = String(baseUrl || MAILTM).replace(/\/+$/, '');
  const a = await mailtmAccount(base);
  if (!a.ok) return a;
  const acc = mailtmLoad();
  const r = await httpJson('GET', `${base}/messages`, null, { Authorization: `Bearer ${acc.token}` }, 30000);
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

/* ---------- 自测用 mock Mail.tm（2026-11-28-8） ----------
 * 本机 HTTP 服务，模拟 api.mail.tm 的 4 个端点（域名/建邮箱/取令牌/
 * 拉邮件），只在自测里用；生产代码默认仍走真实 MAILTM。 */
let mockMailtmServer = null;
async function startMockMailtmServer() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const send = (obj) => { const s = JSON.stringify(obj); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); };
      if (req.url === '/domains' && req.method === 'GET') return send({ 'hydra:member': [{ domain: 'mock.test' }] });
      if (req.url === '/accounts' && req.method === 'POST') return send({ id: 'mock-account-1' });
      if (req.url === '/token' && req.method === 'POST') return send({ token: 'mock-token-123456' });
      if (req.url === '/messages' && req.method === 'GET') return send({ 'hydra:member': [{ id: 'mock-msg-1', subject: '验证码', intro: '您的验证码是 123456，请在 10 分钟内使用。', from: { name: 'Mock', address: 'noreply@mock.test' } }] });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  mockMailtmServer = srv;
  return { base: `http://127.0.0.1:${srv.address().port}` };
}
function mockMailtmServerClose() {
  try { if (mockMailtmServer) mockMailtmServer.close(); } catch (e) { /* 关不掉不影响 */ }
  mockMailtmServer = null;
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
  // 2026-11-28-12：自检不再检测 VLC——它不是默认需要安装的项
  // （VLC 在播放器页按需装）。2026-11-28-2：便携版 Chromium 已
  // 删除，内嵌浏览器常驻可用，也不在自检里出现。
  return out;
}
async function selfcheckInstall(key) {
  if (process.platform !== 'win32') return { ok: false, error: '一键安装只在 Windows 上可用（当前不是 Windows）' };
  if (key === 'wintun') return tunInstall();
  const item = SELFCHECK_ITEMS.find((x) => x.key === key);
  if (!item || !item.wingetId) return { ok: false, error: '这一项没有一键安装（winget 本身请在微软商店装「应用安装程序」）' };
  return runWingetJob(`安装 ${item.name}`, ['install', '--id', item.wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements']);
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
      webviewTag: true, // 内嵌浏览器（webview）
    },
  };
  if (bounds) { opts.x = bounds.x; opts.y = bounds.y; }
  mainWin = new BrowserWindow(opts);
  if (cfg.alwaysOnTop === true) { try { mainWin.setAlwaysOnTop(true); } catch (e) { /* 跳过 */ } }
  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 2026-11-27-2：浏览器视频实时嗅探——默认分区与已有账号的分区都挂上
  //（新账号在 openAccount 里也会挂；重复挂有守卫，不会叠加）。
  // 2026-11-28-12：Chrome / Edge 的内嵌分区也挂上。
  ensureBrowserMediaSniff('persist:toolbox-browser');
  ensureBrowserMediaSniff('persist:toolbox-chrome');
  ensureBrowserMediaSniff('persist:toolbox-edge');
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

/* ---------- 2026-11-28-7：菜单分离为独立窗口 ----------
 * 侧栏与主窗口是同一个渲染进程里的两块 DOM，拖分隔条只能改宽、
 * 分不开。真正的分离是另开一个 BrowserWindow，只渲染菜单（同一
 * 份 index.html，带 ?menu=1，渲染层按此只显示侧栏）；主窗口侧栏
 * 收起、内容区铺满。菜单窗口里点菜单项经 IPC 转发回主窗口切页；
 * 关掉菜单窗口（点 X 或点“合并回主窗口”）即合并。分离状态与
 * 窗口位置、置顶状态存配置，下次启动恢复。 */
let menuWin = null;
function menuWindowBounds() {
  const cfg = getConfig();
  const b = (cfg.menuWindowBounds && typeof cfg.menuWindowBounds === 'object') ? cfg.menuWindowBounds : null;
  if (!b) return null;
  const w = Math.min(Math.max(240, Number(b.width) || 0), 800);
  const h = Math.min(Math.max(400, Number(b.height) || 0), 1200);
  if (!w || !h) return null;
  return { width: w, height: h, x: Number.isFinite(Number(b.x)) ? Number(b.x) : undefined, y: Number.isFinite(Number(b.y)) ? Number(b.y) : undefined };
}
function sendMenuDetachedState() {
  const detached = !!menuWin && !menuWin.isDestroyed();
  sendToRenderer('menu-detached', { detached });
}
function openMenuWindow() {
  if (menuWin && !menuWin.isDestroyed()) { try { menuWin.focus(); } catch (e) { /* 聚焦失败不影响 */ } return { ok: true, detached: true, already: true }; }
  const bounds = menuWindowBounds();
  const cfg = getConfig();
  menuWin = new BrowserWindow({
    width: (bounds && bounds.width) || 360,
    height: (bounds && bounds.height) || 720,
    minWidth: 240,
    minHeight: 400,
    title: '工具箱菜单',
    frame: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (bounds && bounds.x !== undefined && bounds.y !== undefined) { try { menuWin.setPosition(bounds.x, bounds.y); } catch (e) { /* 位置放不下不影响 */ } }
  if (cfg.menuWindowPinned === true) { try { menuWin.setAlwaysOnTop(true); } catch (e) { /* 跳过 */ } }
  menuWin.setMenuBarVisibility(false);
  menuWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { menu: '1' } });
  // 2026-11-28-9：第 8 项：窗口标题要在页面加载完再设——loadFile 后
  // document.title（桌面工具箱）会盖掉 BrowserWindow 的 title 选项。
  menuWin.webContents.once('did-finish-load', () => {
    try { if (menuWin && !menuWin.isDestroyed()) menuWin.setTitle('工具箱菜单'); } catch (e) { /* 标题改不上不影响 */ }
  });
  menuWin.on('closed', () => {
    menuWin = null;
    const c = getConfig();
    if (c.menuDetached) { c.menuDetached = false; saveConfig(c); }
    sendMenuDetachedState();
  });
  const saveBounds = () => {
    if (!menuWin || menuWin.isDestroyed()) return;
    try {
      const b = menuWin.getBounds();
      const c = getConfig();
      c.menuWindowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      saveConfig(c);
    } catch (e) { /* 存不下不影响 */ }
  };
  menuWin.on('resize', saveBounds);
  menuWin.on('move', saveBounds);
  const c = getConfig();
  c.menuDetached = true;
  saveConfig(c);
  sendMenuDetachedState();
  return { ok: true, detached: true };
}
function closeMenuWindow() {
  if (menuWin && !menuWin.isDestroyed()) {
    const w = menuWin;
    menuWin = null;
    try { w.close(); } catch (e) { /* 关不掉不影响 */ }
  }
  const c = getConfig();
  if (c.menuDetached) { c.menuDetached = false; saveConfig(c); }
  sendMenuDetachedState();
  return { ok: true, detached: false };
}
function restoreMenuWindow() {
  try {
    if (getConfig().menuDetached) openMenuWindow();
  } catch (e) { /* 恢复失败不拦启动 */ }
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
  const s = JSON.stringify(value, null, 2);
  if (s.length > 65536) return { ok: false, error: '设置太大了（最多 64KB）' };
  // 2026-11-28-8：裸写收口，走 atomicWriteFile（临时文件 + rename）。
  try { atomicWriteFile(path.join(pluginStoreDir(), String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.json'), s); return { ok: true }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
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

/* ---------- 屏幕实时翻译（2026-11-28-6） ----------
 * 框选屏幕区域 → desktopCapturer 只截选区 → 智能体一次完成
 * 认字 + 翻译（视觉调用）→ 浮窗分开展示原文与译文。
 * 翻译走翻译插件的智能体轮巡设置：参与智能体、间隔、上限、
 * 轮换位置 nextIndex 都读同一份 plugin-state（按插件名找
 * 已安装的翻译插件，再读它的 store；store 按安装 id 存，
 * 不是按 translation.json 文件名）。不支持视觉的模型调用
 * 失败时当作一次轮巡失败顺延，不报错收场。语言方向沿用
 * 插件的 from/to（auto = 中英互译，自动识别）。
 * 视觉格式：OpenAI 兼容接口用 image_url；Anthropic 在
 * agentChatCompletions 里转原生 image 内容块；Gemini API
 * 智能体在工具箱里走 OpenAI 兼容分支，所以同样用 image_url；
 * 千问/豆包的 API 智能体也是 OpenAI 兼容格式。网页令牌
 * 智能体（webChatSend）不支持传图，轮巡里遇到会直接失败
 * 顺延（见 screenTranslateVisionCall 的 web 分支说明）。 */
const SCREEN_TRANSLATE_SHORTCUT = 'CommandOrControl+Alt+T';
let screenTranslateOverlayWin = null;
let screenTranslateResultWin = null;
let screenTranslateAutoCloseTimer = null;
let screenTranslateLastRect = null;
let screenTranslateLastPng = null;
let screenTranslatePendingPayload = null;
let screenTranslateShortcutOk = null;

/* 纯函数：选区归一化（宽高 ≥ 0 的整数矩形）。 */
function normalizeScreenRect(rect) {
  const r = rect || {};
  return {
    x: Math.round(Number(r.x) || 0),
    y: Math.round(Number(r.y) || 0),
    width: Math.max(0, Math.round(Number(r.width) || 0)),
    height: Math.max(0, Math.round(Number(r.height) || 0)),
  };
}
/* 纯函数：把选区夹回指定显示区域内（不超出、不出现负宽高）。 */
function clampScreenRect(rect, display) {
  const r = normalizeScreenRect(rect);
  const d = display || { x: 0, y: 0, width: 1920, height: 1080 };
  const x = Math.max(d.x, Math.min(r.x, d.x + d.width - 1));
  const y = Math.max(d.y, Math.min(r.y, d.y + d.height - 1));
  return {
    x, y,
    width: Math.max(0, Math.min(r.width, d.x + d.width - x)),
    height: Math.max(0, Math.min(r.height, d.y + d.height - y)),
  };
}
/* 纯函数：屏幕坐标选区 → 缩略图裁剪坐标（按缩略图/显示器缩放
 * 比换算，再夹回缩略图内；display 用 bounds 坐标）。 */
function screenTranslateCropRect(rect, display, scaleX, scaleY) {
  const r = normalizeScreenRect(rect);
  const thumbW = Math.max(1, Math.round(display.width * scaleX));
  const thumbH = Math.max(1, Math.round(display.height * scaleY));
  const x = Math.round((r.x - display.x) * scaleX);
  const y = Math.round((r.y - display.y) * scaleY);
  const cx = Math.max(0, Math.min(x, thumbW - 1));
  const cy = Math.max(0, Math.min(y, thumbH - 1));
  return {
    x: cx, y: cy,
    width: Math.max(1, Math.min(Math.round(r.width * scaleX), thumbW - cx)),
    height: Math.max(1, Math.min(Math.round(r.height * scaleY), thumbH - cy)),
  };
}
/* 纯函数：浮窗位置——优先放选区右侧，右侧放不下放左侧，
 * 上下都夹回显示区域内（display 是 workArea）。 */
function screenTranslateResultPos(display, rect, width, height) {
  const d = display || { x: 0, y: 0, width: 1280, height: 800 };
  const r = normalizeScreenRect(rect);
  let x = r.x + r.width + 12;
  if (x + width > d.x + d.width) x = r.x - width - 12;
  if (x < d.x) x = d.x + 8;
  if (x + width > d.x + d.width) x = Math.max(d.x + 8, d.x + d.width - width - 8);
  let y = r.y;
  if (y + height > d.y + d.height) y = d.y + d.height - height - 8;
  if (y < d.y) y = d.y + 8;
  return { x: Math.round(x), y: Math.round(y) };
}
/* 语言方向文案：auto = 中英互译自动识别。 */
function screenTranslateDirectionLine(pair) {
  const name = (c) => ({ zh: '中文', en: '英文', ja: '日文', ko: '韩文' }[String(c || '')] || String(c || ''));
  const from = String((pair && pair.from) || 'auto');
  const to = String((pair && pair.to) || 'auto');
  if (from === 'auto' && to === 'auto') return '自动识别原文语言：原文是中文时译成英文，原文是英文或其他语言时译成中文。';
  if (to === 'auto') return `把${name(from)}译成英文（原文是英文时译成中文）。`;
  if (from === 'auto') return `把原文译成${name(to)}。`;
  return `把${name(from)}译成${name(to)}。`;
}
/* 视觉消息拼装：系统提示 + 用户文本 + image_url 图片块。
 * OpenAI 兼容接口直接用；Anthropic 由 agentChatCompletions
 * 转原生 image 块。 */
function buildScreenTranslateVisionMessages(pngBase64, pair) {
  const dir = screenTranslateDirectionLine(pair || { from: 'auto', to: 'auto' });
  const prompt = '你是屏幕翻译助手。看这张屏幕截图，把图中所有可见文字识别出来并翻译。'
    + dir
    + '只返回一个 JSON 对象，不要加任何解释：{"original": "识别出的原文，保留换行", "translated": "译文"}。'
    + '图中没有可识别文字时，original 与 translated 都返回空字符串。';
  return [
    { role: 'system', content: '你是屏幕翻译助手，只返回指定格式的 JSON，不要输出任何多余文字。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + String(pngBase64 || '') } },
      ],
    },
  ];
}
/* 解析智能体返回：JSON（可带 ``` 包裹）→ {original, translated}；
 * 键名容错 original/source/text、translated/translation/target；
 * 解析失败时整段当译文，原文留空，不丢内容。 */
function parseScreenTranslateResult(text) {
  const raw = String(text || '').trim();
  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const original = obj.original ?? obj.source ?? obj.text ?? '';
    const translated = obj.translated ?? obj.translation ?? obj.target ?? '';
    if (typeof original === 'string' || typeof translated === 'string') return { original: String(original || ''), translated: String(translated || '') };
    return null;
  };
  const tryJson = (s) => { try { return pick(JSON.parse(s)); } catch (e) { return null; } };
  let r = tryJson(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  if (r) return r;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { r = tryJson(m[0]); if (r) return r; }
  return { original: '', translated: raw };
}
/* 读翻译插件的轮巡设置：按插件名找已安装的翻译插件（name
 * 为“翻译”，或 id 为 translation），再读它的 plugin-state。
 * 没装插件 / 没勾选智能体时返回明确的 code + 提示，不静默。 */
function getTranslationRoundRobinSettings() {
  const plugins = getPlugins();
  const tr = plugins.find((p) => p && (p.name === '翻译' || p.id === 'translation'));
  if (!tr) return { ok: false, code: 'no-plugin', error: '还没装翻译插件：先在插件管理里安装翻译插件，再在插件页的“智能体轮巡设置”里勾选智能体' };
  const s = pluginStoreGet(tr.id) || {};
  const rr = (s && s.roundrobin) || {};
  const agents = Array.isArray(rr.agents) ? rr.agents.filter(Boolean) : [];
  if (!agents.length) return { ok: false, code: 'no-agents', error: '还没在翻译插件里勾选轮巡智能体：打开翻译插件页，在“智能体轮巡设置”里勾选已配密钥的智能体' };
  return { ok: true, pluginId: tr.id, settings: s };
}
/* 单个智能体的视觉翻译调用。网页令牌智能体不支持传图：
 * agentChatCompletions 只走 API 分支，web 智能体在这里直接
 * 判失败（不调 webChatSend），轮巡顺延到下一个。 */
async function screenTranslateVisionCall(agent, pngBase64, pair) {
  if (!agent || !agent.apiKey) return { ok: false, error: '未配 API 密钥' };
  if (String(agent.kind || 'api') !== 'api') return { ok: false, error: '网页令牌智能体不支持传图翻译' };
  const messages = buildScreenTranslateVisionMessages(pngBase64, pair);
  const r = await agentChatCompletions(agent, messages);
  if (!r.ok) return { ok: false, error: r.error || '调用失败' };
  const parsed = parseScreenTranslateResult(r.text);
  return { ok: true, original: parsed.original, translated: parsed.translated };
}
/* 轮巡：按翻译插件的轮巡顺序依次调用，失败顺延；成功或全部
 * 失败后都把 nextIndex 写回保存。间隔只在两次屏幕翻译之间
 * 生效（失败顺延不等待，避免一个不支持视觉的模型拖慢整轮）。 */
async function screenTranslateRoundRobin(pngBase64) {
  const st = getTranslationRoundRobinSettings();
  if (!st.ok) return st;
  const cfg = st.settings;
  const rr = cfg.roundrobin || {};
  const list = Array.isArray(rr.agents) ? rr.agents.filter(Boolean) : [];
  const pair = { from: String(cfg.from || 'auto'), to: String(cfg.to || 'auto') };
  const intervalMs = Math.max(0, Number(rr.intervalMs || 0));
  const waitMs = rr.lastCallAt ? (intervalMs - (Date.now() - Number(rr.lastCallAt))) : 0;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const failures = [];
  const tried = new Set();
  const agents = getAgents();
  let idx = Number(rr.nextIndex || 0);
  for (let i = 0; i < list.length; i++) {
    const agentId = list[idx % list.length];
    idx += 1;
    if (tried.has(agentId)) continue;
    tried.add(agentId);
    const agent = agents.find((a) => a && a.id === agentId);
    if (!agent) { failures.push({ agentId, error: '智能体不存在' }); continue; }
    const r = await screenTranslateVisionCall(agent, pngBase64, pair);
    rr.lastCallAt = Date.now();
    if (r.ok) {
      rr.nextIndex = idx % list.length;
      pluginStoreSet(st.pluginId, cfg);
      return { ok: true, agentId, agentName: agent.name, original: r.original, translated: r.translated, failures };
    }
    failures.push({ agentId, agentName: agent.name, error: r.error || '调用失败' });
  }
  rr.nextIndex = idx % list.length;
  pluginStoreSet(st.pluginId, cfg);
  return { ok: false, error: '轮巡的智能体都失败了', failures };
}
/* 只截选区：取对应显示器的屏幕缩略图，按比例裁出选区。 */
async function captureScreenRegion(rect) {
  const r = clampScreenRect(rect, screen.getPrimaryDisplay().bounds);
  if (r.width < 4 || r.height < 4) return { ok: false, error: '选区太小' };
  const display = screen.getDisplayMatching(r);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 4096, height: 4096 } });
  const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!src || !src.thumbnail) return { ok: false, error: '未取到屏幕画面' };
  const ts = src.thumbnail.getSize();
  const crop = screenTranslateCropRect(r, display.bounds, ts.width / display.bounds.width, ts.height / display.bounds.height);
  const img = src.thumbnail.crop(crop);
  const png = img.toPNG();
  return { ok: true, pngBase64: png.toString('base64'), width: img.getSize().width, height: img.getSize().height };
}
/* 选区覆盖层 HTML：全屏透明窗，选区外用 box-shadow 压暗，
 * 框内透明（露出原画面），顶部提示条 + 尺寸标签。 */
function screenTranslateOverlayHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
#sel { position: fixed; display: none; border: 2px solid #3b82f6; box-shadow: 0 0 0 9999px rgba(9,9,11,0.45); }
#hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #18181b; color: #f5f5f7; font-size: 12px; line-height: 20px; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); white-space: nowrap; }
#size-label { position: fixed; display: none; background: #18181b; color: #f5f5f7; font-size: 12px; line-height: 20px; padding: 2px 8px; border-radius: 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style></head><body>
<div id="hint">拖动框选要翻译的区域 · Esc 取消</div>
<div id="sel"></div>
<div id="size-label"></div>
<script>
var startX = 0, startY = 0, curX = 0, curY = 0, dragging = false;
var sel = document.getElementById('sel');
var sizeLabel = document.getElementById('size-label');
function updateSel() {
  var x = Math.min(startX, curX), y = Math.min(startY, curY);
  var w = Math.abs(curX - startX), h = Math.abs(curY - startY);
  sel.style.left = x + 'px'; sel.style.top = y + 'px';
  sel.style.width = w + 'px'; sel.style.height = h + 'px';
  sel.style.display = (w > 0 && h > 0) ? 'block' : 'none';
  if (w > 0 && h > 0) { sizeLabel.style.display = 'block'; sizeLabel.textContent = w + ' × ' + h; sizeLabel.style.left = (x + w + 8) + 'px'; sizeLabel.style.top = (y + h + 8) + 'px'; }
  else sizeLabel.style.display = 'none';
}
window.addEventListener('mousedown', function (e) { dragging = true; startX = e.clientX; startY = e.clientY; curX = e.clientX; curY = e.clientY; updateSel(); });
window.addEventListener('mousemove', function (e) { if (!dragging) return; curX = e.clientX; curY = e.clientY; updateSel(); });
window.addEventListener('mouseup', async function (e) {
  if (!dragging) return; dragging = false;
  var x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
  var w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
  if (w < 4 || h < 4) { await window.toolbox.screenTranslateCancel(); return; }
  await window.toolbox.screenTranslateSelect({ x: x, y: y, width: w, height: h });
});
window.addEventListener('keydown', async function (e) { if (e.key === 'Escape') await window.toolbox.screenTranslateCancel(); });
</script>
</body></html>`;
}
/* 浮窗 HTML：无边框置顶，原文/译文分段，复制/重翻/关闭；
 * 标题栏可拖（-webkit-app-region: drag），按钮 no-drag；
 * 跟随系统深浅色（prefers-color-scheme）。 */
function screenTranslateResultHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f8fafc; color: #18181b; font-size: 14px; line-height: 20px; }
.win { display: flex; flex-direction: column; height: 100%; }
.head { -webkit-app-region: drag; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-bottom: 1px solid rgba(0,0,0,0.08); }
.title { font-size: 14px; font-weight: 600; }
.agent { font-size: 12px; color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.icon-btn { -webkit-app-region: no-drag; width: 28px; height: 28px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: transparent; color: #52525b; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.icon-btn:hover { background: rgba(0,0,0,0.05); }
.icon-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
.body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.label { font-size: 12px; color: #71717a; margin: 8px 0 4px; }
.label:first-child { margin-top: 0; }
.orig { color: #52525b; white-space: pre-wrap; word-break: break-word; }
.trans { font-size: 15px; white-space: pre-wrap; word-break: break-word; }
.hint { font-size: 12px; color: #71717a; margin-top: 8px; }
.err { color: #dc2626; white-space: pre-wrap; word-break: break-word; }
.skeleton { height: 12px; border-radius: 6px; background: rgba(0,0,0,0.08); margin: 8px 0; }
.skeleton.short { width: 60%; }
.foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid rgba(0,0,0,0.08); }
.btn { flex: 1; height: 32px; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: #fff; color: #18181b; font-size: 13px; cursor: pointer; }
.btn:hover { background: #f4f4f5; }
.btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.primary:hover { background: #1d4ed8; }
.btn:disabled { opacity: 0.5; cursor: default; }
.hidden { display: none !important; }
@media (prefers-color-scheme: dark) {
  body { background: #09090b; color: #f5f5f7; }
  .head, .foot { border-color: rgba(255,255,255,0.08); }
  .icon-btn { border-color: rgba(255,255,255,0.12); color: #a1a1aa; }
  .icon-btn:hover { background: rgba(255,255,255,0.08); }
  .orig, .agent, .label, .hint { color: #a1a1aa; }
  .skeleton { background: rgba(255,255,255,0.12); }
  .btn { background: #18181b; border-color: rgba(255,255,255,0.12); color: #f5f5f7; }
  .btn:hover { background: #27272a; }
}
</style></head><body>
<div class="win">
  <div class="head">
    <span class="title">屏幕翻译</span>
    <span class="agent" id="agent-name"></span>
    <button type="button" id="btn-close" class="icon-btn" title="关闭"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
  </div>
  <div class="body">
    <div id="state-loading" class="state">
      <div class="skeleton"></div><div class="skeleton short"></div>
      <p class="hint">正在翻译…</p>
    </div>
    <div id="state-done" class="state hidden">
      <p class="label">原文</p><p class="orig" id="text-original"></p>
      <p class="label">译文</p><p class="trans" id="text-translated"></p>
      <p class="hint hidden" id="fail-note"></p>
    </div>
    <div id="state-error" class="state hidden">
      <p class="err" id="text-error"></p>
      <p class="hint" id="text-failures"></p>
    </div>
  </div>
  <div class="foot">
    <button type="button" id="btn-copy" class="btn primary hidden">复制译文</button>
    <button type="button" id="btn-retry" class="btn">重新翻译</button>
    <button type="button" id="btn-close2" class="btn">关闭</button>
  </div>
</div>
<script>
function show(id) { ['state-loading', 'state-done', 'state-error'].forEach(function (n) { document.getElementById(n).classList.toggle('hidden', n !== id); }); }
function render(p) {
  p = p || {};
  if (p.state === 'done') {
    show('state-done');
    document.getElementById('text-original').textContent = p.original || '';
    document.getElementById('text-translated').textContent = p.translated || '';
    document.getElementById('agent-name').textContent = p.agentName ? '· ' + p.agentName : '';
    document.getElementById('btn-copy').classList.remove('hidden');
    var fails = (p.failures || []).filter(function (f) { return f && f.error; });
    var note = document.getElementById('fail-note');
    if (fails.length) { note.classList.remove('hidden'); note.textContent = '之前 ' + fails.length + ' 个智能体失败，已顺延到当前智能体。'; }
    else note.classList.add('hidden');
  } else if (p.state === 'error') {
    show('state-error');
    document.getElementById('text-error').textContent = p.error || '翻译失败';
    var fails2 = (p.failures || []).filter(function (f) { return f && f.error; });
    document.getElementById('text-failures').textContent = fails2.length ? fails2.map(function (f) { return (f.agentName || f.agentId || '智能体') + '：' + f.error; }).join('；') : '';
    document.getElementById('btn-copy').classList.add('hidden');
  } else {
    show('state-loading');
    document.getElementById('btn-copy').classList.add('hidden');
  }
  if (window.toolbox && window.toolbox.screenTranslateResize) {
    requestAnimationFrame(function () {
      var h = Math.min(640, Math.max(200, document.documentElement.scrollHeight));
      window.toolbox.screenTranslateResize({ height: h });
    });
  }
}
window.addEventListener('pointerdown', function () { if (window.toolbox && window.toolbox.screenTranslateActive) window.toolbox.screenTranslateActive(); });
window.addEventListener('DOMContentLoaded', function () {
  render({ state: 'loading' });
  if (window.toolbox && window.toolbox.on) window.toolbox.on('screen-translate-result', function (p) { render(p); });
  document.getElementById('btn-copy').addEventListener('click', async function () {
    var t = document.getElementById('text-translated').textContent;
    if (!t || !window.toolbox) return;
    await window.toolbox.copyText(t);
    var b = document.getElementById('btn-copy');
    b.textContent = '已复制'; setTimeout(function () { b.textContent = '复制译文'; }, 1500);
  });
  document.getElementById('btn-retry').addEventListener('click', async function () { render({ state: 'loading' }); if (window.toolbox) await window.toolbox.screenTranslateRetry(); });
  var close = async function () { if (window.toolbox) await window.toolbox.screenTranslateClose(); };
  document.getElementById('btn-close').addEventListener('click', close);
  document.getElementById('btn-close2').addEventListener('click', close);
});
</script>
</body></html>`;
}
function closeScreenTranslateOverlay() {
  try { if (screenTranslateOverlayWin && !screenTranslateOverlayWin.isDestroyed()) screenTranslateOverlayWin.close(); } catch (e) { /* 忽略 */ }
  screenTranslateOverlayWin = null;
}
function openScreenTranslateOverlay() {
  closeScreenTranslateOverlay();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(screenTranslateOverlayHtml()));
  win.on('closed', () => { if (screenTranslateOverlayWin === win) screenTranslateOverlayWin = null; });
  screenTranslateOverlayWin = win;
  try { win.focus(); } catch (e) { /* 忽略 */ }
  return win;
}
function closeScreenTranslateResultWin() {
  clearScreenTranslateAutoClose();
  try { if (screenTranslateResultWin && !screenTranslateResultWin.isDestroyed()) screenTranslateResultWin.close(); } catch (e) { /* 忽略 */ }
  screenTranslateResultWin = null;
}
function openScreenTranslateResultWin(rect) {
  closeScreenTranslateResultWin();
  const width = 440;
  const height = 360;
  const display = rect ? screen.getDisplayMatching(rect) : screen.getPrimaryDisplay();
  const pos = screenTranslateResultPos(display.workArea, rect || { x: display.workArea.x, y: display.workArea.y, width: 0, height: 0 }, width, height);
  const win = new BrowserWindow({
    x: pos.x, y: pos.y, width, height,
    frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: true,
    minimizable: false, maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(screenTranslateResultHtml()));
  win.webContents.once('did-finish-load', () => {
    if (screenTranslatePendingPayload && !win.isDestroyed()) {
      try { win.webContents.send('screen-translate-result', screenTranslatePendingPayload); } catch (e) { /* 忽略 */ }
    }
  });
  win.on('closed', () => { if (screenTranslateResultWin === win) screenTranslateResultWin = null; });
  screenTranslateResultWin = win;
  return win;
}
function sendToScreenTranslateResult(payload) {
  screenTranslatePendingPayload = payload;
  const win = screenTranslateResultWin;
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) return; // 等 did-finish-load 再补发
  try { win.webContents.send('screen-translate-result', payload); } catch (e) { /* 忽略 */ }
}
function clearScreenTranslateAutoClose() {
  if (screenTranslateAutoCloseTimer) { clearTimeout(screenTranslateAutoCloseTimer); screenTranslateAutoCloseTimer = null; }
}
function scheduleScreenTranslateAutoClose() {
  clearScreenTranslateAutoClose();
  const cfg = getConfig().screenTranslate || {};
  if (!cfg.autoClose) return;
  screenTranslateAutoCloseTimer = setTimeout(() => { closeScreenTranslateResultWin(); }, 10000);
}
/* 入口：菜单 / 快捷键 / 设置页按钮都走这里。未配轮巡时不静默，
 * 开浮窗把原因与去处说清楚。 */
async function startScreenTranslate() {
  const st = getTranslationRoundRobinSettings();
  if (!st.ok) {
    openScreenTranslateResultWin(null);
    sendToScreenTranslateResult({ state: 'error', error: st.error, code: st.code });
    return { ok: false, code: st.code, error: st.error };
  }
  openScreenTranslateOverlay();
  return { ok: true };
}
async function screenTranslateOnSelected(rect) {
  const r = normalizeScreenRect(rect);
  closeScreenTranslateOverlay();
  if (r.width < 4 || r.height < 4) return { ok: false, error: '选区太小' };
  screenTranslateLastRect = r;
  openScreenTranslateResultWin(r);
  sendToScreenTranslateResult({ state: 'loading' });
  const cap = await captureScreenRegion(r);
  if (!cap.ok) {
    sendToScreenTranslateResult({ state: 'error', error: cap.error });
    return { ok: false, error: cap.error };
  }
  screenTranslateLastPng = cap.pngBase64;
  const res = await screenTranslateRoundRobin(cap.pngBase64);
  if (res.ok) {
    sendToScreenTranslateResult({ state: 'done', original: res.original, translated: res.translated, agentName: res.agentName, failures: res.failures });
    scheduleScreenTranslateAutoClose();
    return { ok: true };
  }
  sendToScreenTranslateResult({ state: 'error', error: res.error, failures: res.failures });
  return { ok: false, error: res.error, failures: res.failures };
}
async function screenTranslateRetry() {
  if (!screenTranslateLastPng) return { ok: false, error: '没有可重翻的图片' };
  clearScreenTranslateAutoClose();
  sendToScreenTranslateResult({ state: 'loading' });
  const res = await screenTranslateRoundRobin(screenTranslateLastPng);
  if (res.ok) {
    sendToScreenTranslateResult({ state: 'done', original: res.original, translated: res.translated, agentName: res.agentName, failures: res.failures });
    scheduleScreenTranslateAutoClose();
    return { ok: true };
  }
  sendToScreenTranslateResult({ state: 'error', error: res.error, failures: res.failures });
  return { ok: false, error: res.error, failures: res.failures };
}
function registerScreenTranslateShortcut() {
  try {
    if (globalShortcut.isRegistered(SCREEN_TRANSLATE_SHORTCUT)) { screenTranslateShortcutOk = true; return { ok: true, registered: true }; }
    const ok = globalShortcut.register(SCREEN_TRANSLATE_SHORTCUT, () => { void startScreenTranslate(); });
    screenTranslateShortcutOk = !!ok;
    return { ok: !!ok, registered: !!ok };
  } catch (e) { screenTranslateShortcutOk = false; return { ok: false, error: e.message || String(e) }; }
}
function screenTranslateStatus() {
  const st = getTranslationRoundRobinSettings();
  return {
    ok: true,
    shortcut: SCREEN_TRANSLATE_SHORTCUT,
    shortcutRegistered: screenTranslateShortcutOk === true,
    autoClose: !!(getConfig().screenTranslate && getConfig().screenTranslate.autoClose),
    configured: st.ok,
    error: st.ok ? '' : (st.error || ''),
  };
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
const BACKUP_SECRET_KEYS = { 'config.json': ['githubToken', 'imageApiKey'], 'agents.json': ['apiKey', 'webToken', 'webCookie', 'webUserAgent'] };
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

/* ---------------- 诊断包（2026-11-28-8，P0） ----------------
 * 导出内容：版本、自测结果、脱敏日志、更新记录、崩溃记录。密钥类
 * 字段一律打码，不含任何密钥；只写用户选定的本机文件，不上传。 */
const DIAG_SECRET_KEYS_RE = /apiKey|api_key|webToken|webCookie|webUserAgent|githubToken|password|passwd|secret|access_token|refresh_token|authorization/i;
function stripSecretsDeep(v, depth) {
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.map((x) => stripSecretsDeep(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = DIAG_SECRET_KEYS_RE.test(k) ? '••••' : stripSecretsDeep(val, depth + 1);
    return out;
  }
  if (typeof v === 'string') return sanitizeDiagText(v);
  return v;
}
function diagnosticsStatus() {
  const files = [];
  try {
    const dir = diagLogDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort()) {
        try {
          const fp = path.join(dir, f);
          const st = fs.statSync(fp);
          files.push({ name: f, lines: fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).length, size: st.size });
        } catch (e) { /* 读失败跳过 */ }
      }
    }
  } catch (e) { /* 忽略 */ }
  const crashes = readJsonFile('crash-log.json', []);
  const lastCrash = Array.isArray(crashes) && crashes.length ? crashes[crashes.length - 1] : null;
  const selfTestAt = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'self-test-result.json'), 'utf8')).at || ''; } catch (e) { return ''; } })();
  return { ok: true, version: DISPLAY_VERSION, logFiles: files, lastCrash, crashMarker: readCrashMarker(), selfTestAt };
}
function buildDiagnosticsBundle() {
  const selfTest = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'self-test-result.json'), 'utf8')); } catch (e) { return null; } })();
  const logs = {};
  try {
    const dir = diagLogDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort().slice(-DIAG_LOG_KEEP_DAYS)) {
        try { logs[f] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).slice(-200); } catch (e) { /* 读失败跳过 */ }
      }
    }
  } catch (e) { /* 忽略 */ }
  const crashLog = readJsonFile('crash-log.json', []);
  return stripSecretsDeep({
    tool: '桌面工具箱', version: VERSION, displayVersion: DISPLAY_VERSION,
    exportedAt: new Date().toISOString(), platform: process.platform,
    selfTest: selfTest ? { at: selfTest.at, version: selfTest.version, platform: selfTest.platform, skipped: selfTest.skipped || {} } : null,
    selfTestNative: selfTest ? selfTest.native : null,
    updateState: getUpdateState(),
    crashLog: Array.isArray(crashLog) ? crashLog.slice(-20) : [],
    logs,
  }, 0);
}
async function exportDiagnostics() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const picked = await dialog.showSaveDialog(mainWin, {
    title: '导出诊断包',
    defaultPath: path.join(defaultDownloadDir(), `toolbox-diagnostics-${stamp}.json`),
    filters: [{ name: '诊断包', extensions: ['json'] }],
  });
  if (!picked || picked.canceled || !picked.filePath) return { ok: false, canceled: true };
  try {
    atomicWriteFile(picked.filePath, JSON.stringify(buildDiagnosticsBundle(), null, 2));
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
  return { ok: true, file: picked.filePath };
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
    // 2026-11-27-10：第 11 项，Pioneer 分流跟全局代理模式（直连 / 手动时按智能分流）。
    const mode = pioneerProxyMode();
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
  // 2026-11-28-2：网络闪断重试一次（只重试 req 层网络错误，
  // 不重试 HTTP 状态错误）；流式调用方传 onChunk 逐块收文本、
  // shouldStop() 返回 true 时断开请求并返回已收到的部分。
  let retried = false;
  return new Promise((resolve) => {
    const request = (u, redirects) => {
      let parsed;
      try { parsed = new URL(u); } catch (e) { resolve({ ok: false, error: '网址无效' }); return; }
      const isHttps = parsed.protocol === 'https:';
      if (parsed.protocol !== 'http:' && !isHttps) { resolve({ ok: false, error: '只支持 http / https 地址' }); return; }
      let px = (opts && opts.forceProxy) ? opts.forceProxy : effectiveProxy(parsed.hostname);
      if (opts && opts.proxyOverride === 'direct') px = null;
      else if (opts && opts.proxyOverride === 'proxy' && !px) {
        const cfg = getConfig();
        px = cfg.proxyHost ? { host: cfg.proxyHost, port: Number(cfg.proxyPort) || 8080 } : null;
      }
      const doReq = (socket) => {
        const reqOpts = {
          method: (opts && opts.method) || 'GET',
          path: parsed.pathname + parsed.search,
          headers,
          ...(socket ? { socket, servername: parsed.hostname } : { hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80) }),
        };
        const chunks = [];
        let total = 0;
        const req = (isHttps ? https : http).request(reqOpts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            clearInterval(stopTimer); // 跳转后由新请求建自己的停止计时器
            if (redirects >= 5) { resolve({ ok: false, status: res.statusCode, error: '重定向次数过多' }); return; }
            request(new URL(res.headers.location, u).toString(), redirects + 1);
            return;
          }
          res.on('data', (d) => {
            total += d.length;
            if (total <= maxBytes) chunks.push(d);
            if (opts && typeof opts.onChunk === 'function') {
              try { opts.onChunk(d.toString('utf8')); } catch (e) { /* 回调失败不影响接收 */ }
            }
          });
          res.on('end', () => {
            clearInterval(stopTimer);
            const text = Buffer.concat(chunks).toString('utf8');
            const setCookies = res.headers['set-cookie'] || [];
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode, text, finalUrl: u, headers: res.headers, setCookies });
            else resolve({ ok: false, status: res.statusCode, text, finalUrl: u, headers: res.headers, setCookies, error: `HTTP ${res.statusCode}` });
          });
        });
        // 停止按钮：每 300ms 查一次 shouldStop，命中就断开请求，
        // 返回已收到的部分（stopped:true，调用方按“已停止”处理）。
        const stopTimer = setInterval(() => {
          if (opts && typeof opts.shouldStop === 'function' && opts.shouldStop()) {
            clearInterval(stopTimer);
            try { req.destroy(); } catch (e) { /* 已关 */ }
            resolve({ ok: false, stopped: true, status: 200, text: Buffer.concat(chunks).toString('utf8') });
          }
        }, 300);
        req.on('error', (e) => {
          clearInterval(stopTimer);
          if (!retried && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i.test(e.message || '')) {
            retried = true;
            request(u, redirects);
            return;
          }
          resolve({ ok: false, error: e.message || String(e) });
        });
        req.setTimeout(timeoutMs, () => { clearInterval(stopTimer); req.destroy(new Error('请求超时')); });
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
const SNIFF_MEDIA_EXT_RE = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|m4s|mp3|m4a|aac|ogg|oga|opus|flac|wav|jpg|jpeg|png|gif|webp|avif|bmp|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|epub)([?#]|$)/i;
function sniffKindOf(url) {
  if (/\.m3u8([?#]|$)/i.test(url)) return 'playlist';
  if (/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i.test(url)) return 'audio';
  return 'video';
}
/* 2026-11-27-11，第 3 项：嗅探分类（视频/直播流/音频/图片/文档/其他），
 * 依据 URL 后缀；直播流是 m3u8/mpd 这类清单。 */
function sniffCategoryOf(url) {
  const u = String(url || '');
  if (/\.(m3u8|mpd)([?#]|$)/i.test(u)) return 'live';
  if (/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i.test(u)) return 'audio';
  if (/\.(jpe?g|png|gif|webp|avif|bmp|svg|ico)([?#]|$)/i.test(u)) return 'image';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|epub)([?#]|$)/i.test(u)) return 'document';
  if (/\.(mp4|m4v|webm|mov|mkv|m4s|ts)([?#]|$)/i.test(u)) return 'video';
  return 'other';
}
/* 噪声过滤：埋点/统计/像素图不算媒体。只按地址特征过滤，
 * 不按大小猜（大小要等响应头，抓到时再说）。 */
const SNIFF_NOISE_RE = /(beacon|analytics|tracking|collect|pixel|__utm|_ga=|googletagmanager|hotjar|segment\.io|amplitude|sentry\.io\/api\/|log\.gif)/i;
function isSniffNoiseUrl(url) {
  const u = String(url || '');
  try { const p = new URL(u).pathname.toLowerCase(); if (/(^|\/)(pixel|1x1|spacer|blank)\.(gif|png)$/.test(p)) return true; } catch (e) { /* 解析不出按整串判 */ }
  return SNIFF_NOISE_RE.test(u);
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
/* 页面内嵌数据（2026-11-27-11，第 5 项）：__NEXT_DATA__、JSON 脚本
 * 里的配置与地址；复用 JSON 键提取的思路并扩展到 token 类字段。
 * 返回 [{name, value, via}]，进统一池的“页面数据”。 */
const PAGE_DATA_TOKEN_KEY_RE = /(access_token|refresh_token|id_token|auth_token|api[_-]?key|apikey|token|session|sid|sessionid|session_id|bearer|client_id|app_id)/i;
const PAGE_DATA_JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
function extractPageData(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const push = (name, value) => {
    const v = String(value || '');
    if (!v || v.length > 2048) return;
    const key = `${name}|${v.slice(0, 64)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (out.length >= 40) return;
    out.push({ name: String(name || ''), value: v, via: '内嵌 JSON' });
  };
  const walk = (o, path, depth) => {
    if (depth > 4 || out.length >= 40) return;
    if (typeof o === 'string') {
      if (PAGE_DATA_JWT_RE.test(o)) push(path, o);
      else { const urls = o.match(/https?:\/\/[^\s"'<>\\]+/g); if (urls) urls.slice(0, 3).forEach((u) => push(path, u)); }
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      const p = path ? `${path}.${k}` : k;
      if (typeof v === 'string' && (PAGE_DATA_TOKEN_KEY_RE.test(k) || PAGE_DATA_JWT_RE.test(v))) push(p, v);
      else walk(v, p, depth + 1);
    }
  };
  const text = String(html || '');
  const nextRe = /<script[^>]+id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
  const mNext = nextRe.exec(text);
  if (mNext) { try { walk(JSON.parse(mNext[1]), '__NEXT_DATA__', 0); } catch (e) { /* 解析不出跳过 */ } }
  const jsonRe = /<script[^>]+type\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonRe.exec(text)) !== null) { try { walk(JSON.parse(m[1]), 'script-json', 0); } catch (e) { /* 解析不出跳过 */ } }
  return out;
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
    if (isSniffNoiseUrl(abs)) return;
    const key = abs.split('#')[0] || abs;
    if (seen.has(key)) return;
    seen.add(key);
    let name = '';
    try { name = decodeURIComponent(new URL(key).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { name = ''; }
    out.push({ url: key, kind: sniffKindOf(key), category: sniffCategoryOf(key), via, name: name || `资源 ${out.length + 1}` });
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
    const items = [{ url: String(url), kind, category: sniffCategoryOf(String(url)), via: '直链' }];
    if (kind === 'playlist') {
      const pl = await fetchText(String(url), { timeoutMs: 20000, maxBytes: 262144 });
      if (pl.ok && pl.text) {
        for (const v of parseHlsVariants(pl.text, pl.finalUrl || String(url))) {
          items.push({ url: v.url, kind: 'playlist', category: 'live', resolution: v.width && v.height ? `${v.width}x${v.height}` : '', bandwidth: v.bandwidth || undefined, via: 'm3u8 变体' });
        }
      }
    }
    return { ok: true, title: '', items, pageData: [] };
  }
  const page = await fetchText(String(url), { timeoutMs: 30000 });
  if (!page.ok || !page.text) return { ok: false, error: page.status === 403 ? '这个站拒绝了访问（HTTP 403），地址可能需要登录或过验证' : (page.error ? `打开页面失败：${page.error}` : `打开页面失败（HTTP ${page.status}）`) };
  const base = page.finalUrl || String(url);
  const meta = parsePageMeta(page.text, base);
  const items = [];
  for (const c of extractSniffedMedia(page.text, base)) items.push({ url: c.url, kind: c.kind, category: c.category || sniffCategoryOf(c.url), via: c.via, note: c.name });
  let probed = 0;
  for (const c of extractSniffedMedia(page.text, base)) {
    if (c.kind !== 'playlist' || probed >= 3) continue;
    probed += 1;
    const pl = await fetchText(c.url, { timeoutMs: 20000, maxBytes: 262144 });
    if (pl.ok && pl.text) {
      for (const v of parseHlsVariants(pl.text, pl.finalUrl || c.url)) {
        items.push({ url: v.url, kind: 'playlist', category: 'live', resolution: v.width && v.height ? `${v.width}x${v.height}` : '', bandwidth: v.bandwidth || undefined, via: 'm3u8 变体' });
      }
    }
  }
  return { ok: true, title: meta.title, items, pageData: extractPageData(page.text, base) };
}
/* ---- 2026-11-27-11：统一嗅探引擎 ----
 * 原来四套分开的东西（实时媒体嗅探、粘贴网址分析 video-sniff、
 * 登录检测 browserLoginCheck、sniff-auth-cookies）整合成一套：
 * 一个总开关（config.sniffEnabled）、每个分区只挂一套 webRequest
 * 监听（开启挂、关闭摘，传 null 移除，不许重复叠加）、一次分类
 * （视频/直播流/音频/图片/文档/其他/Cookie/本地存储/请求头令牌/
 * 响应体令牌）、一个结果池（渲染层 sniffItems）、一个嗅探框按
 * 类别分组显示。video-sniff 共用同一套分类与结果格式。
 * 内嵌浏览器 webview 用的分区：默认 'persist:toolbox-browser'，
 * 用账号管理里的账号打开时换成 persist:account-<id>。
 * 只发给当前浏览器窗口——工具箱只有一个 BrowserWindow，
 * sendToRenderer 就是发给它；换页面时前端自己清空列表。
 * 注意：webRequest 回调必须每次都调，否则请求会被挂起；
 * 嗅探本身绝不能拦住页面请求，所以判断全包在 try 里。
 * .ts 只认 resourceType 为 media/xhr 的：HLS 分片是这两种，
 * 而 TypeScript 源码走 script 加载，不会被当成媒体。
 * 令牌值绝不写日志；主进程只发事件，不落盘。 */
const BROWSER_MEDIA_EXT_RE = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|m4s|mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i;
const BROWSER_MEDIA_TS_RE = /\.ts([?#]|$)/i;
/* 直播抓图片/文档：只认响应 Content-Type，且小于下限的不抓
 *（缩略图/头像/图标不过线，面板不被图片淹没）；页面分析
 *（video-sniff）不设下限，页面里明确给出的链接都算。 */
const SNIFF_IMAGE_DOC_CT_RE = /^image\/(?!svg\+xml)|^application\/pdf|^application\/(msword|vnd\.openxmlformats-officedocument)/i;
const SNIFF_LIVE_IMAGE_MIN_BYTES = 50 * 1024;
function browserMediaTypeOf(url) {
  if (/\.m3u8([?#]|$)/i.test(url)) return 'm3u8';
  if (/\.mpd([?#]|$)/i.test(url)) return 'dash';
  if (/\.m4s([?#]|$)/i.test(url)) return 'dash';
  if (/\.ts([?#]|$)/i.test(url)) return 'ts';
  const m = /\.([a-z0-9]+)([?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : 'video';
}
function sniffContentTypeOf(ct) {
  const t = String(ct || '').toLowerCase().split(';')[0].trim();
  if (t === 'image/jpeg') return 'jpg';
  if (t === 'image/png') return 'png';
  if (t === 'image/gif') return 'gif';
  if (t === 'image/webp') return 'webp';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('image/') || t.startsWith('video/') || t.startsWith('audio/')) return t.split('/')[1] || '';
  return '';
}
function isBrowserMediaRequest(url, resourceType) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  if (isSniffNoiseUrl(url)) return false;
  if (BROWSER_MEDIA_EXT_RE.test(url)) return true;
  if (BROWSER_MEDIA_TS_RE.test(url)) return resourceType === 'media' || resourceType === 'xhr' || resourceType === 'xmlhttprequest';
  return false;
}
function isSniffLiveImageDoc(contentType, size) {
  if (!SNIFF_IMAGE_DOC_CT_RE.test(String(contentType || ''))) return false;
  if (size > 0 && size < SNIFF_LIVE_IMAGE_MIN_BYTES) return false;
  return true;
}
/* 统一嗅探的开关标志（set-config 时同步，不用每次读磁盘）。
 * 监听只在开关开着时挂；开关关了就摘，见 refreshSniffHooks。 */
let sniffEnabledFlag = false;
function refreshSniffEnabledFlag() { try { sniffEnabledFlag = !!getConfig().sniffEnabled; } catch (e) { sniffEnabledFlag = false; } }
refreshSniffEnabledFlag();
function hostOf(url) { try { return new URL(String(url || '')).hostname || ''; } catch (e) { return ''; } }
function sameSiteHost(a, b) {
  const x = String(a || '').toLowerCase(), y = String(b || '').toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.endsWith(`.${y}`) || y.endsWith(`.${x}`)) return true;
  const px = x.split('.').slice(-2).join('.'), py = y.split('.').slice(-2).join('.');
  return px === py && px.includes('.') && !/^\d+\.\d+$/.test(px);
}
const AUTH_URL_RE = /(login|signin|sign-in|sign_in|sso|oauth|token|refresh|auth|session|passport|verify|2fa)/i;
function isAuthSniffUrl(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  try { const p = new URL(u); return AUTH_URL_RE.test(p.pathname) || AUTH_URL_RE.test(p.hostname) || AUTH_URL_RE.test(p.search); } catch (e) { return AUTH_URL_RE.test(u); }
}
function parseSetCookie(str) {
  const parts = String(str || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const eq = parts[0].indexOf('=');
  if (eq <= 0) return null;
  const out = { name: parts[0].slice(0, eq).trim(), value: parts[0].slice(eq + 1).trim(), domain: '', path: '', expires: 0 };
  for (const p of parts.slice(1)) {
    const [k, ...rest] = p.split('=');
    const key = String(k || '').trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'domain') out.domain = val.replace(/^\./, '');
    else if (key === 'path') out.path = val;
    else if (key === 'expires') { const t = Date.parse(val); if (!Number.isNaN(t)) out.expires = Math.floor(t / 1000); }
    else if (key === 'max-age') { const n = Number(val); if (Number.isFinite(n)) out.expires = Math.floor(Date.now() / 1000) + n; }
  }
  if (!out.name) return null;
  return out;
}
const browserMediaSeen = new Set(); // 去重：同一 URL 一个页面内只发一次（换页清空）
const browserMediaSniffedPartitions = new Set(); // 已挂监听的分区
const sniffKnownPartitions = new Set(); // 见过的所有分区（开关重开时重新挂）
const browserMediaPageUrlBySession = new Map(); // session 对象 -> 当前页地址（web-contents-created 跟踪）
const browserMediaStats = { emitted: 0, lastUrl: '', lastType: '', lastPageUrl: '' };
/* 请求日志（2026-11-27-11）：HAR 式，按请求 id 记方法/地址/开始时间，
 * 完成时补状态码/大小/耗时/类型；完整请求头响应头只放本机内存
 * （sniffReqDetails，上限 500 条），点一条时才取。 */
const sniffReqStart = new Map(); // requestId -> {method, url, startedAt, reqHeaders, resHeaders, status, reqBody, headersAt}
const sniffReqDetails = new Map(); // logId -> {reqHeaders, resHeaders, reqBody, timings}
/* 2026-11-28-9，第 3 项：POST 等请求的请求体（uploadData）只记前 8KB 文本，
 * 二进制/文件上传只记类型与大小，不存内容；响应体 webRequest 接口不提供，
 * 不伪造（详情里明说，响应体里的令牌由页面钩子从 fetch/XHR 摘要提取）。 */
function sniffReqBodyText(uploadData) {
  try {
    const list = Array.isArray(uploadData) ? uploadData : [];
    const parts = [];
    for (const u of list) {
      if (u && u.file) { parts.push(`[文件上传：${String(u.file).split(/[\\/]/).pop() || ''}]`); continue; }
      if (u && u.bytes) {
        const buf = Buffer.from(u.bytes);
        if (buf.length > 8192) { parts.push(buf.subarray(0, 8192).toString('utf8')); parts.push('…（已截断，只保留前 8KB）'); }
        else parts.push(buf.toString('utf8'));
      }
    }
    const s = parts.join('');
    return s.length > 8192 ? `${s.slice(0, 8192)}…（已截断，只保留前 8KB）` : s;
  } catch (e) { return ''; }
}
function sniffReqLogType(resourceType, contentType) {
  const rt = String(resourceType || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (ct.startsWith('application/json') || ct.includes('json')) return '接口';
  if (ct.startsWith('text/event-stream')) return '流式';
  if (rt === 'xhr' || rt === 'fetch' || rt === 'xmlhttprequest') return '接口';
  if (rt === 'script') return '脚本';
  if (rt === 'image') return '图片';
  if (rt === 'media') return '媒体';
  if (rt === 'stylesheet') return '样式';
  if (rt === 'font') return '字体';
  // Electron 的 resourceType 是驼峰 mainFrame/subFrame（不是
  // 下划线 main_frame），小写后是 mainframe/subframe。
  if (rt === 'main_frame' || rt === 'mainframe' || rt === 'sub_frame' || rt === 'subframe') return '页面';
  return '其他';
}
function sniffReqLogId(rid) { return `${Date.now().toString(36)}-${String(rid ?? Math.random().toString(36).slice(2, 8))}`; }
function emitSniffMedia(url, type, pageUrl, extra) {
  const key = String(url || '').split('#')[0];
  if (!key || browserMediaSeen.has(key)) return false;
  browserMediaSeen.add(key);
  if (browserMediaSeen.size > 500) { const first = browserMediaSeen.values().next().value; browserMediaSeen.delete(first); }
  browserMediaStats.emitted += 1;
  browserMediaStats.lastUrl = String(url); browserMediaStats.lastType = type; browserMediaStats.lastPageUrl = String(pageUrl || '');
  sendToRenderer('browser-media-found', { url: String(url), type, pageUrl: String(pageUrl || ''), ...(extra || {}) });
  return true;
}
function installSniffHooks(partition) {
  const part = String(partition || '');
  if (!part || browserMediaSniffedPartitions.has(part)) return false;
  let ses;
  try { ses = session.fromPartition(part); } catch (e) { return false; }
  try {
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      try {
        const rid = details.id;
        if (typeof rid === 'number') {
          sniffReqStart.set(rid, { method: String(details.method || 'GET'), url: String(details.url || ''), startedAt: Date.now(), reqHeaders: null, resHeaders: null, status: 0, reqBody: sniffReqBodyText(details.uploadData), headersAt: 0 });
          if (sniffReqStart.size > 1000) { const first = sniffReqStart.keys().next().value; sniffReqStart.delete(first); }
        }
        const url = String((details && details.url) || '');
        if (url && isBrowserMediaRequest(url, details.resourceType)) {
          const pageUrl = String((details && details.referrer) || browserMediaPageUrlBySession.get(ses) || '');
          emitSniffMedia(url, browserMediaTypeOf(url), pageUrl);
        }
      } catch (e) { /* 嗅探绝不能拦住页面请求 */ }
      callback({});
    });
    ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      try {
        const rid = details.id;
        if (typeof rid === 'number' && sniffReqStart.has(rid)) sniffReqStart.get(rid).reqHeaders = details.requestHeaders || {};
        if (isAuthSniffUrl(details.url)) {
          const headers = details.requestHeaders || {};
          const auth = headers.Authorization || headers.authorization || '';
          const cookie = headers.Cookie || headers.cookie || '';
          const pageUrl = String(browserMediaPageUrlBySession.get(ses) || '');
          const host = hostOf(details.url);
          if ((!pageUrl || sameSiteHost(host, hostOf(pageUrl)))) {
            if (auth) sendToRenderer('browser-auth-found', { category: 'req-header', name: 'Authorization', value: String(auth), sourceUrl: String(details.url || ''), host });
            if (cookie) sendToRenderer('browser-auth-found', { category: 'req-header', name: 'Cookie', value: String(cookie), sourceUrl: String(details.url || ''), host });
          }
        }
      } catch (e) { /* 嗅探绝不能拦住页面请求 */ }
      callback({ requestHeaders: details.requestHeaders });
    });
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      try {
        const rid = details.id;
        if (typeof rid === 'number' && sniffReqStart.has(rid)) {
          const e0 = sniffReqStart.get(rid);
          e0.resHeaders = details.responseHeaders || {};
          e0.status = details.statusCode || 0;
          e0.headersAt = Date.now(); // 时间线：首字节到达
        }
        const headers = details.responseHeaders || {};
        const url = String(details.url || '');
        const first = (v) => (Array.isArray(v) ? v[0] : v);
        const lenRaw = first(headers['content-length'] || headers['Content-Length']);
        const size = lenRaw ? Number(lenRaw) || 0 : 0;
        const ctype = String(first(headers['content-type'] || headers['Content-Type']) || '');
        if (url && isBrowserMediaRequest(url, details.resourceType)) {
          if (size > 0 || ctype) sendToRenderer('browser-media-meta', { url, size, contentType: ctype });
        } else if (url && isSniffLiveImageDoc(ctype, size)) {
          const pageUrl = String(browserMediaPageUrlBySession.get(ses) || '');
          emitSniffMedia(url, sniffContentTypeOf(ctype) || 'image', pageUrl, { size: size || 0, contentType: ctype });
        }
        const setCookie = headers['set-cookie'] || headers['Set-Cookie'] || [];
        const list = Array.isArray(setCookie) ? setCookie : [setCookie];
        const pageUrl = String(browserMediaPageUrlBySession.get(ses) || '');
        const pageHost = hostOf(pageUrl);
        for (const sc of list) {
          const parsed = parseSetCookie(String(sc));
          if (!parsed) continue;
          const cookieHost = (parsed.domain || hostOf(url)).replace(/^\./, '');
          if (pageHost && !sameSiteHost(cookieHost, pageHost)) continue;
          sendToRenderer('browser-auth-found', { category: 'cookie', name: parsed.name, value: parsed.value, sourceUrl: url, host: cookieHost, expires: parsed.expires || 0, via: 'Set-Cookie' });
        }
      } catch (e) { /* 嗅探绝不能拦住页面请求 */ }
      callback({ responseHeaders: details.responseHeaders });
    });
    ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      try {
        const rid = details.id;
        const start = (typeof rid === 'number') ? sniffReqStart.get(rid) : null;
        if (start) sniffReqStart.delete(rid);
        const url = String(details.url || '');
        const headers = details.responseHeaders || (start && start.resHeaders) || {};
        const first = (v) => (Array.isArray(v) ? v[0] : v);
        const lenRaw = first(headers['content-length'] || headers['Content-Length']);
        const size = lenRaw ? Number(lenRaw) || 0 : 0;
        const ctype = String(first(headers['content-type'] || headers['Content-Type']) || '');
        const logId = sniffReqLogId(rid);
        // 时间线：wait=发出到首字节，receive=首字节到完成（ms）。
        const now = Date.now();
        const timings = start ? { wait: Math.max(0, (start.headersAt || now) - start.startedAt), receive: Math.max(0, now - (start.headersAt || start.startedAt)), total: Math.max(0, now - start.startedAt) } : { wait: 0, receive: 0, total: 0 };
        sniffReqDetails.set(logId, { reqHeaders: (start && start.reqHeaders) || {}, resHeaders: headers, reqBody: (start && start.reqBody) || '', timings });
        if (sniffReqDetails.size > 500) { const firstKey = sniffReqDetails.keys().next().value; sniffReqDetails.delete(firstKey); }
        sendToRenderer('browser-req-log', {
          id: logId, method: (start && start.method) || 'GET', url, host: hostOf(url),
          status: details.statusCode || (start && start.status) || 0, size,
          durationMs: start ? Date.now() - start.startedAt : 0,
          type: sniffReqLogType(details.resourceType, ctype),
          source: 'browser', timings,
        });
      } catch (e) { /* 记不上不影响浏览 */ }
    });
    ses.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
      try {
        const rid = details.id;
        const start = (typeof rid === 'number') ? sniffReqStart.get(rid) : null;
        if (start) sniffReqStart.delete(rid);
        const logId = sniffReqLogId(rid);
        const now = Date.now();
        const timings = start ? { wait: Math.max(0, (start.headersAt || now) - start.startedAt), receive: 0, total: Math.max(0, now - start.startedAt) } : { wait: 0, receive: 0, total: 0 };
        sniffReqDetails.set(logId, { reqHeaders: (start && start.reqHeaders) || {}, resHeaders: {}, reqBody: (start && start.reqBody) || '', timings });
        if (sniffReqDetails.size > 500) { const firstKey = sniffReqDetails.keys().next().value; sniffReqDetails.delete(firstKey); }
        sendToRenderer('browser-req-log', {
          id: logId, method: (start && start.method) || 'GET', url: String(details.url || ''), host: hostOf(details.url),
          status: 0, size: 0, durationMs: start ? Date.now() - start.startedAt : 0,
          type: sniffReqLogType(details.resourceType, ''),
          source: 'browser', timings,
        });
      } catch (e) { /* 记不上不影响浏览 */ }
    });
  } catch (e) { browserMediaSniffedPartitions.delete(part); return false; }
  browserMediaSniffedPartitions.add(part);
  return true;
}
function removeSniffHooks(partition) {
  const part = String(partition || '');
  if (!part || !browserMediaSniffedPartitions.has(part)) return false;
  let ses;
  try { ses = session.fromPartition(part); } catch (e) { browserMediaSniffedPartitions.delete(part); return false; }
  try { ses.webRequest.onBeforeRequest(null); } catch (e) { /* 摘不掉不影响 */ }
  try { ses.webRequest.onBeforeSendHeaders(null); } catch (e) { /* 摘不掉不影响 */ }
  try { ses.webRequest.onHeadersReceived(null); } catch (e) { /* 摘不掉不影响 */ }
  try { ses.webRequest.onCompleted(null); } catch (e) { /* 摘不掉不影响 */ }
  try { ses.webRequest.onErrorOccurred(null); } catch (e) { /* 摘不掉不影响 */ }
  browserMediaSniffedPartitions.delete(part);
  return true;
}
/* 2026-11-28-12：内嵌浏览器按浏览器种类分区分——Chromium 用默认分区，
 * Chrome / Edge 各用自己的分区。同一浏览器在工具箱内外的 Cookie、
 * 存储、登录态互不相通；嗅探监听与 Pioneer 代理接管都要覆盖这三处。 */
const EMBEDDED_BROWSER_PARTITIONS = ['persist:toolbox-browser', 'persist:toolbox-chrome', 'persist:toolbox-edge'];
function ensureBrowserMediaSniff(partition) {
  const part = String(partition || '');
  if (!part) return false;
  sniffKnownPartitions.add(part);
  if (!sniffEnabledFlag) return false;
  if (browserMediaSniffedPartitions.has(part)) return false;
  return installSniffHooks(part);
}
/* 总开关变化时调：开着把见过的分区都挂上，关了把已挂的都摘掉。 */
function refreshSniffHooks() {
  refreshSniffEnabledFlag();
  let attached = 0, detached = 0;
  if (sniffEnabledFlag) {
    for (const p of [...sniffKnownPartitions]) { if (!browserMediaSniffedPartitions.has(p) && installSniffHooks(p)) attached += 1; }
  } else {
    for (const p of [...browserMediaSniffedPartitions]) { if (removeSniffHooks(p)) detached += 1; }
  }
  return { enabled: sniffEnabledFlag, attached, detached, hooked: [...browserMediaSniffedPartitions] };
}
function ensureBrowserMediaSniffForAccounts() {
  try { for (const a of getAccounts()) ensureBrowserMediaSniff(accountPartition(a.id)); } catch (e) { /* 账号读不到不拦嗅探 */ }
}
/* ---- 2026-11-28-9，第 3 项：嗅探工具箱内安装的其他软件 ----
 * 现实路线（不装驱动、不碰系统证书、不做全流量抓包）：
 * ① 本地代理服务器（只听 127.0.0.1，随机高位端口）：明文 HTTP 请求
 *    转发并记方法/地址/状态/大小/耗时；HTTPS 走 CONNECT 建隧道，只记
 *    目标主机:端口与耗时，隧道里的内容看不到也不解密——这是代理方式的
 *    能力边界，界面上明说。
 * ② 启动注入：工具箱拉起已装软件时给子进程注入 HTTP_PROXY /
 *    HTTPS_PROXY（只走代理的软件才会被抓到）；③ 系统代理模式：把
 *    Windows 系统代理指到本地代理（Pioneer 已连接时拒绝，两套系统
 *    代理会打架），域名过滤只抓名单里的域（名单空 = 全抓）。
 * 域名过滤只决定“记不记”，不过滤的请求照常转发，不拦网。代理日志
 * 只发渲染层内存展示，令牌值不写日志不上报（与浏览器嗅探同一规矩）。
 * 退出时复位系统代理（sniffProxyResetSystemSync，接在 before-quit）。 */
const SNIFF_PROXY_PREV_FILE = 'sniff-prev-proxy.json';
const sniffProxyState = { server: null, port: 0, enabled: false, systemMode: false, domains: [] };
function sniffProxyDomainMatch(host) {
  const list = sniffProxyState.domains || [];
  if (!list.length) return true;
  const h = String(host || '').toLowerCase();
  return list.some((d) => { const s = String(d || '').toLowerCase().replace(/^\*\./, ''); return h === s || h.endsWith(`.${s}`); });
}
function sniffProxyLog(entry) {
  const id = sniffReqLogId('proxy');
  sniffReqDetails.set(id, { reqHeaders: entry.reqHeaders || {}, resHeaders: entry.resHeaders || {}, reqBody: entry.reqBody || '', timings: entry.timings || { wait: 0, receive: 0, total: entry.durationMs || 0 } });
  if (sniffReqDetails.size > 500) { const firstKey = sniffReqDetails.keys().next().value; sniffReqDetails.delete(firstKey); }
  sendToRenderer('browser-req-log', { id, method: entry.method || 'GET', url: entry.url || '', host: entry.host || '', status: entry.status || 0, size: entry.size || 0, durationMs: entry.durationMs || 0, type: entry.type || '代理', source: 'proxy', timings: entry.timings || { wait: 0, receive: 0, total: entry.durationMs || 0 } });
}
function sniffProxyForward(req, res) {
  const startedAt = Date.now();
  let target;
  try { target = new URL(String(req.url || '')); } catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('只接受代理形式的绝对地址请求'); return; }
  if (target.protocol !== 'http:') { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('本地代理只转发明文 HTTP；HTTPS 请走 CONNECT 隧道'); return; }
  const host = target.hostname || '';
  const capture = sniffProxyDomainMatch(host);
  const headers = { ...req.headers };
  delete headers['proxy-connection'];
  delete headers.connection;
  const fwd = http.request({ method: req.method, hostname: target.hostname, port: Number(target.port || 80), path: `${target.pathname || '/'}${target.search || ''}`, headers, timeout: 30000 }, (up) => {
    let size = 0;
    up.on('data', (c) => { size += c.length; });
    up.on('end', () => {
      if (capture) sniffProxyLog({ method: req.method, url: String(req.url || ''), host, status: up.statusCode || 0, size, durationMs: Date.now() - startedAt, type: '代理', reqHeaders: headers, resHeaders: up.headers || {}, timings: { wait: 0, receive: Date.now() - startedAt, total: Date.now() - startedAt } });
    });
    res.writeHead(up.statusCode || 502, up.headers || {});
    up.pipe(res);
  });
  fwd.on('timeout', () => { try { fwd.destroy(new Error('上游超时')); } catch (e) { /* 忽略 */ } });
  fwd.on('error', (e) => {
    if (capture) sniffProxyLog({ method: req.method, url: String(req.url || ''), host, status: 0, size: 0, durationMs: Date.now() - startedAt, type: '代理', reqHeaders: headers, resHeaders: {}, timings: { wait: 0, receive: 0, total: Date.now() - startedAt } });
    try { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`上游失败：${e.message || String(e)}`); } catch (err) { /* 客户端已断开 */ }
  });
  req.pipe(fwd);
}
function sniffProxyHandleConnect(req, socket, head) {
  const startedAt = Date.now();
  const target = String(req.url || '');
  const [host, portRaw] = target.split(':');
  const port = Number(portRaw || 443);
  const capture = sniffProxyDomainMatch(host || '');
  const up = net.connect(port, host || '', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const done = (ok) => {
    if (capture) sniffProxyLog({ method: 'CONNECT', url: target, host: host || '', status: ok ? 0 : 0, size: 0, durationMs: Date.now() - startedAt, type: '隧道', reqHeaders: {}, resHeaders: {}, timings: { wait: 0, receive: 0, total: Date.now() - startedAt } });
  };
  let logged = false;
  up.on('error', () => { if (!logged) { logged = true; done(false); } try { socket.end(); } catch (e) { /* 忽略 */ } });
  socket.on('close', () => { if (!logged) { logged = true; done(true); } try { up.destroy(); } catch (e) { /* 忽略 */ } });
  socket.on('error', () => { try { up.destroy(); } catch (e) { /* 忽略 */ } });
}
async function startSniffProxy() {
  if (sniffProxyState.server) return { ok: true, port: sniffProxyState.port };
  const srv = http.createServer((req, res) => {
    try { sniffProxyForward(req, res); } catch (e) { try { res.writeHead(500); res.end(); } catch (err) { /* 忽略 */ } }
  });
  srv.on('connect', (req, socket, head) => { try { sniffProxyHandleConnect(req, socket, head); } catch (e) { try { socket.end(); } catch (err) { /* 忽略 */ } } });
  srv.on('clientError', (_err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* 忽略 */ } });
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve());
  });
  sniffProxyState.server = srv;
  sniffProxyState.port = srv.address().port;
  sniffProxyState.enabled = true;
  return { ok: true, port: sniffProxyState.port };
}
async function stopSniffProxy() {
  if (sniffProxyState.systemMode) await setSniffProxySystem(false);
  if (sniffProxyState.server) {
    const srv = sniffProxyState.server;
    sniffProxyState.server = null;
    sniffProxyState.port = 0;
    await new Promise((resolve) => { try { srv.close(() => resolve()); } catch (e) { resolve(); } });
  }
  sniffProxyState.enabled = false;
  return { ok: true };
}
function sniffProxyStatus() {
  return { ok: true, running: !!sniffProxyState.server, port: sniffProxyState.port || 0, enabled: sniffProxyState.enabled, systemMode: sniffProxyState.systemMode, domains: [...(sniffProxyState.domains || [])], proxyUrl: sniffProxyState.server ? `http://127.0.0.1:${sniffProxyState.port}` : '' };
}
/* 系统代理模式：注册表命令由纯函数生成（不执行），自测逐条核对；
 * 接管前旧值存 sniff-prev-proxy.json（与 Pioneer 的分开文件，
 * 两套系统代理不能互相覆盖对方的恢复点）。 */
function sniffProxySystemCommands(enable, port, prev) {
  const K = PIONEER_SYS_PROXY_KEY;
  const add = (name, type, data) => ['reg', ['add', K, '/v', name, '/t', type, '/d', String(data), '/f']];
  const del = (name) => ['reg', ['delete', K, '/v', name, '/f']];
  if (!enable) {
    if (prev) {
      const cmds = [];
      for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL']) {
        const v = prev[name];
        if (v && v.data !== undefined && v.data !== null && v.data !== '') cmds.push(add(name, v.type || 'REG_SZ', v.data));
        else cmds.push(del(name));
      }
      return cmds;
    }
    return [add('ProxyEnable', 'REG_DWORD', '0'), del('AutoConfigURL')];
  }
  // 固定代理指本地嗅探代理；localhost/127.* 直连，不走代理。
  return [del('AutoConfigURL'), add('ProxyServer', 'REG_SZ', `127.0.0.1:${port}`), add('ProxyOverride', 'REG_SZ', 'localhost;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2*;172.30.*;172.31.*'), add('ProxyEnable', 'REG_DWORD', '1')];
}
async function sniffProxySavePrevSystemProxy() {
  if (process.platform !== 'win32') return;
  const file = path.join(userDataDir(), SNIFF_PROXY_PREV_FILE);
  try { if (fs.existsSync(file)) return; } catch (e) { /* 继续 */ }
  const prev = {};
  for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL']) {
    const r = await runCmd('reg', ['query', PIONEER_SYS_PROXY_KEY, '/v', name], 10000);
    const m = (r.out || '').match(new RegExp(name + '\\s+(REG_\\w+)\\s+(.+)'));
    prev[name] = (r.code === 0 && m) ? { type: m[1], data: m[2].trim() } : null;
  }
  try { atomicWriteJsonFile(file, prev); } catch (e) { /* 存不下也继续 */ }
}
function sniffProxyLoadPrevSystemProxy() {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir(), SNIFF_PROXY_PREV_FILE), 'utf8')); } catch (e) { return null; }
}
async function setSniffProxySystem(enable) {
  if (process.platform !== 'win32') return { ok: false, error: '系统代理模式只能在 Windows 上用' };
  if (enable) {
    if (!sniffProxyState.server) return { ok: false, error: '本地代理还没启动，先开嗅探代理' };
    if (pioneerTunnelRunning()) return { ok: false, error: 'Pioneer 已连接时不能同时开嗅探系统代理：两套系统代理会互相覆盖，先断开 Pioneer 再开' };
    await sniffProxySavePrevSystemProxy();
    for (const [cmd, args] of sniffProxySystemCommands(true, sniffProxyState.port, null)) {
      try { await runCmd(cmd, args, 10000); } catch (e) { /* 逐条尽力 */ }
    }
    sniffProxyState.systemMode = true;
    return { ok: true };
  }
  const prev = sniffProxyLoadPrevSystemProxy();
  for (const [cmd, args] of sniffProxySystemCommands(false, 0, prev)) {
    try { await runCmd(cmd, args, 10000); } catch (e) { /* 逐条尽力 */ }
  }
  try { fs.unlinkSync(path.join(userDataDir(), SNIFF_PROXY_PREV_FILE)); } catch (e) { /* 已删或无文件 */ }
  sniffProxyState.systemMode = false;
  return { ok: true };
}
function sniffProxyResetSystemSync() {
  if (process.platform !== 'win32') return;
  try {
    const prev = sniffProxyLoadPrevSystemProxy();
    // 只复位“我们接管过的”那一种：当前 ProxyServer 不是本地嗅探
    // 代理就不动（用户自己改了代理，或 Pioneer 接管了）。
    const cur = pioneerReadSysProxyValueSync('ProxyServer');
    const ours = sniffProxyState.port ? cur === `127.0.0.1:${sniffProxyState.port}` : /^127\.0\.0\.1:\d+$/.test(cur || '');
    if (!ours && cur) return;
    for (const [cmd, args] of sniffProxySystemCommands(false, 0, prev)) {
      try { execFileSync(cmd, args, { windowsHide: true, timeout: 10000, stdio: 'ignore' }); } catch (e) { /* 逐条尽力 */ }
    }
    try { fs.unlinkSync(path.join(userDataDir(), SNIFF_PROXY_PREV_FILE)); } catch (e) { /* 已删或无文件 */ }
  } catch (e) { /* 复位失败不拦退出 */ }
  sniffProxyState.systemMode = false;
}
/* 嗅探启动：本地代理先跑起来，再按工具箱拉起软件的同一套 exe 解析，
 * 给子进程注入 HTTP_PROXY/HTTPS_PROXY（NO_PROXY 放过本机地址）。
 * 浏览器与播放器不走这里（它们有自己的打开口子）。 */
async function sniffProxyLaunchApp(key) {
  const k = String(key || '');
  if (k === 'chromium' || k === 'chrome' || k === 'edge' || k === 'vlc' || k === 'potplayer' || k === 'mpv') return { ok: false, error: '浏览器与播放器不走嗅探启动：浏览器流量直接走内嵌嗅探，播放器一般不走 HTTP 代理' };
  const r = await startSniffProxy();
  if (!r.ok) return { ok: false, error: '本地代理启动失败' };
  const exe = toolboxAppExe(k) || (() => {
    const e = loadToolboxApps().find((x) => String(x.key) === k || String(x.wingetId || '') === k);
    const loc = e ? String(e.installLocation || '') : '';
    return loc ? findAppExeInDir(loc, k, e.name || '') : '';
  })();
  if (!exe) return { ok: false, error: '台账里找不到这个软件的可执行文件，先在推荐软件里安装' };
  const proxyUrl = `http://127.0.0.1:${sniffProxyState.port}`;
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', env: { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1' } });
    child.unref();
    return { ok: true, proxyUrl };
  } catch (e2) { return { ok: false, error: `打开失败：${e2.message || String(e2)}` }; }
}
/* ---------- 2026-11-28-9，补充 1：内嵌浏览器快捷键 ---------- */
const browserGuestAttached = new Set();
function attachBrowserGuestShortcuts(guestId) {
  const id = Number(guestId);
  if (!Number.isFinite(id) || id <= 0 || browserGuestAttached.has(id)) return { ok: false, error: '无效或已接管' };
  let guest;
  try { guest = webContents.fromId(id); } catch (e) { return { ok: false, error: '找不到该 webview' }; }
  if (!guest || guest.isDestroyed()) return { ok: false, error: '找不到该 webview' };
  browserGuestAttached.add(id);
  const send = (action) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('browser-shortcut', { action }); } catch (e) { /* 发不出去不影响 */ } };
  guest.on('before-input-event', (event, input) => {
    try {
      if (!input || input.type !== 'keyDown') return;
      const ctrl = !!input.control, shift = !!input.shift, alt = !!input.alt;
      const key = String(input.key || '');
      if (ctrl && !alt && !shift && (key === 'r' || key === 'R')) { event.preventDefault(); guest.reload(); return; }
      if (!ctrl && !alt && !shift && key === 'F5') { event.preventDefault(); guest.reload(); return; }
      if (ctrl && !alt && !shift && (key === 'l' || key === 'L')) { event.preventDefault(); send('focus-url'); return; }
      if (ctrl && !alt && !shift && (key === 'f' || key === 'F')) { event.preventDefault(); send('find-open'); return; }
      if (ctrl && !alt && !shift && (key === 't' || key === 'T')) { event.preventDefault(); send('new-tab'); return; }
      if (ctrl && !alt && !shift && (key === 'w' || key === 'W')) { event.preventDefault(); send('close-tab'); return; }
      if (ctrl && !alt && key === 'Tab' && !shift) { event.preventDefault(); send('next-tab'); return; }
      if (ctrl && !alt && key === 'Tab' && shift) { event.preventDefault(); send('prev-tab'); return; }
      if (!ctrl && alt && !shift && key === 'ArrowLeft') { event.preventDefault(); if (guest.canGoBack()) guest.goBack(); return; }
      if (!ctrl && alt && !shift && key === 'ArrowRight') { event.preventDefault(); if (guest.canGoForward()) guest.goForward(); return; }
      if (!ctrl && !alt && !shift && key === 'F12') { event.preventDefault(); if (guest.isDevToolsOpened()) guest.closeDevTools(); else guest.openDevTools(); return; }
      if (ctrl && shift && !alt && (key === 'i' || key === 'I')) { event.preventDefault(); if (guest.isDevToolsOpened()) guest.closeDevTools(); else guest.openDevTools(); return; }
      // Esc 不 preventDefault：页面自己的 Esc 也要能用；渲染层只在查找条开着时关它。
      if (!ctrl && !alt && !shift && key === 'Escape') { send('find-close'); return; }
    } catch (e) { /* 快捷键失败不影响浏览 */ }
  });
  guest.once('destroyed', () => { browserGuestAttached.delete(id); });
  return { ok: true };
}
/* 统一嗅探：读当前站点的 cookie（登录跳转后复核、嗅探框“重新扫描”都走
 * 这里）。只回给渲染层内存展示，不落盘、不写日志；值由渲染层打码显示。 */
async function sniffAuthCookies(url, partition) {
  const host = hostOf(url);
  if (!host) return { ok: false, error: '当前没有打开的页面' };
  let ses;
  try { ses = session.fromPartition(String(partition || 'persist:toolbox-browser')); } catch (e) { return { ok: false, error: '浏览器会话读不到' }; }
  let list = [];
  try { list = await ses.cookies.get({}); } catch (e) { return { ok: false, error: 'Cookie 读不到' }; }
  const cookies = (Array.isArray(list) ? list : [])
    .filter((c) => sameSiteHost(String((c && c.domain) || '').replace(/^\./, ''), host))
    .map((c) => ({ name: String(c.name || ''), value: String(c.value || ''), domain: String(c.domain || ''), path: String(c.path || '/'), expirationDate: Number(c.expirationDate || 0), secure: !!c.secure, httpOnly: !!c.httpOnly, session: !!c.session }));
  return { ok: true, host, cookies };
}
/* 嗅探历史（2026-11-27-11）：结果落盘本机 JSON（userDataDir 下的
 * sniff-history.json，不进仓库），按站点/时间查、能删；上限 30 条。
 * 令牌类值由渲染层打码后再传进来，这里只存、不解析。 */
function sniffHistoryFile() { return path.join(userDataDir(), 'sniff-history.json'); }
function sniffHistoryLoad() { try { const v = JSON.parse(fs.readFileSync(sniffHistoryFile(), 'utf8')); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function sniffHistorySaveFile(list) { try { fs.mkdirSync(userDataDir(), { recursive: true }); fs.writeFileSync(sniffHistoryFile(), JSON.stringify(list, null, 2), 'utf8'); return true; } catch (e) { return false; } }
function sniffHistorySaveEntry(entry) {
  const list = sniffHistoryLoad();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const item = { id, host: String(entry.host || ''), at: Number(entry.at || Date.now()), count: Array.isArray(entry.items) ? entry.items.length : 0, items: Array.isArray(entry.items) ? entry.items.slice(0, 200) : [] };
  list.unshift(item);
  while (list.length > 30) list.pop();
  if (!sniffHistorySaveFile(list)) return { ok: false, error: '历史存不下' };
  return { ok: true, id };
}
function sniffHistoryListEntries() {
  return { ok: true, entries: sniffHistoryLoad().map((e) => ({ id: e.id, host: e.host, at: e.at, count: e.count || (Array.isArray(e.items) ? e.items.length : 0) })) };
}
function sniffHistoryGetEntry(id) {
  const hit = sniffHistoryLoad().find((e) => e.id === String(id));
  if (!hit) return { ok: false, error: '找不到这条历史' };
  return { ok: true, id: hit.id, host: hit.host, at: hit.at, items: hit.items || [] };
}
function sniffHistoryDeleteEntry(id) {
  const list = sniffHistoryLoad().filter((e) => e.id !== String(id));
  if (!sniffHistorySaveFile(list)) return { ok: false, error: '删除失败' };
  return { ok: true };
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
function getVideoDownloads() { const v = readJsonFile('video-downloads.json', []); return Array.isArray(v) ? v : []; }
function saveVideoDownloads(list) { writeJsonFile('video-downloads.json', list); }
function videoDownloadStart({ url, engine, formatId, title }) {
  const u = String(url || '');
  const eng = resolveVideoEngine(u, engine);
  const exe = videoEnginePath(eng);
  if (!fs.existsSync(exe)) return { ok: false, error: `视频引擎未安装：点下载时会问你要不要一键安装 ${eng === 'ytdlp' ? 'yt-dlp' : eng === 'lux' ? 'Lux' : 'N_m3u8DL-RE'}` };
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
    proxyMode: pioneerProxyMode(),
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
/* ---- 内置 Trojan 隧道（主进程内直接起服务） ---- */
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
  // 2026-11-27-8：隧道停了，内嵌浏览器与账号分区代理复位回直连，
  // 系统代理也按接管前保存的旧值恢复。
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
/* ---------- 2026-11-27-10，第 11 项：Pioneer 代理模式用全局值 ----------
 * Pioneer 页签不再有自己的模式下拉：连接时内嵌浏览器与系统代理按
 * 全局代理模式接管。全局直连 / 手动时 Pioneer 没有对应的分流方式，
 * 按默认智能（PAC 分流）走隧道，否则隧道连上却不走流量。 */
function pioneerProxyMode() {
  const m = getConfig().proxyMode || 'direct';
  return ['smart', 'global', 'tun'].includes(m) ? m : 'smart';
}
/* ---------- 2026-11-27-10，第 11 项：已连接状态只信实测 ----------
 * 根因：pioneer-status 只读 pioneer-state.json 的保存标志，隧道进程
 * 退出、端口不监听、出口检测失败后标志还留在 true，界面就一直显示
 * 已连接。现每次读状态都实测：隧道进程不在、或 127.0.0.1:19352
 * 不监听，就把保存的已连接标志清掉、写日志，界面回到未连接。 */
async function pioneerVerifyLive() {
  const s = pioneerLoad();
  const claimed = !!(s.connected || s.tunnelRunning);
  if (!claimed && !pioneerServer) return { connected: false, checked: true };
  const port = await pioneerCheckLocalPort();
  const tunnelUp = pioneerTunnelRunning();
  if (!port.ok || !tunnelUp) {
    const reason = [!tunnelUp ? '隧道进程已退出' : '', !port.ok ? '本地代理端口 127.0.0.1:19352 未监听' : ''].filter(Boolean).join('，');
    if (s.connected || s.tunnelRunning) {
      pioneerLog(`Pioneer 隧道已断开（${reason}），状态已回到未连接`);
      const s2 = pioneerLoad();
      s2.connected = false; s2.tunnelRunning = false; s2.exitIp = '';
      pioneerSave(s2);
    }
    // 2026-11-28-7：隧道死了也要把内嵌浏览器与账号分区的代理复位
    // 回直连——以前只在隧道进程还在时才停隧道复位，进程已退出或
    // 崩溃后残留的 127.0.0.1:19352 代理配置会一直留在会话里。
    await pioneerResetBrowserProxy();
    if (tunnelUp) pioneerStopTunnel();
    return { connected: false, checked: true, reason };
  }
  return { connected: !!s.connected, checked: true };
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
/* ---------- 2026-11-27-8：Pioneer 系统代理接管 ----------
 * 之前只接管工具箱内嵌浏览器一个会话：账号分区没接管，电脑上的
 * 浏览器与其他程序更走不了 Pioneer，所以用户那边一直“连不上代理”。
 * 现按补丁方法改成：连接后同时写 Windows 系统代理（HKCU 的 Internet
 * Settings，当前用户级，不用管理员权限）——全局/Tun 走固定代理
 * 127.0.0.1:19352，智能走 PAC 文件；断开或退出时恢复接管前的旧值。
 * 注意：pioneerEgressProxy() 不要动——它是连 Trojan 节点用的上游出口
 * 代理（读环境变量 HTTP_PROXY），没有它在公司内网等环境下节点根本
 * 连不上；补丁脚本里把它改成 return null 是错的，这里不采纳。
 * 另外两处补强：① 接管前先把用户原来的代理设置存下来，复位时按原值
 * 恢复，而不是简单关掉；② 退出时用同步写注册表，保证进程退出前复位
 * 已落盘（异步版在 before-quit 里可能来不及跑完）；③ 启动时清理上次
 * 崩溃残留的接管（只清指向本地 19352 或我们 PAC 的那一种）。 */
const PIONEER_SYS_PROXY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const PIONEER_PREV_PROXY_FILE = 'pioneer-prev-proxy.json';
// 返回要依次执行的 reg 命令（每条 [程序, 参数数组]），本身不执行，
// 方便自测逐条核对；真正执行走 setWindowsSystemProxy / 复位函数。
function windowsSystemProxyCommands(enable, mode, pacUrl, prev) {
  const K = PIONEER_SYS_PROXY_KEY;
  const add = (name, type, data) => ['reg', ['add', K, '/v', name, '/t', type, '/d', String(data), '/f']];
  const del = (name) => ['reg', ['delete', K, '/v', name, '/f']];
  if (!enable) {
    // 按接管前保存的旧值恢复；没有保存过就关代理、删自动配置。
    if (prev) {
      const cmds = [];
      for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL']) {
        const v = prev[name];
        if (v && v.data !== undefined && v.data !== null && v.data !== '') cmds.push(add(name, v.type || 'REG_SZ', v.data));
        else cmds.push(del(name));
      }
      return cmds;
    }
    return [add('ProxyEnable', 'REG_DWORD', '0'), del('AutoConfigURL')];
  }
  if (mode === 'global' || mode === 'tun') {
    return [del('AutoConfigURL'), add('ProxyServer', 'REG_SZ', `${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port}`), add('ProxyEnable', 'REG_DWORD', '1')];
  }
  // 智能：PAC 文件接管，ProxyEnable 保持 0。
  return [add('ProxyEnable', 'REG_DWORD', '0'), add('AutoConfigURL', 'REG_SZ', pacUrl)];
}
async function pioneerSavePrevSystemProxy() {
  if (process.platform !== 'win32') return;
  const file = path.join(userDataDir(), PIONEER_PREV_PROXY_FILE);
  try { if (fs.existsSync(file)) return; } catch (e) { /* 继续 */ }
  const prev = {};
  for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL']) {
    const r = await runCmd('reg', ['query', PIONEER_SYS_PROXY_KEY, '/v', name], 10000);
    const m = (r.out || '').match(new RegExp(name + '\\s+(REG_\\w+)\\s+(.+)'));
    prev[name] = (r.code === 0 && m) ? { type: m[1], data: m[2].trim() } : null;
  }
  try { fs.writeFileSync(file, JSON.stringify(prev, null, 2), 'utf8'); } catch (e) { /* 存不下也继续 */ }
}
function pioneerLoadPrevSystemProxy() {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir(), PIONEER_PREV_PROXY_FILE), 'utf8')); } catch (e) { return null; }
}
async function setWindowsSystemProxy(enable, mode) {
  if (process.platform !== 'win32') return;
  if (!enable) { await pioneerRestorePrevSystemProxy(); return; }
  await pioneerSavePrevSystemProxy();
  let pacUrl = '';
  if (mode !== 'global' && mode !== 'tun') {
    const pacFile = path.join(userDataDir(), 'pioneer-smart.pac');
    fs.writeFileSync(pacFile, pioneerSmartPacScript(), 'utf8');
    pacUrl = pathToFileURL(pacFile).href;
  }
  for (const [cmd, args] of windowsSystemProxyCommands(true, mode, pacUrl, null)) {
    try { await runCmd(cmd, args, 10000); } catch (e) { /* runCmd 本身不抛；逐条尽力 */ }
  }
}
async function pioneerRestorePrevSystemProxy() {
  if (process.platform !== 'win32') return;
  const prev = pioneerLoadPrevSystemProxy();
  for (const [cmd, args] of windowsSystemProxyCommands(false, '', '', prev)) {
    try { await runCmd(cmd, args, 10000); } catch (e) { /* 逐条尽力 */ }
  }
  try { fs.unlinkSync(path.join(userDataDir(), PIONEER_PREV_PROXY_FILE)); } catch (e) { /* 已删或无文件 */ }
}
// 退出时用：同步写注册表，保证进程退出前复位已落盘。
function pioneerResetSystemProxySync() {
  if (process.platform !== 'win32') return;
  try {
    const prev = pioneerLoadPrevSystemProxy();
    for (const [cmd, args] of windowsSystemProxyCommands(false, '', '', prev)) {
      try { execFileSync(cmd, args, { windowsHide: true, timeout: 10000, stdio: 'ignore' }); } catch (e) { /* 逐条尽力 */ }
    }
    try { fs.unlinkSync(path.join(userDataDir(), PIONEER_PREV_PROXY_FILE)); } catch (e) { /* 已删或无文件 */ }
  } catch (e) { /* 复位失败不拦退出 */ }
}
// 启动时清理上次崩溃残留的接管：只清指向本地 19352 或我们 PAC 的那一种，
// 用户自己设的代理不动；本地端口还在听说明隧道还活着（另一实例），也不动。
async function pioneerCleanupStaleSystemProxy() {
  if (process.platform !== 'win32') return;
  try {
    const port = await pioneerCheckLocalPort(1500);
    if (port.ok) return;
    const server = pioneerReadSysProxyValueSync('ProxyServer');
    const auto = pioneerReadSysProxyValueSync('AutoConfigURL');
    let pacUrl = '';
    try { pacUrl = pathToFileURL(path.join(userDataDir(), 'pioneer-smart.pac')).href; } catch (e) { pacUrl = ''; }
    const ours = (server === `${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port}`) || (auto && pacUrl && auto === pacUrl);
    if (!ours) return;
    await pioneerRestorePrevSystemProxy();
    pioneerLog('已清理上次退出残留的系统代理接管');
  } catch (e) { /* 清理失败不拦启动 */ }
}
function pioneerReadSysProxyValueSync(name) {
  try {
    const out = execFileSync('reg', ['query', PIONEER_SYS_PROXY_KEY, '/v', name], { windowsHide: true, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = String(out || '').match(new RegExp(name + '\\s+(REG_\\w+)\\s+(.+)'));
    return m ? m[2].trim() : '';
  } catch (e) { return ''; }
}
async function pioneerApplyBrowserProxy(mode) {
  try {
    const partitions = [...EMBEDDED_BROWSER_PARTITIONS];
    for (const acc of getAccounts()) {
      if (!acc.proxy || !acc.proxy.host) {
        partitions.push(accountPartition(acc.id));
      }
    }
    const proxyCfg = (mode === 'global' || mode === 'tun')
      ? {
          mode: 'fixed_servers',
          proxyRules: `socks5=${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port};http=${PIONEER_LOCAL_PROXY.host}:${PIONEER_LOCAL_PROXY.port}`,
        }
      : mode === 'smart'
        ? { mode: 'pac_script', pacScript: pioneerSmartPacScript() }
        : { mode: 'direct' };

    for (const part of partitions) {
      const ses = session.fromPartition(part);
      if (ses) await ses.setProxy(proxyCfg);
    }
    await setWindowsSystemProxy(mode !== 'direct', mode);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
async function pioneerResetBrowserProxy() {
  try {
    const partitions = [
      ...EMBEDDED_BROWSER_PARTITIONS,
      ...getAccounts()
        .filter((a) => !a.proxy || !a.proxy.host)
        .map((a) => accountPartition(a.id)),
    ];
    for (const part of partitions) {
      const ses = session.fromPartition(part);
      if (ses) await ses.setProxy({ mode: 'direct' });
    }
    await setWindowsSystemProxy(false);
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
/* ---------- 2026-11-28-4：Pioneer 出口 IP 纯净度 ----------
 * 纯净度是本机启发式评估，不是商业数据库：拿出口 IP 的国家、运营商 /
 * ASN 类型与反向解析算分，依据写进结果里，不假装是权威检测。记分：
 * 100 起；机房/云服务商 ASN -30；出口国家与所选地区不一致 -15；
 * 反向解析含代理/机房字样 -10；识别不到运营商 -10。等级：>=90 优秀、
 * >=70 良好、>=50 一般、<50 较差。结果按 IP 永久存本机
 * data/pioneer-ip-purity.json（{byIp, byRegion}），同一 IP 直接读
 * 上次结果（可点重新检测刷新），换 IP 自动重测。 */
const IP_PURITY_FILE = 'pioneer-ip-purity.json';
const IP_PURITY_DATACENTER_RE = /hosting|cloud|datacenter|data\s*center|\bvps\b|server|alibaba|amazon|google|microsoft|tencent|digitalocean|linode|vultr|ovh|hetzner|leaseweb|choopa|psychz|m247|quadranet|colocrossing|frantech|datacamp|contabo|kamatera/i;
const IP_PURITY_PROXY_HOST_RE = /vpn|proxy|datacenter|hosting|cloud|\btor\b|relay/i;
function scoreIpPurity(meta, regionCountry) {
  const reasons = [];
  let score = 100;
  const org = String((meta && (meta.org || meta.isp || meta.asnOrg)) || '');
  const asn = String((meta && meta.asn) || '');
  const hostname = String((meta && meta.hostname) || '');
  const country = String((meta && (meta.country || meta.countryName)) || '');
  const hay = `${org} ${asn}`;
  if (IP_PURITY_DATACENTER_RE.test(hay)) { score -= 30; reasons.push('机房/云服务商 IP（ASN 属托管或云厂商）'); }
  else if (!org) { score -= 10; reasons.push('识别不到运营商'); }
  if (IP_PURITY_PROXY_HOST_RE.test(hostname)) { score -= 10; reasons.push('反向解析含代理/机房字样'); }
  const want = String(regionCountry || '').trim();
  if (want && country && country !== want && !want.includes(country) && !country.includes(want)) {
    score -= 15; reasons.push(`出口国家（${country}）与所选地区（${want}）不一致`);
  }
  if (score < 0) score = 0;
  const grade = score >= 90 ? '优秀' : score >= 70 ? '良好' : score >= 50 ? '一般' : '较差';
  if (!reasons.length) reasons.push('住宅/本地运营商 IP，未命中机房与代理特征');
  return { score, grade, reasons, country, org, asn, hostname };
}
function loadIpPurity() {
  const v = readJsonFile(IP_PURITY_FILE, {});
  if (!v || typeof v !== 'object') return { byIp: {}, byRegion: {} };
  return { byIp: (v.byIp && typeof v.byIp === 'object') ? v.byIp : {}, byRegion: (v.byRegion && typeof v.byRegion === 'object') ? v.byRegion : {} };
}
function saveIpPurity(rec) {
  const cur = loadIpPurity();
  const byIp = { ...cur.byIp, ...((rec && rec.byIp) || {}) };
  const byRegion = { ...cur.byRegion, ...((rec && rec.byRegion) || {}) };
  writeJsonFile(IP_PURITY_FILE, { byIp, byRegion });
  return { byIp, byRegion };
}
/* 出口 IP 元数据：4 个 IP 信息服务并行（每家 6 秒超时），按优先级取
 * 第一个成功的；每家状态都记下来，界面分开显示哪家通、哪家不通、耗时。
 * 2026-11-28-9：第 4 项：原来只有 ipinfo.io 与 ipwho.is 两家，任一被
 * 限流就只剩一家，两家都挂就一句“无响应”结束。现加 ip-api.com 与 ip.sb
 *（ip-api.com 免费档只支持 http，走 http://ip-api.com/json/）。 */
const IP_META_SERVICES = [
  { name: 'ipinfo.io', url: 'https://ipinfo.io/json', parse: (d) => (d && d.ip ? { ip: String(d.ip), country: String(d.country || ''), org: String(d.org || ''), hostname: String(d.hostname || ''), city: String(d.city || '') } : null) },
  { name: 'ipwho.is', url: 'https://ipwho.is/', parse: (d) => { if (!d || d.success === false || !d.ip) return null; const conn = (d.connection && typeof d.connection === 'object') ? d.connection : {}; return { ip: String(d.ip), country: String(d.country || d.country_code || ''), org: String(conn.org || conn.isp || ''), asn: String(conn.asn || ''), hostname: '' }; } },
  { name: 'ip-api.com', url: 'http://ip-api.com/json/?fields=status,message,country,isp,org,as,query', parse: (d) => (d && d.status === 'success' && d.query ? { ip: String(d.query), country: String(d.country || ''), org: String(d.isp || d.org || ''), asn: String(d.as || ''), hostname: '' } : null) },
  { name: 'ip.sb', url: 'https://api.ip.sb/geoip', parse: (d) => (d && d.ip ? { ip: String(d.ip), country: String(d.country || d.country_code || ''), org: String(d.isp || d.organization || ''), asn: String(d.asn || ''), hostname: '' } : null) },
];
async function pioneerFetchIpMeta(viaTunnel) {
  const proxy = viaTunnel ? { host: '127.0.0.1', port: 19352 } : null;
  const opts = { timeoutMs: 6000, maxBytes: 65536, ...(proxy ? { forceProxy: proxy } : { proxyOverride: 'direct' }) };
  const run = async (svc) => {
    const t0 = Date.now();
    const r = await fetchText(svc.url, opts);
    const ms = Date.now() - t0;
    if (!r || !r.ok) return { name: svc.name, ok: false, ms, error: (r && r.error) || '无响应' };
    let d = null; try { d = JSON.parse(r.text || '{}'); } catch (e) { return { name: svc.name, ok: false, ms, error: '返回无法解析' }; }
    const meta = svc.parse(d);
    if (!meta) return { name: svc.name, ok: false, ms, error: '返回中没有 IP' };
    return { name: svc.name, ok: true, ms, meta };
  };
  const results = await Promise.all(IP_META_SERVICES.map(run));
  const first = results.find((x) => x.ok);
  const services = results.map((x) => ({ name: x.name, ok: x.ok, ms: x.ms, error: x.ok ? '' : (x.error || '无响应') }));
  if (first) return { ok: true, meta: first.meta, services };
  const detail = results.map((x) => `${x.name}：${x.error || '无响应'}（${x.ms}ms）`).join('；');
  return { ok: false, error: `IP 信息服务均无响应（${detail}）。请检查网络后点“重新检测”，或换个地区再测。`, services };
}
/* 查一次出口 IP 纯净度。opts.force=true 强制重测；否则同一 IP 直接读
 * 上次结果。regionCountry/regionId 用于“地区后显示”与按地区记忆。 */
async function pioneerIpPurityCheck(opts) {
  const o = opts || {};
  const viaTunnel = pioneerTunnelRunning();
  let ip = '';
  if (viaTunnel) {
    const exit = await pioneerFetchExitIp();
    if (!exit.ok) return { ok: false, error: (exit && exit.reason) || '出口 IP 未知，先连接 Pioneer', viaTunnel: true };
    ip = exit.ip;
  } else {
    // 未连接时走直连取本机出口 IP（api.ipify.org）。
    const r = await fetchText('https://api.ipify.org?format=json', { timeoutMs: 20000 });
    if (!r.ok) return { ok: false, error: r.error || '检测失败', viaTunnel: false };
    try { ip = JSON.parse(r.text).ip || ''; } catch (e) { ip = ''; }
    if (!ip) return { ok: false, error: '出口 IP 返回无法解析', viaTunnel: false };
  }
  const stored = loadIpPurity();
  const prev = stored.byIp[ip];
  if (!o.force && prev && typeof prev.score === 'number') {
    return { ok: true, ip, ...prev, fromCache: true, viaTunnel };
  }
  const metaRes = await pioneerFetchIpMeta(viaTunnel);
  if (!metaRes.ok) {
    if (prev && typeof prev.score === 'number') return { ok: true, ip, ...prev, fromCache: true, viaTunnel, stale: true, staleReason: metaRes.error, services: metaRes.services || [] };
    return { ok: false, error: metaRes.error, ip, viaTunnel, services: metaRes.services || [] };
  }
  const s = pioneerLoad();
  const regionCountry = String(o.regionCountry || s.selectedName || '');
  const regionId = o.regionId != null ? Number(o.regionId) : (s.selectedCountryId != null ? Number(s.selectedCountryId) : null);
  const scored = scoreIpPurity(metaRes.meta, regionCountry);
  const rec = { score: scored.score, grade: scored.grade, reasons: scored.reasons, country: scored.country, org: scored.org, asn: scored.asn, hostname: scored.hostname, region: regionCountry, regionId, checkedAt: Date.now() };
  const next = { byIp: { ...stored.byIp, [ip]: rec }, byRegion: { ...stored.byRegion } };
  if (regionId != null && !Number.isNaN(regionId)) next.byRegion[String(regionId)] = { ip, ...rec };
  saveIpPurity(next);
  return { ok: true, ip, ...rec, fromCache: false, viaTunnel, services: metaRes.services || [] };
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
  const applied = await pioneerApplyBrowserProxy(pioneerProxyMode());
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
  // 2026-11-28-4：每次连接成功自动测一次 IP 纯净度（同一 IP 读上次
  // 结果，不重复测；测失败不影响已建立的连接）。
  let purity = null;
  try { const pr = await pioneerIpPurityCheck({ regionId: Number(countryId), regionCountry: s.selectedName || '' }); if (pr && pr.ok) purity = pr; } catch (e) { /* 纯净度测失败不影响连接 */ }
  return { ok: true, nodeName: info.name, region: s.selectedName, exitIp: exit.ip, purity };
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
    method: 'POST', timeoutMs: 20000,
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
  const r = await fetchText(`${DS_WEB_BASE}/api/v0/users/current`, { method: 'GET', timeoutMs: 20000, headers: dsWebHeaders(token) });
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
/* DeepSeekHashV1 PoW 求解（Keccak-f[1600]） */
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
async function dsWebSend(agent, prompt, chatId, onDelta) {
  const v = await dsValidateToken(agent.webToken || '');
  if (!v.ok) return { ok: false, error: `DeepSeek 网页版验证失败：${v.error}`, kind: v.kind };
  const accessToken = v.accessToken;
  // 2026-11-28-2：官网会话复用——按工具箱对话 id 续接同一会话，
  // 带上上条助手消息 id 作 parent_message_id；没有才新建。
  let sessionId = '';
  let parentMessageId = null;
  if (chatId) {
    const saved = getWebSession(chatId);
    if (saved && saved.site === 'deepseek' && saved.sessionId) {
      sessionId = saved.sessionId;
      parentMessageId = saved.parentMessageId || null;
    }
  }
  if (!sessionId) {
    const sessionRes = await dsCallJson('/api/v0/chat_session/create', accessToken, {});
    if (!sessionRes.ok) return { ok: false, error: `DeepSeek 网页版创建会话失败：${sessionRes.error}`, kind: sessionRes.kind };
    const biz = dsBizData(sessionRes.root);
    const sessionObj = (biz && biz.chat_session && typeof biz.chat_session === 'object') ? biz.chat_session : {};
    sessionId = String(sessionObj.id || '');
    if (!sessionId) return { ok: false, error: 'DeepSeek 网页版未返回会话编号（接口可能已变更）' };
  }
  const powRes = await dsPowResponse(accessToken, '/api/v0/chat/completion');
  if (!powRes.ok) return { ok: false, error: powRes.error };
  // 2026-11-28-2：流式回推——onChunk 收到一块就对已收到的全部
  // 文本跑 dsParseSse，累计文本回推给渲染层逐块显示。
  let acc = '';
  const r = await fetchText(`${DS_WEB_BASE}/api/v0/chat/completion`, {
    method: 'POST', timeoutMs: 90000,
    headers: {
      ...dsWebHeaders(accessToken), 'Content-Type': 'application/json',
      'x-ds-pow-response': powRes.pow,
      'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
    },
    body: JSON.stringify({
      chat_session_id: sessionId, parent_message_id: parentMessageId, model_type: 'default',
      prompt, ref_file_ids: [], thinking_enabled: false, search_enabled: false,
      action: null, preempt: false,
    }),
    proxyOverride: agentProxyOverride(agent),
    shouldStop: chatId ? () => agentStreamStop.has(String(chatId)) : undefined,
    onChunk: onDelta ? (chunk) => {
      acc += chunk;
      const parsed = dsParseSse(acc);
      if (parsed.text) { try { onDelta(parsed.text); } catch (e) { /* 回调失败不影响接收 */ } }
    } : undefined,
  });
  if (r.stopped) {
    const parsed = dsParseSse(acc || r.text || '');
    if (parsed.text) {
      if (chatId) setWebSession(chatId, { agentId: agent.id, site: 'deepseek', sessionId, parentMessageId: parsed.messageId || parentMessageId });
      return { ok: true, text: parsed.text, stopped: true };
    }
    return { ok: false, error: '已停止', stopped: true };
  }
  if (!r.ok) {
    const snippet = (r.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const kind = (r.status === 401 || r.status === 403) ? 'expired' : undefined;
    return { ok: false, error: `DeepSeek 网页版回复请求返回 HTTP ${r.status || ''}${snippet ? `：${snippet}` : ''}`, ...(kind ? { kind } : {}) };
  }
  if (!r.text.includes('data:')) {
    let root = null;
    try { root = JSON.parse(r.text); } catch (e) { root = null; }
    const code = root && typeof root.code === 'number' ? root.code : 0;
    if (root && code !== 0) return { ok: false, error: `DeepSeek 网页版回复失败：${dsErrorMessage(root, 'DeepSeek 网页版回复失败')}`, kind: code === 40003 || code === 40001 ? 'expired' : undefined };
    return { ok: false, error: 'DeepSeek 网页版返回了无法解析的回复（接口可能已变更）' };
  }
  const parsed = dsParseSse(r.text);
  if (!parsed.text) return { ok: false, error: 'DeepSeek 网页版返回了空回复' };
  if (chatId) setWebSession(chatId, { agentId: agent.id, site: 'deepseek', sessionId, parentMessageId: parsed.messageId || parentMessageId });
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
  const r = await fetchText('https://chat.qwen.ai/api/chats/?page=1&page_size=1', { method: 'GET', timeoutMs: 20000, headers });
  const failure = qwenApiFailure(r.text || '');
  if (failure) return failure;
  if (!r.ok) return { ok: false, error: `千问验证返回 HTTP ${r.status || ''}`, kind: 'error' };
  return { ok: true, accessToken: token, account: '' };
}
async function qwenWebSend(agent, prompt, chatId, onDelta) {
  const v = await qwenValidateToken(agent);
  if (!v.ok) return { ok: false, error: `千问网页版验证失败：${v.error}`, kind: v.kind };
  const headers = await qwenHeaders(agent);
  // 2026-11-28-2：模型用智能体配置的，不再写死 qwen3-max
  //（配置为空才回退到 qwen3-max）。
  const qwenModel = String(agent.model || '').trim() || 'qwen3-max';
  // 2026-11-28-2：官网会话复用——按工具箱对话 id 续接同一会话，
  // 不再每发一次就新建、发完 DELETE。
  let qwenChatId = '';
  if (chatId) {
    const saved = getWebSession(chatId);
    if (saved && saved.site === 'qwen' && saved.sessionId) qwenChatId = saved.sessionId;
  }
  if (!qwenChatId) {
    const created = await fetchText('https://chat.qwen.ai/api/chats/new', {
      method: 'POST', timeoutMs: 20000, headers,
      body: JSON.stringify({ title: 'New Chat', models: [qwenModel], chat_mode: 'normal', chat_type: 't2t', timestamp: Date.now() }),
    });
    const createFailure = qwenApiFailure(created.text || '');
    if (createFailure) return { ok: false, error: createFailure.error, kind: createFailure.kind };
    if (!created.ok) return { ok: false, error: `千问网页版创建会话失败：HTTP ${created.status || ''}` };
    try { const rec = JSON.parse(created.text); qwenChatId = String((rec.data && rec.data.id) || ''); } catch (e) { qwenChatId = ''; }
    if (!qwenChatId) return { ok: false, error: '千问网页端未返回会话编号（接口可能已变更）' };
  }
  // 2026-11-28-2：流式回推——onChunk 收到一块就对已收到的全部
  // 文本跑 qwenParseSseText，累计文本回推给渲染层逐块显示。
  let acc = '';
  const res = await fetchText(`https://chat.qwen.ai/api/chat/completions?chat_id=${qwenChatId}`, {
    method: 'POST', timeoutMs: 90000,
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify({
      stream: true, incremental_output: true, chat_type: 't2t',
      messages: [{
        fid: crypto.randomUUID(), parentId: null, childrenIds: [], role: 'user', content: prompt,
        user_action: 'chat', files: [], timestamp: Math.floor(Date.now() / 1000), models: [qwenModel],
        chat_type: 't2t',
        feature_config: { thinking_enabled: false, output_schema: 'phase', research_mode: 'normal', auto_search: false, thinking_mode: 'Fast', thinking_budget: 8192, auto_thinking: false },
        extra: {}, sub_chat_type: 't2t', parent_id: null,
      }],
      chat_id: qwenChatId, chat_mode: 'normal', model: qwenModel, parent_id: null,
    }),
    proxyOverride: agentProxyOverride(agent),
    shouldStop: chatId ? () => agentStreamStop.has(String(chatId)) : undefined,
    onChunk: onDelta ? (chunk) => {
      acc += chunk;
      const t = qwenParseSseText(acc);
      if (t) { try { onDelta(t); } catch (e) { /* 回调失败不影响接收 */ } }
    } : undefined,
  });
  const sendFailure = qwenApiFailure(res.text || '');
  if (sendFailure) return { ok: false, error: sendFailure.error, kind: sendFailure.kind };
  if (res.stopped) {
    const t = qwenParseSseText(acc || res.text || '');
    if (t.trim()) {
      if (chatId) setWebSession(chatId, { agentId: agent.id, site: 'qwen', sessionId: qwenChatId });
      return { ok: true, text: t.trim(), stopped: true };
    }
    return { ok: false, error: '已停止', stopped: true };
  }
  if (!res.ok) return { ok: false, error: `千问网页版回复失败：HTTP ${res.status || ''}` };
  const text = qwenParseSseText(res.text || '');
  if (!text.trim()) return { ok: false, error: '千问网页版返回了空回复' };
  if (chatId) setWebSession(chatId, { agentId: agent.id, site: 'qwen', sessionId: qwenChatId });
  return { ok: true, text: text.trim() };
}
/* 千问 SSE 增量解析（整段文本版与流式版共用）：只取 answer 阶段。 */
function qwenParseSseText(text) {
  let out = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let data = null;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const choices = Array.isArray(data && data.choices) ? data.choices : [];
    const delta = (choices[0] && choices[0].delta && typeof choices[0].delta === 'object') ? choices[0].delta : {};
    if (typeof delta.content === 'string' && (delta.phase === 'answer' || delta.phase === undefined)) out += delta.content;
  }
  return out;
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
  const r = await fetchText('https://www.doubao.com/chat/', { method: 'GET', timeoutMs: 20000, headers: doubaoHeaders(cookie) });
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
  const r = await fetchText('https://gemini.google.com/app', { method: 'GET', timeoutMs: 20000, headers: { Cookie: header, 'User-Agent': WEB_UA } });
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
/* 2026-11-28-2：官网会话续接——按工具箱对话 id 存官网会话 id，
 * 本机 web-sessions.json（只存 id，不存令牌）。DeepSeek 存
 * sessionId + parent_message_id（上条助手消息 id），千问存
 * chatId；身份变化、删对话、删智能体时清对应续接。 */
function getWebSessions() { const v = readJsonFile('web-sessions.json', {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function saveWebSessions(map) { writeJsonFile('web-sessions.json', map || {}); }
function getWebSession(chatId) { return getWebSessions()[String(chatId || '')] || null; }
function setWebSession(chatId, rec) {
  const map = getWebSessions();
  map[String(chatId)] = { ...(rec || {}), updatedAt: Date.now() };
  saveWebSessions(map);
}
function clearWebSessionsForChat(chatId) {
  const map = getWebSessions();
  if (map[String(chatId || '')]) { delete map[String(chatId || '')]; saveWebSessions(map); }
}
function clearWebSessionsForAgent(agentId) {
  const map = getWebSessions();
  let changed = false;
  for (const k of Object.keys(map)) {
    if (String(map[k].agentId || '') === String(agentId)) { delete map[k]; changed = true; }
  }
  if (changed) saveWebSessions(map);
}
/* 2026-11-28-2：账号身份哈希——验证成功时存“站点 + 账号标识 +
 * 令牌哈希”的 sha256（只存哈希，不存令牌本身）。两个智能体
 * 同站同哈希即同一账号，列表与抽屉显示碰撞提示；身份变化时
 * 清该智能体的官网会话续接。 */
function webIdentityHash(site, account, token) {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  return crypto.createHash('sha256').update(`${String(site || '').toLowerCase()}|${String(account || '')}|${tokenHash}`).digest('hex').slice(0, 16);
}
function findWebIdentityCollision(agent) {
  if (!agent || agent.connectionType !== 'web' || !agent.webIdentityHash) return null;
  const site = String(agent.webSite || agent.provider || '').toLowerCase();
  return getAgents().find((a) => a.id !== agent.id && a.connectionType === 'web'
    && String(a.webSite || a.provider || '').toLowerCase() === site
    && a.webIdentityHash && a.webIdentityHash === agent.webIdentityHash) || null;
}
function markAgentWebStatus(agentId, status) {
  const list = getAgents();
  const it = list.find((a) => a.id === agentId);
  if (!it) return;
  it.webStatus = status;
  saveAgents(list);
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
    if (it) { it.webStatus = v.kind === 'error' ? 'error' : v.kind; saveAgents(list); }
    return { ok: false, error: v.error, webStatus: v.kind };
  }
  const list = getAgents();
  const it = list.find((a) => a.id === agent.id);
  if (it) {
    const oldHash = it.webIdentityHash || '';
    const hash = webIdentityHash(site, v.account || '', token);
    it.webStatus = 'logged_in';
    it.webLogin = v.account || it.webLogin || '';
    it.webIdentityHash = hash;
    if (site === 'gemini' && v.accessToken && v.accessToken !== token) it.webToken = v.accessToken;
    saveAgents(list);
    // 身份变了（换了账号/令牌），旧官网会话续接作废。
    if (oldHash && oldHash !== hash) clearWebSessionsForAgent(agent.id);
    const other = findWebIdentityCollision(it);
    return { ok: true, login: v.account || '', webStatus: 'logged_in', webIdentityHash: hash, collisionWith: other ? (other.name || '') : '' };
  }
  return { ok: true, login: v.account || '', webStatus: 'logged_in' };
}
async function webChatSend(agent, prompt, chatId, onDelta) {
  const site = String(agent.webSite || agent.provider || '').toLowerCase();
  if (!String(agent.webToken || '').trim()) return { ok: false, error: '该智能体尚未登录网页版（未粘贴令牌）' };
  let r;
  if (site === 'deepseek') r = await dsWebSend(agent, prompt, chatId, onDelta);
  else if (site === 'qwen') r = await qwenWebSend(agent, prompt, chatId, onDelta);
  else if (site === 'doubao') return { ok: false, error: '豆包网页端发送尚未接通：豆包的发送要拼页面签名参数（device_id / web_id / msToken / 版本号），主进程里尚未完成对接' };
  else if (site === 'gemini') return { ok: false, error: 'Gemini 网页端发送尚未接通：Gemini 的发送走 StreamGenerate RPC（需从 /app 页取 bl / sid / at 参数），主进程里尚未完成对接' };
  else return { ok: false, error: '该站点网页端发送尚未接通' };
  // 2026-11-28-2：发送时 401/过期写回 webStatus，列表不再
  // 显示“已登录”撒谎（以前只在验证时写）。
  if (!r.ok && (r.kind === 'expired' || r.kind === 'blocked')) markAgentWebStatus(agent.id, r.kind);
  return r;
}
function buildWebPrompt(agent, history, newContent) {
  const parts = [];
  // 2026-11-28-2：与 API 路径同一套系统提示（系统提示 → 长期
  // 记忆 → 技能 → 工具说明），不再只拼系统提示与技能。
  const sys = buildSystemPrompt(agent);
  if (sys) parts.push(sys);
  // 2026-11-28-2：网页版扁平化同样截断到最近 N 轮（contextLength，
  // 默认 20）；系统提示已在上面单独保留，不随截断丢掉。
  for (const m of truncateHistoryMessages(history || [], agent.contextLength)) {
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

/* ---------------- 手机远程（2026-11-28-5） ----------------
 * 局域网直连（A）+ Tailscale（B）共用同一套本地 HTTPS 服务，
 * 不经过任何第三方服务器，数据不出内网。默认关闭，不开就没
 * 有任何监听端口。2026-11-28-3 删掉的 19876 端口旧远程服务
 * 器不要复用，这里是全新实现。
 * 纯 JS、零新依赖：自签证书手写 DER 编码、二维码手写编码器、
 * 托盘变色图标手写 PNG 编码。凭据只存本机：
 * data/phone-remote.json（令牌只存 SHA-256 哈希）与
 * data/phone-remote-cert.json（证书与私钥），两个文件都不进
 * 仓库、不进备份（BACKUP_FILE_NAMES 里没有它们）、不打日志。 */
const PHONE_REMOTE_FILE = 'phone-remote.json';
const PHONE_REMOTE_CERT_FILE = 'phone-remote-cert.json';
const PHONE_REMOTE_PAIR_TTL_MS = 5 * 60 * 1000; // 配对码 5 分钟过期
const PHONE_REMOTE_PAIR_MAX_ATTEMPTS = 5; // 配对码错 5 次锁定
const PHONE_REMOTE_PAIR_LOCK_MS = 10 * 60 * 1000; // 锁定 10 分钟
const PHONE_REMOTE_TOKEN_INVALID_LIMIT = 10; // 令牌连续 10 次无效拉黑
const PHONE_REMOTE_LOG_MAX = 200;
const PHONE_REMOTE_DANGEROUS_KEYS = ['deleteFile', 'uninstall', 'publish', 'proxy', 'tokenManage'];
const PHONE_REMOTE_DANGEROUS_LABELS = { deleteFile: '删文件（移入回收站）', uninstall: '卸载软件', publish: '发版推库', proxy: '改代理模式', tokenManage: '管理配对令牌' };

/* ---- 最小 DER 编码器（只够拼 X.509 自签证书用） ---- */
function phoneRemoteDerLen(n) {
  if (n < 128) return Buffer.from([n]);
  const b = []; let x = n;
  while (x > 0) { b.unshift(x & 0xff); x >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
function phoneRemoteDerTlv(tag, content) { return Buffer.concat([Buffer.from([tag]), phoneRemoteDerLen(content.length), content]); }
function phoneRemoteDerSeq(...parts) { return phoneRemoteDerTlv(0x30, Buffer.concat(parts)); }
function phoneRemoteDerSet(...parts) { return phoneRemoteDerTlv(0x31, Buffer.concat(parts)); }
function phoneRemoteDerIntBuf(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0x00 && (b[1] & 0x80) === 0) b = b.slice(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return phoneRemoteDerTlv(0x02, b);
}
function phoneRemoteDerIntNum(n) {
  if (n === 0) return phoneRemoteDerTlv(0x02, Buffer.from([0]));
  const b = []; let x = n;
  while (x > 0) { b.unshift(x & 0xff); x >>= 8; }
  return phoneRemoteDerIntBuf(Buffer.from(b));
}
function phoneRemoteDerOid(oid) {
  const parts = oid.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]; const enc = [v & 0x7f]; v >>= 7;
    while (v > 0) { enc.unshift(0x80 | (v & 0x7f)); v >>= 7; }
    out.push(...enc);
  }
  return phoneRemoteDerTlv(0x06, Buffer.from(out));
}
function phoneRemoteDerUtf8(s) { return phoneRemoteDerTlv(0x0c, Buffer.from(s, 'utf8')); }
function phoneRemoteDerNull() { return phoneRemoteDerTlv(0x05, Buffer.alloc(0)); }
function phoneRemoteDerBool(v) { return phoneRemoteDerTlv(0x01, Buffer.from([v ? 0xff : 0])); }
function phoneRemoteDerBitStr(bytes) { return phoneRemoteDerTlv(0x03, Buffer.concat([Buffer.from([0]), bytes])); }
function phoneRemoteDerOctet(bytes) { return phoneRemoteDerTlv(0x04, bytes); }
function phoneRemoteDerExplicit(n, content) { return phoneRemoteDerTlv(0xa0 + n, content); }
function phoneRemoteDerUtc(d) {
  const p = (x) => String(x).padStart(2, '0');
  return phoneRemoteDerTlv(0x17, Buffer.from(`${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'));
}
function phoneRemoteDerGen(d) {
  const p = (x) => String(x).padStart(2, '0');
  return phoneRemoteDerTlv(0x18, Buffer.from(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'));
}
function phoneRemoteDerToPem(der, label) {
  const b64 = der.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
/* 自签证书：v3、随机序列号、CN=桌面工具箱、10 年有效、SAN 含全部
 * 监听 IP 与 localhost、CA:false、keyUsage digitalSignature +
 * keyEncipherment、extKeyUsage serverAuth。返回 {keyPem, certPem,
 * fingerprint, ips, createdAt}，fingerprint 为证书 DER 的 SHA-256。 */
function phoneRemoteGenerateCert(ips) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const n = Buffer.from(jwk.n, 'base64url');
  const e = Buffer.from(jwk.e, 'base64url');
  const rsaPub = phoneRemoteDerSeq(phoneRemoteDerIntBuf(n), phoneRemoteDerIntBuf(e));
  const spki = phoneRemoteDerSeq(
    phoneRemoteDerSeq(phoneRemoteDerOid('1.2.840.113549.1.1.1'), phoneRemoteDerNull()),
    phoneRemoteDerBitStr(rsaPub));
  const name = phoneRemoteDerSeq(phoneRemoteDerSet(phoneRemoteDerSeq(phoneRemoteDerOid('2.5.4.3'), phoneRemoteDerUtf8('桌面工具箱'))));
  const now = new Date();
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000);
  const serial = crypto.randomBytes(8);
  serial[0] &= 0x7f; if (serial[0] === 0) serial[0] = 1;
  const san = [];
  for (const ip of ips || []) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length === 4 && parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) san.push(Buffer.concat([Buffer.from([0x87, 4]), Buffer.from(parts)]));
  }
  san.push(Buffer.concat([Buffer.from([0x82, 9]), Buffer.from('localhost', 'ascii')]));
  const ext = (oid, critical, value) => phoneRemoteDerSeq(phoneRemoteDerOid(oid), ...(critical ? [phoneRemoteDerBool(true)] : []), phoneRemoteDerOctet(value));
  const exts = [
    ext('2.5.29.19', true, phoneRemoteDerSeq()),
    ext('2.5.29.15', true, phoneRemoteDerTlv(0x03, Buffer.from([5, 0xa0]))),
    ext('2.5.29.37', false, phoneRemoteDerSeq(phoneRemoteDerOid('1.3.6.1.5.5.7.3.1'))),
    ext('2.5.29.17', false, phoneRemoteDerSeq(...san)),
  ];
  const sigAlg = phoneRemoteDerSeq(phoneRemoteDerOid('1.2.840.113549.1.1.11'), phoneRemoteDerNull());
  const tbs = phoneRemoteDerSeq(
    phoneRemoteDerExplicit(0, phoneRemoteDerIntNum(2)),
    phoneRemoteDerIntBuf(serial), sigAlg, name,
    phoneRemoteDerSeq(phoneRemoteDerUtc(now), phoneRemoteDerGen(notAfter)),
    name, spki, phoneRemoteDerExplicit(3, phoneRemoteDerSeq(...exts)));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = phoneRemoteDerSeq(tbs, sigAlg, phoneRemoteDerBitStr(sig));
  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certPem: phoneRemoteDerToPem(certDer, 'CERTIFICATE'),
    fingerprint: crypto.createHash('sha256').update(certDer).digest('hex'),
    ips: [...(ips || [])], createdAt: Date.now(),
  };
}
function phoneRemoteLoadCert() {
  const v = readJsonFile(PHONE_REMOTE_CERT_FILE, null);
  if (v && typeof v === 'object' && v.keyPem && v.certPem && v.fingerprint) return v;
  return null;
}
/* 监听地址变了（DHCP 换 IP、Tailscale 通/断）就重新生成证书，
 * 否则 SAN 里的旧 IP 对不上、手机浏览器会报证书错误。 */
function phoneRemoteEnsureCert(ips) {
  const list = [...new Set([...(ips || []), '127.0.0.1'])].sort();
  const cur = phoneRemoteLoadCert();
  if (cur && Array.isArray(cur.ips) && JSON.stringify([...cur.ips].sort()) === JSON.stringify(list)) return cur;
  const cert = phoneRemoteGenerateCert(list);
  try { writeJsonFile(PHONE_REMOTE_CERT_FILE, cert); } catch (e) { /* 证书落盘失败就只用内存里的，服务照常起 */ }
  return cert;
}

/* ---- 状态（phone-remote.json）：令牌只存哈希，绝不存明文 ---- */
function phoneRemoteDefaultState() {
  return {
    version: 1, port: 0, devices: [], logs: [],
    dangerous: { deleteFile: false, uninstall: false, publish: false, proxy: false, tokenManage: false },
    pair: { code: '', token: '', expiresAt: 0, attempts: 0, lockedUntil: 0 },
    invalidToken: { count: 0, lastHash: '', blocked: [] },
  };
}
function phoneRemoteLoad() {
  const v = readJsonFile(PHONE_REMOTE_FILE, null);
  if (v && typeof v === 'object') {
    const d = phoneRemoteDefaultState();
    const s = { ...d, ...v };
    s.dangerous = { ...d.dangerous, ...(v.dangerous || {}) };
    s.pair = { ...d.pair, ...(v.pair || {}) };
    s.invalidToken = { ...d.invalidToken, ...(v.invalidToken || {}) };
    if (!Array.isArray(s.devices)) s.devices = [];
    if (!Array.isArray(s.logs)) s.logs = [];
    if (!Array.isArray(s.invalidToken.blocked)) s.invalidToken.blocked = [];
    return s;
  }
  return phoneRemoteDefaultState();
}
function phoneRemoteSave(s) { writeJsonFile(PHONE_REMOTE_FILE, s); }
function phoneRemoteSha256Hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function phoneRemoteTimingEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}
function phoneRemoteLog(s, deviceName, op, ok, detail) {
  const logs = Array.isArray(s.logs) ? s.logs : [];
  logs.unshift({ at: Date.now(), device: String(deviceName || ''), op: String(op || ''), ok: ok !== false, detail: String(detail || '') });
  s.logs = logs.slice(0, PHONE_REMOTE_LOG_MAX);
}

/* ---- 配对与令牌 ---- */
/* 点“允许配对”才生成：6 位配对码 + 一次性配对令牌（进二维码），
 * 5 分钟过期；配对成功后立即作废。 */
function phoneRemoteAllowPair() {
  const s = phoneRemoteLoad();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const token = crypto.randomBytes(16).toString('hex');
  s.pair = { code, token, expiresAt: Date.now() + PHONE_REMOTE_PAIR_TTL_MS, attempts: 0, lockedUntil: 0 };
  phoneRemoteSave(s);
  return { ok: true, code, expiresAt: s.pair.expiresAt, pairToken: token };
}
function phoneRemoteCheckPair(code, token) {
  const s = phoneRemoteLoad();
  const now = Date.now();
  if (s.pair.lockedUntil && now < s.pair.lockedUntil) return { ok: false, error: '配对已锁定，请 10 分钟后再试', lockedUntil: s.pair.lockedUntil };
  if (!s.pair.token || !s.pair.code || now > s.pair.expiresAt) return { ok: false, error: '配对码已过期，请在工具箱里重新点“允许配对”' };
  if (!phoneRemoteTimingEqual(token, s.pair.token) || String(code) !== String(s.pair.code)) {
    s.pair.attempts += 1;
    if (s.pair.attempts >= PHONE_REMOTE_PAIR_MAX_ATTEMPTS) {
      s.pair.lockedUntil = now + PHONE_REMOTE_PAIR_LOCK_MS;
      s.pair.attempts = 0;
      phoneRemoteLog(s, '系统', '配对', false, '配对码连续错 5 次，已锁定 10 分钟');
    }
    phoneRemoteSave(s);
    return { ok: false, error: '配对码不正确' };
  }
  return { ok: true, state: s };
}
/* 配对成功签发 256 位随机令牌：明文只回手机一次，工具箱只存
 * SHA-256 哈希；同时作废配对码与一次性配对令牌。 */
function phoneRemoteIssueDeviceToken(s, name) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = phoneRemoteSha256Hex(token);
  const dev = { id: localId(), name: String(name || '手机').slice(0, 40) || '手机', tokenHash: hash, createdAt: Date.now(), lastSeenAt: Date.now() };
  s.devices.unshift(dev);
  s.devices = s.devices.slice(0, 20);
  s.pair = { code: '', token: '', expiresAt: 0, attempts: 0, lockedUntil: 0 };
  phoneRemoteSave(s);
  return { device: dev, token };
}
function phoneRemoteRevokeDevice(deviceId) {
  const s = phoneRemoteLoad();
  const before = s.devices.length;
  s.devices = s.devices.filter((d) => d.id !== String(deviceId));
  phoneRemoteSave(s);
  return { ok: s.devices.length < before };
}
/* 令牌只认 Authorization: Bearer 请求头。连续 10 次用同一个无效
 * 令牌来撞时把它拉黑并记日志；没带令牌的不计数。 */
function phoneRemoteNoteInvalidToken(s, hash) {
  if (!hash) return;
  const inv = s.invalidToken || { count: 0, lastHash: '', blocked: [] };
  if (hash === inv.lastHash) inv.count += 1;
  else { inv.count = 1; inv.lastHash = hash; }
  if (inv.count >= PHONE_REMOTE_TOKEN_INVALID_LIMIT) {
    if (!inv.blocked.includes(hash)) inv.blocked.push(hash);
    phoneRemoteLog(s, '未知设备', '令牌校验', false, '令牌连续 10 次无效，已拉黑该令牌');
    inv.count = 0; inv.lastHash = '';
  }
  s.invalidToken = inv;
  phoneRemoteSave(s);
}
function phoneRemoteAuth(headers) {
  const s = phoneRemoteLoad();
  const auth = String((headers && (headers.authorization || headers.Authorization)) || '');
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  if (!m) return { ok: false, status: 401, error: '未提供令牌' };
  const hash = phoneRemoteSha256Hex(m[1]);
  if ((s.invalidToken.blocked || []).includes(hash)) return { ok: false, status: 403, error: '该令牌已被拉黑' };
  const dev = s.devices.find((d) => phoneRemoteTimingEqual(d.tokenHash, hash));
  if (!dev) { phoneRemoteNoteInvalidToken(s, hash); return { ok: false, status: 401, error: '令牌无效' }; }
  s.invalidToken.count = 0; s.invalidToken.lastHash = '';
  dev.lastSeenAt = Date.now();
  phoneRemoteSave(s);
  return { ok: true, device: dev, state: s };
}
/* 高危操作三道门：设置页没勾选放开 → 403；勾选了但请求体没带
 * confirm:true（手机端二次确认）→ 403；两样都有才放行。 */
function phoneRemoteDangerousCheck(key, body) {
  const s = phoneRemoteLoad();
  if (!PHONE_REMOTE_DANGEROUS_KEYS.includes(key)) return { ok: false, status: 403, error: '未知的高危操作' };
  if (!s.dangerous || s.dangerous[key] !== true) return { ok: false, status: 403, error: `「${PHONE_REMOTE_DANGEROUS_LABELS[key] || key}」未在工具箱设置页放开` };
  if (!body || body.confirm !== true) return { ok: false, status: 403, error: '高危操作需要手机端二次确认（confirm:true）' };
  return { ok: true };
}

/* ---- 二维码（纯 JS：字节模式、纠错等级 M、自动选版本 1–10） ----
 * 与 Python segno 1.6.6 逐模块比对过（5 组输入，含中文 URL 与
 * 需版本信息区的长输入）：RS 余数与 reedsolo 一致，5 组输入
 * 用 OpenCV 解码全部还原。已知与 segno 的有意差异：segno 在
 * 位流已字节对齐时仍多补一个 0x00 填充字节（会溢出容量 8 位，
 * 再由 make_blocks 静默丢弃），本实现按 ISO 18004 / Nayuki
 * 做法只在需要时补位到字节边界；掩码选择是罚分高低问题，
 * 两种选择都能正常解码。 */
const QR_M_BLOCKS = { 1: [16], 2: [28], 3: [44], 4: [32, 32], 5: [43, 43], 6: [27, 27, 27, 27], 7: [31, 31, 31, 31], 8: [38, 38, 39, 39], 9: [36, 36, 36, 37, 37], 10: [43, 43, 43, 43, 44] };
const QR_M_EC = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22, 9: 22, 10: 26 };
const QR_ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const QR_REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
const QR_VERSION_BITS = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
const QR_GF_EXP = new Array(512);
const QR_GF_LOG = new Array(256);
(function phoneRemoteQrInitGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) { QR_GF_EXP[i] = x; QR_GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) QR_GF_EXP[i] = QR_GF_EXP[i - 255];
})();
function phoneRemoteQrGfMul(a, b) { if (a === 0 || b === 0) return 0; return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]]; }
function phoneRemoteQrRsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= phoneRemoteQrGfMul(poly[j], QR_GF_EXP[i]); next[j + 1] ^= poly[j]; }
    poly = next;
  }
  return poly;
}
function phoneRemoteQrRsRemainder(data, degree) {
  // 生成多项式是低次在前，余数循环要高次在前（不含首项 1），先翻转。
  const gen = phoneRemoteQrRsGenerator(degree).slice().reverse();
  const res = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < degree; i++) res[i] ^= phoneRemoteQrGfMul(gen[i + 1], factor);
  }
  return res;
}
function phoneRemoteQrFormatBits(mask) {
  let rem = ((0b00 << 3) | mask) << 10;
  const gen = 0x537;
  for (let i = 14; i >= 10; i--) { if (rem & (1 << i)) rem ^= gen << (i - 10); }
  return ((((0b00 << 3) | mask) << 10 | rem) ^ 0x5412) & 0x7fff;
}
const QR_MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
  (r, c) => (((r * c) % 2 + (r * c) % 3) % 2) === 0,
  (r, c) => (((r + c) % 2 + (r * c) % 3) % 2) === 0,
];
function phoneRemoteQrPenalty(m) {
  const n = m.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let run = 1; let prev = m[r][0];
    for (let c = 1; c < n; c++) {
      if (m[r][c] === prev) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = m[r][c]; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < n; c++) {
    let run = 1; let prev = m[0][c];
    for (let r = 1; r < n; r++) {
      if (m[r][c] === prev) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = m[r][c]; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matchAt = (arr, at, pat) => { for (let i = 0; i < 11; i++) if (arr[at + i] !== pat[i]) return false; return true; };
  for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) if (matchAt(m[r], c, pat1) || matchAt(m[r], c, pat2)) score += 40;
  for (let c = 0; c < n; c++) {
    const col = []; for (let r = 0; r < n; r++) col.push(m[r][c]);
    for (let r = 0; r <= n - 11; r++) if (matchAt(col, r, pat1) || matchAt(col, r, pat2)) score += 40;
  }
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
  const total = n * n;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}
function phoneRemoteQrEncode(text) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const cap = QR_M_BLOCKS[v].reduce((a, b) => a + b, 0);
    const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (need <= cap * 8) { version = v; break; }
  }
  if (!version) return { ok: false, error: '内容过长（二维码最大支持版本 10）' };
  const bits = [];
  const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const cap = QR_M_BLOCKS[version].reduce((a, b) => a + b, 0);
  const totalDataBits = cap * 8;
  const term = Math.min(4, totalDataBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11]; let pi = 0;
  while (bits.length < totalDataBits) { pushBits(pads[pi % 2], 8); pi++; }
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; dataCodewords.push(v); }
  const blockSizes = QR_M_BLOCKS[version];
  const ecLen = QR_M_EC[version];
  const blocks = []; let off = 0;
  for (const sz of blockSizes) { const data = dataCodewords.slice(off, off + sz); off += sz; blocks.push({ data, ec: phoneRemoteQrRsRemainder(data, ecLen) }); }
  const interleaved = [];
  const maxData = Math.max(...blockSizes);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) interleaved.push(b.data[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) interleaved.push(b.ec[i]);
  const allBits = [];
  for (const cw of interleaved) for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);
  for (let i = 0; i < QR_REMAINDER_BITS[version]; i++) allBits.push(0);
  const size = 21 + 4 * (version - 1);
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFunc = (r, c, v) => { if (r < 0 || c < 0 || r >= size || c >= size) return; matrix[r][c] = v; isFunc[r][c] = true; };
  const setFuncIfFree = (r, c, v) => { if (r < 0 || c < 0 || r >= size || c >= size) return; if (isFunc[r][c]) return; matrix[r][c] = v; isFunc[r][c] = true; };
  const placeFinder = (r0, c0) => {
    for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) {
      const r = r0 + y, c = c0 + x;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      let v = 0;
      if (y >= 0 && y < 7 && x >= 0 && x < 7) {
        const edge = (x === 0 || x === 6 || y === 0 || y === 6);
        const center = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
        v = (edge || center) ? 1 : 0;
      }
      setFunc(r, c, v);
    }
  };
  placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { setFunc(6, i, (i % 2 === 0) ? 1 : 0); setFunc(i, 6, (i % 2 === 0) ? 1 : 0); }
  // 对齐图案：中心落在探测图案位置（(6,6)/(6,max)/(max,6)）的三处
  // 整块不画（ISO 18004 §6.3.6）；只跳已占格子会错占数据格，
  // 导致码流移位、无法解码（原型验证时定位到的真 bug）。
  const alignMax = QR_ALIGN[version][QR_ALIGN[version].length - 1];
  for (const r of QR_ALIGN[version]) for (const c of QR_ALIGN[version]) {
    if ((r === 6 && c === 6) || (r === 6 && c === alignMax) || (r === alignMax && c === 6)) continue;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) setFuncIfFree(r + y, c + x, (Math.max(Math.abs(x), Math.abs(y)) !== 1) ? 1 : 0);
  }
  setFunc(4 * version + 9, 8, 1); // 暗模块
  for (const c of [0, 1, 2, 3, 4, 5, 7, 8]) setFunc(8, c, 0); // 格式信息区占位
  for (const r of [0, 1, 2, 3, 4, 5, 7]) setFunc(r, 8, 0);
  for (let c = size - 8; c < size; c++) setFunc(8, c, 0);
  for (let r = size - 7; r < size; r++) setFunc(r, 8, 0);
  if (version >= 7) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { setFunc(r, size - 11 + c, 0); setFunc(size - 11 + c, r, 0); }
  }
  let bitIdx = 0; let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (matrix[r][c] === null) matrix[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
      }
    }
    upward = !upward;
  }
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = matrix.map((row, r) => row.map((v, c) => (isFunc[r][c] ? v : (v ^ (QR_MASK_FNS[mask](r, c) ? 1 : 0)))));
    const score = phoneRemoteQrPenalty(m);
    if (!best || score < best.score) best = { mask, matrix: m, score };
  }
  const final = best.matrix;
  const fmt = phoneRemoteQrFormatBits(best.mask);
  const fmtPos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const fmtPos2 = [];
  for (let i = 0; i < 7; i++) fmtPos2.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) fmtPos2.push([8, size - 8 + i]);
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> (14 - i)) & 1;
    final[fmtPos1[i][0]][fmtPos1[i][1]] = bit;
    final[fmtPos2[i][0]][fmtPos2[i][1]] = bit;
  }
  if (version >= 7) {
    const vb = QR_VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const bit = (vb >> i) & 1;
      final[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      final[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }
  return { ok: true, version, mask: best.mask, size, matrix: final };
}
/* 结构校验（自测用）：尺寸公式、三个定位图案、时序图案、格式
 * 信息位可解（与所选掩码重算一致）、暗模块。 */
function phoneRemoteQrCheckStructure(qr) {
  const m = qr.matrix, n = m.length, v = qr.version;
  const finder = (r0, c0) => {
    const pat = [[1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (m[r0 + y][c0 + x] !== pat[y][x]) return false;
    return true;
  };
  const finderOk = finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0);
  let timingOk = true;
  for (let i = 8; i < n - 8; i++) { if (m[6][i] !== (i % 2 === 0 ? 1 : 0)) timingOk = false; if (m[i][6] !== (i % 2 === 0 ? 1 : 0)) timingOk = false; }
  const expected = phoneRemoteQrFormatBits(qr.mask);
  const pos = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  let read = 0; for (const [r, c] of pos) read = (read << 1) | m[r][c];
  return { sizeOk: n === 21 + 4 * (v - 1), finderOk, timingOk, formatOk: read === expected, darkOk: m[4 * v + 9][8] === 1 };
}
function phoneRemoteQrSvg(matrix) {
  const n = matrix.length; const q = 4; const size = n + 2 * q;
  let rects = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (matrix[y][x]) rects += `<rect x="${x + q}" y="${y + q}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="220" height="220" role="img" aria-label="配对二维码"><rect width="${size}" height="${size}" fill="#ffffff"/><g fill="#111111">${rects}</g></svg>`;
}

/* ---- 托盘联动：有手机连接时托盘图标变色（运行时生成 PNG，
 * 不新增二进制资产文件） ---- */
const PHONE_REMOTE_CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function phoneRemoteCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = PHONE_REMOTE_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function phoneRemotePngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(phoneRemoteCrc32(td));
  return Buffer.concat([len, td, crc]);
}
function phoneRemoteMakePng(w, h, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const px = pixelFn(x, y);
      const o = y * (1 + w * 4) + 1 + x * 4;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    phoneRemotePngChunk('IHDR', ihdr),
    phoneRemotePngChunk('IDAT', zlib.deflateSync(raw)),
    phoneRemotePngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function phoneRemoteTrayIconImage() {
  const png = phoneRemoteMakePng(32, 32, (x, y) => {
    const dx = x - 15.5, dy = y - 15.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 10) return [34, 211, 238, 255];
    if (d <= 11.5) return [34, 211, 238, 120];
    return [0, 0, 0, 0];
  });
  try { const img = nativeImage.createFromBuffer(png); if (!img.isEmpty()) return img; } catch (e) { /* 回原图标 */ }
  return trayIconImage();
}
function phoneRemoteOnlineCount() {
  const s = phoneRemoteLoad();
  const now = Date.now();
  return s.devices.filter((d) => d.lastSeenAt && now - d.lastSeenAt < 120000).length;
}
function phoneRemoteRefreshTray() {
  if (!tray) return; // Linux 沙盒里托盘可能为 null，判空跳过
  try {
    if (phoneRemoteRunning && phoneRemoteOnlineCount() > 0) {
      tray.setImage(phoneRemoteTrayIconImage());
      tray.setToolTip('桌面工具箱 · 手机已连接');
    } else {
      tray.setImage(trayIconImage());
      tray.setToolTip('桌面工具箱');
    }
  } catch (e) { /* 托盘刷新失败不影响服务 */ }
}

/* ---- 监听地址：本机局域网 IP + Tailscale IP（第二监听地址） ---- */
function phoneRemoteLanIps() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const a of ifs[name] || []) {
        if (a.family === 'IPv4' && !a.internal) out.push(a.address);
      }
    }
  } catch (e) { /* 读不到网卡就只剩回环 */ }
  return [...new Set(out)];
}
let phoneRemoteTailscaleCache = null;
/* Tailscale 检测：未装/未登录/超时一律静默记“未检测到”，绝不崩、
 * 不拦启动；界面提示用户自己装 Tailscale 并登录自己的账号。 */
function phoneRemoteDetectTailscale() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      execFile('tailscale', ['ip', '-4'], { timeout: 5000 }, (err, stdout) => {
        if (err) return finish({ detected: false, ip: '', reason: '未检测到 Tailscale（未安装或未登录）' });
        const ip = String(stdout || '').trim().split(/\s+/)[0] || '';
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return finish({ detected: true, ip, reason: '' });
        finish({ detected: false, ip: '', reason: '未检测到 Tailscale（未登录）' });
      });
      setTimeout(() => finish({ detected: false, ip: '', reason: '检测超时' }), 5500);
    } catch (e) { finish({ detected: false, ip: '', reason: '未检测到 Tailscale' }); }
  });
}

/* ---- HTTPS 服务生命周期 ---- */
let phoneRemoteServers = [];
let phoneRemoteSockets = new Set();
let phoneRemoteRunning = false;
let phoneRemoteListenInfo = { port: 0, addrs: [], tailscale: { detected: false, ip: '' } };
/* 开启：每个监听地址起一个 https 服务（共用同一 handler）。端口
 * 启动时随机高位生成并持久化到 phone-remote.json。监听失败
 * （如端口被占）明确报错、不静默失败；部分地址失败时其余地址
 * 照常监听，并在返回里写明哪个地址失败。 */
async function phoneRemoteStart(opts) {
  opts = opts || {};
  if (phoneRemoteRunning) return { ok: true, already: true, ...phoneRemoteListenInfo };
  const s = phoneRemoteLoad();
  let port = Number(opts.port) || Number(s.port) || 0;
  if (!port || port < 1 || port > 65535) {
    port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    if (!opts.port) { s.port = port; phoneRemoteSave(s); }
  }
  const lan = opts.loopbackOnly ? [] : phoneRemoteLanIps();
  const ts = opts.tailscale === undefined ? await phoneRemoteDetectTailscale() : opts.tailscale;
  phoneRemoteTailscaleCache = ts || { detected: false, ip: '' };
  const addrs = [];
  for (const ip of lan) if (!addrs.includes(ip)) addrs.push(ip);
  if (ts && ts.detected && ts.ip && !addrs.includes(ts.ip)) addrs.push(ts.ip);
  const listenAddrs = [...addrs, '127.0.0.1'];
  const cert = phoneRemoteEnsureCert(listenAddrs);
  const servers = [];
  const errors = [];
  for (const addr of listenAddrs) {
    const srv = https.createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
      phoneRemoteHandle(req, res).catch((e) => { try { phoneRemoteSendJson(res, 500, { ok: false, error: e.message || String(e) }); } catch (e2) { /* 已回过 */ } });
    });
    srv.on('connection', (sock) => { phoneRemoteSockets.add(sock); sock.on('close', () => phoneRemoteSockets.delete(sock)); });
    const ok = await new Promise((resolve) => {
      const onErr = (e) => { errors.push({ addr, error: e.message || String(e) }); resolve(false); };
      srv.once('error', onErr);
      srv.listen(port, addr, () => { srv.removeListener('error', onErr); resolve(true); });
    });
    if (ok) servers.push(srv);
  }
  if (!servers.length) return { ok: false, error: `监听失败：${errors.map((e) => `${e.addr} ${e.error}`).join('；')}` };
  phoneRemoteServers = servers;
  phoneRemoteRunning = true;
  phoneRemoteListenInfo = { port, addrs: listenAddrs, tailscale: phoneRemoteTailscaleCache, partialErrors: errors };
  phoneRemoteRefreshTray();
  return { ok: true, port, addrs: listenAddrs, tailscale: phoneRemoteTailscaleCache, errors };
}
/* 关闭：停掉全部监听、断开在途连接、作废未用的配对码。 */
function phoneRemoteStop() {
  const servers = phoneRemoteServers; phoneRemoteServers = [];
  phoneRemoteRunning = false;
  for (const srv of servers) { try { srv.close(); } catch (e) { /* 已关 */ } }
  for (const sock of [...phoneRemoteSockets]) { try { sock.destroy(); } catch (e) { /* 已断 */ } }
  phoneRemoteSockets.clear();
  try {
    const s = phoneRemoteLoad();
    // 只有待作废的配对码时才落盘：未用过手机远程就不凭空建 phone-remote.json。
    if (s.pair && (s.pair.code || s.pair.token)) {
      s.pair = { code: '', token: '', expiresAt: 0, attempts: 0, lockedUntil: 0 };
      phoneRemoteSave(s);
    }
  } catch (e) { /* 配对码作废失败不影响停止 */ }
  phoneRemoteListenInfo = { port: 0, addrs: [], tailscale: { detected: false, ip: '' } };
  phoneRemoteRefreshTray();
  return { ok: true };
}
async function phoneRemoteApplyEnabled() {
  const cfg = getConfig();
  const enabled = !!(cfg.phoneRemote && cfg.phoneRemote.enabled);
  if (enabled && !phoneRemoteRunning) {
    const r = await phoneRemoteStart();
    if (!r.ok) console.error('手机远程启动失败', r.error);
    return r;
  }
  if (!enabled && phoneRemoteRunning) return phoneRemoteStop();
  return { ok: true, running: phoneRemoteRunning };
}
async function phoneRemoteSetEnabled(enabled) {
  const cfg = getConfig();
  cfg.phoneRemote = { ...(cfg.phoneRemote || {}), enabled: !!enabled };
  saveConfig(cfg);
  if (enabled) return phoneRemoteStart();
  return phoneRemoteStop();
}
/* 设置页状态：配对码与一次性令牌绝不经这里回显，只回是否在配对中。 */
function phoneRemoteStatus() {
  const s = phoneRemoteLoad();
  const cfg = getConfig();
  const cert = phoneRemoteLoadCert();
  return {
    enabled: !!(cfg.phoneRemote && cfg.phoneRemote.enabled),
    running: phoneRemoteRunning,
    port: phoneRemoteRunning ? phoneRemoteListenInfo.port : (s.port || 0),
    addrs: phoneRemoteRunning ? phoneRemoteListenInfo.addrs : phoneRemoteLanIps(),
    tailscale: phoneRemoteTailscaleCache || { detected: false, ip: '', reason: '尚未检测' },
    fingerprint: cert ? cert.fingerprint : '',
    certCreatedAt: cert ? cert.createdAt : 0,
    pairActive: !!(s.pair && s.pair.token && Date.now() < s.pair.expiresAt),
    pairExpiresAt: (s.pair && s.pair.expiresAt) || 0,
    pairLockedUntil: (s.pair && s.pair.lockedUntil) || 0,
    devices: s.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt })),
    dangerous: { ...phoneRemoteDefaultState().dangerous, ...(s.dangerous || {}) },
    logs: (s.logs || []).slice(0, 50),
    onlineCount: phoneRemoteOnlineCount(),
  };
}
/* 允许配对后返回配对码与二维码（局域网地址一张、Tailscale 地址
 * 一张）；二维码内容是一次性配对链接，配对成功后立即作废。 */
function phoneRemoteAllowPairWithQr() {
  const allow = phoneRemoteAllowPair();
  if (!allow.ok) return allow;
  const st = phoneRemoteStatus();
  const lanIp = (st.addrs.find((a) => a !== '127.0.0.1') || '127.0.0.1');
  const port = st.port || phoneRemoteLoad().port || 0;
  const url = `https://${lanIp}:${port}/?pair=${allow.pairToken}`;
  const qr = phoneRemoteQrEncode(url);
  const out = { ...allow, url, qrSvg: qr.ok ? phoneRemoteQrSvg(qr.matrix) : '', qrVersion: qr.ok ? qr.version : 0, urlTs: '', qrSvgTs: '' };
  const tsIp = st.tailscale && st.tailscale.detected ? st.tailscale.ip : '';
  if (tsIp && tsIp !== lanIp) {
    const urlTs = `https://${tsIp}:${port}/?pair=${allow.pairToken}`;
    const qrTs = phoneRemoteQrEncode(urlTs);
    out.urlTs = urlTs;
    out.qrSvgTs = qrTs.ok ? phoneRemoteQrSvg(qrTs.matrix) : '';
  }
  return out;
}

/* ---- 手机 API（HTTPS + JSON，白名单制，全部 /api/v1 前缀） ---- */
function phoneRemoteSendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function phoneRemoteReadBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); try { req.destroy(); } catch (e) { /* 已断 */ } }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function phoneRemoteReadJsonBody(req) {
  const text = await phoneRemoteReadBody(req);
  if (!text) return {};
  try { const v = JSON.parse(text); return (v && typeof v === 'object') ? v : {}; } catch (e) { throw new Error('请求体不是合法 JSON'); }
}
function phoneRemoteMaskCode(code) {
  const c = String(code || '');
  if (!c) return '';
  if (c.length <= 4) return '****';
  return '*'.repeat(c.length - 4) + c.slice(-4);
}
async function phoneRemoteHandle(req, res) {
  try {
    const u = new URL(req.url || '/', 'https://localhost');
    const pathname = u.pathname;
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(phoneRemotePwaHtml());
      return;
    }
    if (req.method === 'GET' && pathname === '/manifest.webmanifest') {
      phoneRemoteSendJson(res, 200, { name: '工具箱远程', short_name: '工具箱远程', description: '桌面工具箱手机远程控制', start_url: '/', display: 'standalone', background_color: '#F8FAFC', theme_color: '#2563EB', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] });
      return;
    }
    if (req.method === 'GET' && pathname === '/icon-192.png') {
      const png = phoneRemoteIconPng();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(png);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/v1/pair') {
      let body;
      try { body = await phoneRemoteReadJsonBody(req); } catch (e) { phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); return; }
      const chk = phoneRemoteCheckPair(body.code, body.pairToken);
      if (!chk.ok) { phoneRemoteSendJson(res, 403, { ok: false, error: chk.error, lockedUntil: chk.lockedUntil || 0 }); return; }
      const issued = phoneRemoteIssueDeviceToken(chk.state, body.name || '手机');
      phoneRemoteLog(chk.state, issued.device.name, '配对', true, '新手机配对成功');
      phoneRemoteSave(chk.state);
      phoneRemoteSendJson(res, 200, { ok: true, token: issued.token, deviceId: issued.device.id });
      return;
    }
    if (!pathname.startsWith('/api/v1/')) { phoneRemoteSendJson(res, 404, { ok: false, error: '不存在的接口' }); return; }
    const auth = phoneRemoteAuth(req.headers);
    if (!auth.ok) { phoneRemoteSendJson(res, auth.status || 401, { ok: false, error: auth.error }); return; }
    const device = auth.device;
    const state = auth.state;
    const log = (op, ok, detail) => { try { phoneRemoteLog(state, device.name, op, ok, detail); phoneRemoteSave(state); } catch (e) { /* 日志写失败不影响接口 */ } };
    try {
      if (req.method === 'GET' && pathname === '/api/v1/status') {
        const mon = monitorStatus();
        const cfg = getConfig();
        const out = { ok: true, platform: mon.platform, hostname: mon.hostname, memUsed: mon.memUsed, memTotal: mon.memTotal, agents: mon.agents, chats: mon.chats, messages: mon.messages, proxyMode: cfg.proxyMode || 'direct', sniffEnabled: cfg.sniffEnabled === true, onlinePhones: phoneRemoteOnlineCount(), uptimeSec: mon.uptimeSec };
        log('查看状态', true, '');
        phoneRemoteSendJson(res, 200, out);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/v1/agents') {
        // 照 agents-list 的脱敏映射：密钥与网页登录态绝不返回。
        const list = getAgents().map((a) => ({
          id: a.id, name: a.name, provider: a.provider || '', model: a.model || '',
          connectionType: a.connectionType || 'api', webSite: a.webSite || '',
          hasKey: !!a.apiKey, hasWebToken: !!a.webToken, webStatus: a.webStatus || '',
        }));
        log('查看智能体', true, '');
        phoneRemoteSendJson(res, 200, { ok: true, agents: list });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/v1/chat') {
        let body;
        try { body = await phoneRemoteReadJsonBody(req); } catch (e) { phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); return; }
        const agentId = String(body.agentId || '');
        const content = String(body.content || '').trim();
        const agent = getAgents().find((a) => a.id === agentId);
        if (!agent) { log('发对话', false, '智能体不存在'); phoneRemoteSendJson(res, 400, { ok: false, error: '智能体不存在' }); return; }
        if (!content) { phoneRemoteSendJson(res, 400, { ok: false, error: '先输入要说的话' }); return; }
        const chats = getAgentChats();
        const chat = { id: localId(), agentId, title: '新对话', messages: [], updatedAt: Date.now() };
        chats.push(chat);
        writeJsonFile('agent-chats.json', chats);
        const r = await agentChatSend(chat.id, content);
        if (!r.ok) { log('发对话', false, r.error || ''); phoneRemoteSendJson(res, 400, { ok: false, error: r.error || '发送失败' }); return; }
        const finalChat = getAgentChats().find((c) => c.id === chat.id) || r.chat;
        const msgs = (finalChat && finalChat.messages) || [];
        const reply = [...msgs].reverse().find((m) => m.role === 'assistant');
        log('发对话', true, agent.name || '');
        phoneRemoteSendJson(res, 200, { ok: true, chatId: chat.id, reply: (reply && reply.content) || '' });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/v1/chats') {
        const list = getAgentChats()
          .map((c) => ({ id: c.id, title: c.title || '新对话', updatedAt: c.updatedAt || 0, agentName: (getAgents().find((a) => a.id === c.agentId) || {}).name || '' }))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
        log('查看对话', true, '');
        phoneRemoteSendJson(res, 200, { ok: true, chats: list });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/v1/apps') {
        const seen = new Set();
        const list = [];
        const push = (key, name, found) => { if (!key || seen.has(key)) return; seen.add(key); list.push({ key, name, found: !!found }); };
        for (const a of toolboxAppsStatus()) push(a.key, a.name, a.found);
        push('chromium', '浏览器（内嵌）', true);
        push('vlc', 'VLC 播放器', vlcStatus().found);
        log('查看软件', true, '');
        phoneRemoteSendJson(res, 200, { ok: true, apps: list });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/v1/sniff') {
        const r = sniffHistoryListEntries();
        const entries = ((r && r.entries) || []).slice(0, 20).map((e) => ({ id: e.id, kind: 'sniff', host: e.host || '', at: e.at || 0, count: e.count || 0 }));
        log('查看嗅探', true, '');
        phoneRemoteSendJson(res, 200, { ok: true, entries });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/v1/register') {
        // 验证码只显示后 4 位，其余打码；绝不返回完整令牌。
        const list = readJsonList('register-records.json').slice(0, 10).map((x) => ({ id: x.id, kind: x.kind || '', target: x.target || '', code: phoneRemoteMaskCode(x.code), at: x.at || 0 }));
        log('查看验证码', true, '');
        phoneRemoteSendJson(res, 200, { ok: true, records: list });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/v1/open-app') {
        let body;
        try { body = await phoneRemoteReadJsonBody(req); } catch (e) { phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); return; }
        const r = toolboxOpenApp(String(body.key || ''));
        log('打开软件', r.ok !== false, String(body.key || ''));
        phoneRemoteSendJson(res, r.ok === false ? 400 : 200, r);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/v1/browser-open') {
        let body;
        try { body = await phoneRemoteReadJsonBody(req); } catch (e) { phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); return; }
        const url = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(url)) { phoneRemoteSendJson(res, 400, { ok: false, error: '只允许打开 http/https 网址' }); return; }
        const r = openWithDefaultBrowser(url);
        log('打开浏览器', r.ok !== false, url.slice(0, 80));
        phoneRemoteSendJson(res, 200, r);
        return;
      }
      if (req.method === 'POST' && pathname.startsWith('/api/v1/dangerous/')) {
        const key = pathname.slice('/api/v1/dangerous/'.length);
        let body = {};
        try { body = await phoneRemoteReadJsonBody(req); } catch (e) { phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); return; }
        const gate = phoneRemoteDangerousCheck(key, body);
        if (!gate.ok) { log(`高危：${PHONE_REMOTE_DANGEROUS_LABELS[key] || key}`, false, gate.error); phoneRemoteSendJson(res, gate.status || 403, { ok: false, error: gate.error }); return; }
        if (key === 'deleteFile') {
          const p = String(body.path || '').trim();
          if (!p) { phoneRemoteSendJson(res, 400, { ok: false, error: '先给文件路径' }); return; }
          try { await shell.trashItem(p); log('高危：删文件', true, p.slice(0, 120)); phoneRemoteSendJson(res, 200, { ok: true }); } catch (e) { log('高危：删文件', false, e.message || String(e)); phoneRemoteSendJson(res, 400, { ok: false, error: e.message || String(e) }); }
          return;
        }
        if (key === 'uninstall') {
          const r = await toolboxUninstallApp(String(body.key || ''));
          log('高危：卸载软件', r.ok !== false, String(body.key || ''));
          phoneRemoteSendJson(res, r.ok === false ? 400 : 200, r);
          return;
        }
        if (key === 'publish') {
          const r = await publishNewVersion({});
          log('高危：发版推库', r && r.ok !== false, '');
          phoneRemoteSendJson(res, 200, r || { ok: true });
          return;
        }
        if (key === 'proxy') {
          const mode = String(body.mode || '');
          if (!['direct', 'manual', 'smart', 'global'].includes(mode)) { phoneRemoteSendJson(res, 400, { ok: false, error: '代理模式只能是 direct/manual/smart/global' }); return; }
          saveConfig({ ...getConfig(), proxyMode: mode });
          log('高危：改代理模式', true, mode);
          phoneRemoteSendJson(res, 200, { ok: true, proxyMode: mode });
          return;
        }
        if (key === 'tokenManage') {
          const r = phoneRemoteRevokeDevice(String(body.deviceId || ''));
          log('高危：管理配对令牌', r.ok, String(body.deviceId || ''));
          phoneRemoteSendJson(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { ok: false, error: '找不到这台手机' });
          return;
        }
        phoneRemoteSendJson(res, 404, { ok: false, error: '未知的高危操作' });
        return;
      }
      phoneRemoteSendJson(res, 404, { ok: false, error: '不存在的接口' });
    } finally {
      phoneRemoteRefreshTray();
    }
  } catch (e) {
    try { phoneRemoteSendJson(res, 500, { ok: false, error: e.message || String(e) }); } catch (e2) { /* 连接已断 */ }
  }
}
/* 自测与 PWA 图标共用：本机 HTTPS 请求（自签证书，校验关掉）。 */
function phoneRemoteHttpsJson(urlStr, method, bodyObj, token) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const payload = bodyObj == null ? null : JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      rejectUnauthorized: false,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d.toString(); });
      res.on('end', () => { let data = null; try { data = JSON.parse(b); } catch (e) { /* 非 JSON */ } resolve({ status: res.statusCode, body: data, text: b }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message || String(e) }));
    req.setTimeout(5000, () => { req.destroy(new Error('请求超时')); });
    if (payload) req.end(payload); else req.end();
  });
}
let phoneRemoteIconCache = null;
function phoneRemoteIconPng() {
  if (phoneRemoteIconCache) return phoneRemoteIconCache;
  phoneRemoteIconCache = phoneRemoteMakePng(192, 192, (x, y) => {
    const dx = x - 96, dy = y - 96;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 52) return [255, 255, 255, 255];
    return [37, 99, 235, 255];
  });
  return phoneRemoteIconCache;
}

/* ---- 手机端 PWA（单列、大按钮、精简版；样式用 .pr- 前缀，
 * 不污染桌面样式；设计规范见任务书第 6 项：内容驱动容器、
 * 8pt 间距、60-30-10 配色、1px 低对比边框、字阶与线性图标） ---- */
function phoneRemotePwaHtml() {
  return '<!DOCTYPE html>\n'
    + '<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<meta name="theme-color" content="#2563EB">\n<title>工具箱远程</title>\n'
    + '<link rel="manifest" href="/manifest.webmanifest">\n'
    + '<style>\n'
    + '*{box-sizing:border-box}\n'
    + 'body{margin:0;background:#F8FAFC;color:#1E293B;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}\n'
    + '@media (prefers-color-scheme:dark){body{background:#09090B;color:#F4F4F5}}\n'
    + '.pr-wrap{max-width:480px;margin:0 auto;padding:16px 16px 32px}\n'
    + '.pr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 4px}\n'
    + '.pr-head h1{font-size:20px;font-weight:600;margin:0}\n'
    + '.pr-pill{font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid rgba(0,0,0,.12);color:#64748B;white-space:nowrap}\n'
    + '.pr-pill.on{color:#047857;border-color:rgba(4,120,87,.3)}\n'
    + '.pr-hint{font-size:13px;color:#64748B;margin:0 0 16px}\n'
    + '.pr-card{background:#FFFFFF;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:16px;margin-bottom:16px}\n'
    + '@media (prefers-color-scheme:dark){.pr-card{background:#18181B;border-color:rgba(255,255,255,.08)}.pr-pill{border-color:rgba(255,255,255,.14);color:#A1A1AA}.pr-hint{color:#A1A1AA}.pr-field input,.pr-field select,.pr-field textarea{background:#18181B;border-color:rgba(255,255,255,.14)}.pr-btn{background:#18181B;border-color:rgba(255,255,255,.14);color:#F4F4F5}.pr-reply{background:#09090B}}\n'
    + '.pr-card h2{font-size:16px;font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}\n'
    + '.pr-card h2 svg{flex:none;color:#64748B}\n'
    + '.pr-sub{font-size:13px;color:#64748B;margin:0 0 12px}\n'
    + '.pr-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;font-size:13px;color:#475569}\n'
    + '.pr-field input,.pr-field select,.pr-field textarea{width:100%;max-width:480px;padding:8px 10px;border:1px solid rgba(0,0,0,.12);border-radius:8px;font:inherit;background:#fff;color:inherit}\n'
    + '.pr-field input:focus,.pr-field select:focus,.pr-field textarea:focus{outline:2px solid #2563EB;outline-offset:1px}\n'
    + '.pr-chat-row{display:flex;gap:8px;align-items:flex-start}\n'
    + '.pr-chat-row textarea{flex:1;min-height:44px;resize:vertical}\n'
    + '.pr-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;border:1px solid rgba(0,0,0,.12);background:#fff;color:#1E293B;font:inherit;cursor:pointer;white-space:nowrap}\n'
    + '.pr-btn:hover{background:#F1F5F9}\n'
    + '.pr-btn:focus-visible{outline:2px solid #2563EB;outline-offset:1px}\n'
    + '.pr-btn-primary{background:#2563EB;border-color:#2563EB;color:#fff}\n'
    + '.pr-btn-primary:hover{background:#1D4ED8}\n'
    + '.pr-btn:disabled{opacity:.5;cursor:default}\n'
    + '.pr-btn-grid{display:flex;flex-wrap:wrap;gap:8px}\n'
    + '.pr-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid rgba(0,0,0,.06);font-size:14px}\n'
    + '.pr-row:first-of-type{border-top:0}\n'
    + '.pr-row .k{color:#64748B}\n'
    + '.pr-num{font-variant-numeric:tabular-nums}\n'
    + '.pr-msg{font-size:13px;color:#DC2626;min-height:18px;margin:8px 0 0}\n'
    + '.pr-msg.pr-ok{color:#047857}\n'
    + '.pr-empty{font-size:13px;color:#94A3B8;padding:8px 0}\n'
    + '.pr-reply{white-space:pre-wrap;background:#F8FAFC;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:12px;margin-top:12px;font-size:14px}\n'
    + '.pr-foot{margin-top:24px;text-align:center}\n'
    + '.pr-link{background:none;border:0;color:#64748B;font-size:13px;text-decoration:underline;cursor:pointer;padding:4px 8px}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="pr-wrap">\n'
    + '<header class="pr-head"><h1>工具箱远程</h1><span class="pr-pill" id="pr-conn">未连接</span></header>\n'
    + '<p class="pr-hint">手机远程控制电脑上的桌面工具箱。令牌只存在本机浏览器里，可随时在电脑端吊销。</p>\n'
    + '<section class="pr-card" id="pr-pair-card" hidden>\n'
    + '<h2>配对</h2>\n'
    + '<p class="pr-sub">在电脑上点「允许配对」，把 6 位配对码填在这里。首次打开如浏览器提示证书不安全，请先在电脑端核对证书指纹后再继续。</p>\n'
    + '<label class="pr-field"><span>一次性配对令牌</span><input id="pr-pair-token" placeholder="扫码后自动填入" autocomplete="off"></label>\n'
    + '<label class="pr-field"><span>配对码</span><input id="pr-code" inputmode="numeric" maxlength="6" placeholder="6 位数字" autocomplete="off"></label>\n'
    + '<label class="pr-field"><span>手机名</span><input id="pr-name" maxlength="40" placeholder="例如：我的手机"></label>\n'
    + '<button class="pr-btn pr-btn-primary" id="pr-pair-btn" type="button">配对</button>\n'
    + '<p class="pr-msg" id="pr-pair-msg"></p>\n'
    + '</section>\n'
    + '<div id="pr-main" hidden>\n'
    + '<section class="pr-card"><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>状态</h2><div id="pr-status"><p class="pr-empty">加载中…</p></div><div style="margin-top:12px"><button class="pr-btn" id="pr-refresh-btn" type="button">刷新</button></div></section>\n'
    + '<section class="pr-card"><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>发对话</h2>'
    + '<label class="pr-field"><span>智能体</span><select id="pr-agent"></select></label>'
    + '<div class="pr-chat-row"><textarea id="pr-input" placeholder="输入要说的话…" aria-label="对话内容"></textarea><button class="pr-btn pr-btn-primary" id="pr-send-btn" type="button">发送</button></div>'
    + '<p class="pr-msg" id="pr-chat-msg"></p><div class="pr-reply" id="pr-reply" hidden></div></section>\n'
    + '<section class="pr-card"><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>打开软件 / 浏览器</h2><div class="pr-btn-grid" id="pr-apps"><p class="pr-empty">加载中…</p></div>'
    + '<label class="pr-field" style="margin-top:12px"><span>网址</span><input id="pr-url" placeholder="https://…" inputmode="url"></label>'
    + '<button class="pr-btn" id="pr-browser-btn" type="button">在工具箱里打开</button><p class="pr-msg" id="pr-app-msg"></p></section>\n'
    + '<section class="pr-card"><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>今日嗅探摘要</h2><div id="pr-sniff"><p class="pr-empty">加载中…</p></div></section>\n'
    + '<section class="pr-card"><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6L22 7"/></svg>待收验证码</h2><div id="pr-register"><p class="pr-empty">加载中…</p></div></section>\n'
    + '</div>\n'
    + '<div class="pr-foot"><button class="pr-link" id="pr-disconnect-btn" type="button">断开本机（清除令牌）</button></div>\n'
    + '</div>\n'
    + '<script>\n'
    + '(function(){\n'
    + 'var token = localStorage.getItem("pr-token") || "";\n'
    + 'var pairToken = "";\n'
    + 'try { var mm = location.search.match(/[?&]pair=([0-9a-f]+)/); if (mm) pairToken = mm[1]; } catch (e) {}\n'
    + 'function $(id){ return document.getElementById(id); }\n'
    + 'function show(el, on){ if (el) el.hidden = !on; }\n'
    + 'function esc(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }\n'
    + 'function fmtTime(t){ if (!t) return "—"; try { return new Date(t).toLocaleString(); } catch (e) { return String(t); } }\n'
    + 'function setMsg(id, text, ok){ var el = $(id); if (el) { el.textContent = text || ""; el.className = "pr-msg" + (ok ? " pr-ok" : ""); } }\n'
    + 'function api(path, method, body){\n'
    + '  var headers = {"Content-Type": "application/json"};\n'
    + '  if (token) headers["Authorization"] = "Bearer " + token;\n'
    + '  return fetch(path, { method: method || "GET", headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function(res){\n'
    + '    return res.json().then(function(data){ return { status: res.status, data: data }; }).catch(function(){ return { status: res.status, data: null }; });\n'
    + '  });\n'
    + '}\n'
    + 'function needAuth(){\n'
    + '  token = "";\n'
    + '  try { localStorage.removeItem("pr-token"); } catch (e) {}\n'
    + '  show($("pr-main"), false);\n'
    + '  show($("pr-pair-card"), true);\n'
    + '  var pill = $("pr-conn"); if (pill) { pill.textContent = "未连接"; pill.className = "pr-pill"; }\n'
    + '}\n'
    + 'function renderStatus(s){\n'
    + '  var box = $("pr-status"); if (!box) return;\n'
    + '  var rows = [["电脑", esc(s.hostname || "—")], ["系统", esc(s.platform || "—")], ["智能体", "<span class=\\"pr-num\\">" + (s.agents || 0) + "</span> 个"], ["对话", "<span class=\\"pr-num\\">" + (s.chats || 0) + "</span> 个 · <span class=\\"pr-num\\">" + (s.messages || 0) + "</span> 条消息"], ["代理模式", esc(s.proxyMode || "direct")], ["嗅探", s.sniffEnabled ? "开" : "关"], ["在线手机", "<span class=\\"pr-num\\">" + (s.onlinePhones || 0) + "</span> 台"]];\n'
    + '  var html = "";\n'
    + '  for (var i = 0; i < rows.length; i++) html += "<div class=\\"pr-row\\"><span class=\\"k\\">" + rows[i][0] + "</span><span>" + rows[i][1] + "</span></div>";\n'
    + '  box.innerHTML = html;\n'
    + '}\n'
    + 'function renderApps(list){\n'
    + '  var box = $("pr-apps"); if (!box) return;\n'
    + '  box.innerHTML = "";\n'
    + '  if (!list || !list.length) { box.innerHTML = "<p class=\\"pr-empty\\">暂无可打开的软件。</p>"; return; }\n'
    + '  list.forEach(function(a){\n'
    + '    var b = document.createElement("button");\n'
    + '    b.type = "button"; b.className = "pr-btn"; b.textContent = a.name || a.key;\n'
    + '    b.disabled = !a.found;\n'
    + '    b.addEventListener("click", function(){\n'
    + '      b.disabled = true; setMsg("pr-app-msg", "打开中…", true);\n'
    + '      api("/api/v1/open-app", "POST", { key: a.key }).then(function(r){\n'
    + '        b.disabled = false;\n'
    + '        if (r.status === 200 && r.data && r.data.ok) setMsg("pr-app-msg", "已打开：" + (a.name || a.key), true);\n'
    + '        else setMsg("pr-app-msg", (r.data && r.data.error) || "打开失败");\n'
    + '      });\n'
    + '    });\n'
    + '    box.appendChild(b);\n'
    + '  });\n'
    + '}\n'
    + 'function renderList(boxId, items, emptyText, rowFn){\n'
    + '  var box = $(boxId); if (!box) return;\n'
    + '  if (!items || !items.length) { box.innerHTML = "<p class=\\"pr-empty\\">" + emptyText + "</p>"; return; }\n'
    + '  var html = "";\n'
    + '  items.forEach(function(it){ html += rowFn(it); });\n'
    + '  box.innerHTML = html;\n'
    + '}\n'
    + 'function loadAll(){\n'
    + '  return api("/api/v1/status").then(function(r){\n'
    + '    if (r.status === 401 || r.status === 403) { needAuth(); return; }\n'
    + '    if (!r.data || !r.data.ok) { setMsg("pr-pair-msg", (r.data && r.data.error) || "状态加载失败"); return; }\n'
    + '    var pill = $("pr-conn"); if (pill) { pill.textContent = "已连接"; pill.className = "pr-pill on"; }\n'
    + '    show($("pr-pair-card"), false);\n'
    + '    show($("pr-main"), true);\n'
    + '    renderStatus(r.data);\n'
    + '    api("/api/v1/agents").then(function(ra){\n'
    + '      var sel = $("pr-agent"); if (!sel) return;\n'
    + '      sel.innerHTML = "";\n'
    + '      var agents = (ra.data && ra.data.agents) || [];\n'
    + '      if (!agents.length) { var o = document.createElement("option"); o.textContent = "暂无智能体（先在电脑端添加）"; sel.appendChild(o); return; }\n'
    + '      agents.forEach(function(a){ var o = document.createElement("option"); o.value = a.id; o.textContent = a.name; sel.appendChild(o); });\n'
    + '    });\n'
    + '    api("/api/v1/apps").then(function(ra){ renderApps((ra.data && ra.data.apps) || []); });\n'
    + '    api("/api/v1/sniff").then(function(ra){\n'
    + '      renderList("pr-sniff", (ra.data && ra.data.entries) || [], "今天还没有嗅探记录。", function(e){\n'
    + '        return "<div class=\\"pr-row\\"><span>" + esc(e.host || "—") + "</span><span class=\\"pr-num\\">" + (e.count || 0) + " 条 · " + esc(fmtTime(e.at)) + "</span></div>";\n'
    + '      });\n'
    + '    });\n'
    + '    api("/api/v1/register").then(function(ra){\n'
    + '      renderList("pr-register", (ra.data && ra.data.records) || [], "暂无待收验证码。", function(e){\n'
    + '        return "<div class=\\"pr-row\\"><span>" + esc(e.kind || "") + " · " + esc(e.target || "") + "</span><span class=\\"pr-num\\">" + esc(e.code || "") + "</span></div>";\n'
    + '      });\n'
    + '    });\n'
    + '  });\n'
    + '}\n'
    + 'var pairBtn = $("pr-pair-btn");\n'
    + 'if (pairBtn) pairBtn.addEventListener("click", function(){\n'
    + '  var pt = ($("pr-pair-token").value || "").trim();\n'
    + '  var code = ($("pr-code").value || "").trim();\n'
    + '  var name = ($("pr-name").value || "").trim() || "手机";\n'
    + '  if (!pt) { setMsg("pr-pair-msg", "先扫码（配对令牌会自动填入）或手动输入一次性配对令牌"); return; }\n'
    + '  if (!/^\\d{6}$/.test(code)) { setMsg("pr-pair-msg", "配对码是 6 位数字"); return; }\n'
    + '  pairBtn.disabled = true; setMsg("pr-pair-msg", "配对中…", true);\n'
    + '  api("/api/v1/pair", "POST", { pairToken: pt, code: code, name: name }).then(function(r){\n'
    + '    pairBtn.disabled = false;\n'
    + '    if (r.status === 200 && r.data && r.data.token) {\n'
    + '      token = r.data.token;\n'
    + '      try { localStorage.setItem("pr-token", token); } catch (e) {}\n'
    + '      setMsg("pr-pair-msg", "配对成功", true);\n'
    + '      loadAll();\n'
    + '    } else {\n'
    + '      setMsg("pr-pair-msg", (r.data && r.data.error) || "配对失败");\n'
    + '    }\n'
    + '  });\n'
    + '});\n'
    + 'var sendBtn = $("pr-send-btn");\n'
    + 'if (sendBtn) sendBtn.addEventListener("click", function(){\n'
    + '  var agentId = $("pr-agent").value || "";\n'
    + '  var content = ($("pr-input").value || "").trim();\n'
    + '  if (!agentId) { setMsg("pr-chat-msg", "先选一个智能体"); return; }\n'
    + '  if (!content) { setMsg("pr-chat-msg", "先输入要说的话"); return; }\n'
    + '  sendBtn.disabled = true; setMsg("pr-chat-msg", "发送中…", true);\n'
    + '  var replyBox = $("pr-reply"); if (replyBox) { replyBox.hidden = true; replyBox.textContent = ""; }\n'
    + '  api("/api/v1/chat", "POST", { agentId: agentId, content: content }).then(function(r){\n'
    + '    sendBtn.disabled = false;\n'
    + '    if (r.status === 200 && r.data && r.data.ok) {\n'
    + '      setMsg("pr-chat-msg", "", true);\n'
    + '      if (replyBox) { replyBox.textContent = r.data.reply || "（智能体没有回复内容）"; replyBox.hidden = false; }\n'
    + '      $("pr-input").value = "";\n'
    + '    } else if (r.status === 401 || r.status === 403) { needAuth(); }\n'
    + '    else setMsg("pr-chat-msg", (r.data && r.data.error) || "发送失败");\n'
    + '  });\n'
    + '});\n'
    + 'var browserBtn = $("pr-browser-btn");\n'
    + 'if (browserBtn) browserBtn.addEventListener("click", function(){\n'
    + '  var url = ($("pr-url").value || "").trim();\n'
    + '  if (!/^https?:\\/\\//i.test(url)) { setMsg("pr-app-msg", "请输入 http/https 网址"); return; }\n'
    + '  browserBtn.disabled = true;\n'
    + '  api("/api/v1/browser-open", "POST", { url: url }).then(function(r){\n'
    + '    browserBtn.disabled = false;\n'
    + '    if (r.status === 200 && r.data && r.data.ok) setMsg("pr-app-msg", "已在工具箱里打开", true);\n'
    + '    else setMsg("pr-app-msg", (r.data && r.data.error) || "打开失败");\n'
    + '  });\n'
    + '});\n'
    + 'var refreshBtn = $("pr-refresh-btn");\n'
    + 'if (refreshBtn) refreshBtn.addEventListener("click", function(){ loadAll(); });\n'
    + 'var dcBtn = $("pr-disconnect-btn");\n'
    + 'if (dcBtn) dcBtn.addEventListener("click", function(){ needAuth(); setMsg("pr-pair-msg", "已断开本机，令牌已清除", true); });\n'
    + 'if (pairToken) { var pt = $("pr-pair-token"); if (pt) pt.value = pairToken; show($("pr-pair-card"), true); }\n'
    + 'if (token) { loadAll(); } else if (!pairToken) { show($("pr-pair-card"), true); }\n'
    + '})();\n'
    + '</script>\n</body>\n</html>\n';
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle('get-overview', () => ({
    version: DISPLAY_VERSION,
    platform: process.platform,
    winget: wingetAvailable(),
    vlc: vlcStatus(),
    // 2026-11-28-2：便携版 Chromium 已删除；内嵌浏览器常驻可用。
    browser: { found: true, embedded: true, note: '内嵌浏览器 · 点开即用' },
    githubHasToken: !!getConfig().githubToken,
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
  // 2026-11-27-2：视频引擎的干净列表（不含 winget 行），自测的引擎出口。
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
    const rows = parseWingetTable(r.out);
    // 2026-11-28-12：可更新只检测工具箱内安装的东西——按台账的
    // wingetId 过滤，系统里用户自己装的软件即使有更新也不列出。
    const ids = new Set(loadToolboxApps().map((a) => String(a.wingetId || '').toLowerCase()).filter(Boolean));
    return { available: true, rows: rows.filter((x) => ids.has(String(x.id || '').toLowerCase())), error: r.code === 0 ? '' : (r.err || r.out).slice(-300) };
  });
  ipcMain.handle('winget-install', (_e, id, meta) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    const m = (meta && typeof meta === 'object') ? meta : {};
    const recordApp = { key: String(m.key || `winget:${id}`), name: String(m.name || id), kind: String(m.kind || ''), wingetId: String(id), exe: '', installLocation: '' };
    // 2026-11-28-9，第 6 项：微软商店源的包（Microsoft To Do）必须带
    // --source msstore，否则社区源里找不到这个 ID。
    const args = ['install', '--id', String(id), '-e', '--accept-package-agreements', '--accept-source-agreements'];
    if (String(m.source || '') === 'msstore') args.push('--source', 'msstore');
    return { ok: true, ...runWingetJob(`安装 ${id}`, args, { recordApp }) };
  });
  // 2026-11-28-12：工具箱内安装的软件（台账 + 便携版 + 视频引擎），
  // 供已安装页与软件页共用；打开 / 卸载走下面两个口子。
  ipcMain.handle('toolbox-apps-list', async () => {
    const rows = toolboxAppsStatus();
    try { for (const eng of await listVideoEngines()) rows.push({ key: `engine:${eng.id}`, name: eng.name, kind: 'video-engine', source: 'video-engine', wingetId: '', found: true, path: eng.path || '', version: eng.version || '', note: '视频下载引擎 · 工具箱组件' }); } catch (e) { /* 引擎扫描失败不拦列表 */ }
    return { ok: true, rows };
  });
  ipcMain.handle('toolbox-apps-open', (_e, key) => toolboxOpenApp(String(key || '')));
  ipcMain.handle('toolbox-apps-uninstall', async (_e, key) => toolboxUninstallApp(String(key || '')));
  ipcMain.handle('toolbox-apps-remove', (_e, key) => { removeToolboxApp(String(key || '')); return { ok: true }; });
  ipcMain.handle('installed-open-dir', (_e, id) => installedOpenDir(String(id || '')));
  ipcMain.handle('installed-move-to-tools', (_e, id) => installedMoveToTools(String(id || '')));
  // 2026-11-26-7：应用官方图标（渲染层接线随后做，见 main.js 图标段）
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

  // 2026-11-28-2：便携版 Chromium 已删除，browser-status /
  // browser-download / chromium-* 三组 IPC 已移除；内嵌浏览器
  // 不需要下载，浏览器页也不再有设置/扩展页。
  ipcMain.handle('browser-launch', () => launchBrowser());

  /* ---- v1.4.0：应用列表、默认应用、界面内设置 ---- */
  ipcMain.handle('player-apps', () => playerAppsStatus());
  ipcMain.handle('browser-apps', () => browserAppsStatus());
  ipcMain.handle('launch-player', (_e, kind, target) => launchPlayerApp(String(kind || 'vlc'), target ? String(target) : ''));
  ipcMain.handle('launch-browser-app', (_e, kind, url) => openWithDefaultBrowser(url ? String(url) : '', String(kind || 'chromium')));
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
  ipcMain.handle('vlc-play', (_e, target) => playWithDefaultPlayer(String(target || '')));
  ipcMain.handle('browser-open-url', (_e, kind, url) => {
    // 2026-11-28-12：不分 kind，一律走内嵌 webview（kind 决定分区）。
    sendToRenderer('embedded-browser-open', { url: String(url || ''), kind: String(kind || 'chromium') });
    return { ok: true, embedded: true };
  });
  ipcMain.handle('vlc-get-prefs', () => readVlcPrefs());
  ipcMain.handle('vlc-set-prefs', (_e, patch) => { try { return { ok: true, prefs: writeVlcPrefs(patch || {}) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } });


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
  // 2026-11-27-4：自选本机文件更新（方案 3.1 节）——选 zip 包，
  // 校验后只替换白名单内的变化文件；降级需 B 路确认后带
  // {file, confirmDowngrade:true} 再调一次（不用重新选文件）。
  ipcMain.handle('update-from-local-file', async (_e, opts) => {
    const o = opts || {};
    let file = String(o.file || '');
    if (!file) {
      const picked = await dialog.showOpenDialog(mainWin, {
        title: '选择更新包',
        filters: [{ name: '更新包', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      file = picked.filePaths[0];
    }
    return applyLocalUpdate(file, o);
  });
  // 2026-11-27-4：一键发布本地版本到仓库（方案 3.2 节）。
  ipcMain.handle('publish-status', async () => publishStatus());
  ipcMain.handle('publish-local', async () => publishLocal());
  // 2026-11-27-11：一键发布新版本（版本 +1 后 git 提交推送；见 publishNewVersion）。
  ipcMain.handle('publish-new-version', async (_e, opts) => publishNewVersion(opts || {}));
  // 2026-11-27-11：数据嗅探登录态——读当前站点的 cookie（只回给渲染层
  // 内存展示，不落盘、不写日志；值由渲染层打码显示）。
  ipcMain.handle('sniff-auth-cookies', async (_e, url, partition) => sniffAuthCookies(String(url || ''), String(partition || '')));
  // 2026-11-27-11：请求日志详情（点一条时才取完整请求头响应头）与
  // 嗅探历史（本机落盘，令牌打码后保存）。
  ipcMain.handle('sniff-req-detail', async (_e, id) => {
    const hit = sniffReqDetails.get(String(id || ''));
    if (!hit) return { ok: false, error: '这条请求已不在记录里' };
    return { ok: true, reqHeaders: hit.reqHeaders || {}, resHeaders: hit.resHeaders || {}, reqBody: hit.reqBody || '', timings: hit.timings || { wait: 0, receive: 0, total: 0 } };
  });
  ipcMain.handle('sniff-history-save', async (_e, entry) => sniffHistorySaveEntry(entry || {}));
  ipcMain.handle('sniff-history-list', async () => sniffHistoryListEntries());
  ipcMain.handle('sniff-history-get', async (_e, id) => sniffHistoryGetEntry(id));
  ipcMain.handle('sniff-history-delete', async (_e, id) => sniffHistoryDeleteEntry(id));
  // 2026-11-28-9，第 3 项：嗅探其他软件——本地代理开关/域名过滤/
  // 系统代理模式/嗅探启动；请求日志导出 HAR/JSON（只写本机文件）。
  ipcMain.handle('sniff-proxy-status', () => sniffProxyStatus());
  ipcMain.handle('sniff-proxy-set', async (_e, opts) => {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const domains = Array.isArray(o.domains) ? o.domains.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim().slice(0, 128)) : [];
    sniffProxyState.domains = domains;
    let r;
    if (o.enabled === true) { r = await startSniffProxy(); }
    else { r = await stopSniffProxy(); }
    if (r && r.ok) saveConfig({ ...getConfig(), sniffProxyEnabled: o.enabled === true, sniffProxyDomains: domains });
    return { ok: !!(r && r.ok), ...(r || {}), ...sniffProxyStatus() };
  });
  ipcMain.handle('sniff-proxy-system', async (_e, enabled) => {
    const r = await setSniffProxySystem(enabled === true);
    return { ok: !!(r && r.ok), error: (r && r.error) || '', ...sniffProxyStatus() };
  });
  ipcMain.handle('sniff-proxy-launch', async (_e, key) => sniffProxyLaunchApp(String(key || '')));
  /* 2026-11-28-9，补充 1：内嵌浏览器快捷键——webview 聚焦时加速键到不了
   * 主进程（before-input-event 只在 embedder 上挂收不到 guest 的键），
   * 所以渲染层每次建 webview 都把 guest 的 webContentsId 发上来，主进程
   * 直接在 guest 的 webContents 上挂 before-input-event；能直接做的
   * （刷新/前进后退/DevTools）在主进程做，需要改渲染层 UI 的（聚焦地址栏、
   * 查找、新建/关闭/切换页签、关查找）经 browser-shortcut 事件发回渲染层。
   * 不用 globalShortcut（会全系统劫持）；Ctrl+Alt+T 是屏幕翻译的全局
   * 快捷键，不在拦截列表里，不冲突。 */
  ipcMain.handle('browser-webview-ready', (_e, guestId) => attachBrowserGuestShortcuts(guestId));
  ipcMain.handle('sniff-export', async (_e, opts) => {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const format = o.format === 'har' ? 'har' : 'json';
    const entries = Array.isArray(o.entries) ? o.entries : [];
    const picked = await dialog.showSaveDialog(mainWin, {
      title: format === 'har' ? '导出 HAR' : '导出 JSON',
      defaultPath: path.join(getConfig().downloadDir || app.getPath('downloads'), format === 'har' ? 'sniff-requests.har' : 'sniff-requests.json'),
      filters: format === 'har' ? [{ name: 'HAR', extensions: ['har'] }] : [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    let text;
    if (format === 'har') {
      const harEntries = entries.map((e) => ({
        startedDateTime: new Date(Number(e.at || Date.now())).toISOString(),
        time: Number(e.durationMs || 0),
        request: { method: String(e.method || 'GET'), url: String(e.url || ''), httpVersion: 'HTTP/1.1', headers: Object.entries(e.reqHeaders || {}).map(([name, value]) => ({ name, value: String(Array.isArray(value) ? value.join(', ') : value ?? '') })), queryString: [], cookies: [], headersSize: -1, bodySize: (e.reqBody || '').length || 0, postData: e.reqBody ? { mimeType: 'text/plain', text: String(e.reqBody) } : undefined },
        response: { status: Number(e.status || 0), statusText: '', httpVersion: 'HTTP/1.1', headers: Object.entries(e.resHeaders || {}).map(([name, value]) => ({ name, value: String(Array.isArray(value) ? value.join(', ') : value ?? '') })), cookies: [], content: { size: Number(e.size || 0), mimeType: '', text: '' }, redirectURL: '', headersSize: -1, bodySize: Number(e.size || 0) },
        cache: {}, timings: { blocked: 0, dns: -1, connect: -1, send: 0, wait: Number((e.timings && e.timings.wait) || 0), receive: Number((e.timings && e.timings.receive) || 0), ssl: -1 },
        _source: String(e.source || 'browser'), _type: String(e.type || ''),
      }));
      text = JSON.stringify({ log: { version: '1.2', creator: { name: '桌面工具箱', version: DISPLAY_VERSION }, entries: harEntries } }, null, 2);
    } else {
      text = JSON.stringify(entries, null, 2);
    }
    try { atomicWriteFile(picked.filePath, text); return { ok: true, file: picked.filePath, count: entries.length }; }
    catch (e2) { return { ok: false, error: `写文件失败：${e2.message || String(e2)}` }; }
  });
  // 2026-11-27-5：回滚到上一版本（用更新前备份恢复，钉住被回滚的版本）。
  ipcMain.handle('update-rollback-info', async () => rollbackInfo());
  ipcMain.handle('update-rollback', async () => rollbackToolboxUpdate());
  // 2026-11-27-4：壁纸选择（方案 2.2 节）——只返回路径，落盘由
  // B 路经 set-config 写 wallpaperPath。
  ipcMain.handle('select-wallpaper', async () => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '选择壁纸图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: picked.filePaths[0] };
  });
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
  ipcMain.handle('winget-deps', async (_e, id, source) => wingetDepsFor(String(id || ''), String(source || '')));
  ipcMain.handle('install-deps-and-package', async (_e, mainId, depIds, meta) => {
    if (!wingetAvailable()) return { ok: false, error: 'winget 只能在 Windows 上用' };
    const steps = [];
    for (const depId of Array.isArray(depIds) ? depIds : []) {
      const r = await runWinget(['install', '--id', String(depId), '-e', '--accept-package-agreements', '--accept-source-agreements'], 300000);
      steps.push({ id: depId, kind: '依赖', ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
      if (r.code !== 0) return { ok: false, steps, error: `依赖 ${depId} 安装失败，先停下，没装本体。${(r.err || r.out).slice(-200)}` };
    }
    // 2026-11-28-9，第 6 项：本体是微软商店源的包时带 --source msstore。
    const m0 = (meta && typeof meta === 'object') ? meta : {};
    const mainArgs = ['install', '--id', String(mainId), '-e', '--accept-package-agreements', '--accept-source-agreements'];
    if (String(m0.source || '') === 'msstore') mainArgs.push('--source', 'msstore');
    const r = await runWinget(mainArgs, 300000);
    steps.push({ id: String(mainId), kind: '本体', ok: r.code === 0, error: r.code === 0 ? '' : (r.err || r.out).slice(-300) });
    // 2026-11-28-12：本体装成功才记台账（依赖不记），meta 里带 key/name/kind。
    if (r.code === 0) {
      const m = (meta && typeof meta === 'object') ? meta : {};
      recordToolboxApp({ key: String(m.key || `winget:${mainId}`), name: String(m.name || mainId), kind: String(m.kind || ''), wingetId: String(mainId), exe: '', installLocation: '' });
    }
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
    // 2026-11-27-4：githubToken 绝不经 set-config 落盘（渲染层现有
    // 调用未传该键，这里再设防：收到就直接丢掉，不保存、不回显）。
    // 令牌只走 github-set-token（先调 GET /user 验证通过才保存）。
    const clean = { ...(patch || {}) };
    delete clean.githubToken;
    const next = { ...getConfig(), ...clean };
    saveConfig(next);
    refreshSniffHooks(); // 2026-11-27-11：第 3 项，嗅探开关变化时挂/摘监听
    applyWindowSettings(); // 2026-11-26-3：置顶/开机自启/防休眠/托盘菜单立即生效
    return { ...next, githubToken: undefined };
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
  /* 2026-11-28-7：菜单分离为独立窗口（见 openMenuWindow）。
   * menu-navigate 由菜单窗口发来，主进程转发给主窗口切页；
   * menu-pin-toggle 切菜单窗口的置顶状态。 */
  ipcMain.handle('menu-detach-open', () => openMenuWindow());
  ipcMain.handle('menu-detach-close', () => closeMenuWindow());
  ipcMain.handle('menu-navigate', (_e, key) => {
    const k = String(key || '');
    sendToRenderer('menu-navigate', { menu: k });
    return { ok: true };
  });
  ipcMain.handle('menu-pin-toggle', () => {
    if (!menuWin || menuWin.isDestroyed()) return { ok: false, error: '菜单窗口未打开' };
    try {
      const next = !menuWin.isAlwaysOnTop();
      menuWin.setAlwaysOnTop(next);
      const c = getConfig();
      c.menuWindowPinned = next;
      saveConfig(c);
      return { ok: true, pinned: next };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
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
  ipcMain.handle('open-tools-dir', () => shell.openPath(toolsDir()));

  /* ---- 工具箱本地功能：智能体 / 创作 / 代码 / 图像 / 监控 /
   * 记账本 / 注册 / 文件 / 代理（本地数据） ---- */
  ipcMain.handle('code-run', (_e, req) => runCode(req || {}));
  ipcMain.handle('code-interpreters', () => detectInterpreters());
  ipcMain.handle('event-trigger-status', () => eventTriggerStatus());
  ipcMain.handle('tun-status', () => tunStatus());
  ipcMain.handle('tun-install', () => tunInstall());
  ipcMain.handle('tun-start', () => tunStart());
  ipcMain.handle('tun-stop', () => tunStop());
  ipcMain.handle('register-mailtm-fetch', () => mailtmFetch());
  ipcMain.handle('selfcheck-status', () => selfcheckStatus());
  ipcMain.handle('selfcheck-install', (_e, key) => selfcheckInstall(String(key || '')));
  ipcMain.handle('agents-list', () => getAgents().map((a) => ({
    ...a, apiKey: undefined, hasKey: !!a.apiKey,
    webToken: undefined, webCookie: undefined, webUserAgent: undefined,
    connectionType: a.connectionType || 'api', webSite: a.webSite || '',
    hasWebToken: !!(a.webToken), webStatus: a.webStatus || '', webLogin: a.webLogin || '',
    webIdentityHash: a.webIdentityHash || '',
  })));
  ipcMain.handle('agent-save', (_e, agent) => {
    const list = getAgents();
    const next = { ...agent, id: agent.id || localId() };
    if (!next.name) return { ok: false, error: '先填智能体名称' };
    next.connectionType = next.connectionType === 'web' ? 'web' : 'api';
    // 2026-11-28-2：重名校验——同名（忽略大小写与首尾空格）且不是
    // 本身时拒绝保存，提示改名，避免列表里两个同名智能体认错。
    const dup = list.find((a) => a.id !== next.id && String(a.name || '').trim().toLowerCase() === String(next.name).trim().toLowerCase());
    if (dup) return { ok: false, error: `已有同名智能体「${dup.name}」，请换个名字` };
    // 2026-11-28-2：API 智能体模型为空时按服务商补默认模型；
    // 补不上时要求填模型，不再默认发 gpt-4o-mini。
    if (next.connectionType === 'api' && !String(next.model || '').trim()) {
      const d = defaultModelForAgent(next);
      if (d) next.model = d;
      else return { ok: false, error: '先填模型（该服务商没有默认模型）' };
    }
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
    saveAgents(list);
    return { ok: true, agent: { ...next, apiKey: undefined, hasKey: !!next.apiKey, webToken: undefined, webCookie: undefined, webUserAgent: undefined, hasWebToken: !!next.webToken } };
  });
  ipcMain.handle('agent-delete', (_e, id) => {
    const agentId = String(id || '');
    saveAgents(getAgents().filter((a) => a.id !== agentId));
    // 2026-11-28-2：级联清理——该智能体的对话、官网会话续接与
    // 待确认操作一起删（触发器在智能体行里，已随行消失；
    // skills.json 本身不动）。以前只删 agents.json 一行，对话
    // 残留在“最近聊天”里，点开后发送报“智能体不存在”。
    const allChats = getAgentChats();
    const deletedChatIds = new Set(allChats.filter((c) => c.agentId === agentId).map((c) => c.id));
    writeJsonFile('agent-chats.json', allChats.filter((c) => c.agentId !== agentId));
    clearWebSessionsForAgent(agentId);
    savePendingActions(getPendingActions().filter((a) => !deletedChatIds.has(a.chatId)));
    return { ok: true };
  });

  /* ---- 技能（2026-11-27-10）：本地技能管理，存 skills.json ---- */
  ipcMain.handle('skills-list', () => getSkills());
  ipcMain.handle('skill-save', (_e, skill) => saveSkill(skill));
  ipcMain.handle('skill-delete', (_e, id) => deleteSkill(id));
  ipcMain.handle('skill-toggle', (_e, id, enabled) => setSkillEnabled(id, enabled));

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
    // 密钥值：不传 secret 字段表示沿用旧的；传了按传的值算（空串
    // 即清除），与代理密码同一规则。编辑表单留空不改时渲染层不发
    // 该字段。密钥值只存 accounts.json，绝不返回渲染层。
    let secret = prev ? String(prev.secret || '') : '';
    if (a.secret !== undefined) secret = String(a.secret || '');
    const next = {
      ...(prev || {}),
      id: prev ? prev.id : `acc_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      site, siteName: resolved.siteName,
      loginUrl: resolved.loginUrl, signupUrl: resolved.signupUrl,
      name, group: String(a.group || '').trim(), note: String(a.note || ''),
      kind: a.kind === undefined ? (prev ? normalizeAccountKind(prev.kind) : 'credential') : normalizeAccountKind(a.kind),
      identity: a.identity === undefined ? (prev ? String(prev.identity || '') : '') : String(a.identity || '').trim().slice(0, 120),
      secret,
      // 来源：只有显式传 source='sniff' 才是嗅探自动保存；手动保存
      // 不改旧来源（嗅探保存过的手动编辑后仍标嗅探自动保存）。
      source: a.source === 'sniff' ? 'sniff' : (prev ? (String(prev.source || '') === 'sniff' ? 'sniff' : 'manual') : 'manual'),
      autoSavedAt: a.source === 'sniff' ? (Number(a.autoSavedAt || 0) || now) : (prev ? (Number(prev.autoSavedAt || 0) || 0) : 0),
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
  // 2026-11-28-7：复制账号密钥值——值只在主进程读、只写剪贴板，
  // 不返回渲染层、不写日志；没有密钥值时明确报错。
  ipcMain.handle('account-copy-secret', (_e, id) => {
    const account = getAccounts().find((a) => a.id === String(id || ''));
    if (!account) return { ok: false, error: '账号不存在' };
    const secret = String(account.secret || '');
    if (!secret) return { ok: false, error: '这个账号没有保存密钥值' };
    try { clipboard.writeText(secret); } catch (e) { return { ok: false, error: '复制失败' }; }
    return { ok: true };
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
  // 2026-11-28-2：重新生成（只重调模型，不追加用户消息）、停止
  // 流式输出、轻量连接探测（GET /models）。
  ipcMain.handle('agent-chat-regenerate', (_e, chatId) => agentChatRegenerate(chatId));
  ipcMain.handle('agent-chat-stop', (_e, chatId) => agentChatStop(chatId));
  ipcMain.handle('agent-models', async (_e, agentId) => agentModelsTest(agentId));
  ipcMain.handle('agent-complete', (_e, agentId, system, text) => agentComplete(agentId, system, text));
  ipcMain.handle('agent-web-verify', async (_e, agentId) => {
    const agent = getAgents().find((a) => a.id === agentId);
    if (!agent) return { ok: false, error: '智能体不存在' };
    if (agent.connectionType !== 'web') return { ok: false, error: '该智能体不是网页端连接方式' };
    return webVerifyAgent(agent);
  });
  /* ---- 2026-11-26-6：视频嗅探 / 下载 ---- */
  ipcMain.handle('video-download', (_e, req) => videoDownloadStart(req || {}));
  // 2026-11-28-4：视频引擎安装入口（-3 删掉的 IPC 重新接回来——嗅探页
  // 下载视频时若引擎未装，渲染层弹确认后直接调它装，不再走到死路）。
  ipcMain.handle('video-engine-download', (_e, engine) => downloadVideoEngine(String(engine || 'ytdlp')));
  /* ---- 2026-11-26-6：GitHub 已安装更新 ---- */
  ipcMain.handle('github-installed-updates', () => githubInstalledUpdates());
  /* ---- 2026-11-26-6：Pioneer ---- */
  // 2026-11-27-10：第 11 项，读状态前先实测隧道与端口，掉了就纠正为未连接。
  ipcMain.handle('pioneer-status', async () => {
    const v = await pioneerVerifyLive();
    const s = pioneerLoad();
    return { ...pioneerPublic(s), connected: v.connected };
  });
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
  // 2026-11-27-10：第 11 项，Pioneer 模式下拉已删，模式只剩全局代理模式这一个
  // 来源；这个 IPC 只留兼容：改全局代理模式，已连接时按新模式重接管。
  ipcMain.handle('pioneer-logs', () => { const s = pioneerLoad(); return Array.isArray(s.logs) ? s.logs : []; });
  // 2026-11-28-4：IP 纯净度检测（本机启发式评估 + 按 IP 永久记忆，
  // 同一 IP 读上次结果，force=true 强制重测）。
  ipcMain.handle('pioneer-ip-purity', (_e, opts) => pioneerIpPurityCheck(opts || {}));
  ipcMain.handle('pioneer-ip-purity-get', () => ({ ok: true, ...loadIpPurity() }));
  /* ---- 2026-11-28-5：手机远程（局域网直连 + Tailscale） ---- */
  ipcMain.handle('phone-remote-status', async () => {
    if (!phoneRemoteTailscaleCache) phoneRemoteTailscaleCache = await phoneRemoteDetectTailscale();
    return phoneRemoteStatus();
  });
  // 2026-11-28-6：屏幕实时翻译（框选 → 视觉轮巡 → 浮窗）
  ipcMain.handle('screen-translate-start', async () => startScreenTranslate());
  ipcMain.handle('screen-translate-select', async (_e, rect) => screenTranslateOnSelected(rect));
  ipcMain.handle('screen-translate-cancel', async () => { closeScreenTranslateOverlay(); return { ok: true }; });
  ipcMain.handle('screen-translate-retry', async () => screenTranslateRetry());
  ipcMain.handle('screen-translate-close', async () => { closeScreenTranslateResultWin(); return { ok: true }; });
  ipcMain.handle('screen-translate-active', async () => { clearScreenTranslateAutoClose(); return { ok: true }; });
  ipcMain.handle('screen-translate-resize', async (_e, size) => {
    try {
      const win = screenTranslateResultWin;
      if (!win || win.isDestroyed()) return { ok: false };
      const h = Math.max(200, Math.min(640, Math.round(Number((size && size.height) || 360))));
      const display = screen.getDisplayMatching(win.getBounds());
      const maxH = Math.max(200, display.workArea.height - win.getBounds().y - 8);
      win.setSize(win.getBounds().width, Math.min(h, maxH));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
  ipcMain.handle('screen-translate-status', async () => screenTranslateStatus());
  ipcMain.handle('phone-remote-set-enabled', async (_e, enabled) => phoneRemoteSetEnabled(!!enabled));
  ipcMain.handle('phone-remote-allow-pair', () => phoneRemoteAllowPairWithQr());
  ipcMain.handle('phone-remote-revoke', (_e, id) => {
    const r = phoneRemoteRevokeDevice(String(id || ''));
    phoneRemoteRefreshTray();
    return r;
  });
  ipcMain.handle('phone-remote-set-dangerous', (_e, key, enabled) => {
    const k = String(key || '');
    if (!PHONE_REMOTE_DANGEROUS_KEYS.includes(k)) return { ok: false, error: '未知的高危操作' };
    const s = phoneRemoteLoad();
    s.dangerous[k] = !!enabled;
    phoneRemoteSave(s);
    return { ok: true, dangerous: s.dangerous };
  });
  ipcMain.handle('phone-remote-tailscale', async () => {
    phoneRemoteTailscaleCache = await phoneRemoteDetectTailscale();
    return phoneRemoteTailscaleCache;
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
  ipcMain.handle('register-list', () => {
    // 12 小时前的记录自动清理（数据只在本地）
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
  // 2026-11-28-8：诊断包导出——版本、自测结果、脱敏日志、更新记录、
  // 崩溃记录；密钥类字段一律打码，不含任何密钥。只存本机文件。
  ipcMain.handle('diagnostics-status', () => { try { return diagnosticsStatus(); } catch (e) { return { ok: false, error: e.message || String(e) }; } });
  ipcMain.handle('diagnostics-export', () => exportDiagnostics());
  ipcMain.handle('diagnostics-open-logs', () => {
    try { fs.mkdirSync(diagLogDir(), { recursive: true }); shell.openPath(diagLogDir()); return { ok: true }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('diagnostics-clear-logs', () => {
    try {
      const dir = diagLogDir();
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (/^\d{4}-\d{2}-\d{2}\.log$/.test(f) || f === 'last-crash.json') { try { fs.rmSync(path.join(dir, f), { force: true }); } catch (e) { /* 删不掉跳过 */ } }
        }
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  // 2026-11-27-4：接通密码分支——backup-import 接受 {password}，
  // 加密备份真解密（importBackupFile 已有 AES-256-GCM 路径）；
  // 未给密码且备份加密时返回 needsPassword，由 B 路弹密码框再调
  // backup-import-password（已存在）或带密码重调本接口。
  ipcMain.handle('backup-import', async (_e, opts) => {
    const picked = await dialog.showOpenDialog(mainWin, {
      title: '导入工具箱数据备份',
      filters: [{ name: '工具箱备份', extensions: ['toolboxbak'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    const password = opts && opts.password ? String(opts.password) : '';
    const r = await importBackupFile(picked.filePaths[0], password);
    // 2026-11-27-4 整合：需要密码时把文件路径一并返回，渲染层弹密码框后
    // 调 backup-import-password(file, password) 真解密，不用再选一次文件。
    if (r && r.needsPassword) return { ...r, file: picked.filePaths[0] };
    return r;
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
    // 2026-11-28-5：手机远程状态文件、证书与开关（自测里会改，结束时恢复）
    phoneRemote: (() => { try { return fs.readFileSync(path.join(userDataDir(), 'phone-remote.json'), 'utf8'); } catch (e) { return null; } })(),
    phoneRemoteCert: (() => { try { return fs.readFileSync(path.join(userDataDir(), 'phone-remote-cert.json'), 'utf8'); } catch (e) { return null; } })(),
    phoneRemoteEnabled: !!(getConfig().phoneRemote && getConfig().phoneRemote.enabled),
    phoneRemoteWasRunning: phoneRemoteRunning,
    proxyMode: getConfig().proxyMode || 'direct',
    proxyHost: getConfig().proxyHost || '', proxyPort: getConfig().proxyPort || '',
    proxyServers: getConfig().proxyServers || [], ledgerCategories: getConfig().ledgerCategories || [],
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
  await mainWin.webContents.executeJavaScript("openPlayerApp('vlc');");
  await shot('player-vlc');
  // 浏览器：点 Chromium 图标进 Chromium 窗口
  mainWin.webContents.send('test-goto', 'browser');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("openBrowserApp('chromium');");
  await shot('browser-chromium');
  // 工具箱本地功能自检：菜单 14 项、最近栏只显示智能体对话、
  // 各本地页读写本机数据。
  const js = (code) => mainWin.webContents.executeJavaScript(code);
  const clickMenu = async (key) => {
    await js(`document.querySelector('.menu-item[data-menu=${key}]')?.click();`);
    await new Promise((r) => setTimeout(r, 800));
  };
  // 2026-11-27-10，第 10 项（补做）：左侧菜单已删“工具管理”，自测里去工具
  // 管理页改走 openMenuItem('tools')（总览卡片同路），不再点已不存在的菜单项。
  const gotoTools = async () => {
    await js(`openMenuItem('tools');`);
    await new Promise((r) => setTimeout(r, 800));
  };
  const nativeCheck = {};
  // 2026-11-28-8：自测去噪——skip 语义。环境相关项（Windows-only、
  // 未安装项）不记 false，记进 selftestSkipped（键是 native 里的
  // 虚路径、值是原因），不计入布尔叶；口径：native 组内布尔叶
  // 递归计数（含数组）+ skipped 条目数，false 必须为 0。40 个旧
  // false 的去向见自测记录，不许悄悄消失。
  const selftestSkipped = {};
  const markSkipped = (pathKey, reason) => { selftestSkipped[pathKey] = reason; };
  // 2026-11-27-10，第 2 项：返回只在当前功能内部向上层，不跳转去别的功能。
  // 场景 1（2026-11-28-12 改）：浏览器→Edge 内嵌视图→返回应回浏览器列表；
  // 列表再点返回应留在浏览器列表，返回按钮藏起。Edge 不再有外部详情页，
  // 打开即进 Chromium 内嵌视图，分区为 persist:toolbox-edge。场景 2
  //（2026-11-28-2 改，期望 2026-11-28-2 run2 修正）：菜单“打开 Chrome
  // 应用商店”只是在 Chromium 视图内换了网址（chromeGo），不是新子视图，
  // 所以点返回应回浏览器列表（与场景 1 一致），而不是留在 Chromium 视图；
  // 点 ✕ 关闭 Chromium 应回列表；列表再点返回仍留在浏览器。沙盒未装
  // 浏览器/播放器，子视图改走 openBrowserApp / showBrowserView 直达
  //（不点图标）。
  const backState = () => js(`(() => {
    const vis = (id) => { const e = document.querySelector(id); return e ? !e.classList.contains('hidden') : null; };
    return { screen: document.querySelector('.screen.active')?.id || '',
      list: vis('#browser-list-view'), chromium: vis('#browser-chromium-view'),
      partition: document.querySelector('#toolbox-webview')?.getAttribute('partition') || '',
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
  await gotoTools();
  await clickMenu('browser');
  await js(`openBrowserApp('edge');`);
  await new Promise((r) => setTimeout(r, 600));
  const s1a = await backState();
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s1b = await backState();
  await shot('backnav-s1-edge-back');
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s1c = await backState();
  await shot('backnav-s1-stays-on-browser');
  nativeCheck.backNavS1 = { atEdgeEmbedded: s1a.chromium === true && s1a.partition === 'persist:toolbox-edge',
    oneBackOnly: s1a.backBtns === 1 && s1a.oldBackBtns === 0, backLabel: s1a.backLabel,
    headerSticky: s1a.headerSticky, backToList: s1b.screen === 'screen-browser' && s1b.list === true,
    staysOnBrowser: s1c.screen === 'screen-browser' && s1c.list === true,
    backHiddenAtList: await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.classList.contains('hidden')`) };
  await clickMenu('toolbox');
  await gotoTools();
  await clickMenu('browser');
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2a = await backState();
  await js(`openBrowserApp('chromium');`);
  await new Promise((r) => setTimeout(r, 800));
  // 2026-11-28-2：扩展页已随便携版删除，改走菜单“打开 Chrome 应用商店”
  //（仍在内嵌浏览器里打开，视图仍是 Chromium 视图）。
  await js(`document.querySelector('[data-chrome-act="webstore"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2b = await backState();
  // 应用商店应在内嵌浏览器里打开：地址栏与 webview 地址都是应用商店。
  const s2bUrl = await js(`(document.querySelector('#chrome-url')?.value || '') + '|' + (document.querySelector('#toolbox-webview')?.getAttribute('src') || '')`);
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2c = await backState();
  await shot('backnav-s2-webstore-back');
  await js(`document.querySelector('#chrome-close')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2d = await backState();
  await js(`document.querySelector('#screen-browser > .screen-head [data-nav="back"]')?.click();`);
  await new Promise((r) => setTimeout(r, 600));
  const s2e = await backState();
  await shot('backnav-s2-after-close');
  nativeCheck.backNavS2 = { staysOnBrowser: s2a.screen === 'screen-browser' && s2a.list === true,
    atWebstore: s2b.chromium === true && String(s2bUrl || '').includes('chromewebstore.google.com'), webstoreBackToList: s2c.screen === 'screen-browser' && s2c.list === true,
    closeToList: s2d.screen === 'screen-browser' && s2d.list === true,
    staysOnBrowserAfterClose: s2e.screen === 'screen-browser' && s2e.list === true };
  nativeCheck.menuItems = await js(`document.querySelectorAll('.menu-item').length`);
  nativeCheck.menuTitle = await js(`document.querySelector('.sidebar-title')?.textContent`);
  // 自测修正 2026-11-27-9：现行界面没有底部导航（.nav-item），侧栏用
  // .menu-item；“新对话”是侧栏按钮 #sidebar-new-chat。
  nativeCheck.bottomNavHasNewChat = await js(`!!document.querySelector('#sidebar-new-chat')`);
  nativeCheck.bottomNavHasToolbox = await js(`!!document.querySelector('.menu-item[data-menu=toolbox]')`);
  // 2026-11-27-10，第 1 项：深色下 option 应深底浅字，浅色下反之。
  nativeCheck.darkOptionColors = await js(`(() => {
    const prev = document.body.getAttribute('data-theme');
    const probe = (theme) => {
      document.body.setAttribute('data-theme', theme);
      const sel = document.createElement('select');
      const opt = document.createElement('option');
      opt.textContent = 'x'; sel.appendChild(opt); document.body.appendChild(sel);
      const cs = getComputedStyle(opt);
      const r = { bg: cs.backgroundColor, color: cs.color };
      sel.remove(); return r;
    };
    const dark = probe('dark'); const light = probe('light');
    if (prev === null) document.body.removeAttribute('data-theme'); else document.body.setAttribute('data-theme', prev);
    return { darkBg: dark.bg, darkColor: dark.color, lightBg: light.bg, lightColor: light.color,
      // 2026-11-28-5 设计系统：深色 option 底由 #2c2c2e 改 #18181B（rgb(24,24,27)）。
      darkOk: dark.bg === 'rgb(24, 24, 27)' && dark.color === 'rgb(245, 245, 247)',
      lightOk: light.bg === 'rgb(255, 255, 255)' && light.color === 'rgb(28, 28, 30)' };
  })()`);
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
  // 2026-11-27-10，第 9 项（补做）：技能管理——新增、编辑、停用、删除、
  // 持久化重读、挂到智能体上调用时带指令（停用后不带，删除后挂接清理）。
  nativeCheck.skills20261127 = await (async () => {
    const r = {};
    const created = await js(`(async () => window.toolbox.skillSave({ name: '自测技能', description: '自测用', instructions: '回答要简短。', enabled: true }))()`);
    r.created = !!(created && created.ok && created.skill && created.skill.id);
    const sid = created && created.skill ? created.skill.id : '';
    r.inFile = readJsonFile('skills.json', []).some((s) => s.id === sid);
    r.listed = (await js(`(async () => window.toolbox.skillsList())()`)).some((s) => s.id === sid);
    const agents = getAgents();
    const ag = agents[0];
    if (ag) { ag.skillIds = [sid]; saveAgents(agents); }
    r.attachedPromptHasSkill = !!ag && skillPromptSection(ag).includes('回答要简短。');
    await js(`(async () => window.toolbox.skillToggle(${JSON.stringify(sid)}, false))()`);
    r.disabledExcluded = !!ag && !skillPromptSection(getAgents()[0]).includes('回答要简短。');
    const edited = await js(`(async () => window.toolbox.skillSave({ id: ${JSON.stringify(sid)}, name: '自测技能改名', description: '改后', instructions: '回答要详细。', enabled: true }))()`);
    r.edited = !!(edited && edited.ok && edited.skill && edited.skill.name === '自测技能改名');
    r.rereadHasEdit = readJsonFile('skills.json', []).some((s) => s.id === sid && s.instructions === '回答要详细。');
    r.reenabledPromptHasNew = skillPromptSection(getAgents()[0]).includes('回答要详细。');
    const del = await js(`(async () => window.toolbox.skillDelete(${JSON.stringify(sid)}))()`);
    r.deleted = !!(del && del.ok);
    r.goneFromFile = !readJsonFile('skills.json', []).some((s) => s.id === sid);
    r.agentUnlinked = !(getAgents()[0].skillIds || []).includes(sid);
    await js(`gotoAgentTab('skills');`);
    await new Promise((res) => setTimeout(res, 400));
    r.tabVisible = await js(`!!document.querySelector('#agent-tab-skills.active') && !!document.querySelector('#skill-name') && !!document.querySelector('#skill-list')`);
    await js(`gotoAgentTab('list');`);
    return r;
  })();
  // 2026-11-27-10，第 3、4 项：标签栏只留智能体列表、技能、定时触发（第 9 项
  // 补做技能页签）；对话列表与页头「新对话」已去掉，聊天窗仍在（侧栏/最近聊天可打开）。
  nativeCheck.agentTabs = await js(`[...document.querySelectorAll('#screen-agents .tab')].map((b) => b.textContent).join(',')`);
  nativeCheck.agentTabsListSkillsTriggers = nativeCheck.agentTabs === '智能体列表,技能,定时触发,记忆';
  nativeCheck.agentChatListGone = await js(`!document.querySelector('#agent-chat-list')`);
  nativeCheck.agentNewChatGone = await js(`!document.querySelector('#agent-new-chat')`);
  nativeCheck.agentChatPaneKept = await js(`!!document.querySelector('#agent-tab-chat') && !!document.querySelector('#chat-msgs') && !!document.querySelector('#chat-input')`);
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
  // 监控 / 文件
  await clickMenu('monitor');
  nativeCheck.monitorRows = await js(`document.querySelectorAll('#monitor-stats .row').length`);
  nativeCheck.monitorUsageRows = await js(`document.querySelectorAll('#monitor-usage .row').length`);
  nativeCheck.monitorProxyRows = await js(`document.querySelectorAll('#monitor-proxy .row').length`);
  await shot('monitor');
  await clickMenu('files');
  await js(`renderFiles('/home/hatch/workspace/desktop-toolbox')`);
  await new Promise((r) => setTimeout(r, 600));
  nativeCheck.filesRows = await js(`document.querySelectorAll('#files-list .files-tree-row').length`);
  await js(`document.querySelector('#files-search').value='toolbox'; document.querySelector('#files-search').dispatchEvent(new Event('input'));`);
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.filesSearchRows = await js(`document.querySelectorAll('#files-list .files-tree-row').length`);
  await js(`document.querySelector('#files-search').value=''; document.querySelector('#files-search').dispatchEvent(new Event('input'));`);
  nativeCheck.filesMkdir = await js(`(async () => { const r = await window.toolbox.filesMkdir('/home/hatch/workspace/desktop-toolbox', '自测文件夹'); return r; })()`);
  await shot('files');
  // 代理：配一个打不通的代理，测试应明确失败（证明测试链路真实跑了）
  await clickMenu('proxy');
  // 2026-11-27-10，第 11 项（补做）：代理模式已改成按钮式，点按钮即切换并保存。
  await js(`document.querySelector('#proxy-mode-group [data-mode="manual"]')?.click();`);
  await new Promise((r) => setTimeout(r, 400));
  await js(`document.querySelector('#proxy-host').value='127.0.0.1'; document.querySelector('#proxy-port').value='9'; document.querySelector('#proxy-save').click();`);
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.proxyTestFailsClosedPort = (await proxyTest()).ok === false;
  nativeCheck.proxyModeButtons20261127 = await js(`(async () => {
    const r = { modes: [...document.querySelectorAll('#proxy-mode-group [data-mode]')].map((b) => b.dataset.mode).join(','), selectGone: !document.querySelector('#proxy-mode') };
    for (const m of ['direct', 'smart', 'global', 'manual', 'tun']) {
      document.querySelector('#proxy-mode-group [data-mode="' + m + '"]')?.click();
      await new Promise((res) => setTimeout(res, 400));
      const ov = await window.toolbox.getOverview();
      r['mode_' + m] = !!(ov && ov.config && ov.config.proxyMode === m && document.querySelector('#proxy-mode-group [data-mode="' + m + '"].active'));
    }
    return r;
  })()`);
  // 2026-11-27-10，第 11 项（补做）：Pioneer 状态只信实测——只写保存标志
  // 不起隧道，pioneer-status 必须纠正为未连接、清掉标志，界面也显示未连接。
  nativeCheck.pioneerDisconnected20261127 = await (async () => {
    const r = {};
    const before = pioneerLoad();
    pioneerSave({ ...before, connected: true, tunnelRunning: false });
    const st = await js(`(async () => window.toolbox.pioneerStatus())()`);
    r.staleFlagCorrected = !!(st && st.connected === false);
    r.flagClearedOnDisk = pioneerLoad().connected === false;
    r.pioneerModeGone = await js(`!document.querySelector('#pioneer-mode')`);
    await js(`document.querySelector('[data-proxy-tab="pioneer"]')?.click();`);
    await new Promise((res) => setTimeout(res, 800));
    await js(`renderPioneer();`);
    await new Promise((res) => setTimeout(res, 800));
    r.uiShowsDisconnected = await js(`(document.querySelector('#pioneer-exit-ip')?.textContent || '') === '未连接'`);
    // 只恢复连接标志，保留纠正时写的那条日志。
    pioneerSave({ ...pioneerLoad(), connected: !!before.connected, tunnelRunning: !!before.tunnelRunning });
    return r;
  })();
  nativeCheck.proxyLogRows = await js(`document.querySelectorAll('#proxy-log .row').length`);
  nativeCheck.proxyIpCheck = await js(`(async () => { const r = await window.toolbox.proxyIpCheck(); return r && (r.ok || !!r.error); })()`);
  // 2026-11-27-10，第 10 项：手动代理与代理服务器文案更正式简洁。
  nativeCheck.proxyManualWording = await js(`(() => { const t = (id) => document.querySelector(id)?.textContent || ''; return { saveIsSave: t('#proxy-save') === '保存', testIsTest: t('#proxy-test') === '测试', ipIsExitIp: t('#proxy-ip-check') === '检测出口 IP', addIsAdd: t('#proxy-server-add') === '添加' }; })()`);
  nativeCheck.proxyServersNote = await js(`(() => { const rows = document.querySelectorAll('#proxy-servers .row').length; const txt = document.querySelector('#proxy-servers')?.textContent || ''; return { emptyNoteIsConcise: rows ? true : txt === '暂无代理服务器。' }; })()`);
  await shot('proxy');
  // GitHub / 工具管理 / 播放器 / 浏览器菜单直达
  // 自测修正 2026-11-27-9：媒体入口已于 2026-11-27-2 去掉，不要再加回来，
  // mediaScreen / mediaList 两项删除，媒体嗅探由后段 browserMediaSniff 覆盖。
  // GitHub 没有独立 screen，登录卡片在工具管理页「工具来源」页签里。
  await gotoTools();
  await js(`gotoTab('sources')`);
  await new Promise((r) => setTimeout(r, 400));
  nativeCheck.githubLoginCard = await js(`!!document.querySelector('#github-login-card') && !!document.querySelector('#github-token')`);
  await shot('github');
  await gotoTools();
  await js(`document.querySelector('[data-tab=recommended]')?.click();`);
  // 2026-11-28-4，第 9 项：推荐软件改应用商城式——7 类、17 张卡片。
  await waitFor(() => js(`document.querySelectorAll('#recommended-list .store-card').length === 17`));
  nativeCheck.recommendedTab = await js(`(() => { const cats = RECOMMENDED_CATEGORIES; const names = cats.flatMap((c) => c.apps.map((a) => a.name)); const expected = ['Chrome', 'Edge', 'Firefox', 'VLC', 'PotPlayer', 'mpv', '7-Zip', 'Bandizip', 'LibreOffice', 'Notion', 'VS Code', 'Git', 'Telegram', 'Discord', 'PowerToys', 'Everything', 'Geek Uninstaller']; const expectedCats = ['浏览器', '播放器', '压缩解压', '办公', '开发工具', '通讯社交', '系统工具', '图片工具', '下载工具', '效率工具']; return { cards: names.length, names: names.join(','), allSixtyThree: names.length === 63 && expected.every((n) => names.includes(n)), cats: cats.length, catsOk: expectedCats.every((c) => cats.some((x) => x.title === c)) }; })()`);
  nativeCheck.toolsScreen = await js(`document.querySelector('.screen.active')?.id`);
  await clickMenu('player');
  nativeCheck.playerScreen = await js(`document.querySelector('.screen.active')?.id`);
  await clickMenu('browser');
  nativeCheck.browserScreen = await js(`document.querySelector('.screen.active')?.id`);
  // 2026-11-27-10，第 5 项：未安装时不显示推荐的三个，默认下拉只列已装的。
  await clickMenu('player');
  nativeCheck.playerNoIcons = await js(`(async () => { const apps = await window.toolbox.playerApps(); const anyFound = Object.values(apps).some((a) => a && a.found); const icons = document.querySelectorAll('#player-apps [data-app-open]').length; const txt = document.querySelector('#player-apps')?.textContent || ''; return { noneShownWhenUninstalled: !anyFound ? icons === 0 : icons > 0, namesAbsent: !anyFound ? !/VLC|PotPlayer|mpv/.test(txt) : true }; })()`);
  await clickMenu('browser');
  // 2026-11-28-12，第 2 项：Chromium 图标永远显示（内嵌可用），Chrome /
  // Edge 只在工具箱内装了才显示；未装的在文案里不出现名字。
  // 2026-11-28-7：第 1 项：内嵌 Chromium 不再进已安装列表——图标只
  // 有工具箱内装的 Chrome / Edge；入口在“打开内嵌浏览器”按钮。
  nativeCheck.browserNoIcons = await js(`(async () => { const apps = await window.toolbox.browserApps(); const icons = [...document.querySelectorAll('#browser-apps [data-app-open]')].map((b) => b.dataset.appOpen); const txt = document.querySelector('#browser-apps')?.textContent || ''; const expected = ['chrome', 'edge'].filter((k) => apps[k] && apps[k].found); const openBtn = !!document.querySelector('#browser-open-embedded'); return { chromiumAbsent: !icons.includes('chromium'), iconsMatchFound: JSON.stringify(icons) === JSON.stringify(expected), namesAbsent: (apps.chrome && apps.chrome.found) || (apps.edge && apps.edge.found) ? true : !/Chrome|Edge/.test(txt), openEmbeddedBtn: openBtn, emptyNoteMentionsEmbedded: expected.length ? true : /内嵌浏览器/.test(txt) }; })()`);
  nativeCheck.defaultSelectsOnlyInstalled = await js(`(async () => { const p = await window.toolbox.playerApps(); const b = await window.toolbox.browserApps(); const pOpts = [...document.querySelectorAll('#default-player option')].map((o) => o.value); const bOpts = [...document.querySelectorAll('#default-browser option')].map((o) => o.value); return { playerOk: pOpts.every((v) => !v || (p[v] && p[v].found)), browserOk: bOpts.every((v) => !v || v === 'chromium' || (b[v] && b[v].found)), chromiumInBrowserSelect: bOpts.includes('chromium'), playerOpts: pOpts.join(','), browserOpts: bOpts.join(',') }; })()`);
  // 侧栏「新对话」：走 openMenuItem('newchat') 真触发，应新建一个对话
  const chatsBeforeBottomNew = getAgentChats().length;
  await js(`openMenuItem('newchat')`);
  await new Promise((r) => setTimeout(r, 800));
  nativeCheck.bottomNewChatScreen = await js(`document.querySelector('.screen.active')?.id`);
  nativeCheck.chatsAfterBottomNew = getAgentChats().length;
  nativeCheck.bottomNewChatCreates = nativeCheck.bottomNewChatScreen === 'screen-agents'
    && nativeCheck.chatsAfterBottomNew === chatsBeforeBottomNew + 1;
  // v1.5.0 真实实现自检
  // 代码运行：沙盒里有 Python 3 与 Node，跑一段真实代码看输出
  // 2026-11-28-8：powershell 未装是环境 skip（沙盒 Linux 无
  // powershell/pwsh；Windows 上应为 true），记 skip 不记 false。
  nativeCheck.codeInterpreters = (await js(`(async () => { const l = await window.toolbox.codeInterpreters(); return l.map((x) => ({ key: x.key, found: x.found })); })()`)).map((x, i) => {
    if (x.key === 'powershell' && !x.found && process.platform !== 'win32') {
      markSkipped(`codeInterpreters[${i}].found`, 'PowerShell 未安装（沙盒 Linux 无 powershell/pwsh；Windows 上应为 true）');
      return { key: x.key, found: 'skipped' };
    }
    return x;
  });
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
  // Tun：沙盒是 Linux，应如实报不支持（不是假装可用）。2026-11-28-8：
  // 6 个 false 全是环境 skip（Tun/WinTun 仅 Windows），记 skip。
  nativeCheck.tunStatus = await (async () => {
    const r = await js(`(async () => { return window.toolbox.tunStatus(); })()`);
    if (r && process.platform !== 'win32') {
      for (const k of ['ok', 'supported', 'admin', 'driverInstalled', 'dllPresent', 'active']) {
        markSkipped(`tunStatus.${k}`, 'Tun/WinTun 仅 Windows，Linux 沙盒预期不支持');
        r[k] = 'skipped';
      }
    }
    return r;
  })();
  // 发现软件：沙盒无 winget，应如实报不可用。2026-11-28-8：环境 skip。
  nativeCheck.wingetSearch = await (async () => {
    const r = await js(`(async () => { return window.toolbox.wingetSearch('vlc'); })()`);
    if (r && r.available === false && process.platform !== 'win32') {
      markSkipped('wingetSearch.available', 'winget 仅 Windows，沙盒 Linux 无 winget');
      r.available = 'skipped';
    }
    return r;
  })();
  // 注册 Mail.tm：先把代理恢复直连（前面代理自检配了个打不通的代理，
  // 不恢复的话 httpJson 会走那个死代理；真实使用时按用户自己的代理设置走）
  saveConfig({ ...getConfig(), proxyMode: 'direct', proxyHost: '', proxyPort: '' });
  // 注册 Mail.tm：2026-11-28-8 改走本机 mock 端点（mockMailtm20261128
  // 组），不再看沙盒出口脸色；真实 api.mail.tm 只在真机上走。
  nativeCheck.mailtmFetch = await (async () => {
    try {
      const mock = await startMockMailtmServer();
      try { fs.rmSync(path.join(userDataDir(), 'mailtm.json'), { force: true }); } catch (e) { /* 删不掉用旧账号也行 */ }
      const r = await mailtmFetch(mock.base);
      return { ok: !!(r && r.ok), account: (r && r.account) || '', error: (r && r.error) || '', fetched: (r && r.fetched) || 0, added: (r && r.added) || 0 };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
    finally { try { mockMailtmServerClose(); } catch (e) { /* 关不掉不影响 */ } }
  })();
  await shot('register-mailtm');
  // 图像：无密钥时应明确不可用（不编造图片）。2026-11-28-8：旧断言
  // 把“正确拒绝”的 ok:false 当失败记，改记 rejected（拒绝即通过）。
  saveConfig({ ...getConfig(), imageApiKey: '', imageBaseUrl: '' });
  nativeCheck.imageNoKey = await js(`(async () => { const r = await window.toolbox.imageGenerate('一只猫', '1024x1024'); return { rejected: r && r.ok === false, error: (r && r.error) || '' }; })()`);
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
  // 2026-11-28-12，第 9 项：自检不再检测 VLC 和 Chromium（这两个不是
  // 默认需要安装项）；自检里点装这两项应明确失败，不静默成功。
  nativeCheck.selfcheckNoVlcChromium = await js(`(async () => { const rows = await window.toolbox.selfcheckStatus(); const keys = rows.map((x) => x.key); const vlc = await window.toolbox.selfcheckInstall('vlc'); const chr = await window.toolbox.selfcheckInstall('chromium'); return { noVlcRow: !keys.includes('vlc'), noChromiumRow: !keys.includes('chromium'), installVlcFails: vlc && vlc.ok === false, installChromiumFails: chr && chr.ok === false }; })()`);
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
  // 2026-11-28-8：旧断言把“正确拒绝”的 ok:false 当失败记，改记
  // denied / needsConfirm（拒绝或要求确认即通过）。
  nativeCheck.pluginCallDenied = plugin160 ? await (async () => { const r = await pluginCall(plugin160.id, 'files.list', {}, false); return { denied: r && r.ok === false, error: (r && r.error) || '' }; })() : null;
  nativeCheck.pluginCallDangerNeedsConfirm = plugin160 ? await (async () => { const r = await pluginCall(plugin160.id, 'code.run', { language: 'Python', code: 'print(1)' }, false); return { needsConfirm: r && r.ok === false && r.needConfirm === true, error: (r && r.error) || '' }; })() : null;
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
    // 2026-11-28-8：未申请的接口被拒是正确行为，改记 denied。
    nativeCheck.quickLauncherDenied = await (async () => { const d = await pluginCall(ql.id, 'winget.search', { query: 'x' }, false); return { denied: d && d.ok === false, error: (d && d.error) || '' }; })();
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
    // 2026-11-28-8：未申请的接口被拒是正确行为，改记 denied。
    nativeCheck.fastFileSearchDenied = await (async () => { const d = await pluginCall(fsr.id, 'apps.list', {}, false); return { denied: d && d.ok === false, error: (d && d.error) || '' }; })();
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
    // agent.list：只返回已配 key 的智能体，且不含 apiKey。2026-11-28-8：
    // 旧断言 hasApiKey 把“密钥不外泄”这个正确行为当失败记（agent.list
    // 按设计绝不返回 apiKey 字段），改记 noApiKeyLeaked。
    const al = await pluginCall(tr.id, 'agent.list', {}, false);
    nativeCheck.translationAgentList = al && al.ok ? { count: (al.data || []).length, names: (al.data || []).map((x) => x.name), noApiKeyLeaked: !(al.data || []).some((x) => 'apiKey' in x) } : al;
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
      // 2026-11-28-8：旧断言把“预期失败”的 ok:false 与“未超时”的
      // selftestTimeout:false 都当失败记。按注释本意，假 key 调用
      // 报错或 25 秒超时都证明请求已发出，只记 failedAsExpected。
      nativeCheck.translationAgentComplete = { failedAsExpected: !!(ac && !ac.ok), error: (ac && ac.error) || '' };
    } else {
      nativeCheck.translationAgentComplete = { failedAsExpected: false, error: '自测智能体不在 agent.list 里' };
    }
    // plugin.store：存取往返 + 插件间隔离（直接读另一个插件的 store 应为空）
    const st1 = await pluginCall(tr.id, 'plugin.store', { op: 'set', value: { selftest: 'tr-1' } }, false);
    const st2 = await pluginCall(tr.id, 'plugin.store', { op: 'get' }, false);
    nativeCheck.translationStore = { setOk: !!(st1 && st1.ok), getValue: st2 && st2.ok ? st2.data : st2, otherPluginGet: pluginStoreGet('quick-launcher') };
    // translate.models：目录在、未装为空。2026-11-28-8：引擎未装是
    // 环境 skip（沙盒无 argostranslate），记 skip 不记 false。
    const ml = await pluginCall(tr.id, 'translate.models', { op: 'list' }, false);
    nativeCheck.translationModelsList = ml && ml.ok ? { engineInstalled: ml.data.engine.installed ? true : 'skipped', catalogCount: (ml.data.catalog || []).length, installedCount: (ml.data.installed || []).length } : ml;
    if (ml && ml.ok && !ml.data.engine.installed) markSkipped('translationModelsList.engineInstalled', '离线翻译引擎未安装（沙盒无 argostranslate；装了引擎后应为 true）');
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
      // 2026-11-28-8：ok:false 是预期（引擎缺失），改记 handled（翻出来
      // 或明确报缺引擎都算正确处理）。
      const off = await pluginCall(tr.id, 'translate.offline', { text: 'hello', from: 'en', to: 'zh' }, false);
      nativeCheck.translationOffline = { handled: !!(off && (off.ok || off.needEngine)), needEngine: !!(off && off.needEngine), error: (off && off.error) || '' };
      const del = await pluginCall(tr.id, 'translate.models', { op: 'delete', key: 'en-zh' }, false);
      nativeCheck.translationModelDelete = { ok: !!(del && del.ok) };
    } finally { try { zipSrv.close(); } catch (e) { /* 关不掉不影响 */ } }
    // translate.software：沙盒 Linux 上应为空数组
    const sw = await pluginCall(tr.id, 'translate.software', {}, false);
    nativeCheck.translationSoftware = sw && sw.ok ? { count: (sw.data || []).length } : sw;
    // 发现软件列表一键翻译按钮存在（2026-11-26-6：GitHub 专页已并入发现软件）
    nativeCheck.translationGhButton = await js(`!!document.querySelector('#discover-list')`);
    // 右键菜单：翻译菜单是原生 Electron 菜单（contents.on('context-menu')
    // 触发），合成 DOM 事件永远弹不出来，旧测试找不存在的 .translate-menu
    // 所以恒为 false。2026-11-28-8 改为主进程直接验纯函数
    // buildContextMenuTemplate：有选中文字时应含“翻译所选内容”与
    // “发送到智能体解释”，主窗口空白处应为空数组。
    nativeCheck.translationContextMenu = await (async () => {
      const r = {};
      try {
        const withSel = buildContextMenuTemplate({ selectionText: 'A tiny test repository for translation.' }, mainWin.webContents);
        const labels = withSel.map((x) => x.label || '');
        r.hasTranslateItem = labels.includes('翻译所选内容');
        r.hasExplainItem = labels.includes('发送到智能体解释');
        r.blankAreaEmpty = buildContextMenuTemplate({}, mainWin.webContents).length === 0;
      } catch (e) { r.error = e.message || String(e); }
      return r;
    })();
    await js(`(async () => { const box = document.querySelector('#discover-list'); if (box) box.innerHTML = ''; })()`);
  }
  // 清理翻译插件与它的插件状态、模型目录（恢复自测前状态）
  if (tr) {
    savePlugins(getPlugins().filter((x) => x.id !== tr.id));
    try { fs.rmSync(pluginDirFor(tr.id), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
    try { fs.rmSync(path.join(pluginStoreDir(), tr.id + '.json'), { force: true }); } catch (e) { /* 删不掉不影响 */ }
    try { fs.rmSync(modelsDir(), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  }
  // 备份与同步：导出 → 导入；加密备份错密码打不开、对密码能打开；同步文件夹写出并列出
  // 2026-11-28-8：无密码导出的 encrypted:false 是预期（没设密码就不加密），
  // 错密码导入的 ok:false 也是预期（应拒绝），旧断言都把预期值当失败记，
  // 改记 unencrypted / rejected。
  const backupFile160 = path.join(os.tmpdir(), 'toolbox-selftest.toolboxbak');
  nativeCheck.backupExport = await (async () => { const r = await writeBackupFile(backupFile160, {}); return { ok: !!(r && r.ok), unencrypted: r && r.encrypted === false, file: (r && r.file) || '', files: (r && r.files) || [] }; })();
  nativeCheck.backupImport = await importBackupFile(backupFile160);
  const encFile160 = path.join(os.tmpdir(), 'toolbox-selftest-enc.toolboxbak');
  await writeBackupFile(encFile160, { password: 'test123' });
  nativeCheck.backupImportWrongPassword = await (async () => { const r = await importBackupFile(encFile160, 'wrong'); return { rejected: r && r.ok === false, error: (r && r.error) || '' }; })();
  nativeCheck.backupImportRightPassword = await importBackupFile(encFile160, 'test123');
  const syncDir160 = path.join(os.tmpdir(), 'toolbox-sync-test');
  fs.mkdirSync(syncDir160, { recursive: true });
  saveConfig({ ...getConfig(), syncFolder: syncDir160 });
  nativeCheck.syncExport = await (async () => { const r = await writeBackupFile(path.join(syncDir160, '工具箱备份-test.toolboxbak'), {}); return { ok: !!(r && r.ok), unencrypted: r && r.encrypted === false, file: (r && r.file) || '' }; })();
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
  nativeCheck.updateRollbackButtonPresent = await js(`!!document.querySelector('#update-rollback') && !!document.querySelector('#update-rollback-info')`);
  // 2026-11-28-8：本机已是最新版时 newer:false 是预期（不是失败），
  // 改记 upToDate；无文件可更新时 updateApply 应拒绝，改记 rejected。
  nativeCheck.updateCheck = await js(`(async () => { const r = await window.toolbox.updateCheck(); await renderUpdateSection(); return { checked: r && r.ok === true, upToDate: r && r.newer === false, latest: (r && r.latest) || '' }; })()`);
  nativeCheck.updateStatusText = await js(`document.querySelector('#update-result')?.textContent || ''`);
  nativeCheck.updateApplyWithoutFiles = await js(`(async () => { const r = await window.toolbox.updateApply(); return { rejected: r && r.ok === false, error: (r && r.error) || '' }; })()`);
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
  // 2026-11-27-4：自选本机文件更新（好包 + 坏包四种 + 降级确认 +
  // 白名单外忽略 + zip-slip 拒绝），直接调主进程 applyLocalUpdate
  //（不走 dialog，沙盒里弹不出文件选择框）。
  nativeCheck.localUpdate20261127 = await (async () => {
    const r = {};
    const tmpBase = path.join(os.tmpdir(), `toolbox-local-update-${Date.now().toString(36)}`);
    fs.mkdirSync(tmpBase, { recursive: true });
    const origMain = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const mainUnchanged = () => fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') === origMain;
    const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
    const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const makeZip = (files) => {
      const parts = []; const central = []; let offset = 0;
      for (const f of files) {
        const name = Buffer.from(f.name, 'utf8'); const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
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
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const nextInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) + 1}`);
    const nextDisplay = `${String(DISPLAY_VERSION).split('-').slice(0, 3).join('-')}-${(Number(String(DISPLAY_VERSION).split('-')[3]) || 0) + 1}`;
    const prevInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) - 1}`);
    const prevDisplay = `${String(DISPLAY_VERSION).split('-').slice(0, 3).join('-')}-${(Number(String(DISPLAY_VERSION).split('-')[3]) || 0) - 1}`;
    const writePkg = (name, manifest, fileMap) => {
      const entries = [];
      if (manifest) entries.push({ name: 'update-manifest.json', content: JSON.stringify(manifest) });
      for (const [rel, content] of Object.entries(fileMap || {})) entries.push({ name: rel, content });
      const p = path.join(tmpBase, name);
      fs.writeFileSync(p, makeZip(entries));
      return p;
    };
    const manifestFor = (internal, display, files) => ({ version: display, internalVersion: internal, displayVersion: display, releasedAt: '2026-11-27', notes: '', files });
    const newMain = (display) => origMain.replace(`const DISPLAY_VERSION = '${DISPLAY_VERSION}';`, `const DISPLAY_VERSION = '${display}';`);
    const backupDirFor = (v) => path.join(userDataDir(), 'update-backups', String(v).replace(/[^0-9A-Za-z._-]/g, '_'));
    try {
      // (a) 非 zip
      const notZip = path.join(tmpBase, 'notzip.zip');
      fs.writeFileSync(notZip, 'this is not a zip');
      const ra = await applyLocalUpdate(notZip, {});
      r.nonZipRejected = ra.ok === false && /不是有效的 zip/.test(ra.error || '') && mainUnchanged();
      // (b) 缺清单
      const noMan = writePkg('no-manifest.zip', null, { 'main.js': newMain(nextDisplay) });
      const rb = await applyLocalUpdate(noMan, {});
      r.noManifestRejected = rb.ok === false && /没有有效的更新清单/.test(rb.error || '') && mainUnchanged();
      // (c) 哈希不对（清单声称的 sha 与包内文件不符）
      const tampered = 'tampered-content';
      const badShaPkg = writePkg('bad-sha.zip',
        manifestFor(nextInternal, nextDisplay, [{ path: 'main.js', sha256: sha(tampered), size: tampered.length }]),
        { 'main.js': origMain });
      const rc = await applyLocalUpdate(badShaPkg, {});
      r.badShaRejected = rc.ok === false && /校验失败/.test(rc.error || '') && mainUnchanged();
      // (d) 版本更低、未确认降级
      const lowPkg = writePkg('low.zip',
        manifestFor(prevInternal, prevDisplay, [{ path: 'main.js', sha256: sha(newMain(prevDisplay)), size: Buffer.byteLength(newMain(prevDisplay)) }]),
        { 'main.js': newMain(prevDisplay) });
      const rd = await applyLocalUpdate(lowPkg, {});
      r.downgradeNeedsConfirm = rd.ok === false && rd.needsDowngrade === true && rd.file === lowPkg && mainUnchanged();
      // (e) zip-slip：含 ../ 条目，整个包直接拒绝
      const slipPkg = writePkg('slip.zip',
        manifestFor(nextInternal, nextDisplay, [{ path: 'main.js', sha256: sha(newMain(nextDisplay)), size: Buffer.byteLength(newMain(nextDisplay)) }]),
        { 'main.js': newMain(nextDisplay), '../evil.js': 'x' });
      const re = await applyLocalUpdate(slipPkg, {});
      r.zipSlipRejected = re.ok === false && /非法文件路径/.test(re.error || '') && mainUnchanged() && !fs.existsSync(path.join(__dirname, '..', 'evil.js'));
      // (f) 好包：版本更高、只 main.js 变化，清单里多一个白名单外文件
      const goodMain = newMain(`${nextDisplay}-local`);
      const goodPkg = writePkg('good.zip',
        manifestFor(nextInternal, nextDisplay, [
          { path: 'main.js', sha256: sha(goodMain), size: Buffer.byteLength(goodMain) },
          { path: 'preload.js', sha256: await sha256File(path.join(__dirname, 'preload.js')), size: fs.statSync(path.join(__dirname, 'preload.js')).size },
          { path: 'config.json', sha256: sha('x'), size: 1 },
        ]),
        { 'main.js': goodMain, 'preload.js': fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8') });
      const progress = [];
      const rf = await applyLocalUpdate(goodPkg, { onProgress: (j) => progress.push(j) });
      const stAfterGood = getUpdateState();
      r.goodOk = rf.ok === true && Array.isArray(rf.updated) && rf.updated.length === 1 && rf.updated[0] === 'main.js';
      r.goodIgnored = Array.isArray(rf.ignored) && rf.ignored.includes('config.json');
      r.goodFileChanged = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').includes(`const DISPLAY_VERSION = '${nextDisplay}-local';`);
      r.goodBackupExists = fs.existsSync(path.join(backupDirFor(nextInternal), 'main.js'))
        && fs.readFileSync(path.join(backupDirFor(nextInternal), 'main.js'), 'utf8') === origMain;
      r.goodStateSource = stAfterGood.source === 'local-file' && stAfterGood.localFileName === 'good.zip' && stAfterGood.pendingRestart === true;
      r.goodProgress = progress.some((j) => j.status === 'done' && j.pct === 100);
      // 回滚：从备份恢复，哈希应与原文件一致
      fs.copyFileSync(path.join(backupDirFor(nextInternal), 'main.js'), path.join(__dirname, 'main.js'));
      r.goodRollback = mainUnchanged();
      // (g) 降级包点确认后应成功降级
      const rg = await applyLocalUpdate(lowPkg, { confirmDowngrade: true, file: lowPkg });
      r.downgradeConfirmedOk = rg.ok === true && fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').includes(`const DISPLAY_VERSION = '${prevDisplay}';`);
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { fs.writeFileSync(path.join(__dirname, 'main.js'), origMain, 'utf8'); } catch (e) { /* 恢复失败会在 restored 里体现 */ }
      r.restored = mainUnchanged();
      try { fs.rmSync(backupDirFor(nextInternal), { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      try { fs.rmSync(backupDirFor(prevInternal), { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      saveUpdateState({ pendingRestart: false, updatedFiles: [], changedFiles: [], totalBytes: 0, source: '', localFileName: '', latestVersion: '', latestDisplayVersion: '' });
    }
    return r;
  })();
  // 2026-11-27-5：回滚到上一版本（无备份拒绝、有备份往返、钉住后检查跳过）。
  nativeCheck.rollback20261127 = await (async () => {
    const r = {};
    const tmpBase = path.join(os.tmpdir(), `toolbox-rollback-${Date.now().toString(36)}`);
    fs.mkdirSync(tmpBase, { recursive: true });
    const origMain = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const mainUnchanged = () => fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') === origMain;
    const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
    const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const makeZip = (files) => {
      const parts = []; const central = []; let offset = 0;
      for (const f of files) {
        const name = Buffer.from(f.name, 'utf8'); const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
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
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const nextInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) + 1}`);
    const nextDisplay = `${String(DISPLAY_VERSION).split('-').slice(0, 3).join('-')}-${(Number(String(DISPLAY_VERSION).split('-')[3]) || 0) + 1}`;
    const fakeMain = origMain
      .replace(`const VERSION = '${VERSION}';`, `const VERSION = '${nextInternal}';`)
      .replace(`const DISPLAY_VERSION = '${DISPLAY_VERSION}';`, `const DISPLAY_VERSION = '${nextDisplay}';`);
    const backupDirFor = (v) => path.join(userDataDir(), 'update-backups', String(v).replace(/[^0-9A-Za-z._-]/g, '_'));
    const base = path.join(userDataDir(), 'update-backups');
    // 暂移目录必须与原目录在同一文件系统（rename 跨设备会 EXDEV 失败），
    // 放 userDataDir 内、update-backups 外，回滚信息扫描不到它。
    const aside = path.join(userDataDir(), `update-backups-aside-${Date.now().toString(36)}`);
    try {
      // (a) 无备份时回滚信息为空、回滚拒绝（先把整个备份目录暂移走，用完移回）。
      let hadBase = false;
      try {
        if (fs.existsSync(base)) { fs.renameSync(base, aside); hadBase = true; }
        const infoEmpty = rollbackInfo();
        r.noBackupInfoEmpty = !infoEmpty.candidate && Array.isArray(infoEmpty.backups) && infoEmpty.backups.length === 0;
        const rbEmpty = await rollbackToolboxUpdate();
        r.noBackupRejected = rbEmpty.ok === false && /没有可用的备份/.test(rbEmpty.error || '');
      } finally {
        if (hadBase) { try { fs.renameSync(aside, base); } catch (e) { r.asideRestoreFailed = true; } }
      }
      // (b) 装一个假新版本（本地文件更新，只换 main.js），再回滚。
      const writePkg = (name, manifest, fileMap) => {
        const entries = [];
        if (manifest) entries.push({ name: 'update-manifest.json', content: JSON.stringify(manifest) });
        for (const [rel, content] of Object.entries(fileMap || {})) entries.push({ name: rel, content });
        const p = path.join(tmpBase, name);
        fs.writeFileSync(p, makeZip(entries));
        return p;
      };
      const manifestFor = (internal, display, files) => ({ version: display, internalVersion: internal, displayVersion: display, releasedAt: '2026-11-27', notes: '', files });
      const fakePkg = writePkg('fake-new.zip',
        manifestFor(nextInternal, nextDisplay, [{ path: 'main.js', sha256: sha(fakeMain), size: Buffer.byteLength(fakeMain) }]),
        { 'main.js': fakeMain });
      const applied = await applyLocalUpdate(fakePkg, {});
      r.applyOk = applied.ok === true && Array.isArray(applied.updated) && applied.updated.includes('main.js');
      r.appliedVersion = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').includes(`const VERSION = '${nextInternal}';`);
      const info = rollbackInfo();
      r.infoHasCandidate = !!info.candidate && info.candidate.version === VERSION && info.candidate.displayVersion === DISPLAY_VERSION;
      r.infoFromVersion = info.fromVersion === nextInternal;
      const rb = await rollbackToolboxUpdate();
      r.rollbackOk = rb.ok === true && rb.version === DISPLAY_VERSION;
      r.rollbackRestored = mainUnchanged();
      const stAfter = getUpdateState();
      r.pinnedSet = stAfter.pinnedVersion === nextInternal && stAfter.pendingRestart === true;
      r.rollbackBackupKept = fs.existsSync(path.join(`${backupDirFor(nextInternal)}-rollback`, 'main.js'));
      // (c) 钉住后检查更新跳过该版本（本地模拟清单，internalVersion 即被钉住的版本）。
      const pinnedManifest = { version: nextDisplay, internalVersion: nextInternal, displayVersion: nextDisplay, files: [] };
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pinnedManifest));
      });
      await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
      const url = `http://127.0.0.1:${srv.address().port}/update-manifest.json`;
      try {
        const chk = await checkToolboxUpdate({ manifestUrl: url });
        r.pinnedSkipped = chk.newer === false && /钉住/.test(chk.state.lastCheckMessage || '');
      } finally { try { srv.close(); } catch (e) { /* 忽略 */ } }
      // (d) 往返：再回滚一次应回到假新版本，钉住随之换成原版。
      const rb2 = await rollbackToolboxUpdate();
      r.roundTripOk = rb2.ok === true && rb2.version === nextDisplay
        && fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8').includes(`const VERSION = '${nextInternal}';`);
      const stAfter2 = getUpdateState();
      r.roundTripPinned = stAfter2.pinnedVersion === VERSION;
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { fs.writeFileSync(path.join(__dirname, 'main.js'), origMain, 'utf8'); } catch (e) { /* 恢复失败会在 restored 里体现 */ }
      r.restored = mainUnchanged();
      for (const d of [backupDirFor(nextInternal), `${backupDirFor(nextInternal)}-rollback`, `${backupDirFor(VERSION)}-rollback`]) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      }
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      try { fs.rmSync(aside, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      saveUpdateState({ pendingRestart: false, updatedFiles: [], changedFiles: [], totalBytes: 0, source: '', localFileName: '', latestVersion: '', latestDisplayVersion: '', pinnedVersion: '', manifestUrl: '', manifest: null, lastCheckResult: '', lastCheckMessage: '' });
    }
    return r;
  })();
  // 2026-11-27-4：一键发布（本地 HTTP 桩模拟 GitHub API：GET /repos
  // 权限探针、GET contents 取 sha、PUT contents 写文件）。
  nativeCheck.publish20261127 = await (async () => {
    const r = {};
    const prevToken = getConfig().githubToken || '';
    const prevProxy = { mode: getConfig().proxyMode, host: getConfig().proxyHost, port: getConfig().proxyPort };
    const putCalls = [];
    const contents = new Map([['desktop-toolbox/main.js', 'sha-main-old']]);
    let pushAllowed = true;
    let failPutAt = -1;
    const apiSrv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const repoBase = `/repos/${UPDATE_OWNER}/${UPDATE_REPO}`;
        if (req.method === 'GET' && u.pathname === repoBase) { send(200, { permissions: { push: pushAllowed } }); return; }
        if (u.pathname.startsWith(`${repoBase}/contents/`)) {
          const p = decodeURIComponent(u.pathname.slice(`${repoBase}/contents/`.length));
          if (req.method === 'GET') {
            if (contents.has(p)) send(200, { sha: contents.get(p), path: p });
            else send(404, { message: 'Not Found' });
            return;
          }
          if (req.method === 'PUT') {
            let parsed = {};
            try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }
            const idx = putCalls.length;
            putCalls.push({ path: p, message: parsed.message || '', branch: parsed.branch || '', sha: parsed.sha || null, content: parsed.content || '' });
            if (idx === failPutAt) { send(403, { message: 'Forbidden' }); return; }
            contents.set(p, `sha-new-${idx}`);
            send(200, { content: { sha: `sha-new-${idx}` } });
            return;
          }
        }
        send(404, { message: 'Not Found' });
      });
    });
    await new Promise((ok) => apiSrv.listen(0, '127.0.0.1', ok));
    const apiBase = `http://127.0.0.1:${apiSrv.address().port}`;
    const prevInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) - 1}`);
    const prevDisplay = `${String(DISPLAY_VERSION).split('-').slice(0, 3).join('-')}-${(Number(String(DISPLAY_VERSION).split('-')[3]) || 0) - 1}`;
    const nextInternal = String(VERSION).replace(/-(\d+)$/, (_m, n) => `-${Number(n) + 1}`);
    const nextDisplay = `${String(DISPLAY_VERSION).split('-').slice(0, 3).join('-')}-${(Number(String(DISPLAY_VERSION).split('-')[3]) || 0) + 1}`;
    const manSrv = http.createServer((req, res) => {
      if (req.url === '/lower.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ version: prevDisplay, internalVersion: prevInternal, displayVersion: prevDisplay, files: [] })); }
      else if (req.url === '/higher.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ version: nextDisplay, internalVersion: nextInternal, displayVersion: nextDisplay, files: [] })); }
      else { res.writeHead(404); res.end('not found'); }
    });
    await new Promise((ok) => manSrv.listen(0, '127.0.0.1', ok));
    const manBase = `http://127.0.0.1:${manSrv.address().port}`;
    try {
      saveConfig({ ...getConfig(), githubToken: 'selftest-fake-token', proxyMode: 'direct', proxyHost: '', proxyPort: '' });
      const stLow = await publishStatus({ manifestUrl: `${manBase}/lower.json` });
      r.statusLowerCanPublish = stLow.canPublish === true && stLow.localVersion === DISPLAY_VERSION && stLow.remoteVersion === prevDisplay && stLow.hasToken === true;
      const stHigh = await publishStatus({ manifestUrl: `${manBase}/higher.json` });
      r.statusHigherBlocked = stHigh.canPublish === false && /不高于仓库版本/.test(stHigh.reason || '');
      const stMissing = await publishStatus({ manifestUrl: `${manBase}/none.json` });
      r.statusNoManifestCanPublish = stMissing.canPublish === true && stMissing.remoteVersion === null && /还没有更新清单/.test(stMissing.reason || '');
      saveConfig({ ...getConfig(), githubToken: '' });
      const stNoToken = await publishStatus({ manifestUrl: `${manBase}/lower.json` });
      r.statusNoTokenBlocked = stNoToken.canPublish === false && /先在工具来源登录/.test(stNoToken.reason || '') && stNoToken.hasToken === false;
      saveConfig({ ...getConfig(), githubToken: 'selftest-fake-token' });
      // 成功发布：6 个文件、逐文件进度、PUT 带提交信息与分支
      pushAllowed = true; failPutAt = -1; putCalls.length = 0;
      const progress = [];
      const pub = await publishLocal({ apiBase, onProgress: (j) => progress.push(j) });
      r.publishOk = pub.ok === true && Array.isArray(pub.published) && pub.published.length === 6
        && pub.published[5] === 'update-manifest.json' && pub.failed.length === 0;
      r.publishPutCount = putCalls.length === 6;
      r.publishPutMessage = putCalls.every((c) => c.message === `桌面工具箱 ${DISPLAY_VERSION}` && c.branch === 'main');
      r.publishPutSha = putCalls[0] && putCalls[0].sha === 'sha-main-old' && putCalls.slice(1).every((c) => c.sha === null);
      r.publishProgress = progress.filter((j) => j.status === 'publishing').length === 6
        && progress.filter((j) => j.status === 'done').length === 6
        && progress.some((j) => j.index === 6 && j.total === 6);
      let pubManifest = null;
      try { pubManifest = JSON.parse(Buffer.from((putCalls[5] || {}).content || '', 'base64').toString('utf8')); } catch (e) { pubManifest = null; }
      r.publishManifestOk = !!(pubManifest && pubManifest.internalVersion === VERSION
        && Array.isArray(pubManifest.files) && pubManifest.files.length === 5
        && pubManifest.files.every((f) => HOT_UPDATE_FILES.includes(f.path)));
      r.publishManifestSha = !!(pubManifest && pubManifest.files[0].path === 'main.js'
        && pubManifest.files[0].sha256 === await sha256File(path.join(__dirname, 'main.js')));
      r.publishStateRecorded = getUpdateState().lastPublishVersion === DISPLAY_VERSION && !!getUpdateState().lastPublishAt;
      // 无写权限：探针失败即停，一个文件也不写
      pushAllowed = false; putCalls.length = 0;
      const noPerm = await publishLocal({ apiBase });
      r.noPushBlocked = noPerm.ok === false && /没有该仓库的写权限/.test(noPerm.error || '') && noPerm.published.length === 0 && putCalls.length === 0;
      // 中途失败：第三个文件 403，失败即停，已写/未写清单如实
      pushAllowed = true; failPutAt = 2; putCalls.length = 0;
      const midFail = await publishLocal({ apiBase });
      r.midFailStops = midFail.ok === false && midFail.published.length === 2 && midFail.failed.length === 4
        && /新旧混合状态/.test(midFail.error || '') && /已写/.test(midFail.error || '') && putCalls.length === 3;
      r.midFailDetail = /令牌没有写权限/.test(midFail.detail || '');
      // 版本同步检查
      const sync = checkVersionSync();
      r.versionSyncOk = sync.ok === true && sync.packageVersion === VERSION && sync.internalVersion === VERSION && sync.displayVersion === DISPLAY_VERSION;
      r.versionSyncMismatch = checkVersionSync({ version: '2026.11.27-99' }).ok === false;
      // 清单生成与脚本一致（文件集合与哈希）
      const built = buildUpdateManifest();
      r.manifestBuilt = built.internalVersion === VERSION && built.displayVersion === DISPLAY_VERSION
        && built.files.length === HOT_UPDATE_FILES.length
        && built.files.every((f) => HOT_UPDATE_FILES.includes(f.path) && f.sha256 && f.size > 0);
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { apiSrv.close(); } catch (e) { /* 忽略 */ }
      try { manSrv.close(); } catch (e) { /* 忽略 */ }
      saveConfig({ ...getConfig(), githubToken: prevToken, proxyMode: prevProxy.mode, proxyHost: prevProxy.host, proxyPort: prevProxy.port });
      saveUpdateState({ lastPublishAt: '', lastPublishVersion: '' });
    }
    return r;
  })();
  // 2026-11-27-11：一键发布新版本（版本 +1 后 git 提交推送）。
  // 自测只验计算与前置检查、dry-run 与 askpass 推送（本地 bare
  // 仓库），绝不碰真实仓库；按钮存在另在界面里验。
  nativeCheck.publishNewVersion20261127 = await (async () => {
    const r = {};
    try {
      // 版本 +1 计算（日期=当天、末尾每日重置为 0、当天每次修改后 +1；
      // 断言按当天台北日期动态算，不写死日期，免得第二天自测就失败）。
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const todayInt = todayStr.replace(/-/g, '.');
      const n1 = nextVersionFromInternal('2026.11.27-10');
      r.nextCalc = !!(n1 && n1.internal === `${todayInt}-1` && n1.display === `${todayStr}-1`);
      const n2 = nextVersionFromInternal(`${todayInt}-5`);
      r.nextCalc9 = !!(n2 && n2.internal === `${todayInt}-6` && n2.display === `${todayStr}-6`);
      r.nextBad = nextVersionFromInternal('not-a-version') === null && nextVersionFromInternal('') === null;
      // 按钮存在：进设置更新页。
      mainWin.webContents.send('test-goto', 'settings');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`document.querySelector('[data-tab=updates]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 500));
      r.buttonExists = await js(`!!document.querySelector('#update-publish-new')`);
      // 无令牌时明确报错、什么也不写（package.json 与 git 状态都不变）。
      const prevToken = getConfig().githubToken || '';
      const pkgBefore = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
      const statusBefore = (await runCmd('git', ['status', '--porcelain'], 15000, { cwd: __dirname })).out || '';
      saveConfig({ ...getConfig(), githubToken: '' });
      const noTok = await publishNewVersion({});
      r.noTokenBlocked = noTok.ok === false && /先在工具来源登录/.test(noTok.error || '');
      r.noTokenNoWrite = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8') === pkgBefore
        && ((await runCmd('git', ['status', '--porcelain'], 15000, { cwd: __dirname })).out || '') === statusBefore;
      // dry-run：算出下一版与白名单文件，不写任何东西。
      saveConfig({ ...getConfig(), githubToken: 'selftest-fake-token' });
      const dry = await publishNewVersion({ dryRun: true });
      const expectNext = nextVersionFromInternal(VERSION);
      r.dryRunOk = dry.ok === true && dry.dryRun === true && dry.nextVersion === (expectNext && expectNext.display)
        && Array.isArray(dry.files) && dry.files.includes('main.js') && dry.files.includes('update-manifest.json')
        && !dry.files.some((f) => /package-lock|screenshots|self-test-result\.json|server\/\.generated/.test(f));
      r.dryRunNoWrite = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8') === pkgBefore
        && ((await runCmd('git', ['status', '--porcelain'], 15000, { cwd: __dirname })).out || '') === statusBefore;
      // 真实推送（本地 bare 仓库 + 假令牌）：askpass 供令牌、推完即删。
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-gitpush-'));
      try {
        const repo = path.join(tmpBase, 'repo');
        const bare = path.join(tmpBase, 'remote.git');
        await runCmd('git', ['init', '--bare', '-b', 'main', bare], 15000);
        await runCmd('git', ['init', '-b', 'main', repo], 15000);
        fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n', 'utf8');
        await runCmd('git', ['add', 'a.txt'], 15000, { cwd: repo });
        await runCmd('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.com', 'commit', '-m', 'init'], 15000, { cwd: repo });
        const head = (await runCmd('git', ['rev-parse', 'HEAD'], 15000, { cwd: repo })).out.trim();
        const pushed = await gitPushRepo(repo, bare, 'fake-token-123', 'main');
        const remoteHead = (await runCmd('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], 15000)).out.trim();
        r.pushOk = pushed.ok === true && remoteHead === head;
        r.askpassDeleted = !lastGitAskpassDir || !fs.existsSync(lastGitAskpassDir);
        r.tokenNotLeaked = !JSON.stringify(pushed).includes('fake-token-123');
      } finally {
        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      }
      saveConfig({ ...getConfig(), githubToken: prevToken });
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-27-4：备份导出不含密钥（apiKey/webToken/webCookie/
  // webUserAgent 全部剥离；勾选“包含密钥”时才保留）。
  nativeCheck.backupSecrets20261127 = await (async () => {
    const r = {};
    const prevAgents = getAgents();
    try {
      saveAgents([{ id: 'selftest', name: '自测', provider: 'deepseek', apiKey: 'sk-secret-key', webToken: 'wt-secret', webCookie: 'ck-secret', webUserAgent: 'ua-secret', model: 'x' }]);
      const bak = collectBackup(false);
      const text = bak.files['agents.json'] || '';
      r.noApiKey = !text.includes('sk-secret-key');
      r.noWebToken = !text.includes('wt-secret');
      r.noWebCookie = !text.includes('ck-secret');
      r.noWebUserAgent = !text.includes('ua-secret');
      const bakWith = collectBackup(true);
      r.withSecretsKept = (bakWith.files['agents.json'] || '').includes('sk-secret-key');
    } catch (e) { r.error = e.message || String(e); }
    finally { saveAgents(prevAgents); }
    return r;
  })();
  // 2026-11-27-4：配置默认值（theme/wallpaperPath）与 set-config
  // 剥离 githubToken（传了也不落盘、不回显）。
  nativeCheck.configDefaults20261127 = await (async () => {
    const r = {};
    // 2026-11-28-8：saveConfig 是合并写（500ms 防抖），直接读文件前
    // 先强制落盘；恢复文件后清缓存，否则 getConfig 仍读旧缓存。
    flushConfigNow();
    const cfgPath = configPath();
    const origText = fs.readFileSync(cfgPath, 'utf8');
    try {
      const raw = JSON.parse(origText);
      delete raw.theme; delete raw.wallpaperPath;
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      const loaded = loadConfig();
      r.themeDefaultAuto = loaded.theme === 'auto';
      r.wallpaperDefaultEmpty = loaded.wallpaperPath === '';
    } catch (e) { r.error = e.message || String(e); }
    finally { try { fs.writeFileSync(cfgPath, origText, 'utf8'); } catch (e) { /* 忽略 */ } invalidateConfigCache(); }
    return r;
  })();
  nativeCheck.setConfigStripsToken20261127 = await (async () => {
    const r = {};
    const prevToken = getConfig().githubToken || '';
    try {
      const ret = await js(`(async () => {
        const before = await window.toolbox.getConfig();
        const ret = await window.toolbox.setConfig({ githubToken: 'should-not-be-saved', theme: 'dark' });
        const after = await window.toolbox.getConfig();
        await window.toolbox.setConfig({ theme: before.theme || 'auto' });
        return { retHasToken: ret.githubToken !== undefined, afterTheme: after.theme, beforeTheme: before.theme || 'auto' };
      })()`);
      // 2026-11-28-8：saveConfig 是 500ms 合并写，直接读文件前先强制落盘。
      flushConfigNow();
      const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
      r.returnedHasNoToken = ret.retHasToken === false;
      r.themeApplied = ret.afterTheme === 'dark';
      r.tokenNotSaved = raw.githubToken !== 'should-not-be-saved';
      r.tokenUnchanged = (raw.githubToken || '') === prevToken;
      r.themeRestored = (JSON.parse(fs.readFileSync(configPath(), 'utf8')).theme || 'auto') === (ret.beforeTheme || 'auto');
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-27-4：备份导入密码分支已接通（importBackupFile 的
  // AES-256-GCM 解密路径；backup-import IPC 现接受 {password}）。
  nativeCheck.backupImportPassword20261127 = await (async () => {
    const r = {};
    const enc = path.join(os.tmpdir(), 'toolbox-selftest-enc2.toolboxbak');
    try {
      await writeBackupFile(enc, { password: 'pw-27-4' });
      const noPw = await importBackupFile(enc, '');
      r.needsPassword = noPw && noPw.needsPassword === true && noPw.ok === false;
      const wrong = await importBackupFile(enc, 'nope');
      r.wrongRejected = wrong && wrong.ok === false && !wrong.needsPassword;
      const right = await importBackupFile(enc, 'pw-27-4');
      r.rightOk = right && right.ok === true;
    } catch (e) { r.error = e.message || String(e); }
    finally { try { fs.unlinkSync(enc); } catch (e) { /* 忽略 */ } }
    return r;
  })();
  // 2026-11-27-5：备份目录清理（只保留最近 2 个版本）。
  nativeCheck.pruneBackups20261127 = await (async () => {
    const r = {};
    const base = path.join(userDataDir(), 'update-backups');
    fs.mkdirSync(base, { recursive: true });
    const names = ['2026.11.20-1', '2026.11.21-1', '2026.11.22-1', '2026.11.23-1', '2026.11.24-1'];
    try {
      for (let i = 0; i < names.length; i++) {
        const d = path.join(base, names[i]);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'main.js'), 'x');
        const t = new Date(Date.now() - (names.length - i) * 60000);
        fs.utimesSync(d, t, t);
      }
      pruneUpdateBackups();
      const after = fs.readdirSync(base).filter((d) => names.includes(d));
      r.keptTwo = after.length === 2;
      r.keptNewest = after.includes('2026.11.24-1') && after.includes('2026.11.23-1');
      r.droppedOldest = !after.includes('2026.11.20-1') && !after.includes('2026.11.21-1') && !after.includes('2026.11.22-1');
    } catch (e) { r.error = e.message || String(e); }
    finally {
      for (const n of names) { try { fs.rmSync(path.join(base, n), { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
    }
    return r;
  })();
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
  // 2026-11-28-8：开机自启登录项是环境 skip（仅 Windows/macOS；
  // 沙盒 Linux 未设置），记 skip 不记 false。
  nativeCheck.windowStatus = await (async () => {
    const r = await js(`(async () => window.toolbox.windowStatus())()`);
    if (r && r.loginItem === false && process.platform !== 'win32' && process.platform !== 'darwin') {
      markSkipped('windowStatus.loginItem', '开机自启登录项仅 Windows/macOS，沙盒 Linux 未设置');
      r.loginItem = 'skipped';
    }
    return r;
  })();
  // 设置开关读写往返（改完恢复原值）
  // 2026-11-28-8：旧断言直接存开关值本身，设成 false 的 5 项（硬件加速、
  // 通知、透明、托盘、自启）读回 false 就被当失败记；改记“读回的值
  // 等于设下去的值”（应用即通过）。
  nativeCheck.winSettingsRoundTrip = await js(`(async () => {
    const before = await window.toolbox.getConfig();
    await window.toolbox.setConfig({ hardwareAcceleration: false, notificationsEnabled: false, preventSleep: true, alwaysOnTop: true, windowTransparent: false, closeToTray: false, autoStart: false });
    const mid = await window.toolbox.getConfig();
    await window.toolbox.setConfig({ hardwareAcceleration: before.hardwareAcceleration, notificationsEnabled: before.notificationsEnabled, preventSleep: before.preventSleep, alwaysOnTop: before.alwaysOnTop, windowTransparent: before.windowTransparent, closeToTray: before.closeToTray, autoStart: before.autoStart });
    const after = await window.toolbox.getConfig();
    return {
      mid: { hw: mid.hardwareAcceleration === false, notify: mid.notificationsEnabled === false, sleep: mid.preventSleep === true, top: mid.alwaysOnTop === true, trans: mid.windowTransparent === false, tray: mid.closeToTray === false, start: mid.autoStart === false },
      restored: after.hardwareAcceleration === before.hardwareAcceleration && after.closeToTray === before.closeToTray,
    };
  })()`);
  // 通知与防休眠调用不报错。2026-11-28-8：通知是环境 skip（沙盒无系统
  // 通知服务，Notification.isSupported() 为 false），记 skip。
  nativeCheck.notifyCall = (() => { try { const r = { ok: notify('自测通知', '这是一条自测通知'), supported: Notification.isSupported() }; if (!r.supported) { markSkipped('notifyCall.ok', '沙盒无系统通知服务（Notification.isSupported() 为 false）'); markSkipped('notifyCall.supported', '沙盒无系统通知服务（Notification.isSupported() 为 false）'); r.ok = 'skipped'; r.supported = 'skipped'; } return r; } catch (e) { return { ok: false, error: e.message }; } })();
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
  nativeCheck.findToolboxbakArg = {
    hit: findToolboxbakArg(['electron', '.', 'C:\\Users\\x\\a.toolboxbak']),
    miss: findToolboxbakArg(['electron', '.', 'C:\\Users\\x\\notes.txt']),
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
  // 清理自测写入的本地数据，恢复到自测前（2026-11-28-8：accounts
  // 用 saveAccounts 写回，保持带 version 的 v1 格式）
  saveAccounts(snapshot.accounts);
  saveAgents(snapshot.agents);
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
  saveConfig({ ...getConfig(), ...snapshot.winSettings, proxyMode: snapshot.proxyMode, proxyHost: snapshot.proxyHost, proxyPort: snapshot.proxyPort, proxyServers: snapshot.proxyServers, ledgerCategories: snapshot.ledgerCategories, syncFolder: snapshot.syncFolder, activeAccountId: snapshot.activeAccountId, lastRegisterAt: snapshot.lastRegisterAt, registerIntervalMin: snapshot.registerIntervalMin, phoneRemote: { enabled: snapshot.phoneRemoteEnabled } });
  // 2026-11-28-8：saveConfig 是 500ms 合并写，这里是自测恢复，必须立即
  // 落盘，否则收尾 SIGKILL 时恢复会丢、沙盒配置被污染。
  flushConfigNow();
  try { fs.rmSync(path.join(userDataDir(), 'crash-log.json'), { force: true }); } catch (e) { /* 崩溃日志删不掉不影响 */ }
  try { fs.rmSync(path.join(os.tmpdir(), 'toolbox-watch-test'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  try { if (snapshot.mailtm) fs.writeFileSync(path.join(userDataDir(), 'mailtm.json'), snapshot.mailtm); else fs.rmSync(path.join(userDataDir(), 'mailtm.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { if (snapshot.updateState) fs.writeFileSync(path.join(userDataDir(), 'update-state.json'), snapshot.updateState); else fs.rmSync(path.join(userDataDir(), 'update-state.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  // 2026-11-28-5：手机远程状态与证书恢复；自测前服务在跑时恢复监听。
  try { if (snapshot.phoneRemote) fs.writeFileSync(path.join(userDataDir(), 'phone-remote.json'), snapshot.phoneRemote); else fs.rmSync(path.join(userDataDir(), 'phone-remote.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { if (snapshot.phoneRemoteCert) fs.writeFileSync(path.join(userDataDir(), 'phone-remote-cert.json'), snapshot.phoneRemoteCert); else fs.rmSync(path.join(userDataDir(), 'phone-remote-cert.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  if (snapshot.phoneRemoteWasRunning) { try { await phoneRemoteApplyEnabled(); } catch (e) { /* 恢复监听失败不影响 */ } }
  try { fs.rmSync(path.join(userDataDir(), 'code-runs'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
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
    // 2026-11-28-8：未知软件查不到图标、非 Windows 取不到 exe 图标、
    // 空路径取不到图标，都是预期的优雅拒绝，改记 notFound / rejected。
    r.unknownDiscover = await (async () => { const d = await resolveDiscoverIcon({ id: 'Some.Random.App', name: '随机软件', source: 'winget' }); return { notFound: d && d.ok === false, reason: (d && d.reason) || '' }; })();
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
    r.installedNonWindows = await (async () => { const d = await getInstalledAppIcon('/tmp/fake.exe'); return { rejected: d && d.ok === false, error: (d && d.error) || '' }; })();
    r.installedNoExe = await (async () => { const d = await getInstalledAppIcon(''); return { rejected: d && d.ok === false, error: (d && d.error) || '' }; })();
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
      // 2026-11-28-4：旧 formatPioneerIpResult 已随 -13 的 IP 纯净度检测删掉，
      // format 组改测 formatPioneerPurity（分数、等级、失败原因、缓存标记）。
      pioneerPurityOk: formatPioneerPurity({ ok: true, ip: '1.2.3.4', score: 95, grade: '优秀', reasons: ['出口国家与所选地区一致', '未检测到代理特征'] }),
      pioneerPurityBad: formatPioneerPurity({ ok: true, ip: '5.6.7.8', score: 40, grade: '较差', reasons: ['机房/云厂商出口', '出口国家与所选地区不一致'] }),
      pioneerPurityFail: formatPioneerPurity({ ok: false, error: '检测服务不通' }),
      pioneerPurityCached: formatPioneerPurity({ ok: true, ip: '1.2.3.4', score: 88, grade: '良好', reasons: [], fromCache: true }),
    }))()`);
    return {
      adminUnsupportedSaysUnknown: /未检测到/.test(t.adminUnsupported) && !/否（未用/.test(t.adminUnsupported),
      adminNoneSaysUnknown: /未检测到/.test(t.adminNone) && !/否（未用/.test(t.adminNone),
      adminYesShowsMethod: /是（已用管理员身份运行）/.test(t.adminYes) && /powershell-principal/.test(t.adminYes),
      adminNoShowsMethod: /否（未用管理员身份运行）/.test(t.adminNo) && /whoami-groups/.test(t.adminNo),
      pioneerPurityOkShowsScore: /出口 IP 1\.2\.3\.4/.test(t.pioneerPurityOk) && /95 分/.test(t.pioneerPurityOk) && /优秀/.test(t.pioneerPurityOk),
      pioneerPurityBadShowsGrade: /较差/.test(t.pioneerPurityBad) && /40 分/.test(t.pioneerPurityBad) && /机房/.test(t.pioneerPurityBad),
      pioneerPurityFailShowsError: /纯净度检测失败/.test(t.pioneerPurityFail) && /检测服务不通/.test(t.pioneerPurityFail),
      pioneerPurityCachedMarked: /上次结果/.test(t.pioneerPurityCached) && /可重新测/.test(t.pioneerPurityCached),
    };
  })();
  // 登录提示（2026-11-27-3 严格指纹）：未命中已登录凭证不弹提示；
  // 命中凭证才弹一次；同域名 10 分钟内只弹一次；忽略标记生效；
  // 点确认后只建占位记录落盘（且不含用户名/密码字段）。
  nativeCheck.loginPrompt20261127 = await (async () => {
    const r = {};
    const lpSniffPrev = await js(`sniffEnabled`);
    await js(`setSniffEnabled(false);`);
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
      for (const a of getAccounts().filter((x) => (x.siteName || '') === 'ignore-test.example')) { try { await js(`(async () => { await window.toolbox.accountDelete(${JSON.stringify(a.id)}); })()`); } catch (e) { /* 删不掉不影响 */ } }
      // 清理桩 3 落盘的忽略标记。
      const ig = loginIgnoreLoad(); delete ig['ignore-test.example']; loginIgnoreSave(ig);
      r.ignoreCleaned = !isLoginIgnored('ignore-test.example');
    } catch (e) { r.error = e.message || String(e); }
    await js(`setSniffEnabled(${!!lpSniffPrev});`);
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
  // 2026-11-27-8：系统代理接管只验命令本身（纯函数，不写注册表），
  // 沙盒是 Linux，接管/复位在非 Windows 上必须是空操作。
  nativeCheck.sysProxy20261127 = await (async () => {
    const r = {};
    const g = windowsSystemProxyCommands(true, 'global', '', null);
    r.globalSetsServer = g.some((c) => c[1].includes('ProxyServer') && c[1].includes('127.0.0.1:19352'));
    r.globalEnables = g.some((c) => c[1].includes('ProxyEnable') && c[1].includes('1'));
    r.globalClearsPac = g.some((c) => c[0] === 'reg' && c[1][0] === 'delete' && c[1].includes('AutoConfigURL'));
    const s = windowsSystemProxyCommands(true, 'smart', 'file:///D:/x/pioneer-smart.pac', null);
    r.smartSetsPac = s.some((c) => c[1].includes('AutoConfigURL') && c[1].includes('file:///D:/x/pioneer-smart.pac'));
    r.smartDisablesProxy = s.some((c) => c[1].includes('ProxyEnable') && c[1].includes('0'));
    const prev = { ProxyEnable: { type: 'REG_DWORD', data: '0x1' }, ProxyServer: { type: 'REG_SZ', data: '10.0.0.1:8080' }, ProxyOverride: null, AutoConfigURL: null };
    const off = windowsSystemProxyCommands(false, '', '', prev);
    r.restoreReaddsServer = off.some((c) => c[1].includes('ProxyServer') && c[1].includes('10.0.0.1:8080'));
    r.restoreDeletesPac = off.some((c) => c[0] === 'reg' && c[1][0] === 'delete' && c[1].includes('AutoConfigURL'));
    const offNoPrev = windowsSystemProxyCommands(false, '', '', null);
    r.noPrevDisables = offNoPrev.some((c) => c[1].includes('ProxyEnable') && c[1].includes('0'));
    try { await setWindowsSystemProxy(true, 'global'); await setWindowsSystemProxy(false); pioneerResetSystemProxySync(); r.offWindowsNoop = true; } catch (e) { r.offWindowsNoop = false; }
    return r;
  })();
  // 2026-11-28-8：WinTun 4 项全是环境 skip（仅 Windows；bundled zip
  // 不进仓库，沙盒无驱动文件），记 skip 不记 false。
  nativeCheck.wintunDll20261127 = await (async () => {
    const r = {};
    const out = await ensureWintunDll();
    r.ensureOk = !!(out && out.ok);
    r.dllExists = fs.existsSync(wintunDll());
    try { r.dllHashMatches = (await sha256File(wintunDll())) === BUNDLED_SHA256.wintunDllAmd64; } catch (e) { r.dllHashMatches = false; }
    try { r.zipHashMatches = (await sha256File(bundledZipPath('wintun'))) === BUNDLED_SHA256.wintunZip; } catch (e) { r.zipHashMatches = false; }
    if (process.platform !== 'win32') {
      for (const k of ['ensureOk', 'dllExists', 'dllHashMatches', 'zipHashMatches']) {
        if (r[k] === false) { markSkipped(`wintunDll20261127.${k}`, 'WinTun 仅 Windows；bundled zip 不进仓库，沙盒无驱动文件'); r[k] = 'skipped'; }
      }
    }
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
  // 2026-11-27-10，第 8 项：数据嗅探开关——小圆点只在开启后常驻，点两次回原状态。
  const sniffPrev = await js(`(async () => { const ov = await window.toolbox.getOverview(); return !!(ov && ov.config && ov.config.sniffEnabled); })()`);
  await clickMenu('video');
  nativeCheck.sniffToggle = await js(`(async () => {
    const btn = document.querySelector('#sniff-toggle');
    const fabHidden = () => document.querySelector('#browser-media-fab').classList.contains('hidden');
    const before = fabHidden();
    btn.click(); await new Promise((r) => setTimeout(r, 600));
    const mid = fabHidden();
    btn.click(); await new Promise((r) => setTimeout(r, 600));
    const after = fabHidden();
    return { toggles: before !== mid && after === before, toggleExists: !!btn };
  })()`);
  // 浏览器视频实时嗅探：本地测试页（video 标签拉 mp4，fetch 拉 m3u8/mpd/ts
  // 分片；<script src=*.ts> 不应被当成媒体），验主进程事件、小圆点、嗅探框、换页清空。
  // 小圆点常驻：先开启嗅探再进浏览器页；换页后列表清空，但小圆点不隐藏。
  nativeCheck.browserMediaSniff = await (async () => {
    const r = {};
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
    // 2026-11-28-3：空页改走 localhost——登录态自测组会在 127.0.0.1
    //（同一分区 cookie 按 host 存、与端口无关）留一个 auth_session
    // cookie，空页若还走 127.0.0.1，换页后新页扫描会把它重新抓进池，
    // clearedOnNav 永远失败。这是测试隔离问题，不是产品 bug：换页清池
    // 本身正常，新页的登录态扫描本来就该上报新页的 cookie。
    const emptyUrl = `http://localhost:${port}/empty.html`;
    try {
      const before = browserMediaStats.emitted;
      await js(`setSniffEnabled(true);`);
      // 统一嗅探：监听只在总开关开启时挂（开启挂、关闭摘），所以在
      // 开启后核对默认分区已挂上。
      r.hookedDefaultPartition = browserMediaSniffedPartitions.has('persist:toolbox-browser');
      r.hookedPartitions = [...browserMediaSniffedPartitions];
      mainWin.webContents.send('test-goto', 'browser');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`chromeGo(${JSON.stringify(testUrl)});`);
      let got = [];
      for (let i = 0; i < 16; i++) {
        await new Promise((res2) => setTimeout(res2, 500));
        try { got = await js(`sniffItems.map((x) => x.url + "|" + x.type + "|" + (x.pageUrl || ""))`); } catch (e) { got = []; }
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
      // 换页清空：再打开一个无媒体页，did-navigate 应清掉列表；小圆点常驻，不隐藏。
      mainWin.webContents.send('test-goto', 'browser');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`chromeGo(${JSON.stringify(emptyUrl)});`);
      await new Promise((res2) => setTimeout(res2, 1500));
      r.clearedOnNav = await js(`sniffItems.length === 0`);
      // 2026-11-28-3 诊断：清不掉时记下池里剩了什么（字符串，不计布尔叶）。
      r.clearedOnNavPool = await js(`JSON.stringify(sniffItems)`);
      r.clearedOnNavHost = await js(`sniffSiteHost`);
      r.fabStaysAfterNav = await js(`!document.querySelector('#browser-media-fab').classList.contains('hidden')`);
    } catch (e) { r.error = e.message || String(e); }
    finally { try { srv.close(); } catch (e) { /* 关不掉不影响 */ } }
    return r;
  })();
  // 2026-11-27-11：统一嗅探——总开关挂/摘、去重、video-sniff 同格式、
  // 登录态（Set-Cookie + 响应体 token + localStorage）、WS/SSE 流式、
  // 请求日志与接口清单、历史落盘（打码）、内嵌 JSON。
  // 令牌全是自测假值；结果里只记布尔与计数，不记完整令牌值。
  nativeCheck.sniffUnified20261127 = await (async () => {
    const r = {};
    const JWT2 = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMSJ9.0123456789abcdef0123456789abcdef';
    const COOKIE_VAL = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const waitFor = async (fn, timeoutMs = 8000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        try { if (await fn()) return true; } catch (e) { /* 继续等 */ }
        await new Promise((res2) => setTimeout(res2, 400));
      }
      return false;
    };
    const pool = async () => {
      // 登录态/页面数据条目没有 url 字段（只有 name/sourceUrl），这里
      // 统一兜底为空串，调用方才能直接用 x.url.includes。
      try { return await js(`sniffItems.map((x) => ({ url: x.url || x.sourceUrl || '', category: x.category, name: x.name || '', type: x.type || '', messages: x.messages || 0, preview: x.preview || '' }))`); } catch (e) { return []; }
    };
    // 在内嵌 webview（#toolbox-webview）的页面里执行 JS：登录按钮、
    // WS/SSE 触发、页面钩子标志都在访客页里，主窗口 document 里没有。
    const wvJs = async (code) => {
      try { return await js(`document.querySelector('#toolbox-webview').executeJavaScript(${JSON.stringify(code)})`); } catch (e) { return undefined; }
    };
    const gotoBrowser = async (url) => {
      mainWin.webContents.send('test-goto', 'browser');
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`chromeGo(${JSON.stringify(url)});`);
    };
    const srv = http.createServer((req, res) => {
      if (req.url === '/page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><title>sniff2</title><video src="/test.mp4" autoplay muted playsinline></video><img src="/big.jpg"><img src="/tiny.png"><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"apiBase":"https://api.example.com/v1","access_token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456ghi789jkl012mno345pqr678stu901"}}}</script><script>fetch("/test.m3u8").catch(()=>{});fetch("/api/data/123").catch(()=>{});fetch("/api/data/456").catch(()=>{});</script>');
      } else if (req.url === '/login.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><title>login</title><button id="do-login">登录</button><script>document.getElementById("do-login").addEventListener("click", async () => { const r = await fetch("/api/login", { method: "POST" }); const j = await r.json(); localStorage.setItem("ds_token", j.access_token); document.title = "logged-in"; });</script>');
      } else if (req.url === '/ws.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><meta charset="utf-8"><title>ws</title><button id="do-ws">连接</button><script>document.getElementById("do-ws").addEventListener("click", () => { const ws = new WebSocket("ws://127.0.0.1:${srv.address().port}/ws"); window.__wsCount = 0; ws.addEventListener("message", () => { window.__wsCount += 1; }); });</script>`);
      } else if (req.url === '/sse.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><title>sse</title><button id="do-sse">订阅</button><script>document.getElementById("do-sse").addEventListener("click", () => { fetch("/events").then((r) => r.text()).then((t) => { window.__sseDone = true; }); });</script>');
      } else if (req.url === '/empty.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><title>empty</title><p>no media</p>'); }
      else if (req.url === '/test.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112])); }
      else if (req.url === '/test.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end('#EXTM3U\n#EXT-X-VERSION:3\n'); }
      else if (req.url === '/big.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(200 * 1024) }); res.end(Buffer.alloc(200 * 1024, 0xFF)); }
      else if (req.url === '/tiny.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '1024' }); res.end(Buffer.alloc(1024)); }
      else if (req.url === '/api/login' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `auth_session=${COOKIE_VAL}; HttpOnly; Path=/; Max-Age=3600` });
        res.end(JSON.stringify({ access_token: JWT2, refresh_token: `rt-${'0123456789abcdef0123456789abcdef'}`, token_type: 'Bearer' }));
      }
      else if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.end('data: {"delta":"hello "}\n\ndata: {"delta":"world"}\n\n');
      }
      else if (req.url === '/api/data/123' || req.url === '/api/data/456') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }
      else { res.writeHead(404); res.end(); }
    });
    srv.on('upgrade', (req, socket) => {
      if (!String(req.url || '').startsWith('/ws')) { try { socket.destroy(); } catch (e) { /* 忽略 */ } return; }
      const key = req.headers['sec-websocket-key'] || '';
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const sendFrame = (text) => {
        const payload = Buffer.from(text, 'utf8');
        let header;
        if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
        else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
        try { socket.write(Buffer.concat([header, payload])); } catch (e) { /* 忽略 */ }
      };
      setTimeout(() => sendFrame(JSON.stringify({ type: 'chat', text: 'hello stream one' })), 300);
      setTimeout(() => sendFrame(JSON.stringify({ type: 'chat', text: 'hello stream two' })), 600);
      setTimeout(() => { try { socket.end(); } catch (e) { /* 忽略 */ } }, 1500);
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = srv.address().port;
    const pageUrl = `http://127.0.0.1:${port}/page.html`;
    const loginUrl = `http://127.0.0.1:${port}/login.html`;
    const wsUrl = `http://127.0.0.1:${port}/ws.html`;
    const sseUrl = `http://127.0.0.1:${port}/sse.html`;
    try {
      // 总开关：开着挂监听。
      await js(`setSniffEnabled(true);`);
      await new Promise((res2) => setTimeout(res2, 600));
      r.hooksOn = browserMediaSniffedPartitions.has('persist:toolbox-browser');
      // 媒体分类 + 大小：mp4 视频、m3u8 直播流、大图进池（带大小）、
      // 小图不过线、lib.ts 不进池。
      await gotoBrowser(pageUrl);
      const gotMedia = await waitFor(async () => {
        const items = await pool();
        return items.some((x) => x.url.includes('/test.mp4')) && items.some((x) => x.url.includes('/test.m3u8')) && items.some((x) => x.url.includes('/big.jpg'));
      }, 10000);
      const items1 = await pool();
      r.mediaFound = gotMedia;
      r.mp4IsVideo = items1.some((x) => x.url.includes('/test.mp4') && x.category === 'video');
      r.m3u8IsLive = items1.some((x) => x.url.includes('/test.m3u8') && x.category === 'live');
      r.bigImageFound = items1.some((x) => x.url.includes('/big.jpg') && x.category === 'image');
      r.bigImageSize = await js(`(sniffItems.find((x) => (x.url || '').includes('/big.jpg')) || {}).sizeBytes >= ${200 * 1024}`);
      r.tinyImageExcluded = !items1.some((x) => x.url.includes('/tiny.png'));
      // 同一条请求只进池一次：主进程重复发同一条，池不涨。
      // 同一条请求只进池一次：主进程重复发同一条，池里该条不涨。
      // 2026-11-28-4：只数 mp4 条数，不比池总长——总长会受在途的
      // 分片/页面数据条目影响（-12 已抖动过；run6–8 诊断：500ms 内
      // 多了 5 条 sourceUrl=page.html 的登录态/页面数据条目，与去重无关）。
      // 先等池子稳定（连续两次读数相同），再发重复条。
      const mp4 = `http://127.0.0.1:${port}/test.mp4`;
      const countMp4 = async () => (await pool()).filter((x) => x.url === mp4).length;
      let stable = 0, lastLen = -1;
      for (let i = 0; i < 10; i++) {
        const n = (await pool()).length;
        if (n === lastLen) { stable++; if (stable >= 2) break; } else stable = 0;
        lastLen = n;
        await new Promise((res2) => setTimeout(res2, 400));
      }
      const mp4Before = await countMp4();
      const urlsBefore = (await pool()).map((x) => x.url || '').join(',');
      mainWin.webContents.send('browser-media-found', { url: mp4, type: 'mp4', pageUrl });
      mainWin.webContents.send('browser-media-found', { url: mp4, type: 'mp4', pageUrl });
      await new Promise((res2) => setTimeout(res2, 500));
      r.dedupSameRequest = (await countMp4()) === mp4Before && mp4Before >= 1;
      r.dedupUrlsBefore = urlsBefore;
      r.dedupUrlsAfter = (await pool()).map((x) => x.url || '').join(',');
      r.mainSeenDedup = browserMediaSeen.has(mp4);
      // video-sniff 与实时嗅探同格式；内嵌 JSON（__NEXT_DATA__）能抓到。
      const vs = await videoSniff(pageUrl);
      r.videoSniffFormat = vs.ok === true && Array.isArray(vs.items) && vs.items.length >= 3
        && vs.items.every((it) => typeof it.url === 'string' && typeof it.category === 'string' && typeof it.kind === 'string' && typeof it.via === 'string' && ['video', 'live', 'audio', 'image', 'document', 'other'].includes(it.category));
      r.videoSniffPageData = Array.isArray(vs.pageData) && vs.pageData.some((d) => String(d.name || '').includes('access_token'));
      r.videoSniffImageCat = vs.items.some((it) => String(it.url || '').includes('/big.jpg') && it.category === 'image');
      // sniff-auth-cookies 不再抛错（正常与坏参数都不抛）。
      const sac1 = await sniffAuthCookies(pageUrl, 'persist:toolbox-browser');
      r.authCookiesOk = !!(sac1 && sac1.ok === true && Array.isArray(sac1.cookies));
      const sac2 = await sniffAuthCookies('', '');
      r.authCookiesBadArgs = !!(sac2 && sac2.ok === false);
      const sac3 = await sniffAuthCookies('not a url', 'persist:toolbox-browser');
      r.authCookiesBadUrl = !!(sac3 && sac3.ok === false);
      // 登录态：模拟登录响应（Set-Cookie + 响应体 access_token +
      // localStorage 写入）能被分类抓到、值打码、重复不报。
      await gotoBrowser(loginUrl);
      const loginBtn = await waitFor(async () => { try { return await wvJs(`!!document.querySelector('#do-login')`); } catch (e) { return false; } }, 8000);
      r.loginPageLoaded = loginBtn === true;
      r.loginWvUrl = await js(`document.querySelector('#toolbox-webview')?.getURL?.() || ''`);
      await wvJs(`document.querySelector('#do-login')?.click();`);
      const gotAuth = await waitFor(async () => {
        const items = await pool();
        return items.some((x) => x.category === 'cookie' && x.name === 'auth_session')
          && items.some((x) => x.category === 'resp-body' && x.name === 'access_token');
      }, 10000);
      await js(`scanAuthStorageAndPageData('test')`);
      await new Promise((res2) => setTimeout(res2, 800));
      const items2 = await pool();
      r.authCookieFound = gotAuth && items2.some((x) => x.category === 'cookie' && x.name === 'auth_session');
      r.authRespTokenFound = items2.some((x) => x.category === 'resp-body' && x.name === 'access_token');
      r.authStorageFound = items2.some((x) => x.category === 'storage' && String(x.name || '').includes('ds_token'));
      // 值打码：面板里只见打码值，不见完整令牌（先切到登录态页签）。
      await js(`if (document.querySelector('#browser-media-panel').classList.contains('hidden')) document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res2) => setTimeout(res2, 800));
      await js(`document.querySelector('[data-sniff-tab="auth"]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 400));
      const panelText = await js(`document.querySelector('#browser-media-list').textContent || ''`);
      r.authMasked = String(panelText).includes('•••') && !String(panelText).includes(JWT2) && !String(panelText).includes(COOKIE_VAL);
      // 重复不报：再扫一次，登录态条目数不变。
      const authCountBefore = items2.filter((x) => ['cookie', 'storage', 'req-header', 'resp-body'].includes(x.category)).length;
      await js(`scanAuthStorageAndPageData('test2')`);
      await new Promise((res2) => setTimeout(res2, 800));
      const authCountAfter = (await pool()).filter((x) => ['cookie', 'storage', 'req-header', 'resp-body'].includes(x.category)).length;
      r.authNoDup = authCountAfter === authCountBefore;
      // 请求日志：记方法、状态、耗时；接口清单按域名分组、去重、带次数。
      const logOk = await waitFor(async () => {
        try { return await js(`sniffReqLog.some((e) => e.method === 'POST' && e.url.includes('/api/login') && e.status === 200 && typeof e.durationMs === 'number')`); } catch (e) { return false; }
      }, 8000);
      r.reqLogPost = logOk;
      r.reqLogHasPage = await js(`sniffReqLog.some((e) => e.type === '页面' && e.url.includes('/login.html'))`);
      r.reqLogLen = await js(`sniffReqLog.length`);
      r.reqLogUrls = await js(`sniffReqLog.map((e) => e.method + ' ' + e.url).slice(0, 8)`);
      r.reqLogTypes = await js(`sniffReqLog.map((e) => (e.type || '?') + ' ' + e.method + ' ' + e.url).slice(0, 8)`);
      const apiList = await js(`deriveSniffApiList(sniffReqLog)`);
      r.apiListGrouped = Array.isArray(apiList) && apiList.some((g) => g.host === '127.0.0.1' && g.apis.some((a) => a.method === 'POST' && a.path === '/api/login' && a.count >= 1));
      const apiSynth = await js(`deriveSniffApiList([{method:'GET',url:'http://127.0.0.1:9/api/users/123'},{method:'GET',url:'http://127.0.0.1:9/api/users/456'},{method:'POST',url:'http://127.0.0.1:9/api/login'}])`);
      r.apiListDedup = Array.isArray(apiSynth) && apiSynth.length === 1 && apiSynth[0].apis.some((a) => a.method === 'GET' && a.path === '/api/users/{id}' && a.count === 2);
      // 请求日志详情：先切到请求日志页签，再点一条看完整请求头响应头。
      // （Network 面板分页签：mock 登录 POST 没发 body，请求头里没有
      // content-type，切到“响应头”页签再验 application/json。）
      await js(`if (document.querySelector('#browser-media-panel').classList.contains('hidden')) document.querySelector('#browser-media-fab')?.click(); document.querySelector('[data-sniff-tab="reqlog"]')?.click();`);
      await new Promise((res2) => setTimeout(res2, 500));
      await js(`document.querySelector('#sniff-net-list .sniff-net-table tbody tr')?.click();`);
      await new Promise((res2) => setTimeout(res2, 600));
      await js(`[...document.querySelectorAll('#sniff-net-detail .sniff-net-detail-tabs .tab')].find((b) => b.textContent === '响应头')?.click();`);
      const detailOk = await waitFor(async () => {
        try { const t = await js(`document.querySelector('#browser-media-list').textContent || ''`); return String(t).includes('响应头') && String(t).toLowerCase().includes('content-type'); } catch (e) { return false; }
      }, 6000);
      r.reqDetailShown = detailOk;
      r.reqDetailDiag = await js(`({ rows: document.querySelectorAll('#sniff-net-list .sniff-net-table tbody tr').length, detailEls: document.querySelectorAll('#sniff-net-detail .sniff-req-detail').length, detailId: (typeof sniffReqDetailId !== 'undefined' && sniffReqDetailId) ? String(sniffReqDetailId).slice(0, 12) : 'none', panelTextLen: (document.querySelector('#browser-media-list').textContent || '').length })`);
      // 历史：落盘重读还在、令牌打码保存、能删。
      const histId = await js(`saveSniffHistorySnapshot('127.0.0.1')`);
      r.historySaved = typeof histId === 'string' && !!histId;
      let histFileText = '';
      try { histFileText = fs.readFileSync(sniffHistoryFile(), 'utf8'); } catch (e) { histFileText = ''; }
      r.historyMaskedOnDisk = !!histId && histFileText.includes('eyJh•••') && !histFileText.includes(JWT2) && !histFileText.includes(COOKIE_VAL);
      r.historyReload = !!histId && sniffHistoryListEntries().entries.some((e) => e.id === histId);
      r.historyGet = !!histId && sniffHistoryGetEntry(histId).ok === true && (sniffHistoryGetEntry(histId).items || []).length > 0;
      if (histId) sniffHistoryDeleteEntry(histId);
      r.historyDeleted = !!histId && !sniffHistoryListEntries().entries.some((e) => e.id === histId);
      try { if (sniffHistoryLoad().length === 0) fs.unlinkSync(sniffHistoryFile()); } catch (e) { /* 忽略 */ }
      // WS 流式：模拟帧能进池（条数与摘要）。
      await gotoBrowser(wsUrl);
      const hooked = await waitFor(async () => { try { return await wvJs(`window.__toolboxSniffHooked === true`); } catch (e) { return false; } }, 8000);
      r.wsHooked = hooked;
      await wvJs(`document.querySelector('#do-ws')?.click();`);
      const wsFrames = await waitFor(async () => { try { return (await wvJs(`window.__wsCount || 0`)) >= 2; } catch (e) { return false; } }, 8000);
      r.wsFramesArrived = wsFrames;
      await new Promise((res2) => setTimeout(res2, 3000));
      const items3 = await pool();
      r.wsStreamFound = items3.some((x) => x.category === 'stream' && String(x.url || '').includes('/ws') && Number(x.messages || 0) >= 2 && String(x.preview || '').includes('hello stream'));
      // SSE 流式：event-stream 两条 data 能进池（先等页面钩子注入完再点，
      // 否则 fetch 走原生实现、扫不到）。
      await gotoBrowser(sseUrl);
      await waitFor(async () => { try { return await wvJs(`window.__toolboxSniffHooked === true`); } catch (e) { return false; } }, 8000);
      await wvJs(`document.querySelector('#do-sse')?.click();`);
      const sseDone = await waitFor(async () => { try { return await wvJs(`window.__sseDone === true`); } catch (e) { return false; } }, 8000);
      r.sseFetched = sseDone;
      await new Promise((res2) => setTimeout(res2, 3000));
      const items4 = await pool();
      r.sseStreamFound = items4.some((x) => x.category === 'stream' && String(x.url || '').includes('/events') && Number(x.messages || 0) === 2);
      // 总开关关闭后监听不再产生新条目：摘掉监听、再进媒体页池仍为空。
      await js(`setSniffEnabled(false);`);
      await new Promise((res2) => setTimeout(res2, 600));
      r.toggleOffHooksRemoved = browserMediaSniffedPartitions.size === 0;
      r.toggleOffRefresh = refreshSniffHooks().enabled === false;
      await gotoBrowser(pageUrl);
      await new Promise((res2) => setTimeout(res2, 2500));
      r.toggleOffNoNewEntries = (await pool()).length === 0;
      // 重新开：监听挂回来。
      await js(`setSniffEnabled(true);`);
      await new Promise((res2) => setTimeout(res2, 600));
      r.toggleOnHooksBack = browserMediaSniffedPartitions.has('persist:toolbox-browser');
    } catch (e) { r.error = e.message || String(e); }
    finally { try { srv.close(); } catch (e) { /* 关不掉不影响 */ } }
    return r;
  })();
  await js(`setSniffEnabled(${sniffPrev});`);
  // GitHub 页自检：无令牌时搜仓库应提示先登录（不调 GitHub API）
  mainWin.webContents.send('test-goto', 'tools');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-tab=updates]')?.click(); document.querySelector('[data-subtab=github]')?.click(); const gi = document.querySelector('#github-search-input'); if (gi) { gi.value='vlc'; document.querySelector('#github-search-btn')?.click(); }");
  await shot('github');
  // 2026-11-28-12：第 1 项——嗅探小圆点：开启后在非浏览器屏也可见、
  // 位置越界自动复位、点开/点关嗅探框。
  nativeCheck.sniffFab20261128 = await (async () => {
    const r = {};
    const fabSniffPrev = await js(`sniffEnabled`);
    try {
      await js(`setSniffEnabled(true);`);
      await new Promise((res2) => setTimeout(res2, 600));
      await clickMenu('toolbox');
      const fab = await js(`(() => { const f = document.querySelector('#browser-media-fab'); if (!f) return null; const rc = f.getBoundingClientRect(); return { hidden: f.classList.contains('hidden'), x: rc.x, y: rc.y, w: rc.width, h: rc.height, vw: window.innerWidth, vh: window.innerHeight }; })()`);
      r.visibleOnHomeScreen = !!fab && !fab.hidden && fab.w > 0 && fab.x >= 0 && fab.y >= 0 && fab.x + fab.w <= fab.vw && fab.y + fab.h <= fab.vh;
      // 位置越界：往 localStorage 写一个窗外位置，复位函数应把它拉回窗内。
      await js(`localStorage.setItem('sniff-fab-pos', JSON.stringify({ x: 99999, y: 99999 })); restoreSniffFabPos();`);
      await new Promise((res2) => setTimeout(res2, 300));
      const clamped = await js(`(() => { const f = document.querySelector('#browser-media-fab'); if (!f) return null; const rc = f.getBoundingClientRect(); return { x: rc.x, y: rc.y, w: rc.width, h: rc.height, vw: window.innerWidth, vh: window.innerHeight }; })()`);
      r.clampedIntoViewport = !!clamped && clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.w <= clamped.vw && clamped.y + clamped.h <= clamped.vh;
      // 点小圆点开嗅探框，再点关掉。
      const panelBefore = await js(`!document.querySelector('#browser-media-panel')?.classList.contains('hidden')`);
      await js(`document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res2) => setTimeout(res2, 400));
      const panelAfterOpen = await js(`!document.querySelector('#browser-media-panel')?.classList.contains('hidden')`);
      await js(`document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res2) => setTimeout(res2, 400));
      const panelAfterClose = await js(`!document.querySelector('#browser-media-panel')?.classList.contains('hidden')`);
      r.clickTogglesPanel = panelAfterOpen === true && panelAfterClose === false;
      r.panelWasClosedBefore = panelBefore === false;
    } catch (e) { r.error = e.message || String(e); }
    await js(`setSniffEnabled(${!!fabSniffPrev});`);
    return r;
  })();
  // 2026-11-28-12：第 2 项——浏览器内嵌：Chrome / Edge 打开即进内嵌
  // webview（按种类分区），不弹外部窗口；launchBrowserApp 返回 ok 并
  // 切到浏览器屏。
  nativeCheck.embeddedBrowser20261128 = await (async () => {
    const r = {};
    try {
      await clickMenu('browser');
      await js(`openBrowserApp('chrome');`);
      await new Promise((res2) => setTimeout(res2, 800));
      const chromeView = await js(`(() => { const wv = document.querySelector('#toolbox-webview'); return { screen: document.querySelector('.screen.active')?.id || '', chromiumVisible: !document.querySelector('#browser-chromium-view')?.classList.contains('hidden'), partition: wv ? wv.getAttribute('partition') : '' }; })()`);
      r.chromeEmbedded = chromeView.screen === 'screen-browser' && chromeView.chromiumVisible && chromeView.partition === 'persist:toolbox-chrome';
      await js(`openBrowserApp('edge');`);
      await new Promise((res2) => setTimeout(res2, 800));
      const edgeView = await js(`(() => { const wv = document.querySelector('#toolbox-webview'); return { screen: document.querySelector('.screen.active')?.id || '', chromiumVisible: !document.querySelector('#browser-chromium-view')?.classList.contains('hidden'), partition: wv ? wv.getAttribute('partition') : '' }; })()`);
      r.edgeEmbedded = edgeView.screen === 'screen-browser' && edgeView.chromiumVisible && edgeView.partition === 'persist:toolbox-edge';
      const launch = await js(`(async () => { const res = await window.toolbox.launchBrowserApp('chrome', 'https://example.com'); return { ok: !!(res && res.ok), embedded: !!(res && res.embedded), screen: document.querySelector('.screen.active')?.id || '', partition: document.querySelector('#toolbox-webview')?.getAttribute('partition') || '' }; })()`);
      r.launchReturnsEmbedded = launch.ok === true && launch.embedded === true && launch.screen === 'screen-browser' && launch.partition === 'persist:toolbox-chrome';
      r.noOtherView = await js(`!document.querySelector('#browser-other-view')`);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-12：第 4 / 5 / 7 项——工具箱软件台账：记一笔、列表里
  // 能看到、销账后消失；软件页菜单项存在。
  nativeCheck.toolboxApps20261128 = await (async () => {
    const r = {};
    try {
      recordToolboxApp({ key: 'selftest-app', name: '自测软件', kind: 'player', wingetId: '', exe: '', installLocation: '' });
      r.recordedInStatus = toolboxAppsStatus().some((a) => a.key === 'selftest-app');
      const listed = await js(`(async () => { const res = await window.toolbox.toolboxAppsList(); return res && res.ok && Array.isArray(res.rows) ? res.rows.some((x) => x.key === 'selftest-app') : false; })()`);
      r.recordedInListIpc = listed === true;
      removeToolboxApp('selftest-app');
      r.removedFromStatus = !toolboxAppsStatus().some((a) => a.key === 'selftest-app');
      r.appsMenuExists = await js(`!!document.querySelector('.menu-item[data-menu=apps]')`);
      await clickMenu('apps');
      r.appsScreenOpens = await js(`document.querySelector('.screen.active')?.id`) === 'screen-apps';
      r.appsListRendered = await js(`!!document.querySelector('#toolbox-apps-list')`);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-12：第 8 项——右侧顶栏可拖动（计算样式或样式表规则任一
  // 为准；按钮等交互元素必须是 no-drag）。
  nativeCheck.dragRegion20261128 = await js(`(() => { const heads = [...document.querySelectorAll('.screen-head')]; const ruleDrag = [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((x) => x.cssText && x.cssText.includes('.screen-head') && x.cssText.includes('-webkit-app-region: drag')); } catch (e) { return false; } }); const headDrag = heads.length > 0 && heads.every((h) => { const cs = getComputedStyle(h).webkitAppRegion; return cs === 'drag' || ruleDrag; }); const btn = document.querySelector('#screen-browser > .screen-head [data-nav="back"]'); const btnCs = btn ? getComputedStyle(btn).webkitAppRegion : ''; const btnRule = [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((x) => x.cssText && x.cssText.includes('.screen-head') && x.cssText.includes('no-drag')); } catch (e) { return false; } }); const tabsEl = document.querySelector('.tabs'); const tabsCs = tabsEl ? getComputedStyle(tabsEl).webkitAppRegion : ''; const tabsRule = [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((x) => x.cssText && /^\.tabs\s*\{/.test(x.cssText) && x.cssText.includes('-webkit-app-region: drag')); } catch (e) { return false; } }); return { headDrag, backBtnNoDrag: btnCs === 'no-drag' || btnRule, headsCount: heads.length, tabsDrag: tabsCs === 'drag' || tabsRule }; })()`);
  // 2026-11-28-12：第 10 项——版本号规则：日期=当天、末尾每日重置为 0、
  // 当天每次修改后 +1。断言按当天台北日期动态算，不写死日期。
  nativeCheck.publishVersion20261128 = await (async () => {
    const r = {};
    try {
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const todayInt = todayStr.replace(/-/g, '.');
      const prev = nextVersionFromInternal('2026.11.27-11');
      r.crossDayResetsToOne = !!(prev && prev.internal === `${todayInt}-1` && prev.display === `${todayStr}-1`);
      const same = nextVersionFromInternal(`${todayInt}-5`);
      r.sameDayPlusOne = !!(same && same.internal === `${todayInt}-6` && same.display === `${todayStr}-6`);
      r.badInputNull = nextVersionFromInternal('not-a-version') === null;
      const out = execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'publish.js'), '--dry-run'], { cwd: __dirname, encoding: 'utf8', timeout: 60000, windowsHide: true });
      // 2026-11-28-3：断言按当前 VERSION 算出的下一版，不再写死 -1——
      // -2 之后当前已是 -2，dry-run 应报 -3；写死 -1 在 -2 发布后必挂。
      const next = nextVersionFromInternal(VERSION);
      r.dryRunSaysNextVersion = !!(next && String(out || '').includes(next.display));
      r.dryRunNextVersion = next ? next.display : null;
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-2：便携版 Chromium 已删除——相关入口已无、内嵌浏览
  // 仍正常、设置/扩展页无死链接、台账与自检里无 Chromium 标记。
  nativeCheck.portableChromiumRemoved20261128 = await (async () => {
    const r = {};
    try {
      r.noDownloadButton = await js(`!document.querySelector('#browser-download')`);
      r.noSettingsView = await js(`!document.querySelector('#browser-chromium-settings-view')`);
      r.noExtView = await js(`!document.querySelector('#browser-chromium-ext-view')`);
      r.noExtButton = await js(`!document.querySelector('#chrome-ext-btn')`);
      r.noMenuExtOrSettings = await js(`!document.querySelector('[data-chrome-act="extensions"]') && !document.querySelector('[data-chrome-act="settings"]')`);
      r.noPreloadBridge = await js(`typeof window.toolbox.browserStatus === 'undefined' && typeof window.toolbox.browserDownload === 'undefined' && typeof window.toolbox.chromiumExtensions === 'undefined'`);
      const apps = await js(`(async () => window.toolbox.browserApps())()`);
      r.embeddedAlwaysAvailable = !!(apps && apps.chromium && apps.chromium.found === true && apps.chromium.embedded === true);
      r.toolboxAppsNoChromium = !toolboxAppsStatus().some((a) => a.key === 'chromium');
      r.recommendedNoChromium = await js(`!document.querySelector('#recommended-list .row[data-app-key="chromium"]')`);
      r.browserStatusText = await js(`(document.querySelector('#browser-status')?.textContent || '').includes('无需下载')`);
      // 启动清理：放一个假的旧便携版目录，清理函数应把它删掉。
      const dir = path.join(toolsDir(), 'chromium');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'dummy.txt'), 'x');
      cleanupPortableChromium();
      r.portableDirCleaned = !fs.existsSync(dir);
      // 内嵌浏览仍正常：打开 Chromium 分区进内嵌视图。
      await clickMenu('browser');
      await js(`openBrowserApp('chromium');`);
      await new Promise((res2) => setTimeout(res2, 800));
      const view = await js(`(() => { const wv = document.querySelector('#toolbox-webview'); return { screen: document.querySelector('.screen.active')?.id || '', chromiumVisible: !document.querySelector('#browser-chromium-view')?.classList.contains('hidden'), partition: wv ? wv.getAttribute('partition') : '' }; })()`);
      r.embeddedStillWorks = view.screen === 'screen-browser' && view.chromiumVisible && view.partition === 'persist:toolbox-browser';
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-3：清理剥离轮——空间集成入口已无（内嵌空间 webview、
  // 空间悬浮圆点、空间地址、muse-toolbox:// 协议、远程小助手入口、
  // 雷神加速器不在工具箱里）、死 IPC 与死桥已删、本地功能仍正常。
  nativeCheck.decouple20261128 = await (async () => {
    const r = {};
    try {
      const q = (sel) => document.querySelector(sel);
      const gone = await js(`(() => {
        const ids = ['#space-fab', '#screen-space', '#space-webview', '#space-setup', '#screen-remote', '#space-call-toggle', '#cfg-space-url', '#register-protocol', '#protocol-status', '#remote-allow', '#remote-code', '#space-url-input'];
        const missing = ids.filter((id) => !!document.querySelector(id));
        const menuItems = [...document.querySelectorAll('#menu-grid .menu-item')].map((b) => b.dataset.menu);
        const settingsTabs = [...document.querySelectorAll('#settings-tabs .tab')].map((b) => b.dataset.settingsTab);
        return { missing, menuItems, menuCount: menuItems.length, hasRemoteMenu: menuItems.includes('remote'), settingsTabs, hasSpaceTab: settingsTabs.includes('space') };
      })()`);
      r.spaceElementsGone = gone.missing.length === 0;
      r.spaceElementsGoneDetail = gone.missing;
      // 2026-11-28-6：菜单 14 → 15 项（新增“屏幕翻译”入口）。
      r.menuCount15 = gone.menuCount === 15;
      r.menuCount = gone.menuCount;
      r.noRemoteMenu = gone.hasRemoteMenu === false;
      r.noSpaceSettingsTab = gone.hasSpaceTab === false;
      const bridges = await js(`(() => {
        const t = window.toolbox || {};
        const names = ['remoteStart', 'remoteStop', 'remoteServerStatus', 'remoteInfo', 'remoteRegenCode', 'registerProtocol', 'ledgerList', 'ledgerAdd', 'ledgerDelete', 'ledgerExport', 'ledgerClear', 'agentChatDelete', 'githubSearch', 'videoExtract', 'videoEnginesStatus', 'videoDownloadsList', 'videoDownloadOpen', 'wingetUninstall', 'browserLaunch', 'openDefaultApps', 'windowState', 'pickVlc', 'registerMailtmAccount', 'pioneerSetMode', 'getAppIcon'];
        return names.filter((n) => typeof t[n] === 'function');
      })()`);
      r.deadBridgesGone = bridges.length === 0;
      r.deadBridgesStillPresent = bridges;
      // 配置默认值里无空间键（loadConfig 源码断言）。磁盘旧配置里残留的
      // spaceUrl/spaceCallEnabled/remotePairCode 是惰性数据——代码已不再读
      // 它们，所以这里只报现状字符串，不当布尔叶计（旧键在位是预期内）。
      const cfgSrc = loadConfig.toString();
      r.configDefaultsNoSpaceKeys = !cfgSrc.includes('spaceUrl') && !cfgSrc.includes('spaceCallEnabled') && !cfgSrc.includes('remoteEnabled') && !cfgSrc.includes('remotePairCode');
      const cfg = await js(`(async () => { const c = await window.toolbox.getConfig(); return { hasSpaceUrl: 'spaceUrl' in c, hasSpaceCall: 'spaceCallEnabled' in c, hasRemoteEnabled: 'remoteEnabled' in c, hasRemotePair: 'remotePairCode' in c }; })()`);
      r.configKeysDetail = JSON.stringify(cfg);
      const ov = await js(`(async () => { const o = await window.toolbox.getOverview(); return { hasSpaceCall: 'spaceCallEnabled' in o, hasProtocol: 'protocolRegistered' in o }; })()`);
      r.overviewNoSpaceFields = ov.hasSpaceCall === false && ov.hasProtocol === false;
      // 本地功能仍正常：进智能体屏、进浏览器屏（内嵌 webview 在位）
      await clickMenu('agents');
      r.agentsScreenOk = await js(`document.querySelector('.screen.active')?.id`) === 'screen-agents';
      await clickMenu('browser');
      const browserView = await js(`(() => { const s = document.querySelector('.screen.active')?.id; return { screen: s, currentScreen, currentBrowserView }; })()`);
      r.browserScreenOk = browserView.screen === 'screen-browser';
      r.browserScreenActual = JSON.stringify(browserView);
      await clickMenu('toolbox');
      r.backHomeOk = await js(`document.querySelector('.screen.active')?.id`) === 'screen-home';
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-4（-13 批）：嗅探预览/页签/拖动、Pioneer 按钮式地区与
  // IP 纯净度、代理模式后移、软件页去 VLC/Chromium、应用商城式推荐、
  // 文件目录树与右键菜单、注册三页、浏览器铺满、菜单缩放。
  nativeCheck.toolbox20261128 = await (async () => {
    const r = {};
    try {
      // --- 嗅探：引擎说明、分析按钮已删、页签与预览 ---
      const sniffPrev13 = await js(`sniffEnabled`);
      await js(`setSniffEnabled(true);`);
      await new Promise((res) => setTimeout(res, 500));
      await js(`(function () { sniffItems = []; sniffReqLog = []; sniffHistoryView = null; upsertSniffItem({ category: 'video', url: 'http://127.0.0.1:9/test.mp4', type: 'mp4', host: '127.0.0.1', pageUrl: 'http://127.0.0.1:9/' }); upsertSniffItem({ category: 'image', url: 'http://127.0.0.1:9/big.jpg', type: 'jpg', host: '127.0.0.1', pageUrl: 'http://127.0.0.1:9/' }); upsertSniffItem({ category: 'cookie', name: 'sess', value: 'abc123', host: '127.0.0.1', sourceUrl: 'http://127.0.0.1:9/' }); })();`);
      await js(`if (document.querySelector('#browser-media-panel').classList.contains('hidden')) document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res) => setTimeout(res, 500));
      // 2026-11-28-7：第 2 项：引擎说明默认折叠，点名称展开，状态持久化。
      await js(`localStorage.removeItem('sniff-info-open'); renderSniffEngineInfo();`);
      r.engineInfoCollapsed = await js(`!!document.querySelector('#sniff-engine-info .sniff-info-head') && !document.querySelector('#sniff-engine-info .sniff-info-list')`);
      await js(`document.querySelector('#sniff-engine-info .sniff-info-head')?.click();`);
      await new Promise((res) => setTimeout(res, 300));
      const sniffInfo = await js(`(document.querySelector('#sniff-engine-info')?.textContent || '')`);
      r.engineInfoSelfBuilt = /自研/.test(sniffInfo) && /无第三方/.test(sniffInfo) && /yt-dlp/.test(sniffInfo);
      r.engineInfoPersisted = await js(`localStorage.getItem('sniff-info-open') === '1'`);
      await js(`document.querySelector('#sniff-engine-info .sniff-info-head')?.click();`);
      await new Promise((res) => setTimeout(res, 300));
      r.engineInfoCollapses = await js(`!document.querySelector('#sniff-engine-info .sniff-info-list') && localStorage.getItem('sniff-info-open') === '0'`);
      r.analyzeButtonGone = await js(`!document.querySelector('#sniff-analyze')`);
      const tabs = await js(`[...document.querySelectorAll('#sniff-tabs [data-sniff-tab]')].map((b) => b.dataset.sniffTab + ':' + (b.textContent || ''))`);
      r.sniffTabsPresent = tabs.some((t) => t.startsWith('video:')) && tabs.some((t) => t.startsWith('image:')) && tabs.some((t) => t.startsWith('auth:'));
      r.sniffTabCounts = tabs.join(',');
      // 切到图片页签：只剩图片行，视频行不在。
      await js(`document.querySelector('[data-sniff-tab="image"]')?.click();`);
      await new Promise((res) => setTimeout(res, 400));
      r.sniffTabSwitches = await js(`(function () { const t = document.querySelector('#browser-media-list').textContent || ''; return t.includes('/big.jpg') && !t.includes('/test.mp4'); })()`);
      // 视频预览：切回视频页签，点预览出现 video 元素，再点收起。
      await js(`document.querySelector('[data-sniff-tab="video"]')?.click();`);
      await new Promise((res) => setTimeout(res, 400));
      r.previewButtonPresent = await js(`[...document.querySelectorAll('#browser-media-list .row button')].some((b) => (b.textContent || '') === '预览')`);
      await js(`[...document.querySelectorAll('#browser-media-list .row button')].find((b) => (b.textContent || '') === '预览')?.click();`);
      await new Promise((res) => setTimeout(res, 600));
      r.previewShowsVideo = await js(`!!document.querySelector('#browser-media-list video.sniff-preview')`);
      await js(`[...document.querySelectorAll('#browser-media-list .row button')].find((b) => (b.textContent || '') === '收起预览')?.click();`);
      await new Promise((res) => setTimeout(res, 300));
      r.previewCollapses = await js(`!document.querySelector('#browser-media-list video.sniff-preview')`);
      // 嗅探框拖动/改大小：写一个越界位置，恢复函数应夹回窗内并写行内样式。
      await js(`localStorage.setItem('sniff-panel-rect', JSON.stringify({ left: 99999, top: 99999, width: 500, height: 400 })); restoreSniffPanelRect();`);
      await new Promise((res) => setTimeout(res, 300));
      const panelRect = await js(`(function () { const p = document.querySelector('#browser-media-panel'); if (!p) return null; const rc = p.getBoundingClientRect(); return { left: rc.left, top: rc.top, w: rc.width, vw: window.innerWidth, vh: window.innerHeight, hasGrip: !!document.querySelector('#sniff-panel-resize'), hasHead: !!document.querySelector('#sniff-panel-head') }; })()`);
      r.panelRectClamped = !!panelRect && panelRect.left >= 0 && panelRect.top >= 0 && panelRect.left + 120 <= panelRect.vw && panelRect.top + 60 <= panelRect.vh && panelRect.hasGrip && panelRect.hasHead;
      await js(`localStorage.removeItem('sniff-panel-rect'); (function () { const p = document.querySelector('#browser-media-panel'); if (!p) return; p.style.left = ''; p.style.top = ''; p.style.width = ''; p.style.height = ''; p.style.maxHeight = ''; p.style.right = ''; p.style.bottom = ''; })();`);
      // 视频引擎入口：桥在位，未知引擎名明确拒绝（不走网络）。
      r.videoEngineBridge = await js(`typeof window.toolbox.videoEngineDownload === 'function'`);
      r.videoEngineUnknownRejected = (await downloadVideoEngine('nope')).ok === false;
      // --- Pioneer：地区按钮组、日志折叠、纯净度纯函数与落盘 ---
      await clickMenu('proxy');
      await new Promise((res) => setTimeout(res, 400));
      r.pioneerRegionGroup = await js(`!!document.querySelector('#pioneer-region-group') && !document.querySelector('#pioneer-region')`);
      r.pioneerLogToggle = await js(`!!document.querySelector('#pioneer-log-toggle')`);
      r.pioneerIpButtonRenamed = await js(`(document.querySelector('#pioneer-ip-check')?.textContent || '') === 'IP 纯净度检测'`);
      const proxyTabs = await js(`[...document.querySelectorAll('#screen-proxy [data-proxy-tab]')].map((b) => b.dataset.proxyTab).join(',')`);
      r.proxyOrderPioneerFirst = proxyTabs.split(',')[0] === 'pioneer';
      r.proxyPioneerActive = await js(`document.querySelector('#proxy-tab-pioneer')?.classList.contains('active') === true`);
      // 日志折叠：点一次折叠，日志区隐藏；再点展开。
      await js(`localStorage.setItem('pioneer-log-collapsed', '0'); applyPioneerLogCollapsed(); document.querySelector('#pioneer-log-toggle')?.click();`);
      await new Promise((res) => setTimeout(res, 300));
      r.pioneerLogCollapses = await js(`document.querySelector('#pioneer-log')?.classList.contains('hidden') === true && (document.querySelector('#pioneer-log-toggle')?.textContent || '') === '展开'`);
      await js(`document.querySelector('#pioneer-log-toggle')?.click();`);
      await new Promise((res) => setTimeout(res, 300));
      r.pioneerLogExpands = await js(`document.querySelector('#pioneer-log')?.classList.contains('hidden') === false`);
      // 纯净度记分（纯函数，不走网络）：机房 ASN -30、国家不一致 -15。
      r.purityDatacenter = scoreIpPurity({ org: 'Google LLC', country: 'US' }, 'US').score === 70;
      r.purityResidential = scoreIpPurity({ org: 'Chunghwa Telecom Co., Ltd.', country: 'TW' }, 'TW').score === 100;
      r.purityMismatch = scoreIpPurity({ org: 'Chunghwa Telecom', country: 'TW' }, '日本').score === 85;
      r.purityGrades = scoreIpPurity({ org: 'Google LLC', country: 'US' }, 'US').grade === '良好' && scoreIpPurity({ org: 'Chunghwa Telecom', country: 'TW' }, 'TW').grade === '优秀';
      // 按 IP 记忆：写一条再读出来，测完删掉（不污染真实记录）。
      saveIpPurity({ byIp: { '203.0.113.99': { score: 88, grade: '良好', reasons: ['自测'], checkedAt: 1 } }, byRegion: {} });
      r.purityRemembered = loadIpPurity().byIp['203.0.113.99']?.score === 88;
      const _pp = loadIpPurity(); delete _pp.byIp['203.0.113.99']; saveIpPurity(_pp);
      r.purityBridge = await js(`typeof window.toolbox.pioneerIpPurity === 'function' && typeof window.toolbox.pioneerIpPurityGet === 'function'`);
      // --- 软件页：VLC/Chromium 行拿掉；已安装页不再列文件已不在的行 ---
      r.appsNoVlcChromium = !(toolboxAppsStatus().some((x) => x.key === 'vlc' || x.key === 'chromium'));
      r.installedHidesMissing = await js(`(function () { installedRows = [{ id: 'ghost', name: '幽灵软件', kind: 'tool', source: 'toolbox-winget', found: false, path: '', version: '' }]; applyInstalledFilter(); const n = document.querySelectorAll('#installed-list .row').length; loadInstalled(); return n === 0; })()`);
      // --- 文件：目录树、展开、右键菜单 ---
      await clickMenu('files');
      await js(`renderFiles(${JSON.stringify(__dirname)})`);
      await new Promise((res) => setTimeout(res, 800));
      r.treeRows = await js(`document.querySelectorAll('#files-list .files-tree-row').length`);
      r.treeHasCaret = await js(`document.querySelectorAll('#files-list .tree-caret').length > 0`);
      r.treeExpand = await js(`(async function () { const row = [...document.querySelectorAll('#files-list .files-tree-row')].find((x) => (x.dataset.path || '').endsWith('/renderer')); if (!row) return false; row.querySelector('.tree-caret')?.click(); await new Promise((res2) => setTimeout(res2, 900)); return [...document.querySelectorAll('#files-list .files-tree-row')].some((x) => (x.dataset.path || '').indexOf('/renderer/') >= 0); })()`);
      r.treeCtxMenu = await js(`(function () { const row = document.querySelector('#files-list .files-tree-row'); if (!row) return false; row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })); const m = document.querySelector('#files-context-menu'); const ok = m && !m.classList.contains('hidden') && [...m.querySelectorAll('[data-files-ctx]')].map((b) => b.dataset.filesCtx).join(',') === 'open,delete'; document.querySelector('#files-context-menu [data-files-ctx="open"]')?.click(); return !!ok; })()`);
      // --- 注册：三页顺序邮箱→短信→平台，平台页有目录、收码工具条隐藏 ---
      await clickMenu('register');
      await new Promise((res) => setTimeout(res, 500));
      r.regTabOrder = await js(`[...document.querySelectorAll('#screen-register .tab')].map((b) => b.dataset.regTab).join(',') === 'email,sms,platform'`);
      r.regDefaultEmail = await js(`document.querySelector('#screen-register .tab.active')?.dataset.regTab === 'email'`);
      await js(`gotoRegTab('platform');`);
      await new Promise((res) => setTimeout(res, 500));
      r.regPlatformDir = await js(`document.querySelectorAll('#reg-platforms-directory .store-card').length >= 30 && [...document.querySelectorAll('#reg-platforms-directory .store-desc')].some((x) => (x.textContent || '').includes('github.com/signup'))`);
      r.regPlatformHidesTools = await js(`document.querySelector('#screen-register').classList.contains('reg-platform-mode') && document.querySelector('#reg-extract').offsetParent === null`);
      await js(`gotoRegTab('email');`);
      // --- 浏览器铺满：浏览器屏 flex 占满，chrome-view flex 生长，窗口放大跟着放大 ---
      // 先切到浏览器屏（openBrowserApp 只切屏内视图，不切屏；
      // 前一步在注册屏，不切屏 #screen-browser 没 .active，量出来是 0），
      // 再让 webview 真显示（刚进浏览器页是 #chrome-start 起始页，
      // #chrome-view 带 hidden，高为 0，量它得先 loadChromeWebview）。
      await js(`gotoScreen('browser');`);
      await new Promise((res) => setTimeout(res, 500));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res) => setTimeout(res, 800));
      await js(`loadChromeWebview('about:blank');`);
      await new Promise((res) => setTimeout(res, 800));
      r.browserFills = await js(`(function () { const s = document.querySelector('#screen-browser'); const v = document.querySelector('#chrome-view'); if (!s || !v) return false; const cs = getComputedStyle(s); const cv = getComputedStyle(v); return cs.display === 'flex' && cv.flexGrow === '1' && !v.classList.contains('hidden'); })()`);
      const hBefore = await js(`document.querySelector('#chrome-view')?.getBoundingClientRect().height || 0`);
      const winSize = mainWin.getSize();
      mainWin.setSize(winSize[0], winSize[1] + 200);
      await new Promise((res) => setTimeout(res, 800));
      const hAfter = await js(`document.querySelector('#chrome-view')?.getBoundingClientRect().height || 0`);
      mainWin.setSize(winSize[0], winSize[1]);
      await new Promise((res) => setTimeout(res, 500));
      r.browserGrowsWithWindow = hAfter > hBefore + 100;
      r.browserHeights = hBefore + '->' + hAfter;
      // --- 菜单缩放：拖宽夹在 200–480、缩放夹在 80%–150%、贴合恢复默认 ---
      await js(`applySidebarWidth(300);`);
      r.sidebarWidth300 = await js(`Math.abs(document.querySelector('#sidebar').offsetWidth - 300) <= 2`);
      await js(`applySidebarWidth(100);`);
      r.sidebarWidthClamped = await js(`Math.abs(document.querySelector('#sidebar').offsetWidth - 200) <= 2`);
      await js(`applyUiZoom(1.2);`);
      r.zoom120 = await js(`window.toolbox.getZoomFactor().zoom === 1.2`);
      await js(`applyUiZoom(2);`);
      r.zoomClampedMax = await js(`window.toolbox.getZoomFactor().zoom === 1.5`);
      await js(`applyUiZoom(0.5);`);
      r.zoomClampedMin = await js(`window.toolbox.getZoomFactor().zoom === 0.8`);
      await js(`document.querySelector('#setting-layout-reset')?.click();`);
      await new Promise((res) => setTimeout(res, 500));
      r.layoutSnap = await js(`Math.abs(document.querySelector('#sidebar').offsetWidth - 340) <= 2 && window.toolbox.getZoomFactor().zoom === 1`);
      r.layoutSaved = await js(`(async function () { const ov = await window.toolbox.getOverview(); return ov && ov.config && ov.config.sidebarWidth === 340 && ov.config.uiZoom === 1; })()`);
      // 收尾：嗅探池清掉、开关恢复到进组前（与 sniffUnified 组结尾一致）。
      await js(`sniffItems = []; sniffReqLog = []; sniffHistoryView = null; renderSniffPanel();`);
      await js(`setSniffEnabled(${!!sniffPrev13});`);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-2：对比修复轮（P0-P3 全部 17 项）——本地 mock 服务
  // 模拟 OpenAI 兼容接口，覆盖：空回复失败、流式回推与停止、400
  // 去参数重试、温度进请求体、历史截断、网页消息落库、删除级联、
  // 重名与模型默认、触发器失败不记已执行、重新生成不重复用户消息、
  // 原子写与损坏保护、agents.json 版本、会话续接、身份哈希碰撞、
  // 轻量连接探测、补齐网页智能体。
  nativeCheck.agentFixes20261128 = await (async () => {
    const r = {};
    const mock = await new Promise((resolve) => {
      const bodies = [];
      const srv = http.createServer((req, res) => {
        res.on('error', () => { /* 客户端断开不崩进程 */ });
        let data = '';
        req.on('data', (c) => { data += c; });
        req.on('end', () => {
          if (req.url === '/v1/models' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'other-model' }] }));
            return;
          }
          if (req.url === '/v1/chat/completions' && req.method === 'POST') {
            let body = null;
            try { body = JSON.parse(data || '{}'); } catch (e) { body = {}; }
            bodies.push(body);
            if (body.model === 'empty-model') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
              return;
            }
            if (body.temperature !== undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'temperature not supported' } }));
              return;
            }
            if (body.stream === true) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream' });
              if (body.model === 'slow-model') {
                res.write('data: {"choices":[{"delta":{"content":"慢"}}]}\n\n');
                setTimeout(() => { try { if (!res.writableEnded) { res.write('data: {"choices":[{"delta":{"content":"回复"}}]}\n\n'); res.write('data: [DONE]\n\n'); res.end(); } } catch (e) { /* 客户端已断开 */ } }, 4000);
              } else {
                res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
                res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
              }
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: '模拟回复' } }] }));
            return;
          }
          res.writeHead(404); res.end();
        });
      });
      srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, bodies }));
    });
    const base = `http://127.0.0.1:${mock.port}/v1`;
    // 2026-11-28-2 run2：agent-save 回传的 agent 含 apiKey/webToken/
    // webCookie/webUserAgent 四个 undefined 属性（防泄密故意置
    // undefined），经 executeJavaScript 回传会抛 DataCloneError
    //（“An object could not be cloned.”，run1 整组因此只剩 error）。
    // 渲染层只回布尔值，新建行由主进程按“新 id + 同名”直接读回；
    // 这是自测回传方式问题，抽屉保存本身正常（agentsSaved=1）。
    const saveAgentViaJs = async (input) => {
      const beforeIds = new Set(getAgents().map((a) => a.id));
      let savedOk = false;
      try {
        savedOk = await js(`(async () => { try { const r = await window.toolbox.agentSave(${JSON.stringify(input)}); return !!(r && r.ok); } catch (e) { return false; } })()`);
      } catch (e) {
        r.jsAgentSaveError = e.message || String(e);
        console.error('[selftest agentFixes] agentSave js() 抛错：', e.message || e);
      }
      const created = getAgents().find((a) => !beforeIds.has(a.id) && a.name === input.name);
      if (!created && savedOk) r.jsAgentSaveError = 'agentSave 报告成功，但主进程未找到新建智能体';
      return created || null;
    };
    const mkAgent = async (name, extra) => saveAgentViaJs({ name, provider: 'deepseek', baseUrl: base, model: 'mock-model', apiKey: 'test-key', streaming: false, proxyPolicy: 'direct', ...(extra || {}) });
    try {
      const mockAgent = await mkAgent('自测模拟智能体');
      const emptyAgent = await mkAgent('自测空回复智能体', { model: 'empty-model' });
      const tempAgent = await mkAgent('自测温度智能体', { temperature: 0.5 });
      const truncAgent = await mkAgent('自测截断智能体', { contextLength: 1, systemPrompt: 'SYS' });
      r.agentsCreated = !!(mockAgent && emptyAgent && tempAgent && truncAgent);
      if (!r.agentsCreated) throw new Error('mock 智能体未建出来（agentsCreated=false）');
      // P2-10：轻量探测——http 地址应被 https 前缀校验挡住（不发请求）；
      // /models 列表本身能被 httpJson 读到并解析。
      const modelsTest = await js(`(async () => window.toolbox.agentModelsTest(${JSON.stringify(mockAgent ? mockAgent.id : '')}))()`);
      r.modelsTestRejectsHttp = !!(modelsTest && modelsTest.ok === false && /https/.test(modelsTest.error || ''));
      const modelsRes = await httpJson('GET', `${base}/models`, null, { Authorization: 'Bearer test-key' }, 20000, { proxyOverride: 'direct' });
      r.modelsListParsed = !!(modelsRes.ok && Array.isArray(modelsRes.data && modelsRes.data.data) && modelsRes.data.data.length === 2 && modelsRes.data.data.some((m) => m.id === 'mock-model'));
      // P3-14：流式回推——至少两块增量，累计文本正确。
      const deltas = [];
      const streamRes = await agentChatCompletionsStream({ provider: 'deepseek', baseUrl: base, model: 'mock-model', apiKey: 'test-key' }, [{ role: 'user', content: 'hi' }], (t) => deltas.push(t), null);
      r.streamDeltas = streamRes.ok === true && streamRes.text === '你好' && deltas.length >= 2 && deltas[deltas.length - 1] === '你好';
      // P3-14：停止——慢流发一块后点停止，只留已收到的部分。
      const slowPromise = agentChatCompletionsStream({ provider: 'deepseek', baseUrl: base, model: 'slow-model', apiKey: 'test-key' }, [{ role: 'user', content: 'hi' }], () => {}, 'selftest-stop');
      await new Promise((res2) => setTimeout(res2, 1000));
      agentChatStop('selftest-stop');
      const slowRes = await slowPromise;
      r.streamStop = slowRes.ok === true && slowRes.stopped === true && slowRes.text === '慢';
      // P0-3：API 空回复算失败，不入库（对话里只有用户消息）。
      const emptyChats = getAgentChats();
      const emptyChat = { id: localId(), agentId: emptyAgent.id, title: '空回复', messages: [], updatedAt: Date.now() };
      emptyChats.push(emptyChat);
      writeJsonFile('agent-chats.json', emptyChats);
      const emptySend = await agentChatSend(emptyChat.id, '你好');
      const emptyAfter = getAgentChats().find((c) => c.id === emptyChat.id);
      r.emptyReplyFails = emptySend.ok === false && /空内容/.test(emptySend.error || '') && emptyAfter.messages.length === 1 && emptyAfter.messages[0].role === 'user';
      // P3-13：400/422 去参数重试——第一次带 temperature 被 400，
      // 第二次去掉后 200；温度确实进了第一次请求体。
      const beforeTemp = mock.bodies.length;
      const tempChats = getAgentChats();
      const tempChat = { id: localId(), agentId: tempAgent.id, title: '温度', messages: [], updatedAt: Date.now() };
      tempChats.push(tempChat);
      writeJsonFile('agent-chats.json', tempChats);
      const tempSend = await agentChatSend(tempChat.id, '你好');
      const tempBodies = mock.bodies.slice(beforeTemp);
      r.tempRetry400 = tempSend.ok === true && tempBodies.length === 2 && tempBodies[0].temperature === 0.5 && tempBodies[1].temperature === undefined;
      // P3-12：历史截断——6 条历史 + 新问句，contextLength 1 时
      // 只发系统提示 + 最近 2 条。
      const truncChats = getAgentChats();
      const truncChat = { id: localId(), agentId: truncAgent.id, title: '截断', messages: [
        { role: 'user', content: '问1', at: 1 }, { role: 'assistant', content: '答1', at: 2 },
        { role: 'user', content: '问2', at: 3 }, { role: 'assistant', content: '答2', at: 4 },
        { role: 'user', content: '问3', at: 5 }, { role: 'assistant', content: '答3', at: 6 },
      ], updatedAt: Date.now() };
      truncChats.push(truncChat);
      writeJsonFile('agent-chats.json', truncChats);
      const beforeTrunc = mock.bodies.length;
      const truncSend = await agentChatSend(truncChat.id, '新问题');
      const truncBody = mock.bodies[mock.bodies.length - 1];
      r.truncation = truncSend.ok === true && mock.bodies.length === beforeTrunc + 1 && Array.isArray(truncBody.messages) && truncBody.messages.length === 3 && truncBody.messages[truncBody.messages.length - 1].content === '新问题';
      // P0-1：网页消息先落库——失败发送后用户消息仍在库里、标题已设；
      // buildWebPrompt 用完整历史，不丢上一条助手回复。
      const webAgent = await saveAgentViaJs({ name: '自测网页智能体', connectionType: 'web', webSite: 'deepseek', webToken: 'fake-token' });
      const webChats = getAgentChats();
      const webChat = { id: localId(), agentId: webAgent.id, title: '网页', messages: [
        { role: 'user', content: '第一问', at: 1 }, { role: 'assistant', content: '第一答', at: 2 },
      ], updatedAt: Date.now() };
      webChats.push(webChat);
      writeJsonFile('agent-chats.json', webChats);
      const webSend = await agentChatSend(webChat.id, '第二问');
      const webAfter = getAgentChats().find((c) => c.id === webChat.id);
      const webPrompt = buildWebPrompt(getAgents().find((a) => a.id === webAgent.id), [{ role: 'user', content: '第一问', at: 1 }, { role: 'assistant', content: '第一答', at: 2 }], '第二问');
      r.webUserMessagePersisted = webSend.ok === false && webAfter.messages.length === 3 && webAfter.messages[2].role === 'user' && webAfter.messages[2].content === '第二问' && webAfter.title === '第一问';
      r.webPromptKeepsPrevious = webPrompt.includes('第一答') && webPrompt.includes('第二问');
      // P0-2：删除级联——对话、官网会话续接、待确认操作一起删。
      const delAgent = await saveAgentViaJs({ name: '自测删除智能体', provider: 'deepseek', baseUrl: base, model: 'mock-model', apiKey: 'test-key', streaming: false });
      const delChats = getAgentChats();
      const delChat1 = { id: localId(), agentId: delAgent.id, title: '删1', messages: [{ role: 'user', content: 'x', at: 1 }], updatedAt: Date.now() };
      const delChat2 = { id: localId(), agentId: delAgent.id, title: '删2', messages: [], updatedAt: Date.now() };
      delChats.push(delChat1, delChat2);
      writeJsonFile('agent-chats.json', delChats);
      setWebSession(delChat1.id, { agentId: delAgent.id, site: 'deepseek', sessionId: 's1', parentMessageId: 1 });
      savePendingActions([{ id: 'pa-selftest', chatId: delChat1.id, tool: 'install_app', args: { name: 'VLC' }, label: '安装 VLC' }]);
      await js(`(async () => window.toolbox.agentDelete(${JSON.stringify(delAgent.id)}))()`);
      r.deleteCascade = !getAgents().some((a) => a.id === delAgent.id)
        && !getAgentChats().some((c) => c.agentId === delAgent.id)
        && getWebSession(delChat1.id) === null
        && !getPendingActions().some((a) => a.id === 'pa-selftest');
      // P3-16：重名拒绝、模型默认补齐、未知服务商要求填模型。
      // 重名用组内已建的“自测模拟智能体”做靶子，不再依赖早先分组建的
      // “自测智能体”；回传只取 {ok,error}/模型字符串，不回传 agent 对象。
      const dupSave = await js(`(async () => { try { const r = await window.toolbox.agentSave({ name: '自测模拟智能体', provider: 'deepseek', baseUrl: '${base}', model: 'mock-model', apiKey: 'test-key' }); return { ok: !!(r && r.ok), error: (r && r.error) || '' }; } catch (e) { return { ok: false, error: 'js异常：' + (e.message || e) }; } })()`);
      r.dupNameRejected = !!(dupSave && dupSave.ok === false && /同名/.test(dupSave.error || ''));
      const defModel = await js(`(async () => { try { const r = await window.toolbox.agentSave({ name: '自测默认模型智能体', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: '', apiKey: 'test-key' }); return (r && r.ok && r.agent && r.agent.model) || ''; } catch (e) { return ''; } })()`);
      r.modelDefaultFilled = defModel === 'deepseek-chat';
      const reqSave = await js(`(async () => { try { const r = await window.toolbox.agentSave({ name: '自测未知服务商智能体', provider: 'custom', baseUrl: 'https://example.com/v1', model: '', apiKey: 'test-key' }); return { ok: !!(r && r.ok), error: (r && r.error) || '' }; } catch (e) { return { ok: false, error: 'js异常：' + (e.message || e) }; } })()`);
      r.modelRequiredWhenUnknown = !!(reqSave && reqSave.ok === false && /模型/.test(reqSave.error || ''));
      // P1-6：触发器失败不记已执行（记 lastError），成功才记 lastRun。
      const failAgent = await saveAgentViaJs({ name: '自测触发失败智能体', provider: 'deepseek', baseUrl: 'http://127.0.0.1:1/v1', model: 'mock-model', apiKey: 'test-key', streaming: false, proxyPolicy: 'direct' });
      const failTrigId = await js(`(async () => { try { const r = await window.toolbox.agentTriggerSave(${JSON.stringify(failAgent.id)}, { name: '自测失败触发', kind: 'time', time: '23:58', prompt: '触发测试', enabled: true }); return (r && r.ok && r.trigger && r.trigger.id) || ''; } catch (e) { return ''; } })()`);
      const failRun = await runAgentTrigger(failAgent.id, failTrigId);
      const failAfter = getAgents().find((a) => a.id === failAgent.id);
      const failT = (failAfter.triggers || []).find((t) => t.id === failTrigId);
      r.triggerFailureNotMarked = failRun.ok === false && !!failT && !failT.lastRun && !!failT.lastError;
      const okTrigId = await js(`(async () => { try { const r = await window.toolbox.agentTriggerSave(${JSON.stringify(mockAgent.id)}, { name: '自测成功触发', kind: 'time', time: '23:58', prompt: '触发测试', enabled: true }); return (r && r.ok && r.trigger && r.trigger.id) || ''; } catch (e) { return ''; } })()`);
      const okRun = await runAgentTrigger(mockAgent.id, okTrigId);
      const okAfter = getAgents().find((a) => a.id === mockAgent.id);
      const okT = (okAfter.triggers || []).find((t) => t.id === okTrigId);
      const todayStr = new Date().toISOString().slice(0, 10);
      r.triggerSuccessMarked = okRun.ok === true && !!okT && okT.lastRun === todayStr && !okT.lastError;
      // P2-11：重新生成不重复用户消息。
      const regenChats = getAgentChats();
      const regenChat = { id: localId(), agentId: mockAgent.id, title: '重生成', messages: [], updatedAt: Date.now() };
      regenChats.push(regenChat);
      writeJsonFile('agent-chats.json', regenChats);
      await agentChatSend(regenChat.id, '你好');
      const regenRes = await agentChatRegenerate(regenChat.id);
      const regenAfter = getAgentChats().find((c) => c.id === regenChat.id);
      r.regenerateNoDupUser = regenRes.ok === true && regenAfter.messages.filter((m) => m.role === 'user').length === 1 && regenAfter.messages.length === 2;
      // P3-15：原子写无残留临时文件；损坏文件留副本并返回 fallback；
      // agents.json 带 version，旧裸数组仍能读。
      writeJsonFile('selftest-atomic.json', { a: 1 });
      const atomicOk = readJsonFile('selftest-atomic.json', {}).a === 1
        && !fs.readdirSync(userDataDir()).some((f) => f.startsWith('selftest-atomic.json.tmp-'));
      fs.writeFileSync(path.join(userDataDir(), 'selftest-corrupt.json'), '{bad json', 'utf8');
      const corruptRead = readJsonFile('selftest-corrupt.json', []);
      const corruptCopy = fs.readdirSync(userDataDir()).some((f) => f.startsWith('selftest-corrupt.json.corrupt-'));
      r.atomicWriteNoTmp = atomicOk === true;
      r.corruptBackup = Array.isArray(corruptRead) && corruptRead.length === 0 && corruptCopy === true;
      try { fs.rmSync(path.join(userDataDir(), 'selftest-atomic.json'), { force: true }); } catch (e) { /* 忽略 */ }
      try { fs.rmSync(path.join(userDataDir(), 'selftest-corrupt.json'), { force: true }); } catch (e) { /* 忽略 */ }
      for (const f of fs.readdirSync(userDataDir())) {
        if (f.startsWith('selftest-corrupt.json.corrupt-')) { try { fs.rmSync(path.join(userDataDir(), f), { force: true }); } catch (e) { /* 忽略 */ } }
      }
      // P2-8：会话续接存取与清理。
      setWebSession('selftest-chat-a', { agentId: 'ag-a', site: 'deepseek', sessionId: 's-a', parentMessageId: 7 });
      setWebSession('selftest-chat-b', { agentId: 'ag-a', site: 'qwen', sessionId: 's-b' });
      const sessA = getWebSession('selftest-chat-a');
      clearWebSessionsForChat('selftest-chat-a');
      const sessAGone = getWebSession('selftest-chat-a') === null;
      clearWebSessionsForAgent('ag-a');
      r.webSessionStore = !!(sessA && sessA.sessionId === 's-a' && sessA.parentMessageId === 7) && sessAGone && getWebSession('selftest-chat-b') === null;
      // P2-9：身份哈希——同输入同哈希，不同令牌不同哈希；同站同哈希
      // 的两个智能体互相碰撞。
      const h1 = webIdentityHash('deepseek', 'acc', 'tok1');
      const h2 = webIdentityHash('deepseek', 'acc', 'tok1');
      const h3 = webIdentityHash('deepseek', 'acc', 'tok2');
      const collList = getAgents();
      collList.push({ id: 'coll-a', name: '自测碰撞A', connectionType: 'web', webSite: 'deepseek', webIdentityHash: 'hash-selftest' });
      collList.push({ id: 'coll-b', name: '自测碰撞B', connectionType: 'web', webSite: 'deepseek', webIdentityHash: 'hash-selftest' });
      saveAgents(collList);
      const collHit = findWebIdentityCollision(getAgents().find((a) => a.id === 'coll-a'));
      saveAgents(getAgents().filter((a) => a.id !== 'coll-a' && a.id !== 'coll-b'));
      r.identityHashCollision = h1 === h2 && h1 !== h3 && !!(collHit && collHit.id === 'coll-b');
      // P1-7：写回过期状态（单元级：markAgentWebStatus 落盘）。
      markAgentWebStatus(mockAgent.id, 'expired');
      const marked = getAgents().find((a) => a.id === mockAgent.id);
      markAgentWebStatus(mockAgent.id, '');
      r.markExpired = !!(marked && marked.webStatus === 'expired');
      // P1-5：三路共用系统提示——顺序固定，技能去重只拼一次。
      const skillId = await js(`(async () => { try { const r = await window.toolbox.skillSave({ name: '自测提示词技能', description: '', instructions: 'SKILL-XYZ', enabled: true }); return (r && r.ok && r.skill && r.skill.id) || ''; } catch (e) { return ''; } })()`);
      const sysPrompt = buildSystemPrompt({ systemPrompt: 'SYS-XYZ', memories: [{ text: 'MEM-XYZ' }], skillIds: [skillId, skillId], toolsEnabled: true });
      const countSkill = (sysPrompt.match(/SKILL-XYZ/g) || []).length;
      r.buildSystemPromptOrder = sysPrompt.indexOf('SYS-XYZ') >= 0
        && sysPrompt.indexOf('SYS-XYZ') < sysPrompt.indexOf('MEM-XYZ')
        && sysPrompt.indexOf('MEM-XYZ') < sysPrompt.indexOf('SKILL-XYZ')
        && sysPrompt.indexOf('SKILL-XYZ') < sysPrompt.indexOf('调用本机工具')
        && countSkill === 1;
      if (skillId) await js(`(async () => { await window.toolbox.skillDelete(${JSON.stringify(skillId)}); return true; })()`);
      // P3-17：千问 SSE 增量解析只取 answer 阶段；DeepSeek SSE 解析。
      r.qwenParseSse = qwenParseSseText('data: {"choices":[{"delta":{"content":"a","phase":"answer"}}]}\n\ndata: {"choices":[{"delta":{"content":"b","phase":"thinking"}}]}\n\ndata: {"choices":[{"delta":{"content":"c"}}]}\n\n') === 'ac';
      r.dsParseSse = dsParseSse('data: {"v":"你好","p":"response/fragments/0/content"}\n\n').text === '你好';
      // P3-12/P1-4：截断与代理策略纯函数。
      r.truncateHelper = truncateHistoryMessages([1, 2, 3, 4, 5, 6], 1).length === 2 && truncateHistoryMessages([1, 2, 3], 20).length === 3;
      r.proxyOverrideMap = agentProxyOverride({ proxyPolicy: 'direct' }) === 'direct' && agentProxyOverride({ proxyPolicy: 'proxy' }) === 'proxy' && agentProxyOverride({ proxyPolicy: 'global' }) === null && agentProxyOverride({}) === null;
      // 2026-11-28-7：第 4 项：补齐按钮已删除——按钮、桥、主进程函数
      // 与 IPC 全无残留；智能体列表不再一键建空壳智能体。
      const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
      r.fillDefaultWebRemoved = await js(`(() => !document.querySelector('#agent-fill-default-web') && typeof window.toolbox.agentFillDefaultWeb === 'undefined')()`)
        && typeof agentFillDefaultWeb === 'undefined'
        && !/ipcMain\.handle\('agent-fill-default-web'/.test(mainSrc);
      // P3-15（续）：agents.json 带 version，旧裸数组仍能读；测完
      // 立刻用快照恢复（本组在收尾时还会再恢复一次）。
      const rawAgents = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'agents.json'), 'utf8'));
      r.agentsVersioned = !!(rawAgents && rawAgents.version === 1 && Array.isArray(rawAgents.items));
      fs.writeFileSync(path.join(userDataDir(), 'agents.json'), JSON.stringify([{ id: 'legacy-one', name: '旧格式' }]), 'utf8');
      const legacyRead = getAgents();
      r.agentsLegacyArrayReadable = Array.isArray(legacyRead) && legacyRead.some((a) => a.id === 'legacy-one');
      saveAgents(snapshot.agents);
    } catch (e) { r.error = e.message || String(e); }
    try { saveAgents(snapshot.agents); } catch (e) { /* 忽略 */ }
    try { mock.srv.close(); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-5：手机远程（局域网直连 + Tailscale）——配对码过期与
  // 锁定、令牌校验与吊销、高危操作默认拒绝、服务未开启时端口不
  // 监听、证书解析回验、QR 结构校验、Tailscale 未装优雅降级、
  // 回环 HTTPS 实测。测试用临时端口与本机回环，测完关闭服务并
  // 恢复 phone-remote.json 与证书文件，不污染本机数据。
  nativeCheck.phoneRemote20261128 = await (async () => {
    const r = {};
    const prFile = path.join(userDataDir(), 'phone-remote.json');
    const prCertFile = path.join(userDataDir(), 'phone-remote-cert.json');
    const snapPr = (() => { try { return fs.readFileSync(prFile, 'utf8'); } catch (e) { return null; } })();
    const snapCert = (() => { try { return fs.readFileSync(prCertFile, 'utf8'); } catch (e) { return null; } })();
    const wasRunningBeforeGroup = phoneRemoteRunning;
    try {
      if (wasRunningBeforeGroup) phoneRemoteStop();
      // 1) 配对码过期
      phoneRemoteAllowPair();
      let st = phoneRemoteLoad();
      st.pair.expiresAt = Date.now() - 1000;
      phoneRemoteSave(st);
      const expiredCheck = phoneRemoteCheckPair(st.pair.code, st.pair.token);
      r.pairCodeExpired = expiredCheck.ok === false && /过期/.test(expiredCheck.error || '');
      // 2) 配对码错 5 次锁定 10 分钟，锁定期间正确码也不通过
      phoneRemoteAllowPair();
      st = phoneRemoteLoad();
      for (let i = 0; i < 5; i++) phoneRemoteCheckPair('000000', st.pair.token);
      st = phoneRemoteLoad();
      r.pairLockAfter5Wrong = st.pair.lockedUntil > Date.now();
      const lockedCheck = phoneRemoteCheckPair(st.pair.code, st.pair.token);
      r.pairLockedBlocksCorrectCode = lockedCheck.ok === false && /锁定/.test(lockedCheck.error || '');
      // 3) 令牌：签发、校验、只存哈希、吊销、连续 10 次无效拉黑
      phoneRemoteAllowPair();
      st = phoneRemoteLoad();
      const pairOk = phoneRemoteCheckPair(st.pair.code, st.pair.token);
      r.pairCorrectCodePasses = pairOk.ok === true;
      const issued = phoneRemoteIssueDeviceToken(pairOk.state, '自测手机');
      r.tokenIssued256bit = issued.token.length === 64 && /^[0-9a-f]+$/.test(issued.token);
      const authOk = phoneRemoteAuth({ authorization: `Bearer ${issued.token}` });
      r.tokenValidPasses = authOk.ok === true && !!authOk.device && authOk.device.id === issued.device.id;
      const stored = phoneRemoteLoad();
      r.tokenStoredAsHashOnly = stored.devices.some((d) => d.tokenHash === phoneRemoteSha256Hex(issued.token)) && !JSON.stringify(stored).includes(issued.token);
      const authBad = phoneRemoteAuth({ authorization: `Bearer ${'0'.repeat(64)}` });
      r.tokenInvalidRejected = authBad.ok === false && authBad.status === 401;
      phoneRemoteRevokeDevice(issued.device.id);
      r.tokenRevokedRejected = phoneRemoteAuth({ authorization: `Bearer ${issued.token}` }).ok === false;
      const badToken = 'a'.repeat(64);
      for (let i = 0; i < 10; i++) phoneRemoteAuth({ authorization: `Bearer ${badToken}` });
      const st2 = phoneRemoteLoad();
      r.tokenInvalid10TimesBlocked = (st2.invalidToken.blocked || []).includes(phoneRemoteSha256Hex(badToken));
      r.tokenBlockedReturns403 = phoneRemoteAuth({ authorization: `Bearer ${badToken}` }).status === 403;
      // 4) 高危操作默认拒绝：未勾选 403；勾选后无 confirm 403；有 confirm 才放行（只验门禁，不真执行）
      r.dangerDefaultDenied = phoneRemoteDangerousCheck('deleteFile', { confirm: true }).ok === false;
      let st3 = phoneRemoteLoad(); st3.dangerous.deleteFile = true; phoneRemoteSave(st3);
      r.dangerEnabledNoConfirmDenied = phoneRemoteDangerousCheck('deleteFile', {}).ok === false;
      r.dangerEnabledWithConfirmAllowed = phoneRemoteDangerousCheck('deleteFile', { confirm: true }).ok === true;
      st3 = phoneRemoteLoad(); st3.dangerous.deleteFile = false; phoneRemoteSave(st3);
      r.dangerUnknownKeyDenied = phoneRemoteDangerousCheck('formatDisk', { confirm: true }).ok === false;
      // 5) 服务未开启时端口不监听（连接被拒绝）
      const testPort = 49152 + Math.floor(Math.random() * 10000);
      r.serviceStoppedWhenDisabled = phoneRemoteRunning === false;
      const refused = await new Promise((resolve) => {
        const sock = net.connect({ host: '127.0.0.1', port: testPort, timeout: 1500 });
        sock.on('connect', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => resolve(true));
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
      });
      r.portNotListeningWhenStopped = refused === true;
      // 6) 证书解析回验
      const cert = phoneRemoteEnsureCert(['127.0.0.1']);
      const x509 = new crypto.X509Certificate(cert.certPem);
      r.certParses = (x509.subject || '').includes('桌面工具箱');
      r.certFingerprint64Hex = /^[0-9a-f]{64}$/.test(cert.fingerprint);
      r.certFingerprintMatches = x509.fingerprint256.replace(/:/g, '').toLowerCase() === cert.fingerprint;
      r.certSanHasLoopback = (x509.subjectAltName || '').includes('127.0.0.1');
      r.certVerifySignature = (() => { try { return x509.verify(x509.publicKey); } catch (e) { return false; } })();
      r.certNotCA = x509.ca === false;
      r.certTenYears = (() => { try { return (new Date(x509.validTo).getTime() - new Date(x509.validFrom).getTime()) > 9 * 365 * 24 * 3600 * 1000; } catch (e) { return false; } })();
      // 7) QR 结构校验（短链接、中文链接各一）
      const qr1 = phoneRemoteQrEncode(`https://192.168.1.100:54321/?pair=${'a'.repeat(32)}`);
      const chk1 = qr1.ok ? phoneRemoteQrCheckStructure(qr1) : null;
      r.qrSizeFormula = !!chk1 && chk1.sizeOk;
      r.qrFinderPatterns = !!chk1 && chk1.finderOk;
      r.qrTimingPattern = !!chk1 && chk1.timingOk;
      r.qrFormatInfoDecodable = !!chk1 && chk1.formatOk;
      r.qrDarkModule = !!chk1 && chk1.darkOk;
      const qr2 = phoneRemoteQrEncode(`https://192.168.1.100:54321/?pair=${'b'.repeat(32)}&name=测试手机`);
      const chk2 = qr2.ok ? phoneRemoteQrCheckStructure(qr2) : null;
      r.qrChineseInputOk = !!chk2 && chk2.finderOk && chk2.formatOk && qr2.version >= 1 && qr2.version <= 10;
      r.qrTooLongRejected = phoneRemoteQrEncode('x'.repeat(300)).ok === false;
      // 8) Tailscale 未装时优雅降级
      const ts = await phoneRemoteDetectTailscale();
      r.tailscaleGraceful = !!ts && typeof ts.detected === 'boolean' && (ts.detected ? !!ts.ip : !ts.ip);
      // 9) 回环 HTTPS 实测：未带令牌 401、配对发令牌、带令牌 200、PWA 与 manifest 可达
      const startR = await phoneRemoteStart({ port: testPort, loopbackOnly: true, tailscale: { detected: false, ip: '' } });
      r.liveServerStarts = startR.ok === true;
      if (startR.ok) {
        const base = `https://127.0.0.1:${startR.port}`;
        const noAuth = await phoneRemoteHttpsJson(`${base}/api/v1/status`, 'GET', null, null);
        r.liveStatusNoToken401 = noAuth.status === 401;
        const allow = phoneRemoteAllowPair();
        const pairRes = await phoneRemoteHttpsJson(`${base}/api/v1/pair`, 'POST', { pairToken: allow.pairToken, code: allow.code, name: '自测手机' }, null);
        r.livePairIssuesToken = pairRes.status === 200 && !!pairRes.body && typeof pairRes.body.token === 'string' && pairRes.body.token.length === 64;
        if (pairRes.body && pairRes.body.token) {
          const withAuth = await phoneRemoteHttpsJson(`${base}/api/v1/status`, 'GET', null, pairRes.body.token);
          r.liveStatusWithToken200 = withAuth.status === 200 && !!withAuth.body && withAuth.body.ok === true;
          const pwa = await phoneRemoteHttpsJson(`${base}/`, 'GET', null, null);
          r.livePwaServes = pwa.status === 200 && /工具箱远程/.test(pwa.text || '');
          const man = await phoneRemoteHttpsJson(`${base}/manifest.webmanifest`, 'GET', null, null);
          r.liveManifestOk = man.status === 200 && !!man.body && man.body.name === '工具箱远程';
          const badPath = await phoneRemoteHttpsJson(`${base}/api/v1/nope`, 'GET', null, pairRes.body.token);
          r.liveUnknownApi404 = badPath.status === 404;
        }
        phoneRemoteStop();
      }
      r.liveServerStoppedAfterTest = phoneRemoteRunning === false;
      // 10) 设置页：手机远程页签与面板在位，IPC phone-remote-status 可调通
      const phoneTab = await js(`(() => { const t = document.querySelector('#settings-tabs [data-settings-tab=phone]'); const p = document.querySelector('#settings-pane-phone'); return { tab: !!t, pane: !!p, enabled: !!document.querySelector('#phone-remote-enabled'), pairBtn: !!document.querySelector('#phone-remote-pair-btn') }; })()`);
      r.settingsTabPresent = phoneTab.tab === true && phoneTab.pane === true;
      r.settingsControlsPresent = phoneTab.enabled === true && phoneTab.pairBtn === true;
      const ipcStatus = await js(`(async () => { try { const s = await window.toolbox.phoneRemoteStatus(); return { ok: true, hasFingerprint: typeof s.fingerprint === 'string', hasDevices: Array.isArray(s.devices) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } })()`);
      r.ipcStatusOk = !!(ipcStatus && ipcStatus.ok && ipcStatus.hasFingerprint && ipcStatus.hasDevices);
    } catch (e) { r.error = e.message || String(e); }
    // 收尾：停测试服务、恢复状态与证书文件（本组在收尾恢复点之后跑，须自己恢复）
    try { phoneRemoteStop(); } catch (e) { /* 已停 */ }
    try { if (snapPr) fs.writeFileSync(prFile, snapPr); else fs.rmSync(prFile, { force: true }); } catch (e) { /* 恢复失败不影响 */ }
    try { if (snapCert) fs.writeFileSync(prCertFile, snapCert); else fs.rmSync(prCertFile, { force: true }); } catch (e) { /* 恢复失败不影响 */ }
    if (wasRunningBeforeGroup) { try { await phoneRemoteApplyEnabled(); } catch (e) { /* 恢复监听失败不影响 */ } }
    return r;
  })();
  // 2026-11-28-5 设计系统修正 + 清理：聚焦环、表单语义宽度、8pt 间距、
  // 深色画布、tabular-nums、SVG 图标、死引用清零。
  nativeCheck.designSystem20261128 = await (async () => {
    const r = {};
    try {
      const css = fs.readFileSync(path.join(__dirname, 'renderer', 'styles.css'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
      const rendererSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
      const preloadSrc = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
      const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
      // 1) 聚焦环：CSS 里有 :focus-visible 规则
      r.focusRingRule = /:focus-visible\s*\{[^}]*outline/.test(css);
      // 2) 表单语义宽度：.form 上限 480px；验证码短字段 120px
      r.formMaxWidth480 = /\.form\s*\{[^}]*max-width:\s*480px/.test(css);
      r.shortField120 = /id="reg-code"[^>]*width:120px/.test(html);
      // 3) 间距 8pt：可疑值已清（150px 右内边距、6/10/14px padding/gap）
      r.screenHeadPadding148 = /padding:\s*8px 148px 12px 0/.test(css);
      r.noBadSpacing = !/padding:\s*6px 8px/.test(css) && !/padding:\s*10px 12px/.test(css)
        && !/padding:\s*8px 10px/.test(css) && !/margin:\s*10px 0 0/.test(css)
        && !/gap:\s*6px/.test(css) && !/padding:\s*14px/.test(css);
      // 4) 深色画布：dark/auto 两块都是 #09090B/#18181B，旧 #2c2c2e 已清；阴影 L3 已压弱
      r.darkCanvas = (css.match(/--canvas-from:\s*#09090b/g) || []).length === 2
        && (css.match(/--canvas-to:\s*#18181b/g) || []).length === 2
        && !/#2c2c2e/.test(css);
      r.shadowL3Soft = /--shadow-l3:\s*0 8px 24px rgba\(0,0,0,0\.16\)/.test(css);
      // 5) tabular-nums 覆盖统计与时间类
      r.tabularNumsStats = /\.recent-date, \.browser-media-count, \.purity-badge, \.sniff-tabs \.tab \{ font-variant-numeric: tabular-nums; \}/.test(css);
      // 6) 图标：15 个菜单瓦片全是 SVG（2026-11-28-6 新增“屏幕翻译”），窗口按钮与返回按钮全是 SVG
      r.menuTilesSvg15 = (await js(`[...document.querySelectorAll('.menu-tile svg')].length`)) === 15;
      r.menuTilesNoGlyph = await js(`[...document.querySelectorAll('.menu-tile')].every((t) => t.querySelector('svg') && !/[✦◐▣⚡✉▢◍⬇▦▤▶◉◎]/.test(t.textContent))`);
      r.winBtnsSvg = await js(`[...document.querySelectorAll('.win-btn svg')].length === 3`);
      r.backBtnsSvg = await js(`[...document.querySelectorAll('.back svg')].length === [...document.querySelectorAll('.back')].length && document.querySelectorAll('.back').length > 0`);
      // 7) 深色下文字可读：切 dark 主题读变量（读完恢复原主题）
      const dark = await js(`(() => { const prev = document.body.getAttribute('data-theme'); document.body.setAttribute('data-theme', 'dark'); const cs = getComputedStyle(document.body); const v = (n) => (cs.getPropertyValue(n) || '').trim(); const out = { canvasFrom: v('--canvas-from'), text: v('--text') }; if (prev === null) document.body.removeAttribute('data-theme'); else document.body.setAttribute('data-theme', prev); return out; })()`);
      r.darkThemeVars = dark.canvasFrom === '#09090b' && dark.text === '#f5f5f7';
      // 8) 清理后无死引用
      r.deadFnGone = !/function addSniffResults/.test(rendererSrc) && !/const MENU_INFO/.test(rendererSrc)
        && !/const RECOMMENDED_APPS/.test(rendererSrc) && !/const chromeHist/.test(rendererSrc);
      r.deadCssGone = !/\.sniff-group\s*\{/.test(css) && !/\.sniff-group-head/.test(css) && !/\.switch-row/.test(css);
      // agentToolPending 与 toolsInstalledExtra 看似渲染层不用，但自测调它们，留着
      r.deadBridgesGone = !/wingetInstalled:/.test(preloadSrc)
        && !/videoSniff:/.test(preloadSrc) && !/pioneerIpCheck:/.test(preloadSrc)
        && !/systemStatus:/.test(preloadSrc);
      r.selftestBridgesKept = /agentToolPending:/.test(preloadSrc) && /toolsInstalledExtra:/.test(preloadSrc);
      r.deadHandlersGone = !/ipcMain\.handle\('winget-installed'/.test(mainSrc)
        && !/ipcMain\.handle\('video-sniff'/.test(mainSrc) && !/ipcMain\.handle\('pioneer-ip-check'/.test(mainSrc)
        && !/ipcMain\.handle\('system-status'/.test(mainSrc);
      // 9) 第一阶段手机远程代码未动（清理/样式改动避开它）
      // #settings-pane-phone 是 DOM 选择器写法，源码里是 id="settings-pane-phone"（无 #）
      r.phoneRemoteIntact = /function phoneRemoteQrEncode/.test(mainSrc) && /phoneRemoteStatus:/.test(preloadSrc)
        && /id="settings-pane-phone"/.test(html) && /renderPhoneRemote/.test(rendererSrc);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-6：屏幕实时翻译——选区/裁剪/浮窗定位纯函数、
  // 视觉消息拼装（OpenAI image_url 与 Anthropic 原生 image 块）、
  // 结果解析、轮巡顺序与失败顺延（mock 智能体端点，不调真实
  // 厂商接口）、未配轮巡时的明确提示、快捷键注册、覆盖层与
  // 浮窗窗口、选区截图。测完恢复插件、智能体与配置。
  nativeCheck.screenTranslate20261128 = await (async () => {
    const r = {};
    const snapAgents = getAgents();
    const snapPlugins = getPlugins();
    const snapCfg = getConfig().screenTranslate || null;
    const mock = { srv: null, port: 0, sawOpenAiImage: false, sawAnthropicImage: false };
    let tr = null;
    try {
      // 1) 纯函数：选区归一化与夹回
      r.normalize = normalizeScreenRect({ x: 10.6, y: -3, width: 100.4, height: 50 }).x === 11
        && normalizeScreenRect({ width: -5 }).width === 0;
      r.clamp = JSON.stringify(clampScreenRect({ x: 1900, y: 100, width: 200, height: 100 }, { x: 0, y: 0, width: 1920, height: 1080 })) === JSON.stringify({ x: 1900, y: 100, width: 20, height: 100 });
      r.clampNegative = clampScreenRect({ x: -50, y: -20, width: 100, height: 100 }, { x: 0, y: 0, width: 1920, height: 1080 }).x === 0
        && clampScreenRect({ x: -50, y: -20, width: 100, height: 100 }, { x: 0, y: 0, width: 1920, height: 1080 }).width === 100;
      // 2) 裁剪坐标：1920×1080 显示器，缩略图 3840×2160（2 倍）
      const cr = screenTranslateCropRect({ x: 100, y: 50, width: 200, height: 100 }, { x: 0, y: 0, width: 1920, height: 1080 }, 2, 2);
      r.cropRect = cr.x === 200 && cr.y === 100 && cr.width === 400 && cr.height === 200;
      const crEdge = screenTranslateCropRect({ x: 1900, y: 1000, width: 200, height: 200 }, { x: 0, y: 0, width: 1920, height: 1080 }, 2, 2);
      r.cropRectEdge = crEdge.x + crEdge.width <= 3840 && crEdge.y + crEdge.height <= 2160;
      // 3) 浮窗定位：右侧够放放右，右侧不够放左，上下夹回
      const d = { x: 0, y: 0, width: 1920, height: 1080 };
      r.posRight = JSON.stringify(screenTranslateResultPos(d, { x: 100, y: 100, width: 200, height: 100 }, 440, 360)) === JSON.stringify({ x: 312, y: 100 });
      r.posLeft = screenTranslateResultPos(d, { x: 1600, y: 100, width: 200, height: 100 }, 440, 360).x === 1600 - 440 - 12;
      const pBottom = screenTranslateResultPos(d, { x: 100, y: 900, width: 200, height: 100 }, 440, 360);
      r.posBottomClamped = pBottom.y + 360 <= 1080;
      // 4) 视觉消息拼装：OpenAI image_url；Anthropic 转原生 image 块
      const msgs = buildScreenTranslateVisionMessages('AAAABBBB', { from: 'auto', to: 'auto' });
      const userContent = msgs.find((m) => m.role === 'user').content;
      r.visionOpenAi = Array.isArray(userContent) && userContent.some((p) => p.type === 'image_url' && String(p.image_url.url).startsWith('data:image/png;base64,AAAABBBB'));
      const anth = visionContentForAnthropic(userContent);
      r.visionAnthropic = Array.isArray(anth) && anth.some((p) => p.type === 'image' && p.source && p.source.type === 'base64' && p.source.media_type === 'image/png' && p.source.data === 'AAAABBBB');
      r.visionPromptHasFormat = userContent.some((p) => p.type === 'text' && String(p.text || '').includes('{"original"'));
      // 5) 结果解析：JSON、围栏 JSON、非 JSON 兜底
      const p1 = parseScreenTranslateResult('{"original":"Hello","translated":"你好"}');
      r.parseJson = p1.original === 'Hello' && p1.translated === '你好';
      const p2 = parseScreenTranslateResult('```json\n{"original":"Hi","translated":"嗨"}\n```');
      r.parseFenced = p2.original === 'Hi' && p2.translated === '嗨';
      const p3 = parseScreenTranslateResult('just some text');
      r.parseFallback = p3.translated === 'just some text' && p3.original === '';
      // 6) 未配轮巡时的明确提示：先确认没装翻译插件时报 no-plugin
      savePlugins(getPlugins().filter((p) => p && p.name !== '翻译' && p.id !== 'translation'));
      const noPlugin = getTranslationRoundRobinSettings();
      r.noPluginCode = noPlugin.code === 'no-plugin' && /翻译插件/.test(noPlugin.error || '');
      // 7) 装翻译插件、不勾选智能体时报 no-agents
      const trInstall = await pluginInstallFromFolder(path.join(__dirname, 'plugins-dev', 'translation'));
      tr = trInstall && trInstall.plugin;
      r.pluginInstalled = !!(trInstall && trInstall.ok && tr && tr.id);
      if (tr) {
        pluginStoreSet(tr.id, { defaultMethod: 'roundrobin', from: 'auto', to: 'auto', roundrobin: { agents: [], limits: {}, intervalMs: 0, nextIndex: 0, lastCallAt: 0 } });
        const noAgents = getTranslationRoundRobinSettings();
        r.noAgentsCode = noAgents.code === 'no-agents' && /勾选/.test(noAgents.error || '');
      }
      // 8) mock 智能体端点：不支持视觉的模型报 400，视觉模型返回 JSON
      mock.srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
          try {
            const j = JSON.parse(body || '{}');
            if (req.url === '/v1/chat/completions') {
              if (j.model === 'novision-model') return send(400, { error: { message: 'model does not support images' } });
              if (j.model === 'vision-model') {
                const parts = (j.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
                if (parts.some((p) => p.type === 'image_url')) mock.sawOpenAiImage = true;
                return send(200, { choices: [{ message: { content: '{"original":"Hello world","translated":"你好，世界"}' } }] });
              }
              return send(400, { error: { message: 'unknown model' } });
            }
            if (req.url === '/messages') {
              const parts = (j.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
              if (parts.some((p) => p.type === 'image')) mock.sawAnthropicImage = true;
              return send(200, { content: [{ type: 'text', text: '{"original":"Bonjour","translated":"你好"}' }] });
            }
            return send(404, { error: { message: 'not found' } });
          } catch (e) { return send(400, { error: { message: String(e) } }); }
        });
      });
      await new Promise((res) => mock.srv.listen(0, '127.0.0.1', res));
      mock.port = mock.srv.address().port;
      const mkAgent = (name, provider, model, baseUrl) => {
        const list = getAgents();
        const agent = { id: 'st-screen-' + name, name, provider, model, baseUrl, apiKey: 'test-key', streaming: false, proxyPolicy: 'direct', toolsEnabled: false };
        list.push(agent); saveAgents(list); return agent;
      };
      const aNoVision = mkAgent('novision', 'deepseek', 'novision-model', `http://127.0.0.1:${mock.port}/v1`);
      const aVision = mkAgent('vision', 'deepseek', 'vision-model', `http://127.0.0.1:${mock.port}/v1`);
      const aAnth = mkAgent('anthropic', 'anthropic', 'claude-mock', `http://127.0.0.1:${mock.port}`);
      if (tr) {
        pluginStoreSet(tr.id, { defaultMethod: 'roundrobin', from: 'auto', to: 'auto', roundrobin: { agents: [aNoVision.id, aVision.id], limits: {}, intervalMs: 0, nextIndex: 0, lastCallAt: 0 } });
      }
      // 1x1 透明 PNG（只测流程，不调真实厂商接口）
      const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const rrRes = await screenTranslateRoundRobin(TINY_PNG);
      r.roundRobinFailover = !!(rrRes && rrRes.ok && rrRes.agentId === aVision.id && rrRes.translated === '你好，世界' && rrRes.original === 'Hello world');
      r.roundRobinFailures = !!(rrRes && Array.isArray(rrRes.failures) && rrRes.failures.some((f) => f.agentId === aNoVision.id));
      r.roundRobinNextIndex = tr ? Number(((pluginStoreGet(tr.id) || {}).roundrobin || {}).nextIndex) === 0 : false;
      r.openAiImageSent = mock.sawOpenAiImage === true;
      const anthRes = await screenTranslateVisionCall(aAnth, TINY_PNG, { from: 'auto', to: 'auto' });
      r.anthropicVision = !!(anthRes && anthRes.ok && anthRes.translated === '你好') && mock.sawAnthropicImage === true;
      // 9) 全局快捷键已注册
      r.shortcutRegistered = globalShortcut.isRegistered(SCREEN_TRANSLATE_SHORTCUT) === true;
      r.shortcutStatus = screenTranslateStatus().shortcutRegistered === true;
      // 10) 覆盖层窗口：打开、桥可用、关闭
      openScreenTranslateOverlay();
      await new Promise((res) => { const w = screenTranslateOverlayWin; if (!w) return res(); if (w.webContents.isLoading()) w.webContents.once('did-finish-load', res); else res(); });
      r.overlayOpen = !!(screenTranslateOverlayWin && !screenTranslateOverlayWin.isDestroyed());
      r.overlayBridge = await screenTranslateOverlayWin.webContents.executeJavaScript(`typeof window.toolbox.screenTranslateSelect === 'function' && typeof window.toolbox.screenTranslateCancel === 'function'`);
      r.overlayHint = await screenTranslateOverlayWin.webContents.executeJavaScript(`document.getElementById('hint') ? document.getElementById('hint').textContent : ''`).then((t) => /Esc/.test(String(t)));
      closeScreenTranslateOverlay();
      r.overlayClosed = !screenTranslateOverlayWin;
      // 11) 菜单入口：点菜单项 → 覆盖层打开（轮巡已配好）
      await js(`(async () => { await openMenuItem('screentranslate'); return true; })()`);
      await new Promise((res) => setTimeout(res, 500));
      r.menuOpensOverlay = !!(screenTranslateOverlayWin && !screenTranslateOverlayWin.isDestroyed());
      closeScreenTranslateOverlay();
      // 12) 浮窗：打开、加载态、收到结果后分开展示原文与译文
      const rw = openScreenTranslateResultWin({ x: 100, y: 100, width: 200, height: 100 });
      r.resultOpen = !!(rw && !rw.isDestroyed());
      await new Promise((res) => setTimeout(res, 800));
      r.resultLoadingShown = await rw.webContents.executeJavaScript(`!document.getElementById('state-loading').classList.contains('hidden')`);
      sendToScreenTranslateResult({ state: 'done', original: 'Hello', translated: '你好', agentName: '自测智能体', failures: [{ agentId: 'x', error: 'e' }] });
      await new Promise((res) => setTimeout(res, 500));
      r.resultDoneShown = await rw.webContents.executeJavaScript(`document.getElementById('text-translated').textContent === '你好' && document.getElementById('text-original').textContent === 'Hello' && !document.getElementById('state-done').classList.contains('hidden')`);
      r.resultFailNote = await rw.webContents.executeJavaScript(`!document.getElementById('fail-note').classList.contains('hidden')`);
      closeScreenTranslateResultWin();
      r.resultClosed = !screenTranslateResultWin;
      // 13) 选区截图：只截选区，返回 PNG base64，宽高比与选区一致
      const cap = await captureScreenRegion({ x: 0, y: 0, width: 80, height: 60 });
      r.captureOk = !!(cap && cap.ok && typeof cap.pngBase64 === 'string' && cap.pngBase64.length > 100 && cap.width > 0 && cap.height > 0 && Math.abs(cap.width / cap.height - 80 / 60) < 0.01);
      // 14) 配置默认值与静态接线：菜单、设置小节、插件页说明、桥与 IPC
      r.configDefault = !!getConfig().screenTranslate && getConfig().screenTranslate.autoClose === false;
      const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
      const preloadSrc = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
      const rendererSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
      r.bridges = /screenTranslateStart:/.test(preloadSrc) && /screenTranslateSelect:/.test(preloadSrc) && /screenTranslateRetry:/.test(preloadSrc) && /screen-translate-result/.test(preloadSrc);
      r.ipcHandlers = /ipcMain\.handle\('screen-translate-start'/.test(mainSrc) && /ipcMain\.handle\('screen-translate-select'/.test(mainSrc) && /ipcMain\.handle\('screen-translate-status'/.test(mainSrc);
      r.menuEntry = /data-menu=["']?screentranslate["']?/.test(html) && /屏幕翻译/.test(html);
      r.settingsSection = /screen-translate-autoclose/.test(html) && /screenTranslateStatus/.test(rendererSrc);
      r.pluginNote = fs.readFileSync(path.join(__dirname, 'plugins-dev', 'translation', 'page.html'), 'utf8').includes('屏幕翻译');
    } catch (e) { r.error = e.message || String(e); }
    try { if (mock.srv) mock.srv.close(); } catch (e) { /* 忽略 */ }
    try { closeScreenTranslateOverlay(); } catch (e) { /* 忽略 */ }
    try { closeScreenTranslateResultWin(); } catch (e) { /* 忽略 */ }
    try { saveAgents(snapAgents); } catch (e) { /* 忽略 */ }
    try { savePlugins(snapPlugins); } catch (e) { /* 忽略 */ }
    try {
      if (tr && tr.id) {
        fs.rmSync(pluginDirFor(tr.id), { recursive: true, force: true });
        try { fs.rmSync(path.join(userDataDir(), 'plugin-state', tr.id + '.json'), { force: true }); } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
    try { if (snapCfg) saveConfig({ ...getConfig(), screenTranslate: snapCfg }); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-7：第 1 项：内嵌浏览器——UA 去 Electron 标记、谷歌可
  // 加载、加载失败有错误面板、隧道死后代理复位回直连。
  nativeCheck.browser20261128 = await (async () => {
    const r = {};
    const snapPio = pioneerLoad();
    try {
      // UA：纯函数去 Electron 标记；重建 webview 后属性上也不带。
      r.uaStripped = await js(`typeof embeddedBrowserUA === 'function' && !/Electron\\//.test(embeddedBrowserUA()) && /Chrome\\//.test(embeddedBrowserUA())`);
      await js(`document.querySelector('#toolbox-webview')?.remove(); setEmbeddedBrowserKind('chromium');`);
      await new Promise((res) => setTimeout(res, 500));
      r.webviewUaAttr = await js(`!(document.querySelector('#toolbox-webview')?.getAttribute('useragent') || '').includes('Electron')`);
      // 谷歌：标题不可信（失败时错误页标题也是 google.com），以
      // webview 内 location.href 为准。沙盒 MITM 证书不被 webview
      // 信任（-202），到不了真页时记 skipped，真机验。
      const webviewHref = async () => { try { return await js(`(async () => { const wv = document.querySelector('#toolbox-webview'); if (!wv || typeof wv.executeJavaScript !== 'function') return ''; try { return await wv.executeJavaScript('location.href'); } catch (e) { return ''; } })()`); } catch (e) { return ''; } };
      await js(`chromeGo('https://www.google.com');`);
      let href = '';
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 500));
        href = await webviewHref();
        if (href.startsWith('https://www.google.com/')) break;
      }
      r.googleTitle = await js(`document.querySelector('#toolbox-webview')?.getTitle() || ''`);
      r.googleLoads = href.startsWith('https://www.google.com/') ? true : 'skipped-sandbox-cert';
      r.googleHref = href;
      // 失败面板：连不上本地端口 → 错误面板出现，带错误码与重试按钮。
      await js(`chromeGo('https://127.0.0.1:59999/');`);
      let errVisible = false;
      for (let i = 0; i < 16; i++) {
        await new Promise((res) => setTimeout(res, 500));
        errVisible = await js(`!document.querySelector('#chrome-load-error')?.classList.contains('hidden')`);
        if (errVisible) break;
      }
      r.failPanelShows = errVisible;
      r.failPanelHasCode = await js(`/-?\\d+/.test(document.querySelector('#chrome-load-error')?.textContent || '')`);
      r.failPanelHasRetry = await js(`!!document.querySelector('#chrome-load-error-retry')`);
      // 面板清除：失败后导航到本地 HTTP 页（无 TLS，沙盒内确定性），
      // 加载成功后面板应消失。
      const localSrv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>ok-page</title>ok'); });
      await new Promise((res) => localSrv.listen(0, '127.0.0.1', res));
      const localUrl = `http://127.0.0.1:${localSrv.address().port}/ok.html`;
      await js(`chromeGo(${JSON.stringify(localUrl)});`);
      let href2 = '';
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 500));
        href2 = await webviewHref();
        if (href2 === localUrl) break;
      }
      r.failPanelClears = href2 === localUrl && await js(`document.querySelector('#chrome-load-error')?.classList.contains('hidden') === true`);
      r.localClearsHref = href2;
      try { localSrv.close(); } catch (e) { /* 忽略 */ }
      // 代理：先挂一个死的本地代理，隧道“假连着”时调 verifyLive，
      // 应把状态打回未连接、把浏览器分区代理复位回直连。
      const bs = session.fromPartition('persist:toolbox-browser');
      await bs.setProxy({ proxyRules: 'http=127.0.0.1:19352;https=127.0.0.1:19352' });
      const before = await bs.resolveProxy('https://www.google.com/');
      r.proxyDeadSet = /19352/.test(before);
      pioneerSave({ ...snapPio, connected: true, tunnelRunning: true, region: 'TW' });
      const vl = await pioneerVerifyLive();
      const after = await bs.resolveProxy('https://www.google.com/');
      r.proxyResetOnDeadTunnel = vl.connected === false && after === 'DIRECT';
      r.pioneerStateCleared = pioneerLoad().connected === false;
    } catch (e) { r.error = e.message || String(e); }
    try { pioneerSave(snapPio); } catch (e) { /* 忽略 */ }
    try { await session.fromPartition('persist:toolbox-browser').setProxy({ mode: 'direct' }); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-7：第 2 项：嗅探面板——默认长方形、已保存 rect 不动、
  // 分类与页签用专业术语（折叠/持久化在 toolbox20261128 组里测）。
  nativeCheck.sniffPanel20261128 = await (async () => {
    const r = {};
    const snapRect = await js(`localStorage.getItem('sniff-panel-rect')`);
    try {
      const sniffPrev = await js(`sniffEnabled`);
      await js(`setSniffEnabled(true);`);
      // 默认长方形：清掉已保存 rect，清行内样式，打开面板量尺寸。
      await js(`localStorage.removeItem('sniff-panel-rect'); (function () { const p = document.querySelector('#browser-media-panel'); if (!p) return; p.style.left = ''; p.style.top = ''; p.style.width = ''; p.style.height = ''; p.style.maxHeight = ''; p.style.right = ''; p.style.bottom = ''; })();`);
      await js(`if (document.querySelector('#browser-media-panel').classList.contains('hidden')) document.querySelector('#browser-media-fab')?.click();`);
      await new Promise((res) => setTimeout(res, 500));
      const rc = await js(`(function () { const p = document.querySelector('#browser-media-panel'); if (!p) return null; const b = p.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`);
      r.defaultLandscape = !!(rc && rc.w >= 700 && rc.w > rc.h);
      r.defaultRect = rc ? `${rc.w}x${rc.h}` : 'none';
      // 已保存 rect 不动：写 500x400，恢复后仍是 500x400。
      await js(`localStorage.setItem('sniff-panel-rect', JSON.stringify({ left: 100, top: 100, width: 500, height: 400 })); restoreSniffPanelRect();`);
      await new Promise((res) => setTimeout(res, 300));
      r.savedRectKept = await js(`Math.abs(document.querySelector('#browser-media-panel').getBoundingClientRect().width - 500) <= 2`);
      // 专业术语：分类常量与页签文本。
      r.labelsProfessional = await js(`SNIFF_CATEGORY_LABEL.video === '视频媒体' && SNIFF_CATEGORY_LABEL['req-header'] === '请求头凭证' && SNIFF_CATEGORY_LABEL['page-data'] === '页面内嵌数据' && SNIFF_CATEGORY_LABEL.stream === '流式传输' && SNIFF_CATEGORY_LABEL.storage === 'Web 存储'`);
      // 直接 upsert 不触发重渲染（生产路径经 addSniffMedia 等渲染），
      // 这里显式 renderSniffPanel() 再读页签。
      await js(`(function () { sniffItems = []; sniffReqLog = []; sniffHistoryView = null; upsertSniffItem({ category: 'video', url: 'http://127.0.0.1:9/test.mp4', type: 'mp4', host: '127.0.0.1', pageUrl: 'http://127.0.0.1:9/' }); upsertSniffItem({ category: 'cookie', name: 'sess', value: 'abc123', host: '127.0.0.1', sourceUrl: 'http://127.0.0.1:9/' }); renderSniffPanel(); })();`);
      await new Promise((res) => setTimeout(res, 400));
      const tabsTxt = await js(`[...document.querySelectorAll('#sniff-tabs [data-sniff-tab]')].map((b) => b.textContent || '').join('|')`);
      r.tabLabels = /认证凭证/.test(tabsTxt) && /视频媒体/.test(tabsTxt) && !/登录态/.test(tabsTxt) && !/接口清单/.test(tabsTxt);
      r.tabLabelsText = tabsTxt;
      const rendererSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
      r.historyLabelPro = /label: '历史快照'/.test(rendererSrc);
      // API 端点页签计数来自请求日志（不是条目分类），标签走源码断言。
      r.apiLabelPro = /label: 'API 端点'/.test(rendererSrc);
      await js(`sniffItems = []; sniffReqLog = []; sniffHistoryView = null; renderSniffPanel();`);
      await js(`setSniffEnabled(${!!sniffPrev});`);
    } catch (e) { r.error = e.message || String(e); }
    try {
      await js(`(function () { const v = ${JSON.stringify(snapRect)}; if (v) localStorage.setItem('sniff-panel-rect', v); else localStorage.removeItem('sniff-panel-rect'); })();`);
    } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-7：第 3 项：菜单分离——独立窗口、主窗口铺满、点击
  // 转发切页、合并恢复、未分离时图标布局随侧栏宽变。
  nativeCheck.menuDetach20261128 = await (async () => {
    const r = {};
    const snapDetached = !!getConfig().menuDetached;
    try {
      const open = await js(`(async () => window.toolbox.menuDetachOpen())()`);
      r.detachOk = !!(open && open.ok && open.detached);
      if (menuWin && !menuWin.isDestroyed()) {
        await new Promise((res) => { if (menuWin.webContents.isLoading()) menuWin.webContents.once('did-finish-load', res); else res(); });
        await new Promise((res) => setTimeout(res, 600));
      }
      r.menuWindowOpen = !!(menuWin && !menuWin.isDestroyed());
      r.menuWindowUrl = menuWin ? menuWin.webContents.getURL() : '';
      r.menuWindowIsMenu = /menu=1/.test(r.menuWindowUrl);
      r.mainDetachedClass = await js(`document.body.classList.contains('menu-detached')`);
      r.configPersisted = getConfig().menuDetached === true;
      r.sidebarHidden = await js(`getComputedStyle(document.querySelector('#sidebar')).display === 'none'`);
      // 菜单窗口点“浏览器”→主窗口切到浏览器页。先把主窗口切到
      // 首页，避免它本来就在浏览器页造成假阳性。
      await clickMenu('toolbox');
      await new Promise((res) => setTimeout(res, 400));
      if (menuWin && !menuWin.isDestroyed()) {
        await menuWin.webContents.executeJavaScript(`(function () { const b = document.querySelector('[data-menu="browser"]'); if (b) b.click(); return !!b; })()`);
        await new Promise((res) => setTimeout(res, 800));
      }
      r.navigateForwards = await js(`document.querySelector('.screen.active')?.id === 'screen-browser'`);
      // 合并回主窗口。
      const closed = await js(`(async () => window.toolbox.menuDetachClose())()`);
      r.mergeOk = !!(closed && closed.ok);
      await new Promise((res) => setTimeout(res, 500));
      r.menuWindowClosed = !menuWin;
      r.mainRestored = await js(`!document.body.classList.contains('menu-detached') && getComputedStyle(document.querySelector('#sidebar')).display !== 'none'`);
      r.configCleared = getConfig().menuDetached === false;
      // 未分离时：侧栏宽变，菜单网格列数跟着变。
      await js(`applySidebarWidth(220);`);
      await new Promise((res) => setTimeout(res, 400));
      r.densityNarrow = await js(`(function () { const g = document.querySelector('#menu-grid'); if (!g) return false; const cols = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length; const lbl = g.querySelector('.menu-label'); return cols === 2 && (!lbl || getComputedStyle(lbl).display === 'none'); })()`);
      await js(`applySidebarWidth(480);`);
      await new Promise((res) => setTimeout(res, 400));
      r.densityWide = await js(`(function () { const g = document.querySelector('#menu-grid'); if (!g) return false; return getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length === 5; })()`);
      await js(`applySidebarWidth(340);`);
      await new Promise((res) => setTimeout(res, 400));
      r.densityMid = await js(`(function () { const g = document.querySelector('#menu-grid'); if (!g) return false; return getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length === 3; })()`);
    } catch (e) { r.error = e.message || String(e); }
    try { closeMenuWindow(); } catch (e) { /* 忽略 */ }
    try { await js(`applySidebarWidth(340);`); } catch (e) { /* 忽略 */ }
    try { if (snapDetached) await js(`(async () => window.toolbox.menuDetachOpen())()`); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-7：第 4 项：账号管理——凭证/密码/API 三种类型、旧
  // 数据兼容、自定义站点只需登录地址、嗅探自动保存去重。
  nativeCheck.accountsSniffAutoSave20261128 = await (async () => {
    const r = {};
    const snapAccounts = getAccounts();
    try {
      // 旧数据：无 kind/secret 字段 → 按凭证读，不丢数据。新建时主进程
      // 生成随机 id（传入的 id 只用于找旧记录），后续按返回的 id 查。
      const testIds = [];
      const oldSave = await js(`(async () => window.toolbox.accountSave({ site: 'deepseek', siteName: 'DeepSeek', name: '旧号', loginUrl: 'https://chat.deepseek.com' }))()`);
      r.oldCompatSaved = !!(oldSave && oldSave.ok);
      const oldId = oldSave && oldSave.account && oldSave.account.id;
      if (oldId) testIds.push(oldId);
      const list1 = await js(`(async () => window.toolbox.accountsList())()`);
      const oldView = ((list1 && list1.accounts) || []).find((a) => a.id === oldId);
      r.oldCompatKind = !!(oldView && oldView.kind === 'credential' && oldView.hasSecret === false);
      // 三种类型：密码与 API 密钥存值、列表只给脱敏值、原值不进 IPC。
      const pwSave = await js(`(async () => window.toolbox.accountSave({ site: 'deepseek', siteName: 'DeepSeek', name: '密码号', loginUrl: 'https://chat.deepseek.com', kind: 'password', identity: 'user@example.com', secret: 'pw-12345678' }))()`);
      const apiSave = await js(`(async () => window.toolbox.accountSave({ site: 'qwen', siteName: '通义千问', name: 'API 号', loginUrl: 'https://chat.qwen.ai', kind: 'api', identity: 'ak-user', secret: 'sk-abcdef1234' }))()`);
      r.kindsSaved = !!(pwSave && pwSave.ok && apiSave && apiSave.ok);
      const pwId = pwSave && pwSave.account && pwSave.account.id;
      const apiId = apiSave && apiSave.account && apiSave.account.id;
      if (pwId) testIds.push(pwId);
      if (apiId) testIds.push(apiId);
      const list2 = await js(`(async () => window.toolbox.accountsList())()`);
      const listJson = JSON.stringify(list2);
      const pwView = ((list2 && list2.accounts) || []).find((a) => a.id === pwId);
      const apiView = ((list2 && list2.accounts) || []).find((a) => a.id === apiId);
      r.maskedViews = !!(pwView && pwView.kind === 'password' && pwView.secretMasked === 'pw••••78' && pwView.identity === 'user@example.com'
        && apiView && apiView.kind === 'api' && apiView.secretMasked === 'sk••••34');
      r.secretNotInIpc = !listJson.includes('pw-12345678') && !listJson.includes('sk-abcdef1234');
      // 复制密钥：主进程内复制，返回值 ok（值不经过渲染进程）。
      const copy = await js(`(async () => window.toolbox.accountCopySecret(${JSON.stringify(pwId)}))()`);
      r.copySecretOk = !!(copy && copy.ok);
      // 自定义站点：抽屉里只填登录地址（不填注册地址）也能保存。
      await clickMenu('accounts');
      await js(`(async () => { openAccountDrawer(null); document.getElementById('account-site').value = 'custom'; document.getElementById('account-login-url').value = 'https://example.com/login'; document.getElementById('account-signup-url').value = ''; document.getElementById('account-name').value = '自测自定义站'; document.getElementById('account-kind').value = 'credential'; document.getElementById('account-secret').value = ''; document.getElementById('account-save').click(); return true; })()`);
      await new Promise((res) => setTimeout(res, 800));
      const list3 = await js(`(async () => window.toolbox.accountsList())()`);
      r.customSiteSaved = ((list3 && list3.accounts) || []).some((a) => a.siteName === 'example.com' && a.name === '自测自定义站');
      await js(`closeDrawer({ restoreFocus: false });`);
      // 分组：按站点分组头出现。
      await js(`renderAccounts();`);
      r.groupHeads = await js(`document.querySelectorAll('.account-group-head').length >= 2`);
      // 嗅探自动保存：构造已登录样本，调两次，只存一条。用 gemini 站
      // 测——本组前面已建了空标识的 deepseek 手动账号，按“站点+标识”
      // 去重会命中它，自动保存本就该跳过。
      // 注意：js() 的完成值要能跨进程克隆，结尾补 true，不能让求值
      // 结果是刚赋值的函数（会抛 DataCloneError，整组中止）。
      await js(`window.__testSetSniffEnabled(true); window.__testLoginCheck = async () => ({ ok: true, loggedIn: true, matchedKey: 'sessionid', host: 'gemini.google.com' }); true;`);
      await js(`(async () => { await maybePromptSaveAccount('https://gemini.google.com/', 'test'); return true; })()`);
      await new Promise((res) => setTimeout(res, 800));
      await js(`loginPromptedAt.delete('gemini.google.com');`);
      await js(`(async () => { await maybePromptSaveAccount('https://gemini.google.com/', 'test'); return true; })()`);
      await new Promise((res) => setTimeout(res, 800));
      const list4 = await js(`(async () => window.toolbox.accountsList())()`);
      const sniffSaved = ((list4 && list4.accounts) || []).filter((a) => a.site === 'gemini' && a.source === 'sniff');
      r.autoSaveOnce = sniffSaved.length === 1;
      // renderAccounts 是 async（先拉列表再渲染行），必须 await 完再读 DOM。
      r.autoSaveVisible = await js(`(async () => { await renderAccounts(); return [...document.querySelectorAll('.account-group-head, .row .badge')].some((el) => (el.textContent || '').includes('嗅探自动保存')); })()`);
      // 嗅探关闭时不自动保存（已有同站账号时走去重分支，不弹框、不新增）。
      await js(`window.__testSetSniffEnabled(false); loginPromptedAt.delete('gemini.google.com');`);
      const beforeOff = ((list4 && list4.accounts) || []).length;
      await js(`(async () => { await maybePromptSaveAccount('https://gemini.google.com/', 'test'); return true; })()`);
      await new Promise((res) => setTimeout(res, 500));
      const list5 = await js(`(async () => window.toolbox.accountsList())()`);
      r.noAutoSaveWhenOff = ((list5 && list5.accounts) || []).length === beforeOff;
    } catch (e) { r.error = e.message || String(e); }
    try { await js(`window.__testLoginCheck = undefined; window.__testSetSniffEnabled(false);`); } catch (e) { /* 忽略 */ }
    try {
      for (const id of testIds) await js(`(async () => window.toolbox.accountDelete(${JSON.stringify(id)}))()`);
      const cur = await js(`(async () => window.toolbox.accountsList())()`);
      for (const a of ((cur && cur.accounts) || [])) {
        if (a.siteName === 'example.com' || ((a.source === 'sniff' && (a.site === 'gemini' || a.site === 'deepseek')))) await js(`(async () => window.toolbox.accountDelete('${a.id}'))()`);
      }
    } catch (e) { /* 忽略 */ }
    try { saveAccounts(snapAccounts); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-8，P0-1：诊断日志 + 崩溃兜底。
  nativeCheck.diagnostics20261128 = await (async () => {
    const r = {};
    const logFile = path.join(diagLogDir(), `${new Date().toISOString().slice(0, 10)}.log`);
    const logBefore = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : null;
    const crashBefore = fs.existsSync(path.join(userDataDir(), 'crash-log.json')) ? fs.readFileSync(path.join(userDataDir(), 'crash-log.json'), 'utf8') : null;
    try {
      // 脱敏：密钥类键值与 Bearer 令牌应打码，普通文本不动。
      const masked = sanitizeDiagText('apiKey: sk-abcdef123456, token=xyz789, Authorization: Bearer abcdefghijklmnop, path=/a/b/c.js');
      r.sanitizeMasksSecrets = !masked.includes('sk-abcdef123456') && !masked.includes('xyz789') && !masked.includes('abcdefghijklmnop') && masked.includes('••••');
      r.sanitizeKeepsNormalText = masked.includes('/a/b/c.js');
      // 写日志：今天文件里应有刚写的一条。
      diagLogWrite({ at: new Date().toISOString(), kind: 'selftest-probe', message: '自测探针', stack: '' });
      const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
      r.logWritten = lines.some((l) => l.includes('selftest-probe'));
      // 崩溃标记：写 → 读 → 清。
      writeCrashMarker({ at: new Date().toISOString(), kind: 'selftest-probe', message: '自测探针标记' });
      const marker = readCrashMarker();
      r.markerRoundTrip = !!marker && marker.kind === 'selftest-probe';
      clearCrashMarker();
      r.markerCleared = readCrashMarker() === null;
      // 主进程异常处理函数：直接调，验落盘与标记（不退出进程）。
      handleMainProcessError('selftest-error', new Error('自测模拟异常 apiKey=sk-should-be-masked'));
      const lines2 = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
      const last = lines2.length ? JSON.parse(lines2[lines2.length - 1]) : null;
      r.errorLogged = !!last && last.kind === 'selftest-error';
      r.errorLogMasked = !!last && !String(last.message || '').includes('sk-should-be-masked');
      r.errorMarkerWritten = !!readCrashMarker();
      clearCrashMarker();
      // 诊断包：构建 bundle，密钥字段应打码。
      const bundle = buildDiagnosticsBundle();
      r.bundleHasVersion = bundle.version === VERSION;
      r.bundleNoSecrets = JSON.stringify(bundle).indexOf('sk-should-be-masked') === -1;
      // 诊断状态形状。
      const st = diagnosticsStatus();
      r.statusOk = st && st.ok === true && Array.isArray(st.logFiles);
    } catch (e) { r.error = e.message || String(e); }
    finally {
      // 自测不污染本机数据：今天的日志文件与 crash-log.json 恢复原样。
      try { if (logBefore === null) fs.rmSync(logFile, { force: true }); else fs.writeFileSync(logFile, logBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      try { if (crashBefore === null) fs.rmSync(path.join(userDataDir(), 'crash-log.json'), { force: true }); else fs.writeFileSync(path.join(userDataDir(), 'crash-log.json'), crashBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      clearCrashMarker();
    }
    return r;
  })();
  // 2026-11-28-8，P0-4：数据迁移框架。
  nativeCheck.migration20261128 = await (async () => {
    const r = {};
    const accountsFp = path.join(userDataDir(), 'accounts.json');
    const configFp = configPath();
    const agentsFp = path.join(userDataDir(), 'agents.json');
    const accountsBefore = fs.existsSync(accountsFp) ? fs.readFileSync(accountsFp, 'utf8') : null;
    const configBefore = fs.existsSync(configFp) ? fs.readFileSync(configFp, 'utf8') : null;
    const agentsBefore = fs.existsSync(agentsFp) ? fs.readFileSync(agentsFp, 'utf8') : null;
    try {
      // 旧版 accounts.json（裸数组、缺新字段）→ 升版为 v1，不丢数据。
      fs.writeFileSync(accountsFp, JSON.stringify([{ id: 'acc_old1', site: 'deepseek', siteName: 'DeepSeek', loginUrl: 'https://chat.deepseek.com', name: '旧号' }]), 'utf8');
      const got = getAccounts();
      r.accountsV0Migrated = got.length === 1 && got[0].id === 'acc_old1' && got[0].kind === 'credential' && got[0].source === 'manual' && got[0].identity === '';
      const afterFile = JSON.parse(fs.readFileSync(accountsFp, 'utf8'));
      r.accountsFileNowV1 = afterFile && afterFile.version === CURRENT_ACCOUNTS_VERSION && Array.isArray(afterFile.items) && afterFile.items.length === 1;
      // v1 往返：saveAccounts 写 v1，getAccounts 读回。
      saveAccounts([{ id: 'acc_v1', site: 'qwen', siteName: '通义千问', loginUrl: 'https://chat.qwen.ai', kind: 'api', identity: 'ak-user', secret: 'sk-test', source: 'manual', autoSavedAt: 0 }]);
      const got1 = getAccounts();
      r.accountsV1RoundTrip = got1.length === 1 && got1[0].kind === 'api' && got1[0].identity === 'ak-user';
      // 未知版本：备份原文件 + 按空处理，不静默覆盖。
      fs.writeFileSync(accountsFp, JSON.stringify({ version: 99, items: [{ id: 'acc_future' }] }), 'utf8');
      const got99 = getAccounts();
      const corruptCopies = fs.readdirSync(userDataDir()).filter((f) => f.startsWith('accounts.json.corrupt-'));
      r.accountsUnknownVersionEmpty = got99.length === 0;
      r.accountsUnknownVersionBackedUp = corruptCopies.length > 0;
      // agents.json：裸数组读得到，saveAgents 写 v1；未知版本备份。
      fs.writeFileSync(agentsFp, JSON.stringify([{ id: 'ag_old', name: '旧智能体' }]), 'utf8');
      r.agentsV0Read = getAgents().some((a) => a.id === 'ag_old');
      saveAgents([{ id: 'ag_v1', name: '新智能体' }]);
      const agentsAfter = JSON.parse(fs.readFileSync(agentsFp, 'utf8'));
      r.agentsFileNowV1 = agentsAfter && agentsAfter.version === CURRENT_AGENTS_VERSION && Array.isArray(agentsAfter.items);
      fs.writeFileSync(agentsFp, JSON.stringify({ version: 99, items: [] }), 'utf8');
      r.agentsUnknownVersionEmpty = getAgents().length === 0;
      // config.json：无 version 的旧文件读作 v1；未知版本按默认处理并备份。
      const cfgRaw = JSON.parse(configBefore || '{}');
      delete cfgRaw.version;
      fs.writeFileSync(configFp, JSON.stringify(cfgRaw), 'utf8');
      invalidateConfigCache();
      r.configV0ReadsAsV1 = loadConfig().version === CURRENT_CONFIG_VERSION;
      fs.writeFileSync(configFp, JSON.stringify({ ...cfgRaw, version: 99 }), 'utf8');
      invalidateConfigCache();
      const loaded99 = loadConfig();
      r.configUnknownVersionDefaults = loaded99.version === CURRENT_CONFIG_VERSION && loaded99.theme === 'auto';
      r.configUnknownVersionBackedUp = fs.readdirSync(userDataDir()).some((f) => f.startsWith('config.json.corrupt-'));
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { if (accountsBefore === null) fs.rmSync(accountsFp, { force: true }); else fs.writeFileSync(accountsFp, accountsBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      try { if (configBefore === null) fs.rmSync(configFp, { force: true }); else fs.writeFileSync(configFp, configBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      try { if (agentsBefore === null) fs.rmSync(agentsFp, { force: true }); else fs.writeFileSync(agentsFp, agentsBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      invalidateConfigCache();
      try { for (const c of fs.readdirSync(userDataDir()).filter((f) => /\.corrupt-/.test(f))) { if (c.startsWith('accounts.json.corrupt-') || c.startsWith('config.json.corrupt-') || c.startsWith('agents.json.corrupt-')) fs.rmSync(path.join(userDataDir(), c), { force: true }); } } catch (e) { /* 清理失败不影响 */ }
    }
    return r;
  })();
  // 2026-11-28-8，P0-3：裸写收口 + 配置单写者队列。
  nativeCheck.writerQueue20261128 = await (async () => {
    const r = {};
    const appsBefore = loadToolboxApps();
    const ignoreBefore = loginIgnoreLoad();
    const mailtmBefore = fs.existsSync(mailtmFile()) ? fs.readFileSync(mailtmFile(), 'utf8') : null;
    const fp = configPath();
    try {
      // 配置队列：先定一个已知值并落盘，再连续 5 次 saveConfig（末值 true）；
      // 100ms 后文件仍是旧值（证明合并写在防抖，未立即写盘），缓存已是新值；
      // flush 后文件与缓存一致；最后恢复原值并落盘。
      const beforeTrans = getConfig().windowTransparent;
      saveConfig({ ...getConfig(), windowTransparent: false });
      flushConfigNow();
      r.setupFlushedFalse = JSON.parse(fs.readFileSync(fp, 'utf8')).windowTransparent === false;
      for (let i = 0; i < 5; i++) saveConfig({ ...getConfig(), windowTransparent: i % 2 === 0 });
      r.cacheSeesLatestWrite = getConfig().windowTransparent === true;
      await new Promise((res) => setTimeout(res, 100));
      r.writeDeferredBeforeFlush = JSON.parse(fs.readFileSync(fp, 'utf8')).windowTransparent === false;
      flushConfigNow();
      const afterFlush = JSON.parse(fs.readFileSync(fp, 'utf8'));
      r.flushedMatchesCache = afterFlush.windowTransparent === true && afterFlush.version === CURRENT_CONFIG_VERSION;
      saveConfig({ ...getConfig(), windowTransparent: beforeTrans });
      flushConfigNow();
      r.restored = JSON.parse(fs.readFileSync(fp, 'utf8')).windowTransparent === beforeTrans;
      // 裸写收口：5 处现在都走原子写（写后文件合法、无 .tmp 残留）。
      saveToolboxApps([{ key: 'wq-test', name: '队列测试', kind: 'test', installedAt: Date.now() }]);
      r.toolboxAppsAtomic = loadToolboxApps().some((x) => x.key === 'wq-test');
      loginIgnoreSave({ 'wq.example': true });
      r.loginIgnoreAtomic = loginIgnoreLoad()['wq.example'] === true;
      pluginStoreSet('wq-test-plugin', { a: 1 });
      r.pluginStoreAtomic = pluginStoreGet('wq-test-plugin') && pluginStoreGet('wq-test-plugin').a === 1;
      mailtmSave({ address: 'wq@mock.test', token: 'wq-token', seen: [] });
      r.mailtmAtomic = (() => { try { return JSON.parse(fs.readFileSync(mailtmFile(), 'utf8')).address === 'wq@mock.test'; } catch (e) { return false; } })();
      const tmpLeft = fs.readdirSync(userDataDir()).filter((f) => /\.tmp-\d+$/.test(f));
      r.noTmpLeftovers = tmpLeft.length === 0;
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { saveToolboxApps(appsBefore); } catch (e) { /* 恢复失败不影响 */ }
      try { loginIgnoreSave(ignoreBefore); } catch (e) { /* 恢复失败不影响 */ }
      try { if (mailtmBefore === null) fs.rmSync(mailtmFile(), { force: true }); else fs.writeFileSync(mailtmFile(), mailtmBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      try { fs.rmSync(path.join(pluginStoreDir(), 'wq-test-plugin.json'), { force: true }); } catch (e) { /* 忽略 */ }
      flushConfigNow();
    }
    return r;
  })();
  // 2026-11-28-8，P0-2：mock Mail.tm 全流程（建邮箱 → 取令牌 → 拉邮件
  // → 提取 6 位验证码记入注册记录）；生产代码默认仍走真实 api.mail.tm。
  nativeCheck.mailtmMock20261128 = await (async () => {
    const r = {};
    const mailtmBefore = fs.existsSync(mailtmFile()) ? fs.readFileSync(mailtmFile(), 'utf8') : null;
    const recordsBefore = readJsonList('register-records.json');
    let mock = null;
    try {
      mock = await startMockMailtmServer();
      try { fs.rmSync(path.join(userDataDir(), 'mailtm.json'), { force: true }); } catch (e) { /* 删不掉用旧账号也行 */ }
      const res = await mailtmFetch(mock.base);
      r.fetchOk = !!(res && res.ok);
      r.fetchedOne = res && res.fetched === 1;
      r.addedOne = res && res.added === 1;
      const recs = readJsonList('register-records.json');
      r.codeExtracted = recs.some((x) => x.code === '123456' && String(x.target || '').includes('mock.test'));
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { if (mock) mockMailtmServerClose(); } catch (e) { /* 关不掉不影响 */ }
      try { if (mailtmBefore === null) fs.rmSync(mailtmFile(), { force: true }); else fs.writeFileSync(mailtmFile(), mailtmBefore, 'utf8'); } catch (e) { /* 恢复失败不影响 */ }
      try { writeJsonList('register-records.json', recordsBefore); } catch (e) { /* 恢复失败不影响 */ }
    }
    return r;
  })();
  // 2026-11-28-9，第 1 项：Pioneer 开着时更新检查失败——清单拉取先走
  // 直连再走代理。死代理配着时也应直连成功；两条路都死时报错要写清
  // 两条路各自的原因，不只报“未找到更新信息”。
  nativeCheck.updateCheckPioneer20261128 = await (async () => {
    const r = {};
    let mock = null;
    const cfgBefore = getConfig();
    try {
      mock = await new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ internalVersion: '2026.11.28-99', displayVersion: '2026-11-28-99', files: [] }));
        });
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
      });
      const url = `http://127.0.0.1:${mock.port}/update-manifest.json`;
      const directOk = await fetchUpdateManifest(url);
      r.directFirst = !!(directOk && directOk.ok && directOk.via === 'direct');
      // 配一个死的代理（模拟 Pioneer 隧道出口不通）：直连仍应成功。
      saveConfig({ ...getConfig(), proxyMode: 'manual', proxyHost: '127.0.0.1', proxyPort: 9 });
      flushConfigNow();
      const withDeadProxy = await fetchUpdateManifest(url);
      r.deadProxyStillDirect = !!(withDeadProxy && withDeadProxy.ok && withDeadProxy.via === 'direct');
      // 两条路都死：报错同时写清直连与代理的原因。
      const bothDead = await fetchUpdateManifest('http://127.0.0.1:9/nope-manifest.json');
      r.bothDeadFails = !!(bothDead && !bothDead.ok && !bothDead.noManifest);
      r.bothDeadReasons = typeof bothDead.error === 'string' && /直连失败/.test(bothDead.error) && /经代理也失败/.test(bothDead.error);
      r.bothDeadError = bothDead.error || '';
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { if (mock) mock.srv.close(); } catch (e) { /* 忽略 */ }
      try { saveConfig({ ...getConfig(), proxyMode: cfgBefore.proxyMode || 'direct', proxyHost: cfgBefore.proxyHost || '', proxyPort: cfgBefore.proxyPort || '' }); flushConfigNow(); } catch (e) { /* 忽略 */ }
    }
    return r;
  })();
  // 2026-11-28-9，第 2 项：浏览器跟随右侧尺寸——账号指纹视图（写死行内
  // 宽高）被夹回内容区内，窗口缩小时重夹；菜单窗口与主窗口各自调大小、
  // 移位置互不干扰，菜单窗口尺寸持久化。
  nativeCheck.browserFollow20261128 = await (async () => {
    const r = {};
    try {
      await js(`gotoScreen('browser');`);
      await new Promise((res) => setTimeout(res, 400));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res) => setTimeout(res, 500));
      await js(`loadChromeWebview('about:blank');`);
      await new Promise((res) => setTimeout(res, 500));
      await js(`ensureAccountWebview({ viewport: { w: 2000, h: 1500 }, loginUrl: 'about:blank', partition: 'persist:toolbox-browser' });`);
      await new Promise((res) => setTimeout(res, 600));
      const m = await js(`(function () { const v = document.querySelector('#chrome-view'); const p = document.querySelector('#browser-chromium-view'); if (!v || !p) return null; const vr = v.getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { vw: Math.round(vr.width), vh: Math.round(vr.height), pw: Math.round(pr.width), ph: Math.round(pr.height), fitsW: vr.width <= pr.width + 1, fitsH: vr.bottom <= pr.bottom + 1 }; })()`);
      r.accountClamped = !!(m && m.fitsW && m.fitsH);
      r.accountMeasure = m ? `${m.vw}x${m.vh} / ${m.pw}x${m.ph}` : 'none';
      const winSize = mainWin.getSize();
      mainWin.setSize(winSize[0], Math.max(600, winSize[1] - 200));
      await new Promise((res) => setTimeout(res, 600));
      const m2 = await js(`(function () { const v = document.querySelector('#chrome-view'); const p = document.querySelector('#browser-chromium-view'); if (!v || !p) return null; const vr = v.getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { fitsW: vr.width <= pr.width + 1, fitsH: vr.bottom <= pr.bottom + 1 }; })()`);
      r.accountReclamped = !!(m2 && m2.fitsW && m2.fitsH);
      mainWin.setSize(winSize[0], winSize[1]);
      await new Promise((res) => setTimeout(res, 400));
      await js(`restoreDefaultWebview();`);
      r.restored = await js(`!document.querySelector('#chrome-view').classList.contains('account-sized')`);
      const mainBefore = { size: mainWin.getSize(), pos: mainWin.getPosition() };
      const open = await js(`(async () => window.toolbox.menuDetachOpen())()`);
      r.menuOpened = !!(open && open.ok);
      if (menuWin && !menuWin.isDestroyed()) {
        await new Promise((res) => { if (menuWin.webContents.isLoading()) menuWin.webContents.once('did-finish-load', res); else res(); });
        await new Promise((res) => setTimeout(res, 500));
        const menuBefore = { size: menuWin.getSize(), pos: menuWin.getPosition() };
        menuWin.setSize(menuBefore.size[0] + 60, menuBefore.size[1] + 60);
        menuWin.setPosition(menuBefore.pos[0] + 40, menuBefore.pos[1] + 40);
        await new Promise((res) => setTimeout(res, 500));
        const mainAfter = { size: mainWin.getSize(), pos: mainWin.getPosition() };
        r.menuResizeIndependent = mainAfter.size[0] === mainBefore.size[0] && mainAfter.size[1] === mainBefore.size[1] && mainAfter.pos[0] === mainBefore.pos[0] && mainAfter.pos[1] === mainBefore.pos[1];
        r.menuMoved = menuWin.getPosition()[0] !== menuBefore.pos[0];
        r.menuResized = menuWin.getSize()[0] !== menuBefore.size[0];
        const savedSize = menuWin.getSize();
        await js(`(async () => window.toolbox.menuDetachClose())()`);
        await new Promise((res) => setTimeout(res, 500));
        const cfg = getConfig();
        r.menuBoundsPersisted = !!(cfg.menuWindowBounds && Math.abs(Number(cfg.menuWindowBounds.width) - savedSize[0]) <= 2);
      }
    } catch (e) { r.error = e.message || String(e); }
    try { closeMenuWindow(); } catch (e) { /* 忽略 */ }
    try { await js(`restoreDefaultWebview();`); } catch (e) { /* 忽略 */ }
    return r;
  })();
  // 2026-11-28-9，第 3 项 + 补充 2：Network 面板（表格/排序/过滤/搜索/
  // 只看错误/详情/请求体打码/时间线）与本地代理（HTTP 转发、CONNECT
  // 只记隧道、域名过滤、系统代理命令纯函数、面板拉升跟随）。
  nativeCheck.sniffNetwork20261128 = await (async () => {
    const r = {};
    let proxy = null;
    let upstream = null;
    try {
      await js(`(function () { sniffItems = []; sniffReqLog = []; sniffHistoryView = null; sniffReqDetailId = null; sniffNetFilter = { type: '', q: '', errorsOnly: false, sortKey: 'time', sortDir: -1 }; sniffReqLog.push(
        { id: 't1', method: 'GET', url: 'https://api.example.com/users/1', host: 'api.example.com', status: 200, size: 1200, durationMs: 120, type: '接口', source: 'browser', at: Date.now(), timings: { wait: 80, receive: 40, total: 120 } },
        { id: 't2', method: 'POST', url: 'https://img.example.com/pic.png', host: 'img.example.com', status: 404, size: 0, durationMs: 900, type: '图片', source: 'browser', at: Date.now(), timings: { wait: 800, receive: 100, total: 900 }, reqHeaders: { 'content-type': 'image/png' }, resHeaders: {}, reqBody: '{"token":"abc123456789"}' },
        { id: 't3', method: 'CONNECT', url: 'chat.example.com:443', host: 'chat.example.com', status: 0, size: 0, durationMs: 50, type: '隧道', source: 'proxy', at: Date.now(), timings: { wait: 0, receive: 0, total: 50 } }
      ); sniffActiveTab = 'reqlog'; sniffPanelOpen = true; renderSniffPanel(); })();`);
      await new Promise((res) => setTimeout(res, 400));
      r.tableRows = await js(`document.querySelectorAll('#sniff-net-list .sniff-net-table tbody tr').length`);
      r.tableRowsOk = r.tableRows === 3;
      await js(`sniffNetFilter.sortKey = 'duration'; sniffNetFilter.sortDir = -1; renderSniffPanel();`);
      await new Promise((res) => setTimeout(res, 300));
      r.sortByDuration = await js(`document.querySelector('#sniff-net-list .sniff-net-table tbody tr td')?.textContent === 'POST'`);
      await js(`sniffNetFilter.sortKey = 'time'; sniffNetFilter.sortDir = -1; sniffNetFilter.errorsOnly = true; renderSniffPanel();`);
      await new Promise((res) => setTimeout(res, 300));
      r.errorsOnlyCount = await js(`document.querySelectorAll('#sniff-net-list .sniff-net-table tbody tr').length`);
      await js(`sniffNetFilter.errorsOnly = false; sniffNetFilter.q = 'api.example'; renderSniffPanel();`);
      await new Promise((res) => setTimeout(res, 300));
      r.searchCount = await js(`document.querySelectorAll('#sniff-net-list .sniff-net-table tbody tr').length`);
      await js(`sniffNetFilter.q = ''; sniffNetFilter.type = ''; renderSniffPanel(); [...document.querySelectorAll('#sniff-net-list .sniff-net-table tbody tr')].find((tr) => tr.firstChild.textContent === 'POST')?.click();`);
      await new Promise((res) => setTimeout(res, 600));
      r.detailShown = await js(`!!document.querySelector('#sniff-net-detail .sniff-req-detail')`);
      r.bodyMasked = await js(`(async () => { sniffNetDetailTab = 'reqBody'; renderSniffPanel(); await new Promise((res2) => setTimeout(res2, 300)); const t = document.querySelector('#sniff-net-detail .sniff-req-detail')?.textContent || ''; return t.includes('••••') && !t.includes('abc123456789'); })()`);
      r.timelineShown = await js(`(async () => { sniffNetDetailTab = 'timeline'; renderSniffPanel(); await new Promise((res2) => setTimeout(res2, 300)); const t = document.querySelector('#sniff-net-detail')?.textContent || ''; return /总耗时：900ms/.test(t) && /等待首字节：800ms/.test(t); })()`);
      r.maskFn = await js(`maskSniffBodyText('{"password":"x9y8z7w6"}').includes('••••') && !maskSniffBodyText('{"password":"x9y8z7w6"}').includes('x9y8z7w6')`);
      // 其他软件页签常驻（没内容也显示）。
      r.proxyTabAlways = await js(`[...document.querySelectorAll('#sniff-tabs [data-sniff-tab]')].some((b) => b.dataset.sniffTab === 'proxy')`);
      // 本地代理：上游 mock + HTTP 转发 + CONNECT 隧道 + 域名过滤。
      upstream = await new Promise((resolve) => {
        const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('upstream-ok'); });
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
      });
      proxy = await startSniffProxy();
      r.proxyStarted = !!(proxy && proxy.ok && proxy.port > 0);
      const proxied = await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'GET', path: `http://127.0.0.1:${upstream.port}/hello`, timeout: 5000 }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', (e) => resolve({ error: e.message || String(e) }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
        req.end();
      });
      r.proxyForwards = proxied && proxied.status === 200 && proxied.body === 'upstream-ok';
      await new Promise((res) => setTimeout(res, 600));
      r.proxyLogged = await js(`sniffReqLog.some((e) => e.source === 'proxy' && e.type === '代理' && (e.url || '').includes('/hello'))`);
      const tun = await new Promise((resolve) => {
        const sock = net.connect(proxy.port, '127.0.0.1', () => { sock.write(`CONNECT 127.0.0.1:${upstream.port} HTTP/1.1\r\nHost: 127.0.0.1:${upstream.port}\r\n\r\n`); });
        let buf = '';
        sock.on('data', (c) => { buf += c.toString(); if (buf.includes('200')) { sock.end(); resolve({ ok: buf.includes('200 Connection Established') }); } });
        sock.on('error', (e) => resolve({ error: e.message || String(e) }));
        setTimeout(() => resolve({ error: 'timeout' }), 5000);
      });
      r.connectOk = !!(tun && tun.ok);
      await new Promise((res) => setTimeout(res, 600));
      r.connectLogged = await js(`sniffReqLog.some((e) => e.source === 'proxy' && e.method === 'CONNECT' && e.type === '隧道')`);
      sniffProxyState.domains = ['example.com'];
      const before = await js(`sniffReqLog.filter((e) => e.source === 'proxy').length`);
      await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'GET', path: `http://127.0.0.1:${upstream.port}/filtered`, timeout: 5000 }, (res) => { res.resume(); res.on('end', resolve); });
        req.on('error', resolve);
        req.end();
      });
      await new Promise((res) => setTimeout(res, 500));
      const after = await js(`sniffReqLog.filter((e) => e.source === 'proxy').length`);
      r.domainFilterDrops = after === before;
      sniffProxyState.domains = [];
      const cmds = sniffProxySystemCommands(true, 12345, null);
      r.proxyCmds = cmds.some((c) => c[1].includes('127.0.0.1:12345')) && cmds.some((c) => c[1].includes('ProxyEnable'));
      const sysR = await setSniffProxySystem(true);
      r.systemModeRefusedOnLinux = sysR && sysR.ok === false;
      await js(`(function () { const p = document.querySelector('#browser-media-panel'); p.style.width = '600px'; p.style.height = '500px'; p.style.maxHeight = '500px'; })();`);
      await new Promise((res) => setTimeout(res, 300));
      const ph = await js(`(function () { const p = document.querySelector('#browser-media-panel'); const l = document.querySelector('#browser-media-list'); if (!p || !l) return null; return { panelH: Math.round(p.getBoundingClientRect().height), listH: Math.round(l.getBoundingClientRect().height) }; })()`);
      r.panelGrowsWithHeight = !!(ph && Math.abs(ph.panelH - 500) <= 2 && ph.listH > 200);
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { await stopSniffProxy(); } catch (e) { /* 忽略 */ }
      try { if (upstream) upstream.srv.close(); } catch (e) { /* 忽略 */ }
      try { await js(`sniffItems = []; sniffReqLog = []; sniffHistoryView = null; sniffReqDetailId = null; sniffPanelOpen = false; renderSniffPanel(); localStorage.removeItem('sniff-panel-rect'); (function () { const p = document.querySelector('#browser-media-panel'); if (!p) return; p.style.left = ''; p.style.top = ''; p.style.width = ''; p.style.height = ''; p.style.maxHeight = ''; p.style.right = ''; p.style.bottom = ''; })();`); } catch (e) { /* 忽略 */ }
    }
    return r;
  })();
  // 2026-11-28-9，第 4 项：IP 纯净度多服务回退——4 家服务并行、每家
  // 状态分开记、失败文案列出每家原因与下一步；评分纯函数形状。
  nativeCheck.ipPurityMulti20261128 = await (async () => {
    const r = {};
    try {
      const metaRes = await pioneerFetchIpMeta(false);
      r.servicesCount = Array.isArray(metaRes.services) ? metaRes.services.length : 0;
      r.servicesShape = Array.isArray(metaRes.services) && metaRes.services.every((s) => s && typeof s.name === 'string' && typeof s.ok === 'boolean' && typeof s.ms === 'number');
      r.servicesNames = (metaRes.services || []).map((s) => s.name).join(',');
      r.fourServices = (metaRes.services || []).length === 4;
      // 成功分支：拿到 IP；失败分支：报错列出每家服务原因与下一步。
      // 沙盒里至少一家服务实际通，不假设全失败。
      r.resultShapeOk = metaRes.ok === true
        ? !!(metaRes.meta && metaRes.meta.ip)
        : (typeof metaRes.error === 'string' && /ipinfo\.io/.test(metaRes.error) && /ip-api\.com/.test(metaRes.error) && /ip\.sb/.test(metaRes.error) && /重新检测/.test(metaRes.error));
      // 失败分支确定性触发：经死代理（127.0.0.1:19352 无监听）四家全败，
      // 报错必须列出每家原因与下一步。
      const deadRes = await pioneerFetchIpMeta(true);
      r.failurePathAllFailed = deadRes.ok === false && Array.isArray(deadRes.services) && deadRes.services.length === 4 && deadRes.services.every((s) => s.ok === false);
      r.errorListsServices = typeof deadRes.error === 'string' && /ipinfo\.io/.test(deadRes.error) && /ipwho\.is/.test(deadRes.error) && /ip-api\.com/.test(deadRes.error) && /ip\.sb/.test(deadRes.error) && /重新检测/.test(deadRes.error);
      r.errorText = deadRes.error || '';
      const scored = scoreIpPurity({ ip: '1.2.3.4', country: 'TW', org: 'Test ISP', asn: 'AS1234', hostname: '' }, 'TW');
      r.scoreShape = typeof scored.score === 'number' && typeof scored.grade === 'string' && Array.isArray(scored.reasons);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-9，第 5 项：长期记忆单独「记忆」页签——查看/搜索/新增/
  // 删除/开关都在页签里；开关关掉后系统提示不再带长期记忆。
  nativeCheck.memoryTab20261128 = await (async () => {
    const r = {};
    let agentId = '';
    try {
      await clickMenu('agents');
      await new Promise((res) => setTimeout(res, 500));
      r.memoryTabExists = await js(`!!document.querySelector('[data-agent-tab="memory"]')`);
      r.tabOrder = await js(`[...document.querySelectorAll('#screen-agents [data-agent-tab]')].map((b) => b.dataset.agentTab).join(',')`);
      await js(`gotoAgentTab('memory');`);
      await new Promise((res) => setTimeout(res, 500));
      r.memoryPaneActive = await js(`document.querySelector('#agent-tab-memory')?.classList.contains('active')`);
      r.memoryControls = await js(`!!document.querySelector('#memory-agent') && !!document.querySelector('#memory-input') && !!document.querySelector('#memory-add') && !!document.querySelector('#memory-search') && !!document.querySelector('#memory-enabled') && !!document.querySelector('#agent-memory-list')`);
      const save = await js(`(async () => window.toolbox.agentSave({ name: '记忆测试号', provider: 'deepseek', connType: 'api', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-test-memory-only' }))()`);
      r.agentSaved = !!(save && save.ok);
      agentId = save && save.agent && save.agent.id ? String(save.agent.id) : '';
      if (agentId) {
        await js(`(async () => { const ag = (await window.toolbox.agentsList()).find((a) => a.id === '${agentId}'); await window.toolbox.agentSave({ ...ag, apiKey: undefined, memories: [{ id: 'm1', text: '用户喜欢简短回答', at: Date.now() }, { id: 'm2', text: '用户住在台北', at: Date.now() }] }); })()`);
        await js(`(async () => { await fillAgentSelect(document.querySelector('#memory-agent')); const sel = document.querySelector('#memory-agent'); sel.value = '${agentId}'; sel.dispatchEvent(new Event('change')); })();`);
        await new Promise((res) => setTimeout(res, 600));
        r.memoryRows = await js(`document.querySelectorAll('#agent-memory-list .row').length`);
        await js(`(function () { const s = document.querySelector('#memory-search'); s.value = '台北'; s.dispatchEvent(new Event('input')); })();`);
        await new Promise((res) => setTimeout(res, 400));
        r.searchFilters = await js(`document.querySelectorAll('#agent-memory-list .row').length`) === 1;
        await js(`(function () { const s = document.querySelector('#memory-search'); s.value = ''; s.dispatchEvent(new Event('input')); })();`);
        await js(`(async () => { const b = document.querySelector('#memory-enabled'); b.checked = false; b.dispatchEvent(new Event('change')); await new Promise((res2) => setTimeout(res2, 800)); })()`);
        const savedOff = await js(`(async () => (await window.toolbox.agentsList()).find((a) => a.id === '${agentId}'))()`) || {};
        r.switchSavedOff = savedOff.memoryEnabled === false;
        r.switchGatesPrompt = !/长期记忆/.test(buildSystemPrompt({ memoryEnabled: false, memories: [{ text: '用户喜欢简短回答' }] }));
        r.switchOnIncludes = /长期记忆/.test(buildSystemPrompt({ memoryEnabled: true, memories: [{ text: '用户喜欢简短回答' }] }));
        await js(`(async () => { const ag = (await window.toolbox.agentsList()).find((a) => a.id === '${agentId}'); await window.toolbox.agentSave({ ...ag, apiKey: undefined, memories: (ag.memories || []).filter((x) => x.id !== 'm1') }); renderAgentMemory(); })()`);
        await new Promise((res) => setTimeout(res, 400));
        r.deleteWorks = await js(`document.querySelectorAll('#agent-memory-list .row').length`) === 1;
      }
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { if (agentId) await js(`window.toolbox.agentDelete('${agentId}')`); } catch (e) { /* 忽略 */ }
      try { await js(`gotoAgentTab('list');`); } catch (e) { /* 忽略 */ }
    }
    return r;
  })();
  // 2026-11-28-9，第 6 项：推荐软件类别标签切换——10 类 63 款，每类
  // 至少 6 款，一次只显示一类；ID 按核对结果修正，查不到的四款不上架。
  nativeCheck.recommendedTabs20261128 = await (async () => {
    const r = {};
    try {
      r.catCount = await js(`RECOMMENDED_CATEGORIES.length`);
      r.totalApps = await js(`RECOMMENDED_CATEGORIES.reduce((n, c) => n + c.apps.length, 0)`);
      r.minPerCat = await js(`Math.min(...RECOMMENDED_CATEGORIES.map((c) => c.apps.length))`);
      r.allHaveWingetId = await js(`RECOMMENDED_CATEGORIES.every((c) => c.apps.every((a) => a.wingetId && typeof a.wingetId === 'string'))`);
      const dump = await js(`JSON.stringify(RECOMMENDED_CATEGORIES)`);
      r.noUnverifiedFour = !/KMPlayer/.test(dump) && !/Quicker/.test(dump) && !/YoudaoNote/.test(dump) && !/SPlayer/.test(dump);
      r.msstoreTodo = /9NBLGGH5R558/.test(dump) && await js(`RECOMMENDED_CATEGORIES.flatMap((c) => c.apps).some((a) => a.wingetId === '9NBLGGH5R558' && a.source === 'msstore')`);
      r.correctedIds = ['Vivaldi.Vivaldi', 'Giorgiotani.Peazip', 'ChuyuTeam.DISM++', 'Bopsoft.Listary', 'Yuanli.uTools', 'IrfanSkiljan.IrfanView', 'liule.Snipaste', 'Appest.TickTick'].every((id) => dump.includes(id));
      await js(`gotoScreen('tools'); gotoTab('recommended');`);
      await new Promise((res) => setTimeout(res, 900));
      r.tabButtons = await js(`document.querySelectorAll('#recommended-tabs [data-rec-cat]').length`);
      r.onlyOneCatShown = await js(`document.querySelectorAll('#recommended-list .store-cat').length === 1`);
      r.firstCatCards = await js(`document.querySelectorAll('#recommended-list .store-card').length`);
      await js(`(function () { const b = document.querySelector('[data-rec-cat="image"]'); if (b) b.click(); })();`);
      await new Promise((res) => setTimeout(res, 900));
      r.imageCatCards = await js(`document.querySelectorAll('#recommended-list .store-card').length`);
      r.imageCatTitle = await js(`document.querySelector('#recommended-list .store-cat')?.textContent || ''`);
      await js(`(function () { const b = document.querySelector('[data-rec-cat="player"]'); if (b) b.click(); })();`);
      await new Promise((res) => setTimeout(res, 900));
      r.verifyBadges = await js(`document.querySelectorAll('#recommended-list .store-verify').length`);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-9，第 7 项：最近聊天空态下方的“贴合 / 调整大小”已删，
  // 调整入口只在设置 → 通用 → 界面缩放里，恢复默认布局仍可用。
  nativeCheck.snapRemoved20261128 = await (async () => {
    const r = {};
    try {
      r.noLayoutSnap = await js(`!document.querySelector('#layout-snap')`);
      r.noSidebarZoom = await js(`!document.querySelector('#sidebar-zoom')`);
      r.settingsResetExists = await js(`!!document.querySelector('#setting-layout-reset')`);
      r.noSidebarZoomCss = !/\.sidebar-zoom/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'styles.css'), 'utf8'));
      await js(`document.querySelector('#setting-layout-reset')?.click();`);
      await new Promise((res) => setTimeout(res, 500));
      r.resetWorks = await js(`Math.abs(document.querySelector('#sidebar').offsetWidth - 340) <= 2 && window.toolbox.getZoomFactor().zoom === 1`);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-9，第 8 项：菜单窗口只留原生标题栏一套窗口控制——
  // 菜单窗口模式里应用内三键与侧栏头藏掉，合并/置顶可见；主窗口三键不受影响。
  nativeCheck.menuWindowSingleControl20261128 = await (async () => {
    const r = {};
    try {
      await js(`document.documentElement.classList.add('menu-window'); document.body.classList.add('menu-window');`);
      await new Promise((res) => setTimeout(res, 300));
      r.menuHidesWinControls = await js(`getComputedStyle(document.querySelector('#win-controls')).display === 'none'`);
      r.menuHidesSidebarHead = await js(`getComputedStyle(document.querySelector('#sidebar-head')).display === 'none'`);
      r.menuShowsMergePin = await js(`getComputedStyle(document.querySelector('#menu-merge-back')).display !== 'none' && getComputedStyle(document.querySelector('#menu-pin')).display !== 'none'`);
      await js(`document.documentElement.classList.remove('menu-window'); document.body.classList.remove('menu-window');`);
      await new Promise((res) => setTimeout(res, 300));
      r.mainKeepsWinControls = await js(`getComputedStyle(document.querySelector('#win-controls')).display !== 'none'`);
      const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
      r.titleSetAfterLoad = /menuWin\.webContents\.once\('did-finish-load'/.test(mainSrc) && /setTitle\('工具箱菜单'\)/.test(mainSrc);
    } catch (e) { r.error = e.message || String(e); }
    return r;
  })();
  // 2026-11-28-9，补充 1：内嵌浏览器快捷键——guest 接管、Ctrl+T/W
  // 新建关闭页签、Ctrl+Tab 切换、Ctrl+L 聚焦地址栏、Ctrl+F 查找 +
  // Esc 关闭、Ctrl+R 刷新、F12 开关 DevTools。
  nativeCheck.browserShortcuts20261128 = await (async () => {
    const r = {};
    try {
      await js(`gotoScreen('browser');`);
      await new Promise((res) => setTimeout(res, 400));
      await js(`openBrowserApp('chromium');`);
      await new Promise((res) => setTimeout(res, 500));
      await js(`loadChromeWebview('about:blank');`);
      await new Promise((res) => setTimeout(res, 800));
      const guestId = await js(`(function () { const wv = document.querySelector('#toolbox-webview'); return (wv && typeof wv.getWebContentsId === 'function') ? wv.getWebContentsId() : 0; })()`);
      r.guestIdOk = Number(guestId) > 0;
      // did-attach 应已自动接管；若时序上还没发到，手动重发一次兜底。
      await new Promise((res) => setTimeout(res, 1000));
      r.attached = browserGuestAttached.has(Number(guestId));
      if (!r.attached) {
        await js(`window.toolbox.browserWebviewReady(${Number(guestId)})`);
        await new Promise((res) => setTimeout(res, 400));
      }
      r.attachedManual = browserGuestAttached.has(Number(guestId));
      let guest = null;
      try { guest = webContents.fromId(Number(guestId)); } catch (e) { guest = null; }
      r.guestFound = !!(guest && !guest.isDestroyed());
      if (guest) {
        // sendInputEvent 的 keyCode：字母传单个字符（'t' 到达时 key='t'，
        // code='KeyT'），命名键（Tab/Escape/F12）原样传；传 'KeyT' 这类
        // DOM code 或不传 keyCode，key 到达时是空串或直接抛错。
        const sendKey = async (key, code, modifiers) => {
          guest.sendInputEvent({ type: 'keyDown', key, keyCode: code, modifiers: modifiers || [] });
          guest.sendInputEvent({ type: 'keyUp', key, keyCode: code, modifiers: modifiers || [] });
          await new Promise((res) => setTimeout(res, 700));
        };
        await sendKey('t', 't', ['control']);
        r.ctrlTNewTab = await js(`chromeTabs.length`) === 2;
        await sendKey('w', 'w', ['control']);
        r.ctrlWCloseTab = await js(`chromeTabs.length`) === 1;
        await sendKey('t', 't', ['control']);
        const before = await js(`chromeActive`);
        await sendKey('Tab', 'Tab', ['control']);
        const afterNext = await js(`chromeActive`);
        await sendKey('Tab', 'Tab', ['control', 'shift']);
        const afterPrev = await js(`chromeActive`);
        r.ctrlTabSwitch = before === 1 && afterNext === 0 && afterPrev === 1;
        await sendKey('w', 'w', ['control']);
        await js(`document.querySelector('#chrome-url').blur();`);
        await sendKey('l', 'l', ['control']);
        r.ctrlLFocusUrl = await js(`document.activeElement && document.activeElement.id === 'chrome-url'`);
        await sendKey('f', 'f', ['control']);
        r.ctrlFFindBar = await js(`!document.querySelector('#chrome-find-bar').classList.contains('hidden')`);
        await sendKey('Escape', 'Escape', []);
        r.escClosesFind = await js(`document.querySelector('#chrome-find-bar').classList.contains('hidden')`);
        let loads = 0;
        const onLoad = () => { loads += 1; };
        guest.on('did-finish-load', onLoad);
        await js(`loadChromeWebview('about:blank');`);
        await new Promise((res) => setTimeout(res, 800));
        const loadsBefore = loads;
        await sendKey('r', 'r', ['control']);
        r.ctrlRReloads = await waitFor(() => loads > loadsBefore, 6000);
        guest.removeListener('did-finish-load', onLoad);
        await sendKey('F12', 'F12', []);
        r.f12OpensDevTools = await waitFor(() => guest.isDevToolsOpened(), 8000);
        await sendKey('F12', 'F12', []);
        r.f12ClosesDevTools = await waitFor(() => !guest.isDevToolsOpened(), 8000);
      }
    } catch (e) { r.error = e.message || String(e); }
    finally {
      try { const gid = await js(`(function () { const wv = document.querySelector('#toolbox-webview'); return (wv && typeof wv.getWebContentsId === 'function') ? wv.getWebContentsId() : 0; })()`); const g = webContents.fromId(Number(gid)); if (g && g.isDevToolsOpened()) g.closeDevTools(); } catch (e) { /* 忽略 */ }
      try { await js(`closeChromeFind(); loadChromeWebview('');`); } catch (e) { /* 忽略 */ }
    }
    return r;
  })();
  // 2026-11-27-4：-27-3 观察到的“自测跑完进程不随 app.quit() 退出”——
  // 本轮复现（结果写盘后 3 分钟仍在，只靠外部 SIGKILL 结束）。
  // 收尾前记录当时仍活动的 Node 句柄（定位用）。
  nativeCheck.exitHandles = (() => {
    try {
      const names = (arr) => arr.map((h) => (h && h.constructor ? h.constructor.name : typeof h));
      return { handles: names(process._getActiveHandles()), requests: names(process._getActiveRequests()) };
    } catch (e) { return { error: e.message || String(e) }; }
  })();
  stopAllEventWatchers();
  fs.writeFileSync(path.join(__dirname, 'self-test-result.json'), JSON.stringify({
    at: new Date().toISOString(),
    version: VERSION,
    platform: process.platform,
    screenshots: results,
    native: nativeCheck,
    // 2026-11-28-8：skip 认领清单（键为 native 里的虚路径，值是原因）。
    skipped: selftestSkipped,
    bundledEnsure: globalThis.__bundledEnsure || null,
    vlc: vlcStatus(),
    // 2026-11-28-2：便携版 Chromium 已删除，内嵌浏览器常驻可用。
    browser: { found: true, embedded: true, note: '内嵌浏览器 · 点开即用' },
  }, null, 2));
  // 2026-11-27-4：自测收尾。-27-3 观察项已定位到这一步：
  // app.quit() 会返回、process.exit(0)/app.exit(0) 都会返回而不
  // 终止进程（本机 Electron 38 主进程里它们不是同步终止），随后
  // 进程仍不死；收尾时只剩 1 个 Node 句柄（FSWatcher），但最小
  // 复现证明它不是元凶；渲染进程已全部退出，只剩 zygote 与
  // NetworkService；托盘销毁 + 窗口销毁也救不回来。未彻底定位
  // 的根因（见自测记录第 9 节，疑似原生关闭序列卡在无 D-Bus
  // 会话总线的沙盒环境里）。自测结果已写盘、本地数据已恢复，
  // 这里只影响自测收尾，正常用户退出路径不受影响（-27-3 结论）。
  // 最后一招：自测模式下 SIGKILL 自己（保证结束；wrapper 会看到
  // 退出码 137，属预期）。
  try { if (tray) { tray.destroy(); tray = null; } } catch (e) { /* 忽略 */ }
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.destroy(); } catch (e) { /* 忽略 */ }
  try { app.exit(0); } catch (e) { /* 忽略 */ }
  try { process.kill(process.pid, 'SIGKILL'); } catch (e) { /* 忽略 */ }
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
  app.on('before-quit', () => { isQuitting = true; try { flushConfigNow(); } catch (e) { /* 忽略 */ } stopAllEventWatchers(); phoneRemoteStop(); pioneerStopTunnel(); pioneerResetSystemProxySync(); sniffProxyResetSystemSync(); tunHelperStopOnQuit(); closeScreenTranslateOverlay(); closeScreenTranslateResultWin(); try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ } });
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
        // 2026-11-27-11：统一嗅探——整页导航后是新的页面视图，去重池
        // 清空，下次再抓同一地址会重新进池；页内跳转不清。
        contents.on('did-navigate', () => { browserMediaSeen.clear(); track(); });
        contents.on('did-navigate-in-page', track);
      } else if (type === 'window' || type === 'browserView') {
        attachBrowserGuards(contents, type === 'window');
      }
    } catch (e) { /* 跟踪失败不影响浏览 */ }
  });
  app.on('second-instance', (_e, argv) => {
    const bak = findToolboxbakArg(argv);
    if (bak) void handleToolboxbakFile(bak);
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
  app.on('open-file', (e, filePath) => {
    // macOS 上双击 .toolboxbak 走这里；窗口还没建好时先记下，建好再处理。
    e.preventDefault();
    if (String(filePath || '').toLowerCase().endsWith('.toolboxbak')) {
      if (mainWin) void handleToolboxbakFile(filePath);
      else pendingToolboxbakFile = filePath;
    }
  });

  /* 2026-11-28-12：打包后把 Electron 自己的数据目录（webview 分区、
   * 缓存等）也放到 exe 旁 data 下：工具箱内外同一浏览器数据不互通，
   * 工具箱安装的软件数据统一在工具箱所在目录下管理。必须在 ready
   * 之前改路径；先迁旧 AppData 数据（此时 getPath 还是旧路径），
   * 再改路径。开发运行（未打包）不改，走 Electron 默认目录。 */
  if (app.isPackaged) {
    try { migrateLegacyUserData(); } catch (e) { /* 迁移失败不拦启动 */ }
    try { app.setPath('userData', userDataDir()); } catch (e) { /* 改路径失败不拦启动 */ }
  }

  app.whenReady().then(async () => {
    // 2026-11-26-2：文件夹发行后第一次启动，把旧版 AppData 里
    // 的数据迁到 exe 旁边的 data 目录（只迁一次，旧目录留着）。
    globalThis.__dataMigrated = migrateLegacyUserData();
    registerIpc();
    // 2026-11-28-6：屏幕翻译全局快捷键（Ctrl+Alt+T）；注册失败
    // 不拦启动，设置页显示注册状态。
    registerScreenTranslateShortcut();
    // 2026-11-27-8：启动时清理上次崩溃残留的系统代理接管（只清指向
    // 本地 19352 或我们 PAC 的那一种，用户自己设的代理不动）。
    void pioneerCleanupStaleSystemProxy();
    // 2026-11-28-7：启动时核一次 Pioneer 存活——上次崩溃时隧道
    // 已断但状态还写着已连接的，这里清标志并把浏览器分区代理复
    // 位回直连；隧道真活着时 verifyLive 不动任何配置。
    void pioneerVerifyLive();
    // 启动时恢复上次分离的菜单窗口（见 menu-detach）。
    void restoreMenuWindow();
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
    // 2026-11-28-8：上次主进程崩溃的恢复提示——读到崩溃标记就通知
    // 渲染层弹提示，标记读完即清（诊断日志文件还在，可导出诊断包）。
    try {
      const marker = readCrashMarker();
      if (marker) {
        clearCrashMarker();
        setTimeout(() => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('crash-recovered', marker); } catch (e) { /* 发不出去不影响 */ } }, 1200);
      }
    } catch (e) { /* 读标记失败不拦启动 */ }
    // 2026-11-28-5：手机远程开启状态下启动时自动恢复监听。
    void phoneRemoteApplyEnabled();
    // 2026-11-28-9，第 3 项：嗅探代理开启状态下启动时自动恢复监听
    // （域名过滤一并恢复；系统代理模式不自动恢复，需手动再开，
    // 避免启动时悄悄改走用户系统代理）。
    try {
      const cfg0 = getConfig();
      if (cfg0.sniffProxyEnabled === true) {
        sniffProxyState.domains = Array.isArray(cfg0.sniffProxyDomains) ? cfg0.sniffProxyDomains.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim()) : [];
        void startSniffProxy();
      }
    } catch (e) { /* 恢复监听失败不影响启动 */ }
    const bak = findToolboxbakArg(process.argv) || pendingToolboxbakFile;
    if (bak) { pendingToolboxbakFile = ''; setTimeout(() => void handleToolboxbakFile(bak), 900); }
    // v1.6.1：启动时不自动检查更新（用户要求去掉自动更新）。
    // 更新只在设置里手动点「检查更新」/「一键更新」。
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
