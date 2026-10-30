# Development

```bash
uv sync
uv run pytest -q
```

## Documentation

This site is built with [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) from `docs/` and published to GitHub Pages from `main`. To preview it:

```bash
uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve
```

CI builds it with `--strict`, which fails on broken internal links.

## Releases

A tag `vX.Y.Z` on `main`; servers pin the tag.
