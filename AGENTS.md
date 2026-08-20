# cf-crawl

TypeScript CLI over the Cloudflare Browser Rendering API and Workers AI `tomarkdown`:
async site crawls, synchronous single-page operations, and local file conversion.

Runtime needs `.env` with `CF_ACCOUNT_ID` and `CF_API_TOKEN`; `.env.example` is the template.

ESM, strict TypeScript. Local imports carry a `.js` extension over `.ts` sources.

Normal control flow exits only through `index.ts`; CLI and config validation throw the
typed errors in `src/errors.ts`. The SIGINT handler in `src/cli.ts` is the one other exit.

Behavior changes update `CHANGELOG.md` alongside the code and tests.

For command usage and flags, see README.md.
For module layout and runtime invariants, see docs/ARCHITECTURE.md.
For agent-facing command selection and cost guidance, see skill.md.
