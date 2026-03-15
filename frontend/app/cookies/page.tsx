import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: 'Cookie policy for FullCountProps.',
}

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Cookie Policy</h1>
        <div className="prose prose-invert prose-slate max-w-none text-slate-300 space-y-4 text-sm leading-relaxed">
          <p>Last updated: June 2025</p>

          <h2 className="text-lg font-semibold text-white mt-8">1. What Are Cookies</h2>
          <p>
            Cookies are small text files stored on your device when you visit a website.
            They help the site function properly and provide information to site owners.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">2. How We Use Cookies</h2>
          <p>
            FullCountProps uses minimal cookies for essential site functionality only.
            We do not use tracking cookies or third-party advertising cookies.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">3. Essential Cookies</h2>
          <p>
            These cookies are necessary for the website to function. They include session
            cookies for authentication and preference cookies for your settings. These
            cannot be disabled without affecting site functionality.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">4. Analytics</h2>
          <p>
            We use Vercel Analytics and Google Analytics to understand how visitors use
            our site. These tools may use cookies to collect anonymous usage data. No
            personally identifiable information is collected through analytics.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">5. Third-Party Cookies</h2>
          <p>
            Our payment processor (Stripe) may set cookies during the checkout process.
            These are governed by Stripe&apos;s own cookie policy.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">6. Managing Cookies</h2>
          <p>
            You can control and delete cookies through your browser settings. Note that
            disabling essential cookies may affect site functionality. Most browsers allow
            you to refuse or accept cookies, delete existing cookies, and set preferences
            for certain websites.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">7. Changes</h2>
          <p>
            We may update this cookie policy from time to time. Changes will be posted
            on this page.
          </p>
        </div>
      </div>
    </div>
  )
}
