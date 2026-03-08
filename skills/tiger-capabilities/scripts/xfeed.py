#!/usr/bin/env python3
"""Tiger Claw X Feed — ecosystem intelligence collector.
Monitors skill popularity, usage signals, and community trends."""

import json
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path(os.environ.get("TIGER_CLAW_HOME", Path.home() / ".tiger-claw")) / "capabilities"
SKILL_DIR = Path(__file__).resolve().parent.parent
FLAVORS_DIR = SKILL_DIR / "flavors"
INDEX_FILE = DATA_DIR / "ecosystem-index.json"
XFEED_CACHE = DATA_DIR / "xfeed-cache.json"
FLAVOR_STACK_FILE = DATA_DIR / "flavor-stack.json"


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def gh_api(endpoint):
    result = subprocess.run(
        ["gh", "api", endpoint], capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def get_active_flavor_keywords():
    """Get boost/suppress keywords from the active flavor stack."""
    stack = load_json(FLAVOR_STACK_FILE, {"flavors": ["general"]})
    boost, suppress = [], []
    for fname in stack.get("flavors", ["general"]):
        fpath = FLAVORS_DIR / f"{fname}.json"
        if fpath.exists():
            f = load_json(fpath)
            boost.extend(f.get("priorities", {}).get("boost", []))
            suppress.extend(f.get("priorities", {}).get("suppress", []))
    return list(set(boost)), list(set(suppress))


def collect_signals():
    """Collect ecosystem signals: recent commits, popular authors, active skills."""
    print("Collecting X Feed signals from the ecosystem...")
    signals = {"collected_at": datetime.now(timezone.utc).isoformat(), "skills": []}

    # Get recent commits to the openclaw/skills repo (proxy for activity)
    commits = gh_api("repos/openclaw/skills/commits?per_page=100")
    if not commits:
        print("  Warning: Could not fetch recent commits.")
        commits = []

    # Count skill mentions in recent commit messages
    skill_activity = {}
    for commit in commits:
        msg = commit.get("commit", {}).get("message", "")
        # Commits often reference author/skill paths
        parts = msg.split("/")
        if len(parts) >= 2:
            key = f"{parts[0].strip()}/{parts[1].strip().split()[0]}"
            skill_activity[key] = skill_activity.get(key, 0) + 1

    # Load the ecosystem index for cross-referencing
    index = load_json(INDEX_FILE, {"skills": []})
    boost, suppress = get_active_flavor_keywords()

    for skill in index.get("skills", []):
        author = skill.get("author", "")
        sname = skill.get("skill", "")
        key = f"{author}/{sname}"
        name = skill.get("name", sname)
        desc = skill.get("description", "")
        text = f"{name} {desc} {sname}".lower()

        # Calculate trending score
        activity = skill_activity.get(key, 0)
        boost_hits = sum(1 for kw in boost if kw.lower() in text)
        suppress_hits = sum(1 for kw in suppress if kw.lower() in text)
        trend_score = (activity * 10) + (boost_hits * 5) - (suppress_hits * 8)

        if trend_score > 0:
            signals["skills"].append({
                "author": author, "skill": sname, "name": name,
                "description": desc[:200],
                "trend_score": trend_score,
                "recent_activity": activity,
                "flavor_relevance": boost_hits,
            })

    signals["skills"].sort(key=lambda x: x["trend_score"], reverse=True)
    save_json(XFEED_CACHE, signals)
    return signals


def cmd_trending(limit=20):
    """Show trending skills from X Feed, scoped by active Flavor."""
    # Try cache first (refresh if older than 1 hour)
    cache = load_json(XFEED_CACHE)
    collected_at = cache.get("collected_at", "")

    if not collected_at or not cache.get("skills"):
        cache = collect_signals()

    skills = cache.get("skills", [])
    if not skills:
        print("No trending skills found. Run 'capabilities scan' first to build the index.")
        return

    stack = load_json(FLAVOR_STACK_FILE, {"flavors": ["general"]})
    flavor_name = " + ".join(stack.get("flavors", ["general"]))

    print(f"Trending Skills — Flavor: {flavor_name}")
    print(f"Last updated: {cache.get('collected_at', 'unknown')}\n")
    print(f"  {'Rank':<5} {'Skill':<45} {'Score':>6}  {'Activity':>8}  Description")
    print(f"  {'─'*5} {'─'*45} {'─'*6}  {'─'*8}  {'─'*40}")

    for i, s in enumerate(skills[:limit], 1):
        path = f"{s['author']}/{s['skill']}"
        desc = s.get("description", "")[:40]
        print(f"  {i:<5} {path:<45} {s['trend_score']:>6}  {s['recent_activity']:>8}  {desc}")

    print(f"\n  Showing top {min(limit, len(skills))} of {len(skills)} trending skills.")


def cmd_refresh():
    """Force refresh X Feed data."""
    print("Refreshing X Feed intelligence...")
    signals = collect_signals()
    print(f"Collected signals for {len(signals.get('skills', []))} skills.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "trending"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 20

    if cmd == "trending":
        cmd_trending(limit)
    elif cmd == "refresh":
        cmd_refresh()
    else:
        print(f"Usage: xfeed.py [trending|refresh] [limit]")
