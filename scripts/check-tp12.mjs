import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

const allRscData = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  return scripts.filter(s => s.textContent?.trim().startsWith('self.__next_f.push')).map(s => s.textContent?.trim()).join('\n')
})

const initIdx = allRscData.indexOf('initialData\\":{\\"hits\\":')
const chunkStart = allRscData.lastIndexOf('self.__next_f.push([1,"', initIdx)

let i = chunkStart + 'self.__next_f.push([1,'.length
while (i < allRscData.length && allRscData[i] !== '"') i++
i++

let rawStr = ''
let j = i
while (j < allRscData.length) {
  if (allRscData[j] === '\\') {
    rawStr += allRscData[j] + (allRscData[j + 1] || '')
    j += 2
  } else if (allRscData[j] === '"') {
    break
  } else {
    rawStr += allRscData[j]
    j++
  }
}

console.log('rawStr length:', rawStr.length)

const decoded = JSON.parse('"' + rawStr + '"')
console.log('decoded length:', decoded.length)

const hitsIdx = decoded.indexOf('"hits":[{')
console.log('hitsIdx:', hitsIdx)

// Extract hits array
let depth = 1
let k = hitsIdx + 9
while (k < decoded.length && depth > 0) {
  if (decoded[k] === '[') depth++
  else if (decoded[k] === ']') depth--
  k++
}
const hitsStr = '[' + decoded.slice(hitsIdx + 9, k - 1) + ']'
console.log('hitsStr length:', hitsStr.length)
console.log('hitsStr last 100 chars:', JSON.stringify(hitsStr.slice(-100)))

// Try to parse
try {
  const hits = JSON.parse(hitsStr)
  console.log('Hits count:', hits.length)
  hits.forEach((h, i) => {
    console.log(i, h.title, h.display_price, h.min_bedrooms, h.min_sq_feet, h.home_status)
    console.log('  schools:', h.schools?.map(s => s.name).join(', '))
  })
} catch(e) {
  console.log('Parse error:', e.message)
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0')
  if (pos) {
    console.log('Context around position', pos, ':')
    console.log(JSON.stringify(hitsStr.slice(Math.max(0, pos-100), pos+100)))
  }
}

await browser.close()
