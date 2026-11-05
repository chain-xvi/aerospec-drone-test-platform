#!/usr/bin/env bash
# Cloudflare Pages build: restore vendored three.js, then assemble dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/fetch-vendor.sh
rm -rf dist
mkdir -p dist
cp -r index.html style.css main.js README.md js vendor dist/
echo "dist/ ready: $(du -sh dist | cut -f1)"
