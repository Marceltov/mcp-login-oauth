---
hide:
  - toc
---

# Where mcp-login-oauth is going

What is planned and what has shipped, from one library for four FastMCP servers to the same OAuth server in Python and TypeScript. Each step serves a [value](values.md) and has its issue or pull request.

<!-- roadmap -->

## The idea behind all of it

One small, strict OAuth server for MCP clients, the same in Python and TypeScript, that holds nothing usable at rest and leaves accounts and sign-in methods to the app.

## Parked

Nothing yet.

## Decided against

A complete sign-in for apps with a web UI: magic links, passkeys, several sign-in providers, browser sessions and user accounts, in both packages. Better Auth already does this well for TypeScript, where every UI lives, and Python backends only need to check its tokens ([ADR 0004](adr/0004-web-apps-sign-in-with-better-auth.md), [V7](values.md#v7-a-login-library-not-an-account-system)).

## Keep it true

The timeline is rendered from [`docs/roadmap.yml`](https://github.com/Marceltov/mcp-login-oauth/blob/main/docs/roadmap.yml); on GitHub, read that file. Finish a step in the pull request that finishes it: set `status: done`, replace `when` with a `date`, add the link to its pull request, and move it to the top of the shipped entries. Change the file in the pull request that changes the plan.
