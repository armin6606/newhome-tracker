import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function publishStatus(context, state, description) {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const sha = process.env.GITHUB_SHA
  if (!token || !repo || !sha) return

  await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      state,
      context,
      description: description.slice(0, 140),
    }),
  })
}

const rows = await prisma.listing.findMany({
  where: {
    AND: [
      {
        OR: [
          { lotNumber: { contains: "104" } },
          { address: { contains: "104" } },
          { sourceUrl: { contains: "104" } },
        ],
      },
      {
        OR: [
          { floorPlan: { contains: "Rhea", mode: "insensitive" } },
          { address: { contains: "Rhea", mode: "insensitive" } },
          { sourceUrl: { contains: "rhea", mode: "insensitive" } },
          { community: { name: { contains: "Rhea", mode: "insensitive" } } },
        ],
      },
    ],
  },
  select: {
    id: true,
    address: true,
    lotNumber: true,
    floorPlan: true,
    status: true,
    currentPrice: true,
    soldAt: true,
    sourceUrl: true,
    community: {
      select: {
        name: true,
        builder: { select: { name: true } },
      },
    },
  },
  orderBy: { id: "desc" },
  take: 10,
})

console.log(`RHEA104 matches: ${rows.length}`)
for (const row of rows) {
  console.log(JSON.stringify(row))
}

if (rows.length === 0) {
  await publishStatus("audit/rhea-104", "failure", "No DB row found matching Rhea + 104")
} else {
  const first = rows[0]
  await publishStatus(
    "audit/rhea-104",
    first.status === "sold" ? "success" : "failure",
    `${first.community.builder.name} ${first.community.name}: ${first.address ?? ""} lot ${first.lotNumber ?? ""} plan ${first.floorPlan ?? ""} status ${first.status}`
  )
}

await prisma.$disconnect()
