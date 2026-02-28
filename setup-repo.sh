#!/bin/bash
# Tiger Claw — Repo Setup Script
#
# Run this ONCE on your Mac to create the GitHub repo and push everything.
#
# Prerequisites:
#   1. GitHub CLI installed: brew install gh
#   2. Logged in: gh auth login
#   3. This entire tiger-claw/ folder on your Mac
#
# Usage:
#   cd tiger-claw/
#   chmod +x setup-repo.sh
#   ./setup-repo.sh

set -euo pipefail

echo "🐯 Tiger Claw — Setting up repository"
echo ""

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo "ERROR: GitHub CLI (gh) not installed."
    echo "Install it: brew install gh"
    echo "Then login: gh auth login"
    exit 1
fi

# Check if logged in
if ! gh auth status &> /dev/null; then
    echo "ERROR: Not logged into GitHub."
    echo "Run: gh auth login"
    exit 1
fi

# Initialize git
git init
git add -A
git commit -m "Initial commit: Tiger Claw Master Spec v2 + repo structure

- 127 locked architectural decisions
- 18 OpenClaw reference docs
- Dev container config for Cursor
- Docker infrastructure (customer + dev + platform)
- Working provisioning script from v4
- Cursor agent rules
- 14 skill tool placeholders"

# Create private GitHub repo and push
echo ""
echo "Creating private GitHub repository..."
gh repo create tiger-claw --private --source=. --push

echo ""
echo "✅ Done!"
echo ""
echo "Your repo is live at: https://github.com/$(gh api user -q .login)/tiger-claw"
echo ""
echo "Next steps:"
echo "  1. Open Cursor"
echo "  2. Clone: gh repo clone tiger-claw"
echo "  3. Cursor will detect .devcontainer and offer 'Reopen in Container'"
echo "  4. Start coding inside Docker"
echo ""
echo "The spec is at: specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md"
echo "Tell your Cursor agent to read it before writing any code."
