/**
 * Debug RSC decoding for school data
 */
import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

const allRscData = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  return scripts
    .filter(s => s.textContent?.trim().startsWith('self.__next_f.push'))
    .map(s => s.textContent?.trim())
    .join('\n')
})

// Find the initData chunk
const initIdx = allRscData.indexOf('initialData\\":{\\"hits\\":')
console.log('initIdx:', initIdx)

if (initIdx !== -1) {
  // Extract around it
  const sample = allRscData.slice(Math.max(0, initIdx - 50), initIdx + 200)
  console.log('Sample around initIdx:')
  console.log(JSON.stringify(sample))

  // Find the chunk start
  const chunkStart = allRscData.lastIndexOf('self.__next_f.push([1,"', initIdx)
  console.log('chunkStart:', chunkStart)

  // Get the raw string content of this push call
  const pushContent = allRscData.slice(chunkStart, chunkStart + 500)
  console.log('Push content start:')
  console.log(JSON.stringify(pushContent))

  // Try a different approach: use JSON.parse on the whole push expression
  // Find the string argument between [1, and the closing ]
  const strStart = chunkStart + 'self.__next_f.push([1,'.length

  // Find the string: it starts with "
  let i = strStart
  while (i < allRscData.length && allRscData[i] !== '"') i++
  i++ // skip opening "

  // Now collect chars until unescaped closing "
  let rawStr = ''
  let j = i
  while (j < allRscData.length) {
    if (allRscData[j] === '\\') {
      rawStr += allRscData[j] + (allRscData[j+1] || '')
      j += 2
    } else if (allRscData[j] === '"') {
      break
    } else {
      rawStr += allRscData[j]
      j++
    }
  }

  console.log('\nRaw string length:', rawStr.length)

  // Now decode it using JSON.parse trick
  try {
    const decoded = JSON.parse('"' + rawStr + '"')
    console.log('Decoded length:', decoded.length)

    const hitsIdx = decoded.indexOf('"hits":[{')
    console.log('hits in decoded at:', hitsIdx)
    if (hitsIdx !== -1) {
      console.log('Sample hits:')
      console.log(decoded.slice(hitsIdx, hitsIdx + 1000))
    }
  } catch(e) {
    console.log('JSON.parse error:', e.message)
    // Show what failed
    const badIdx = parseInt(e.message.match(/position (\d+)/)?.[1] || '0')
    if (badIdx) {
      console.log('Around error position', badIdx, ':')
      console.log(JSON.stringify(rawStr.slice(Math.max(0, badIdx-50), badIdx+50)))
    }
  }
}

await browser.close()
