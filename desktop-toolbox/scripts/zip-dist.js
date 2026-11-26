'use strict';
/** 把打包好的 win-unpacked 文件夹打成 zip 发给用户。
 * 用法：`npm run build:win` 之后运行 `node scripts/zip-dist.js`。
 * zip 名用内部版本号：桌面工具箱-2026.11.26-2.zip。
 * 优先用系统 zip 命令（Linux/mac），没有时用 Windows 的
 * PowerShell Compress-Archive，再没有就报错提示手动打包。 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const zipName = `桌面工具箱-${pkg.version}.zip`;
const zipPath = path.join(DIST, zipName);
const srcDir = path.join(DIST, 'win-unpacked');
if (!fs.existsSync(srcDir)) {
  console.error(`找不到 ${srcDir}：请先跑 npm run build:win`);
  process.exit(1);
}
try { fs.unlinkSync(zipPath); } catch (e) { /* 本来就没有 */ }

let r;
if (process.platform === 'win32') {
  r = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${srcDir}' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });
} else {
  r = spawnSync('zip', ['-r', '-q', zipPath, 'win-unpacked'], { cwd: DIST, stdio: 'inherit' });
}
if (r.error || r.status !== 0) {
  console.error('打包 zip 失败：系统里没有可用的 zip 工具，请手动把 dist/win-unpacked 打成 zip。');
  process.exit(1);
}
const size = fs.statSync(zipPath).size;
console.log(`${zipName} 已生成：${(size / 1024 / 1024).toFixed(1)}MB（${size} 字节）`);
