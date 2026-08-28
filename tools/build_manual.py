#!/usr/bin/env python3
"""Assemble /manual/index.html from the docs pages. Fail loud if markup shifts."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://rocknroller.nicapotato.com"
OUT = ROOT / "manual" / "index.html"

# (source file, section id, heading to inject if the extract has no h1)
SECTIONS = (
    (ROOT / "index.html", "about", "About"),
    (ROOT / "features" / "index.html", "features", None),
    (ROOT / "demucs-stems" / "index.html", "stems", None),
    (ROOT / "keybinds" / "index.html", "keybinds", None),
    (ROOT / "configurations" / "index.html", "settings", None),
)

SECTION_PATHS = {
    "/": "about",
    "/features/": "features",
    "/demucs-stems/": "stems",
    "/keybinds/": "keybinds",
    "/configurations/": "settings",
}

NAV_RE = re.compile(r'<nav class="page__nav">.*?</nav>', re.S)
HREF_RE = re.compile(r'\bhref="([^"]+)"')
ID_RE = re.compile(r'\bid="([^"]+)"')
VIDEO_RE = re.compile(r'<div class="video-embed">.*?</div>', re.S)
ITCH_RE = re.compile(r'<div class="itch-embed">.*?</div>', re.S)
YOUTUBE_ID_RE = re.compile(r"youtube\.com/embed/([\w-]+)")
ITCH_HREF_RE = re.compile(r'<a href="(https://nicapotato\.itch\.io/[^"]+)"')


def extract_body(html: str, source: Path) -> str:
    nav = NAV_RE.search(html)
    if not nav:
        raise AssertionError(f"{source}: missing <nav class=\"page__nav\">")
    end = html.rfind("</main>")
    if end < 0:
        raise AssertionError(f"{source}: missing </main>")
    body = html[nav.end() : end].strip()
    if not body:
        raise AssertionError(f"{source}: empty body after nav")
    return body


def prefix_fragment_ids(html: str, prefix: str) -> str:
    def id_sub(match: re.Match[str]) -> str:
        return f'id="{prefix}-{match.group(1)}"'

    def hash_sub(match: re.Match[str]) -> str:
        href = match.group(1)
        if href.startswith("#") and len(href) > 1:
            return f'href="#{prefix}-{href[1:]}"'
        return match.group(0)

    html = ID_RE.sub(id_sub, html)
    html = HREF_RE.sub(hash_sub, html)
    return html


def rewrite_site_href(href: str) -> str:
    if href.startswith(("http://", "https://", "mailto:", "#")):
        return href
    if not href.startswith("/"):
        return href
    path, _, frag = href.partition("#")
    if not path.endswith("/") and path + "/" in SECTION_PATHS:
        path = path + "/"
    if path in SECTION_PATHS:
        sid = SECTION_PATHS[path]
        return f"#{sid}-{frag}" if frag else f"#{sid}"
    return SITE + href


def rewrite_hrefs(html: str) -> str:
    def sub(match: re.Match[str]) -> str:
        return f'href="{rewrite_site_href(match.group(1))}"'

    return HREF_RE.sub(sub, html)


def add_print_fallbacks(html: str, source: Path) -> str:
    def video_sub(match: re.Match[str]) -> str:
        block = match.group(0)
        vid = YOUTUBE_ID_RE.search(block)
        if not vid:
            raise AssertionError(f"{source}: video-embed missing YouTube id")
        url = f"https://www.youtube.com/watch?v={vid.group(1)}"
        return (
            f"{block}\n"
            f'<a class="print-link" href="{url}">'
            f"Watch trailer — youtube.com/watch?v={vid.group(1)}</a>"
        )

    def itch_sub(match: re.Match[str]) -> str:
        block = match.group(0)
        link = ITCH_HREF_RE.search(block)
        if not link:
            raise AssertionError(f"{source}: itch-embed missing itch.io href")
        url = link.group(1)
        label = url.removeprefix("https://")
        return (
            f"{block}\n"
            f'<a class="print-link" href="{url}">'
            f"Demucs MLX on itch.io — {label}</a>"
        )

    html = VIDEO_RE.sub(video_sub, html)
    html = ITCH_RE.sub(itch_sub, html)
    return html


def section_html(source: Path, sid: str, heading: str | None) -> str:
    raw = source.read_text(encoding="utf-8")
    body = extract_body(raw, source)
    body = prefix_fragment_ids(body, sid)
    body = rewrite_hrefs(body)
    body = add_print_fallbacks(body, source)
    if heading and "<h1" not in body:
        body = f"<h1>{heading}</h1>\n{body}"
    return f'<section class="manual-section" id="{sid}">\n{body}\n</section>'


def build() -> None:
    parts = [section_html(path, sid, heading) for path, sid, heading in SECTIONS]
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Manual — Rock N Roller</title>
    <link rel="icon" type="image/png" href="/rocknroller-icon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/assets/site.css" />
    <link rel="stylesheet" href="/assets/manual.css" />
  </head>
  <body>
    <main class="page page--manual">
      <h1 class="page__title">
        <img
          class="page__logo"
          src="/rocknroller-logo.png"
          alt="Rock N Roller"
          width="810"
          height="160"
        />
      </h1>
      <nav class="page__nav no-print">
        <a href="/latest/">Play</a>
        <a href="/">About</a>
        <a href="/features/">Features</a>
        <a href="/demucs-stems/">Stems</a>
        <a href="/keybinds/">Keybinds</a>
        <a href="/configurations/">Settings</a>
        <a href="/versions/">Versions</a>
      </nav>

      <p class="manual-lede">
        Offline reference for Rock N Roller — About, Features, Stems, Keybinds,
        and Settings. Live site:
        <a href="{SITE}/">{SITE.replace("https://", "")}</a>.
      </p>
      <div class="btn-row no-print">
        <a class="btn" href="/rocknroller-manual.pdf" download="rocknroller-manual.pdf">
          Download PDF
        </a>
      </div>
      <ol class="toc">
        <li><a href="#about">About</a></li>
        <li><a href="#features">Features</a></li>
        <li><a href="#stems">Stems &amp; Demucs</a></li>
        <li><a href="#keybinds">Keybinds</a></li>
        <li><a href="#settings">Settings</a></li>
      </ol>

      {chr(10).join(parts)}
    </main>
    <script src="/assets/content-pages.js"></script>
  </body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
