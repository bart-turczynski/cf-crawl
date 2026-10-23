# cf-crawl

TypeScript CLI over the Cloudflare Browser Rendering API and Workers AI `tomarkdown`:
async site crawls, synchronous single-page operations, and local file conversion.

Runtime needs `.env` with `CF_ACCOUNT_ID` and `CF_API_TOKEN`. The maintainer generates it from
`.env.tpl` with `op inject -f -i .env.tpl -o .env` (a file, not `op run`, because dotenv and
`scripts/*.sh` read `.env`); `.env.example` is the template for everyone else.

ESM, strict TypeScript. Local imports carry a `.js` extension over `.ts` sources.

Normal control flow exits only through `index.ts`; CLI and config validation throw the
typed errors in `src/errors.ts`. The SIGINT handler in `src/cli.ts` is the one other exit.

Behavior changes update `CHANGELOG.md` alongside the code and tests.

GitLab is the source of truth. GitHub carries a read-only push mirror with Actions off: add no
`.github/workflows/`, and never push there. Setup: seor `design/github-mirror.md`.

Verify with `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm citation:check`,
`pnpm test` — the chain `.githooks/pre-push` and `.gitlab-ci.yml` both run.

A release bumps `version` in `package.json`, `CITATION.cff` and `.zenodo.json` together, and
`date-released` with them. The Zenodo DOI comes from the GitHub Release: seor
`design/github-mirror.md` §5. Zenodo reads the tagged tree, so make a GitHub Release only for a
tag whose tree carries both files: never for `v4.0.0`, which predates them.
`scripts/check-citation-nonr.py` is vendored from seor; change it there, never here.

For command usage and flags, see README.md.
For module layout and runtime invariants, see docs/ARCHITECTURE.md.
For agent-facing command selection and cost guidance, see skill/SKILL.md — the whole
of what Claude sees, and what `~/.claude/skills/cf-crawl` links.
