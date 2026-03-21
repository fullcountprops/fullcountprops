import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy policy for FullCountProps.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Privacy Policy</h1>
        <div className="prose prose-invert prose-slate max-w-none text-slate-300 space-y-4 text-sm leading-relaxed">
          <p>Last updated: March 22, 2026</p>
          <h2 className="text-lg font-semibold text-white mt-8">1. Information We Collect</h2>
          <p>
            When you sign up for the waitlist or subscribe, we collect your email
            address. For paid subscriptions, Stripe handles payment processing — we
            do not store credit card numbers.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">2. How We Use Your Information</h2>
          <p>
            We use your email address to send you daily pick digests, product
            updates, and occasional announcements. We never sell or share your email
            with third parties.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">3. Data Storage</h2>
          <p>
            Email addresses are stored securely in Supabase with row-level security
            enabled. Subscription data is managed by Stripe.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">4. Cookies</h2>
          <p>
            We use minimal cookies for essential site functionality. We do not use
            tracking cookies or third-party analytics.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">5. Unsubscribe</h2>
          <p>
            You can unsubscribe from emails at any time by clicking the unsubscribe
            link in any email or by contacting us.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">6. Changes</h2>
          <p>
            We may update this policy from time to time. Changes will be posted on
            this page.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">7. Your Rights</h2>
          <p>
            You may request deletion of your account and associated data by emailing
            grant@fullcountprops.com. We will process your request within 30 days.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">8. Third-Party Services</h2>
          <p>
            We use the following third-party services: Stripe (payment processing),
            Supabase (data storage), Resend (transactional email), and Vercel (hosting).
            Each has its own privacy policy governing data they process on our behalf.
          </p>
          <h2 className="text-lg font-semibold text-white mt-8">9. Jurisdiction</h2>
          <p>
            FullCountProps is operated from the United States. Users are responsible
            for compliance with the laws of their own jurisdiction, including any
            restrictions on sports betting tools or analytics.
          </p>
        </div>
      </div>
    </div>
  )
}
