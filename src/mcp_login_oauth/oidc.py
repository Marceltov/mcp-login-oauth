"""Sign in through an OpenID Connect provider (Authentik, Keycloak, …) instead of a form.

The provider only answers "who is this": the browser goes there with the authorization code flow
(PKCE, `state`, `nonce`), comes back to `/login/callback`, and the ID token's claims go to the server's
`check_login`. Nothing from the provider is logged or passed on; only the grant `check_login` returns
is kept.
"""

import base64
import hashlib
import secrets
import ssl
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
import jwt
import truststore

ALGORITHMS = ["RS256", "ES256", "PS256"]
LEEWAY = 60  # seconds of clock difference accepted on exp and iat


class OidcError(Exception):
    """The provider refused, or its answer could not be trusted. The message is safe to show."""


@dataclass(frozen=True)
class OidcLogin:
    """An OpenID Connect provider to sign in with. `issuer` is the provider's issuer URL exactly as it
    publishes it (Authentik: `https://<host>/application/o/<slug>/`). Register `<base_url>/login/callback`
    there as the redirect URI. Without `client_secret` the client is public and relies on PKCE alone."""

    issuer: str
    client_id: str
    client_secret: str | None = None
    scopes: tuple[str, ...] = ("openid", "profile", "email")
    name: str = "single sign-on"
    verify_tls: bool = True


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class OidcClient:
    """Discovery, the redirect, the code exchange and the ID token check for one provider."""

    def __init__(self, login: OidcLogin, transport: httpx.AsyncBaseTransport | None = None):
        self.login = login
        verify: ssl.SSLContext | bool = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT) if login.verify_tls else False
        self.http = httpx.AsyncClient(verify=verify, transport=transport, timeout=httpx.Timeout(15))
        self._metadata: dict | None = None
        self._keys: dict[str, jwt.PyJWK] = {}

    async def metadata(self) -> dict:
        if self._metadata is None:
            url = self.login.issuer.rstrip("/") + "/.well-known/openid-configuration"
            try:
                r = await self.http.get(url)
                r.raise_for_status()
                data = r.json()
            except (httpx.HTTPError, ValueError) as e:
                raise OidcError(f"{self.login.name} could not be reached ({type(e).__name__}).") from None
            for key in ("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"):
                if not isinstance(data.get(key), str):
                    raise OidcError(f"{self.login.name}'s discovery document has no {key}.")
            self._metadata = data
        return self._metadata

    async def authorize_url(self, *, state: str, nonce: str, challenge: str, redirect_uri: str) -> str:
        meta = await self.metadata()
        query = urlencode({"response_type": "code", "client_id": self.login.client_id, "redirect_uri": redirect_uri,
                           "scope": " ".join(self.login.scopes), "state": state, "nonce": nonce,
                           "code_challenge": challenge, "code_challenge_method": "S256"})
        sep = "&" if "?" in meta["authorization_endpoint"] else "?"
        return f"{meta['authorization_endpoint']}{sep}{query}"

    async def exchange(self, *, code: str, verifier: str, redirect_uri: str) -> dict:
        """Trade the code for tokens; returns the token response (with `id_token`)."""
        meta = await self.metadata()
        data = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
                "code_verifier": verifier, "client_id": self.login.client_id}
        auth = (self.login.client_id, self.login.client_secret) if self.login.client_secret else None
        try:
            r = await self.http.post(meta["token_endpoint"], data=data, auth=auth,
                                     headers={"Accept": "application/json"})
        except httpx.HTTPError as e:
            raise OidcError(f"{self.login.name} could not be reached ({type(e).__name__}).") from None
        if not r.is_success:
            try:
                code_ = r.json().get("error", r.status_code)
            except ValueError:
                code_ = r.status_code
            raise OidcError(f"{self.login.name} refused the sign-in ({code_}).")
        tokens = r.json()
        if not isinstance(tokens.get("id_token"), str):
            raise OidcError(f"{self.login.name} sent no ID token.")
        return tokens

    async def claims(self, tokens: dict, nonce: str) -> dict:
        """The verified ID token's claims, completed from the userinfo endpoint: providers such as Authentik
        put profile claims (`preferred_username`, `groups`) only there unless told otherwise. The ID token's
        own claims win; userinfo for another `sub` is refused."""
        claims = await self.verify(tokens["id_token"], nonce)
        meta = await self.metadata()
        access = tokens.get("access_token")
        if not isinstance(access, str) or not isinstance(meta.get("userinfo_endpoint"), str):
            return claims
        try:
            r = await self.http.get(meta["userinfo_endpoint"], headers={"Authorization": f"Bearer {access}",
                                                                        "Accept": "application/json"})
            r.raise_for_status()
            info = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise OidcError(f"{self.login.name}'s user info could not be read ({type(e).__name__}).") from None
        if not isinstance(info, dict) or info.get("sub") != claims["sub"]:
            raise OidcError(f"{self.login.name}'s user info is for another account.")
        return {**info, **claims}

    async def _key(self, kid: str | None) -> jwt.PyJWK:
        if kid not in self._keys:
            await self._load_keys()  # once more for an unknown kid: the provider may have rotated its keys
        if kid not in self._keys:
            if kid is None and len(self._keys) == 1:
                return next(iter(self._keys.values()))
            raise OidcError(f"{self.login.name} signed the sign-in with an unknown key.")
        return self._keys[kid]

    async def _load_keys(self) -> None:
        meta = await self.metadata()
        try:
            r = await self.http.get(meta["jwks_uri"])
            r.raise_for_status()
            keys = jwt.PyJWKSet.from_dict(r.json()).keys
        except (httpx.HTTPError, ValueError, jwt.PyJWKSetError) as e:
            raise OidcError(f"{self.login.name}'s signing keys could not be read ({type(e).__name__}).") from None
        self._keys = {k.key_id: k for k in keys}

    async def verify(self, id_token: str, nonce: str) -> dict:
        """The ID token's claims, after checking signature, issuer, audience, expiry and nonce."""
        meta = await self.metadata()
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError:
            raise OidcError(f"{self.login.name} sent an unreadable ID token.") from None
        if header.get("alg") not in ALGORITHMS:
            raise OidcError(f"{self.login.name} signed the sign-in with an unsupported algorithm.")
        key = await self._key(header.get("kid"))
        try:
            claims = jwt.decode(id_token, key, algorithms=ALGORITHMS, audience=self.login.client_id,
                                issuer=meta["issuer"], leeway=LEEWAY,
                                options={"require": ["exp", "iat", "iss", "aud", "sub"]})
        except jwt.PyJWTError as e:
            raise OidcError(f"The sign-in at {self.login.name} could not be verified ({type(e).__name__}).") from None
        if not isinstance(claims.get("nonce"), str) or not secrets.compare_digest(claims["nonce"], nonce):
            raise OidcError(f"The sign-in at {self.login.name} could not be verified (nonce).")
        return claims

    async def aclose(self) -> None:
        await self.http.aclose()
