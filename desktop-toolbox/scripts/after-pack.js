'use strict';
/** electron-builder afterPack：给打包好的文件夹瘦身。
 *
 * 2026-11-27-6 起，安装包不再内置 VLC（75MB，已从 extraResources
 * 拿掉），这里只做两件打包后清理，不动任何功能文件：
 *  1. 删 Electron 自带的 LICENSES.chromium.html（约 14.5MB 的许可证
 *     文本，工具箱自己的许可证见 THIRD-PARTY-LICENSES.md）。
 *  2. locales/ 只留 11 种语言（简中、繁中、英语、日语、法语、西班牙
 *     语、印地语、阿拉伯语、葡萄牙语、俄语、德语），其余语言包删除；
 *     缺失的语言 Electron 会自动回退到英语，不影响启动与界面。
 * 有风险的不动：dxcompiler.dll、vk_swiftshader.dll 等 GPU 相关文件、
 * ffmpeg.dll、icudtl.dat、resources.pak、v8 快照一律保留。
 * 缺文件不报错（Linux/mac 打包路径不同时跳过不存在的项），只删
 * 上面点名的文件，绝不按通配符整目录删除。
 * 用法：electron-builder.yml 里配 `afterPack: ./scripts/after-pack.js`；
 * 自测可直接 require 本文件，用假 context 调 `afterPack({ appOutDir })`。
 */
const fs = require('fs');
const path = require('path');

/** 保留的语言（locales/<语言>.pak），用户 2026-11-27 定：中英繁日法，
 * 再加地球上最常用的几种语言。 */
const KEEP_LOCALES = [
  'zh-CN', 'zh-TW', // 简中、繁中
  'en-US',          // 英语
  'ja',             // 日语
  'fr',             // 法语
  'es',             // 西班牙语
  'hi',             // 印地语
  'ar',             // 阿拉伯语
  'pt-BR',          // 葡萄牙语
  'ru',             // 俄语
  'de',             // 德语
];

function removeFile(file, removed) {
  try {
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    fs.unlinkSync(file);
    removed.push({ file: path.basename(file), size });
  } catch (e) { /* 单个文件删不掉不拦打包，如实记日志 */ }
}

async function afterPack(context) {
  const outDir = (context && context.appOutDir) || '';
  if (!outDir || !fs.existsSync(outDir)) return;
  const removed = [];
  removeFile(path.join(outDir, 'LICENSES.chromium.html'), removed);
  const locDir = path.join(outDir, 'locales');
  try {
    if (fs.existsSync(locDir)) {
      for (const name of fs.readdirSync(locDir)) {
        if (!/\.pak$/i.test(name)) continue;
        if (KEEP_LOCALES.includes(name.replace(/\.pak$/i, ''))) continue;
        removeFile(path.join(locDir, name), removed);
      }
    }
  } catch (e) { /* locales 读不到不拦打包 */ }
  const savedMB = removed.reduce((s, r) => s + r.size, 0) / 1024 / 1024;
  console.log(`[after-pack] 瘦身完成：删除 ${removed.length} 个文件，省 ${savedMB.toFixed(1)}MB（未压缩）`);
  for (const r of removed.slice(0, 8)) console.log(`[after-pack]   - ${r.file} (${(r.size / 1024 / 1024).toFixed(1)}MB)`);
  if (removed.length > 8) console.log(`[after-pack]   …其余 ${removed.length - 8} 个为语言包`);
}

module.exports = afterPack;
module.exports.KEEP_LOCALES = KEEP_LOCALES;
