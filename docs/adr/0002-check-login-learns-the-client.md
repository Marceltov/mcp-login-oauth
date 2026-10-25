---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# check_login learns the client through an optional second argument

## Context and Problem Statement

invoiceninja-mcp mints one InvoiceNinja API token per connected client and names it
`MCP: <client name>`, so each connection is visible and revocable in InvoiceNinja. v0.1's
`check_login(form)` only sees the form, so a server on the library could not name the token. The
recall engine and trilium-mcp-proxy already use the one-argument form. How does the callback learn
the client without breaking them?

## Considered Options

* Change the signature to `check_login(form, client)` for everyone.
* Put the client into the form mapping under a reserved key.
* Pass a `LoginClient` as a second argument only to callbacks that take two arguments.

## Decision Outcome

Chosen: **an optional second argument**. The library inspects the callback once at construction:
one positional parameter gets `(form)`, two get `(form, client)`. Existing consumers keep working
when they move to v0.2.0, and the form stays exactly the declared fields. A reserved form key would
collide with a field of the same name and blur "what the person typed" with "what the client said".

`LoginClient` carries `client_id`, `client_name` and `redirect_uri`. The name is self-reported at
dynamic registration, so it is a label, never proof of identity.

### Consequences

* Good, because v0.1 callbacks need no change.
* Bad, because the calling convention depends on the callback's signature, which a reader of the
  callback alone can't see; the README documents both forms.
