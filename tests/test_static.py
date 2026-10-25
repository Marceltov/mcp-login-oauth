from conftest import call_whoami, whoami


async def raw_etapi(token):
    return {"credential": token} if token == "raw-etapi" else None


def test_static_token_grant_reaches_the_tool(app_factory):
    with app_factory(verify_static=raw_etapi) as c:
        assert whoami(c, "raw-etapi") == {"credential": "raw-etapi"}
        assert call_whoami(c, "other").status_code == 401


def test_prefixed_unknown_token_skips_verify_static(app_factory):
    calls = []

    async def spy(token):
        calls.append(token)
        return {"credential": token}
    with app_factory(verify_static=spy) as c:
        assert call_whoami(c, "tst_stale-or-made-up").status_code == 401
    assert calls == []


def test_verify_static_crash_is_401(app_factory):
    async def boom(token):
        raise RuntimeError("upstream down")
    with app_factory(verify_static=boom) as c:
        assert call_whoami(c, "raw-etapi").status_code == 401


def test_no_verify_static_rejects_non_prefixed(client):
    assert call_whoami(client, "raw-etapi").status_code == 401
