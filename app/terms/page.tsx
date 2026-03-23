import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "NewKey.us terms of use — rules and conditions governing your use of our new home tracking service.",
  alternates: { canonical: "https://www.newkey.us/terms" },
  robots: { index: true, follow: true },
}

export default function TermsOfUsePage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-amber-600 text-xs font-semibold uppercase tracking-widest mb-1.5">Legal</p>
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Terms of Use</h1>
        <p className="text-sm text-stone-400">Effective Date: January 1, 2025 &middot; Last Updated: March 20, 2026</p>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-6 sm:px-8 py-8 space-y-8 text-stone-600 text-sm leading-relaxed">

        {/* Acceptance */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using the NewKey.us website located at{" "}
            <a href="https://www.newkey.us" className="text-amber-600 hover:underline">www.newkey.us</a>{" "}
            (the &quot;Site&quot;), you agree to be bound by these Terms of Use (&quot;Terms&quot;). If you do
            not agree to these Terms, you must not access or use the Site. We reserve the right to modify these
            Terms at any time, and your continued use of the Site constitutes acceptance of any changes.
          </p>
        </section>

        {/* Description of Service */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">2. Description of Service</h2>
          <p>
            NewKey.us is a real estate data aggregation platform that collects and displays publicly available
            information about new construction homes from homebuilder websites. Our services include listing
            aggregation, price tracking, sales velocity analytics, builder incentive tracking, and email
            notifications. The Site is intended for informational purposes only and does not constitute real
            estate advice, appraisals, or endorsements of any builder or property.
          </p>
        </section>

        {/* Data Accuracy Disclaimer */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">3. Data Accuracy Disclaimer</h2>
          <p className="mb-3">
            All listing data, pricing information, floor plan details, incentive offers, and other information
            displayed on the Site is sourced from publicly available homebuilder websites and is provided on an
            &quot;as is&quot; basis. We make no representations or warranties regarding the accuracy,
            completeness, timeliness, or reliability of any data displayed on the Site.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800">
            <p className="font-semibold mb-1">Important:</p>
            <p>
              Prices, availability, incentives, floor plans, and other listing details may change at any time
              without notice. You should always verify all information directly with the homebuilder before
              making any purchasing decisions. See our{" "}
              <Link href="/accuracy" className="text-amber-700 underline hover:text-amber-900">
                Accuracy Disclosure
              </Link>{" "}
              for more details.
            </p>
          </div>
        </section>

        {/* User Accounts */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">4. User Accounts</h2>
          <p className="mb-3">
            Certain features of the Site require you to create an account. When you create an account, you agree
            to:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Provide accurate and complete registration information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Promptly notify us of any unauthorized use of your account</li>
            <li>Accept responsibility for all activity that occurs under your account</li>
          </ul>
          <p className="mt-3">
            We reserve the right to suspend or terminate your account at our sole discretion, with or without
            notice, for any reason, including violation of these Terms.
          </p>
        </section>

        {/* Acceptable Use */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">5. Acceptable Use</h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Use the Site for any unlawful purpose or in violation of any applicable laws or regulations</li>
            <li>Scrape, crawl, or use automated tools to extract data from the Site without our prior written
              consent</li>
            <li>Reproduce, redistribute, sell, or commercially exploit any data, content, or materials obtained
              from the Site</li>
            <li>Attempt to gain unauthorized access to the Site, other user accounts, or our systems</li>
            <li>Interfere with or disrupt the integrity or performance of the Site or its infrastructure</li>
            <li>Upload or transmit viruses, malware, or other harmful code</li>
            <li>Impersonate any person or entity, or falsely state or misrepresent your affiliation with any
              person or entity</li>
            <li>Use the Site to send unsolicited communications or spam</li>
          </ul>
        </section>

        {/* Intellectual Property */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">6. Intellectual Property</h2>
          <p className="mb-3">
            The Site and its original content (excluding data sourced from third-party builder websites),
            features, and functionality are owned by NewKey.us and are protected by applicable intellectual
            property laws. This includes, but is not limited to, the Site&apos;s design, layout, code, logos,
            graphics, and analytics methodologies.
          </p>
          <p>
            Listing data, builder names, community names, and related content displayed on the Site are the
            property of their respective homebuilders and are displayed for informational purposes. Use of
            builder trademarks on this Site does not imply any affiliation with or endorsement by those builders.
          </p>
        </section>

        {/* Third-Party Links */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">7. Third-Party Links and Content</h2>
          <p>
            The Site may contain links to third-party websites, including homebuilder websites. These links are
            provided for your convenience only. We do not control, endorse, or assume responsibility for the
            content, privacy policies, or practices of any third-party websites. You access third-party sites at
            your own risk.
          </p>
        </section>

        {/* Limitation of Liability */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">8. Limitation of Liability</h2>
          <p className="mb-3">
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, NEWKEY.US AND ITS OWNERS, OPERATORS, OFFICERS,
            EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES ARISING FROM OR RELATED TO:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Your use of or inability to use the Site</li>
            <li>Any inaccuracies, errors, or omissions in the data or content displayed on the Site</li>
            <li>Any decisions made based on information obtained from the Site</li>
            <li>Any unauthorized access to or alteration of your account or data</li>
            <li>Any interruption or cessation of service</li>
          </ul>
          <p>
            IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING FROM OR RELATED TO THE SITE
            EXCEED THE AMOUNT YOU HAVE PAID US, IF ANY, IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
          </p>
        </section>

        {/* Disclaimer of Warranties */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">9. Disclaimer of Warranties</h2>
          <p>
            THE SITE AND ALL CONTENT, DATA, AND SERVICES PROVIDED THROUGH IT ARE OFFERED ON AN &quot;AS
            IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
            PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SITE WILL BE UNINTERRUPTED,
            SECURE, OR ERROR-FREE, OR THAT ANY DATA WILL BE ACCURATE OR COMPLETE.
          </p>
        </section>

        {/* Indemnification */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">10. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless NewKey.us and its owners, operators, officers,
            employees, and agents from and against any claims, liabilities, damages, losses, and expenses
            (including reasonable attorneys&apos; fees) arising out of or in connection with your use of the
            Site, your violation of these Terms, or your violation of any rights of any third party.
          </p>
        </section>

        {/* Governing Law */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">11. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the State of
            California, without regard to its conflict of law provisions. Any dispute arising from these Terms
            or your use of the Site shall be resolved exclusively in the state or federal courts located in
            Orange County, California.
          </p>
        </section>

        {/* Termination */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">12. Termination</h2>
          <p>
            We may terminate or suspend your access to the Site immediately, without prior notice or liability,
            for any reason, including if you breach these Terms. Upon termination, your right to use the Site
            will immediately cease. Sections that by their nature should survive termination shall survive,
            including intellectual property, limitation of liability, disclaimer of warranties, and
            indemnification.
          </p>
        </section>

        {/* Severability */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">13. Severability</h2>
          <p>
            If any provision of these Terms is held to be invalid, illegal, or unenforceable, the remaining
            provisions shall continue in full force and effect. The invalid provision shall be modified to the
            minimum extent necessary to make it valid and enforceable.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">14. Contact Us</h2>
          <p>
            If you have questions about these Terms of Use, please contact us at:{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>
          </p>
        </section>
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between text-xs text-stone-400">
        <Link href="/" className="hover:text-amber-600 transition-colors">&larr; Back to Home</Link>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-amber-600 transition-colors">Privacy Policy</Link>
          <Link href="/accuracy" className="hover:text-amber-600 transition-colors">Accuracy Disclosure</Link>
        </div>
      </div>
    </div>
  )
}
