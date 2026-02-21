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
  parsePassLineNumbers,
  getExistingFileContent,
  buildSkeletonContent,
  createOrUpdateSkeletonFile,
  buildSuggestionBody,
  postSuggestionComments,
  deletePreviousSuggestions,
  readStateFile,
  writeStateFile,
  ReviewComment,
} from './github'
import { analyzeChanges, AnalysisResult, GeneratedTest } from './claude'

function buildCommentBody(result: AnalysisResult, declinedSuggestions: string[] = [], actionsUrl: string = ''): string {
  const lines = ['## PR Test Checker', '', result.summary]
  const all = [...result.coveredTests, ...result.missingTests]
  // Don't re-show dismissed items that are now covered
  const activeDismissed = declinedSuggestions.filter((s) => !result.coveredTests.includes(s))
  const hasAny = all.length > 0 || activeDismissed.length > 0
  if (hasAny) {
    lines.push('', '**Suggested tests:**')
    for (const s of result.coveredTests) lines.push(`- ~~${s}~~ ✓`)
    for (const s of result.missingTests) lines.push(`- [ ] ${s}`)
    for (const s of activeDismissed) lines.push(`- [x] ${s}`)
    lines.push('')
    const tip = '> ✓ = covered · ☐ = needs a test · ☑ = dismissed by you (uncheck to restore)'
    lines.push(tip)
    if (actionsUrl) {
      lines.push(`> After checking or unchecking boxes, re-run the check: [Actions tab](${actionsUrl}) → **Run workflow**.`)
    }
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

  const actionsUrl = `${github.context.serverUrl}/${owner}/${repo}/actions`

  const existingComment = await findBotComment(token)
  const previousSuggestions = existingComment ? parsePreviousSuggestions(existingComment.body) : []
  // State file is the fallback when there's no PR comment yet
  const stateFile = await readStateFile(token, branch)
  const declinedSuggestions = existingComment
    ? parseDeclinedSuggestions(existingComment.body)
    : stateFile.dismissed

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

  // Strip everything except letters and digits for fuzzy matching
  const normalize = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()

  // Build a lookup: normalizedKey → canonical stored text
  const canonicalMap = new Map<string, string>()
  for (const s of [...previousSuggestions, ...declinedSuggestions]) {
    canonicalMap.set(normalize(s), s)
  }

  // Replace Claude's output with canonical text wherever we have a prior match
  result.missingTests = result.missingTests.map(
    (s) => canonicalMap.get(normalize(s)) ?? s
  )
  result.generatedTests = result.generatedTests.map((t) => ({
    ...t,
    description: canonicalMap.get(normalize(t.description)) ?? t.description,
  }))

  const normalizedDeclined = new Set(declinedSuggestions.map(normalize))

  // Remove any missingTests / generatedTests that the user has already dismissed
  result.missingTests = result.missingTests.filter(
    (s) => !normalizedDeclined.has(normalize(s))
  )
  result.generatedTests = result.generatedTests.filter(
    (t) => !normalizedDeclined.has(normalize(t.description))
  )

  // missingTests is the single source of truth; derive everything from it
  result.needsTests = result.missingTests.length > 0
  if (!result.needsTests) {
    result.generatedTests = []
  }

  const commentBody = buildCommentBody(result, declinedSuggestions, actionsUrl)

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

  // Persist dismissed list to state file — source of truth across runs
  await writeStateFile(token, branch, declinedSuggestions, stateFile.sha)

  // Always clean up old suggestions so dismissed tests don't linger
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
