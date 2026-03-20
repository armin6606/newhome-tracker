import { createServerSupabaseClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { getResend, FROM_EMAIL } from "@/lib/email/resend"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next")

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Notify admin about new verified signup (fire-and-forget)
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        notifyAdminNewSignup(user.email).catch(() => {})
      }
      // If 'next' was explicitly provided (e.g. OAuth), go there; otherwise show confirmation page
      return NextResponse.redirect(`${origin}${next ?? "/auth/confirmed"}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=Could+not+verify+email`)
}

async function notifyAdminNewSignup(email: string) {
  try {
    const resend = getResend()
    await resend.emails.send({
      from: FROM_EMAIL,
      to: "info@newkey.us",
      subject: "New User Signup — NewKey.us",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1c1917; margin-bottom: 8px;">New User Signed Up</h2>
          <p style="color: #78716c; font-size: 14px; margin-bottom: 16px;">
            A new user just verified their email on NewKey.us.
          </p>
          <div style="background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 16px;">
            <p style="color: #44403c; font-size: 14px; margin: 0;"><strong>Email:</strong> ${email}</p>
            <p style="color: #44403c; font-size: 14px; margin: 8px 0 0;"><strong>Date:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</p>
          </div>
        </div>
      `,
    })
  } catch (err) {
    console.error("Failed to send signup admin notification:", err)
  }
}
