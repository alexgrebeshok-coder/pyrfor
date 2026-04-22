#!/usr/bin/env bash
# Usage: ./tools/transfer-to-org.sh ceoclaw
# Transfers all ceoclaw repos to the specified GitHub org
ORG="${1:-ceoclaw}"
echo "🚀 Transferring repos to org: $ORG"

REPOS=(ceoclaw ceoclaw-engine ceoclaw-ochag ceoclaw-freeclaude)
for repo in "${REPOS[@]}"; do
  new_name="${repo#ceoclaw-}"   # strip ceoclaw- prefix
  [[ "$repo" == "ceoclaw" ]] && new_name="ceoclaw"
  echo -n "  $repo → $ORG/$new_name ... "
  gh api -X POST /repos/alexgrebeshok-coder/${repo}/transfer \
    --field new_owner="$ORG" \
    --field new_name="$new_name" \
    --jq '.full_name' 2>&1
done

echo ""
echo "After transfer, update remotes:"
echo "  git remote set-url origin https://github.com/$ORG/ceoclaw.git"
echo "  git remote set-url engine  https://github.com/$ORG/engine.git"
echo "  git remote set-url ochag   https://github.com/$ORG/ochag.git"
echo "  git remote set-url freeclaude https://github.com/$ORG/freeclaude.git"
