import { chromium } from 'playwright'
async function check(name, url, evalFn) {
  const b = await chromium.launch({ headless: true })
  const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })).newPage()
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await p.waitForTimeout(5000)
    const r = await p.evaluate(evalFn)
    console.log(`\n=== ${name} ===`, JSON.stringify(r).slice(0,600))
  } catch(e) { console.log(`\n=== ${name} FAIL ===`, e.message.slice(0,80)) }
  await b.close()
}

// TRI Pointe
await check('TRI Pointe', 'https://www.tripointehomes.com/ca/orange-county/', () => {
  const bodies = document.querySelectorAll('h2,h3,[class*="community"],[class*="card"]')
  const bodyText = document.body.innerText.slice(0, 800)
  const links = Array.from(document.querySelectorAll('a[href*="tripointehomes"]')).map(a => ({ href: a.href, txt: a.textContent?.trim().slice(0,30) })).slice(0,5)
  return { bodyText, links }
})

// Pulte
await check('Pulte', 'https://www.pulte.com/homes/california/orange-county', () => {
  const bodyText = document.body.innerText.slice(0, 1000)
  const winKeys = Object.keys(window).filter(k => k.includes('community') || k.includes('Community') || k.includes('__'))
  return { bodyText, winKeys: winKeys.slice(0,10) }
})

// Taylor Morrison  
await check('Taylor Morrison', 'https://www.taylormorrison.com/ca/orange-county', () => {
  const bodyText = document.body.innerText.slice(0, 800)
  const links = Array.from(document.querySelectorAll('a[href*="taylormorrison"]')).map(a => ({ href: a.href.slice(0,80), txt: a.textContent?.trim().slice(0,30) })).filter(l => l.txt).slice(0,5)
  return { bodyText, links }
})
