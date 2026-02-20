import * as github from '@actions/github'

export interface ChangedFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | string
  patch?: string
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
