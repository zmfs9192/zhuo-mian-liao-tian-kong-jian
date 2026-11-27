# 第三方许可证（2026-11-27-6 修订）

工具箱本身的代码是 MIT 许可证（见 `package.json` 的 `license` 字段）。
2026-11-27-6 起 VLC 与 Chromium 都不再随安装包内置，许可证原文
只留源码备查（`bundled/licenses/`），不再随包发；WinTun 仍随包发，
其许可证见 WinTun 官方包内附带的文件。

## VLC 3.0.21 — GNU GPL v2

- 来源：VideoLAN 官方下载
  `https://download.videolan.org/pub/videolan/vlc/3.0.21/win64/vlc-3.0.21-win64.zip`
- 许可证：GNU General Public License v2
- 原文：`bundled/licenses/VLC-COPYING.txt`（从 VLC zip 里的
  `vlc-3.0.21/COPYING.txt` 原样取出）
- 官网：https://www.videolan.org/vlc/

VLC 是 GPL 软件：可以免费使用与分发，随包分发时须保留
许可证原文；改源码再分发时须按 GPL 提供源码。2026-11-27-6 起
VLC 不再随安装包发，许可证原文只留源码备查。

## Chromium 160.0.8184.0（2026-11-25 快照）— BSD 风格许可证

- 来源：Chromium 官方快照服务
  `https://download-chromium.appspot.com/dl/Win_x64?type=snapshots`
  （快照版本 160.0.8184.0，见包内 `chrome-win/160.0.8184.0.manifest`）
- 许可证：BSD 风格许可证（Copyright 2015 The Chromium Authors）
- 原文：`bundled/licenses/CHROMIUM-LICENSE.txt`（取自 Chromium
  源码树 main 分支的 LICENSE 文件）
- 源码：https://chromium.googlesource.com/chromium/src

注意两点：

1. 这是 **Chromium 开源版快照，不是 Google Chrome 稳定版**。
   快照是持续构建，未经过 Chrome 稳定版的发布测试，
   没有自动更新；组件只随工具箱版本一起更新。
2. Chromium 还捆绑了大量第三方组件，各有自己的许可证，
   完整清单在 Chromium 源码树里，不在快照 zip 里。
   快照 zip 内没有附带 LICENSE 文件，以上主许可证文件
   是从源码树取的。

## Electron

工具箱是 Electron 程序，Electron 本身随安装包一起发，
其许可证见 Electron 发行包内的 LICENSE 文件（MIT/BSD 风格）。
