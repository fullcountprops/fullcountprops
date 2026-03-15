// ===========================================================
// StructuredData.tsx — JSON-LD components for SEO rich snippets
// Import into layout.tsx or individual page files
// ===========================================================

export function HomepageJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'FullCountProps',
    applicationCategory: 'SportsApplication',
    operatingSystem: 'Web',
    url: 'https://www.fullcountprops.com',
    description:
      'MLB prop betting analytics powered by Monte Carlo simulation. 3,000 sims per game, 33 engineered features, glass-box factor breakdowns on every pick.',
    offers: [
      {
        '@type': 'Offer',
        name: 'Free Tier',
        price: '0',
        priceCurrency: 'USD',
        description: 'Top 3 daily edges with full factor breakdowns',
      },
      {
        '@type': 'Offer',
        name: 'Double-A',
        price: '9',
        priceCurrency: 'USD',
        description: 'Full slate access, all prop types, daily email alerts',
      },
      {
        '@type': 'Offer',
        name: 'Triple-A',
        price: '19',
        priceCurrency: 'USD',
        description: 'Everything in Double-A plus SHAP explanations and API access',
      },
      {
        '@type': 'Offer',
        name: 'The Show',
        price: '39',
        priceCurrency: 'USD',
        description: 'Full platform access with CSV export and priority support',
      },
    ],
    creator: {
      '@type': 'Organization',
      name: 'FullCountProps',
      url: 'https://www.fullcountprops.com',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function FaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'How does FullCountProps generate prop predictions?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'We run 3,000 Monte Carlo simulations per game at the plate-appearance level, using 33 Statcast features including park factors, umpire tendencies, and catcher framing data.',
        },
      },
      {
        '@type': 'Question',
        name: 'What prop types does FullCountProps cover?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'We cover 6 MLB player prop types: Strikeouts (K), Hits (H), Total Bases (TB), Home Runs (HR), Walks (BB), and RBIs.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is FullCountProps free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes! The free tier shows the top 3 daily edges with full factor breakdowns. No credit card or signup required. Paid tiers start at $9/mo for full slate access.',
        },
      },
      {
        '@type': 'Question',
        name: 'How accurate are the predictions?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Our 2025 backtest on 11,004 graded props shows +8.7% ROI at the 4% edge threshold with 3.1% calibration error (ECE). All results are publicly graded nightly.',
        },
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function MethodologyJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'FullCountProps Methodology — How We Build MLB Prop Projections',
    description:
      'Technical methodology for MLB prop projections: LightGBM matchup model, PA-level Monte Carlo simulation, and edge detection vs. sportsbook lines.',
    url: 'https://www.fullcountprops.com/methodology',
    author: {
      '@type': 'Organization',
      name: 'FullCountProps',
    },
    publisher: {
      '@type': 'Organization',
      name: 'FullCountProps',
      url: 'https://www.fullcountprops.com',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function AccuracyJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'FullCountProps Accuracy & Calibration — 2025 Backtest Results',
    description:
      'Public accuracy tracking for FullCountProps MLB prop predictions. 11,004 graded props, +8.7% Tier A ROI, 3.1% calibration error.',
    url: 'https://www.fullcountprops.com/accuracy',
    author: {
      '@type': 'Organization',
      name: 'FullCountProps',
    },
    publisher: {
      '@type': 'Organization',
      name: 'FullCountProps',
      url: 'https://www.fullcountprops.com',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
