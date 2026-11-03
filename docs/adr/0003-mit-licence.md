---
status: accepted
date: 2026-11-02
decision-makers: Marcel Bruckner
---

# MIT, not AGPL

## Context and Problem Statement

ADR 0001 made the library AGPL-3.0-or-later, like the servers that use it. It is a library other servers embed, and the AGPL's network clause protects services that are hosted for others, which this is not; it would instead force every server that embeds it open. passageway is also moving to a licence for companies (Marceltov/passageway#97) and must not depend on an AGPL package.

## Decision

From 0.2.3 the library is MIT. Releases up to 0.2.2 stay AGPL-3.0-or-later for anyone who has them. The maintainer holds the copyright alone, so no one else's consent was needed.

This replaces the licence sentence of ADR 0001; the rest of that decision stands.
