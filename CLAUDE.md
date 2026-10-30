# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

mcp-login-oauth: the OAuth server for MCP clients and the sign-in behind it, as a Python package (repository root) and a TypeScript package (`typescript/`).

## Rules

- What mcp-login-oauth stands for is `docs/values.md`: changes are judged against it, and a review names the point it touches ("this breaks V3").
- Both packages keep the same features and behaviour (V3): a change to one names the other in its pull request.
- Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
