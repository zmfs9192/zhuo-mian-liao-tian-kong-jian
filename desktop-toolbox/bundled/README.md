# 打包内置组件（bundled/）

2026-11-27-6 起安装包里只剩 WinTun 一个内置组件；VLC 与 Chromium
快照包都不再随安装包发。本目录里的两个大 zip 只作源码备查：
`vlc-3.0.21-win64.zip`（75MB）与 `chromium-win64.zip`（209MB），
需要时由工具箱在首次使用时按需下载（VLC 走后备下载，Chromium
走官方快照地址，断点续传 + sha256 校验）。`licenses/` 也不再随
包发，只留源码备查。

WinTun 首次运行时由 `main.js` 的 `ensureWintunDll()` 校验 sha256
后解出 amd64 的 dll 到 `%APPDATA%\muse-desktop-toolbox\tools\wintun\`；
VLC 下完后解压到 `tools/vlc/`，Chromium 下完后解压到 `tools/chromium/`。

| 文件 | 内容 | 大小 | sha256 |
| --- | --- | --- | --- |
| `wintun-0.14.1.zip` | WinTun 0.14.1 官方包，随安装包发，首次运行解压 | 0.7MB | 见 `main.js` 的 `BUNDLED_SHA256.wintunZip` |
| `vlc-3.0.21-win64.zip` | VLC 3.0.21 官方 zip，原样，未改动；2026-11-27-6 起不再随安装包发，只作源码备查 | 75MB | `a0b7ec02b50adf6417eed014fb8df50af39690505a4225b85b3dc2ed17d14843` |
| `chromium-win64.zip` | Chromium 快照 160.0.8184.0（2026-11-25），只去掉一个文件（见下）；v1.6.0 起不再随安装包发，首次使用浏览器时再下载，本文件只作源码备查 | 209MB | `6a79b6435e30dad51298f609ff70bea0c3fb292bcf419e738ca97ffa47d1df52` |

来源（打包时下载的地址，与 `main.js` 里的运行时下载后备地址一致）：

- VLC：`https://download.videolan.org/pub/videolan/vlc/3.0.21/win64/vlc-3.0.21-win64.zip`
- Chromium：`https://download-chromium.appspot.com/dl/Win_x64?type=snapshots`

## Chromium 瘦身：只去掉一个文件

原快照 zip 是 366MB、解压后 852MB，其中 `chrome-win/interactive_ui_tests.exe`
一个文件就占 390MB——那是 Chromium 自己的界面测试程序，浏览用不到。
打包前已用 zip 重打包去掉它，其余 257 个文件原样保留，`chrome-win/chrome.exe`
仍在。去掉后 zip 为 209MB。解压后仍约 462MB，这是 Chromium 本身的体积，
不是工具箱加的东西。

注意：原快照里没有附带 LICENSE 文件；许可证见
`licenses/CHROMIUM-LICENSE.txt`（BSD，取自 Chromium 源码树 main 分支）
与 `THIRD-PARTY-LICENSES.md`。

## 许可证文件

`licenses/` 里有（只留源码备查，不再随安装包发）：

- `VLC-COPYING.txt`：从 VLC zip 里原样取出的 `vlc-3.0.21/COPYING.txt`（GPLv2）。
- `CHROMIUM-LICENSE.txt`：Chromium 主许可证（BSD 风格，Copyright 2015 The Chromium Authors）。

## 重新生成（打包者用）

1. 按上面两个地址重新下载原包；
2. Chromium：只删除 `chrome-win/interactive_ui_tests.exe` 后重打包；
3. 更新本文件与 `main.js` 里 `BUNDLED_SHA256` 的哈希；
4. 更新 `THIRD-PARTY-LICENSES.md` 里的版本与日期。

组件不单独更新：VLC 与 Chromium 只随工具箱版本一起更新，
换版本时重新按上面步骤取新包。
