import * as core from '@actions/core'
import * as github from '@actions/github'
import { getChangedFiles } from './github'
import { analyzeChanges } from './claude'

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true })
  const anthropicApiKey = core.getInput('anthropic-api-key', { required: true })

  const files = await getChangedFiles(token)
  core.info(`Changed files (${files.length}):`)
  for (const f of files) {
    core.info(`  [${f.status}] ${f.filename}`)
  }

  core.setOutput('changed_files', JSON.stringify(files.map((f) => f.filename)))

  core.info('Analyzing changes with Claude...')
  const result = await analyzeChanges(files, anthropicApiKey)
  core.info(`Analysis: ${result.summary}`)

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!

  let commentBody: string
  if (result.needsTests) {
    const listItems = result.missingTests.map((t) => `- ${t}`).join('\n')
    commentBody = `## PR Test Checker\n\n${result.summary}\n\n**Missing tests:**\n${listItems}`
  } else {
    commentBody = `## PR Test Checker\n\n${result.summary}\n\nNo tests needed.`
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr.number,
    body: commentBody,
  })

  if (result.needsTests) {
    core.setFailed(`Missing tests: ${result.missingTests.join('; ')}`)
  }
}

run().catch(core.setFailed)
