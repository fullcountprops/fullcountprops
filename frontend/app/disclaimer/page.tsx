import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'Disclaimer for FullCountProps.',
}

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Disclaimer</h1>
        <div className="prose prose-invert prose-slate max-w-none text-slate-300 space-y-4 text-sm leading-relaxed">
          <p>Last updated: June 2025</p>

          <h2 className="text-lg font-semibold text-white mt-8">1. For Entertainment Purposes Only</h2>
          <p>
            FullCountProps is a sports analytics platform that provides statistical projections
            and analytical tools for informational and entertainment purposes only. Nothing on
            this site constitutes financial, investment, or gambling advice.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">2. No Guarantee of Results</h2>
          <p>
            Past model performance does not guarantee future results. Sports betting involves
            risk and the potential to lose money. All projections are based on statistical
            models and Monte Carlo simulations, which are inherently probabilistic.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">3. Responsible Gambling</h2>
          <p>
            You must be 21 years of age or older to use this service. If you or someone you
            know has a gambling problem, please call the National Problem Gambling Helpline
            at 1-800-GAMBLER (1-800-426-2537). You can also visit{' '}
            <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
              ncpgambling.org
            </a>{' '}
            for resources and support.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">4. Your Responsibility</h2>
          <p>
            You are solely responsible for your own betting decisions. Please bet responsibly
            and in accordance with the laws of your jurisdiction. FullCountProps does not
            facilitate, process, or handle any wagers.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">5. Data Accuracy</h2>
          <p>
            While we strive for accuracy, FullCountProps makes no warranties regarding the
            completeness or accuracy of any data, projections, or analysis provided. Data
            sources include publicly available MLB statistics and Statcast data.
          </p>

          <h2 className="text-lg font-semibold text-white mt-8">6. Limitation of Liability</h2>
          <p>
            FullCountProps and its creators shall not be liable for any losses arising from
            the use of projections, picks, or any other information provided by the Service.
            Use at your own risk.
          </p>
        </div>
      </div>
    </div>
  )
}
