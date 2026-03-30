import { Resend } from "resend"

export const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "NewKey.us <noreply@newkey.us>"

// Lazy singleton so build-time import doesn't fail when RESEND_API_KEY isn't set
let _resend: Resend | null = null

export function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}
