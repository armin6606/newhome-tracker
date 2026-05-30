import tls from "node:tls"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const IMAP_HOST = process.env.PROMO_IMAP_HOST || "imap.gmail.com"
const IMAP_PORT = Number(process.env.PROMO_IMAP_PORT || 993)
const PROMO_USER = process.env.PROMO_GMAIL_USER || "amy309431@gmail.com"
const PROMO_PASSWORD = process.env.PROMO_GMAIL_APP_PASSWORD || ""
const LOOKBACK_DAYS = Number(process.env.PROMO_INBOX_LOOKBACK_DAYS || 14)
const MAX_EMAILS = Number(process.env.PROMO_INBOX_MAX_EMAILS || 50)
const MAX_ATTEMPTS = Number(process.env.PROMO_INBOX_MAX_ATTEMPTS || 3)
const SOCKET_TIMEOUT_MS = Number(process.env.PROMO_INBOX_SOCKET_TIMEOUT_MS || 20_000)
const COMMAND_TIMEOUT_MS = Number(process.env.PROMO_INBOX_COMMAND_TIMEOUT_MS || 30_000)
const RUN_TIMEOUT_MS = Number(process.env.PROMO_INBOX_RUN_TIMEOUT_MS || 4 * 60_000)
const RETRY_DELAYS_MS = [10_000, 30_000]

const BOILERPLATE_PATTERNS = [
  /prices?\s+may\s+not\s+include/i,
  /prices?.*promotions?.*incentives?.*subject\s+to\s+change/i,
  /features?.*options?.*amenities?.*floor\s+plans?.*subject\s+to\s+change/i,
  /square\s+footage.*estimated/i,
  /copyright\s+©?\s*\d{4}/i,
  /all\s+rights\s+reserved/i,
  /privacy\s+policy/i,
  /terms\s+of\s+use/i,
  /unsubscribe/i,
]

const STRONG_PROMO_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:off|credit|bonus|savings?|toward|incentive|closing)/i,
  /\d+(?:\.\d+)?\s?%\s*(?:apr|rate|interest|financing|mortgage|buydown)/i,
  /(?:save|savings)\s+(?:up\s+to\s+)?(?:\$|\d)/i,
  /(?:closing\s+cost|design|upgrade|flex\s+cash|rate\s+buy[-\s]?down|buydown)\s+(?:credit|assistance|savings?|offer|incentive)/i,
  /(?:special|limited[-\s]?time)\s+(?:financing|rate|offer|incentive|promotion|savings)/i,
  /(?:below[-\s]?market|reduced)\s+(?:interest\s+)?rate/i,
]

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function imapDate(date) {
  return `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`
}

function decodeQuotedPrintable(value) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function decodeEncodedWords(value) {
  return value.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_match, charset, encoding, text) => {
    try {
      const bytes = encoding.toUpperCase() === "B"
        ? Buffer.from(text, "base64")
        : Buffer.from(decodeQuotedPrintable(text.replace(/_/g, " ")), "binary")
      return bytes.toString(String(charset).toLowerCase().includes("iso-8859") ? "latin1" : "utf8")
    } catch {
      return text
    }
  })
}

function parseHeaders(raw) {
  const headerText = raw.split(/\r?\n\r?\n/, 1)[0] ?? ""
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ")
  const headers = new Map()
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    headers.set(line.slice(0, idx).toLowerCase(), decodeEncodedWords(line.slice(idx + 1).trim()))
  }
  return headers
}

function htmlToText(value) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function emailBodyText(raw) {
  const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n")
  return htmlToText(decodeQuotedPrintable(body))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function compact(value, max = 4000) {
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function containsPromo(text) {
  return hasStrongPromoSignal(text)
}

function isBoilerplate(text) {
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text))
}

function hasStrongPromoSignal(text) {
  return STRONG_PROMO_PATTERNS.some((pattern) => pattern.test(text))
}

function extractOfferText(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => compact(line, 500))
    .filter((line) => line.length >= 12 && line.length <= 500)

  const hits = lines.filter((line) => hasStrongPromoSignal(line) && !isBoilerplate(line))
  const unique = [...new Set(hits)]
  if (unique.length > 0) return unique.slice(0, 4).join(" | ")

  return ""
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i)
  return match?.[0]?.replace(/[),.]+$/, "")
}

function extractExpiration(text) {
  const patterns = [
    /(?:expires|ends|through|valid through|offer ends)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(?:expires|ends|through|valid through|offer ends)\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const date = new Date(match[1])
    if (!Number.isNaN(date.getTime())) return date
  }
  return undefined
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
}

function findBuilder(text, builders) {
  const haystack = normalizeName(text)
  return builders.find((builder) => haystack.includes(normalizeName(builder.name))) ?? null
}

function findCommunity(text, communities) {
  const haystack = normalizeName(text)
  return communities
    .filter((community) => haystack.includes(normalizeName(community.name)))
    .sort((a, b) => b.name.length - a.name.length)[0] ?? null
}

class ImapClient {
  constructor({ host, port, user, password }) {
    this.host = host
    this.port = port
    this.user = user
    this.password = password
    this.tagCounter = 1
    this.buffer = ""
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (err) => {
        if (settled) return
        settled = true
        this.socket?.destroy()
        reject(err)
      }

      this.socket = tls.connect(this.port, this.host, { servername: this.host }, () => resolve())
      this.socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
        fail(new Error(`IMAP socket timeout after ${Math.round(SOCKET_TIMEOUT_MS / 1000)}s`))
      })
      this.socket.setEncoding("utf8")
      this.socket.on("data", (chunk) => { this.buffer += chunk })
      this.socket.on("error", fail)
      this.socket.on("connect", () => { settled = true })
    }).then(() => this.waitForGreeting())
  }

  waitForGreeting() {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const tick = () => {
        if (this.buffer.includes("\r\n")) return resolve()
        if (Date.now() - started > SOCKET_TIMEOUT_MS) {
          this.socket?.destroy()
          return reject(new Error("IMAP greeting timeout"))
        }
        setTimeout(tick, 25)
      }
      tick()
    })
  }

  nextTag() {
    return `A${String(this.tagCounter++).padStart(4, "0")}`
  }

  command(command) {
    const tag = this.nextTag()
    this.buffer = ""
    this.socket.write(`${tag} ${command}\r\n`)
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const tick = () => {
        if (new RegExp(`\\r\\n${tag} (OK|NO|BAD)`, "i").test(this.buffer)) {
          return resolve(this.buffer)
        }
        if (Date.now() - started > COMMAND_TIMEOUT_MS) {
          this.socket?.destroy()
          return reject(new Error(`IMAP timeout on ${command}`))
        }
        setTimeout(tick, 50)
      }
      tick()
    })
  }

  async login() {
    const res = await this.command(`LOGIN "${this.user.replace(/"/g, '\\"')}" "${this.password.replace(/"/g, '\\"')}"`)
    if (!/\r\nA\d+ OK/i.test(res)) throw new Error("IMAP login rejected")
  }

  async selectInbox() {
    const res = await this.command("SELECT INBOX")
    if (!/\r\nA\d+ OK/i.test(res)) throw new Error("IMAP inbox select failed")
  }

  async searchSince(date) {
    const res = await this.command(`UID SEARCH SINCE ${imapDate(date)}`)
    const line = res.split(/\r?\n/).find((row) => row.startsWith("* SEARCH")) ?? ""
    return line.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean)
  }

  async fetchRaw(uid) {
    const res = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`)
    const literalStart = res.indexOf("\r\n\r\n")
    if (literalStart >= 0) {
      const firstLine = res.slice(0, literalStart).split(/\r?\n/).find((line) => /\{\d+\}$/.test(line))
      const sizeMatch = firstLine?.match(/\{(\d+)\}$/)
      if (sizeMatch) {
        const start = literalStart + 4
        return res.slice(start, start + Number(sizeMatch[1]))
      }
    }
    return res
  }

  async logout() {
    try { await this.command("LOGOUT") } catch {}
    this.socket.end()
  }
}

async function loadCatalog() {
  const builders = await prisma.builder.findMany({
    select: {
      id: true,
      name: true,
      communities: { select: { id: true, name: true } },
    },
  })
  const communities = builders.flatMap((builder) =>
    builder.communities.map((community) => ({ ...community, builderName: builder.name }))
  )
  return { builders, communities }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createPendingPromo(raw, catalog) {
  const headers = parseHeaders(raw)
  const body = emailBodyText(raw)
  const combined = `${headers.get("from") ?? ""}\n${headers.get("subject") ?? ""}\n${body}`

  if (!containsPromo(combined)) return { created: false, reason: "no promo keywords" }

  const sourceMessageId = headers.get("message-id") ?? headers.get("x-gm-message-state") ?? undefined
  if (sourceMessageId) {
    const existing = await prisma.promoSubmission.findFirst({ where: { sourceMessageId } })
    if (existing) return { created: false, reason: "duplicate" }
  }

  const builder = findBuilder(combined, catalog.builders)
  const community = builder
    ? findCommunity(combined, catalog.communities.filter((item) => item.builderName === builder.name))
    : findCommunity(combined, catalog.communities)

  const offerText = extractOfferText(body)
  if (!offerText) return { created: false, reason: "empty offer" }

  const duplicate = await prisma.promoSubmission.findFirst({
    where: {
      status: "pending",
      builderName: builder?.name ?? community?.builderName ?? null,
      communityName: community?.name ?? null,
      offerText,
    },
  })
  if (duplicate) return { created: false, reason: "duplicate offer" }

  const confidence =
    (builder ? 0.45 : 0) +
    (community ? 0.25 : 0) +
    (extractFirstUrl(body) ? 0.15 : 0) +
    (extractExpiration(body) ? 0.15 : 0)

  const promo = await prisma.promoSubmission.create({
    data: {
      source: "gmail",
      sourceMessageId,
      sourceFrom: headers.get("from") ?? null,
      sourceSubject: headers.get("subject") ?? null,
      sourceDate: headers.get("date") ? new Date(headers.get("date")) : null,
      rawSnippet: compact(body, 1000),
      builderName: builder?.name ?? community?.builderName ?? null,
      communityName: community?.name ?? null,
      offerText,
      offerUrl: extractFirstUrl(body) ?? null,
      expiresAt: extractExpiration(body),
      confidence: Math.min(1, confidence),
      notes: builder ? null : "Builder could not be matched automatically.",
    },
  })

  return { created: true, promo }
}

async function main() {
  const watchdog = setTimeout(async () => {
    console.error(`Promo inbox monitor skipped after ${Math.round(RUN_TIMEOUT_MS / 1000)}s run timeout.`)
    await prisma.$disconnect().catch(() => {})
    process.exit(0)
  }, RUN_TIMEOUT_MS)

  if (!PROMO_PASSWORD) {
    console.log("PROMO_GMAIL_APP_PASSWORD is not configured; promo inbox monitor skipped.")
    clearTimeout(watchdog)
    return
  }

  const catalog = await loadCatalog()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  let created = 0
  let skipped = 0
  let lastError = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = new ImapClient({
      host: IMAP_HOST,
      port: IMAP_PORT,
      user: PROMO_USER,
      password: PROMO_PASSWORD,
    })

    try {
      if (attempt > 1) console.log(`Promo inbox: retry attempt ${attempt}/${MAX_ATTEMPTS}.`)
      await client.connect()
      await client.login()
      await client.selectInbox()
      const uids = (await client.searchSince(since)).slice(-MAX_EMAILS)
      console.log(`Promo inbox: checking ${uids.length} email(s) since ${imapDate(since)}.`)

      for (const uid of uids) {
        const raw = await client.fetchRaw(uid)
        const result = await createPendingPromo(raw, catalog)
        if (result.created) {
          created++
          console.log(`  Created pending promo #${result.promo.id}: ${result.promo.builderName ?? "Unknown builder"}`)
        } else {
          skipped++
        }
      }

      await client.logout()
      console.log(`Promo inbox monitor done. Created ${created}, skipped ${skipped}.`)
      clearTimeout(watchdog)
      await prisma.$disconnect()
      return
    } catch (err) {
      lastError = err
      console.warn(`Promo inbox attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`)
      try { await client.logout() } catch {}

      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
        console.log(`Promo inbox: waiting ${Math.round(delay / 1000)}s before retry.`)
        await sleep(delay)
      }
    }
  }

  console.error(`Promo inbox monitor skipped after ${MAX_ATTEMPTS} failed attempt(s): ${lastError?.message ?? lastError}`)
  clearTimeout(watchdog)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Promo inbox monitor failed:", err)
  await prisma.$disconnect()
  process.exit(1)
})
