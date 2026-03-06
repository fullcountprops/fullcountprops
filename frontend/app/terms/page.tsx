import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'Terms of use for FullCountProps.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Terms of Use</h1>
        <div className="prose prose-invert prose-slate max-w-none text-slate-300 space-y-4 text-sm leading-relaxed">
          <p>Last updated: March 2, 2026</p>
          <h2 className="text-lg font-semibold text-white mt-8">1. Acceptance</h2>
          <p>
            By using FullCountProps (&quot;the Service&quot;), you agree to these terms. If you
            do not agree, do not use the Service.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">2. Description of Service</h2>
          <p>
            FullCountProps provides analytical tools and statistical projections for MLB
            player prop bets using Monte Carlo simulation. The Service is provided
            for entertainment and informational purposes only.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">3. Not Gambling Advice</h2>
          <p>
            Nothing on this site constitutes financial, investment, or gambling
            advice. Past model performance does not guarantee future results. Sports
            betting involves risk and the potential to lose money. You are solely
            responsible for your own betting decisions. Please bet responsibly and in
            accordance with the laws of your jurisdiction.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">4. Subscriptions</h2>
          <p>
            Paid subscriptions are billed monthly through Stripe. You may cancel at
            any time from your account settings. Cancellation takes effect at the end
            of the current billing period. No refunds for partial months.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">5. Limitation of Liability</h2>
          <p>
            FullCountProps and its creators shall not be liable for any losses arising
            from the use of projections, picks, or any other information provided by
            the Service. Use at your own risk.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">6. Changes</h2>
          <p>
            We may update these terms from time to time. Continued use of the Service
            constitutes acceptance of updated terms.
          </p>
        </div>
      </div>
    </div>
  )
}
