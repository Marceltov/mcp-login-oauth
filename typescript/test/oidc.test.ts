import { describe, expect, test } from "vitest";
import { LoginRejected, type Grant, type OidcLogin } from "../src/index.js";
import { BASE, REDIRECT, bearer, call, ours, registerClient, setup, startAuthorize } from "./helpers.js";

const ISSUER = "https://auth.example.org/application/o/questlog/";

const idToken = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

// A provider that answers discovery and the token endpoint; `claims` decides what the id_token says.
function provider(now: () => number, claims: (nonce: string) => Record<string, unknown>) {
  const seen = { nonce: "", tokenRequests: 0 };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://auth.example.org/application/o/questlog/.well-known/openid-configuration")
      return Response.json({ issuer: ISSUER, authorization_endpoint: "https://auth.example.org/authorize", token_endpoint: "https://auth.example.org/token" });
    if (url === "https://auth.example.org/token") {
      seen.tokenRequests++;
      const body = new URLSearchParams(String(init?.body));
      if (body.get("code") !== "provider-code") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ id_token: idToken(claims(seen.nonce)) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const good = (nonce: string) => ({ iss: ISSUER, aud: "questlog", sub: "abc", name: "Marcel", email: "m@example.org", email_verified: true, exp: Math.floor(now() / 1000) + 300, nonce });
  return { fetchFn, seen, good };
}

function oidcSetup(claims?: (nonce: string, good: (n: string) => Record<string, unknown>) => Record<string, unknown>, grant?: OidcLogin["grant"]) {
  let p!: ReturnType<typeof provider>;
  const login: OidcLogin = {
    kind: "oidc",
    issuer: ISSUER,
    clientId: "questlog",
    clientSecret: "provider-secret",
    buttonLabel: "Sign in with authentik",
    grant: grant ?? (async (person): Promise<Grant> => ({ subject: `user-${person.sub}`, name: person.name })),
    fetch: ((...a: Parameters<typeof fetch>) => p.fetchFn(...a)) as typeof fetch,
  };
  const s = setup({ login });
  p = provider(s.clock.now, (nonce) => (claims ? claims(nonce, p.good) : p.good(nonce)));
  return { ...s, p };
}

// Authorize, press the button: the provider URL, the flight cookie and the state.
async function start(auth: ReturnType<typeof setup>["auth"], p: ReturnType<typeof provider>) {
  const client = await registerClient(auth);
  const { pendingId, verifier } = await startAuthorize(auth, client.client_id);
  const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId }, headers: ours });
  const to = new URL(res.headers.get("location") ?? "");
  p.seen.nonce = to.searchParams.get("nonce") ?? "";
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { client, pendingId, verifier, res, to, cookie, state: to.searchParams.get("state") ?? "" };
}

const callback = (auth: ReturnType<typeof setup>["auth"], state: string, cookie: string, code = "provider-code") =>
  call(auth, "GET", `/oauth/callback?state=${state}&code=${code}`, { headers: cookie ? { cookie } : {} });

describe("OIDC login", () => {
  test("the login page offers one button", async () => {
    const { auth } = oidcSetup();
    const client = await registerClient(auth);
    const { location } = await startAuthorize(auth, client.client_id);
    const html = await (await call(auth, "GET", new URL(location).pathname + new URL(location).search)).text();
    expect(html).toContain("Sign in with authentik");
    expect(html).not.toContain('type="password"');
  });

  test("the button sends the browser to the provider with PKCE, state and nonce, and sets the flight cookie", async () => {
    const { auth, p } = oidcSetup();
    const { res, to, cookie } = await start(auth, p);
    expect(res.status).toBe(303);
    expect(to.origin + to.pathname).toBe("https://auth.example.org/authorize");
    expect(to.searchParams.get("client_id")).toBe("questlog");
    expect(to.searchParams.get("redirect_uri")).toBe(`${BASE}/oauth/callback`);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cookie.startsWith("mlo_flight=")).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("Path=/oauth; Max-Age=600; HttpOnly; SameSite=Lax; Secure");
  });

  test("the callback turns the person into the grant and sends the code to the client", async () => {
    const { auth, p } = oidcSetup();
    const { client, verifier, state, cookie } = await start(auth, p);
    const res = await callback(auth, state, cookie);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(res.headers.get("set-cookie")).toContain("mlo_flight=; Path=/oauth; Max-Age=0");
    const tok = await call(auth, "POST", "/oauth/token", { body: { grant_type: "authorization_code", code: to.searchParams.get("code")!, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT } });
    const v = await auth.verify(bearer((await tok.json()).access_token));
    expect(v?.grant).toEqual({ subject: "user-abc", name: "Marcel" });
  });

  test("a sign-in started in another browser is never completed", async () => {
    const { auth, p } = oidcSetup();
    const { state } = await start(auth, p);
    expect((await callback(auth, state, "")).status).toBe(400);
    expect((await callback(auth, state, "mlo_flight=someone-elses")).status).toBe(400);
    expect(p.seen.tokenRequests).toBe(0);
  });

  test("a callback works once", async () => {
    const { auth, p } = oidcSetup();
    const { state, cookie } = await start(auth, p);
    expect((await callback(auth, state, cookie)).status).toBe(302);
    expect((await callback(auth, state, cookie)).status).toBe(400);
  });

  test.each([
    ["nonce", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), nonce: "other" })],
    ["iss", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), iss: "https://evil.example/" })],
    ["aud", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), aud: "other-app" })],
    ["azp", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), aud: ["questlog", "other"], azp: "other" })],
    ["exp", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), exp: 1 })],
    ["sub", (n: string, g: (n: string) => Record<string, unknown>) => ({ ...g(n), sub: "" })],
  ])("an id_token with a wrong %s is refused and counts as a failed attempt", async (check, claims) => {
    const { auth, p, logs } = oidcSetup(claims);
    const { state, cookie } = await start(auth, p);
    const res = await callback(auth, state, cookie);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("The sign-in did not succeed.");
    expect(logs).toContain("sign-in failed");
    void check;
  });

  test("the provider refusing the code is a failed sign-in", async () => {
    const { auth, p } = oidcSetup();
    const { state, cookie } = await start(auth, p);
    expect((await callback(auth, state, cookie, "wrong")).status).toBe(401);
  });

  test("the app can refuse the person", async () => {
    const { auth, p } = oidcSetup(undefined, async () => {
      throw new LoginRejected("Your account has no access to Questlog.");
    });
    const { state, cookie } = await start(auth, p);
    const res = await callback(auth, state, cookie);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Your account has no access to Questlog.");
  });

  test("an unreachable provider says so on the page", async () => {
    const s = setup({
      login: { kind: "oidc", issuer: ISSUER, clientId: "q", clientSecret: "s", grant: async () => ({}), fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch },
    });
    const client = await registerClient(s.auth);
    const { pendingId } = await startAuthorize(s.auth, client.client_id);
    const res = await call(s.auth, "POST", "/oauth/login", { body: { id: pendingId }, headers: ours });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("provider can&#x27;t be reached");
  });
});
