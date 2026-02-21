"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var core = __toESM(require("@actions/core"));
var github2 = __toESM(require("@actions/github"));

// src/github.ts
var github = __toESM(require("@actions/github"));
async function getChangedFiles(token) {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    throw new Error("This action must run on a pull_request event");
  }
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100
  });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch
  }));
}
async function findBotComment(token) {
  const pr = github.context.payload.pull_request;
  if (!pr) return null;
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100
  });
  const botComment = comments.find((c) => c.body?.includes("<!-- pr-test-checker:"));
  if (!botComment || !botComment.body) return null;
  return { id: botComment.id, body: botComment.body };
}
async function updateComment(token, commentId, body) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body
  });
}
function parsePreviousSuggestions(body) {
  const match = body.match(/<!-- pr-test-checker: ({.*?}) -->/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]).suggestions ?? [];
  } catch {
    return [];
  }
}
function deriveTestFilePath(sourceFile) {
  const parts = sourceFile.split("/");
  const basename = parts[parts.length - 1];
  parts[parts.length - 1] = `test_${basename}`;
  return parts.join("/");
}
function parsePassLineNumbers(content) {
  const result = /* @__PURE__ */ new Map();
  const lines = content.split("\n");
  let currentFunc = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(/^def (test_\w+)\s*\(/);
    if (fnMatch) {
      currentFunc = fnMatch[1];
      continue;
    }
    if (currentFunc !== null) {
      const trimmed = line.trim();
      if (trimmed === "pass") {
        result.set(currentFunc, i + 1);
        currentFunc = null;
      } else if (trimmed !== "" && !trimmed.startsWith("#")) {
        currentFunc = null;
      }
    }
  }
  return result;
}
function parseExistingFunctionNames(content) {
  const names = /* @__PURE__ */ new Set();
  const regex = /^def (test_\w+)\s*\(/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    names.add(match[1]);
  }
  return names;
}
async function getExistingFileContent(token, path, branch) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    const data = response.data;
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return { content, sha: data.sha };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
function buildSkeletonContent(tests, existingNames, sourceFile, existingLineCount = 0) {
  const newTests = tests.filter((t) => !existingNames.has(t.functionName));
  const lines = [];
  const stubs = [];
  if (existingLineCount === 0 && newTests.length > 0) {
    const parts = sourceFile.split("/");
    const module2 = parts[parts.length - 1].replace(/\.py$/, "");
    lines.push("import pytest", `from ${module2} import *`);
  }
  for (const test of newTests) {
    lines.push("", "", `def ${test.functionName}():`, "    pass");
    const passLine = existingLineCount + lines.length;
    stubs.push({ functionName: test.functionName, passLine });
  }
  return { content: lines.join("\n"), stubs };
}
async function commitFile(token, path, content, message, branch, sha) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const encodedContent = Buffer.from(content).toString("base64");
  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encodedContent,
    branch,
    sha
  });
  return response.data.commit.sha;
}
async function createOrUpdateSkeletonFile(token, path, content, branch, sha) {
  return commitFile(token, path, content, `chore: add test stubs for ${path} [skip ci]`, branch, sha);
}
function buildSuggestionBody(test) {
  return `\`\`\`suggestion
${test.suggestionBody}
\`\`\``;
}
async function deletePreviousSuggestions(token) {
  const pr = github.context.payload.pull_request;
  if (!pr) return;
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100
  });
  const botSuggestions = comments.filter(
    (c) => c.user?.login === "github-actions[bot]" && c.body.includes("```suggestion")
  );
  for (const c of botSuggestions) {
    try {
      await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c.id });
    } catch (err) {
      console.error(`Failed to delete comment ${c.id}:`, err);
    }
  }
}
async function postSuggestionComments(token, commitSha, comments) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const pr = github.context.payload.pull_request;
  for (const comment of comments) {
    try {
      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: pr.number,
        commit_id: commitSha,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: "RIGHT"
      });
    } catch (err) {
      console.error("Failed to post suggestion comment:", err);
    }
  }
}

// src/claude.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));
var IGNORED_EXTENSIONS = [
  ".md",
  ".txt",
  ".rst",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".cfg",
  ".ini",
  ".lock",
  ".env",
  ".gitignore",
  ".dockerignore"
];
function isSourceFile(filename) {
  const lower = filename.toLowerCase();
  if (IGNORED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
  return lower.endsWith(".py");
}
function isTestFile(filename) {
  const lower = filename.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  return basename.startsWith("test_") || lower.includes("_test.") || lower.includes("/tests/");
}
async function analyzeChanges(files, apiKey, existingTestContents = /* @__PURE__ */ new Map(), previousSuggestions = []) {
  const sourceFiles = files.filter(
    (f) => f.status !== "removed" && isSourceFile(f.filename) && !isTestFile(f.filename)
  );
  if (sourceFiles.length === 0) {
    return {
      needsTests: false,
      summary: "No Python source file changes detected.",
      missingTests: [],
      coveredTests: [],
      generatedTests: []
    };
  }
  const testFiles = files.filter(
    (f) => f.status !== "removed" && f.filename.endsWith(".py") && isTestFile(f.filename)
  );
  const sourceDiffsText = sourceFiles.map((f) => `### ${f.filename}
\`\`\`diff
${f.patch ?? "(no patch)"}
\`\`\``).join("\n\n");
  const testDiffsText = testFiles.length > 0 ? testFiles.map((f) => `### ${f.filename}
\`\`\`diff
${f.patch ?? "(no patch)"}
\`\`\``).join("\n\n") : "(none)";
  const previousSuggestionsSection = previousSuggestions.length > 0 ? `
The following tests were identified in a previous run. Classify each as "covered" or "still missing" based on the current test file contents and diffs. DO NOT add new tests \u2014 only classify these exact items. Use the EXACT text from this list in missingTests and coveredTests:
${previousSuggestions.map((s) => `- ${s}`).join("\n")}
` : "";
  const existingTestsSection = existingTestContents.size > 0 ? `
Existing test file contents (complete \u2014 use these to know what is already tested):
${[...existingTestContents.entries()].map(([path, content]) => `### ${path}
\`\`\`python
${content}
\`\`\``).join("\n\n")}
` : "";
  const prompt = `You are a code reviewer. Given the following file diffs from a pull request,
determine if new pytest tests are needed to cover the changes.

Rules:
- Only consider .py source files (ignore test files, configs, docs)
- Focus on semantic intent, not line coverage
- If changes are trivial (typos, comments, formatting) \u2192 no tests needed
- If test file diffs are included and they cover the changed source code \u2192 no new tests needed
- IMPORTANT: A function body of \`pass\` is a stub placeholder \u2014 treat as not yet implemented (needsTests: true), but do NOT mention "pass", "stub", or "placeholder" in summary or missingTests descriptions
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
${previousSuggestionsSection}${existingTestsSection}
Source file diffs (files that may need tests):
${sourceDiffsText}

Test file diffs already in this PR (use these to judge coverage):
${testDiffsText}`;
  const client = new import_sdk.default({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }]
  });
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain JSON: ${text}`);
  }
  const result = JSON.parse(jsonMatch[0]);
  result.generatedTests = result.generatedTests ?? [];
  return result;
}

// src/index.ts
function buildCommentBody(result, actionsUrl = "") {
  const lines = ["## PR Test Checker", "", result.summary];
  const all = [...result.coveredTests, ...result.missingTests];
  if (all.length > 0) {
    lines.push("", "**Suggested tests:**");
    for (const s of result.coveredTests) lines.push(`- ~~${s}~~ \u2713`);
    for (const s of result.missingTests) lines.push(`- ${s}`);
    lines.push("");
    lines.push("> \u2713 = covered \xB7 \u2610 = needs a test");
    if (actionsUrl) {
      lines.push(`> After adding tests, re-run: [Actions tab](${actionsUrl}) \u2192 **Run workflow**.`);
    }
    lines.push("", `<!-- pr-test-checker: ${JSON.stringify({ suggestions: all })} -->`);
  }
  return lines.join("\n");
}
async function run() {
  const token = core.getInput("github-token", { required: true });
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });
  const files = await getChangedFiles(token);
  core.info(`Changed files (${files.length}):`);
  for (const f of files) {
    core.info(`  [${f.status}] ${f.filename}`);
  }
  core.setOutput("changed_files", JSON.stringify(files.map((f) => f.filename)));
  const octokit = github2.getOctokit(token);
  const { owner, repo } = github2.context.repo;
  const pr = github2.context.payload.pull_request;
  const branch = pr.head.ref;
  const actionsUrl = `${github2.context.serverUrl}/${owner}/${repo}/actions`;
  const existingComment = await findBotComment(token);
  const previousSuggestions = existingComment ? parsePreviousSuggestions(existingComment.body) : [];
  const existingTestContents = /* @__PURE__ */ new Map();
  const candidateTestPaths = [
    ...new Set(
      files.filter((f) => f.status !== "removed" && f.filename.endsWith(".py")).filter((f) => {
        const base = f.filename.split("/").pop() ?? "";
        return !base.startsWith("test_") && !f.filename.includes("_test.") && !f.filename.includes("/tests/");
      }).map((f) => deriveTestFilePath(f.filename))
    )
  ];
  for (const testPath of candidateTestPaths) {
    const existing = await getExistingFileContent(token, testPath, branch);
    if (existing) existingTestContents.set(testPath, existing.content);
  }
  core.info("Analyzing changes with Claude...");
  const result = await analyzeChanges(files, anthropicApiKey, existingTestContents, previousSuggestions);
  core.info(`Analysis: ${result.summary}`);
  result.needsTests = result.missingTests.length > 0;
  if (!result.needsTests) {
    result.generatedTests = [];
  }
  const commentBody = buildCommentBody(result, actionsUrl);
  if (existingComment) {
    await updateComment(token, existingComment.id, commentBody);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body: commentBody
    });
  }
  await deletePreviousSuggestions(token);
  if (result.needsTests && result.generatedTests.length > 0) {
    const byFile = /* @__PURE__ */ new Map();
    for (const t of result.generatedTests) {
      const testPath = deriveTestFilePath(t.sourceFile);
      if (!byFile.has(testPath)) byFile.set(testPath, []);
      byFile.get(testPath).push(t);
    }
    const allComments = [];
    let lastSha = null;
    for (const [testPath, tests] of byFile) {
      const existing = await getExistingFileContent(token, testPath, branch);
      const existingNames = existing ? parseExistingFunctionNames(existing.content) : /* @__PURE__ */ new Set();
      const existingLineCount = existing ? existing.content.trimEnd().split("\n").length : 0;
      const { content: newContent, stubs } = buildSkeletonContent(
        tests,
        existingNames,
        tests[0].sourceFile,
        existingLineCount
      );
      if (stubs.length > 0) {
        const finalContent = existing ? existing.content.trimEnd() + "\n" + newContent : newContent;
        lastSha = await createOrUpdateSkeletonFile(token, testPath, finalContent, branch, existing?.sha);
        for (const stub of stubs) {
          const test = tests.find((t) => t.functionName === stub.functionName);
          allComments.push({ path: testPath, line: stub.passLine, body: buildSuggestionBody(test) });
        }
      }
      if (existing) {
        const passLines = parsePassLineNumbers(existing.content);
        for (const test of tests) {
          if (existingNames.has(test.functionName) && passLines.has(test.functionName)) {
            allComments.push({
              path: testPath,
              line: passLines.get(test.functionName),
              body: buildSuggestionBody(test)
            });
          }
        }
      }
    }
    const commitSha = lastSha ?? pr.head.sha;
    if (allComments.length > 0) {
      await postSuggestionComments(token, commitSha, allComments);
    }
  }
  if (result.missingTests.length > 0) {
    core.setFailed(`Missing tests: ${result.missingTests.join("; ")}`);
  }
}
run().catch(core.setFailed);
