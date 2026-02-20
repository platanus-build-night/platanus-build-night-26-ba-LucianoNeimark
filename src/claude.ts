import Anthropic from '@anthropic-ai/sdk'
import { ChangedFile } from './github'

export interface AnalysisResult {
  needsTests: boolean
  summary: string
  missingTests: string[]
  coveredTests: string[]
}

const IGNORED_EXTENSIONS = [
  '.md', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.cfg', '.ini',
  '.lock', '.env', '.gitignore', '.dockerignore',
]

function isSourceFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (IGNORED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false
  return lower.endsWith('.py')
}

function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return lower.includes('/test_') || lower.includes('_test.') || lower.includes('/tests/')
}

export async function analyzeChanges(
  files: ChangedFile[],
  apiKey: string,
  previousSuggestions: string[] = [],
): Promise<AnalysisResult> {
  const sourceFiles = files.filter(
    (f) => f.status !== 'removed' && isSourceFile(f.filename) && !isTestFile(f.filename),
  )

  if (sourceFiles.length === 0) {
    return {
      needsTests: false,
      summary: 'No Python source file changes detected.',
      missingTests: [],
      coveredTests: [],
    }
  }

  const testFiles = files.filter(
    (f) => f.status !== 'removed' && f.filename.endsWith('.py') && isTestFile(f.filename),
  )

  const sourceDiffsText = sourceFiles
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch ?? '(no patch)'}\n\`\`\``)
    .join('\n\n')

  const testDiffsText =
    testFiles.length > 0
      ? testFiles
          .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch ?? '(no patch)'}\n\`\`\``)
          .join('\n\n')
      : '(none)'

  const previousSuggestionsSection =
    previousSuggestions.length > 0
      ? `\nPrevious test suggestions — classify each as "covered" or "still missing":\n${previousSuggestions.map((s) => `- ${s}`).join('\n')}\n`
      : ''

  const prompt = `You are a code reviewer. Given the following file diffs from a pull request,
determine if new pytest tests are needed to cover the changes.

Rules:
- Only consider .py source files (ignore test files, configs, docs)
- Focus on semantic intent, not line coverage
- If changes are trivial (typos, comments, formatting) → no tests needed
- If test file diffs are included and they cover the changed source code → no new tests needed

Respond ONLY with JSON:
{
  "needsTests": boolean,
  "summary": "one sentence verdict",
  "missingTests": ["still needed or new suggestions..."],
  "coveredTests": ["from previous suggestions, now covered by test diffs..."]
}
${previousSuggestionsSection}
Source file diffs (files that may need tests):
${sourceDiffsText}

Test file diffs already in this PR (use these to judge coverage):
${testDiffsText}`

  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain JSON: ${text}`)
  }

  const result = JSON.parse(jsonMatch[0]) as AnalysisResult
  return result
}
