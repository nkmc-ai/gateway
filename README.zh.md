# nkmc gateway

**[English](README.md)** | **[日本語](README.ja.md)**

> The gateway of internet for all agents. NaKaMiChi - the middle path, the right path.

在加密保险库中存储凭证，代理 CLI 工具而不暴露密钥，与对等网关联邦共享访问权限。

```
                        托管网关（协调层）
                         ┌─────────────────────────┐
                         │  Tunnel 注册表           │
                         │  节点发现                │
                         │  Pool 凭证（40+ API）    │
                         └────────┬────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │ CF Tunnel   │  CF Tunnel   │
                    ▼             │              ▼
        ┌──────────────┐         │    ┌──────────────┐
        │ 你的网关      │ ◄───────┘    │ 对等网关      │
        │ (localhost)  │ ◄──────────► │ (任意位置)    │
        │              │  联邦通信     │              │
        │ Vault:       │  query/exec  │ Vault:       │
        │  github.com  │              │  openai.com  │
        │  stripe.com  │              │  anthropic   │
        └──────┬───────┘              └──────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
 nkmc run   nkmc cat   nkmc ls
 gh repo    /openai/   /
 list       models
```

### 工作原理

**1. 本地操作** — 你的网关加密存储凭证，在请求时注入：

```
nkmc run gh repo list
  |
  +-- POST /proxy/exec ----->  ToolRegistry: gh -> github.com
  |                            Vault: AES-GCM 解密 -> ghp_xxx
  |                            Exec: spawn("gh", [...], { GH_TOKEN })
  |                            <---- { stdout, exitCode }
```

**2. 联邦路由** — 本地没有凭证时，查询对等网关：

```
nkmc cat /api.openai.com/models
  |
  +-- POST /execute -------->  Vault: api.openai.com 无本地密钥
  |                            +-- 对等回退 -------------->  对等网关
  |                            |   query: api.openai.com?    检查借出规则
  |                            |   <-- available: true       Vault: 注入密钥
  |                            |   exec: cat /models         请求 OpenAI API
  |                            |   <-- { data: [...] }       <-- 返回结果
  |                            <---- 结果
```

**3. Tunnel 与发现** — 托管网关协调整个网络：

```
nkmc gateway start --tunnel
  |
  +-- 启动本地网关 :9090
  +-- POST 托管网关/tunnels/create ------>  托管网关
  |     { advertisedDomains: [...] }        创建 CF Tunnel
  |     <-- { tunnelToken, publicUrl }      注册到发现服务
  +-- 启动 cloudflared 连接器
  |     localhost:9090 <===> Cloudflare Edge <===> publicUrl
  |
  完成: https://abc123.tunnel.nkmc.ai

# 其他网关现在可以发现你并建立对等连接：
nkmc peers discover               # 查询托管网关
nkmc peers discover --domain gh   # 查找谁有 GitHub 凭证
```

## 快速开始

### 单机模式（仅本地）

```bash
# 安装
npm install -g @nkmc/cli @nkmc/server

# 启动网关
nkmc gateway start

# 存储密钥（AES-GCM 加密存入本地 vault）
nkmc keys set github.com --token ghp_...

# 使用
nkmc run gh repo list
nkmc cat /api.github.com/repos/nkmc-ai/gateway
```

### 网络模式（联邦 + tunnel）

```bash
# 带 tunnel 启动 — 自动认证，无需额外设置
nkmc gateway start --tunnel
# => 本地:  http://localhost:9090
# => 公网: https://abc123.tunnel.nkmc.ai

# 设置借出规则 — 决定共享什么
nkmc rules set github.com --allow --pricing free
nkmc rules set api.stripe.com --deny

# 发现网络上的对等节点
nkmc peers discover
# => Bob 的网关 — https://xyz789.tunnel.nkmc.ai
# =>   域名: api.openai.com, api.anthropic.com

# 添加对等节点
nkmc peers add --id bob --name "Bob" \
  --url https://xyz789.tunnel.nkmc.ai --secret shared-key

# 现在可以使用 Bob 的 OpenAI 凭证
nkmc cat /api.openai.com/models
# => 路由到 Bob 的网关，注入 Bob 的密钥，返回结果
```

## 功能特性

- **凭证保险库** -- API 密钥使用 AES-GCM 加密存储在 SQLite 中。Agent 通过 JWT 认证，网关代为注入凭证。密钥永远不会离开网关。
- **CLI 代理** -- 通过网关运行现有 CLI 工具（`gh`、`stripe`、`openai`、`aws`）。网关查找工具对应的凭证域，注入环境变量，执行命令并返回输出。
- **服务注册** -- 通过 OpenAPI 自动发现（`nkmc register --url http://localhost:3000`）或 `skill.md` 清单注册任意 HTTP API。使用 `nkmc ls /` 浏览已注册服务。
- **网关联邦** -- 对等网关之间可以互借凭证。当本地凭证缺失时，网关向对等节点查询。借出规则控制访问权限（免费、按请求计费、按 token 计费，通过 x402 协议）。
- **隧道与发现** -- `nkmc gateway start --tunnel` 创建 Cloudflare Tunnel 实现 NAT 穿透。网关向协调服务器注册并自动发现其他网关。
- **BYOK（自带密钥）** -- Agent 可以上传自己的 API 密钥到网关保险库。BYOK 密钥优先于池密钥。
- **域名验证** -- 通过 DNS TXT 挑战验证域名所有权（`nkmc claim example.com`）。验证通过后获得发布令牌用于注册服务。
- **虚拟文件系统** -- API 挂载为虚拟路径（`/api.openai.com/models`）。Agent 使用熟悉的 `ls`、`cat`、`write`、`rm`、`grep` 操作。

## 包结构

| 包 | npm | 说明 |
|---|-----|------|
| `packages/gateway` | `@nkmc/gateway` | 核心网关逻辑：注册表、保险库、联邦、代理、隧道 |
| `packages/agent-fs` | `@nkmc/agent-fs` | 虚拟文件系统层：挂载点、后端（HTTP、JSON-RPC）、解析器 |
| `packages/server` | `@nkmc/server` | 独立 Node.js 服务器，包含 SQLite、迁移、密钥生成 |

相关 SDK 包（在 [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)）：

| 包 | npm | 说明 |
|---|-----|------|
| `packages/cli` | `@nkmc/cli` | CLI 工具（`nkmc`），用于与网关交互 |
| `packages/core` | `@nkmc/core` | 共享类型、JWT 签名、skill.md 生成 |

## CLI 命令

| 命令 | 说明 |
|------|------|
| `nkmc auth` | 向网关认证并保存 JWT 令牌 |
| `nkmc init` | 为项目创建 `nkmc.config.ts` 配置 |
| `nkmc generate` | 扫描路由/模型并生成 `.well-known/skill.md` |
| `nkmc register --url <url>` | 自动发现 OpenAPI 规范并注册服务 |
| `nkmc register --domain <d>` | 从本地 `skill.md` 注册服务 |
| `nkmc claim <domain>` | 请求 DNS TXT 挑战以验证域名所有权 |
| `nkmc claim <domain> --verify` | 验证 DNS 挑战并获取发布令牌 |
| `nkmc ls <path>` | 列出虚拟路径下的条目 |
| `nkmc cat <path>` | 读取虚拟路径的数据 |
| `nkmc write <path> <data>` | 向虚拟路径写入数据 |
| `nkmc rm <path>` | 删除虚拟路径上的资源 |
| `nkmc grep <pattern> <path>` | 搜索服务或端点 |
| `nkmc pipe "cat /a \| write /b"` | 在两个路径间传输数据 |
| `nkmc run <tool> [args...]` | 代理 CLI 工具（如 `gh`、`stripe`） |
| `nkmc keys set <domain>` | 将 API 密钥存入网关保险库（加密） |
| `nkmc keys list` | 列出已存储的 API 密钥 |
| `nkmc keys remove <domain>` | 删除 API 密钥 |
| `nkmc gateway start` | 启动本地网关服务器 |
| `nkmc gateway start --tunnel` | 启动并开启 Cloudflare Tunnel 公网访问 |
| `nkmc gateway start --daemon` | 以后台进程启动 |
| `nkmc gateway stop` | 停止后台网关 |
| `nkmc gateway status` | 查看网关进程和隧道信息 |
| `nkmc peers add` | 添加联邦对等网关 |
| `nkmc peers list` | 列出已配置的对等网关 |
| `nkmc peers remove <id>` | 删除对等网关 |
| `nkmc peers discover` | 通过隧道网络发现在线网关 |
| `nkmc rules set <domain>` | 设置凭证借出规则 |
| `nkmc rules list` | 列出所有借出规则 |
| `nkmc rules remove <domain>` | 删除借出规则 |

## 联邦

网关可以互相对等，在网络中共享凭证访问权限。

**添加对等节点：**

```bash
nkmc peers add \
  --id peer-alice \
  --name "Alice 的网关" \
  --url https://alice.tunnel.nkmc.ai \
  --secret shared-secret-value
```

**借出规则**控制哪些凭证可以共享给哪些对等节点：

```bash
# 允许所有对等节点免费使用你的 OpenAI 密钥
nkmc rules set api.openai.com --allow --peers '*' --pricing free

# 仅允许特定对等节点，按请求收费
nkmc rules set api.stripe.com --allow --peers peer-alice,peer-bob \
  --pricing per-request --amount 0.01

# 拒绝借出某个域名的凭证
nkmc rules set github.com --deny
```

**工作原理：**

1. Agent 在本地网关请求 `cat /api.openai.com/models`
2. 本地网关检查保险库——未找到凭证
3. 网关查询对等节点：`POST /federation/query { domain: "api.openai.com" }`
4. 对等节点响应：`{ available: true, pricing: { mode: "free" } }`
5. 本地网关委托对等节点执行：`POST /federation/exec { command: "cat /api.openai.com/models" }`
6. 对等节点注入自己的凭证，发起 API 调用，返回结果
7. 密钥始终不会离开对等网关

**计费模式：**

| 模式 | 说明 |
|------|------|
| `free` | 免费 |
| `per-request` | 每次请求固定美元金额 |
| `per-token` | 每 token 美元金额（用于 LLM API） |

付费请求使用 x402 支付协议（请求头 `X-402-Payment`）。

## 安全

- **AES-GCM 加密** -- 保险库中的所有凭证使用 256 位 AES-GCM 密钥加密。每条记录使用唯一的 12 字节 IV。
- **文件权限** -- 敏感文件（`keys.json`、`encryption.key`、`admin-token`）设置为 `0600`（仅所有者可读写）。
- **JWT 认证** -- Agent 使用 EdDSA (Ed25519) 签名的 JWT 进行认证。网关在 `/.well-known/jwks.json` 公开其公钥。
- **密钥不出网关** -- 保险库在请求时解密凭证，注入到出站 API 调用或子进程环境变量中，随后丢弃。原始密钥永远不会发送给 Agent。
- **BYOK 隔离** -- 每个 Agent 的 BYOK 凭证按其 Agent ID 隔离。Agent 无法访问其他 Agent 的密钥。
- **Pool 与 BYOK 优先级** -- 当某个域名同时存在 BYOK 和池凭证时，BYOK 凭证优先。
- **联邦边界** -- 对等网关代为执行请求。借出方网关注入自己的凭证，凭证永远不会传输给请求方。

## 配置

服务器从环境变量和数据目录中可选的 `config.json` 文件读取配置。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NKMC_PORT` | `9090` | 服务器监听端口 |
| `NKMC_HOST` | `0.0.0.0` | 服务器监听地址 |
| `NKMC_DATA_DIR` | `~/.nkmc/server` | 数据目录（SQLite 数据库、密钥、配置） |
| `NKMC_ADMIN_TOKEN` | （自动生成） | 凭证管理用管理员令牌 |
| `NKMC_ENCRYPTION_KEY` | （自动生成） | Base64 编码的 256 位 AES 密钥 |
| `NKMC_GATEWAY_PRIVATE_KEY` | （自动生成） | EdDSA 私钥（JWK JSON） |
| `NKMC_GATEWAY_PUBLIC_KEY` | （自动生成） | EdDSA 公钥（JWK JSON） |
| `NKMC_GATEWAY_URL` | `https://nkmc.ai` | 网关 URL（CLI 使用） |
| `NKMC_GATEWAY_NAME` | （无） | 隧道发现时的显示名称 |

自动生成的值在首次运行时以 `0600` 权限持久化到数据目录。

## HTTP API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/.well-known/jwks.json` | 公开 | 网关公钥（JWKS） |
| `POST` | `/auth/token` | 公开 | 为 Agent 签发 JWT |
| `POST` | `/domains/challenge` | 公开 | 请求 DNS TXT 挑战 |
| `POST` | `/domains/verify` | 公开 | 验证 DNS 挑战 |
| `POST` | `/registry/services` | 发布/管理员 | 注册服务（skill.md） |
| `POST` | `/registry/services/discover` | 发布/管理员 | 自动发现并注册 |
| `GET` | `/credentials` | 管理员 | 列出保险库域名 |
| `PUT` | `/credentials/:domain` | 管理员 | 设置池凭证 |
| `DELETE` | `/credentials/:domain` | 管理员 | 删除池凭证 |
| `PUT` | `/byok/:domain` | Agent JWT | 上传 BYOK 凭证 |
| `GET` | `/byok` | Agent JWT | 列出 BYOK 域名 |
| `DELETE` | `/byok/:domain` | Agent JWT | 删除 BYOK 凭证 |
| `POST` | `/execute` | Agent JWT | 执行文件系统命令 |
| `POST` | `/proxy/exec` | Agent JWT | 执行注入凭证的 CLI 工具 |
| `GET` | `/proxy/tools` | Agent JWT | 列出可用代理工具 |
| `GET` | `/admin/federation/peers` | 管理员 | 列出对等网关 |
| `PUT` | `/admin/federation/peers/:id` | 管理员 | 添加/更新对等节点 |
| `DELETE` | `/admin/federation/peers/:id` | 管理员 | 删除对等节点 |
| `GET` | `/admin/federation/rules` | 管理员 | 列出借出规则 |
| `PUT` | `/admin/federation/rules/:domain` | 管理员 | 设置借出规则 |
| `DELETE` | `/admin/federation/rules/:domain` | 管理员 | 删除借出规则 |
| `POST` | `/federation/query` | 对等节点 | 查询凭证可用性 |
| `POST` | `/federation/exec` | 对等节点 | 代为执行命令 |
| `POST` | `/federation/announce` | 对等节点 | 公告可提供的域名 |
| `POST` | `/tunnels/create` | Agent JWT | 创建 Cloudflare Tunnel |
| `DELETE` | `/tunnels/:id` | Agent JWT | 删除隧道 |
| `GET` | `/tunnels` | Agent JWT | 列出 Agent 的隧道 |
| `GET` | `/tunnels/discover` | Agent JWT | 发现在线网关 |
| `POST` | `/tunnels/heartbeat` | Agent JWT | 更新隧道心跳 |

## 开发

```bash
# 克隆
git clone https://github.com/nkmc-ai/gateway.git
cd gateway

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 类型检查
pnpm lint
```

## 链接

- **GitHub**: [nkmc-ai/gateway](https://github.com/nkmc-ai/gateway) | [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)
- **npm**: [@nkmc/gateway](https://www.npmjs.com/package/@nkmc/gateway) | [@nkmc/agent-fs](https://www.npmjs.com/package/@nkmc/agent-fs) | [@nkmc/server](https://www.npmjs.com/package/@nkmc/server) | [@nkmc/cli](https://www.npmjs.com/package/@nkmc/cli) | [@nkmc/core](https://www.npmjs.com/package/@nkmc/core)

## 许可证

MIT
