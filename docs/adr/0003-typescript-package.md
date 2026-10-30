---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# A TypeScript package next to the Python one, with an OIDC login and an SQLite store

## Context and Problem Statement

Marcel's TypeScript apps (notefeed, freundebuch, and the new questlog) each carry a hand-written copy of the same OAuth authorization server for MCP clients, the problem ADR 0001 solved for the Python servers. freundebuch's copy (its ADR 0003) lists the gaps that come from storing nothing: a used code or refresh token can be replayed once after a restart, a single client can't be revoked, and only rotating the secret signs anyone out. questlog decided to use a shared TypeScript library instead of a third copy (questlog ADR 0003). Where does it live, how does it differ from the Python package, and how is it installed?

## Decision Drivers

* The same behaviour as the Python package: lifetimes, refusals, revocation, resource binding, the pages.
* The TypeScript apps sign in through an OpenID Connect provider (authentik), not a form checked by a service.
* The apps are Next.js route handlers today; the library must not depend on a framework.
* No replay after a restart, and revocation of one client.
* One container and one data volume per app.

## Considered Options

* **A separate repository** for the TypeScript package. Simpler to publish, but the two packages would drift, which is what this library exists to stop.
* **This repository, Python moved into `python/`.** Symmetric, but it changes the install URL of the four Python servers.
* **This repository, Python at the root, TypeScript in `typescript/`.** (chosen)

## Decision Outcome

Chosen: the TypeScript package lives in `typescript/` of this repository. The Python package stays where its users pin it.

* **Same model:** the app supplies how a login is checked and gets a *grant* back; the library owns discovery, dynamic client registration, the authorize step, `/token` (PKCE `S256`, rotating refresh tokens), `/revoke` for public and confidential clients, tokens bound to a resource (RFC 8707) and `iss` on the code redirect (RFC 9207). Defaults match the Python package (code 300 s, access 3600 s, refresh 30 days, login link 600 s, 5 attempts, 1 s delay after a failure).
* **Two kinds of login:** `form` (fields plus a `check` callback, as `check_login` in Python) and `oidc` (a redirect to a provider; the library checks the id_token's issuer, audience, `azp`, expiry and nonce, and hands the person to the app, which returns the grant). The OIDC flight is bound to the browser that started it by a cookie, so a sign-in started by someone else can't be completed by a victim.
* **Framework-neutral:** `handle(request)` answers every OAuth route with a web `Response` (or `null` for a path that isn't its own), and `verify(request)` returns the grant behind a bearer token. A Next.js app mounts it from route handlers.
* **Store:** an interface with two implementations: `sqliteStore` (the default for apps: its own SQLite file next to the app's database, with its own migrations) and `memoryStore` (tests, development). Values are encrypted with AES-256-GCM under a key derived from the app's secret, and keys are stored as HMACs, so the file holds no usable token. A changed secret turns every entry into a miss: clients sign in again.
* **Revoking a person:** a grant may carry a `subject`; `revokeSubject(subject)` ends every token pair and code of that person, for example when the app deletes a user.
* **Releases** are tagged `ts-v0.x.y` (Python keeps `v0.x.y`). npm can't install a package from a subfolder of a git repository, so CI packs the package on such a tag and attaches the tarball to the GitHub release; apps depend on the tarball's URL. Publishing to npm can follow.

### Consequences

* Good, because the TypeScript apps get the same login behaviour as the Python servers, and fixes land once per language in one place.
* Good, because the store closes freundebuch's gaps: codes and refresh tokens are spent in the store, so a restart doesn't make them usable again, and one client can be revoked.
* Bad, because the behaviour is written twice, once per language. The README's defaults and the tests keep them in step; a change to one package should name the other in its pull request.
* Bad, because an app moving from its own OAuth code drops its connected clients once: they sign in again.
* Bad, because the id_token's signature is not checked against the provider's keys, as in freundebuch: it comes straight from the token endpoint over TLS, which OIDC Core 3.1.3.7 allows. That holds only while it does.
