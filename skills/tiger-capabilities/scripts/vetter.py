#!/usr/bin/env python3
"""Tiger Claw skill vetter — security and relevance checks before install."""

import json
import os
import re
import subprocess
import sys
import base64
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path(os.environ.get("TIGER_CLAW_HOME", Path.home() / ".tiger-claw")) / "capabilities"
MANIFEST_FILE = DATA_DIR / "capabilities.json"
VET_LOG_FILE = DATA_DIR / "vet-log.json"

# Patterns that indicate malicious or dangerous skill content
DANGEROUS_PATTERNS = [
    (r"curl\s+.*\|\s*(?:bash|sh|python)", "Pipe-to-shell execution detected"),
    (r"eval\s*\(", "Dynamic code evaluation"),
    (r"exec\s*\(", "Dynamic code execution"),
    (r"__import__\s*\(", "Dynamic import"),
    (r"subprocess\.(?:call|run|Popen).*shell\s*=\s*True", "Shell injection risk"),
    (r"os\.system\s*\(", "OS command execution"),
    (r"IGNORE\s+(?:ALL\s+)?PREVIOUS\s+INSTRUCTIONS", "Prompt injection attempt"),
    (r"You\s+are\s+now\s+(?:a|an)\s+", "Persona override attempt"),
    (r"(?:send|post|upload|exfil).*(?:api\.telegram|discord\.com/api|webhook)", "Data exfiltration pattern"),
    (r"(?:password|secret|token|key|credential).*(?:send|post|upload)", "Credential exfiltration"),
    (r"rm\s+-rf\s+/", "Destructive command"),
    (r"chmod\s+777", "Insecure permissions"),
]

# Required frontmatter fields
REQUIRED_FIELDS = ["name", "description"]


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
        raise RuntimeError(f"gh api failed: {result.stderr[:200]}")
    return json.loads(result.stdout)


def fetch_skill_content(author_skill):
    """Fetch all files for a skill from the openclaw/skills repo."""
    parts = author_skill.split("/")
    if len(parts) != 2:
        raise ValueError(f"Expected 'author/skill' format, got: {author_skill}")
    author, skill = parts

    # Get the tree for this skill directory
    tree_path = f"skills/{author}/{skill}"
    try:
        contents = gh_api(f"repos/openclaw/skills/contents/{tree_path}")
    except RuntimeError:
        raise FileNotFoundError(f"Skill '{author_skill}' not found in openclaw/skills repo")

    files = {}
    for item in contents if isinstance(contents, list) else [contents]:
        if item.get("type") == "file":
            blob = gh_api(f"repos/openclaw/skills/git/blobs/{item['sha']}")
            content = base64.b64decode(blob.get("content", "")).decode("utf-8", errors="replace")
            files[item["name"]] = content

    return files


def vet_skill(author_skill):
    """Run full vetting on a skill. Returns (passed, report)."""
    print(f"Vetting: {author_skill}")
    print("=" * 60)

    report = {
        "skill": author_skill,
        "vetted_at": datetime.now(timezone.utc).isoformat(),
        "checks": [],
        "passed": True,
        "score": 100,
    }

    # Fetch content
    try:
        files = fetch_skill_content(author_skill)
    except (FileNotFoundError, RuntimeError) as e:
        report["passed"] = False
        report["checks"].append({"check": "fetch", "passed": False, "detail": str(e)})
        print(f"  FAIL: Could not fetch skill — {e}")
        return False, report

    print(f"  Files found: {', '.join(files.keys())}")

    # Check 1: SKILL.md exists
    if "SKILL.md" not in files:
        report["passed"] = False
        report["score"] -= 50
        report["checks"].append({"check": "structure", "passed": False, "detail": "No SKILL.md"})
        print("  FAIL: No SKILL.md found")
        return False, report
    else:
        report["checks"].append({"check": "structure", "passed": True, "detail": "SKILL.md present"})
        print("  PASS: SKILL.md present")

    skill_md = files["SKILL.md"]

    # Check 2: Valid frontmatter
    fm_match = re.match(r"^---\s*\n(.*?)\n---", skill_md, re.DOTALL)
    if fm_match:
        fm = fm_match.group(1)
        has_name = bool(re.search(r"^name:", fm, re.MULTILINE))
        has_desc = bool(re.search(r"^description:", fm, re.MULTILINE))
        if has_name and has_desc:
            report["checks"].append({"check": "frontmatter", "passed": True, "detail": "Valid frontmatter"})
            print("  PASS: Valid frontmatter with name and description")
        else:
            missing = []
            if not has_name: missing.append("name")
            if not has_desc: missing.append("description")
            report["score"] -= 15
            report["checks"].append({"check": "frontmatter", "passed": False,
                                      "detail": f"Missing: {', '.join(missing)}"})
            print(f"  WARN: Missing frontmatter fields: {', '.join(missing)}")
    else:
        report["score"] -= 20
        report["checks"].append({"check": "frontmatter", "passed": False, "detail": "No YAML frontmatter"})
        print("  WARN: No YAML frontmatter found")

    # Check 3: Security scan across all files
    all_content = "\n".join(files.values())
    security_issues = []
    for pattern, description in DANGEROUS_PATTERNS:
        matches = re.findall(pattern, all_content, re.IGNORECASE)
        if matches:
            security_issues.append({"pattern": description, "count": len(matches)})

    if security_issues:
        report["score"] -= len(security_issues) * 15
        for issue in security_issues:
            report["checks"].append({"check": "security", "passed": False,
                                      "detail": f"{issue['pattern']} ({issue['count']}x)"})
            print(f"  FAIL: {issue['pattern']} ({issue['count']} occurrence(s))")
        if any(i["pattern"] in ("Prompt injection attempt", "Data exfiltration pattern",
                                 "Credential exfiltration") for i in security_issues):
            report["passed"] = False
            print("  BLOCKED: Critical security issue detected")
    else:
        report["checks"].append({"check": "security", "passed": True, "detail": "No dangerous patterns"})
        print("  PASS: No dangerous patterns detected")

    # Check 4: Size check (skills shouldn't be enormous)
    total_size = sum(len(c) for c in files.values())
    if total_size > 500_000:
        report["score"] -= 10
        report["checks"].append({"check": "size", "passed": False,
                                  "detail": f"Total size {total_size:,} bytes (>500KB)"})
        print(f"  WARN: Large skill ({total_size:,} bytes)")
    else:
        report["checks"].append({"check": "size", "passed": True,
                                  "detail": f"Total size {total_size:,} bytes"})
        print(f"  PASS: Reasonable size ({total_size:,} bytes)")

    # Final score
    report["score"] = max(0, report["score"])
    if report["score"] < 40:
        report["passed"] = False

    print(f"\n  Final score: {report['score']}/100")
    print(f"  Verdict: {'APPROVED' if report['passed'] else 'REJECTED'}")

    # Log the vet
    vet_log = load_json(VET_LOG_FILE, {"entries": []})
    vet_log["entries"].append(report)
    save_json(VET_LOG_FILE, vet_log)

    return report["passed"], report


def install_skill(author_skill):
    """Vet and install a skill into the local manifest."""
    passed, report = vet_skill(author_skill)

    if not passed:
        print(f"\nSkill '{author_skill}' REJECTED. Not installing.")
        return False

    # Add to manifest
    manifest = load_json(MANIFEST_FILE, {"installed": []})
    installed = manifest.get("installed", [])

    # Check if already installed
    existing = [s for s in installed if f"{s.get('author')}/{s.get('skill')}" == author_skill]
    if existing:
        print(f"\nSkill '{author_skill}' is already installed. Updating.")
        installed = [s for s in installed if f"{s.get('author')}/{s.get('skill')}" != author_skill]

    # Get skill metadata from index or report
    index = load_json(DATA_DIR / "ecosystem-index.json", {"skills": []})
    skill_data = next(
        (s for s in index.get("skills", [])
         if f"{s.get('author')}/{s.get('skill')}" == author_skill),
        None
    )

    parts = author_skill.split("/")
    entry = {
        "author": parts[0],
        "skill": parts[1],
        "name": skill_data.get("name", parts[1]) if skill_data else parts[1],
        "description": skill_data.get("description", "") if skill_data else "",
        "installed_at": datetime.now(timezone.utc).isoformat(),
        "vet_score": report["score"],
    }
    installed.append(entry)

    manifest["installed"] = installed
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_json(MANIFEST_FILE, manifest)

    print(f"\nSkill '{author_skill}' installed successfully.")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: vetter.py [--install] <author/skill>")
        sys.exit(1)

    do_install = "--install" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--install"]

    if not args:
        print("Error: No skill specified.")
        sys.exit(1)

    skill = args[0]

    if do_install:
        success = install_skill(skill)
    else:
        passed, report = vet_skill(skill)
        success = passed

    sys.exit(0 if success else 1)
