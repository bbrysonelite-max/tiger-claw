#!/usr/bin/env python3
"""Tiger Claw ecosystem scanner — indexes ClawdHub skills, manages Flavors."""

import json
import os
import re
import subprocess
import sys
import base64
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path(os.environ.get("TIGER_CLAW_HOME", Path.home() / ".tiger-claw")) / "capabilities"
SKILL_DIR = Path(__file__).resolve().parent.parent
FLAVORS_DIR = SKILL_DIR / "flavors"
INDEX_FILE = DATA_DIR / "ecosystem-index.json"
MANIFEST_FILE = DATA_DIR / "capabilities.json"
FLAVOR_STACK_FILE = DATA_DIR / "flavor-stack.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def get_active_flavor():
    """Load the active flavor stack and merge into a single profile."""
    stack = load_json(FLAVOR_STACK_FILE, {"flavors": ["general"]})
    merged = {"boost": [], "suppress": [], "compliance": {"regions": [], "rules": []},
              "channels": {"primary": [], "secondary": []}, "aggression": "medium"}

    for flavor_name in stack.get("flavors", ["general"]):
        fpath = FLAVORS_DIR / f"{flavor_name}.json"
        if not fpath.exists():
            print(f"Warning: Flavor '{flavor_name}' not found at {fpath}", file=sys.stderr)
            continue
        flavor = load_json(fpath)
        p = flavor.get("priorities", {})
        merged["boost"].extend(p.get("boost", []))
        merged["suppress"].extend(p.get("suppress", []))
        c = flavor.get("compliance", {})
        merged["compliance"]["regions"].extend(c.get("regions", []))
        merged["compliance"]["rules"].extend(c.get("rules", []))
        ch = flavor.get("channels", {})
        merged["channels"]["primary"].extend(ch.get("primary", []))
        merged["channels"]["secondary"].extend(ch.get("secondary", []))
        merged["aggression"] = flavor.get("aggression", merged["aggression"])

    # Deduplicate
    for key in ["boost", "suppress"]:
        merged[key] = list(dict.fromkeys(merged[key]))
    for key in ["primary", "secondary"]:
        merged["channels"][key] = list(dict.fromkeys(merged["channels"][key]))
    merged["compliance"]["regions"] = list(dict.fromkeys(merged["compliance"]["regions"]))

    return merged


def relevance_score(skill_name, description, flavor):
    """Score a skill 0-100 based on active Flavor."""
    text = f"{skill_name} {description}".lower()
    boost_hits = sum(1 for kw in flavor["boost"] if kw.lower() in text)
    suppress_hits = sum(1 for kw in flavor["suppress"] if kw.lower() in text)
    score = min(100, 30 + (boost_hits * 12) - (suppress_hits * 15))
    return max(0, score)


def gh_api(endpoint):
    """Call GitHub API via gh CLI."""
    result = subprocess.run(
        ["gh", "api", endpoint], capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh api failed: {result.stderr[:200]}")
    return json.loads(result.stdout)


def cmd_list():
    """List installed capabilities."""
    manifest = load_json(MANIFEST_FILE, {"installed": []})
    installed = manifest.get("installed", [])
    if not installed:
        print("No capabilities installed. Run 'capabilities scan' to discover skills.")
        return
    print(f"Installed capabilities ({len(installed)}):\n")
    for skill in sorted(installed, key=lambda s: s.get("name", "")):
        name = skill.get("name", skill.get("skill", "unknown"))
        desc = skill.get("description", "(no description)")[:80]
        print(f"  {name:<40} {desc}")


def cmd_search(query):
    """Search the ecosystem index."""
    index = load_json(INDEX_FILE, {"skills": []})
    if not index.get("skills"):
        print("Ecosystem index is empty. Run 'capabilities scan' first.")
        return

    flavor = get_active_flavor()
    query_lower = query.lower()
    results = []

    for skill in index["skills"]:
        name = skill.get("name", skill.get("skill", ""))
        desc = skill.get("description", "")
        text = f"{name} {desc} {skill.get('author', '')}".lower()
        if query_lower in text:
            score = relevance_score(name, desc, flavor)
            results.append({**skill, "relevance": score})

    results.sort(key=lambda x: x["relevance"], reverse=True)

    if not results:
        print(f"No skills matching '{query}' in the ecosystem index.")
        return

    print(f"Search results for '{query}' ({len(results)} matches):\n")
    print(f"  {'Skill':<45} {'Relevance':>9}  Description")
    print(f"  {'─'*45} {'─'*9}  {'─'*50}")
    for r in results[:50]:
        path = f"{r.get('author', '?')}/{r.get('skill', '?')}"
        desc = r.get("description", "")[:50]
        print(f"  {path:<45} {r['relevance']:>6}/100  {desc}")


def cmd_scan():
    """Scan ClawdHub ecosystem and build/update the index."""
    print("Scanning OpenClaw/ClawdHub ecosystem...")

    # Get the skills tree SHA
    tree = gh_api("repos/openclaw/skills/git/trees/main")
    skills_sha = None
    for item in tree.get("tree", []):
        if item["path"] == "skills" and item["type"] == "tree":
            skills_sha = item["sha"]
            break

    if not skills_sha:
        print("Error: Could not find skills directory in openclaw/skills repo.")
        return

    # Get recursive tree to find all SKILL.md files
    print("Fetching skill tree (this may take a moment)...")
    full_tree = gh_api(f"repos/openclaw/skills/git/trees/{skills_sha}?recursive=1")

    skill_blobs = [
        item for item in full_tree.get("tree", [])
        if item["type"] == "blob"
        and item["path"].endswith("SKILL.md")
        and item["path"].count("/") == 2  # author/skill/SKILL.md
    ]

    print(f"Found {len(skill_blobs)} skills. Fetching descriptions...")

    # Load existing index to avoid re-fetching
    existing = load_json(INDEX_FILE, {"skills": []})
    existing_by_sha = {s.get("sha"): s for s in existing.get("skills", [])}

    flavor = get_active_flavor()
    skills = []
    fetched = 0

    for blob in skill_blobs:
        path = blob["path"]
        sha = blob["sha"]
        parts = path.replace("/SKILL.md", "").split("/")
        author, skill_name = parts[0], parts[1]

        # Use cached if SHA matches
        if sha in existing_by_sha:
            entry = existing_by_sha[sha]
            entry["relevance"] = relevance_score(
                entry.get("name", skill_name),
                entry.get("description", ""),
                flavor
            )
            skills.append(entry)
            continue

        # Fetch blob content
        try:
            blob_data = gh_api(f"repos/openclaw/skills/git/blobs/{sha}")
            content = base64.b64decode(blob_data.get("content", "")).decode("utf-8", errors="replace")

            name = skill_name
            description = ""

            fm_match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
            if fm_match:
                fm = fm_match.group(1)
                nm = re.search(r"^name:\s*[\"']?(.+?)[\"']?\s*$", fm, re.MULTILINE)
                if nm:
                    name = nm.group(1).strip()
                dm = re.search(r"^description:\s*[\"']?(.+?)[\"']?\s*$", fm, re.MULTILINE)
                if dm:
                    description = dm.group(1).strip().rstrip("\"'")

            if not description:
                for line in content.split("\n"):
                    line = line.strip()
                    if line and not line.startswith(("---", "#")) and len(line) > 10:
                        description = line[:300]
                        break

            score = relevance_score(name, description, flavor)
            skills.append({
                "sha": sha, "author": author, "skill": skill_name,
                "name": name, "description": description,
                "relevance": score, "indexed_at": datetime.now(timezone.utc).isoformat()
            })
            fetched += 1

            if fetched % 100 == 0:
                print(f"  Fetched {fetched} new skills...")

        except Exception as e:
            skills.append({
                "sha": sha, "author": author, "skill": skill_name,
                "name": skill_name, "description": f"(fetch error: {str(e)[:80]})",
                "relevance": 0, "indexed_at": datetime.now(timezone.utc).isoformat()
            })

    # Save index
    index = {
        "version": "1.0.0",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_skills": len(skills),
        "skills": skills
    }
    save_json(INDEX_FILE, index)

    # Summary
    relevant = [s for s in skills if s.get("relevance", 0) >= 40]
    print(f"\nScan complete:")
    print(f"  Total skills indexed: {len(skills)}")
    print(f"  New skills fetched:   {fetched}")
    print(f"  Relevant to Flavor:   {len(relevant)}")
    print(f"  Index saved to:       {INDEX_FILE}")


def cmd_flavor_show():
    """Show the active Flavor."""
    stack = load_json(FLAVOR_STACK_FILE, {"flavors": ["general"]})
    flavor = get_active_flavor()
    print(f"Active Flavor stack: {' + '.join(stack.get('flavors', ['general']))}")
    print(f"\nBoosted keywords ({len(flavor['boost'])}):")
    for kw in flavor["boost"][:20]:
        print(f"  + {kw}")
    if len(flavor["boost"]) > 20:
        print(f"  ... and {len(flavor['boost']) - 20} more")
    print(f"\nSuppressed keywords ({len(flavor['suppress'])}):")
    for kw in flavor["suppress"][:10]:
        print(f"  - {kw}")
    print(f"\nPrimary channels: {', '.join(flavor['channels']['primary']) or 'all'}")
    print(f"Aggression: {flavor['aggression']}")


def cmd_flavor_set(name):
    """Set the active Flavor (supports stacking with +)."""
    names = [n.strip() for n in name.split("+")]
    for n in names:
        fpath = FLAVORS_DIR / f"{n}.json"
        if not fpath.exists():
            print(f"Error: Flavor '{n}' not found. Available flavors:")
            cmd_flavor_list()
            return
    save_json(FLAVOR_STACK_FILE, {"flavors": names, "set_at": datetime.now(timezone.utc).isoformat()})
    print(f"Flavor set to: {' + '.join(names)}")


def cmd_flavor_list():
    """List available Flavors."""
    print("Available Flavors:\n")
    for fpath in sorted(FLAVORS_DIR.glob("*.json")):
        flavor = load_json(fpath)
        name = fpath.stem
        desc = flavor.get("description", "(no description)")
        print(f"  {name:<35} {desc}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        cmd_list()
        sys.exit(0)

    command = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "list": cmd_list,
        "search": lambda: cmd_search(" ".join(args)) if args else print("Usage: scanner.py search <query>"),
        "scan": cmd_scan,
        "flavor-show": cmd_flavor_show,
        "flavor-set": lambda: cmd_flavor_set(" ".join(args)) if args else print("Usage: scanner.py flavor-set <name>"),
        "flavor-list": cmd_flavor_list,
    }

    fn = commands.get(command)
    if fn:
        fn()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
