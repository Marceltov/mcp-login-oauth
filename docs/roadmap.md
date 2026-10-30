# Where mcp-login-oauth is going

mcp-login-oauth started as one library for the login OAuth of Marcel's FastMCP servers, replacing four drifting copies, and gained a TypeScript sibling with the same behaviour. It stays the OAuth server for MCP servers whose login is a form checked by a service; apps with a web UI and their own users sign in with Better Auth instead.

This page says what is planned and why, inside the [values](values.md). Each item links to its issue and the value it serves. There are no dates. An item leaves the page when it ships (the release notes have it) or is dropped (the reason is in its issue).

## The idea behind all of it

One small, strict OAuth server for MCP clients, the same in Python and TypeScript, that holds nothing usable at rest and leaves accounts and sign-in methods to the app.

## Now

- **First TypeScript release** ([#5](https://github.com/Marceltov/mcp-login-oauth/issues/5)): tag `ts-v0.1.0` so that TypeScript servers can install the package from its release tarball. Serves [V3](values.md#v3-the-same-in-python-and-typescript).

## Next

- **Client ID Metadata Documents** ([#6](https://github.com/Marceltov/mcp-login-oauth/issues/6)): accept clients that identify themselves by a metadata URL, which the MCP spec now prefers over dynamic registration, in both packages. Serves [V4](values.md#v4-standards-any-client-speaks).

## Later

- **Shared test cases** ([#7](https://github.com/Marceltov/mcp-login-oauth/issues/7)): one language-neutral set of flows run against both packages, so that they can't drift apart unnoticed. Serves [V3](values.md#v3-the-same-in-python-and-typescript).

## Parked

Nothing yet.

## Decided against

- **A complete sign-in for apps with a web UI** ([ADR 0004](adr/0004-web-apps-sign-in-with-better-auth.md)): magic links, passkeys, several sign-in providers, browser sessions and user accounts, in both packages. Better Auth already does this well for TypeScript, where every UI lives, and Python backends only need to check its tokens. We recommend Better Auth for TypeScript apps instead of rebuilding it. See [V7](values.md#v7-a-login-library-not-an-account-system).
