---
status: proposed
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# A complete sign-in in both packages: magic links, passkeys, several OIDC providers and the browser session

## Context and Problem Statement

Both packages sign in MCP clients only. The Python package has one login kind, a form; the TypeScript package (ADR 0003) has a form or one OIDC provider. Marcel's apps need more:

* **Magic links**, which Marcel uses regularly, and **passkeys**.
* **Several OIDC providers** at once (authentik, Authelia, Google, Apple, …), not one.
* **The web pages' own sign-in.** questlog's and freundebuch's pages need a browser session too. Each app would carry a second sign-in next to the library, the copying this library exists to stop.

How do the packages grow into the whole sign-in of an app, what do they own versus the app, and do we build it or take an existing library?

## Decision Drivers

* Fix once, for every app (ADR 0001, ADR 0003): what every app would write the same way belongs in the library.
* The same features in Python and TypeScript ([values](../values.md) V3).
* No new way in for an attacker. Anyone can register an MCP client (RFC 7591), so an attacker can start a sign-in for someone else's address.
* The library reads no environment. Each app names its own variables (`QUESTLOG_*`, `FREUNDEBUCH_*`) and passes values in.
* A person is who they proved to be. A claim nobody checked never joins two sign-ins into one account.
* Framework-neutral, as before: `Request` in, `Response` out ([values](../values.md) V6).

## Considered Options

**Build or take**

* **[Better Auth](https://better-auth.com/docs/plugins)** for TypeScript. It has magic links, passkeys, generic OAuth and Apple, sessions, an SQLite adapter, and an `mcp()` plugin that makes the app an OAuth server for MCP clients. But it exists only for TypeScript: Python would still be written by hand, and the two would differ in lifetimes, refusals, storage and revocation, which breaks V3. Its tables would hold the tokens as they are, where ours hold only HMACs.
* **FastMCP's `OIDCProxy`** for Python. One external OIDC provider only; rejected for the form servers in ADR 0001.
* **Build both, on small single-purpose libraries** (WebAuthn, SMTP), with shared test cases. (chosen)

**Sending the magic link**

* The app supplies a `send(email, link)` callback. The library stays free of mail, but every app writes the same SMTP code and mail text, and none of them sends mail today.
* **The library sends through SMTP**, with `send` as an optional override. (chosen)

**Where the magic link works**

* In any browser. An attacker starts a sign-in with your address. You click the genuine mail and their client gets access to your data.
* In any browser after "approve the sign-in on the other device". The same attack, with a button labelled "Approve".
* Only in the browser that asked. Safe, but reading the mail on the phone no longer works.
* **A link and a 6-digit code.** The link works only in the browser that asked; the code is typed into the page waiting in that browser. (chosen)

**Configuring OIDC providers**

* The library parses `<PREFIX>OIDC_<NAME>_*` from the environment. Short for the apps, but the library would read the environment and fix each app's variable names.
* **Parameters:** a list in the options and `registerOidcProvider(...)`. The app parses its own environment. (chosen)

**Who a person is**

* Always the provider plus its `sub`. Safe, but the same person through a magic link and Google becomes two accounts unless they link them by hand.
* **Configurable, with the verified email as the default.** (chosen)

**Passkeys**

* Write the WebAuthn verification by hand (CBOR, COSE keys, attestation formats).
* **`@simplewebauthn/server`**, a widely used library that does only this. (chosen)

**The browser session**

* MCP clients only; each app keeps its own web sign-in.
* **The library also gives the app a browser session.** (chosen)

## Decision Outcome

Both packages become the whole sign-in of an app, with the same features (V3). They ship together as `ts-v0.2.0` and `v0.3.0`; the options change, which 0.x allows. Names below are the TypeScript ones; Python uses the same in snake_case.

### Sign-in methods

`methods` replaces `login` and holds any of `magicLink`, `passkey` and `oidc` (one or more providers). The sign-in page offers each one: a passkey button, an email field and one button per provider. `form` stays a method of its own and doesn't combine with the others: its grant carries a service's credentials, which nothing else can produce.

Every method ends in one app callback, `grant(identity, context)`, which returns the grant or throws `LoginRejected`:

* `identity`: `{ key, method, email?, provider?, issuer?, sub?, name? }`.
* `context`: `{ client?, signedIn? }`. `client` is the MCP client being authorized, if any. `signedIn` is the grant of the browser session, if the person is already signed in, so the app can link a second sign-in to them.

### Who a person is

The app chooses how a person is identified, with the option `identifyBy: "email" | "subject"`. When it sets nothing, it is `"email"`.

* With `"email"`, `identity.key` is the lowercased address. A magic link proves it. An OIDC provider counts only when its id_token says `email_verified: true` **and** the provider is trusted for email (`trustEmail`, default `true`). Set it to `false` for a provider whose users can set any address.
* When the email doesn't count, the key is the issuer plus `sub`. That also applies to Apple's private relay addresses, which match nothing.
* With `"subject"`, the key is always the issuer plus `sub`, or the address for a magic link. A second sign-in joins an account only through `context.signedIn`.

### Magic link

* Options: `{ smtp: { url, from }, allowEmail(email), send? }`. The library sends through `nodemailer`; `send` replaces that for an app with its own mail service.
* The page answers the same whether or not the address may sign in, so nobody can probe for accounts. `allowEmail` decides whether a mail goes out. Requests are limited per address and per IP.
* The mail holds a link and a 6-digit code. Both are spent once, last 10 minutes and allow 5 wrong attempts (the existing defaults).
  * The link signs in only the browser that asked, bound by a cookie as the OIDC sign-in is.
  * Opened anywhere else, the link signs nobody in and says: "Enter the code on the device where you started."
  * The code is accepted only by the page waiting in the browser that asked.

### OIDC providers

* `methods.oidc` is a list of `{ name, issuer, clientId, clientSecret, label?, trustEmail?, scopes? }`. `registerOidcProvider({ … })` adds one later, the same shape as an object.
* Each provider gets its own redirect URI, `${baseUrl}${oauthPath}/callback/<name>`.
* `issuer` is known for `google` and `apple`. Self-hosted providers (authentik, Authelia, …) give their own.
* Apple has no fixed client secret: it takes `{ teamId, keyId, privateKey }`, and the library signs the short-lived ES256 secret Apple expects. Apple posts its answer back (`form_post`), so the callback accepts a POST for it.
* The id_token is checked as before: issuer, audience, `azp`, expiry and nonce. Its signature is still not checked, since it comes straight from the token endpoint over TLS (ADR 0003).

### Passkeys

* Built on `@simplewebauthn/server` in TypeScript and `webauthn` (py_webauthn) in Python. These verify passkeys only; everything else here is ours. The relying party is the host of `baseUrl`. User verification is required.
* Credentials are discoverable, so signing in needs no username, and the browser can offer the passkey in the email field.
* A passkey is added only in a signed-in browser session. The first sign-in is always another method, usually a magic link.
* Passkeys are kept in the store without an expiry, under the person's subject. The app lists and deletes them through `passkeys(subject)` and `deletePasskey(subject, id)`.

### The browser session

* `session(request)` returns the grant behind the session cookie, or `null`.
* `signInPage(request, { next })` and `signOut(request)` return the matching responses.
* The cookie is `__Host-`, `HttpOnly`, `Secure` and `SameSite=Lax`, and holds an opaque token. The session lives in the store, lasts 30 days and is renewed on use. A POST must come from the app's own origin, as the login page already demands.
* When an MCP client asks to connect and the browser already has a session, the person sees "Allow <client> to access <service>?" instead of signing in again.

### Ending access

* `revokeSubject(subject)` ends every session, code and token pair of the person. Their passkeys stay.
* `deleteSubject(subject)` also removes their passkeys. Call it when the app deletes the user.

### Pages and mail text

* The sign-in pages and the mail have text: "Sign in", "Check your mail", "Enter the code". The library ships it in English and German, and the app picks with `language: "en" | "de"` (default `"en"`). freundebuch, whose UI is German, sets `"de"`.
* `texts` replaces single strings, for an app that wants other wording, for example `texts: { signInTitle: "Sign in to your quest log" }`. The README lists every key.

### Python

* The Python package gets every method and the browser session as well (V3). Its current servers keep their form, because their grant carries a service's credentials, which no other method produces; a new Python server can use the rest.
* Passkeys use `webauthn`, SMTP the standard library's `smtplib`. Calls to OIDC providers verify TLS against the operating system's certificate store (`truststore`), as every HTTPS client of Marcel's does.
* The behaviour is checked by the same test cases in both packages, as for the OAuth server today.

### Consequences

* Good, because an app gets its whole sign-in from one place: MCP clients and its own pages, magic links, passkeys and any OIDC provider. A fix lands once.
* Good, because the magic link can't be used to hand someone's account to a client they never started, yet still works across devices through the code.
* Good, because the library reads no environment: each app keeps its own variable names and parses them itself.
* Bad, because both packages grow from an OAuth server into a sign-in system, with new dependencies: `nodemailer` and `@simplewebauthn/server` (and its browser half for the page) in TypeScript, `webauthn` in Python.
* Bad, because we write and maintain what Better Auth would give TypeScript for free, so that Python gets the same.
* Bad, because the email as the default identity trusts each provider's `email_verified`. A provider that sets it carelessly must be marked `trustEmail: false`, or an address there takes over the account of that address.
* Bad, because the options change: apps on 0.1 move `login` into `methods` when they update.
* Bad, because every feature is written twice, once per language, and a release waits for both.
