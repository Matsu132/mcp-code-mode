# MCP Code Mode Gateway の導入

Gateway は複数のMCPサーバーを `search`、`describe`、`execute` に集約します。
接続先を検索し、使うツールの入力スキーマを確認してから、JavaScript または
TypeScript で実行できます。外部デプロイや有料ライブラリは起動に不要です。

## ローカルで試す

1. Docker と Compose を用意します。
2. リポジトリのルートで `config.example.json` を `config.json` にコピーし、
   URL・ID・許可するツール名を編集します。接続先がない状態で起動するなら
   `config.json` の中身を `[]` にします。
3. `GATEWAY_TOKEN` に32文字以上のランダムな値を環境変数として設定します。
4. `docker compose up --build` を実行します。
5. 管理画面は `http://127.0.0.1:3001`、MCP は
   `http://127.0.0.1:3000/mcp` です。MCPクライアントでは
   `Authorization: Bearer <Gatewayのトークン>` を指定します。

Docker を使わない場合は Node.js 22.13 以上で、ルートで
`npm ci && npm run build && npm start` を実行します。
別ターミナルで `cd apps/admin && npm ci && npm run dev` を実行します。

## 管理画面

- **MCP Servers** で接続先を登録し、接続テストとツールの再取得を行います。
  ツールを公開するには許可する名前を入力します。Bearer認証の環境変数名は、
  Gatewayの設定で対象エンドポイントに紐付けます。
- **管理** でユーザーとロールを割り当てます。Viewer は閲覧、Operator は閲覧と
  実行、Admin は閲覧・実行・管理が可能です。
- **OAuth Connections** で自分の上流認証を接続・解除します。利用するには
  Gatewayの発行元設定、上流MCPと認可発行元の紐付け、コールバックURL、
  保存用の暗号化キーが必要です。設定例は英語 README の
  **Connecting users to upstream OAuth** を参照してください。
- **Execution Logs** で保存済みの実行履歴を検索します。
- **Benchmarks** と **Settings** でトークン推定値や実行制限を確認できます。

ChatGPT、Codex、Claude の設定は英語 README の **MCP client setup** にあります。
接続・OAuth・ユーザー分離の自動テストはローカルのモックを使っています。
実サービスへの接続は検証対象外です。

## 実行例

`search` で `list_items` を検索し、`describe` で
`demo.list_items` のスキーマを確認してから、`execute` に次を渡します。

```ts
const tool: string = "demo.list_items";
const result = await mcp.call(tool, {});
return result.content;
```

コードはQuickJSを使う子プロセスで実行します。Gatewayと子プロセスは
同じOSユーザーおよびコンテナを共有します。本番利用を検討する場合は
[セキュリティモデル](SECURITY.md) を確認してください。
