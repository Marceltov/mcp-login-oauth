# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

mcp-login-oauth: the OAuth server for MCP clients of servers whose login is a form checked by a service (or one OIDC provider), as a Python package (repository root) and a TypeScript package (`typescript/`). Apps with a web UI sign in with Better Auth instead (`docs/adr/0004-*`).

## Commands

- Python: `uv sync`, `uv run pytest -q`
- TypeScript (in `typescript/`): `npm ci`, `npm test`, `npm run typecheck`, `npm pack`
- Docs: `uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve` (`build --strict` in CI); published to GitHub Pages from `main`. The READMEs stay short and link to the docs site; usage lives in `docs/`.

## Rules

- What mcp-login-oauth stands for is `docs/values.md`: changes are judged against it, and a review names the point it touches ("this breaks V3").
- Both packages keep the same features and behaviour (V3): a change to one names the other in its pull request.
- Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
