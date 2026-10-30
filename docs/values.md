# What mcp-login-oauth stands for

mcp-login-oauth is the OAuth server that MCP clients such as claude.ai connect through, for FastMCP servers whose login is a form checked by the service behind them. This page says what it will stay, whoever uses it and whatever it grows into.

It is for anyone deciding whether to trust their server's sign-in to it, and it is the yardstick for every change: a contribution, from a person or an AI, is judged against these points, and a review names the one it touches ("this breaks V2").

## Lines never crossed

When a feature would be easier, or would sell better, by bending one of these, the feature changes or is not built.

### V1. Nothing usable at rest

What the library stores can't be used by whoever reads the files. Everything is encrypted with a key derived from the server's secret; a form, a token or a person's details never reach a log.

**Rules out:** tokens, codes, links or credentials stored as they are; a store without encryption "for development" in production; logging a form, a token, an email address or a grant.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md)

### V2. Spent is spent, revoked is gone

A code, a refresh token and a login link work once, also across a restart. Revoking a client ends its access at once, not when a token runs out.

**Rules out:** single-use checks kept only in memory; revocation that waits for expiry; one secret shared by every client so that only "everyone" can be revoked.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md)

## What you can rely on

### V3. Standards any client speaks

The OAuth server follows the published standards (OAuth 2.1, RFC 8414, 9728, 7591, 7009, 8707, 9207), so every MCP client that follows them connects without anything made for it.

**Rules out:** our own token formats or endpoints where a standard exists; behaviour tuned to one client that breaks the standard for others.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md)

### V4. Inside your server

The library runs in the server's own process and keeps its data in its own store next to the server's data. It needs no other service and calls nothing but the service the server checks logins against. Losing the store only makes clients sign in again.

**Rules out:** a hosted sign-in service; telemetry; the store inside the server's own data.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md)

## Principles that follow

### V5. The server checks the login; the library does the rest

The server supplies the login form and the check that turns it into a grant. Everything that would be the same in every server (the OAuth server, the login and dead-end pages, the store, the protection against guessing) belongs in the library. The library reads no environment: the server passes values in.

**Rules out:** server-specific code paths in the library; reading `os.environ` in the library; a server copying OAuth code the library could own; user accounts or sessions in the library.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md), [0002](adr/0002-check-login-learns-the-client.md)

## Changing this page

Points keep their numbers, so that reviews and issues citing them stay right. A change needs the maintainer's approval and says why in its pull request. Weakening a line never crossed is a change to what the library is.
