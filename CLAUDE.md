# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

mcp-login-oauth: the OAuth server for MCP clients of FastMCP servers whose login is a form checked by the service behind them. One Python package.

## Commands

- `uv sync`, `uv run pytest -q`, `uv build`
- Release: set `version` in `pyproject.toml`, then push a tag `vX.Y.Z` on `main`; CI publishes to PyPI (Trusted Publishing) and makes the GitHub release.
- Docs: `uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve` (`build --strict` in CI); published to GitHub Pages from `main`. The README stays short and links to the docs site; usage lives in `docs/`. The roadmap is data: `docs/roadmap.yml`, rendered as a timeline by `docs_hooks/roadmap.py`. The pull request that finishes or changes a step updates it (`status: done`, a `date`, the PR link).

## Rules

- What mcp-login-oauth stands for is `docs/values.md`: changes are judged against it, and a review names the point it touches ("this breaks V2").
- Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
