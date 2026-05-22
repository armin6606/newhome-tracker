/**
 * check-evaluate-functions.mjs
 *
 * CI guard: scans scraper TypeScript files for named function declarations
 * (function foo()) inside page.evaluate() callbacks.
 *
 * WHY: tsx/esbuild injects __name(foo, "foo") after named function declarations.
 * When Playwright serializes a page.evaluate() callback to send to the browser,
 * those __name() calls are included — but __name is not defined in the browser
 * context, causing:  ReferenceError: __name is not defined
 *
 * FIX: always use arrow functions (const foo = () => {}) inside page.evaluate().
 * Arrow functions are NOT wrapped with __name() by esbuild.
 */

import fs from "fs"
import path from "path"

const SCAN_DIRS = [
  "lib/scraper",
  "scripts/scrapers",
]

// Matches named function declarations: "function foo(" or "function foo <" (generic)
const NAMED_FN_RE = /\bfunction\s+[A-Za-z_$]\w*\s*[(<]/

function collectTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectTs(full, out)
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full)
  }
  return out
}

const files = SCAN_DIRS.flatMap(d => collectTs(d))
let violations = 0

for (const file of files) {
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")

  let insideEvaluate = false
  let parenDepth = 0
  let evaluateStartLine = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Detect page.evaluate( opening
    if (!insideEvaluate && /page\.(evaluate|evaluateHandle)\s*\(/.test(line)) {
      insideEvaluate = true
      parenDepth = 0
      evaluateStartLine = lineNum
    }

    if (insideEvaluate) {
      // Count parens to track when the evaluate() call ends
      for (const ch of line) {
        if (ch === "(") parenDepth++
        else if (ch === ")") {
          parenDepth--
          if (parenDepth <= 0) {
            insideEvaluate = false
            break
          }
        }
      }

      // Check for named function declarations on this line
      if (insideEvaluate && NAMED_FN_RE.test(line)) {
        const trimmed = line.trim()
        // Ignore comments
        if (!trimmed.startsWith("//") && !trimmed.startsWith("*")) {
          const rel = path.relative(process.cwd(), file).replace(/\\/g, "/")
          console.error(
            `❌ ${rel}:${lineNum} — named function declaration inside page.evaluate() (block started line ${evaluateStartLine})\n` +
            `   ${trimmed}\n` +
            `   → Use an arrow function instead: const foo = (...) => { ... }`
          )
          violations++
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} violation(s) found.\n` +
    `Named functions inside page.evaluate() crash in the browser because esbuild\n` +
    `injects __name() helpers that are not available in the browser context.\n` +
    `Replace every  function foo(  with  const foo = (...) => {`
  )
  process.exit(1)
} else {
  console.log("✅ No named function declarations found inside page.evaluate() blocks.")
}
