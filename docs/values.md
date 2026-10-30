# What mcp-login-oauth stands for

mcp-login-oauth is the OAuth server that MCP clients such as claude.ai connect through, for MCP servers whose login is a form checked by a service or a sign-in at one OIDC provider, in a Python and a TypeScript package. Apps with a web UI sign in with Better Auth instead (ADR 0004). This page says what it will stay, whoever uses it and whatever it grows into.

It is for anyone deciding whether to trust their app's sign-in to it, and it is the yardstick for every change: a contribution, from a person or an AI, is judged against these points, and a review names the one it touches ("this breaks V3").

## Lines never crossed

When a feature would be easier, or would sell better, by bending one of these, the feature changes or is not built.

### V1. Nothing usable at rest

What the library stores can't be used by whoever reads the file. Keys are HMACs and values are encrypted with a key derived from the app's secret; a form, a token or a person's details never reach a log.

**Rules out:** tokens, codes, links or credentials stored as they are; a store without encryption "for development" in production; logging a form, a token, an email address or a grant.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md), [0003](adr/0003-typescript-package.md)

### V2. Spent is spent, revoked is gone

A code, a refresh token and a sign-in link work once, also across a restart. A sign-in completes only in the browser that started it. Revoking a client or a person ends their access at once, not when a token runs out.

**Rules out:** single-use checks kept only in memory; a login link that signs in any browser; revocation that waits for expiry; one secret shared by every client so that only "everyone" can be revoked.

**ADRs:** [0003](adr/0003-typescript-package.md)

## What you can rely on

### V3. The same in Python and TypeScript

Both packages have the same features and the same behaviour: methods, lifetimes, refusals, pages and storage. A feature ships in both, in releases that go out together, and the same test cases check both.

**Rules out:** a feature only one package has; a release of a feature in one language while the other waits; defaults that differ between the packages; taking a library that exists for one language only when it would make the two behave differently.

**ADRs:** [0003](adr/0003-typescript-package.md), [0004](adr/0004-web-apps-sign-in-with-better-auth.md)

### V4. Standards any client speaks

The OAuth server follows the published standards (OAuth 2.1, RFC 8414, 9728, 7591, 7009, 8707, 9207), so every MCP client that follows them connects without anything made for it.

**Rules out:** our own token formats or endpoints where a standard exists; behaviour tuned to one client that breaks the standard for others.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md), [0003](adr/0003-typescript-package.md)

### V5. Inside your app, on your server

The library runs in the app's own process and keeps its data in its own SQLite file next to the app's database. It needs no other service and calls nothing but the providers and the mail server the app configured. Losing that file only makes clients sign in again.

**Rules out:** a hosted sign-in service; telemetry; tables in the app's database.

**ADRs:** [0003](adr/0003-typescript-package.md)

## Principles that follow

### V6. The app says who may sign in; the library does the rest

The app supplies who may sign in and what a sign-in grants. Everything that would be the same in every server (the OAuth server, the login and dead-end pages, the store) belongs in the library. The library reads no environment and depends on no web framework: the app passes values in and mounts handlers that take a `Request` and return a `Response`.

**Rules out:** app-specific code paths in the library; reading `process.env` or `os.environ` in the library; a dependency on Next.js, Starlette or any other framework; an app copying sign-in code the library could own.

**ADRs:** [0001](adr/0001-shared-login-oauth-library.md), [0002](adr/0002-check-login-learns-the-client.md), [0003](adr/0003-typescript-package.md), [0004](adr/0004-web-apps-sign-in-with-better-auth.md)

### V7. A login library, not an account system

This library signs MCP clients in to servers whose login is a form checked by a service, or a sign-in at one OIDC provider. It holds no user accounts and doesn't compete with full sign-in systems: an app with a web UI and its own users signs in with [Better Auth](https://better-auth.com), which does that well for TypeScript, and the README says so.

**Rules out:** user accounts, browser sessions, magic links, passkeys or lists of sign-in providers in this library; rebuilding for TypeScript apps what Better Auth already offers; a TypeScript app with a web UI choosing this library over Better Auth.

**ADRs:** [0004](adr/0004-web-apps-sign-in-with-better-auth.md)

## Changing this page

Points keep their numbers, so that reviews and issues citing them stay right. A change needs the maintainer's approval and says why in its pull request. Weakening a line never crossed is a change to what the library is.
