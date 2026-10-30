// The OAuth 2.1 authorization server for an MCP server whose login is a form checked by the app, or a sign-in at an
// OpenID Connect provider. Framework-neutral: `handle` answers every OAuth route with a web Response, `verify` turns a
// bearer token into the grant the login produced. The behaviour matches the Python package (ADR 0003).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OidcClient, OidcError, httpsOrLoopback, type OidcPerson, type OidcProvider } from "./oidc.js";
import { badRequestPage, deadEndPage, loginPage, signInPage, type LoginField } from "./pages.js";
import type { Clock, Store } from "./store.js";

/** Whatever the login produced, for example the user's id. A string `subject` makes revokeSubject find it. */
export type Grant = Record<string, unknown> & { subject?: string };

/** The client a login is for, as it registered itself. The name is self-chosen: a label, not proof of identity. */
export interface LoginClient {
  clientId: string;
  clientName: string;
  redirectUri: string;
}

/** Thrown by a login callback when the login is refused; the message is shown on the page. */
export class LoginRejected extends Error {}

export interface FormLogin {
  kind: "form";
  fields: readonly LoginField[];
  /** Turn the submitted fields (all strings, "" when empty) into the grant, or throw LoginRejected. */
  check(form: Record<string, string>, client: LoginClient): Promise<Grant>;
}

export interface OidcLogin extends OidcProvider {
  kind: "oidc";
  /** The button on the authorize page, e.g. "Sign in with authentik". */
  buttonLabel?: string;
  /** Turn the signed-in person into the grant (create the user on first sign-in), or throw LoginRejected. */
  grant(person: OidcPerson, client: LoginClient): Promise<Grant>;
  fetch?: typeof fetch;
}

export interface LoginOAuthOptions {
  /** The public URL of the app, e.g. https://questlog.example.org. It is the issuer. */
  baseUrl: string;
  /** Path of the MCP endpoint, default "/mcp". */
  mcpPath?: string;
  /** Further paths (or URLs) a token may be bound to, each its own audience, e.g. ["/api/v1"]. */
  resources?: readonly string[];
  /** Where the OAuth endpoints live, default "/oauth" (/oauth/authorize, /oauth/token, …). */
  oauthPath?: string;
  serviceName: string;
  login: FormLogin | OidcLogin;
  store: Store;
  /** Prefix of every code and token this server issues, e.g. "ql_". */
  tokenPrefix: string;
  /** Clean up when a client revokes (log out a minted service token). Failures are logged; the revocation stands. */
  onRevoke?(grant: Grant): Promise<void>;
  /** Accept a header token that isn't one of ours (a static API token); the returned grant is used as is. */
  verifyStatic?(token: string): Promise<Grant | null>;
  ttl?: {
    /** Login link, default 600 s. */ pending?: number;
    /** Authorization code, default 300 s. */ code?: number;
    /** Access token, default 3600 s. */ access?: number;
    /** Refresh token, rotated on every use, default 30 days. */ refresh?: number;
    /** Optional cap on a whole grant: refreshes stop this long after the login. Default none. */ grant?: number;
  };
  /** Delay after a refused login, default 1000 ms. */
  failedLoginDelayMs?: number;
  /** Refused logins before a login link ends, default 5. */
  maxLoginAttempts?: number;
  /** Where errors are reported; never receives a form, a token or a person's details. Default console.error. */
  log?(message: string, details?: Record<string, unknown>): void;
  now?: Clock;
}

export interface Verified {
  clientId: string;
  grant: Grant;
  scopes: string[];
  /** The resource the token is bound to, if the client named one. */
  resource?: string;
  /** Epoch seconds; absent for static tokens. */
  expiresAt?: number;
}

export interface LoginOAuth {
  /** Answers the OAuth routes and the discovery documents; null for any other path. */
  handle(request: Request): Promise<Response | null>;
  /**
   * The grant behind the request's bearer token, or null. With `resource` (a path or URL), the token must be bound to
   * exactly that resource; a token bound to nothing counts as bound to the MCP endpoint.
   */
  verify(request: Request, options?: { resource?: string }): Promise<Verified | null>;
  /** A 401 that points MCP clients at the protected resource metadata. */
  unauthorized(resource?: string): Response;
  /** End every grant of a subject (all their clients), e.g. when the app deletes the user. Returns the token pairs ended. */
  revokeSubject(subject: string): Promise<number>;
}

const STATIC_CLIENT_ID = "static";
const MAX_BODY = 16 * 1024;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url of a SHA-256
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/; // RFC 7636 4.1
const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

interface Client {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: AuthMethod;
  client_secret?: string;
  client_id_issued_at: number;
}

interface AuthorizeParams {
  redirectUri: string;
  redirectUriExplicit: boolean;
  codeChallenge: string;
  state?: string;
  resource?: string;
  scopes: string[];
}

type Pending = { clientId: string; params: AuthorizeParams; attempts: number } | { done: true };
interface Flight {
  pendingId: string;
  nonce: string;
  verifier: string;
  binding: string; // SHA-256 of the cookie that ties the sign-in to the browser that started it
}
interface Code {
  clientId: string;
  params: AuthorizeParams;
  grant: Grant;
  loginAt: number;
}
interface Pair {
  clientId: string;
  scopes: string[];
  grant: Grant;
  resource?: string;
  loginAt: number;
  expiresAt: number;
}
type Access = Pair & { refresh: string };
type Refresh = Pair & { access: string };

const cors = { "Access-Control-Allow-Origin": "*" };
const noStore = { ...cors, "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200, headers: HeadersInit = noStore) => Response.json(body, { status, headers });
const oauthError = (error: string, status = 400, description?: string) => json(description ? { error, error_description: description } : { error }, status);
const preflight = (methods: string) =>
  new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": methods, "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version" } });
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const trim = (u: string) => u.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Where a redirect really goes: host and port, never the userinfo, which can pose as a host.
function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return null;
  const buf = await req.arrayBuffer().catch(() => null);
  return buf && buf.byteLength <= MAX_BODY ? new TextDecoder().decode(buf) : null;
}

// Form fields from a urlencoded body. A repeated parameter counts as missing (RFC 6749 3.1).
async function readForm(req: Request): Promise<((k: string) => string | undefined) | null> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const body = await readBody(req);
  if (body === null) return null;
  return single(new URLSearchParams(body));
}

const single = (p: URLSearchParams) => (k: string) => {
  const v = p.getAll(k);
  return v.length === 1 ? v[0] : undefined;
};

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function createLoginOAuth(options: LoginOAuthOptions): LoginOAuth {
  const now = options.now ?? Date.now;
  const seconds = () => Math.floor(now() / 1000);
  const base = trim(options.baseUrl);
  if (!httpsOrLoopback(`${base}/`)) throw new Error("createLoginOAuth: baseUrl must be https (plain http only on loopback)");
  const origin = new URL(base).origin;
  const issuer = base;
  const oauthPath = trim(options.oauthPath ?? "/oauth");
  const mcpPath = options.mcpPath ?? "/mcp";
  const basePath = new URL(base).pathname.replace(/\/$/, "");
  const abs = (p: string) => (/^https?:\/\//.test(p) ? trim(p) : `${base}${p.startsWith("/") ? p : `/${p}`}`);
  const mcpUrl = abs(mcpPath);
  const resourceUrls = [mcpUrl, ...(options.resources ?? []).map(abs)];
  const accepted = new Set([base, ...resourceUrls].map(trim));
  const endpoint = (name: string) => `${base}${oauthPath}/${name}`;
  const ttl = { pending: 600, code: 300, access: 3600, refresh: 30 * 24 * 3600, ...options.ttl };
  const delay = options.failedLoginDelayMs ?? 1000;
  const maxAttempts = options.maxLoginAttempts ?? 5;
  const prefix = options.tokenPrefix;
  const store = options.store;
  const log = options.log ?? ((message: string, details?: Record<string, unknown>) => console.error(`[mcp-login-oauth] ${message}`, details ?? ""));
  const login = options.login;
  const oidc = login.kind === "oidc" ? new OidcClient(login, login.fetch ?? fetch, now) : undefined;
  const secure = base.startsWith("https:");
  const FLIGHT_COOKIE = "mlo_flight";

  const forUs = (resource: string | undefined) => resource === undefined || accepted.has(trim(resource));
  const metadataUrl = (resource: string) => `${origin}/.well-known/oauth-protected-resource${new URL(resource).pathname.replace(/\/$/, "")}`;

  // -- discovery ---------------------------------------------------------------------------

  const authServerMetadata = () => ({
    issuer,
    authorization_endpoint: endpoint("authorize"),
    token_endpoint: endpoint("token"),
    registration_endpoint: endpoint("register"),
    revocation_endpoint: endpoint("revoke"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    authorization_response_iss_parameter_supported: true,
  });

  const protectedResource = (resource: string) => ({
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_name: options.serviceName,
  });

  // -- registration (RFC 7591) ----------------------------------------------------------------

  async function register(req: Request): Promise<Response> {
    const body = await readBody(req);
    let m: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = body ? JSON.parse(body) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) m = parsed as Record<string, unknown>;
    } catch {}
    if (!m) return oauthError("invalid_client_metadata", 400, "The body must be a JSON object.");
    const { client_name, redirect_uris } = m;
    const method = (m.token_endpoint_auth_method ?? "none") as AuthMethod;
    if (!Array.isArray(redirect_uris) || redirect_uris.length < 1 || redirect_uris.length > 5 || !redirect_uris.every(httpsOrLoopback))
      return oauthError("invalid_redirect_uri", 400, "1 to 5 redirect URIs, https or http on loopback, without a fragment.");
    // The name is shown on the login page: no control or format characters (a bidi override could disguise it).
    if (client_name !== undefined && (typeof client_name !== "string" || client_name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(client_name)))
      return oauthError("invalid_client_metadata", 400, "client_name: up to 100 characters, no control characters.");
    if (!AUTH_METHODS.includes(method)) return oauthError("invalid_client_metadata", 400, `token_endpoint_auth_method: one of ${AUTH_METHODS.join(", ")}.`);
    const client: Client = { client_id: random(16), redirect_uris, token_endpoint_auth_method: method, client_id_issued_at: seconds() };
    if (typeof client_name === "string") client.client_name = client_name;
    if (method !== "none") client.client_secret = random();
    await store.put("clients", client.client_id, client);
    return json(
      { ...client, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...(client.client_secret ? { client_secret_expires_at: 0 } : {}) },
      201,
    );
  }

  const getClient = async (id: string | undefined) => (id ? ((await store.get("clients", id)) as Client | undefined) : undefined);

  // The client of a token or revocation request, authenticated as it registered (RFC 6749 2.3.1).
  async function authenticate(req: Request, form: (k: string) => string | undefined): Promise<Client | null> {
    let id = form("client_id");
    let secret = form("client_secret");
    const auth = req.headers.get("authorization") ?? "";
    if (auth.toLowerCase().startsWith("basic ")) {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i < 0) return null;
      id = decodeURIComponent(decoded.slice(0, i));
      secret = decodeURIComponent(decoded.slice(i + 1));
    }
    const client = await getClient(id);
    if (!client) return null;
    if (client.token_endpoint_auth_method === "none") return client;
    return secret !== undefined && client.client_secret !== undefined && safeEqual(secret, client.client_secret) ? client : null;
  }

  // -- authorize ------------------------------------------------------------------------------

  async function authorize(req: Request): Promise<Response> {
    const one = single(new URL(req.url).searchParams);
    // Until client_id and redirect_uri check out, nothing redirects: that would make this an open redirector.
    const client = await getClient(one("client_id"));
    if (!client) return badRequestPage(options.serviceName, "The app that sent you here is not registered with this server. Go back to the app and connect again.");
    const asked = one("redirect_uri");
    const redirectUri = asked ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
    if (redirectUri === undefined || !client.redirect_uris.includes(redirectUri))
      return badRequestPage(options.serviceName, "The app asked to be sent back to an address it did not register.");

    const state = one("state");
    const back = (error: string) => {
      const to = new URL(redirectUri);
      to.searchParams.set("error", error);
      if (state !== undefined) to.searchParams.set("state", state);
      to.searchParams.set("iss", issuer);
      return Response.redirect(to.href, 302);
    };
    if (one("response_type") !== "code") return back("unsupported_response_type");
    const challenge = one("code_challenge");
    if (one("code_challenge_method") !== "S256" || challenge === undefined || !CHALLENGE_RE.test(challenge)) return back("invalid_request");
    const resource = one("resource");
    if (new URL(req.url).searchParams.has("resource") && (resource === undefined || !forUs(resource))) return back("invalid_target");

    const params: AuthorizeParams = { redirectUri, redirectUriExplicit: asked !== undefined, codeChallenge: challenge, scopes: (one("scope") ?? "").split(" ").filter(Boolean) };
    if (state !== undefined) params.state = state;
    if (resource !== undefined) params.resource = trim(resource);
    const pendingId = random();
    await store.put("pending", pendingId, { clientId: client.client_id, params, attempts: 0 } satisfies Pending, { ttl: ttl.pending });
    return Response.redirect(`${endpoint("login")}?id=${pendingId}`, 302);
  }

  // -- the login page ---------------------------------------------------------------------------

  const expired = () =>
    deadEndPage(
      options.serviceName,
      "Login link expired or already used",
      `Login links work once, for ${Math.round(ttl.pending / 60)} minutes, and end after ${maxAttempts} failed attempts.`,
      400,
    );
  const completed = () =>
    deadEndPage(
      options.serviceName,
      "Login already completed",
      "Your login was accepted a moment ago and the browser sent it a second time. If your app now shows the connector without tools, it dropped that finished login.",
      200,
    );

  type Context =
    | { kind: "stop"; response: Response }
    | { kind: "open"; pendingId: string; pending: Pending; who: LoginClient; show: (error?: string, status?: number) => Response };

  async function loginContext(pendingId: string | undefined): Promise<Context> {
    const pending = pendingId ? ((await store.get("pending", pendingId)) as Pending | undefined) : undefined;
    if (!pending) return { kind: "stop", response: expired() };
    if ("done" in pending) return { kind: "stop", response: completed() };
    const client = await getClient(pending.clientId);
    if (!client) return { kind: "stop", response: expired() };
    const who: LoginClient = { clientId: client.client_id, clientName: client.client_name ?? client.client_id, redirectUri: pending.params.redirectUri };
    const show = (error?: string, status = 200) => {
      const p = { serviceName: options.serviceName, pendingId: pendingId!, clientName: who.clientName, redirectHost: host(who.redirectUri), action: endpoint("login"), status, ...(error ? { error } : {}) };
      return login.kind === "form" ? loginPage({ ...p, fields: login.fields }) : signInPage({ ...p, buttonLabel: login.buttonLabel ?? "Sign in" });
    };
    return { kind: "open", pendingId: pendingId!, pending, who, show };
  }

  // A refused login: wait, count it, and end the link after too many.
  async function refused(pendingId: string, pending: Exclude<Pending, { done: true }>): Promise<void> {
    await sleep(delay);
    const attempts = pending.attempts + 1;
    if (attempts >= maxAttempts) await store.delete("pending", pendingId);
    else await store.put("pending", pendingId, { ...pending, attempts } satisfies Pending, { ttl: ttl.pending });
  }

  // The login succeeded: spend the link (keeping a marker, so a replayed form gets an honest answer) and send the code.
  async function finish(pendingId: string, pending: Exclude<Pending, { done: true }>, grant: Grant, extraHeaders: HeadersInit = {}): Promise<Response> {
    await store.put("pending", pendingId, { done: true } satisfies Pending, { ttl: ttl.pending });
    const code = prefix + random();
    const subject = typeof grant.subject === "string" ? grant.subject : undefined;
    await store.put("codes", code, { clientId: pending.clientId, params: pending.params, grant, loginAt: seconds() } satisfies Code, { ttl: ttl.code, ...(subject ? { subject } : {}) });
    const to = new URL(pending.params.redirectUri);
    to.searchParams.set("code", code);
    if (pending.params.state !== undefined) to.searchParams.set("state", pending.params.state);
    to.searchParams.set("iss", issuer); // RFC 9207: exactly the metadata's issuer
    const headers = new Headers(extraHeaders);
    headers.set("Location", to.href);
    headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 302, headers });
  }

  // A POST to the login page must come from our own page: an auto-submitting form on another site must never sign a
  // logged-in person into a client they never saw (registration is open to anyone).
  const crossSite = (req: Request) => {
    const o = req.headers.get("origin");
    if (o !== null && o !== "null" && o !== origin) return true;
    return req.headers.get("sec-fetch-site") === "cross-site";
  };

  async function loginRoute(req: Request): Promise<Response> {
    if (req.method === "GET") {
      const ctx = await loginContext(new URL(req.url).searchParams.get("id") ?? undefined);
      return ctx.kind === "stop" ? ctx.response : ctx.show();
    }
    if (crossSite(req)) return new Response("Forbidden", { status: 403 });
    const form = await readForm(req);
    if (!form) return new Response("Bad request", { status: 400 });
    const ctx = await loginContext(form("id"));
    if (ctx.kind === "stop") return ctx.response;
    const { pendingId, pending, who, show } = ctx;
    if ("done" in pending) return completed();

    if (login.kind === "form") {
      // Only declared fields, only text: a missing field is "".
      const values = Object.fromEntries(login.fields.map((f) => [f.name, form(f.name) ?? ""]));
      let grant: Grant;
      try {
        grant = await login.check(values, who);
      } catch (e) {
        if (e instanceof LoginRejected) {
          await refused(pendingId, pending);
          return show(e.message, 401);
        }
        log("login check failed", { error: e instanceof Error ? e.message : String(e) }); // never the form
        return show(`Could not reach ${options.serviceName}.`, 502);
      }
      return finish(pendingId, pending, grant);
    }

    // OIDC: send the browser to the provider; the flight is stored, and bound to this browser by a cookie.
    let meta;
    try {
      meta = await oidc!.discover();
    } catch (e) {
      log("sign-in could not start", e instanceof OidcError ? { reason: e.message, ...e.details } : { error: String(e) });
      return show("The sign-in provider can't be reached right now. Try again in a moment.", 502);
    }
    const state = random(16);
    const binding = random();
    const flight: Flight = { pendingId, nonce: random(16), verifier: random(), binding: sha256(binding) };
    await store.put("flights", state, flight, { ttl: ttl.pending });
    const to = oidc!.authorizeUrl(meta, { redirectUri: endpoint("callback"), state, nonce: flight.nonce, challenge: sha256(flight.verifier) });
    return new Response(null, { status: 303, headers: { Location: to, "Set-Cookie": flightCookie(binding, ttl.pending), "Cache-Control": "no-store" } });
  }

  const flightCookie = (value: string, maxAge: number) => `${FLIGHT_COOKIE}=${value}; Path=${basePath}${oauthPath}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  async function callback(req: Request): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const clear = { "Set-Cookie": flightCookie("", 0) };
    const state = params.get("state");
    const flight = state ? ((await store.take("flights", state)) as Flight | undefined) : undefined;
    const binding = cookie(req, FLIGHT_COOKIE);
    // A sign-in that this browser didn't start (or that was already used) is never completed.
    if (!flight || binding === undefined || !safeEqual(sha256(binding), flight.binding))
      return deadEndPage(options.serviceName, "Sign-in can't be completed here", "This sign-in was started in another browser, took too long, or was already used.", 400, clear);
    const ctx = await loginContext(flight.pendingId);
    if (ctx.kind === "stop") {
      ctx.response.headers.append("Set-Cookie", clear["Set-Cookie"]);
      return ctx.response;
    }
    const { pendingId, pending, who, show } = ctx;
    if ("done" in pending) return completed();
    const page = (r: Response) => {
      r.headers.append("Set-Cookie", clear["Set-Cookie"]);
      return r;
    };

    let person: OidcPerson;
    try {
      if (params.has("error")) throw new OidcError("provider denied the sign-in", { error: (params.get("error") ?? "").slice(0, 64) });
      const code = params.get("code");
      if (!code) throw new OidcError("no code in the callback");
      const meta = await oidc!.discover();
      person = await oidc!.exchange(meta, { code, redirectUri: endpoint("callback"), verifier: flight.verifier, nonce: flight.nonce });
    } catch (e) {
      if (!(e instanceof OidcError)) throw e;
      log("sign-in failed", { reason: e.message, ...e.details }); // never who
      await refused(pendingId, pending);
      return page(show("The sign-in did not succeed. Try again.", 401));
    }
    let grant: Grant;
    try {
      grant = await (login as OidcLogin).grant(person, who);
    } catch (e) {
      if (!(e instanceof LoginRejected)) throw e;
      await refused(pendingId, pending);
      return page(show(e.message, 403));
    }
    return finish(pendingId, pending, grant, clear);
  }

  // -- tokens ------------------------------------------------------------------------------------

  async function issue(clientId: string, scopes: string[], grant: Grant, resource: string | undefined, loginAt: number): Promise<Response> {
    const access = prefix + random();
    const refresh = prefix + random();
    const t = seconds();
    const subject = typeof grant.subject === "string" ? { subject: grant.subject } : {};
    const common = { clientId, scopes, grant, loginAt, ...(resource !== undefined ? { resource } : {}) };
    await store.put("access", access, { ...common, refresh, expiresAt: t + ttl.access } satisfies Access, { ttl: ttl.access, ...subject });
    await store.put("refresh", refresh, { ...common, access, expiresAt: t + ttl.refresh } satisfies Refresh, { ttl: ttl.refresh, ...subject });
    return json({ access_token: access, token_type: "Bearer", expires_in: ttl.access, refresh_token: refresh, ...(scopes.length ? { scope: scopes.join(" ") } : {}) });
  }

  // Every check runs before the code or refresh token is spent, so a failed attempt (a wrong verifier from someone who
  // intercepted the code) can't burn the legitimate client's grant. `take` then spends it exactly once.
  async function token(req: Request): Promise<Response> {
    const form = await readForm(req);
    if (!form) return oauthError("invalid_request", 400, "Expected an application/x-www-form-urlencoded body.");
    const client = await authenticate(req, form);
    if (!client) return oauthError("invalid_client", 401);
    const grantType = form("grant_type");
    const resource = form("resource");
    if (resource !== undefined && !forUs(resource)) return oauthError("invalid_target");

    if (grantType === "authorization_code") {
      const [code, redirectUri, verifier] = [form("code"), form("redirect_uri"), form("code_verifier")];
      if (!code || !verifier) return oauthError("invalid_request");
      const c = (await store.get("codes", code)) as Code | undefined;
      if (!c || c.clientId !== client.client_id) return oauthError("invalid_grant", 400, "Authorization code not found or already used.");
      if (c.params.redirectUriExplicit ? redirectUri !== c.params.redirectUri : redirectUri !== undefined && redirectUri !== c.params.redirectUri) return oauthError("invalid_grant", 400, "redirect_uri does not match.");
      if (!VERIFIER_RE.test(verifier) || sha256(verifier) !== c.params.codeChallenge) return oauthError("invalid_grant", 400, "code_verifier does not match.");
      if (resource !== undefined && c.params.resource !== undefined && trim(resource) !== c.params.resource) return oauthError("invalid_target");
      if (!(await store.take("codes", code))) return oauthError("invalid_grant", 400, "Authorization code not found or already used.");
      return issue(client.client_id, c.params.scopes, c.grant, c.params.resource ?? (resource !== undefined ? trim(resource) : undefined), c.loginAt);
    }

    if (grantType === "refresh_token") {
      const token = form("refresh_token");
      if (!token) return oauthError("invalid_request");
      const r = (await store.get("refresh", token)) as Refresh | undefined;
      if (!r || r.clientId !== client.client_id) return oauthError("invalid_grant", 400, "Refresh token not found or already used.");
      // Bound to another server, or to our old URL (the base URL changed): make the client sign in again.
      if (!forUs(r.resource)) return oauthError("invalid_grant", 400, "Refresh token was issued for another resource.");
      if (resource !== undefined && r.resource !== undefined && trim(resource) !== r.resource) return oauthError("invalid_target");
      const asked = (form("scope") ?? "").split(" ").filter(Boolean);
      if (!asked.every((s) => r.scopes.includes(s))) return oauthError("invalid_scope", 400, "Requested scopes exceed the original grant.");
      if (ttl.grant !== undefined && seconds() > r.loginAt + ttl.grant) return oauthError("invalid_grant", 400, "The login has ended; sign in again.");
      if (!(await store.take("refresh", token))) return oauthError("invalid_grant", 400, "Refresh token not found or already used.");
      await store.delete("access", r.access); // rotate: the old pair dies, the grant lives on
      return issue(client.client_id, asked.length ? asked : r.scopes, r.grant, r.resource, r.loginAt);
    }

    return oauthError(grantType === undefined ? "invalid_request" : "unsupported_grant_type");
  }

  async function dropPair(access: string, refresh: string, grant: Grant): Promise<void> {
    await store.delete("access", access);
    await store.delete("refresh", refresh);
    if (!options.onRevoke) return;
    try {
      await options.onRevoke(grant);
    } catch (e) {
      // The pair is gone already; a failed clean-up only leaves a stray credential.
      log("onRevoke failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // RFC 7009 for public and confidential clients. A token that isn't the caller's is left alone, and the answer is 200
  // either way, so the endpoint reveals nothing about other clients' tokens.
  async function revoke(req: Request): Promise<Response> {
    const form = await readForm(req);
    if (!form) return oauthError("invalid_request");
    const client = await authenticate(req, form);
    if (!client) return oauthError("invalid_client", 401);
    const t = form("token");
    if (t) {
      const refresh = (await store.get("refresh", t)) as Refresh | undefined;
      const access = refresh ? undefined : ((await store.get("access", t)) as Access | undefined);
      if (refresh && refresh.clientId === client.client_id) await dropPair(refresh.access, t, refresh.grant);
      else if (access && access.clientId === client.client_id) await dropPair(t, access.refresh, access.grant);
    }
    return new Response(null, { status: 200, headers: noStore });
  }

  // -- routing -----------------------------------------------------------------------------------

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    let path = url.pathname;
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || "/";
    const method = req.method.toUpperCase();
    const wellKnown = url.pathname; // discovery documents live at the origin's root (RFC 8414, RFC 9728)

    if (wellKnown === "/.well-known/oauth-authorization-server" || wellKnown === `/.well-known/oauth-authorization-server${basePath}`) {
      if (method === "OPTIONS") return preflight("GET");
      return method === "GET" ? json(authServerMetadata(), 200, cors) : null;
    }
    if (wellKnown.startsWith("/.well-known/oauth-protected-resource")) {
      const suffix = wellKnown.slice("/.well-known/oauth-protected-resource".length);
      const resource = suffix === "" ? mcpUrl : resourceUrls.find((r) => new URL(r).pathname.replace(/\/$/, "") === suffix);
      if (!resource) return null;
      if (method === "OPTIONS") return preflight("GET");
      return method === "GET" ? json(protectedResource(resource), 200, cors) : null;
    }
    if (!path.startsWith(`${oauthPath}/`)) return null;
    const name = path.slice(oauthPath.length + 1);
    switch (`${method} ${name}`) {
      case "OPTIONS register":
      case "OPTIONS token":
      case "OPTIONS revoke":
        return preflight("POST");
      case "POST register":
        return register(req);
      case "GET authorize":
        return authorize(req);
      case "GET login":
      case "POST login":
        return loginRoute(req);
      case "GET callback":
        return login.kind === "oidc" ? callback(req) : null;
      case "POST token":
        return token(req);
      case "POST revoke":
        return revoke(req);
      default:
        return null;
    }
  }

  async function verify(req: Request, opts: { resource?: string } = {}): Promise<Verified | null> {
    const header = req.headers.get("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!m) return null;
    const t = m[1]!;
    if (t.startsWith(prefix)) {
      // Ours, or a stale one of ours: never hand it to verifyStatic as a service credential.
      const a = (await store.get("access", t)) as Access | undefined;
      if (!a || a.expiresAt <= seconds() || !forUs(a.resource)) return null;
      if (opts.resource !== undefined && trim(abs(opts.resource)) !== trim(a.resource ?? mcpUrl)) return null;
      return { clientId: a.clientId, grant: a.grant, scopes: a.scopes, expiresAt: a.expiresAt, ...(a.resource !== undefined ? { resource: a.resource } : {}) };
    }
    if (!options.verifyStatic) return null;
    try {
      const grant = await options.verifyStatic(t);
      return grant ? { clientId: STATIC_CLIENT_ID, grant, scopes: [] } : null;
    } catch (e) {
      log("verifyStatic failed", { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  function unauthorized(resource?: string): Response {
    const r = resource === undefined ? mcpUrl : abs(resource);
    return Response.json(
      { error: "invalid_token", error_description: "Sign in through OAuth to use this server." },
      { status: 401, headers: { ...cors, "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl(r)}"`, "Access-Control-Expose-Headers": "WWW-Authenticate" } },
    );
  }

  async function revokeSubject(subject: string): Promise<number> {
    // Codes, access and refresh tokens of the subject are gone in one step; then clean up once per pair.
    const pairs = (await store.takeSubject(subject)).filter((e) => e.collection === "refresh").map((e) => e.value as Refresh);
    for (const r of pairs) {
      await store.delete("access", r.access); // an access token whose refresh was rotated in the meantime
      if (!options.onRevoke) continue;
      try {
        await options.onRevoke(r.grant);
      } catch (e) {
        log("onRevoke failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return pairs.length;
  }

  return { handle, verify, unauthorized, revokeSubject };
}


