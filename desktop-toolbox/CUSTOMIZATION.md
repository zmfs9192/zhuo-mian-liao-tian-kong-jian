# 定制说明（v1.3.0，v1.6.0 更新）：Chromium 与 VLC 能定制什么

结论先说：两个都是开源软件，但**都没有从源码重编**。
Chromium 从源码编一次要上百 GB 磁盘、数小时到数天、还要
depot_tools 全套工具链，在这里不现实；VLC 从源码编也要
MinGW/MSVC 全套构建环境，同样不做。下面的定制全部是
**不重编就能做的**：启动参数、预置配置文件、界面设置。

## Chromium（160.0.8184.0 快照；v1.6.0 起首次使用浏览器时再下载，不再打包内置，下完的配置与启动参数与打包内置版一致）

### 已实现（代码里有，见 `main.js`）

| 定制 | 怎么做 | 说明 |
| --- | --- | --- |
| 界面语言中文 | 启动参数 `--lang=zh-CN` | 每次启动都带；用户在浏览器里改语言后以浏览器设置为准 |
| 浏览数据隔离 | 启动参数 `--user-data-dir=<工具箱 profile 目录>`、`--no-first-run` | 不动系统浏览器；profile 在 `tools/chromium/profile/` |
| 主页 | 首次启动时写 `profile/Default/Preferences`：`homepage=https://www.google.com`、`homepage_is_newtabpage=false` | 只在 profile 首次创建时写一次；用户在浏览器里改主页后以用户改的为准 |
| 语言偏好 | 同上：`intl.accept_languages=zh-CN,zh` | 同上 |
| 不弹“设为默认浏览器”提示 | 同上：`browser.check_default_browser=false` | 同上 |

### 能定制、但本次没做（列出来，不虚构）

- **默认搜索引擎**：`Preferences` 里有 `default_search_provider.*`
  一组键，但 Chromium 要求默认搜索提供方带有效的预填充 ID
  与签名，直接写 Preferences 常被重置回内置默认。可靠的
  办法是在浏览器里「设置 → 搜索引擎」里改，或用企业策略
  `DefaultSearchProvider*` 下发。本次没做，不 claim 已做。
- **启动时打开的页面**：`session.restore_on_startup=4` +
  `session.urls_to_restore_on_startup`，写进 Preferences
  即可；本次没做，启动时默认打开新标签页。
- **默认下载目录**：`download.default_directory`，写进
  Preferences 即可；本次没做，浏览器用自己的默认下载目录，
  工具箱的「下载默认存放位置」是工具箱自己的下载目录，
  两者不是同一个设置。
- **扩展**：启动参数 `--load-extension=<路径>` 可加载未打包
  扩展；本次没打包任何扩展。
- **企业策略**：Windows 注册表 / `master_preferences`
  可下发主页、搜索引擎等；本次没做。

### 不重编做不到的

改界面布局、增删浏览器内置功能、改品牌与更新通道、
改渲染/网络底层行为。这些要改 Chromium 源码并重编，
本次不做。

## VLC（打包内置版，3.0.21）

### 已实现（代码里有，见 `main.js`）

| 定制 | 怎么做 | 说明 |
| --- | --- | --- |
| 配置隔离 | 只对打包内置版启动时加 `--config <tools/vlc/vlcrc-toolbox>` | 不动用户自己的 `%APPDATA%\vlc\vlcrc`；已装版不用这条 |
| 网络流缓存 | 预置 vlcrc：`network-caching=2000`（默认 1000ms，公网流放宽到 2000ms） | 只在首次启动、文件不存在时写一次 |
| 免首次隐私提示 | 启动参数 `--no-qt-privacy-ask` | 只对打包内置版 |

### 能定制、但本次没做（列出来，不虚构）

VLC 的配置就是一个 `vlcrc` 文本文件（Windows 在
`%APPDATA%\vlc\vlcrc`，键是 `key=value`，缺了就是默认）。
以下键都可以写进工具箱的预置 vlcrc，本次只写了上面
`network-caching` 一项，其余没写、没 claim：

- 界面：`qt-minimal-view`、`qt-privacy-ask`、`language`
- 音频：`volume`、输出设备（`aout`）
- 视频：硬件解码（`avcodec-hw`，Windows 默认 `any` 即 D3D11VA）、
  去隔行、视频输出
- 字幕：`freetype-font`、`freetype-fontsize`、编码
- 播放列表与实例：`one-instance`、`playlist-enqueue`
- 日志：`file-logging`、`logfile`、`log-verbose`

改这些不用重编，改 vlcrc 或启动参数就行；要改再加。

### 不重编做不到的

加新解码器、改界面结构、改皮肤引擎之外的播放器行为。
这些要改 VLC 源码并重编，本次不做。
