import { describe, expect, test } from "vitest";
import { BASE, REDIRECT, bearer, call, loginWithCode, ours, pkce, registerClient, setup, startAuthorize, tokens } from "./helpers.js";

describe("discovery", () => {
  test("authorization server metadata names every endpoint and the iss flag", async () => {
    const { auth } = setup();
    const res = await call(auth, "GET", "/.well-known/oauth-authorization-server");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const m = await res.json();
    expect(m).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      revocation_endpoint: `${BASE}/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  test("protected resource metadata for the MCP endpoint and each further resource", async () => {
    const { auth } = setup();
    expect(await (await call(auth, "GET", "/.well-known/oauth-protected-resource")).json()).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    expect(await (await call(auth, "GET", "/.well-known/oauth-protected-resource/mcp")).json()).toMatchObject({ resource: `${BASE}/mcp` });
    expect(await (await call(auth, "GET", "/.well-known/oauth-protected-resource/api/v1")).json()).toMatchObject({ resource: `${BASE}/api/v1` });
    expect(await auth.handle(new Request(`${BASE}/.well-known/oauth-protected-resource/other`))).toBeNull();
  });

  test("other paths are not ours", async () => {
    const { auth } = setup();
    expect(await auth.handle(new Request(`${BASE}/mcp`, { method: "POST" }))).toBeNull();
    expect(await auth.handle(new Request(`${BASE}/oauth/nothing`))).toBeNull();
    expect(await auth.handle(new Request(`${BASE}/oauth/callback`))).toBeNull(); // only with an OIDC login
  });

  test("unauthorized points at the resource metadata", () => {
    const { auth } = setup();
    expect(auth.unauthorized().headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    expect(auth.unauthorized("/api/v1").headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/v1");
  });
});

describe("registration", () => {
  test("a public client gets an id and no secret", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    expect(c.client_id).toBeTruthy();
    expect(c.client_secret).toBeUndefined();
  });

  test("a confidential client gets a secret", async () => {
    const { auth } = setup();
    expect((await registerClient(auth, { token_endpoint_auth_method: "client_secret_post" })).client_secret).toBeTruthy();
  });

  test.each([
    [{ redirect_uris: ["http://evil.example/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://a.example/cb#x"] }, "invalid_redirect_uri"],
    [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [{ redirect_uris: [REDIRECT], client_name: "Cl‮aude" }, "invalid_client_metadata"],
    [{ redirect_uris: [REDIRECT], token_endpoint_auth_method: "private_key_jwt" }, "invalid_client_metadata"],
  ])("refuses %j", async (body, error) => {
    const { auth } = setup();
    const res = await call(auth, "POST", "/oauth/register", { json: body });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
  });

  test("plain http is fine on loopback", async () => {
    const { auth } = setup();
    const res = await call(auth, "POST", "/oauth/register", { json: { redirect_uris: ["http://127.0.0.1:33418/callback"] } });
    expect(res.status).toBe(201);
  });
});

describe("authorize", () => {
  test("an unknown client or unregistered redirect URI is never redirected to", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const unknown = await call(auth, "GET", `/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(unknown.status).toBe(400);
    const other = await call(auth, "GET", `/oauth/authorize?client_id=${c.client_id}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`);
    expect(other.status).toBe(400);
    expect(other.headers.get("location")).toBeNull();
  });

  test("missing PKCE goes back to the client with an error, state and iss", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const res = await call(auth, "GET", `/oauth/authorize?client_id=${c.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&state=s`);
    const to = new URL(res.headers.get("location")!);
    expect(to.searchParams.get("error")).toBe("invalid_request");
    expect(to.searchParams.get("state")).toBe("s");
    expect(to.searchParams.get("iss")).toBe(BASE);
  });

  test("a resource of another server is invalid_target", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const { location } = await startAuthorize(auth, c.client_id, { resource: "https://other.example/mcp" });
    expect(new URL(location).searchParams.get("error")).toBe("invalid_target");
  });

  test("the login page names the client and where the code goes", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const { location } = await startAuthorize(auth, c.client_id);
    const page = await call(auth, "GET", new URL(location).pathname + new URL(location).search);
    const html = await page.text();
    expect(html).toContain("<b>Claude</b> wants access to your Questlog");
    expect(html).toContain("<b>claude.ai</b>");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("form login", () => {
  test("the right password sends the code back with state and iss", async () => {
    const { auth } = setup();
    const { res, code, to } = await loginWithCode(auth);
    expect(res.status).toBe(302);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(code.startsWith("ql_")).toBe(true);
    expect(to.searchParams.get("state")).toBe("st-1");
    expect(to.searchParams.get("iss")).toBe(BASE);
  });

  test("a wrong password shows the message, and the link ends after 5 attempts", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const { pendingId } = await startAuthorize(auth, c.client_id);
    for (let i = 0; i < 5; i++) {
      const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "wrong" }, headers: ours });
      expect(res.status).toBe(401);
      expect(await res.text()).toContain("Wrong password.");
    }
    const after = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: ours });
    expect(after.status).toBe(400);
    expect(await after.text()).toContain("expired or already used");
  });

  test("the link expires", async () => {
    const { auth, clock } = setup();
    const c = await registerClient(auth);
    const { pendingId } = await startAuthorize(auth, c.client_id);
    clock.advance(601);
    const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: ours });
    expect(res.status).toBe(400);
  });

  test("a replayed form after success gets an honest answer, not a second code", async () => {
    const { auth } = setup();
    const { pendingId } = await loginWithCode(auth);
    const again = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: ours });
    expect(again.status).toBe(200);
    expect(again.headers.get("location")).toBeNull();
    expect(await again.text()).toContain("Login already completed");
  });

  test("a POST from another site is refused", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    const { pendingId } = await startAuthorize(auth, c.client_id);
    const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const fetchMeta = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: { "sec-fetch-site": "cross-site" } });
    expect(fetchMeta.status).toBe(403);
  });

  test("a failing check says the service can't be reached and never logs the form", async () => {
    const { auth, logs } = setup({
      login: { kind: "form", fields: [{ name: "password", label: "Password" }], check: async () => { throw new Error("ECONNREFUSED"); } },
    });
    const c = await registerClient(auth);
    const { pendingId } = await startAuthorize(auth, c.client_id);
    const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "secret-pw" }, headers: ours });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Could not reach Questlog.");
    expect(logs.join(" ")).not.toContain("secret-pw");
  });

  test("the check learns the client", async () => {
    let seen: unknown;
    const { auth } = setup({
      login: { kind: "form", fields: [], check: async (_f, client) => { seen = client; return {}; } },
    });
    await loginWithCode(auth);
    expect(seen).toMatchObject({ clientName: "Claude", redirectUri: REDIRECT });
  });
});

describe("token endpoint", () => {
  test("a code becomes a token pair, and the access token carries the grant", async () => {
    const { auth } = setup();
    const { body } = await tokens(auth);
    expect(body.access_token.startsWith("ql_")).toBe(true);
    expect(body.expires_in).toBe(3600);
    const v = await auth.verify(bearer(body.access_token));
    expect(v?.grant).toEqual({ subject: "user-1", token: "service-token" });
  });

  test("a code works once", async () => {
    const { auth } = setup();
    const { client, code, verifier } = await loginWithCode(auth);
    const form = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT };
    expect((await call(auth, "POST", "/oauth/token", { body: form })).status).toBe(200);
    const again = await call(auth, "POST", "/oauth/token", { body: form });
    expect((await again.json()).error).toBe("invalid_grant");
  });

  test("a wrong verifier doesn't burn the code", async () => {
    const { auth } = setup();
    const { client, code, verifier } = await loginWithCode(auth);
    const base = { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT };
    const wrong = await call(auth, "POST", "/oauth/token", { body: { ...base, code_verifier: pkce().verifier } });
    expect((await wrong.json()).error).toBe("invalid_grant");
    expect((await call(auth, "POST", "/oauth/token", { body: { ...base, code_verifier: verifier } })).status).toBe(200);
  });

  test("another client can't use the code", async () => {
    const { auth } = setup();
    const { code, verifier } = await loginWithCode(auth);
    const other = await registerClient(auth);
    const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: other.client_id, redirect_uri: REDIRECT } });
    expect((await res.json()).error).toBe("invalid_grant");
  });

  test("a confidential client must send its secret", async () => {
    const { auth } = setup();
    const c = await registerClient(auth, { token_endpoint_auth_method: "client_secret_basic" });
    const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: "x", client_id: c.client_id } });
    expect(res.status).toBe(401);
    const basic = `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString("base64")}`;
    const ok = await call(auth, "POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: "x" }, headers: { authorization: basic } });
    expect((await ok.json()).error).toBe("invalid_grant"); // authenticated; the token itself is unknown
  });

  test("refresh rotates: the old pair dies, the grant lives on", async () => {
    const { auth } = setup();
    const { client, body } = await tokens(auth);
    const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: client.client_id } });
    const next = await res.json();
    expect(next.refresh_token).not.toBe(body.refresh_token);
    expect(await auth.verify(bearer(body.access_token))).toBeNull();
    expect((await auth.verify(bearer(next.access_token)))?.grant.subject).toBe("user-1");
    const reuse = await call(auth, "POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: client.client_id } });
    expect((await reuse.json()).error).toBe("invalid_grant");
  });

  test("an optional grant lifetime stops refreshes after the login", async () => {
    const { auth, clock } = setup({ ttl: { grant: 7200 } });
    const { client, body } = await tokens(auth);
    clock.advance(7201);
    const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: client.client_id } });
    expect((await res.json()).error).toBe("invalid_grant");
  });

  test("access tokens expire", async () => {
    const { auth, clock } = setup();
    const { body } = await tokens(auth);
    clock.advance(3601);
    expect(await auth.verify(bearer(body.access_token))).toBeNull();
  });

  test("unknown grant types and bodies are refused", async () => {
    const { auth } = setup();
    const c = await registerClient(auth);
    expect((await (await call(auth, "POST", "/oauth/token", { body: { grant_type: "password", client_id: c.client_id } })).json()).error).toBe("unsupported_grant_type");
    expect((await (await call(auth, "POST", "/oauth/token", { json: { grant_type: "password" } })).json()).error).toBe("invalid_request");
  });
});

describe("resources (RFC 8707)", () => {
  test("a token bound to /api/v1 works there and not on /mcp", async () => {
    const { auth } = setup();
    const { body } = await tokens(auth, { resource: `${BASE}/api/v1` });
    expect(await auth.verify(bearer(body.access_token), { resource: "/api/v1" })).not.toBeNull();
    expect(await auth.verify(bearer(body.access_token), { resource: "/mcp" })).toBeNull();
  });

  test("a token bound to nothing counts as bound to the MCP endpoint", async () => {
    const { auth } = setup();
    const { body } = await tokens(auth);
    expect(await auth.verify(bearer(body.access_token), { resource: "/mcp" })).not.toBeNull();
    expect(await auth.verify(bearer(body.access_token), { resource: "/api/v1" })).toBeNull();
  });

  test("a token bound to our old URL is refused, and so is its refresh", async () => {
    const { auth, store } = setup();
    const { client, body } = await tokens(auth, { resource: `${BASE}/mcp` });
    const moved = setup({ store, baseUrl: "https://new.example.org" }).auth;
    expect(await moved.verify(new Request("https://new.example.org/mcp", { headers: { authorization: `Bearer ${body.access_token}` } }))).toBeNull();
    const res = await moved.handle(new Request("https://new.example.org/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: client.client_id }) }));
    expect((await res!.json()).error).toBe("invalid_grant");
  });
});

describe("revocation", () => {
  test("a public client revokes its own refresh token, which ends the pair and calls onRevoke", async () => {
    const revoked: unknown[] = [];
    const { auth } = setup({ onRevoke: async (g) => void revoked.push(g) });
    const { client, body } = await tokens(auth);
    const res = await call(auth, "POST", "/oauth/revoke", { body: { token: body.refresh_token, client_id: client.client_id } });
    expect(res.status).toBe(200);
    expect(await auth.verify(bearer(body.access_token))).toBeNull();
    expect(revoked).toEqual([{ subject: "user-1", token: "service-token" }]);
  });

  test("another client's token is left alone, and the answer is still 200", async () => {
    const { auth } = setup();
    const { body } = await tokens(auth);
    const other = await registerClient(auth);
    const res = await call(auth, "POST", "/oauth/revoke", { body: { token: body.access_token, client_id: other.client_id } });
    expect(res.status).toBe(200);
    expect(await auth.verify(bearer(body.access_token))).not.toBeNull();
  });

  test("an unknown client is invalid_client", async () => {
    const { auth } = setup();
    expect((await call(auth, "POST", "/oauth/revoke", { body: { token: "x", client_id: "nope" } })).status).toBe(401);
  });

  test("a failing onRevoke is logged, and the revocation stands", async () => {
    const { auth, logs } = setup({ onRevoke: async () => { throw new Error("boom"); } });
    const { client, body } = await tokens(auth);
    await call(auth, "POST", "/oauth/revoke", { body: { token: body.access_token, client_id: client.client_id } });
    expect(await auth.verify(bearer(body.access_token))).toBeNull();
    expect(logs).toContain("onRevoke failed");
  });

  test("revokeSubject ends every pair and code of that person", async () => {
    const { auth } = setup();
    const a = await tokens(auth);
    const b = await tokens(auth);
    const pending = await loginWithCode(auth); // a code not yet exchanged
    expect(await auth.revokeSubject("user-1")).toBe(2);
    expect(await auth.verify(bearer(a.body.access_token))).toBeNull();
    expect(await auth.verify(bearer(b.body.access_token))).toBeNull();
    const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "authorization_code", code: pending.code, code_verifier: pending.verifier, client_id: pending.client.client_id, redirect_uri: REDIRECT } });
    expect((await res.json()).error).toBe("invalid_grant");
  });
});

describe("verify", () => {
  test("no header, another scheme, or an unknown token gives null", async () => {
    const { auth } = setup();
    expect(await auth.verify(new Request(`${BASE}/mcp`))).toBeNull();
    expect(await auth.verify(new Request(`${BASE}/mcp`, { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(await auth.verify(bearer("ql_unknown"))).toBeNull();
  });

  test("static tokens go to verifyStatic, but ours never do", async () => {
    const seen: string[] = [];
    const { auth } = setup({ verifyStatic: async (t) => (seen.push(t), t === "static-ok" ? { subject: "svc" } : null) });
    expect((await auth.verify(bearer("static-ok")))?.clientId).toBe("static");
    expect(await auth.verify(bearer("ql_stale"))).toBeNull();
    expect(seen).toEqual(["static-ok"]);
  });
});
