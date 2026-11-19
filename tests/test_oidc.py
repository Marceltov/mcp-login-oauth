import ssl

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from conftest import BASE, REDIRECT, authorize, register
from fake_oidc import CLIENT_ID, CLIENT_SECRET, ISSUER, FakeProvider
from mcp_login_oauth import LoginField, LoginRejected, OidcLogin
from mcp_login_oauth.oidc import OidcClient

LOGIN = OidcLogin(issuer=ISSUER, client_id=CLIENT_ID, client_secret=CLIENT_SECRET, name="Authentik")


async def allow_trading(claims):
    if "trading" not in claims.get("groups", []):
        raise LoginRejected(f"{claims.get('preferred_username')} may not use Test.")
    return {"user": claims["preferred_username"]}


@pytest.fixture
def idp():
    return FakeProvider()


@pytest.fixture
def oidc_client(app_factory, idp, monkeypatch):
    real_init = OidcClient.__init__

    def init(self, login, transport=None):
        real_init(self, login, transport=httpx.MockTransport(idp.handler))
    monkeypatch.setattr(OidcClient, "__init__", init)
    with app_factory(fields=[], oidc=LOGIN, check_login=allow_trading) as c:
        yield c


def to_provider(http, idp) -> tuple[str, str, httpx.URL]:
    """register, authorize, press the button: (client_id, verifier, the provider's authorize URL). The fake
    provider remembers a code for this login, as if the person signed in there."""
    client_id = register(http)["client_id"]
    pending, verifier = authorize(http, client_id)
    page = http.get("/login", params={"id": pending})
    assert "Continue with Authentik" in page.text and 'name="password"' not in page.text
    r = http.post("/login", data={"id": pending}, follow_redirects=False)
    assert r.status_code == 303, r.text
    url = httpx.URL(r.headers["location"])
    idp.codes["the-code"] = url.params["nonce"]
    return client_id, verifier, url


def back(http, url, **params):
    query = {"code": "the-code", "state": url.params["state"], **params}
    return http.get("/login/callback", params=query, follow_redirects=False)


def test_full_sign_in_through_the_provider(oidc_client, idp):
    client_id, verifier, url = to_provider(oidc_client, idp)
    assert url.host == "idp.example" and url.params["client_id"] == CLIENT_ID
    assert url.params["redirect_uri"] == f"{BASE}/login/callback" and url.params["code_challenge_method"] == "S256"
    assert set(url.params["scope"].split()) == {"openid", "profile", "email"}
    r = back(oidc_client, url)
    assert r.status_code == 302 and r.headers["location"].startswith(REDIRECT)
    code = httpx.URL(r.headers["location"]).params["code"]
    tokens = oidc_client.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                                              "client_id": client_id, "code_verifier": verifier}).json()
    assert tokens["access_token"].startswith("tst_")
    sent = idp.seen_token_requests[0]
    assert sent["form"]["code_verifier"] and sent["auth"].startswith("Basic ")


def test_check_login_refusal_shows_the_page_again(oidc_client, idp):
    idp.claims["groups"] = ["family"]
    _, _, url = to_provider(oidc_client, idp)
    r = back(oidc_client, url)
    assert r.status_code == 403 and "marcel may not use Test." in r.text and "Continue with Authentik" in r.text


def test_callback_state_is_single_use(oidc_client, idp):
    _, _, url = to_provider(oidc_client, idp)
    assert back(oidc_client, url).status_code == 302
    again = back(oidc_client, url)
    assert again.status_code == 400 and "expired or already used" in again.text


def test_unknown_state_is_a_dead_end(oidc_client):
    r = oidc_client.get("/login/callback", params={"code": "x", "state": "nope"})
    assert r.status_code == 400 and "expired or already used" in r.text


def test_provider_error_is_a_dead_end(oidc_client, idp):
    _, _, url = to_provider(oidc_client, idp)
    r = oidc_client.get("/login/callback", params={"error": "access_denied", "state": url.params["state"]})
    assert r.status_code == 400 and "access_denied" in r.text and "not completed" in r.text


@pytest.mark.parametrize("override", [{"aud": "someone-else"}, {"iss": "https://evil.example/"},
                                      {"exp": 1000}, {"nonce": "replayed"}])
def test_untrusted_id_token_is_refused(oidc_client, idp, override):
    idp.overrides = override
    _, _, url = to_provider(oidc_client, idp)
    r = back(oidc_client, url)
    assert r.status_code == 400 and "could not be verified" in r.text


def test_bad_signature_is_refused(oidc_client, idp):
    idp.sign_with = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _, _, url = to_provider(oidc_client, idp)
    assert "could not be verified" in back(oidc_client, url).text


def test_token_endpoint_refusal_is_a_dead_end(oidc_client, idp):
    idp.token_error = "invalid_client"
    _, _, url = to_provider(oidc_client, idp)
    r = back(oidc_client, url)
    assert r.status_code == 400 and "invalid_client" in r.text


async def test_unknown_kid_refetches_jwks(idp):
    client = OidcClient(LOGIN, transport=httpx.MockTransport(idp.handler))
    claims = await client.verify(idp.id_token("n"), "n")
    assert claims["preferred_username"] == "marcel" and idp.jwks_fetches == 1
    idp.kid, idp.key = "k2", rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert (await client.verify(idp.id_token("n"), "n"))["sub"] == "u-1"
    assert idp.jwks_fetches == 2


def test_client_verifies_tls_with_truststore_unless_switched_off():
    import truststore
    on = OidcClient(LOGIN)
    assert isinstance(on.http._transport._pool._ssl_context, truststore.SSLContext)
    off = OidcClient(OidcLogin(issuer=ISSUER, client_id=CLIENT_ID, verify_tls=False))
    assert off.http._transport._pool._ssl_context.verify_mode == ssl.CERT_NONE


def test_fields_and_oidc_exclude_each_other(app_factory):
    with pytest.raises(ValueError, match="no form fields"):
        app_factory(fields=[LoginField("password", "Password")], oidc=LOGIN)
    with pytest.raises(ValueError, match="at least one field"):
        app_factory(fields=[])


def test_no_callback_route_without_oidc(client):
    assert client.get("/login/callback", params={"state": "x"}).status_code == 404


def test_profile_claims_from_userinfo(app_factory, idp, monkeypatch):
    """Authentik leaves preferred_username and groups out of the ID token by default; userinfo has them."""
    seen = []

    async def remember(claims):
        seen.append(claims)
        return {"user": claims["preferred_username"]}
    real_init = OidcClient.__init__
    monkeypatch.setattr(OidcClient, "__init__",
                        lambda self, login, transport=None: real_init(self, login, transport=httpx.MockTransport(idp.handler)))
    idp.claims_in_userinfo_only = ("preferred_username", "groups")
    with app_factory(fields=[], oidc=LOGIN, check_login=remember) as c:
        _, _, url = to_provider(c, idp)
        assert back(c, url).status_code == 302
    assert seen[0]["preferred_username"] == "marcel" and seen[0]["groups"] == ["trading"] and seen[0]["aud"] == CLIENT_ID


def test_userinfo_for_another_account_is_refused(oidc_client, idp):
    idp.userinfo_sub = "someone-else"
    _, _, url = to_provider(oidc_client, idp)
    r = back(oidc_client, url)
    assert r.status_code == 400 and "another account" in r.text


def test_provider_failure_does_not_blame_the_app(oidc_client, idp):
    idp.token_error = "invalid_client"
    _, _, url = to_provider(oidc_client, idp)
    assert "Reconnect" not in back(oidc_client, url).text
