# Development

Both packages live in this repository: Python at the root, TypeScript in `typescript/`. They keep the same features and behaviour ([V3](values.md#v3-the-same-in-python-and-typescript)), so a change to one names the other in its pull request.

## Python

```bash
uv sync
uv run pytest -q
```

## TypeScript

In `typescript/`:

```bash
npm ci
npm test
npm run typecheck
npm pack          # builds dist/ and the tarball
```

## Documentation

This site is built with [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) from `docs/` and published to GitHub Pages from `main`. To preview it:

```bash
uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve
```

CI builds it with `--strict`, which fails on broken internal links.

## Releases

- **Python:** a tag `vX.Y.Z` on `main`; servers pin the tag.
- **TypeScript:** a tag `ts-vX.Y.Z` on `main`. The release workflow packs the package and attaches the tarball to the GitHub release; the tag must match `typescript/package.json`.
