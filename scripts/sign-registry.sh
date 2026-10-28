#!/bin/sh
# Signs the current commit's registry for Backslash: a commit with the same
# files on the `signed` branch, signed with the registry key. Backslash only
# reads a registry signed by this key, and never an older one than it saw.
# Runs in CI after the checks pass on main (see .github/workflows/check.yml).
#   REGISTRY_SIGNING_KEY="$(cat key)" scripts/sign-registry.sh
# Without REGISTRY_SIGNING_KEY, says so and stops.
set -eu
cd "$(dirname "$0")/.."

if [ -z "${REGISTRY_SIGNING_KEY:-}" ]; then
  echo "::notice::No REGISTRY_SIGNING_KEY secret: the registry was not signed"
  exit 0
fi
key=$(mktemp)
trap 'rm -f "$key"' EXIT
printf '%s\n' "$REGISTRY_SIGNING_KEY" > "$key"
chmod 600 "$key"

source=$(git rev-parse HEAD)
tree=$(git rev-parse "HEAD^{tree}")
parent=
if git fetch -q --depth 1 origin signed 2>/dev/null; then
  parent=$(git rev-parse FETCH_HEAD)
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "signed already has these files"
    exit 0
  fi
fi

# ssh-keygen explicitly: a configured gpg.ssh.program could sign with another key.
commit=$(git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey="$key" \
  -c user.name="Backslash Registry" -c user.email="contact@getbackslash.com" \
  commit-tree -S "$tree" ${parent:+-p "$parent"} -m "Registry at $source")
git push -q origin "$commit:refs/heads/signed"
echo "Signed the registry at $source as $commit"
