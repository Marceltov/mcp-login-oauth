from conftest import call_whoami, login, register


def revoke(http, token, client_id, **extra):
    return http.post("/revoke", data={"token": token, "client_id": client_id, **extra})


def recorder():
    calls = []

    async def on_revoke(grant):
        calls.append(grant)
    return calls, on_revoke


def test_public_client_revokes_its_refresh_token(app_factory):
    calls, on_revoke = recorder()
    with app_factory(on_revoke=on_revoke) as c:
        tokens = login(c)
        r = revoke(c, tokens["refresh_token"], tokens["client_id"])
        assert r.status_code == 200, r.text
        assert call_whoami(c, tokens["access_token"]).status_code == 401
    assert calls == [{"credential": "minted-1"}]


def test_revoking_by_access_token_kills_the_pair(client):
    tokens = login(client)
    assert revoke(client, tokens["access_token"], tokens["client_id"]).status_code == 200
    assert call_whoami(client, tokens["access_token"]).status_code == 401
    r = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                    "client_id": tokens["client_id"]})
    assert r.status_code in (400, 401)


def test_other_clients_token_is_not_revoked(app_factory):
    calls, on_revoke = recorder()
    with app_factory(on_revoke=on_revoke) as c:
        victim = login(c)
        attacker = register(c, name="other")["client_id"]
        assert revoke(c, victim["refresh_token"], attacker).status_code == 200
        assert call_whoami(c, victim["access_token"]).status_code == 200
    assert calls == []


def test_unknown_client_is_401(client):
    tokens = login(client)
    assert revoke(client, tokens["refresh_token"], "no-such-client").status_code == 401
    assert call_whoami(client, tokens["access_token"]).status_code == 200


def test_confidential_client_needs_its_secret(client):
    info = register(client, name="confidential", token_endpoint_auth_method="client_secret_post")
    assert revoke(client, "tst_x", info["client_id"], client_secret="wrong").status_code == 401
    assert revoke(client, "tst_x", info["client_id"]).status_code == 401
    assert revoke(client, "tst_x", info["client_id"], client_secret=info["client_secret"]).status_code == 200


def test_on_revoke_failure_still_revokes(app_factory):
    async def boom(grant):
        raise RuntimeError("service down")
    with app_factory(on_revoke=boom) as c:
        tokens = login(c)
        assert revoke(c, tokens["refresh_token"], tokens["client_id"]).status_code == 200
        assert call_whoami(c, tokens["access_token"]).status_code == 401
