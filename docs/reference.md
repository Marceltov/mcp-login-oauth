# Python API

```python
from mcp_login_oauth import (BearerPrefixMiddleware, LoginClient, LoginField, LoginOAuthProvider,
                             LoginRejected, build_store)
```

## `LoginOAuthProvider`

The FastMCP auth provider: pass it as `FastMCP(..., auth=...)`.

| Argument | |
|---|---|
| `base_url` | The server's public URL. It is the issuer. |
| `store` | Where clients, login links, codes and tokens live; usually `build_store(...)`. |
| `service_name` | Shown on the login page ("Log in to Trilium Notes"). |
| `fields` | The login form, a list of `LoginField`. |
| `check_login` | Turns the submitted form into the grant (below). |
| `token_prefix` | Prefix of every code and token this server issues, e.g. `"tmcp_"`. |
| `on_revoke` | Optional clean-up when a client revokes (below). |
| `verify_static` | Optional: accept header tokens that aren't OAuth tokens (below). |
| `pending_ttl`, `code_ttl`, `access_ttl`, `refresh_ttl`, `failed_login_delay`, `max_login_attempts` | Lifetimes and limits; defaults on [Lifetimes, flow and limits](behaviour.md#lifetimes-and-limits). |

Tools read the grant from the access token: `get_access_token().claims["grant"]`.

## Callbacks

| Argument | Signature | Purpose |
|---|---|---|
| `check_login` | `async (form: Mapping[str, str]) -> dict`<br>or `async (form, client: LoginClient) -> dict` | Turn the submitted form into the grant, or raise `LoginRejected("shown on the page")`. Any other exception shows "Could not reach <service>" (HTTP 502) and doesn't count as a failed attempt. Take a second argument to learn which client the login is for. |
| `on_revoke` | `async (grant: dict) -> None` | Clean up when a client revokes, for example log out a minted token. Failures are logged; the revocation still happens. |
| `verify_static` | `async (token: str) -> dict \| None` | Accept a header token that isn't an OAuth token (a raw service token, a static password); the returned dict is the grant. Tokens starting with `token_prefix` never reach it. |

`LoginClient` carries `client_id`, `client_name` (what the client registered as, falling back to the id) and `redirect_uri`. Use it to label a credential minted per client, for example an InvoiceNinja API token named `MCP: claude.ai`. The name is chosen by the client, so it is a label, not proof of identity ([ADR 0002](adr/0002-check-login-learns-the-client.md)).

## `LoginField`

```python
LoginField(name, label, type="text", required=False, autocomplete=None, inputmode=None,
           hint=None, group=None)
```

`type` is `text`, `password` or `email`. `hint` is a sentence shown above the input. Fields with the same `group` go into one collapsed section titled by the group, after the other fields. Use it for a way to log in that most people don't need:

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

## `build_store`

```python
build_store(directory: Path, secret: str, salt: str)
```

A Fernet-encrypted file tree under `directory`. A changed secret turns every stored entry into a miss: clients simply sign in again. It uses `caio`'s thread backend, because its io_uring backend takes locked kernel memory per store and Docker's default seccomp profile blocks io_uring.

## `BearerPrefixMiddleware`

Clients that send a raw token without `Bearer ` (ETAPI clients) need `BearerPrefixMiddleware(app)` around the app. `BearerPrefixMiddleware(app, schemes=("Token",))` also rewrites `Token <token>`, the form Paperless clients send.
