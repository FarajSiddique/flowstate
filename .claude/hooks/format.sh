#!/usr/bin/env bash
# PostToolUse hook: formats each file Claude edits, then applies ESLint fixes.
# Errors ESLint can't fix go to stderr with exit 2, so Claude sees them and fixes them.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
file="$(jq -r '.tool_input.file_path // empty')"

if [[ -z "$file" || ! -f "$file" || "$file" != "$root"/* ]]; then
  exit 0
fi

cd "$root" || exit 0
pnpm exec prettier --write --ignore-unknown --log-level warn "$file" >/dev/null 2>&1

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac

# ESLint 9 resolves config from the cwd, so run it from the owning workspace.
dir="$(dirname "$file")"
while [[ "$dir" != "$root" ]] && ! compgen -G "$dir/eslint.config.*" >/dev/null; do
  dir="$(dirname "$dir")"
done

if ! compgen -G "$dir/eslint.config.*" >/dev/null; then
  exit 0
fi

cd "$dir" || exit 0

if ! output="$(pnpm exec eslint --fix --no-warn-ignored --max-warnings 0 "$file" 2>&1)"; then
  echo "ESLint found problems it could not fix in $file:" >&2
  echo "$output" >&2
  exit 2
fi
