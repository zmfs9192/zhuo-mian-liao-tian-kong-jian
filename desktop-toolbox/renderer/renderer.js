'use strict';
/* 桌面工具箱 — 渲染层 2026-11-26-3：主页是桌面聊天空间式布局
 * （深色顶栏、左侧菜单边栏、右侧主内容区、底部导航栏），
 * 苹果手机桌面主题已在 v1.4.1 放弃。左侧是「工具箱菜单」，
 * 含空间全部 13 项功能加工具管理、播放器、浏览器（16 项）；
 * 点工具箱进工具箱内容，其他功能全部是工具箱自己的实现与
 * 本地数据（与空间不互通）；空间不再占菜单一项，改成右下角
 * 悬浮小圆点，点它切换到空间（再点切回工具箱）。
 * v1.4.2：同名功能页按空间里的完整界面做（智能体含系统提示、
 * 长期记忆、定时触发；记账本、注册、远程、文件、代理、媒体、
 * GitHub 均为完整界面），数据只存本机、与空间不互通；跑不通
 * 的功能界面照样做出来并如实标明暂不可用。
 * 全部经 preload 白名单 IPC 调主进程；本层不碰 Node。
 * 真实功能：winget 工具管理、GitHub、内置 VLC/Chromium 启动与
 * muse-toolbox:// 协议、空间调用开关。空间里除播放器、浏览器
 * 外多数功能可用，只有这两项在空间里是界面预览，真的播放/
 * 浏览在这里完成；电脑端离线也能用很多功能。 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- 界面切换：右侧主内容区的页 ---------- */
function gotoScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'player') renderPlayerApps();
  if (name === 'settings') { renderSelfcheck(); renderUpdateSection(); }
  if (name === 'browser') renderBrowserApps();
  if (name !== 'monitor' && typeof monitorTimer !== 'undefined' && monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
}
$$('[data-screen]').forEach((b) => b.addEventListener('click', () => gotoScreen(b.dataset.screen)));
$$('[data-goto="home"]').forEach((b) => b.addEventListener('click', () => { setMenuActive('toolbox'); gotoScreen('home'); }));
window.toolbox.on('test-goto', (msg) => {
  if (msg && typeof msg === 'object' && msg.screen === 'space') { openSpace(msg.spaceUrl || null); return; }
  if (msg === 'space') { openSpace(); return; }
  gotoScreen(msg);
});

/* ---------- 工具箱菜单 / 底部导航 / 最近聊天 ---------- */
/* 菜单 16 项：空间 13 项 + 工具管理、播放器、浏览器。
 * 空间不在菜单里，改成右下角悬浮小圆点（#space-fab）。
 * 全部菜单项打开工具箱自己的页面（本地实现与数据）。 */
const MENU_INFO = {
  agents: { name: '智能体' }, create: { name: '创作' }, code: { name: '代码' },
  image: { name: '图像' }, monitor: { name: '监控' }, ledger: { name: '记账本' },
  register: { name: '注册' }, remote: { name: '远程' }, files: { name: '文件' },
  proxy: { name: '代理' }, media: { name: '媒体' }, github: { name: 'GitHub' },
  toolbox: { name: '工具箱' }, tools: { name: '工具管理' }, player: { name: '播放器' },
  browser: { name: '浏览器' },
};
function setMenuActive(key) {
  $$('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.menu === key));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.menu === key));
  const fab = $('#space-fab');
  if (fab) fab.classList.toggle('active', key === 'space');
}
const MENU_ROUTE = {
  agents: () => { gotoScreen('agents'); renderAgents(); },
  create: () => { gotoScreen('create'); renderCreate(); },
  code: () => { gotoScreen('code'); renderCode(); },
  image: () => { gotoScreen('image'); renderImages(); },
  monitor: () => { gotoScreen('monitor'); renderMonitor(); },
  ledger: () => { gotoScreen('ledger'); renderLedger(); },
  register: () => { gotoScreen('register'); renderRegister(); },
  remote: () => { gotoScreen('remote'); renderRemote(); },
  files: () => { gotoScreen('files'); renderFiles(); },
  proxy: () => { gotoScreen('proxy'); renderProxy(); },
  media: () => { gotoScreen('media'); renderMedia(); },
  github: () => { gotoScreen('github'); renderGh2(); },
  toolbox: () => gotoScreen('home'),
  tools: () => gotoScreen('tools'),
  player: () => gotoScreen('player'),
  browser: () => gotoScreen('browser'),
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
$$('.nav-item').forEach((b) => b.addEventListener('click', () => openMenuItem(b.dataset.menu)));
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
$('#topbar-back').addEventListener('click', () => { setMenuActive('toolbox'); gotoScreen('home'); });
$('#topbar-more-settings').addEventListener('click', () => { setMenuActive('toolbox'); gotoScreen('settings'); });
$('#topbar-more-about').addEventListener('click', async () => {
  const ov = await window.toolbox.getOverview();
  toast(`桌面工具箱 ${ov.version} · VLC 与 Chromium 已打包内置`);
});

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
  $$('#screen-tools .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('#screen-tools .tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}
$$('#screen-tools .tab').forEach((b) => b.addEventListener('click', () => gotoTab(b.dataset.tab)));
function gotoSubTab(name) {
  $$('#screen-tools .subtab').forEach((b) => b.classList.toggle('active', b.dataset.subtab === name));
  $$('#screen-tools .subpane').forEach((p) => p.classList.toggle('active', p.id === `subtab-${name}`));
}
$$('#screen-tools .subtab').forEach((b) => b.addEventListener('click', () => gotoSubTab(b.dataset.subtab)));

function pkgRow(row, actions) {
  const wrap = el('div', 'row');
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
function fillList(container, rows, actions, emptyText) {
  container.innerHTML = '';
  if (!rows.length) { container.className = 'list empty-note'; container.textContent = emptyText; return; }
  container.className = 'list';
  for (const r of rows) container.appendChild(pkgRow(r, actions));
}
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
  box.className = 'list empty-note'; box.textContent = '正在搜索 winget 与微软商店…';
  const r = await window.toolbox.wingetSearch(q);
  fillList(box, r.rows || [], [{ label: '安装', onClick: (row) => checkDepsThenInstall(row) }], r.error || '没有搜到这个软件。');
});
$('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#search-btn').click(); });
$('#web-search-btn').addEventListener('click', async () => {
  const q = $('#search-input').value.trim();
  const url = q ? `https://www.bing.com/search?q=${encodeURIComponent(q)}` : 'https://www.bing.com';
  const r = await window.toolbox.browserOpenUrl('chromium', url);
  if (r && !r.ok) toast(r.error || '打开失败');
});

async function loadInstalled() {
  const box = $('#installed-list');
  box.className = 'list empty-note'; box.textContent = '正在读取…';
  const r = await window.toolbox.wingetInstalled();
  $('#installed-count').textContent = r.rows && r.rows.length ? `共 ${r.rows.length} 个` : '';
  fillList(box, r.rows || [], [{ label: '卸载', danger: true, onClick: (row) => startJob(window.toolbox.wingetUninstall(row.id)) }], r.error || '没有读到已安装软件。');
  return r.rows || [];
}
$('#installed-refresh').addEventListener('click', loadInstalled);

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
}
$('#updates-refresh').addEventListener('click', loadUpgrades);
$('#upgrade-all').addEventListener('click', () => startJob(window.toolbox.wingetUpgradeAll()));
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
  const log = $('#job-log');
  log.textContent = (job.log || []).join('\n');
  log.scrollTop = log.scrollHeight;
  if (job.status === 'done') {
    const m = /^(安装|更新) (\S+)/.exec(job.label || '');
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
      btn.addEventListener('click', () => { gotoTab('updates'); gotoSubTab('github'); });
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
  if (!missing.length) { toast(wingetMissing ? '除 winget 外没有缺的。' : '必备环境都齐了。'); return; }
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
$('#github-search-btn').addEventListener('click', async () => {
  const q = $('#github-search-input').value.trim();
  if (!q) { toast('先输入要搜的仓库名'); return; }
  const box = $('#github-list');
  box.className = 'list empty-note'; box.textContent = '正在搜索 GitHub…';
  const r = await window.toolbox.githubSearch(q);
  if (!r.ok) { box.textContent = r.error || '搜索失败'; toast(r.error || '搜索失败'); return; }
  box.innerHTML = '';
  if (!r.items.length) { box.textContent = '没有搜到仓库。'; return; }
  box.className = 'list';
  for (const repo of r.items) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', repo.full_name));
    main.appendChild(el('div', 'row-sub', `${repo.description || '无简介'} · ★ ${repo.stars}${repo.language ? ` · ${repo.language}` : ''}`));
    wrap.appendChild(main);
    const rel = el('button', 'btn small', '查看 Releases');
    rel.type = 'button';
    rel.addEventListener('click', () => loadReleases(repo));
    const open = el('button', 'btn small', '打开 GitHub');
    open.type = 'button';
    open.addEventListener('click', () => window.toolbox.openExternal(repo.html_url));
    wrap.appendChild(rel); wrap.appendChild(open);
    box.appendChild(wrap);
  }
});
$('#github-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#github-search-btn').click(); });

async function loadReleases(repo) {
  const box = $('#github-releases');
  box.className = 'list empty-note'; box.textContent = `正在读取 ${repo.full_name} 的 Releases…`;
  const r = await window.toolbox.githubReleases(repo.owner, repo.name);
  if (!r.ok) { box.textContent = r.error || '读取失败'; toast(r.error || '读取失败'); return; }
  box.innerHTML = '';
  if (!r.releases.length) { box.textContent = '这个仓库没有 Releases。'; return; }
  box.className = 'list';
  for (const rel of r.releases) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${repo.full_name} ${rel.tag}`));
    const assets = (rel.assets || []).map((a) => a.name).join('、') || '无附件';
    main.appendChild(el('div', 'row-sub', `${rel.name || ''} · 附件：${assets}`));
    wrap.appendChild(main);
    let installed = false;
    for (const a of rel.assets || []) {
      if (!/\.(exe|msi)$/i.test(a.name)) continue;
      installed = true;
      const btn = el('button', 'btn small', `安装 ${a.name}`);
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const dr = await window.toolbox.githubReleaseDeps(repo.owner, repo.name, rel.tag);
        if (!dr.ok) { toast(dr.error || '查依赖失败'); return; }
        const deps = dr.deps || [];
        const conflicts = deps.filter((d) => d.conflict).map((d) => `${d.name || d.id}：${d.conflict}`);
        pendingDep = { kind: 'github', assetUrl: a.url, assetName: a.name, repo, deps };
        showDepPanel(dr.note || '', deps, conflicts);
      });
      wrap.appendChild(btn);
    }
    if (!installed) {
      const note = el('span', 'ver', '无 exe / msi 安装包');
      wrap.appendChild(note);
    }
    box.appendChild(wrap);
  }
}

/* ---------- 播放器：应用列表 → VLC 窗口 / 其他播放器 ---------- */
const PLAYER_META = {
  vlc: { name: 'VLC', tile: 'orange', glyph: '▶' },
  potplayer: { name: 'PotPlayer', tile: 'blue', glyph: '▶' },
  mpv: { name: 'mpv', tile: 'gray', glyph: '▶' },
};
let playerAppsCache = {};
let currentOtherPlayer = null;
function showPlayerView(name) {
  $('#player-list-view').classList.toggle('hidden', name !== 'list');
  $('#player-vlc-view').classList.toggle('hidden', name !== 'vlc');
  $('#player-vlc-prefs-view').classList.toggle('hidden', name !== 'prefs');
  $('#player-other-view').classList.toggle('hidden', name !== 'other');
}
$$('[data-goto-player-list]').forEach((b) => b.addEventListener('click', () => showPlayerView('list')));
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
async function playVlcTarget(target) {
  const r = await window.toolbox.vlcPlay(target);
  if (r && r.ok) {
    vlcRecentAdd(target);
    $('#vlc-now-playing').textContent = `正在用 VLC 播放：${target}`;
  } else if (r) toast(r.error || '播放失败');
}
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
  } else if (act === 'back-vlc') {
    showPlayerView('vlc');
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
function showBrowserView(name) {
  $('#browser-list-view').classList.toggle('hidden', name !== 'list');
  $('#browser-chromium-view').classList.toggle('hidden', name !== 'chromium');
  $('#browser-chromium-settings-view').classList.toggle('hidden', name !== 'settings');
  $('#browser-chromium-ext-view').classList.toggle('hidden', name !== 'ext');
  $('#browser-other-view').classList.toggle('hidden', name !== 'other');
}
$$('[data-goto-browser-list]').forEach((b) => b.addEventListener('click', () => showBrowserView('list')));
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
    btn.addEventListener('click', () => { chromeActive = i; $('#chrome-url').value = chromeTabs[i].url; renderChromeTabs(); });
    bar.insertBefore(btn, $('#chrome-new-tab'));
  });
}
function chromeGo(raw) {
  let url = String(raw || '').trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[^\s]+\.[^\s]{2,}$/.test(url)) url = `https://${url}`;
    else url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  chromeTabs[chromeActive].url = url;
  chromeTabs[chromeActive].title = url.replace(/^https?:\/\//, '').split('/')[0] || '新标签页';
  chromeHist.push(url);
  chromeHistIdx = chromeHist.length - 1;
  $('#chrome-url').value = url;
  renderChromeTabs();
  window.toolbox.browserOpenUrl('chromium', url).then((r) => {
    if (r && !r.ok) {
      toast(r.error || '打开失败');
      if (r && r.error && r.error.includes('下载')) renderBrowser();
    }
  });
}
$('#chrome-new-tab').addEventListener('click', () => {
  chromeTabs.push({ title: '新标签页', url: '' });
  chromeActive = chromeTabs.length - 1;
  $('#chrome-url').value = '';
  renderChromeTabs();
});
$('#chrome-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') chromeGo(e.target.value); });
$('#chrome-back').addEventListener('click', () => {
  if (chromeHistIdx > 0) { chromeHistIdx -= 1; const url = chromeHist[chromeHistIdx]; $('#chrome-url').value = url; chromeTabs[chromeActive].url = url; }
});
$('#chrome-forward').addEventListener('click', () => {
  if (chromeHistIdx < chromeHist.length - 1) { chromeHistIdx += 1; const url = chromeHist[chromeHistIdx]; $('#chrome-url').value = url; chromeTabs[chromeActive].url = url; }
});
$('#chrome-reload').addEventListener('click', () => { const url = $('#chrome-url').value.trim(); if (url) chromeGo(url); });
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
  else if (act === 'back-list') showBrowserView('list');
  else if (act === 'back-chromium') showBrowserView('chromium');
}));
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

/* ---------- 设置（含空间调用） ---------- */
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
        if (item.key === 'wintun' && !window.confirm('安装 WinTun 驱动：从官网下载官方包并建立虚拟网卡，需要管理员权限。确定继续吗？')) return;
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
  $('#cfg-vlc-path').value = ov.config.vlcPath || '';
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
  const verEl = $('#titlebar-version');
  if (verEl) verEl.textContent = ov.version || '';
  document.body.classList.toggle('transparent-mode', winCfg.windowTransparent !== false);
  renderBackupSync();
  renderUpdateSection();
  renderWindowStatus();
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

/* 2026-11-26-3：自定义标题栏按钮（无边框窗口） */
$('#win-min').addEventListener('click', () => window.toolbox.windowMinimize());
$('#win-max').addEventListener('click', async () => {
  const r = await window.toolbox.windowMaximize();
  $('#win-max').textContent = r.maximized ? '❐' : '▢';
});
$('#win-close').addEventListener('click', () => window.toolbox.windowClose());
$('#titlebar').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return; // 点按钮不触发
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
$('#pick-vlc').addEventListener('click', async () => {
  const p = await window.toolbox.pickVlc();
  if (p) { await window.toolbox.setConfig({ vlcPath: p }); renderSettings(); renderVlc(); toast('已保存 VLC 路径'); }
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
const PROVIDERS = {
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  doubao: { base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  custom: { base: '', model: '' },
};
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
      main.appendChild(el('div', 'row-sub', `${a.model || ''}${a.hasKey ? ' · 已填密钥' : ' · 未填密钥'}`));
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
async function renderCreate() {
  await fillAgentSelect($('#create-agent'));
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
  const r = await window.toolbox.agentComplete(agentId, `${createSystemPrefix()}\n${CREATE_TASKS[b.dataset.task]}`, input);
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
    img.addEventListener('click', () => window.toolbox.filesOpenPath(f));
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
    ['账目 / 接码记录', `${r.ledgerCount} 条账目 · ${r.registerCount || 0} 条接码记录`],
    ['本地数据量', fmtSize(r.dataSize || 0)],
  ]);
  const ov = await window.toolbox.getOverview().catch(() => null);
  const modeName = { direct: '直连', smart: '智能', global: '全局', manual: '手动 HTTP 代理', tun: 'Tun（暂不可用）' };
  paintRows($('#monitor-proxy'), [
    ['代理模式', ov ? (modeName[ov.config.proxyMode] || ov.config.proxyMode || '直连') : '—'],
    ['空间调用', ov ? (ov.spaceCallEnabled !== false ? '已打开' : '已关闭') : '—'],
  ]);
}
async function renderMonitor() {
  await paintMonitor();
  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    if (document.querySelector('#screen-monitor.active')) paintMonitor();
    else { clearInterval(monitorTimer); monitorTimer = null; }
  }, 5000);
}
$('#monitor-refresh').addEventListener('click', paintMonitor);

/* ----- 记账本：完整记账界面，数据只存本机 ----- */
const LEDGER_DEFAULT_CATS = ['餐饮', '交通', '购物', '住房', '娱乐', '工资', '其他'];
let ledgerCats = [...LEDGER_DEFAULT_CATS];
async function loadLedgerCats() {
  const ov = await window.toolbox.getOverview().catch(() => null);
  if (ov && Array.isArray(ov.config.ledgerCategories) && ov.config.ledgerCategories.length) {
    ledgerCats = ov.config.ledgerCategories;
  }
  const dl = $('#ledger-cat-datalist');
  dl.innerHTML = '';
  for (const c of ledgerCats) {
    const o = document.createElement('option');
    o.value = c;
    dl.appendChild(o);
  }
  const sel = $('#ledger-filter-cat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>';
  for (const c of ledgerCats) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  const list = $('#ledger-cat-list');
  list.innerHTML = '';
  list.className = 'list';
  for (const c of ledgerCats) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', c));
    row.appendChild(main);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      ledgerCats = ledgerCats.filter((x) => x !== c);
      await window.toolbox.setConfig({ ledgerCategories: ledgerCats });
      toast(`分类「${c}」已删除（已有账目不受影响）`);
      loadLedgerCats();
    });
    row.appendChild(del);
    list.appendChild(row);
  }
}
function ledgerMonthValue() {
  const v = $('#ledger-month').value;
  if (v) return v;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
async function renderLedger() {
  await loadLedgerCats();
  if (!$('#ledger-month').value) $('#ledger-month').value = ledgerMonthValue();
  if (!$('#ledger-date').value) {
    const now = new Date();
    $('#ledger-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const list = await window.toolbox.ledgerList().catch(() => []);
  const [y, m] = ledgerMonthValue().split('-').map(Number);
  const kindF = $('#ledger-filter-kind').value;
  const catF = $('#ledger-filter-cat').value;
  const q = ($('#ledger-search').value || '').trim();
  const inMonth = list.filter((x) => {
    const d = new Date(x.at || 0);
    return d.getFullYear() === y && d.getMonth() + 1 === m;
  });
  let out = 0; let inn = 0;
  const catTotals = {};
  for (const x of inMonth) {
    const amt = Number(x.amount) || 0;
    if (x.kind === '收入') inn += amt; else out += amt;
    const k = `${x.kind} · ${x.category || '未分类'}`;
    catTotals[k] = (catTotals[k] || 0) + amt;
  }
  $('#ledger-totals').textContent = `${y}年${m}月：支出 ¥${out.toFixed(2)} · 收入 ¥${inn.toFixed(2)} · 结余 ¥${(inn - out).toFixed(2)}`;
  const catBox = $('#ledger-cat-totals');
  catBox.innerHTML = '';
  const catKeys = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
  if (!catKeys.length) { catBox.className = 'list empty-note'; catBox.textContent = '本月暂无账目。'; }
  else {
    catBox.className = 'list';
    for (const k of catKeys) {
      const row = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', k));
      row.appendChild(main);
      row.appendChild(el('span', 'ver', `¥${catTotals[k].toFixed(2)}`));
      catBox.appendChild(row);
    }
  }
  const shown = inMonth.filter((x) =>
    (!kindF || x.kind === kindF) && (!catF || (x.category || '未分类') === catF) &&
    (!q || (x.note || '').includes(q)));
  const box = $('#ledger-list');
  box.innerHTML = '';
  if (!shown.length) { box.className = 'list empty-note'; box.textContent = '没有符合的账目。'; return; }
  box.className = 'list';
  for (const x of shown) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${x.kind} ¥${Number(x.amount).toFixed(2)} · ${x.category || '未分类'}`));
    main.appendChild(el('div', 'row-sub', `${fmtTime(x.at)}${x.note ? ` · ${x.note}` : ''}`));
    row.appendChild(main);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => { await window.toolbox.ledgerDelete(x.id); renderLedger(); });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#ledger-month').addEventListener('change', renderLedger);
$('#ledger-filter-kind').addEventListener('change', renderLedger);
$('#ledger-filter-cat').addEventListener('change', renderLedger);
$('#ledger-search').addEventListener('input', renderLedger);
$('#ledger-export').addEventListener('click', async () => {
  const r = await window.toolbox.ledgerExport();
  if (r && r.ok) toast(`账本已导出：${r.file}`);
  else toast((r && r.error) || '导出失败');
});
$('#ledger-cat-add').addEventListener('click', async () => {
  const c = $('#ledger-new-cat').value.trim();
  if (!c) { toast('先填分类名称'); return; }
  if (ledgerCats.includes(c)) { toast('分类已存在'); return; }
  ledgerCats = [...ledgerCats, c];
  await window.toolbox.setConfig({ ledgerCategories: ledgerCats });
  $('#ledger-new-cat').value = '';
  toast('分类已添加');
  loadLedgerCats();
});
$('#ledger-add').addEventListener('click', async () => {
  const dateVal = $('#ledger-date').value;
  const r = await window.toolbox.ledgerAdd({
    kind: $('#ledger-kind').value, category: $('#ledger-cat').value.trim(),
    amount: $('#ledger-amount').value, note: $('#ledger-note').value.trim(),
    at: dateVal ? new Date(`${dateVal}T12:00:00`).getTime() : undefined,
  });
  if (!r || r.ok === false) { toast((r && r.error) || '记账失败'); return; }
  $('#ledger-amount').value = ''; $('#ledger-note').value = '';
  toast('已记一笔');
  renderLedger();
});
$('#ledger-clear').addEventListener('click', async () => {
  if (!window.confirm('确定清空全部账目？')) return;
  await window.toolbox.ledgerClear();
  renderLedger();
});

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
  if (!window.confirm('确定清空全部记录？')) return;
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
function paintFiles() {
  const box = $('#files-list');
  const q = ($('#files-search').value || '').trim().toLowerCase();
  const sort = $('#files-sort').value;
  let entries = filesEntries.filter((e) => !q || e.name.toLowerCase().includes(q));
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
  direct: '直连：不走任何代理。',
  smart: '智能：按域名分流，海外 AI 服务走代理，国内服务（DeepSeek、豆包、通义千问）直连。',
  global: '全局：智能体全部请求走代理。',
  manual: '手动 HTTP 代理：智能体、创作、代码、图像与 GitHub 请求走这里填的代理。',
  tun: 'Tun：在全局基础上把空间服务端的网页抓取也接进隧道。',
};
async function renderProxy() {
  renderTunStatus();
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
  if (mode === 'tun') toast('Tun 模式需要 WinTun 驱动：先在下方检测 / 安装，安装与启动都需要管理员权限');
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
    ? `平台 Windows · 管理员权限：${st.admin ? '是' : '否'} · WinTun 驱动：${st.driverInstalled ? '已安装' : '未安装'} · 驱动文件：${st.dllPresent ? '已下载' : '未下载'} · 状态：${st.active ? '运行中' : '未启动'}${st.note ? ` · ${st.note}` : ''}`
    : (st.note || 'Tun 只能在 Windows 上用');
}
$('#tun-check').addEventListener('click', async () => { await renderTunStatus(); toast('Tun 检测完成'); });
$('#tun-install').addEventListener('click', async () => {
  if (!window.confirm('安装 WinTun 驱动：从 WinTun 官网（wintun.net）下载官方安装包并建立虚拟网卡，需要以管理员身份运行工具箱。确定继续吗？')) return;
  toast('正在安装 WinTun 驱动…');
  const r = await window.toolbox.tunInstall().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { toast((r && r.error) || '安装失败'); await renderTunStatus(); return; }
  toast(r.note || 'WinTun 驱动已安装');
  await renderTunStatus();
});
$('#tun-start').addEventListener('click', async () => {
  if (!window.confirm('启动 Tun：建立虚拟网卡并改默认路由，需要管理员权限。确定继续吗？')) return;
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

/* ----- 媒体：本地媒体库 + 最近播放 ----- */
const MEDIA_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.flac', '.wav', '.m4a'];
async function renderMedia() {
  const ov = await window.toolbox.getOverview().catch(() => null);
  const dir = (ov && ov.config.downloadDir) || '';
  const r = await window.toolbox.filesListDir(dir || undefined).catch(() => ({ ok: false, entries: [] }));
  const box = $('#media-list');
  box.innerHTML = '';
  const files = (r.entries || []).filter((e) => !e.isDir && MEDIA_EXTS.some((ext) => e.name.toLowerCase().endsWith(ext)));
  if (!files.length) { box.className = 'list empty-note'; box.textContent = '下载目录里没有媒体文件。'; }
  else {
    box.className = 'list';
    for (const e of files) {
      const row = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', e.name));
      main.appendChild(el('div', 'row-sub', `${fmtSize(e.size)} · ${fmtTime(e.mtime)}`));
      row.appendChild(main);
      const play = el('button', 'btn small primary', '播放');
      play.type = 'button';
      play.addEventListener('click', async () => {
        const sep = (r.dir || '').includes('\\') ? '\\' : '/';
        const full = (r.dir || '').replace(/[\\/]+$/, '') + sep + e.name;
        const rr = await window.toolbox.vlcPlay(full);
        if (rr && rr.ok) { vlcRecentAdd(full); toast('已用 VLC 播放'); }
        else toast((rr && rr.error) || '播放失败');
      });
      row.appendChild(play);
      box.appendChild(row);
    }
  }
  const recent = vlcRecent();
  const rb = $('#media-recent');
  rb.innerHTML = '';
  if (!recent.length) { rb.className = 'list empty-note'; rb.textContent = '最近用工具箱打开过的媒体会列在这里。'; }
  else {
    rb.className = 'list';
    for (const item of recent) {
      const row = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', item.name));
      main.appendChild(el('div', 'row-sub', item.target));
      row.appendChild(main);
      const play = el('button', 'btn small', '播放');
      play.type = 'button';
      play.addEventListener('click', () => playVlcTarget(item.target));
      row.appendChild(play);
      rb.appendChild(row);
    }
  }
}
$('#media-refresh').addEventListener('click', renderMedia);
$('#media-open-player').addEventListener('click', () => gotoScreen('player'));

/* ----- GitHub 专页：登录、搜仓库、看 Releases ----- */
async function renderGh2Status() {
  const st = await window.toolbox.githubStatus();
  $('#gh2-status').textContent = st.hasToken
    ? (st.login ? `已登录：${st.login}` : '已保存令牌，但验证失败，请重新登录。')
    : '未登录：需要个人访问令牌（Personal Access Token）才能搜仓库。';
}
async function renderGh2() {
  renderGh2Status();
}
$('#gh2-token-help').addEventListener('click', () => window.toolbox.openExternal('https://github.com/settings/tokens'));
$('#gh2-login').addEventListener('click', async () => {
  const t = $('#gh2-token').value.trim();
  if (!t) { toast('先粘贴令牌'); return; }
  const r = await window.toolbox.githubSetToken(t);
  if (r.ok) { toast(`已登录：${r.login}`); $('#gh2-token').value = ''; }
  else toast(r.error || '登录失败');
  renderGh2Status();
});
$('#gh2-logout').addEventListener('click', async () => {
  await window.toolbox.githubClearToken();
  toast('令牌已清除');
  renderGh2Status();
});
$('#gh2-search-btn').addEventListener('click', async () => {
  const q = $('#gh2-search-input').value.trim();
  if (!q) { toast('先输入要搜的仓库名'); return; }
  const box = $('#gh2-list');
  box.className = 'list empty-note'; box.textContent = '正在搜索 GitHub…';
  const r = await window.toolbox.githubSearch(q);
  if (!r.ok) { box.textContent = r.error || '搜索失败'; toast(r.error || '搜索失败'); return; }
  box.innerHTML = '';
  if (!r.items.length) { box.textContent = '没有搜到仓库。'; return; }
  box.className = 'list';
  for (const repo of r.items) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', repo.full_name));
    main.appendChild(el('div', 'row-sub', `${repo.description || '无简介'} · ★ ${repo.stars}${repo.language ? ` · ${repo.language}` : ''}`));
    wrap.appendChild(main);
    const rel = el('button', 'btn small', '查看 Releases');
    rel.type = 'button';
    rel.addEventListener('click', () => loadGh2Releases(repo));
    const open = el('button', 'btn small', '打开 GitHub');
    open.type = 'button';
    open.addEventListener('click', () => window.toolbox.openExternal(repo.html_url));
    wrap.appendChild(rel); wrap.appendChild(open);
    box.appendChild(wrap);
  }
});
$('#gh2-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gh2-search-btn').click(); });
$('#gh2-translate-btn').addEventListener('click', async () => {
  const subs = [...document.querySelectorAll('#gh2-list .row-sub')];
  if (!subs.length) { toast('先搜索仓库，列表有内容后再一键翻译'); return; }
  const descs = subs.map((s) => {
    const m = s.textContent.match(/^(.*?) · ★/);
    return m ? m[1] : s.textContent;
  });
  await requestToolTranslation(descs.join('\n\n'), { kind: 'github-list' });
});
async function loadGh2Releases(repo) {
  const box = $('#gh2-releases');
  box.className = 'list empty-note'; box.textContent = `正在读取 ${repo.full_name} 的 Releases…`;
  const r = await window.toolbox.githubReleases(repo.owner, repo.name);
  if (!r.ok) { box.textContent = r.error || '读取失败'; toast(r.error || '读取失败'); return; }
  box.innerHTML = '';
  if (!r.releases.length) { box.textContent = '这个仓库没有 Releases。'; return; }
  box.className = 'list';
  for (const rel of r.releases) {
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${repo.full_name} ${rel.tag}`));
    const assets = (rel.assets || []).map((a) => a.name).join('、') || '无附件';
    main.appendChild(el('div', 'row-sub', `${rel.name || ''} · 附件：${assets}`));
    wrap.appendChild(main);
    let installed = false;
    for (const a of rel.assets || []) {
      if (!/\.(exe|msi)$/i.test(a.name)) continue;
      installed = true;
      const btn = el('button', 'btn small', `安装 ${a.name}`);
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const dr = await window.toolbox.githubReleaseDeps(repo.owner, repo.name, rel.tag);
        if (!dr.ok) { toast(dr.error || '查依赖失败'); return; }
        const deps = dr.deps || [];
        const conflicts = deps.filter((d) => d.conflict).map((d) => `${d.name || d.id}：${d.conflict}`);
        pendingDep = { kind: 'github', assetUrl: a.url, assetName: a.name, repo, deps };
        showDepPanel(dr.note || '', deps, conflicts);
      });
      wrap.appendChild(btn);
    }
    if (!installed) wrap.appendChild(el('span', 'ver', '无 exe / msi 安装包'));
    box.appendChild(wrap);
  }
}


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
      if (!window.confirm(`删除自定义来源「${s.name}」？`)) return;
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
      if (!window.confirm(`删除插件「${p.name}」？它的文件夹会一起删掉。`)) return;
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
    if (window.confirm(`插件要调用 ${e.data.method}（装软件 / 运行代码），确定允许吗？`)) {
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
  if (lastTranslateTarget && lastTranslateTarget.kind === 'github-list') {
    const subs = [...document.querySelectorAll('#gh2-list .row-sub')];
    const parts = d.translated.split(/\n\s*\n/);
    if (subs.length && parts.length === subs.length) {
      subs.forEach((sub, i) => {
        const m = sub.textContent.match(/^(.*?) · ★/);
        if (m) sub.textContent = parts[i].trim() + sub.textContent.slice(m[1].length);
      });
      toast('已替换仓库简介');
      return;
    }
    toast('译文段数与仓库行数不一致，译文已显示在翻译插件页');
    return;
  }
  toast('翻译完成，译文在翻译插件页');
}
function hideTranslateMenu() { document.querySelectorAll('.translate-menu').forEach((m) => m.remove()); }
function showTranslateMenu(x, y, onPick) {
  hideTranslateMenu();
  const menu = document.createElement('div');
  menu.className = 'translate-menu';
  menu.textContent = '翻译所选内容';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.addEventListener('click', () => { hideTranslateMenu(); onPick(); });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', hideTranslateMenu, { once: true }), 0);
}
document.addEventListener('contextmenu', (e) => {
  const screen = document.querySelector('.screen.active');
  const screenId = screen ? screen.id : '';
  if (!screenId || screenId === 'screen-browser' || screenId === 'screen-plugin') return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  e.preventDefault();
  const range = sel.getRangeAt(0).cloneRange();
  const text = sel.toString();
  showTranslateMenu(e.clientX, e.clientY, () => {
    requestToolTranslation(text, { kind: 'selection', range });
  });
});
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
    renderSettings(); renderAgents(); renderLedger(); renderRegister();
  } else if (r && r.needsPassword) {
    const pw = window.prompt('这份备份有密码保护，请输入密码：');
    if (pw == null) return;
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
      if (!window.confirm(`从 ${f.name} 恢复数据？导入前当前数据会自动备份一份。`)) return;
      let res = await window.toolbox.syncImport(f.path);
      if (res && res.needsPassword) {
        const pw = window.prompt('这份备份有密码保护，请输入密码：');
        if (pw == null) return;
        res = await window.toolbox.syncImportPassword(f.path, pw);
      }
      if (res && res.ok) { toast(`已从 ${f.name} 恢复 ${res.files.length} 个数据文件`); renderSettings(); renderAgents(); renderLedger(); renderRegister(); }
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
