# mcp-login-oauth

OAuth 2.1 browser login for [FastMCP](https://gofastmcp.com) servers that sit in front of another
service. Clients that can't send a token header, such as claude.ai, the Claude desktop and mobile apps,
log in once with a form. The form is checked by the service behind the server, for example a Trilium
password, an InvoiceNinja email, password and 2FA code, or a Paperless username and password. The
client then only holds opaque OAuth tokens. Your server turns each login into a *grant*, such as a
service token minted at login, and reads it back in tool code.

The library provides:
- dynamic client registration, PKCE, refresh rotation and revocation, including revocation for public
  clients, which the MCP SDK's own `/revoke` rejects;
- a Fernet-encrypted file store that survives restarts;
- the login page with configurable fields, hints and collapsed sections for alternative logins, and
  honest dead-end pages for broken flows;
- tokens bound to this server (RFC 8707 resource indicators) and the issuer named on the code redirect
  (RFC 9207);
- protection against password guessing: a delay after each failed login, and login links that end after
  5 failures or 10 minutes;
- optional static header tokens next to OAuth.

What this library [stands for](https://mcp-login-oauth.marceltov.de/values/) and [where it is going](https://mcp-login-oauth.marceltov.de/roadmap/) are on the [documentation site](https://mcp-login-oauth.marceltov.de/).

**TypeScript?** This library is Python only; TypeScript apps sign in with Better Auth, see
[Coming from TypeScript](https://mcp-login-oauth.marceltov.de/typescript/).

Used by [trilium-mcp](https://github.com/Marceltov/trilium-mcp),
[invoiceninja-mcp](https://github.com/Marceltov/invoiceninja-mcp),
[paperless-ngx-mcp](https://github.com/Marceltov/paperless-ngx-mcp) and the recall engine in
[trilium-llm-wiki](https://github.com/Marceltov/trilium-llm-wiki).

## Install

From PyPI:

```bash
uv add mcp-login-oauth
```

Needs Python ≥ 3.12 and FastMCP ≥ 4.1.3.

**Documentation:** [mcp-login-oauth.marceltov.de](https://mcp-login-oauth.marceltov.de/): [getting started](https://mcp-login-oauth.marceltov.de/getting-started/), the [reference](https://mcp-login-oauth.marceltov.de/reference/), [behaviour](https://mcp-login-oauth.marceltov.de/behaviour/), [development](https://mcp-login-oauth.marceltov.de/development/) and the design decisions.

## License

Copyright © 2026 Marcel Bruckner.

Licensed under the [GNU Affero General Public License v3.0 or later](https://github.com/Marceltov/mcp-login-oauth/blob/main/LICENSE) (AGPL-3.0-or-later). You may use, modify, and redistribute it, but any modified version — **including one you run as a network service** — must be released under the same license with its source made available to its users, and the original copyright notice preserved. See [LICENSE](https://github.com/Marceltov/mcp-login-oauth/blob/main/LICENSE) for the full terms.
