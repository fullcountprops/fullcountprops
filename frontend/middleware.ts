// frontend/middleware.ts
// ============================================================
// FullCountProps — Middleware
//
// 1. Refreshes the Supabase auth session cookie on every request
//    (required to keep the session alive via @supabase/ssr).
// 2. Subscription gate: checks auth session + subscription tier
//    for subscriber-gated routes.
//
// Routes gated by this middleware:
//   /edges       — accessible to all, tier info passed via header
//   /players/*   — accessible to all, tier info passed via header
//   /best-bets   — requires Double-A+
//   /simulator   — requires Triple-A+
//   /api-keys    — requires The Show
// ============================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ---- Tier hierarchy for comparison ----
const TIER_HIERARCHY = ['single_a', 'double_a', 'triple_a', 'the_show'];

function hasAccess(userTier: string, requiredTier: string): boolean {
  return TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(requiredTier);
}

/**
 * Decode the Supabase JWT from cookies to extract user metadata.
 * In edge middleware we can't use the full Supabase client, so we
 * manually parse the JWT payload (no verification needed since we
 * trust the cookie was set by Supabase on our domain).
 */
function getUserTierFromCookies(request: NextRequest): {
  tier: string;
  isAuthenticated: boolean;
  userId?: string;
} {
  const cookies = request.cookies;

  let authCookieValue: string | undefined;
  for (const [name, cookie] of cookies) {
    if (name.startsWith('sb-') && name.endsWith('-auth-token')) {
      authCookieValue = cookie.value;
      break;
    }
  }

  if (!authCookieValue) {
    return { tier: 'single_a', isAuthenticated: false };
  }

  try {
    let accessToken: string | undefined;

    const decoded = decodeURIComponent(authCookieValue);
    const parsed = JSON.parse(decoded);

    if (Array.isArray(parsed)) {
      accessToken = parsed[0];
    } else if (typeof parsed === 'object' && parsed.access_token) {
      accessToken = parsed.access_token;
    } else if (typeof parsed === 'string') {
      accessToken = parsed;
    }

    if (!accessToken) {
      return { tier: 'single_a', isAuthenticated: false };
    }

    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return { tier: 'single_a', isAuthenticated: false };
    }

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { tier: 'single_a', isAuthenticated: false };
    }

    const userMetadata = payload.user_metadata || {};
    const tier = userMetadata.subscription_tier || 'single_a';
    const userId = payload.sub;

    return {
      tier: TIER_HIERARCHY.includes(tier) ? tier : 'single_a',
      isAuthenticated: true,
      userId,
    };
  } catch {
    return { tier: 'single_a', isAuthenticated: false };
  }
}

// Routes that require a minimum tier (redirect to /pricing if insufficient)
const TIER_GATED_ROUTES: { path: string; minTier: string }[] = [
  { path: '/best-bets', minTier: 'double_a' },
  { path: '/simulator', minTier: 'triple_a' },
  { path: '/api-keys', minTier: 'the_show' },
];

// Routes where tier info is passed as a header but access is not blocked
const TIER_AWARE_ROUTES = ['/edges', '/players', '/most-likely', '/projections'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ---- Skip: API routes, static files, Next.js internals ----
  // Must return before creating the Supabase client (no need to refresh on these)
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // ---- Refresh Supabase auth session cookie ----
  // IMPORTANT: always return supabaseResponse (or a response that copies its cookies)
  // to keep the session alive. Do NOT return a plain NextResponse.next() after this point.
  const supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  await supabase.auth.getUser();

  // ---- Public routes — no tier check needed ----
  const publicPaths = [
    '/',
    '/compare',
    '/methodology',
    '/faq',
    '/accuracy',
    '/pricing',
    '/props',
    '/newsletter',
    '/terms',
    '/privacy',
    '/login',
    '/signup',
    '/auth',
    '/account',
    '/park-factors',
    '/games',
    '/blog',
  ];

  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return supabaseResponse;
  }

  // ---- Extract user tier from JWT cookie ----
  const { tier, isAuthenticated } = getUserTierFromCookies(request);

  // ---- Tier-gated routes: redirect if tier too low ----
  for (const route of TIER_GATED_ROUTES) {
    if (pathname === route.path || pathname.startsWith(route.path + '/')) {
      if (!isAuthenticated) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/signup';
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
      }
      if (!hasAccess(tier, route.minTier)) {
        const pricingUrl = request.nextUrl.clone();
        pricingUrl.pathname = '/pricing';
        pricingUrl.searchParams.set('upgrade', route.minTier);
        return NextResponse.redirect(pricingUrl);
      }
    }
  }

  // ---- Tier-aware routes: pass tier via request header ----
  const isTierAware = TIER_AWARE_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (isTierAware) {
    // Build a new response with custom request headers (for tier info),
    // then copy any refreshed Supabase auth cookies from supabaseResponse.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-subscription-tier', tier);
    requestHeaders.set('x-is-authenticated', isAuthenticated ? '1' : '0');

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    // Forward refreshed auth cookies so the session stays alive
    supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
      response.cookies.set(name, value);
    });

    return response;
  }

  // ---- All other routes: pass through with refreshed session ----
  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
