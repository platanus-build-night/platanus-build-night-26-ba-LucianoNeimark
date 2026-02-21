# PR Test Checker

A GitHub Action that uses Claude AI to analyze pull requests and flag when source-code changes are missing corresponding tests. It posts a clear comment on the PR explaining what was changed and why tests are (or aren't) needed.

## Usage

Add this workflow to any Python/pytest repo (`.github/workflows/test-checker.yml`):

```yaml
name: PR Test Checker
on:
  pull_request:
  workflow_dispatch:
jobs:
  check-tests:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: platanus-build-night/platanus-build-night-26-ba-LucianoNeimark@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Set `ANTHROPIC_API_KEY` as a repository secret. `GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `github-token` | Yes | GitHub token for reading PR diffs and posting comments (`secrets.GITHUB_TOKEN`) |
| `anthropic-api-key` | Yes | Anthropic API key used to call Claude |

## How it works

- Fetches the list of files changed in the PR via the GitHub API
- Splits changed files into **source files** and **test files**
- Sends both diffs to Claude (`claude-sonnet-4-6`) with a prompt asking whether the source changes have adequate test coverage
- Posts a comment on the PR with Claude's analysis
- Fails the check (`exit 1`) if tests are missing; passes if coverage looks good

## Requirements

- Python projects following the **pytest** convention: test files are named `test_*.py` or `*_test.py`
- An Anthropic API key with access to `claude-sonnet-4-6`

## License

MIT
