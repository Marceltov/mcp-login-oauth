# @marceltov/mcp-login-oauth (TypeScript)

OAuth 2.1 authorization server for MCP servers that clients such as claude.ai, the Claude desktop and mobile apps connect to. The client logs in once in the browser and then only holds opaque OAuth tokens. The login is either a **form** your app checks (a password, a service login) or a **sign-in at an OpenID Connect provider** such as authentik. Your app turns each login into a *grant*, for example the user's id, and reads it back on every MCP request.

**For a TypeScript app with a web UI and its own users, use [Better Auth](https://better-auth.com) instead** ([ADR 0004](../docs/adr/0004-web-apps-sign-in-with-better-auth.md)): this package is for MCP servers whose login is a form checked by a service, or a sign-in at one OIDC provider.

The sibling of the Python package in the root of this repository, with the same behaviour ([ADR 0003](../docs/adr/0003-typescript-package.md)). Framework-neutral: it takes a web `Request` and returns a `Response`, so it mounts in Next.js route handlers or any server that speaks the Fetch API.

The package provides:
- discovery (RFC 8414, RFC 9728), dynamic client registration (RFC 7591), PKCE `S256`, rotating refresh tokens, and revocation (RFC 7009) for public clients too;
- an SQLite store in its own file, encrypted, that survives restarts: a code or refresh token is spent once, even across a restart, and one client can be revoked without signing out the others;
- tokens bound to a resource (RFC 8707), each resource its own audience, and the issuer on the code redirect (RFC 9207);
- the login page and honest dead-end pages for broken flows;
- protection against password guessing: a delay after each failed login, and login links that end after 5 failures or 10 minutes;
- an OIDC sign-in bound to the browser that started it;
- `revokeSubject(id)` to end every grant of a person, and optional static header tokens.

## Install

npm can't install from a folder of a git repository, so each release carries the packed package. Pin the tarball of a `ts-v*` release:

```bash
npm install https://github.com/Marceltov/mcp-login-oauth/releases/download/ts-v0.1.0/marceltov-mcp-login-oauth-0.1.0.tgz
```

Needs Node.js ≥ 22. The default store uses `better-sqlite3`.

**Documentation:** [marceltov.github.io/mcp-login-oauth/typescript](https://marceltov.github.io/mcp-login-oauth/typescript/), with examples for an OIDC sign-in in Next.js and a form checked by a service, the API, options and defaults.

## License

AGPL-3.0-or-later, like the Python package. See [LICENSE](../LICENSE).
