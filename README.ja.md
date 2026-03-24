# nkmc gateway

**[English](README.md)** | **[简体中文](README.zh.md)**

AIエージェント向けのフェデレーション型APIゲートウェイ。暗号化されたVaultに認証情報を保管し、キーを公開せずにCLIツールをプロキシし、ピアゲートウェイとフェデレーションしてアクセスを共有します。

```
                        ホストゲートウェイ（調整層）
                         ┌─────────────────────────┐
                         │  Tunnel レジストリ       │
                         │  ノード探索              │
                         │  Pool 認証情報（40+ API）│
                         └────────┬────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │ CF Tunnel   │  CF Tunnel   │
                    ▼             │              ▼
        ┌──────────────┐         │    ┌──────────────┐
        │ あなたのGW    │ ◄───────┘    │ ピアGW       │
        │ (localhost)  │ ◄──────────► │ (任意の場所) │
        │              │ フェデレーション│              │
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

### 動作原理

**1. ローカル操作** — ゲートウェイが認証情報を暗号化保存し、リクエスト時に注入：

```
nkmc run gh repo list
  |
  +-- POST /proxy/exec ----->  ToolRegistry: gh -> github.com
  |                            Vault: AES-GCM 復号 -> ghp_xxx
  |                            Exec: spawn("gh", [...], { GH_TOKEN })
  |                            <---- { stdout, exitCode }
```

**2. フェデレーション** — ローカルに認証情報がない場合、ピアに問い合わせ：

```
nkmc cat /api.openai.com/models
  |
  +-- POST /execute -------->  Vault: api.openai.com のキーなし
  |                            +-- ピアフォールバック ---->  ピアゲートウェイ
  |                            |   query: api.openai.com?    貸出ルール確認
  |                            |   <-- available: true       Vault: キー注入
  |                            |   exec: cat /models         OpenAI API呼出
  |                            |   <-- { data: [...] }       <-- レスポンス
  |                            <---- 結果
```

**3. Tunnel と探索** — ホストゲートウェイがネットワークを調整：

```
nkmc gateway start --tunnel
  |
  +-- ローカルGW起動 :9090
  +-- POST ホストGW/tunnels/create ------>  ホストゲートウェイ
  |     { advertisedDomains: [...] }        CF Tunnel 作成
  |     <-- { tunnelToken, publicUrl }      探索サービスに登録
  +-- cloudflared コネクタ起動
  |     localhost:9090 <===> Cloudflare Edge <===> publicUrl
  |
  完了: https://abc123.tunnel.nkmc.ai

# 他のGWがあなたを発見してピア接続できるようになります：
nkmc peers discover               # ホストGWに問い合わせ
nkmc peers discover --domain gh   # GitHub認証情報を持つノードを検索
```

## クイックスタート

### スタンドアロンモード（ローカルのみ）

```bash
# インストール
npm install -g @nkmc/cli @nkmc/server

# ゲートウェイ起動
nkmc gateway start

# 認証
nkmc auth --gateway-url http://localhost:9090

# キーを保存（AES-GCM暗号化でローカルVaultに格納）
nkmc keys set github.com --token ghp_...

# 利用
nkmc run gh repo list
nkmc cat /api.github.com/repos/nkmc-ai/gateway
```

### ネットワークモード（フェデレーション + Tunnel）

```bash
# ホストゲートウェイで認証（Tunnel・探索用）
nkmc auth

# Tunnel付きで起動 — GWが公開アクセス可能に
nkmc gateway start --tunnel
# => ローカル: http://localhost:9090
# => 公開:    https://abc123.tunnel.nkmc.ai

# 貸出ルールを設定 — 何を共有するか決定
nkmc rules set github.com --allow --pricing free
nkmc rules set api.stripe.com --deny

# ネットワーク上のピアを探索
nkmc peers discover
# => Bobのゲートウェイ — https://xyz789.tunnel.nkmc.ai
# =>   ドメイン: api.openai.com, api.anthropic.com

# ピアを追加
nkmc peers add --id bob --name "Bob" \
  --url https://xyz789.tunnel.nkmc.ai --secret shared-key

# BobのOpenAI認証情報を利用可能に
nkmc cat /api.openai.com/models
# => Bobのゲートウェイにルーティング、Bobのキーで注入、結果を返却
```

## 機能

- **認証情報Vault** -- APIキーはSQLite内でAES-GCM暗号化して保管。エージェントはJWTで認証し、ゲートウェイが代わりに認証情報を注入します。キーはゲートウェイの外に出ません。
- **CLIプロキシ** -- 既存のCLIツール（`gh`、`stripe`、`openai`、`aws`）をゲートウェイ経由で実行。ツールの認証情報ドメインを検索し、環境変数を注入して実行、出力を返します。
- **サービスレジストリ** -- OpenAPI自動検出（`nkmc register --url http://localhost:3000`）または`skill.md`マニフェストで任意のHTTP APIを登録。`nkmc ls /` で登録済みサービスを閲覧できます。
- **ゲートウェイフェデレーション** -- ピアゲートウェイ間で認証情報を貸借。ローカルに認証情報がない場合、ピアに問い合わせます。貸出ルールでアクセス制御（無料、リクエスト単位、トークン単位の課金。x402プロトコル対応）。
- **トンネルとディスカバリ** -- `nkmc gateway start --tunnel` でCloudflare Tunnelを作成し、NAT越えを実現。ゲートウェイはコーディネーションサーバーに登録し、相互に自動検出します。
- **BYOK（自前キー持ち込み）** -- エージェントは自分のAPIキーをゲートウェイVaultにアップロード可能。BYOKキーはプールキーより優先されます。
- **ドメイン認証** -- DNS TXTチャレンジによるドメイン所有権の証明（`nkmc claim example.com`）。認証後、サービス登録用のパブリッシュトークンを取得できます。
- **仮想ファイルシステム** -- APIは仮想パス（`/api.openai.com/models`）としてマウントされます。エージェントは`ls`、`cat`、`write`、`rm`、`grep` の操作で利用できます。

## パッケージ構成

| パッケージ | npm | 説明 |
|-----------|-----|------|
| `packages/gateway` | `@nkmc/gateway` | コアゲートウェイロジック：レジストリ、Vault、フェデレーション、プロキシ、トンネル |
| `packages/agent-fs` | `@nkmc/agent-fs` | 仮想ファイルシステム層：マウント、バックエンド（HTTP、JSON-RPC）、パーサー |
| `packages/server` | `@nkmc/server` | スタンドアロンNode.jsサーバー（SQLite、マイグレーション、鍵生成） |

関連SDKパッケージ（[nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)）：

| パッケージ | npm | 説明 |
|-----------|-----|------|
| `packages/cli` | `@nkmc/cli` | CLIツール（`nkmc`）：ゲートウェイとのインタラクション |
| `packages/core` | `@nkmc/core` | 共有型定義、JWT署名、skill.md生成 |

## CLIコマンド

| コマンド | 説明 |
|---------|------|
| `nkmc auth` | ゲートウェイで認証しJWTトークンを保存 |
| `nkmc init` | プロジェクトに `nkmc.config.ts` を作成 |
| `nkmc generate` | ルート/スキーマをスキャンして `.well-known/skill.md` を生成 |
| `nkmc register --url <url>` | OpenAPI仕様を自動検出してサービスを登録 |
| `nkmc register --domain <d>` | ローカルの `skill.md` からサービスを登録 |
| `nkmc claim <domain>` | ドメイン所有権のDNS TXTチャレンジを要求 |
| `nkmc claim <domain> --verify` | DNSチャレンジを検証しパブリッシュトークンを取得 |
| `nkmc ls <path>` | 仮想パスのエントリを一覧 |
| `nkmc cat <path>` | 仮想パスのデータを読み取り |
| `nkmc write <path> <data>` | 仮想パスにデータを書き込み |
| `nkmc rm <path>` | 仮想パスのリソースを削除 |
| `nkmc grep <pattern> <path>` | サービスやエンドポイントを検索 |
| `nkmc pipe "cat /a \| write /b"` | 2つのパス間でデータをパイプ |
| `nkmc run <tool> [args...]` | CLIツールをプロキシ実行（例：`gh`、`stripe`） |
| `nkmc keys set <domain>` | APIキーをゲートウェイVaultに保存（暗号化） |
| `nkmc keys list` | 保存済みAPIキーを一覧 |
| `nkmc keys remove <domain>` | APIキーを削除 |
| `nkmc gateway start` | ローカルゲートウェイサーバーを起動 |
| `nkmc gateway start --tunnel` | Cloudflare Tunnel付きで起動（公開アクセス） |
| `nkmc gateway start --daemon` | バックグラウンドプロセスとして起動 |
| `nkmc gateway stop` | バックグラウンドゲートウェイを停止 |
| `nkmc gateway status` | ゲートウェイプロセスとトンネル情報を表示 |
| `nkmc peers add` | フェデレーション用ピアゲートウェイを追加 |
| `nkmc peers list` | 設定済みピアゲートウェイを一覧 |
| `nkmc peers remove <id>` | ピアゲートウェイを削除 |
| `nkmc peers discover` | トンネルネットワーク経由でオンラインゲートウェイを検出 |
| `nkmc rules set <domain>` | 認証情報の貸出ルールを設定 |
| `nkmc rules list` | 全貸出ルールを一覧 |
| `nkmc rules remove <domain>` | 貸出ルールを削除 |

## フェデレーション

ゲートウェイ同士がピアリングし、ネットワーク全体で認証情報のアクセスを共有できます。

**ピアの追加：**

```bash
nkmc peers add \
  --id peer-alice \
  --name "Aliceのゲートウェイ" \
  --url https://alice.tunnel.nkmc.ai \
  --secret shared-secret-value
```

**貸出ルール**は、どの認証情報をどのピアと共有するかを制御します：

```bash
# 全ピアにOpenAIキーを無料で貸出
nkmc rules set api.openai.com --allow --peers '*' --pricing free

# 特定ピアのみ許可、リクエスト単位で課金
nkmc rules set api.stripe.com --allow --peers peer-alice,peer-bob \
  --pricing per-request --amount 0.01

# ドメインの貸出を拒否
nkmc rules set github.com --deny
```

**動作の仕組み：**

1. エージェントがローカルゲートウェイで `cat /api.openai.com/models` をリクエスト
2. ローカルゲートウェイがVaultを確認 — 認証情報なし
3. ゲートウェイがピアに問い合わせ：`POST /federation/query { domain: "api.openai.com" }`
4. ピアが応答：`{ available: true, pricing: { mode: "free" } }`
5. ローカルゲートウェイがピアに実行を委任：`POST /federation/exec { command: "cat /api.openai.com/models" }`
6. ピアが自身の認証情報を注入し、API呼び出しを行い、結果を返却
7. キーはピアゲートウェイの外に出ない

**課金モード：**

| モード | 説明 |
|--------|------|
| `free` | 無料 |
| `per-request` | リクエストごとに固定USD金額 |
| `per-token` | トークンごとのUSD金額（LLM API向け） |

有料リクエストはx402支払いプロトコル（ヘッダー `X-402-Payment`）を使用します。

## セキュリティ

- **AES-GCM暗号化** -- Vault内の全認証情報は256ビットAES-GCM鍵で暗号化。各エントリに固有の12バイトIVを使用。
- **ファイルパーミッション** -- 機密ファイル（`keys.json`、`encryption.key`、`admin-token`）は`0600`（所有者のみ読み書き可）に設定。
- **JWT認証** -- エージェントはEdDSA (Ed25519) 署名JWTで認証。ゲートウェイは `/.well-known/jwks.json` で公開鍵を公開。
- **キーはゲートウェイ外に出ない** -- Vaultはリクエスト時に認証情報を復号し、送信API呼び出しまたはサブプロセスの環境変数に注入後、破棄します。生のキーはエージェントに送信されません。
- **BYOK分離** -- 各エージェントのBYOK認証情報はエージェントIDでスコープされます。他のエージェントのキーにはアクセスできません。
- **Pool vs BYOK優先度** -- 同一ドメインにBYOKとプール認証情報が存在する場合、BYOKが優先されます。
- **フェデレーション境界** -- ピアゲートウェイはリクエスト元に代わって実行します。貸出側ゲートウェイが自身の認証情報を注入し、認証情報はリクエスト元ピアに送信されません。

## 設定

サーバーは環境変数とデータディレクトリ内のオプションの `config.json` ファイルから設定を読み込みます。

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `NKMC_PORT` | `9090` | サーバーリッスンポート |
| `NKMC_HOST` | `0.0.0.0` | サーバーリッスンホスト |
| `NKMC_DATA_DIR` | `~/.nkmc/server` | データディレクトリ（SQLite DB、鍵、設定） |
| `NKMC_ADMIN_TOKEN` | （自動生成） | 認証情報管理用の管理トークン |
| `NKMC_ENCRYPTION_KEY` | （自動生成） | Base64エンコード256ビットAES鍵（Vault用） |
| `NKMC_GATEWAY_PRIVATE_KEY` | （自動生成） | EdDSA秘密鍵（JWK JSON） |
| `NKMC_GATEWAY_PUBLIC_KEY` | （自動生成） | EdDSA公開鍵（JWK JSON） |
| `NKMC_GATEWAY_URL` | `https://nkmc.ai` | ゲートウェイURL（CLIが使用） |
| `NKMC_GATEWAY_NAME` | （なし） | トンネルディスカバリ用の表示名 |

自動生成された値は初回起動時に `0600` パーミッションでデータディレクトリに永続化されます。

## HTTP API

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| `GET` | `/.well-known/jwks.json` | 公開 | ゲートウェイ公開鍵（JWKS） |
| `POST` | `/auth/token` | 公開 | エージェント用JWTを発行 |
| `POST` | `/domains/challenge` | 公開 | DNS TXTチャレンジを要求 |
| `POST` | `/domains/verify` | 公開 | DNSチャレンジを検証 |
| `POST` | `/registry/services` | パブリッシュ/管理者 | サービスを登録（skill.md） |
| `POST` | `/registry/services/discover` | パブリッシュ/管理者 | 自動検出して登録 |
| `GET` | `/credentials` | 管理者 | Vaultドメインを一覧 |
| `PUT` | `/credentials/:domain` | 管理者 | プール認証情報を設定 |
| `DELETE` | `/credentials/:domain` | 管理者 | プール認証情報を削除 |
| `PUT` | `/byok/:domain` | Agent JWT | BYOK認証情報をアップロード |
| `GET` | `/byok` | Agent JWT | BYOKドメインを一覧 |
| `DELETE` | `/byok/:domain` | Agent JWT | BYOK認証情報を削除 |
| `POST` | `/execute` | Agent JWT | ファイルシステムコマンドを実行 |
| `POST` | `/proxy/exec` | Agent JWT | 認証情報を注入してCLIツールを実行 |
| `GET` | `/proxy/tools` | Agent JWT | 利用可能なプロキシツールを一覧 |
| `GET` | `/admin/federation/peers` | 管理者 | ピアゲートウェイを一覧 |
| `PUT` | `/admin/federation/peers/:id` | 管理者 | ピアを追加/更新 |
| `DELETE` | `/admin/federation/peers/:id` | 管理者 | ピアを削除 |
| `GET` | `/admin/federation/rules` | 管理者 | 貸出ルールを一覧 |
| `PUT` | `/admin/federation/rules/:domain` | 管理者 | 貸出ルールを設定 |
| `DELETE` | `/admin/federation/rules/:domain` | 管理者 | 貸出ルールを削除 |
| `POST` | `/federation/query` | ピア | 認証情報の利用可能性を問合せ |
| `POST` | `/federation/exec` | ピア | ピアの代わりにコマンドを実行 |
| `POST` | `/federation/announce` | ピア | 提供可能ドメインをアナウンス |
| `POST` | `/tunnels/create` | Agent JWT | Cloudflare Tunnelを作成 |
| `DELETE` | `/tunnels/:id` | Agent JWT | トンネルを削除 |
| `GET` | `/tunnels` | Agent JWT | エージェントのトンネルを一覧 |
| `GET` | `/tunnels/discover` | Agent JWT | オンラインゲートウェイを検出 |
| `POST` | `/tunnels/heartbeat` | Agent JWT | トンネルのハートビートを更新 |

## 開発

```bash
# クローン
git clone https://github.com/nkmc-ai/gateway.git
cd gateway

# 依存関係をインストール
pnpm install

# 全パッケージをビルド
pnpm build

# テストを実行
pnpm test

# 型チェック
pnpm lint
```

## リンク

- **GitHub**: [nkmc-ai/gateway](https://github.com/nkmc-ai/gateway) | [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)
- **npm**: [@nkmc/gateway](https://www.npmjs.com/package/@nkmc/gateway) | [@nkmc/agent-fs](https://www.npmjs.com/package/@nkmc/agent-fs) | [@nkmc/server](https://www.npmjs.com/package/@nkmc/server) | [@nkmc/cli](https://www.npmjs.com/package/@nkmc/cli) | [@nkmc/core](https://www.npmjs.com/package/@nkmc/core)

## ライセンス

MIT
