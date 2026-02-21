import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  getChangedFiles,
  findBotComment,
  updateComment,
  deriveTestFilePath,
  parseExistingFunctionNames,
  parsePassLineNumbers,
  getExistingFileContent,
  buildSkeletonContent,
  createOrUpdateSkeletonFile,
  buildSuggestionBody,
  postSuggestionComments,
  deletePreviousSuggestions,
  ReviewComment,
} from './github'
import { analyzeChanges, AnalysisResult, GeneratedTest } from './claude'

function buildCommentBody(result: AnalysisResult, actionsUrl: string = ''): string {
  const lines = ['## PR Test Checker', '', result.summary]
  const all = [...result.coveredTests, ...result.missingTests]
  if (all.length > 0) {
    lines.push('', '**Suggested tests:**')
    for (const s of result.coveredTests) lines.push(`- ~~${s}~~ ✓`)
    for (const s of result.missingTests) lines.push(`- ${s}`)
    lines.push('')
    lines.push('> ✓ = covered · ☐ = needs a test')
    if (actionsUrl) {
      lines.push(`> After adding tests, re-run: [Actions tab](${actionsUrl}) → **Run workflow**.`)
    }
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

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!
  const branch = (pr.head as { ref: string }).ref

  const actionsUrl = `${github.context.serverUrl}/${owner}/${repo}/actions`

  const existingComment = await findBotComment(token)

  // Fetch full content of existing test files for Claude context
  const existingTestContents = new Map<string, string>()
  const candidateTestPaths = [
    ...new Set(
      files
        .filter((f) => f.status !== 'removed' && f.filename.endsWith('.py'))
        .filter((f) => {
          const base = f.filename.split('/').pop() ?? ''
          return !base.startsWith('test_') && !f.filename.includes('_test.') && !f.filename.includes('/tests/')
        })
        .map((f) => deriveTestFilePath(f.filename)),
    ),
  ]
  for (const testPath of candidateTestPaths) {
    const existing = await getExistingFileContent(token, testPath, branch)
    if (existing) existingTestContents.set(testPath, existing.content)
  }

  core.info('Analyzing changes with Claude...')
  const result = await analyzeChanges(files, anthropicApiKey, existingTestContents)
  core.info(`Analysis: ${result.summary}`)

  // missingTests is the single source of truth; derive everything from it
  result.needsTests = result.missingTests.length > 0
  if (!result.needsTests) {
    result.generatedTests = []
  }

  const commentBody = buildCommentBody(result, actionsUrl)

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

  // Always clean up old suggestions so stale ones don't linger
  await deletePreviousSuggestions(token)

  // Phase 3: commit skeleton test stubs and post suggestion review
  if (result.needsTests && result.generatedTests.length > 0) {
    const byFile = new Map<string, GeneratedTest[]>()
    for (const t of result.generatedTests) {
      const testPath = deriveTestFilePath(t.sourceFile)
      if (!byFile.has(testPath)) byFile.set(testPath, [])
      byFile.get(testPath)!.push(t)
    }

    const allComments: ReviewComment[] = []
    let lastSha: string | null = null

    for (const [testPath, tests] of byFile) {
      const existing = await getExistingFileContent(token, testPath, branch)
      const existingNames = existing ? parseExistingFunctionNames(existing.content) : new Set<string>()
      const existingLineCount = existing ? existing.content.trimEnd().split('\n').length : 0

      const { content: newContent, stubs } = buildSkeletonContent(
        tests, existingNames, tests[0].sourceFile, existingLineCount,
      )

      if (stubs.length > 0) {
        const finalContent = existing
          ? existing.content.trimEnd() + '\n' + newContent
          : newContent

        lastSha = await createOrUpdateSkeletonFile(token, testPath, finalContent, branch, existing?.sha)

        for (const stub of stubs) {
          const test = tests.find((t) => t.functionName === stub.functionName)!
          allComments.push({ path: testPath, line: stub.passLine, body: buildSuggestionBody(test) })
        }
      }

      // For stubs already in the file (pass-body only), post suggestions without committing
      if (existing) {
        const passLines = parsePassLineNumbers(existing.content)
        for (const test of tests) {
          if (existingNames.has(test.functionName) && passLines.has(test.functionName)) {
            allComments.push({
              path: testPath,
              line: passLines.get(test.functionName)!,
              body: buildSuggestionBody(test),
            })
          }
        }
      }
    }

    // Use new commit SHA if we made one, otherwise use PR HEAD
    const commitSha = lastSha ?? (pr.head as { sha: string }).sha
    if (allComments.length > 0) {
      await postSuggestionComments(token, commitSha, allComments)
    }
  }

  if (result.missingTests.length > 0) {
    core.setFailed(`Missing tests: ${result.missingTests.join('; ')}`)
  }
}

run().catch(core.setFailed)
