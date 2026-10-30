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

1. Set `version` in `pyproject.toml` in the pull request that changes what ships.
2. After it is merged, tag `main`: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
3. The release workflow (`.github/workflows/release.yml`) checks that the tag matches `pyproject.toml`, runs the tests, builds with `uv build`, publishes to [PyPI](https://pypi.org/project/mcp-login-oauth/) through Trusted Publishing (no API token) and attaches the files to the GitHub release.

The PyPI side is set up once: a trusted publisher for `Marceltov/mcp-login-oauth`, workflow `release.yml`, environment `pypi`.
