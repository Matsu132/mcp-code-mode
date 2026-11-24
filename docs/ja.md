# MCP Code Mode Gateway 日本語ガイド

MCP Code Mode Gateway は、複数のMCPサーバーを3つのツールにまとめます。`search` で必要なツールを探し、`describe` で引数を確認し、`execute` からJavaScriptまたはTypeScriptで呼び出します。

- [起動する](#起動する)
- [MCPサーバーを登録する](#mcpサーバーを登録する)
- [MCPクライアントを接続する](#mcpクライアントを接続する)
- [ツールを実行する](#ツールを実行する)
- [ユーザー権限と上流OAuthを設定する](#ユーザー権限と上流oauthを設定する)
- [トラブルシューティング](#トラブルシューティング)

## 起動する

DockerとComposeを用意し、リポジトリのルートで実行します。既存の `config.json` があれば、その設定を使います。初回は空の接続先リストで起動し、管理画面から接続先を追加できます。

```sh
test -e config.json || printf '[]\n' > config.json
export GATEWAY_TOKEN="$(openssl rand -hex 32)"
docker compose up --build
```

| 用途 | URL |
| --- | --- |
| 管理画面 | `http://127.0.0.1:3001` |
| MCPエンドポイント | `http://127.0.0.1:3000/mcp` |
| ヘルスチェック | `http://127.0.0.1:3000/health` |

管理画面の **Access token** には、起動時に設定した `GATEWAY_TOKEN` を入力します。停止するときは `docker compose down` を使います。接続設定、権限、実行履歴、OAuth資格情報は `state` ボリュームに保存されます。`docker compose down -v` は保存データも削除します。

Dockerを使わない場合は、Node.js 22.13以上を用意します。上の例と同様に `config.json` と `GATEWAY_TOKEN` を用意して、ルートで `npm ci && npm run build && npm start` を実行します。別のターミナルで `cd apps/admin && npm ci && npm run dev` を実行すると管理画面を開けます。

## MCPサーバーを登録する

1. 管理画面の **MCP Servers** を開き、管理者トークンで **保存済み設定を読み込む** を押します。
2. **サーバーを追加** を押し、Server IDに `demo`、MCP endpoint URLに実際のStreamable HTTPエンドポイントを入力します。
3. **接続テスト** を押し、検出したツール名を確認します。**Allowed tool names** に公開する名前をカンマ区切りで入力し、**有効** を選んで **保存** します。
4. Dashboardに戻り、**Load catalog** で許可したツールを確認します。サーバーIDが `demo`、ツール名が `list_items` なら、GatewayでのIDは `demo.list_items` です。

管理画面から追加するURLには、公開IPに解決されるHTTPSエンドポイントを指定します。ローカルやプライベートネットワーク上の信頼済み接続先は、運用者が `config.json` で設定します。上流がBearer認証を求める場合は、Gatewayの `UPSTREAM_CREDENTIALS` にURLと環境変数名を登録し、実際のトークンをその環境変数としてGatewayに渡します。管理画面の **Bearer token environment variable** には環境変数名を入力します。 [設定例](../.env.example)

## MCPクライアントを接続する

### Codex

`~/.codex/config.toml` に次を追加し、Codexを起動する環境にも、Gatewayと同じ `GATEWAY_TOKEN` を設定します。 [Codex MCP公式ガイド](https://developers.openai.com/codex/mcp)

```toml
[mcp_servers.code-mode]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "GATEWAY_TOKEN"
```

### ChatGPT・Claude・その他のクライアント

- **ChatGPT** は、開発者モードを利用できるワークスペースで、到達可能なHTTPSの `/mcp` URLをカスタムMCPアプリに登録します。OAuthを使う場合は、Gatewayと発行元のリソースURLを一致させます。 [ChatGPT公式ガイド](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
- **Claude** は、カスタムコネクタに到達可能なHTTPSの `/mcp` URLを登録し、OAuthまたはアカウントで利用可能な固定認証ヘッダーを設定します。 [Claude公式ガイド](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- **その他のMCPクライアント** では、Streamable HTTPを選び、`Authorization: Bearer <Gatewayのトークン>` を送ります。

ChatGPTとClaudeのクラウド側から接続する場合は、クライアントから到達できるHTTPSエンドポイントを用意します。自動テストはローカルのモックを使用しており、各製品の実アカウント接続は未検証です。

## ツールを実行する

次は、引数なしで呼び出せる `demo.list_items` が登録されている場合の例です。実際のIDと引数は、接続先のツールに合わせます。

| 操作 | Gatewayに渡す入力 |
| --- | --- |
| `search` | `{"query":"list_items"}` |
| `describe` | `{"id":"demo.list_items"}` |
| `execute` | `language` に `typescript`、`code` に下のコード |

```ts
const tool: string = "demo.list_items";
const result = await mcp.call(tool, {});
return result.content;
```

MCPクライアントに依頼する場合は「在庫一覧のツールを検索し、引数スキーマを確認してから、一覧を取得してください」のように伝えます。管理画面の **Tools** でもツールIDをクリックすると、JSON SchemaとTypeScriptの型宣言を確認できます。

## ユーザー権限と上流OAuthを設定する

- **権限管理** では、信頼済み発行元のSubjectにロールを割り当てます。Viewerは閲覧、Operatorは閲覧と実行、Adminは閲覧・実行・管理に対応します。カスタムロールではサーバーとツールの許可範囲を指定できます。
- **OAuth Connections** をユーザーごとに使う場合は、`OAUTH_CONFIG` でGateway側の発行元とリソースURLを設定します。続いて `UPSTREAM_OAUTH_CONFIG` にサーバーID・上流URL・認可発行元を登録し、`UPSTREAM_OAUTH_REDIRECT_URL` に管理画面の `/api/oauth/callback` の完全なURL、`UPSTREAM_OAUTH_KEY` に32バイトをbase64url化した安定したキーを設定します。上流サーバーには共有Bearerトークンを設定せず、ユーザー自身が **OAuth Connections** から **接続** を押します。認可後はGatewayトークンを再入力して接続状態を確認します。 [環境変数の設定例](../.env.example)
- **Execution Logs** では実行結果や権限変更を検索できます。**Benchmarks** ではトークン推定を比較でき、**Settings** では同時実行数、待ち行列、タイムアウトを設定できます。

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| `401` が返る | 起動時に設定したGatewayトークンを使っているか確認します。OAuthの場合は発行元、Subject、トークンのaudienceを確認します。 |
| `403` が返る | ロール・ツール許可範囲を確認します。リバースプロキシ経由なら `ALLOWED_HOST` と、必要に応じて `ALLOWED_ORIGIN` も確認します。 |
| 接続テストは通るがツールが表示されない | 接続先が有効で、検出したツール名が **Allowed tool names** に含まれ、利用者にも許可されているか確認します。 |
| OAuth認可の戻り先で失敗する | 発行元に登録したコールバックURLとGatewayの設定値を照合し、接続を開始したブラウザーからやり直します。 |

コードはQuickJSを使う子プロセスで実行します。Gatewayと子プロセスは同じOSユーザーとコンテナを共有します。 [セキュリティモデル](SECURITY.md)
