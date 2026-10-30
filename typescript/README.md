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

## Example: sign-in through authentik (Next.js)

```ts
// lib/auth.ts
import { createLoginOAuth, sqliteStore } from "@marceltov/mcp-login-oauth";

export const auth = createLoginOAuth({
  baseUrl: process.env.PUBLIC_URL!,               // the issuer, e.g. https://questlog.example.org
  serviceName: "questlog",
  tokenPrefix: "ql_",
  resources: ["/api/v1"],                         // optional: further audiences next to /mcp
  store: sqliteStore({ path: `${process.env.DATA_DIR}/oauth.sqlite`, secret: process.env.QUESTLOG_SECRET!, salt: "questlog-oauth" }),
  login: {
    kind: "oidc",
    issuer: process.env.QUESTLOG_OIDC_ISSUER!,
    clientId: process.env.QUESTLOG_OIDC_CLIENT_ID!,
    clientSecret: process.env.QUESTLOG_OIDC_CLIENT_SECRET!,
    buttonLabel: "Sign in with authentik",
    async grant(person) {                          // throw LoginRejected("…") to refuse
      const user = await usersFromOidc(person);     // your code: create the user on first sign-in
      return { subject: user.id };
    },
  },
});
```

```ts
// app/oauth/[...path]/route.ts, app/.well-known/[...path]/route.ts
import { auth } from "@/lib/auth";
const handler = async (req: Request) => (await auth.handle(req)) ?? new Response("Not found", { status: 404 });
export { handler as GET, handler as POST, handler as OPTIONS };
```

```ts
// app/mcp/route.ts
export async function POST(req: Request) {
  const v = await auth.verify(req, { resource: "/mcp" });
  if (!v) return auth.unauthorized();
  const userId = v.grant.subject;                  // whatever the login returned
  // … hand the request to the MCP SDK
}
```

The OIDC provider's redirect URI is `${baseUrl}/oauth/callback`.

## Example: a form checked by a service

```ts
import { createLoginOAuth, LoginRejected, sqliteStore } from "@marceltov/mcp-login-oauth";

const auth = createLoginOAuth({
  baseUrl: "https://trilium-mcp.example.org",
  serviceName: "Trilium Notes",
  tokenPrefix: "tmcp_",
  store: sqliteStore({ path: "/data/oauth.sqlite", secret: process.env.MCP_OAUTH_SECRET!, salt: "trilium-mcp-oauth" }),
  login: {
    kind: "form",
    fields: [{ name: "password", label: "Trilium password", type: "password", required: true }],
    async check(form, client) {                    // client: { clientId, clientName, redirectUri }
      const r = await fetch("http://trilium:8080/etapi/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: form.password }) });
      if (!r.ok) throw new LoginRejected(`Trilium rejected the login (HTTP ${r.status}).`);
      return { etapiToken: (await r.json()).authToken };   // the grant, stored encrypted
    },
  },
  async onRevoke(grant) { /* log the minted token out */ },
});
```

Fields work as in Python: `{ name, label, type?, required?, autocomplete?, inputmode?, hint?, group? }`; fields with the same `group` go into one collapsed section.

## API

| | |
|---|---|
| `handle(request)` | Answers `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/<resource path>]` and `<oauthPath>/{register,authorize,login,callback,token,revoke}`. `null` for any other path. |
| `verify(request, { resource? })` | The grant behind `Authorization: Bearer …`, or `null`. With `resource`, the token must be bound to exactly that resource; a token bound to nothing counts as bound to the MCP endpoint. |
| `unauthorized(resource?)` | A 401 whose `WWW-Authenticate` points the client at the resource metadata. |
| `revokeSubject(subject)` | Ends every code and token pair whose grant has that `subject`, and calls `onRevoke` for each pair. Call it when your app deletes a user. |

## Options and defaults

| Option | Default |
|---|---|
| `mcpPath` | `/mcp` |
| `oauthPath` | `/oauth` |
| `ttl.pending` (login link) | 600 s |
| `ttl.code` | 300 s |
| `ttl.access` | 3600 s |
| `ttl.refresh` (rotated on every refresh) | 30 days |
| `ttl.grant` (cap on a whole login) | none |
| `failedLoginDelayMs` | 1000 |
| `maxLoginAttempts` (per login link) | 5 |
| `verifyStatic`, `onRevoke`, `log`, `now` | optional |

## Notes

- **The store is its own file.** Keep it next to your app's database, not in it. Losing it only makes connected clients sign in again. Values are AES-256-GCM encrypted and keys and subjects are HMACs, both derived from `secret` and `salt`; changing the secret signs every client out.
- **A form is never stored or logged.** Only the grant is stored, encrypted. Logs never carry a form, a token or a person's details.
- **The OIDC id_token's signature is not checked** against the provider's keys: it comes straight from the token endpoint over TLS, which OIDC Core 3.1.3.7 allows. The issuer, audience, `azp`, expiry and nonce are checked.
- **A POST to the login page must come from the page itself** (`Origin`, `Sec-Fetch-Site`): an auto-submitting form on another site can't sign a person in for a client they never saw.
- **Moving from your own OAuth code** drops existing logins: connected clients sign in once more.

## Development

```bash
npm ci
npm test
npm run typecheck
npm pack          # builds dist/ and the tarball
```

## License

AGPL-3.0-or-later, like the Python package. See [LICENSE](../LICENSE).
