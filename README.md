# MCP Code Mode Gateway (experimental)
A vendor-neutral TypeScript gateway exposing search, describe and execute instead of all upstream tools. QuickJS/WASM executes JavaScript without Node globals; the broker enforces explicit per-server tool allowlists and JSON Schema validation.

## Setup
Node 22+, npm install, npm run build. Copy config.example.json to config.json and configure trusted upstream URLs and explicit tool names. Set GATEWAY_TOKEN (at least 32 random characters) and upstream token environment variables. Run npm start. Connect a Streamable HTTP client to http://127.0.0.1:3000/mcp with Authorization: Bearer <token>. Use a trusted TLS reverse proxy for remote access. Do not expose this experimental service publicly without independent security review.

## Example
Search for list_items, describe demo.list_items, then execute:
```js
const result = await mcp.call("demo.list_items", {});
return result.content;
```
The broker returns the MCP result envelope. JavaScript only, not TypeScript syntax. Explicit allowlists may include mutating tools; calls are not transactional and cancellation does not undo side effects.

## Limits
Single trusted operator, static bearer credentials, stateless HTTP POST, startup discovery, 20 calls per execution, 15-second target deadline, 32 MiB QuickJS heap. No OAuth, per-user authorization, or production security guarantee. Upstream cancellation is best effort. No token savings claim until measured. No lockfile yet. Do not use untrusted upstream servers.

## 日本語
複数のMCPを3ツールに集約する実験版です。設定ファイルで接続先と許可ツールを指定し、環境変数で認証情報を設定してください。初期状態はローカルのみで待ち受けます。公開運用前に独立したセキュリティ検証が必要です。

## References
- https://modelcontextprotocol.io/specification/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/justjake/quickjs-emscripten
- https://www.anthropic.com/engineering/code-execution-with-mcp
