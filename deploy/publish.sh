#!/bin/bash
# Build the public version and publish it to the gh-pages branch (served by GitHub Pages).
# Usage: npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
npm test
rm -rf dist && VITE_PUBLIC=true npx vite build
touch dist/.nojekyll
cd dist
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Published to gh-pages."
