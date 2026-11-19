---
status: accepted
date: 2026-11-19
decision-makers: Marcel Bruckner
---

# Pass the provider's access token to check_login, on request

## Context and Problem Statement

With `oidc=` (ADR 0004) `check_login` receives the ID token's claims: enough to decide who gets in, not enough to act as that person. Some services behind a server take a credential of their own on every request and accept only their provider's tokens to make one: OpenCloud signs everyone in through Authentik and makes app tokens (`POST /auth-app/tokens`) only for a request carrying the person's access token. The homelab's OpenCloud connector (mcp-login-proxy in front of opencloud-mcp) should sign in once at Authentik and create that app token itself, instead of asking people to make one and paste it.

How does `check_login` get the provider's access token without giving up "nothing from the provider is passed on"?

## Considered Options

* **Opt-in field on `OidcLogin`:** `pass_access_token=True` adds `claims["access_token"]` for `check_login`.
* **Always pass it:** every OIDC server would hold a bearer credential it doesn't need.
* **A second callback with the raw token response:** more surface for one value.

## Decision Outcome

Chosen: **opt-in field on `OidcLogin`**, v0.5.0. Off by default, so a server that only asks "who is this" keeps receiving claims alone. The token is put into the dict handed to `check_login` and nowhere else: it is not stored (the pending login's record holds state, verifier and nonce only) and not logged (V1). What `check_login` returns is the grant, as before; a server that creates a credential keeps that credential in the grant, encrypted like every grant.

### Consequences

* Good, because a server can turn one sign-in at the provider into the credential its service needs, and nobody handles tokens.
* Neutral, because the access token's lifetime doesn't matter: it is used once, during the login.
