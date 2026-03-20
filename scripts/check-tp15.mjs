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

// 1st decode: outer JS string
const decoded1 = JSON.parse('"' + rawStr + '"')
console.log('decoded1 first 100:', decoded1.slice(0, 100))

// decoded1 still has escaped JSON (\"type\"). This is because the RSC chunk
// contains a JSON-encoded string value. We need to find the "initialData" object
// and parse it from decoded1.

// The decoded1 starts with RSC markup like: 36:[false,["$","$L46",null,{...}]]
// Find the initialData property and extract its object
const initDataIdx = decoded1.indexOf('"initialData":{"hits":')
console.log('initialData found in decoded1 at:', initDataIdx)
if (initDataIdx === -1) {
  // Still escaped
  console.log('Still escaped, trying second decode of the hits section')
  // The hitsStr from decoded1 is still escaped, so we need to parse it again
  const hitsIdx = decoded1.indexOf('\\"hits\\":[{\\"')
  if (hitsIdx === -1) {
    console.log('No escaped hits either')
  } else {
    console.log('Found double-escaped hits at:', hitsIdx)
  }
} else {
  // Great, we can extract normally
  const hitsIdx = decoded1.indexOf('"hits":[{', initDataIdx)
  if (hitsIdx !== -1) {
    let depth = 1
    let k = hitsIdx + 8 + 1 // past the [
    while (k < decoded1.length && depth > 0) {
      if (decoded1[k] === '[') depth++
      else if (decoded1[k] === ']') depth--
      k++
    }
    const hitsStr = '[' + decoded1.slice(hitsIdx + 9, k - 1) + ']'
    console.log('hitsStr first 50:', hitsStr.slice(0, 50))
    try {
      const hits = JSON.parse(hitsStr)
      console.log('SUCCESS', hits.length, 'hits')
      hits.forEach(h => console.log(' ', h.title, h.display_price, h.schools?.map(s=>s.name)))
    } catch(e) {
      console.log('ERROR:', e.message.slice(0, 100))
    }
  }
}

// The key insight: the RSC data structure
// allRscData contains: self.__next_f.push([1,"<JS-string-escaped RSC payload>"])
// After 1st JSON.parse: decoded1 = the RSC payload string, which is RSC flight format
// RSC flight format: 36:[...,[{sectionId:..., initialData: <INNER-JSON-STRING>}]]
// The initialData VALUE is a JS object that's been JSON.stringify'd and embedded in the RSC

// Let's examine decoded1 structure more carefully
const pos = decoded1.indexOf('initialData')
console.log('\nContext around initialData in decoded1:')
console.log(JSON.stringify(decoded1.slice(pos - 10, pos + 200)))

await browser.close()
