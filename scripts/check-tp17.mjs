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

// Find the start of the initialData value in decoded1
const initDataIdx = decoded1.indexOf('"initialData":')
const valueStart = initDataIdx + '"initialData":'.length

// Try to directly JSON.parse the entire RSC payload line
// The RSC data is: 36:[false,["$","$L46",null,{...props...}]]
// Extract the props object
const propsStart = decoded1.indexOf('[false,["$","$L46",null,')
if (propsStart !== -1) {
  const objStart = propsStart + '[false,["$","$L46",null,'.length
  console.log('Props object start:', objStart, 'char:', decoded1[objStart])

  // Find end of props object
  let depth = 1
  let end = objStart + 1
  while (end < decoded1.length && depth > 0) {
    const c = decoded1[end]
    if (c === '{') depth++
    else if (c === '}') depth--
    end++
  }
  const propsStr = decoded1.slice(objStart, end)
  console.log('Props length:', propsStr.length)
  console.log('Props first 100:', propsStr.slice(0, 100))
  console.log('Props last 100:', propsStr.slice(-100))

  try {
    const props = JSON.parse(propsStr)
    console.log('\nParsed props keys:', Object.keys(props))
    const hits = props.initialData?.hits
    console.log('Hits count:', hits?.length)
    hits?.forEach(h => {
      console.log(`  ${h.title}: $${h.display_price} | ${h.min_bedrooms}bd | ${h.min_sq_feet}sqft | ${h.home_status}`)
      console.log(`    schools: ${h.schools?.map(s => s.name).join(', ')}`)
    })
  } catch(e) {
    console.log('Props parse error:', e.message?.slice(0, 80))
    const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0')
    if (pos) {
      console.log('Context:', JSON.stringify(propsStr.slice(Math.max(0,pos-50), pos+100)))
    }
  }
}

await browser.close()
