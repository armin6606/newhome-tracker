import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Data Accuracy Policy",
  description: "Understand the limitations of listing data on NewKey.us. Prices, availability, and details may not be current — always verify with the builder.",
  alternates: { canonical: "https://www.newkey.us/data-accuracy" },
  robots: { index: true, follow: true },
}

export default function DataAccuracyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-stone-900 mb-2">Data Accuracy Policy</h1>
      <p className="text-stone-500 text-sm mb-4">Last updated: March 2026</p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-10">
        <p className="text-amber-900 font-semibold text-base">
          ⚠ Important: All listing data on NewKey.us is for informational purposes only.
          Always verify prices, availability, and all other details directly with the homebuilder
          before making any decisions.
        </p>
      </div>

      <div className="prose prose-stone max-w-none space-y-8 text-stone-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">1. Nature of Our Data</h2>
          <p>
            NewKey.us operates as an independent data aggregation service. We collect and display
            information sourced from publicly available homebuilder websites through automated means.
            We are <strong>not</strong> a homebuilder, real estate broker, or official representative
            of any builder featured on this site.
          </p>
          <p className="mt-3">
            Our data is collected periodically (typically daily) and may not reflect real-time
            changes made by builders.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">2. What May Be Inaccurate</h2>
          <p>The following information is particularly subject to change and may be outdated or incorrect:</p>
          <ul className="list-disc pl-6 mt-2 space-y-2">
            <li><strong>Prices:</strong> Home prices change frequently. A price shown on NewKey.us may not reflect the current asking price. Builders may change prices, add incentives, or remove listings without notice.</li>
            <li><strong>Availability:</strong> A home shown as "active" may already be sold, under contract, or removed from the market. Homes marked "removed" may still be available.</li>
            <li><strong>HOA Fees:</strong> HOA fees are estimates sourced from builder websites or public records. Actual fees may differ and are subject to change.</li>
            <li><strong>Property Taxes:</strong> Tax estimates are calculated using approximate tax rates and may not reflect actual assessed values, special assessments, Mello-Roos, or CFD charges.</li>
            <li><strong>Square Footage &amp; Specifications:</strong> Floor plans, square footage, bed/bath counts, and other specifications are sourced from builder marketing materials and may differ from final construction.</li>
            <li><strong>Move-In Dates:</strong> Estimated completion and move-in dates are subject to construction delays and builder discretion.</li>
            <li><strong>School Information:</strong> School assignments are subject to change. District boundaries shift and school ratings change annually. Verify with the school district.</li>
            <li><strong>Incentives:</strong> Builder incentives, promotions, and financing offers expire and change frequently.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">3. No Warranty</h2>
          <p>
            NEWKEY.US PROVIDES ALL LISTING DATA "AS IS" WITHOUT ANY WARRANTY OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF ACCURACY,
            COMPLETENESS, TIMELINESS, OR FITNESS FOR A PARTICULAR PURPOSE.
          </p>
          <p className="mt-3">
            NewKey.us does not guarantee that information displayed is current, correct, or complete.
            We expressly disclaim any liability for errors, omissions, or inaccuracies in the data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">4. No Liability for Reliance</h2>
          <p>
            UNDER NO CIRCUMSTANCES SHALL NEWKEY.US, ITS OWNERS, OPERATORS, EMPLOYEES, OR
            AFFILIATES BE LIABLE FOR ANY LOSS, DAMAGE, OR HARM — INCLUDING BUT NOT LIMITED TO
            FINANCIAL LOSS, MISSED OPPORTUNITIES, OR DECISIONS MADE IN RELIANCE ON DATA
            DISPLAYED ON THIS SITE.
          </p>
          <p className="mt-3">
            This includes but is not limited to:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Purchasing or attempting to purchase a home based on a price shown on NewKey.us</li>
            <li>Relying on availability information that turns out to be incorrect</li>
            <li>Financial planning based on HOA, tax, or cost estimates from this site</li>
            <li>School enrollment decisions based on school information shown here</li>
            <li>Any other action taken based on information found on this site</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">5. Always Verify with the Builder</h2>
          <p>
            Before making any real estate decision — including but not limited to making an offer,
            signing a purchase agreement, or making a deposit — you must independently verify
            all information directly with the homebuilder's sales team.
          </p>
          <p className="mt-3 font-semibold text-stone-800">
            NewKey.us is a research and intelligence tool, not a source of record.
            The homebuilder is the only authoritative source for current pricing, availability,
            and home specifications.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">6. Reporting Inaccuracies</h2>
          <p>
            If you notice incorrect or outdated information on NewKey.us, we welcome your feedback.
            Please email <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a> with
            details and we will investigate. However, reporting an inaccuracy does not create any
            obligation or liability on our part.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-800 mb-3">7. Contact</h2>
          <p>Questions about our data practices? Email <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>.</p>
        </section>

      </div>
    </div>
  )
}
