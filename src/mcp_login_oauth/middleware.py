"""Header normalisation for servers whose clients send a raw token without the Bearer scheme."""


class BearerPrefixMiddleware:
    """Pure ASGI: turn `Authorization: <token>` (no scheme, as ETAPI clients send it) into
    `Authorization: Bearer <token>`, the only form FastMCP's auth middleware reads. `schemes` lists
    further schemes to rewrite the same way, case-insensitively, such as Paperless's `Token`. Other
    schemes (`Bearer …`, `Basic …`) and non-HTTP scopes pass through unchanged."""

    def __init__(self, app, schemes: tuple[str, ...] = ()):
        self.app = app
        self.schemes = {s.lower().encode() for s in schemes}

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = []
            for name, value in scope.get("headers") or []:
                if name == b"authorization" and (raw := value.strip()):
                    scheme, _, rest = raw.partition(b" ")
                    if not rest:
                        value = b"Bearer " + raw
                    elif scheme.lower() in self.schemes:
                        value = b"Bearer " + rest.strip()
                headers.append((name, value))
            scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)
