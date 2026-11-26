'use strict';
/** 生成 update-manifest.json（代码热更新清单）。
 * 用法：发版前在 desktop-toolbox/ 目录运行 `node scripts/gen-manifest.js`。
 * 它按 package.json 的内部版本号（semver，如 2026.11.26-2）算出
 * 界面版本号（2026-11-26-2），再给每个热更新代码文件算 sha256，
 * 写进本目录的 update-manifest.json；发版时把清单与代码一起推
 * 上 GitHub（仓库根目录 desktop-toolbox/ 下），工具箱检查更新时
 * 就从 raw.githubusercontent.com 拉这份清单。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css'];
// package.json 不在清单里：打包时 electron-builder 会删掉它的
// devDependencies 与 scripts，发出去的文件哈希对不上源码的哈希；
// 它运行时不起作用（版本号在 main.js 的 VERSION 里）。

function displayVersion(internal) {
  // 2026.11.26-2 → 2026-11-26-2（前两个点换成 -，-2 保留）。
  const parts = String(internal).split('.');
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}-${parts.slice(2).join('.')}`;
  return String(internal);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const internal = String(pkg.version || '');
const manifest = {
  version: displayVersion(internal),
  internalVersion: internal,
  displayVersion: displayVersion(internal),
  releasedAt: new Date().toISOString().slice(0, 10),
  notes: '',
  files: FILES.map((rel) => {
    const full = path.join(ROOT, rel);
    const buf = fs.readFileSync(full);
    return { path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
  }),
};
fs.writeFileSync(path.join(ROOT, 'update-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`update-manifest.json 已生成：版本 ${manifest.displayVersion}（内部 ${internal}），${manifest.files.length} 个文件，共 ${manifest.files.reduce((n, f) => n + f.size, 0)} 字节`);
