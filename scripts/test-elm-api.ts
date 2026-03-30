/**
 * TEST ONLY — fetches Toll Brothers cache API directly to find lot/homesite data.
 */

const ELM_PATH = "/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"
const CACHE_API = `https://www.tollbrothers.com/cache/api/v1/route?path=${encodeURIComponent(ELM_PATH)}`

// Also try the direct community API once we know the internetId
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.tollbrothers.com/",
}

function deepFind(obj: unknown, test: (key: string, val: unknown) => boolean, path = ""): Array<{ path: string; val: unknown }> {
  const results: Array<{ path: string; val: unknown }> = []
  if (!obj || typeof obj !== "object") return results
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      results.push(...deepFind(obj[i], test, `${path}[${i}]`))
    }
  } else {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k
      if (test(k, v)) results.push({ path: p, val: v })
      results.push(...deepFind(v, test, p))
    }
  }
  return results
}

function countStatuses(arr: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of arr) {
    const s = String((item as Record<string, unknown>)?.status ?? (item as Record<string, unknown>)?.homesiteStatus ?? "no-status")
    counts[s] = (counts[s] || 0) + 1
  }
  return counts
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function main() {
  console.log("=== Fetching cache API for Elm Collection ===")
  console.log(CACHE_API, "\n")

  const data = await fetchJson(CACHE_API) as Record<string, unknown>

  // Show top-level keys
  console.log("Top-level keys:", Object.keys(data))

  // Look for internetId / apiUrl
  const apiUrls = deepFind(data, (k) => k === "apiUrl")
  console.log("\napiUrl fields:", apiUrls.map(r => r.val))

  const internetIds = deepFind(data, (k) => k === "internetId")
  console.log("internetId fields:", internetIds.slice(0, 5).map(r => `${r.path} = ${r.val}`))

  // Find any arrays that look like homesite/lot arrays
  console.log("\n=== Searching for homesite/lot arrays ===")
  const homesiteArrays = deepFind(data, (k, v) => {
    if (!Array.isArray(v) || v.length === 0) return false
    const keywords = /homesite|lot|qmi|avail|unit|plan|model/i
    if (!keywords.test(k)) return false
    const first = v[0] as Record<string, unknown>
    return !!first && typeof first === "object"
  })

  for (const { path, val } of homesiteArrays.slice(0, 20)) {
    const arr = val as unknown[]
    const first = arr[0] as Record<string, unknown>
    const keys = Object.keys(first).slice(0, 10).join(", ")
    console.log(`\n[${path}] — ${arr.length} items`)
    console.log(`  Keys: ${keys}`)
    if ("status" in first || "homesiteStatus" in first) {
      console.log(`  Statuses:`, countStatuses(arr))
    }
    console.log(`  First:`, JSON.stringify(first).substring(0, 200))
  }

  // Check for site plan specific data
  console.log("\n=== Looking for sitePlan / siteplan fields ===")
  const sitePlanFields = deepFind(data, (k) => /siteplan|sitePlan|site_plan/i.test(k))
  for (const { path, val } of sitePlanFields.slice(0, 10)) {
    console.log(`\n[${path}]:`, JSON.stringify(val).substring(0, 300))
  }

  // Check for availability / inventory fields
  console.log("\n=== Looking for availability/inventory fields ===")
  const availFields = deepFind(data, (k) => /availab|inventory|totalHome|homeCount|numHome/i.test(k))
  for (const { path, val } of availFields.slice(0, 10)) {
    if (typeof val !== "object" || val === null) {
      console.log(`  [${path}]:`, val)
    } else {
      console.log(`\n[${path}]:`, JSON.stringify(val).substring(0, 300))
    }
  }

  // Now try direct community API
  const communityApiUrl = apiUrls.find(r => String(r.val).includes("/community/"))?.val as string
  if (communityApiUrl) {
    const fullCommunityApiUrl = `https://www.tollbrothers.com${communityApiUrl}`
    console.log(`\n=== Fetching direct community API: ${fullCommunityApiUrl} ===`)
    try {
      const commData = await fetchJson(fullCommunityApiUrl) as Record<string, unknown>
      console.log("Top-level keys:", Object.keys(commData))

      // Find homesite arrays
      const ha = deepFind(commData, (k, v) => {
        if (!Array.isArray(v) || v.length === 0) return false
        const first = v[0] as Record<string, unknown>
        return !!first && typeof first === "object" && ("status" in first || "homesite" in String(k).toLowerCase())
      })
      for (const { path, val } of ha.slice(0, 10)) {
        const arr = val as unknown[]
        console.log(`\n[${path}] — ${arr.length} items, statuses:`, countStatuses(arr))
        console.log(`  First:`, JSON.stringify(arr[0]).substring(0, 200))
      }

      // Try siteplan sub-endpoint
      const internetId = internetIds[0]?.val as string
      if (internetId) {
        const sitePlanUrl = `https://www.tollbrothers.com/api/v1/community/${internetId}/siteplan`
        const sitePlanUrl2 = `https://www.tollbrothers.com/api/v1/community/${internetId}/homesites`
        console.log(`\n=== Trying siteplan endpoint: ${sitePlanUrl} ===`)
        try {
          const sp = await fetchJson(sitePlanUrl)
          console.log(JSON.stringify(sp).substring(0, 500))
        } catch (e) { console.log("  Error:", String(e)) }

        console.log(`\n=== Trying homesites endpoint: ${sitePlanUrl2} ===`)
        try {
          const hs = await fetchJson(sitePlanUrl2) as unknown[]
          if (Array.isArray(hs)) {
            console.log(`  ${hs.length} homesites, statuses:`, countStatuses(hs))
            console.log("  First:", JSON.stringify(hs[0]).substring(0, 300))
          } else {
            console.log(JSON.stringify(hs).substring(0, 500))
          }
        } catch (e) { console.log("  Error:", String(e)) }
      }
    } catch (e) {
      console.log("Error fetching community API:", String(e))
    }
  }
}

main().catch(console.error)
