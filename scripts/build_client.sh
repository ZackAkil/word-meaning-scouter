#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/client"
DIST_DIR="$ROOT_DIR/client_dist"

echo "Building and minifying frontend assets into client_dist/..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 1. Bundle & minify JS modules into a single file
npx --yes esbuild "$SRC_DIR/app.js" \
  --bundle \
  --minify \
  --format=esm \
  --outfile="$DIST_DIR/app.min.js"

# 2. Concatenate & minify CSS into a single file
cat "$SRC_DIR/css/base.css" \
    "$SRC_DIR/css/reader.css" \
    "$SRC_DIR/css/vocab.css" \
    "$SRC_DIR/css/print.css" \
  | npx --yes esbuild --loader=css --minify > "$DIST_DIR/bundle.min.css"

# 3. Copy static assets
if [ -f "$SRC_DIR/favicon.svg" ]; then
  cp "$SRC_DIR/favicon.svg" "$DIST_DIR/favicon.svg"
fi

# 4. Generate cache-busted index.html pointing to bundled assets
BUILD_HASH=$(shasum -a 256 "$DIST_DIR/app.min.js" "$DIST_DIR/bundle.min.css" | shasum -a 256 | cut -c1-8)

python3 - "$SRC_DIR/index.html" "$DIST_DIR/index.html" "$BUILD_HASH" <<'EOF'
import re
import sys

src_path, dst_path, build_hash = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(src_path, "r", encoding="utf-8").read()

# Replace local CSS links with single bundle.min.css
html = re.sub(
    r'(\s*<link rel="stylesheet" href="\./css/[^"]+">\s*)+',
    f'\n    <link rel="stylesheet" href="./bundle.min.css?v={build_hash}">\n',
    html,
)

# Replace app.js module entry with app.min.js
html = html.replace(
    '<script type="module" src="./app.js"></script>',
    f'<script type="module" src="./app.min.js?v={build_hash}"></script>',
)

open(dst_path, "w", encoding="utf-8").write(html)
EOF

echo "Frontend build complete (version: $BUILD_HASH):"
ls -lh "$DIST_DIR"
