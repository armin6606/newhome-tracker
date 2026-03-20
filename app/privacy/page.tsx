import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "NewKey.us privacy policy — how we collect, use, and protect your personal information.",
  alternates: { canonical: "https://www.newkey.us/privacy" },
  robots: { index: true, follow: true },
}

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-amber-600 text-xs font-semibold uppercase tracking-widest mb-1.5">Legal</p>
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Privacy Policy</h1>
        <p className="text-sm text-stone-400">Effective Date: January 1, 2025 &middot; Last Updated: March 20, 2026</p>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-6 sm:px-8 py-8 space-y-8 text-stone-600 text-sm leading-relaxed">

        {/* Introduction */}
        <section>
          <p>
            NewKey.us (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the website located at{" "}
            <a href="https://www.newkey.us" className="text-amber-600 hover:underline">www.newkey.us</a>{" "}
            (the &quot;Site&quot;). This Privacy Policy describes how we collect, use, disclose, and protect your
            personal information when you visit our Site or use our services. By accessing or using the Site, you
            agree to the terms of this Privacy Policy.
          </p>
        </section>

        {/* Information We Collect */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">1. Information We Collect</h2>

          <h3 className="font-semibold text-stone-700 mb-1.5">1.1 Account Information</h3>
          <p className="mb-3">
            When you create an account, we collect your email address and authentication credentials. We use
            Supabase as our authentication provider, which may store your email, hashed password, and OAuth
            tokens if you sign in via Google. We do not store your raw password.
          </p>

          <h3 className="font-semibold text-stone-700 mb-1.5">1.2 Usage Data</h3>
          <p className="mb-3">
            We automatically collect certain information when you visit the Site, including your IP address,
            browser type, operating system, referring URLs, pages viewed, and the dates and times of your visits.
            This data is collected through Google Analytics (measurement ID: G-2NDP6KLSSY) and server logs.
          </p>

          <h3 className="font-semibold text-stone-700 mb-1.5">1.3 User Preferences and Activity</h3>
          <p>
            When you use our services, we collect information about your interactions, including communities you
            follow, listings you favorite, price alert preferences, and search filters you apply. This data is
            stored to provide you with a personalized experience.
          </p>
        </section>

        {/* How We Use Your Information */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">2. How We Use Your Information</h2>
          <p className="mb-3">We use the information we collect to:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Provide, operate, and maintain the Site and its features</li>
            <li>Authenticate your identity and manage your account</li>
            <li>Send you email notifications about price changes, new listings, and incentive updates for
              communities you follow (via our email provider, Resend)</li>
            <li>Analyze usage trends to improve the Site and user experience</li>
            <li>Respond to your inquiries and provide customer support</li>
            <li>Detect and prevent fraud, abuse, or security incidents</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong> sell, rent, or share your personal information with third parties for marketing purposes.</p>
        </section>

        {/* Cookies and Tracking */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">3. Cookies and Tracking Technologies</h2>
          <p className="mb-3">
            We use cookies and similar tracking technologies for the following purposes:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>
              <span className="font-semibold text-stone-700">Essential Cookies:</span> Required for
              authentication and session management (set by Supabase).
            </li>
            <li>
              <span className="font-semibold text-stone-700">Analytics Cookies:</span> Used by Google Analytics
              to understand how visitors interact with the Site. These cookies collect information in an
              aggregated form.
            </li>
          </ul>
          <p>
            You can control cookie preferences through your browser settings. Disabling essential cookies may
            prevent you from using certain features of the Site, such as signing in.
          </p>
        </section>

        {/* Email Communications */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">4. Email Communications</h2>
          <p className="mb-3">
            We use Resend as our transactional email service provider. We may send you emails for the following
            purposes:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Account verification and password reset</li>
            <li>Price change alerts for listings you are tracking</li>
            <li>New listing notifications for communities you follow</li>
            <li>Builder incentive updates relevant to your preferences</li>
          </ul>
          <p>
            You may opt out of non-essential email notifications at any time by adjusting your notification
            preferences in your account settings or by contacting us at{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.
          </p>
        </section>

        {/* Third-Party Services */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">5. Third-Party Services</h2>
          <p className="mb-3">We integrate with the following third-party services:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <span className="font-semibold text-stone-700">Supabase:</span> Authentication and database
              hosting. Subject to{" "}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer"
                className="text-amber-600 hover:underline">Supabase&apos;s Privacy Policy</a>.
            </li>
            <li>
              <span className="font-semibold text-stone-700">Google Analytics:</span> Website analytics and
              usage tracking. Subject to{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer"
                className="text-amber-600 hover:underline">Google&apos;s Privacy Policy</a>.
            </li>
            <li>
              <span className="font-semibold text-stone-700">Google OAuth:</span> Sign-in via Google account.
              Subject to Google&apos;s Privacy Policy.
            </li>
            <li>
              <span className="font-semibold text-stone-700">Resend:</span> Email delivery. Subject to{" "}
              <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer"
                className="text-amber-600 hover:underline">Resend&apos;s Privacy Policy</a>.
            </li>
          </ul>
        </section>

        {/* Data Retention */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">6. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as needed to provide you
            with our services. If you delete your account, we will remove your personal information within 30
            days, except where retention is required by law or for legitimate business purposes such as fraud
            prevention.
          </p>
        </section>

        {/* Data Security */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">7. Data Security</h2>
          <p>
            We implement industry-standard security measures to protect your personal information, including
            encrypted connections (TLS/SSL), secure authentication via Supabase, and access controls on our
            infrastructure. However, no method of transmission over the internet or electronic storage is 100%
            secure, and we cannot guarantee absolute security.
          </p>
        </section>

        {/* Your Rights */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">8. Your Rights</h2>
          <p className="mb-3">Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your personal data</li>
            <li>Object to or restrict certain processing of your data</li>
            <li>Data portability (receive your data in a structured format)</li>
          </ul>
          <p>
            To exercise any of these rights, please contact us at{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.
            We will respond to your request within 30 days.
          </p>
        </section>

        {/* California Residents */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">9. California Residents</h2>
          <p>
            If you are a California resident, you may have additional rights under the California Consumer
            Privacy Act (CCPA). We do not sell your personal information. You may request disclosure of the
            categories and specific pieces of personal information we have collected, and you may request
            deletion of your personal information. To exercise these rights, contact us at{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.
          </p>
        </section>

        {/* Children's Privacy */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">10. Children&apos;s Privacy</h2>
          <p>
            The Site is not intended for children under the age of 13. We do not knowingly collect personal
            information from children under 13. If we learn that we have collected information from a child under
            13, we will promptly delete it.
          </p>
        </section>

        {/* Changes */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">11. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any material changes by
            posting the updated policy on this page and updating the &quot;Last Updated&quot; date above. Your
            continued use of the Site after such changes constitutes acceptance of the revised policy.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">12. Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy, please contact us at:{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>
          </p>
        </section>
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between text-xs text-stone-400">
        <Link href="/" className="hover:text-amber-600 transition-colors">&larr; Back to Home</Link>
        <div className="flex gap-4">
          <Link href="/terms" className="hover:text-amber-600 transition-colors">Terms of Use</Link>
          <Link href="/accuracy" className="hover:text-amber-600 transition-colors">Accuracy Disclosure</Link>
        </div>
      </div>
    </div>
  )
}
