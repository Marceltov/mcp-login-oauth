"""OAuth 2.1 browser login for FastMCP servers whose login is a form checked by the service behind them."""

from mcp_login_oauth.store import build_store

__all__ = ["build_store"]
