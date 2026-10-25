import httpx
from conftest import BASE, authorize, call_whoami, login, register, whoami


def test_discovery_names_the_base_url(client):
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"].rstrip("/") == BASE
    assert meta["authorization_endpoint"] == f"{BASE}/authorize"
    assert client.get("/.well-known/oauth-protected-resource/mcp").json()["resource"] == f"{BASE}/mcp"


def test_mcp_without_token_is_401_with_resource_metadata(client):
    r = client.post("/mcp", json={})
    assert r.status_code == 401 and "resource_metadata" in r.headers["www-authenticate"]


def test_login_grant_reaches_the_tool(client):
    tokens = login(client)
    assert tokens["access_token"].startswith("tst_") and tokens["expires_in"] == 3600
    assert whoami(client, tokens["access_token"]) == {"credential": "minted-1"}


def test_refresh_rotates_and_old_access_dies(client):
    tokens = login(client)
    r = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                    "client_id": tokens["client_id"]})
    assert r.status_code == 200
    assert whoami(client, r.json()["access_token"]) == {"credential": "minted-1"}
    assert call_whoami(client, tokens["access_token"]).status_code == 401
    reuse = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                        "client_id": tokens["client_id"]})
    assert reuse.status_code in (400, 401) and reuse.json()["error"] in ("invalid_grant", "invalid_token"), reuse.text


def test_logins_survive_a_restart(app_factory):
    with app_factory() as first:
        tokens = login(first)
    with app_factory() as second:
        assert whoami(second, tokens["access_token"]) == {"credential": "minted-1"}


def test_redirect_carries_the_advertised_issuer(client):
    """RFC 9207: the code redirect names the authorization server, and discovery says it does."""
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["authorization_response_iss_parameter_supported"] is True
    client_id = register(client)["client_id"]
    pending, _ = authorize(client, client_id)
    r = client.post("/login", data={"id": pending, "password": "pw"}, follow_redirects=False)
    assert httpx.URL(r.headers["location"]).params["iss"] == meta["issuer"]


def test_token_for_this_server_works(client):
    for resource in (BASE, f"{BASE}/mcp", f"{BASE}/mcp/"):
        tokens = login(client, resource=resource)
        assert whoami(client, tokens["access_token"]) == {"credential": "minted-1"}


def test_token_for_another_server_is_refused(client):
    """RFC 8707: a token bound to some other resource neither works here nor refreshes."""
    tokens = login(client, resource="https://elsewhere.example/mcp")
    assert call_whoami(client, tokens["access_token"]).status_code == 401
    r = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                    "client_id": tokens["client_id"]})
    assert r.status_code in (400, 401) and r.json()["error"] == "invalid_grant", r.text
