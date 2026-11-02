import tomllib
from pathlib import Path

ROOT = Path(__file__).parent.parent


def test_the_library_is_mit_everywhere_it_says_so():
    assert tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["license"] == "MIT"
    assert (ROOT / "LICENSE").read_text().startswith("MIT License")
    assert "[MIT License]" in (ROOT / "README.md").read_text()
    assert ">MIT</a>" in (ROOT / "mkdocs.yml").read_text()  # the site footer
