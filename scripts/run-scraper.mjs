/**
 * Run the full scraper locally.
 * Usage: node --env-file=.env.local scripts/run-scraper.mjs
 */
import { PrismaClient } from "@prisma/client"

// Polyfill so the TypeScript scraper path-alias @/lib/db works via compiled output
// We call the scraper builders directly using ts-node / tsx instead
const prisma = new PrismaClient()

// Quick connectivity check
const count = await prisma.listing.count()
console.log(`DB connected. Current listing count: ${count}`)
await prisma.$disconnect()

console.log("\nStarting full scraper via tsx...\n")
