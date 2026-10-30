# Getting started: TypeScript

An MCP server on Node.js in front of Trilium Notes, where people sign in with their Trilium password. The package is framework-neutral: it takes a web `Request` and returns a `Response`, so it mounts in Next.js route handlers or any server that speaks the Fetch API.

!!! tip "An app with a web UI and its own users?"
    Use [Better Auth](https://better-auth.com) instead, see [Is this the right library?](../index.md#is-this-the-right-library)

## Install

npm can't install from a folder of a git repository, so each release carries the packed package. Pin the tarball of a `ts-v*` release:

```bash
npm install https://github.com/Marceltov/mcp-login-oauth/releases/download/ts-v0.1.0/marceltov-mcp-login-oauth-0.1.0.tgz
```

Needs Node.js ≥ 22. The default store uses `better-sqlite3`.

## A server with a password login

```ts
// auth.ts
import { createLoginOAuth, LoginRejected, sqliteStore } from "@marceltov/mcp-login-oauth";

export const auth = createLoginOAuth({
  baseUrl: "https://trilium-mcp.example.org",      // the issuer
  serviceName: "Trilium Notes",
  tokenPrefix: "tmcp_",
  store: sqliteStore({ path: "/data/oauth.sqlite", secret: process.env.MCP_OAUTH_SECRET!, salt: "trilium-mcp-oauth" }),
  login: {
    kind: "form",
    fields: [{ name: "password", label: "Trilium password", type: "password", required: true }],
    async check(form, client) {                    // client: { clientId, clientName, redirectUri }
      const r = await fetch("http://trilium:8080/etapi/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.password }),
      });
      if (!r.ok) throw new LoginRejected(`Trilium rejected the login (HTTP ${r.status}).`);
      return { etapiToken: (await r.json()).authToken };   // the grant, stored encrypted
    },
  },
  async onRevoke(grant) { /* log the minted token out of Trilium */ },
});
```

Mount it. In Next.js, as route handlers:

```ts
// app/oauth/[...path]/route.ts and app/.well-known/[...path]/route.ts
import { auth } from "@/auth";
const handler = async (req: Request) => (await auth.handle(req)) ?? new Response("Not found", { status: 404 });
export { handler as GET, handler as POST, handler as OPTIONS };
```

```ts
// app/mcp/route.ts
import { auth } from "@/auth";
export async function POST(req: Request) {
  const v = await auth.verify(req, { resource: "/mcp" });
  if (!v) return auth.unauthorized();
  const { etapiToken } = v.grant;                  // what check() returned
  // … hand the request to the MCP SDK
}
```

## A sign-in at one OpenID Connect provider

For an MCP server without users of its own, where people sign in at authentik or another provider, swap the login:

```ts
login: {
  kind: "oidc",
  issuer: process.env.MCP_OIDC_ISSUER!,
  clientId: process.env.MCP_OIDC_CLIENT_ID!,
  clientSecret: process.env.MCP_OIDC_CLIENT_SECRET!,
  buttonLabel: "Sign in with authentik",
  async grant(person) {                            // { sub, name?, email?, emailVerified, claims }
    if (!person.emailVerified) throw new LoginRejected("Your email address isn't verified.");
    return { subject: person.sub, email: person.email };
  },
},
```

The provider's redirect URI is `${baseUrl}/oauth/callback`. An app that has its own users, sessions or several providers needs Better Auth, not this.

## Next

- Every option, the login kinds and the functions: [TypeScript reference](../reference/typescript.md).
- Lifetimes, refusals and what is stored: [Behaviour](../reference/behaviour.md).
