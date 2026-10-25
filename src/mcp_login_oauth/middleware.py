"""Header normalisation for servers whose clients send a raw token without the Bearer scheme."""


class BearerPrefixMiddleware:
    """Pure ASGI: turn `Authorization: <token>` (no scheme, as ETAPI clients send it) into
    `Authorization: Bearer <token>`, the only form FastMCP's auth middleware reads. Values with a
    scheme (`Bearer …`, `Basic …`) and non-HTTP scopes pass through unchanged."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = []
            for name, value in scope.get("headers") or []:
                if name == b"authorization" and value.strip() and b" " not in value.strip():
                    value = b"Bearer " + value.strip()
                headers.append((name, value))
            scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)
