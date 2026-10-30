"""MkDocs hook: renders docs/roadmap.yml as a timeline in place of the <!-- roadmap --> marker of docs/roadmap.md.

The markup has no blank lines (a blank line would end the raw HTML block in Python-Markdown) and every piece of text from
the data file is escaped. Icons are Material Design icons, taken from the installed mkdocs-material and inlined.
"""

import datetime
import html
import re
from pathlib import Path

import yaml

MARKER = "<!-- roadmap -->"
DATA = Path(__file__).resolve().parents[1] / "docs" / "roadmap.yml"


def load_icon(name: str) -> str:
    import material

    path = Path(material.__file__).parent / "templates" / ".icons" / "material" / f"{name}.svg"
    if not path.is_file():
        from mkdocs.exceptions import PluginError

        raise PluginError(f"roadmap.yml uses the icon '{name}', which is not in the Material Design icon set")
    return path.read_text().strip()


def inline(text: str) -> str:
    """Escape, then allow `code`, **bold** and [links](https://...) or [links](relative/path)."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    return re.sub(r"\[([^\]]+)\]\((https://[^)\s]+|[\w./#-]+)\)",
                  lambda m: f'<a href="{m.group(2).replace(chr(34), "%22")}">{m.group(1)}</a>', out)


def blocks(text: str) -> str:
    """Paragraphs and "- " lists, as HTML without blank lines."""
    parts: list[str] = []
    paragraph: list[str] = []
    items: list[str] = []

    def flush() -> None:
        nonlocal paragraph, items
        if paragraph:
            parts.append("<p>" + inline(" ".join(paragraph)) + "</p>")
        if items:
            parts.append("<ul>" + "".join(f"<li>{inline(i)}</li>" for i in items) + "</ul>")
        paragraph, items = [], []

    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            flush()
        elif line.startswith("- "):
            if paragraph:
                flush()
            items.append(line[2:])
        else:
            if items:
                flush()
            paragraph.append(line)
    flush()
    return "\n".join(parts)


def nice_date(value) -> str:
    day = datetime.date.fromisoformat(str(value))
    return f"{day.day} {day:%b %Y}"


def row(entry: dict, icon) -> str:
    done = entry["status"] == "done"
    when = html.escape(nice_date(entry["date"]) if done else entry["when"])
    links = "".join(f'<a href="{html.escape(link["url"], quote=True)}">{html.escape(link["label"])}</a>'
                    for link in entry.get("links", []))
    details = ""
    if entry.get("details"):
        details = f'<details class="ml-tl-details"><summary>Details</summary>\n{blocks(entry["details"])}\n</details>'
    lines = [
        f'<div class="ml-tl-row ml-{html.escape(entry["status"])}" id="{html.escape(entry["id"])}">',
        f'<div class="ml-tl-when">{when}</div>',
        '<div class="ml-tl-dot" aria-hidden="true"></div>',
        '<div class="ml-tl-card">',
        f'<div class="ml-tl-head"><span class="ml-ic" aria-hidden="true">{icon(entry["icon"])}</span>'
        f'<span class="ml-tl-title">{html.escape(entry["title"])}</span><span class="ml-tl-links">{links}</span></div>',
        f'<p class="ml-tl-summary">{inline(entry["summary"])}</p>',
    ]
    if details:
        lines.append(details)
    lines += ["</div>", "</div>"]
    return "\n".join(lines)


def render(data: dict, icon=load_icon) -> str:
    items = data["items"]
    open_items = [i for i in items if i["status"] != "done"]
    done = sorted((i for i in items if i["status"] == "done"), key=lambda i: str(i["date"]), reverse=True)  # stable
    return '<div class="ml-timeline">\n' + "\n".join(row(i, icon) for i in open_items + done) + "\n</div>"


def on_page_markdown(markdown, page, config, files):
    if page.file.src_uri != "roadmap.md":
        return markdown
    if MARKER not in markdown:
        from mkdocs.exceptions import PluginError

        raise PluginError(f"docs/roadmap.md has no {MARKER} marker for the timeline")
    return markdown.replace(MARKER, render(yaml.safe_load(DATA.read_text())))


def on_serve(server, config, builder):
    server.watch(str(DATA))  # a change to the data rebuilds the page
    return server
