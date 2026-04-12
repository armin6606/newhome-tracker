import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getResend, FROM_EMAIL } from "@/lib/email/resend"

const MAX_EMAIL_LEN = 254  // RFC 5321 maximum email address length

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* malformed JSON → treat as empty */ }

    const email = typeof body.email === "string" ? body.email.trim() : ""

    if (
      !email ||
      email.length > MAX_EMAIL_LEN ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    // Check if already subscribed
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ message: "You're already subscribed!" })
    }

    // Create subscriber
    await prisma.newsletterSubscriber.create({ data: { email } })

    // Notify admin — fire-and-forget (never block the subscriber response)
    try {
      const resend = getResend()
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      "info@newkey.us",
        subject: "New Newsletter Subscriber",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1c1917; margin-bottom: 8px;">New Newsletter Subscriber</h2>
            <p style="color: #78716c; font-size: 14px; margin-bottom: 16px;">
              Someone just subscribed to the NewKey.us weekly newsletter.
            </p>
            <div style="background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <p style="color: #44403c; font-size: 14px; margin: 0;"><strong>Email:</strong> ${email}</p>
              <p style="color: #44403c; font-size: 14px; margin: 8px 0 0;"><strong>Date:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</p>
            </div>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("[/api/newsletter] Admin notification failed:", emailErr)
      // Don't fail the subscription if admin email fails
    }

    return NextResponse.json({ message: "Successfully subscribed!" })
  } catch (err) {
    console.error("[/api/newsletter] Unhandled error:", err)
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
}
