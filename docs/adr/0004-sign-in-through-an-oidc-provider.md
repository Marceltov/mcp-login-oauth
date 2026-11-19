---
status: accepted
date: 2026-11-19
decision-makers: Marcel Bruckner
---

# Sign in through an OpenID Connect provider

## Context and Problem Statement

Every login so far was a form the server checks against the service behind it. The homelab's MCP servers that have no login of their own (OpenBB's, behind mcp-login-proxy) got a fixed list of users and passwords instead. Marcel wants them to sign in with the household's Authentik: one login with passkeys and two-factor, and who gets in managed in one place.

How does a server on this library let people sign in at an identity provider?

## Considered Options

* **A login kind in the library:** `oidc=OidcLogin(...)`. The pending login, the consent page, codes, tokens and revocation stay the library's; the provider round trip is a second way to finish a pending login.
* **FastMCP's `OIDCProxy`** in each server instead of this library: a whole second OAuth server with its own store, pages and revocation rules, so a server would behave differently depending on how people sign in.
* **App passwords at the provider through a form:** no passkeys or two-factor, and everyone has to create an app password first.

## Decision Outcome

Chosen: **a login kind in the library**, v0.4.0.

* `OidcLogin(issuer, client_id, client_secret=None, scopes, name, verify_tls)`, passed as `oidc=` with `fields=[]`; the constructor refuses both or neither.
* The login page keeps the consent card ("claude.ai wants access to … Only continue if you started this") and shows one button, "Continue with <name>". It does not redirect on its own: that moment is the protection against a login someone else started.
* Authorization code flow with PKCE, `state` and `nonce`. The state, verifier and nonce wait in the encrypted store for the login link's lifetime and are deleted when the callback reads them (V2).
* The ID token is checked with PyJWT against the provider's JWKS (RS256, ES256, PS256): signature, issuer from discovery, audience = client id, `exp`, `iat`, `nonce`, 60 s leeway. An unknown key id fetches the keys once more.
* The claims are completed from the userinfo endpoint: Authentik leaves `preferred_username` and `groups` out of the ID token by default. The ID token's claims win; userinfo for another `sub` is refused.
* `check_login` receives the claims and decides: a grant, or `LoginRejected` shown on the page. The library lets nobody in by itself.
* The provider is called with httpx and a `truststore` context (convention: HTTPS clients); `verify_tls=False` is the explicit off switch. httpx, truststore and PyJWT are now direct dependencies.

### Consequences

* Good: a server can hand "who is this" to Authentik (or Keycloak, …) without its own user list, and keeps everything else this library guarantees.
* Good: V4 holds: the provider is the service the server checks logins against.
* Bad: the provider's discovery and keys are fetched at the first login after a start, so a provider that is down shows its error on the page rather than at startup.
* Neutral: one more route, `/login/callback`, only when `oidc` is set.

### Confirmation

`tests/test_oidc.py` runs the whole flow against a fake provider that signs with a real RSA key: success, the refusal page, single-use state, unknown state, provider error, wrong audience, wrong issuer, expired token, wrong nonce, a foreign signature, a refused code, key rotation, the truststore context and the constructor rules. mcp-login-proxy exposes it as `login.oidc` and was checked against a disposable Authentik.
