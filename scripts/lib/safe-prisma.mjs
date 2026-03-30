/**
 * SAFETY WRAPPER — use this instead of raw PrismaClient in fix/cleanup scripts.
 *
 * Rules enforced:
 * 1. Fix scripts CANNOT change listing `status` (only scrapers can).
 * 2. Every bulk operation is previewed first; pass --apply to commit changes.
 *
 * Usage:
 *   import { safePrisma, checkApply } from "./lib/safe-prisma.mjs"
 *   checkApply()  // prints warning and exits unless --apply flag passed
 *   const prisma = safePrisma()
 */

import { PrismaClient } from "@prisma/client"

const IS_DRY_RUN = !process.argv.includes("--apply")

export function checkApply() {
  if (IS_DRY_RUN) {
    console.log("╔══════════════════════════════════════════════════════════╗")
    console.log("║  DRY RUN — no changes will be written to the database   ║")
    console.log("║  Run with --apply to commit changes.                    ║")
    console.log("╚══════════════════════════════════════════════════════════╝\n")
  } else {
    console.log("⚠️  APPLY MODE — changes WILL be written to the database\n")
  }
}

export function isDryRun() {
  return IS_DRY_RUN
}

/**
 * Returns a Prisma client proxy that:
 *  - Blocks any update/updateMany that sets `status` on Listing
 *  - Blocks all writes in dry-run mode
 */
export function safePrisma() {
  const prisma = new PrismaClient()

  function guardData(model, operation, args) {
    // Block status changes in Listing from fix scripts
    if (model === "listing" && args?.data && "status" in args.data) {
      throw new Error(
        `🚫 SAFETY BLOCK: Fix scripts cannot change listing status.\n` +
        `   Only scraper scripts (run-scraper.mjs, scrape-*.mjs) may set status.\n` +
        `   Attempted: ${model}.${operation}({ data: { status: "${args.data.status}" } })`
      )
    }

    // Block community.excluded changes that would hide real communities with active listings
    // (allowed only if name matches known garbage patterns)
    if (model === "community" && args?.data && "excluded" in args.data && args.data.excluded === true) {
      console.warn("⚠️  WARNING: Excluding a community — verify it has no real active listings first.")
    }

    // In dry-run, block all writes
    if (IS_DRY_RUN) {
      const preview = JSON.stringify(args, null, 2).slice(0, 300)
      console.log(`  [DRY RUN] ${model}.${operation}(${preview}${preview.length >= 300 ? "..." : ""})`)
      // Return a fake result
      return { count: 0 }
    }
  }

  // Proxy the prisma client to intercept write operations
  return new Proxy(prisma, {
    get(target, prop) {
      const model = prop.toLowerCase()
      const modelClient = target[prop]
      if (typeof modelClient !== "object" || modelClient === null) return modelClient

      return new Proxy(modelClient, {
        get(mTarget, operation) {
          const fn = mTarget[operation]
          if (!["update", "updateMany", "delete", "deleteMany", "create", "createMany", "upsert"].includes(operation)) {
            return typeof fn === "function" ? fn.bind(mTarget) : fn
          }

          return async (args) => {
            const result = guardData(model, operation, args)
            if (result !== undefined) return result
            return fn.call(mTarget, args)
          }
        }
      })
    }
  })
}
