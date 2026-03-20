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

// First decode
const decoded1 = JSON.parse('"' + rawStr + '"')
console.log('After 1st decode (first 200):', decoded1.slice(0, 200))
console.log('Contains "hits":[{:', decoded1.includes('"hits":[{'))
console.log('Contains \\"hits\\":[{\\":', decoded1.includes('\\"hits\\":[{\\"'))

// Try second decode
try {
  const decoded2 = JSON.parse('"' + decoded1.replace(/"/g, '\\"') + '"')
  console.log('After 2nd decode (first 200):', decoded2.slice(0, 200))
} catch(e) {
  console.log('2nd decode error:', e.message?.slice(0, 60))
}

// The decoded string has: \"type\" so it's still escaped JSON
// We need to treat the hits array content AS a JSON string and parse it again
const hitsIdx = decoded1.indexOf('\\"hits\\":[{\\"')
console.log('\nhitsIdx with escaped quotes:', hitsIdx)
if (hitsIdx !== -1) {
  // The content after \\"hits\\":[{\\" is still escaped
  // We need to extract the full escaped hits string and decode it
  const sample = decoded1.slice(hitsIdx, hitsIdx + 500)
  console.log('Sample:', sample)

  // The hits content is a JSON string inside a JSON string
  // Extract the whole outer JSON object that contains hits
  // Find the containing object start
  let start = hitsIdx
  while (start > 0 && decoded1[start] !== '{') start--

  // Find end
  let depth = 0
  let end = start
  while (end < decoded1.length) {
    if (decoded1[end] === '\\' && decoded1[end+1]) { end += 2; continue }
    if (decoded1[end] === '{') depth++
    else if (decoded1[end] === '}') { depth--; if (depth === 0) { end++; break } }
    end++
  }

  const outerObj = decoded1.slice(start, end)
  console.log('\nOuter object (first 300):', outerObj.slice(0, 300))

  // Now decode this as JSON string
  try {
    const decodedInner = JSON.parse('"' + outerObj + '"')
    console.log('decodedInner (first 200):', decodedInner.slice(0, 200))
  } catch(e) {
    console.log('Inner decode error:', e.message?.slice(0, 60))
  }
}

await browser.close()
