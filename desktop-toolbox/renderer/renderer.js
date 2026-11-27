'use strict';
/* 桌面工具箱 — 渲染层 2026-11-26-6：主页是桌面聊天空间式布局
 * （无边框窗口、左侧菜单边栏、右侧主内容区），
 * 苹果手机桌面主题已在 v1.4.1 放弃。左侧是「工具箱菜单」，
 * 含空间 11 项功能加视频下载、工具管理、播放器、浏览器、账号管理（15 项；
 * 点工具箱进工具箱内容，其他功能全部是工具箱自己的实现与
 * 本地数据（与空间不互通）；空间不再占菜单一项，改成右下角
 * 悬浮小圆点，点它切换到空间（再点切回工具箱）。
 * v1.4.2：同名功能页按空间里的完整界面做（智能体含系统提示、
 * 长期记忆、定时触发；注册、远程、文件、代理均为完整界面），
 * 数据只存本机、与空间不互通；跑不通的功能界面照样做出来并
 * 如实标明暂不可用。
 * 全部经 preload 白名单 IPC 调主进程；本层不碰 Node。
 * 真实功能：winget 工具管理、视频下载、内嵌 VLC/Chromium 与
 * muse-toolbox:// 协议、空间调用开关。空间里除播放器、浏览器
 * 外多数功能可用，只有这两项在空间里是界面预览，真的播放/
 * 浏览在这里完成；电脑端离线也能用很多功能。 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* 新 IPC（video-*、pioneer-*、monitors-*、prompts-*、image-upload/edit、
 * github-installed-updates、agent-web-verify）由后端在 preload 里补齐；
 * 方法不存在时返回明确提示，不抛错。 */
async function callTb(name, ...args) {
  const f = window.toolbox && window.toolbox[name];
  if (typeof f !== 'function') return { ok: false, error: '后端未就绪：该功能需要新版后端' };
  try { return await f(...args); } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}
/* ---------- 2026-11-27-3：自定义确认/输入弹窗 ----------
 * 替代原生 window.confirm / window.prompt：原生弹窗在 Windows 下会
 * 锁死渲染进程键盘焦点，之后所有输入框都输不进字；且原生弹窗不可
 * 定制按钮。弹窗默认不渲染内容，调用时才打开；同一时间只允许一个。
 * showCustomDialog({title, message, input?, inputType?, inputValue?,
 *   buttons: [{label, value, primary?}]}) → Promise，解析为所点按钮的
 * value（input 时为 {value, input}，点遮罩/取消为 null）。
 * 键盘：回车确认主按钮，Esc 取消；打开后自动聚焦输入框或主按钮。 */
let customDialogResolve = null;
function showCustomDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const overlay = $('#custom-dialog');
    const titleEl = $('#custom-dialog-title');
    const msgEl = $('#custom-dialog-message');
    const inputEl = $('#custom-dialog-input');
    const actionsEl = $('#custom-dialog-actions');
    if (customDialogResolve) { try { customDialogResolve(null); } catch (e) { /* 忽略 */ } }
    customDialogResolve = resolve;
    titleEl.textContent = o.title || '请确认';
    msgEl.textContent = o.message || '';
    msgEl.classList.toggle('hidden', !o.message);
    const useInput = !!o.input;
    inputEl.classList.toggle('hidden', !useInput);
    inputEl.type = o.inputType || 'text';
    inputEl.value = o.inputValue || '';
    actionsEl.innerHTML = '';
    const buttons = Array.isArray(o.buttons) && o.buttons.length
      ? o.buttons
      : [{ label: '确定', value: true, primary: true }, { label: '取消', value: false }];
    const close = (value) => {
      overlay.classList.add('hidden');
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      const r = customDialogResolve; customDialogResolve = null;
      if (r) r(useInput ? { value, input: inputEl.value } : value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(buttons.length ? buttons[buttons.length - 1].value : false); }
      else if (e.key === 'Enter') {
        const primary = buttons.find((b) => b.primary) || buttons[0];
        if (primary) { e.preventDefault(); close(primary.value); }
      }
    };
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn${b.primary ? ' primary' : ''}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => close(b.value));
      actionsEl.appendChild(btn);
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(buttons.length ? buttons[buttons.length - 1].value : false); };
    document.addEventListener('keydown', onKey, true);
    overlay.classList.remove('hidden');
    setTimeout(() => { try { (useInput ? inputEl : actionsEl.querySelector('.btn.primary') || actionsEl.querySelector('.btn')).focus(); } catch (e) { /* 忽略 */ } }, 0);
  });
}
function customConfirm(title, message, okLabel) {
  return showCustomDialog({ title, message, buttons: [{ label: okLabel || '确定', value: true, primary: true }, { label: '取消', value: false }] });
}
function customPrompt(title, message, inputType) {
  return showCustomDialog({ title, message, input: true, inputType: inputType || 'text', buttons: [{ label: '确定', value: true, primary: true }, { label: '取消', value: false }] });
}
/* ---------- 2026-11-27-3：主进程右键菜单与外部协议事件 ----------
 * 右键菜单由主进程统一挂（见 main.js attachBrowserGuards），这里只接
 * 菜单点选后发回来的事件；外部协议提示条同理。 */
if (window.toolbox && typeof window.toolbox.on === 'function') {
  window.toolbox.on('ctx-translate', async (p) => {
    const text = p && p.text ? String(p.text) : '';
    if (!text.trim()) return;
    if (p.mode === 'explain') {
      // 发送到智能体解释：进对话页，把“请解释”发给当前智能体。
      const agents = await window.toolbox.agentsList().catch(() => []);
      if (!agents.length) { toast('先在智能体设置里添加智能体'); return; }
      gotoScreen('agents'); gotoAgentTab('chat');
      const input = $('#chat-input');
      if (input) input.value = `请解释下面这段话：\n${text}`;
      await sendChat();
      return;
    }
    requestToolTranslation(text, { kind: 'selection' });
  });
  window.toolbox.on('ctx-open-link', (p) => {
    const url = p && p.url ? String(p.url) : '';
    if (!url) return;
    gotoScreen('browser');
    showBrowserView('chromium');
    chromeTabs.push({ title: '新标签页', url: '' });
    chromeActive = chromeTabs.length - 1;
    chromeGo(url);
  });
  window.toolbox.on('external-protocol-ask', (p) => {
    const url = p && p.url ? String(p.url) : '';
    const bar = $('#external-protocol-bar');
    if (!bar || !url) return;
    gotoScreen('browser');
    $('#external-protocol-text').textContent = `网页想打开外部应用：${url}`;
    bar.dataset.url = url;
    bar.classList.remove('hidden');
  });
}
$('#external-protocol-open').addEventListener('click', async () => {
  const bar = $('#external-protocol-bar');
  const url = bar.dataset.url || '';
  bar.classList.add('hidden');
  if (!url) return;
  const r = await callTb('externalProtocolOpen', url);
  if (!r || r.ok === false) toast((r && r.error) || '打开失败');
});
$('#external-protocol-dismiss').addEventListener('click', () => {
  $('#external-protocol-bar').classList.add('hidden');
});
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- 界面切换：右侧主内容区的页 ---------- */
/* 导航历史（2026-11-26-7）：按历史返回。菜单进功能页是顶层，顶层页的
 * 返回回上一个页面；播放器/浏览器子视图的返回回上一个子视图。
 * 栈里是 {screen, view}，view 只对 player / browser 两个有子视图的页有效。
 * 2026-11-27-1：每页只留一个返回控件（页头「‹ 返回」，data-nav="back"），
 * 子视图里重复的返回按钮已删；关闭（✕）也走 goBack，不再清栈——
 * 之前 closePlayerView / closeBrowserView 会把同页栈项全弹掉，
 * 关一次就丢了“从哪来”的记录，再点返回会直接跳工具箱总览。 */
const SCREEN_MENU_KEY = { home: 'toolbox', space: 'space', plugin: 'plugin' };
let navStack = [];
let currentScreen = 'home';
let currentPlayerView = 'list';
let currentBrowserView = 'list';
let suppressNavPush = false;
function pushNavEntry() {
  if (suppressNavPush) return;
  navStack.push({
    screen: currentScreen,
    view: currentScreen === 'player' ? currentPlayerView : currentScreen === 'browser' ? currentBrowserView : null,
  });
  if (navStack.length > 50) navStack.shift();
}
function gotoScreen(name) {
  if (name !== currentScreen) {
    if (currentScreen === 'browser' && currentBrowserView === 'chromium') stopBrowserMedia();
    if (currentScreen === 'player' && currentPlayerView === 'vlc') stopEmbeddedMedia();
    pushNavEntry();
    currentScreen = name;
    /* 2026-11-27-1：进功能页时子视图回到列表。菜单进浏览器/播放器应
     * 落在主列表，不是上次离开时停的子视图——否则栈顶记的是
     * {browser:list}，实际却停在 Chromium 视图，点返回会跳过列表
     * （自测里 Edge 详情→返回落到了 Chromium 视图就是这个原因）。
     * goBack 随后会按栈恢复子视图（suppressNavPush 下不压栈）。 */
    if (name === 'player' && currentPlayerView !== 'list') {
      const s = suppressNavPush; suppressNavPush = true;
      try { showPlayerView('list'); } finally { suppressNavPush = s; }
    } else if (name === 'browser' && currentBrowserView !== 'list') {
      const s = suppressNavPush; suppressNavPush = true;
      try { showBrowserView('list'); } finally { suppressNavPush = s; }
    }
  }
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'player') renderPlayerApps();
  if (name === 'video') renderVideo();
  if (name === 'settings') { renderSelfcheck(); renderUpdateSection(); }
  if (name === 'browser') renderBrowserApps();
  if (name !== 'monitor' && typeof monitorTimer !== 'undefined' && monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
  if (typeof updateBrowserMediaFab === 'function') updateBrowserMediaFab();
}
function goBack() {
  const prev = navStack.pop();
  if (!prev) {
    if (currentScreen !== 'home') { setMenuActive('toolbox'); gotoScreen('home'); }
    return;
  }
  suppressNavPush = true;
  try {
    gotoScreen(prev.screen);
    if (prev.screen === 'player' && prev.view) showPlayerView(prev.view);
    else if (prev.screen === 'browser' && prev.view) showBrowserView(prev.view);
  } finally { suppressNavPush = false; }
  setMenuActive(SCREEN_MENU_KEY[prev.screen] || prev.screen);
}
$$('[data-screen]').forEach((b) => b.addEventListener('click', () => gotoScreen(b.dataset.screen)));
$$('[data-nav="back"]').forEach((b) => b.addEventListener('click', goBack));
window.toolbox.on('test-goto', (msg) => {
  if (msg && typeof msg === 'object' && msg.screen === 'space') { openSpace(msg.spaceUrl || null); return; }
  if (msg === 'space') { openSpace(); return; }
  gotoScreen(msg);
});

/* ---------- 工具箱菜单 / 底部导航 / 最近聊天 ---------- */
/* 菜单 15 项：空间 11 项 + 视频下载、工具管理、播放器、浏览器、账号管理。
 * 2026-11-27-2：媒体入口已去掉（播放器保留），不要再加回来。
 * 空间不在菜单里，改成右下角悬浮小圆点（#space-fab）。
 * 全部菜单项打开工具箱自己的页面（本地实现与数据）。 */
const MENU_INFO = {
  agents: { name: '智能体' }, create: { name: '创作' }, code: { name: '代码' },
  image: { name: '图像' }, monitor: { name: '监控' },
  register: { name: '注册' }, remote: { name: '远程' }, files: { name: '文件' },
  proxy: { name: '代理' }, video: { name: '视频下载' },
  toolbox: { name: '工具箱' }, tools: { name: '工具管理' }, player: { name: '播放器' },
  browser: { name: '浏览器' }, accounts: { name: '账号管理' },
};
function setMenuActive(key) {
  $$('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.menu === key));
  const fab = $('#space-fab');
  if (fab) fab.classList.toggle('active', key === 'space');
}
const MENU_ROUTE = {
  agents: () => { gotoScreen('agents'); renderAgents(); },
  create: () => { gotoScreen('create'); renderCreate(); },
  code: () => { gotoScreen('code'); renderCode(); },
  image: () => { gotoScreen('image'); renderImages(); },
  monitor: () => { gotoScreen('monitor'); renderMonitor(); },
  register: () => { gotoScreen('register'); renderRegister(); },
  remote: () => { gotoScreen('remote'); renderRemote(); },
  files: () => { gotoScreen('files'); renderFiles(); },
  proxy: () => { gotoScreen('proxy'); renderProxy(); },
  video: () => { gotoScreen('video'); renderVideo(); },
  toolbox: () => gotoScreen('home'),
  tools: () => gotoScreen('tools'),
  player: () => gotoScreen('player'),
  browser: () => gotoScreen('browser'),
  accounts: () => { gotoScreen('accounts'); renderAccounts(); },
  space: () => openSpace(),
  newchat: () => newAgentChat(),
};
function openMenuItem(key) {
  if (key === 'newchat') { setMenuActive('agents'); newAgentChat(); return; }
  if (typeof key === 'string' && key.startsWith('plugin:')) { openPlugin(key.slice(7)); return; }
  setMenuActive(key);
  (MENU_ROUTE[key] || (() => gotoScreen('home')))();
}
$$('.menu-item').forEach((b) => b.addEventListener('click', () => openMenuItem(b.dataset.menu)));
/* 右下角悬浮小圆点：可拖动（v1.5.0），轻点切换空间/工具箱。
 * 拖动超过 6px 算拖动，不触发切换；位置存本机，下次打开还在原处。 */
(function () {
  const fab = $('#space-fab');
  if (!fab) return;
  try {
    const saved = JSON.parse(localStorage.getItem('space-fab-pos') || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      fab.style.left = `${saved.left}px`; fab.style.top = `${saved.top}px`;
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
    }
  } catch (e) { /* 读不到按默认位置 */ }
  let dragging = false, moved = 0, sx = 0, sy = 0, ox = 0, oy = 0;
  fab.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; sx = e.clientX; sy = e.clientY;
    const r = fab.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    if (moved < 6) return;
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const left = Math.min(Math.max(0, e.clientX - ox), window.innerWidth - w);
    const top = Math.min(Math.max(0, e.clientY - oy), window.innerHeight - h);
    fab.style.left = `${left}px`; fab.style.top = `${top}px`;
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (moved >= 6) {
      try { localStorage.setItem('space-fab-pos', JSON.stringify({ left: parseInt(fab.style.left, 10) || 0, top: parseInt(fab.style.top, 10) || 0 })); } catch (e) { /* 存不下不影响 */ }
    }
  };
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', () => {
    if (moved >= 6) return; // 拖动后不触发切换
    if (document.querySelector('#screen-space.active')) { setMenuActive('toolbox'); gotoScreen('home'); return; }
    openSpace();
  });
})();
$('#sidebar-new-chat').addEventListener('click', () => openMenuItem('newchat'));
/* 左下角设置：和空间里一样点齿轮进设置，只用点击，不用手势 */
$('#sidebar-settings').addEventListener('click', () => { setMenuActive('toolbox'); gotoScreen('settings'); });
$('#sidebar-collapse-recent').addEventListener('click', () => $('#recent-block').classList.toggle('collapsed'));
$('#sidebar-collapse').addEventListener('click', () => $('#sidebar').classList.toggle('collapsed'));
/* 下拉菜单（VLC / Chromium 界面内） */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) $$('.menu.open').forEach((m) => m.classList.remove('open'));
});
$$('.menu-btn').forEach((b) => b.addEventListener('click', (e) => {
  e.stopPropagation();
  const m = b.closest('.menu');
  const was = m.classList.contains('open');
  $$('.menu.open').forEach((x) => x.classList.remove('open'));
  if (!was) m.classList.add('open');
}));
$('#chrome-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = e.target.closest('.menu');
  const was = m.classList.contains('open');
  $$('.menu.open').forEach((x) => x.classList.remove('open'));
  if (!was) m.classList.add('open');
});

/* 最近聊天：只显示工具箱本地智能体的聊天历史 */
function fmtDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
async function renderRecent() {
  const box = $('#recent-list');
  if (!box) return;
  let chats = [];
  try { chats = await window.toolbox.agentChats(); } catch (e) { /* 取不到按空处理 */ }
  let agents = [];
  try { agents = await window.toolbox.agentsList(); } catch (e) { /* 取不到按空处理 */ }
  const agentName = {};
  agents.forEach((a) => { agentName[a.id] = a.name; });
  box.innerHTML = '';
  if (!chats.length) {
    const p = el('p', 'empty-note', '暂无最近聊天');
    box.appendChild(p);
    return;
  }
  for (const c of chats.slice(0, 8)) {
    const b = el('button', 'recent-item');
    b.type = 'button';
    const av = el('span', 'recent-avatar', (agentName[c.agentId] || '智').slice(0, 1));
    const main = el('div', 'recent-main');
    const top = el('div', 'recent-top');
    top.appendChild(el('span', 'recent-name', c.title || '新对话'));
    top.appendChild(el('span', 'recent-date', fmtDay(c.updatedAt)));
    main.appendChild(top);
    main.appendChild(el('span', 'recent-snippet', agentName[c.agentId] || '智能体'));
    b.appendChild(av);
    b.appendChild(main);
    b.addEventListener('click', () => openAgentChat(c.id));
    box.appendChild(b);
  }
}

/* ---------- 空间：只有点右下角悬浮小圆点才打开空间（内嵌网页） ---------- */
let spaceUrlOverride = null; // 自测用：覆盖配置里的空间地址
function getSpaceUrl() {
  return (spaceUrlOverride || window.__spaceUrl || '').trim().replace(/\/index\.html$/, '');
}
function setSpaceNavState(text) { const n = $('#space-nav-state'); if (n) n.textContent = text; }
function setSpaceStatus(text) { const n = $('#space-status'); if (n) n.textContent = text; }
function openSpace(urlOverride) {
  if (urlOverride !== undefined) spaceUrlOverride = urlOverride;
  setMenuActive('space');
  gotoScreen('space');
  const url = getSpaceUrl();
  const setup = $('#space-setup');
  const wv = $('#space-webview');
  if (!url) {
    setSpaceStatus('未连接');
    setSpaceNavState('setup');
    setup.classList.remove('hidden');
    wv.classList.add('hidden');
    return;
  }
  setup.classList.add('hidden');
  wv.classList.remove('hidden');
  setSpaceNavState('');
  if (wv.getAttribute('src') !== url) {
    setSpaceStatus('正在加载空间…');
    wv.setAttribute('src', url);
  } else {
    setSpaceStatus('已连接');
  }
}
function initSpaceWebview() {
  const wv = $('#space-webview');
  if (!wv) return;
  wv.addEventListener('did-finish-load', () => {
    if (!document.querySelector('#screen-space.active')) return;
    setSpaceStatus('已连接');
    setSpaceNavState('ok');
  });
  wv.addEventListener('did-fail-load', (_e, code) => {
    if (code === -3) return; // 导航被新地址打断，不是失败
    setSpaceStatus('空间打不开：检查空间地址与网络');
    setSpaceNavState('load-fail');
    $('#space-setup').classList.remove('hidden');
  });
  wv.addEventListener('did-start-loading', () => setSpaceStatus('正在加载空间…'));
  $('#space-reload').addEventListener('click', () => {
    if (!getSpaceUrl()) { openSpace(); return; }
    setSpaceStatus('正在加载空间…');
    wv.reload();
  });
  $('#space-open-external').addEventListener('click', () => {
    const url = getSpaceUrl();
    if (url) window.toolbox.openExternal(url);
    else toast('先填写空间地址');
  });
  const saveUrl = async () => {
    const v = $('#space-url-input').value.trim();
    if (!v) { toast('先填写空间地址'); return; }
    await window.toolbox.setConfig({ spaceUrl: v });
    window.__spaceUrl = v;
    toast('空间地址已保存');
    openSpace();
  };
  $('#space-url-save').addEventListener('click', saveUrl);
  $('#save-space-url').addEventListener('click', async () => {
    const v = $('#cfg-space-url').value.trim();
    await window.toolbox.setConfig({ spaceUrl: v });
    window.__spaceUrl = v;
    toast(v ? '空间地址已保存' : '空间地址已清空');
  });
}
initSpaceWebview();


/* ---------- 工具管理 ---------- */
function gotoTab(name) {
  $$('#screen-tools > .tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('#screen-tools .tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}
/* 只绑顶层四个页签：已安装里的分类按钮也在 #screen-tools 内、同样是 .tab，
 * 以前这里全量绑定，点分类会调 gotoTab(undefined)，全部 tabpane 失活导致白屏。 */
$$('#screen-tools > .tabs .tab').forEach((b) => b.addEventListener('click', () => gotoTab(b.dataset.tab)));
function gotoSubTab(name) {
  $$('#screen-tools .subtab').forEach((b) => b.classList.toggle('active', b.dataset.subtab === name));
  $$('#screen-tools .subpane').forEach((p) => p.classList.toggle('active', p.id === `subtab-${name}`));
}
$$('#screen-tools .subtab').forEach((b) => b.addEventListener('click', () => gotoSubTab(b.dataset.subtab)));

/* 应用商店样式：图标瓦片——首字 + 按名称哈希配色，纯 CSS，不联网取图 */
const TILE_COLORS = 8;
function tileClassFor(name) {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `tile-c${h % TILE_COLORS}`;
}
function iconTile(name) {
  const first = (String(name || '?').trim()[0] || '?').toUpperCase();
  return el('span', `row-icon ${tileClassFor(name)}`, first);
}
/* 2026-11-26-7：官方图标优先，取到就替换首字色块；取不到（无官方
 * 地址、下载失败、非 Windows）就保持首字占位，不报错、不阻塞渲染。 */
async function fillRowIcon(wrap, fetchIcon) {
  let r = null;
  try { r = await fetchIcon(); } catch (_) { r = null; }
  if (!r || !r.ok || !r.icon) return;
  const img = document.createElement('img');
  img.className = 'row-icon-img';
  img.src = r.icon;
  img.alt = '';
  const tile = wrap.querySelector('.row-icon');
  if (tile) tile.replaceWith(img);
}

/* 2026-11-27-2：工具管理精简——每行只留名称、版本、来源；点图标进详情；
 * 长描述文案已删掉，不再显示。 */
function iconButtonFor(row, kind) {
  const btn = el('button', 'row-icon-btn');
  btn.type = 'button';
  btn.title = '查看详情';
  btn.setAttribute('aria-label', `查看${row.name || row.id}详情`);
  btn.appendChild(iconTile(row.name || row.id));
  btn.addEventListener('click', () => showToolDetail(row, kind));
  return btn;
}
function pkgRow(row, actions, kind) {
  const wrap = el('div', 'row');
  wrap.dataset.rowId = row.id || '';
  const iconBtn = iconButtonFor(row, kind || 'discover');
  wrap.appendChild(iconBtn);
  fillRowIcon(wrap, () => window.toolbox.getInstalledIcon(row.id || row.name));
  const main = el('div', 'row-main');
  main.appendChild(el('div', 'row-title', row.name || row.id));
  main.appendChild(el('div', 'row-sub', row.id + (row.source ? ` · ${row.source}` : '')));
  wrap.appendChild(main);
  const ver = el('span', 'ver', row.available ? `${row.version || ''} → ${row.available}` : (row.version || ''));
  wrap.appendChild(ver);
  for (const a of actions) {
    const btn = el('button', `btn small${a.danger ? ' danger' : ''}`, a.label);
    btn.type = 'button';
    btn.addEventListener('click', () => a.onClick(row));
    wrap.appendChild(btn);
  }
  return wrap;
}
function fillList(container, rows, actions, emptyText, kind) {
  container.innerHTML = '';
  if (!rows.length) { container.className = 'list empty-note'; container.textContent = emptyText; return; }
  container.className = 'list';
  for (const r of rows) container.appendChild(pkgRow(r, actions, kind));
}

/* 工具详情卡片：只显示名称、版本、来源、标识，引擎行多显示所在路径。 */
let toolDetailRow = null;
let toolDetailKind = 'discover';
function showToolDetail(row, kind) {
  toolDetailRow = row;
  toolDetailKind = kind || 'discover';
  const card = $('#tool-detail');
  if (!card) return;
  $('#tool-detail-name').textContent = row.name || row.id || '';
  const meta = [`版本 ${row.version || row.available || '—'}`, `来源 ${row.source || (row.kind === 'video-engine' ? '视频下载引擎' : '—')}`];
  if (row.id) meta.push(`标识 ${row.id}`);
  $('#tool-detail-meta').textContent = meta.join(' · ');
  const pathLine = $('#tool-detail-path');
  if (row.path) { pathLine.textContent = `路径 ${row.path}`; pathLine.classList.remove('hidden'); }
  else { pathLine.textContent = ''; pathLine.classList.add('hidden'); }
  const bar = $('#tool-detail-actions');
  bar.innerHTML = '';
  const addBtn = (label, cls, onClick) => {
    const b = el('button', cls || 'btn small', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    bar.appendChild(b);
  };
  if (toolDetailKind === 'installed') {
    addBtn('打开所在目录', 'btn small primary', () => openInstalledDir(toolDetailRow));
    /* 视频下载引擎不是 winget 包：不给转移/卸载（引擎就在组件目录下，删文件即卸载）。 */
    if (row.kind !== 'video-engine' && row.source !== 'video-engine') {
      addBtn('转移', 'btn small', () => moveInstalled(toolDetailRow, null));
      addBtn('卸载', 'btn small danger', () => uninstallInstalled(toolDetailRow, null, null));
    }
  } else if (toolDetailKind === 'discover') {
    addBtn('安装', 'btn small primary', () => {
      if (row.source === 'github') installGithubRepo(row);
      else checkDepsThenInstall(row);
    });
  }
  card.classList.remove('hidden');
  card.scrollIntoView({ block: 'nearest' });
}
$('#tool-detail-close').addEventListener('click', () => $('#tool-detail').classList.add('hidden'));
async function startJob(promise) {
  const r = await promise;
  if (r && r.ok === false && !r.canceled) toast(r.error || '操作失败');
  return r;
}

const pendingUpgrade = new Map(); // id -> oldVersion
function upgradeOne(row) {
  pendingUpgrade.set(row.id, row.version || '');
  return startJob(window.toolbox.wingetUpgradeOne(row.id));
}
async function verifyUpgrade(id) {
  const oldV = pendingUpgrade.get(id) || '';
  pendingUpgrade.delete(id);
  const r = await window.toolbox.wingetInstalledOne(id);
  const row = r && r.row;
  if (row) toast(`${row.name || id}：${oldV || '?'} → ${row.version || '?'}，已在已安装里核对`);
  else toast(`${id} 更新完成，但已安装里暂时没找到它，请点「刷新列表」再看一次`);
}

$('#search-btn').addEventListener('click', async () => {
  const q = $('#search-input').value.trim();
  if (!q) { toast('先输入要搜的软件名'); return; }
  const box = $('#discover-list');
  box.className = 'list empty-note'; box.textContent = '正在搜索 winget、微软商店与 GitHub…';
  const r = await window.toolbox.wingetSearch(q);
  const hint = $('#github-search-hint');
  if (hint) hint.classList.toggle('hidden', !r.githubSkipped);
  renderDiscoverRows(box, r.rows || [], r.error || '没有搜到这个软件。');
});
/* 发现软件：同一行显示来源徽章、置信度、来源链接；GitHub 行走 Release 安装流程 */
function renderDiscoverRows(box, rows, emptyText) {
  box.innerHTML = '';
  if (!rows.length) { box.className = 'list empty-note'; box.textContent = emptyText; return; }
  box.className = 'list';
  const labels = { winget: 'winget', msstore: '微软商店', github: 'GitHub' };
  for (const row of rows) {
    const wrap = el('div', 'row');
    wrap.dataset.rowId = row.id || '';
    const iconBtn = iconButtonFor(row, 'discover');
    wrap.appendChild(iconBtn);
    fillRowIcon(wrap, () => window.toolbox.getDiscoverIcon(row));
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', row.name || row.id));
    /* 只留标识与来源：长描述文案已去掉（2026-11-27-2 工具管理精简）。 */
    main.appendChild(el('div', 'row-sub', `${row.id || ''}${row.stars ? ` · ★ ${row.stars}` : ''}`));
    wrap.appendChild(main);
    if (row.source) wrap.appendChild(el('span', `source-badge source-${row.source}`, labels[row.source] || row.sourceLabel || row.source));
    if (typeof row.confidence === 'number') wrap.appendChild(el('span', 'confidence', `置信度 ${row.confidence}`));
    if (row.sourceUrl) {
      const link = el('button', 'btn small', '来源');
      link.type = 'button';
      link.addEventListener('click', () => window.toolbox.openExternal(row.sourceUrl));
      wrap.appendChild(link);
    }
    const inst = el('button', 'btn small', '安装');
    inst.type = 'button';
    inst.addEventListener('click', () => {
      if (row.source === 'github') installGithubRepo(row);
      else checkDepsThenInstall(row);
    });
    wrap.appendChild(inst);
    box.appendChild(wrap);
  }
}
$('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#search-btn').click(); });
$('#web-search-btn').addEventListener('click', async () => {
  const q = $('#search-input').value.trim();
  const url = q ? `https://www.bing.com/search?q=${encodeURIComponent(q)}` : 'https://www.bing.com';
  const r = await window.toolbox.browserOpenUrl('chromium', url);
  if (r && !r.ok) toast(r.error || '打开失败');
});

/* 已安装：本机分类与快速过滤（只对已加载的列表过滤，不重新调 winget） */
let installedRows = [];
let installedCat = 'all';
let installedError = '';
const INSTALLED_CAT_KEYWORDS = {
  browser: ['chrome', 'chromium', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'arc', 'qq浏览器', '搜狗浏览器', 'uc浏览器', '360浏览器'],
  media: ['vlc', 'potplayer', 'mpv', '播放器', '视频', '音乐', '音频', 'spotify', '网易云', 'qq音乐', '酷狗', '酷我', '爱奇艺', '优酷', '腾讯视频', 'bilibili', '哔哩', 'media player', 'k-lite', 'foobar', 'itunes'],
  dev: ['visual studio', 'vscode', 'vs code', 'git', 'node', 'python', 'java', 'jdk', 'docker', 'notepad++', 'sublime', 'jetbrains', 'idea', 'pycharm', 'webstorm', 'android studio', 'postman', 'eclipse', 'rust', 'golang', 'phpstorm', 'datagrip', 'clion', 'rider'],
  chat: ['微信', 'wechat', 'telegram', 'discord', 'slack', 'zoom', 'teams', 'skype', 'whatsapp', '钉钉', 'dingtalk', '飞书', '企业微信', 'line', 'signal'],
  office: ['office', 'word', 'excel', 'powerpoint', 'wps', 'pdf', 'acrobat', 'onenote', 'outlook', '金山', '有道', '石墨', 'notion', '印象笔记', 'evernote'],
  tools: ['7-zip', '7zip', 'winrar', 'bandizip', '压缩', '解压', 'everything', '清理', '输入法', '搜狗输入', '驱动', 'ccleaner', 'powertoys', '截图', 'snipaste', 'geek', 'uninstaller', 'revo', 'peazip', 'winzip', 'yt-dlp', 'ytdlp', 'n_m3u8dl', 'lux', 'ffmpeg', 'video-engine', '视频下载引擎'],
  games: ['steam', 'epic', '游戏', 'game', 'minecraft', 'origin', 'gog', 'battle.net', 'uplay', 'xbox'],
};
function classifyInstalled(row) {
  /* 2026-11-27-2：视频下载引擎（tools/video/ 下的 yt-dlp、N_m3u8DL-RE、
   * Lux 等，后端以 kind:'video-engine' 混进已安装列表）单独成类。 */
  if (row.kind === 'video-engine' || row.source === 'video-engine') return 'video-engine';
  const hay = `${row.name || ''} ${row.id || ''}`.toLowerCase();
  for (const [key, kws] of Object.entries(INSTALLED_CAT_KEYWORDS)) {
    if (kws.some((k) => hay.includes(k))) return key;
  }
  return 'other';
}
function installedVisibleRows() {
  const q = ($('#installed-search').value || '').trim().toLowerCase();
  return installedRows.filter((r) => {
    if (installedCat !== 'all' && classifyInstalled(r) !== installedCat) return false;
    /* 引擎行按名字、标识、来源、路径都能搜到。 */
    if (q && !`${r.name || ''} ${r.id || ''} ${r.source || ''} ${r.path || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderInstalledRows(rows) {
  const box = $('#installed-list');
  box.innerHTML = '';
  const total = installedRows.length;
  const shown = rows.length;
  $('#installed-count').textContent = total
    ? (shown < total ? `显示 ${shown} / 共 ${total} 个` : `共 ${total} 个`)
    : '';
  if (!rows.length) {
    box.className = 'list empty-note';
    box.textContent = total ? '没有符合条件的软件。' : (installedError || '没有读到已安装软件。');
    return;
  }
  box.className = 'list';
  for (const row of rows) {
    const wrap = el('div', 'row');
    wrap.dataset.rowId = row.id || '';
    const isEngine = row.kind === 'video-engine' || row.source === 'video-engine';
    if (isEngine) {
      /* 视频下载引擎：通用引擎图标（⬇ 瓦片），注明是引擎；不走官方图标接口。 */
      const btn = el('button', 'row-icon-btn');
      btn.type = 'button';
      btn.title = '查看详情';
      btn.setAttribute('aria-label', `查看${row.name || row.id}详情`);
      btn.appendChild(el('span', 'row-icon tile-c2', '⬇'));
      btn.addEventListener('click', () => showToolDetail(row, 'installed'));
      wrap.appendChild(btn);
    } else {
      const iconBtn = iconButtonFor(row, 'installed');
      wrap.appendChild(iconBtn);
      fillRowIcon(wrap, () => window.toolbox.getInstalledIcon(row.id || row.name));
    }
    const main = el('div', 'row-main');
    const nameBtn = el('button', 'row-title row-name', row.name || row.id);
    nameBtn.type = 'button';
    nameBtn.title = '打开所在目录';
    nameBtn.addEventListener('click', () => openInstalledDir(row));
    main.appendChild(nameBtn);
    /* 只留最小信息：引擎行显示“视频下载引擎 · 所在路径”，普通行显示标识。 */
    main.appendChild(el('div', 'row-sub', isEngine ? `视频下载引擎${row.path ? ` · ${row.path}` : ''}` : (row.id || '')));
    wrap.appendChild(main);
    wrap.appendChild(el('span', 'ver', row.version || ''));
    const prog = el('div', 'row-progress', '');
    prog.dataset.rowId = row.id || '';
    /* 视频下载引擎不是 winget 包：不挂转移/卸载按钮（不要给它们挂 winget 卸载）。 */
    if (!isEngine) {
      const moveBtn = el('button', 'btn small', '转移');
      moveBtn.type = 'button';
      moveBtn.addEventListener('click', () => moveInstalled(row, moveBtn));
      wrap.appendChild(moveBtn);
      const unBtn = el('button', 'btn small danger', '卸载');
      unBtn.type = 'button';
      unBtn.addEventListener('click', () => uninstallInstalled(row, unBtn, prog));
      wrap.appendChild(unBtn);
    }
    wrap.appendChild(prog);
    box.appendChild(wrap);
  }
}
function applyInstalledFilter() { renderInstalledRows(installedVisibleRows()); }
async function openInstalledDir(row) {
  const r = await callTb('installedOpenDir', row.id);
  if (r && r.ok !== false) {
    if (r.dir) toast(`已打开：${r.dir}`);
    return;
  }
  /* 2026-11-27-2：视频下载引擎不在注册表里，主进程按 id 可能找不到；
   * 行里自带 path 时直接用 path 的父目录打开（files-open-path 已有通道）。 */
  if (row.path) {
    const dir = String(row.path).replace(/[\\/][^\\/]*$/, '') || row.path;
    const rr = await callTb('filesOpenPath', dir);
    if (rr && rr.ok !== false) { toast(`已打开：${dir}`); return; }
  }
  toast((r && r.error) || '后端未就绪');
}
async function moveInstalled(row, btn) {
  const name = row.name || row.id;
  if (row.kind === 'video-engine' || row.source === 'video-engine') { toast('视频下载引擎已在工具箱组件目录下，无需转移'); return; }
  if (!await customConfirm('转移安装目录', `将「${name}」的整个安装目录移到组件目录下，并在原处留联接，原快捷方式与注册表路径继续有效。`, '确定转移')) return;
  if (btn) btn.disabled = true;
  const old = btn ? btn.textContent : '';
  if (btn) btn.textContent = '转移中…';
  const r = await callTb('installedMoveToTools', row.id);
  if (btn) { btn.disabled = false; btn.textContent = old; }
  if (!r || r.ok === false) { toast((r && r.error) || '转移失败'); return; }
  /* 主进程返回的新结构：to/movedTo 是新目录，note 里写清改了几个快捷方式、
   * 几项注册表；旧字段 r.to 仍保留兼容。 */
  toast(r.note || ((r.movedTo || r.to) ? `已转移到：${r.movedTo || r.to}` : '已转移'));
  loadInstalled();
}
async function uninstallInstalled(row, btn, prog) {
  if (row.kind === 'video-engine' || row.source === 'video-engine') { toast('视频下载引擎不是 winget 安装的软件，不能在这里卸载；删掉 tools/video/ 下对应的 exe 文件即可'); return; }
  toast('正在卸载…');
  if (btn) btn.disabled = true;
  if (prog) prog.textContent = '卸载中…';
  const r = await startJob(window.toolbox.wingetUninstall(row.id));
  if (btn) btn.disabled = false;
  if (r && r.ok === false && !r.canceled && prog) prog.textContent = `失败：${r.error || '卸载失败'}`;
}

async function loadInstalled() {
  const box = $('#installed-list');
  box.className = 'list empty-note'; box.textContent = '正在读取…';
  const r = await window.toolbox.wingetInstalled();
  installedRows = r.rows || [];
  installedError = r.error || '';
  applyInstalledFilter();
  return installedRows;
}
$('#installed-refresh').addEventListener('click', loadInstalled);
$('#installed-search-btn').addEventListener('click', applyInstalledFilter);
$('#installed-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyInstalledFilter(); });
$('#installed-search').addEventListener('input', (e) => { if (!e.target.value.trim()) applyInstalledFilter(); });
$$('#installed-cat-tabs .tab').forEach((b) => b.addEventListener('click', () => {
  installedCat = b.dataset.installedCat || 'all';
  $$('#installed-cat-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
  applyInstalledFilter();
}));

async function loadUpgrades() {
  const box = $('#updates-list');
  box.className = 'list empty-note'; box.textContent = '正在检查…';
  const r = await window.toolbox.wingetUpgrades();
  const rows = r.rows || [];
  const badge = $('#upd-badge');
  badge.textContent = String(rows.length);
  badge.classList.toggle('hidden', rows.length === 0);
  const homeBadge = $('#home-upd-badge');
  homeBadge.textContent = String(rows.length);
  homeBadge.classList.toggle('hidden', rows.length === 0);
  fillList(box, rows, [{ label: '更新', onClick: (row) => upgradeOne(row) }], r.error || '没有可更新的软件，都是最新版。');
  for (const rowEl of box.querySelectorAll('.row')) {
    const prog = el('div', 'row-progress', '');
    prog.dataset.rowId = rowEl.dataset.rowId || '';
    rowEl.appendChild(prog);
  }
}
function setRowProgress(id, text) {
  if (!id) return;
  document.querySelectorAll(`.row-progress[data-row-id="${CSS.escape(id)}"]`).forEach((e) => { e.textContent = text; });
}
$('#updates-refresh').addEventListener('click', loadUpgrades);
$('#upgrade-all').addEventListener('click', () => {
  document.querySelectorAll('#updates-list .row-progress').forEach((e) => { e.textContent = '更新中…'; });
  startJob(window.toolbox.wingetUpgradeAll());
});
$('#bundle-export').addEventListener('click', async () => {
  const r = await window.toolbox.wingetExport();
  if (r && r.ok) toast(`清单已导出：${r.file}`);
  else if (r && !r.canceled) toast(r.error || '导出失败');
});
$('#bundle-import').addEventListener('click', () => startJob(window.toolbox.wingetImport()));

window.toolbox.on('winget-job', (job) => {
  const panel = $('#job-panel');
  panel.classList.remove('hidden');
  $('#job-label').textContent = job.label;
  $('#job-status').textContent = job.status === 'running' ? '进行中…' : job.status === 'done' ? '已完成' : '失败';
  const mj = /^(安装|更新|卸载) (\S+)/.exec(job.label || '');
  if (mj) {
    const runningText = mj[1] === '安装' ? '安装中…' : mj[1] === '更新' ? '更新中…' : '卸载中…';
    let text = job.status === 'running' ? runningText : job.status === 'done' ? '已完成' : '失败';
    if (job.status === 'failed') {
      const lastLines = (job.log || []).filter((l) => String(l || '').trim()).slice(-3)
        .map((l) => String(l).trim().slice(0, 200));
      if (lastLines.length) text = `失败：${lastLines.join('；')}`;
    }
    setRowProgress(mj[2], text);
  }
  const log = $('#job-log');
  log.textContent = (job.log || []).join('\n');
  log.scrollTop = log.scrollHeight;
  if (job.status === 'done') {
    const m = /^(安装|更新|卸载) (\S+)/.exec(job.label || '');
    loadInstalled().then(() => { if (m && m[1] === '更新') verifyUpgrade(m[2]); });
    loadUpgrades();
  }
});

/* ---------- 工具来源 ---------- */
const SOURCES = [
  { key: 'winget', name: 'winget', desc: 'Windows 软件源。发现软件、安装与更新走它。', login: null },
  { key: 'msstore', name: '微软商店', desc: '微软商店源。发现软件里搜未安装的商店应用。', login: 'store' },
  { key: 'github', name: 'GitHub', desc: '搜仓库、看 Releases、装安装包。', login: 'github' },
  { key: 'browser', name: '浏览器', desc: '网页搜索入口。启用后，发现软件页出现「网页搜索」，在工具箱浏览器里打开搜索结果。', login: null },
];
let currentSources = { browser: true, msstore: true, github: true, winget: true };
async function renderSources() {
  const box = $('#sources-list');
  const ov = await window.toolbox.getOverview();
  currentSources = { browser: true, msstore: true, github: true, winget: true, ...(ov.config.sources || {}) };
  $('#web-search-btn').style.display = currentSources.browser ? '' : 'none';
  box.innerHTML = '';
  box.className = 'list';
  for (const s of SOURCES) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', s.name));
    main.appendChild(el('div', 'row-sub', s.desc));
    wrap.appendChild(main);
    if (s.login === 'github') {
      const btn = el('button', 'btn small', '登录');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        gotoTab('sources');
        const card = $('#github-login-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const token = $('#github-token');
        if (token) token.focus();
      });
      wrap.appendChild(btn);
    } else if (s.login === 'store') {
      const btn = el('button', 'btn small', '在微软商店登录');
      btn.type = 'button';
      btn.addEventListener('click', () => window.toolbox.openExternal('ms-windows-store://home'));
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(el('span', 'ver', '无需登录'));
    }
    const label = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = currentSources[s.key] !== false;
    input.addEventListener('change', async () => {
      currentSources[s.key] = input.checked;
      await window.toolbox.setConfig({ sources: currentSources });
      $('#web-search-btn').style.display = currentSources.browser ? '' : 'none';
      toast(input.checked ? `${s.name}已启用` : `${s.name}已关闭`);
    });
    label.appendChild(input);
    label.appendChild(el('span', 'slider'));
    wrap.appendChild(label);
    box.appendChild(wrap);
  }
  renderCustomSources();
  renderImportedList();
}

/* ---------- 必备环境 ---------- */
async function loadPrereqs() {
  const box = $('#prereq-list');
  box.className = 'list empty-note'; box.textContent = '正在检查…';
  const r = await window.toolbox.prereqStatus();
  box.innerHTML = '';
  if (!r.items || !r.items.length) { box.textContent = '没有读到必备环境。'; return; }
  box.className = 'list';
  for (const it of r.items) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', it.name));
    main.appendChild(el('div', 'row-sub', `${it.why}${it.version ? ` · 已装 ${it.version}` : ''}${it.note ? ` · ${it.note}` : ''}`));
    wrap.appendChild(main);
    const st = el('span', 'ver', it.status === 'ok' ? '已装' : it.status === 'missing' ? '缺失' : '无法检测');
    wrap.appendChild(st);
    box.appendChild(wrap);
  }
}
$('#prereq-check').addEventListener('click', loadPrereqs);
$('#prereq-install-all').addEventListener('click', async () => {
  const r = await window.toolbox.prereqStatus();
  const missing = (r.items || []).filter((x) => x.status === 'missing' && x.key !== 'winget').map((x) => x.key);
  const wingetMissing = (r.items || []).some((x) => x.key === 'winget' && x.status === 'missing');
  if (wingetMissing) toast('winget 不在：请先在微软商店安装「应用安装程序」（App Installer），没有 winget 装不了别的。');
  if (!missing.length) { toast(wingetMissing ? '除 winget 外没有缺的。' : '必备都齐了。'); return; }
  const res = await window.toolbox.prereqInstall(missing);
  const bad = (res.results || []).filter((x) => !x.ok);
  toast(res.ok ? '缺的必备环境已装好' : `部分没装上：${bad.map((x) => x.key).join('、')}`);
  loadPrereqs();
});

/* ---------- 依赖确认（只在可更新 › 环境与依赖一处） ---------- */
let pendingDep = null; // {kind:'winget'|'github', id, name, depIds, assetUrl, assetName, repo}
function showDepPanel(note, deps, conflicts) {
  gotoTab('updates');
  gotoSubTab('env');
  const panel = $('#dep-panel');
  panel.classList.remove('hidden');
  $('#dep-note').textContent = note || '';
  const box = $('#dep-list');
  box.innerHTML = '';
  if (!deps.length) { box.className = 'list empty-note'; box.textContent = '没有检测到需要另外装的依赖。'; }
  else {
    box.className = 'list';
    for (const d of deps) {
      const wrap = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', d.name || d.label || d.id));
      main.appendChild(el('div', 'row-sub', `${d.source || ''}${d.requiredVersion ? ` · 要求 ${d.requiredVersion}` : ''} · ${d.installed ? `已装 ${d.installedVersion || ''}` : '未装'}${d.note ? ` · ${d.note}` : ''}${d.line ? ` · ${d.line}` : ''}`));
      wrap.appendChild(main);
      wrap.appendChild(el('span', 'ver', d.installed ? '已装' : '缺失'));
      box.appendChild(wrap);
    }
  }
  const cf = $('#dep-conflicts');
  if (conflicts && conflicts.length) {
    cf.classList.remove('hidden');
    cf.textContent = `依赖冲突：\n${conflicts.join('\n')}\n处理办法：升级依赖到要求版本（点「一起装」会先升级）；运行库多版本一般可并存，不用卸载旧版；实在不兼容就点「取消」，手动装对应版本再回来。`;
  } else { cf.classList.add('hidden'); cf.textContent = ''; }
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideDepPanel() { $('#dep-panel').classList.add('hidden'); pendingDep = null; }
$('#dep-cancel').addEventListener('click', hideDepPanel);
$('#dep-only-main').addEventListener('click', async () => {
  const p = pendingDep; hideDepPanel();
  if (!p) return;
  if (p.kind === 'winget') startJob(window.toolbox.wingetInstall(p.id));
  else {
    const res = await window.toolbox.githubInstallAsset(p.assetUrl, p.assetName);
    if (res.ok) toast('安装程序已启动，装完后在「已安装」里点刷新核对');
    else toast(res.error || '安装失败');
  }
});
$('#dep-confirm').addEventListener('click', async () => {
  const p = pendingDep; hideDepPanel();
  if (!p) return;
  const depIds = (p.deps || []).filter((d) => !d.installed && d.id).map((d) => d.id);
  if (p.kind === 'winget') {
    const res = await window.toolbox.installDepsAndPackage(p.id, depIds);
    if (!res.ok) { toast(res.error || '安装失败'); return; }
    toast('本体和依赖都装好了，已刷新已安装清单');
    loadInstalled(); loadUpgrades();
  } else {
    const res = await window.toolbox.githubInstallWithDeps(p.assetUrl, p.assetName, depIds);
    if (!res.ok) { toast(res.error || '安装失败'); return; }
    toast('安装程序已启动（依赖已先装好），装完后在「已安装」里点刷新核对');
    setTimeout(async () => {
      const rows = await loadInstalled();
      const hit = rows.find((x) => (x.name || '').toLowerCase().includes(p.repo.name.toLowerCase()) || (x.id || '').toLowerCase().includes(p.repo.name.toLowerCase()));
      if (hit) toast(`${hit.name || p.repo.name} 已出现在已安装里（${hit.version || ''}）`);
    }, 8000);
  }
});

async function installGithubRepo(row) {
  const full = row.full_name || row.id || '';
  const parts = full.split('/');
  const owner = row.owner || parts[0];
  const repo = row.repo || parts[1] || row.name;
  if (!owner || !repo) { toast('这个仓库信息不完整，打不开 Releases'); return; }
  const r = await window.toolbox.githubReleases(owner, repo);
  if (!r || !r.ok) { toast((r && r.error) || '读取 Releases 失败'); return; }
  const rel = (r.releases || [])[0];
  if (!rel) { toast('这个仓库没有 Releases'); return; }
  const asset = (rel.assets || []).find((a) => /\.(exe|msi)$/i.test(a.name));
  if (!asset) {
    toast('最新 Release 里没有 exe / msi 安装包');
    window.toolbox.openExternal(row.html_url || row.sourceUrl || `https://github.com/${owner}/${repo}`);
    return;
  }
  installGithubAssetFlow({ owner, name: repo, full_name: `${owner}/${repo}` }, rel, asset);
}
/* GitHub 安装：取最新 release → 依赖确认（复用 showDepPanel）→ 安装 */
function installGithubAssetFlow(repo, rel, asset) {
  window.toolbox.githubReleaseDeps(repo.owner, repo.name, rel.tag).then((dr) => {
    if (!dr.ok) { toast(dr.error || '查依赖失败'); return; }
    const deps = dr.deps || [];
    const conflicts = deps.filter((d) => d.conflict).map((d) => `${d.name || d.id}：${d.conflict}`);
    pendingDep = { kind: 'github', assetUrl: asset.url, assetName: asset.name, repo, deps };
    showDepPanel(dr.note || '', deps, conflicts);
  });
}

async function checkDepsThenInstall(row) {
  const r = await window.toolbox.wingetDeps(row.id);
  if (!r.available) { toast(r.note || '无法查依赖'); return; }
  const deps = r.deps || [];
  const conflicts = deps.filter((d) => d.conflict).map((d) => `${d.name || d.id}：${d.conflict}`);
  pendingDep = { kind: 'winget', id: row.id, name: row.name || row.id, deps };
  showDepPanel(r.note || (deps.length ? '装这个软件前，先确认它的依赖。缺的会一起装，已装的不会重复装。' : 'winget 清单里没有声明依赖，不代表没有依赖，只是清单没写，无法自动检测。'), deps, conflicts);
}

/* ---------- GitHub ---------- */
async function renderGithubStatus() {
  const st = await window.toolbox.githubStatus();
  $('#github-status').textContent = st.hasToken
    ? (st.login ? `已登录：${st.login}` : '已保存令牌，但验证失败，请重新登录。')
    : '未登录：需要个人访问令牌（Personal Access Token）才能搜仓库。';
}
$('#github-token-help').addEventListener('click', () => window.toolbox.openExternal('https://github.com/settings/tokens'));
$('#github-login').addEventListener('click', async () => {
  const t = $('#github-token').value.trim();
  if (!t) { toast('先粘贴令牌'); return; }
  const r = await window.toolbox.githubSetToken(t);
  if (r.ok) { toast(`已登录：${r.login}`); $('#github-token').value = ''; }
  else toast(r.error || '登录失败');
  renderGithubStatus();
});
$('#github-logout').addEventListener('click', async () => {
  await window.toolbox.githubClearToken();
  toast('令牌已清除');
  renderGithubStatus();
});
/* 已安装仓库工具：读 github-installed.json，与各仓库最新 release 比对 */
async function loadGithubInstalled() {
  const box = $('#github-installed-list');
  if (!box) return;
  box.className = 'list empty-note'; box.textContent = '正在检查…';
  const r = await callTb('githubInstalledUpdates');
  if (!r || r.ok === false) { box.textContent = (r && r.error) || '检查失败'; return; }
  const rows = r.rows || [];
  box.innerHTML = '';
  if (!rows.length) { box.textContent = '没有从 GitHub Release 装过的工具。'; return; }
  box.className = 'list';
  for (const row of rows) {
    const wrap = el('div', 'row');
    wrap.dataset.rowId = `${row.owner}/${row.repo}`;
    wrap.appendChild(iconTile(row.name || row.repo));
    fillRowIcon(wrap, () => window.toolbox.getDiscoverIcon({ id: `${row.owner}/${row.repo}`, name: row.name || row.repo, source: 'github' }));
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', row.name || `${row.owner}/${row.repo}`));
    main.appendChild(el('div', 'row-sub', `${row.owner}/${row.repo} · 当前 ${row.currentTag || '—'} → 最新 ${row.latestTag || '—'}`));
    wrap.appendChild(main);
    if (row.hasUpdate) {
      const btn = el('button', 'btn small primary', '更新');
      btn.type = 'button';
      btn.addEventListener('click', () => updateGithubInstalled(row));
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(el('span', 'ver', '已是最新'));
    }
    box.appendChild(wrap);
  }
}
async function updateGithubInstalled(row) {
  const r = await window.toolbox.githubReleases(row.owner, row.repo);
  if (!r || !r.ok) { toast((r && r.error) || '读取 Releases 失败'); return; }
  const rel = (r.releases || []).find((x) => x.tag === row.latestTag) || (r.releases || [])[0];
  if (!rel) { toast('这个仓库没有 Releases'); return; }
  const asset = (rel.assets || []).find((a) => /\.(exe|msi)$/i.test(a.name));
  if (!asset) { toast('最新 Release 里没有 exe / msi 安装包'); return; }
  installGithubAssetFlow({ owner: row.owner, name: row.repo, full_name: `${row.owner}/${row.repo}` }, rel, asset);
}
$('#github-installed-refresh').addEventListener('click', loadGithubInstalled);

/* ---------- 播放器：应用列表 → VLC 窗口 / 其他播放器 ---------- */
const PLAYER_META = {
  vlc: { name: 'VLC', tile: 'orange', glyph: '▶' },
  potplayer: { name: 'PotPlayer', tile: 'blue', glyph: '▶' },
  mpv: { name: 'mpv', tile: 'gray', glyph: '▶' },
};
let playerAppsCache = {};
let currentOtherPlayer = null;
/* 内嵌播放器：离开 VLC 视图就停掉，避免只隐藏视图、视频还在后台播 */
function stopEmbeddedMedia() {
  const v = $('#embedded-player');
  if (!v) return;
  try { v.pause(); } catch (e) { /* 未在播放时忽略 */ }
  v.removeAttribute('src');
  try { v.load(); } catch (e) { /* 忽略 */ }
}
function showPlayerView(name) {
  if (name !== currentPlayerView) {
    const leavingVlc = currentPlayerView === 'vlc';
    if (currentScreen === 'player' && !suppressNavPush) pushNavEntry();
    if (leavingVlc) stopEmbeddedMedia();
    currentPlayerView = name;
  }
  $('#player-list-view').classList.toggle('hidden', name !== 'list');
  $('#player-vlc-view').classList.toggle('hidden', name !== 'vlc');
  $('#player-vlc-prefs-view').classList.toggle('hidden', name !== 'prefs');
  $('#player-other-view').classList.toggle('hidden', name !== 'other');
}
async function renderPlayerApps() {
  const box = $('#player-apps');
  const apps = await window.toolbox.playerApps();
  playerAppsCache = apps;
  box.innerHTML = '';
  box.className = 'app-list';
  for (const key of ['vlc', 'potplayer', 'mpv']) {
    const a = apps[key];
    const meta = PLAYER_META[key];
    const card = el('div', 'app-card');
    card.appendChild(el('span', `icon-tile ${meta.tile}`, meta.glyph));
    card.appendChild(el('h3', '', meta.name));
    card.appendChild(el('p', '', a.note + (key === 'vlc' ? '。空间里的播放器是界面预览，真的播放在这里完成。' : '')));
    const bar = el('div', 'toolbar');
    const open = el('button', 'btn primary', '打开');
    open.type = 'button';
    open.dataset.appOpen = key;
    open.addEventListener('click', () => openPlayerApp(key));
    bar.appendChild(open);
    const launch = el('button', 'btn', '启动');
    launch.type = 'button';
    launch.disabled = !a.found;
    launch.addEventListener('click', async () => {
      const r = await window.toolbox.launchPlayer(key);
      if (r && !r.ok) toast(r.error || '启动失败');
    });
    bar.appendChild(launch);
    card.appendChild(bar);
    box.appendChild(card);
  }
}
function openPlayerApp(key) {
  if (key === 'vlc') { showPlayerView('vlc'); renderVlc(); return; }
  currentOtherPlayer = key;
  const a = playerAppsCache[key] || {};
  $('#other-player-name').textContent = PLAYER_META[key].name;
  $('#other-player-status').textContent = a.note || '';
  $('#other-player-launch').disabled = !a.found;
  showPlayerView('other');
}
$('#other-player-launch').addEventListener('click', async () => {
  if (!currentOtherPlayer) return;
  const r = await window.toolbox.launchPlayer(currentOtherPlayer);
  if (r && !r.ok) toast(r.error || '启动失败');
});
$('#other-player-default').addEventListener('click', async () => {
  if (!currentOtherPlayer) return;
  await window.toolbox.setConfig({ defaultPlayer: currentOtherPlayer });
  $('#default-player').value = currentOtherPlayer;
  toast(`默认播放器已设为 ${PLAYER_META[currentOtherPlayer].name}`);
});
$('#other-player-install').addEventListener('click', () => {
  gotoScreen('tools');
  gotoTab('discover');
  const q = currentOtherPlayer === 'potplayer' ? 'PotPlayer' : 'mpv';
  $('#search-input').value = q;
  $('#search-btn').click();
});

/* VLC 最近播放（本机保存） */
function vlcRecent() {
  try { return JSON.parse(localStorage.getItem('toolbox-vlc-recent') || '[]'); } catch (e) { return []; }
}
function vlcRecentAdd(target) {
  const list = vlcRecent().filter((x) => x.target !== target);
  list.unshift({ target, name: target.split(/[\\/]/).pop() || target, at: Date.now() });
  try { localStorage.setItem('toolbox-vlc-recent', JSON.stringify(list.slice(0, 20))); } catch (e) { /* 存不下不拦播放 */ }
  renderVlcPlaylist();
}
function renderVlcPlaylist() {
  const box = $('#vlc-playlist');
  const list = vlcRecent();
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '最近用工具箱打开过的媒体会列在这里，点一行用 VLC 播放。'; return; }
  box.className = 'list';
  for (const item of list) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', item.name));
    main.appendChild(el('div', 'row-sub', item.target));
    wrap.appendChild(main);
    const btn = el('button', 'btn small', '播放');
    btn.type = 'button';
    btn.addEventListener('click', () => playVlcTarget(item.target));
    wrap.appendChild(btn);
    box.appendChild(wrap);
  }
}
function isM3u8(target) { return /\.m3u8(\?|$)/i.test(target || ''); }
function isEmbeddable(target) { return /\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg)$/i.test(target || ''); }
function playEmbedded(target) {
  const v = $('#embedded-player');
  setMenuActive('player');
  gotoScreen('player');
  showPlayerView('vlc');
  if (!v) return;
  const url = /^https?:\/\//i.test(target) ? target : `file:///${String(target).replace(/\\/g, '/')}`;
  v.src = url;
  $('#vlc-now-playing').textContent = `正在内嵌播放：${target}`;
  v.play().catch(() => { $('#vlc-now-playing').textContent = `内嵌播放失败，请点「外部 VLC 打开」：${target}`; });
  vlcRecentAdd(target);
}
async function playVlcTarget(target) {
  if (isM3u8(target)) {
    toast('m3u8 地址不能直接播放，请去视频下载页下载后播放');
    setMenuActive('video'); gotoScreen('video'); renderVideo();
    return;
  }
  if (isEmbeddable(target)) { playEmbedded(target); return; }
  const r = await window.toolbox.vlcPlay(target);
  if (r && r.ok) {
    vlcRecentAdd(target);
    $('#vlc-now-playing').textContent = `正在用外部 VLC 播放：${target}`;
  } else if (r) toast(r.error || '播放失败');
}
$('#vlc-close').addEventListener('click', goBack);
$$('[data-vlc-act]').forEach((b) => b.addEventListener('click', async () => {
  const act = b.dataset.vlcAct;
  $$('.menu.open').forEach((m) => m.classList.remove('open'));
  if (act === 'open-file') {
    const file = await window.toolbox.pickMedia();
    if (file) playVlcTarget(file);
  } else if (act === 'open-url') {
    $('#vlc-url-row').style.display = '';
    $('#vlc-url-input').focus();
  } else if (act === 'launch') {
    const r = await window.toolbox.vlcLaunch();
    if (r && !r.ok) toast(r.error);
  } else if (act === 'playlist') {
    $('#vlc-playlist').classList.toggle('hidden');
    renderVlcPlaylist();
  } else if (act === 'prefs') {
    showPlayerView('prefs');
    loadVlcPrefs();
  } else if (act === 'about') {
    const st = await window.toolbox.vlcStatus();
    toast(st.found ? `VLC ${st.version || ''}（已集成）` : 'VLC 未就绪');
  }
}));
$('#vlc-url-play').addEventListener('click', () => {
  const url = $('#vlc-url-input').value.trim();
  if (!url) { toast('先粘贴视频地址'); return; }
  playVlcTarget(url);
});
$('#vlc-url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vlc-url-play').click(); });

async function renderVlc() {
  const st = await window.toolbox.vlcStatus();
  const txt = st.found
    ? (st.bundled ? `已集成 · VLC ${st.version}（VideoLAN 官方，打包内置）\n${st.path}` : `使用电脑已安装的 VLC（${st.path}）`)
    : '内置 VLC 缺失或损坏：点「重新下载（后备）」重新下载，或在设置里指定已装的 VLC。';
  $('#vlc-status').textContent = txt;
  $('#vlc-download').classList.toggle('hidden', st.found);
  $('#vlc-download').textContent = '重新下载（后备）';
  renderVlcPlaylist();
}
$('#vlc-download').addEventListener('click', async () => {
  $('#vlc-progress').classList.remove('hidden');
  const r = await window.toolbox.vlcDownload();
  if (r.ok) { toast('VLC 已重新下载好'); renderVlc(); }
  else toast(r.error || '下载失败');
});
async function loadVlcPrefs() {
  const p = await window.toolbox.vlcGetPrefs();
  $('#vlc-pref-cache').value = p.networkCaching || '2000';
  $('#vlc-pref-volume').value = p.volume || '';
  $('#vlc-pref-lang').value = p.language || '';
  $('#vlc-pref-subsize').value = p.subtitleSize || '';
}
$('#vlc-prefs-save').addEventListener('click', async () => {
  const r = await window.toolbox.vlcSetPrefs({
    networkCaching: $('#vlc-pref-cache').value.trim(),
    volume: $('#vlc-pref-volume').value.trim(),
    language: $('#vlc-pref-lang').value.trim(),
    subtitleSize: $('#vlc-pref-subsize').value.trim(),
  });
  toast(r.ok ? '偏好设置已保存，下次启动 VLC 时生效' : (r.error || '保存失败'));
});
$('#vlc-prefs-reset').addEventListener('click', async () => {
  await window.toolbox.vlcSetPrefs({ networkCaching: '2000', volume: '', language: '', subtitleSize: '' });
  loadVlcPrefs();
  toast('已恢复默认');
});
$('#default-player').addEventListener('change', async (e) => {
  await window.toolbox.setConfig({ defaultPlayer: e.target.value });
  toast(`默认播放器已设为 ${PLAYER_META[e.target.value].name}`);
});
window.toolbox.on('component-progress', ({ kind, status, pct, error }) => {
  const bar = kind === 'vlc' ? $('#vlc-progress') : $('#browser-progress');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.querySelector('.bar').style.width = `${pct || 0}%`;
  if (status === 'done') { setTimeout(() => bar.classList.add('hidden'), 600); renderVlc(); renderBrowser(); }
  if (status === 'failed') { toast(error || '下载失败'); bar.classList.add('hidden'); }
});

/* ---------- 浏览器：应用列表 → Chromium 窗口 / 其他浏览器 ---------- */
const BROWSER_META = {
  chromium: { name: 'Chromium', tile: 'blue', glyph: '◉' },
  chrome: { name: 'Chrome', tile: 'red', glyph: '◉' },
  edge: { name: 'Edge', tile: 'teal', glyph: '◉' },
};
let browserAppsCache = {};
let currentOtherBrowser = null;
/* 关闭浏览器视图时彻底停掉媒体：先停加载，再把 webview 切到空白页，
 * 只隐藏视图不停页面是之前“关了浏览器视频还在后台播”的原因。
 * 账号登录态存在分区磁盘里，切空白页不会丢登录；标签页地址保留在
 * chromeTabs 里，回 Chromium 视图时按地址恢复。 */
function stopBrowserMedia() {
  const wv = $('#toolbox-webview');
  if (!wv) return;
  try { if (typeof wv.stop === 'function') wv.stop(); } catch (e) { /* 未在加载时忽略 */ }
  try { wv.setAttribute('src', 'about:blank'); } catch (e) { /* 忽略 */ }
}
function showBrowserView(name) {
  if (name !== currentBrowserView) {
    const leavingChromium = currentBrowserView === 'chromium';
    if (currentScreen === 'browser' && !suppressNavPush) pushNavEntry();
    if (leavingChromium) stopBrowserMedia();
    currentBrowserView = name;
  }
  $('#browser-list-view').classList.toggle('hidden', name !== 'list');
  $('#browser-chromium-view').classList.toggle('hidden', name !== 'chromium');
  $('#browser-chromium-settings-view').classList.toggle('hidden', name !== 'settings');
  $('#browser-chromium-ext-view').classList.toggle('hidden', name !== 'ext');
  $('#browser-other-view').classList.toggle('hidden', name !== 'other');
  if (name === 'chromium') updateChromeView();
  if (typeof updateBrowserMediaFab === 'function') updateBrowserMediaFab();
}
async function renderBrowserApps() {
  const box = $('#browser-apps');
  const apps = await window.toolbox.browserApps();
  browserAppsCache = apps;
  box.innerHTML = '';
  box.className = 'app-list';
  for (const key of ['chromium', 'chrome', 'edge']) {
    const a = apps[key];
    const meta = BROWSER_META[key];
    const card = el('div', 'app-card');
    card.appendChild(el('span', `icon-tile ${meta.tile}`, meta.glyph));
    card.appendChild(el('h3', '', meta.name));
    card.appendChild(el('p', '', a.note + (key === 'chromium' ? '。空间里的浏览器是界面预览，真的浏览在这里完成。' : '')));
    const bar = el('div', 'toolbar');
    const open = el('button', 'btn primary', '打开');
    open.type = 'button';
    open.dataset.appOpen = key;
    open.addEventListener('click', () => openBrowserApp(key));
    bar.appendChild(open);
    const launch = el('button', 'btn', '启动');
    launch.type = 'button';
    launch.disabled = !a.found;
    launch.addEventListener('click', async () => {
      const r = await window.toolbox.launchBrowserApp(key);
      if (r && !r.ok) toast(r.error || '启动失败');
    });
    bar.appendChild(launch);
    card.appendChild(bar);
    box.appendChild(card);
  }
}
function openBrowserApp(key) {
  if (key === 'chromium') { showBrowserView('chromium'); renderBrowser(); return; }
  currentOtherBrowser = key;
  const a = browserAppsCache[key] || {};
  $('#other-browser-name').textContent = BROWSER_META[key].name;
  $('#other-browser-status').textContent = a.note || '';
  $('#other-browser-launch').disabled = !a.found;
  showBrowserView('other');
}
$('#other-browser-launch').addEventListener('click', async () => {
  if (!currentOtherBrowser) return;
  const r = await window.toolbox.launchBrowserApp(currentOtherBrowser);
  if (r && !r.ok) toast(r.error || '启动失败');
});
$('#other-browser-default').addEventListener('click', async () => {
  if (!currentOtherBrowser) return;
  await window.toolbox.setConfig({ defaultBrowser: currentOtherBrowser });
  $('#default-browser').value = currentOtherBrowser;
  toast(`默认浏览器已设为 ${BROWSER_META[currentOtherBrowser].name}`);
});
$('#other-browser-install').addEventListener('click', () => {
  gotoScreen('tools');
  gotoTab('discover');
  $('#search-input').value = currentOtherBrowser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge';
  $('#search-btn').click();
});

/* Chromium 窗口：标签页只管理这里的地址，浏览本身在 Chromium 里进行 */
const chromeTabs = [{ title: '新标签页', url: '' }];
let chromeActive = 0;
const chromeHist = [''];
let chromeHistIdx = 0;
function renderChromeTabs() {
  const bar = $('#chrome-tabs');
  bar.querySelectorAll('.chrome-tab').forEach((t) => t.remove());
  chromeTabs.forEach((t, i) => {
    const btn = el('button', `chrome-tab${i === chromeActive ? ' active' : ''}`, t.title);
    btn.type = 'button';
    btn.dataset.tabIdx = String(i);
    btn.addEventListener('click', () => { chromeActive = i; updateChromeView(); renderChromeTabs(); });
    bar.insertBefore(btn, $('#chrome-new-tab'));
  });
}
function loadChromeWebview(url) {
  const wv = $('#toolbox-webview');
  const view = $('#chrome-view');
  const start = $('#chrome-start');
  if (!wv || !view || !start) return;
  if (!url) { view.classList.add('hidden'); start.classList.remove('hidden'); return; }
  start.classList.add('hidden');
  view.classList.remove('hidden');
  if (wv.getAttribute('src') !== url) wv.setAttribute('src', url);
}
function updateChromeView() {
  const url = (chromeTabs[chromeActive] && chromeTabs[chromeActive].url) || '';
  $('#chrome-url').value = url;
  loadChromeWebview(url);
}
function chromeGo(raw) {
  let url = String(raw || '').trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[^\s]+\.[^\s]{2,}$/.test(url)) url = `https://${url}`;
    else url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  if (/^chrome:\/\//i.test(url)) { toast('Chromium 内部页面请在外部 Chromium 窗口中打开'); window.toolbox.launchBrowserApp('chromium'); return; }
  chromeTabs[chromeActive].url = url;
  chromeTabs[chromeActive].title = url.replace(/^https?:\/\//, '').split('/')[0] || '新标签页';
  $('#chrome-url').value = url;
  renderChromeTabs();
  loadChromeWebview(url);
}
$('#chrome-new-tab').addEventListener('click', () => {
  chromeTabs.push({ title: '新标签页', url: '' });
  chromeActive = chromeTabs.length - 1;
  $('#chrome-url').value = '';
  renderChromeTabs();
  updateChromeView();
});
$('#chrome-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') chromeGo(e.target.value); });
$('#chrome-back').addEventListener('click', () => {
  const wv = $('#toolbox-webview');
  if (wv && wv.canGoBack && wv.canGoBack()) wv.goBack();
});
$('#chrome-forward').addEventListener('click', () => {
  const wv = $('#toolbox-webview');
  if (wv && wv.canGoForward && wv.canGoForward()) wv.goForward();
});
$('#chrome-reload').addEventListener('click', () => {
  const wv = $('#toolbox-webview');
  if (wv) wv.reload();
});
$('#chrome-search-go').addEventListener('click', () => chromeGo($('#chrome-search').value));
$('#chrome-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') chromeGo(e.target.value); });
const CHROME_BOOKMARKS = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: '微软', url: 'https://www.microsoft.com' },
  { name: '维基百科', url: 'https://zh.wikipedia.org' },
];
CHROME_BOOKMARKS.forEach((b) => {
  const btn = el('button', '', b.name);
  btn.type = 'button';
  btn.addEventListener('click', () => chromeGo(b.url));
  $('#chrome-bookmarks').appendChild(btn);
});
const CHROME_SHORTCUTS = [
  { name: 'Google', glyph: 'G', url: 'https://www.google.com' },
  { name: 'GitHub', glyph: 'G', url: 'https://github.com' },
  { name: '应用商店', glyph: '▦', url: 'https://chromewebstore.google.com/' },
];
CHROME_SHORTCUTS.forEach((s) => {
  const btn = el('button', '');
  btn.type = 'button';
  btn.appendChild(el('span', 'shortcut-dot', s.glyph));
  btn.appendChild(el('span', '', s.name));
  btn.addEventListener('click', () => chromeGo(s.url));
  $('#chrome-shortcuts').appendChild(btn);
});
$('#chrome-ext-btn').addEventListener('click', () => { showBrowserView('ext'); renderChromiumExt(); });
$$('[data-chrome-act]').forEach((b) => b.addEventListener('click', async () => {
  const act = b.dataset.chromeAct;
  $$('.menu.open').forEach((m) => m.classList.remove('open'));
  if (act === 'new-tab') $('#chrome-new-tab').click();
  else if (act === 'extensions') { showBrowserView('ext'); renderChromiumExt(); }
  else if (act === 'settings') { showBrowserView('settings'); loadChromiumSettings(); }
  else if (act === 'webstore') chromeGo('https://chromewebstore.google.com/');
}));
function initToolboxWebview() {
  const wv = $('#toolbox-webview');
  if (!wv || wv.dataset.bound) return;
  wv.dataset.bound = '1';
  wv.addEventListener('did-navigate', (e) => {
    const url = e.url || '';
    if (url === 'about:blank') return; // 停媒体时切到空白页，不覆盖标签页地址
    $('#chrome-url').value = url;
    chromeTabs[chromeActive].url = url;
    chromeTabs[chromeActive].title = url.replace(/^https?:\/\//, '').split('/')[0] || '新标签页';
    renderChromeTabs();
    /* 2026-11-27-2：换页后上页抓到的视频失效，清掉嗅探列表与悬浮图标；
     * 同时记下导航轨迹，供登录成功启发式用。 */
    clearBrowserMedia();
    trackBrowserLoginNav(url);
  });
  wv.addEventListener('did-finish-load', () => {
    /* 登录成功启发式第二信号：登录页跳走后，新页出现登出/头像等登录态标志。 */
    checkBrowserLoggedInDom();
  });
  wv.addEventListener('page-title-updated', (e) => {
    if (e.title) { chromeTabs[chromeActive].title = e.title; renderChromeTabs(); }
  });
  wv.addEventListener('did-fail-load', (_e, code) => { if (code === -3) return; toast('页面打不开：检查地址与网络'); });
}
initToolboxWebview();
$('#chrome-close').addEventListener('click', goBack);
$('#chrome-open-external').addEventListener('click', async () => {
  const url = ($('#chrome-url').value || '').trim();
  const r = await window.toolbox.launchBrowserApp('chromium', url || undefined);
  if (r && !r.ok) toast(r.error || '打开失败');
});
/* 外部调用进内嵌浏览器：browser-open-url(kind=chromium) 改为发此事件 */
window.toolbox.on('embedded-browser-open', (msg) => {
  const url = msg && msg.url;
  setMenuActive('browser');
  gotoScreen('browser');
  showBrowserView('chromium');
  if (url) chromeGo(url);
});

/* ---------- 2026-11-27-2：浏览器视频嗅探悬浮图标 + 登录成功提示保存账号 ----------
 * 嗅探：主进程接 session webRequest 监听到视频流后发 browser-media-found
 * （preload.onBrowserMedia，payload {url, type, pageUrl}）；前端只收列表、
 * 亮悬浮图标、点图标展开视频下载页。主进程没发事件时不报错、不影响浏览。
 * 登录提示：只用能实际检测到的信号——①从登录页（含 login/signin/auth 等
 * 的地址）同域跳转到非登录页；②跳走后新页面 DOM 里出现登出/头像等登录态
 * 标志（executeJavaScript 读不到就只用信号①）。两个信号都只是“可能登录
 * 成功”，所以只弹确认框问用户，不静默保存；同域名 10 分钟内只弹一次；
 * 正在用账号管理里的账号浏览、或正在走注册流程时不弹。
 * 检测不到的场景（SPA 无跳转登录、扫码登录、executeJavaScript 被页面禁掉、
 * 用户名/密码本身）见汇报，不假装能检测。account-save 不存用户名密码，
 * 提示保存只建一条站点占位记录，用户名需用户在账号管理里补填。 */
let browserMediaItems = []; // [{url, type, pageUrl}]
const LOGIN_PATH_RE = /login|signin|sign-in|sign_in|auth|passport|oauth|user\/login|account\/login/i;
const LOGIN_PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
let lastBrowserNav = { prev: '', url: '', at: 0 }; // 上一次 did-navigate 的地址与它的上一页
const loginPromptedAt = new Map(); // host -> 上次弹框时间戳
function browserMediaHost(url) {
  try { return new URL(url).hostname || ''; } catch (e) { return ''; }
}
function updateBrowserMediaFab() {
  const fab = $('#browser-media-fab');
  const count = $('#browser-media-count');
  if (!fab) return;
  const n = browserMediaItems.length;
  /* 只在内嵌浏览器视图打开时显示：切到别的页就藏起来，回来再亮。 */
  const browsing = currentScreen === 'browser' && currentBrowserView === 'chromium'
    && !$('#chrome-view').classList.contains('hidden');
  fab.classList.toggle('hidden', n === 0 || !browsing);
  if (count) {
    count.textContent = String(Math.min(n, 99));
    count.classList.toggle('hidden', n === 0);
  }
  fab.title = n ? `本页发现 ${n} 个视频，点我下载` : '本页发现视频，点我下载';
}
function clearBrowserMedia() {
  browserMediaItems = [];
  updateBrowserMediaFab();
  renderBrowserMediaPanel();
}
function renderBrowserMediaPanel() {
  const panel = $('#browser-media-panel');
  const box = $('#browser-media-list');
  if (!panel || !box) return;
  panel.classList.toggle('hidden', browserMediaItems.length === 0);
  box.innerHTML = '';
  if (!browserMediaItems.length) { box.className = 'list empty-note'; box.textContent = '暂无抓到的视频。'; return; }
  box.className = 'list';
  for (const it of browserMediaItems) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${(it.type || '视频').toUpperCase()}${it.pageUrl ? ` · ${browserMediaHost(it.pageUrl)}` : ''}`));
    main.appendChild(el('div', 'row-sub', it.url || ''));
    wrap.appendChild(main);
    const dl = el('button', 'btn small primary', '下载');
    dl.type = 'button';
    dl.addEventListener('click', () => videoStartDownload(it.url, 'auto', undefined, undefined));
    wrap.appendChild(dl);
    box.appendChild(wrap);
  }
}
if (typeof window.toolbox.onBrowserMedia === 'function') {
  window.toolbox.onBrowserMedia((p) => {
    if (!p || !p.url) return;
    if (browserMediaItems.some((x) => x.url === p.url)) return;
    browserMediaItems.push({ url: String(p.url), type: String(p.type || ''), pageUrl: String(p.pageUrl || '') });
    if (browserMediaItems.length > 50) browserMediaItems.shift();
    updateBrowserMediaFab();
    renderBrowserMediaPanel();
  });
}
$('#browser-media-fab').addEventListener('click', () => {
  setMenuActive('video');
  gotoScreen('video');
  gotoPageTab('video', 'videoTab', 'video-tab', 'parse');
  renderBrowserMediaPanel();
});
$('#browser-media-clear').addEventListener('click', clearBrowserMedia);

function trackBrowserLoginNav(url) {
  const prev = lastBrowserNav.url;
  lastBrowserNav = { prev, url, at: Date.now() };
  if (!prev || !url || prev === url) return;
  if (!/^https?:\/\//i.test(prev) || !/^https?:\/\//i.test(url)) return;
  let prevHost = '', host = '';
  try { prevHost = new URL(prev).hostname; host = new URL(url).hostname; } catch (e) { return; }
  if (!prevHost || prevHost !== host) return; // 跨站跳走不算（多是第三方登录中转）
  if (!LOGIN_PATH_RE.test(prev)) return; // 上一页不是登录页
  if (LOGIN_PATH_RE.test(url)) return; // 还在登录流程里（输错密码、二次验证等）
  maybePromptSaveAccount(url, 'login-redirect');
}
async function checkBrowserLoggedInDom() {
  const wv = $('#toolbox-webview');
  const url = (wv && wv.getURL && wv.getURL()) || $('#chrome-url').value || '';
  if (!url || !/^https?:\/\//i.test(url)) return;
  const prev = lastBrowserNav.prev;
  if (!prev || !LOGIN_PATH_RE.test(prev)) return; // 只有从登录页跳过来才查 DOM
  if (LOGIN_PATH_RE.test(url)) return;
  let loggedIn = false;
  try {
    if (wv && typeof wv.executeJavaScript === 'function') {
      loggedIn = await wv.executeJavaScript(`(() => {
        const txt = (document.body && document.body.innerText || '').slice(0, 4000);
        const hasLogout = !!document.querySelector('a[href*="logout" i], a[href*="signout" i], a[href*="sign-out" i], button[class*="logout" i]');
        const hasAvatar = !!document.querySelector('[class*="avatar" i], [class*="user-menu" i], [aria-label*="账号" i], [aria-label*="账户" i]');
        const saysLogout = /退出登录|登出|退出账号/.test(txt);
        return hasLogout || hasAvatar || saysLogout;
      })()`, false);
    }
  } catch (e) { /* 页面禁脚本就只用跳转信号，不报错 */ }
  if (loggedIn) maybePromptSaveAccount(url, 'login-dom');
}
/* 2026-11-27-3：登录提示改用严格认证指纹。
 * 旧逻辑只凭“登录页跳转 + 页面出现登出/头像”就弹保存提示，跳转本
 * 身不等于登录成功（输错密码回首页、扫码中转等都会误判）。新逻辑：
 * 跳转/DOM 信号只作弱信号，必须先经主进程查浏览器分区 Cookie，
 * 命中明确的已登录凭证键（如 sessionid、SESSDATA、Auth Token 等）
 * 才认定已登录；未命中不弹提示。提示前与本地已存账号按站点去重，
 * 已忽略的站点（本次忽略/不再提示）不再弹。 */
async function maybePromptSaveAccount(url, _reason) {
  const host = browserMediaHost(url);
  if (!host) return;
  if (activeAccountId) return; // 正在用账号管理里的账号浏览，已有归属，不弹
  const banner = $('#register-banner');
  if (banner && !banner.classList.contains('hidden')) return; // 正在走注册流程
  const last = loginPromptedAt.get(host) || 0;
  if (Date.now() - last < LOGIN_PROMPT_COOLDOWN_MS) return; // 同域名短时间内只弹一次
  // 严格认证指纹：主进程读 Cookie，只回是否命中与键名；自测可注入桩。
  const check = window.__testLoginCheck || ((u) => callTb('browserLoginCheck', u));
  let verified = null;
  try { verified = await check(url); } catch (e) { verified = null; }
  if (!verified || !verified.loggedIn) return; // 未命中已登录凭证，不弹提示
  // 去重：本地已有同站账号时不重复提示。
  try {
    const list = await window.toolbox.accountsList().catch(() => null);
    const arr = (list && list.accounts) || [];
    const dup = arr.some((a) => {
      const h = (a.siteName || a.site || '').toLowerCase();
      if (h === host.toLowerCase()) return true;
      try { return new URL(a.loginUrl || '').hostname.toLowerCase() === host.toLowerCase(); } catch (e) { return false; }
    });
    if (dup) return;
  } catch (e) { /* 读不到已存账号时继续提示 */ }
  // 忽略标记：本次忽略或不再提示该站点时不弹。
  try {
    const ignored = await callTb('browserLoginIgnored', host);
    if (ignored && ignored.ignored) return;
  } catch (e) { /* 忽略 */ }
  loginPromptedAt.set(host, Date.now());
  const choice = await showCustomDialog({
    title: '保存账号',
    message: '检测到在 ' + host + ' 已登录（已验证登录凭证：' + (verified.matchedKey || '已登录') + '），是否把这个账号保存到账号管理？\n（只保存站点，用户名与密码不会自动读取，保存后请在账号管理里补填。）',
    buttons: [
      { label: '保存', value: 'save', primary: true },
      { label: '本次忽略', value: 'ignore-session' },
      { label: '不再提示该站点', value: 'ignore-forever' },
    ],
  });
  if (choice === 'ignore-session' || choice === 'ignore-forever') {
    try { await callTb('browserLoginIgnore', { host, scope: choice === 'ignore-forever' ? 'forever' : 'session' }); } catch (e) { /* 忽略 */ }
    return;
  }
  if (choice !== 'save') return;
  let origin = '';
  try { origin = new URL(url).origin; } catch (e) { origin = ''; }
  const r = await callTb('accountSave', {
    site: 'custom', siteName: host, name: `${host} 账号`,
    loginUrl: origin || url, note: '浏览器登录后提示保存；用户名与密码未自动读取，请在账号管理里补填',
  });
  if (r && r.ok) toast(`已保存到账号管理：${host} 账号（请在账号管理里补填用户名）`);
  else toast((r && r.error) || '保存失败');
}
async function renderBrowser() {
  const st = await window.toolbox.browserStatus();
  if (st.downloaded) {
    $('#browser-status').textContent = `已下载 · Chromium ${st.version || ''}（官方快照 ${st.snapshotDate || ''}）\n${st.path}`;
    $('#browser-download').classList.add('hidden');
  } else {
    $('#browser-status').textContent = `Chromium 还没下载：首次使用时从官方快照地址下载（约 209MB，带断点续传和 sha256 校验），下完按工具箱预置配置启动。安装包里不带 Chromium，点下面按钮下载。\n${st.note || ''}`;
    $('#browser-download').classList.remove('hidden');
    $('#browser-download').textContent = '下载 Chromium（约 209MB）';
  }
  renderChromeTabs();
  updateChromeView();
}
$('#browser-download').addEventListener('click', async () => {
  $('#browser-progress').classList.remove('hidden');
  const r = await window.toolbox.browserDownload();
  if (r.ok) { toast('浏览器已重新下载好'); renderBrowser(); }
  else toast(r.error || '下载失败');
});
async function loadChromiumSettings() {
  const s = await window.toolbox.chromiumGetSettings();
  $('#chrome-set-homepage').value = s.homepage || '';
  $('#chrome-set-lang').value = s.language || 'zh-CN';
  $('#chrome-set-downdir').value = s.downloadDir || '';
  $('#chrome-set-check-default').checked = s.checkDefaultBrowser !== false;
}
$('#chrome-settings-save').addEventListener('click', async () => {
  const r = await window.toolbox.chromiumSetSettings({
    homepage: $('#chrome-set-homepage').value.trim(),
    language: $('#chrome-set-lang').value,
    downloadDir: $('#chrome-set-downdir').value.trim(),
    checkDefaultBrowser: $('#chrome-set-check-default').checked,
  });
  toast(r.ok ? '已保存，下次启动 Chromium 时生效' : (r.error || '保存失败'));
});
async function renderChromiumExt() {
  const box = $('#chromium-ext-list');
  box.className = 'list empty-note';
  box.textContent = '正在读取已装扩展…';
  const list = await window.toolbox.chromiumExtensions();
  box.innerHTML = '';
  if (!list.length) { box.textContent = '工具箱浏览器里还没有装扩展。去 Chrome 应用商店添加。'; return; }
  box.className = 'list';
  for (const ext of list) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', ext.name));
    main.appendChild(el('div', 'row-sub', `${ext.id} · ${ext.version}`));
    wrap.appendChild(main);
    box.appendChild(wrap);
  }
}
$('#chrome-webstore-open').addEventListener('click', () => chromeGo('https://chromewebstore.google.com/'));
$('#chrome-ext-manage').addEventListener('click', () => chromeGo('chrome://extensions'));
$('#default-browser').addEventListener('change', async (e) => {
  await window.toolbox.setConfig({ defaultBrowser: e.target.value });
  toast(`默认浏览器已设为 ${BROWSER_META[e.target.value].name}`);
});

/* ---------- 账号管理：多账号分开登录、集中管理（2026-11-26-7） ----------
 * 后端 IPC（accountsList / accountSave / accountDelete / accountOpen /
 * accountClose / accountRegisterBegin / accountRegisterDone /
 * accountRegisterCancel）由主进程侧提供；方法未就位时 callTb 返回
 * 「后端未就绪」，界面如实提示，不假装成功。
 * 代理密码只在保存时发给后端，列表与编辑回填里都不出现。
 * 注意：后端实际读 proxy.username / proxy.password（任务契约写的是
 * user / pass，见汇报），这里按后端实际字段发送；IPC 名未动。 */
const ACCOUNT_SITES = {
  google: { name: '谷歌', loginUrl: 'https://accounts.google.com/signin', signupUrl: 'https://accounts.google.com/signup' },
  github: { name: 'GitHub', loginUrl: 'https://github.com/login', signupUrl: 'https://github.com/signup' },
  microsoft: { name: '微软', loginUrl: 'https://login.microsoftonline.com/', signupUrl: 'https://signup.live.com/signup' },
  custom: { name: '自定义', loginUrl: '', signupUrl: '' },
};
let accountsCache = [];
let currentAccountId = null; // 正在编辑的账号（null = 新建）
let activeAccountId = null; // 当前在浏览器里打开的账号
let activeAccountName = '';
let registeringAccountId = null;

function accountTimeValue(v) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
async function renderAccounts() {
  const box = $('#account-list');
  const r = await callTb('accountsList');
  if (!r || r.ok === false) {
    accountsCache = [];
    box.className = 'list empty-note';
    box.textContent = (r && r.error) || '账号列表读取失败';
    fillRegisterSelect();
    return;
  }
  accountsCache = r.accounts || [];
  renderAccountRows();
  fillRegisterSelect();
  try {
    const cfg = await window.toolbox.getConfig();
    if (cfg && cfg.registerIntervalMin) $('#register-interval').value = String(cfg.registerIntervalMin);
  } catch (e) { /* 读不到用默认 60 */ }
}
function renderAccountRows() {
  const box = $('#account-list');
  const q = ($('#account-search').value || '').trim().toLowerCase();
  const rows = accountsCache
    .filter((a) => !q || [a.siteName, a.site, a.name, a.group, a.note]
      .some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => accountTimeValue(b.lastUsedAt) - accountTimeValue(a.lastUsedAt));
  box.innerHTML = '';
  if (!rows.length) {
    box.className = 'list empty-note';
    box.textContent = accountsCache.length ? '没有符合条件的账号。' : '暂无账号，点「新增账号」添加。';
    return;
  }
  box.className = 'list';
  for (const a of rows) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    const title = el('div', 'row-title', `${a.siteName || ACCOUNT_SITES[a.site]?.name || a.site || ''} · ${a.name || ''}`);
    main.appendChild(title);
    const subParts = [];
    if (a.group) subParts.push(a.group);
    if (a.note) subParts.push(a.note);
    subParts.push(a.hasProxy ? `代理：${a.proxySummary || '已设置'}` : '直连');
    subParts.push(a.lastUsedAt ? `最近使用 ${fmtTime(a.lastUsedAt)}` : '未使用过');
    main.appendChild(el('div', 'row-sub', subParts.join(' · ')));
    wrap.appendChild(main);
    if (a.id === activeAccountId) wrap.appendChild(el('span', 'badge', '正在使用'));
    if (a.status === 'registering') wrap.appendChild(el('span', 'badge', '注册中'));
    const openBtn = el('button', 'btn small primary', '打开');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openAccount(a.id));
    wrap.appendChild(openBtn);
    const editBtn = el('button', 'btn small', '编辑');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => {
      currentAccountId = a.id;
      fillAccountForm(a);
      $('#account-name').focus();
    });
    wrap.appendChild(editBtn);
    const delBtn = el('button', 'btn small danger', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => deleteAccount(a.id));
    wrap.appendChild(delBtn);
    box.appendChild(wrap);
  }
}
function fillRegisterSelect() {
  const sel = $('#register-account');
  const prev = sel.value;
  sel.innerHTML = '';
  if (!accountsCache.length) {
    sel.appendChild(new Option('暂无账号，先新增账号', ''));
  } else {
    for (const a of accountsCache) {
      sel.appendChild(new Option(`${a.siteName || ACCOUNT_SITES[a.site]?.name || a.site || ''} · ${a.name || ''}`, a.id));
    }
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
function updateAccountCustomFields() {
  $('#account-custom-fields').classList.toggle('hidden', $('#account-site').value !== 'custom');
}
$('#account-site').addEventListener('change', updateAccountCustomFields);
$('#account-search').addEventListener('input', renderAccountRows);
function fillAccountForm(a) {
  const site = (a && a.site) || 'google';
  $('#account-site').value = ACCOUNT_SITES[site] ? site : 'custom';
  $('#account-login-url').value = (a && a.loginUrl) || '';
  $('#account-signup-url').value = (a && a.signupUrl) || '';
  $('#account-signup-url').placeholder = 'https://…';
  $('#account-name').value = (a && a.name) || '';
  $('#account-group').value = (a && a.group) || '';
  $('#account-note').value = (a && a.note) || '';
  // 列表接口返回结构化代理（不含密码）：编辑时类型、地址、端口、代理账号
  // 直接回填；密码不回填，留空表示不改。旧数据只有摘要时再从摘要解析。
  const p = (a && a.proxy) || {};
  $('#account-proxy-type').value = p.type || 'http';
  $('#account-proxy-host').value = p.host || '';
  $('#account-proxy-port').value = p.port || '';
  $('#account-proxy-user').value = p.username || p.user || '';
  $('#account-proxy-pass').value = ''; // 密码不回填，留空表示不改
  if (a && a.hasProxy && !p.host && a.proxySummary) {
    const m = /^(SOCKS5|HTTP) (.+):(\d+)$/.exec(String(a.proxySummary));
    if (m) {
      $('#account-proxy-type').value = m[1] === 'SOCKS5' ? 'socks5' : 'http';
      $('#account-proxy-host').value = m[2];
      $('#account-proxy-port').value = m[3];
    }
  }
  $('#account-proxy-user').placeholder = '';
  const f = (a && a.fingerprint) || {};
  $('#account-fp-ua').value = f.userAgent || '';
  $('#account-fp-lang').value = f.language || '';
  $('#account-fp-tz').value = f.timezone || '';
  $('#account-fp-width').value = f.windowWidth || '';
  $('#account-fp-height').value = f.windowHeight || '';
  $('#account-delete').disabled = !a;
  updateAccountCustomFields();
}
$('#account-new').addEventListener('click', () => {
  currentAccountId = null;
  fillAccountForm(null);
  $('#account-name').focus();
});
$('#account-save').addEventListener('click', async () => {
  const site = $('#account-site').value;
  const name = $('#account-name').value.trim();
  if (!name) { toast('先填账号名'); return; }
  const loginUrl = $('#account-login-url').value.trim();
  const signupUrl = $('#account-signup-url').value.trim();
  if (site === 'custom' && !loginUrl) { toast('自定义站点先填登录地址'); return; }
  if (site === 'custom' && !signupUrl) { toast('自定义站点先填注册地址'); return; }
  const cur = accountsCache.find((a) => a.id === currentAccountId) || {};
  const defaults = ACCOUNT_SITES[site] || ACCOUNT_SITES.custom;
  let siteName = defaults.name;
  if (site === 'custom') {
    try { siteName = new URL(loginUrl).hostname || '自定义'; } catch (e) { siteName = '自定义'; }
  }
  const proxyHost = $('#account-proxy-host').value.trim();
  const proxyPort = parseInt($('#account-proxy-port').value, 10);
  if (proxyHost && (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) { toast('代理端口须为 1-65535 的数字'); return; }
  const proxyPass = $('#account-proxy-pass').value;
  const fpW = parseInt($('#account-fp-width').value, 10);
  const fpH = parseInt($('#account-fp-height').value, 10);
  const account = {
    id: currentAccountId || undefined,
    site,
    siteName,
    loginUrl: site === 'custom' ? loginUrl : (cur.loginUrl || defaults.loginUrl),
    signupUrl: site === 'custom' ? signupUrl : (cur.signupUrl || defaults.signupUrl),
    name,
    group: $('#account-group').value.trim(),
    note: $('#account-note').value.trim(),
    proxy: {
      type: $('#account-proxy-type').value,
      host: proxyHost,
      port: proxyPort || 0,
      username: $('#account-proxy-user').value.trim(),
      // 后端读 username / password（不是 user / pass）；留空表示直连；密码留空表示不改（不发空串覆盖已有密码）
      ...(proxyHost && proxyPass ? { password: proxyPass } : {}),
    },
    fingerprint: {
      userAgent: $('#account-fp-ua').value.trim(),
      language: $('#account-fp-lang').value.trim(),
      timezone: $('#account-fp-tz').value.trim(),
      windowWidth: Number.isFinite(fpW) ? fpW : null,
      windowHeight: Number.isFinite(fpH) ? fpH : null,
    },
  };
  const r = await callTb('accountSave', account);
  if (!r || r.ok === false) { toast((r && r.error) || '保存失败'); return; }
  if (r.account && r.account.id) currentAccountId = r.account.id;
  toast('账号已保存');
  renderAccounts();
});
async function deleteAccount(id) {
  const a = accountsCache.find((x) => x.id === id);
  if (!await customConfirm('删除账号', `确定删除账号「${(a && a.name) || ''}」吗？`, '删除')) return;
  const r = await callTb('accountDelete', id);
  if (!r || r.ok === false) { toast((r && r.error) || '删除失败'); return; }
  if (id === currentAccountId) { currentAccountId = null; fillAccountForm(null); }
  if (id === activeAccountId) restoreDefaultWebview();
  toast('账号已删除');
  renderAccounts();
}
$('#account-delete').addEventListener('click', () => {
  if (!currentAccountId) { toast('先在列表里选一个账号'); return; }
  deleteAccount(currentAccountId);
});

/* ----- 账号浏览器切换：替换 #toolbox-webview，登录态存在分区磁盘里 ----- */
function ensureAccountWebview(open) {
  const view = $('#chrome-view');
  const old = $('#toolbox-webview');
  const wv = document.createElement('webview');
  wv.id = 'toolbox-webview';
  wv.setAttribute('partition', open.partition || 'persist:toolbox-browser');
  if (open.preloadFileUrl) wv.setAttribute('preload', open.preloadFileUrl);
  if (open.userAgent) wv.setAttribute('useragent', open.userAgent);
  if (old) old.remove(); // 销毁旧元素不丢登录态（Cookie 在分区磁盘里）
  view.appendChild(wv);
  initToolboxWebview(); // 新元素没有 dataset.bound，重新挂 did-navigate 等绑定
  if (open.viewport && open.viewport.w && open.viewport.h) {
    view.style.width = `${open.viewport.w}px`;
    view.style.height = `${open.viewport.h}px`;
    view.classList.add('account-sized');
  } else {
    view.style.width = '';
    view.style.height = '';
    view.classList.remove('account-sized');
  }
  loadChromeWebview(open.loginUrl);
}
function restoreDefaultWebview() {
  const view = $('#chrome-view');
  const old = $('#toolbox-webview');
  if (old) old.remove();
  const wv = document.createElement('webview');
  wv.id = 'toolbox-webview';
  wv.setAttribute('partition', 'persist:toolbox-browser');
  view.appendChild(wv);
  initToolboxWebview();
  view.style.width = '';
  view.style.height = '';
  view.classList.remove('account-sized');
  activeAccountId = null;
  activeAccountName = '';
  hideRegisterBanner();
  updateAccountChromeUI();
  chromeTabs[chromeActive] = { title: '新标签页', url: '' };
  $('#chrome-url').value = '';
  renderChromeTabs();
  loadChromeWebview('');
}
function updateAccountChromeUI() {
  const on = !!activeAccountId;
  $('#chrome-account-label').classList.toggle('hidden', !on);
  $('#chrome-account-close').classList.toggle('hidden', !on);
  if (on) $('#chrome-account-label').textContent = `正在使用：${activeAccountName}`;
}
function switchToAccountBrowser(open, accountId, accountName) {
  ensureAccountWebview(open);
  activeAccountId = accountId;
  activeAccountName = accountName || open.siteName || '';
  chromeTabs[chromeActive] = { title: activeAccountName, url: open.loginUrl || '' };
  $('#chrome-url').value = open.loginUrl || '';
  renderChromeTabs();
  updateAccountChromeUI();
  setMenuActive('browser');
  gotoScreen('browser');
  showBrowserView('chromium');
}
async function openAccount(id) {
  const r = await callTb('accountOpen', id);
  if (!r || r.ok === false) { toast((r && r.error) || '打开账号失败'); return; }
  if (!r.open) { toast('打开账号失败'); return; }
  const acc = accountsCache.find((a) => a.id === id);
  switchToAccountBrowser(r.open, r.open.accountId || id, (acc && (acc.name || acc.siteName)) || r.open.siteName);
  renderAccounts(); // 刷新「正在使用」标记与最近使用时间
}
$('#chrome-account-close').addEventListener('click', async () => {
  const r = await callTb('accountClose');
  if (r && r.ok === false) { toast(r.error || '关闭账号失败'); return; }
  restoreDefaultWebview();
  setMenuActive('accounts');
  gotoScreen('accounts');
  renderAccounts();
});

/* ----- 注册向导：一次一个账号，手机验证请本人操作，不自动填账号密码 ----- */
function showRegisterBanner(name) {
  $('#register-banner-name').textContent = name || '';
  $('#register-banner').classList.remove('hidden');
}
function hideRegisterBanner() {
  $('#register-banner').classList.add('hidden');
  registeringAccountId = null;
}
$('#register-begin').addEventListener('click', async () => {
  const id = $('#register-account').value;
  if (!id) { toast('先选择一个账号'); return; }
  const mins = parseInt($('#register-interval').value, 10);
  const interval = Number.isFinite(mins) && mins > 0 ? mins : 60;
  try { await window.toolbox.setConfig({ registerIntervalMin: interval }); } catch (e) { /* 存不下不拦注册 */ }
  const r = await callTb('accountRegisterBegin', id);
  if (!r || r.ok === false) { toast((r && r.error) || '开始注册失败'); return; }
  if (!r.open) { toast('开始注册失败'); return; }
  const acc = accountsCache.find((a) => a.id === id);
  registeringAccountId = id;
  switchToAccountBrowser(r.open, r.open.accountId || id, (acc && (acc.name || acc.siteName)) || r.open.siteName);
  showRegisterBanner(activeAccountName);
  renderAccounts();
});
$('#register-done').addEventListener('click', async () => {
  if (!registeringAccountId) { hideRegisterBanner(); return; }
  const r = await callTb('accountRegisterDone', registeringAccountId);
  if (r && r.ok === false) { toast(r.error || '完成注册失败'); return; }
  hideRegisterBanner();
  toast('注册已完成');
  renderAccounts();
});
$('#register-cancel').addEventListener('click', async () => {
  if (!registeringAccountId) { hideRegisterBanner(); return; }
  const r = await callTb('accountRegisterCancel', registeringAccountId);
  if (r && r.ok === false) { toast(r.error || '取消注册失败'); return; }
  hideRegisterBanner();
  toast('已取消注册');
});

/* ---------- 设置（含空间调用） ---------- */
function gotoSettingsTab(name) {
  $$('#settings-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.settingsTab === name));
  $$('#screen-settings .tabpane').forEach((p) => p.classList.toggle('active', p.id === `settings-pane-${name}`));
}
$$('#settings-tabs .tab').forEach((b) => b.addEventListener('click', () => gotoSettingsTab(b.dataset.settingsTab)));

/* ---------- 菜单页分标签（2026-11-26-7）：一个页面堆多组功能的页拆成标签 ----------
 * 已拆：创作、图像、监控、远程、视频下载、代理。
 * 2026-11-27-2：媒体页已删，不再拆。
 * 未拆：工具、设置、智能体、注册、文件（已有标签）；播放器、浏览器
 * （已是子视图切换）；账号管理（按任务约束不动）；插件、空间、工具箱
 * 总览（单组功能，无需拆）；代码（左右分栏是同一编辑流程的两部分）。 */
function gotoPageTab(screen, attr, prefix, name) {
  $$(`#screen-${screen} .tab`).forEach((b) => b.classList.toggle('active', b.dataset[attr] === name));
  $$(`#screen-${screen} .tabpane`).forEach((p) => p.classList.toggle('active', p.id === `${prefix}-${name}`));
}
$$('#screen-create [data-create-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('create', 'createTab', 'create-tab', b.dataset.createTab)));
$$('#screen-image [data-image-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('image', 'imageTab', 'image-tab', b.dataset.imageTab)));
$$('#screen-monitor [data-monitor-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('monitor', 'monitorTab', 'monitor-tab', b.dataset.monitorTab)));
$$('#screen-remote [data-remote-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('remote', 'remoteTab', 'remote-tab', b.dataset.remoteTab)));
$$('#screen-video [data-video-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('video', 'videoTab', 'video-tab', b.dataset.videoTab)));
$$('#screen-proxy [data-proxy-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('proxy', 'proxyTab', 'proxy-tab', b.dataset.proxyTab)));
async function renderSelfcheck() {
  const box = $('#selfcheck-list');
  if (!box) return;
  const list = await window.toolbox.selfcheckStatus().catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '检测失败。'; return; }
  box.className = 'list';
  for (const item of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${item.name}${item.version ? ` ${item.version}` : ''}`));
    main.appendChild(el('div', 'row-sub', item.status === 'ok' ? '已就绪' : item.status === 'missing' ? `未安装 · ${item.note || ''}` : (item.note || '无法检测')));
    row.appendChild(main);
    if (item.status === 'missing') {
      const inst = el('button', 'btn small primary', item.key === 'wintun' ? '安装驱动' : '一键安装');
      inst.type = 'button';
      inst.addEventListener('click', async () => {
        if (item.key === 'wintun') {
          const go = await customConfirm('安装 WinTun 驱动', '驱动文件已随安装包内置，不再下载。首次安装需弹一次确认框拉起提权 helper，装好后日常使用不再提权。', '开始安装');
          if (!go) return;
        }
        inst.disabled = true;
        inst.textContent = '安装中…';
        const r = await window.toolbox.selfcheckInstall(item.key).catch((e) => ({ ok: false, error: e.message || String(e) }));
        inst.disabled = false;
        if (r && r.jobId) { toast('安装已开始，进度见工具管理'); }
        else if (r && r.ok === false) toast(r.error || '安装失败');
        else toast('已安装');
        renderSelfcheck();
      });
      row.appendChild(inst);
    }
    box.appendChild(row);
  }
}
$('#selfcheck-refresh').addEventListener('click', renderSelfcheck);
async function renderSettings() {
  const ov = await window.toolbox.getOverview();
  $('#cfg-download-dir').value = ov.config.downloadDir || '';
  $('#space-call-toggle').checked = ov.spaceCallEnabled !== false;
  window.__spaceUrl = ov.config.spaceUrl || '';
  $('#cfg-space-url').value = ov.config.spaceUrl || '';
  const pm = $('#proxy-mode'); if (pm) pm.value = ov.config.proxyMode || 'direct';
  const ph = $('#proxy-host'); if (ph) ph.value = ov.config.proxyHost || '';
  const pp = $('#proxy-port'); if (pp) pp.value = ov.config.proxyPort || '';
  const setupInput = $('#space-url-input');
  if (setupInput && !setupInput.value) setupInput.value = ov.config.spaceUrl || '';
  $('#protocol-status').textContent = ov.protocolRegistered
    ? '已注册：空间点播放 / 打开链接能唤起本程序'
    : '未注册：点右侧按钮重新注册';
  $('#about-line').textContent = `桌面工具箱 · 版本 ${ov.version} · 更新走 GitHub Releases（zmfs9192/zhuo-mian-liao-tian-kong-jian），只手动检查与更新，不自动检查。`;
  $('#default-player').value = ov.config.defaultPlayer || 'vlc';
  $('#default-browser').value = ov.config.defaultBrowser || 'chromium';
  // 2026-11-26-3：窗口与系统开关（默认行为见主进程配置默认值）
  const winCfg = ov.config || {};
  const setChecked = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
  setChecked('#cfg-hw-accel', winCfg.hardwareAcceleration !== false);
  setChecked('#cfg-notify', winCfg.notificationsEnabled !== false);
  setChecked('#cfg-prevent-sleep', winCfg.preventSleep === true);
  setChecked('#cfg-always-on-top', winCfg.alwaysOnTop === true);
  setChecked('#cfg-transparent', winCfg.windowTransparent !== false);
  setChecked('#cfg-close-tray', winCfg.closeToTray !== false);
  setChecked('#cfg-autostart', winCfg.autoStart === true);
  document.body.classList.toggle('transparent-mode', winCfg.windowTransparent !== false);
  renderBackupSync();
  renderUpdateSection();
  renderWindowStatus();
  renderAdminStatus();
}
/* 2026-11-27-2：管理员权限显示（设置页「窗口与系统」区）。
 * 首选主进程 tools-check-admin（返回 {isAdmin, method, detail}）；
 * 它没返回结果时退到 tun-status 的 admin（net session 检测），并如实注明来源；
 * 两个都读不到就显示未检测到，不编造结果。 */
function adminStatusText(r) {
  if (!r || typeof r.isAdmin !== 'boolean') return '管理员权限：未检测到';
  /* method 为 unsupported-platform（非 Windows）或 none（三级都失败）时
   * 不能写成“否”，那会误导成“已确认不是管理员”；如实写未检测到。 */
  if (r.method === 'unsupported-platform') return `管理员权限：未检测到（${r.detail || '管理员检测只在 Windows 上有意义'}）`;
  if (r.method === 'none') return `管理员权限：未检测到（${r.detail || '三种检测都失败，未能确认管理员身份'}）`;
  return `管理员权限：${r.isAdmin ? '是（已用管理员身份运行）' : '否（未用管理员身份运行）'}${r.method ? ` · 检测方法：${r.method}` : ''}${r.detail ? ` · ${r.detail}` : ''}`;
}
async function renderAdminStatus() {
  const line = $('#admin-status-line');
  if (!line) return;
  let text = '管理员权限：未检测到';
  try {
    const r = await callTb('toolsCheckAdmin');
    if (r && typeof r.isAdmin === 'boolean') {
      text = adminStatusText(r);
      line.textContent = text;
      return;
    }
    const tun = await callTb('tunStatus');
    if (tun && typeof tun.admin === 'boolean') {
      text = `管理员权限：${tun.admin ? '是（已用管理员身份运行）' : '否（未用管理员身份运行）'} · 检测方法：net session（经 Tun 状态；tools-check-admin 未返回结果）`;
    }
  } catch (e) { /* 读不到不拦设置页 */ }
  line.textContent = text;
}
/* 2026-11-26-3：电源与崩溃状态行（设置页「窗口与系统」区） */
async function renderWindowStatus() {
  try {
    const st = await window.toolbox.windowStatus();
    const powerNames = { 'lock-screen': '锁屏', 'unlock-screen': '解锁', suspend: '休眠', resume: '唤醒' };
    const pl = $('#power-status-line');
    if (pl) {
      pl.textContent = st.power
        ? `电源状态：最近一次「${powerNames[st.power.kind] || st.power.kind}」${new Date(st.power.at).toLocaleString('zh-CN')}`
        : '电源状态：暂无记录（锁屏、解锁、休眠、唤醒会在这里显示最近一条）';
    }
    const cl = $('#crash-status-line');
    if (cl) {
      const last = Array.isArray(st.crashes) && st.crashes.length ? st.crashes[st.crashes.length - 1] : null;
      cl.textContent = last
        ? `崩溃记录：最近一次 ${last.kind}（${new Date(last.at).toLocaleString('zh-CN')}），共 ${st.crashes.length} 条近期记录`
        : '崩溃记录：暂无记录';
    }
  } catch (e) { /* 状态读不到不拦设置页 */ }
}
function bindWindowSetting(id, key, toastMsg, restartMsg) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', async () => {
    await window.toolbox.setConfig({ [key]: el.checked });
    toast(restartMsg || toastMsg || '已保存');
    renderSettings();
  });
}
bindWindowSetting('#cfg-hw-accel', 'hardwareAcceleration', '', '硬件加速已保存，重启后生效');
bindWindowSetting('#cfg-notify', 'notificationsEnabled', '系统通知已保存');
bindWindowSetting('#cfg-prevent-sleep', 'preventSleep', '防休眠设置已保存');
bindWindowSetting('#cfg-always-on-top', 'alwaysOnTop', '窗口置顶已保存');
bindWindowSetting('#cfg-transparent', 'windowTransparent', '', '窗口透明已保存，重启后生效');
bindWindowSetting('#cfg-close-tray', 'closeToTray', '关闭按钮行为已保存');
bindWindowSetting('#cfg-autostart', 'autoStart', '开机自启已保存');

/* 2026-11-26-6：无边框窗口——悬浮窗口按钮（右上角），关闭仍走原有最小化到托盘逻辑（按设置） */
$('#win-min').addEventListener('click', () => window.toolbox.windowMinimize());
$('#win-max').addEventListener('click', async () => {
  const r = await window.toolbox.windowMaximize();
  $('#win-max').textContent = r.maximized ? '❐' : '▢';
});
$('#win-close').addEventListener('click', () => window.toolbox.windowClose());
/* 侧边栏顶部是拖拽区，双击切换最大化（点按钮不触发） */
$('#sidebar-head').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  window.toolbox.windowMaximize().then((r) => { $('#win-max').textContent = r.maximized ? '❐' : '▢'; });
});
window.toolbox.on('window-state', ({ maximized }) => {
  $('#win-max').textContent = maximized ? '❐' : '▢';
});
$('#space-call-toggle').addEventListener('change', async (e) => {
  await window.toolbox.setConfig({ spaceCallEnabled: e.target.checked });
  toast(e.target.checked ? '空间调用已打开' : '空间调用已关闭，协议调用会被拒绝');
  renderSettings();
});
$('#pick-dir').addEventListener('click', async () => {
  const dir = await window.toolbox.pickDir();
  if (dir) { await window.toolbox.setConfig({ downloadDir: dir }); renderSettings(); }
});
$('#register-protocol').addEventListener('click', async () => {
  const r = await window.toolbox.registerProtocol();
  toast(r.registered ? '协议已注册' : '注册失败，请重新安装工具箱再试');
  renderSettings();
});
$('#open-tools').addEventListener('click', () => window.toolbox.openToolsDir());

/* ----- 更新（2026-11-26-2，代码热更新）：只手动检查与下载改动的文件，不自动更新 ----- */
async function renderUpdateSection() {
  const s = await window.toolbox.updateStatus();
  const st = (s && s.state) || {};
  $('#update-current').textContent = `当前版本：${s.version || ''}`;
  $('#update-source').textContent = `更新源：GitHub 仓库更新清单（${s.repo || ''} / ${s.manifestPath || ''}）`;
  $('#update-last-check').textContent = st.lastCheckAt ? `上次检查：${new Date(st.lastCheckAt).toLocaleString('zh-CN')}` : '上次检查：尚未检查';
  $('#update-result').textContent = st.lastCheckMessage || '点「检查更新」查看有没有新版本。';
  const hasNew = st.lastCheckResult === 'update-available' && Array.isArray(st.changedFiles) && st.changedFiles.length > 0;
  $('#update-download').disabled = !hasNew;
  const rs = $('#update-restart');
  if (rs) rs.classList.toggle('hidden', !st.pendingRestart);
  $('#update-downloaded').textContent = st.pendingRestart && Array.isArray(st.updatedFiles)
    ? `已更新 ${st.updatedFiles.length} 个代码文件到 ${st.updatedVersion || ''}（${st.updatedFiles.join('、')}），旧文件已备份。点「重启生效」后用新版本。`
    : '';
}
$('#update-check').addEventListener('click', async () => {
  const btn = $('#update-check');
  btn.disabled = true; btn.textContent = '检查中…';
  $('#update-result').textContent = '正在拉 GitHub 上的更新清单…';
  try { await window.toolbox.updateCheck(); } catch (e) { $('#update-result').textContent = `检查失败：${e.message || e}`; }
  await renderUpdateSection();
  btn.disabled = false; btn.textContent = '检查更新';
});
$('#update-download').addEventListener('click', async () => {
  const btn = $('#update-download');
  btn.disabled = true; btn.textContent = '更新中…';
  $('#update-progress').classList.remove('hidden');
  try {
    const r = await window.toolbox.updateApply();
    if (!r.ok) $('#update-result').textContent = r.error || '更新失败';
  } catch (e) { $('#update-result').textContent = `更新失败：${e.message || e}`; }
  await renderUpdateSection();
  btn.disabled = false; btn.textContent = '一键更新';
});
$('#update-restart').addEventListener('click', () => window.toolbox.updateRestart());
$('#update-open-releases').addEventListener('click', () => window.toolbox.updateOpenReleases());
window.toolbox.on('update-progress', ({ status, pct, error }) => {
  const bar = $('#update-progress');
  const fill = $('#update-progress-fill');
  if (!bar || !fill) return;
  bar.classList.remove('hidden');
  fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  if (status === 'running') $('#update-result').textContent = `正在下载改动的代码文件…${pct || 0}%（下载前已备份旧文件）`;
  else if (status === 'done') $('#update-result').textContent = '更新完成：点「重启生效」后用新版本。';
  else if (status === 'failed') $('#update-result').textContent = `更新失败：${error || '未知原因'}（旧文件已保留）`;
});


/* ---------- 工具箱本地功能页 ---------- */
function fmtSize(n) {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ----- 智能体：对话 / 设置 / 长期记忆 / 定时触发 ----- */
function gotoAgentTab(name) {
  $$('#screen-agents .tab').forEach((b) => b.classList.toggle('active', b.dataset.agentTab === name));
  $$('#screen-agents .tabpane').forEach((p) => p.classList.toggle('active', p.id === `agent-tab-${name}`));
  if (name === 'memory') renderAgentMemory();
  if (name === 'triggers') { renderAgentTriggers(); renderEventTriggerStatus(); }
  if (name === 'chat') renderAgentChatList();
}
$$('#screen-agents .tab').forEach((b) => b.addEventListener('click', () => gotoAgentTab(b.dataset.agentTab)));
/* 服务商与空间的服务商表一致（地址与默认模型取空间表首选模型；
 * 空间表里没列模型的，模型留空、由用户填写，与豆包现有做法一致）。
 * 网页端站点不跟进：网页端发送只接通了 DeepSeek 与通义千问，
 * 豆包、Gemini 只有验证流程、发送未接通，其余站点不加选项。 */
const PROVIDERS = {
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  doubao: { base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  anthropic: { base: 'https://api.anthropic.com/v1', model: 'claude-fable-5-2' },
  kimi: { base: 'https://api.moonshot.cn/v1', model: 'kimi-k3.1-pro' },
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flashx' },
  xai: { base: 'https://api.x.ai/v1', model: '' },
  mistral: { base: 'https://api.mistral.ai/v1', model: '' },
  hunyuan: { base: 'https://api.hunyuan.cloud.tencent.com/v1', model: '' },
  wenxin: { base: 'https://qianfan.baidubce.com/v2', model: '' },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: '' },
  siliconflow: { base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  custom: { base: '', model: '' },
};
const WEB_SITE_NAMES = { deepseek: 'DeepSeek', doubao: '豆包', qwen: '通义千问', gemini: 'Gemini' };
const AGENT_WEB_STEPS = {
  deepseek: '取令牌：登录 DeepSeek 网页端后，在浏览器开发者工具的应用（Application）→ 本地存储里找到 userToken，复制粘贴到令牌框。',
  doubao: '取令牌：登录豆包网页端后，复制浏览器里整段 Cookie，粘贴到令牌框。',
  qwen: '取令牌：登录通义千问网页端后，复制包含 token、cookie 与 UA 的 JSON，粘贴到令牌框。',
  gemini: '取令牌：登录 Gemini 网页端后，复制 __Secure-1PSID 与 __Secure-1PSIDTS 两项 Cookie，粘贴到令牌框。',
};
function updateAgentWebFields() {
  const isWeb = $('#agent-conn-type').value === 'web';
  $('#agent-web-fields').classList.toggle('hidden', !isWeb);
  $('#agent-web-steps').textContent = isWeb ? (AGENT_WEB_STEPS[$('#agent-web-site').value] || '') : '';
}
$('#agent-conn-type').addEventListener('change', updateAgentWebFields);
$('#agent-web-site').addEventListener('change', updateAgentWebFields);
$('#agent-web-verify').addEventListener('click', async () => {
  if (!currentAgentId) { toast('先保存智能体'); return; }
  $('#agent-web-status').textContent = '验证中…';
  const r = await callTb('agentWebVerify', currentAgentId);
  if (!r || r.ok === false) { $('#agent-web-status').textContent = `验证失败：${(r && r.error) || '未知原因'}`; return; }
  $('#agent-web-status').textContent = r.login ? `已登录：${r.login}` : '验证通过';
  renderAgents();
});
let currentAgentId = null;
let currentChatId = null;
async function renderAgents() {
  const agents = await window.toolbox.agentsList().catch(() => []);
  const box = $('#agent-list');
  box.innerHTML = '';
  if (!agents.length) { box.className = 'list empty-note'; box.textContent = '还没有智能体，在下方添加。'; }
  else {
    box.className = 'list';
    for (const a of agents) {
      const row = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', a.name));
      const connLabel = a.connectionType === 'web'
        ? `网页端${a.webSite ? ` · ${WEB_SITE_NAMES[a.webSite] || a.webSite}` : ''}${a.webLogin ? ` · 已登录 ${a.webLogin}` : (a.hasWebToken ? ' · 已填令牌' : ' · 未填令牌')}`
        : `API${a.hasKey ? ' · 已填密钥' : ' · 未填密钥'}`;
      main.appendChild(el('div', 'row-sub', `${a.model || ''} · ${connLabel}`));
      row.appendChild(main);
      const btn = el('button', 'btn small', a.id === currentAgentId ? '使用中' : '使用');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        currentAgentId = a.id;
        fillAgentForm(a);
        renderAgents();
        const chats = await window.toolbox.agentChats();
        const last = chats.filter((c) => c.agentId === a.id)[0];
        if (last) openAgentChat(last.id);
        else newAgentChat();
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }
  if (!currentAgentId && agents.length) { currentAgentId = agents[0].id; fillAgentForm(agents[0]); }
  renderAgentChatList();
  fillAgentSelect($('#memory-agent'));
  fillAgentSelect($('#trigger-agent'));
  const cur = agents.find((a) => a.id === currentAgentId);
  if (cur) { $('#memory-agent').value = cur.id; $('#trigger-agent').value = cur.id; }
}
function fillAgentForm(a) {
  $('#agent-name').value = a.name || '';
  $('#agent-base').value = a.baseUrl || '';
  $('#agent-model').value = a.model || '';
  $('#agent-key').value = '';
  const sys = $('#agent-system');
  if (sys) sys.value = a.systemPrompt || '';
  const connType = a.connectionType || 'api';
  $('#agent-conn-type').value = connType;
  $('#agent-web-site').value = a.webSite || 'deepseek';
  $('#agent-web-token').value = '';
  $('#agent-web-status').textContent = connType === 'web'
    ? (a.webLogin ? `已登录：${a.webLogin}` : (a.hasWebToken ? '已填令牌，未验证' : '未填令牌'))
    : '';
  updateAgentWebFields();
  const prov = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].base && PROVIDERS[k].base === a.baseUrl) || 'custom';
  $('#agent-provider').value = prov;
}
$('#agent-provider').addEventListener('change', (e) => {
  const p = PROVIDERS[e.target.value] || PROVIDERS.custom;
  $('#agent-base').value = p.base;
  if (p.model) $('#agent-model').value = p.model;
});
$('#agent-save').addEventListener('click', async () => {
  const name = $('#agent-name').value.trim();
  const baseUrl = $('#agent-base').value.trim();
  const model = $('#agent-model').value.trim();
  const key = $('#agent-key').value.trim();
  if (!name) { toast('先填智能体名称'); return; }
  const agents = await window.toolbox.agentsList().catch(() => []);
  const cur = agents.find((a) => a.id === currentAgentId) || {};
  const r = await window.toolbox.agentSave({
    id: currentAgentId, name, baseUrl, apiKey: key || undefined, model,
    systemPrompt: $('#agent-system').value.trim(),
    connectionType: $('#agent-conn-type').value, webSite: $('#agent-web-site').value,
    webToken: $('#agent-web-token').value.trim() || undefined,
    memories: cur.memories || [], triggers: cur.triggers || [],
  });
  if (r && r.ok === false) { toast(r.error || '保存失败'); return; }
  if (r && r.agent) currentAgentId = r.agent.id;
  $('#agent-key').value = '';
  toast('智能体已保存');
  renderAgents();
});
$('#agent-new').addEventListener('click', () => {
  currentAgentId = null;
  $('#agent-name').value = ''; $('#agent-base').value = ''; $('#agent-model').value = '';
  $('#agent-key').value = ''; $('#agent-system').value = '';
  $('#agent-conn-type').value = 'api'; $('#agent-web-site').value = 'deepseek';
  $('#agent-web-token').value = ''; $('#agent-web-status').textContent = '';
  updateAgentWebFields();
  gotoAgentTab('settings');
  toast('填好后点「保存智能体」');
});
$('#agent-delete').addEventListener('click', async () => {
  if (!currentAgentId) return;
  await window.toolbox.agentDelete(currentAgentId);
  currentAgentId = null;
  currentChatId = null;
  $('#agent-name').value = ''; $('#agent-base').value = ''; $('#agent-model').value = ''; $('#agent-key').value = '';
  toast('智能体已删除');
  renderAgents();
  renderChat(null);
});
function renderChat(chat) {
  const box = $('#chat-msgs');
  box.innerHTML = '';
  if (!chat) { $('#chat-title').textContent = '新对话'; box.innerHTML = '<p class="empty-note">选一个智能体，点「新对话」开始聊。</p>'; return; }
  $('#chat-title').textContent = chat.title || '新对话';
  for (const m of chat.messages || []) {
    const d = el('div', `msg ${m.role === 'user' ? 'user' : 'ai'}`, m.content);
    box.appendChild(d);
    if (m.pendingAction && m.pendingAction.status === 'pending') {
      const bar = el('div', 'toolbar');
      const okBtn = el('button', 'btn primary small', '确认执行');
      okBtn.type = 'button';
      okBtn.addEventListener('click', async () => {
        okBtn.disabled = true; cancelBtn.disabled = true;
        const r = await window.toolbox.agentToolConfirm(m.pendingAction.id, true);
        if (r && r.chat) renderChat(r.chat);
        if (r && r.ok === false) toast(r.error || '执行失败');
        renderRecent();
      });
      const cancelBtn = el('button', 'btn small', '取消');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', async () => {
        okBtn.disabled = true; cancelBtn.disabled = true;
        const r = await window.toolbox.agentToolConfirm(m.pendingAction.id, false);
        if (r && r.chat) renderChat(r.chat);
        renderRecent();
      });
      bar.appendChild(okBtn);
      bar.appendChild(cancelBtn);
      box.appendChild(bar);
    }
  }
  box.scrollTop = box.scrollHeight;
}
async function renderAgentChatList() {
  const box = $('#agent-chat-list');
  if (!box) return;
  const chats = await window.toolbox.agentChats().catch(() => []);
  const list = chats.filter((c) => !currentAgentId || c.agentId === currentAgentId);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '暂无对话，点右上角「新对话」开始聊。'; return; }
  box.className = 'list';
  for (const c of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', c.title || '新对话'));
    main.appendChild(el('div', 'row-sub', fmtTime(c.updatedAt)));
    row.appendChild(main);
    const open = el('button', 'btn small', '打开');
    open.type = 'button';
    open.addEventListener('click', () => openAgentChat(c.id));
    row.appendChild(open);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      await window.toolbox.agentChatDelete(c.id);
      if (currentChatId === c.id) { currentChatId = null; renderChat(null); }
      renderAgentChatList(); renderRecent();
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
async function openAgentChat(chatId) {
  const chat = await window.toolbox.agentChatGet(chatId);
  if (!chat) return;
  currentChatId = chat.id;
  currentAgentId = chat.agentId;
  setMenuActive('agents');
  gotoScreen('agents');
  renderAgents();
  renderChat(chat);
}
async function newAgentChat() {
  const agents = await window.toolbox.agentsList().catch(() => []);
  setMenuActive('agents');
  gotoScreen('agents');
  renderAgents();
  gotoAgentTab('chat');
  if (!agents.length) { renderChat(null); toast('先添加一个智能体'); return; }
  if (!currentAgentId || !agents.some((a) => a.id === currentAgentId)) currentAgentId = agents[0].id;
  const chat = await window.toolbox.agentChatNew(currentAgentId);
  currentChatId = chat.id;
  renderChat(chat);
  renderRecent();
}
$('#agent-new-chat').addEventListener('click', () => newAgentChat());
async function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentChatId) { await newAgentChat(); if (!currentChatId) return; }
  input.value = '';
  const btn = $('#chat-send');
  btn.disabled = true;
  const r = await window.toolbox.agentChatSend(currentChatId, text);
  btn.disabled = false;
  if (r && r.chat) renderChat(r.chat);
  if (r && r.ok === false) toast(r.error || '发送失败');
  else if (r && r.pending) toast('这个操作要先确认：点聊天里的「确认执行」才跑');
  renderRecent();
}
$('#chat-send').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

/* ----- 长期记忆（只存本机，与空间不互通） ----- */
async function currentAgentObj() {
  const agents = await window.toolbox.agentsList().catch(() => []);
  return agents.find((a) => a.id === ($('#memory-agent').value || currentAgentId)) || null;
}
async function renderAgentMemory() {
  const agent = await currentAgentObj();
  const box = $('#agent-memory-list');
  box.innerHTML = '';
  const memories = (agent && agent.memories) || [];
  if (!agent) { box.className = 'list empty-note'; box.textContent = '先在智能体页添加智能体。'; return; }
  if (!memories.length) { box.className = 'list empty-note'; box.textContent = '还没有长期记忆。'; return; }
  box.className = 'list';
  for (const m of memories) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', m.text));
    main.appendChild(el('div', 'row-sub', fmtTime(m.at)));
    row.appendChild(main);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      const ag = await currentAgentObj();
      if (!ag) return;
      await window.toolbox.agentSave({ ...ag, apiKey: undefined, memories: (ag.memories || []).filter((x) => x.id !== m.id) });
      renderAgentMemory();
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#memory-agent').addEventListener('change', renderAgentMemory);
$('#memory-add').addEventListener('click', async () => {
  const text = $('#memory-input').value.trim();
  if (!text) { toast('先写一条记忆'); return; }
  const ag = await currentAgentObj();
  if (!ag) { toast('先在智能体页添加智能体'); return; }
  const memories = [...(ag.memories || []), { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now() }];
  await window.toolbox.agentSave({ ...ag, apiKey: undefined, memories });
  $('#memory-input').value = '';
  toast('已记下来');
  renderAgentMemory();
});

/* ----- 定时触发（时间触发真实可用，事件触发暂不可用） ----- */
async function renderAgentTriggers() {
  const agents = await window.toolbox.agentsList().catch(() => []);
  const agentId = $('#trigger-agent').value || currentAgentId;
  const agent = agents.find((a) => a.id === agentId);
  const box = $('#agent-trigger-list');
  box.innerHTML = '';
  const triggers = (agent && agent.triggers) || [];
  if (!agent) { box.className = 'list empty-note'; box.textContent = '先在智能体页添加智能体。'; return; }
  if (!triggers.length) { box.className = 'list empty-note'; box.textContent = '还没有触发器。'; return; }
  box.className = 'list';
  for (const t of triggers) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    const kindLabel = t.kind === 'file' ? `文件变化 · ${t.path || ''}` : `每天 ${t.time || ''}`;
    main.appendChild(el('div', 'row-title', `${t.name || '触发器'} · ${kindLabel}`));
    main.appendChild(el('div', 'row-sub', `${t.enabled === false ? '已停用 · ' : ''}${(t.prompt || '').slice(0, 40)}${t.lastRun ? ` · 上次执行 ${t.lastRun}` : ''}`));
    row.appendChild(main);
    const run = el('button', 'btn small', '立即执行');
    run.type = 'button';
    run.addEventListener('click', async () => {
      const r = await window.toolbox.agentTriggerRun(agent.id, t.id);
      if (r && r.ok === false) toast(r.error || '执行失败');
      else { toast('已执行，新对话已建好'); renderRecent(); }
      renderAgentTriggers();
    });
    row.appendChild(run);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await window.toolbox.agentTriggerDelete(agent.id, t.id); renderAgentTriggers(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
async function renderEventTriggerStatus() {
  const box = $('#event-trigger-status');
  if (!box) return;
  const list = await window.toolbox.eventTriggerStatus().catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '还没有文件触发器。'; return; }
  box.className = 'list';
  for (const t of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${t.name || '文件触发'} · ${t.agentName || ''}`));
    main.appendChild(el('div', 'row-sub', `${t.path} · ${t.exists ? (t.watching ? '正在监听' : '未监听（路径可能被删或未启动）') : '路径不存在'}${t.lastEvent ? ` · 上次触发 ${t.lastEvent}` : ''}`));
    row.appendChild(main);
    box.appendChild(row);
  }
}
$('#trigger-agent').addEventListener('change', () => { renderAgentTriggers(); renderEventTriggerStatus(); });
$('#trigger-kind').addEventListener('change', (e) => {
  const isFile = e.target.value === 'file';
  $('#trigger-time-field').classList.toggle('hidden', isFile);
  $('#trigger-path-field').classList.toggle('hidden', !isFile);
});
$('#trigger-save').addEventListener('click', async () => {
  const agentId = $('#trigger-agent').value;
  const name = $('#trigger-name').value.trim();
  const kind = $('#trigger-kind').value || 'time';
  const time = $('#trigger-time').value;
  const pathVal = $('#trigger-path').value.trim();
  const prompt = $('#trigger-prompt').value.trim();
  if (!agentId) { toast('先在智能体页添加智能体'); return; }
  if (!prompt) { toast('指令要填'); return; }
  if (kind === 'time' && !time) { toast('时间要填'); return; }
  if (kind === 'file' && !pathVal) { toast('监听路径要填'); return; }
  const r = await window.toolbox.agentTriggerSave(agentId, { name: name || (kind === 'file' ? '文件触发' : '定时触发'), kind, time: kind === 'time' ? time : '', path: kind === 'file' ? pathVal : '', prompt, enabled: true });
  if (r && r.ok === false) { toast(r.error || '保存失败'); return; }
  $('#trigger-name').value = ''; $('#trigger-prompt').value = '';
  toast('触发器已保存');
  renderAgentTriggers();
});

/* ----- 创作 ----- */
const CREATE_TASKS = {
  polish: '你是一个文字编辑。润色以下文字，保持原意，只输出润色后的文字。',
  expand: '你是一个写作助手。扩写以下文字，内容更丰富，只输出扩写后的文字。',
  shorten: '你是一个文字编辑。缩写以下文字，保留要点，只输出缩写后的文字。',
  outline: '你是一个写作助手。为以下内容生成一份结构清晰的大纲，只输出大纲。',
  translate: '把以下文字翻译成英文，只输出译文。',
  write: '你是一个写作助手。按要求写一篇完整文字，只输出正文。',
};
function createSystemPrefix() {
  const type = $('#create-type').value;
  const style = $('#create-style').value;
  const len = $('#create-length').value;
  return `类型：${type}；风格：${style}；字数：${len}。`;
}
async function fillAgentSelect(sel) {
  const agents = await window.toolbox.agentsList().catch(() => []);
  sel.innerHTML = '';
  for (const a of agents) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${a.name}${a.hasKey ? '' : '（未填密钥）'}`;
    sel.appendChild(o);
  }
  if (!agents.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '先在智能体页添加智能体';
    sel.appendChild(o);
  }
}
let promptTemplates = [];
async function loadPrompts() {
  const sel = $('#create-prompt');
  const box = $('#prompts-list');
  const r = await callTb('promptsList');
  promptTemplates = Array.isArray(r) ? r : [];
  const cur = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '不用模板';
  sel.appendChild(none);
  for (const pp of promptTemplates) {
    const o = document.createElement('option');
    o.value = pp.id;
    o.textContent = pp.name;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  if (!box) return;
  box.innerHTML = '';
  if (!promptTemplates.length) { box.className = 'list empty-note'; box.textContent = '暂无模板。'; return; }
  box.className = 'list';
  for (const pp of promptTemplates) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', pp.name));
    main.appendChild(el('div', 'row-sub', (pp.text || '').slice(0, 80)));
    row.appendChild(main);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await callTb('promptDelete', pp.id); loadPrompts(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#prompt-manage').addEventListener('click', () => {
  $('#prompt-panel').classList.toggle('hidden');
  loadPrompts();
});
$('#prompt-save').addEventListener('click', async () => {
  const name = $('#prompt-name').value.trim();
  const text = $('#prompt-text').value.trim();
  if (!name || !text) { toast('模板名称与内容都要填'); return; }
  const r = await callTb('promptSave', { name, text });
  if (!r || r.ok === false) { toast((r && r.error) || '保存失败'); return; }
  $('#prompt-name').value = ''; $('#prompt-text').value = '';
  toast('模板已保存');
  loadPrompts();
});
async function renderCreate() {
  await fillAgentSelect($('#create-agent'));
  loadPrompts();
  const q = ($('#create-search').value || '').trim();
  const list = (await window.toolbox.creationList().catch(() => []))
    .filter((x) => !q || `${x.task || ''}${x.input || ''}${x.output || ''}`.includes(q));
  const box = $('#create-history');
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = q ? '没有符合的创作记录。' : '暂无创作记录。'; return; }
  box.className = 'list';
  for (const item of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${item.task} · ${fmtTime(item.at)}`));
    main.appendChild(el('div', 'row-sub', (item.input || '').slice(0, 40)));
    row.appendChild(main);
    const look = el('button', 'btn small', '查看');
    look.type = 'button';
    look.addEventListener('click', () => { $('#create-input').value = item.input || ''; $('#create-result').value = item.output || ''; });
    row.appendChild(look);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await window.toolbox.creationDelete(item.id); renderCreate(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$$('#create-tasks .btn').forEach((b) => b.addEventListener('click', async () => {
  const agentId = $('#create-agent').value;
  const input = $('#create-input').value.trim();
  if (!agentId) { toast('先在智能体页添加智能体'); return; }
  if (!input) { toast('先粘贴要处理的文字'); return; }
  b.disabled = true;
  const tpl = promptTemplates.find((pp) => pp.id === $('#create-prompt').value);
  const system = `${tpl ? `${tpl.text}\n` : ''}${createSystemPrefix()}\n${CREATE_TASKS[b.dataset.task]}`;
  const r = await window.toolbox.agentComplete(agentId, system, input);
  b.disabled = false;
  if (!r || r.ok === false) { toast((r && r.error) || '处理失败'); return; }
  $('#create-result').value = r.text || '';
  await window.toolbox.creationSave({ task: b.textContent, input, output: r.text || '' });
  renderCreate();
}));
$('#create-search').addEventListener('input', renderCreate);
$('#create-draft-save').addEventListener('click', async () => {
  const input = $('#create-input').value.trim();
  const output = $('#create-result').value.trim();
  if (!input && !output) { toast('先写点内容再保存草稿'); return; }
  await window.toolbox.creationSave({ task: '草稿', input, output });
  toast('草稿已保存');
  renderCreate();
});
$('#create-copy').addEventListener('click', async () => {
  const v = $('#create-result').value;
  if (!v) return;
  await window.toolbox.copyText(v);
  toast('已复制');
});

/* ----- 代码 ----- */
let codeAllSnippets = [];
async function renderCode() {
  await fillAgentSelect($('#code-agent'));
  renderCodeInterpreters();
  codeAllSnippets = await window.toolbox.snippetsList().catch(() => []);
  const langs = [...new Set(codeAllSnippets.map((x) => x.lang || '').filter(Boolean))];
  const filter = $('#snippet-filter');
  const cur = filter.value;
  filter.innerHTML = '<option value="">全部语言</option>';
  for (const l of langs) {
    const o = document.createElement('option');
    o.value = l; o.textContent = l;
    filter.appendChild(o);
  }
  if ([...filter.options].some((o) => o.value === cur)) filter.value = cur;
  const q = ($('#snippet-search').value || '').trim().toLowerCase();
  const lang = filter.value;
  const list = codeAllSnippets.filter((x) =>
    (!lang || (x.lang || '') === lang) &&
    (!q || `${x.title || ''}${x.code || ''}`.toLowerCase().includes(q)));
  const box = $('#snippet-list');
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = q || lang ? '没有符合的代码片段。' : '暂无代码片段。'; return; }
  box.className = 'list';
  for (const item of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', item.title || '未命名'));
    main.appendChild(el('div', 'row-sub', `${item.lang || ''} · ${fmtTime(item.at)}`));
    row.appendChild(main);
    const load = el('button', 'btn small', '打开');
    load.type = 'button';
    load.addEventListener('click', () => {
      $('#snippet-title').value = item.title || '';
      $('#snippet-lang').value = item.lang || '';
      $('#snippet-code').value = item.code || '';
      $('#snippet-save').dataset.id = item.id;
    });
    row.appendChild(load);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await window.toolbox.snippetDelete(item.id); renderCode(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#snippet-search').addEventListener('input', renderCode);
$('#snippet-filter').addEventListener('change', renderCode);
$('#snippet-export').addEventListener('click', async () => {
  if (!codeAllSnippets.length) { toast('没有可导出的片段'); return; }
  const text = codeAllSnippets.map((x) => `### ${x.title || '未命名'}（${x.lang || ''}）\n${x.code || ''}`).join('\n\n');
  await window.toolbox.copyText(text);
  toast('全部片段已复制，可粘贴保存');
});
$('#snippet-new').addEventListener('click', () => {
  delete $('#snippet-save').dataset.id;
  $('#snippet-title').value = '';
  $('#snippet-lang').value = '';
  $('#snippet-code').value = '';
  $('#snippet-title').focus();
  toast('新建文件：填好标题与代码后点「保存片段」');
});
$('#snippet-save').addEventListener('click', async () => {
  const title = $('#snippet-title').value.trim();
  const code = $('#snippet-code').value;
  if (!title || !code) { toast('标题与代码都要填'); return; }
  const r = await window.toolbox.snippetSave({ id: $('#snippet-save').dataset.id || undefined, title, lang: $('#snippet-lang').value.trim(), code });
  if (r && r.ok === false) { toast(r.error || '保存失败'); return; }
  delete $('#snippet-save').dataset.id;
  toast('片段已保存');
  renderCode();
});
$('#code-run').addEventListener('click', async () => {
  const code = $('#snippet-code').value;
  const lang = $('#snippet-lang').value.trim() || 'Python';
  if (!code.trim()) { toast('先粘贴代码'); return; }
  const btn = $('#code-run');
  btn.disabled = true;
  $('#code-output').value = '运行中…';
  const r = await window.toolbox.codeRun({ language: lang, code }).catch((e) => ({ ok: false, error: e.message || String(e) }));
  btn.disabled = false;
  if (!r) { $('#code-output').value = '运行失败：无返回'; return; }
  const head = r.ok ? `已运行（${r.interpreter || ''}，退出码 ${r.exitCode}）` : `运行失败：${r.error || `退出码 ${r.exitCode}`}`;
  $('#code-output').value = `${head}\n${r.stdout || ''}${r.stderr ? `\n[标准错误]\n${r.stderr}` : ''}`;
  if (!r.ok) toast(r.error || '运行失败');
});
async function renderCodeInterpreters() {
  const box = $('#code-interpreters');
  if (!box) return;
  const list = await window.toolbox.codeInterpreters().catch(() => []);
  if (!list.length) { box.textContent = '检测解释器失败。'; return; }
  box.textContent = '本机解释器：' + list.map((x) => `${x.key}${x.found ? ` ${x.version || '已安装'}` : ' 未安装'}`).join('；') + '。未安装的可在设置「自检与安装」里一键安装。';
}
$('#code-ask').addEventListener('click', async () => {
  const agentId = $('#code-agent').value;
  const code = $('#snippet-code').value.trim();
  if (!agentId) { toast('先在智能体页添加智能体'); return; }
  if (!code) { toast('先粘贴代码'); return; }
  const btn = $('#code-ask');
  btn.disabled = true;
  const r = await window.toolbox.agentComplete(agentId, '你是一个编程助手。解释以下代码，并指出可能的问题，只输出解释。', code);
  btn.disabled = false;
  if (!r || r.ok === false) { toast((r && r.error) || '处理失败'); return; }
  $('#code-result').value = r.text || '';
});

/* ----- 图像 ----- */
async function renderImages() {
  const ov = await window.toolbox.getOverview().catch(() => null);
  if (ov) {
    $('#image-base').value = ov.config.imageBaseUrl || 'https://api.openai.com/v1';
    $('#image-model').value = ov.config.imageModel || 'gpt-image-1';
  }
  const r = await window.toolbox.imagesList().catch(() => ({ ok: false, files: [] }));
  const box = $('#image-gallery');
  box.innerHTML = '';
  if (!r || r.ok === false || !r.files.length) {
    box.innerHTML = '<p class="empty-note">暂无生成的图片。</p>';
    return;
  }
  for (const f of r.files) {
    const wrap = el('div', 'img-item');
    const img = document.createElement('img');
    img.src = `file:///${f.replace(/\\/g, '/')}`;
    img.alt = f.split(/[\\/]/).pop();
    img.title = f;
    img.addEventListener('click', () => selectImageForEdit(f, wrap));
    wrap.appendChild(img);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rr = await window.toolbox.filesTrashPath(f);
      if (rr && rr.ok === false) toast(rr.error || '删除失败');
      else renderImages();
    });
    wrap.appendChild(del);
    box.appendChild(wrap);
  }
}
$('#image-save').addEventListener('click', async () => {
  const patch = { imageBaseUrl: $('#image-base').value.trim(), imageModel: $('#image-model').value.trim() };
  const key = $('#image-key').value.trim();
  if (key) patch.imageApiKey = key;
  await window.toolbox.setConfig(patch);
  $('#image-key').value = '';
  toast('图片设置已保存');
});
let selectedImageFile = null;
function selectImageForEdit(f, wrap) {
  selectedImageFile = f;
  document.querySelectorAll('#image-gallery .img-item').forEach((x) => x.classList.remove('selected'));
  if (wrap) wrap.classList.add('selected');
  $('#image-edit-panel').classList.remove('hidden');
  $('#image-edit-target').textContent = `选中：${f}`;
  fillAgentSelect($('#image-edit-agent'));
}
$('#image-upload').addEventListener('click', async () => {
  const r = await callTb('imageUpload');
  if (!r || r.ok === false) { toast((r && r.error) || '上传失败'); return; }
  toast('图片已上传');
  renderImages();
});
$('#image-edit').addEventListener('click', async () => {
  const prompt = $('#image-edit-prompt').value.trim();
  const agentId = $('#image-edit-agent').value;
  if (!selectedImageFile) { toast('先在图库点一张图'); return; }
  if (!prompt) { toast('先写改图提示词'); return; }
  if (!agentId) { toast('先在智能体页添加智能体'); return; }
  const btn = $('#image-edit');
  btn.disabled = true; btn.textContent = '改图中…';
  const r = await callTb('imageEdit', { file: selectedImageFile, prompt, agentId });
  btn.disabled = false; btn.textContent = '改图';
  if (!r || r.ok === false) { toast((r && r.error) || '改图失败'); return; }
  toast('改图完成，已进图库');
  renderImages();
});
$('#image-edit-open').addEventListener('click', () => {
  if (selectedImageFile) window.toolbox.filesOpenPath(selectedImageFile);
});
$('#image-generate').addEventListener('click', async () => {
  const style = $('#image-style').value;
  const prompt = `${style ? `风格：${style}。` : ''}${$('#image-prompt').value.trim()}`;
  if (!$('#image-prompt').value.trim()) { toast('先写画面描述'); return; }
  const btn = $('#image-generate');
  btn.disabled = true;
  btn.textContent = '生成中…';
  const r = await window.toolbox.imageGenerate(prompt, $('#image-size').value);
  btn.disabled = false;
  btn.textContent = '生成图片';
  if (!r || r.ok === false) { toast((r && r.error) || '生成失败'); return; }
  toast('图片已保存到本机');
  renderImages();
});

/* ----- 监控 ----- */
let monitorTimer = null;
function paintRows(box, rows) {
  box.innerHTML = '';
  box.className = 'list';
  for (const [k, v] of rows) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', k));
    main.appendChild(el('div', 'row-sub', v));
    row.appendChild(main);
    box.appendChild(row);
  }
}
async function paintMonitor() {
  const r = await window.toolbox.monitorStatus().catch(() => null);
  const box = $('#monitor-stats');
  if (!r) { box.innerHTML = '<p class="empty-note">读取失败。</p>'; return; }
  const memPct = r.memTotal ? Math.round((r.memUsed / r.memTotal) * 100) : 0;
  $('#monitor-mem-bar').style.width = `${memPct}%`;
  $('#monitor-mem-text').textContent = `${fmtSize(r.memUsed)} / ${fmtSize(r.memTotal)}（${memPct}%）`;
  $('#monitor-load-text').textContent = Array.isArray(r.loadavg) ? r.loadavg.map((v) => v.toFixed(2)).join(' / ') : '—';
  paintRows(box, [
    ['系统', `${r.platform} ${r.arch} · ${r.hostname}`],
    ['CPU', `${r.cpuModel} · ${r.cpuCores} 核`],
    ['运行时间', `${Math.floor(r.uptimeSec / 3600)} 小时 ${Math.floor((r.uptimeSec % 3600) / 60)} 分钟`],
  ]);
  paintRows($('#monitor-usage'), [
    ['智能体', `${r.agents} 个 · 对话 ${r.chats} 条 · 消息 ${r.messages || 0} 条`],
    ['创作 / 代码 / 图片', `${r.creations || 0} 条创作 · ${r.snippets || 0} 个片段 · ${r.images || 0} 张图片`],
    ['接码记录', `${r.registerCount || 0} 条接码记录`],
    ['本地数据量', fmtSize(r.dataSize || 0)],
  ]);
  const ov = await window.toolbox.getOverview().catch(() => null);
  const modeName = { direct: '直连', smart: '智能', global: '全局', manual: '手动 HTTP 代理', tun: 'Tun' };
  paintRows($('#monitor-proxy'), [
    ['代理模式', ov ? (modeName[ov.config.proxyMode] || ov.config.proxyMode || '直连') : '—'],
    ['空间调用', ov ? (ov.spaceCallEnabled !== false ? '已打开' : '已关闭') : '—'],
  ]);
}
async function renderMonitors() {
  const box = $('#monitors-list');
  if (!box) return;
  const r = await callTb('monitorsList');
  const list = Array.isArray(r) ? r : [];
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '暂无监控提醒。'; return; }
  box.className = 'list';
  const kindName = { webpage: '网页变化', 'app-version': '软件版本' };
  for (const m of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', m.name || m.target));
    main.appendChild(el('div', 'row-sub', `${kindName[m.kind] || m.kind} · ${m.target} · 每 ${m.intervalMin || 60} 分钟${m.lastCheck ? ` · 上次检查 ${fmtTime(m.lastCheck)}` : ''}${m.lastResult ? ` · ${m.lastResult}` : ''}${m.lastChange ? ' · 有变化' : ''}`));
    row.appendChild(main);
    const run = el('button', 'btn small', '立即检查');
    run.type = 'button';
    run.addEventListener('click', async () => {
      const rr = await callTb('monitorRun', m.id);
      if (!rr || rr.ok === false) toast((rr && rr.error) || '检查失败');
      else toast(rr.result || '检查完成');
      renderMonitors();
    });
    row.appendChild(run);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await callTb('monitorDelete', m.id); renderMonitors(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#monitor-save').addEventListener('click', async () => {
  const target = $('#monitor-target').value.trim();
  const intervalMin = Math.max(5, Number($('#monitor-interval').value) || 60);
  if (!target) { toast('先填监控目标'); return; }
  const r = await callTb('monitorSave', { kind: $('#monitor-kind').value, name: target, target, intervalMin, enabled: true });
  if (!r || r.ok === false) { toast((r && r.error) || '保存失败'); return; }
  $('#monitor-target').value = '';
  toast('监控提醒已保存');
  renderMonitors();
});
async function renderMonitor() {
  await paintMonitor();
  renderMonitors();
  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    if (document.querySelector('#screen-monitor.active')) paintMonitor();
    else { clearInterval(monitorTimer); monitorTimer = null; }
  }, 5000);
}
$('#monitor-refresh').addEventListener('click', paintMonitor);

/* ----- 注册：与空间里对应的接码界面结构，记录只存本机 -----
 * 工具箱未接入接码平台：提取号码、自动刷新暂不可用，界面照样做
 * 出来并如实标明；号码与验证码手动添加。 */
let regCharge = '免费';
let regKind = 'sms';
function gotoRegTab(kind) {
  regKind = kind;
  $$('#screen-register .tab').forEach((b) => b.classList.toggle('active', b.dataset.regTab === kind));
  $$('#screen-register .tabpane').forEach((p) => p.classList.toggle('active', p.id === `reg-tab-${kind}`));
  renderRegister();
}
$$('#screen-register .tab').forEach((b) => b.addEventListener('click', () => gotoRegTab(b.dataset.regTab)));
$$('#reg-charge-seg .seg-btn').forEach((b) => b.addEventListener('click', () => {
  regCharge = b.dataset.charge;
  $$('#reg-charge-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  renderRegisterPlatforms();
}));
let regAutoTimer = null;
async function regMailtmFetchOnce() {
  const r = await window.toolbox.registerMailtmFetch().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { toast((r && r.error) || '拉取失败'); return r; }
  const acc = $('#reg-mailtm-account');
  if (acc) acc.textContent = `临时邮箱：${r.account}（Mail.tm）· 本次拉取 ${r.fetched} 封，新收验证码 ${r.added} 条`;
  renderRegister();
  return r;
}
$('#reg-extract').addEventListener('click', async () => {
  if (regKind === 'email') {
    toast('正在建临时邮箱并拉取邮件…');
    const r = await regMailtmFetchOnce();
    if (r && r.ok) toast(`已拉取：新收验证码 ${r.added} 条`);
    return;
  }
  toast('短信自动提取暂不可用：没有公开可用的免费短信接口，请手动添加记录；邮箱可用 Mail.tm 自动收码（切到邮箱页签）');
});
$('#reg-auto').addEventListener('change', (e) => {
  if (regAutoTimer) { clearInterval(regAutoTimer); regAutoTimer = null; }
  if (!e.target.checked) return;
  if (regKind !== 'email') {
    e.target.checked = false;
    toast('自动刷新只对邮箱生效（Mail.tm）：短信没有公开接口可自动刷新');
    return;
  }
  regAutoTimer = setInterval(() => { if (document.querySelector('#screen-register.active')) regMailtmFetchOnce(); }, 10000);
  toast('自动刷新已开：每 10 秒拉取一次邮箱新邮件');
  regMailtmFetchOnce();
});
$('#reg-add-open').addEventListener('click', () => {
  const card = document.querySelector('#screen-register .card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('#reg-target').focus();
});
$('#reg-history-toggle').addEventListener('click', () => {
  const h = $('#reg-history');
  h.classList.toggle('hidden');
  renderRegisterHistory();
});
async function renderRegisterPlatforms() {
  const platforms = await window.toolbox.registerPlatformsList().catch(() => []);
  const shown = platforms.filter((p) => !regCharge || (p.charge || '免费') === regCharge);
  const sel = $('#reg-platform-select');
  const cur = sel.value;
  sel.innerHTML = '<option value="">选择平台</option>';
  for (const p of platforms) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = `${p.name}${p.charge ? `（${p.charge}）` : ''}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  const renderInto = (box, kind) => {
    box.innerHTML = '';
    const list = shown.filter((p) => (p.kind || 'sms') === kind);
    if (!list.length) { box.className = 'app-list empty-note'; box.textContent = kind === 'sms' ? '还没有短信平台，点下方添加。' : '还没有邮箱平台，点短信页下方添加（类型选邮箱）。'; return; }
    box.className = 'app-list';
    for (const p of list) {
      const card = el('div', 'app-card');
      card.appendChild(el('span', 'icon-tile gray', kind === 'sms' ? '✉' : '@'));
      card.appendChild(el('h3', '', p.name));
      card.appendChild(el('p', '', `${p.charge || '免费'}${p.url ? ` · ${p.url}` : ''}${p.loginRequired ? ' · 需登录' : ''}`));
      const bar = el('div', 'toolbar');
      if (p.loginRequired && p.url) {
        const login = el('button', 'btn small', '登录');
        login.type = 'button';
        login.addEventListener('click', () => window.toolbox.openExternal(p.url));
        bar.appendChild(login);
      }
      const use = el('button', 'btn small primary', '用此平台接码');
      use.type = 'button';
      use.addEventListener('click', () => {
        sel.value = p.id;
        $('#reg-kind').value = kind === 'sms' ? '短信' : '邮箱';
        $('#reg-target').focus();
        toast(`已选平台：${p.name}（号码需手动添加）`);
      });
      bar.appendChild(use);
      const del = el('button', 'btn small danger', '删除');
      del.type = 'button';
      del.addEventListener('click', async () => { await window.toolbox.registerPlatformDelete(p.id); renderRegisterPlatforms(); });
      bar.appendChild(del);
      card.appendChild(bar);
      box.appendChild(card);
    }
  };
  renderInto($('#reg-platforms'), 'sms');
  renderInto($('#reg-platforms-email'), 'email');
}
$('#reg-platform-add').addEventListener('click', async () => {
  const name = $('#reg-platform-name').value.trim();
  const url = $('#reg-platform-url').value.trim();
  if (!name) { toast('先填平台名称'); return; }
  const r = await window.toolbox.registerPlatformAdd({
    name, url, charge: $('#reg-platform-charge').value,
    loginRequired: $('#reg-platform-login').checked, kind: 'sms',
  });
  if (!r || r.ok === false) { toast((r && r.error) || '添加失败'); return; }
  $('#reg-platform-name').value = ''; $('#reg-platform-url').value = '';
  toast('平台已添加');
  renderRegisterPlatforms();
});
function regRow(x, withRefresh) {
  const row = el('div', 'row');
  const main = el('div', 'row-main');
  main.appendChild(el('div', 'row-title', `${x.kind} · ${x.target}`));
  main.appendChild(el('div', 'row-sub', `${x.code ? `验证码 ${x.code} · ` : ''}${fmtTime(x.at)}${x.note ? ` · ${x.note}` : ''}`));
  row.appendChild(main);
  if (withRefresh) {
    const rf = el('button', 'btn small', '刷新');
    rf.type = 'button';
    rf.addEventListener('click', async () => {
      if (x.kind === '邮箱') { await regMailtmFetchOnce(); return; }
      renderRegister(); toast('短信没有公开接口可拉取，手动添加记录');
    });
    row.appendChild(rf);
  }
  if (x.code) {
    const cp = el('button', 'btn small', '复制验证码');
    cp.type = 'button';
    cp.addEventListener('click', async () => { await window.toolbox.copyText(x.code); toast('已复制'); });
    row.appendChild(cp);
  }
  const cp2 = el('button', 'btn small', '复制号码');
  cp2.type = 'button';
  cp2.addEventListener('click', async () => { await window.toolbox.copyText(x.target); toast('已复制'); });
  row.appendChild(cp2);
  const del = el('button', 'btn small danger', '删除');
  del.type = 'button';
  del.addEventListener('click', async () => { await window.toolbox.registerDelete(x.id); renderRegister(); });
  row.appendChild(del);
  return row;
}
async function renderRegister() {
  await renderRegisterPlatforms();
  const list = await window.toolbox.registerList().catch(() => []);
  const sms = list.filter((x) => x.kind !== '邮箱');
  const email = list.filter((x) => x.kind === '邮箱');
  const fill = (box, items) => {
    box.innerHTML = '';
    if (!items.length) { box.className = 'list empty-note'; box.textContent = '暂无记录。'; return; }
    box.className = 'list';
    for (const x of items) box.appendChild(regRow(x, true));
  };
  fill($('#reg-list'), sms);
  fill($('#reg-list-email'), email);
  if (!$('#reg-history').classList.contains('hidden')) renderRegisterHistory();
}
async function renderRegisterHistory() {
  const list = await window.toolbox.registerList().catch(() => []);
  const box = $('#reg-history-list');
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '暂无历史记录。'; return; }
  box.className = 'list';
  for (const x of list) box.appendChild(regRow(x, false));
}
$('#reg-add').addEventListener('click', async () => {
  const r = await window.toolbox.registerAdd({
    kind: $('#reg-kind').value, target: $('#reg-target').value.trim(),
    code: $('#reg-code').value.trim(), note: $('#reg-note').value.trim(),
  });
  if (!r || r.ok === false) { toast((r && r.error) || '添加失败'); return; }
  if (r.dup) toast('该号码已在记录里，仍已添加');
  else toast('已添加');
  $('#reg-target').value = ''; $('#reg-code').value = ''; $('#reg-note').value = '';
  renderRegister();
});
async function regClearAll() {
  if (!await customConfirm('清空记录', '确定清空全部记录？', '清空')) return;
  await window.toolbox.registerClear();
  renderRegister();
}
$('#reg-clear').addEventListener('click', regClearAll);
$('#reg-clear-sms').addEventListener('click', regClearAll);
$('#reg-clear-email').addEventListener('click', regClearAll);

/* ----- 远程：本机信息、配对码、远程会话与设置 ----- */
async function renderRemote() {
  renderRemoteServer();
  const r = await window.toolbox.remoteInfo().catch(() => null);
  if (!r) return;
  $('#remote-host').textContent = r.hostname || '—';
  $('#remote-ips').textContent = (r.ips && r.ips.length ? r.ips.join('、') : '未获取到局域网 IP');
  $('#remote-code').textContent = r.pairCode || '—';
  const ov = await window.toolbox.getOverview().catch(() => null);
  $('#remote-allow').checked = !ov || ov.config.remoteEnabled !== false;
  $('#remote-status').textContent = $('#remote-allow').checked ? '等待空间小助手连接' : '已关闭，不接受小助手连接';
}
$('#remote-copy').addEventListener('click', async () => {
  const v = $('#remote-code').textContent;
  if (!v || v === '—') return;
  await window.toolbox.copyText(v);
  toast('配对码已复制');
});
$('#remote-regen').addEventListener('click', async () => {
  const r = await window.toolbox.remoteRegenCode();
  if (r && r.pairCode) { $('#remote-code').textContent = r.pairCode; toast('配对码已换新，旧码失效'); }
});
async function renderRemoteServer() {
  const st = await window.toolbox.remoteServerStatus().catch(() => null);
  if (!st) return;
  $('#remote-server-status').textContent = st.running ? `运行中：${st.url}` : '未启动';
  $('#remote-server-url').textContent = st.running ? `局域网地址：${(st.lanUrls || []).join('、') || '无'}（输入配对码查看）` : '';
  const sessions = $('#remote-sessions');
  if (sessions && st.running) { sessions.className = 'list'; sessions.textContent = `远程画面服务运行中：${st.url}（配对码 ${st.pairCode}）。只能看画面，不能操作。`; }
}
$('#remote-start').addEventListener('click', async () => {
  const r = await window.toolbox.remoteStart().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { toast((r && r.error) || '启动失败'); return; }
  toast(`远程画面已启动：${r.url}`);
  renderRemoteServer();
});
$('#remote-stop').addEventListener('click', async () => {
  await window.toolbox.remoteStop().catch(() => {});
  toast('远程画面已停止');
  renderRemoteServer();
});
$('#remote-allow').addEventListener('change', async (e) => {
  await window.toolbox.setConfig({ remoteEnabled: e.target.checked });
  renderRemote();
  toast(e.target.checked ? '已允许小助手连接' : '已关闭小助手连接');
});

/* ----- 文件：搜索 / 排序 / 新建文件夹 ----- */
let filesCurrentDir = '';
let filesEntries = [];
async function renderFiles(dir) {
  const r = await window.toolbox.filesListDir(dir || undefined).catch(() => ({ ok: false, error: '读取失败' }));
  const box = $('#files-list');
  if (!r || r.ok === false) { box.innerHTML = '<p class="empty-note">读取失败。</p>'; return; }
  filesCurrentDir = r.dir;
  filesEntries = r.entries || [];
  $('#files-dir').textContent = r.dir;
  $('#files-up').disabled = !r.parent || r.parent === r.dir;
  paintFiles();
}
let filesCat = 'all';
const FILES_CAT_EXTS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.heic'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv'],
  audio: ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac'],
  doc: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.rtf'],
};
function fileCatOf(name) {
  const lower = (name || '').toLowerCase();
  for (const [cat, exts] of Object.entries(FILES_CAT_EXTS)) {
    if (exts.some((ext) => lower.endsWith(ext))) return cat;
  }
  return 'other';
}
$$('#files-cat-tabs .tab').forEach((b) => b.addEventListener('click', () => {
  filesCat = b.dataset.filesCat;
  $$('#files-cat-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
  paintFiles();
}));
function paintFiles() {
  const box = $('#files-list');
  const q = ($('#files-search').value || '').trim().toLowerCase();
  const sort = $('#files-sort').value;
  let entries = filesEntries.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (e.isDir || filesCat === 'all' || fileCatOf(e.name) === filesCat));
  if (sort === 'size') entries = [...entries].sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (sort === 'time') entries = [...entries].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  else entries = [...entries].sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh'));
  box.innerHTML = '';
  box.className = 'list';
  if (!entries.length) { box.className = 'list empty-note'; box.textContent = q ? '没有符合的文件。' : '空文件夹。'; return; }
  for (const e of entries) {
    const sep = filesCurrentDir.includes('\\') ? '\\' : '/';
    const full = filesCurrentDir.replace(/[\\/]+$/, '') + sep + e.name;
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${e.isDir ? '▢ ' : ''}${e.name}`));
    main.appendChild(el('div', 'row-sub', e.isDir ? '文件夹' : `${fmtSize(e.size)} · ${fmtTime(e.mtime)}`));
    row.appendChild(main);
    const open = el('button', 'btn small', e.isDir ? '打开' : '打开');
    open.type = 'button';
    open.addEventListener('click', async () => {
      if (e.isDir) renderFiles(full);
      else { const rr = await window.toolbox.filesOpenPath(full); if (rr && rr.ok === false) toast(rr.error || '打不开'); }
    });
    row.appendChild(open);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      const rr = await window.toolbox.filesTrashPath(full);
      if (rr && rr.ok === false) toast(rr.error || '删除失败');
      else renderFiles(filesCurrentDir);
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#files-up').addEventListener('click', async () => {
  const r = await window.toolbox.filesListDir(filesCurrentDir).catch(() => null);
  if (r && r.parent) renderFiles(r.parent);
});
$('#files-refresh').addEventListener('click', () => renderFiles(filesCurrentDir));
$('#files-search').addEventListener('input', paintFiles);
$('#files-sort').addEventListener('change', paintFiles);
$('#files-mkdir').addEventListener('click', async () => {
  const name = $('#files-new-name').value.trim();
  if (!name) { toast('先填文件夹名称'); return; }
  const r = await window.toolbox.filesMkdir(filesCurrentDir, name);
  if (!r || r.ok === false) { toast((r && r.error) || '新建失败'); return; }
  $('#files-new-name').value = '';
  toast('文件夹已新建');
  renderFiles(filesCurrentDir);
});

/* ----- 代理：模式分流、服务器、IP 纯净度检测、日志 -----
 * 智能模式只把海外服务走代理，国内服务直连；全局模式智能体
 * 全部请求走代理；Tun 模式暂不可用（需虚拟网卡驱动）。 */
const PROXY_MODE_DESC = {
  direct: '直连：不走代理，直接上网。',
  smart: '智能：只把海外 AI 服务走代理，国内服务直接连。',
  global: '全局：智能体全部请求都走代理。',
  manual: '手动代理：按下面填的地址走 HTTP 代理。',
  tun: 'Tun：WinTun 系统隧道。启动后在本机建一张虚拟网卡，整机流量都走隧道；首次安装需弹一次确认框拉起提权 helper，智能/全局模式不需要 Tun 与管理员权限。',
};
async function renderProxy() {
  renderTunStatus();
  renderPioneer();
  const ov = await window.toolbox.getOverview().catch(() => null);
  if (!ov) return;
  const mode = ov.config.proxyMode || 'direct';
  $('#proxy-mode').value = mode;
  $('#proxy-host').value = ov.config.proxyHost || '';
  $('#proxy-port').value = ov.config.proxyPort || '';
  $('#proxy-result').textContent = '';
  $('#proxy-ip-result').textContent = '';
  $('#proxy-mode-desc').textContent = PROXY_MODE_DESC[mode] || '';
  $('#proxy-tun-warn').classList.toggle('hidden', mode !== 'tun');
  renderProxyServers(ov.config.proxyServers || []);
  const log = await window.toolbox.proxyLogList().catch(() => []);
  const box = $('#proxy-log');
  box.innerHTML = '';
  if (!log.length) { box.className = 'list empty-note'; box.textContent = '暂无代理日志，点「测试代理」会记一条。'; return; }
  box.className = 'list';
  for (const x of log.slice(0, 20)) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', x.ok ? `测试通过 · ${x.ms || ''} 毫秒` : '测试失败'));
    main.appendChild(el('div', 'row-sub', `${fmtTime(x.at)} · ${x.mode || ''}${x.error ? ` · ${x.error}` : ''}`));
    row.appendChild(main);
    box.appendChild(row);
  }
}
function renderProxyServers(servers) {
  const box = $('#proxy-servers');
  box.innerHTML = '';
  if (!servers.length) { box.className = 'list empty-note'; box.textContent = '还没有代理服务器，在上方添加。'; return; }
  box.className = 'list';
  for (const sv of servers) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', sv.name || `${sv.host}:${sv.port}`));
    main.appendChild(el('div', 'row-sub', `${sv.host}:${sv.port}`));
    row.appendChild(main);
    const use = el('button', 'btn small', '使用');
    use.type = 'button';
    use.addEventListener('click', async () => {
      await window.toolbox.setConfig({ proxyHost: sv.host, proxyPort: String(sv.port), proxyMode: $('#proxy-mode').value === 'direct' ? 'manual' : $('#proxy-mode').value });
      toast(`已选用代理服务器：${sv.name || sv.host}`);
      renderProxy();
    });
    row.appendChild(use);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      const ov = await window.toolbox.getOverview();
      const next = (ov.config.proxyServers || []).filter((x) => x.id !== sv.id);
      await window.toolbox.setConfig({ proxyServers: next });
      renderProxyServers(next);
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#proxy-mode').addEventListener('change', async (e) => {
  const mode = e.target.value;
  $('#proxy-mode-desc').textContent = PROXY_MODE_DESC[mode] || '';
  $('#proxy-tun-warn').classList.toggle('hidden', mode !== 'tun');
  if (mode === 'tun') toast('Tun 模式需要 WinTun 驱动：先在下方检测 / 安装；首次安装需弹一次确认框拉起提权 helper');
  await window.toolbox.setConfig({ proxyMode: mode });
});
$('#proxy-server-add').addEventListener('click', async () => {
  const name = $('#proxy-server-name').value.trim();
  const host = $('#proxy-server-host').value.trim();
  const port = $('#proxy-server-port').value.trim();
  if (!host || !port) { toast('地址与端口都要填'); return; }
  const ov = await window.toolbox.getOverview();
  const servers = [...(ov.config.proxyServers || []), { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: name || host, host, port: Number(port) }];
  await window.toolbox.setConfig({ proxyServers: servers });
  $('#proxy-server-name').value = ''; $('#proxy-server-host').value = ''; $('#proxy-server-port').value = '';
  toast('代理服务器已添加');
  renderProxyServers(servers);
});
$('#proxy-save').addEventListener('click', async () => {
  const mode = $('#proxy-mode').value;
  if (mode === 'tun') { toast('Tun 模式已保存：先在下方启动 Tun（需管理员权限）才会真正走隧道'); }
  await window.toolbox.setConfig({
    proxyMode: mode,
    proxyHost: $('#proxy-host').value.trim(),
    proxyPort: $('#proxy-port').value.trim(),
  });
  toast('代理设置已保存');
  renderProxy();
});
async function renderTunStatus() {
  const box = $('#tun-status-text');
  if (!box) return;
  const st = await window.toolbox.tunStatus().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!st || st.ok === false && !st.supported) { box.textContent = (st && (st.note || st.error)) || '检测失败'; return; }
  box.textContent = st.supported
    ? `平台 Windows · 管理员权限：${st.admin ? '是' : '否'} · WinTun 驱动：${st.driverInstalled ? '已安装' : '未安装'} · 驱动文件：${st.dllPresent ? '已内置' : '缺失'} · 提权 helper：${st.helperRunning ? `运行中（${st.helperState || ''}）` : '未运行'} · 状态：${st.active ? '运行中' : '未启动'}${st.note ? ` · ${st.note}` : ''}`
    : (st.note || 'Tun 只能在 Windows 上用');
}
$('#tun-check').addEventListener('click', async () => { await renderTunStatus(); toast('Tun 检测完成'); });
$('#tun-install').addEventListener('click', async () => {
  // 2026-11-27-3：安装不再预弹确认框——首次拉起提权 helper 时系统会弹
  // 一次确认框；主程序本身不提权。驱动文件已随包内置，不下载。
  toast('正在安装 WinTun 驱动…');
  const r = await window.toolbox.tunInstall().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { toast((r && r.error) || '安装失败'); await renderTunStatus(); return; }
  toast(r.note || 'WinTun 驱动已安装');
  await renderTunStatus();
});
$('#tun-start').addEventListener('click', async () => {
  // 2026-11-27-3：启动不再预弹确认框——首次拉起提权 helper 时系统会弹
  // 一次确认框，helper 常驻后开关 Tun 不再弹；主程序本身不提权。
  const r = await window.toolbox.tunStart().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { toast((r && r.error) || '启动失败'); await renderTunStatus(); return; }
  toast(r.note || 'Tun 已启动');
  await renderTunStatus();
});
$('#tun-stop').addEventListener('click', async () => {
  const r = await window.toolbox.tunStop().catch((e) => ({ ok: false, error: e.message || String(e) }));
  toast((r && r.note) || 'Tun 已停止');
  await renderTunStatus();
});
/* ----- Pioneer：账号密码登录、地区、连接、模式、IP 检测、日志 -----
 * 账号密码、token 永不显示，只发给主进程。 */
async function renderPioneer() {
  const statusEl = $('#pioneer-status');
  if (!statusEl) return;
  const st = await callTb('pioneerStatus');
  if (!st || st.ok === false) { statusEl.textContent = '后端未就绪：Pioneer 需要新版后端。'; return; }
  statusEl.textContent = st.loggedIn
    ? `已登录${st.username ? `：${st.username}` : ''}${st.accountType ? ` · ${st.accountType}` : ''}${st.dueTime ? ` · 到期 ${st.dueTime}` : ''}`
    : '未登录：填账号密码登录。';
  $('#pioneer-exit-ip').textContent = st.connected
    ? `已连接：${st.nodeName || ''}${st.region ? ` · ${st.region}` : ''} · 出口 IP ${st.exitIp || '—'}`
    : '未连接';
  const modeSel = $('#pioneer-mode');
  if (modeSel) modeSel.value = st.proxyMode || 'smart';
  $('#pioneer-login').disabled = !!st.loggedIn;
  $('#pioneer-connect').disabled = !st.loggedIn || !!st.connected;
  $('#pioneer-disconnect').disabled = !st.connected;
  if (st.loggedIn) loadPioneerRegions();
  renderPioneerLogs();
}
async function loadPioneerRegions() {
  const r = await callTb('pioneerRegions');
  const sel = $('#pioneer-region');
  if (!r || !r.ok || !sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">选择地区</option>';
  for (const rg of r.regions || []) {
    const o = document.createElement('option');
    o.value = String(rg.country_id);
    o.textContent = rg.country_name;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
async function renderPioneerLogs() {
  const box = $('#pioneer-log');
  if (!box) return;
  const logs = await callTb('pioneerLogs');
  box.innerHTML = '';
  if (!Array.isArray(logs) || !logs.length) { box.className = 'list empty-note'; box.textContent = '暂无日志。'; return; }
  box.className = 'list';
  for (const x of logs.slice(0, 20)) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', x.text || ''));
    main.appendChild(el('div', 'row-sub', fmtTime(x.at)));
    row.appendChild(main);
    box.appendChild(row);
  }
}
$('#pioneer-login').addEventListener('click', async () => {
  const username = $('#pioneer-username').value.trim();
  const password = $('#pioneer-password').value;
  if (!username || !password) { toast('账号密码都要填'); return; }
  const r = await callTb('pioneerLogin', { username, password });
  $('#pioneer-password').value = '';
  if (!r || !r.ok) { toast((r && r.error) || '登录失败'); return; }
  toast('Pioneer 已登录');
  renderPioneer();
});
$('#pioneer-logout').addEventListener('click', async () => {
  await callTb('pioneerLogout');
  toast('Pioneer 已退出登录');
  renderPioneer();
});
$('#pioneer-connect').addEventListener('click', async () => {
  const countryId = $('#pioneer-region').value;
  if (!countryId) { toast('先选择地区'); return; }
  const btn = $('#pioneer-connect');
  btn.disabled = true; btn.textContent = '连接中…';
  const r = await callTb('pioneerConnect', { countryId });
  btn.disabled = false; btn.textContent = '连接';
  if (!r || !r.ok) { toast((r && r.error) || '连接失败'); renderPioneer(); return; }
  toast(`已连接：${r.nodeName || ''} · 出口 IP ${r.exitIp || '—'}`);
  renderPioneer();
});
$('#pioneer-disconnect').addEventListener('click', async () => {
  await callTb('pioneerDisconnect');
  toast('Pioneer 已断开');
  renderPioneer();
});
$('#pioneer-mode').addEventListener('change', async (e) => {
  const mode = e.target.value;
  await callTb('pioneerSetMode', mode);
  const pm = $('#proxy-mode');
  if (pm) { pm.value = mode; $('#proxy-mode-desc').textContent = PROXY_MODE_DESC[mode] || ''; }
  toast('Pioneer 模式已保存');
});
/* 2026-11-27-2：出口验证失败要分阶段显示中文原因（主进程 pioneer-ip-check /
 * pioneer-connect 失败时带 stage 与中文 reason）。与主进程
 * PIONEER_EGRESS_STAGE_TEXT 同一套文案。 */
const PIONEER_STAGE_TEXT = { proxy: '代理没连上', node: '节点失效', detector: '检测服务不通' };
function formatPioneerIpResult(r) {
  if (r && r.ok) return `出口 IP：${r.ip}（${r.viaTunnel ? '走隧道' : '直连'}）`;
  const stage = r && r.stage ? (PIONEER_STAGE_TEXT[r.stage] || r.stage) : '';
  return `检测失败${stage ? `（${stage}）` : ''}：${(r && (r.reason || r.error)) || '未知原因'}`;
}
$('#pioneer-ip-check').addEventListener('click', async () => {
  $('#pioneer-ip-result').textContent = '检测中…';
  const r = await callTb('pioneerIpCheck');
  $('#pioneer-ip-result').textContent = formatPioneerIpResult(r);
});

$('#proxy-test').addEventListener('click', async () => {
  $('#proxy-result').textContent = '测试中…';
  const r = await window.toolbox.proxyTest();
  await renderProxy();
  if (r && r.ok) $('#proxy-result').textContent = `代理可用：${r.ms} 毫秒到达 api.github.com（${r.status}）`;
  else $('#proxy-result').textContent = `代理不可用：${(r && r.error) || '测试失败'}`;
});
$('#proxy-ip-check').addEventListener('click', async () => {
  $('#proxy-ip-result').textContent = '检测中…';
  const r = await window.toolbox.proxyIpCheck();
  if (r && r.ok) $('#proxy-ip-result').textContent = `出口 IP：${r.ip}（${r.viaProxy ? '走代理' : '直连'}，模式：${r.mode || '直连'}）`;
  else $('#proxy-ip-result').textContent = `检测失败：${(r && r.error) || '未知原因'}`;
});

/* ---------- v1.6.0：工具来源自定义 + 从本机已装程序导入 ---------- */
async function renderCustomSources() {
  const box = $('#custom-sources-list');
  if (!box) return;
  const list = await window.toolbox.sourcesCustomList().catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '还没有自定义来源。'; return; }
  box.className = 'list';
  const typeName = { winget: 'winget 源', github: 'GitHub 仓库', url: '网址' };
  for (const s of list) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${s.name} · ${typeName[s.type] || s.type}`));
    main.appendChild(el('div', 'row-sub', `${s.address}${s.note ? ` · ${s.note}` : ''}`));
    wrap.appendChild(main);
    if (s.type === 'winget') {
      const reg = el('button', 'btn small', '注册到 winget');
      reg.type = 'button';
      reg.addEventListener('click', async () => {
        const r = await window.toolbox.sourcesCustomRegisterWinget(s.id);
        toast(r.ok ? '已注册到 winget' : (r.error || '注册失败'));
      });
      wrap.appendChild(reg);
    }
    if (s.type === 'github') {
      const open = el('button', 'btn small', '打开仓库');
      open.type = 'button';
      open.addEventListener('click', () => window.toolbox.openExternal(`https://github.com/${s.address}`));
      wrap.appendChild(open);
    }
    if (s.type === 'url') {
      const open = el('button', 'btn small', '打开链接');
      open.type = 'button';
      open.addEventListener('click', () => window.toolbox.openExternal(s.address));
      wrap.appendChild(open);
    }
    const label = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = s.enabled !== false;
    input.addEventListener('change', async () => {
      await window.toolbox.sourcesCustomToggle(s.id, input.checked);
      renderCustomSources();
    });
    label.appendChild(input);
    label.appendChild(el('span', 'slider'));
    wrap.appendChild(label);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await customConfirm('删除自定义来源', `删除自定义来源「${s.name}」？`, '删除')) return;
      await window.toolbox.sourcesCustomDelete(s.id);
      renderCustomSources();
    });
    wrap.appendChild(del);
    box.appendChild(wrap);
  }
}
$('#custom-source-add').addEventListener('click', async () => {
  const name = $('#custom-source-name').value.trim();
  const type = $('#custom-source-type').value;
  const address = $('#custom-source-address').value.trim();
  if (!name || !address) { toast('名称和地址都要填'); return; }
  const r = await window.toolbox.sourcesCustomAdd({ name, type, address });
  if (r && r.ok) {
    toast('来源已添加');
    $('#custom-source-name').value = '';
    $('#custom-source-address').value = '';
    renderCustomSources();
  } else toast(r.error || '添加失败');
});
async function renderImportedList() {
  const box = $('#imported-list');
  if (!box) return;
  const list = await window.toolbox.sourcesImportedList().catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '还没导入过本机已装程序。'; return; }
  box.className = 'list';
  $('#import-installed-count').textContent = `共 ${list.length} 个`;
  for (const it of list.slice(0, 100)) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${it.name}${it.version ? ` ${it.version}` : ''}`));
    main.appendChild(el('div', 'row-sub', `${it.publisher ? `${it.publisher} · ` : ''}安装指导：${it.guide || '未提供'}`));
    wrap.appendChild(main);
    if (it.wingetId) {
      const btn = el('button', 'btn small', '在 winget 里查看');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        gotoTab('discover');
        $('#search-input').value = it.wingetId;
        $('#search-btn').click();
      });
      wrap.appendChild(btn);
    }
    box.appendChild(wrap);
  }
  if (list.length > 100) box.appendChild(el('div', 'row-sub', `……共 ${list.length} 个，只列前 100 个`));
}
$('#import-installed-btn').addEventListener('click', async () => {
  const btn = $('#import-installed-btn');
  btn.disabled = true;
  btn.textContent = '扫描中…';
  const r = await window.toolbox.sourcesImportInstalled();
  btn.disabled = false;
  btn.textContent = '扫描并导入已装程序';
  if (r && r.ok) { toast(`已导入 ${r.count} 个本机已装程序`); renderImportedList(); }
  else toast(r.error || '扫描失败');
});

/* ---------- v1.6.0：插件 ---------- */
let currentPluginId = null;
async function renderPlugins() {
  const box = $('#plugins-list');
  if (!box) return;
  const list = await window.toolbox.pluginsList().catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '还没有插件。'; return; }
  box.className = 'list';
  for (const p of list) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${p.name} ${p.version}`));
    main.appendChild(el('div', 'row-sub', `${p.description || ''}${p.description ? ' · ' : ''}菜单：${p.menuLabel} · 权限：${(p.permissions || []).join('、') || '无'} · 来源：${p.source || ''}`));
    wrap.appendChild(main);
    const open = el('button', 'btn small', '打开');
    open.type = 'button';
    open.disabled = !p.enabled;
    open.addEventListener('click', () => openPlugin(p.id));
    wrap.appendChild(open);
    const toggle = el('button', 'btn small', p.enabled ? '禁用' : '启用');
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      await window.toolbox.pluginEnable(p.id, !p.enabled);
      renderPlugins();
      renderPluginsMenu();
    });
    wrap.appendChild(toggle);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await customConfirm('删除插件', `删除插件「${p.name}」？它的文件夹会一起删掉。`, '删除')) return;
      await window.toolbox.pluginDelete(p.id);
      renderPlugins();
      renderPluginsMenu();
    });
    wrap.appendChild(del);
    box.appendChild(wrap);
  }
}
async function renderPluginsMenu() {
  const grid = $('#menu-grid');
  if (!grid) return;
  grid.querySelectorAll('[data-menu^="plugin:"]').forEach((b) => b.remove());
  const list = await window.toolbox.pluginsList().catch(() => []);
  for (const p of list) {
    if (!p.enabled) continue;
    const btn = el('button', 'menu-item');
    btn.type = 'button';
    btn.dataset.menu = `plugin:${p.id}`;
    btn.appendChild(el('span', 'menu-tile purple', '✚'));
    btn.appendChild(el('span', 'menu-label', p.menuLabel));
    btn.addEventListener('click', () => openMenuItem(`plugin:${p.id}`));
    grid.appendChild(btn);
  }
}
async function openPlugin(id) {
  const list = await window.toolbox.pluginsList().catch(() => []);
  const p = list.find((x) => x.id === id);
  if (!p) { toast('插件不存在'); return; }
  currentPluginId = id;
  $('#plugin-title').textContent = p.menuLabel;
  $('#plugin-desc').textContent = `插件「${p.name} ${p.version}」· 权限：${(p.permissions || []).join('、') || '无'} · 只能调工具箱给它的接口。`;
  setMenuActive(`plugin:${id}`);
  gotoScreen('plugin');
  const frame = $('#plugin-frame');
  const pagePath = p.page ? await window.toolbox.pluginPagePath(id) : '';
  frame.src = pagePath ? `file://${pagePath}` : 'about:blank';
  if (!pagePath) toast('这个插件没有界面文件（manifest 里没写 page），只注册了菜单入口');
}
window.addEventListener('message', async (e) => {
  if (!currentPluginId) return;
  if (!e.data || typeof e.data.type !== 'string') return;
  const frame = $('#plugin-frame');
  if (!frame || !frame.contentWindow || e.source !== frame.contentWindow) return;
  if (e.data.type === 'plugin-translate-ack') {
    if (translateAckResolve) { const r = translateAckResolve; translateAckResolve = null; r(); }
    return;
  }
  if (e.data.type === 'plugin-translate-result') { handleTranslateResult(e.data); return; }
  if (e.data.type !== 'plugin-call' || typeof e.data.method !== 'string') return;
  let result = await window.toolbox.pluginCall(currentPluginId, e.data.method, e.data.args || {}, false);
  if (result && result.needConfirm) {
    if (await customConfirm('插件调用确认', `插件要调用 ${e.data.method}（装软件 / 运行代码），确定允许吗？`, '允许')) {
      result = await window.toolbox.pluginCall(currentPluginId, e.data.method, e.data.args || {}, true);
    } else {
      result = { ok: false, error: '你取消了这次调用' };
    }
  }
  frame.contentWindow.postMessage({ type: 'plugin-result', id: e.data.id, result }, '*');
});

/* ---------- 翻译插件：工具页右键翻译与一键翻译（只针对工具页面，浏览器页面不用） ---------- */
let translateAckResolve = null;
let lastTranslateTarget = null;

async function findTranslationPlugin() {
  const list = await window.toolbox.pluginsList().catch(() => []);
  const p = list.find((x) => x.id === 'translation' || x.name === '翻译');
  return p ? p.id : null;
}
async function requestToolTranslation(text, target) {
  const id = await findTranslationPlugin();
  if (!id) { toast('先在插件管理里安装「翻译」插件'); return; }
  lastTranslateTarget = target || null;
  await openPlugin(id);
  const frame = $('#plugin-frame');
  let acked = false;
  for (let i = 0; i < 10; i++) {
    const ack = new Promise((resolve) => { translateAckResolve = resolve; });
    frame.contentWindow.postMessage({ type: 'plugin-translate-request', text, target: target && target.kind }, '*');
    const ok = await Promise.race([ack.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
    if (ok) { acked = true; break; }
  }
  if (!acked) toast('翻译插件没有回应');
}
function handleTranslateResult(d) {
  if (!d || !d.ok) { toast('翻译失败：' + ((d && d.error) || '未知原因')); return; }
  if (!d.translated || d.translated === d.text) { toast('已是中文或无需翻译'); return; }
  if (lastTranslateTarget && lastTranslateTarget.kind === 'selection' && lastTranslateTarget.range) {
    const range = lastTranslateTarget.range;
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, d.translated);
      if (!ok) { range.deleteContents(); range.insertNode(document.createTextNode(d.translated)); }
      toast('已替换所选内容');
    } catch (err) { toast('就地替换失败，译文已显示在翻译插件页'); }
    return;
  }
  toast('翻译完成，译文在翻译插件页');
}
$('#plugin-install-folder').addEventListener('click', async () => {
  const r = await window.toolbox.pluginInstallFolder();
  if (r && r.ok) { toast(`插件「${r.plugin.name}」已安装`); renderPlugins(); renderPluginsMenu(); }
  else if (r && !r.canceled) toast(r.error || '安装失败');
});
$('#plugin-install-github').addEventListener('click', async () => {
  const repo = $('#plugin-github-input').value.trim();
  if (!repo) { toast('先填 GitHub 仓库 owner/repo'); return; }
  const btn = $('#plugin-install-github');
  btn.disabled = true;
  btn.textContent = '下载安装中…';
  const r = await window.toolbox.pluginInstallGithub(repo);
  btn.disabled = false;
  btn.textContent = '从 GitHub 安装';
  if (r && r.ok) { toast(`插件「${r.plugin.name}」已安装`); $('#plugin-github-input').value = ''; renderPlugins(); renderPluginsMenu(); }
  else toast(r.error || '安装失败');
});

/* ---------- v1.6.0：备份与同步 ---------- */
function backupOpts() {
  return {
    includeSecrets: $('#backup-include-secrets').checked,
    password: $('#backup-password').value || '',
  };
}
$('#backup-export').addEventListener('click', async () => {
  const r = await window.toolbox.backupExport(backupOpts());
  if (r && r.ok) {
    $('#backup-status').textContent = `已导出到 ${r.file}${r.encrypted ? '（已加密）' : ''}，包含 ${r.files.length} 个数据文件。`;
    toast('备份已导出');
  } else if (r && !r.canceled) toast(r.error || '导出失败');
});
$('#backup-import').addEventListener('click', async () => {
  const r = await window.toolbox.backupImport();
  if (r && r.ok) {
    toast(`已导入 ${r.files.length} 个数据文件，旧数据已自动备份到 ${r.autoBackup}`);
    renderSettings(); renderAgents(); renderRegister();
  } else if (r && r.needsPassword) {
    const pwRes = await customPrompt('备份密码', '这份备份有密码保护，请输入密码：', 'password');
    if (!pwRes || pwRes.value !== true) return;
    toast('带密码的导入请用同步文件夹里的备份，或重新导出不加密的备份');
  } else if (r && !r.canceled) toast(r.error || '导入失败');
});
$('#sync-set-folder').addEventListener('click', async () => {
  const r = await window.toolbox.syncSetFolder();
  if (r && r.ok) { toast(`同步文件夹已设为 ${r.folder}`); renderSyncFolder(); }
  else if (r && !r.canceled) toast(r.error || '选择失败');
});
$('#sync-export').addEventListener('click', async () => {
  const r = await window.toolbox.syncExport(backupOpts());
  if (r && r.ok) { toast(`已同步到文件夹：${r.file}`); renderSyncList(); }
  else toast(r.error || '同步失败');
});
$('#sync-list-refresh').addEventListener('click', renderSyncList);
async function renderSyncFolder() {
  const ov = await window.toolbox.getOverview();
  const folder = ov.config.syncFolder || '';
  $('#sync-folder-label').textContent = folder ? `同步文件夹：${folder}` : '未指定同步文件夹（可用 U 盘、网盘同步目录或局域网共享文件夹）。';
  renderSyncList();
}
async function renderSyncList() {
  const box = $('#sync-list');
  if (!box) return;
  const r = await window.toolbox.syncList().catch(() => ({ ok: false, files: [] }));
  box.innerHTML = '';
  if (!r.ok) { box.className = 'list empty-note'; box.textContent = r.error || '先选同步文件夹。'; return; }
  if (!r.files.length) { box.className = 'list empty-note'; box.textContent = '同步文件夹里还没有备份。'; return; }
  box.className = 'list';
  for (const f of r.files) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', f.name));
    main.appendChild(el('div', 'row-sub', `${fmtSize(f.size)} · ${fmtTime(f.mtime)}`));
    wrap.appendChild(main);
    const btn = el('button', 'btn small primary', '从这份恢复');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      if (!await customConfirm('恢复数据', `从 ${f.name} 恢复数据？导入前当前数据会自动备份一份。`, '恢复')) return;
      let res = await window.toolbox.syncImport(f.path);
      if (res && res.needsPassword) {
        const pwRes = await customPrompt('备份密码', '这份备份有密码保护，请输入密码：', 'password');
        if (!pwRes || pwRes.value !== true) return;
        res = await window.toolbox.syncImportPassword(f.path, pwRes.input);
      }
      if (res && res.ok) { toast(`已从 ${f.name} 恢复 ${res.files.length} 个数据文件`); renderSettings(); renderAgents(); renderRegister(); }
      else toast(res.error || '恢复失败');
    });
    wrap.appendChild(btn);
    box.appendChild(wrap);
  }
}
async function renderBackupSync() {
  renderPlugins();
  renderSyncFolder();
}

/* ---------- 视频下载 ---------- */
const VIDEO_ENGINE_NAMES = { ytdlp: 'yt-dlp', nm3u8: 'N_m3u8DL-RE', lux: 'Lux', ffmpeg: 'ffmpeg' };
async function renderVideo() {
  renderVideoEngines();
  renderVideoDownloads();
}
async function renderVideoEngines() {
  const box = $('#video-engines');
  if (!box) return;
  const r = await callTb('videoEnginesStatus');
  box.innerHTML = '';
  if (!r || r.ok === false || !r.engines) {
    box.className = 'list empty-note';
    box.textContent = (r && r.error) || '引擎状态读取需要新版后端。';
    return;
  }
  box.className = 'list';
  for (const key of ['ytdlp', 'nm3u8', 'lux', 'ffmpeg']) {
    const e = r.engines[key] || {};
    const row = el('div', 'row');
    row.dataset.engine = key;
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', VIDEO_ENGINE_NAMES[key]));
    main.appendChild(el('div', 'row-sub', e.installed ? `已安装${e.version ? ` · ${e.version}` : ''}` : '未安装'));
    row.appendChild(main);
    if (!e.installed) {
      const btn = el('button', 'btn small', '安装');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '下载中…';
        const rr = await callTb('videoEngineDownload', key);
        if (!rr || rr.ok === false) toast((rr && rr.error) || '引擎下载失败');
        else toast(`${VIDEO_ENGINE_NAMES[key]} 已安装`);
        renderVideoEngines();
      });
      row.appendChild(btn);
    }
    box.appendChild(row);
  }
}
async function renderVideoDownloads() {
  const box = $('#video-downloads');
  if (!box) return;
  const r = await callTb('videoDownloadsList');
  const list = Array.isArray(r) ? r : [];
  box.innerHTML = '';
  if (!list.length) { box.className = 'list empty-note'; box.textContent = '暂无下载。'; return; }
  box.className = 'list';
  for (const d of list) {
    const wrap = el('div', 'row');
    wrap.dataset.jobId = d.id;
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', d.title || d.file || d.id));
    main.appendChild(el('div', 'row-sub', `${d.engine || ''}${d.size ? ` · ${fmtSize(d.size)}` : ''}${d.at ? ` · ${fmtTime(d.at)}` : ''}`));
    const prog = el('div', 'row-progress', d.status === 'done' ? '已完成' : d.status === 'failed' ? '失败' : d.status === 'running' ? '下载中…' : (d.status || ''));
    prog.dataset.jobId = d.id;
    main.appendChild(prog);
    wrap.appendChild(main);
    if (d.file) {
      const open = el('button', 'btn small', '打开');
      open.type = 'button';
      open.addEventListener('click', async () => {
        const rr = await callTb('videoDownloadOpen', d.file);
        if (!rr || rr.ok === false) toast((rr && rr.error) || '打不开');
      });
      wrap.appendChild(open);
    }
    box.appendChild(wrap);
  }
}
function videoStartDownload(url, engine, formatId, title) {
  callTb('videoDownload', { url, engine, formatId, title }).then((r) => {
    if (!r || r.ok === false) { toast((r && r.error) || '下载失败'); return; }
    toast('已开始下载');
    renderVideoDownloads();
  });
}
$('#video-sniff').addEventListener('click', async () => {
  const url = $('#video-url').value.trim();
  if (!url) { toast('先粘贴视频地址'); return; }
  const box = $('#video-results');
  box.className = 'list empty-note'; box.textContent = '正在嗅探…';
  $('#video-status').textContent = '';
  const r = await callTb('videoSniff', url);
  if (!r || r.ok === false) { box.textContent = (r && r.error) || '嗅探失败'; return; }
  const items = r.items || [];
  box.innerHTML = '';
  if (!items.length) { box.textContent = '没有嗅探到视频。'; return; }
  box.className = 'list';
  $('#video-status').textContent = r.title ? `标题：${r.title}` : '';
  for (const it of items) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${it.kind === 'audio' ? '音频' : it.kind === 'playlist' ? '播放列表' : '视频'}${it.resolution ? ` · ${it.resolution}` : ''}`));
    main.appendChild(el('div', 'row-sub', `${it.url}${it.note ? ` · ${it.note}` : ''}${it.via ? ` · ${it.via}` : ''}`));
    wrap.appendChild(main);
    const dl = el('button', 'btn small primary', '下载');
    dl.type = 'button';
    dl.addEventListener('click', () => videoStartDownload(it.url, $('#video-engine').value || 'auto', undefined, r.title));
    wrap.appendChild(dl);
    box.appendChild(wrap);
  }
});
$('#video-extract').addEventListener('click', async () => {
  const url = $('#video-url').value.trim();
  if (!url) { toast('先粘贴视频地址'); return; }
  const box = $('#video-results');
  box.className = 'list empty-note'; box.textContent = '正在深度解析…';
  $('#video-status').textContent = '';
  const r = await callTb('videoExtract', url);
  if (!r || r.ok === false) { box.textContent = (r && r.error) || '解析失败'; return; }
  const formats = r.formats || [];
  box.innerHTML = '';
  if (!formats.length) { box.textContent = '没有解析到可用格式。'; return; }
  box.className = 'list';
  $('#video-status').textContent = `${r.title || ''}${r.duration ? ` · ${r.duration}` : ''}${r.engine ? ` · 引擎 ${r.engine}` : ''}`;
  for (const f of formats) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${f.quality || f.id} · ${f.ext || ''}`));
    main.appendChild(el('div', 'row-sub', `${f.width && f.height ? `${f.width}x${f.height} · ` : ''}${f.fps ? `${f.fps}fps · ` : ''}${f.size ? fmtSize(f.size) : ''}${f.note ? ` · ${f.note}` : ''}`));
    wrap.appendChild(main);
    const dl = el('button', 'btn small primary', '下载');
    dl.type = 'button';
    dl.addEventListener('click', () => videoStartDownload(url, $('#video-engine').value || 'auto', f.id, r.title));
    wrap.appendChild(dl);
    box.appendChild(wrap);
  }
});
window.toolbox.on('video-download-progress', (p) => {
  if (!p || !p.jobId) return;
  document.querySelectorAll(`#video-downloads .row-progress[data-job-id="${CSS.escape(p.jobId)}"]`).forEach((e) => {
    e.textContent = p.status === 'done' ? '已完成' : p.status === 'failed' ? `失败：${p.error || ''}` : `下载中… ${p.pct || 0}%`;
  });
  if (p.status === 'done' || p.status === 'failed') renderVideoDownloads();
});
window.toolbox.on('video-engine-progress', (p) => {
  if (!p || !p.engine) return;
  const row = document.querySelector(`#video-engines .row[data-engine="${CSS.escape(p.engine)}"] .row-sub`);
  if (row) row.textContent = `${p.status || '下载中'} ${p.pct || 0}%`;
});

/* ---------- 启动 ---------- */
(async () => {
  const ov = await window.toolbox.getOverview();
  $('#winget-warn').classList.toggle('hidden', ov.winget);
  renderVlc();
  renderBrowser();
  renderSettings();
  renderSelfcheck();
  renderRecent();
  renderGithubStatus();
  renderSources();
  renderPluginsMenu();
  renderBackupSync();
  loadPrereqs();
  if (ov.winget) { loadInstalled(); loadUpgrades(); }
})();
