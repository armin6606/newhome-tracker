import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0" })
const page = await context.newPage()
await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
const allRscData = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('script:not([src])')).filter(s => s.textContent?.trim().startsWith('self.__next_f.push')).map(s => s.textContent?.trim()).join('\n')
})

// Find the initData chunk
const initIdx = allRscData.indexOf('initialData\\":{\\"hits\\":')
const chunkStart = allRscData.lastIndexOf('self.__next_f.push([1,"', initIdx)
let i = chunkStart + 'self.__next_f.push([1,'.length
while (i < allRscData.length && allRscData[i] !== '"') i++
i++
let rawStr = ''
let j = i
while (j < allRscData.length) {
  if (allRscData[j] === '\\') { rawStr += allRscData[j] + (allRscData[j+1] || ''); j += 2 }
  else if (allRscData[j] === '"') break
  else { rawStr += allRscData[j]; j++ }
}
const decoded = JSON.parse('"' + rawStr + '"')

const hitsIdx = decoded.indexOf('"hits":[')
const arrayStart = hitsIdx + 8 // points to [

console.log('arrayStart char:', decoded[arrayStart])
console.log('decoded around hits (hitsIdx to hitsIdx+20):')
console.log(JSON.stringify(decoded.slice(hitsIdx, hitsIdx + 30)))

// The array starts at arrayStart which should be [
// Let's see what's at arrayStart
console.log('\nFirst 20 chars of array content:')
console.log(JSON.stringify(decoded.slice(arrayStart, arrayStart + 50)))

// Count brackets to extract
let depth = 1
let k = arrayStart + 1
while (k < decoded.length && depth > 0) {
  if (decoded[k] === '[') depth++
  else if (decoded[k] === ']') depth--
  k++
}
const hitsStr = decoded.slice(arrayStart, k)
console.log('\nhitsStr length:', hitsStr.length)
console.log('hitsStr[0]:', hitsStr[0])
console.log('hitsStr first 50:', JSON.stringify(hitsStr.slice(0, 50)))
console.log('hitsStr last 50:', JSON.stringify(hitsStr.slice(-50)))

try {
  const hits = JSON.parse(hitsStr)
  console.log('SUCCESS! Parsed', hits.length, 'hits')
  hits.forEach(h => {
    console.log(`  ${h.title}: $${h.display_price} | ${h.min_bedrooms}bd | ${h.min_sq_feet}sqft`)
    console.log(`  schools: ${JSON.stringify(h.schools)}`)
  })
} catch(e) {
  console.log('Parse error:', e.message)
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0')
  console.log('Context around position', pos, ':')
  console.log(JSON.stringify(hitsStr.slice(Math.max(0,pos-30), pos+50)))
}

await browser.close()
