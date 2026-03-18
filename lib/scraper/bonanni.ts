/**
 * Bonanni Development scraper.
 * Squarespace index at bonannidevelopment.com linking to sub-sites.
 * Each sub-site is WordPress + Elementor with plan data in headings.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const INDEX_URL = "https://www.bonannidevelopment.com/find-your-new-home"

// Known Bonanni sub-sites (OC area)
const SUBSITES = [
  { name: "Covara", url: "https://livecovara.com/homes/", city: "Anaheim" },
  { name: "Volara", url: "https://www.volarahomes.com/homes/", city: "Orange County" },
  { name: "Coastlands", url: "https://livecoastlands.com/homes/", city: "Orange County" },
  { name: "Bigsby", url: "https://livebigsby.com/homes/", city: "Orange County" },
  { name: "Oak Pointe", url: "https://www.liveoakpointe.com/homes/", city: "Orange County" },
]

export async function scrapeBonanniOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()

    // Try to discover sub-sites from the index page too
    let subsites = [...SUBSITES]
    try {
      await page.goto(INDEX_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForTimeout(2000)
      const discovered = await page.evaluate(() => {
        const results: { name: string; url: string }[] = []
        document.querySelectorAll("#properties-now-selling a[href], .image-card a[href]").forEach((a) => {
          const href = (a as HTMLAnchorElement).href
          if (!href || href.includes("bonannidevelopment.com")) return
          const imgAlt = a.querySelector("img")?.getAttribute("alt") || ""
          results.push({ name: imgAlt.replace(/-NewLogo.*/, "").trim() || href, url: href })
        })
        return results
      })
      // Merge discovered with known
      for (const d of discovered) {
        if (!subsites.some((s) => s.url.includes(new URL(d.url).hostname))) {
          subsites.push({ name: d.name, url: d.url, city: "Orange County" })
        }
      }
    } catch {}

    for (const site of subsites) {
      console.log(`  Scraping Bonanni sub-site: ${site.name} (${site.url})`)
      try {
        const homesUrl = site.url.endsWith("/") ? site.url : site.url + "/"
        await page.goto(homesUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(3000)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(1500)

        const data = await page.evaluate((url) => {
          const body = (document.body as HTMLElement).innerText || ""
          const results: { address?: string; planName?: string; price?: number; beds?: number; baths?: number; sqft?: number }[] = []

          // Parse plan headings like "PLAN 2A | 2 BED | 2.5 BATH | 1,155 sq.ft"
          const planRegex = /PLAN\s+(\w+)\s*\|?\s*(\d+)\s*BED\s*\|?\s*([\d.]+)\s*BATH\s*\|?\s*([\d,]+)\s*sq\.?\s*ft/gi
          let m: RegExpExecArray | null
          while ((m = planRegex.exec(body)) !== null) {
            results.push({
              planName: `Plan ${m[1]}`,
              beds: parseFloat(m[2]),
              baths: parseFloat(m[3]),
              sqft: parseInt(m[4].replace(/,/g, ""), 10),
            })
          }

          // Also check Elementor headings (h2/h3/h4 with plan info)
          if (results.length === 0) {
            document.querySelectorAll("h2, h3, h4").forEach((el) => {
              const text = (el as HTMLElement).innerText || ""
              const planM = text.match(/PLAN\s+(\w+)/i)
              if (!planM) return
              const bedM = text.match(/(\d+)\s*(?:BED|BR)/i)
              const bathM = text.match(/([\d.]+)\s*(?:BATH|BA)/i)
              const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)
              results.push({
                planName: `Plan ${planM[1]}`,
                beds: bedM ? parseFloat(bedM[1]) : undefined,
                baths: bathM ? parseFloat(bathM[1]) : undefined,
                sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              })
            })
          }

          // Get community address from footer
          const addrEl = document.querySelector("footer [class*='address'], footer address, .footer-address") as HTMLElement | null
          const footerText = (document.querySelector("footer") as HTMLElement)?.innerText || ""
          const addrM = footerText.match(/\d+\s+[A-Z][a-z]+[\w\s,]+CA\s+\d{5}/)
          const address = addrEl?.innerText?.trim() || addrM?.[0] || ""

          // Get price if shown
          const priceM = body.match(/(?:starting|from|priced from)\s*\$\s*([\d,]+)/i) || body.match(/\$\s*([\d,]+(?:,\d{3})*)/)

          return {
            plans: results,
            address,
            price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
          }
        }, homesUrl)

        const baseAddress = data.address || `${site.name} - Plans Available`
        const basePrice = data.price && data.price > 100000 ? data.price : undefined

        if (data.plans.length > 0) {
          for (const plan of data.plans) {
            allListings.push({
              communityName: site.name,
              communityUrl: homesUrl,
              address: plan.planName ? `${baseAddress} - ${plan.planName}` : baseAddress,
              floorPlan: plan.planName,
              sqft: plan.sqft,
              beds: plan.beds,
              baths: plan.baths,
              price: basePrice,
              pricePerSqft: basePrice && plan.sqft ? Math.round(basePrice / plan.sqft) : undefined,
              propertyType: "Attached",
              sourceUrl: homesUrl,
            })
          }
        } else {
          allListings.push({
            communityName: site.name,
            communityUrl: homesUrl,
            address: baseAddress,
            price: basePrice,
            propertyType: "Attached",
            sourceUrl: homesUrl,
          })
        }
      } catch (err) {
        console.log(`  Error scraping Bonanni sub-site ${site.name}:`, err)
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}
