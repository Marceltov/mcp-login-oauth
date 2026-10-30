---
status: proposed
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# Apps with a web UI sign in with Better Auth; this library stays the form-login OAuth server

## Context and Problem Statement

Both packages sign in MCP clients only. The Python package has one login kind, a form; the TypeScript package (ADR 0003) has a form or one OIDC provider. Marcel's apps need more:

* **Magic links**, which Marcel uses regularly, and **passkeys**.
* **Several OIDC providers** at once (authentik, Authelia, Google, Apple, …), not one.
* **The web pages' own sign-in**, so an app doesn't carry a second sign-in next to the library.
* **Scripts** that call an app's API with a token, next to the web UI and MCP clients.
* **A Python backend later**, behind the TypeScript UI, for features only Python has. Every UI is TypeScript and React; none will be Python.

Does this library grow into all of that, in both languages, or does an existing library take it over?

## Decision Drivers

* Sign-in is security code: less of our own is better, as long as what we take is held to the same lines ([values](../values.md) V1, V2).
* The frontend and a Python backend must be deployable and scalable apart, behind a load balancer, without sharing state.
* The data stays on the app's server: no hosted sign-in, no telemetry (V5).
* The same person through a magic link and Google is one account, joined only on a proven email.
* The existing Python servers (trilium-mcp, invoiceninja-mcp, paperless-ngx-mcp, the recall engine) sign in with a form checked by a service, and their grant carries that service's credentials.

## Considered Options

* **Grow this library in both packages:** magic links, passkeys, several providers, the browser session, written twice. Everything under our own rules, but the most security code of our own, and four features in Python that no Python server needs: the sign-in always lives in a TypeScript app.
* **[Better Auth](https://better-auth.com) in every app with a web UI; this library unchanged for form-login servers.** (chosen)
* **An external identity provider** (authentik) as the OAuth server for MCP clients. Rejected in freundebuch's ADR 0003 and questlog's ADR 0003: a client registered there per connection, tokens without the app's user id.

## Decision Outcome

Chosen: **Better Auth signs in every app that has a web UI.** This library keeps doing what Better Auth can't: the OAuth server for MCP servers whose login is a form checked by a service, whose grant carries that service's credentials.

### Where the sign-in lives

The Next.js app runs Better Auth. Users, sessions, linked accounts and passkeys are in Better Auth's tables in the app's own database: an SQLite file in `DATA_DIR` for one instance, a Postgres shared by all instances when the app is scaled. It is an open-source library (MIT) in the app's process; its telemetry is off unless the app turns it on, and stays off (V5).

Better Auth has no pages of its own: the app builds the sign-in and consent pages in React against its client.

### Three kinds of clients

```
browser ──cookie──▶ Next.js + Better Auth ──Bearer JWT──▶ Python backend (optional)
claude.ai ──OAuth──▶ Next.js (mcp plugin) … then Bearer token ──▶ the MCP endpoint
script ──device sign-in──▶ Next.js … then Bearer JWT ──▶ the API
```

* **The web UI** uses a backend-for-frontend: the browser holds only Better Auth's `HttpOnly` session cookie and talks only to Next.js. With a Python backend, a Next.js route forwards the request with a short-lived JWT for the signed-in user (the `jwt` plugin, 15 minutes by default). No token reaches the browser, and there is no CORS.
* **MCP clients** sign in through OAuth at Next.js: the `@better-auth/mcp` plugin on `@better-auth/oauth-provider`. Their tokens are bound to the MCP resource (RFC 8707), refresh tokens rotate, tokens can be revoked and introspected, and Client ID Metadata Documents come with `@better-auth/cimd`. Dynamic client registration stays off unless the app turns it on. The MCP endpoint can live in Next.js or in Python.
* **Scripts** sign in once through the device flow (RFC 8628, the `device-authorization` plugin): the script shows a code, the person confirms it in a browser. The script swaps its session for a short-lived JWT and calls the API with it.

### What a backend checks

A Python backend never signs anyone in. It checks each request's JWT against the app's public keys (`/api/auth/jwks`, cached): signature, issuer, audience, expiry. It takes the user id from the token and refuses any request without a valid one, also from inside the network. FastMCP's `JWTVerifier` does this for an MCP endpoint. Each kind of client gets its own audience, so a script's token fails on the MCP endpoint and the reverse.

A JWT can't be revoked before it expires: signing someone out stops their refresh, and the access token they hold keeps working until it runs out. Access tokens for a backend therefore live 5 to 10 minutes; anything that must end at once asks Next.js (token introspection) instead of trusting the JWT.

### Sign-in methods

* **Several OIDC providers:** Better Auth's built-in providers (Google, Apple, …) and `genericOAuth` for authentik, Authelia and any other. The app reads its own `<APP>_OIDC_<NAME>_*` variables and passes a list in; Better Auth reads no environment for them.
* **Passkeys:** `@better-auth/passkey`, added while signed in.
* **Magic link and email code.** Better Auth's magic link signs in whichever browser opens it. During an MCP sign-in that would let an attacker who started a sign-in with your address finish it when you click the genuine mail (V2). So:
  * During an MCP or script sign-in, the mail holds only a 6-digit code (`email-otp`: 5 minutes, 3 attempts). It is typed into the page waiting in the browser that asked, so only that page can use it.
  * For the web UI on its own, the mail holds the link and the code. Opening the link elsewhere signs in only that browser, into the account of the address it was sent to, which gains an attacker nothing.
  * Links and codes are stored hashed (`storeToken: "hashed"`, `storeOTP: "hashed"`), not in plain text as by default (V1).
* **Mail** goes out through the app's own `sendMagicLink` and `sendVerificationOTP`, over SMTP configured by the app.

### Who a person is

Configurable per app, with the verified email as the default. Better Auth links a sign-in to an existing account by email only when the provider says `email_verified: true` and the local account's email is verified too; `trustedProviders` names the providers whose email counts. `disableImplicitLinking` turns that off, so a second sign-in joins an account only when linked while signed in.

### This library

* **Unchanged in purpose:** the OAuth server for MCP servers whose login is a form checked by a service, in Python and TypeScript, the same in both (V3). The Python servers keep it.
* **The TypeScript package stays** for a TypeScript server of that kind, and for nothing more: apps with a web UI don't use it.
* **No new sign-in methods.** Magic links, passkeys, several providers and the browser session are Better Auth's job.

### Consequences

* Good, because the security code we would have written for magic links, passkeys, Apple and sessions comes from a widely used library, and this one stays small.
* Good, because a Python backend scales and deploys on its own: it checks tokens against public keys and shares nothing with the frontend.
* Good, because every app with a web UI signs in the same way, and Better Auth's tables are where its users live, so the apps don't each model accounts.
* Bad, because the apps now depend on a fast-moving framework (1.7 stable, 1.8 in beta) and follow its upgrades in each app.
* Bad, because each app builds its sign-in and consent pages itself.
* Bad, because a backend's JWT stays valid until it expires; short lifetimes and introspection keep that small.
* Bad, because some of Better Auth's defaults are weaker than our lines (magic links and codes stored in plain text); each app sets them, and questlog's ADR names the settings.
* Bad, because freundebuch and notefeed lose their current logins when they move: connected clients sign in once more.
