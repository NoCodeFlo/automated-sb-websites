#!/usr/bin/env bash

# Exit on error
set -o errexit

echo "--- Install dependencies (ci if lock present)"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Optional build step (no-op for this API)
# npm run build || true

echo "--- Ensure Puppeteer cache directory exists"
export PUPPETEER_CACHE_DIR="/opt/render/.cache/puppeteer"
mkdir -p "$PUPPETEER_CACHE_DIR"

echo "--- Try to reuse Chrome from build cache"
BUILD_CACHE_DIR="/opt/render/project/src/.cache/puppeteer"
if [ -d "$BUILD_CACHE_DIR/chrome" ]; then
  echo "Copying Chrome from build cache to $PUPPETEER_CACHE_DIR"
  mkdir -p "$PUPPETEER_CACHE_DIR"
  cp -R "$BUILD_CACHE_DIR/chrome" "$PUPPETEER_CACHE_DIR/" || true
fi

echo "--- Install Chrome for Puppeteer cache (fallback)"
# Use npx to run the Puppeteer installer CLI without adding puppeteer as a dep
npx puppeteer browsers install chrome || true

echo "--- Store Puppeteer cache back into build cache for next deploy"
mkdir -p "$BUILD_CACHE_DIR"
cp -R "$PUPPETEER_CACHE_DIR/chrome" "$BUILD_CACHE_DIR/" 2>/dev/null || true

echo "Build script finished."

