# check-citation-nonr v1
"""Citation-metadata consistency gate for repositories without a DESCRIPTION.

WHY THIS EXISTS. `CITATION.cff` and `.zenodo.json` each carry a copy of the
release version, and nothing asserts that the copy is right. In the R packages
`scripts/check-citation.py` keeps both in step with `DESCRIPTION`. The Node and
Swift repositories joining Zenodo have no `DESCRIPTION`, so that gate has
nothing to read there, and without a gate of their own their metadata drifts
from the release it names: measured on the R fleet, four of seven repositories
had drifted before a gate existed (SEOR-lreejxat). This is the smaller sibling
for the repositories that keep their version somewhere else. Why it is a
separate script rather than more sources in the R one is
design/adr/0006-non-r-citation-metadata-has-its-own-gate.md.

WHERE THE VERSION LIVES. Each repository declares its source with `--source`
on the hook entry. The flag is required and has no default: the gate never
guesses, because a guess is exactly how a repository whose `package.json` holds
a placeholder would come to cite the placeholder.

* `--source package-json` - the `version` field of `package.json` at the
  repository root. Node repositories bump it when they release and leave it
  alone in between, so it always names the latest release. In step means
  `CITATION.cff` `version:` and `.zenodo.json` `"version"` equal it exactly.
  Bump all three in the release commit.
* `--source git-tag` - the highest `vX.Y.Z` tag merged into HEAD, compared as
  numbers (so v0.10.0 is newer than v0.9.0), with the `v` stripped. For
  repositories with no manifest version (Swift) and for ones whose
  `package.json` holds a `0.0.0` placeholder; the placeholder is never read.
  In step means both files equal that tag. Between releases they keep naming
  the latest tag, just as an R package's `X.Y.Z.9000` still cites `X.Y.Z`.
  Only `vX.Y.Z` tags count: `v2.0.0-rc.1`, `v1.2` or `vendor-foo` are ignored.
  "Merged into HEAD" is what the tree descends from, so a branch cut before the
  latest release is judged against the release it was cut from. The tag has to
  exist when the gate runs: bump the files, commit, tag that commit, then push
  (the pre-push hook sees local tags).

NEVER RELEASED. When the source names no release - `package.json` says
`0.0.0`, or no `vX.Y.Z` tag is merged into HEAD - there is no version to cite.
Both files then carry no version, no `date-released` and no DOI, the same
honesty clause the R gate applies to a package that has never released. A
file that does claim a version in that state fails, which is also what a
shallow or tagless clone looks like, so the gate fails loudly there instead of
passing: CI for a `git-tag` repository needs git and the tags in the image
(on GitLab, `GIT_DEPTH: 0`).

WHAT IT CHECKS.

1. `CITATION.cff` `version:` equals the release the source names.
2. `.zenodo.json` `"version"`, same rule.
3. A repository that has never released claims no version, no
   `date-released` and no DOI in either file.
4. A repository carrying neither file passes: whether it should have them is a
   separate question, not drift.

WHAT IT DOES NOT CHECK, ON PURPOSE.

* URLs. The R gate cross-checks them against `DESCRIPTION`'s `URL:`; there is
  no equivalent single field here, and inventing one would be a rule nobody
  decided.
* Whether `date-released` is the tag's date. The R gate does not check that
  either.
* The network. Everything is read from the working tree and local git.

Stdlib only, so it runs in a bare Python image or any repository without adding
a dependency. `CITATION.cff` is read with a deliberately small top-level-scalar
reader rather than a YAML parser for the same reason; it refuses to guess when
the file does not have that shape.

    python3 scripts/check-citation-nonr.py --source package-json  # exit 1 on drift
    python3 scripts/check-citation-nonr.py --source git-tag       # exit 1 on drift
    python3 scripts/check-citation-nonr.py --self-test            # fixtures + digest
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# --- fleet sync --------------------------------------------------------------
#
# THIS FILE IS VENDORED. seor holds the reference copy; each non-R repository
# carrying citation metadata holds a byte-identical implementation, because a
# fresh clone's hooks cannot depend on a sibling checkout. The mechanism is
# check-citation.py's (SEOR-tssbiedr): the digest below covers the
# IMPLEMENTATION -- every byte below the module docstring, minus this
# assignment -- so the prose above may differ per repository while any change
# to behavior is caught. Bytes rather than a parse-tree hash, so the digest
# does not move with the Python version running it.
#
# `main()` verifies it on every run, so it is armed in every copy whether or
# not that repository runs `--self-test`. Whether the copies agree is one grep:
#
#     grep -h '^IMPLEMENTATION_DIGEST' ~/Projects/*/scripts/check-citation-nonr.py | sort -u
#
# One line out means every copy is in sync. Re-bless it in every copy in the
# same change, never in one. It is a different digest from check-citation.py's
# on purpose: the two scripts are re-blessed independently (ADR 0006).
IMPLEMENTATION_DIGEST = "73ffec92ee64fe3b"


SOURCES = ("package-json", "git-tag")

# A top-level `key: value` line in a CFF file: no leading whitespace, and not a
# block opener (`key:` with nothing after it, which starts a mapping or list).
CFF_SCALAR = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):[ \t]+(.+?)[ \t]*$")
CFF_KEY = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):")

# The only tags that name a release. Anything else matching `v*` is ignored.
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")

# What a `package.json` says before its repository has ever released.
PLACEHOLDER_VERSION = "0.0.0"

# Claims that only a release can back.
CFF_RELEASE_CLAIMS = ("date-released", "doi", "identifiers")

# Environment variables that pin git to a repository other than the one named
# by `-C`. A hook runs with some of them set, and the self-test's fixtures must
# not read the enclosing repository's tags. This is `git rev-parse
# --local-env-vars`, the list git itself clears for submodules.
GIT_LOCAL_ENV = frozenset(
    {
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
        "GIT_OBJECT_DIRECTORY",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_IMPLICIT_WORK_TREE",
        "GIT_GRAFT_FILE",
        "GIT_INDEX_FILE",
        "GIT_NO_REPLACE_OBJECTS",
        "GIT_REPLACE_REF_BASE",
        "GIT_PREFIX",
        "GIT_INTERNAL_SUPER_PREFIX",
        "GIT_SHALLOW_FILE",
        "GIT_COMMON_DIR",
    }
)


def module_docstring_end(source: str) -> int:
    """The 1-based line on which this module's docstring ends, or 0 if none."""
    body = ast.parse(source).body
    if body:
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            return first.end_lineno or 0
    return 0


def implementation_source(source: str) -> str:
    """This file's bytes below the docstring, minus the digest assignment."""
    lines = source.splitlines(keepends=True)
    start = module_docstring_end(source)
    return "".join(
        line
        for line in lines[start:]
        if not line.startswith("IMPLEMENTATION_DIGEST = ")
    )


def implementation_digest(source: str) -> str:
    """The recorded digest's counterpart: what this file actually is."""
    return hashlib.sha256(implementation_source(source).encode()).hexdigest()[:16]


def check_vendored_copy() -> list[str]:
    """Fail when this copy's implementation is not the one it claims to be."""
    found = implementation_digest(Path(__file__).resolve().read_text(encoding="utf-8"))
    if found == IMPLEMENTATION_DIGEST:
        return []
    return [
        f"vendored copy drifted: implementation digest is {found}, "
        f"IMPLEMENTATION_DIGEST records {IMPLEMENTATION_DIGEST}. Either this "
        "copy was edited without re-blessing it, or it was re-blessed without "
        "the other copies. Fix every copy in one change (ADR 0006)."
    ]


def git_env() -> dict[str, str]:
    """The environment minus anything pinning git to another repository."""
    return {k: v for k, v in os.environ.items() if k not in GIT_LOCAL_ENV}


def git(root: Path, *args: str) -> str | None:
    """Run git in `root`, returning None if it fails (no git, no repository).

    S603/S607 as in check-design.py: no shell is involved, every argument is a
    literal or a path passed after `-C`, and `git` is resolved from PATH on
    purpose so the script runs wherever the checkout does.
    """
    try:
        result = subprocess.run(  # noqa: S603
            ["git", "-C", str(root), *args],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
            env=git_env(),
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return result.stdout


def read_cff(path: Path) -> tuple[dict[str, str], set[str]]:
    """Top-level scalars, plus the set of every top-level key present.

    The key set is what lets `version:`, `date-released:` and `identifiers:`
    be detected whether they are scalars or block openers.
    """
    scalars: dict[str, str] = {}
    keys: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        key_match = CFF_KEY.match(line)
        if key_match:
            keys.add(key_match.group(1))
        scalar = CFF_SCALAR.match(line)
        if scalar:
            scalars[scalar.group(1)] = scalar.group(2).strip().strip("\"'")
    return scalars, keys


def version_from_package_json(root: Path) -> tuple[str | None, str, list[str]]:
    """(release or None if never released, where it came from, errors)."""
    path = root / "package.json"
    where = "package.json `version`"
    if not path.exists():
        return None, where, [
            "package.json is missing; `--source package-json` has nothing to read."
        ]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return None, where, [f"package.json is not valid JSON: {exc}"]
    version = data.get("version") if isinstance(data, dict) else None
    if not isinstance(version, str) or not version.strip():
        return None, where, ["package.json has no string `version` field."]
    version = version.strip()
    if version == PLACEHOLDER_VERSION:
        return None, f"{where} ({PLACEHOLDER_VERSION})", []
    return version, f"{where} ({version})", []


def version_from_git_tag(root: Path) -> tuple[str | None, str, list[str]]:
    """(release or None if never released, where it came from, errors)."""
    where = "the newest vX.Y.Z tag merged into HEAD"
    # An explicit sort, so a user's `tag.sort` cannot change what is listed
    # first; the newest release is chosen by `max()` below either way.
    listed = git(root, "tag", "--list", "v*", "--merged", "HEAD", "--sort=refname")
    if listed is None:
        return None, where, [
            "could not list git tags (no git on PATH, not a repository, or no "
            "commit yet); `--source git-tag` has nothing to read."
        ]
    releases = []
    for tag in listed.split():
        match = RELEASE_TAG.match(tag)
        if match:
            releases.append(tuple(int(part) for part in match.groups()))
    if not releases:
        where += " (none found; a shallow or tagless clone looks the same)"
        return None, where, []
    newest = ".".join(str(part) for part in max(releases))
    return newest, f"{where} (v{newest})", []


RESOLVERS = {
    "package-json": version_from_package_json,
    "git-tag": version_from_git_tag,
}


def check_repo(root: Path, source: str) -> list[str]:
    """Findings for one repository; empty when the metadata agrees."""
    if source not in RESOLVERS:
        declared = ", ".join(SOURCES)
        return [f"unknown version source {source!r}; declare one of {declared}."]

    cff_path = root / "CITATION.cff"
    zenodo_path = root / ".zenodo.json"
    if not cff_path.exists() and not zenodo_path.exists():
        # Whether this repository should carry them is a separate question.
        return []

    expected, where, errors = RESOLVERS[source](root)
    if errors:
        return errors

    unreleased = f"{where} names no release: there is no version, date or DOI to cite."

    if cff_path.exists():
        scalars, keys = read_cff(cff_path)
        if expected is None:
            for claim in ("version", *CFF_RELEASE_CLAIMS):
                if claim in keys:
                    errors.append(f"CITATION.cff carries `{claim}:`, but {unreleased}")
        elif "version" not in scalars:
            errors.append(
                "CITATION.cff has no top-level `version:` scalar. Either it is "
                "absent or this gate's reader does not understand the file; "
                "both need a human."
            )
        elif scalars["version"] != expected:
            errors.append(
                f"CITATION.cff says version {scalars['version']}; {where} "
                f"names release {expected}."
            )

    if zenodo_path.exists():
        try:
            data = json.loads(zenodo_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f".zenodo.json is not valid JSON: {exc}")
            data = None
        if data is not None and not isinstance(data, dict):
            errors.append(".zenodo.json is not a JSON object.")
        elif isinstance(data, dict):
            if expected is None:
                for claim in ("version", "doi"):
                    if claim in data:
                        errors.append(
                            f".zenodo.json carries `{claim}`, but {unreleased}"
                        )
            elif "version" not in data:
                errors.append(".zenodo.json has no `version` key.")
            elif data["version"] != expected:
                errors.append(
                    f".zenodo.json says version {data['version']}; {where} "
                    f"names release {expected}."
                )

    return errors


# --- self-test (positive + negative coverage, executable) --------------------

RELEASED_CFF = (
    "cff-version: 1.2.0\ntype: software\nversion: {version}\n"
    'date-released: "2026-09-29"\n'
)
UNRELEASED_CFF = "cff-version: 1.2.0\ntype: software\ntitle: fixture\n"


def _fixture_git(directory: Path, *args: str) -> None:
    """Git for building fixtures, isolated from the user's and the hook's config."""
    env = git_env()
    env.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.org",
            "GIT_COMMITTER_NAME": "fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.org",
        }
    )
    subprocess.run(  # noqa: S603
        ["git", "-C", str(directory), *args],  # noqa: S607
        capture_output=True,
        check=True,
        env=env,
    )


def _fixture(
    directory: Path,
    *,
    cff: str | None,
    zenodo: dict | None,
    package_json: str | None = None,
    tags: list[str] | None = None,
    unmerged_tags: tuple[str, ...] = (),
) -> Path:
    """A repository on disk. `tags=None` means no git at all.

    Each tag gets its own commit on the current branch, alternating
    lightweight and annotated tags (unbreak carries both). `unmerged_tags`
    sit on a side branch that HEAD does not contain.
    """
    directory.mkdir(parents=True, exist_ok=True)
    if package_json is not None:
        (directory / "package.json").write_text(
            json.dumps({"name": "fixture", "version": package_json}), encoding="utf-8"
        )
    if cff is not None:
        (directory / "CITATION.cff").write_text(cff, encoding="utf-8")
    if zenodo is not None:
        (directory / ".zenodo.json").write_text(json.dumps(zenodo), encoding="utf-8")
    if tags is None:
        return directory
    _fixture_git(directory, "init", "-q")
    _fixture_git(directory, "commit", "-q", "--allow-empty", "-m", "root")
    for index, tag in enumerate(tags):
        _fixture_git(directory, "commit", "-q", "--allow-empty", "-m", tag)
        if index % 2:
            _fixture_git(directory, "tag", "-a", "-m", tag, tag)
        else:
            _fixture_git(directory, "tag", tag)
    if unmerged_tags:
        _fixture_git(directory, "checkout", "-q", "-b", "side")
        for tag in unmerged_tags:
            _fixture_git(directory, "commit", "-q", "--allow-empty", "-m", tag)
            _fixture_git(directory, "tag", tag)
        _fixture_git(directory, "checkout", "-q", "-")
    return directory


def _released(version: str) -> dict:
    return {
        "cff": RELEASED_CFF.format(version=version),
        "zenodo": {"version": version},
    }


def self_test() -> list[str]:
    """Run every case, collecting failures rather than stopping at the first.

    A mutation that breaks one source should show every fixture it breaks, so
    the report names them all in one run.
    """
    failures: list[str] = []
    counts = {"positive": 0, "negative": 0}

    def run(tag: str, source: str, **kwargs) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            return check_repo(_fixture(Path(tmp) / tag, **kwargs), source)

    def expect_clean(tag: str, source: str, **kwargs) -> None:
        counts["positive"] += 1
        found = run(tag, source, **kwargs)
        if found:
            failures.append(f"{tag}: expected clean, got {found}")

    def expect_flagged(tag: str, needle: str, source: str, **kwargs) -> None:
        counts["negative"] += 1
        found = run(tag, source, **kwargs)
        if not any(needle in f for f in found):
            failures.append(f"{tag}: expected {needle!r}, got {found}")

    # --- package.json (cc-cream, cf-crawl) ---
    # POSITIVE: the files name the version package.json names.
    expect_clean(
        "pkg-in-step",
        "package-json",
        package_json="0.5.4",
        **_released("0.5.4"),
    )
    # NEGATIVE: CITATION.cff left behind a release bump.
    expect_flagged(
        "pkg-drift-cff",
        "CITATION.cff says version 0.5.3",
        "package-json",
        package_json="0.5.4",
        cff=RELEASED_CFF.format(version="0.5.3"),
        zenodo={"version": "0.5.4"},
    )
    # NEGATIVE: .zenodo.json left behind a release bump.
    expect_flagged(
        "pkg-drift-zenodo",
        ".zenodo.json says version 0.5.3",
        "package-json",
        package_json="0.5.4",
        cff=RELEASED_CFF.format(version="0.5.4"),
        zenodo={"version": "0.5.3"},
    )
    # NEGATIVE: a 0.0.0 package.json names no release, so a file citing one -
    # with a release date, even - is claiming something that does not exist.
    # This is also what declaring the wrong source on linklint looks like.
    expect_flagged(
        "pkg-placeholder-cited",
        "names no release",
        "package-json",
        package_json="0.0.0",
        **_released("0.0.0"),
    )
    # NEGATIVE: package.json declared but absent.
    expect_flagged(
        "pkg-missing",
        "package.json is missing",
        "package-json",
        **_released("1.0.0"),
    )

    # --- git tags (unbreak) ---
    # POSITIVE: the files name the newest tag, mixing lightweight and annotated.
    expect_clean(
        "tag-in-step",
        "git-tag",
        tags=["v0.1.2", "v0.7.1", "v0.7.2"],
        **_released("0.7.2"),
    )
    # POSITIVE: v0.10.0 is newer than v0.9.0 - numbers, not strings.
    expect_clean(
        "tag-numeric-order",
        "git-tag",
        tags=["v0.10.0", "v0.9.0"],
        **_released("0.10.0"),
    )
    # POSITIVE: only vX.Y.Z tags name a release.
    expect_clean(
        "tag-non-release-ignored",
        "git-tag",
        tags=["v1.0.0", "v2.0.0-rc.1", "vendor-snapshot", "v3.0"],
        **_released("1.0.0"),
    )
    # POSITIVE: a tag on a branch HEAD does not contain is not this tree's release.
    expect_clean(
        "tag-unmerged-ignored",
        "git-tag",
        tags=["v0.7.2"],
        unmerged_tags=("v0.8.0",),
        **_released("0.7.2"),
    )
    # POSITIVE: never released - no version, no date, no DOI anywhere.
    expect_clean(
        "tag-never-released",
        "git-tag",
        tags=[],
        cff=UNRELEASED_CFF,
        zenodo={"title": "fixture"},
    )
    # POSITIVE: neither file is not drift, and needs no source at all.
    expect_clean("absent", "git-tag", cff=None, zenodo=None)
    # NEGATIVE: the files stayed on the previous tag.
    expect_flagged(
        "tag-drift",
        "CITATION.cff says version 0.7.1",
        "git-tag",
        tags=["v0.7.1", "v0.7.2"],
        cff=RELEASED_CFF.format(version="0.7.1"),
        zenodo={"version": "0.7.2"},
    )
    # NEGATIVE: string order would call v0.9.0 the newest.
    expect_flagged(
        "tag-drift-string-order",
        ".zenodo.json says version 0.9.0",
        "git-tag",
        tags=["v0.9.0", "v0.10.0"],
        cff=RELEASED_CFF.format(version="0.10.0"),
        zenodo={"version": "0.9.0"},
    )
    # NEGATIVE: a version claimed with no tag - also a shallow, tagless clone.
    expect_flagged(
        "tag-none-but-claimed",
        "names no release",
        "git-tag",
        tags=[],
        **_released("0.1.0"),
    )
    # NEGATIVE: the honesty clause - a release date with no release.
    expect_flagged(
        "tag-none-but-dated",
        "carries `date-released:`",
        "git-tag",
        tags=[],
        cff=UNRELEASED_CFF + 'date-released: "2026-01-01"\n',
        zenodo={"title": "fixture"},
    )
    # NEGATIVE: the honesty clause on the Zenodo side.
    expect_flagged(
        "tag-none-but-doi",
        ".zenodo.json carries `doi`",
        "git-tag",
        tags=[],
        cff=UNRELEASED_CFF,
        zenodo={"doi": "10.5281/zenodo.1"},
    )

    # --- placeholder package.json plus tags (linklint) ---
    # POSITIVE: the tag is the release; the 0.0.0 placeholder is never read.
    expect_clean(
        "placeholder-in-step",
        "git-tag",
        package_json="0.0.0",
        tags=["v1.1.0", "v1.2.0"],
        **_released("1.2.0"),
    )
    # NEGATIVE: the files copied the placeholder instead of the tag.
    expect_flagged(
        "placeholder-cited",
        "CITATION.cff says version 0.0.0",
        "git-tag",
        package_json="0.0.0",
        tags=["v1.2.0"],
        **_released("0.0.0"),
    )
    # NEGATIVE: the files stayed on the previous tag.
    expect_flagged(
        "placeholder-drift",
        ".zenodo.json says version 1.1.0",
        "git-tag",
        package_json="0.0.0",
        tags=["v1.1.0", "v1.2.0"],
        cff=RELEASED_CFF.format(version="1.2.0"),
        zenodo={"version": "1.1.0"},
    )

    # --- either source ---
    # NEGATIVE: a CITATION.cff this reader cannot understand must not pass.
    expect_flagged(
        "unreadable-cff",
        "does not understand",
        "package-json",
        package_json="1.0.0",
        cff="cff-version: 1.2.0\nversion:\n  - 1.0.0\n",
        zenodo={"version": "1.0.0"},
    )
    # NEGATIVE: no guessing - an undeclared source is refused.
    expect_flagged(
        "unknown-source",
        "unknown version source",
        "auto",
        package_json="1.0.0",
        **_released("1.0.0"),
    )

    # The vendored-copy digest (see IMPLEMENTATION_DIGEST). These cases prove
    # what it is FOR -- that it ignores prose and catches code -- rather than
    # only asserting that this copy matches today, which main() already does.
    # Built by position, not by replacing a phrase, as in check-citation.py.
    here = Path(__file__).resolve().read_text(encoding="utf-8")
    lines = here.splitlines(keepends=True)
    end = module_docstring_end(here)
    if implementation_digest(here) != IMPLEMENTATION_DIGEST:
        failures.append("vendor-untouched: digest mismatch")
    if end == 0:
        failures.append("vendor-prose: no module docstring")
    else:
        inserted = ["Inserted by the self-test.\n"]
        prose = "".join(lines[: end - 1] + inserted + lines[end - 1 :])
        if implementation_digest(prose) != IMPLEMENTATION_DIGEST:
            failures.append("vendor-prose: a docstring edit moved the digest")
    if implementation_digest(here + "\n_ = None\n") == IMPLEMENTATION_DIGEST:
        failures.append("vendor-logic: a code edit left the digest alone")
    reblessed = here.replace(
        'IMPLEMENTATION_DIGEST = "' + IMPLEMENTATION_DIGEST + '"',
        'IMPLEMENTATION_DIGEST = "0000000000000000"',
    )
    if reblessed == here:
        failures.append("vendor-rebless: constant not found")
    elif implementation_digest(reblessed) != IMPLEMENTATION_DIGEST:
        failures.append("vendor-rebless: the digest hashes its own value")

    if not failures:
        print(
            f"check-citation-nonr self-test: PASS ({counts['positive']} positive "
            f"+ {counts['negative']} negative cases, 4 vendor-digest cases)"
        )
    return failures


def main() -> int:
    drift = check_vendored_copy()
    if drift:
        print("check-citation-nonr failed:", file=sys.stderr)
        for error in drift:
            print(f"  - {error}", file=sys.stderr)
        return 1

    parser = argparse.ArgumentParser(
        description="CITATION.cff and .zenodo.json name the release version."
    )
    parser.add_argument(
        "--source",
        choices=SOURCES,
        help="where this repository's release version lives (required)",
    )
    parser.add_argument("--self-test", action="store_true", help="run the fixtures")
    args = parser.parse_args()

    if args.self_test:
        failures = self_test()
        if failures:
            print("check-citation-nonr self-test FAILED:", file=sys.stderr)
            for failure in failures:
                print(f"  - {failure}", file=sys.stderr)
            return 1
        return 0

    if args.source is None:
        parser.error(
            "--source is required: declare where this repository's release "
            "version lives. The gate never guesses."
        )

    errors = check_repo(Path(__file__).resolve().parent.parent, args.source)
    if errors:
        print("check-citation-nonr failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(f"check-citation-nonr: CITATION.cff and .zenodo.json agree ({args.source}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
