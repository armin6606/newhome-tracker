import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Accuracy Disclosure",
  description: "NewKey.us data accuracy disclosure — important information about the sources and limitations of our listing data.",
}

export default function AccuracyDisclosurePage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-amber-600 text-xs font-semibold uppercase tracking-widest mb-1.5">Legal</p>
        <h1 className="text-3xl font-bold text-stone-800 mb-2">Accuracy Disclosure</h1>
        <p className="text-sm text-stone-400">Effective Date: January 1, 2025 &middot; Last Updated: March 20, 2026</p>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-6 sm:px-8 py-8 space-y-8 text-stone-600 text-sm leading-relaxed">

        {/* Important Notice */}
        <section>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 text-amber-800">
            <p className="font-bold text-base mb-2">Important Notice</p>
            <p>
              NewKey.us is an independent data aggregation service. We are not a real estate broker, agent,
              appraiser, or builder. The information on this Site is for general informational purposes only
              and should not be relied upon as the sole basis for any real estate purchasing decision. Always
              verify all information directly with the homebuilder before making any commitments.
            </p>
          </div>
        </section>

        {/* Data Sources */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">1. Data Sources</h2>
          <p className="mb-3">
            All listing data displayed on NewKey.us is sourced from publicly available homebuilder websites.
            Our automated systems periodically visit builder websites to collect and organize information
            including, but not limited to:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Home prices and pricing history</li>
            <li>Floor plan names, square footage, bedroom and bathroom counts</li>
            <li>Community names and locations</li>
            <li>Move-in dates and estimated completion timelines</li>
            <li>Builder incentives, promotions, and special offers</li>
            <li>Lot availability and home status (e.g., available, model, sold)</li>
          </ul>
        </section>

        {/* Pricing Information */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">2. Pricing Information</h2>
          <p className="mb-3">
            Prices displayed on the Site reflect the information available on builder websites at the time of
            our most recent data collection. You should be aware that:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Prices are subject to change at any time without notice by the builder</li>
            <li>Displayed prices may not include lot premiums, upgrades, options, HOA fees, Mello-Roos taxes,
              closing costs, or other additional charges</li>
            <li>There may be a delay between when a builder updates their pricing and when our systems reflect
              that change</li>
            <li>Price history shown on the Site reflects only the prices we have observed and recorded; actual
              price changes may have occurred between our data collection intervals</li>
            <li>&quot;Base price&quot; figures typically do not include structural options or design upgrades
              that may be included in a specific home</li>
          </ul>
        </section>

        {/* Incentives and Offers */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">3. Incentives and Special Offers</h2>
          <p className="mb-3">
            Builder incentives and promotions displayed on the Site are sourced from builder websites and
            marketing materials. These offers:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>May expire at any time without notice</li>
            <li>May be subject to terms, conditions, and restrictions not displayed on our Site</li>
            <li>May require the use of a specific lender or financing arrangement</li>
            <li>May not be combinable with other offers</li>
            <li>May vary by community, floor plan, or specific home</li>
            <li>Should always be confirmed directly with the builder&apos;s sales team before relying on them</li>
          </ul>
        </section>

        {/* Availability */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">4. Availability and Status</h2>
          <p>
            Home availability, move-in dates, and construction status displayed on the Site may not reflect
            real-time conditions. Homes shown as &quot;available&quot; may have already been sold, placed under
            contract, or removed from the market. Move-in dates are estimates and are subject to change based
            on construction progress, permitting, and other factors. Always contact the builder directly to
            confirm current availability and timelines.
          </p>
        </section>

        {/* Data Freshness */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">5. Data Freshness and Update Frequency</h2>
          <p className="mb-3">
            Our data collection systems operate on a periodic schedule. The frequency of updates varies by
            builder and data type:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Listing data is typically refreshed daily, but delays may occur due to technical issues or
              changes to builder websites</li>
            <li>Incentive data is collected as frequently as possible, but new promotions or expirations may
              not be immediately reflected</li>
            <li>Community-level data (new community launches or closures) may take longer to appear</li>
          </ul>
          <p>
            If a builder changes their website structure or technology, there may be a temporary disruption in
            our ability to collect data from that builder until our systems are updated.
          </p>
        </section>

        {/* Floor Plans */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">6. Floor Plan and Property Details</h2>
          <p>
            Floor plan specifications (square footage, bedroom/bathroom counts, garage spaces, etc.) are
            sourced from builder websites and may represent approximate or planned values. Actual built homes
            may differ from published specifications. Elevation styles, included features, and available
            options may vary. Always review the builder&apos;s official documentation and visit the model homes
            or sales center for accurate, up-to-date specifications.
          </p>
        </section>

        {/* Analytics and Derived Data */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">7. Analytics and Derived Data</h2>
          <p>
            Some features of the Site display analytics and derived metrics such as sales velocity, price
            trends, days on market, and inventory levels. These calculations are based on our observed data
            and may not perfectly reflect actual market conditions. These metrics are provided for informational
            purposes and should not be used as the sole basis for investment or purchasing decisions. We
            recommend consulting with a licensed real estate professional for market analysis and advice.
          </p>
        </section>

        {/* No Endorsement */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">8. No Endorsement</h2>
          <p>
            The inclusion of any builder, community, or listing on the Site does not constitute an endorsement,
            recommendation, or guarantee by NewKey.us. We do not evaluate the quality of construction, the
            financial stability of builders, the desirability of communities, or the value of any property.
            All such determinations should be made by you with the assistance of qualified professionals.
          </p>
        </section>

        {/* Errors and Corrections */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">9. Reporting Errors</h2>
          <p>
            We strive to provide accurate information but acknowledge that errors may occur in our data
            collection and display processes. If you notice any inaccurate information on the Site, we
            encourage you to report it to us at{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>{" "}
            so we can investigate and correct it promptly.
          </p>
        </section>

        {/* Your Responsibility */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">10. Your Responsibility</h2>
          <p className="mb-3">
            By using this Site, you acknowledge and agree that:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You will independently verify all information with the applicable homebuilder before making
              any purchasing decisions</li>
            <li>You will not rely solely on the data provided by NewKey.us for any real estate transaction</li>
            <li>NewKey.us bears no responsibility for any decisions made based on data displayed on the Site</li>
            <li>You understand that listing data may be outdated, incomplete, or inaccurate at any given time</li>
          </ul>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-3">11. Questions</h2>
          <p>
            If you have questions about our data collection practices or this Accuracy Disclosure, please
            contact us at:{" "}
            <a href="mailto:info@newkey.us" className="text-amber-600 hover:underline">info@newkey.us</a>
          </p>
        </section>
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between text-xs text-stone-400">
        <Link href="/" className="hover:text-amber-600 transition-colors">&larr; Back to Home</Link>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-amber-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-amber-600 transition-colors">Terms of Use</Link>
        </div>
      </div>
    </div>
  )
}
