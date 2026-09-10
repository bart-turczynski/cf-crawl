#!/bin/sh
set -eu

# Link this repo's skill/ directory into the user-level Claude skills dir.
#
# This is a script rather than a README one-liner because of what it has to
# replace. Before the skill/ move, an install was a real directory holding a
# symlink to the root skill.md:
#
#   ~/.claude/skills/cf-crawl/SKILL.md -> <repo>/skill.md
#
# A plain `ln -s <repo>/skill ~/.claude/skills/cf-crawl` against that lands
# *inside* the directory, creating ~/.claude/skills/cf-crawl/skill and leaving
# the dangling SKILL.md exactly where it was. It reports success. The skill
# stays broken. So the old shape has to be recognised and removed first, and
# only a shape this repository provably installed is ever removed.
#
# Idempotent: an already-correct link is left alone.

repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
skill_dir=$repo_root/skill
skill_link=${CLAUDE_HOME:-"$HOME/.claude"}/skills/cf-crawl

if [ ! -f "$skill_dir/SKILL.md" ]; then
  echo "error: $skill_dir/SKILL.md is missing; is this a full clone?" >&2
  exit 1
fi

# True when $1 is a symlink resolving to somewhere inside this repository —
# either the current skill/ or the pre-move skill.md. Anything else is someone
# else's link and is never touched.
points_into_repo() {
  [ -L "$1" ] || return 1
  target=$(readlink -- "$1")
  case $target in
    "$repo_root"|"$repo_root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

mkdir -p "$(dirname -- "$skill_link")"

if [ -L "$skill_link" ]; then
  if [ "$(readlink -- "$skill_link")" = "$skill_dir" ]; then
    echo "ok: $skill_link -> $skill_dir"
    exit 0
  fi
  if points_into_repo "$skill_link"; then
    echo "==> replacing an older link: $skill_link -> $(readlink -- "$skill_link")"
    rm -- "$skill_link"
  else
    echo "error: $skill_link is a symlink to $(readlink -- "$skill_link")," >&2
    echo "       which this repository did not create. Move it aside and re-run." >&2
    exit 1
  fi
elif [ -d "$skill_link" ]; then
  # The pre-move install: a real directory whose only entry is a SKILL.md
  # symlink into this repo. Both conditions are required before removing it,
  # so a directory holding anyone else's work is refused instead.
  entries=$(ls -A -- "$skill_link")
  if [ "$entries" = "SKILL.md" ] && points_into_repo "$skill_link/SKILL.md"; then
    echo "==> removing the pre-skill/ install: a directory holding $(readlink -- "$skill_link/SKILL.md")"
    rm -- "$skill_link/SKILL.md"
    rmdir -- "$skill_link"
  else
    echo "error: $skill_link is a real directory this repository did not create." >&2
    echo "       Inspect it, move it aside, and re-run." >&2
    exit 1
  fi
elif [ -e "$skill_link" ]; then
  echo "error: $skill_link exists and is neither a symlink nor a directory." >&2
  exit 1
fi

ln -s "$skill_dir" "$skill_link"
echo "==> linked $skill_link -> $skill_dir"

# Prove the entry point is readable through the link, not merely that ln exited 0.
if [ ! -f "$skill_link/SKILL.md" ]; then
  echo "error: $skill_link/SKILL.md is not readable through the new link." >&2
  exit 1
fi
echo "==> verified $skill_link/SKILL.md"
echo "==> done. Restart Claude Code so it picks up the change."
