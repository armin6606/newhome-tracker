import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0" })
const page = await context.newPage()
await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
const allRscData = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('script:not([src])')).filter(s => s.textContent?.trim().startsWith('self.__next_f.push')).map(s => s.textContent?.trim()).join('\n')
})

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
const decoded1 = JSON.parse('"' + rawStr + '"')

// decoded1 is the RSC payload. It's like:
// 36:[false,["$","$L46",null,{"sectionId":"...","initialData":{"hits":[ESCAPED_CONTENT]}}]]
//
// The "initialData" key maps to an object, but WITHIN that object, the hits array
// contains escaped JSON content (still has \" and \\ etc.)
//
// This is because the RSC data serializes the Algolia response as a string
// embedded in the React component props.

// Find "initialData": in decoded1
const initDataIdx = decoded1.indexOf('"initialData":')
console.log('initDataIdx:', initDataIdx)
console.log('Context:', decoded1.slice(initDataIdx, initDataIdx + 100))

// The value after "initialData": is {"hits":[...]}
// But the hits content is STILL escaped (double-escape: outer RSC -> inner JSON string)
// Look at the raw value starting right after "initialData":
const valueStart = initDataIdx + '"initialData":'.length
console.log('valueStart char:', decoded1[valueStart], 'next:', decoded1[valueStart+1])
console.log('Value start to +200:', decoded1.slice(valueStart, valueStart + 200))

// Strategy: find "initialData":"<string-value>" and JSON.parse the string
// OR find the raw escaped section in allRscData and decode it manually

// The raw RSC data has \\\"hits\\\":[{\\\"type
// This is: \\ (escaped \) followed by \" (escaped ") — so in raw it's \" which in JSON = "
// So the rawStr has \\\" which decodes to \"
// This means the hits content is a JSON-encoded string inside the RSC payload

// Different approach: extract from rawStr directly
// In rawStr: initialData\\":{\\"hits\\":[{\\"type
// \\" = escaped quote in JSON string = "
// \\\\": = escaped backslash = \, followed by "
// Actually \\ = two chars that represent a single \, \" = two chars that represent "
// So \\\" in rawStr = \" in decoded1 = escaped quote in JSON

// The hits data in decoded1 is STILL valid JSON if we treat it as a JSON string
// because "type" appears as \"type\" in decoded1 which is the JSON-string-escaped form

// So we need to:
// 1. Find "initialData": in decoded1
// 2. Find the VALUE (starting with {)
// 3. Extract that escaped JSON and parse it again

// Let's find the start of the initialData value string
// It contains \"hits\":[{\", which we need to find and then extract
const escapedHitsIdx = decoded1.indexOf('\\"hits\\":[{\\"')
console.log('\nEscaped hits at:', escapedHitsIdx)
if (escapedHitsIdx !== -1) {
  // Find the outer string containing this
  // It starts with {\\"hits\\":
  // Walk back to find {\"
  let start = escapedHitsIdx
  while (start > 0 && !(decoded1[start] === '{' && decoded1[start+1] === '\\"')) start--
  console.log('Container start at:', start, 'char:', decoded1[start], decoded1[start+1])

  // Now we need to extract this as a string and parse it
  // Find the content between start and matching }
  // But the content itself has escaped quotes, so we treat it as a raw string
  // The outer { and } are unescaped in decoded1

  // Actually, let me think differently:
  // decoded1 has the outer RSC array, where the JSON props are embedded
  // The prop value of initialData is a JSON object but when serialized into RSC,
  // it gets JSON.stringify'd, so keys/values are escaped

  // The best approach: extract the raw substring from allRscData and do a targeted decode
  // We need to find: "initialData":\\"<escaped-string-value>\\"
  // Actually: in the RSC, initialData has a JSON object value embedded as a string

  // Looking at the raw data:
  // allRscData has: ...initialData\\":{\\"hits\\":[{\\"type\\":\\"Floor Plan\\"...
  // After first JSON.parse this becomes: ...initialData\\":{\\"hits\\":[{\\"type\\":\\"Floor Plan\\"...
  // Wait NO — after JSON.parse('"' + rawStr + '"'), the \\\\ becomes \\ and \\" becomes "
  // So \\\"hits\\\" → \"hits\" (backslash-quote)
  // Meaning in decoded1: \"hits\" = escaped quote + hits + escaped quote

  // So decoded1 contains: initialData":{"hits":[{"type":"Floor Plan"...
  // But actually appears as: initialData\\":{\\"hits\\":[{\\"type\\"...
  // which means decoded1 literally contains: initialData":{"hits":[{"type":"Floor Plan"...

  // Let me check character by character:
  const testStr = decoded1.slice(initDataIdx, initDataIdx + 50)
  console.log('\nByte by byte (hex):')
  for (let ci = 0; ci < testStr.length; ci++) {
    process.stdout.write(testStr.charCodeAt(ci).toString(16).padStart(2,'0') + ' ')
  }
  console.log()
  console.log('Text:', testStr)
}

await browser.close()
