import * as core from '@actions/core'
import { getChangedFiles } from './github'

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true })

  const files = await getChangedFiles(token)
  core.info(`Changed files (${files.length}):`)
  for (const f of files) {
    core.info(`  [${f.status}] ${f.filename}`)
  }

  core.setOutput('changed_files', JSON.stringify(files.map((f) => f.filename)))
}

run().catch(core.setFailed)
