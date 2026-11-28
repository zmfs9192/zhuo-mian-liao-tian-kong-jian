'use strict';
/* 桌面工具箱 — 渲染层 2026-11-26-6：主页是桌面聊天空间式布局
 * （无边框窗口、左侧菜单边栏、右侧主内容区），
 * 苹果手机桌面主题已在 v1.4.1 放弃。左侧是「工具箱菜单」，
 * 含 14 项功能：智能体、创作、代码、图像、监控、注册、文件、代理、
 * 数据嗅探、工具箱、软件、播放器、浏览器、账号管理；点工具箱进工具箱
 * 内容，其他功能全部是工具箱自己的实现与本地数据。
 * v1.4.2：同名功能页按空间里的完整界面做（智能体含系统提示、
 * 长期记忆、定时触发；注册、远程、文件、代理均为完整界面），
 * 数据只存本机、与空间不互通；跑不通的功能界面照样做出来并
 * 如实标明暂不可用。
 * 全部经 preload 白名单 IPC 调主进程；本层不碰 Node。
 * 真实功能：winget 工具管理、视频下载、内嵌 VLC 与内嵌浏览器；
 * 电脑端离线也能用很多功能。 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* 2026-11-28-5 设计系统：图标统一线性内联 SVG（Lucide 风格，描边 2px）。
 * 数据表里的 icon/glyph 字段放 SVG 字符串，渲染处用 innerHTML 写入
 * （都是本文件静态字面量，无用户输入）；静态 HTML 里的图标见 index.html。 */
const SVG_ICON = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const SVG_CHEV_L = SVG_ICON('<polyline points="15 18 9 12 15 6"/>');
const SVG_CHEV_D = SVG_ICON('<polyline points="6 9 12 15 18 9"/>');
const SVG_CHEV_R = SVG_ICON('<polyline points="9 18 15 12 9 6"/>');
const SVG_X = SVG_ICON('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
const SVG_DOWNLOAD = SVG_ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
const SVG_PLAY = SVG_ICON('<polygon points="6 3 20 12 6 21 6 3"/>');
const SVG_COMPASS = SVG_ICON('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>');
const SVG_IMAGE = SVG_ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>');
const SVG_APPWIN = SVG_ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>');
const SVG_CODE = SVG_ICON('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
const SVG_MAIL = SVG_ICON('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>');
const SVG_SLIDERS = SVG_ICON('<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>');
const SVG_GRID = SVG_ICON('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>');
const SVG_USER = SVG_ICON('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');
const SVG_MAX = SVG_ICON('<rect x="3" y="3" width="18" height="18" rx="2"/>');
const SVG_RESTORE = SVG_ICON('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
/* 窗口最大化按钮图标随状态切（之前三处直接写 ❐/▢ 文本，会盖掉 index.html 里的 SVG）。 */
function setWinMaxIcon(maximized) { const b = document.querySelector('#win-max'); if (b) b.innerHTML = maximized ? SVG_RESTORE : SVG_MAX; }

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
/* ---------- 2026-11-27-4：右侧抽屉基座与原生视图统一规则 ----------
 * 抽屉容器（#drawer-overlay、<aside id="drawer">，内含 #drawer-title、
 * #drawer-close、#drawer-tabs、#drawer-body、.drawer-status）由 A 路在
 * index.html 末尾建；这里只按契约使用。若 A 路的容器还没建（例如本路
 * 先合入），ensureDrawerDom() 会按同一份契约在 JS 里补建一份，A 路
 * 落地后这段补建不再触发（只做一次事件绑定）。
 * 同一时间只允许一个抽屉或弹窗：开抽屉先关弹窗，反之亦然。
 * 原生视图统一规则：抽屉/弹窗打开、或切离任何一屏时，两个 <webview>
 * 一律停与藏（stop() + 切 about:blank，恢复时按原地址重设 src），
 * 插件 <iframe> 只藏不重置（不丢插件页状态）；恢复只针对当前屏。 */
let customDialogForceClose = null; // showCustomDialog 打开时登记，供 openDrawer 关弹窗用
let drawerState = { open: false, trigger: null, onClose: null };
let drawerDomWired = false;
function ensureDrawerDom() {
  let overlay = document.getElementById('drawer-overlay');
  let drawer = document.getElementById('drawer');
  if (!overlay || !drawer) {
    overlay = document.createElement('div');
    overlay.id = 'drawer-overlay';
    overlay.className = 'drawer-overlay';
    drawer = document.createElement('aside');
    drawer.id = 'drawer';
    drawer.className = 'drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML = '<div class="drawer-head"><p class="drawer-title" id="drawer-title"></p>'
      + '<button type="button" class="btn small" id="drawer-close" aria-label="关闭抽屉">' + SVG_X + '</button></div>'
      + '<div class="drawer-tabs" id="drawer-tabs" role="tablist"></div>'
      + '<div class="drawer-body" id="drawer-body"></div>'
      + '<p class="drawer-status"></p>';
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }
  if (drawerDomWired) return;
  drawerDomWired = true;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDrawer(); });
  const closeBtn = document.getElementById('drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer());
}
function drawerKeyHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDrawer(); }
}
function overlayOpen() { return drawerState.open || !!customDialogResolve; }
function drawerStatusEl() {
  const d = document.getElementById('drawer');
  return d ? d.querySelector('.drawer-status') : null;
}
/* openDrawer({title, tabs:[{id,label,render(pane)}], content?, footer?, onClose})
 * tabs 与 content 二选一：tabs 建 Segmented Control 分组面板；content
 * 直接挂一个已建好的节点（如模板管理、改图面板）。footer 节点挂在面板
 * 下方（保存/删除按钮）。render 回调里 appendChild 已有节点是移动，
 * 不会重复创建；切抽屉时 body 被清空，被移走的节点由各模块在 JS 里
 * 持有引用，下次打开再移回来。 */
/* 抽屉内容暂存区：切抽屉时 body 里的节点（已移入的表单）不能用 innerHTML
 * 清掉——那样节点会脱离文档，之后 $('#id') 找不到它们；改成移入文档内
 * 的隐藏暂存区，下次打开再移回面板。 */
let drawerParking = null;
function ensureDrawerParking() {
  if (!drawerParking) {
    drawerParking = document.createElement('div');
    drawerParking.id = 'drawer-parking';
    drawerParking.style.display = 'none';
    document.body.appendChild(drawerParking);
  }
  return drawerParking;
}
function openDrawer(opts) {
  const o = opts || {};
  if (customDialogForceClose) { try { customDialogForceClose(); } catch (e) { /* 忽略 */ } }
  if (drawerState.open) closeDrawer({ restoreFocus: false });
  ensureDrawerDom();
  ensureDrawerParking();
  const overlay = document.getElementById('drawer-overlay');
  const drawer = document.getElementById('drawer');
  const titleEl = document.getElementById('drawer-title');
  const tabsEl = document.getElementById('drawer-tabs');
  const bodyEl = document.getElementById('drawer-body');
  if (!overlay || !drawer || !tabsEl || !bodyEl) return;
  drawerState.trigger = (document.activeElement && document.contains(document.activeElement))
    ? document.activeElement : null;
  drawerState.onClose = typeof o.onClose === 'function' ? o.onClose : null;
  if (titleEl) titleEl.textContent = o.title || '';
  const statusEl = drawerStatusEl();
  if (statusEl) statusEl.textContent = '';
  while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild); // 切换按钮每次新建，旧的丢弃
  while (bodyEl.firstChild) drawerParking.appendChild(bodyEl.firstChild); // 面板内容移入暂存区，不脱离文档
  const tabs = Array.isArray(o.tabs) ? o.tabs : [];
  if (o.content) {
    tabsEl.classList.add('hidden');
    bodyEl.appendChild(o.content);
  } else if (tabs.length) {
    tabsEl.classList.remove('hidden');
    const panes = [];
    tabs.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tab${i === 0 ? ' active' : ''}`;
      btn.textContent = t.label || t.id || '';
      btn.dataset.drawerTab = t.id || '';
      const pane = document.createElement('div');
      pane.className = 'drawer-pane';
      pane.dataset.drawerPane = t.id || '';
      if (i !== 0) pane.classList.add('hidden');
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        panes.forEach((p) => p.classList.toggle('hidden', p !== pane));
      });
      tabsEl.appendChild(btn);
      bodyEl.appendChild(pane);
      panes.push(pane);
      try { if (typeof t.render === 'function') t.render(pane); } catch (e) { /* 单组渲染失败不拦抽屉打开 */ }
    });
  }
  if (o.footer) bodyEl.appendChild(o.footer);
  overlay.classList.add('open');
  drawer.classList.add('open');
  drawerState.open = true;
  document.addEventListener('keydown', drawerKeyHandler, true);
  suspendNativeViews();
  /* 打开后聚焦抽屉内第一个输入框。注意：抽屉显隐靠 visibility 过渡
   * （0.25s），过渡完成前 visibility 仍是 hidden，此时 focus() 会被
   * 浏览器直接忽略；setTimeout(0) 只在渲染空闲时偶然赶上翻转（沙盒实
   * 测：JS 点击能落上、真实鼠标点击落不上）。因此 0ms 试一次、300ms
   * 再补一次；抽屉已关、或焦点已在抽屉内时不再抢焦点。 */
  const focusFirst = () => {
    try {
      if (!drawerState.open) return;
      if (drawer.contains(document.activeElement)) return;
      const first = bodyEl.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
        || bodyEl.querySelector('button:not([disabled])');
      if (first) first.focus();
    } catch (e) { /* 忽略 */ }
  };
  setTimeout(focusFirst, 0);
  setTimeout(focusFirst, 300);
}
function closeDrawer(opts) {
  const o = opts || {};
  if (!drawerState.open) return;
  document.removeEventListener('keydown', drawerKeyHandler, true);
  const overlay = document.getElementById('drawer-overlay');
  const drawer = document.getElementById('drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  drawerState.open = false;
  syncNativeViewVisibility();
  const cb = drawerState.onClose;
  drawerState.onClose = null;
  if (cb) { try { cb(); } catch (e) { /* 忽略 */ } }
  if (o.restoreFocus !== false && drawerState.trigger && document.contains(drawerState.trigger)) {
    try { drawerState.trigger.focus(); } catch (e) { /* 忽略 */ }
  }
  drawerState.trigger = null;
}
/* ----- 原生视图停/藏/恢复（两个 webview + 插件 iframe） ----- */
function currentChromeUrl() {
  try { return (typeof chromeTabs !== 'undefined' && chromeTabs[chromeActive] && chromeTabs[chromeActive].url) || ''; }
  catch (e) { return ''; }
}
function stopAndBlankWebview(wv) {
  if (!wv) return;
  if (!wv.dataset.savedSrc) {
    const s = wv.getAttribute('src') || '';
    if (s && s !== 'about:blank') wv.dataset.savedSrc = s;
  }
  try { if (typeof wv.stop === 'function') wv.stop(); } catch (e) { /* 未在加载时忽略 */ }
  try { wv.setAttribute('src', 'about:blank'); } catch (e) { /* 忽略 */ }
  wv.style.display = 'none';
}
function restoreWebview(wv, fallbackUrl) {
  if (!wv) return;
  const url = (wv.dataset && wv.dataset.savedSrc) || fallbackUrl || '';
  if (url && wv.getAttribute('src') !== url) {
    try { wv.setAttribute('src', url); } catch (e) { /* 忽略 */ }
  }
  if (wv.dataset) delete wv.dataset.savedSrc;
  wv.style.display = '';
}
/* 切离任何一屏 / 打开抽屉或弹窗时调用：内嵌浏览器 webview 停与藏，
 * 插件 iframe 只藏（不重置 src，不丢插件页状态）。 */
function suspendNativeViews() {
  stopAndBlankWebview(document.getElementById('toolbox-webview'));
  const fr = document.getElementById('plugin-frame');
  if (fr) fr.style.display = 'none';
}
/* 按当前屏与遮罩状态同步原生视图的显隐；只恢复当前屏的那一个，
 * 恢复时按原地址（savedSrc 优先，其次当前标签页地址）重设 src。 */
function syncNativeViewVisibility() {
  const blocked = overlayOpen();
  const tb = document.getElementById('toolbox-webview');
  if (tb) {
    if (blocked) stopAndBlankWebview(tb);
    else if (currentScreen === 'browser' && currentBrowserView === 'chromium') restoreWebview(tb, currentChromeUrl());
    else tb.style.display = 'none';
  }
  const fr = document.getElementById('plugin-frame');
  if (fr) fr.style.display = (blocked || currentScreen !== 'plugin') ? 'none' : '';
}
/* ---------- 2026-11-27-4：异步反馈模板与删除确认 ----------
 * 以更新页为模板：点击 → 禁用 + 进行中文字 → 成功 toast + 行内状态 →
 * 失败行内写具体原因（后端 error，无则写明哪一步失败）。beginAsync 返回
 * finish(ok, msg)：恢复按钮、写行内状态、有 msg 时 toast。行内状态优先
 * 用抽屉的 .drawer-status，否则用按钮旁新建的 .async-status。 */
function ensureAsyncStatus(btn) {
  if (!btn || !btn.parentElement) return null;
  let s = btn.parentElement.querySelector(':scope > .async-status');
  if (!s) {
    s = document.createElement('span');
    s.className = 'async-status hint';
    btn.insertAdjacentElement('afterend', s);
  }
  return s;
}
function beginAsync(btn, runningText, statusEl) {
  if (!btn) return () => {};
  const prevText = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  if (runningText) btn.textContent = runningText;
  const status = statusEl || (btn.closest('#drawer') ? drawerStatusEl() : ensureAsyncStatus(btn));
  if (status) status.textContent = runningText || '';
  let done = false;
  return (ok, msg) => {
    if (done) return;
    done = true;
    btn.disabled = wasDisabled;
    btn.textContent = prevText;
    if (status) status.textContent = msg || '';
    if (msg) toast(msg);
  };
}
async function confirmDelete(title, what, note) {
  return customConfirm(title, `删除「${what}」？${note || '删除后无法恢复。'}`);
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
    if (drawerState.open) closeDrawer({ restoreFocus: false }); // 同一时间只允许一个抽屉或弹窗
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
      customDialogForceClose = null;
      overlay.classList.add('hidden');
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      syncNativeViewVisibility();
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
    customDialogForceClose = close; // openDrawer 关弹窗时用
    suspendNativeViews();
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
const SCREEN_MENU_KEY = { home: 'toolbox', plugin: 'plugin' };
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
    if (currentScreen === 'player' && currentPlayerView === 'vlc') stopEmbeddedMedia();
    /* 2026-11-27-4：切屏统一规则——离开任何一屏时，内嵌浏览器 webview
     * 一律停与藏。 */
    suspendNativeViews();
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
  if (typeof updateSniffFab === 'function') updateSniffFab();
  updateBackButtons();
  syncNativeViewVisibility(); // 进入浏览器/插件屏时恢复对应原生视图
}
function goBack() {
  /* 2026-11-27-10，第 2 项：返回只在当前功能内部向上一层——栈顶不是当前
   * 屏的条目一律不动，不跳转去别的功能；当前功能内没有上一层时不做任何事。 */
  const top = navStack[navStack.length - 1];
  if (!top || top.screen !== currentScreen) return;
  navStack.pop();
  suppressNavPush = true;
  try {
    gotoScreen(top.screen);
    if (top.screen === 'player' && top.view) showPlayerView(top.view);
    else if (top.screen === 'browser' && top.view) showBrowserView(top.view);
  } finally { suppressNavPush = false; }
  setMenuActive(SCREEN_MENU_KEY[top.screen] || top.screen);
  updateBackButtons();
}
/* 当前功能内没有上一层时，返回按钮藏起来（不留一个点上去没反应的按钮）。
 * 只看栈顶：goBack 也只弹栈顶；栈里更深处同屏的旧条目不算（切屏历史会留
 * 下这种旧条目，算进去会让按钮该藏时不藏）。 */
function updateBackButtons() {
  const top = navStack[navStack.length - 1];
  const hasPrev = !!top && top.screen === currentScreen;
  $$('[data-nav="back"]').forEach((b) => {
    const sec = b.closest('.screen');
    const name = sec ? sec.id.replace('screen-', '') : '';
    b.classList.toggle('hidden', !(name === currentScreen && hasPrev));
  });
}
$$('[data-screen]').forEach((b) => b.addEventListener('click', () => gotoScreen(b.dataset.screen)));
$$('[data-nav="back"]').forEach((b) => b.addEventListener('click', goBack));
window.toolbox.on('test-goto', (msg) => {
  gotoScreen(msg);
});

/* ---------- 工具箱菜单 / 底部导航 / 最近聊天 ---------- */
/* 菜单 14 项（见 index.html 的 menu-grid）：智能体、创作、代码、图像、
 * 监控、注册、文件、代理、数据嗅探、工具箱、软件、播放器、浏览器、
 * 账号管理。2026-11-27-2：媒体入口已去掉（播放器保留），不要再加回来。
 * 2026-11-28-3：远程页已删除（曾是空间小助手连接本机的入口）。
 * 全部菜单项打开工具箱自己的页面（本地实现与数据）。 */
/* 2026-11-28-7：第 3 项：菜单分离为独立窗口——菜单窗口是同一份
 * index.html 带 ?menu=1 打开的第二个 BrowserWindow，渲染层按此
 * 只显示侧栏（见 styles.css 的 .menu-window）；点菜单项经 IPC
 * 转发回主窗口切页，本窗口不切页。 */
const IS_MENU_WINDOW = new URLSearchParams(location.search).get('menu') === '1';
function applyMenuDetached(detached) {
  document.body.classList.toggle('menu-detached', !!detached);
}
function setMenuActive(key) {
  $$('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.menu === key));
}
const MENU_ROUTE = {
  agents: () => { gotoScreen('agents'); renderAgents(); },
  create: () => { gotoScreen('create'); renderCreate(); },
  code: () => { gotoScreen('code'); renderCode(); },
  image: () => { gotoScreen('image'); renderImages(); },
  monitor: () => { gotoScreen('monitor'); renderMonitor(); },
  register: () => { gotoScreen('register'); renderRegister(); },
  files: () => { gotoScreen('files'); renderFiles(); },
  proxy: () => { gotoScreen('proxy'); renderProxy(); },
  video: () => { gotoScreen('video'); renderVideo(); },
  toolbox: () => gotoScreen('home'),
  apps: () => { gotoScreen('apps'); renderToolboxApps(); },
  tools: () => gotoScreen('tools'),
  player: () => gotoScreen('player'),
  browser: () => gotoScreen('browser'),
  accounts: () => { gotoScreen('accounts'); renderAccounts(); },
  newchat: () => newAgentChat(),
};
function openMenuItem(key) {
  if (key === 'newchat') { setMenuActive('agents'); newAgentChat(); return; }
  if (key === 'screentranslate') { startScreenTranslateFromUi(); return; }
  if (typeof key === 'string' && key.startsWith('plugin:')) { openPlugin(key.slice(7)); return; }
  setMenuActive(key);
  (MENU_ROUTE[key] || (() => gotoScreen('home')))();
}
/* 2026-11-28-6：屏幕翻译入口（菜单、设置页按钮共用）——
 * 未配轮巡时主进程返回明确提示，浮窗里直接说原因与去处。 */
async function startScreenTranslateFromUi() {
  const r = await window.toolbox.screenTranslateStart().catch(() => null);
  // 未配轮巡时主进程已开浮窗说明原因与去处，不再重复弹提示；
  // 只有无 code 的意外失败才 toast。
  if (r && r.ok === false && !r.code && r.error) toast(r.error);
}
$$('.menu-item').forEach((b) => b.addEventListener('click', () => {
  const key = b.dataset.menu;
  if (IS_MENU_WINDOW) {
    if (key !== 'screentranslate') setMenuActive(key);
    window.toolbox.menuNavigate(key).catch(() => { /* 转发失败不影响 */ });
    return;
  }
  openMenuItem(key);
}));
$('#sidebar-new-chat').addEventListener('click', () => {
  if (IS_MENU_WINDOW) { window.toolbox.menuNavigate('newchat').catch(() => {}); return; }
  openMenuItem('newchat');
});
/* 左下角设置：点齿轮进设置，只用点击，不用手势 */
$('#sidebar-settings').addEventListener('click', () => {
  if (IS_MENU_WINDOW) { window.toolbox.menuNavigate('settings').catch(() => {}); return; }
  setMenuActive('toolbox'); gotoScreen('settings');
});
/* 2026-11-28-7：第 3 项：分离菜单 / 合并回主窗口 / 菜单窗口置顶。 */
$('#menu-detach').addEventListener('click', async () => {
  const r = await window.toolbox.menuDetachOpen().catch(() => null);
  if (r && r.ok) toast('菜单已分离到独立窗口');
  else toast((r && r.error) || '菜单分离失败');
});
$('#menu-merge-back').addEventListener('click', async () => {
  await window.toolbox.menuDetachClose().catch(() => {});
});
$('#menu-pin').addEventListener('click', async (e) => {
  const r = await window.toolbox.menuPinToggle().catch(() => null);
  if (r && r.ok) e.currentTarget.textContent = r.pinned ? '取消置顶' : '置顶';
  else toast((r && r.error) || '置顶切换失败');
});
if (typeof window.toolbox.on === 'function') {
  // 主窗口收到菜单窗口的点菜单：settings 单独处理，其余走 openMenuItem。
  window.toolbox.on('menu-navigate', (msg) => {
    const key = msg && msg.menu;
    if (!key) return;
    if (key === 'settings') { setMenuActive('toolbox'); gotoScreen('settings'); return; }
    openMenuItem(key);
  });
  window.toolbox.on('menu-detached', (msg) => { if (!IS_MENU_WINDOW) applyMenuDetached(msg && msg.detached); });
  // 2026-11-28-8：主进程崩溃后的重启恢复提示。
  window.toolbox.on('crash-recovered', (marker) => {
    toast(`上次启动异常退出${marker && marker.message ? `（${marker.message}）` : ''}，诊断日志已保存，可在设置 → 备份与同步 → 诊断日志里导出。`);
    renderDiagnostics();
  });
}
if (IS_MENU_WINDOW) {
  document.documentElement.classList.add('menu-window');
  document.body.classList.add('menu-window');
  (async () => {
    try {
      const ov = await window.toolbox.getOverview();
      const pin = $('#menu-pin');
      if (pin && ov && ov.config && ov.config.menuWindowPinned === true) pin.textContent = '取消置顶';
    } catch (e) { /* 读不到按未置顶 */ }
  })();
}
$('#sidebar-collapse-recent').addEventListener('click', () => $('#recent-block').classList.toggle('collapsed'));
/* 2026-11-28-4，第 13 项：收起边栏时清掉行内宽度（collapsed 的 84px
 * 才生效），展开时恢复拖出来的宽度。 */
let sidebarWidthSaved = 340;
$('#sidebar-collapse').addEventListener('click', () => {
  const sb = $('#sidebar');
  if (!sb.classList.contains('collapsed')) sidebarWidthSaved = sb.offsetWidth || 340;
  const collapsed = sb.classList.toggle('collapsed');
  if (collapsed) sb.style.width = '';
  else sb.style.width = `${sidebarWidthSaved}px`;
});
/* ---------- 2026-11-28-4，第 13 项：菜单与窗口独立缩放 ----------
 * 分隔条拖动调菜单宽（200–480px，存配置，下次打开恢复）；缩放按钮
 * 调整整页缩放（webFrame，80%–150%，步进 10%，存配置）；“贴合”一键
 * 恢复默认（菜单 340px、缩放 100%）。缩放是整页缩放，布局随窗口
 * 重排，不会出现错位或溢出（只是整体放大/缩小）。 */
const SIDEBAR_WIDTH_DEFAULT = 340;
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 480;
const UI_ZOOM_MIN = 0.8;
const UI_ZOOM_MAX = 1.5;
function applySidebarWidth(w) {
  const sb = $('#sidebar');
  if (!sb) return;
  const width = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Number(w) || SIDEBAR_WIDTH_DEFAULT));
  sidebarWidthSaved = width;
  if (!sb.classList.contains('collapsed')) sb.style.width = `${width}px`;
}
function applyUiZoom(z) {
  const zoom = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Number(z) || 1));
  const r = window.toolbox.setZoomFactor(zoom);
  const pct = $('#zoom-pct');
  if (pct) pct.textContent = `${Math.round(((r && r.zoom) || zoom) * 100)}%`;
  return zoom;
}
async function saveLayoutConfig(patch) {
  try { await window.toolbox.setConfig(patch); } catch (e) { /* 存不下不影响 */ }
}
$('#zoom-out').addEventListener('click', async () => {
  const cur = (window.toolbox.getZoomFactor().zoom) || 1;
  const z = applyUiZoom(Math.round((cur - 0.1) * 10) / 10);
  await saveLayoutConfig({ uiZoom: z });
});
$('#zoom-in').addEventListener('click', async () => {
  const cur = (window.toolbox.getZoomFactor().zoom) || 1;
  const z = applyUiZoom(Math.round((cur + 0.1) * 10) / 10);
  await saveLayoutConfig({ uiZoom: z });
});
$('#layout-snap').addEventListener('click', async () => {
  const sb = $('#sidebar');
  if (sb) sb.classList.remove('collapsed');
  applySidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  applyUiZoom(1);
  await saveLayoutConfig({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT, uiZoom: 1 });
  toast('已恢复默认布局');
});
(function () {
  const resizer = $('#shell-resizer');
  const sb = $('#sidebar');
  if (!resizer || !sb) return;
  let dragging = false, startX = 0, startW = 0;
  resizer.addEventListener('pointerdown', (e) => {
    if (sb.classList.contains('collapsed')) return; // 收起时不调宽
    dragging = true; startX = e.clientX; startW = sb.offsetWidth;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applySidebarWidth(startW + (e.clientX - startX));
  });
  const end = async () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    await saveLayoutConfig({ sidebarWidth: sidebarWidthSaved });
  };
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);
})();
(async () => {
  // 启动时恢复上次的菜单宽度与缩放（只读配置，不改）。
  try {
    const ov = await window.toolbox.getOverview();
    const cfg = (ov && ov.config) || {};
    if (cfg.sidebarWidth) applySidebarWidth(cfg.sidebarWidth);
    if (cfg.uiZoom) applyUiZoom(cfg.uiZoom);
    if (cfg.menuDetached && !IS_MENU_WINDOW) applyMenuDetached(true);
  } catch (e) { /* 读不到按默认布局 */ }
})();
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

/* ---------- 工具管理 ---------- */
function gotoTab(name) {
  $$('#screen-tools > .tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('#screen-tools .tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}
/* 只绑顶层四个页签：已安装里的分类按钮也在 #screen-tools 内、同样是 .tab，
 * 以前这里全量绑定，点分类会调 gotoTab(undefined)，全部 tabpane 失活导致白屏。 */
$$('#screen-tools > .tabs .tab').forEach((b) => b.addEventListener('click', () => { gotoTab(b.dataset.tab); if (b.dataset.tab === 'recommended') renderRecommended(); }));
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
      addBtn('打开', 'btn small', () => openToolboxRow(toolDetailRow));
      // 转移只给 winget 装的：便携版（VLC/Chromium）本来就在工具箱管理目录下。
      if (row.source === 'toolbox-winget') addBtn('转移', 'btn small', () => moveInstalled(toolDetailRow, null));
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
    // 2026-11-28-4，第 8 项：已安装页只列文件还在的行——台账有记录但
    // 文件已不在的行（found=false）不是“已安装”，它只在软件页里以
    // “清理记录”出现；以前两边都出现，同一软件既显示已安装又显示
    // 未安装。视频引擎行 found 恒为 true，不受影响。
    if (r.found === false) return false;
    if (installedCat !== 'all' && classifyInstalled(r) !== installedCat) return false;
    /* 引擎行按名字、标识、来源、路径都能搜到。 */
    if (q && !`${r.name || ''} ${r.id || ''} ${r.source || ''} ${r.path || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderInstalledRows(rows) {
  const box = $('#installed-list');
  box.innerHTML = '';
  // 2026-11-28-4，第 8 项：总数只算文件还在的行（与 installedVisibleRows
  // 的过滤一致），不把“记录在但文件已不在”的行算进已安装总数。
  const total = installedRows.filter((r) => r.found !== false).length;
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
      { const tile = el('span', 'row-icon tile-c2'); tile.innerHTML = SVG_DOWNLOAD; btn.appendChild(tile); }
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
    /* 只留最小信息：引擎行显示“视频下载引擎 · 所在路径”，普通行显示标识；
     * 文件已不在的行把台账备注也写上（如“记录在但文件已不在”）。 */
    main.appendChild(el('div', 'row-sub', isEngine ? `视频下载引擎${row.path ? ` · ${row.path}` : ''}` : ((row.id || '') + (row.found === false && row.note ? ` · ${row.note}` : ''))));
    wrap.appendChild(main);
    wrap.appendChild(el('span', 'ver', row.version || ''));
    const prog = el('div', 'row-progress', '');
    prog.dataset.rowId = row.id || '';
    /* 视频下载引擎不是 winget 包：不挂打开/转移/卸载按钮（不要给它们挂 winget 卸载）。 */
    if (!isEngine) {
      const openBtn = el('button', 'btn small', '打开');
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => openToolboxRow(row));
      wrap.appendChild(openBtn);
      // 转移只给 winget 装的：便携版（VLC/Chromium）本来就在工具箱管理目录下。
      if (row.source === 'toolbox-winget') {
        const moveBtn = el('button', 'btn small', '转移');
        moveBtn.type = 'button';
        moveBtn.addEventListener('click', () => moveInstalled(row, moveBtn));
        wrap.appendChild(moveBtn);
      }
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
/* 已安装页 / 软件页 / 详情抽屉共用的“打开”：浏览器走内嵌，播放器拉起窗口。 */
async function openToolboxRow(row) {
  const r = await window.toolbox.toolboxAppsOpen(row.id);
  if (r && !r.ok) toast(r.error || '打开失败');
}
async function openInstalledDir(row) {
  const r = await callTb('installedOpenDir', row.wingetId || row.id);
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
  const r = await callTb('installedMoveToTools', row.wingetId || row.id);
  if (btn) { btn.disabled = false; btn.textContent = old; }
  if (!r || r.ok === false) { toast((r && r.error) || '转移失败'); return; }
  /* 主进程返回的新结构：to/movedTo 是新目录，note 里写清改了几个快捷方式、
   * 几项注册表；旧字段 r.to 仍保留兼容。 */
  toast(r.note || ((r.movedTo || r.to) ? `已转移到：${r.movedTo || r.to}` : '已转移'));
  loadInstalled();
}
async function uninstallInstalled(row, btn, prog) {
  if (row.kind === 'video-engine' || row.source === 'video-engine') { toast('视频下载引擎不是 winget 安装的软件，不能在这里卸载；删掉 tools/video/ 下对应的 exe 文件即可'); return; }
  // 2026-11-28-12，第 4 项：卸载要确认框；便携版删工具箱管理目录，
  // winget 装的走 winget 卸载；都走 toolbox-apps-uninstall 一个口子。
  const portable = row.source === 'toolbox-portable';
  const ok = await customConfirm('卸载软件',
    portable
      ? `确定卸载「${row.name || row.id}」吗？将删除工具箱管理目录里它的程序与数据。`
      : `确定卸载「${row.name || row.id}」吗？将用 winget 卸载。`, '卸载');
  if (!ok) return;
  if (btn) btn.disabled = true;
  if (prog) prog.textContent = '卸载中…';
  const r = await window.toolbox.toolboxAppsUninstall(row.id);
  if (btn) btn.disabled = false;
  if (!r || !r.ok) { toast((r && r.error) || '卸载失败'); if (prog) prog.textContent = ''; return; }
  if (portable) { toast(`已卸载：${row.name || row.id}`); loadInstalled(); renderToolboxApps(); renderRecommended(); }
  else { toast('正在卸载，完成后列表会自动刷新'); if (prog) prog.textContent = '卸载中…'; }
}

async function loadInstalled() {
  const box = $('#installed-list');
  box.className = 'list empty-note'; box.textContent = '正在读取…';
  // 2026-11-28-12，第 5 项：已安装只列工具箱内安装的（台账 + 便携版 +
  // 视频引擎），不再用 winget list 全系统扫。行形沿用旧的 {id,...}，
  // key 映射到 id，wingetId 另留着给转移/打开目录用。
  const r = await window.toolbox.toolboxAppsList();
  installedRows = (r.rows || []).map((x) => ({ ...x, id: x.key, wingetId: x.wingetId || '' }));
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

/* ---------- 软件（2026-11-28-12，第 7 项）：工具箱内安装的软件 ----------
 * 只列工具箱自己装的（台账 + 便携版 + 视频引擎），每行都显示已安装/
 * 未安装，装了的能打开、能卸载；文件已不在的只剩“清理记录”。 */
async function renderToolboxApps() {
  const box = $('#toolbox-apps-list');
  if (!box) return;
  box.className = 'list empty-note'; box.textContent = '正在读取…';
  const r = await window.toolbox.toolboxAppsList().catch(() => null);
  const rows = (r && r.rows) || [];
  box.innerHTML = '';
  if (!rows.length) { box.textContent = '工具箱里还没装软件，去「工具管理 · 推荐软件」安装。'; return; }
  box.className = 'list';
  for (const row of rows) {
    const wrap = el('div', 'row');
    wrap.dataset.appKey = row.key;
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', row.name || row.key));
    const kindLabel = row.kind === 'video-engine' ? '视频下载引擎' : row.kind === 'player' ? '播放器' : row.kind === 'browser' ? '浏览器' : (row.kind || '');
    const sub = `${kindLabel}${row.version ? ` · ${row.version}` : ''} · ${row.found ? '已安装' : '未安装'}${row.path ? ` · ${row.path}` : ''}${!row.found && row.note ? ` · ${row.note}` : ''}`;
    main.appendChild(el('div', 'row-sub', sub));
    wrap.appendChild(main);
    wrap.appendChild(el('span', 'ver', row.found ? '已安装' : '未安装'));
    if (row.kind === 'video-engine') { box.appendChild(wrap); continue; }
    if (row.found) {
      const openBtn = el('button', 'btn small', '打开');
      openBtn.type = 'button';
      openBtn.addEventListener('click', async () => {
        const res = await window.toolbox.toolboxAppsOpen(row.key);
        if (res && !res.ok) toast(res.error || '打开失败');
      });
      wrap.appendChild(openBtn);
    }
    const unBtn = el('button', 'btn small danger', row.found ? '卸载' : '清理记录');
    unBtn.type = 'button';
    unBtn.addEventListener('click', () => uninstallToolboxAppRow(row, wrap));
    wrap.appendChild(unBtn);
    box.appendChild(wrap);
  }
}
async function uninstallToolboxAppRow(row, wrap) {
  if (!row.found) {
    if (!await customConfirm('清理记录', `「${row.name || row.key}」的文件已不在，只删除工具箱里的这条安装记录，不动别的东西。`, '清理记录')) return;
    const r = await window.toolbox.toolboxAppsRemove(row.key);
    if (r && r.ok) { toast('记录已清理'); renderToolboxApps(); loadInstalled(); }
    else toast((r && r.error) || '清理失败');
    return;
  }
  const portable = row.source === 'toolbox-portable';
  if (!await customConfirm('卸载软件', portable
    ? `确定卸载「${row.name || row.key}」吗？将删除工具箱管理目录里它的程序与数据。`
    : `确定卸载「${row.name || row.key}」吗？将用 winget 卸载。`, '卸载')) return;
  const btns = wrap ? [...wrap.querySelectorAll('button')] : [];
  btns.forEach((b) => { b.disabled = true; });
  const r = await window.toolbox.toolboxAppsUninstall(row.key);
  if (r && r.ok) {
    if (portable) { toast(`已卸载：${row.name || row.key}`); renderToolboxApps(); loadInstalled(); renderRecommended(); }
    else toast('正在卸载，完成后列表会自动刷新');
  } else {
    toast((r && r.error) || '卸载失败');
    btns.forEach((b) => { b.disabled = false; });
  }
}
$('#apps-goto-recommended').addEventListener('click', () => { gotoScreen('tools'); gotoTab('recommended'); });

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
    // 2026-11-28-12，第 3 项：推荐页与软件页的状态跟着刷新（装好变“已安装”）。
    renderRecommended();
    renderToolboxApps();
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

/* 2026-11-28-4，第 9 项：推荐软件改应用商城式——按类别分组、卡片式展示，
 * 每类几个常用必备软件；仍走现有 winget 安装流程（依赖确认卡不变），
 * 安装状态与软件页台账同源（playerApps/browserApps/台账）。
 * wingetId 按公开 winget 清单核对：Bandizip（Bandisoft.Bandizip）与
 * Notion（Notion.Notion）未在沙盒里逐条验证，需真 Windows 上确认。 */
const RECOMMENDED_CATEGORIES = [
  { id: 'browser', title: '浏览器', icon: SVG_COMPASS, apps: [
    { key: 'chrome', kind: 'browser', name: 'Chrome', wingetId: 'Google.Chrome', desc: '最常用的浏览器' },
    { key: 'edge', kind: 'browser', name: 'Edge', wingetId: 'Microsoft.Edge', desc: 'Windows 自带浏览器' },
    { key: 'firefox', kind: 'browser', name: 'Firefox', wingetId: 'Mozilla.Firefox', desc: '开源浏览器，注重隐私' },
  ] },
  { id: 'player', title: '播放器', icon: SVG_PLAY, apps: [
    { key: 'vlc', kind: 'player', name: 'VLC', wingetId: 'VideoLAN.VLC', desc: '万能播放器，格式全' },
    { key: 'potplayer', kind: 'player', name: 'PotPlayer', wingetId: 'DAUM.PotPlayer', desc: '轻量高清播放器' },
    { key: 'mpv', kind: 'player', name: 'mpv', wingetId: 'mpv.mpv', desc: '开源极简播放器' },
  ] },
  { id: 'compress', title: '压缩解压', icon: SVG_IMAGE, apps: [
    { key: '7zip', kind: 'tool', name: '7-Zip', wingetId: '7zip.7zip', desc: '免费开源解压缩' },
    { key: 'bandizip', kind: 'tool', name: 'Bandizip', wingetId: 'Bandisoft.Bandizip', desc: '解压快，支持分卷' },
  ] },
  { id: 'office', title: '办公', icon: SVG_APPWIN, apps: [
    { key: 'libreoffice', kind: 'tool', name: 'LibreOffice', wingetId: 'TheDocumentFoundation.LibreOffice', desc: '免费开源办公套件' },
    { key: 'notion', kind: 'tool', name: 'Notion', wingetId: 'Notion.Notion', desc: '笔记与团队协作' },
  ] },
  { id: 'dev', title: '开发工具', icon: SVG_CODE, apps: [
    { key: 'vscode', kind: 'tool', name: 'VS Code', wingetId: 'Microsoft.VisualStudioCode', desc: '最常用的代码编辑器' },
    { key: 'git', kind: 'tool', name: 'Git', wingetId: 'Git.Git', desc: '版本控制，开发必备' },
  ] },
  { id: 'social', title: '通讯社交', icon: SVG_MAIL, apps: [
    { key: 'telegram', kind: 'tool', name: 'Telegram', wingetId: 'Telegram.TelegramDesktop', desc: '即时通讯' },
    { key: 'discord', kind: 'tool', name: 'Discord', wingetId: 'Discord.Discord', desc: '社群语音聊天' },
  ] },
  { id: 'system', title: '系统工具', icon: SVG_SLIDERS, apps: [
    { key: 'powertoys', kind: 'tool', name: 'PowerToys', wingetId: 'Microsoft.PowerToys', desc: 'Windows 官方效率工具集' },
    { key: 'everything', kind: 'tool', name: 'Everything', wingetId: 'voidtools.Everything', desc: '秒搜全盘文件' },
    { key: 'geekuninstaller', kind: 'tool', name: 'Geek Uninstaller', wingetId: 'GeekUninstaller.GeekUninstaller', desc: '干净卸载残留' },
  ] },
];
/* 2026-11-28-12，第 3 项：推荐软件原地安装——点安装立刻有反应（先显示
 * “正在查依赖…”），依赖确认卡就嵌在推荐页签里，不跳去别的页签；
 * winget 装的走 winget；装好后状态变“已安装”，旁边有“打开 / 卸载”。
 * 行内进度用 .row-progress[data-row-id]，winget-job 事件与
 * component-progress 事件直接往里写进度，复用现有机制。 */
let recommendedDepPending = null; // {app, depIds}
async function renderRecommended() {
  const box = $('#recommended-list');
  if (!box) return;
  box.className = 'list empty-note'; box.textContent = '正在读取安装状态…';
  const [players, browsers, appsList] = await Promise.all([
    window.toolbox.playerApps().catch(() => ({})),
    window.toolbox.browserApps().catch(() => ({})),
    window.toolbox.toolboxAppsList().catch(() => ({ rows: [] })),
  ]);
  const status = { ...players, ...browsers };
  // 工具类软件的状态只看台账（与软件页同源）：按 key 或 wingetId 匹配。
  for (const row of (appsList.rows || [])) {
    if (!row) continue;
    const found = !!row.found;
    if (row.key) status[row.key] = { found, path: row.path || '' };
    if (row.wingetId) status[row.wingetId] = { found, path: row.path || '' };
  }
  box.innerHTML = '';
  box.className = 'store';
  for (const cat of RECOMMENDED_CATEGORIES) {
    { const h = el('h2', 'store-cat'); h.innerHTML = `${cat.icon} ${cat.title}`; box.appendChild(h); }
    const grid = el('div', 'store-grid');
    for (const app of cat.apps) {
      const st = status[app.key] || status[app.wingetId] || {};
      const card = el('div', 'store-card');
      card.dataset.appKey = app.key;
      { const ic = el('div', 'store-icon'); ic.innerHTML = cat.icon; card.appendChild(ic); }
      card.appendChild(el('div', 'store-name', app.name));
      card.appendChild(el('div', 'store-desc', app.desc || ''));
      // 行内进度：winget 任务按 wingetId 写。
      const prog = el('div', 'row-progress');
      prog.dataset.rowId = app.wingetId || app.key;
      card.appendChild(prog);
      const foot = el('div', 'store-foot');
      if (st.found) {
        foot.appendChild(el('span', 'store-status', '已安装'));
        const openBtn = el('button', 'btn small', '打开');
        openBtn.type = 'button';
        openBtn.addEventListener('click', () => recommendedOpen(app));
        foot.appendChild(openBtn);
        const unBtn = el('button', 'btn small', '卸载');
        unBtn.type = 'button';
        unBtn.addEventListener('click', () => recommendedUninstall(app, card));
        foot.appendChild(unBtn);
      } else {
        foot.appendChild(el('span', 'store-status', '未安装'));
        const btn = el('button', 'btn small primary', '安装');
        btn.type = 'button';
        btn.addEventListener('click', () => recommendedInstall(app, btn, prog));
        foot.appendChild(btn);
      }
      card.appendChild(foot);
      grid.appendChild(card);
    }
    box.appendChild(grid);
  }
}
function recommendedOpen(app) {
  // 只有 Chrome/Edge 走内嵌浏览器；Firefox 是独立桌面浏览器、工具类
  // 是独立程序，都走台账 exe 拉起（toolboxAppsOpen）。
  if (app.kind === 'browser' && (app.key === 'chrome' || app.key === 'edge')) { gotoScreen('browser'); openBrowserApp(app.key); return; }
  window.toolbox.toolboxAppsOpen(app.key).then((r) => { if (r && !r.ok) toast(r.error || '打开失败'); });
}
async function recommendedInstall(app, btn, prog) {
  // 点下立刻有反应：先变文案，再去查依赖（winget show 最长 90 秒）。
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '正在查依赖…';
  if (prog) prog.textContent = '正在查依赖…';
  try {
    const r = await window.toolbox.wingetDeps(app.wingetId);
    if (!r || !r.available) { toast((r && r.note) || '无法查依赖'); btn.disabled = false; btn.textContent = oldText; if (prog) prog.textContent = ''; return; }
    const deps = r.deps || [];
    const missing = deps.filter((d) => !d.installed && d.id);
    if (missing.length) {
      showRecommendedDep(app, deps, r.note || '');
      btn.disabled = false; btn.textContent = oldText;
      if (prog) prog.textContent = '等确认依赖';
      return;
    }
    if (prog) prog.textContent = '安装中…';
    const res = await startJob(window.toolbox.wingetInstall(app.wingetId, { key: app.key, name: app.name, kind: app.kind }));
    if (res && res.ok === false) { btn.disabled = false; btn.textContent = oldText; if (prog) prog.textContent = ''; }
    // 成功时任务在后台跑：进度由 winget-job 事件写进行内文字，
    // 完成后事件里刷新推荐页，状态变“已安装”。
  } catch (e) {
    toast(`安装失败：${e.message || String(e)}`);
    btn.disabled = false; btn.textContent = oldText;
    if (prog) prog.textContent = '';
  }
}
async function recommendedUninstall(app, wrap) {
  const portable = app.key === 'vlc';
  const ok = await customConfirm('卸载软件',
    portable
      ? `确定卸载「${app.name}」吗？将删除工具箱管理目录里它的程序与数据。`
      : `确定卸载「${app.name}」吗？将用 winget 卸载。`, '卸载');
  if (!ok) return;
  const btns = wrap ? [...wrap.querySelectorAll('button')] : [];
  btns.forEach((b) => { b.disabled = true; });
  const prog = wrap ? wrap.querySelector('.row-progress') : null;
  if (prog) prog.textContent = '卸载中…';
  const r = await window.toolbox.toolboxAppsUninstall(app.key);
  if (r && r.ok) {
    // 便携版是同步删完的，立即刷新；winget 的在后台跑，完成后
    // winget-job 事件里再刷新一次。
    if (portable) { toast(`已卸载：${app.name}`); renderRecommended(); renderToolboxApps(); loadInstalled(); }
    else toast('正在卸载，完成后状态会自动刷新');
  } else {
    toast((r && r.error) || '卸载失败');
    btns.forEach((b) => { b.disabled = false; });
    if (prog) prog.textContent = '';
  }
}
function showRecommendedDep(app, deps, note) {
  recommendedDepPending = { app, depIds: (deps || []).filter((d) => !d.installed && d.id).map((d) => d.id) };
  $('#recommended-dep-title').textContent = `装「${app.name}」前，先确认它的依赖`;
  const box = $('#recommended-dep-list');
  box.innerHTML = '';
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
  if (note) {
    const n = el('div', 'row-sub', note);
    box.appendChild(n);
  }
  $('#recommended-dep').classList.remove('hidden');
  $('#recommended-dep').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideRecommendedDep() { $('#recommended-dep').classList.add('hidden'); recommendedDepPending = null; }
$('#recommended-dep-cancel').addEventListener('click', hideRecommendedDep);
$('#recommended-dep-main').addEventListener('click', async () => {
  const p = recommendedDepPending; hideRecommendedDep();
  if (!p) return;
  const res = await startJob(window.toolbox.wingetInstall(p.app.wingetId, { key: p.app.key, name: p.app.name, kind: p.app.kind }));
  if (res && res.ok === false) renderRecommended();
});
$('#recommended-dep-all').addEventListener('click', async () => {
  const p = recommendedDepPending; hideRecommendedDep();
  if (!p) return;
  const row = document.querySelector(`#recommended-list .row[data-app-key="${p.app.key}"] .row-progress`);
  if (row) row.textContent = '安装中…';
  const res = await window.toolbox.installDepsAndPackage(p.app.wingetId, p.depIds, { key: p.app.key, name: p.app.name, kind: p.app.kind });
  if (!res || !res.ok) { toast((res && res.error) || '安装失败'); renderRecommended(); return; }
  toast('本体和依赖都装好了');
  renderRecommended(); renderToolboxApps(); loadInstalled(); loadUpgrades();
});

/* ---------- GitHub ---------- */
async function renderGithubStatus() {
  const st = await window.toolbox.githubStatus();
  $('#github-status').textContent = st.hasToken
    ? (st.login ? `已登录：${st.login}` : '已保存令牌，但验证失败，请重新登录。')
    : '未登录：需要个人访问令牌（Personal Access Token）才能搜仓库。';
}
$('#github-token-help').addEventListener('click', () => window.toolbox.openExternal('https://github.com/settings/tokens'));
$('#github-login').addEventListener('click', async (e) => {
  const t = $('#github-token').value.trim();
  if (!t) { toast('先粘贴令牌'); return; }
  const finish = beginAsync(e.currentTarget, '登录中…', document.getElementById('github-status'));
  const r = await window.toolbox.githubSetToken(t);
  if (r.ok) { finish(true, `已登录：${r.login}`); $('#github-token').value = ''; }
  else finish(false, `GitHub 没有登录：${r.error || '后端没有返回原因'}`);
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
  vlc: { name: 'VLC', tile: 'orange', glyph: SVG_PLAY },
  potplayer: { name: 'PotPlayer', tile: 'blue', glyph: SVG_PLAY },
  mpv: { name: 'mpv', tile: 'gray', glyph: SVG_PLAY },
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
  updateBackButtons();
}
/* 2026-11-27-10，第 5 项：未安装的浏览器/播放器不显示、不出现在任何描述里；
 * 只有装了的才出现，且只像电脑桌面那样一个图标，单击即开。 */
function fillDefaultAppSelect(sel, apps, order, always) {
  if (!sel) return;
  const current = sel.value || '';
  sel.innerHTML = '';
  // always：不用下载也永远可用的项（如内嵌 Chromium）。
  const installed = order.filter((k) => (apps[k] && apps[k].found) || (always || []).includes(k));
  if (!installed.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '未安装'; o.disabled = true;
    sel.appendChild(o);
    return;
  }
  for (const k of installed) {
    const o = document.createElement('option');
    o.value = k; o.textContent = apps[k].name || k;
    sel.appendChild(o);
  }
  if (current && installed.includes(current)) sel.value = current;
}
async function renderPlayerApps() {
  const box = $('#player-apps');
  const apps = await window.toolbox.playerApps();
  playerAppsCache = apps;
  fillDefaultAppSelect($('#default-player'), apps, ['vlc', 'potplayer', 'mpv']);
  box.innerHTML = '';
  const installed = ['vlc', 'potplayer', 'mpv'].filter((k) => apps[k] && apps[k].found);
  if (!installed.length) {
    box.className = 'list empty-note';
    box.textContent = '未安装播放器。去「工具管理 · 推荐软件」安装后，这里会出现图标，点图标即开。';
    return;
  }
  box.className = 'app-list';
  for (const key of installed) {
    const meta = PLAYER_META[key];
    const btn = el('button', 'app-icon-btn', '');
    btn.type = 'button';
    btn.dataset.appOpen = key;
    btn.title = meta.name;
    btn.appendChild(el('span', `icon-tile ${meta.tile}`)); btn.lastChild.innerHTML = meta.glyph;
    btn.appendChild(el('span', 'app-icon-label', meta.name));
    btn.appendChild(el('span', 'app-icon-status', '已安装'));
    btn.addEventListener('click', () => openPlayerApp(key));
    box.appendChild(btn);
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
  gotoTab('recommended');
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
    toast('m3u8 地址不能直接播放，请在数据嗅探框里下载后播放');
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
$('#vlc-download').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '下载中…');
  $('#vlc-progress').classList.remove('hidden');
  const r = await window.toolbox.vlcDownload();
  if (r.ok) { finish(true, 'VLC 已重新下载好'); renderVlc(); }
  else finish(false, `VLC 没有下载好：${r.error || '后端没有返回原因'}`);
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
  const bar = kind === 'vlc' ? $('#vlc-progress') : null;
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.querySelector('.bar').style.width = `${pct || 0}%`;
  // 2026-11-28-12，第 3 项：推荐页对应行也同步进度（行内文字）。
  const recRow = document.querySelector('#recommended-list .row[data-app-key="vlc"] .row-progress');
  if (recRow) recRow.textContent = status === 'done' ? '已完成' : status === 'failed' ? `失败：${(error || '').slice(0, 60)}` : `下载中 ${pct || 0}%`;
  if (status === 'done') { setTimeout(() => bar.classList.add('hidden'), 600); renderVlc(); renderBrowser(); renderRecommended(); }
  if (status === 'failed') { toast(error || '下载失败'); bar.classList.add('hidden'); }
});

/* ---------- 浏览器：应用列表 → Chromium 窗口 / 其他浏览器 ---------- */
const BROWSER_META = {
  chromium: { name: 'Chromium', tile: 'blue', glyph: SVG_COMPASS },
  chrome: { name: 'Chrome', tile: 'red', glyph: SVG_COMPASS },
  edge: { name: 'Edge', tile: 'teal', glyph: SVG_COMPASS },
};
let browserAppsCache = {};
/* 2026-11-28-12，第 2 项：内嵌浏览器按种类分区分——Chromium 用默认分区，
 * Chrome / Edge 各用自己的分区；同一浏览器在工具箱内外的 Cookie、
 * 存储、登录态互不相通。系统 Chrome/Edge 不是真的嵌不进去，而是
 * Electron 的 webview 本身就是 Chromium 内核：三种浏览器都在工具箱
 * 窗口内的同一个 webview 里打开，只是换分区隔离数据；没有外部窗口。 */
const EMBEDDED_BROWSER_PARTITIONS = { chromium: 'persist:toolbox-browser', chrome: 'persist:toolbox-chrome', edge: 'persist:toolbox-edge' };
let embeddedBrowserKind = 'chromium';
/* 2026-11-28-7：内嵌浏览器 UA——webview 默认 UA 里带 Electron/版本号，
 * 谷歌会把这类 UA 当成自动化/不安全浏览器（登录直接拒，个别页面只
 * 给降级页）。去掉 Electron 标记后就是标准 Chrome UA，平台与版本
 * 跟随本机，不写死。账号指纹里自填的 UA 优先（见 ensureAccountWebview）。 */
function embeddedBrowserUA() {
  return String((typeof navigator !== 'undefined' && navigator.userAgent) || '').replace(/\sElectron\/[0-9.]+/, '');
}
function applyEmbeddedBrowserUA(wv) {
  if (!wv) return;
  try { if (!wv.getAttribute('useragent')) wv.setAttribute('useragent', embeddedBrowserUA()); } catch (e) { /* 设不上不影响打开 */ }
}
/* 切内嵌浏览器种类：重建 #toolbox-webview 换分区（与账号切换同做法），
 * 登录态存在分区磁盘里，切走不丢；当前标签页地址保留，回来继续看。 */
function setEmbeddedBrowserKind(kind) {
  const k = EMBEDDED_BROWSER_PARTITIONS[kind] ? kind : 'chromium';
  // 账号浏览中：分区是账号的，动它会丢账号浏览状态；先不动，等账号
  // 退出后再切（restoreDefaultWebview 会把 kind 复位回 chromium）。
  if (typeof activeAccountId !== 'undefined' && activeAccountId) return;
  if (k === embeddedBrowserKind && $('#toolbox-webview')) return;
  embeddedBrowserKind = k;
  const view = $('#chrome-view');
  const old = $('#toolbox-webview');
  if (old) old.remove();
  const wv = document.createElement('webview');
  wv.id = 'toolbox-webview';
  wv.setAttribute('partition', EMBEDDED_BROWSER_PARTITIONS[k]);
  wv.setAttribute('useragent', embeddedBrowserUA());
  view.appendChild(wv);
  initToolboxWebview();
  loadChromeWebview((chromeTabs[chromeActive] && chromeTabs[chromeActive].url) || '');
  syncNativeViewVisibility();
}
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
  if (name === 'chromium') updateChromeView();
  if (typeof updateSniffFab === 'function') updateSniffFab();
  updateBackButtons();
  /* 2026-11-27-4：屏内视图切换也要同步原生视图显隐。gotoScreen 只在
   * 切屏时同步；此前切到 Chromium 视图后 webview 仍被行内 display:none
   * 压住（切屏时按 list 视图藏起），须在这里恢复。 */
  syncNativeViewVisibility();
}
async function renderBrowserApps() {
  const box = $('#browser-apps');
  const apps = await window.toolbox.browserApps();
  browserAppsCache = apps;
  fillDefaultAppSelect($('#default-browser'), apps, ['chromium', 'chrome', 'edge'], ['chromium']);
  box.innerHTML = '';
  // 2026-11-28-7：内嵌 Chromium 不再进已安装列表——它不是装出来的
  // 软件，放在这里会让人以为“已安装”里有个不存在的 Chromium；入口
  // 在上方“打开内嵌浏览器”按钮（browser-open-embedded）。这里只列
  // 工具箱内装的 Chrome / Edge。
  const shown = ['chrome', 'edge'].filter((k) => apps[k] && apps[k].found);
  if (!shown.length) {
    box.className = 'app-list empty-note';
    box.textContent = '未在工具箱内安装外部浏览器。内嵌浏览器点上方按钮直接打开，不用安装；想装外部浏览器去「工具管理 · 推荐软件」。';
    return;
  }
  box.className = 'app-list';
  for (const key of shown) {
    const meta = BROWSER_META[key];
    const btn = el('button', 'app-icon-btn', '');
    btn.type = 'button';
    btn.dataset.appOpen = key;
    btn.title = meta.name;
    btn.appendChild(el('span', `icon-tile ${meta.tile}`)); btn.lastChild.innerHTML = meta.glyph;
    btn.appendChild(el('span', 'app-icon-label', meta.name));
    btn.appendChild(el('span', 'app-icon-status', '已安装'));
    btn.addEventListener('click', () => openBrowserApp(key));
    box.appendChild(btn);
  }
}
$('#browser-open-embedded').addEventListener('click', () => openBrowserApp('chromium'));
$('#chrome-load-error-retry').addEventListener('click', () => {
  const p = $('#chrome-load-error');
  if (p) p.classList.add('hidden');
  const wv = $('#toolbox-webview');
  if (wv && wv.reload) wv.reload();
});
function openBrowserApp(key) {
  // 2026-11-28-12，第 2 项：三种浏览器都进内嵌视图（按种类换分区），
  // 不再有“外部详情页”（#browser-other-view 已删）。
  setEmbeddedBrowserKind(key);
  showBrowserView('chromium');
  renderBrowser();
}

/* Chromium 窗口：标签页只管理这里的地址，浏览本身在 Chromium 里进行 */
const chromeTabs = [{ title: '新标签页', url: '' }];
let chromeActive = 0;
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
  if (!url) { const p = $('#chrome-load-error'); if (p) p.classList.add('hidden'); view.classList.add('hidden'); start.classList.remove('hidden'); return; }
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
  if (/^chrome:\/\//i.test(url)) { toast('Chromium 内部页面不能在内嵌浏览器里打开'); return; }
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
  { name: '应用商店', glyph: SVG_GRID, url: 'https://chromewebstore.google.com/' },
];
CHROME_SHORTCUTS.forEach((s) => {
  const btn = el('button', '');
  btn.type = 'button';
  { const dot = el('span', 'shortcut-dot'); dot.innerHTML = s.glyph; btn.appendChild(dot); }
  btn.appendChild(el('span', '', s.name));
  btn.addEventListener('click', () => chromeGo(s.url));
  $('#chrome-shortcuts').appendChild(btn);
});
/* 2026-11-28-2：便携版 Chromium 已删除，扩展页与设置页随之删除；
 * 应用商店仍在内嵌浏览器里打开。 */
$$('[data-chrome-act]').forEach((b) => b.addEventListener('click', async () => {
  const act = b.dataset.chromeAct;
  $$('.menu.open').forEach((m) => m.classList.remove('open'));
  if (act === 'new-tab') $('#chrome-new-tab').click();
  else if (act === 'webstore') chromeGo('https://chromewebstore.google.com/');
}));
function initToolboxWebview() {
  const wv = $('#toolbox-webview');
  if (!wv || wv.dataset.bound) return;
  wv.dataset.bound = '1';
  applyEmbeddedBrowserUA(wv);
  wv.addEventListener('did-navigate', (e) => {
    const url = e.url || '';
    if (url === 'about:blank') return; // 停媒体时切到空白页，不覆盖标签页地址
    $('#chrome-url').value = url;
    chromeTabs[chromeActive].url = url;
    chromeTabs[chromeActive].title = url.replace(/^https?:\/\//, '').split('/')[0] || '新标签页';
    renderChromeTabs();
    /* 2026-11-27-11：统一嗅探——换页后上页抓到的内容失效，清池；
     * 换站前先存一次历史快照；同时记下导航轨迹，供登录成功启发式用。 */
    onSniffPageChange(url);
    trackBrowserLoginNav(url);
    if (sniffEnabled && LOGIN_PATH_RE.test(lastBrowserNav.prev || '')) scanAuthStorageAndPageData('login-redirect');
  });
  wv.addEventListener('did-finish-load', () => {
    /* 登录成功启发式第二信号：登录页跳走后，新页出现登出/头像等登录态标志。 */
    checkBrowserLoggedInDom();
    /* 2026-11-27-11：统一嗅探——页面钩子（fetch/XHR/WS/SSE）注入；
     * 换了页就扫一次存储与内嵌数据（同页不重复扫）。 */
    injectSniffPageHooks();
    if (sniffEnabled) {
      const u = currentWebviewUrl();
      if (u && u !== lastSniffScanUrl) { lastSniffScanUrl = u; scanAuthStorageAndPageData('load'); }
    }
  });
  wv.addEventListener('page-title-updated', (e) => {
    if (e.title) { chromeTabs[chromeActive].title = e.title; renderChromeTabs(); }
  });
  // 注意：<webview> 的 DOM 事件只传一个 event 对象（errorCode 等在
  // 属性上）；多参数是主进程 webContents.on 的签名。以前按多参数写，
  // code 恒为 undefined，!isMainFrame 恒真，错误面板永远弹不出来。
  wv.addEventListener('did-fail-load', (e) => {
    const code = e && e.errorCode;
    const desc = e && e.errorDescription;
    const url = e && e.validatedURL;
    const isMainFrame = e && e.isMainFrame;
    if (code === -3 || !isMainFrame) return;
    const panel = $('#chrome-load-error');
    const text = $('#chrome-load-error-text');
    if (panel && text) {
      text.textContent = `错误 ${code}（${desc || '未知错误'}）：${url || ''}。先检查地址与网络；若开了 Pioneer 或代理，断开后再试。`;
      panel.classList.remove('hidden');
    }
    toast('页面打不开：检查地址与网络');
  });
  // 导航开始时藏错误面板；加载失败由 did-fail-load 重新显示。不能在
  // did-finish-load 里藏——失败后 Chromium 会加载内部错误页，同样
  // 触发 did-finish-load，面板只闪一下就没了。
  wv.addEventListener('did-start-loading', () => { const p = $('#chrome-load-error'); if (p) p.classList.add('hidden'); });
}
initToolboxWebview();
$('#chrome-close').addEventListener('click', goBack);
/* 外部调用进内嵌浏览器：browser-open-url / launchBrowserApp
 * 都发此事件；kind 决定分区（chromium/chrome/edge，缺省 chromium）。 */
window.toolbox.on('embedded-browser-open', (msg) => {
  const url = msg && msg.url;
  const kind = (msg && msg.kind) || 'chromium';
  setMenuActive('browser');
  gotoScreen('browser');
  setEmbeddedBrowserKind(kind);
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
/* ---------- 统一嗅探（2026-11-27-11）：一个结果池、一个嗅探框 ----------
 * 池 sniffItems：媒体（视频/直播流/音频/图片/文档/其他）、登录态
 * （Cookie/本地存储/请求头令牌/响应体令牌）、流式消息、页面数据。
 * 请求日志 sniffReqLog 另记（HAR 式，上限 500 条滚动），接口清单
 * 由它归纳；历史落盘本机 JSON（令牌打码）。值只放内存展示，
 * 完整值点一下才复制，绝不写日志、不上报。
 * 登录提示：只用能实际检测到的信号——①从登录页（含 login/signin/auth 等
 * 的地址）同域跳转到非登录页；②跳走后新页面 DOM 里出现登出/头像等登录态
 * 标志（executeJavaScript 读不到就只用信号①）。两个信号都只是“可能登录
 * 成功”，所以只弹确认框问用户，不静默保存；同域名 10 分钟内只弹一次；
 * 正在用账号管理里的账号浏览、或正在走注册流程时不弹。
 * 检测不到的场景（SPA 无跳转登录、扫码登录、executeJavaScript 被页面禁掉、
 * 用户名/密码本身）见汇报，不假装能检测。account-save 不存用户名密码，
 * 提示保存只建一条站点占位记录，用户名需用户在账号管理里补填。 */
/* 2026-11-28-7：第 2 项：分类标签用标准技术术语（媒体类型 / 凭证
 * 位置 / 传输方式），不用口语化说法。 */
const SNIFF_CATEGORIES = [
  { key: 'video', label: '视频媒体' }, { key: 'live', label: '直播流' },
  { key: 'audio', label: '音频媒体' }, { key: 'image', label: '图片资源' },
  { key: 'document', label: '文档' }, { key: 'other', label: '其他资源' },
  { key: 'cookie', label: 'Cookie' }, { key: 'storage', label: 'Web 存储' },
  { key: 'req-header', label: '请求头凭证' }, { key: 'resp-body', label: '响应体凭证' },
  { key: 'stream', label: '流式传输' }, { key: 'page-data', label: '页面内嵌数据' },
];
const SNIFF_CATEGORY_LABEL = Object.fromEntries(SNIFF_CATEGORIES.map((c) => [c.key, c.label]));
const SNIFF_AUTH_CATEGORIES = ['cookie', 'storage', 'req-header', 'resp-body'];
let sniffItems = []; // 统一结果池
let sniffReqLog = []; // HAR 式请求日志，上限 500 条滚动
let sniffHistoryMeta = []; // 历史快照元数据（主进程落盘本机 JSON）
let sniffHistoryView = null; // 正在看的历史快照 {id, host, at, items}（null 表示看实时池）
let sniffSiteHost = ''; // 当前站点 host（变了就清池，换站前存一次历史）
let sniffReqFilter = { type: '', host: '' };
let sniffReqDetailId = null;
const LOGIN_PATH_RE = /login|signin|sign-in|sign_in|auth|passport|oauth|user\/login|account\/login/i;
const LOGIN_PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
let lastBrowserNav = { prev: '', url: '', at: 0 }; // 上一次 did-navigate 的地址与它的上一页
const loginPromptedAt = new Map(); // host -> 上次弹框时间戳
function browserMediaHost(url) {
  try { return new URL(url).hostname || ''; } catch (e) { return ''; }
}
function currentWebviewUrl() {
  try { const wv = $('#toolbox-webview'); return (wv && wv.getURL && wv.getURL()) || ''; } catch (e) { return ''; }
}
/* 2026-11-27-10，第 8 项：视频下载改为数据嗅探。开启后右下角常驻一个
 * 可拖动小圆点（位置存本机），点小圆点开关常驻嗅探框，框里实时显示当前
 * 页面的嗅探结果。复用现有的浏览器媒体嗅探，不恢复已去掉的媒体入口。 */
let sniffEnabled = false; // 开关存在 config.sniffEnabled，随配置落盘
let sniffPanelOpen = false;
function sniffCategoryOfUrl(url, type) {
  const t = String(type || '').toLowerCase();
  if (t === 'm3u8' || t === 'dash') return 'live';
  if (['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav'].includes(t)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'].includes(t)) return 'image';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub'].includes(t)) return 'document';
  if (['mp4', 'm4v', 'webm', 'mov', 'mkv', 'm4s', 'ts'].includes(t)) return 'video';
  const u = String(url || '');
  if (/\.(m3u8|mpd)([?#]|$)/i.test(u)) return 'live';
  if (/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i.test(u)) return 'audio';
  if (/\.(jpe?g|png|gif|webp|avif|bmp|svg|ico)([?#]|$)/i.test(u)) return 'image';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|epub)([?#]|$)/i.test(u)) return 'document';
  if (/\.(mp4|m4v|webm|mov|mkv|m4s|ts)([?#]|$)/i.test(u)) return 'video';
  return 'other';
}
function sniffItemKey(it) {
  if (SNIFF_AUTH_CATEGORIES.includes(it.category) || it.category === 'page-data') return `${it.category}|${it.host || ''}|${it.name || ''}`;
  if (it.category === 'stream') return `stream|${it.host || ''}|${it.url || ''}`;
  return `media|${String(it.url || '').split('#')[0]}`;
}
function upsertSniffItem(patch) {
  const now = Date.now();
  const it = { ...patch, firstSeen: now, lastChanged: now };
  const key = sniffItemKey(it);
  const idx = sniffItems.findIndex((x) => sniffItemKey(x) === key);
  if (idx >= 0) {
    const prev = sniffItems[idx];
    const changed = it.category === 'stream'
      ? (Number(it.messages || 0) !== Number(prev.messages || 0))
      : (String(it.value ?? it.url ?? '') !== String(prev.value ?? prev.url ?? ''));
    if (!changed) return prev; // 重复不报
    sniffItems[idx] = { ...prev, ...it, firstSeen: prev.firstSeen, lastChanged: now };
    return sniffItems[idx];
  }
  sniffItems.push(it);
  if (sniffItems.length > 200) sniffItems.shift();
  return it;
}
function addSniffMedia(p, quiet) {
  if (!p || !p.url) return null;
  const type = String(p.type || '');
  const it = upsertSniffItem({
    category: p.category || sniffCategoryOfUrl(p.url, type),
    url: String(p.url), type, name: String(p.name || ''),
    sourceUrl: String(p.sourceUrl || p.pageUrl || ''), host: browserMediaHost(p.pageUrl || p.url),
    pageUrl: String(p.pageUrl || ''), sizeBytes: Number(p.size || 0) || 0,
    contentType: String(p.contentType || ''), resolution: String(p.resolution || ''),
    bandwidth: Number(p.bandwidth || 0) || 0, via: String(p.via || '实时嗅探'),
  });
  if (!quiet) { updateSniffFab(); renderSniffPanel(); }
  return it;
}
function addSniffAuth(p, quiet) {
  if (!p || !p.name) return null;
  const it = upsertSniffItem({
    category: p.category, name: String(p.name), value: String(p.value ?? ''),
    sourceUrl: String(p.sourceUrl || ''), host: String(p.host || browserMediaHost(p.sourceUrl || '')),
    expires: Number(p.expires || 0) || 0, via: String(p.via || ''),
  });
  if (!quiet) { updateSniffFab(); renderSniffPanel(); }
  return it;
}
function maskSniffValue(v) {
  const s = String(v ?? '');
  if (!s) return '—';
  if (s.length > 8) return `${s.slice(0, 4)}•••${s.slice(-4)}`;
  if (s.length > 4) return `${s.slice(0, 2)}•••${s.slice(-2)}`;
  return '••••';
}
function formatSniffBytes(n) {
  const v = Number(n || 0);
  if (!v) return '';
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
}
function formatSniffExpiry(ts) {
  const n = Number(ts || 0);
  if (!n) return '会话';
  try { return new Date(n * 1000).toLocaleDateString(); } catch (e) { return '—'; }
}
function isTokenLikeSniffValue(v) {
  const s = String(v || '');
  if (!s || s.length < 8) return false;
  return /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(s)
    || /^[a-f0-9]{32,}$/i.test(s) || /^(sk|pk|ghp|github_pat|Bearer )[A-Za-z0-9_\-]{8,}/.test(s);
}
function updateSniffFab() {
  const fab = $('#browser-media-fab');
  const count = $('#browser-media-count');
  if (!fab) return;
  const n = sniffItems.length;
  fab.classList.toggle('hidden', !sniffEnabled);
  if (count) {
    count.textContent = String(Math.min(n, 99));
    count.classList.toggle('hidden', n === 0);
  }
  fab.title = n ? `数据嗅探：本页发现 ${n} 条` : '数据嗅探';
}
function clearSniffPool() {
  sniffItems = [];
  sniffReqLog = [];
  sniffHistoryView = null;
  updateSniffFab();
  renderSniffPanel();
}
async function onSniffPageChange(url) {
  const host = browserMediaHost(url);
  const prevHost = sniffSiteHost;
  if (host && prevHost && host !== prevHost && sniffItems.length) {
    await saveSniffHistorySnapshot(prevHost); // 换站前存一次快照（有条目才存）
  }
  sniffSiteHost = host;
  // 请求日志只清旧页条目：新页主文档的 onCompleted 可能先于
  // did-navigate 到达，url 等于新页地址的条目要保留下来。
  const newUrl = String(url || '');
  const keepLog = sniffReqLog.filter((e) => e.url === newUrl);
  clearSniffPool();
  sniffReqLog = keepLog;
  updateSniffFab();
  renderSniffPanel();
}
/* 2026-11-28-4，第 3 项：嗅探结果按类别分页签（不再全混一列），每个页签
 * 带计数；只渲染当前页签的内容。页签只显示有内容的类别，默认选中
 * 第一个有内容的页签；用户切过页签后保持用户的选择（有内容时）。
 * 第 5 项：面板顶部的引擎说明——自研内置统一引擎，不是开源工具，
 * 没装任何第三方嗅探工具；视频下载用的视频引擎是唯一可选安装项。 */
let sniffActiveTab = '';
/* 2026-11-28-7：第 2 项：引擎说明默认折叠——以前整块说明占了大半个
 * 嗅探框。现在只显示名称行，点名称才展开详情；展开状态存本机
 * localStorage（sniff-info-open），下次打开恢复。 */
function sniffEngineInfoOpen() {
  try { return localStorage.getItem('sniff-info-open') === '1'; } catch (e) { return false; }
}
function renderSniffEngineInfo() {
  const box = $('#sniff-engine-info');
  if (!box) return;
  const open = sniffEngineInfoOpen();
  box.innerHTML = '';
  box.classList.toggle('open', open);
  const head = el('button', 'sniff-info-head', '');
  head.type = 'button';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.appendChild(el('strong', '', '嗅探引擎：工具箱自研内置统一引擎'));
  const caret = el('span', 'sniff-info-caret', '');
  caret.innerHTML = open ? SVG_CHEV_D : SVG_CHEV_R;
  head.appendChild(caret);
  head.addEventListener('click', () => {
    try { localStorage.setItem('sniff-info-open', sniffEngineInfoOpen() ? '0' : '1'); } catch (e) { /* 存不下不影响 */ }
    renderSniffEngineInfo();
  });
  box.appendChild(head);
  if (!open) return;
  const ul = el('ul', '');
  for (const t of ['请求拦截：捕获内嵌浏览器全部 HTTP(S) 请求', '媒体捕获：视频、直播流（HLS/DASH）、音频、图片、文档', '流式传输：WebSocket / SSE 消息摘要（前 200 字符）', '认证凭证：Cookie、Web 存储、请求头与响应体中的令牌（脱敏显示，点击复制）', '请求日志：HAR 格式全量记录，按类型与域名筛选', '历史快照：本地持久化，可查看与删除', 'API 端点：按域名分组，路径参数归一化为 {id}', '页面内嵌数据：__NEXT_DATA__、JSON 状态与 JS 全局变量']) ul.appendChild(el('li', '', t));
  box.appendChild(ul);
  box.appendChild(el('div', '', '依赖：内置引擎，无第三方组件。视频下载引擎（yt-dlp 等）为唯一可选安装项，未安装时下载会提示安装。'));
}
function renderSniffTabs(tabs) {
  const bar = $('#sniff-tabs');
  if (!bar) return;
  bar.innerHTML = '';
  for (const t of tabs) {
    const b = el('button', 'tab', `${t.label}（${t.count}）`);
    b.type = 'button';
    b.dataset.sniffTab = t.id;
    b.setAttribute('role', 'tab');
    b.classList.toggle('active', t.id === sniffActiveTab);
    b.addEventListener('click', () => { sniffActiveTab = t.id; renderSniffPanel(); });
    bar.appendChild(b);
  }
}
/* 各页签的行构建（从旧的 renderSniffPanel 分组回调里抽出来）。 */
function sniffMediaRowsFor(wrap, group) {
  const tsGroups = new Map();
  for (const it of group) {
    if (it.type === 'ts') {
      let dir = '';
      try { const u = new URL(it.url); dir = `${u.hostname}${u.pathname.split('/').slice(0, -1).join('/')}`; } catch (e) { dir = it.host || ''; }
      const g = tsGroups.get(dir) || { dir, count: 0 };
      g.count += 1; tsGroups.set(dir, g);
      continue;
    }
    sniffMediaRow(wrap, it);
  }
  // HLS 分片按目录折叠成一行
  for (const g of tsGroups.values()) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `TS · HLS 分片 ×${g.count}`));
    main.appendChild(el('div', 'row-sub', g.dir || ''));
    row.appendChild(main);
    wrap.appendChild(row);
  }
}
function sniffAuthRowsFor(wrap, group) {
  for (const cat of SNIFF_AUTH_CATEGORIES) {
    const g = group.filter((x) => x.category === cat);
    if (!g.length) continue;
    wrap.appendChild(el('div', 'sniff-subhead', `${SNIFF_CATEGORY_LABEL[cat]}（${g.length}）`));
    for (const it of g) sniffAuthRow(wrap, it);
  }
}
function sniffStreamRowsFor(wrap, group) {
  for (const it of group) {
    const row = el('div', 'row');
    if (Date.now() - (it.lastChanged || 0) < 15000) row.classList.add('sniff-new');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${it.via || '流式'} · ${it.host || ''} · ${Number(it.messages || 0)} 条`));
    main.appendChild(el('div', 'row-sub', `${formatSniffBytes(it.bytes)}${it.preview ? ` · ${String(it.preview).slice(0, 120)}` : ''}`));
    row.appendChild(main);
    wrap.appendChild(row);
  }
}
function sniffPageDataRowsFor(wrap, group) {
  for (const it of group) {
    const row = el('div', 'row');
    if (Date.now() - (it.lastChanged || 0) < 15000) row.classList.add('sniff-new');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${it.name || ''}${it.host ? ` · ${it.host}` : ''}`));
    const tokenLike = isTokenLikeSniffValue(it.value);
    const val = el('button', 'sniff-value', tokenLike ? maskSniffValue(it.value) : String(it.value || '').slice(0, 160));
    val.type = 'button'; val.title = '点一下复制完整值';
    val.addEventListener('click', async () => {
      try { await window.toolbox.copyText(String(it.value || '')); toast('已复制完整值'); }
      catch (e) { toast('复制失败'); }
    });
    main.appendChild(val);
    row.appendChild(main);
    wrap.appendChild(row);
  }
}
function sniffReqLogRowsFor(wrap) {
  const types = [...new Set(sniffReqLog.map((e) => e.type || 'other'))].sort();
  const hosts = [...new Set(sniffReqLog.map((e) => e.host || ''))].filter(Boolean).sort();
  const filterRow = el('div', 'sniff-filter-row');
  const typeSel = el('select', 'ctrl-select');
  typeSel.appendChild(el('option', '', '全部类型'));
  for (const t of types) { const o = el('option', '', t); o.value = t; typeSel.appendChild(o); }
  typeSel.value = sniffReqFilter.type;
  typeSel.addEventListener('change', () => { sniffReqFilter.type = typeSel.value; renderSniffPanel(); });
  const hostSel = el('select', 'ctrl-select');
  hostSel.appendChild(el('option', '', '全部域名'));
  for (const h of hosts) { const o = el('option', '', h); o.value = h; hostSel.appendChild(o); }
  hostSel.value = sniffReqFilter.host;
  hostSel.addEventListener('change', () => { sniffReqFilter.host = hostSel.value; renderSniffPanel(); });
  filterRow.append(typeSel, hostSel);
  wrap.appendChild(filterRow);
  const shown = sniffReqLog.filter((e) => (!sniffReqFilter.type || (e.type || 'other') === sniffReqFilter.type) && (!sniffReqFilter.host || (e.host || '') === sniffReqFilter.host)).slice(-100);
  for (const e of shown) {
    const row = el('div', 'row');
    row.classList.add('sniff-req-row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${e.method || 'GET'} · ${e.status || '—'} · ${formatSniffBytes(e.size) || '—'} · ${e.durationMs || 0}ms`));
    main.appendChild(el('div', 'row-sub', e.url || ''));
    row.appendChild(main);
    row.addEventListener('click', async () => {
      if (sniffReqDetailId === e.id) { sniffReqDetailId = null; renderSniffPanel(); return; }
      sniffReqDetailId = e.id;
      if (!e.reqHeaders) {
        try { const r = await window.toolbox.sniffReqDetail(e.id); if (r && r.ok) { e.reqHeaders = r.reqHeaders || {}; e.resHeaders = r.resHeaders || {}; } } catch (err) { /* 取不到也显示基本信息 */ }
      }
      renderSniffPanel();
    });
    wrap.appendChild(row);
    if (sniffReqDetailId === e.id) {
      const detail = el('pre', 'sniff-req-detail', sniffReqDetailText(e));
      wrap.appendChild(detail);
    }
  }
  if (!shown.length) wrap.appendChild(el('p', 'empty-note', '没有符合筛选的请求。'));
}
function sniffApiRowsFor(wrap, apiGroups) {
  for (const g of apiGroups) {
    wrap.appendChild(el('div', 'sniff-subhead', `${g.host}（${g.apis.length}）`));
    for (const a of g.apis) {
      const row = el('div', 'row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', `${a.method} ${a.path} ×${a.count}`));
      main.appendChild(el('div', 'row-sub', `最近状态 ${a.lastStatus || '—'}`));
      row.appendChild(main);
      wrap.appendChild(row);
    }
  }
}
function sniffHistoryRowsFor(wrap) {
  for (const h of sniffHistoryMeta) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', `${h.host || ''} · ${h.count || 0} 条`));
    main.appendChild(el('div', 'row-sub', new Date(h.at || 0).toLocaleString()));
    row.appendChild(main);
    const view = el('button', 'btn small', '查看');
    view.type = 'button';
    view.addEventListener('click', async () => {
      try {
        const r = await window.toolbox.sniffHistoryGet(h.id);
        if (r && r.ok) { sniffHistoryView = { id: h.id, host: h.host, at: h.at, items: r.items || [] }; renderSniffPanel(); }
        else toast((r && r.error) || '读不到这条历史');
      } catch (e) { toast('读不到这条历史'); }
    });
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      const ok = await customConfirm('删除历史快照', `删除 ${h.host || ''} ${new Date(h.at || 0).toLocaleString()} 的快照？`, '删除');
      if (!ok) return;
      try { await window.toolbox.sniffHistoryDelete(h.id); await refreshSniffHistoryMeta(); renderSniffPanel(); } catch (e) { toast('删除失败'); }
    });
    row.append(view, del);
    wrap.appendChild(row);
  }
}
function sniffMediaRow(wrap, it) {
  const row = el('div', 'row');
  if (Date.now() - (it.lastChanged || 0) < 15000) row.classList.add('sniff-new');
  const main = el('div', 'row-main');
  const meta = [formatSniffBytes(it.sizeBytes), it.resolution || '', it.bandwidth ? `约 ${Math.round(it.bandwidth / 1000)} kbps` : ''].filter(Boolean).join(' · ');
  main.appendChild(el('div', 'row-title', `${(it.type || SNIFF_CATEGORY_LABEL[it.category] || '媒体').toUpperCase()}${it.host ? ` · ${it.host}` : ''}${meta ? ` · ${meta}` : ''}`));
  main.appendChild(el('div', 'row-sub', it.url || ''));
  row.appendChild(main);
  // 2026-11-28-4，第 1 项：直接文件地址可内置预览（HLS/DASH 直播流
  // Chromium 原生播不了，不给预览按钮，只给下载）。
  if (SNIFF_PREVIEW_RE.test(it.url || '')) {
    const pv = el('button', 'btn small', '预览');
    pv.type = 'button';
    pv.addEventListener('click', () => toggleSniffPreview(row, pv, it));
    row.appendChild(pv);
  }
  if (['video', 'live', 'audio'].includes(it.category)) {
    const dl = el('button', 'btn small primary', '下载');
    dl.type = 'button';
    dl.addEventListener('click', () => videoStartDownload(it.url, 'auto', undefined, undefined));
    row.appendChild(dl);
  }
  wrap.appendChild(row);
}
/* 2026-11-28-4，第 1 项：嗅探视频/音频行内预览（内置播放器播嗅探到的
 * 地址）。只播直接文件地址；防盗链的站播不了会提示改点下载。 */
const SNIFF_PREVIEW_RE = /\.(mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i;
function toggleSniffPreview(row, btn, it) {
  const old = row.querySelector('.sniff-preview');
  if (old) { old.pause(); old.remove(); btn.textContent = '预览'; return; }
  const isAudio = it.category === 'audio' || /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)([?#]|$)/i.test(it.url || '');
  const media = document.createElement(isAudio ? 'audio' : 'video');
  media.className = 'sniff-preview';
  media.controls = true;
  media.preload = 'metadata';
  if (!isAudio) media.playsInline = true;
  media.src = it.url || '';
  media.addEventListener('error', () => { toast('这个地址内置播放器播不了（可能是防盗链或需要登录），请点下载'); });
  row.appendChild(media);
  btn.textContent = '收起预览';
  media.play().catch(() => { media.muted = true; media.play().catch(() => { /* 自动播放被禁时用户手动点播放 */ }); });
}
function sniffAuthRow(wrap, it) {
  const row = el('div', 'row');
  if (Date.now() - (it.lastChanged || 0) < 15000) row.classList.add('sniff-new');
  const main = el('div', 'row-main');
  main.appendChild(el('div', 'row-title', `${it.name || ''}${it.host ? ` · ${it.host}` : ''}`));
  const sub = [`来源：${browserMediaHost(it.sourceUrl || '') || it.host || '—'}`, `过期：${formatSniffExpiry(it.expires)}`, it.via || ''].filter(Boolean).join(' · ');
  main.appendChild(el('div', 'row-sub', sub));
  const val = el('button', 'sniff-value', maskSniffValue(it.value));
  val.type = 'button'; val.title = '点一下复制完整值';
  val.addEventListener('click', async () => {
    try { await window.toolbox.copyText(String(it.value || '')); toast('已复制完整值'); }
    catch (e) { toast('复制失败'); }
  });
  main.appendChild(val);
  row.appendChild(main);
  wrap.appendChild(row);
}
function apiPathTemplate(pathname) {
  return String(pathname || '').split('/').map((seg) => {
    if (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{4,}$/i.test(seg) || /^[0-9a-f]{24,}$/i.test(seg)) return '{id}';
    return seg;
  }).join('/');
}
function deriveSniffApiList(log) {
  const map = new Map();
  for (const e of log || []) {
    let u; try { u = new URL(e.url); } catch (err) { continue; }
    const key = `${e.method || 'GET'} ${u.hostname}${apiPathTemplate(u.pathname)}`;
    const hit = map.get(key) || { key, method: e.method || 'GET', host: u.hostname, path: apiPathTemplate(u.pathname), count: 0, lastStatus: 0 };
    hit.count += 1; hit.lastStatus = e.status || 0;
    map.set(key, hit);
  }
  const byHost = {};
  for (const v of map.values()) { (byHost[v.host] = byHost[v.host] || []).push(v); }
  return Object.keys(byHost).sort().map((h) => ({ host: h, apis: byHost[h].sort((a, b) => b.count - a.count) }));
}
function renderSniffPanel() {
  const panel = $('#browser-media-panel');
  const box = $('#browser-media-list');
  if (!panel || !box) return;
  panel.classList.toggle('hidden', !sniffPanelOpen);
  const pageEl = $('#browser-media-page');
  if (pageEl) {
    const cur = currentWebviewUrl() || (sniffItems.length ? sniffItems[sniffItems.length - 1].pageUrl || '' : '');
    pageEl.textContent = `当前页面：${cur || '—'}`;
  }
  renderSniffEngineInfo();
  box.innerHTML = '';
  const viewing = sniffHistoryView;
  if (viewing) {
    const back = el('button', 'btn small'); back.innerHTML = SVG_CHEV_L + ' 回到实时';
    back.type = 'button';
    back.addEventListener('click', () => { sniffHistoryView = null; renderSniffPanel(); });
    box.appendChild(back);
    const note = el('p', 'empty-note', `正在看历史快照：${viewing.host || ''} · ${new Date(viewing.at || 0).toLocaleString()}（${(viewing.items || []).length} 条）`);
    box.appendChild(note);
  }
  const items = viewing ? (viewing.items || []) : sniffItems;
  const mediaItems = items.filter((x) => SNIFF_CATEGORIES.some((c) => c.key === x.category) && !SNIFF_AUTH_CATEGORIES.includes(x.category) && x.category !== 'stream' && x.category !== 'page-data');
  const authItems = items.filter((x) => SNIFF_AUTH_CATEGORIES.includes(x.category));
  const streamItems = items.filter((x) => x.category === 'stream');
  const pageDataItems = items.filter((x) => x.category === 'page-data');
  const apiGroups = deriveSniffApiList(sniffReqLog);
  const apiTotal = apiGroups.reduce((n, g) => n + g.apis.length, 0);
  // 2026-11-28-4，第 3 项：结果按类别分页签，只渲染当前页签；
  // 页签只显示有内容的类别，带计数。
  const tabs = [
    ...['video', 'live', 'audio', 'image', 'document', 'other'].map((cat) => ({ id: cat, label: SNIFF_CATEGORY_LABEL[cat], count: mediaItems.filter((x) => x.category === cat).length, build: (w) => sniffMediaRowsFor(w, mediaItems.filter((x) => x.category === cat)) })),
    { id: 'auth', label: '认证凭证', count: authItems.length, build: (w) => sniffAuthRowsFor(w, authItems) },
    { id: 'stream', label: '流式传输', count: streamItems.length, build: (w) => sniffStreamRowsFor(w, streamItems) },
    { id: 'page-data', label: '页面内嵌数据', count: pageDataItems.length, build: (w) => sniffPageDataRowsFor(w, pageDataItems) },
    { id: 'reqlog', label: '请求日志', count: sniffReqLog.length, build: (w) => sniffReqLogRowsFor(w) },
    { id: 'api', label: 'API 端点', count: apiTotal, build: (w) => sniffApiRowsFor(w, apiGroups) },
    { id: 'history', label: '历史快照', count: sniffHistoryMeta.length, build: (w) => sniffHistoryRowsFor(w) },
  ].filter((t) => t.count > 0);
  renderSniffTabs(tabs);
  if (!items.length && !sniffReqLog.length && !sniffHistoryMeta.length) {
    box.className = 'list empty-note';
    box.textContent = '暂无抓到的内容。去内嵌浏览器打开页面，媒体、登录态与接口调用出现后会实时列在这里。';
    return;
  }
  box.className = 'list';
  if (!tabs.some((t) => t.id === sniffActiveTab)) sniffActiveTab = tabs.length ? tabs[0].id : '';
  const active = tabs.find((t) => t.id === sniffActiveTab);
  if (active) active.build(box);
}
function sniffReqDetailText(e) {
  const maskHeader = (k, v) => {
    const key = String(k || '').toLowerCase();
    if (key === 'cookie' || key === 'authorization' || key === 'set-cookie' || key.includes('token')) return maskSniffValue(v);
    return String(v ?? '');
  };
  const lines = [`${e.method || 'GET'} ${e.url || ''}`, `状态：${e.status || '—'} · 大小：${formatSniffBytes(e.size) || '—'} · 耗时：${e.durationMs || 0}ms · 类型：${e.type || '—'}`];
  const dump = (title, headers) => {
    lines.push(`--- ${title} ---`);
    const hs = headers || {};
    const keys = Object.keys(hs);
    if (!keys.length) { lines.push('（无）'); return; }
    for (const k of keys) {
      const v = hs[k];
      lines.push(`${k}: ${Array.isArray(v) ? v.map((x) => maskHeader(k, x)).join(' | ') : maskHeader(k, v)}`);
    }
  };
  dump('请求头', e.reqHeaders);
  dump('响应头', e.resHeaders);
  return lines.join('\n');
}
async function saveSniffHistorySnapshot(host) {
  if (!sniffItems.length) return null;
  const masked = sniffItems.map((it) => {
    const copy = { ...it };
    if (SNIFF_AUTH_CATEGORIES.includes(it.category)) copy.value = maskSniffValue(it.value);
    return copy;
  });
  try {
    const r = await window.toolbox.sniffHistorySave({ host: host || sniffSiteHost || '', at: Date.now(), items: masked });
    if (r && r.ok) { await refreshSniffHistoryMeta(); return r.id || null; }
  } catch (e) { /* 存不上不影响浏览 */ }
  return null;
}
async function refreshSniffHistoryMeta() {
  try { const r = await window.toolbox.sniffHistoryList(); if (r && r.ok) sniffHistoryMeta = r.entries || []; } catch (e) { /* 读不到按空 */ }
}
if (typeof window.toolbox.onBrowserMedia === 'function') {
  window.toolbox.onBrowserMedia((p) => { if (!p || !p.url) return; addSniffMedia(p); });
}
if (typeof window.toolbox.onBrowserMediaMeta === 'function') {
  window.toolbox.onBrowserMediaMeta((p) => {
    if (!p || !p.url) return;
    const it = sniffItems.find((x) => x.url === p.url);
    if (!it) return;
    it.sizeBytes = Number(p.size || 0) || it.sizeBytes || 0;
    it.contentType = String(p.contentType || it.contentType || '');
    renderSniffPanel();
  });
}
if (typeof window.toolbox.onBrowserAuth === 'function') {
  window.toolbox.onBrowserAuth((p) => { if (!p || !p.name) return; addSniffAuth(p); });
}
if (typeof window.toolbox.onBrowserReqLog === 'function') {
  window.toolbox.onBrowserReqLog((p) => {
    if (!p || !p.url) return;
    sniffReqLog.push({ ...p, id: String(p.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) });
    if (sniffReqLog.length > 500) sniffReqLog.splice(0, sniffReqLog.length - 500);
    if (sniffPanelOpen) renderSniffPanel();
  });
}
/* 页面钩子（2026-11-27-11）：executeJavaScript 注入进页面主世界，
 * 包一层 fetch/XHR/WebSocket/EventSource，响应体与流式消息只记
 * 摘要与条数、不存全文；登录态与页面内嵌数据走下面的存储扫描。
 * 只在嗅探开着时注入；注入失败不影响浏览。 */
const SNIFF_PAGE_HOOK_SCRIPT = `(function () {
  if (window.__toolboxSniffHooked) return 'already';
  window.__toolboxSniffHooked = true;
  window.__toolboxSniffFindings = window.__toolboxSniffFindings || [];
  var push = function (f) { try { window.__toolboxSniffFindings.push(f); if (window.__toolboxSniffFindings.length > 200) window.__toolboxSniffFindings.shift(); } catch (e) {} };
  var AUTH_RE = /(login|signin|sign-in|sso|oauth|token|refresh|auth|session|passport)/i;
  var TOKEN_KEY_RE = /(access_token|refresh_token|id_token|auth_token|api[_-]?key|token|session|sid|bearer)/i;
  var JWT_RE = /eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/;
  function scanText(text, url, via) {
    if (!text || typeof text !== 'string') return;
    if (text.length > 524288) text = text.slice(0, 524288);
    var found = {};
    try {
      var obj = JSON.parse(text);
      (function walk(o, depth) {
        if (depth > 4 || !o || typeof o !== 'object') return;
        for (var k in o) {
          if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
          var v = o[k];
          if (typeof v === 'string') {
            if (TOKEN_KEY_RE.test(k) && v) found[k] = v;
            else if (JWT_RE.test(v)) found[k || 'jwt'] = v;
          } else if (v && typeof v === 'object') walk(v, depth + 1);
        }
      })(obj, 0);
    } catch (e) {
      var m = text.match(/eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/g);
      if (m) m.slice(0, 3).forEach(function (t, i) { found['jwt-' + i] = t; });
    }
    for (var k in found) push({ category: 'resp-body', name: k, value: found[k], sourceUrl: url, via: via });
  }
  function scanStreamText(text, url) {
    if (!text) return;
    var lines = text.split(/\\r?\\n/);
    var count = 0, preview = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('data:') === 0) {
        var d = line.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        count += 1;
        if (!preview) preview = d.slice(0, 200);
      }
    }
    if (count) push({ category: 'stream', url: url, messages: count, bytes: text.length, preview: preview, via: 'SSE' });
  }
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
    var p = origFetch.apply(this, arguments);
    try {
      p.then(function (res) {
        try {
          var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          if (!/json|event-stream|text\\/plain/i.test(ct) && !AUTH_RE.test(url)) return;
          res.clone().text().then(function (t) {
            if (/event-stream/i.test(ct)) scanStreamText(t, url);
            else scanText(t, url, 'fetch');
          }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
    return p;
  };
  var OrigXHR = window.XMLHttpRequest;
  var origOpen = OrigXHR.prototype.open, origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.open = function (method, url) { this.__toolboxUrl = url; return origOpen.apply(this, arguments); };
  OrigXHR.prototype.send = function () {
    var self = this, url = self.__toolboxUrl || '';
    self.addEventListener('load', function () {
      try {
        var ct = self.getResponseHeader('content-type') || '';
        var t = self.responseText || '';
        if (/event-stream/i.test(ct)) scanStreamText(t, url);
        else if (t) scanText(t, url, 'xhr');
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
  var OrigWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    var entry = { category: 'stream', url: String(url), messages: 0, bytes: 0, preview: '', via: 'WebSocket' };
    ws.addEventListener('message', function (ev) {
      try {
        var data = ev && ev.data;
        var text = typeof data === 'string' ? data : '';
        entry.messages += 1;
        entry.bytes += text.length;
        if (!entry.preview && text) entry.preview = text.slice(0, 200);
        push({ category: 'stream', url: String(url), messages: entry.messages, bytes: entry.bytes, preview: entry.preview, via: 'WebSocket' });
      } catch (e) {}
    });
    return ws;
  }
  PatchedWS.prototype = OrigWS.prototype;
  PatchedWS.CONNECTING = OrigWS.CONNECTING; PatchedWS.OPEN = OrigWS.OPEN; PatchedWS.CLOSING = OrigWS.CLOSING; PatchedWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = PatchedWS;
  var OrigES = window.EventSource;
  if (OrigES) {
    window.EventSource = function (url, opts) {
      var es = new OrigES(url, opts);
      var entry = { category: 'stream', url: String(url), messages: 0, bytes: 0, preview: '', via: 'EventSource' };
      es.addEventListener('message', function (ev) {
        try {
          var text = (ev && ev.data) || '';
          entry.messages += 1; entry.bytes += text.length;
          if (!entry.preview && text) entry.preview = text.slice(0, 200);
          push({ category: 'stream', url: String(url), messages: entry.messages, bytes: entry.bytes, preview: entry.preview, via: 'EventSource' });
        } catch (e) {}
      });
      return es;
    };
  }
  return 'ok';
})()`;
/* 存储与内嵌数据扫描（2026-11-27-11）：localStorage/sessionStorage/
 * IndexedDB（有上限与超时）+ __NEXT_DATA__、Nuxt/Apollo/Redux 初始态、
 * JSON 脚本里的配置与地址；令牌类只记名与值（渲染层打码显示）。 */
const SNIFF_STORAGE_SCAN_SCRIPT = `(async () => {
  var out = [];
  var TOKEN_KEY_RE = /(access_token|refresh_token|id_token|auth_token|api[_-]?key|apikey|token|session|sid|sessionid|session_id|bearer)/i;
  var JWT_RE = /eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/;
  var URL_RE = /https?:\\/\\/[^\\s"'<>]+/g;
  function isTokenKey(k) { return TOKEN_KEY_RE.test(k); }
  function isTokenVal(v) { return typeof v === 'string' && v.length >= 8 && (JWT_RE.test(v) || /^[a-f0-9]{32,}$/i.test(v) || /^[A-Za-z0-9_\\-]{32,}$/.test(v)); }
  function pushStorage(store, k, v) {
    if (typeof v !== 'string' || !v) return;
    if (isTokenKey(k) || isTokenVal(v)) out.push({ category: 'storage', name: store + ':' + k, value: v, via: store });
  }
  try {
    for (var i = 0; i < localStorage.length && out.length < 60; i++) { var k = localStorage.key(i); pushStorage('localStorage', k, localStorage.getItem(k)); }
    for (var j = 0; j < sessionStorage.length && out.length < 60; j++) { var k2 = sessionStorage.key(j); pushStorage('sessionStorage', k2, sessionStorage.getItem(k2)); }
  } catch (e) {}
  function walk(o, path, depth) {
    if (depth > 4 || out.length >= 60) return;
    if (typeof o === 'string') {
      if (isTokenVal(o)) out.push({ category: 'page-data', name: path, value: o, via: '内嵌 JSON' });
      else { var urls = o.match(URL_RE); if (urls) urls.slice(0, 3).forEach(function (u) { out.push({ category: 'page-data', name: path, value: u, via: '内嵌 JSON' }); }); }
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      if (typeof v === 'string' && (isTokenKey(k) || isTokenVal(v))) out.push({ category: 'page-data', name: path ? path + '.' + k : k, value: v, via: '内嵌 JSON' });
      else walk(v, path ? path + '.' + k : k, depth + 1);
    }
  }
  try {
    var next = document.getElementById('__NEXT_DATA__');
    if (next && next.textContent) { try { walk(JSON.parse(next.textContent), '__NEXT_DATA__', 0); } catch (e) {} }
    var scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length && out.length < 60; s++) { try { walk(JSON.parse(scripts[s].textContent), 'script-json', 0); } catch (e) {} }
    var globals = ['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__PRELOADED_STATE__', '__DATA__'];
    for (var g = 0; g < globals.length; g++) { try { var gv = window[globals[g]]; if (gv) walk(gv, globals[g], 0); } catch (e) {} }
  } catch (e) {}
  try {
    if (window.indexedDB && indexedDB.databases) {
      var dbs = await Promise.race([indexedDB.databases(), new Promise(function (res) { setTimeout(function () { res([]); }, 2000); })]);
      for (var d = 0; d < Math.min((dbs || []).length, 3) && out.length < 60; d++) {
        var dbName = dbs[d] && dbs[d].name; if (!dbName) continue;
        try {
          var db = await new Promise(function (res, rej) { var r = indexedDB.open(dbName); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(new Error('open fail')); }; setTimeout(function () { rej(new Error('timeout')); }, 2000); });
          var stores = Array.prototype.slice.call(db.objectStoreNames || []).slice(0, 3);
          for (var st = 0; st < stores.length && out.length < 60; st++) {
            try {
              var tx = db.transaction(stores[st], 'readonly');
              var store = tx.objectStore(stores[st]);
              var rows = await new Promise(function (res) { var q = store.getAll(null, 20); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; setTimeout(function () { res([]); }, 2000); });
              rows.forEach(function (row) { walk(row, 'indexeddb:' + stores[st], 0); });
            } catch (e) {}
          }
          try { db.close(); } catch (e) {}
        } catch (e) {}
      }
    }
  } catch (e) {}
  return out;
})()`;
let sniffPollTimer = null;
function startSniffPolling() {
  if (sniffPollTimer) return;
  sniffPollTimer = setInterval(async () => {
    if (!sniffEnabled) return;
    const wv = $('#toolbox-webview');
    if (!wv || typeof wv.executeJavaScript !== 'function') return;
    try {
      const findings = await wv.executeJavaScript(`(window.__toolboxSniffFindings && window.__toolboxSniffFindings.length) ? window.__toolboxSniffFindings.splice(0, window.__toolboxSniffFindings.length) : []`);
      if (Array.isArray(findings) && findings.length) {
        for (const f of findings) {
          if (f.category === 'stream') upsertSniffItem({ category: 'stream', url: String(f.url || ''), name: String(f.url || ''), sourceUrl: String(f.url || ''), host: browserMediaHost(f.url || ''), messages: Number(f.messages || 0), bytes: Number(f.bytes || 0), preview: String(f.preview || ''), via: String(f.via || '流式') });
          else if (f.category === 'resp-body') addSniffAuth(f, true);
        }
        updateSniffFab(); renderSniffPanel();
      }
    } catch (e) { /* 页面读不到不影响 */ }
  }, 2000);
}
async function injectSniffPageHooks() {
  if (!sniffEnabled) return;
  const wv = $('#toolbox-webview');
  if (!wv || typeof wv.executeJavaScript !== 'function') return;
  try { await wv.executeJavaScript(SNIFF_PAGE_HOOK_SCRIPT); } catch (e) { /* 注入失败不影响浏览 */ }
}
let sniffScanRunning = false;
let lastSniffScanUrl = '';
async function scanAuthStorageAndPageData(reason) {
  if (!sniffEnabled || sniffScanRunning) return 0;
  const wv = $('#toolbox-webview');
  if (!wv || typeof wv.executeJavaScript !== 'function') return 0;
  sniffScanRunning = true;
  try {
    const findings = await wv.executeJavaScript(SNIFF_STORAGE_SCAN_SCRIPT);
    let n = 0;
    if (Array.isArray(findings)) for (const f of findings) {
      if (f.category === 'storage') { if (addSniffAuth(f, true)) n += 1; }
      else if (f.category === 'page-data') {
        upsertSniffItem({ category: 'page-data', name: String(f.name || ''), value: String(f.value || ''), sourceUrl: currentWebviewUrl(), host: browserMediaHost(currentWebviewUrl()), via: String(f.via || '内嵌 JSON') });
        n += 1;
      }
    }
    await refreshSniffCookies(); // 登录态复核：读当前站 cookie 进池
    updateSniffFab(); renderSniffPanel();
    return n;
  } catch (e) { return 0; }
  finally { sniffScanRunning = false; }
}
async function refreshSniffCookies() {
  if (!sniffEnabled) return 0;
  const url = currentWebviewUrl();
  if (!url) return 0;
  const wv = $('#toolbox-webview');
  let partition = 'persist:toolbox-browser';
  try { partition = (wv && wv.getAttribute && wv.getAttribute('partition')) || partition; } catch (e) { /* 读不到用默认分区 */ }
  try {
    const r = await window.toolbox.sniffAuthCookies(url, partition);
    if (!r || !r.ok || !Array.isArray(r.cookies)) return 0;
    let n = 0;
    for (const c of r.cookies) { if (addSniffAuth({ category: 'cookie', name: c.name, value: c.value, sourceUrl: url, host: browserMediaHost(url), expires: c.expirationDate || 0, via: 'Cookie 读取' }, true)) n += 1; }
    if (n) { updateSniffFab(); renderSniffPanel(); }
    return n;
  } catch (e) { return 0; }
}
/* 分析当前页面：video-sniff（与实时嗅探同一套分类与结果格式）+ 存储扫描，
 * 都进同一个池；粘贴网址入口已在 -10 去掉，不恢复。 */
/* 小圆点可拖动：拖动超过 6px 算拖动，不触发
 * 开关；位置存本机，下次打开还在原处。2026-11-28-12，第 1 项：恢复位置
 * 时夹在视口内（窗口变小、旧位置越界时自动复位，越界的存值也改回），
 * 窗口大小变了也重新夹一次；恢复逻辑提成具名函数，供自测调用。 */
function restoreSniffFabPos() {
  const fab = $('#browser-media-fab');
  if (!fab) return;
  try {
    const saved = JSON.parse(localStorage.getItem('sniff-fab-pos') || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const w = fab.offsetWidth || 48, h = fab.offsetHeight || 48;
      const left = Math.min(Math.max(0, saved.left), Math.max(0, window.innerWidth - w));
      const top = Math.min(Math.max(0, saved.top), Math.max(0, window.innerHeight - h));
      fab.style.left = `${left}px`; fab.style.top = `${top}px`;
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
      if (left !== saved.left || top !== saved.top) {
        try { localStorage.setItem('sniff-fab-pos', JSON.stringify({ left, top })); } catch (e) { /* 存不下不影响 */ }
      }
    }
  } catch (e) { /* 读不到按默认位置 */ }
}
(function () {
  const fab = $('#browser-media-fab');
  if (!fab) return;
  restoreSniffFabPos();
  window.addEventListener('resize', restoreSniffFabPos);
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
      try { localStorage.setItem('sniff-fab-pos', JSON.stringify({ left: parseInt(fab.style.left, 10) || 0, top: parseInt(fab.style.top, 10) || 0 })); } catch (e) { /* 存不下不影响 */ }
    }
  };
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', () => {
    if (moved >= 6) return; // 拖动后不触发开关
    sniffPanelOpen = !sniffPanelOpen;
    if (sniffPanelOpen) refreshSniffHistoryMeta();
    renderSniffPanel();
  });
})();
/* 2026-11-28-4，第 2 项：嗅探框可拖动、可调大小——抓标题行拖动，
 * 抓右下角拖边改大小；位置与大小存本机，下次打开恢复（越界自动夹回）。 */
function restoreSniffPanelRect() {
  const panel = $('#browser-media-panel');
  if (!panel) return;
  try {
    const saved = JSON.parse(localStorage.getItem('sniff-panel-rect') || 'null');
    if (!saved) return;
    const w = Math.min(Math.max(280, Number(saved.width) || 0), window.innerWidth - 16);
    const h = Math.min(Math.max(200, Number(saved.height) || 0), window.innerHeight - 16);
    const left = Math.min(Math.max(0, Number(saved.left) || 0), Math.max(0, window.innerWidth - 120));
    const top = Math.min(Math.max(0, Number(saved.top) || 0), Math.max(0, window.innerHeight - 60));
    if (w > 0) { panel.style.width = `${w}px`; panel.style.maxHeight = `${h}px`; }
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  } catch (e) { /* 读不到按默认位置 */ }
}
function saveSniffPanelRect() {
  const panel = $('#browser-media-panel');
  if (!panel) return;
  try {
    const r = panel.getBoundingClientRect();
    localStorage.setItem('sniff-panel-rect', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }));
  } catch (e) { /* 存不下不影响 */ }
}
(function () {
  const panel = $('#browser-media-panel');
  const head = $('#sniff-panel-head');
  const grip = $('#sniff-panel-resize');
  if (!panel || !head || !grip) return;
  restoreSniffPanelRect();
  window.addEventListener('resize', restoreSniffPanelRect);
  let mode = null; // 'move' | 'resize'
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // 标题行里的按钮照常点
    mode = 'move';
    sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointerdown', (e) => {
    mode = 'resize';
    sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect();
    ow = r.width; oh = r.height;
    grip.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  const move = (e) => {
    if (!mode) return;
    if (mode === 'move') {
      const left = Math.min(Math.max(0, e.clientX - ox), Math.max(0, window.innerWidth - 120));
      const top = Math.min(Math.max(0, e.clientY - oy), Math.max(0, window.innerHeight - 60));
      panel.style.left = `${left}px`; panel.style.top = `${top}px`;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    } else {
      const w = Math.min(Math.max(280, ow + (e.clientX - sx)), window.innerWidth - 16);
      const h = Math.min(Math.max(200, oh + (e.clientY - sy)), window.innerHeight - 16);
      panel.style.width = `${w}px`; panel.style.maxHeight = `${h}px`;
    }
  };
  const end = () => { if (mode) { mode = null; saveSniffPanelRect(); } };
  head.addEventListener('pointermove', move);
  grip.addEventListener('pointermove', move);
  head.addEventListener('pointerup', end);
  grip.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  grip.addEventListener('pointercancel', end);
})();
/* 启动时读一次开关（只读配置，不改）：开着时小圆点在各页都常驻。 */
(async () => {
  try { const ov = await window.toolbox.getOverview(); sniffEnabled = !!(ov && ov.config && ov.config.sniffEnabled); } catch (e) { /* 读不到按未开启 */ }
  updateSniffFab();
  startSniffPolling();
})();
$('#browser-media-clear').addEventListener('click', clearSniffPool);
$('#browser-media-close').addEventListener('click', () => { sniffPanelOpen = false; renderSniffPanel(); });
$('#browser-media-rescan').addEventListener('click', () => { scanAuthStorageAndPageData('manual'); });

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
// 自测桩：强制嗅探开关（与 __testLoginCheck 同一思路，供自测切自动保存路径）。
window.__testSetSniffEnabled = (v) => { sniffEnabled = !!v; };
/* 2026-11-28-7：第 4 项：从已登录页面尽力取账号标识——头像/账号
 * 菜单的 aria-label 或 title 优先，其次页面里的邮箱；取不到返回
 * 空串（自动保存时按站点去重）。只读展示文本，不读凭证值。 */
async function extractBrowserLoginIdentity() {
  const wv = $('#toolbox-webview');
  if (!wv || typeof wv.executeJavaScript !== 'function') return '';
  try {
    const id = await wv.executeJavaScript(`(() => {
      try {
        const labeled = document.querySelector('[aria-label*="账号" i], [aria-label*="账户" i], [title*="账号" i], [title*="账户" i]');
        if (labeled) { const t = ((labeled.getAttribute('aria-label') || labeled.getAttribute('title') || '')).trim(); if (t) return t.slice(0, 80); }
        const avatar = document.querySelector('[class*="avatar" i]');
        if (avatar) { const t = ((avatar.getAttribute('alt') || avatar.getAttribute('title') || avatar.textContent || '')).trim(); if (t) return t.slice(0, 80); }
        const txt = (document.body && document.body.innerText || '').slice(0, 2000);
        const m = txt.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        return m ? m[0].slice(0, 80) : '';
      } catch (e) { return ''; }
    })()`, false);
    return String(id || '').trim().slice(0, 80);
  } catch (e) { return ''; }
}
function accountSiteHost(a) {
  try { const u = new URL(a.loginUrl || ''); if (u.hostname) return u.hostname.toLowerCase(); } catch (e) { /* 不是合法地址时按站点名比 */ }
  return String(a.siteName || a.site || '').toLowerCase();
}
/* 2026-11-28-7：第 4 项：嗅探自动保存账号——嗅探开着时，登录检测
 * 命中已登录凭证就不再弹框，直接保存进账号管理。去重按“站点 +
 * 账号标识”（标识为空时按站点去重），非重复才保存；保存的只有
 * 站点、账号标识与登录地址，凭证值不保存（登录状态留在浏览器
 * 分区里）。保存后在账号管理里标“嗅探自动保存”，可删。 */
async function autoSaveSniffAccount(url, verified) {
  const host = browserMediaHost(url);
  if (!host) return { ok: false, error: '缺少站点' };
  try {
    const ignored = await callTb('browserLoginIgnored', host);
    if (ignored && ignored.ignored) return { ok: true, ignored: true };
  } catch (e) { /* 读不到忽略标记时继续保存 */ }
  let origin = '';
  try { origin = new URL(url).origin; } catch (e) { origin = ''; }
  const site = SNIFF_ACCOUNT_SITE_HOSTS[host.toLowerCase()] || 'custom';
  const identity = await extractBrowserLoginIdentity();
  const list = await window.toolbox.accountsList().catch(() => null);
  const arr = (list && list.accounts) || [];
  const dup = arr.some((a) => accountSiteHost(a) === host.toLowerCase()
    && String(a.identity || '').toLowerCase() === String(identity || '').toLowerCase());
  if (dup) return { ok: true, duplicate: true };
  const siteName = site === 'custom' ? host : (ACCOUNT_SITES[site]?.name || host);
  const r = await callTb('accountSave', {
    site, siteName, name: identity ? `${siteName} · ${identity}` : `${host} 账号`,
    identity, kind: 'credential', source: 'sniff', autoSavedAt: Date.now(),
    loginUrl: origin || url,
    note: '嗅探自动保存：检测到已登录。凭证值未保存，登录状态保留在浏览器分区。',
  });
  if (r && r.ok) loginPromptedAt.set(host, Date.now());
  return r || { ok: false, error: '后端没有返回原因' };
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
  // 2026-11-28-7：第 4 项：嗅探开着时不弹框，检测到实际登录就直接
  // 自动保存进账号管理（站点 + 账号标识去重）；嗅探关着时保持原
  // 来的弹框提示。
  if (sniffEnabled) {
    const saved = await autoSaveSniffAccount(url, verified).catch(() => null);
    if (saved && saved.ok && !saved.duplicate && !saved.ignored) toast(`已自动保存到账号管理：${host}`);
    else if (saved && saved.ok === false) toast((saved && saved.error) || '账号自动保存失败');
    return;
  }
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
  // 2026-11-28-2：便携版 Chromium 已删除；内嵌浏览器是 Electron
  // webview，常驻可用，不再有下载状态与设置/扩展页。
  const statusEl = $('#browser-status');
  if (statusEl) statusEl.textContent = '内嵌浏览器无需下载，点开即用。';
  renderChromeTabs();
  updateChromeView();
}
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
  deepseek: { name: 'DeepSeek', loginUrl: 'https://chat.deepseek.com', signupUrl: 'https://chat.deepseek.com/sign-up' },
  doubao: { name: '豆包', loginUrl: 'https://www.doubao.com/chat/', signupUrl: 'https://www.doubao.com/chat/' },
  qwen: { name: '通义千问', loginUrl: 'https://chat.qwen.ai', signupUrl: 'https://chat.qwen.ai' },
  gemini: { name: 'Gemini', loginUrl: 'https://gemini.google.com', signupUrl: 'https://gemini.google.com' },
  custom: { name: '自定义', loginUrl: '', signupUrl: '' },
};
const ACCOUNT_KIND_NAMES = { credential: '凭证', password: '密码', api: 'API 密钥' };
/* 2026-11-28-7：嗅探自动保存认的站点——域名映射到账号站点；不在
 * 表里的按 custom 存（站点名取域名）。 */
const SNIFF_ACCOUNT_SITE_HOSTS = {
  'chat.deepseek.com': 'deepseek', 'www.doubao.com': 'doubao', 'doubao.com': 'doubao',
  'chat.qwen.ai': 'qwen', 'tongyi.aliyun.com': 'qwen', 'qwen.ai': 'qwen',
  'gemini.google.com': 'gemini', 'accounts.google.com': 'google', 'github.com': 'github',
  'login.microsoftonline.com': 'microsoft',
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
    .filter((a) => !q || [a.siteName, a.site, a.name, a.group, a.note, a.identity]
      .some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => {
      const sa = String(a.siteName || a.site || ''), sb = String(b.siteName || b.site || '');
      return sa.localeCompare(sb, 'zh') || (accountTimeValue(b.lastUsedAt) - accountTimeValue(a.lastUsedAt));
    });
  box.innerHTML = '';
  if (!rows.length) {
    box.className = 'list empty-note';
    box.textContent = accountsCache.length ? '没有符合条件的账号。' : '暂无账号，点「新增账号」添加。';
    return;
  }
  box.className = 'list';
  // 2026-11-28-7：第 4 项：按网站分组列表。
  let lastSite = null;
  for (const a of rows) {
    const siteName = a.siteName || ACCOUNT_SITES[a.site]?.name || a.site || '';
    if (siteName !== lastSite) {
      lastSite = siteName;
      box.appendChild(el('div', 'account-group-head', siteName));
    }
    const wrap = el('div', 'row');
    const main = el('div', 'row-main');
    const title = el('div', 'row-title', `${a.name || ''}${a.identity ? ` · ${a.identity}` : ''}`);
    main.appendChild(title);
    const subParts = [];
    subParts.push(ACCOUNT_KIND_NAMES[a.kind] || '凭证');
    if (a.group) subParts.push(a.group);
    if (a.note) subParts.push(a.note);
    subParts.push(a.hasProxy ? `代理：${a.proxySummary || '已设置'}` : '直连');
    subParts.push(a.lastUsedAt ? `最近使用 ${fmtTime(a.lastUsedAt)}` : '未使用过');
    main.appendChild(el('div', 'row-sub', subParts.join(' · ')));
    if (a.hasSecret) main.appendChild(el('div', 'row-sub', `密钥值：${a.secretMasked || '••••'}`));
    wrap.appendChild(main);
    if (a.source === 'sniff') wrap.appendChild(el('span', 'badge', '嗅探自动保存'));
    if (a.id === activeAccountId) wrap.appendChild(el('span', 'badge', '正在使用'));
    if (a.status === 'registering') wrap.appendChild(el('span', 'badge', '注册中'));
    if (a.hasSecret) {
      const copyBtn = el('button', 'btn small', '复制密钥');
      copyBtn.type = 'button';
      copyBtn.title = '复制完整密钥值';
      copyBtn.addEventListener('click', async () => {
        const r = await window.toolbox.accountCopySecret(a.id).catch(() => null);
        toast(r && r.ok ? '已复制密钥值' : ((r && r.error) || '复制失败'));
      });
      wrap.appendChild(copyBtn);
    }
    const openBtn = el('button', 'btn small primary', '打开');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openAccount(a.id));
    wrap.appendChild(openBtn);
    const editBtn = el('button', 'btn small', '编辑');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openAccountDrawer(a)); // 2026-11-27-4：编辑进抽屉回填
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
  $('#account-signup-url').placeholder = 'https://…（可选）';
  $('#account-kind').value = (a && a.kind) || 'credential';
  $('#account-identity').value = (a && a.identity) || '';
  $('#account-secret').value = ''; // 密钥值不回填，留空表示不改
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
$('#account-new').addEventListener('click', () => openAccountDrawer(null)); // 2026-11-27-4：新增进抽屉，表单清空
$('#account-save').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '保存中…');
  const site = $('#account-site').value;
  const name = $('#account-name').value.trim();
  if (!name) { finish(false, '先填账号名'); return; }
  const loginUrl = $('#account-login-url').value.trim();
  const signupUrl = $('#account-signup-url').value.trim();
  // 2026-11-28-7：第 4 项：自定义站点只要求登录地址，注册地址可选——
  // 以前两个都强制，用户连网站都加不进来。
  if (site === 'custom' && !loginUrl) { finish(false, '自定义站点先填登录地址'); return; }
  const cur = accountsCache.find((a) => a.id === currentAccountId) || {};
  const defaults = ACCOUNT_SITES[site] || ACCOUNT_SITES.custom;
  let siteName = defaults.name;
  if (site === 'custom') {
    try { siteName = new URL(loginUrl).hostname || '自定义'; } catch (e) { siteName = '自定义'; }
  }
  const proxyHost = $('#account-proxy-host').value.trim();
  const proxyPort = parseInt($('#account-proxy-port').value, 10);
  if (proxyHost && (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) { finish(false, '代理端口须为 1-65535 的数字'); return; }
  const proxyPass = $('#account-proxy-pass').value;
  const fpW = parseInt($('#account-fp-width').value, 10);
  const fpH = parseInt($('#account-fp-height').value, 10);
  const secretVal = $('#account-secret').value;
  const account = {
    id: currentAccountId || undefined,
    site,
    siteName,
    loginUrl: site === 'custom' ? loginUrl : (cur.loginUrl || defaults.loginUrl),
    signupUrl: site === 'custom' ? (signupUrl || '') : (cur.signupUrl || defaults.signupUrl),
    name,
    kind: $('#account-kind').value,
    identity: $('#account-identity').value.trim(),
    // 密钥值留空表示不改（不发字段，后端沿用旧值）；填了才发。
    ...(secretVal ? { secret: secretVal } : {}),
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
  if (!r || r.ok === false) { finish(false, `账号没有保存：${(r && r.error) || '后端没有返回原因'}`); return; }
  if (r.account && r.account.id) currentAccountId = r.account.id;
  finish(true, '账号已保存');
  renderAccounts();
});
async function deleteAccount(id) {
  const a = accountsCache.find((x) => x.id === id);
  if (!await customConfirm('删除账号', `确定删除账号「${(a && a.name) || ''}」吗？`, '删除')) return;
  const r = await callTb('accountDelete', id);
  if (!r || r.ok === false) { toast(`账号没有删除：${(r && r.error) || '后端没有返回原因'}`); return; }
  if (id === currentAccountId) { currentAccountId = null; fillAccountForm(null); }
  if (id === activeAccountId) restoreDefaultWebview();
  closeDrawer({ restoreFocus: false }); // 在抽屉里删的，删完关抽屉
  toast(`账号已删除：${(a && a.name) || ''}`);
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
  else wv.setAttribute('useragent', embeddedBrowserUA());
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
  syncNativeViewVisibility(); // 重建后按新规则处理隐藏状态（抽屉/弹窗开着、或不在浏览器屏时藏起来）
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
  embeddedBrowserKind = 'chromium'; // 回到默认分区，内嵌浏览器种类复位
  hideRegisterBanner();
  updateAccountChromeUI();
  chromeTabs[chromeActive] = { title: '新标签页', url: '' };
  $('#chrome-url').value = '';
  renderChromeTabs();
  loadChromeWebview('');
  syncNativeViewVisibility(); // 重建后按新规则处理隐藏状态
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
  closeDrawer({ restoreFocus: false }); // 开始注册要切到浏览器屏，先关抽屉
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

/* ---------- 设置 ---------- */
function gotoSettingsTab(name) {
  $$('#settings-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.settingsTab === name));
  $$('#screen-settings .tabpane').forEach((p) => p.classList.toggle('active', p.id === `settings-pane-${name}`));
  if (name === 'phone') renderPhoneRemote();
}
$$('#settings-tabs .tab').forEach((b) => b.addEventListener('click', () => gotoSettingsTab(b.dataset.settingsTab)));

/* ---------- 手机远程（2026-11-28-5） ---------- */
const PHONE_REMOTE_DANGER_LABELS = { deleteFile: '删文件（移入回收站）', uninstall: '卸载软件', publish: '发版推库', proxy: '改代理模式', tokenManage: '管理配对令牌' };
async function renderPhoneRemote() {
  const st = await window.toolbox.phoneRemoteStatus().catch(() => null);
  if (!st) return;
  const setText = (id, text) => { const e = $(id); if (e) e.textContent = text; };
  const en = $('#phone-remote-enabled'); if (en) en.checked = st.enabled === true;
  setText('#phone-remote-status-line', st.running ? `运行中 · 端口 ${st.port} · 在线手机 ${st.onlineCount} 台` : (st.enabled ? '已开启，但监听失败（请看主进程日志）' : '未开启'));
  setText('#phone-remote-addrs', '监听地址：' + (st.addrs && st.addrs.length ? st.addrs.map((a) => `https://${a}:${st.port || '—'}`).join('、') : '—'));
  const ts = st.tailscale || {};
  setText('#phone-remote-tailscale', ts.detected ? `Tailscale：已检测到 ${ts.ip}` : 'Tailscale：未检测到——请先在电脑与手机上安装 Tailscale 并登录同一个账号，再点刷新状态。');
  setText('#phone-remote-fingerprint', st.fingerprint ? `证书指纹（SHA-256）：${st.fingerprint}` : '证书指纹：服务开启后生成');
  const devBox = $('#phone-remote-devices');
  if (devBox) {
    devBox.innerHTML = '';
    if (!st.devices || !st.devices.length) { devBox.className = 'list empty-note'; devBox.textContent = '暂无已配对手机。'; }
    else {
      devBox.className = 'list';
      for (const d of st.devices) {
        const row = el('div', 'row');
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', d.name || '手机'));
        main.appendChild(el('div', 'row-sub', `配对 ${new Date(d.createdAt).toLocaleString('zh-CN')} · 上次连接 ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('zh-CN') : '从未'}`));
        row.appendChild(main);
        const revoke = el('button', 'btn small', '吊销');
        revoke.type = 'button';
        revoke.addEventListener('click', async () => {
          const go = await customConfirm('吊销这台手机', `吊销后「${d.name || '手机'}」立刻断开，需要重新扫码配对才能再连。`, '吊销');
          if (!go) return;
          await window.toolbox.phoneRemoteRevoke(d.id).catch(() => ({}));
          toast('已吊销');
          renderPhoneRemote();
        });
        row.appendChild(revoke);
        devBox.appendChild(row);
      }
    }
  }
  const dg = $('#phone-remote-danger');
  if (dg) {
    dg.innerHTML = '';
    for (const k of Object.keys(PHONE_REMOTE_DANGER_LABELS)) {
      const lab = el('label', 'field-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!(st.dangerous && st.dangerous[k]);
      cb.addEventListener('change', async () => {
        await window.toolbox.phoneRemoteSetDangerous(k, cb.checked).catch(() => ({}));
        renderPhoneRemote();
      });
      lab.appendChild(cb);
      lab.appendChild(el('span', '', PHONE_REMOTE_DANGER_LABELS[k]));
      dg.appendChild(lab);
    }
  }
  const logBox = $('#phone-remote-logs');
  if (logBox) {
    logBox.innerHTML = '';
    if (!st.logs || !st.logs.length) { logBox.className = 'list empty-note'; logBox.textContent = '暂无远程操作。'; }
    else {
      logBox.className = 'list';
      for (const l of st.logs.slice(0, 50)) {
        const row = el('div', 'row');
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', `${l.op || ''}${l.ok === false ? '（失败）' : ''}`));
        main.appendChild(el('div', 'row-sub', `${l.device || ''}${l.detail ? ` · ${l.detail}` : ''}`));
        row.appendChild(main);
        row.appendChild(el('div', 'row-sub', new Date(l.at).toLocaleString('zh-CN')));
        logBox.appendChild(row);
      }
    }
  }
}
$('#phone-remote-enabled').addEventListener('change', async (e) => {
  const box = e.target;
  box.disabled = true;
  const r = await window.toolbox.phoneRemoteSetEnabled(box.checked).catch((err) => ({ ok: false, error: err.message || String(err) }));
  box.disabled = false;
  if (r && r.ok === false) toast(r.error || '开启失败');
  else toast(box.checked ? '手机远程已开启' : '手机远程已关闭');
  renderPhoneRemote();
});
$('#phone-remote-refresh').addEventListener('click', async () => {
  await window.toolbox.phoneRemoteTailscale().catch(() => ({}));
  renderPhoneRemote();
});
$('#phone-remote-pair-btn').addEventListener('click', async () => {
  const r = await window.toolbox.phoneRemoteAllowPair().catch((err) => ({ ok: false, error: err.message || String(err) }));
  if (!r || r.ok === false) { toast((r && r.error) || '生成配对码失败'); return; }
  $('#phone-remote-pair-box').classList.remove('hidden');
  $('#phone-remote-pair-code').textContent = r.code;
  $('#phone-remote-qr').innerHTML = r.qrSvg || '';
  $('#phone-remote-pair-url').textContent = '扫码地址：' + r.url;
  const tsWrap = $('#phone-remote-qr-ts-wrap');
  if (r.urlTs) {
    tsWrap.classList.remove('hidden');
    $('#phone-remote-qr-ts').innerHTML = r.qrSvgTs || '';
    $('#phone-remote-qr-ts').classList.add('hidden');
  } else tsWrap.classList.add('hidden');
});
$('#phone-remote-qr-ts-btn').addEventListener('click', () => {
  const t = $('#phone-remote-qr-ts');
  if (t) t.classList.toggle('hidden');
});

/* ---------- 菜单页分标签（2026-11-26-7）：一个页面堆多组功能的页拆成标签 ----------
 * 已拆：创作、图像、监控、远程、视频下载、代理。
 * 2026-11-27-2：媒体页已删，不再拆。
 * 未拆：工具、设置、智能体、注册、文件（已有标签）；播放器、浏览器
 * （已是子视图切换）；账号管理（按任务约束不动）；插件、工具箱
 * 总览（单组功能，无需拆）；代码（左右分栏是同一编辑流程的两部分）。 */
function gotoPageTab(screen, attr, prefix, name) {
  $$(`#screen-${screen} .tab`).forEach((b) => b.classList.toggle('active', b.dataset[attr] === name));
  $$(`#screen-${screen} .tabpane`).forEach((p) => p.classList.toggle('active', p.id === `${prefix}-${name}`));
}
$$('#screen-create [data-create-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('create', 'createTab', 'create-tab', b.dataset.createTab)));
$$('#screen-image [data-image-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('image', 'imageTab', 'image-tab', b.dataset.imageTab)));
$$('#screen-monitor [data-monitor-tab]').forEach((b) => b.addEventListener('click', () => gotoPageTab('monitor', 'monitorTab', 'monitor-tab', b.dataset.monitorTab)));
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
  const pm = $('#proxy-mode'); if (pm) pm.value = ov.config.proxyMode || 'direct';
  const ph = $('#proxy-host'); if (ph) ph.value = ov.config.proxyHost || '';
  const pp = $('#proxy-port'); if (pp) pp.value = ov.config.proxyPort || '';
  $('#about-line').textContent = `桌面工具箱 · 版本 ${ov.version} · 更新走 GitHub Releases（zmfs9192/zhuo-mian-liao-tian-kong-jian），只手动检查与更新，不自动检查。`;
  /* 2026-11-27-10，第 5 项：默认应用下拉只列已装的；未装时只显示“未安装”。 */
  const [pApps, bApps] = await Promise.all([window.toolbox.playerApps().catch(() => ({})), window.toolbox.browserApps().catch(() => ({}))]);
  fillDefaultAppSelect($('#default-player'), pApps, ['vlc', 'potplayer', 'mpv']);
  fillDefaultAppSelect($('#default-browser'), bApps, ['chromium', 'chrome', 'edge']);
  if (ov.config.defaultPlayer && [...$('#default-player').options].some((o) => o.value === ov.config.defaultPlayer)) $('#default-player').value = ov.config.defaultPlayer;
  if (ov.config.defaultBrowser && [...$('#default-browser').options].some((o) => o.value === ov.config.defaultBrowser)) $('#default-browser').value = ov.config.defaultBrowser;
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
  applyTheme(winCfg); // 2026-11-27-4：主题与壁纸按配置应用；控件由 A 路建，bindThemeControls 幂等绑定
  bindThemeControls();
  renderBackupSync();
  renderUpdateSection();
  renderWindowStatus();
  renderAdminStatus();
  renderPhoneRemote(); // 2026-11-28-5：手机远程子页
  renderScreenTranslateSettings(ov.config || {}); // 2026-11-28-6：屏幕翻译小节
}
/* 2026-11-28-6：屏幕翻译设置小节——快捷键显示、浮窗行为；
 * 语言方向与轮巡智能体沿用翻译插件的设置，这里不重复配置；
 * 未配轮巡时把去处写在状态行里。 */
async function renderScreenTranslateSettings(cfg) {
  const box = $('#screen-translate-autoclose');
  if (box) box.checked = !!(cfg.screenTranslate && cfg.screenTranslate.autoClose);
  const line = $('#screen-translate-status-line');
  if (!line) return;
  try {
    const st = await window.toolbox.screenTranslateStatus();
    line.textContent = `快捷键 ${st.shortcut || 'Ctrl+Alt+T'}${st.shortcutRegistered ? '（已注册）' : '（注册失败）'}；语言方向与轮巡智能体沿用翻译插件的设置${st.configured ? '。' : '——' + (st.error || '未配轮巡智能体') + '。'}`;
  } catch (e) {
    line.textContent = '快捷键 Ctrl+Alt+T；语言方向与轮巡智能体沿用翻译插件的设置。';
  }
}
$('#screen-translate-start-btn').addEventListener('click', () => startScreenTranslateFromUi());
$('#screen-translate-autoclose').addEventListener('change', async (e) => {
  await window.toolbox.setConfig({ screenTranslate: { autoClose: !!e.target.checked } });
});
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
  setWinMaxIcon(r.maximized);
});
$('#win-close').addEventListener('click', () => window.toolbox.windowClose());
/* 侧边栏顶部是拖拽区，双击切换最大化（点按钮不触发） */
$('#sidebar-head').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  window.toolbox.windowMaximize().then((r) => { setWinMaxIcon(r.maximized); });
});
window.toolbox.on('window-state', ({ maximized }) => {
  setWinMaxIcon(maximized);
});
$('#pick-dir').addEventListener('click', async () => {
  const dir = await window.toolbox.pickDir();
  if (dir) { await window.toolbox.setConfig({ downloadDir: dir }); renderSettings(); }
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
    ? (st.source === 'rollback'
      ? `已回滚 ${st.updatedFiles.length} 个代码文件到 ${st.updatedVersion || ''}（${st.updatedFiles.join('、')}），点「重启生效」后用该版本。`
      : `已更新 ${st.updatedFiles.length} 个代码文件到 ${st.updatedVersion || ''}（${st.updatedFiles.join('、')}），旧文件已备份。点「重启生效」后用新版本。`)
    : '';
  /* 2026-11-27-5：回滚入口——显示可回滚版本，无备份时置灰。 */
  try {
    const rb = await window.toolbox.rollbackInfo();
    const rbInfo = $('#update-rollback-info');
    const rbBtn = $('#update-rollback');
    const pinnedNote = rb && rb.pinnedVersion ? `已钉住版本 ${rb.pinnedDisplay || rb.pinnedVersion}，检查更新时跳过它。` : '';
    if (rb && rb.candidate) {
      if (rbInfo) rbInfo.textContent = `可回滚版本：${rb.candidate.displayVersion}（备份于 ${new Date(rb.candidate.mtime).toLocaleString('zh-CN')}）。回滚后当前版本 ${rb.fromDisplay || ''} 会被钉住，检查更新时不再提示它。${pinnedNote}`;
      if (rbBtn) { rbBtn.disabled = false; rbBtn.textContent = `回滚到 ${rb.candidate.displayVersion}`; }
    } else {
      if (rbInfo) rbInfo.textContent = pinnedNote ? `${pinnedNote}暂无可回滚的备份。` : '可回滚版本：无（尚未更新过，或备份已被清理）。';
      if (rbBtn) { rbBtn.disabled = true; rbBtn.textContent = '回滚到上一版本'; }
    }
  } catch (e) { /* 回滚信息读不到不影响更新区 */ }
  /* 2026-11-27-4 复核：更新子页“清单还没有推上 GitHub”一句已过时——
   * 远端清单（main 分支 desktop-toolbox/update-manifest.json）实测已是
   * 2026-11-27-3，与本地版本一致。index.html 原文不由本路改，这里运行
   * 时改写为当前状态；A 路发版时同步删原文。 */
  const staleNote = [...document.querySelectorAll('#settings-pane-update p.desc')]
    .find((p) => (p.textContent || '').includes('还没有推上'));
  if (staleNote) {
    staleNote.textContent = '更新清单已在 GitHub 仓库（desktop-toolbox/update-manifest.json），与代码一起发布；查不到清单时会如实显示「未找到更新信息」。下载前会先备份旧文件，下载或校验失败就保留旧文件，不会把程序弄坏。';
  }
  refreshPublishStatus(); // 发布按钮按本地/远端版本决定是否置灰
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
/* 2026-11-27-5：回滚到上一版本——先确认，再调主进程回滚；状态反馈按更新页模板。 */
let rollbackRunningUi = false;
$('#update-rollback').addEventListener('click', async (e) => {
  const btn = $('#update-rollback');
  if (!btn || btn.disabled || rollbackRunningUi) return;
  let info = null;
  try { info = await window.toolbox.rollbackInfo(); } catch (err) { info = null; }
  const cand = info && info.candidate;
  if (!cand) { $('#update-result').textContent = '没有可用的备份：尚未更新过，或备份已被清理。'; return; }
  const ok = await customConfirm('回滚到上一版本', `回滚到 ${cand.displayVersion} 吗？回滚后当前版本 ${info.fromDisplay || ''} 会被钉住，检查更新时不再提示它。回滚完成要点「重启生效」。`);
  if (!ok) return;
  rollbackRunningUi = true;
  const finish = beginAsync(btn, '回滚中…', $('#update-result'));
  try {
    const r = await window.toolbox.rollback();
    if (!r || r.ok === false) { finish(false, `回滚失败：${(r && r.error) || '未知原因'}（旧文件已保留）`); return; }
    finish(true, `已回滚到 ${r.version || cand.displayVersion}：点「重启生效」后用该版本。`);
  } catch (err) { finish(false, `回滚失败：${err.message || err}`); }
  await renderUpdateSection();
  rollbackRunningUi = false;
});
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

/* ----- 智能体：列表 / 技能 / 定时触发（2026-11-27-10） -----
 * 对话不在标签栏里：聊天窗口只由侧栏「新对话」与最近聊天以编程方式打开
 * （gotoAgentTab('chat')）；对话列表卡片已去掉，后端数据与 IPC 不动。
 * 长期记忆没有单独页签，并进智能体列表页。技能是本地技能管理
 * （skills.json），挂到智能体上后调用时把指令拼进系统提示。 */
function gotoAgentTab(name) {
  $$('#screen-agents .tab').forEach((b) => b.classList.toggle('active', b.dataset.agentTab === name));
  $$('#screen-agents .tabpane').forEach((p) => p.classList.toggle('active', p.id === `agent-tab-${name}`));
  if (name === 'list') renderAgentMemory();
  if (name === 'skills') renderSkills();
  if (name === 'triggers') { renderAgentTriggers(); renderEventTriggerStatus(); }
}
$$('#screen-agents .tab').forEach((b) => b.addEventListener('click', () => gotoAgentTab(b.dataset.agentTab)));
/* 服务商表（地址与默认模型取表首选模型；
 * 表里没列模型的，模型留空、由用户填写，与豆包现有做法一致）。
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
$('#agent-web-verify').addEventListener('click', async (e) => {
  if (!currentAgentId) { toast('先保存智能体'); return; }
  const finish = beginAsync(e.currentTarget, '验证中…', $('#agent-web-status'));
  const r = await callTb('agentWebVerify', currentAgentId);
  if (!r || r.ok === false) { finish(false, `验证没有通过：${(r && r.error) || '后端没有返回原因'}`); return; }
  finish(true, r.login ? `已登录：${r.login}` : '验证通过');
  if (r.collisionWith) toast(`注意：与「${r.collisionWith}」是同一账号，共用登录态与官网历史。`);
  renderAgents();
});
/* 2026-11-28-2：抽屉里的同账号碰撞提示（与列表同一规则）。 */
async function updateAgentCollisionHint(a) {
  const hint = $('#agent-web-collision');
  if (!hint) return;
  hint.textContent = '';
  if (!a || a.connectionType !== 'web' || !a.webIdentityHash) return;
  const agents = await window.toolbox.agentsList().catch(() => []);
  const other = agents.find((x) => x.id !== a.id && x.connectionType === 'web'
    && String(x.webSite || x.provider || '').toLowerCase() === String(a.webSite || a.provider || '').toLowerCase()
    && x.webIdentityHash && x.webIdentityHash === a.webIdentityHash);
  if (other) hint.textContent = `⚠ 与「${other.name}」是同一账号，共用登录态与官网历史。`;
}
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
      // 2026-11-28-2：同站同账号身份哈希的智能体是同一账号，
      // 共用登录态与官网历史，列表里提示，避免认错。
      const collision = a.connectionType === 'web' && a.webIdentityHash
        ? agents.find((x) => x.id !== a.id && x.connectionType === 'web'
          && String(x.webSite || x.provider || '').toLowerCase() === String(a.webSite || a.provider || '').toLowerCase()
          && x.webIdentityHash && x.webIdentityHash === a.webIdentityHash)
        : null;
      main.appendChild(el('div', 'row-sub', `${a.model || ''} · ${connLabel}${(a.skillIds || []).length ? ` · 技能 ${(a.skillIds || []).length} 个` : ''}${collision ? ` · ⚠ 与「${collision.name}」同一账号` : ''}`));
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
      const edit = el('button', 'btn small', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', () => openAgentDrawer(a)); // 2026-11-27-4：编辑进抽屉回填
      row.appendChild(edit);
      box.appendChild(row);
    }
  }
  /* 2026-11-27-4：取消“进入页面自动回填首条智能体”——未选时抽屉不自动
   * 打开，设置页只显示列表与空状态引导。 */
  const emptyNote = document.getElementById('agent-settings-empty');
  if (emptyNote) emptyNote.classList.toggle('hidden', !!currentAgentId);
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
  // 2026-11-28-2：抽屉里的同账号碰撞提示（与列表同一规则）。
  void updateAgentCollisionHint(a);
  /* 2026-11-27-4 新增配置项（agents.json 现无对应字段时按默认值容错，
   * 未填时按现状行为；主进程 agent-save 用展开保存，新字段会落盘）。 */
  const tempEl = $('#agent-temperature');
  if (tempEl) tempEl.value = numOr(a.temperature, 0.7);
  const ctxEl = $('#agent-context-length');
  if (ctxEl) ctxEl.value = Math.max(1, Math.round(numOr(a.contextLength, 20)));
  const streamEl = $('#agent-streaming');
  if (streamEl) streamEl.checked = a.streaming !== false;
  const toolEl = $('#agent-tool-call');
  if (toolEl) toolEl.checked = a.toolsEnabled === true;
  const proxyEl = $('#agent-proxy-policy');
  if (proxyEl) proxyEl.value = a.proxyPolicy || 'global';
  // 2026-11-27-10：技能挂接复选框（抽屉「提示词与参数」页签里渲染）。
  void renderAgentSkillBox(a.skillIds || []);
  updateAgentWebFields();
  const prov = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].base && PROVIDERS[k].base === a.baseUrl) || 'custom';
  $('#agent-provider').value = prov;
}
$('#agent-provider').addEventListener('change', (e) => {
  const p = PROVIDERS[e.target.value] || PROVIDERS.custom;
  $('#agent-base').value = p.base;
  if (p.model) $('#agent-model').value = p.model;
});
$('#agent-save').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '保存中…');
  const name = $('#agent-name').value.trim();
  const baseUrl = $('#agent-base').value.trim();
  const model = $('#agent-model').value.trim();
  const key = $('#agent-key').value.trim();
  if (!name) { finish(false, '先填智能体名称'); return; }
  const agents = await window.toolbox.agentsList().catch(() => []);
  const cur = agents.find((a) => a.id === currentAgentId) || {};
  const r = await window.toolbox.agentSave({
    id: currentAgentId, name, baseUrl, apiKey: key || undefined, model,
    systemPrompt: $('#agent-system').value.trim(),
    connectionType: $('#agent-conn-type').value, webSite: $('#agent-web-site').value,
    webToken: $('#agent-web-token').value.trim() || undefined,
    /* 2026-11-27-4 新增字段：温度默认 0.7、上下文长度默认 20、流式默认开、
     * 工具调用默认关、代理策略默认跟随全局；缺失时按现状行为。 */
    temperature: numOr($('#agent-temperature') ? $('#agent-temperature').value : undefined, 0.7),
    contextLength: Math.max(1, Math.round(numOr($('#agent-context-length') ? $('#agent-context-length').value : undefined, 20))),
    streaming: $('#agent-streaming') ? $('#agent-streaming').checked : true,
    // 2026-11-28-2：toolCall 改名 toolsEnabled，与后端读取的字段
    // 一致（以前抽屉写 toolCall、后端读 toolsEnabled，开关恒开）。
    toolsEnabled: $('#agent-tool-call') ? $('#agent-tool-call').checked : false,
    proxyPolicy: $('#agent-proxy-policy') ? $('#agent-proxy-policy').value : 'global',
    // 2026-11-27-10：挂到该智能体上的技能；技能框没渲染出来时沿用旧值，不清空。
    skillIds: agentSkillBoxReady ? [...document.querySelectorAll('#agent-skill-box input:checked')].map((c) => c.value) : (cur.skillIds || []),
    memories: cur.memories || [], triggers: cur.triggers || [],
  });
  if (r && r.ok === false) { finish(false, `智能体没有保存：${r.error || '后端没有返回原因'}`); return; }
  if (r && r.agent) currentAgentId = r.agent.id;
  $('#agent-key').value = '';
  finish(true, '智能体已保存');
  renderAgents();
  renderSkills();
});
$('#agent-new').addEventListener('click', () => openAgentDrawer(null)); // 2026-11-27-4：新建进抽屉
// 2026-11-28-7：“补齐主流网页智能体”已删除——不再一键建空壳智能体；
// 网页智能体站的登录账号改由嗅探在检测到实际登录时自动保存进账号管理。
$('#agent-delete').addEventListener('click', async () => {
  if (!currentAgentId) return;
  const cur = (await window.toolbox.agentsList().catch(() => [])).find((a) => a.id === currentAgentId);
  if (!await confirmDelete('删除智能体', (cur && cur.name) || '', '删除后该智能体的对话与记忆也会一起删掉，无法恢复。')) return;
  await window.toolbox.agentDelete(currentAgentId);
  const deletedName = (cur && cur.name) || '';
  currentAgentId = null;
  currentChatId = null;
  $('#agent-name').value = ''; $('#agent-base').value = ''; $('#agent-model').value = ''; $('#agent-key').value = '';
  closeDrawer({ restoreFocus: false });
  toast(`智能体已删除：${deletedName}`);
  renderAgents();
  renderSkills();
  renderChat(null);
});
function renderChat(chat) {
  const box = $('#chat-msgs');
  box.innerHTML = '';
  if (!chat) { $('#chat-title').textContent = '新对话'; box.innerHTML = '<p class="empty-note">选一个智能体，点侧栏「新对话」开始聊。</p>'; return; }
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
  // 2026-11-28-2：失败重发——最后一条是用户消息（发送失败、还没
  // 助手回复）时给“重新生成”按钮，只重调模型，不追加用户消息。
  const msgs = chat.messages || [];
  if (msgs.length && msgs[msgs.length - 1].role === 'user') {
    const bar = el('div', 'toolbar');
    const regen = el('button', 'btn small', '重新生成');
    regen.type = 'button';
    regen.addEventListener('click', async () => {
      const finish = beginAsync(regen, '重新生成中…');
      const r = await window.toolbox.agentChatRegenerate(chat.id);
      if (r && r.chat) renderChat(r.chat);
      if (r && r.ok === false) finish(false, `重新生成没有成功：${r.error || '后端没有返回原因'}`);
      else if (r && r.stopped) finish(true, '已停止');
      else finish(true, '');
      renderRecent();
    });
    bar.appendChild(regen);
    box.appendChild(bar);
  }
  box.scrollTop = box.scrollHeight;
}
async function openAgentChat(chatId) {
  const chat = await window.toolbox.agentChatGet(chatId);
  if (!chat) return;
  currentChatId = chat.id;
  currentAgentId = chat.agentId;
  setMenuActive('agents');
  gotoScreen('agents');
  renderAgents();
  gotoAgentTab('chat');
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
/* 2026-11-28-2：流式回推——主进程发 agent-chat-delta 时，把当前
 * 对话里最后一条助手气泡（流式占位）逐块更新；发完后 renderChat
 * 重绘最终结果。 */
let chatStreaming = false;
window.toolbox.on('agent-chat-delta', ({ chatId, text }) => {
  if (!chatStreaming || chatId !== currentChatId) return;
  const box = $('#chat-msgs');
  if (!box) return;
  let d = box.querySelector('.msg.ai.streaming');
  if (!d) {
    d = el('div', 'msg ai streaming', '');
    box.appendChild(d);
  }
  d.textContent = text;
  box.scrollTop = box.scrollHeight;
});
async function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentChatId) { await newAgentChat(); if (!currentChatId) return; }
  input.value = '';
  const btn = $('#chat-send');
  const stopBtn = $('#chat-stop');
  const finish = beginAsync(btn, '发送中…');
  if (stopBtn) stopBtn.classList.remove('hidden');
  chatStreaming = true;
  const r = await window.toolbox.agentChatSend(currentChatId, text);
  chatStreaming = false;
  if (stopBtn) stopBtn.classList.add('hidden');
  if (r && r.chat) renderChat(r.chat);
  if (r && r.ok === false) finish(false, `发送没有成功：${r.error || '后端没有返回原因'}`);
  else if (r && r.pending) finish(true, '这个操作要先确认：点聊天里的「确认执行」才跑');
  else if (r && r.stopped) finish(true, '已停止');
  else finish(true, '');
  renderRecent();
}
$('#chat-send').addEventListener('click', sendChat);
$('#chat-stop').addEventListener('click', () => {
  if (!currentChatId) return;
  window.toolbox.agentChatStop(currentChatId);
});
$('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

/* ----- 长期记忆（只存本机） ----- */
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
      if (!await confirmDelete('删除记忆', (m.text || '').slice(0, 20), '删除后该条记忆无法恢复。')) return;
      const ag = await currentAgentObj();
      if (!ag) return;
      await window.toolbox.agentSave({ ...ag, apiKey: undefined, memories: (ag.memories || []).filter((x) => x.id !== m.id) });
      toast(`记忆已删除：${(m.text || '').slice(0, 20)}`);
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
    // 2026-11-28-2：失败不再记已执行，列表显示失败原因，按钮变
    // “立即重试”（以前失败也记已执行，当天不再重试）。
    main.appendChild(el('div', 'row-sub', `${t.enabled === false ? '已停用 · ' : ''}${(t.prompt || '').slice(0, 40)}${t.lastRun ? ` · 上次执行 ${t.lastRun}` : ''}${t.lastError ? ` · 上次失败：${t.lastError}` : ''}`));
    row.appendChild(main);
    const run = el('button', 'btn small', t.lastError ? '立即重试' : '立即执行');
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
    del.addEventListener('click', async () => {
      if (!await confirmDelete('删除触发器', t.name || '触发器', '删除后该触发器不再执行，无法恢复。')) return;
      await window.toolbox.agentTriggerDelete(agent.id, t.id);
      toast(`触发器已删除：${t.name || '触发器'}`);
      renderAgentTriggers();
    });
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
$('#trigger-save').addEventListener('click', async (e) => {
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
  const finish = beginAsync(e.currentTarget, '保存中…');
  const r = await window.toolbox.agentTriggerSave(agentId, { name: name || (kind === 'file' ? '文件触发' : '定时触发'), kind, time: kind === 'time' ? time : '', path: kind === 'file' ? pathVal : '', prompt, enabled: true });
  if (r && r.ok === false) { finish(false, `触发器没有保存：${r.error || '后端没有返回原因'}`); return; }
  $('#trigger-name').value = ''; $('#trigger-prompt').value = '';
  finish(true, '触发器已保存');
  renderAgentTriggers();
});

/* ----- 技能（本地技能管理，2026-11-27-10） -----
 * 技能存本机 skills.json：列表、新增、编辑、删除、启用/停用；挂到
 * 智能体上后，调用时把已启用技能的指令拼进系统提示（主进程
 * skillPromptSection，与长期记忆同一段）。 */
let currentSkillId = null;
let agentSkillBoxReady = false;
async function renderAgentSkillBox(selectedIds) {
  const box = $('#agent-skill-box');
  if (!box) return;
  const skills = await window.toolbox.skillsList().catch(() => []);
  box.innerHTML = '';
  const sel = new Set(selectedIds || []);
  if (!skills.length) { box.appendChild(el('div', 'row-sub', '还没有技能，先去「技能」页签添加。')); agentSkillBoxReady = true; return; }
  for (const s of skills) {
    const lab = el('label', 'field-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = s.id; cb.checked = sel.has(s.id);
    cb.disabled = s.enabled === false;
    lab.append(cb, el('span', '', `${s.name}${s.enabled === false ? '（已停用）' : ''}${s.description ? ` · ${s.description}` : ''}`));
    box.appendChild(lab);
  }
  agentSkillBoxReady = true;
}
async function renderSkills() {
  const box = $('#skill-list');
  if (!box) return;
  const [skills, agents] = await Promise.all([
    window.toolbox.skillsList().catch(() => []),
    window.toolbox.agentsList().catch(() => []),
  ]);
  box.innerHTML = '';
  if (!skills.length) { box.className = 'list empty-note'; box.textContent = '还没有技能，填好上方表单保存一个。'; return; }
  box.className = 'list';
  for (const s of skills) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.appendChild(el('div', 'row-title', s.name));
    const usedBy = agents.filter((a) => (a.skillIds || []).includes(s.id)).map((a) => a.name);
    main.appendChild(el('div', 'row-sub', `${s.enabled === false ? '已停用 · ' : ''}${s.description || ''}${usedBy.length ? ` · 用于：${usedBy.join('、')}` : ' · 未挂到智能体'}`));
    row.appendChild(main);
    const toggle = el('button', 'btn small', s.enabled === false ? '启用' : '停用');
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      await window.toolbox.skillToggle(s.id, s.enabled === false);
      toast(s.enabled === false ? `技能已启用：${s.name}` : `技能已停用：${s.name}`);
      renderSkills();
    });
    row.appendChild(toggle);
    const edit = el('button', 'btn small', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      currentSkillId = s.id;
      $('#skill-name').value = s.name || '';
      $('#skill-desc').value = s.description || '';
      $('#skill-instructions').value = s.instructions || '';
      $('#skill-cancel').classList.remove('hidden');
      $('#skill-name').focus();
    });
    row.appendChild(edit);
    const del = el('button', 'btn small danger', '删除');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await confirmDelete('删除技能', s.name || '技能', '删除后挂到智能体上的该技能也会一起去掉，无法恢复。')) return;
      await window.toolbox.skillDelete(s.id);
      if (currentSkillId === s.id) {
        currentSkillId = null;
        $('#skill-name').value = ''; $('#skill-desc').value = ''; $('#skill-instructions').value = '';
        $('#skill-cancel').classList.add('hidden');
      }
      toast(`技能已删除：${s.name}`);
      renderSkills();
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#skill-save').addEventListener('click', async (e) => {
  const name = $('#skill-name').value.trim();
  const instructions = $('#skill-instructions').value.trim();
  if (!name) { toast('先填技能名称'); return; }
  if (!instructions) { toast('先填技能的指令内容'); return; }
  const finish = beginAsync(e.currentTarget, '保存中…');
  // 编辑时沿用原来的启用状态，不因保存而悄悄重新启用。
  const prev = currentSkillId ? (await window.toolbox.skillsList().catch(() => [])).find((x) => x.id === currentSkillId) : null;
  const r = await window.toolbox.skillSave({ id: currentSkillId || undefined, name, description: $('#skill-desc').value.trim(), instructions, enabled: prev ? prev.enabled !== false : true });
  if (r && r.ok === false) { finish(false, `技能没有保存：${r.error || '后端没有返回原因'}`); return; }
  currentSkillId = null;
  $('#skill-name').value = ''; $('#skill-desc').value = ''; $('#skill-instructions').value = '';
  $('#skill-cancel').classList.add('hidden');
  finish(true, '技能已保存');
  renderSkills();
});
$('#skill-cancel').addEventListener('click', () => {
  currentSkillId = null;
  $('#skill-name').value = ''; $('#skill-desc').value = ''; $('#skill-instructions').value = '';
  $('#skill-cancel').classList.add('hidden');
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
  /* 2026-11-27-4：模板管理子卡片改为抽屉内嵌的二级面板（用 openDrawer 打开）。 */
  const panel = document.getElementById('prompt-panel');
  if (panel) panel.classList.remove('hidden');
  loadPrompts();
  openDrawer({ title: '管理提示词模板', content: panel });
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
    del.addEventListener('click', async () => {
      if (!await confirmDelete('删除创作记录', `${item.task} · ${fmtTime(item.at)}`, '删除后该条创作记录无法恢复。')) return;
      await window.toolbox.creationDelete(item.id);
      toast(`创作记录已删除：${item.task}`);
      renderCreate();
    });
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
    del.addEventListener('click', async () => {
      if (!await confirmDelete('删除代码片段', item.title || '未命名', '删除后该片段的代码无法恢复。')) return;
      await window.toolbox.snippetDelete(item.id);
      toast(`代码片段已删除：${item.title || '未命名'}`);
      renderCode();
    });
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
      if (!await confirmDelete('删除图片', f.split(/[\\/]/).pop(), '删除后该图片文件无法恢复。')) return;
      const rr = await window.toolbox.filesTrashPath(f);
      if (rr && rr.ok === false) toast(`图片没有删除：${rr.error || '后端没有返回原因'}`);
      else { toast(`图片已删除：${f.split(/[\\/]/).pop()}`); renderImages(); }
    });
    wrap.appendChild(del);
    box.appendChild(wrap);
  }
}
$('#image-save').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '保存中…');
  const patch = { imageBaseUrl: $('#image-base').value.trim(), imageModel: $('#image-model').value.trim() };
  const key = $('#image-key').value.trim();
  if (key) patch.imageApiKey = key;
  const r = await window.toolbox.setConfig(patch).catch((err) => ({ ok: false, error: err.message || String(err) }));
  if (r && r.ok === false) { finish(false, `图片设置没有保存：${r.error || '后端没有返回原因'}`); return; }
  $('#image-key').value = '';
  finish(true, '图片设置已保存');
});
let selectedImageFile = null;
function selectImageForEdit(f, wrap) {
  selectedImageFile = f;
  document.querySelectorAll('#image-gallery .img-item').forEach((x) => x.classList.remove('selected'));
  if (wrap) wrap.classList.add('selected');
  /* 2026-11-27-4：改图面板改为抽屉（用 openDrawer 打开）。 */
  const panel = document.getElementById('image-edit-panel');
  if (panel) panel.classList.remove('hidden');
  $('#image-edit-target').textContent = `选中：${f}`;
  fillAgentSelect($('#image-edit-agent'));
  openDrawer({ title: '改图', content: panel });
}
$('#image-upload').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '上传中…');
  const r = await callTb('imageUpload');
  if (!r || r.ok === false) { finish(false, `图片没有上传：${(r && r.error) || '后端没有返回原因'}`); return; }
  finish(true, '图片已上传');
  renderImages();
});
$('#image-edit').addEventListener('click', async (e) => {
  const prompt = $('#image-edit-prompt').value.trim();
  const agentId = $('#image-edit-agent').value;
  if (!selectedImageFile) { toast('先在图库点一张图'); return; }
  if (!prompt) { toast('先写改图提示词'); return; }
  if (!agentId) { toast('先在智能体页添加智能体'); return; }
  const finish = beginAsync(e.currentTarget, '改图中…');
  const r = await callTb('imageEdit', { file: selectedImageFile, prompt, agentId });
  if (!r || r.ok === false) { finish(false, `改图没有完成：${(r && r.error) || '后端没有返回原因'}`); return; }
  finish(true, '改图完成，已进图库');
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
    del.addEventListener('click', async () => {
      if (!await confirmDelete('删除监控提醒', m.name || m.target, '删除后不再检查该目标，无法恢复。')) return;
      await callTb('monitorDelete', m.id);
      toast(`监控提醒已删除：${m.name || m.target}`);
      renderMonitors();
    });
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

/* ----- 注册：接码界面结构，记录只存本机 -----
 * 工具箱未接入接码平台：提取号码、自动刷新暂不可用，界面照样做
 * 出来并如实标明；号码与验证码手动添加。 */
let regCharge = '免费';
let regKind = 'email';
function gotoRegTab(kind) {
  regKind = kind;
  $$('#screen-register .tab').forEach((b) => b.classList.toggle('active', b.dataset.regTab === kind));
  $$('#screen-register .tabpane').forEach((p) => p.classList.toggle('active', p.id === `reg-tab-${kind}`));
  // 2026-11-28-4，第 11 项：平台注册页不收码，收码工具条藏起来。
  $('#screen-register').classList.toggle('reg-platform-mode', kind === 'platform');
  if (kind === 'platform') renderRegisterDirectory();
  renderRegister();
}
/* 2026-11-28-4，第 11 项：平台注册页——全球各类型平台的官方注册页
 * 地址（按类别分组）。点卡片在内嵌浏览器打开注册页，手机验证请本人操作。
 * 地址是各平台公认的官方注册页（2026-11-28 核对），个别平台改版后
 * 地址变了会跳到登录页或首页，届时以页面实际内容为准。 */
const REGISTER_DIRECTORY = [
  { cat: '邮箱', icon: '@', platforms: [
    { name: 'Gmail', url: 'https://accounts.google.com/signup' },
    { name: 'Outlook', url: 'https://signup.live.com/' },
    { name: 'QQ 邮箱', url: 'https://zc.qq.com/' },
    { name: '网易邮箱', url: 'https://zc.reg.163.com/reg/reg.jsp' },
    { name: 'Proton Mail', url: 'https://account.proton.me/signup' },
    { name: 'Yahoo 邮箱', url: 'https://login.yahoo.com/account/create' },
  ] },
  { cat: '社交', icon: SVG_USER, platforms: [
    { name: '微信', url: 'https://weixin.qq.com/' },
    { name: 'QQ', url: 'https://zc.qq.com/' },
    { name: '微博', url: 'https://weibo.com/signup/signup.php' },
    { name: 'X（Twitter）', url: 'https://twitter.com/i/flow/signup' },
    { name: 'Facebook', url: 'https://www.facebook.com/r.php' },
    { name: 'Instagram', url: 'https://www.instagram.com/accounts/emailsignup/' },
    { name: 'Telegram', url: 'https://telegram.org/' },
    { name: 'WhatsApp', url: 'https://www.whatsapp.com/download' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/signup' },
    { name: 'Reddit', url: 'https://www.reddit.com/register/' },
  ] },
  { cat: '视频', icon: SVG_PLAY, platforms: [
    { name: '哔哩哔哩', url: 'https://passport.bilibili.com/register/phone.html' },
    { name: '抖音', url: 'https://www.douyin.com/' },
    { name: 'YouTube（Google 账号）', url: 'https://accounts.google.com/signup' },
    { name: '爱奇艺', url: 'https://passport.iqiyi.com/pages/register' },
    { name: '腾讯视频', url: 'https://v.qq.com/' },
    { name: 'Netflix', url: 'https://www.netflix.com/signup' },
  ] },
  { cat: '开发', icon: SVG_CODE, platforms: [
    { name: 'GitHub', url: 'https://github.com/signup' },
    { name: 'GitLab', url: 'https://gitlab.com/users/sign_up' },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com/users/signup' },
    { name: '掘金', url: 'https://juejin.cn/login' },
    { name: 'CSDN', url: 'https://passport.csdn.net/register' },
  ] },
  { cat: '购物', icon: SVG_APPWIN, platforms: [
    { name: '淘宝', url: 'https://reg.taobao.com/member/reg/fill_mobile.htm' },
    { name: '京东', url: 'https://reg.jd.com/reg/person' },
    { name: '拼多多', url: 'https://mobile.yangkeduo.com/login.html' },
    { name: 'Amazon', url: 'https://www.amazon.com/ap/register' },
    { name: 'eBay', url: 'https://signup.ebay.com/pa/crte' },
  ] },
  { cat: '通讯', icon: SVG_MAIL, platforms: [
    { name: '钉钉', url: 'https://www.dingtalk.com/' },
    { name: '企业微信', url: 'https://work.weixin.qq.com/' },
    { name: 'Slack', url: 'https://slack.com/get-started' },
    { name: 'Discord', url: 'https://discord.com/register' },
    { name: 'Zoom', url: 'https://zoom.us/signup' },
  ] },
];
function renderRegisterDirectory() {
  const box = $('#reg-platforms-directory');
  if (!box) return;
  box.innerHTML = '';
  for (const group of REGISTER_DIRECTORY) {
    { const h = el('h2', 'store-cat'); h.innerHTML = `${group.icon} ${group.cat}`; box.appendChild(h); }
    const grid = el('div', 'store-grid');
    for (const p of group.platforms) {
      const card = el('div', 'store-card');
      { const ic = el('div', 'store-icon'); ic.innerHTML = group.icon; card.appendChild(ic); }
      card.appendChild(el('div', 'store-name', p.name));
      card.appendChild(el('div', 'store-desc', p.url.replace(/^https?:\/\//, '')));
      const foot = el('div', 'store-foot');
      const go = el('button', 'btn small primary', '打开注册页');
      go.type = 'button';
      go.addEventListener('click', () => {
        // 内嵌浏览器打开（launchBrowserApp → embedded-browser-open）。
        window.toolbox.launchBrowserApp('chromium', p.url);
        toast(`已在内嵌浏览器打开 ${p.name} 注册页`);
      });
      foot.appendChild(go);
      card.appendChild(foot);
      grid.appendChild(card);
    }
    box.appendChild(grid);
  }
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
$('#reg-extract').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '提取中…', document.getElementById('reg-mailtm-account'));
  if (regKind === 'email') {
    const r = await regMailtmFetchOnce();
    if (r && r.ok) finish(true, `已拉取：新收验证码 ${r.added} 条`);
    else finish(false, `提取没有完成：${(r && r.error) || '后端没有返回原因'}`);
    return;
  }
  finish(false, '短信自动提取暂不可用：没有公开可用的免费短信接口，请手动添加记录；邮箱可用 Mail.tm 自动收码（切到邮箱页签）');
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
  /* 2026-11-27-4：手动添加记录默认折叠，点「添加」先展开再聚焦。 */
  if (regManualCollapse) regManualCollapse.expand();
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
      { const ic = el('span', 'icon-tile gray'); ic.innerHTML = kind === 'sms' ? SVG_MAIL : '@'; card.appendChild(ic); }
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
      del.addEventListener('click', async () => {
        if (!await confirmDelete('删除平台', p.name, '删除后该平台不再出现在接码列表里，无法恢复。')) return;
        await window.toolbox.registerPlatformDelete(p.id);
        toast(`平台已删除：${p.name}`);
        renderRegisterPlatforms();
      });
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
  del.addEventListener('click', async () => {
    if (!await confirmDelete('删除记录', `${x.kind} · ${x.target}`, '删除后该条接码记录无法恢复。')) return;
    await window.toolbox.registerDelete(x.id);
    toast(`记录已删除：${x.target}`);
    renderRegister();
  });
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
  // 2026-11-28-4，第 10 项：“全部”页签按目录树显示（见 paintFilesTree），
  // 其他分类页签仍是扁平过滤列表。
  if (filesCat === 'all') { paintFilesTree(); return; }
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
      if (!await confirmDelete('删除文件', e.name, '文件会移入回收站（可从回收站恢复），不是直接永久删除。')) return;
      const rr = await window.toolbox.filesTrashPath(full);
      if (rr && rr.ok === false) toast(`文件没有删除：${rr.error || '后端没有返回原因'}`);
      else { toast(`文件已删除：${e.name}`); renderFiles(filesCurrentDir); }
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}
$('#files-up').addEventListener('click', async () => {
  const r = await window.toolbox.filesListDir(filesCurrentDir).catch(() => null);
  if (r && r.parent) renderFiles(r.parent);
});
/* ---------- 2026-11-28-4，第 10 项：文件“全部”页签按硬盘目录树显示 ----------
 * 层级清晰、可展开折叠、显示完整路径；打开与删除放右键菜单（像电脑
 * 一样操作：单击选中、双击打开、右键弹出菜单，删除前确认、进回收站）。
 * 子目录按需加载（点展开才读一次），换目录后缓存清掉。 */
let filesTreeChildren = new Map(); // dir path -> entries
let filesTreeExpanded = new Set(); // 已展开的目录 path
let filesTreeRoot = '';
let filesCtxTarget = null; // { full, name, isDir }
function paintFilesTree() {
  const box = $('#files-list');
  if (filesTreeRoot !== filesCurrentDir) { filesTreeChildren = new Map(); filesTreeExpanded = new Set(); filesTreeRoot = filesCurrentDir; }
  const q = ($('#files-search').value || '').trim().toLowerCase();
  box.innerHTML = '';
  box.className = 'list';
  const rootEntries = (filesEntries || []).filter((e) => !q || e.name.toLowerCase().includes(q));
  if (!rootEntries.length) { box.className = 'list empty-note'; box.textContent = q ? '没有符合的文件。' : '空文件夹。'; return; }
  const walk = (entries, dir, depth) => {
    for (const e of entries) {
      const sep = dir.includes('\\') ? '\\' : '/';
      const full = dir.replace(/[\\/]+$/, '') + sep + e.name;
      box.appendChild(filesTreeRow(full, e.name, !!e.isDir, depth, e));
      if (e.isDir && filesTreeExpanded.has(full)) {
        const kids = (filesTreeChildren.get(full) || []).filter((k) => !q || k.name.toLowerCase().includes(q));
        walk(kids, full, depth + 1);
      }
    }
  };
  walk(rootEntries, filesCurrentDir, 0);
}
function filesTreeRow(full, name, isDir, depth, entry) {
  const row = el('div', 'files-tree-row');
  row.style.setProperty('--depth', depth);
  row.dataset.path = full;
  if (isDir) {
    const caret = el('button', 'tree-caret', filesTreeExpanded.has(full) ? '▾' : '▸');
    caret.type = 'button';
    caret.setAttribute('aria-label', '展开或折叠');
    caret.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (filesTreeExpanded.has(full)) { filesTreeExpanded.delete(full); paintFilesTree(); return; }
      filesTreeExpanded.add(full);
      if (!filesTreeChildren.has(full)) {
        const r = await window.toolbox.filesListDir(full).catch(() => null);
        if (r && r.ok) filesTreeChildren.set(full, r.entries || []);
      }
      paintFilesTree();
    });
    row.appendChild(caret);
  } else {
    row.appendChild(el('span', 'tree-caret', ''));
  }
  const main = el('div', 'row-main');
  main.appendChild(el('div', 'row-title', `${isDir ? '▢ ' : ''}${name}`));
  main.appendChild(el('div', 'row-sub', isDir ? full : `${fmtSize(entry.size)} · ${fmtTime(entry.mtime)}`));
  row.appendChild(main);
  row.addEventListener('click', () => selectFilesTreeRow(row));
  row.addEventListener('dblclick', () => filesTreeOpen({ full, name, isDir }));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); selectFilesTreeRow(row); showFilesContextMenu(e.clientX, e.clientY, { full, name, isDir }); });
  return row;
}
function selectFilesTreeRow(row) {
  document.querySelectorAll('#files-list .files-tree-row.selected').forEach((r) => r.classList.remove('selected'));
  if (row) row.classList.add('selected');
}
function showFilesContextMenu(x, y, target) {
  filesCtxTarget = target;
  const menu = $('#files-context-menu');
  if (!menu) return;
  menu.classList.remove('hidden');
  menu.style.left = `${Math.min(x, window.innerWidth - 140)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 90)}px`;
}
function hideFilesContextMenu() { const m = $('#files-context-menu'); if (m) m.classList.add('hidden'); filesCtxTarget = null; }
document.addEventListener('click', (e) => { if (!e.target.closest('#files-context-menu')) hideFilesContextMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFilesContextMenu(); });
async function filesTreeOpen(target) {
  if (!target) return;
  if (target.isDir) { renderFiles(target.full); return; }
  const rr = await window.toolbox.filesOpenPath(target.full);
  if (rr && rr.ok === false) toast(rr.error || '打不开');
}
async function filesTreeDelete(target) {
  if (!target) return;
  if (!await confirmDelete('删除文件', target.name, '文件会移入回收站（可从回收站恢复），不是直接永久删除。')) return;
  const rr = await window.toolbox.filesTrashPath(target.full);
  if (rr && rr.ok === false) toast(`文件没有删除：${rr.error || '后端没有返回原因'}`);
  else { toast(`文件已删除：${target.name}`); renderFiles(filesCurrentDir); }
}
$$('#files-context-menu [data-files-ctx]').forEach((b) => b.addEventListener('click', () => {
  const act = b.dataset.filesCtx;
  const t = filesCtxTarget;
  hideFilesContextMenu();
  if (act === 'open') filesTreeOpen(t);
  else if (act === 'delete') filesTreeDelete(t);
}));
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
  manual: '手动代理：使用下方填写的 HTTP 代理服务器。',
  tun: 'Tun：WinTun 系统隧道。启动后在本机建一张虚拟网卡，整机流量都走隧道；首次安装需弹一次确认框拉起提权 helper，智能/全局模式不需要 Tun 与管理员权限。',
};
async function renderProxy() {
  renderTunStatus();
  renderPioneer();
  const ov = await window.toolbox.getOverview().catch(() => null);
  if (!ov) return;
  const mode = ov.config.proxyMode || 'direct';
  // 2026-11-27-10：第 11 项，代理模式改成按钮式：点按钮即切换并保存。
  setProxyModeButtons(mode);
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
/* 2026-11-27-10：第 11 项，代理模式按钮式：当前模式即选中态，点按即切换并保存。 */
function currentProxyMode() {
  return document.querySelector('#proxy-mode-group [data-mode].active')?.dataset.mode || 'direct';
}
function setProxyModeButtons(mode) {
  $$('#proxy-mode-group [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
function renderProxyServers(servers) {
  const box = $('#proxy-servers');
  box.innerHTML = '';
  if (!servers.length) { box.className = 'list empty-note'; box.textContent = '暂无代理服务器。'; return; }
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
      await window.toolbox.setConfig({ proxyHost: sv.host, proxyPort: String(sv.port), proxyMode: currentProxyMode() === 'direct' ? 'manual' : currentProxyMode() });
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
$$('#proxy-mode-group [data-mode]').forEach((b) => b.addEventListener('click', async () => {
  const mode = b.dataset.mode;
  setProxyModeButtons(mode);
  $('#proxy-mode-desc').textContent = PROXY_MODE_DESC[mode] || '';
  $('#proxy-tun-warn').classList.toggle('hidden', mode !== 'tun');
  if (mode === 'tun') toast('Tun 模式需要 WinTun 驱动：先在下方检测 / 安装；首次安装需弹一次确认框拉起提权 helper');
  await window.toolbox.setConfig({ proxyMode: mode });
}));
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
$('#proxy-save').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '保存中…');
  const mode = currentProxyMode();
  const r = await window.toolbox.setConfig({
    proxyMode: mode,
    proxyHost: $('#proxy-host').value.trim(),
    proxyPort: $('#proxy-port').value.trim(),
  }).catch((err) => ({ ok: false, error: err.message || String(err) }));
  if (r && r.ok === false) { finish(false, `代理设置没有保存：${r.error || '后端没有返回原因'}`); return; }
  finish(true, mode === 'tun' ? 'Tun 模式已保存：先在下方启动 Tun（需管理员权限）才会真正走隧道' : '代理设置已保存');
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
$('#tun-install').addEventListener('click', async (e) => {
  // 2026-11-27-3：安装不再预弹确认框——首次拉起提权 helper 时系统会弹
  // 一次确认框；主程序本身不提权。驱动文件已随包内置，不下载。
  const finish = beginAsync(e.currentTarget, '安装中…', document.getElementById('tun-status-text'));
  const r = await window.toolbox.tunInstall().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { finish(false, `WinTun 驱动没有装上：${(r && r.error) || '后端没有返回原因'}`); await renderTunStatus(); return; }
  finish(true, r.note || 'WinTun 驱动已安装');
  await renderTunStatus();
});
$('#tun-start').addEventListener('click', async (e) => {
  // 2026-11-27-3：启动不再预弹确认框——首次拉起提权 helper 时系统会弹
  // 一次确认框，helper 常驻后开关 Tun 不再弹；主程序本身不提权。
  const finish = beginAsync(e.currentTarget, '启动中…', document.getElementById('tun-status-text'));
  const r = await window.toolbox.tunStart().catch((e) => ({ ok: false, error: e.message || String(e) }));
  if (!r || r.ok === false) { finish(false, `Tun 没有启动：${(r && r.error) || '后端没有返回原因'}`); await renderTunStatus(); return; }
  finish(true, r.note || 'Tun 已启动');
  await renderTunStatus();
});
$('#tun-stop').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '停止中…', document.getElementById('tun-status-text'));
  const r = await window.toolbox.tunStop().catch((e) => ({ ok: false, error: e.message || String(e) }));
  finish(true, (r && r.note) || 'Tun 已停止');
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
  // 2026-11-27-10：第 11 项，Pioneer 模式下拉已删，模式只剩全局代理模式；
  // 已连接状态由主进程实测隧道与端口后返回，不只信保存标志。
  $('#pioneer-login').disabled = !!st.loggedIn;
  $('#pioneer-connect').disabled = !st.loggedIn || !!st.connected;
  $('#pioneer-disconnect').disabled = !st.connected;
  if (st.loggedIn) {
    await loadPioneerRegions();
    // 已连接时把当前地区标成选中，方便直接断开重连或看纯净度。
    if (st.connected && st.region) {
      const hit = pioneerRegions.find((rg) => rg.country_name === st.region);
      if (hit) { pioneerSelectedRegion = String(hit.country_id); renderPioneerRegionButtons(); paintPioneerRegionPurity(); }
    }
  }
  renderPioneerLogs();
}
/* 2026-11-28-4，第 6 项：地区改按钮式（与代理模式按钮式一致），
 * 按钮后挂该地区上次连接的 IP 纯净度；选中的地区存在内存变量里。 */
let pioneerSelectedRegion = '';
let pioneerRegions = [];
async function loadPioneerRegions() {
  const r = await callTb('pioneerRegions');
  const group = $('#pioneer-region-group');
  if (!r || !r.ok || !group) return;
  pioneerRegions = r.regions || [];
  renderPioneerRegionButtons();
  await paintPioneerRegionPurity();
}
function renderPioneerRegionButtons() {
  const group = $('#pioneer-region-group');
  if (!group) return;
  group.innerHTML = '';
  if (!pioneerRegions.length) { group.appendChild(el('span', 'hint', '登录后加载地区。')); return; }
  for (const rg of pioneerRegions) {
    const b = el('button', '', rg.country_name);
    b.type = 'button';
    b.dataset.countryId = String(rg.country_id);
    b.classList.toggle('active', pioneerSelectedRegion === String(rg.country_id));
    b.addEventListener('click', () => {
      pioneerSelectedRegion = String(rg.country_id);
      renderPioneerRegionButtons();
      paintPioneerRegionPurity();
    });
    group.appendChild(b);
  }
}
/* 各地区按钮后挂纯净度徽章（本机存的上次结果；没有就不挂，不瞎写）。 */
async function paintPioneerRegionPurity() {
  const group = $('#pioneer-region-group');
  if (!group) return;
  const rec = await callTb('pioneerIpPurityGet').catch(() => null);
  const byRegion = (rec && rec.byRegion) || {};
  for (const b of group.querySelectorAll('[data-country-id]')) {
    const old = b.querySelector('.purity-badge');
    if (old) old.remove();
    const p = byRegion[b.dataset.countryId];
    if (p && typeof p.score === 'number') {
      const badge = el('span', `purity-badge ${p.score >= 70 ? 'purity-good' : p.score >= 50 ? 'purity-ok' : 'purity-bad'}`, `纯净度 ${p.score} · ${p.grade || ''}`);
      b.appendChild(badge);
    }
  }
}
async function renderPioneerLogs() {
  const box = $('#pioneer-log');
  if (!box) return;
  const logs = await callTb('pioneerLogs');
  box.innerHTML = '';
  if (!Array.isArray(logs) || !logs.length) { box.className = 'list empty-note'; box.textContent = '暂无日志。'; }
  else {
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
  // 2026-11-28-4，第 6 项：日志可折叠——渲染完按存的折叠状态收/展。
  applyPioneerLogCollapsed();
}
/* 2026-11-28-4，第 6 项：Pioneer 日志默认展开，可折叠隐藏（状态存本机）。 */
function applyPioneerLogCollapsed() {
  const box = $('#pioneer-log');
  const btn = $('#pioneer-log-toggle');
  if (!box || !btn) return;
  let collapsed = false;
  try { collapsed = localStorage.getItem('pioneer-log-collapsed') === '1'; } catch (e) { /* 读不到按展开 */ }
  box.classList.toggle('hidden', collapsed);
  btn.textContent = collapsed ? '展开' : '折叠';
  btn.setAttribute('aria-expanded', String(!collapsed));
}
$('#pioneer-log-toggle').addEventListener('click', () => {
  let collapsed = false;
  try { collapsed = localStorage.getItem('pioneer-log-collapsed') === '1'; } catch (e) { /* ignore */ }
  try { localStorage.setItem('pioneer-log-collapsed', collapsed ? '0' : '1'); } catch (e) { /* 存不下不影响 */ }
  applyPioneerLogCollapsed();
});
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
  const countryId = pioneerSelectedRegion;
  if (!countryId) { toast('先选择地区'); return; }
  const btn = $('#pioneer-connect');
  btn.disabled = true; btn.textContent = '连接中…';
  const r = await callTb('pioneerConnect', { countryId });
  btn.disabled = false; btn.textContent = '连接';
  if (!r || !r.ok) { toast((r && r.error) || '连接失败'); renderPioneer(); return; }
  toast(`已连接：${r.nodeName || ''} · 出口 IP ${r.exitIp || '—'}`);
  // 2026-11-28-4，第 6 项：连接成功自动测过纯净度（主进程回 purity），
  // 直接显示并挂到对应地区按钮后。
  if (r.purity) renderPioneerPurityResult(r.purity);
  paintPioneerRegionPurity();
  renderPioneer();
});
$('#pioneer-disconnect').addEventListener('click', async () => {
  await callTb('pioneerDisconnect');
  toast('Pioneer 已断开');
  renderPioneer();
});
/* 2026-11-28-4，第 6 项：IP 检测改成 IP 纯净度检测——同一 IP 读上次
 * 结果（标“上次结果”，可点重新检测），换 IP 自动重测；每次连接
 * 成功主进程自动测一次，结果也走这里显示。 */
function formatPioneerPurity(r) {
  if (!r || !r.ok) return `纯净度检测失败：${(r && r.error) || '未知原因'}`;
  const when = r.checkedAt ? new Date(r.checkedAt).toLocaleString() : '';
  const cached = r.fromCache ? '（上次结果，可重新测）' : '';
  return `出口 IP ${r.ip} · 纯净度 ${r.score} 分（${r.grade}）${cached}${when ? ` · 测于 ${when}` : ''}。${(r.reasons || []).join('；')}`;
}
function renderPioneerPurityResult(r) {
  const box = $('#pioneer-ip-result');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(document.createTextNode(formatPioneerPurity(r)));
  if (r && r.ok && r.fromCache) {
    const again = el('button', 'btn small', '重新检测');
    again.type = 'button';
    again.style.marginLeft = '8px';
    again.addEventListener('click', () => checkPioneerPurity(true));
    box.appendChild(again);
  }
}
async function checkPioneerPurity(force) {
  const box = $('#pioneer-ip-result');
  if (box) box.textContent = '纯净度检测中…';
  const rg = pioneerRegions.find((x) => String(x.country_id) === pioneerSelectedRegion);
  const r = await callTb('pioneerIpPurity', { force: !!force, regionId: pioneerSelectedRegion ? Number(pioneerSelectedRegion) : null, regionCountry: rg ? rg.country_name : '' });
  renderPioneerPurityResult(r);
  paintPioneerRegionPurity();
}
$('#pioneer-ip-check').addEventListener('click', () => checkPioneerPurity(false));

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
  frame.onload = () => sendThemeToPlugin(); // 插件页加载后下发主题变量
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
$('#plugin-install-folder').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '安装中…');
  const r = await window.toolbox.pluginInstallFolder();
  if (r && r.ok) { finish(true, `插件「${r.plugin.name}」已安装`); renderPlugins(); renderPluginsMenu(); }
  else if (r && !r.canceled) finish(false, `插件没有装上：${r.error || '后端没有返回原因'}`);
  else finish(true, '');
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
$('#backup-export').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '导出中…', document.getElementById('backup-status'));
  const r = await window.toolbox.backupExport(backupOpts());
  if (r && r.ok) {
    finish(true, `已导出到 ${r.file}${r.encrypted ? '（已加密）' : ''}，包含 ${r.files.length} 个数据文件。`);
  } else if (r && !r.canceled) finish(false, `备份没有导出：${r.error || '后端没有返回原因'}`);
  else finish(true, '');
});
$('#backup-import').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '导入中…', document.getElementById('backup-status'));
  const r = await window.toolbox.backupImport();
  if (r && r.ok) {
    finish(true, `已导入 ${r.files.length} 个数据文件，旧数据已自动备份到 ${r.autoBackup}`);
    renderSettings(); renderAgents(); renderRegister();
  } else if (r && r.needsPassword) {
    /* 2026-11-27-4 整合：主进程已把文件路径随 needsPassword 返回，这里弹
     * 密码框后调 backup-import-password 真解密，不用再选一次文件。 */
    const pwRes = await customPrompt('备份密码', '这份备份有密码保护，请输入密码：', 'password');
    if (!pwRes || pwRes.value !== true) { finish(true, ''); return; }
    const r2 = await window.toolbox.backupImportPassword(r.file, pwRes.input);
    if (r2 && r2.ok) {
      finish(true, `已导入 ${r2.files.length} 个数据文件，旧数据已自动备份到 ${r2.autoBackup}`);
      renderSettings(); renderAgents(); renderRegister();
    } else if (r2 && !r2.canceled) finish(false, `备份没有导入：${r2.error || '后端没有返回原因'}`);
    else finish(true, '');
  } else if (r && !r.canceled) finish(false, `备份没有导入：${r.error || '后端没有返回原因'}`);
  else finish(true, '');
});
$('#sync-set-folder').addEventListener('click', async () => {
  const r = await window.toolbox.syncSetFolder();
  if (r && r.ok) { toast(`同步文件夹已设为 ${r.folder}`); renderSyncFolder(); }
  else if (r && !r.canceled) toast(r.error || '选择失败');
});
$('#sync-export').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '同步中…');
  const r = await window.toolbox.syncExport(backupOpts());
  if (r && r.ok) { finish(true, `已同步到文件夹：${r.file}`); renderSyncList(); }
  else finish(false, `同步没有完成：${r.error || '后端没有返回原因'}`);
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
  renderDiagnostics();
}

/* ---------- 2026-11-28-8：诊断日志 ---------- */
async function renderDiagnostics() {
  const box = $('#diag-status');
  if (!box) return;
  const st = await window.toolbox.diagnosticsStatus().catch(() => ({ ok: false }));
  if (!st || !st.ok) { box.textContent = '诊断日志：读取失败'; return; }
  const last = st.lastCrashLogEntry;
  const crashText = last ? `最近崩溃：${fmtTime(last.at)} ${last.message || last.kind || ''}` : '最近崩溃：暂无记录';
  const selfText = st.selfTest ? `自测：${st.selfTest.at || ''}（${st.selfTest.trueCount || 0} 通过 / ${st.selfTest.falseCount || 0} 失败 / ${st.selfTest.skippedCount || 0} 跳过）` : '自测：暂无记录';
  box.textContent = `日志文件 ${st.logFiles.length} 个（最近 7 天）${st.logFiles.length ? `，最新 ${st.logFiles[st.logFiles.length - 1].name}（${st.logFiles[st.logFiles.length - 1].lines} 条）` : ''}。${crashText}。${selfText}。`;
}
$('#diag-export').addEventListener('click', async (e) => {
  const finish = beginAsync(e.currentTarget, '导出中…', document.getElementById('diag-status'));
  const r = await window.toolbox.diagnosticsExport();
  if (r && r.ok) finish(true, `诊断包已导出到 ${r.file}（已脱敏，不含密钥）。`);
  else if (r && !r.canceled) finish(false, `诊断包没有导出：${r.error || '后端没有返回原因'}`);
  else finish(true, '');
});
$('#diag-open-logs').addEventListener('click', async () => {
  const r = await window.toolbox.diagnosticsOpenLogs();
  if (r && !r.ok) toast(r.error || '打开失败');
});
$('#diag-clear-logs').addEventListener('click', async () => {
  if (!await customConfirm('清空诊断日志', '清空 data/logs/ 里的全部日志文件？崩溃记录也会一起清掉。', '清空')) return;
  const r = await window.toolbox.diagnosticsClearLogs();
  if (r && r.ok) { toast(`已清空 ${r.removed} 个日志文件`); renderDiagnostics(); }
  else toast((r && r.error) || '清空失败');
});

/* ---------- 视频下载 ---------- */
/* 2026-11-27-10，第 8 项：视频下载改为数据嗅探——粘贴网址、引擎状态、
 * 下载列表全部去掉。嗅探开关存在配置里；嗅探框里的每条媒体仍可点「下载」。 */
async function renderVideo() {
  try {
    const ov = await window.toolbox.getOverview();
    sniffEnabled = !!(ov && ov.config && ov.config.sniffEnabled);
  } catch (e) { /* 读不到按未开启 */ }
  updateSniffToggle();
  updateSniffFab();
}
function updateSniffToggle() {
  const btn = $('#sniff-toggle');
  const st = $('#sniff-status');
  if (!btn) return;
  btn.textContent = sniffEnabled ? '关闭数据嗅探' : '开启数据嗅探';
  if (st) st.textContent = sniffEnabled ? '已开启：右下角有小圆点，点小圆点打开嗅探框。' : '未开启';
}
async function setSniffEnabled(on) {
  sniffEnabled = !!on;
  await window.toolbox.setConfig({ sniffEnabled });
  if (!sniffEnabled) { sniffPanelOpen = false; renderSniffPanel(); }
  updateSniffToggle();
  updateSniffFab();
}
$('#sniff-toggle').addEventListener('click', () => setSniffEnabled(!sniffEnabled));
// 2026-11-28-4，第 4 项：“分析当前页面”按钮已删——嗅探本身是实时的，
// 不需要手动分析（旧的 analyzeCurrentPage 函数随之一并删掉）。
function videoStartDownload(url, engine, formatId, title) {
  callTb('videoDownload', { url, engine, formatId, title }).then(async (r) => {
    if (r && r.ok) { toast('已开始下载'); return; }
    const err = (r && r.error) || '下载失败';
    // 2026-11-28-4，第 1 项：视频引擎未装是唯一死路——直接问要不要
    // 一键装 yt-dlp，装好自动重下，不再让用户自己找安装入口。
    if (/视频引擎未安装/.test(err)) {
      const go = await customConfirm('安装视频引擎', '下载视频要先装视频引擎（yt-dlp，免费开源）。现在一键安装吗？装好自动开始下载。', '一键安装');
      if (!go) { toast('已取消：下载视频需要先装视频引擎'); return; }
      toast('正在安装视频引擎…');
      const inst = await callTb('videoEngineDownload', 'ytdlp');
      if (!inst || inst.ok === false) { toast(`视频引擎安装失败：${(inst && inst.error) || '未知原因'}`); return; }
      toast('视频引擎已装好，正在开始下载…');
      const r2 = await callTb('videoDownload', { url, engine, formatId, title });
      if (!r2 || r2.ok === false) toast((r2 && r2.error) || '下载失败');
      else toast('已开始下载');
      return;
    }
    toast(err);
  });
}

/* ---------- 2026-11-27-4：抽屉迁移与表单分组（初始化） ----------
 * 只在启动时跑一次：把页面常驻表单的节点移到抽屉面板里（节点本身不
 * 重建，ID 与已有监听都不变），页面只留列表与新增按钮。 */
function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
const labelFor = (id) => { const input = document.getElementById(id); return input ? (input.closest('label') || input) : null; };

/* ----- 账号管理抽屉：默认只显示卡片列表 +「新增账号」，15 项表单进抽屉 ----- */
let accountDrawerNodes = null;
let accountLoginStatusEl = null;
let accountFooterEl = null;
let regManualCollapse = null;
function openAccountDrawer(a) {
  currentAccountId = (a && a.id) || null;
  fillAccountForm(a || null);
  if (accountLoginStatusEl) accountLoginStatusEl.textContent = '未检测登录态。';
  const n = accountDrawerNodes || { basic: [], login: [], env: [], register: [] };
  openDrawer({
    title: a ? `编辑账号 · ${(a && a.name) || ''}` : '新增账号',
    tabs: [
      { id: 'basic', label: '基础信息', render: (pane) => { n.basic.forEach((x) => pane.appendChild(x)); } },
      { id: 'login', label: '凭证与登录', render: (pane) => { n.login.forEach((x) => pane.appendChild(x)); } },
      { id: 'env', label: '环境隔离', render: (pane) => { n.env.forEach((x) => pane.appendChild(x)); } },
      { id: 'register', label: '注册', render: (pane) => { n.register.forEach((x) => pane.appendChild(x)); } },
    ],
    footer: accountFooterEl,
    onClose: () => { renderAccounts(); },
  });
}
function initAccountDrawer() {
  const split = document.querySelector('#screen-accounts .split');
  const firstCard = document.querySelector('#screen-accounts .split .card');
  if (!split || !firstCard) return;
  const heading = (text) => [...firstCard.querySelectorAll('h2.subhead')].find((h) => (h.textContent || '').includes(text));
  const fpDesc = [...firstCard.querySelectorAll('p.desc')].find((p) => (p.textContent || '').includes('硬件指纹'));
  /* 凭证与登录组是新增的界面（原页面没有登录态检测/打开登录/Cookie 状态）： */
  const loginIntro = el('p', 'desc', '登录态只在浏览器里检测：先保存账号，再打开浏览器登录，登录后点「检测登录态」。Cookie 状态由主进程读分区 Cookie 后回传，不显示 Cookie 值。');
  accountLoginStatusEl = el('p', 'desc', '未检测登录态。');
  accountLoginStatusEl.id = 'account-login-status';
  const loginRow = el('div', 'field-row');
  const loginOpenBtn = el('button', 'btn primary', '打开浏览器登录');
  loginOpenBtn.type = 'button';
  loginOpenBtn.addEventListener('click', async () => {
    if (!currentAccountId) { if (accountLoginStatusEl) accountLoginStatusEl.textContent = '先点「保存账号」，再打开浏览器登录。'; return; }
    closeDrawer({ restoreFocus: false });
    await openAccount(currentAccountId);
  });
  const loginCheckBtn = el('button', 'btn', '检测登录态');
  loginCheckBtn.type = 'button';
  loginCheckBtn.addEventListener('click', async () => {
    const finish = beginAsync(loginCheckBtn, '检测中…', accountLoginStatusEl);
    const site = document.getElementById('account-site').value;
    const url = site === 'custom'
      ? document.getElementById('account-login-url').value.trim()
      : (ACCOUNT_SITES[site] || ACCOUNT_SITES.custom).loginUrl;
    if (!url) { finish(false, '先填登录地址'); return; }
    const r = await callTb('browserLoginCheck', url);
    if (!r || r.ok === false) { finish(false, `检测没有完成：${(r && r.error) || '后端没有返回原因'}`); return; }
    finish(true, r.loggedIn ? `已登录${r.login ? `：${r.login}` : ''}` : '未登录：该站点没有命中已登录凭证');
  });
  loginRow.append(loginOpenBtn, loginCheckBtn);
  const regCard = split.querySelectorAll('.card')[1];
  accountDrawerNodes = {
    basic: [labelFor('account-site'), document.getElementById('account-custom-fields'),
      labelFor('account-name'), labelFor('account-group'), labelFor('account-note')].filter(Boolean),
    login: [loginIntro, accountLoginStatusEl, loginRow].filter(Boolean),
    env: [heading('代理'), labelFor('account-proxy-type'), labelFor('account-proxy-host'),
      labelFor('account-proxy-port'), labelFor('account-proxy-user'), labelFor('account-proxy-pass'),
      heading('指纹'), labelFor('account-fp-ua'), labelFor('account-fp-lang'), labelFor('account-fp-tz'),
      document.getElementById('account-fp-width') ? document.getElementById('account-fp-width').closest('.field-row') : null,
      fpDesc].filter(Boolean),
    register: regCard ? [labelFor('register-account'), labelFor('register-interval'),
      document.getElementById('register-begin') ? document.getElementById('register-begin').closest('.field-row') : null].filter(Boolean) : [],
  };
  accountFooterEl = document.getElementById('account-save')
    ? document.getElementById('account-save').closest('.field-row') : null;
  split.style.display = 'none'; // 页面不再渲染表单，只留列表 + 新增按钮
}

/* ----- 智能体设置抽屉：默认只显示列表 +「新建智能体」，9 项表单进抽屉 ----- */
let agentDrawerNodes = null;
let agentFooterEl = null;
function openAgentDrawer(a) {
  currentAgentId = (a && a.id) || null;
  if (a) fillAgentForm(a);
  else {
    fillAgentForm({ connectionType: 'api', webSite: 'deepseek' });
    const ws = document.getElementById('agent-web-status');
    if (ws) ws.textContent = '';
  }
  const n = agentDrawerNodes || { basic: [], auth: [], params: [], advanced: [] };
  openDrawer({
    title: a ? `编辑智能体 · ${(a && a.name) || ''}` : '新建智能体',
    tabs: [
      { id: 'basic', label: '基础设定', render: (pane) => { n.basic.forEach((x) => pane.appendChild(x)); } },
      { id: 'auth', label: '连接与认证', render: (pane) => { n.auth.forEach((x) => pane.appendChild(x)); } },
      { id: 'params', label: '提示词与参数', render: (pane) => { n.params.forEach((x) => pane.appendChild(x)); } },
      { id: 'advanced', label: '高级与调试', render: (pane) => { n.advanced.forEach((x) => pane.appendChild(x)); } },
    ],
    footer: agentFooterEl,
    onClose: () => { renderAgents(); },
  });
}
function initAgentDrawer() {
  const formCard = document.getElementById('agent-name')
    ? document.getElementById('agent-name').closest('.card') : null;
  if (!formCard) return;
  /* 2026-11-27-4 新增字段节点（页面原先没有，JS 新建；默认值见 fillAgentForm）： */
  const mkField = (labelText, input) => {
    const lab = el('label', 'field');
    lab.appendChild(el('span', '', labelText));
    lab.appendChild(input);
    return lab;
  };
  const tempInput = document.createElement('input');
  tempInput.id = 'agent-temperature'; tempInput.type = 'number'; tempInput.min = '0'; tempInput.max = '2'; tempInput.step = '0.1'; tempInput.value = '0.7';
  const ctxInput = document.createElement('input');
  ctxInput.id = 'agent-context-length'; ctxInput.type = 'number'; ctxInput.min = '1'; ctxInput.step = '1'; ctxInput.value = '20';
  const streamLabel = el('label', 'field-row');
  const streamInput = document.createElement('input');
  streamInput.id = 'agent-streaming'; streamInput.type = 'checkbox'; streamInput.checked = true;
  streamLabel.append(streamInput, el('span', '', '流式输出（默认开）'));
  const toolLabel = el('label', 'field-row');
  const toolInput = document.createElement('input');
  toolInput.id = 'agent-tool-call'; toolInput.type = 'checkbox';
  toolLabel.append(toolInput, el('span', '', '工具调用（默认关，未开启时智能体不调本机工具）'));
  const proxyLabel = el('label', 'field');
  proxyLabel.appendChild(el('span', '', '代理策略'));
  const proxySel = document.createElement('select');
  proxySel.id = 'agent-proxy-policy';
  proxySel.append(new Option('跟随全局（默认）', 'global'), new Option('直连', 'direct'), new Option('使用代理', 'proxy'));
  proxyLabel.appendChild(proxySel);
  // 2026-11-27-10：技能挂接（抽屉「提示词与参数」页签）：勾上的技能会随
  // 每次对话发给该智能体；已停用的技能不可勾。
  const skillLabel = el('label', 'field');
  skillLabel.appendChild(el('span', '', '使用技能（已启用的技能会随每次对话发给智能体）'));
  const skillBox = document.createElement('div');
  skillBox.id = 'agent-skill-box';
  skillLabel.appendChild(skillBox);
  const testRow = el('div', 'field-row');
  const testBtn = el('button', 'btn', '连接测试');
  testBtn.type = 'button'; testBtn.id = 'agent-test';
  const testStatus = el('span', 'hint', '');
  testStatus.id = 'agent-test-status';
  testRow.append(testBtn, testStatus);
  testBtn.addEventListener('click', async () => {
    if (!currentAgentId) { testStatus.textContent = '先保存智能体'; return; }
    const finish = beginAsync(testBtn, '测试中…', testStatus);
    const connType = document.getElementById('agent-conn-type').value;
    if (connType === 'web') {
      const r = await callTb('agentWebVerify', currentAgentId);
      if (!r || r.ok === false) { finish(false, `连接测试没有通过：${(r && r.error) || '后端没有返回原因'}`); return; }
      finish(true, r.login ? `连接测试通过，已登录：${r.login}` : '连接测试通过');
      return;
    }
    // 2026-11-28-2：API 连接测试改轻量探测——GET {base}/models，
    // 不发计费调用；空列表或空回复都算失败。网页测试继续走验证。
    const r = await window.toolbox.agentModelsTest(currentAgentId).catch((e) => ({ ok: false, error: e.message || String(e) }));
    if (!r || r.ok === false) { finish(false, `连接测试没有通过：${(r && r.error) || '后端没有返回原因'}`); return; }
    finish(true, r.note || `连接测试通过，共 ${r.count || 0} 个模型。`);
  });
  const ioRow = el('div', 'field-row');
  const exportBtn = el('button', 'btn', '导出配置');
  exportBtn.type = 'button'; exportBtn.id = 'agent-export';
  const importBtn = el('button', 'btn', '导入配置');
  importBtn.type = 'button'; importBtn.id = 'agent-import';
  ioRow.append(exportBtn, importBtn);
  exportBtn.addEventListener('click', async () => {
    const agents = await window.toolbox.agentsList().catch(() => []);
    const cur = agents.find((x) => x.id === currentAgentId);
    if (!cur) { toast('先保存智能体'); return; }
    const { apiKey, webToken, webCookie, webUserAgent, ...safe } = cur;
    await window.toolbox.copyText(JSON.stringify(safe, null, 2));
    toast('配置已复制（不含密钥与令牌），可粘贴保存');
  });
  importBtn.addEventListener('click', async () => {
    const res = await customPrompt('导入智能体配置', '粘贴之前导出的配置 JSON（不含密钥，密钥需重新填写）：', 'text');
    if (!res || res.value !== true || !res.input.trim()) return;
    let parsed = null;
    try { parsed = JSON.parse(res.input); } catch (e) { toast(`导入没有成功：JSON 读不懂（${e.message}）`); return; }
    if (!parsed || !parsed.name) { toast('导入没有成功：配置里没有名称'); return; }
    currentAgentId = parsed.id || null;
    fillAgentForm(parsed);
    toast('配置已填入抽屉，点「保存智能体」保存');
  });
  agentDrawerNodes = {
    basic: [labelFor('agent-name'), labelFor('agent-provider'), labelFor('agent-conn-type'), labelFor('agent-model')].filter(Boolean),
    auth: [labelFor('agent-base'), labelFor('agent-key'), document.getElementById('agent-web-fields'), proxyLabel].filter(Boolean),
    params: [labelFor('agent-system'), mkField('温度（0–2，默认 0.7）', tempInput),
      mkField('上下文长度（轮数，默认 20）', ctxInput), streamLabel, skillLabel].filter(Boolean),
    advanced: [toolLabel, testRow, ioRow].filter(Boolean),
  };
  agentFooterEl = document.getElementById('agent-save')
    ? document.getElementById('agent-save').closest('.field-row') : null;
  formCard.style.display = 'none'; // 设置页只留列表 + 新建按钮，不渲染表单
  const empty = el('p', 'desc', '未选择智能体：点「新建智能体」或列表里的「编辑」打开设置抽屉。');
  empty.id = 'agent-settings-empty';
  document.getElementById('agent-tab-list').appendChild(empty);
}

/* ----- 其余表单分组（不进抽屉） ----- */
function makeSegmented(labels, onSwitch) {
  const seg = el('div', 'tabs segmented');
  seg.setAttribute('role', 'tablist');
  const btns = labels.map((text, i) => {
    const b = el('button', `tab${i === 0 ? ' active' : ''}`, text);
    b.type = 'button';
    b.addEventListener('click', () => {
      btns.forEach((x) => x.classList.toggle('active', x === b));
      onSwitch(i);
    });
    seg.appendChild(b);
    return b;
  });
  return seg;
}
function makeCollapsible(row, title) {
  if (!row || !row.parentElement) return { expand: () => {} };
  const btn = el('button', 'btn', `${title} ▸`);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const hidden = row.classList.toggle('hidden');
    btn.textContent = `${title} ${hidden ? '▸' : '▾'}`;
  });
  row.parentElement.insertBefore(btn, row);
  row.classList.add('hidden');
  return {
    expand: () => { row.classList.remove('hidden'); btn.textContent = `${title} ▾`; },
  };
}
function initFormGrouping() {
  /* 创作 7 项：顶部 Segmented Control 分组（参数 / 内容）；模板管理子卡片改为抽屉内嵌的二级面板。 */
  const createForm = document.querySelector('#create-tab-write .form');
  if (createForm) {
    const paramsBox = el('div', 'create-group-params');
    const contentBox = el('div', 'create-group-content');
    const agentLabel = labelFor('create-agent');
    const promptRow = document.getElementById('create-prompt') ? document.getElementById('create-prompt').closest('.field-row') : null;
    const typeRow = document.getElementById('create-type') ? document.getElementById('create-type').closest('.field-row') : null;
    const inputLabel = labelFor('create-input');
    const tasksRow = document.getElementById('create-tasks');
    const resultLabel = labelFor('create-result');
    const actionsRow = document.getElementById('create-copy') ? document.getElementById('create-copy').closest('.field-row') : null;
    [agentLabel, promptRow, typeRow].forEach((x) => { if (x) paramsBox.appendChild(x); });
    [inputLabel, tasksRow, resultLabel, actionsRow].forEach((x) => { if (x) contentBox.appendChild(x); });
    const seg = makeSegmented(['参数', '内容'], (i) => {
      paramsBox.classList.toggle('hidden', i !== 0);
      contentBox.classList.toggle('hidden', i !== 1);
    });
    contentBox.classList.add('hidden');
    createForm.insertBefore(seg, createForm.firstChild);
    createForm.appendChild(paramsBox);
    createForm.appendChild(contentBox);
  }
  /* 图像 6 项：接口设置 / 生成参数；改图面板改为抽屉。 */
  const imageForm = document.querySelector('#image-tab-generate .form');
  if (imageForm) {
    const apiBox = el('div', 'image-group-api');
    const genBox = el('div', 'image-group-gen');
    [labelFor('image-base'), labelFor('image-key'), labelFor('image-model'),
      document.getElementById('image-save') ? document.getElementById('image-save').closest('.field-row') : null]
      .forEach((x) => { if (x) apiBox.appendChild(x); });
    [labelFor('image-prompt'), labelFor('image-style'), labelFor('image-size'),
      document.getElementById('image-generate') ? document.getElementById('image-generate').closest('.field-row') : null,
      document.getElementById('image-upload') ? document.getElementById('image-upload').closest('.field-row') : null]
      .forEach((x) => { if (x) genBox.appendChild(x); });
    const seg = makeSegmented(['接口设置', '生成参数'], (i) => {
      apiBox.classList.toggle('hidden', i !== 0);
      genBox.classList.toggle('hidden', i !== 1);
    });
    genBox.classList.add('hidden');
    imageForm.insertBefore(seg, imageForm.firstChild);
    imageForm.appendChild(apiBox);
    imageForm.appendChild(genBox);
  }
  /* 代码：保持左右分栏，设置类字段（智能体）收进顶部一段。 */
  const codeAgentLabel = labelFor('code-agent');
  const codeSplit = document.querySelector('#screen-code .split');
  if (codeAgentLabel && codeSplit && codeSplit.parentElement) {
    const strip = el('div', 'field-row');
    strip.id = 'code-agent-strip';
    strip.appendChild(codeAgentLabel);
    codeSplit.parentElement.insertBefore(strip, codeSplit);
  }
  /* 设置窗口与系统：7 个复选框按“窗口 / 系统 / 通知”分三组。 */
  const winPane = document.getElementById('settings-pane-window');
  if (winPane) {
    const rows = [...winPane.querySelectorAll('.card-row')];
    const byId = (id) => rows.find((r) => r.querySelector(id));
    const groups = [
      ['窗口', ['#cfg-hw-accel', '#cfg-always-on-top', '#cfg-transparent', '#cfg-close-tray']],
      ['系统', ['#cfg-prevent-sleep', '#cfg-autostart']],
      ['通知', ['#cfg-notify']],
    ];
    const anchor = document.getElementById('power-status-line');
    groups.forEach(([title, ids]) => {
      const group = el('div', 'settings-group');
      group.appendChild(el('p', 'subhead', title));
      ids.forEach((id) => { const r = byId(id); if (r) group.appendChild(r); });
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(group, anchor);
      else winPane.appendChild(group);
    });
  }
  /* 代理 6 个 tab 保留，只换玻璃 Segmented Control 样式类（样式由 A 路定义）。 */
  const proxyTabs = document.querySelector('#screen-proxy .tabs');
  if (proxyTabs) proxyTabs.classList.add('segmented');
  /* 注册页“添加平台”“手动添加记录”改为默认折叠卡片，与历史记录折叠原则一致。 */
  const platformRow = document.getElementById('reg-platform-name')
    ? document.getElementById('reg-platform-name').closest('.field-row') : null;
  makeCollapsible(platformRow, '添加平台');
  const manualRow = document.getElementById('reg-target')
    ? document.getElementById('reg-target').closest('.field-row') : null;
  regManualCollapse = makeCollapsible(manualRow, '手动添加记录');
}

/* ---------- 2026-11-27-4：更新子页新按钮（本地文件更新 / 发布到仓库） ---------- */
const PUBLISH_FILES = ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css', 'update-manifest.json'];
let publishStatusCache = null;
let publishRunning = false;
function onPublishProgress(p) {
  if (!p) return;
  const result = document.getElementById('update-result');
  if (result) result.textContent = `正在发布第 ${p.index || 0}/${p.total || 6} 个文件：${p.file || ''}`;
}
async function refreshPublishStatus() {
  const btn = document.getElementById('update-publish');
  const note = document.getElementById('update-publish-note');
  if (!btn) return;
  const st = await callTb('publishStatus');
  if (!st || st.ok === false) {
    publishStatusCache = null;
    btn.disabled = true;
    if (note) note.textContent = (st && st.error) || '发布功能需要新版后端';
    return;
  }
  publishStatusCache = st;
  btn.disabled = !st.canPublish;
  if (note) {
    note.textContent = st.reason
      || (st.canPublish
        ? `本地 ${st.localVersion} 高于仓库 ${st.remoteVersion || '无清单'}，可以发布`
        : `本地 ${st.localVersion} / 仓库 ${st.remoteVersion || '无清单'}`);
  }
}
async function onUpdateFromLocalFile() {
  const btn = document.getElementById('update-local-file');
  if (!btn || btn.disabled) return;
  const finish = beginAsync(btn, '更新中…', document.getElementById('update-result'));
  const bar = document.getElementById('update-progress');
  if (bar) bar.classList.remove('hidden');
  const r = await callTb('updateFromLocalFile');
  if (!r || r.ok === false) {
    finish(false, `本地更新没有完成：${(r && r.error) || '后端没有返回原因'}`);
    return;
  }
  finish(true, '本地更新完成：点「重启生效」后用新版本。');
  await renderUpdateSection();
}
async function onPublishLocal() {
  const btn = document.getElementById('update-publish');
  if (!btn || btn.disabled || publishRunning) return;
  const st = publishStatusCache || await callTb('publishStatus');
  if (!st || st.ok === false || !st.canPublish) {
    toast((st && (st.reason || st.error)) || '现在不能发布');
    return;
  }
  const ok = await customConfirm('发布本地版本到仓库',
    `本地版本 ${st.localVersion}，仓库版本 ${st.remoteVersion || '无清单'}。将发布 6 个文件：${PUBLISH_FILES.join('、')}。二进制组件不随本次发布，仍随完整文件夹发行。`, '发布');
  if (!ok) return;
  publishRunning = true;
  const finish = beginAsync(btn, '发布中…', document.getElementById('update-result'));
  const r = await callTb('publishLocal');
  publishRunning = false;
  if (!r || r.ok === false) {
    const done = Array.isArray(r && r.published) ? r.published : [];
    const failed = Array.isArray(r && r.failed) ? r.failed : [];
    finish(false, `发布没有完成：${(r && r.error) || '后端没有返回原因'}${done.length ? `（已写 ${done.join('、')}，未写 ${failed.join('、') || '其余文件'}，仓库已处于新旧混合状态，请重新发布或手动处理）` : ''}`);
    await refreshPublishStatus();
    return;
  }
  finish(true, `已发布到仓库：版本 ${st.localVersion}（${(r.published || []).length || 6} 个文件），仓库清单已更新`);
  await renderUpdateSection();
  await refreshPublishStatus();
}
/* 2026-11-27-11，第 1 项：发布新版本（版本 +1 后 git 提交推送）。
 * 小改动后点一下就行；没装 Git、不是仓库副本、没令牌时后端如实报错。 */
let publishNewRunning = false;
async function onPublishNewVersion() {
  const btn = document.getElementById('update-publish-new');
  if (!btn || publishNewRunning) return;
  const ok = await customConfirm('发布新版本',
    '先把版本按“日期=当天、末尾每日重置为 0、当天每次修改后 +1”升一级，再精确提交白名单文件并推送到仓库（git push）。需要本机装 Git、当前安装是仓库副本、已在工具来源登录 GitHub。令牌不会出现在日志或界面里。', '发布新版本');
  if (!ok) return;
  publishNewRunning = true;
  const finish = beginAsync(btn, '发布新版本…', document.getElementById('update-result'));
  const r = await callTb('publishNewVersion');
  publishNewRunning = false;
  if (!r || r.ok === false) {
    finish(false, `发布新版本没有完成：${(r && r.error) || '后端没有返回原因'}`);
    return;
  }
  finish(true, `已发布新版本 ${r.version}（${(r.files || []).length} 个文件已提交并推送）。当前运行的仍是旧版本，重启后显示新版。`);
  await renderUpdateSection();
  await refreshPublishStatus();
}
function initUpdateButtons() {
  const toolbar = document.querySelector('#settings-pane-update .toolbar');
  if (!toolbar || document.getElementById('update-local-file')) return;
  const localBtn = el('button', 'btn', '从本机文件更新');
  localBtn.type = 'button'; localBtn.id = 'update-local-file';
  const pubBtn = el('button', 'btn', '发布本地版本到仓库');
  pubBtn.type = 'button'; pubBtn.id = 'update-publish';
  const pubNewBtn = el('button', 'btn primary', '发布新版本（版本 +1）');
  pubNewBtn.type = 'button'; pubNewBtn.id = 'update-publish-new';
  pubNewBtn.title = '先把版本 +1，再提交并推送到仓库（需要 Git 与仓库副本）';
  const pubNote = el('span', 'hint', '');
  pubNote.id = 'update-publish-note';
  toolbar.append(localBtn, pubBtn, pubNewBtn);
  toolbar.insertAdjacentElement('afterend', pubNote);
  localBtn.addEventListener('click', onUpdateFromLocalFile);
  pubBtn.addEventListener('click', onPublishLocal);
  pubNewBtn.addEventListener('click', onPublishNewVersion);
  if (window.toolbox && typeof window.toolbox.on === 'function') {
    try { window.toolbox.on('publish-progress', onPublishProgress); } catch (e) { /* C 路补透传前静默 */ }
  }
  refreshPublishStatus();
}

/* ---------- 2026-11-27-4：主题（跟随 / 浅色 / 深色 + 壁纸） ----------
 * 配置字段 theme（'auto'|'light'|'dark'，默认 'auto'）与 wallpaperPath
 * （默认 ''）由 C 路在 loadConfig 默认值里加；这里只读配置、不假设
 * 字段已存在。控件 #setting-theme、#setting-wallpaper-pick、
 * #setting-wallpaper-clear 由 A 路建 markup；控件还没建时只应用
 * 配置，不报错。 */
function resolveThemeName(cfg) {
  const t = (cfg && cfg.theme) || 'auto';
  if (t === 'light' || t === 'dark') return t;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch (e) { return 'light'; }
}
function applyTheme(cfg) {
  const theme = resolveThemeName(cfg || {});
  document.body.dataset.theme = theme;
  const wp = ((cfg && cfg.wallpaperPath) || '').trim();
  const layer = document.getElementById('wallpaper-layer');
  const url = wp ? `url("${encodeURI(`file:///${wp.replace(/\\/g, '/')}`)}")` : '';
  if (layer) layer.style.backgroundImage = url;
  else document.body.style.backgroundImage = url;
  /* 同步主题控件的显示值（控件由 A 路建）：下拉当前档位、壁纸名提示。 */
  const themeSel = document.getElementById('setting-theme');
  if (themeSel) themeSel.value = (cfg && cfg.theme) || 'auto';
  const wpName = document.getElementById('setting-wallpaper-name');
  if (wpName) {
    wpName.textContent = wp
      ? `壁纸：${wp.split(/[\\/]/).pop()}`
      : '未设置壁纸时使用默认渐变。';
  }
  sendThemeToPlugin();
}
function bindThemeControls() {
  const themeSel = document.getElementById('setting-theme');
  if (themeSel && !themeSel.dataset.bound) {
    themeSel.dataset.bound = '1';
    themeSel.addEventListener('change', async () => {
      await window.toolbox.setConfig({ theme: themeSel.value });
      const cfg = await window.toolbox.getConfig().catch(() => ({}));
      applyTheme({ ...(cfg || {}), theme: themeSel.value });
      toast('主题已保存');
    });
  }
  const pickBtn = document.getElementById('setting-wallpaper-pick');
  if (pickBtn && !pickBtn.dataset.bound) {
    pickBtn.dataset.bound = '1';
    pickBtn.addEventListener('click', async () => {
      const r = await callTb('selectWallpaper');
      if (!r || r.ok === false) {
        if (!r || !r.canceled) toast((r && r.error) || '选择壁纸没有完成：后端没有返回原因');
        return;
      }
      await window.toolbox.setConfig({ wallpaperPath: r.path || '' });
      const cfg = await window.toolbox.getConfig().catch(() => ({}));
      applyTheme({ ...(cfg || {}), wallpaperPath: r.path || '' });
      toast('壁纸已设置');
    });
  }
  const clearBtn = document.getElementById('setting-wallpaper-clear');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', async () => {
      await window.toolbox.setConfig({ wallpaperPath: '' });
      const cfg = await window.toolbox.getConfig().catch(() => ({}));
      applyTheme({ ...(cfg || {}), wallpaperPath: '' });
      toast('壁纸已清除');
    });
  }
}
function initThemeListener() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = async () => {
      const cfg = await window.toolbox.getConfig().catch(() => ({}));
      if (!cfg || (cfg.theme || 'auto') === 'auto') applyTheme(cfg || {});
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  } catch (e) { /* 不支持时忽略 */ }
}
/* 插件页主题变量：plugin-call（主进程）推不进沙盒 iframe，能到达插件页
 * 的只有渲染层 → iframe 的 postMessage（翻译请求走的同一条通道），
 * 这里复用它下发主题变量；插件页监听 'plugin-theme' 后写 CSS 变量。 */
function pluginThemeVars() {
  const dark = document.body.dataset.theme === 'dark';
  return dark
    ? { mode: 'dark', bg: '#1c1c1e', surface: '#2c2c2e', text: '#f5f5f7', muted: '#a1a1a6', accent: '#0f766e', border: 'rgba(255,255,255,0.16)', hover: 'rgba(255,255,255,0.08)', tagBg: '#26423f', radius: 8, fontSize: 14, titleSize: 14, subSize: 12 }
    : { mode: 'light', bg: '#ffffff', surface: '#f5f5f7', text: '#1c1c1e', muted: '#6e6e73', accent: '#0f766e', border: 'rgba(0,0,0,0.12)', hover: '#e0f2f0', tagBg: '#e6f4f1', radius: 8, fontSize: 14, titleSize: 14, subSize: 12 };
}
function sendThemeToPlugin() {
  const frame = document.getElementById('plugin-frame');
  if (!frame || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage({ type: 'plugin-theme', theme: pluginThemeVars() }, '*'); }
  catch (e) { /* 插件页未加载时忽略 */ }
}
function initDrawerMigrations() {
  initAccountDrawer();
  initAgentDrawer();
  initFormGrouping();
  initUpdateButtons();
  bindThemeControls();
  initThemeListener();
}

/* ---------- 启动 ---------- */
(async () => {
  initDrawerMigrations(); // 2026-11-27-4：抽屉迁移、表单分组、更新按钮、主题控件绑定
  const ov = await window.toolbox.getOverview();
  applyTheme(ov.config || {}); // 主题与壁纸按配置立即应用
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
