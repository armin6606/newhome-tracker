import { prisma } from "../lib/db"

async function main() {
  const builders = await prisma.builder.findMany({
    include: {
      communities: {
        include: {
          listings: {
            orderBy: { lastUpdated: "desc" },
            take: 1,
            select: { lastUpdated: true },
          },
        },
      },
    },
  })

  const now = new Date()
  for (const b of builders) {
    let latest: Date | null = null
    for (const c of b.communities) {
      const t = c.listings[0]?.lastUpdated
      if (t && (!latest || t > latest)) latest = t
    }
    if (latest) {
      const diffDays = ((now.getTime() - latest.getTime()) / 1000 / 60 / 60 / 24).toFixed(1)
      console.log(`${b.name}: ${latest.toISOString().slice(0, 16).replace("T", " ")} UTC  (${diffDays} days ago)`)
    } else {
      console.log(`${b.name}: never`)
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
