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

What this library stands for is in [docs/values.md](docs/values.md), where it is going in
[docs/roadmap.md](docs/roadmap.md), both also on the [documentation site](https://marceltov.github.io/mcp-login-oauth/).

**TypeScript?** This library is Python only; TypeScript apps sign in with Better Auth, see
[TypeScript: use Better Auth](https://marceltov.github.io/mcp-login-oauth/typescript/).

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

**Documentation:** [marceltov.github.io/mcp-login-oauth](https://marceltov.github.io/mcp-login-oauth/): [getting started](https://marceltov.github.io/mcp-login-oauth/getting-started/), the [reference](https://marceltov.github.io/mcp-login-oauth/reference/), [behaviour](https://marceltov.github.io/mcp-login-oauth/behaviour/), [development](https://marceltov.github.io/mcp-login-oauth/development/) and the design decisions.

## License

Copyright © 2026 Marcel Bruckner.

Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). You may use, modify, and redistribute it, but any modified version — **including one you run as a network service** — must be released under the same license with its source made available to its users, and the original copyright notice preserved. See [LICENSE](LICENSE) for the full terms.
