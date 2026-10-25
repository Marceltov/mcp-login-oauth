"""The pages a person sees during login: the form, and the dead ends that explain a broken flow."""

from collections.abc import Sequence
from dataclasses import dataclass
from html import escape
from typing import Literal

from starlette.responses import HTMLResponse

_STYLE = ("body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}"
          "label{display:block;margin:.6rem 0}input,button{font:inherit;padding:.4rem;margin:.3rem 0;width:100%;"
          "box-sizing:border-box}")


@dataclass(frozen=True)
class LoginField:
    """One input of the login form. Every value reaches `check_login` as a string ("" when left empty)."""

    name: str
    label: str
    type: Literal["text", "password", "email"] = "text"
    required: bool = False
    autocomplete: str | None = None
    inputmode: str | None = None


def _page(service_name: str, inner: str, status: int) -> HTMLResponse:
    e = escape(service_name)
    body = ('<!doctype html><html><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"<title>{e} login</title><style>{_STYLE}</style></head><body><h1>{e}</h1>{inner}</body></html>")
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
    return f"<label>{escape(field.label)} <input {' '.join(attrs)}></label>"


def login_page(*, service_name: str, fields: Sequence[LoginField], pending_id: str, client_name: str,
               redirect_host: str, error: str = "", status: int = 200) -> HTMLResponse:
    """Who is asking, where the code goes, and the form."""
    err = f'<p style="color:#b00">{escape(error)}</p>' if error else ""
    inputs = "".join(_input(f, i == 0) for i, f in enumerate(fields))
    return _page(service_name,
                 f"{err}<p><b>{escape(client_name)}</b> wants access to your {escape(service_name)}. After login "
                 f"you will be sent to <b>{escape(redirect_host)}</b>. Only continue if you started this.</p>"
                 f'<form method="post"><input type="hidden" name="id" value="{escape(pending_id)}">'
                 f"{inputs}<button>Authorize</button></form>", status)


def dead_end_page(service_name: str, heading: str, what: str, status: int) -> HTMLResponse:
    """A login that can't continue from here. The usual cause is the MCP client interrupting its own
    flow (claude.ai asking you to log in to claude.ai partway through, then dropping the finished login),
    so say that it isn't the server's fault and give the fix."""
    return _page(service_name,
                 f"<h2>{escape(heading)}</h2><p>{escape(what)}</p>"
                 "<p><b>Why:</b> your app most likely interrupted its own login, for example by asking you to "
                 "log in to the app itself partway through, and then lost track of this one. Nothing is wrong "
                 "with this server.</p><p><b>Fix:</b> go back to your app and use its Reconnect button, or "
                 "remove the connector and add it again. Being logged in to the app first avoids the "
                 "interruption.</p>", status)
