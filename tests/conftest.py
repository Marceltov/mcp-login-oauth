"""A FastMCP app with LoginOAuthProvider, a fake login check and a `whoami` tool that returns the grant."""

import base64
import hashlib
import secrets
from collections.abc import Callable

import httpx
import pytest
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from starlette.testclient import TestClient

from mcp_login_oauth import LoginField, LoginOAuthProvider, LoginRejected, build_store

BASE = "http://localhost:8000"
REDIRECT = "http://localhost:9/cb"
FIELDS = [LoginField("password", "Password", type="password", required=True)]


async def check(form):
    if form["password"] == "pw":
        return {"credential": "minted-1"}
    raise LoginRejected("Wrong password.")


def make_app(directory, **overrides):
    """The provider's keyword arguments can be overridden per test."""
    args = dict(base_url=BASE, store=build_store(directory, secret="k", salt="test"), service_name="Test",
                fields=FIELDS, check_login=check, token_prefix="tst_", failed_login_delay=0)
    provider = LoginOAuthProvider(**{**args, **overrides})
    mcp = FastMCP("test", auth=provider)

    @mcp.tool
    def whoami() -> dict:
        return get_access_token().claims["grant"]

    return mcp.http_app(path="/mcp", json_response=True, stateless_http=True, host_origin_protection=False)


@pytest.fixture
def app_factory(tmp_path) -> Callable[..., TestClient]:
    def factory(**overrides) -> TestClient:
        return TestClient(make_app(tmp_path / "store", **overrides), base_url=BASE)
    return factory


@pytest.fixture
def client(app_factory):
    with app_factory() as c:
        yield c


def register(http, name="claude.ai", **extra) -> dict:
    r = http.post("/register", json={"client_name": name, "redirect_uris": [REDIRECT],
                                     "token_endpoint_auth_method": "none",
                                     "grant_types": ["authorization_code", "refresh_token"],
                                     "response_types": ["code"], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def authorize(http, client_id) -> tuple[str, str]:
    """Start a login: (pending id, PKCE verifier)."""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    r = http.get("/authorize", params={"response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT,
                                       "code_challenge": challenge, "code_challenge_method": "S256", "state": "s"},
                 follow_redirects=False)
    assert r.status_code == 302, r.text
    return httpx.URL(r.headers["location"]).params["id"], verifier


def login(http, password="pw") -> dict:
    """register -> authorize -> /login -> /token; the token JSON plus client_id."""
    client_id = register(http)["client_id"]
    pending, verifier = authorize(http, client_id)
    r = http.post("/login", data={"id": pending, "password": password}, follow_redirects=False)
    assert r.status_code == 302, r.text
    code = httpx.URL(r.headers["location"]).params["code"]
    r = http.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                                  "client_id": client_id, "code_verifier": verifier})
    assert r.status_code == 200, r.text
    return {**r.json(), "client_id": client_id}


def call_whoami(http, token) -> httpx.Response:
    return http.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                   "params": {"name": "whoami", "arguments": {}}},
                     headers={"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"})


def whoami(http, token) -> dict:
    r = call_whoami(http, token)
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]
