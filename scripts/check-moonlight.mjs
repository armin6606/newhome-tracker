import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.replace(/\r/, "").split("=")
    if (k && !k.startsWith("#") && v.length)
      process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const communities = ["Rhythm", "Moonlight", "Stafford Glen"]

for (const name of communities) {
  const active = await prisma.listing.count({ where: { community: { name, builder: { name: "KB Home" } }, status: "active" } })
  const sold   = await prisma.listing.count({ where: { community: { name, builder: { name: "KB Home" } }, status: "sold"   } })
  const future = await prisma.listing.count({ where: { community: { name, builder: { name: "KB Home" } }, status: "future" } })
  console.log(`${name}: active=${active}  sold=${sold}  future=${future}`)
}

await prisma.$disconnect()
