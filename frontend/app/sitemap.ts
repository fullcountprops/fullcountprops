import { MetadataRoute } from 'next'

const SITE_URL = 'https://www.fullcountprops.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    '',
    '/edges',
    '/props',
    '/projections',
    '/players',
    '/methodology',
    '/faq',
    '/accuracy',
    '/subscribe',
    '/compare',
    '/park-factors',
    '/pitchers/preview',
    '/matchups',
    '/most-likely',
    '/trends',
    '/best-bets',
    '/newsletter',
    '/terms',
    '/privacy',
  ]

  return staticPages.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === '' ? 'daily' : path === '/edges' || path === '/props' ? 'daily' : 'weekly',
    priority: path === '' ? 1.0 : path === '/edges' ? 0.9 : path === '/methodology' ? 0.8 : 0.7,
  }))
}
