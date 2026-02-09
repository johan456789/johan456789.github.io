#!/usr/bin/env bash
set -euo pipefail

# Build the URL list Lighthouse CI should collect:
# - Always include core pages.
# - Add blog post pages changed across the pull request range.
#
# Required env:
# - GITHUB_BASE_REF
# - GITHUB_HEAD_SHA
#
# Output:
# - JSON array to stdout, e.g. ["/index.html","/blog/index.html"]

BASE_REF="${GITHUB_BASE_REF:-}"
HEAD_SHA="${GITHUB_HEAD_SHA:-}"

if [[ -z "${BASE_REF}" || -z "${HEAD_SHA}" ]]; then
  echo "GITHUB_BASE_REF and GITHUB_HEAD_SHA are required" >&2
  exit 1
fi

BASE_REMOTE_REF="refs/remotes/origin/${BASE_REF}"
if ! git rev-parse --verify "${BASE_REMOTE_REF}" >/dev/null 2>&1; then
  git fetch --no-tags --depth=1 origin "${BASE_REF}"
  BASE_REMOTE_REF="FETCH_HEAD"
fi
BASE_SHA="$(git merge-base "${BASE_REMOTE_REF}" "${HEAD_SHA}")"

CHANGED_POST_FILES_OUTPUT="$(
  git diff --name-only "${BASE_SHA}" "${HEAD_SHA}" -- \
    'src/content/docs/blog/*.md' \
    'src/content/docs/blog/*.mdx' \
    | sort -u
)"

CHANGED_POST_URLS_OUTPUT=""
if [[ -n "${CHANGED_POST_FILES_OUTPUT}" ]]; then
  CHANGED_POST_URLS_OUTPUT="$(
    printf '%s\n' "${CHANGED_POST_FILES_OUTPUT}" \
      | node ./scripts/filter-non-draft-blog-urls.mjs
  )"
fi

mapfile -t CHANGED_POST_URLS <<< "${CHANGED_POST_URLS_OUTPUT}"

URLS=(
  "/index.html"
  "/blog/index.html"
  "/404.html"
)

for url in "${CHANGED_POST_URLS[@]}"; do
  URLS+=("${url}")
done

declare -A SEEN
FINAL_URLS=()
for url in "${URLS[@]}"; do
  [[ -z "${url}" ]] && continue
  [[ -n "${SEEN[$url]:-}" ]] && continue
  SEEN["$url"]=1
  FINAL_URLS+=("$url")
done

printf 'Testing URLs:\n' >&2
printf ' - %s\n' "${FINAL_URLS[@]}" >&2

printf '%s\n' "${FINAL_URLS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'
