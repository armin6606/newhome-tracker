/**
 * The RSC data is in a JS string with escaped JSON.
 * Find and decode the initialData hits to get all plan data.
 */
import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

const allNextF = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const parts = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if (text.startsWith('self.__next_f.push')) parts.push(text)
  }
  return parts.join('\n')
})

// The RSC data is in an escaped JSON string format: \"hits\":[{\"type\":\"Floor Plan\",...}]
// We need to find the initialData section and decode it
const initIdx = allNextF.indexOf('initialData\\":{\\"hits\\":')
console.log('initialData escaped at:', initIdx)

if (initIdx !== -1) {
  // Extract from this point to find the hits array
  const segment = allNextF.slice(initIdx)
  // Find the start of the hits array
  const hitsStart = segment.indexOf('\\"hits\\":[{')
  console.log('hitsStart:', hitsStart)

  // We need to extract the JSON string and then decode it
  // The whole RSC chunk is inside push([1,"...string..."])
  // Find which chunk contains this data
  const chunkIdx = allNextF.lastIndexOf('self.__next_f.push([1,"', initIdx)
  console.log('Chunk starts at:', chunkIdx)

  // Extract the string content of this push call
  // Find the matching end of the push call
  let i = chunkIdx + 22 // after 'self.__next_f.push([1,"'
  let escaped = false
  let str = ''
  while (i < allNextF.length) {
    const c = allNextF[i]
    if (escaped) {
      if (c === '"') str += '"'
      else if (c === '\\') str += '\\'
      else if (c === 'n') str += '\n'
      else if (c === 't') str += '\t'
      else if (c === 'u') {
        const hex = allNextF.slice(i+1, i+5)
        str += String.fromCodePoint(parseInt(hex, 16))
        i += 4
      } else str += '\\' + c
      escaped = false
    } else if (c === '\\') {
      escaped = true
    } else if (c === '"' && allNextF.slice(i).startsWith('"]) ')) {
      break // end of string
    } else if (c === '"' && allNextF[i+1] === ']') {
      break
    } else {
      str += c
    }
    i++
  }

  console.log('Decoded string length:', str.length)

  // Find hits in decoded string
  const hitsIdx2 = str.indexOf('"hits":[{')
  if (hitsIdx2 !== -1) {
    console.log('Hits found at:', hitsIdx2)
    console.log('Context:')
    console.log(str.slice(hitsIdx2, hitsIdx2 + 3000))
  }
}

await browser.close()
