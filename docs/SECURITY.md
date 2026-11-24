# Gateway security model

Treat the Gateway as experimental. Review upstream providers, their tool
schemas, tool output and write permissions before deploying. The external
identity provider must issue JWT access tokens with the exact Gateway
resource audience. Gateway credentials authenticate only to the Gateway.
Each delegated upstream receives the grant issued for its own resource and
the authenticated subject. Shared service credentials are also supported
for explicitly bound endpoints.

The administrator-controlled bootstrap configuration can trust private
endpoints. Endpoints added in the UI require HTTPS and public network
addresses, validated at connection time. Redirects and HTTP origin changes
are blocked. Configure OS or container egress restrictions for the Gateway,
including bootstrap destinations and the external identity provider.
Tool output is untrusted model input.

Untrusted JavaScript and transpiled TypeScript run in QuickJS WASM inside a
per-execution worker with an empty environment, a Node permission policy,
bounded IPC and a parent deadline. The worker shares the Gateway container
and OS identity. The app-level boundary provides no independent OS network
namespace. Use a restricted host or executor sandbox with independent
resource and network limits when deploying beyond trusted operators.
Cancellation may follow an upstream side effect.

SQLite stores audit events and encrypted OAuth credentials. Store the
encryption key separately, restrict the directory to the Gateway user and
rotate host logs according to the applicable retention period. Subject and
tool IDs can appear in audit events. Do not log authorization codes, tokens,
execution arguments, tool output or user code.

The tests cover local MCP and OAuth fixtures. Independent security review
and interoperability tests with each intended remote service remain
required before relying on the Gateway in production.
