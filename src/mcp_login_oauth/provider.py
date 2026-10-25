"""OAuth 2.1 authorization server whose login is a form checked by the service behind the MCP server.

FastMCP and the MCP SDK serve discovery, dynamic client registration, /authorize and /token (PKCE) on
top of these methods. This module adds /login (the one page a person sees) and replaces /revoke: the
SDK's handler demands a client_secret, so public clients (claude.ai) could never revoke. Every
code and token maps to a *grant*: whatever `check_login` returned for that login, for example a
service token minted from the submitted password. Tool code reads it from
`get_access_token().claims["grant"]`.
"""

import asyncio
import base64
import binascii
import hmac
import logging
import secrets
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from urllib.parse import urlsplit

from fastmcp.server.auth import AccessToken, OAuthProvider
from fastmcp.server.auth.auth import ClientRegistrationOptions, RevocationOptions
from key_value.aio.protocols import AsyncKeyValue
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from mcp_login_oauth.pages import LoginField, dead_end_page, login_page

log = logging.getLogger("mcp_login_oauth")

STATIC_CLIENT_ID = "static"

CheckLogin = Callable[[Mapping[str, str]], Awaitable[dict]]
OnRevoke = Callable[[dict], Awaitable[None]]
VerifyStatic = Callable[[str], Awaitable[dict | None]]


class LoginRejected(Exception):
    """Raised by `check_login` when the service says no; the message is shown on the login page."""


class LoginOAuthProvider(OAuthProvider):
    def __init__(self, *, base_url: str, store: AsyncKeyValue, service_name: str, fields: Sequence[LoginField],
                 check_login: CheckLogin, token_prefix: str, on_revoke: OnRevoke | None = None,
                 verify_static: VerifyStatic | None = None, pending_ttl: int = 600, code_ttl: int = 300,
                 access_ttl: int = 3600, refresh_ttl: int = 30 * 24 * 3600, failed_login_delay: float = 1.0,
                 max_login_attempts: int = 5):
        super().__init__(base_url=base_url,
                         client_registration_options=ClientRegistrationOptions(enabled=True),
                         revocation_options=RevocationOptions(enabled=True))
        self.store = store
        self.service_name = service_name
        self.fields = list(fields)
        self.check_login = check_login
        self.token_prefix = token_prefix
        self.on_revoke = on_revoke
        self.verify_static = verify_static
        self.pending_ttl, self.code_ttl = pending_ttl, code_ttl
        self.access_ttl, self.refresh_ttl = access_ttl, refresh_ttl
        self.failed_login_delay = failed_login_delay
        self.max_login_attempts = max_login_attempts

    # -- clients and codes ------------------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        data = await self.store.get(client_id, collection="clients")
        return OAuthClientInformationFull.model_validate(data) if data else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        await self.store.put(client_info.client_id, client_info.model_dump(mode="json"), collection="clients")

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        pending_id = secrets.token_urlsafe(32)
        await self.store.put(pending_id, {"client_id": client.client_id, "params": params.model_dump(mode="json"),
                                          "attempts": 0}, collection="pending", ttl=self.pending_ttl)
        return f"{str(self.base_url).rstrip('/')}/login?id={pending_id}"

    async def load_authorization_code(self, client: OAuthClientInformationFull,
                                      authorization_code: str) -> AuthorizationCode | None:
        data = await self.store.get(authorization_code, collection="codes")
        if not data or data["code"]["client_id"] != client.client_id:
            return None
        return AuthorizationCode.model_validate(data["code"])

    async def exchange_authorization_code(self, client: OAuthClientInformationFull,
                                          authorization_code: AuthorizationCode) -> OAuthToken:
        data = await self.store.get(authorization_code.code, collection="codes")
        if not data:
            raise TokenError("invalid_grant", "Authorization code not found or already used.")
        await self.store.delete(authorization_code.code, collection="codes")
        return await self._issue(client.client_id, authorization_code.scopes, data["grant"])

    # -- tokens -----------------------------------------------------------------------------

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        data = await self.store.get(refresh_token, collection="refresh")
        if not data or data["client_id"] != client.client_id:
            return None
        return RefreshToken(token=refresh_token, client_id=data["client_id"], scopes=data["scopes"],
                            expires_at=data["expires_at"])

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: RefreshToken,
                                     scopes: list[str]) -> OAuthToken:
        data = await self.store.get(refresh_token.token, collection="refresh")
        if not data:
            raise TokenError("invalid_grant", "Refresh token not found or already used.")
        if not set(scopes) <= set(refresh_token.scopes):
            raise TokenError("invalid_scope", "Requested scopes exceed the original grant.")
        await self._drop(data["access"], refresh_token.token)  # rotate: the old pair dies, the grant lives on
        return await self._issue(client.client_id, scopes or refresh_token.scopes, data["grant"])

    async def load_access_token(self, token: str) -> AccessToken | None:
        data = await self.store.get(token, collection="access")
        if not data:
            return None
        return AccessToken(token=token, client_id=data["client_id"], scopes=data["scopes"],
                           expires_at=data["expires_at"], claims={"grant": data["grant"]})

    async def verify_token(self, token: str) -> AccessToken | None:
        if token.startswith(self.token_prefix):
            # Ours, or a stale one of ours: never hand it to verify_static as a service credential.
            return await self.load_access_token(token)
        if self.verify_static is None:
            return None
        try:
            grant = await self.verify_static(token)
        except Exception:
            log.exception("verify_static failed")
            return None
        return AccessToken(token=token, client_id=STATIC_CLIENT_ID, scopes=[], claims={"grant": grant}) \
            if grant is not None else None

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        if isinstance(token, RefreshToken):
            data = await self.store.get(token.token, collection="refresh")
            pair = (data["access"], token.token) if data else None
        else:
            data = await self.store.get(token.token, collection="access")
            pair = (token.token, data["refresh"]) if data else None
        if not pair:
            return
        await self._drop(*pair)
        if self.on_revoke:
            try:
                await self.on_revoke(data["grant"])
            except Exception:  # the pair is gone already; a failed clean-up only leaves a stray credential
                log.exception("on_revoke failed")

    # -- the login page ---------------------------------------------------------------------

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        routes = [r for r in super().get_routes(mcp_path) if getattr(r, "path", None) != "/revoke"]
        return [*routes, Route("/login", self._login, methods=["GET", "POST"]),
                Route("/revoke", self._revoke, methods=["POST"])]

    async def _revoke(self, request: Request) -> Response:
        """RFC 7009 for public and confidential clients. A token that isn't the caller's is left alone, and
        the answer is 200 either way, so the endpoint reveals nothing about other clients' tokens."""
        form = await request.form()
        client_id, secret = form.get("client_id"), form.get("client_secret")
        basic = request.headers.get("authorization", "")
        if basic.lower().startswith("basic "):
            try:
                client_id, _, secret = base64.b64decode(basic[6:]).decode().partition(":")
            except (binascii.Error, UnicodeDecodeError):
                return JSONResponse({"error": "invalid_client"}, status_code=401)
        client = await self.get_client(client_id) if isinstance(client_id, str) and client_id else None
        if client is None:
            return JSONResponse({"error": "invalid_client"}, status_code=401)
        if client.token_endpoint_auth_method != "none":
            if not (isinstance(secret, str) and client.client_secret
                    and hmac.compare_digest(secret.encode(), client.client_secret.encode())):
                return JSONResponse({"error": "invalid_client"}, status_code=401)
        token = form.get("token")
        if isinstance(token, str) and token:
            for collection in ("refresh", "access"):
                data = await self.store.get(token, collection=collection)
                if data and data["client_id"] == client.client_id:
                    found = RefreshToken(token=token, client_id=client.client_id, scopes=data["scopes"]) \
                        if collection == "refresh" else \
                        AccessToken(token=token, client_id=client.client_id, scopes=data["scopes"])
                    await self.revoke_token(found)
                    break
        return Response(status_code=200)

    def _dead_end(self, heading: str, what: str, status: int) -> Response:
        return dead_end_page(self.service_name, heading, what, status)

    async def _login(self, request: Request) -> Response:
        form = await request.form() if request.method == "POST" else request.query_params
        pending_id = form.get("id", "")
        pending = await self.store.get(pending_id, collection="pending") \
            if isinstance(pending_id, str) and pending_id else None
        if not pending:
            return self._dead_end("Login link expired or already used",
                                  f"Login links work once, for {self.pending_ttl // 60} minutes, and end after "
                                  f"{self.max_login_attempts} failed attempts.", 400)
        if pending.get("done"):
            # A browser re-submitted a login that already succeeded (seen with claude.ai's connector flow).
            return self._dead_end("Login already completed",
                                  "Your login was accepted a moment ago and the browser sent the form a second "
                                  "time. If your app now shows the connector without tools, it dropped that "
                                  "finished login.", 200)
        params = AuthorizationParams.model_validate(pending["params"])
        client = await self.get_client(pending["client_id"])
        redirect = str(params.redirect_uri)

        def page(error: str = "", status: int = 200) -> Response:
            return login_page(service_name=self.service_name, fields=self.fields, pending_id=pending_id,
                              client_name=(client.client_name if client else None) or pending["client_id"],
                              redirect_host=urlsplit(redirect).netloc or redirect, error=error, status=status)

        if request.method == "GET":
            return page()

        # Only declared fields, only text: a missing field is "", an uploaded file is dropped.
        values = {f.name: v if isinstance(v := form.get(f.name, ""), str) else "" for f in self.fields}
        try:
            grant = await self.check_login(values)
        except LoginRejected as rejected:
            await asyncio.sleep(self.failed_login_delay)
            attempts = pending["attempts"] + 1
            if attempts >= self.max_login_attempts:
                await self.store.delete(pending_id, collection="pending")
            else:
                await self.store.put(pending_id, {**pending, "attempts": attempts}, collection="pending",
                                     ttl=self.pending_ttl)
            return page(str(rejected), 401)
        except Exception:
            log.exception("check_login failed")  # never log the form
            return page(f"Could not reach {self.service_name}.", 502)

        # Keep a short-lived marker instead of deleting, so a replayed form gets an honest answer.
        await self.store.put(pending_id, {"done": True}, collection="pending", ttl=self.pending_ttl)
        code = AuthorizationCode(code=self.token_prefix + secrets.token_urlsafe(32), client_id=pending["client_id"],
                                 scopes=params.scopes or [], expires_at=time.time() + self.code_ttl,
                                 code_challenge=params.code_challenge, redirect_uri=params.redirect_uri,
                                 redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                                 resource=params.resource)
        await self.store.put(code.code, {"code": code.model_dump(mode="json"), "grant": grant}, collection="codes",
                             ttl=self.code_ttl)
        return RedirectResponse(construct_redirect_uri(redirect, code=code.code, state=params.state), status_code=302)

    # -- helpers ----------------------------------------------------------------------------

    async def _issue(self, client_id: str, scopes: list[str], grant: dict) -> OAuthToken:
        access = self.token_prefix + secrets.token_urlsafe(32)
        refresh = self.token_prefix + secrets.token_urlsafe(32)
        now = int(time.time())
        common = {"client_id": client_id, "scopes": scopes, "grant": grant}
        await self.store.put(access, {**common, "refresh": refresh, "expires_at": now + self.access_ttl},
                             collection="access", ttl=self.access_ttl)
        await self.store.put(refresh, {**common, "access": access, "expires_at": now + self.refresh_ttl},
                             collection="refresh", ttl=self.refresh_ttl)
        return OAuthToken(access_token=access, token_type="Bearer", expires_in=self.access_ttl,
                          refresh_token=refresh, scope=" ".join(scopes) or None)

    async def _drop(self, access: str, refresh: str) -> None:
        await self.store.delete(access, collection="access")
        await self.store.delete(refresh, collection="refresh")
