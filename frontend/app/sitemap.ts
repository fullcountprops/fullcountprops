// app/sitemap.ts
// ============================================================
// FullCountProps — Auto-generating sitemap for SEO
//
// Next.js will serve this at /sitemap.xml automatically.
// Includes all static pages + dynamically generated player pages.
//
// Submit to Google Search Console after deploying:
//   https://www.fullcountprops.com/sitemap.xml
// ============================================================

import { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://www.fullcountprops.com';

// Initialize Supabase client for fetching player IDs
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ---- Static pages ----
  const staticPages: MetadataRoute.Sitemap = [
    // Core pages — high priority
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/edges`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/props`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/projections`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/players`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    // High-value SEO pages
    {
      url: `${BASE_URL}/methodology`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/accuracy`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/compare`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/best-bets`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/most-likely`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/park-factors`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    // Conversion pages
    {
      url: `${BASE_URL}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/faq`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    // Archive
    {
      url: `${BASE_URL}/newsletter`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.4,
    },
  ];

  // ---- Dynamic player pages ----
  let playerPages: MetadataRoute.Sitemap = [];
  try {
    const supabase = getSupabase();
    const { data: players, error } = await supabase
      .from('players')
      .select('player_id')
      .limit(1500); // Safety limit

    if (!error && players) {
      playerPages = players.map((player) => ({
        url: `${BASE_URL}/players/${player.player_id}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
    }
  } catch {
    // If player fetch fails, sitemap still works with static pages only
    console.warn('Sitemap: failed to fetch player IDs, skipping player pages');
  }

  return [...staticPages, ...playerPages];
}
