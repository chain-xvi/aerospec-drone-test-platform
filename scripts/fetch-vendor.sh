#!/usr/bin/env bash
# Restores the vendored Three.js module (kept out of git due to size).
# The deployed site and any preview already ship with this file in place.
set -euo pipefail
cd "$(dirname "$0")/.."
THREE_VER="0.160.1"
curl -fsSL "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js" \
  -o vendor/three.module.js
echo "vendor/three.module.js restored ($(du -h vendor/three.module.js | cut -f1))"
