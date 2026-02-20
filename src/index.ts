import * as core from '@actions/core'
import * as github from '@actions/github'
import { getChangedFiles, findBotComment, updateComment, parsePreviousSuggestions } from './github'
import { analyzeChanges, AnalysisResult } from './claude'

function buildCommentBody(result: AnalysisResult): string {
  const lines = ['## PR Test Checker', '', result.summary]
  const all = [...result.coveredTests, ...result.missingTests]
  if (all.length > 0) {
    lines.push('', '**Suggested tests:**')
    for (const s of result.coveredTests) lines.push(`- ~~${s}~~ ✓`)
    for (const s of result.missingTests) lines.push(`- ${s}`)
    lines.push('', `<!-- pr-test-checker: ${JSON.stringify({ suggestions: all })} -->`)
  }
  return lines.join('\n')
}

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true })
  const anthropicApiKey = core.getInput('anthropic-api-key', { required: true })

  const files = await getChangedFiles(token)
  core.info(`Changed files (${files.length}):`)
  for (const f of files) {
    core.info(`  [${f.status}] ${f.filename}`)
  }

  core.setOutput('changed_files', JSON.stringify(files.map((f) => f.filename)))

  const existingComment = await findBotComment(token)
  const previousSuggestions = existingComment
    ? parsePreviousSuggestions(existingComment.body)
    : []

  core.info('Analyzing changes with Claude...')
  const result = await analyzeChanges(files, anthropicApiKey, previousSuggestions)
  core.info(`Analysis: ${result.summary}`)

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!

  const commentBody = buildCommentBody(result)

  if (existingComment) {
    await updateComment(token, existingComment.id, commentBody)
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body: commentBody,
    })
  }

  if (result.needsTests) {
    core.setFailed(`Missing tests: ${result.missingTests.join('; ')}`)
  }
}

run().catch(core.setFailed)
