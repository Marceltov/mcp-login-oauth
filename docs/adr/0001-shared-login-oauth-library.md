---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# One library for the login OAuth of all of Marcel's FastMCP servers

## Context and Problem Statement

trilium-mcp, invoiceninja-mcp, paperless-ngx-mcp and the recall engine in trilium-llm-wiki each carry a
copy of the same OAuth authorization server. The planned trilium-mcp-proxy would add a fifth. The
copies have drifted: only one slows down password guessing, and none lets a public client like
claude.ai revoke, because the MCP SDK's `/revoke` demands a `client_secret`. How do we stop fixing the
same code five times?

## Considered Options

* Keep the copies and port fixes by hand.
* FastMCP's `OAuthProxy`/`OIDCProxy` with an external identity provider (what teamscale-mcp does).
* A shared library, where each server supplies only its login form and the check that turns the form
  into a grant.

## Decision Outcome

Chosen: **a shared library**, `mcp-login-oauth`. An external identity provider doesn't fit: the
services themselves check the login, and the login is what mints the per-client service token (an ETAPI
or API token). So the service has to see the credentials once anyway.

Distribution is a pinned git tag for now. The package is a normal `src/` layout with a build backend,
so publishing to PyPI later needs no restructuring. It is AGPL-3.0-or-later, like the MCP servers
(v0.1.0 went out as MIT by mistake and was superseded by v0.1.1). trilium-llm-wiki, which is MIT, can
depend on it: its own code stays MIT, and its published image follows the AGPL as a whole, which public
source already satisfies.

### Consequences

* Good, because fixes and hardening land once, and every server gets the same login behaviour.
* Good, because the public-client `/revoke` fix and the `caio` thread pin come for free.
* Bad, because a server's update to the library drops its stored logins (the record shape is new), so
  clients log in once more.
* Bad, because the library pins FastMCP ≥ 4.1.3, so servers on FastMCP 3 have to upgrade when they
  migrate.
