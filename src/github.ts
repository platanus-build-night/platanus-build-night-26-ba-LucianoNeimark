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
