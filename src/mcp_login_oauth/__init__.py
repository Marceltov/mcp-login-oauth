"""OAuth 2.1 browser login for FastMCP servers whose login is a form checked by the service behind them."""

from mcp_login_oauth.pages import LoginField
from mcp_login_oauth.provider import LoginOAuthProvider, LoginRejected
from mcp_login_oauth.store import build_store

__all__ = ["LoginField", "LoginOAuthProvider", "LoginRejected", "build_store"]
