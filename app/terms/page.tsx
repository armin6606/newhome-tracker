export const metadata = { title: "Terms of Use — NewKey.us" }

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-stone-900 mb-2">Terms of Use</h1>
      <p className="text-stone-500 text-sm mb-10">Last updated: March 2026</p>

      <div className="prose prose-stone max-w-none space-y-8 text-stone-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using NewKey.us ("the Site," "the Service"), you agree to be bound by these
            Terms of Use. If you do not agree, you must immediately stop using the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">2. Description of Service</h2>
          <p>
            NewKey.us is an independent information aggregation platform that collects and displays
            publicly available data about new construction homes from homebuilder websites.
            NewKey.us is <strong>not</strong> a real estate broker, agent, builder, or affiliated with
            any homebuilder. We do not facilitate real estate transactions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">3. No Real Estate Advice</h2>
          <p>
            Nothing on NewKey.us constitutes real estate, financial, legal, or investment advice.
            All information is provided for general informational purposes only. You should consult
            a licensed real estate professional before making any real estate decisions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">4. Data Accuracy Disclaimer</h2>
          <p>
            NewKey.us makes no representations or warranties, express or implied, regarding the
            accuracy, completeness, timeliness, or reliability of any listing data displayed on the Site.
            Prices, availability, floor plans, and all other listing details are subject to change
            without notice. <strong>Always verify information directly with the homebuilder before
            making any decisions.</strong> See our full <a href="/data-accuracy" className="text-amber-600 hover:underline">Data Accuracy Policy</a> for details.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">5. Intellectual Property</h2>
          <p>
            The NewKey.us platform, including its design, code, and original content, is owned by
            NewKey.us. Listing data is aggregated from public sources and remains the property of
            the respective homebuilders. You may not reproduce, distribute, or commercially exploit
            any content from this Site without written permission.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">6. Prohibited Uses</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Scrape, crawl, or systematically extract data from NewKey.us without permission</li>
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to interfere with the Site's operation or security</li>
            <li>Misrepresent yourself or your affiliation with any entity</li>
            <li>Use the Service to compete with NewKey.us commercially</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">7. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEWKEY.US AND ITS OPERATORS SHALL NOT BE
            LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
            DAMAGES ARISING FROM YOUR USE OF, OR INABILITY TO USE, THE SERVICE OR ANY INFORMATION
            OBTAINED THROUGH IT, INCLUDING BUT NOT LIMITED TO RELIANCE ON LISTING DATA, PRICES,
            OR AVAILABILITY.
          </p>
          <p className="mt-3">
            YOUR USE OF THE SERVICE IS AT YOUR SOLE RISK. THE SERVICE IS PROVIDED "AS IS" AND
            "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">8. Third-Party Links</h2>
          <p>
            The Site contains links to homebuilder websites. NewKey.us has no control over and
            assumes no responsibility for the content, accuracy, or practices of any third-party sites.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">9. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the State of California, without regard to
            conflict of law principles. Any disputes shall be resolved in the courts of
            Orange County, California.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">10. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. Continued use of the Service
            after changes constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">11. Contact</h2>
          <p>Questions? Email <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.</p>
        </section>

      </div>
    </div>
  )
}
