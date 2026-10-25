from mcp_login_oauth import BearerPrefixMiddleware


async def run(scope):
    seen = {}

    async def app(scope, receive, send):
        seen["scope"] = scope
    await BearerPrefixMiddleware(app)(scope, None, None)
    return seen["scope"]


def http(*headers):
    return {"type": "http", "headers": list(headers)}


async def test_raw_token_gets_bearer_prefix():
    scope = await run(http((b"authorization", b"rawtoken"), (b"x-other", b"1")))
    assert scope["headers"] == [(b"authorization", b"Bearer rawtoken"), (b"x-other", b"1")]


async def test_bearer_and_basic_untouched():
    for value in (b"Bearer abc", b"Basic dXM6cHc="):
        assert (await run(http((b"authorization", value))))["headers"] == [(b"authorization", value)]


async def test_websocket_scope_passes_through():
    scope = {"type": "websocket", "headers": [(b"authorization", b"raw")]}
    assert await run(scope) is scope


async def test_listed_schemes_become_bearer():
    seen = {}

    async def app(scope, receive, send):
        seen["scope"] = scope
    for value in (b"Token abc", b"token abc"):
        await BearerPrefixMiddleware(app, schemes=("Token",))(http((b"authorization", value)), None, None)
        assert seen["scope"]["headers"] == [(b"authorization", b"Bearer abc")]
    await BearerPrefixMiddleware(app, schemes=("Token",))(http((b"authorization", b"Basic xyz")), None, None)
    assert seen["scope"]["headers"] == [(b"authorization", b"Basic xyz")]
