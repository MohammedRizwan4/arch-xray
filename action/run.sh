#!/usr/bin/env bash
# ArchXray composite-action driver: diff the PR, publish report to gh-pages, post/update the comment.
set -euo pipefail

if [ -z "${PR_NUMBER}" ]; then
  echo "::error::no PR number — run on a pull_request event or pass pr-number"
  exit 1
fi

# On pull_request events the merge ref is checked out and GITHUB_BASE_REF is set.
# On workflow_dispatch we resolve everything from the PR itself.
HEAD_REF="HEAD"
if [ -z "${GITHUB_BASE_REF:-}" ]; then
  GITHUB_BASE_REF=$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq .base.ref)
  HEAD_SHA=$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq .head.sha)
  git fetch -q origin "pull/${PR_NUMBER}/head"
  HEAD_REF="${HEAD_SHA}"
fi

BASE_REF="${INPUT_BASE:-origin/${GITHUB_BASE_REF}}"
OWNER="${GITHUB_REPOSITORY%%/*}"
REPO="${GITHUB_REPOSITORY##*/}"
PR_DIR="pr-${PR_NUMBER}"
PAGES_URL="https://${OWNER,,}.github.io/${REPO}/${PR_DIR}/report.html"
# raw URL works even before Pages is enabled; ?v= busts GitHub's image cache per push
IMAGE_URL="https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/gh-pages/${PR_DIR}/diff.svg?v=${HEAD_SHA}"

echo "::group::ArchXray diff (${BASE_REF} -> HEAD)"
set +e
node "$GITHUB_ACTION_PATH/bin/archxray.js" diff \
  --repo . --base "$BASE_REF" --head "$HEAD_REF" --out archxray-out \
  --image-url "$IMAGE_URL" --report-url "$PAGES_URL" \
  $([ "$INPUT_FAIL" = "true" ] && echo --fail-on-violation)
XRAY_EXIT=$?
set -e
echo "::endgroup::"

find_comment() {
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate \
    --jq '[.[] | select(.body | contains("<!-- archxray -->"))][0].id' 2>/dev/null || true
}

if [ ! -f archxray-out/comment.md ]; then
  echo "Architecture untouched — staying quiet."
  EXISTING=$(find_comment)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
    printf '<!-- archxray -->\n## 🩻 Architecture X-Ray\n\n🤫 The latest push no longer touches the architecture.\n' > /tmp/quiet.md
    gh api "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING}" -X PATCH -F body=@/tmp/quiet.md > /dev/null
  fi
  exit 0
fi

echo "::group::Publish report to gh-pages/${PR_DIR}"
GHP=$(mktemp -d)
git config --global user.name 'archxray[bot]'
git config --global user.email 'archxray[bot]@users.noreply.github.com'
REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git clone --depth 1 --branch gh-pages "$REMOTE" "$GHP" 2>/dev/null; then
  :
else
  git init -b gh-pages "$GHP"
  git -C "$GHP" remote add origin "$REMOTE"
fi
mkdir -p "$GHP/$PR_DIR"
cp archxray-out/report.html archxray-out/diff.svg archxray-out/diff.json "$GHP/$PR_DIR/"
touch "$GHP/.nojekyll"
git -C "$GHP" add -A
git -C "$GHP" commit -m "archxray: report for PR #${PR_NUMBER} (${HEAD_SHA})" > /dev/null
# concurrent PR runs race on gh-pages — rebase and retry
for attempt in 1 2 3 4; do
  if git -C "$GHP" push origin gh-pages 2>/dev/null; then break; fi
  echo "gh-pages push rejected (attempt ${attempt}) — rebasing"
  git -C "$GHP" pull --rebase origin gh-pages
  sleep $((attempt * 2))
done
echo "::endgroup::"

echo "::group::Post PR comment"
EXISTING=$(find_comment)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING}" -X PATCH -F body=@archxray-out/comment.md > /dev/null
  echo "Updated existing comment ${EXISTING}"
else
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -X POST -F body=@archxray-out/comment.md > /dev/null
  echo "Posted new comment"
fi
echo "::endgroup::"

echo "Report: ${PAGES_URL}"
exit $XRAY_EXIT
