import * as github from '@actions/github'
import { GeneratedTest } from './claude'

export interface ChangedFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | string
  patch?: string
}

export interface ReviewComment {
  path: string
  line: number
  body: string
}

export async function getChangedFiles(token: string): Promise<ChangedFile[]> {
  const pr = github.context.payload.pull_request
  if (!pr) {
    throw new Error('This action must run on a pull_request event')
  }

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  })

  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch,
  }))
}

export async function findBotComment(
  token: string,
): Promise<{ id: number; body: string } | null> {
  const pr = github.context.payload.pull_request
  if (!pr) return null

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  })

  const botComment = comments.find((c) => c.body?.includes('<!-- pr-test-checker:'))
  if (!botComment || !botComment.body) return null

  return { id: botComment.id, body: botComment.body }
}

export async function updateComment(
  token: string,
  commentId: number,
  body: string,
): Promise<void> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  })
}

export function parsePreviousSuggestions(body: string): string[] {
  const match = body.match(/<!-- pr-test-checker: ({.*?}) -->/)
  if (!match) return []
  return JSON.parse(match[1]).suggestions ?? []
}

export function parseDeclinedSuggestions(body: string): string[] {
  const declined: string[] = []
  const regex = /^- \[x\] (.+)$/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    let text = match[1].trim()
    // Strip markdown artifacts from previous rendering versions
    text = text
      .replace(/^~~/, '').replace(/~~\s*$/, '')
      .replace(/\s*\*\(dismissed[^)]*\)\*/, '')
      .replace(/\s*\*\(re-open[^)]*\)\*/, '')
      .trim()
    declined.push(text)
  }
  return declined
}

export function deriveTestFilePath(sourceFile: string): string {
  const parts = sourceFile.split('/')
  const basename = parts[parts.length - 1]
  parts[parts.length - 1] = `test_${basename}`
  return parts.join('/')
}

export function parsePassLineNumbers(content: string): Map<string, number> {
  const result = new Map<string, number>()
  const lines = content.split('\n')
  let currentFunc: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fnMatch = line.match(/^def (test_\w+)\s*\(/)
    if (fnMatch) {
      currentFunc = fnMatch[1]
      continue
    }
    if (currentFunc !== null) {
      const trimmed = line.trim()
      if (trimmed === 'pass') {
        result.set(currentFunc, i + 1) // 1-indexed line number
        currentFunc = null
      } else if (trimmed !== '' && !trimmed.startsWith('#')) {
        // Real implementation found — not a stub
        currentFunc = null
      }
    }
  }
  return result
}

export function parseExistingFunctionNames(content: string): Set<string> {
  const names = new Set<string>()
  const regex = /^def (test_\w+)\s*\(/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    names.add(match[1])
  }
  return names
}

export async function getExistingFileContent(
  token: string,
  path: string,
  branch: string,
): Promise<{ content: string; sha: string } | null> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
    const data = response.data as { content: string; sha: string }
    const content = Buffer.from(data.content, 'base64').toString('utf8')
    return { content, sha: data.sha }
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}

export function buildSkeletonContent(
  tests: GeneratedTest[],
  existingNames: Set<string>,
  sourceFile: string,
  existingLineCount: number = 0,
): { content: string; stubs: { functionName: string; passLine: number }[] } {
  const newTests = tests.filter((t) => !existingNames.has(t.functionName))

  const lines: string[] = []
  const stubs: { functionName: string; passLine: number }[] = []

  if (existingLineCount === 0 && newTests.length > 0) {
    const parts = sourceFile.split('/')
    const module = parts[parts.length - 1].replace(/\.py$/, '')
    lines.push('import pytest', `from ${module} import *`)
  }

  for (const test of newTests) {
    lines.push('', '', `def ${test.functionName}():`, '    pass')
    const passLine = existingLineCount + lines.length
    stubs.push({ functionName: test.functionName, passLine })
  }

  return { content: lines.join('\n'), stubs }
}

async function commitFile(
  token: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string,
): Promise<string> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const encodedContent = Buffer.from(content).toString('base64')
  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo, path, message, content: encodedContent, branch, sha,
  })
  return response.data.commit.sha
}

export async function createOrUpdateSkeletonFile(
  token: string,
  path: string,
  content: string,
  branch: string,
  sha?: string,
): Promise<string> {
  return commitFile(token, path, content, `chore: add test stubs for ${path} [skip ci]`, branch, sha)
}

export async function readStateFile(
  token: string,
  branch: string,
): Promise<{ dismissed: string[]; sha?: string }> {
  const existing = await getExistingFileContent(token, '.tests/state.json', branch)
  if (!existing) return { dismissed: [] }
  try {
    const parsed = JSON.parse(existing.content)
    return { dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [], sha: existing.sha }
  } catch {
    return { dismissed: [], sha: existing.sha }
  }
}

export async function writeStateFile(
  token: string,
  branch: string,
  dismissed: string[],
  sha?: string,
): Promise<void> {
  const content = JSON.stringify({ dismissed }, null, 2) + '\n'
  try {
    await commitFile(token, '.tests/state.json', content, 'chore: update test checker state [skip ci]', branch, sha)
  } catch (err) {
    console.error('Failed to write state file (non-fatal):', err)
  }
}

export function buildSuggestionBody(test: GeneratedTest): string {
  return `\`\`\`suggestion\n${test.suggestionBody}\n\`\`\``
}

export async function deletePreviousSuggestions(token: string): Promise<void> {
  const pr = github.context.payload.pull_request
  if (!pr) return

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  })

  const botSuggestions = comments.filter(
    (c) => c.user?.login === 'github-actions[bot]' && c.body.includes('```suggestion'),
  )

  for (const c of botSuggestions) {
    try {
      await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c.id })
    } catch (err) {
      console.error(`Failed to delete comment ${c.id}:`, err)
    }
  }
}

export async function postSuggestionComments(
  token: string,
  commitSha: string,
  comments: ReviewComment[],
): Promise<void> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!

  for (const comment of comments) {
    try {
      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: pr.number,
        commit_id: commitSha,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: 'RIGHT',
      })
    } catch (err) {
      console.error('Failed to post suggestion comment:', err)
    }
  }
}
