"""The pages a person sees during login: the form, and the dead ends that explain a broken flow."""

from collections.abc import Sequence
from dataclasses import dataclass
from html import escape
from typing import Literal

from starlette.responses import HTMLResponse

# Cobalt on ink, the docs site's colours; light and dark follow the browser. No JavaScript, no web fonts and
# nothing loaded from elsewhere: the page sits in an OAuth flow and stands on its own.
_STYLE = (
    ":root{--accent:#2348a8;--accent-hover:#1b2f73;--ink:#121a2b;--muted:#4a5570;--line:#c9d1e0;--hair:rgba(18,26,43,.1);"
    "--bg:#edf1f8;--card:#fff;--field:#fff;--danger:#a3261b;--danger-bg:#fdf0ee;--focus:#1b2f73;--on-accent:#fff;"
    "color-scheme:light dark}"
    "@media (prefers-color-scheme:dark){:root{--accent:#9db6ff;--accent-hover:#c7d5ff;--ink:#e3e7ef;--muted:#a7b0c4;"
    "--line:#3a4560;--hair:rgba(227,231,239,.1);--bg:hsl(224 26% 9%);--card:hsl(224 24% 13%);--field:hsl(224 26% 10%);"
    "--danger:#ffb4a8;--danger-bg:rgba(255,120,100,.1);--focus:#9db6ff;--on-accent:hsl(224 26% 9%)}}"
    "*{box-sizing:border-box}"
    "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem 1rem;background:var(--bg);"
    'color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    ".card{width:100%;max-width:26rem;background:var(--card);border:1px solid var(--hair);border-radius:14px;"
    "padding:2rem 1.75rem;box-shadow:0 1px 2px rgba(18,26,43,.04),0 12px 32px -12px rgba(18,26,43,.18)}"
    ".eyebrow{margin:0 0 .35rem;font:600 .72rem/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"
    "letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}"
    'h1{margin:0 0 1rem;font:600 1.85rem/1.15 "Iowan Old Style",Charter,Georgia,serif;letter-spacing:-.01em;'
    "overflow-wrap:anywhere}"
    "h2{margin:0 0 .5rem;font-size:1.1rem;line-height:1.35}p{margin:0 0 1rem}"
    ".consent{color:var(--muted)}.consent b{color:var(--ink);font-weight:600}"
    ".host{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere}"
    ".warn{color:var(--ink);font-weight:600}"
    ".error{margin:0 0 1.25rem;padding:.7rem .9rem;border-radius:8px;border-left:3px solid var(--danger);"
    "background:var(--danger-bg);color:var(--danger);font-weight:500}"
    "form{margin:1.25rem 0 0}label{display:block;margin:0 0 1rem;font-weight:600;font-size:.94rem}"
    ".hint{margin:0 0 .35rem;font-size:.88rem;color:var(--muted)}"
    "input{display:block;width:100%;margin-top:.35rem;padding:.65rem .8rem;font:inherit;font-weight:400;"
    "color:var(--ink);background:var(--field);border:1px solid var(--line);border-radius:8px}"
    "input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px;"
    "border-color:var(--accent)}"
    "details{margin:0 0 1rem;border:1px solid var(--hair);border-radius:8px;padding:.6rem .85rem}"
    "details[open]{padding-bottom:.1rem}"
    "summary{display:flex;gap:.6em;align-items:baseline;cursor:pointer;font-size:.92rem;font-weight:600;"
    "color:var(--muted);list-style:none}summary::-webkit-details-marker{display:none}"
    'summary::before{content:"";flex:none;display:inline-block;width:.45em;height:.45em;margin-bottom:.12em;'
    "border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(-45deg);transition:transform .15s}"
    "details[open] summary{margin-bottom:.85rem}details[open] summary::before{transform:rotate(45deg)}"
    "button{width:100%;margin-top:.25rem;padding:.75rem 1rem;font:inherit;font-weight:600;line-height:1.2;"
    "color:var(--on-accent);background:var(--accent);border:0;border-radius:8px;cursor:pointer}"
    "button:hover{background:var(--accent-hover)}"
    ".steps p{padding-left:.9rem;border-left:2px solid var(--hair)}"
    ".steps b{display:block;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}"
    "@media (prefers-reduced-motion:reduce){summary::before{transition:none}}"
)


@dataclass(frozen=True)
class LoginField:
    """One input of the login form. Every value reaches `check_login` as a string ("" when left empty).

    `hint` is a sentence shown above the input. Fields with the same `group` go into one collapsed
    section, titled by the group, after the ungrouped fields: an alternative way to log in that most
    people don't need, such as an API token for single-sign-on accounts."""

    name: str
    label: str
    type: Literal["text", "password", "email"] = "text"
    required: bool = False
    autocomplete: str | None = None
    inputmode: str | None = None
    hint: str | None = None
    group: str | None = None


def _page(service_name: str, eyebrow: str, inner: str, status: int) -> HTMLResponse:
    e = escape(service_name)
    body = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"<title>{e} login</title><style>{_STYLE}</style></head><body>"
            f'<main class="card"><p class="eyebrow">{escape(eyebrow)}</p><h1>{e}</h1>{inner}</main></body></html>')
    # DENY framing so the form can't be clickjacked.
    return HTMLResponse(body, status_code=status, headers={"X-Frame-Options": "DENY"})


def _input(field: LoginField, first: bool) -> str:
    attrs = [f'name="{escape(field.name)}"', f'type="{field.type}"']
    if field.required:
        attrs.append("required")
    if field.autocomplete:
        attrs.append(f'autocomplete="{escape(field.autocomplete)}"')
    if field.inputmode:
        attrs.append(f'inputmode="{escape(field.inputmode)}"')
    if first:
        attrs.append("autofocus")
    hint = f'<p class="hint">{escape(field.hint)}</p>' if field.hint else ""
    return f"{hint}<label>{escape(field.label)} <input {' '.join(attrs)}></label>"


def _inputs(fields: Sequence[LoginField]) -> str:
    """Ungrouped fields in order, then one collapsed section per group, in order of first appearance.
    The first ungrouped field gets the focus; a field inside a closed section can't take it."""
    plain = [f for f in fields if not f.group]
    groups: dict[str, list[LoginField]] = {}
    for f in fields:
        if f.group:
            groups.setdefault(f.group, []).append(f)
    html = "".join(_input(f, i == 0) for i, f in enumerate(plain))
    for title, members in groups.items():
        html += (f"<details><summary>{escape(title)}</summary>"
                 f"{''.join(_input(f, False) for f in members)}</details>")
    return html


def login_page(*, service_name: str, fields: Sequence[LoginField], pending_id: str, client_name: str,
               redirect_host: str, error: str = "", status: int = 200) -> HTMLResponse:
    """Who is asking, where the code goes, and the form."""
    err = f'<p class="error" role="alert">{escape(error)}</p>' if error else ""
    inputs = _inputs(fields)
    return _page(service_name, "Sign in",
                 f'{err}<p class="consent"><b>{escape(client_name)}</b> wants access to your {escape(service_name)}. '
                 f'After login you will be sent to <b class="host">{escape(redirect_host)}</b>. '
                 '<span class="warn">Only continue if you started this.</span></p>'
                 f'<form method="post"><input type="hidden" name="id" value="{escape(pending_id)}">'
                 f"{inputs}<button>Authorize</button></form>", status)


def dead_end_page(service_name: str, heading: str, what: str, status: int) -> HTMLResponse:
    """A login that can't continue from here. The usual cause is the MCP client interrupting its own
    flow (claude.ai asking you to log in to claude.ai partway through, then dropping the finished login),
    so say that it isn't the server's fault and give the fix."""
    return _page(service_name, "Login can't continue",
                 f'<h2>{escape(heading)}</h2><p class="consent">{escape(what)}</p><div class="steps">'
                 "<p><b>Why</b>Your app most likely interrupted its own login, for example by asking you to "
                 "log in to the app itself partway through, and then lost track of this one. Nothing is wrong "
                 "with this server.</p><p><b>Fix</b>Go back to your app and use its Reconnect button, or "
                 "remove the connector and add it again. Being logged in to the app first avoids the "
                 "interruption.</p></div>", status)
