import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  getChangedFiles,
  findBotComment,
  updateComment,
  parsePreviousSuggestions,
  parseDeclinedSuggestions,
  deriveTestFilePath,
  parseExistingFunctionNames,
  getExistingFileContent,
  buildSkeletonContent,
  createOrUpdateSkeletonFile,
  buildSuggestionBody,
  postSkeletonReview,
  deletePreviousSuggestions,
  ReviewComment,
} from './github'
import { analyzeChanges, AnalysisResult, GeneratedTest } from './claude'

function buildCommentBody(result: AnalysisResult, declinedSuggestions: string[] = []): string {
  const lines = ['## PR Test Checker', '', result.summary]
  const all = [...result.coveredTests, ...result.missingTests]
  const hasAny = all.length > 0 || declinedSuggestions.length > 0
  if (hasAny) {
    lines.push('', '**Suggested tests** (check a box to skip):')
    for (const s of result.coveredTests) lines.push(`- ~~${s}~~ ✓`)
    for (const s of result.missingTests) lines.push(`- [ ] ${s}`)
    for (const s of declinedSuggestions) lines.push(`- [x] ${s}`)
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

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request!
  const branch = (pr.head as { ref: string }).ref

  const existingComment = await findBotComment(token)
  const previousSuggestions = existingComment
    ? parsePreviousSuggestions(existingComment.body)
    : []
  const declinedSuggestions = existingComment ? parseDeclinedSuggestions(existingComment.body) : []

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
  const result = await analyzeChanges(files, anthropicApiKey, previousSuggestions, existingTestContents, declinedSuggestions)
  core.info(`Analysis: ${result.summary}`)

  const commentBody = buildCommentBody(result, declinedSuggestions)

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

  // Phase 3: commit skeleton test stubs and post suggestion review
  if (result.needsTests && result.generatedTests.length > 0) {
    await deletePreviousSuggestions(token)

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
      if (stubs.length === 0) continue

      const finalContent = existing
        ? existing.content.trimEnd() + '\n' + newContent
        : newContent

      lastSha = await createOrUpdateSkeletonFile(token, testPath, finalContent, branch, existing?.sha)

      for (const stub of stubs) {
        const test = tests.find((t) => t.functionName === stub.functionName)!
        allComments.push({ path: testPath, line: stub.passLine, body: buildSuggestionBody(test) })
      }
    }

    if (lastSha && allComments.length > 0) {
      await postSkeletonReview(token, lastSha, allComments)
    }
  }

  if (result.needsTests) {
    core.setFailed(`Missing tests: ${result.missingTests.join('; ')}`)
  }
}

run().catch(core.setFailed)
