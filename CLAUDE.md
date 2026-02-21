# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build   # Compile src/ → dist/ via tsup (CJS bundle, all deps inlined)
npm run dev     # Run locally with ts-node (requires GitHub Actions context env vars)
```

There are no tests for this project itself. There is no lint script.

**Important:** `dist/` must be committed alongside `src/` changes — the GitHub Action runs from `dist/index.js`. The `release.yml` workflow auto-commits `dist/` on pushes to `main`, but when working locally you must run `npm run build` and commit both together.

## Architecture

Three source files in `src/`:

- **`github.ts`** — All GitHub API interactions: fetching PR changed files, reading/writing comments, committing skeleton test files, posting review suggestions.
- **`claude.ts`** — `analyzeChanges()` calls the Anthropic API (`claude-sonnet-4-6`) with a structured prompt and parses the JSON response. Also contains `isSourceFile()` and `isTestFile()` helpers.
- **`index.ts`** — Orchestrator. Reads action inputs, calls `getChangedFiles`, passes results to `analyzeChanges`, posts/updates the PR summary comment, and (when tests are missing) commits skeleton stub files and posts inline review suggestions.

### Key data flow

1. Fetch all changed files in the PR
2. For each non-test `.py` source file, derive the expected test file path (`test_<basename>.py`) and fetch its current content from the branch
3. Call `analyzeChanges(files, apiKey, existingTestContents, previousSuggestions)` — skips Claude entirely if no Python source files changed
4. Post or update a single summary comment (identified by `<!-- pr-test-checker: ... -->` marker)
5. If tests are missing: commit skeleton `pass`-body stubs to the test file, then post GitHub review suggestion comments pointing at each `pass` line with the actual assertion body

### Prompt design invariants

- Source file diffs and test file diffs are sent to Claude as separate sections
- Existing test file full contents are included so Claude knows what's already covered
- Previous suggestions (parsed from the hidden HTML comment in the bot's PR comment) are fed back so Claude can classify them as "covered" or "still missing" without generating duplicates
- `needsTests` is overridden post-response: `result.needsTests = result.missingTests.length > 0`

### GitHub Action inputs

| Input | Description |
|---|---|
| `github-token` | Required for all GitHub API calls; needs `contents: write` and `pull-requests: write` |
| `anthropic-api-key` | Passed directly to the Anthropic SDK |
