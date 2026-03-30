/**
 * Visits each Lennar listing's /property-details page and fills in missing floors.
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

async function main() {
  const listings = await prisma.listing.findMany({
    where: {
      floors: null,
      status: "active",
      community: { builder: { name: "Lennar" } },
      sourceUrl: { not: null },
    },
    select: { id: true, address: true, sourceUrl: true },
  })

  console.log(`Found ${listings.length} Lennar listings missing floors`)
  if (!listings.length) { await prisma.$disconnect(); return }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  let updated = 0

  for (const listing of listings) {
    const pdUrl = listing.sourceUrl.endsWith("/property-details")
      ? listing.sourceUrl
      : `${listing.sourceUrl}/property-details`

    try {
      await page.goto(pdUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForFunction(
        () => document.body.innerText.includes("Stories") || document.body.innerText.includes("Tax rate"),
        { timeout: 12000 }
      ).catch(() => {})

      const floors = await page.evaluate(() => {
        const kv = {}
        document.querySelectorAll("div, li").forEach(el => {
          const ch = el.children
          if (ch.length !== 2) return
          const k = ch[0].innerText?.trim()
          const v = ch[1].innerText?.trim()
          if (k && v && k.length < 80 && !k.includes("\n") && !kv[k]) kv[k] = v
        })
        const storiesRaw = kv["Stories"] || kv["stories"]
        return storiesRaw ? parseInt(storiesRaw.trim(), 10) || null : null
      })

      if (floors && floors > 0 && floors <= 10) {
        await prisma.listing.update({ where: { id: listing.id }, data: { floors } })
        console.log(`  ✓ [${listing.id}] ${listing.address} → ${floors} floors`)
        updated++
      } else {
        console.log(`  ✗ [${listing.id}] ${listing.address} — Stories not found`)
      }

      await page.waitForTimeout(400)
    } catch (err) {
      console.log(`  ! [${listing.id}] ${listing.address} — error: ${err.message?.slice(0, 60)}`)
    }
  }

  await browser.close()
  console.log(`\nUpdated ${updated}/${listings.length} Lennar listings with floors.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
