#!/usr/bin/env python3
"""Tiger Claw RSS feed generator — operator-facing feed of capabilities."""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString

DATA_DIR = Path(os.environ.get("TIGER_CLAW_HOME", Path.home() / ".tiger-claw")) / "capabilities"
INDEX_FILE = DATA_DIR / "ecosystem-index.json"
XFEED_CACHE = DATA_DIR / "xfeed-cache.json"
MANIFEST_FILE = DATA_DIR / "capabilities.json"
FLAVOR_STACK_FILE = DATA_DIR / "flavor-stack.json"
RSS_FILE = DATA_DIR / "feed.xml"


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def generate_rss():
    """Generate RSS 2.0 feed from ecosystem index and X Feed data."""
    stack = load_json(FLAVOR_STACK_FILE, {"flavors": ["general"]})
    flavor_name = " + ".join(stack.get("flavors", ["general"]))

    index = load_json(INDEX_FILE, {"skills": []})
    xfeed = load_json(XFEED_CACHE, {"skills": []})
    manifest = load_json(MANIFEST_FILE, {"installed": []})

    installed_keys = {
        f"{s.get('author')}/{s.get('skill')}"
        for s in manifest.get("installed", [])
    }

    # Build RSS
    rss = Element("rss", version="2.0")
    rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")
    channel = SubElement(rss, "channel")

    SubElement(channel, "title").text = f"Tiger Claw Capabilities — {flavor_name}"
    SubElement(channel, "description").text = (
        f"Available and trending skills for Tiger Claw bots. "
        f"Active Flavor: {flavor_name}. "
        f"Total indexed: {len(index.get('skills', []))}. "
        f"Installed: {len(installed_keys)}."
    )
    SubElement(channel, "link").text = "https://github.com/openclaw/skills"
    SubElement(channel, "lastBuildDate").text = datetime.now(timezone.utc).strftime(
        "%a, %d %b %Y %H:%M:%S +0000"
    )
    SubElement(channel, "generator").text = "Tiger Claw Capabilities v1.0.0"

    # Section 1: Trending skills (from X Feed)
    trending = xfeed.get("skills", [])[:30]
    for skill in trending:
        item = SubElement(channel, "item")
        path = f"{skill['author']}/{skill['skill']}"
        status = "INSTALLED" if path in installed_keys else "AVAILABLE"
        SubElement(item, "title").text = f"[TRENDING] [{status}] {skill.get('name', skill['skill'])}"
        SubElement(item, "description").text = (
            f"{skill.get('description', 'No description')}\n\n"
            f"Author: {skill['author']} | Trend score: {skill.get('trend_score', 0)} | "
            f"Recent activity: {skill.get('recent_activity', 0)}"
        )
        SubElement(item, "link").text = f"https://github.com/openclaw/skills/tree/main/skills/{path}"
        SubElement(item, "guid", isPermaLink="false").text = f"tiger-claw-trending-{path}"
        SubElement(item, "category").text = "trending"

    # Section 2: High-relevance skills not yet installed
    relevant = sorted(
        [s for s in index.get("skills", [])
         if s.get("relevance", 0) >= 60
         and f"{s.get('author')}/{s.get('skill')}" not in installed_keys],
        key=lambda x: x.get("relevance", 0),
        reverse=True
    )[:50]

    for skill in relevant:
        item = SubElement(channel, "item")
        path = f"{skill['author']}/{skill['skill']}"
        SubElement(item, "title").text = f"[RECOMMENDED] {skill.get('name', skill['skill'])} (score: {skill.get('relevance', 0)})"
        SubElement(item, "description").text = (
            f"{skill.get('description', 'No description')}\n\n"
            f"Author: {skill['author']} | Relevance: {skill.get('relevance', 0)}/100"
        )
        SubElement(item, "link").text = f"https://github.com/openclaw/skills/tree/main/skills/{path}"
        SubElement(item, "guid", isPermaLink="false").text = f"tiger-claw-recommended-{path}"
        SubElement(item, "category").text = "recommended"

    # Section 3: Currently installed
    for skill in manifest.get("installed", []):
        item = SubElement(channel, "item")
        path = f"{skill.get('author')}/{skill.get('skill')}"
        SubElement(item, "title").text = f"[INSTALLED] {skill.get('name', skill.get('skill', 'unknown'))}"
        SubElement(item, "description").text = (
            f"{skill.get('description', 'No description')}\n\n"
            f"Installed: {skill.get('installed_at', 'unknown')} | "
            f"Vet score: {skill.get('vet_score', 'N/A')}"
        )
        SubElement(item, "link").text = f"https://github.com/openclaw/skills/tree/main/skills/{path}"
        SubElement(item, "guid", isPermaLink="false").text = f"tiger-claw-installed-{path}"
        SubElement(item, "category").text = "installed"

    # Write RSS file
    xml_str = parseString(tostring(rss, encoding="unicode")).toprettyxml(indent="  ")
    # Remove extra XML declaration if present
    lines = xml_str.split("\n")
    if lines[0].startswith("<?xml"):
        xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + "\n".join(lines[1:])

    with open(RSS_FILE, "w") as f:
        f.write(xml_str)

    total_items = len(trending) + len(relevant) + len(manifest.get("installed", []))
    print(f"RSS feed generated: {RSS_FILE}")
    print(f"  Trending:    {len(trending)} items")
    print(f"  Recommended: {len(relevant)} items")
    print(f"  Installed:   {len(manifest.get('installed', []))} items")
    print(f"  Total:       {total_items} items")


if __name__ == "__main__":
    generate_rss()
