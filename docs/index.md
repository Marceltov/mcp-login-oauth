# mcp-login-oauth

The OAuth 2.1 server that MCP clients such as claude.ai, the Claude desktop and mobile apps connect through, for MCP servers whose login is a **form checked by the service behind them** (a Trilium password, an InvoiceNinja or Paperless login) or a **sign-in at one OpenID Connect provider**. The client signs in once in the browser and then only holds opaque OAuth tokens; your server turns each login into a *grant* and reads it back on every request.

It comes as two packages with the same behaviour:

- **[Python package](python.md)** for [FastMCP](https://gofastmcp.com) servers.
- **[TypeScript package](typescript.md)** for MCP servers on Node.js, framework-neutral (web `Request` in, `Response` out).

Both provide dynamic client registration, PKCE, rotating refresh tokens, revocation also for public clients, tokens bound to a resource (RFC 8707), the issuer on the code redirect (RFC 9207), an encrypted store that survives restarts, the login page and protection against password guessing.

!!! tip "Building a TypeScript app with a web UI and its own users?"
    Use [Better Auth](https://better-auth.com) instead. It has user accounts, sessions, magic links, passkeys, several sign-in providers and an OAuth server for MCP clients (`@better-auth/mcp`), which this library deliberately doesn't ([ADR 0004](adr/0004-web-apps-sign-in-with-better-auth.md), [V7](values.md#v7-a-login-library-not-an-account-system)).

## Used by

[trilium-mcp](https://github.com/Marceltov/trilium-mcp), [invoiceninja-mcp](https://github.com/Marceltov/invoiceninja-mcp), [paperless-ngx-mcp](https://github.com/Marceltov/paperless-ngx-mcp) and the recall engine in [trilium-llm-wiki](https://github.com/Marceltov/trilium-llm-wiki).

## License

Copyright © 2026 Marcel Bruckner. Licensed under the [GNU Affero General Public License v3.0 or later](https://github.com/Marceltov/mcp-login-oauth/blob/main/LICENSE).
