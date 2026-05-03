async function main() {
  const sid   = process.env.TWILIO_ACCOUNT_SID!
  const token = process.env.TWILIO_AUTH_TOKEN!
  const from  = process.env.TWILIO_WHATSAPP_FROM!
  const to    = process.env.TWILIO_WHATSAPP_TO!

  console.log("SID:", sid)
  console.log("Token:", token?.slice(0, 6) + "...")
  console.log("From:", from)
  console.log("To:", to)

  const body = new URLSearchParams({
    From: from,
    To: to,
    Body: "✅ New Key WhatsApp test — scraper failure alerts are working!",
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  )

  const json = await res.json()
  console.log("Status:", res.status)
  console.log("Response:", JSON.stringify(json, null, 2))
}

main().catch(console.error)
