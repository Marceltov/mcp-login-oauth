import { createHash, randomBytes } from "node:crypto";
import { createLoginOAuth, LoginRejected, memoryStore, type Grant, type LoginOAuth, type LoginOAuthOptions, type Store } from "../src/index.js";

export const BASE = "https://app.example.org";
export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

export class FakeClock {
  t = Date.UTC(2026, 9, 30, 12, 0, 0);
  now = () => this.t;
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const passwordLogin: LoginOAuthOptions["login"] = {
  kind: "form",
  fields: [{ name: "password", label: "Password", type: "password", required: true }],
  async check(form): Promise<Grant> {
    if (form.password !== "right") throw new LoginRejected("Wrong password.");
    return { subject: "user-1", token: "service-token" };
  },
};

export function setup(overrides: Partial<LoginOAuthOptions> = {}) {
  const clock = new FakeClock();
  const store: Store = overrides.store ?? memoryStore({ now: clock.now });
  const logs: string[] = [];
  const auth = createLoginOAuth({
    baseUrl: BASE,
    serviceName: "Questlog",
    login: passwordLogin,
    store,
    tokenPrefix: "ql_",
    resources: ["/api/v1"],
    failedLoginDelayMs: 0,
    now: clock.now,
    log: (m) => logs.push(m),
    ...overrides,
  });
  return { auth, clock, store, logs };
}

export async function call(auth: LoginOAuth, method: string, path: string, init: { body?: string | Record<string, string>; json?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body: string | undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = typeof init.body === "string" ? init.body : new URLSearchParams(init.body).toString();
  }
  const res = await auth.handle(new Request(`${BASE}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }));
  if (!res) throw new Error(`no route for ${method} ${path}`);
  return res;
}

export async function registerClient(auth: LoginOAuth, extra: Record<string, unknown> = {}) {
  const res = await call(auth, "POST", "/oauth/register", { json: { client_name: "Claude", redirect_uris: [REDIRECT], ...extra } });
  return (await res.json()) as { client_id: string; client_secret?: string };
}

export async function startAuthorize(auth: LoginOAuth, clientId: string, extra: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", ...extra });
  const res = await call(auth, "GET", `/oauth/authorize?${q}`);
  const location = res.headers.get("location") ?? "";
  const pendingId = new URL(location, BASE).searchParams.get("id") ?? "";
  return { res, location, pendingId, verifier };
}

export const ours = { origin: BASE, "sec-fetch-site": "same-origin" };

/** Register, authorize and log in with the right password: the code and the verifier. */
export async function loginWithCode(auth: LoginOAuth, extra: Record<string, string> = {}) {
  const client = await registerClient(auth);
  const { pendingId, verifier } = await startAuthorize(auth, client.client_id, extra);
  const res = await call(auth, "POST", "/oauth/login", { body: { id: pendingId, password: "right" }, headers: ours });
  const to = new URL(res.headers.get("location") ?? "");
  return { client, pendingId, verifier, res, code: to.searchParams.get("code") ?? "", to };
}

export async function tokens(auth: LoginOAuth, extra: Record<string, string> = {}) {
  const { client, code, verifier } = await loginWithCode(auth, extra);
  const res = await call(auth, "POST", "/oauth/token", { body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT } });
  return { client, body: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number } };
}

export const bearer = (token: string, path = "/mcp") => new Request(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
