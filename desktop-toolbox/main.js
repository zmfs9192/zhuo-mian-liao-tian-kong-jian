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
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, desktopCapturer } = require('electron');
const { spawn } = require('child_process');
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
const VERSION = '2026.11.26-2'; // 内部 semver
const DISPLAY_VERSION = '2026-11-26-2'; // 界面与 Release tag 用的版本号

// --print-version：只打印版本号就退出（热更新自测用：替换代码
// 文件后起一个新进程，看它读到的是不是新版本；放文件顶部，
// 在单实例锁之前就退出，不会被正在运行的工具箱拦住）。
if (process.argv.includes('--print-version')) {
  console.log(`VERSION=${VERSION} DISPLAY=${DISPLAY_VERSION}`);
  process.exit(0);
}
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
const BUNDLED_SHA256 = {
  vlc: 'a0b7ec02b50adf6417eed014fb8df50af39690505a4225b85b3dc2ed17d14843',
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
  const file = kind === 'vlc' ? BUNDLED_VLC_FILE : BUNDLED_CHROMIUM_FILE;
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
  if (!cfg.downloadDir) cfg.downloadDir = app.getPath('downloads');
  return cfg;
}

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
  const push = () => sendToRenderer('component-progress', { kind, ...job });
  push();
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
    return { ok: true };
  } catch (e) {
    job.status = 'failed'; job.error = e.message || String(e); push();
    return { ok: false, error: job.error };
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
function runWingetJob(label, args) {
  const id = ++wingetJobSeq;
  const job = { id, label, status: 'running', log: [] };
  wingetJobs.set(id, job);
  const push = () => sendToRenderer('winget-job', { id, label, status: job.status, log: job.log.slice(-80) });
  push();
  const child = spawn('winget', args, { windowsHide: true });
  const onData = (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const t = line.trim();
      if (t) job.log.push(t);
    }
    push();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { job.status = 'failed'; job.log.push(`启动 winget 失败：${e.message}`); push(); });
  child.on('close', (code) => { job.status = code === 0 ? 'done' : 'failed'; job.log.push(code === 0 ? '完成' : `winget 退出码 ${code}`); push(); });
  return { jobId: id };
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
  const urls = manifestUrl ? [manifestUrl] : UPDATE_MANIFEST_BRANCHES.map(manifestRawUrl);
  let lastError = '';
  for (const u of urls) {
    const r = await httpJson('GET', u, null, { 'User-Agent': `MuseToolbox/${VERSION}`, Accept: 'application/json' }, 30000);
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
  const push = (job) => sendToRenderer('update-progress', job);
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
    return { ok: true, updated: replaced.map((d) => d.path), version: st.latestDisplayVersion, backupDir };
  } catch (e) {
    const msg = e.message || String(e);
    push({ status: 'failed', pct: 0, error: msg });
    return { ok: false, error: msg };
  } finally {
    updateApplyRunning = false;
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
    const useProxy = ['manual', 'smart', 'global'].includes(cfg.proxyMode) && cfg.proxyHost && proxyApplies(cfg.proxyMode, u.hostname);
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
    const port = Number(cfg.proxyPort) || 8080;
    const sock = net.connect(port, cfg.proxyHost);
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
 * 通义千问）直连；全局与手动模式全部走代理。Tun 模式需要虚拟网卡
 * 驱动，工具箱未内置，暂不可用。 */
function proxyApplies(mode, host) {
  if (mode === 'smart') {
    const directHosts = ['api.deepseek.com', 'ark.cn-beijing.volces.com', 'dashscope.aliyuncs.com'];
    if (directHosts.includes(host) || host.endsWith('.cn')) return false;
    return true;
  }
  return true; // manual / global：全部走代理
}

/* ---------- 智能体（本地 API 对话） ---------- */
function getAgents() { const v = readJsonFile('agents.json', []); return Array.isArray(v) ? v : []; }
function getAgentChats() { const v = readJsonFile('agent-chats.json', []); return Array.isArray(v) ? v : []; }
function agentBase(agent) { return (agent.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''); }
async function agentChatSend(chatId, content) {
  const chats = getAgentChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: '对话不存在' };
  const agent = getAgents().find((a) => a.id === chat.agentId);
  if (!agent) return { ok: false, error: '智能体不存在' };
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
  const r = await httpJson('POST', `${agentBase(agent)}/chat/completions`,
    { model: agent.model || 'gpt-4o-mini', messages: [...sysMsg, ...history.map((m) => ({ role: m.role, content: m.content }))] },
    { Authorization: `Bearer ${agent.apiKey}` });
  if (!r.ok) return { ok: false, error: r.error, chat };
  const text = r.data?.choices?.[0]?.message?.content || '';
  // LLM 也可以回 JSON 工具调用：执行后把结果再交给 LLM 说一句人话。
  const llmCall = parseLlmToolCall(text);
  if (llmCall) {
    const done = await executeToolCall(llmCall, chatId);
    if (done.pending) return { ok: true, chat: done.chat, pending: true, actionId: done.actionId };
    const r2 = await httpJson('POST', `${agentBase(agent)}/chat/completions`,
      { model: agent.model || 'gpt-4o-mini', messages: [...sysMsg, { role: 'user', content: `工具「${llmCall.label}」执行完了，结果如下：\n${done.resultText || ''}\n请用一两句中文告诉用户做了什么、结果怎样。` }] },
      { Authorization: `Bearer ${agent.apiKey}` });
    const summary = r2.ok ? (r2.data?.choices?.[0]?.message?.content || '') : '';
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
  if (!agent.apiKey) return { ok: false, error: '先在智能体里填 API 密钥' };
  const sys = [agent.systemPrompt, system].filter(Boolean).join('\n\n');
  const r = await httpJson('POST', `${agentBase(agent)}/chat/completions`,
    { model: agent.model || 'gpt-4o-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }] },
    { Authorization: `Bearer ${agent.apiKey}` });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.data?.choices?.[0]?.message?.content || '' };
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
      const job = runWingetJob(`卸载 ${id}`, ['uninstall', '--id', id, '-e', '--accept-source-agreements']);
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
function imagesDir() { return path.join(getConfig().downloadDir || app.getPath('downloads'), '工具箱图片'); }
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
    ledgerCount: readJsonList('ledger.json').length,
    registerCount: readJsonList('register-records.json').length,
    dataSize: ['agents.json', 'agent-chats.json', 'ledger.json', 'register-records.json', 'creation.json', 'snippets.json']
      .reduce((n, f) => { try { return n + fs.statSync(path.join(userDataDir(), f)).size; } catch (e) { return n; } }, 0),
  };
}

/* ---------- 文件（本机目录） ---------- */
function listDir(dir) {
  const target = dir || getConfig().downloadDir || app.getPath('downloads');
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
const WINTUN_ZIP_URL = 'https://www.wintun.net/builds/wintun-0.14.1.zip';
function wintunDir() { return path.join(toolsDir(), 'wintun'); }
function wintunDll() { return path.join(wintunDir(), 'wintun.dll'); }
async function isAdminWindows() {
  if (process.platform !== 'win32') return false;
  const r = await runCmd('net', ['session'], 15000);
  return r.code === 0;
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
  return { ok: true, supported: true, platform: 'win32', admin, driverInstalled, dllPresent: fs.existsSync(wintunDll()), active: !!cfg.tunActive, note: admin ? '' : '需要以管理员身份运行工具箱才能安装驱动、建立 Tun' };
}
async function tunInstall() {
  const st = await tunStatus();
  if (!st.supported) return { ok: false, error: st.note };
  if (!st.admin) return { ok: false, needsAdmin: true, error: '安装 WinTun 驱动需要管理员权限：请右键工具箱「以管理员身份运行」后再点安装' };
  if (st.driverInstalled && st.dllPresent) return { ok: true, already: true, note: 'WinTun 驱动已安装' };
  fs.mkdirSync(wintunDir(), { recursive: true });
  const zip = path.join(wintunDir(), 'wintun-0.14.1.zip');
  try {
    if (!fs.existsSync(wintunDll())) {
      await downloadFile(WINTUN_ZIP_URL, zip);
      const tmp = path.join(wintunDir(), 'extract');
      await extractZip(zip, tmp);
      const dll = path.join(tmp, 'amd64', 'wintun.dll');
      if (!fs.existsSync(dll)) return { ok: false, error: '官方 WinTun 包里没找到 amd64/wintun.dll' };
      fs.copyFileSync(dll, wintunDll());
    }
  } catch (e) { return { ok: false, error: `下载 WinTun 官方包失败：${e.message || String(e)}` }; }
  // 用 PowerShell P/Invoke 建网卡（驱动随建网卡时由 Windows 安装）
  const ps = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Wintun {
  [DllImport("wintun.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr WintunCreateAdapter(string name, string tunnelType, Guid requestedGUID);
  [DllImport("wintun.dll", SetLastError = true)]
  public static extern void WintunCloseAdapter(IntPtr adapter);
}
"@
$guid = [Guid]::NewGuid()
$h = [Wintun]::WintunCreateAdapter("ToolboxTun", "Toolbox", $guid)
if ($h -eq [IntPtr]::Zero) { throw "WintunCreateAdapter 失败，错误码 " + [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
[Wintun]::WintunCloseAdapter($h)
"OK"
`;
  const r = await runCmd('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], 120000);
  const text = `${r.out || ''} ${r.err || ''}`;
  if (r.code !== 0 || !/OK/.test(text)) return { ok: false, error: `建立 WinTun 网卡失败：${text.trim().slice(-400) || '未知错误'}（驱动可能未成功安装，请确认以管理员身份运行）` };
  return { ok: true, note: 'WinTun 网卡已建立（ToolboxTun）' };
}
async function tunStart() {
  const st = await tunStatus();
  if (!st.supported) return { ok: false, error: st.note };
  if (!st.admin) return { ok: false, needsAdmin: true, error: '启动 Tun 需要管理员权限：请右键工具箱「以管理员身份运行」' };
  if (!st.driverInstalled || !st.dllPresent) {
    const ins = await tunInstall();
    if (!ins.ok) return ins;
  }
  const ip = await runCmd('netsh', ['interface', 'ip', 'set', 'address', 'name=ToolboxTun', 'static', '10.200.0.2', '255.255.255.0'], 30000);
  if (ip.code !== 0) return { ok: false, error: `给 ToolboxTun 配 IP 失败：${`${ip.out || ''} ${ip.err || ''}`.trim().slice(-300)}` };
  const route = await runCmd('route', ['add', '0.0.0.0', 'mask', '0.0.0.0', '10.200.0.1', 'metric', '100', 'if', 'ToolboxTun'], 30000);
  const cfg = getConfig(); cfg.tunActive = true; saveConfig(cfg);
  return { ok: true, routeOk: route.code === 0, note: route.code === 0 ? 'Tun 已启动：虚拟网卡 ToolboxTun 已配 IP 并接管默认路由（metric 100），停用时自动恢复' : 'Tun 网卡已启动并配 IP，但加默认路由失败，流量未全部走隧道' };
}
async function tunStop() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tun 只能在 Windows 上用' };
  await runCmd('route', ['delete', '0.0.0.0', 'mask', '0.0.0.0', '10.200.0.1'], 30000);
  await runCmd('netsh', ['interface', 'ip', 'set', 'address', 'name=ToolboxTun', 'source=dhcp'], 30000);
  const cfg = getConfig(); cfg.tunActive = false; saveConfig(cfg);
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
function sendToRenderer(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: '桌面工具箱',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // v1.4.1：内嵌空间（webview）承载空间菜单功能
    },
  });
  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('closed', () => { mainWin = null; });
}

/** 处理一条 muse-toolbox:// 链接：空间的播放 / 浏览器调用
 * 都从这里进。返回处理结果文本（自检与日志用）。 */
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
    const ps = `Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*, HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*, HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString | ConvertTo-Json -Depth 2`;
    const r = await runCmd('powershell', ['-NoProfile', '-Command', ps], 120000);
    let rows = [];
    try {
      const parsed = JSON.parse(r.out || '[]');
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) { rows = []; }
    let wingetRows = [];
    try { wingetRows = parseWingetTable((await runWinget(['list', '--accept-source-agreements'], 120000)).out || ''); } catch (e) { wingetRows = []; }
    const seen = new Set();
    for (const row of rows) {
      const name = String(row.DisplayName || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const match = wingetRows.find((w) => (w.name || '').toLowerCase() === name.toLowerCase() || (w.name || '').toLowerCase().includes(name.toLowerCase()));
      items.push({
        name, version: String(row.DisplayVersion || ''), publisher: String(row.Publisher || ''),
        installLocation: String(row.InstallLocation || ''), wingetId: match ? match.id : '',
        guide: match ? `winget install --id ${match.id}` : `官网搜索「${name}」下载安装包`,
        uninstall: String(row.UninstallString || ''), source: 'registry',
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
const PLUGIN_PERMISSIONS = ['system.status', 'monitor.status', 'winget.search', 'winget.install', 'files.list', 'files.open', 'open.external', 'clipboard.write', 'code.run'];
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
 * 点“从文件夹恢复”选那份备份导入，同步前同样先自动备份。 */
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
    if (src.winget !== false) {
      const r = await runWinget(['search', String(q || ''), '--accept-source-agreements'], 90000);
      rows = parseWingetTable(r.out);
      if (r.code !== 0) error = (r.err || r.out).slice(-300);
    }
    const seen = new Set(rows.map((x) => x.id));
    if (src.msstore !== false) {
      try {
        const r2 = await runWinget(['search', String(q || ''), '--source', 'msstore', '--accept-source-agreements'], 90000);
        for (const row of parseWingetTable(r2.out)) {
          if (row.id && !seen.has(row.id)) { seen.add(row.id); rows.push(row); }
        }
      } catch (e) { /* 商店源不可用时只用默认源的结果 */ }
    }
    if (src.winget === false && src.msstore === false) error = 'winget 与微软商店两个来源都已在「工具来源」里关闭，请先启用至少一个。';
    return { available: true, rows, error };
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
    return { available: true, rows: parseWingetTable(r.out), error: r.code === 0 ? '' : (r.err || r.out).slice(-300) };
  });
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
    return { ok: true, ...runWingetJob(`卸载 ${id}`, ['uninstall', '--id', String(id), '-e', '--accept-source-agreements']) };
  });
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
  ipcMain.handle('browser-open-url', (_e, kind, url) => openWithDefaultBrowser(String(url || ''), 'local', String(kind || 'chromium')));
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
  ipcMain.handle('github-install-asset', async (_e, url, name) => {
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
  ipcMain.handle('github-install-with-deps', async (_e, url, name, depIds) => {
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
    return { ok: true, steps, file: dest };
  });

  ipcMain.handle('get-config', () => { const c = getConfig(); return { ...c, githubToken: undefined, githubHasToken: !!c.githubToken }; });
  ipcMain.handle('set-config', (_e, patch) => {
    const next = { ...getConfig(), ...(patch || {}) };
    saveConfig(next);
    return next;
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
  ipcMain.handle('agents-list', () => getAgents().map((a) => ({ ...a, apiKey: undefined, hasKey: !!a.apiKey })));
  ipcMain.handle('agent-save', (_e, agent) => {
    const list = getAgents();
    const next = { ...agent, id: agent.id || localId() };
    if (!next.name) return { ok: false, error: '先填智能体名称' };
    const i = list.findIndex((a) => a.id === next.id);
    if (i >= 0) { if (!next.apiKey) next.apiKey = list[i].apiKey; list[i] = next; }
    else list.push(next);
    writeJsonFile('agents.json', list);
    return { ok: true, agent: { ...next, apiKey: undefined, hasKey: !!next.apiKey } };
  });
  ipcMain.handle('agent-delete', (_e, id) => {
    writeJsonFile('agents.json', getAgents().filter((a) => a.id !== id));
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
    const file = path.join(getConfig().downloadDir || app.getPath('downloads'), `工具箱账本-${new Date().toISOString().slice(0, 10)}.csv`);
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
    try { fs.mkdirSync(path.join(dir || getConfig().downloadDir || app.getPath('downloads'), clean), { recursive: true }); return { ok: true }; }
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
      defaultPath: path.join(getConfig().downloadDir || app.getPath('downloads'), `工具箱备份-${new Date().toISOString().slice(0, 10)}.toolboxbak`),
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
    pendingActions: getPendingActions(), syncFolder: getConfig().syncFolder || '',
    updateState: (() => { try { return fs.readFileSync(path.join(userDataDir(), 'update-state.json'), 'utf8'); } catch (e) { return null; } })(),
    spaceUrl: getConfig().spaceUrl || '', proxyMode: getConfig().proxyMode || 'direct',
    proxyHost: getConfig().proxyHost || '', proxyPort: getConfig().proxyPort || '',
    proxyServers: getConfig().proxyServers || [], ledgerCategories: getConfig().ledgerCategories || [],
    remoteEnabled: getConfig().remoteEnabled,
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
  // 记账本：记一笔 → 本地有记录
  await clickMenu('ledger');
  await js(`document.querySelector('#ledger-cat').value='餐饮'; document.querySelector('#ledger-amount').value='25.5'; document.querySelector('#ledger-add').click();`);
  await new Promise((r) => setTimeout(r, 600));
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
    const simMain = origMain.replace(`const DISPLAY_VERSION = '${DISPLAY_VERSION}';`, `const DISPLAY_VERSION = '2026-11-26-2-sim';`);
    if (simMain === origMain) throw new Error('模拟文件没改动：DISPLAY_VERSION 替换失败');
    fs.writeFileSync(path.join(simDir, 'main.js'), simMain, 'utf8');
    const simSha = crypto.createHash('sha256').update(simMain).digest('hex');
    const simFiles = [{ path: 'main.js', sha256: simSha, size: Buffer.byteLength(simMain) }];
    for (const rel of HOT_UPDATE_FILES.slice(1)) {
      const full = path.join(__dirname, rel);
      simFiles.push({ path: rel, sha256: await sha256File(full), size: fs.statSync(full).size });
    }
    const simManifest = { version: '2026-11-26-3', internalVersion: '2026.11.26-3', displayVersion: '2026-11-26-3', notes: '自测模拟清单', files: simFiles };
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
    nativeCheck.updateSimFileChanged = appliedMain.includes(`const DISPLAY_VERSION = '2026-11-26-2-sim';`);
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
    saveUpdateState({ pendingRestart: false, updatedFiles: [], changedFiles: [], totalBytes: 0 });
  }
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
  // 清理自测写入的本地数据，恢复到自测前
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
  saveConfig({ ...getConfig(), spaceUrl: snapshot.spaceUrl, proxyMode: snapshot.proxyMode, proxyHost: snapshot.proxyHost, proxyPort: snapshot.proxyPort, proxyServers: snapshot.proxyServers, ledgerCategories: snapshot.ledgerCategories, remoteEnabled: snapshot.remoteEnabled, syncFolder: snapshot.syncFolder });
  try { fs.rmSync(path.join(os.tmpdir(), 'toolbox-watch-test'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  try { if (snapshot.mailtm) fs.writeFileSync(path.join(userDataDir(), 'mailtm.json'), snapshot.mailtm); else fs.rmSync(path.join(userDataDir(), 'mailtm.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { if (snapshot.updateState) fs.writeFileSync(path.join(userDataDir(), 'update-state.json'), snapshot.updateState); else fs.rmSync(path.join(userDataDir(), 'update-state.json'), { force: true }); } catch (e) { /* 恢复失败不影响 */ }
  try { fs.rmSync(path.join(userDataDir(), 'code-runs'), { recursive: true, force: true }); } catch (e) { /* 删不掉不影响 */ }
  remoteStop();
  // GitHub 页自检：无令牌时搜仓库应提示先登录（不调 GitHub API）
  mainWin.webContents.send('test-goto', 'tools');
  await new Promise((r) => setTimeout(r, 500));
  await mainWin.webContents.executeJavaScript("document.querySelector('[data-tab=updates]')?.click(); document.querySelector('[data-subtab=github]')?.click(); document.querySelector('#github-search-input').value='vlc'; document.querySelector('#github-search-btn')?.click();");
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

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = findProtocolArg(argv);
    if (link) handleProtocolUrl(link);
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleProtocolUrl(url); });

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
    startAllEventWatchers();
    setInterval(checkTriggers, 60000);
    checkTriggers();
    // v1.3.0：先从安装包解压内置 VLC / Chromium 到 tools/，
    // 解压失败时不拦启动，界面会显示后备下载入口。
    globalThis.__bundledEnsure = await ensureBundledComponents();
    if (process.argv.includes('--self-test')) {
      void runSelfTest();
      return;
    }
    createWindow();
    const link = findProtocolArg(process.argv);
    if (link) setTimeout(() => handleProtocolUrl(link), 600);
    // v1.6.1：启动时不自动检查更新（用户要求去掉自动更新）。
    // 更新只在设置里手动点「检查更新」/「一键更新」。
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
