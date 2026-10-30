# Getting started: Python

A FastMCP server in front of Trilium Notes, where people sign in with their Trilium password.

## Install

Pinned by git tag until there is a PyPI release:

```bash
uv add "mcp-login-oauth @ git+https://github.com/Marceltov/mcp-login-oauth@v0.2.0"
```

Needs Python ≥ 3.12 and FastMCP ≥ 4.1.3.

## A server with a password login

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

What happens:

1. claude.ai registers, opens the login page and shows the person a password field.
2. `check_login` logs in to Trilium with it. A `LoginRejected` shows its message on the page; the person can try again.
3. The returned dict is the **grant**. It is stored encrypted, and every tool reads it from the access token.
4. When the client revokes, `on_revoke` logs the minted token out of Trilium.

## Next

- Every argument, the callbacks, the login fields and the defaults: [Python reference](../reference/python.md).
- Lifetimes, refusals and what is stored: [Behaviour](../reference/behaviour.md).
