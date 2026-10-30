# TypeScript reference

```ts
import { createLoginOAuth, LoginRejected, memoryStore, sqliteStore } from "@marceltov/mcp-login-oauth";
```

## `createLoginOAuth(options)`

| Option | |
|---|---|
| `baseUrl` | The server's public URL. It is the issuer. |
| `serviceName` | Shown on the login page. |
| `login` | A `form` or an `oidc` login (below). |
| `store` | `sqliteStore(...)` for a server, `memoryStore()` for tests. |
| `tokenPrefix` | Prefix of every code and token this server issues, e.g. `"tmcp_"`. |
| `mcpPath` | Path of the MCP endpoint, default `/mcp`. |
| `resources` | Further paths or URLs a token may be bound to, each its own audience, e.g. `["/api/v1"]`. |
| `oauthPath` | Where the OAuth endpoints live, default `/oauth`. |
| `onRevoke(grant)` | Clean up when a client revokes. Failures are logged; the revocation stands. |
| `verifyStatic(token)` | Accept a header token that isn't one of ours; the returned grant is used as is. |
| `ttl`, `failedLoginDelayMs`, `maxLoginAttempts` | Lifetimes and limits; defaults on [Behaviour](behaviour.md#lifetimes-and-limits). `ttl.grant` optionally caps a whole login: refreshes stop that long after it. |
| `log(message, details?)` | Where errors go; never receives a form, a token or a person's details. Default `console.error`. |
| `now` | A clock, for tests. |

### Logins

**`form`**: `{ kind: "form", fields, check(form, client) }`. `fields` work as in Python: `{ name, label, type?, required?, autocomplete?, inputmode?, hint?, group? }`. `check` returns the grant or throws `LoginRejected("shown on the page")`; `client` is `{ clientId, clientName, redirectUri }`.

**`oidc`**: `{ kind: "oidc", issuer, clientId, clientSecret, buttonLabel?, grant(person, client) }`. `person` is `{ sub, name?, email?, emailVerified, claims }`. `grant` returns the grant (give it a `subject` so the person can be revoked) or throws `LoginRejected`. The provider's redirect URI is `${baseUrl}${oauthPath}/callback`.

## The object it returns

| | |
|---|---|
| `handle(request)` | Answers `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/<resource path>]` and `<oauthPath>/{register,authorize,login,callback,token,revoke}`. `null` for any other path. |
| `verify(request, { resource? })` | `{ clientId, grant, scopes, resource?, expiresAt? }` behind `Authorization: Bearer …`, or `null`. With `resource`, the token must be bound to exactly that resource; a token bound to nothing counts as bound to the MCP endpoint. |
| `unauthorized(resource?)` | A 401 whose `WWW-Authenticate` points the client at the resource metadata. |
| `revokeSubject(subject)` | Ends every code and token pair whose grant has that `subject`, calls `onRevoke` for each, and returns how many pairs it ended. |

## Stores

- **`sqliteStore({ path, secret, salt })`**: its own SQLite file. Values are AES-256-GCM encrypted, keys and subjects are HMACs, both derived from `secret` and `salt`.
- **`memoryStore()`**: in memory, gone on restart; for tests and development.
- Both implement `Store` (`get`, `put`, `take`, `delete`, `takeSubject`), so another store can be plugged in. `take` reads and deletes in one step; that is what makes a code or refresh token single use.
