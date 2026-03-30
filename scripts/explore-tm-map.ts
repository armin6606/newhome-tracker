import { chromium } from "playwright"

const URL = "https://www.taylormorrison.com/ca/southern-california/irvine/aurora-at-luna-park"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const apiCalls: string[] = []
  page.on("request", req => {
    const u = req.url()
    if (/(lot|homesite|siteplan|community|inventory|available|homes)/i.test(u) && !u.includes("google") && !u.includes("analytics")) {
      apiCalls.push(req.method() + " " + u)
    }
  })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(4000)
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
  await page.waitForTimeout(3000)

  const info = await page.evaluate("(function(){ var out = {}; out.svgCount = document.querySelectorAll('svg').length; out.canvasCount = document.querySelectorAll('canvas').length; out.iframes = Array.from(document.querySelectorAll('iframe')).map(function(f){ return f.src }); var dataEls = document.querySelectorAll('[data-lot-number],[data-lot-status],[data-homesite],[data-lot-id],[data-home-status],[data-status]'); out.dataAttrElements = dataEls.length; out.dataAttrSamples = Array.from(dataEls).slice(0,5).map(function(el){ return { tag: el.tagName, cls: el.className.substring(0,60), attrs: el.getAttributeNames().slice(0,8).reduce(function(a,n){ a[n]=el.getAttribute(n); return a }, {}) } }); var svgGs = document.querySelectorAll('svg g[id]'); out.svgGroupsWithId = svgGs.length; out.svgGroupSamples = Array.from(svgGs).slice(0,10).map(function(el){ return el.id }); out.siteplanEl = !!document.querySelector('[class*=site-plan],[class*=sitePlan],[id*=siteplan]'); var text = document.body.innerText; out.pageLineCount = text.split('\n').filter(function(l){ return l.trim() }).length; out.textSample = text.split('\n').filter(function(l){ return l.trim() }).slice(0,50).join(' | '); return JSON.stringify(out) })()")
  console.log("DOM info:", JSON.parse(info as string))
  console.log("API calls:", apiCalls.slice(0, 30))

  await browser.close()
}
main().catch(console.error)
