# 桌面聊天空间

桌面聊天空间是一个多智能体网页聊天应用：左侧智能体列表，中间最近聊天 / 文件 / 群聊，右侧聊天窗口。支持 API 智能体和网页令牌智能体（DeepSeek、豆包、千问、Gemini 等），支持群聊、每位智能体的长期记忆与系统提示、每阶段指定负责人、定时 / 事件触发、文件上传与智能体访问开关，以及 Pioneer VPN（全局模式）。

> 这是一份代码快照，不含任何账号、密钥、令牌、聊天记录和数据库数据。拿到代码后需要自行部署服务端并重新配置登录。

## 目录结构

- `client/`：前端（React + TypeScript，Tailwind）
- `server/`：服务端（Bun + TypeScript，`server/src/actions.ts` 为主要动作实现）
- `drizzle/`：数据库迁移（0001–0032，含 Pioneer 全局模式与 VPN 日志的 0032）
- `package.json` / `bun.lock` / `bunfig.toml`：依赖与构建
- `space.json`：空间元数据（入口为构建后的 `client/dist/index.html`）
- `LOGS.md`：脱敏日志摘要
- `.gitignore`：不应入库的内容

## 部署运行

### 环境

- Bun 1.3.x（`package.json` 指定 `bun@1.3.10`）
- 一个可用的数据库（按 `drizzle/` 迁移建表）
- 服务端运行环境（本快照源自 Muse 托管空间，`@hatch/space-sdk` 在 `package.json` 里是本地文件引用 `file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz`，不是公开 npm 包；在 Muse 之外复现需要先替换 / 适配这层运行环境，不能直接 `bun install` 就跑）

### 步骤

1. 安装依赖并构建：
   ```bash
   bun install
   bun run build
   ```
   构建产物在 `client/dist/` 与 `server/dist/`，构建产物不入库。
2. 按 `drizzle/` 顺序执行数据库迁移。
3. 启动服务端，按运行环境的说明配置入口与端口。
4. 在空间里逐个配置智能体（见下），不要把密钥写进代码或提交到仓库。

### 不会跟着代码走的东西

API Key、网页登录令牌、Cookie、Pioneer 账号密码、聊天记录、文件内容、数据库文件都只存在原空间的服务端，不在仓库里。复现出来是一个空壳，需要重新登录和配置。

## 智能体配置

### API 智能体

在智能体设置里填 API Base、API Key、模型名、温度等，保存后用「测试连接」验证。Key 只存服务端，页面不回显。

### 网页令牌智能体

以 Gemini、千问为例，都是网页令牌登录，不是 API Key。通用步骤：智能体列表 → 进入该智能体设置 → 「网页登录令牌」→ 粘贴 → 「验证登录」，显示已登录后即可在房间里发消息。令牌只存服务端，页面不回显；没贴令牌时显示尚未登录、发消息没反应。

**Gemini**

需要 `gemini.google.com` 的两个 Cookie：`__Secure-1PSID` 与 `__Secure-1PSIDTS`。

在自己电脑浏览器登录 `gemini.google.com`，按 F12，「应用 → Cookie → gemini.google.com」，复制这两个值，推荐用竖线式一行粘贴：

```
<你的 __Secure-1PSID 值>|<你的 __Secure-1PSIDTS 值>
```

前面一串以 `g.a000` 开头，后面一串以 `sidts-` 开头，中间只有一个 `|`，不要换行、不要引号、不要空格。也可以贴整段 Cookie：

```
__Secure-1PSID=<你的值>; __Secure-1PSIDTS=<你的值>
```

不要把令牌值发给别人、贴到公开仓库或聊天记录里。

**千问**

千问的令牌是 `chat.qwen.ai` 本地存储里键名为 `token` 的值（值本身是一串 JWT，不含“token”这几个字），用作 Bearer 令牌。

在自己电脑浏览器登录 `chat.qwen.ai`，按 F12，控制台执行：

```js
copy(localStorage.getItem("token"))
```

然后粘贴到空间千问设置里并验证。注意：千问访问令牌有效期只有约 15 分钟，导出后要尽快粘贴验证；空间也支持粘贴控制台一键导出的整段 JSON（`token` + `cookie` + `ua`），服务端会分开保存并在验证与发消息时按整组对齐发送；若 Cookie 里 `token=` 与本地存储不一致，以 Cookie 为准。服务器出口 IP 无法与浏览器对齐，设置里会如实说明。

### 其他网页智能体

DeepSeek、豆包、元宝、Kimi、智谱、Mistral、文心一言、Grok、GPT、Claude 等各有自己的令牌形态与验证接口，见各智能体设置页的帮助文案；未配置或令牌过期的智能体保持沉默，不会假装回复。

## Pioneer VPN 与全局模式

空间的「代理」（Pioneer VPN）面板提供：登录 / 登出、地区列表与选择、换节点、断开、隧道出口复核、IP 纯净度测试、全局模式开关、VPN 连接日志。

- 登录 Pioneer 账号后选择地区（例如中国台湾、日本、新加坡等），连接后隧道建立，面板显示节点与出口信息。
- **全局模式（fun 模式）**：VPN 面板里的开关，保存在服务端。开启且隧道已连接时，全部智能体请求（API 与网页版）改走隧道本地代理，从所连节点出口发送；开启但未连接时明确显示「暂未生效、仍直连」，不假装生效。
- 未开全局模式时，智能体请求仍直连，VPN 只用于出口 IP 复核与纯净度测试。
- VPN 日志区可折叠、可清空，记录登录 / 退出、服务器识别、连接 / 断开与隧道结果、全局模式开关与生效状态、纯净度测试结果，保留最近 100 条。

## 已知问题：Gemini 直连 ECONNRESET

直连 `gemini.google.com` 时，服务端请求可能在收到任何响应前被重置，报错 `TypeError: ECONNRESET: The socket connection was closed unexpectedly`。这时令牌本身可能完全没问题（格式通过、请求头可正常构造），问题在服务端出口到 Gemini 的链路被重置，换令牌解决不了。

已验证的绕法：连上 Pioneer VPN 并打开全局模式，让 Gemini 请求走隧道出口，验证可一次通过。注意：当时 Gemini 聊天经隧道不再断连，但适配器仍解析为空回复，聊天未完全解决，见 `LOGS.md`。

## 注意事项

- 不要把任何 API Key、网页令牌、Cookie、密码提交到仓库；也不要把聊天记录、数据库文件（`app.db*`）、上传的图片、浏览器日志、审计记录提交。
- 构建产物（`client/dist/`、`server/dist/`、`.space-build*`）、`node_modules/`、日志与上传文件都在 `.gitignore` 里。
- `client/src/assets/logos/*.png` 等二进制图片因本次快照推送只支持 UTF-8 文本文件而未包含在内，需要时自行恢复。
