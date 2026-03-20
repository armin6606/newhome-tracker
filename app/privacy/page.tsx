import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Learn how NewKey.us collects, uses, and protects your personal information when you use our new construction home tracking platform.",
  alternates: { canonical: "https://www.newkey.us/privacy" },
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-stone-900 mb-2">Privacy Policy</h1>
      <p className="text-stone-500 text-sm mb-10">Last updated: March 2026</p>

      <div className="prose prose-stone max-w-none space-y-8 text-stone-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">1. Information We Collect</h2>
          <p>NewKey.us collects minimal information necessary to operate the service:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li><strong>Usage data:</strong> Pages visited, filters applied, listings viewed — collected anonymously via standard server logs.</li>
            <li><strong>Account data (if applicable):</strong> Email address and name if you create an account or sign in.</li>
            <li><strong>Contact inquiries:</strong> Any information you voluntarily submit via email to info@newkey.us.</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong> collect payment information, Social Security numbers, or any sensitive financial data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">2. How We Use Information</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To operate and improve the NewKey.us platform</li>
            <li>To respond to your inquiries</li>
            <li>To send service-related communications (if you have an account)</li>
            <li>To analyze aggregate usage patterns (no individual tracking)</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong> sell, rent, or share your personal information with third parties for marketing purposes.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">3. Data Sources</h2>
          <p>
            NewKey.us aggregates publicly available information from homebuilder websites. All listing data
            is sourced from public builder websites and is provided for informational purposes only.
            We do not obtain or store any non-public or proprietary builder data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">4. Cookies & Tracking</h2>
          <p>
            NewKey.us may use essential cookies to maintain session state (e.g., saved filters, favorites).
            We do not use third-party advertising cookies or cross-site tracking technologies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">5. Data Retention</h2>
          <p>
            Account data is retained for the duration of your account and deleted upon request.
            Anonymous usage logs are retained for up to 90 days for operational purposes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">6. Your Rights</h2>
          <p>You may request access to, correction of, or deletion of any personal data we hold about you by contacting us at <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">7. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Continued use of NewKey.us after
            changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">8. Contact</h2>
          <p>Questions about this policy? Email us at <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.</p>
        </section>

      </div>
    </div>
  )
}
