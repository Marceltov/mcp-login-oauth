from conftest import BASE, call_whoami, login, whoami


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
