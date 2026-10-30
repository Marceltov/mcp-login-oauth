// The OpenID Connect relying party for the `oidc` login: discovery, the authorize URL (code + PKCE S256, state, nonce)
// and the code exchange with the id_token's claims checked. Ported from freundebuch (backend/oidc/flow.ts).

export interface OidcProvider {
  /** The provider's issuer URL, e.g. https://auth.example.org/application/o/questlog/ */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Defaults to "openid profile email". */
  scope?: string;
}

/** The signed-in person, from the id_token. `claims` holds every claim, for apps that need more. */
export interface OidcPerson {
  sub: string;
  name?: string;
  email?: string;
  emailVerified: boolean;
  claims: Record<string, unknown>;
}

interface Meta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

/** Why a sign-in failed, for the log. Never carries the person's details or the provider's error description. */
export class OidcError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

const fail = (message: string, details?: Record<string, string | number>): never => {
  throw new OidcError(message, details);
};

/** https anywhere, plain http only on loopback. No fragment. Also the rule for redirect URIs. */
export function httpsOrLoopback(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 512 || u.includes("#") || !URL.canParse(u)) return false;
  const { protocol, hostname } = new URL(u);
  return protocol === "https:" || (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"));
}

// Issuers compare exactly, except for one trailing slash, which names the same provider and which operators get wrong.
const bare = (issuer: string) => issuer.replace(/\/$/, "");
const sameIssuer = (a: unknown, b: string) => typeof a === "string" && bare(a) === bare(b);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

// Control, separator and text-direction characters: they let a name read as another.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g;

function nameFrom(c: Record<string, unknown>): string | undefined {
  for (const k of ["name", "preferred_username", "email"]) {
    const v = c[k];
    const clean = typeof v === "string" ? v.replace(FORBIDDEN, " ").trim() : "";
    if (clean) return clean;
  }
  return undefined;
}

export class OidcClient {
  private cache: { at: number; meta: Meta } | undefined;

  constructor(
    private readonly provider: OidcProvider,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async getJson(url: string, init: RequestInit, reason: string): Promise<Record<string, unknown>> {
    let res: Response;
    let body: unknown;
    try {
      res = await this.fetchFn(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
      body = await res.json().catch(() => undefined);
    } catch (e) {
      const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
      return fail(reason, { error: typeof code === "string" ? code : e instanceof Error ? e.name : "unknown" });
    }
    if (!res.ok) return fail(reason, { status: res.status, ...(isObject(body) && typeof body.error === "string" ? { error: body.error.slice(0, 64) } : {}) });
    if (!isObject(body)) return fail(reason, { status: res.status, error: "not a JSON object" });
    return body;
  }

  async discover(): Promise<Meta> {
    const { issuer } = this.provider;
    if (this.cache && this.now() - this.cache.at < 3_600_000) return this.cache.meta;
    // TLS to the provider is what lets exchange skip the id_token's signature: https, or plain http on loopback only.
    if (!httpsOrLoopback(issuer)) fail("issuer is not an https URL");
    const doc = await this.getJson(`${bare(issuer)}/.well-known/openid-configuration`, { headers: { accept: "application/json" } }, "discovery failed");
    if (!sameIssuer(doc.issuer, issuer)) fail("issuer does not match the discovery document");
    const { authorization_endpoint, token_endpoint } = doc;
    if (!httpsOrLoopback(authorization_endpoint)) fail("authorization_endpoint is not https");
    if (!httpsOrLoopback(token_endpoint)) fail("token_endpoint is not https");
    const meta: Meta = { issuer, authorization_endpoint: authorization_endpoint as string, token_endpoint: token_endpoint as string };
    this.cache = { at: this.now(), meta };
    return meta;
  }

  authorizeUrl(meta: Meta, p: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
    const u = new URL(meta.authorization_endpoint);
    const q = {
      response_type: "code",
      client_id: this.provider.clientId,
      redirect_uri: p.redirectUri,
      scope: this.provider.scope ?? "openid profile email",
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    };
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.href;
  }

  async exchange(meta: Meta, p: { code: string; redirectUri: string; verifier: string; nonce: string }): Promise<OidcPerson> {
    const { clientId, clientSecret } = this.provider;
    const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: clientId, client_secret: clientSecret });
    const res = await this.getJson(meta.token_endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body }, "token request rejected");
    // The id_token's signature is not verified: it came straight from the token endpoint over TLS, which
    // OIDC Core 3.1.3.7 lets stand in for it. Verify against the provider's JWKS if tokens ever arrive another way.
    return this.check(payload(res.id_token), meta, p.nonce);
  }

  // OIDC Core 3.1.3.7: issuer, audience (azp whenever there are several, or one is given), expiry, nonce, subject.
  private check(c: Record<string, unknown>, meta: Meta, nonce: string): OidcPerson {
    const { clientId } = this.provider;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    const invalid = (check: string) => fail("id_token invalid", { check });
    if (!sameIssuer(c.iss, meta.issuer)) invalid("iss");
    if (!aud.includes(clientId)) invalid("aud");
    if ((aud.length !== 1 || c.azp !== undefined) && c.azp !== clientId) invalid("azp");
    if (typeof c.exp !== "number" || c.exp * 1000 <= this.now()) invalid("exp");
    if (c.nonce !== nonce) invalid("nonce");
    const sub = str(c.sub) ?? invalid("sub");
    const person: OidcPerson = { sub, emailVerified: c.email_verified === true, claims: c };
    const name = nameFrom(c);
    const email = str(c.email);
    if (name !== undefined) person.name = name;
    if (email !== undefined) person.email = email;
    return person;
  }
}

function payload(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== "string") fail("token response has no id_token");
  const parts = (idToken as string).split(".");
  let c: unknown;
  try {
    if (parts.length === 3) c = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  } catch {}
  return isObject(c) ? c : fail("id_token invalid", { check: "malformed" });
}
