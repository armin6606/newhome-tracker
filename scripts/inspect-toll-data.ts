import { chromium } from "playwright"

const url = process.argv[2]

if (!url) {
  console.error("Usage: npx tsx scripts/inspect-toll-data.ts <toll-url>")
  process.exit(1)
}

function looksRelevant(text: string): boolean {
  return /site\s*plan|homesite|home\s*site|lot|community|model|inventory/i.test(text)
}

function summarizeMatches(value: unknown) {
  const matches: Array<{ path: string; type: string; size?: number; sample: string }> = []
  const seen = new Set<unknown>()

  function visit(node: unknown, path: string) {
    if (matches.length >= 100) return
    if (!node || typeof node !== "object") return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      if (node.length > 0) {
        const sample = JSON.stringify(node[0])?.slice(0, 300) ?? ""
        if (looksRelevant(`${path} ${sample}`)) {
          matches.push({ path, type: "array", size: node.length, sample })
        }
      }
      node.slice(0, 20).forEach((item, i) => visit(item, `${path}[${i}]`))
      return
    }

    const record = node as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      const childPath = path ? `${path}.${key}` : key
      const childSample = typeof child === "string" ? child : JSON.stringify(child)?.slice(0, 300) ?? ""
      if (/site\s*plan|siteplan|homesite|home\s*site|lot|qmi|inventory|model|masterCommunity|community/i.test(key) || looksRelevant(childSample)) {
        matches.push({
          path: childPath,
          type: Array.isArray(child) ? "array" : typeof child,
          size: Array.isArray(child) ? child.length : undefined,
          sample: childSample.slice(0, 300),
        })
      }
      visit(child, childPath)
    }
  }

  visit(value, "")
  return matches
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const responses: Array<{ url: string; status: number; type: string; sample: string }> = []

  page.on("response", async (response) => {
    const request = response.request()
    const type = request.resourceType()
    const responseUrl = response.url()
    const contentType = response.headers()["content-type"] ?? ""

    if (!/json|javascript|text|html/i.test(contentType) && type !== "xhr" && type !== "fetch") return
    if (!/tollbrothers|siteplan|inventory|community|model|homesite|lot/i.test(responseUrl)) return

    try {
      const body = await response.text()
      if (!looksRelevant(body)) return
      responses.push({
        url: responseUrl,
        status: response.status(),
        type,
        sample: body.slice(0, 500).replace(/\s+/g, " ").trim(),
      })
    } catch {
      // Some responses are not readable after Playwright gets them.
    }
  })

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  const rawPageData = await page.evaluate(() => {
    const nextData = document.querySelector("#__NEXT_DATA__")?.textContent ?? ""
    const scripts = Array.from(document.querySelectorAll("script"))
      .map((script) => script.textContent ?? "")
      .filter((text) => /site\s*plan|homesite|home\s*site|lot|community|model|inventory/i.test(text))
      .map((text) => text.slice(0, 500).replace(/\s+/g, " ").trim())
      .slice(0, 10)

    return {
      nextData,
      matchingScripts: scripts,
    }
  })
  const parsedNextData = rawPageData.nextData ? JSON.parse(rawPageData.nextData) : null
  const pageData = {
    hasNextData: rawPageData.nextData.length > 0,
    nextDataSample: rawPageData.nextData.slice(0, 1000).replace(/\s+/g, " ").trim(),
    nextDataMatches: summarizeMatches(parsedNextData),
    matchingScripts: rawPageData.matchingScripts,
  }

  console.log(JSON.stringify({ url, pageData, responses }, null, 2))
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
