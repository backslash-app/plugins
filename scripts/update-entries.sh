#!/bin/sh
# Regenerates the registry entries of the first-party extensions from the
# current commit. Run after merging changes to extensions/, then commit.
set -eu
cd "$(dirname "$0")/.."
for dir in extensions/*/; do
  id=$(basename "$dir")
  backslash publish "$dir" | sed '1d' > "registry/$id.toml"
  echo "registry/$id.toml"
done
