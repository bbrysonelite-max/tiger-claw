#!/bin/bash
# Tiger Claw Build Script
# TIGERCLAW-MASTER-SPEC-v2.md Block 1.6 "Version Scheme" (LOCKED decisions 32-36)
#
# Version scheme: v{YEAR}.{MONTH}.{DAY}.{BUILD}
#   - Date is UTC at build time.
#   - BUILD is an auto-incrementing integer per day (1, 2, 3...).
#   - Tags are immutable — never reused.
#   - Every version maps 1:1 to a Docker image: tiger-claw-scout:v2026.02.28.1
#
# What this script does:
#   1. Reads deployment_state.json to determine the next build number for today.
#   2. Builds the Docker image with the versioned tag.
#   3. Optionally pushes to registry.
#   4. Records the build in deployment_state.json (keeps last 5 builds — LOCKED).
#   5. Prunes local Docker images beyond the last 5 versions (LOCKED).
#   6. If files in skill/, api/, or docker/ changed since the last git tag,
#      creates and pushes a git tag v{VERSION} (LOCKED).
#
# Usage:
#   ./ops/build.sh                        # auto-determine next version
#   ./ops/build.sh --version v2026.02.28.2 # override version (use sparingly)
#   ./ops/build.sh --no-push              # build locally, skip registry push
#   ./ops/build.sh --no-git-tag           # build without creating git tag
#   ./ops/build.sh --dry-run              # show what would happen, do nothing
#
# Reads from .env.deploy if present. All env vars can override defaults.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$REPO_ROOT/.env.deploy" ]] && source "$REPO_ROOT/.env.deploy"

# ── Configuration ─────────────────────────────────────────────────────────────
IMAGE_NAME="${IMAGE_NAME:-tiger-claw-scout}"
REGISTRY="${REGISTRY:-}"
DEPLOYMENT_STATE_FILE="${DEPLOYMENT_STATE_FILE:-$REPO_ROOT/deployment_state.json}"
OPENCLAW_VERSION="${OPENCLAW_VERSION:-0.1.0}"
MAX_BUILDS=5   # LOCKED: retain last 5 versions

# Flags (settable via args)
DO_PUSH=true
DO_GIT_TAG=true
DRY_RUN=false
VERSION_OVERRIDE=""

# Directories that trigger a git tag when changed (LOCKED per spec decision 35)
GIT_TAG_WATCH_DIRS=("skill" "api" "docker")

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)    VERSION_OVERRIDE="$2"; shift 2 ;;
    --no-push)    DO_PUSH=false;    shift ;;
    --no-git-tag) DO_GIT_TAG=false; shift ;;
    --dry-run)    DRY_RUN=true;     shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

log()  { echo "[build] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
error(){ echo "[build] ERROR: $*" >&2; exit 1; }
dry()  { [[ "$DRY_RUN" == "true" ]] && echo "[dry-run] $*" || eval "$*"; }

# ── Read current state ─────────────────────────────────────────────────────────
read_state() {
  [[ -f "$DEPLOYMENT_STATE_FILE" ]] && cat "$DEPLOYMENT_STATE_FILE" || echo '{}'
}

# ── Determine next version number ─────────────────────────────────────────────
# Format: v{YEAR}.{MONTH}.{DAY}.{BUILD}
# BUILD starts at 1 and increments if another build already happened today.
determine_version() {
  local today_utc; today_utc="$(date -u '+%Y.%m.%d')"

  if [[ -n "$VERSION_OVERRIDE" ]]; then
    echo "$VERSION_OVERRIDE"
    return
  fi

  python3 - "$today_utc" "$DEPLOYMENT_STATE_FILE" << 'PYEOF'
import json, sys, os

today, state_file = sys.argv[1:]

builds = []
if os.path.exists(state_file):
    try:
        with open(state_file) as f:
            d = json.load(f)
        builds = d.get('builds', [])
    except Exception:
        pass

# Find the highest BUILD number used today
max_build = 0
for b in builds:
    v = b.get('version', '')
    # Format: vYYYY.MM.DD.N
    if v.startswith('v' + today + '.'):
        try:
            n = int(v[len('v' + today) + 1:])
            if n > max_build:
                max_build = n
        except ValueError:
            pass

next_build = max_build + 1
print(f'v{today}.{next_build}')
PYEOF
}

# ── Check if git tag is needed ────────────────────────────────────────────────
# Returns 0 (tag needed) or 1 (no relevant changes since last tag).
should_git_tag() {
  if [[ "$DO_GIT_TAG" == "false" ]]; then
    return 1
  fi

  # If no previous tags exist, always tag
  local last_tag
  last_tag="$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null || echo "")"

  if [[ -z "$last_tag" ]]; then
    log "  No previous git tag found — tagging."
    return 0
  fi

  # Check if any watched directories have changed since the last tag
  local changed_files
  changed_files="$(git -C "$REPO_ROOT" diff --name-only "$last_tag" HEAD \
    -- "${GIT_TAG_WATCH_DIRS[@]}" 2>/dev/null | wc -l | tr -d ' ')"

  if (( changed_files > 0 )); then
    log "  ${changed_files} file(s) changed in skill/api/docker since ${last_tag} — tagging."
    return 0
  fi

  log "  No changes in skill/api/docker since ${last_tag} — skipping git tag."
  return 1
}

# ── Record build in deployment_state.json ────────────────────────────────────
record_build() {
  local version="$1" git_tagged="$2"
  local commit_hash; commit_hash="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  local image_tag="${IMAGE_NAME}:${version}"

  python3 - "$version" "$commit_hash" "$image_tag" "$git_tagged" \
            "$IMAGE_NAME" "$MAX_BUILDS" "$DEPLOYMENT_STATE_FILE" << 'PYEOF'
import json, sys, datetime, os

version, commit_hash, image_tag, git_tagged, image_name, max_builds_str, state_file = sys.argv[1:]
max_builds = int(max_builds_str)

try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}

if 'builds' not in d:
    d['builds'] = []

# Add new build entry at the front
new_build = {
    'version': version,
    'builtAt': datetime.datetime.utcnow().isoformat() + 'Z',
    'imageTag': image_tag,
    'commitHash': commit_hash,
    'gitTagged': git_tagged == 'true',
}
d['builds'].insert(0, new_build)

# Keep only the last MAX_BUILDS entries (LOCKED: 5 versions)
d['builds'] = d['builds'][:max_builds]

# Update latestVersion
d['latestVersion'] = version

# Preserve all pipeline state fields
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)

print(f"Build recorded: {version} (commit {commit_hash})")
print(f"Retained builds ({min(len(d['builds']), max_builds)}/{max_builds}):")
for b in d['builds']:
    print(f"  {b['version']}  {b['builtAt'][:10]}  {b['commitHash']}")
PYEOF
}

# ── Prune Docker images beyond the last MAX_BUILDS versions ──────────────────
prune_old_images() {
  log "Pruning local images beyond last ${MAX_BUILDS} versions..."

  python3 - "$DEPLOYMENT_STATE_FILE" "$IMAGE_NAME" "$MAX_BUILDS" << 'PYEOF'
import json, sys, subprocess

state_file, image_name, max_builds_str = sys.argv[1:]
max_builds = int(max_builds_str)

# Load versions to keep
try:
    with open(state_file) as f:
        d = json.load(f)
    keep_tags = {b['version'] for b in d.get('builds', [])}
except Exception:
    keep_tags = set()

# List all local images for this image name
result = subprocess.run(
    ['docker', 'images', image_name, '--format', '{{.Tag}}'],
    capture_output=True, text=True
)
all_tags = [t.strip() for t in result.stdout.splitlines() if t.strip() and t.strip() != '<none>']

pruned = 0
for tag in all_tags:
    if tag not in keep_tags and tag != 'latest':
        full = f'{image_name}:{tag}'
        print(f'  Pruning: {full}')
        subprocess.run(['docker', 'rmi', full], capture_output=True)
        pruned += 1

if pruned == 0:
    print('  Nothing to prune.')
else:
    print(f'  Pruned {pruned} image(s).')
PYEOF
}

# ── Main ───────────────────────────────────────────────────────────────────────
main() {
  log "=== Tiger Claw Build ==="

  # 1. Determine version
  local version; version="$(determine_version)"
  log "Version: ${version}"
  log "Image:   ${IMAGE_NAME}:${version}"

  # Sanity: don't overwrite an existing tag (immutable)
  local existing_tag
  existing_tag="$(git -C "$REPO_ROOT" tag -l "$version" 2>/dev/null || echo "")"
  if [[ -n "$existing_tag" ]]; then
    error "Version ${version} already exists as a git tag. Use --version to specify a new version."
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] Would build ${IMAGE_NAME}:${version}"
    log "[dry-run] Would record build in ${DEPLOYMENT_STATE_FILE}"
    log "[dry-run] Would prune images beyond last ${MAX_BUILDS} versions"
    log "[dry-run] Git tag: $(should_git_tag && echo YES || echo NO)"
    exit 0
  fi

  # 2. Build Docker image
  log "Building Docker image..."
  docker build \
    -f "$REPO_ROOT/docker/customer/Dockerfile" \
    --build-arg "OPENCLAW_VERSION=${OPENCLAW_VERSION}" \
    -t "${IMAGE_NAME}:${version}" \
    -t "${IMAGE_NAME}:latest" \
    --label "tc.version=${version}" \
    --label "tc.built-at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --label "tc.commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    "$REPO_ROOT"

  log "Build complete: ${IMAGE_NAME}:${version}"

  # 3. Push to registry if configured
  if [[ "$DO_PUSH" == "true" && -n "$REGISTRY" ]]; then
    log "Pushing to registry: ${REGISTRY}/${IMAGE_NAME}:${version}"
    docker tag "${IMAGE_NAME}:${version}" "${REGISTRY}/${IMAGE_NAME}:${version}"
    docker push "${REGISTRY}/${IMAGE_NAME}:${version}"
    docker tag "${IMAGE_NAME}:latest" "${REGISTRY}/${IMAGE_NAME}:latest"
    docker push "${REGISTRY}/${IMAGE_NAME}:latest"
    log "Push complete."
  elif [[ -z "$REGISTRY" ]]; then
    log "No REGISTRY configured — skipping push. Set REGISTRY= in .env.deploy to enable."
  fi

  # 4. Git tag if relevant files changed
  local git_tagged="false"
  if should_git_tag; then
    log "Creating git tag ${version}..."
    git -C "$REPO_ROOT" tag -a "$version" \
      -m "Build ${version}: $(git -C "$REPO_ROOT" log -1 --pretty=format:'%s')"

    if git -C "$REPO_ROOT" remote -v 2>/dev/null | grep -q origin; then
      git -C "$REPO_ROOT" push origin "$version"
      log "Git tag pushed: ${version}"
    else
      log "No git remote 'origin' found — tag created locally only."
    fi
    git_tagged="true"
  fi

  # 5. Record build in deployment_state.json (keep last 5 — LOCKED)
  record_build "$version" "$git_tagged"

  # 6. Prune old local images (keep last 5 — LOCKED)
  prune_old_images

  log ""
  log "✅ Build complete."
  log "   Version:   ${version}"
  log "   Image:     ${IMAGE_NAME}:${version}"
  log "   Git tag:   ${git_tagged}"
  log ""
  log "Next: ./ops/deploy.sh staging ${version}"
}

main
