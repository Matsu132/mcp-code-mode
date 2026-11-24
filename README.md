# MCP Code Mode Gateway (experimental)
Vendor-neutral MCP gateway exposing search, describe and execute instead of every upstream tool. TypeScript input is transpiled (syntax checking, not semantic type checking), then evaluated in QuickJS WASM. Tool results remain MCP envelopes.

## Run
Node 22.13+, npm ci, npm run build. Copy config.example.json to config.json. Configure trusted upstream URLs, token environment variable names and explicit allowed tools. Set GATEWAY_TOKEN to a random string of at least 32 characters and run npm start. Connect to http://127.0.0.1:3000/mcp with Authorization: Bearer <token>. Default Host is 127.0.0.1:3000; set ALLOWED_HOST explicitly for reverse proxies, and ALLOWED_ORIGIN if needed. Bind only to localhost unless using a trusted TLS proxy.

## Docker Compose

Install Docker Engine with the Compose plugin. From the repository root, copy
`config.example.json` to `config.json` and edit it with trusted upstream URLs and
explicit tool allowlists. To start without an upstream, use an empty JSON array.
Export a randomly generated `GATEWAY_TOKEN` of at least 32 characters and run
`docker compose up --build`. If an upstream uses a service token, inject its
named environment variable into the Gateway service using a private Compose override.

Connect MCP clients to `http://127.0.0.1:3000/mcp` and open the admin UI at
`http://127.0.0.1:3001`. Both ports are published on loopback. The containers
share a network namespace so the admin proxy can use the same Host allowlist
as the local MCP client. The Gateway persists policies and audit entries in
the `state` volume. Use Docker Engine on Linux for this configuration.

## OAuth resource server
Alternatively set OAUTH_CONFIG to JSON with issuer, jwks, resource (exact HTTPS MCP URL), and users array of {sub,allow:["demo.list_items"]}. Use an external OAuth authorization server that supports MCP resource audiences and PKCE. JWT verification supports RS256 and ES256, validates issuer, audience, expiry and subject, and exposes protected resource metadata. Unknown subjects are denied. Never pass incoming tokens upstream. OAuth client registration and upstream OAuth delegation are not implemented.

## Example
Search for list_items, describe demo.list_items, then execute with language typescript:
```ts
const id: string = "demo.list_items";
const result = await mcp.call(id, {});
return result.content;
```
Describe generates conservative declarations from input JSON Schema; unsupported constructs map to unknown. The catalog refreshes every minute. A failed upstream is removed from the exposed catalog until it reconnects. Calls are explicitly authorized per subject. Limits: 20 calls per execution, 15-second target deadline, 32 MiB QuickJS heap, 4 concurrent executions (default) and 32 concurrent HTTP requests. No transactional semantics.

## Docker
Build with docker build -t mcp-code-mode . and run with an env file and read-only config mount. Publish only on localhost (127.0.0.1:3000:3000). Set memory/CPU limits, read-only root filesystem and no-new-privileges. Never mount Docker socket or credentials into the sandbox.

## Tests
npm test; npm run lint; npm run typecheck; npm audit --audit-level=high. npm run benchmark measures serialized JSON tokens using cl100k_base and o200k_base; pass a local JSON array of tool definitions with `npm run benchmark -- path/to/catalog.json`. The comparison covers multiple catalog sizes and itemizes search, describe and execute overhead for an illustrative call. It excludes execution results, generated declarations, prompts and protocol framing.

## 日本語
複数MCPを3ツールに集約する実験版です。TypeScript入力、検索、スキーマ型生成、定期カタログ更新、外部OAuth発行元のJWT検証とユーザー別許可リストに対応します。ChatGPT等との実機接続は未検証です。両アプリは `npm ci` でインストールできます。Docker Compose を使う場合は、接続設定を `config.json` として保存し、32文字以上のランダムな `GATEWAY_TOKEN` を環境変数に設定して `docker compose up --build` を実行します。管理画面は http://127.0.0.1:3001 です。上流OAuth委譲と独立した安全性検証は今後の課題です。公開運用前に docs/SECURITY.md を確認してください。

## References
- https://modelcontextprotocol.io/specification/
- https://ts.sdk.modelcontextprotocol.io/server
- https://github.com/panva/jose
- https://github.com/justjake/quickjs-emscripten
- https://www.anthropic.com/engineering/code-execution-with-mcp

## Catalog UI
Open `/admin` and enter a valid access token to inspect the authorized catalog. The token is not persisted. This is a read-only catalog viewer, not a configuration editor. Synthetic benchmark excludes protocol overhead.

## Next.js administration UI
The separate app in `apps/admin` uses Next.js App Router, TypeScript, MUI Core and Emotion (free OSS components). Start the gateway first, then run `cd apps/admin && npm ci && npm run dev`. Open http://127.0.0.1:3001. Set GATEWAY_URL on the UI server if needed; the gateway Host allowlist must match that URL. The same-origin server route proxies the access token only to the configured gateway and does not store it. Dashboard counts are limited to the visible catalog (up to 30 tools). Dark mode and responsive navigation are supported. The /manage page edits additional subject restrictions and displays recent audit events. Administrators can create custom roles, assign roles to external OAuth subjects, disable assigned users and filter the recent audit list. The /servers page manages upstream URLs, credential bindings, connection status and tool allowlists. Upstream OAuth delegation is pending. Build the UI container with `docker build -t mcp-code-mode-admin apps/admin`; configure a private network and GATEWAY_URL, and publish only to localhost or a trusted TLS proxy.

## Administrative policy and isolated execution
Set ADMIN_SUBJECTS to a comma-separated list of trusted OAuth subject IDs (static operator is also admin). /manage provides an additional deny-by-default-for-listed-subjects policy editor and the latest 1000 retained audit events. Policies persist atomically in STATE_PATH (default state.json); mount a private writable directory. The Gateway image defaults to /data/state.json, so mount /data as a persistent volume. Tool outcomes and policy changes are persisted in a local SQLite file at AUDIT_PATH (default STATE_PATH plus .audit.sqlite). AUDIT_RETENTION_DAYS defaults to 30. Audit events omit tool arguments, responses and credentials. Protect both files and their parent directory with OS permissions. Upstream redirects are disallowed. Existing OAuth allowlists remain the upper bound. QuickJS now runs in a separate Node child with empty environment and Node permission restrictions, a hard parent deadline and bounded IPC. This is not OS-level network isolation; use a restricted container. Upstream OAuth delegation is not yet supported.

### Roles

Gateway authentication and the external OAuth subject allowlist remain required.
The built-in Viewer role reads the catalog. Operator also executes tools.
Admin also manages policy. Custom roles select read, execute and manage
capabilities, with server and tool allowlists intersected with the existing
subject restrictions. A role with manage capability can edit all Gateway
policies, so grant it only to administrators. Bootstrap administrators from
`ADMIN_SUBJECTS` and the static administrator token retain management access
for recovery. Their upstream tool allowlists still apply. Subjects with
no assignment retain their previous permissions. Removing an assignment
restores those permissions. Disable the assignment to suspend an existing
OAuth subject at the Gateway.

### Execution limits

`EXECUTION_CONCURRENCY` defaults to 4, `EXECUTION_QUEUE_SIZE` to 8, and
`EXECUTION_QUEUE_WAIT_MS` to 5000. A full queue or expired queue wait
returns an MCP tool error. Closing the HTTP connection or cancelling the
MCP request stops queued execution or terminates the worker process and
aborts pending upstream calls. Upstream side effects may already have
occurred when cancellation is received.

### Managing upstream servers

`CONFIG_PATH` is the operator-managed bootstrap file. It also defines
endpoints trusted to use private addresses or loopback HTTP. The admin
API persists the active configuration in `UPSTREAMS_PATH` (default
`STATE_PATH` plus `.servers.json`). Restart loads the saved configuration
while still reading trust and credential bindings from the bootstrap file.

URLs added in the admin UI require HTTPS and public address resolution.
The Gateway rejects redirects and restricts its HTTP client to the approved
origin. Avoid secrets in URLs. For a new Bearer credential, set
`UPSTREAM_CREDENTIALS` in the Gateway environment to a JSON array of
`{"url":"https://example.com/mcp","tokenEnv":"EXAMPLE_MCP_TOKEN"}`
bindings and inject the named token separately. Each token is bound to the
exact endpoint. Only the environment variable name is returned to administrators.
The admin form supports uncredentialed connections by leaving that field blank.
Use the network firewall to restrict egress for operator-trusted endpoints.
