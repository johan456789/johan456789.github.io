#!/usr/bin/env bash
set -euo pipefail

# Build the URL list Lighthouse CI should collect:
# - Always include core pages.
# - Add blog post pages changed in the current git range.
#
# Required env:
# - GITHUB_SHA
# Optional env:
# - GITHUB_EVENT_BEFORE
#
# Output:
# - JSON array to stdout, e.g. ["/index.html","/blog/index.html"]

BASE_SHA="${GITHUB_EVENT_BEFORE:-}"
HEAD_SHA="${GITHUB_SHA:-}"

if [[ -z "${HEAD_SHA}" ]]; then
  HEAD_SHA="$(git rev-parse HEAD)"
fi

if [[ -z "${BASE_SHA}" || "${BASE_SHA}" =~ ^0+$ ]]; then
  if git rev-parse HEAD^ >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse HEAD^)"
  else
    BASE_SHA="${HEAD_SHA}"
  fi
fi

mapfile -t CHANGED_POST_URLS < <(
  git diff --name-only "${BASE_SHA}" "${HEAD_SHA}" \
    | rg '^src/content/docs/blog/.*\.(md|mdx)$' \
    | sed -E 's#^src/content/docs##; s#\.(md|mdx)$##; s#$#/index.html#' \
    | sort -u
)

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
  [[ -n "${SEEN[$url]:-}" ]] && continue
  SEEN["$url"]=1
  FINAL_URLS+=("$url")
done

printf 'Testing URLs:\n' >&2
printf ' - %s\n' "${FINAL_URLS[@]}" >&2

printf '%s\n' "${FINAL_URLS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'
