# mcp-login-oauth

OAuth 2.1 browser login for [FastMCP](https://gofastmcp.com) servers that sit in front of another
service. Clients that can't send a token header, such as claude.ai, the Claude desktop and mobile apps,
log in once with a form. The form is checked by the service behind the server, for example a Trilium
password, an InvoiceNinja email, password and 2FA code, or a Paperless username and password. The
client then only holds opaque OAuth tokens. Your server turns each login into a *grant*, such as a
service token minted at login, and reads it back in tool code.

The library provides:
- dynamic client registration, PKCE, refresh rotation and revocation, including revocation for public
  clients, which the MCP SDK's own `/revoke` rejects;
- a Fernet-encrypted file store that survives restarts;
- the login page with configurable fields, hints and collapsed sections for alternative logins, and
  honest dead-end pages for broken flows;
- tokens bound to this server (RFC 8707 resource indicators) and the issuer named on the code redirect
  (RFC 9207);
- protection against password guessing: a delay after each failed login, and login links that end after
  5 failures or 10 minutes;
- optional static header tokens next to OAuth.

A TypeScript package with the same behaviour, for MCP servers outside Python (and with an OpenID Connect
sign-in next to the form), lives in [`typescript/`](typescript/README.md).

Used by [trilium-mcp](https://github.com/Marceltov/trilium-mcp),
[invoiceninja-mcp](https://github.com/Marceltov/invoiceninja-mcp),
[paperless-ngx-mcp](https://github.com/Marceltov/paperless-ngx-mcp) and the recall engine in
[trilium-llm-wiki](https://github.com/Marceltov/trilium-llm-wiki).

## Install

Pinned by git tag until there is a PyPI release:

```bash
uv add "mcp-login-oauth @ git+https://github.com/Marceltov/mcp-login-oauth@v0.2.0"
```

Needs Python ≥ 3.12 and FastMCP ≥ 4.1.3.

## Example

```python
import os

import httpx
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from mcp_login_oauth import LoginField, LoginOAuthProvider, LoginRejected, build_store

trilium = httpx.AsyncClient(base_url="http://trilium:8080/etapi")

async def check_login(form):                       # the form's values, all strings
    r = await trilium.post("/auth/login", json={"password": form["password"]})
    if not r.is_success:
        raise LoginRejected(f"Trilium rejected the login (HTTP {r.status_code}).")
    return {"etapi_token": r.json()["authToken"]}  # the grant, stored encrypted

async def on_revoke(grant):                        # optional clean-up
    await trilium.post("/auth/logout", headers={"Authorization": grant["etapi_token"]})

auth = LoginOAuthProvider(
    base_url="https://trilium-mcp.example.org",
    store=build_store("/data/oauth", secret=os.environ["MCP_OAUTH_SECRET"], salt="trilium-mcp-oauth"),
    service_name="Trilium Notes",
    fields=[LoginField("password", "Trilium password", type="password", required=True)],
    check_login=check_login, on_revoke=on_revoke, token_prefix="tmcp_",
)
mcp = FastMCP("trilium", auth=auth)

@mcp.tool
async def get_app_info() -> dict:
    token = get_access_token().claims["grant"]["etapi_token"]
    return (await trilium.get("/app-info", headers={"Authorization": token})).json()
```

## Callbacks

| Argument | Signature | Purpose |
|---|---|---|
| `check_login` | `async (form: Mapping[str, str]) -> dict`<br>or `async (form, client: LoginClient) -> dict` | Turn the submitted form into the grant, or raise `LoginRejected("shown on the page")`. Any other exception shows "Could not reach <service>" (HTTP 502) and doesn't count as a failed attempt. Take a second argument to learn which client the login is for (see below). |
| `on_revoke` | `async (grant: dict) -> None` | Optional. Clean up when a client revokes, for example log out a minted token. Failures are logged; the revocation still happens. |
| `verify_static` | `async (token: str) -> dict \| None` | Optional. Accept a header token that isn't an OAuth token (a raw service token, a static password); the returned dict is the grant. Tokens starting with `token_prefix` never reach it. |

`LoginClient` carries `client_id`, `client_name` (what the client registered as, falling back to the
id) and `redirect_uri`. Use it to label a credential minted per client, for example an InvoiceNinja
API token named `MCP: claude.ai`. The name is chosen by the client, so it is a label, not proof of
identity.

Clients that send a raw token without `Bearer ` (ETAPI clients) need `BearerPrefixMiddleware` around
the app. `BearerPrefixMiddleware(app, schemes=("Token",))` also rewrites `Token <token>`, the form
Paperless clients send.

## Login fields

```python
LoginField(name, label, type="text", required=False, autocomplete=None, inputmode=None,
           hint=None, group=None)
```

`type` is `text`, `password` or `email`. `hint` is a sentence shown above the input. Fields with
the same `group` go into one collapsed section titled by the group, after the other fields. Use it for
a way to log in that most people don't need:

```python
fields = [
    LoginField("username", "Paperless username", autocomplete="username"),
    LoginField("password", "Paperless password", type="password", autocomplete="current-password"),
    LoginField("code", "Two-factor code, if enabled", autocomplete="one-time-code", inputmode="numeric"),
    LoginField("token", "API token", type="password", autocomplete="off",
               group="Signed in through single sign-on, with no Paperless password?",
               hint="Paste the API token from My Profile in Paperless instead, and leave the fields above empty."),
]
```

## Defaults

| Argument | Default |
|---|---|
| `pending_ttl` (login link) | 600 s |
| `code_ttl` | 300 s |
| `access_ttl` | 3600 s |
| `refresh_ttl` (rotated on every refresh) | 30 days |
| `failed_login_delay` | 1.0 s |
| `max_login_attempts` (per login link) | 5 |

## Notes

- The form is never stored or logged. Only the grant is stored, encrypted with a key derived from
  `secret`; changing the secret logs every client out.
- A client that names a `resource` (RFC 8707) gets codes and tokens bound to it. A token bound to
  anything other than `base_url` or the MCP endpoint is refused, and so is its refresh: this also
  logs clients out when `base_url` changes. Clients that send no `resource` are accepted.
- The code redirect carries `iss` (RFC 9207), and the authorization server metadata advertises
  `authorization_response_iss_parameter_supported`.
- Servers moving to this library from their own OAuth code don't carry their stored logins over:
  connected clients log in once more.
- The file store uses `caio`'s thread backend: its io_uring backend takes locked kernel memory per
  store, and Docker's default seccomp profile blocks io_uring.

## Development

```bash
uv sync
uv run pytest -q
```

## License

Copyright © 2026 Marcel Bruckner.

Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). You may use, modify, and redistribute it, but any modified version — **including one you run as a network service** — must be released under the same license with its source made available to its users, and the original copyright notice preserved. See [LICENSE](LICENSE) for the full terms.
