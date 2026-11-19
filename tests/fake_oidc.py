"""A fake OpenID Connect provider as an httpx transport: discovery, JWKS, token endpoint. Its /authorize is
not served: tests read the redirect URL the library builds and call the callback themselves, as the
browser would after signing in. The ID token is signed with a real RSA key, so the checks are real."""

import json
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://idp.example/application/o/test/"
CLIENT_ID = "client-1"
CLIENT_SECRET = "secret-1"


@dataclass
class FakeProvider:
    key: rsa.RSAPrivateKey = field(default_factory=lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048))
    kid: str = "k1"
    claims: dict = field(default_factory=lambda: {"sub": "u-1", "preferred_username": "marcel",
                                                  "groups": ["trading"], "email": "m@example.org"})
    codes: dict = field(default_factory=dict)  # code -> nonce, set by the test from the authorize URL
    token_error: str | None = None
    overrides: dict = field(default_factory=dict)  # claim overrides for the next token (aud, iss, exp, nonce)
    sign_with: rsa.RSAPrivateKey | None = None
    seen_token_requests: list = field(default_factory=list)
    jwks_fetches: int = 0

    def jwks(self) -> dict:
        public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        return {"keys": [{**public, "kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def id_token(self, nonce: str) -> str:
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "iat": now, "exp": now + 300, "nonce": nonce, **self.claims,
                  **self.overrides}
        return jwt.encode(claims, self.sign_with or self.key, algorithm="RS256", headers={"kid": self.kid})

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={"issuer": ISSUER, "authorization_endpoint": "https://idp.example/authorize/",
                                             "token_endpoint": "https://idp.example/token/",
                                             "jwks_uri": "https://idp.example/jwks/"})
        if path == "/jwks/":
            self.jwks_fetches += 1
            return httpx.Response(200, json=self.jwks())
        if path == "/token/":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.seen_token_requests.append({"form": form, "auth": request.headers.get("authorization")})
            if self.token_error:
                return httpx.Response(400, json={"error": self.token_error})
            nonce = self.codes.pop(form.get("code"), None)
            if nonce is None:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "at", "token_type": "Bearer", "id_token": self.id_token(nonce)})
        return httpx.Response(404)
