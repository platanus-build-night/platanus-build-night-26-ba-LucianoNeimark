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

export async function createOrUpdateSkeletonFile(
  token: string,
  path: string,
  content: string,
  branch: string,
  sha?: string,
): Promise<string> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const encodedContent = Buffer.from(content).toString('base64')

  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `chore: add test stubs for ${path} [skip ci]`,
    content: encodedContent,
    branch,
    sha,
  })

  return response.data.commit.sha
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

export async function postSkeletonReview(
  token: string,
  commitSha: string,
  comments: ReviewComment[],
): Promise<void> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pr.number,
      commit_id: commitSha,
      event: 'COMMENT',
      body: 'Click "Commit suggestion" per test to apply.',
      comments: comments.map((c) => ({ path: c.path, line: c.line, side: 'RIGHT' as const, body: c.body })),
    })
  } catch (err) {
    console.error('Failed to post skeleton review:', err)
  }
}
