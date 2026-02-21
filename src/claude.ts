import Anthropic from '@anthropic-ai/sdk'
import { ChangedFile } from './github'

export interface GeneratedTest {
  sourceFile: string
  functionName: string
  description: string
  suggestionBody: string
}

export interface AnalysisResult {
  needsTests: boolean
  summary: string
  missingTests: string[]
  coveredTests: string[]
  generatedTests: GeneratedTest[]
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
  const basename = lower.split('/').pop() ?? lower
  return basename.startsWith('test_') || lower.includes('_test.') || lower.includes('/tests/')
}

export async function analyzeChanges(
  files: ChangedFile[],
  apiKey: string,
  existingTestContents: Map<string, string> = new Map(),
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
      generatedTests: [],
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

  const existingTestsSection =
    existingTestContents.size > 0
      ? `\nExisting test file contents (complete — use these to know what is already tested):\n${
          [...existingTestContents.entries()]
            .map(([path, content]) => `### ${path}\n\`\`\`python\n${content}\n\`\`\``)
            .join('\n\n')
        }\n`
      : ''

  const prompt = `You are a code reviewer. Given the following file diffs from a pull request,
determine if new pytest tests are needed to cover the changes.

Rules:
- Only consider .py source files (ignore test files, configs, docs)
- Focus on semantic intent, not line coverage
- If changes are trivial (typos, comments, formatting) → no tests needed
- If test file diffs are included and they cover the changed source code → no new tests needed
- IMPORTANT: A function body of \`pass\` is a stub placeholder — treat as not yet implemented (needsTests: true), but do NOT mention "pass", "stub", or "placeholder" in summary or missingTests descriptions
- Existing test file contents show ALL tests already written; do not suggest tests already implemented there

Respond ONLY with JSON:
{
  "needsTests": boolean,
  "summary": "one sentence verdict",
  "missingTests": ["still needed or new suggestions..."],
  "coveredTests": ["from previous suggestions, now covered by test diffs..."],
  "generatedTests": [
    {
      "sourceFile": "path matching the diff header",
      "functionName": "test_snake_case",
      "description": "same as corresponding missingTests entry",
      "suggestionBody": "    assert ..."
    }
  ]
}

Rules for generatedTests:
- One entry per missingTests item, same order
- [] when needsTests is false
- suggestionBody must be 4-space indented Python assertion(s)
${existingTestsSection}
Source file diffs (files that may need tests):
${sourceDiffsText}

Test file diffs already in this PR (use these to judge coverage):
${testDiffsText}`

  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
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
  result.generatedTests = result.generatedTests ?? []
  return result
}
