import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const [cities, builders, communities] = await Promise.all([
    prisma.community.findMany({ select: { city: true }, distinct: ["city"], orderBy: { city: "asc" } }),
    prisma.builder.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.community.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ])
  return NextResponse.json({
    cities:      cities.map((c) => c.city),
    builders:    builders.map((b) => b.name),
    communities: communities.map((c) => c.name),
  })
}
