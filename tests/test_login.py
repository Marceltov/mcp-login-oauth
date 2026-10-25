import io

from conftest import FIELDS, authorize, login, register
from mcp_login_oauth import LoginField, LoginRejected


def start(http):
    return authorize(http, register(http)["client_id"])[0]


def post(http, pending, **form):
    return http.post("/login", data={"id": pending, **form}, follow_redirects=False)


def test_get_shows_the_form(client):
    page = client.get("/login", params={"id": start(client)})
    assert page.status_code == 200 and 'name="password"' in page.text


def test_rejection_shows_message_401(client):
    r = post(client, start(client), password="nope")
    assert r.status_code == 401 and "Wrong password." in r.text and 'name="password"' in r.text


def test_failed_login_waits_delay(app_factory, monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)
    monkeypatch.setattr("mcp_login_oauth.provider.asyncio.sleep", fake_sleep)
    with app_factory(failed_login_delay=1.0) as c:
        post(c, start(c), password="nope")
    assert slept == [1.0]


def test_link_ends_after_max_attempts(client):
    pending = start(client)
    for _ in range(5):
        assert post(client, pending, password="nope").status_code == 401
    r = post(client, pending, password="pw")
    assert r.status_code == 400 and "location" not in r.headers


def test_resubmitted_form_gets_already_completed_page(client):
    pending = start(client)
    assert post(client, pending, password="pw").status_code == 302
    again = post(client, pending, password="pw")
    assert again.status_code == 200 and "already completed" in again.text


def test_unknown_or_expired_link_is_400(client):
    assert client.get("/login", params={"id": "nope"}).status_code == 400
    assert client.get("/login").status_code == 400


def test_check_login_crash_is_502_and_not_counted(app_factory):
    calls = []

    async def flaky(form):
        calls.append(1)
        if len(calls) <= 5:
            raise RuntimeError("service down")
        return {"ok": True}
    with app_factory(check_login=flaky) as c:
        pending = start(c)
        for _ in range(5):
            r = post(c, pending, password="pw")
            assert r.status_code == 502 and "Could not reach Test." in r.text and "service down" not in r.text
        assert post(c, pending, password="pw").status_code == 302


def test_form_values_reach_check_as_strings(app_factory):
    seen = []

    async def record(form):
        seen.append(dict(form))
        raise LoginRejected("no")
    fields = [*FIELDS, LoginField("code", "Code"), LoginField("token", "Token")]
    with app_factory(check_login=record, fields=fields) as c:
        pending = start(c)
        c.post("/login", data={"id": pending, "password": "pw"}, files={"token": ("t.txt", io.BytesIO(b"x"))},
               follow_redirects=False)
    assert seen == [{"password": "pw", "code": "", "token": ""}]


def test_login_with_the_helper_still_works(client):
    assert login(client)["token_type"].lower() == "bearer"
