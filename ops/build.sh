#!/bin/bash
# Tiger Claw Build Script
# TIGERCLAW-MASTER-SPEC-v2.md Block 1.6 "Version Scheme" (LOCKED decisions 32-36)
# TIGERCLAW-BLUEPRINT-v3.md §4.2 (LOCKED decisions B4.1, B4.2)
#
# Image tag format (LOCKED B4.2): tiger-claw:{TC_VERSION}-oc{OC_VERSION}
#   Example: tiger-claw:v2026.03.03.1-oc2026.3.2
#
# TC_VERSION scheme: v{YEAR}.{MONTH}.{DAY}.{BUILD}
#   - Date is UTC at build time.
#   - BUILD is an auto-incrementing integer per day (1, 2, 3...).
#   - Tags are immutable — never reused.
#
# Registry: GitHub Container Registry (GHCR)
#   Image path: ghcr.io/bbrysonelite-max/tiger-claw:{tag}
#   Auth: GITHUB_TOKEN env var, login via `docker login ghcr.io`
#
# What this script does:
#   1. Validates --tc-version and --oc-version CLI arguments.
#   2. Builds the Docker image with the dual-version tag.
#   3. Pushes to GHCR (requires GITHUB_TOKEN).
#   4. Records the build in deployment_state.json (keeps last 5 builds — LOCKED).
#   5. Prunes local Docker images beyond the last 5 versions (LOCKED).
#   6. If files in skill/, api/, or docker/ changed since the last git tag,
#      creates and pushes a git tag v{TC_VERSION} (LOCKED).
#
# Usage:
#   ./ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2
#   ./ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2 --no-push
#   ./ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2 --dry-run
#
# Reads from .env.deploy if present. All env vars can override defaults.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$REPO_ROOT/.env.deploy" ]] && source "$REPO_ROOT/.env.deploy"

# ── Configuration ─────────────────────────────────────────────────────────────
REGISTRY="${REGISTRY:-ghcr.io/bbrysonelite-max}"
IMAGE_NAME="tiger-claw"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"
DEPLOYMENT_STATE_FILE="${DEPLOYMENT_STATE_FILE:-$REPO_ROOT/deployment_state.json}"
MAX_BUILDS=5   # LOCKED: retain last 5 versions

# Flags and required args
DO_PUSH=true
DO_GIT_TAG=true
DRY_RUN=false
TC_VERSION=""
OC_VERSION=""

# Directories that trigger a git tag when changed (LOCKED per spec decision 35)
GIT_TAG_WATCH_DIRS=("skill" "api" "docker")

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tc-version)  TC_VERSION="$2";  shift 2 ;;
    --oc-version)  OC_VERSION="$2";  shift 2 ;;
    --no-push)     DO_PUSH=false;    shift ;;
    --no-git-tag)  DO_GIT_TAG=false; shift ;;
    --dry-run)     DRY_RUN=true;     shift ;;
    *) echo "[build] ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TC_VERSION" ]]; then
  echo "[build] ERROR: --tc-version is required." >&2
  echo "  Example: ./ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2" >&2
  exit 1
fi

if [[ -z "$OC_VERSION" ]]; then
  echo "[build] ERROR: --oc-version is required." >&2
  echo "  Example: ./ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2" >&2
  exit 1
fi

# Image tag: tiger-claw:{TC_VERSION}-oc{OC_VERSION} (LOCKED B4.2)
IMAGE_TAG="${TC_VERSION}-oc${OC_VERSION}"

log()  { echo "[build] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
error(){ echo "[build] ERROR: $*" >&2; exit 1; }

# ── Read current state ─────────────────────────────────────────────────────────
read_state() {
  [[ -f "$DEPLOYMENT_STATE_FILE" ]] && cat "$DEPLOYMENT_STATE_FILE" || echo '{}'
}

# ── Check if git tag is needed ────────────────────────────────────────────────
should_git_tag() {
  if [[ "$DO_GIT_TAG" == "false" ]]; then
    return 1
  fi

  local last_tag
  last_tag="$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null || echo "")"

  if [[ -z "$last_tag" ]]; then
    log "  No previous git tag found — tagging."
    return 0
  fi

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
  local tc_version="$1" oc_version="$2" image_tag="$3" git_tagged="$4"
  local commit_hash; commit_hash="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

  python3 - "$tc_version" "$oc_version" "$commit_hash" "$image_tag" \
            "$git_tagged" "$MAX_BUILDS" "$DEPLOYMENT_STATE_FILE" << 'PYEOF'
import json, sys, datetime, os

tc_version, oc_version, commit_hash, image_tag, git_tagged, max_builds_str, state_file = sys.argv[1:]
max_builds = int(max_builds_str)

try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}

if 'builds' not in d:
    d['builds'] = []

new_build = {
    'tcVersion': tc_version,
    'ocVersion': oc_version,
    'imageTag': image_tag,
    'builtAt': datetime.datetime.utcnow().isoformat() + 'Z',
    'commitHash': commit_hash,
    'gitTagged': git_tagged == 'true',
}
d['builds'].insert(0, new_build)
d['builds'] = d['builds'][:max_builds]

d['tigerClaw'] = {'current': tc_version, 'previous': d.get('tigerClaw', {}).get('current', '')}
d['openClaw'] = {'current': oc_version, 'previous': d.get('openClaw', {}).get('current', '')}
d['imageTag'] = image_tag

with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)

print(f"Build recorded: {tc_version} (OC {oc_version}, commit {commit_hash})")
print(f"Retained builds ({min(len(d['builds']), max_builds)}/{max_builds}):")
for b in d['builds']:
    print(f"  {b['imageTag']}  {b['builtAt'][:10]}  {b['commitHash']}")
PYEOF
}

# ── Prune Docker images beyond the last MAX_BUILDS versions ──────────────────
prune_old_images() {
  log "Pruning local images beyond last ${MAX_BUILDS} versions..."

  python3 - "$DEPLOYMENT_STATE_FILE" "$FULL_IMAGE" "$MAX_BUILDS" << 'PYEOF'
import json, sys, subprocess

state_file, full_image, max_builds_str = sys.argv[1:]

try:
    with open(state_file) as f:
        d = json.load(f)
    keep_tags = set()
    for b in d.get('builds', []):
        tag = b.get('imageTag', '')
        if ':' in tag:
            keep_tags.add(tag.split(':', 1)[1])
except Exception:
    keep_tags = set()

result = subprocess.run(
    ['docker', 'images', full_image, '--format', '{{.Tag}}'],
    capture_output=True, text=True
)
all_tags = [t.strip() for t in result.stdout.splitlines() if t.strip() and t.strip() != '<none>']

pruned = 0
for tag in all_tags:
    if tag not in keep_tags and tag != 'latest':
        full = f'{full_image}:{tag}'
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
  log "TC Version:     ${TC_VERSION}"
  log "OC Version:     ${OC_VERSION}"
  log "Image Tag:      ${FULL_IMAGE}:${IMAGE_TAG}"

  # Sanity: don't overwrite an existing tag (immutable)
  local existing_tag
  existing_tag="$(git -C "$REPO_ROOT" tag -l "$TC_VERSION" 2>/dev/null || echo "")"
  if [[ -n "$existing_tag" ]]; then
    error "Version ${TC_VERSION} already exists as a git tag. Tags are immutable."
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] Would build ${FULL_IMAGE}:${IMAGE_TAG}"
    log "[dry-run] Would push to GHCR: ${DO_PUSH}"
    log "[dry-run] Would record build in ${DEPLOYMENT_STATE_FILE}"
    log "[dry-run] Would prune images beyond last ${MAX_BUILDS} versions"
    log "[dry-run] Git tag: $(should_git_tag && echo YES || echo NO)"
    exit 0
  fi

  # 1. Build Docker image
  log "Building Docker image..."
  docker build \
    -f "$REPO_ROOT/docker/customer/Dockerfile" \
    --build-arg "TC_VERSION=${TC_VERSION}" \
    --build-arg "OPENCLAW_VERSION=${OC_VERSION}" \
    -t "${FULL_IMAGE}:${IMAGE_TAG}" \
    -t "${FULL_IMAGE}:latest" \
    --label "tc.version=${TC_VERSION}" \
    --label "oc.version=${OC_VERSION}" \
    --label "tc.built-at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --label "tc.commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    "$REPO_ROOT"

  log "Build complete: ${FULL_IMAGE}:${IMAGE_TAG}"

  # 2. Config validation — skipped.
  # openclaw.json is generated at runtime by entrypoint.sh (it uses env vars
  # like TENANT_ID, TELEGRAM_BOT_TOKEN, ACTIVE_MODEL that are only available
  # inside a running container). There is no static config file to validate
  # at build time. Config correctness is verified by the /readyz check after
  # container startup (ops/update.sh and provisioner.ts).

  # 3. Push to GHCR
  if [[ "$DO_PUSH" == "true" ]]; then
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
      error "GITHUB_TOKEN env var is not set. Required for GHCR push.\n  export GITHUB_TOKEN=ghp_...\n  echo \$GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin"
    fi

    log "Pushing to GHCR: ${FULL_IMAGE}:${IMAGE_TAG}"
    docker push "${FULL_IMAGE}:${IMAGE_TAG}"
    docker push "${FULL_IMAGE}:latest"
    log "Push complete."
  else
    log "Push skipped (--no-push)."
  fi

  # 4. Git tag if relevant files changed
  local git_tagged="false"
  if should_git_tag; then
    log "Creating git tag ${TC_VERSION}..."
    git -C "$REPO_ROOT" tag -a "$TC_VERSION" \
      -m "Build ${IMAGE_TAG}: $(git -C "$REPO_ROOT" log -1 --pretty=format:'%s')"

    if git -C "$REPO_ROOT" remote -v 2>/dev/null | grep -q origin; then
      git -C "$REPO_ROOT" push origin "$TC_VERSION"
      log "Git tag pushed: ${TC_VERSION}"
    else
      log "No git remote 'origin' found — tag created locally only."
    fi
    git_tagged="true"
  fi

  # 5. Record build in deployment_state.json (keep last 5 — LOCKED)
  record_build "$TC_VERSION" "$OC_VERSION" "${FULL_IMAGE}:${IMAGE_TAG}" "$git_tagged"

  # 6. Prune old local images (keep last 5 — LOCKED)
  prune_old_images

  log ""
  log "Build complete."
  log "   Image:  ${FULL_IMAGE}:${IMAGE_TAG}"
  log ""

  # Print the full image tag to stdout for use by ops/update.sh
  echo "${FULL_IMAGE}:${IMAGE_TAG}"
}

main
