# MCP Code Mode Gateway (experimental)
Vendor-neutral MCP gateway exposing search, describe and execute instead of every upstream tool. TypeScript input is transpiled (syntax checking, not semantic type checking), then evaluated in QuickJS WASM. Tool results remain MCP envelopes.

## Run
Node 22+, npm install, npm run build. Copy config.example.json to config.json. Configure trusted upstream URLs, token environment variable names and explicit allowed tools. Set GATEWAY_TOKEN to a random string of at least 32 characters and run npm start. Connect to http://127.0.0.1:3000/mcp with Authorization: Bearer <token>. Default Host is 127.0.0.1:3000; set ALLOWED_HOST explicitly for reverse proxies, and ALLOWED_ORIGIN if needed. Bind only to localhost unless using a trusted TLS proxy.

## OAuth resource server
Alternatively set OAUTH_CONFIG to JSON with issuer, jwks, resource (exact HTTPS MCP URL), and users array of {sub,allow:["demo.list_items"]}. Use an external OAuth authorization server that supports MCP resource audiences and PKCE. JWT verification supports RS256 and ES256, validates issuer, audience, expiry and subject, and exposes protected resource metadata. Unknown subjects are denied. Never pass incoming tokens upstream. OAuth client registration and upstream OAuth delegation are not implemented.

## Example
Search for list_items, describe demo.list_items, then execute with language typescript:
```ts
const id: string = "demo.list_items";
const result = await mcp.call(id, {});
return result.content;
```
Describe generates conservative declarations from input JSON Schema; unsupported constructs map to unknown. The catalog refreshes every minute and clears on refresh failure. Calls are explicitly authorized per subject. Limits: 20 calls per execution, 15-second target deadline, 32 MiB QuickJS heap, 4 concurrent HTTP requests. No transactional semantics.

## Docker
Build with docker build -t mcp-code-mode . and run with an env file and read-only config mount. Publish only on localhost (127.0.0.1:3000:3000). Set memory/CPU limits, read-only root filesystem and no-new-privileges. Never mount Docker socket or credentials into the sandbox.

## Tests
npm test; npm run lint; npm run typecheck; npm audit --audit-level=high. npm run benchmark measures serialized JSON tokens using cl100k_base and o200k_base; optional JSON catalog file can be passed as an argument.

## 日本語
複数MCPを3ツールに集約する実験版です。TypeScript入力、検索、スキーマ型生成、定期カタログ更新、外部OAuth発行元のJWT検証とユーザー別許可リストに対応します。ChatGPT等との実機接続は未検証です。ロックファイル、上流OAuth委譲と独立した安全性検証は今後の課題です。公開運用前に docs/SECURITY.md を確認してください。

## References
- https://modelcontextprotocol.io/specification/
- https://ts.sdk.modelcontextprotocol.io/server
- https://github.com/panva/jose
- https://github.com/justjake/quickjs-emscripten
- https://www.anthropic.com/engineering/code-execution-with-mcp

## Catalog UI
Open `/admin` and enter a valid access token to inspect the authorized catalog. The token is not persisted. This is a read-only catalog viewer, not a configuration editor. Synthetic benchmark excludes protocol overhead.

## Next.js administration UI
The separate app in `apps/admin` uses Next.js App Router, TypeScript, MUI Core and Emotion (free OSS components). Start the gateway first, then run `cd apps/admin && npm install && npm run dev`. Open http://127.0.0.1:3001. Set GATEWAY_URL on the UI server if needed; the gateway Host allowlist must match that URL. The same-origin server route proxies the access token only to the configured gateway and does not store it. Dashboard counts are limited to the visible catalog (up to 30 tools). Dark mode and responsive navigation are supported. This is a read-only admin frontend; configuration editing, role administration, upstream OAuth delegation and persistent audit dashboards are not yet implemented. Build the UI container with `docker build -t mcp-code-mode-admin apps/admin`; configure a private network and GATEWAY_URL, and publish only to localhost or a trusted TLS proxy.
