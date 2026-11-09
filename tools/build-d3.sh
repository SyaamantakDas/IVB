#!/bin/sh
# Rebuilds vendor/d3.ivb.min.js: only the parts of D3 the map uses (select, pointer, geoConicConformal, geoPath,
# zoom, zoomIdentity and transitions), about a quarter of the full library. Run from the repository root.
set -e
dir=$(mktemp -d)
cd "$dir"
npm init -y > /dev/null
npm i --silent d3-selection@3.0.0 d3-geo@3.1.1 d3-zoom@3.0.0 d3-transition@3.0.1 esbuild@0.24.2
cat > entry.js <<'JS'
export { select, pointer } from "d3-selection";
export { geoConicConformal, geoPath } from "d3-geo";
export { zoom, zoomIdentity } from "d3-zoom";
import "d3-transition";
JS
npx esbuild entry.js --bundle --minify --format=iife --global-name=d3 --target=es2019 --outfile=d3.js
cd - > /dev/null
{
  echo "// IVB's subset of D3 (https://d3js.org, ISC licence, Copyright 2010-2023 Mike Bostock): d3-selection 3.0.0, d3-geo 3.1.1,"
  echo "// d3-zoom 3.0.0 and d3-transition 3.0.1, with what they use. Rebuild: see tools/build-d3.sh"
  cat "$dir/d3.js"
} > vendor/d3.ivb.min.js
rm -rf "$dir"
echo "wrote vendor/d3.ivb.min.js"
