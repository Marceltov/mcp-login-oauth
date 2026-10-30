// The pages a person sees during login: the form or the sign-in button, and the dead ends that explain a broken
// flow. Ported from the Python package's pages.py; keep the wording of both in step.

export interface LoginField {
  name: string;
  label: string;
  type?: "text" | "password" | "email";
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  /** A sentence shown above the input. */
  hint?: string;
  /** Fields with the same group go into one collapsed section, titled by the group, after the ungrouped fields. */
  group?: string;
}

const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}" +
  "label{display:block;margin:.6rem 0}input,button{font:inherit;padding:.4rem;margin:.3rem 0;width:100%;" +
  "box-sizing:border-box}details{margin:1rem 0}summary{cursor:pointer}.hint{margin:.6rem 0 0}";

export function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);
}

// No framing, so the form can't be clickjacked; no caching and no referrer, since the URL carries the login link.
export const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function page(serviceName: string, inner: string, status: number, headers: HeadersInit = {}): Response {
  const e = escape(serviceName);
  const body =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${e} login</title><style>${STYLE}</style></head><body><h1>${e}</h1>${inner}</body></html>`;
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) h.set(k, v);
  return new Response(body, { status, headers: h });
}

function input(f: LoginField, first: boolean): string {
  const attrs = [`name="${escape(f.name)}"`, `type="${f.type ?? "text"}"`];
  if (f.required) attrs.push("required");
  if (f.autocomplete) attrs.push(`autocomplete="${escape(f.autocomplete)}"`);
  if (f.inputmode) attrs.push(`inputmode="${escape(f.inputmode)}"`);
  if (first) attrs.push("autofocus");
  const hint = f.hint ? `<p class="hint">${escape(f.hint)}</p>` : "";
  return `${hint}<label>${escape(f.label)} <input ${attrs.join(" ")}></label>`;
}

// Ungrouped fields in order, then one collapsed section per group, in order of first appearance.
// The first ungrouped field gets the focus; a field inside a closed section can't take it.
function inputs(fields: readonly LoginField[]): string {
  const plain = fields.filter((f) => !f.group);
  const groups = new Map<string, LoginField[]>();
  for (const f of fields) if (f.group) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  let html = plain.map((f, i) => input(f, i === 0)).join("");
  for (const [title, members] of groups) html += `<details><summary>${escape(title)}</summary>${members.map((f) => input(f, false)).join("")}</details>`;
  return html;
}

export interface LoginPage {
  serviceName: string;
  pendingId: string;
  clientName: string;
  redirectHost: string;
  action: string;
  error?: string;
  status?: number;
}

const intro = (p: LoginPage) =>
  (p.error ? `<p style="color:#b00">${escape(p.error)}</p>` : "") +
  `<p><b>${escape(p.clientName)}</b> wants access to your ${escape(p.serviceName)}. After login ` +
  `you will be sent to <b>${escape(p.redirectHost)}</b>. Only continue if you started this.</p>`;

/** Who is asking, where the code goes, and the form. */
export function loginPage(p: LoginPage & { fields: readonly LoginField[] }): Response {
  return page(
    p.serviceName,
    `${intro(p)}<form method="post" action="${escape(p.action)}"><input type="hidden" name="id" value="${escape(p.pendingId)}">` +
      `${inputs(p.fields)}<button>Authorize</button></form>`,
    p.status ?? 200,
  );
}

/** Who is asking, where the code goes, and one button that starts the sign-in at the provider. */
export function signInPage(p: LoginPage & { buttonLabel: string }): Response {
  return page(
    p.serviceName,
    `${intro(p)}<form method="post" action="${escape(p.action)}"><input type="hidden" name="id" value="${escape(p.pendingId)}">` +
      `<button autofocus>${escape(p.buttonLabel)}</button></form>`,
    p.status ?? 200,
  );
}

/**
 * A login that can't continue from here. The usual cause is the MCP client interrupting its own flow (claude.ai asking
 * you to log in to claude.ai partway through, then dropping the finished login), so say that it isn't the server's
 * fault and give the fix.
 */
export function deadEndPage(serviceName: string, heading: string, what: string, status: number, headers: HeadersInit = {}): Response {
  return page(
    serviceName,
    `<h2>${escape(heading)}</h2><p>${escape(what)}</p>` +
      "<p><b>Why:</b> your app most likely interrupted its own login, for example by asking you to " +
      "log in to the app itself partway through, and then lost track of this one. Nothing is wrong " +
      "with this server.</p><p><b>Fix:</b> go back to your app and use its Reconnect button, or " +
      "remove the connector and add it again. Being logged in to the app first avoids the " +
      "interruption.</p>",
    status,
    headers,
  );
}

/** A request that is wrong in itself (unknown client, unregistered redirect URI): nothing to redirect to. */
export function badRequestPage(serviceName: string, what: string): Response {
  return page(serviceName, `<h2>This login request can't be used</h2><p>${escape(what)}</p>`, 400);
}
