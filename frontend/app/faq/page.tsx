import { Metadata } from 'next'
import FAQClient from './FAQClient'

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Frequently asked questions about BaselineMLB: what props we cover, how picks update, what edge % means, free vs paid plans, and our accuracy track record.',
  openGraph: {
    title: 'FAQ — BaselineMLB',
    description:
      'Everything you need to know about BaselineMLB prop analytics.',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FAQ — BaselineMLB',
    description:
      'What props we cover, how picks update, what edge % means, and more.',
    images: ['/og-image.png'],
  },
}

function FAQJsonLd() {
  const faqItems = [
    {
      question: 'What player props does BaselineMLB cover?',
      answer:
        'We cover six prop types: strikeouts (K), hits (H), total bases (TB), RBIs, walks (BB), and runs scored (R). Pitcher strikeout props are our strongest suit.',
    },
    {
      question: 'How often do picks update?',
      answer:
        'Picks run twice daily during the MLB season: 10:30 AM ET (morning run with probable pitchers) and 4:30 PM ET (afternoon refresh with confirmed lineups, final umpire assignments, and real-time weather).',
    },
    {
      question: 'What does edge % mean?',
      answer:
        'Edge is the difference between our simulated probability and the sportsbook no-vig implied probability for a prop. A +6.4% edge means our model believes this outcome happens 6.4 percentage points more often than the market price implies.',
    },
    {
      question: 'What do I get for free?',
      answer:
        'Free users get the top 3 edges per day with direction and grade, daily slate overview, basic accuracy stats, and full methodology documentation.',
    },
    {
      question: 'What is your accuracy track record?',
      answer:
        'In backtesting on the 2024 season (12,847 graded props), the model achieved 3.1% calibration error (ECE) and +8.7% ROI at the 4% edge threshold. When we predict 60% probability, actual hit rate was approximately 58-62%.',
    },
    {
      question: 'Is BaselineMLB open source?',
      answer:
        'Yes. The entire codebase — simulation engine, matchup model, data pipelines, and frontend — is available on GitHub at github.com/nrlefty5/baselinemlb.',
    },
  ]

  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default function FAQPage() {
  return (
    <>
      <FAQJsonLd />
      <FAQClient />
    </>
  )
}
