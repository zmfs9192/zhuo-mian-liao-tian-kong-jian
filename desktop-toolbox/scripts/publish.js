'use strict';
/** ⚠⚠⚠ 给后来改代码的 AI：每次改动后版本号前面日期固定为 2026-11-27，
 * 最后一位按当前版本 +1（如 2026.11.27-9 → 2026.11.27-10），发版只用
 * 本脚本算新版本，不要手改版本号。注意：本脚本跨天会按当天日期从 1 开始
 * （不是永远固定日期），如用户要改成永远固定日期，先改下面的计数逻辑
 * （nextCount 那一行）再发版，见 AGENTS.md 第 3 节。
 * 一键发版：按“日期-当日次数”规则算新版本，同步改 package.json
 * 与 main.js 的版本号，调用 gen-manifest.js 重新生成清单并校验。
 * 用法：在 desktop-toolbox/ 目录运行 `node scripts/publish.js`
 * （或 `npm run publish`）。只改本地文件，不推仓库、不打包。
 * 选项：--dry-run 只算不写；--date YYYY-MM-DD 指定日期（自测用）。
 * 任何一步失败即停并报原因，退出码 1；成功打印新版本号与清单。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css'];

function fail(msg) { console.error(`发版失败：${msg}`); process.exit(1); }
function displayVersion(internal) {
  const parts = String(internal || '').split('.');
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}-${parts.slice(2).join('.')}`;
  return String(internal || '');
}
function todayTaipei(dateOverride) {
  if (dateOverride) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) fail(`--date 格式不对：${dateOverride}，应为 YYYY-MM-DD`);
    return dateOverride;
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function parseInternal(v) {
  const m = String(v || '').match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, count: Number(m[4]) };
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dateArg = (() => { const i = args.findIndex((a) => a === '--date'); return i >= 0 ? args[i + 1] : ''; })();

// 1) 读当前版本：package.json 与 main.js 两处必须一致，否则先同步再发版。
let pkg;
try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch (e) { fail(`package.json 读不到：${e.message}`); }
const curInternal = String(pkg.version || '');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const mVer = mainSrc.match(/^const VERSION = '([^']+)';/m);
const mDisp = mainSrc.match(/^const DISPLAY_VERSION = '([^']+)';/m);
if (!mVer || !mDisp) fail('main.js 里找不到 VERSION / DISPLAY_VERSION（行首定义）');
if (mVer[1] !== curInternal || mDisp[1] !== displayVersion(curInternal)) {
  fail(`本地版本号不一致（package.json ${curInternal}，main.js ${mVer[1]} / ${mDisp[1]}），请先同步再发版`);
}
const parsed = parseInternal(curInternal);
if (!parsed) fail(`当前内部版本号格式不对：${curInternal}，应为 YYYY.MM.DD-N`);
const today = todayTaipei(dateArg);
const nextCount = parsed.date === today ? parsed.count + 1 : 1;
const nextInternal = `${today.replace(/-/g, '.')}-${nextCount}`;
const nextDisplay = `${today}-${nextCount}`;

if (dryRun) {
  console.log(`试算：当前 ${displayVersion(curInternal)}（内部 ${curInternal}）→ 新版 ${nextDisplay}（内部 ${nextInternal}），未写任何文件。`);
  process.exit(0);
}

// 2) 写 package.json（保持两格缩进、无尾换行，与现文件格式一致）。
pkg.version = nextInternal;
fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
// 3) 写 main.js 两处版本号（行首定义，各必须恰好命中一次）。
let next = mainSrc.replace(/^const VERSION = '[^']+';/m, `const VERSION = '${nextInternal}';`);
if (next === mainSrc) fail('main.js 的 VERSION 替换失败');
const next2 = next.replace(/^const DISPLAY_VERSION = '[^']+';/m, `const DISPLAY_VERSION = '${nextDisplay}';`);
if (next2 === next) fail('main.js 的 DISPLAY_VERSION 替换失败');
fs.writeFileSync(path.join(ROOT, 'main.js'), next2, 'utf8');
// 4) 调用 gen-manifest.js 重新生成清单（它按 package.json 的新版本算清单）。
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-manifest.js')], { stdio: 'inherit' });
} catch (e) { fail(`gen-manifest.js 执行失败：${e.message}`); }
// 5) 校验清单：版本字段与 5 个文件的哈希、大小逐项核对磁盘。
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'update-manifest.json'), 'utf8')); } catch (e) { fail(`update-manifest.json 读不到：${e.message}`); }
if (manifest.version !== nextDisplay || manifest.internalVersion !== nextInternal || manifest.displayVersion !== nextDisplay) {
  fail(`清单版本号不对：${manifest.version} / ${manifest.internalVersion}，应为 ${nextDisplay} / ${nextInternal}`);
}
for (const f of FILES) {
  const item = (manifest.files || []).find((x) => x.path === f);
  if (!item) fail(`清单里缺文件 ${f}`);
  const buf = fs.readFileSync(path.join(ROOT, f));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== String(item.sha256 || '').toLowerCase() || buf.length !== Number(item.size)) fail(`清单里 ${f} 的哈希或大小对不上磁盘`);
}
console.log(`发版就绪：${nextDisplay}（内部 ${nextInternal}）`);
for (const f of FILES) {
  const it = manifest.files.find((x) => x.path === f);
  console.log(`  ${f}  ${it.size} 字节  sha256 ${String(it.sha256).slice(0, 12)}…`);
}
console.log('下一步：检查改动无误后推上 GitHub（main 分支），工具箱点「检查更新」即可拉到。');
