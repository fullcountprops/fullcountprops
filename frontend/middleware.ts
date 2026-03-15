// frontend/middleware.ts
// ============================================================
// FullCountProps — Middleware
//
// Subscription gate: checks auth session + subscription tier
// for subscriber-gated routes. Free users see limited content
// on /edges (top 3 with blurred cards). Paid users get full access.
//
// Routes gated by this middleware:
//   /edges       — accessible to all, but tier info passed via header
//   /players/*   — accessible to all, tier info passed via header
//   /best-bets   — requires Double-A+
//   /simulator   — requires Triple-A+
//   /api-keys    — requires The Show
// ============================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  // Supabase stores auth in a cookie named sb-<project-ref>-auth-token
  // The cookie value is a base64-encoded JSON with access_token
  const cookies = request.cookies;

  // Find the Supabase auth cookie
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
    // The cookie may be a JSON array [access_token, refresh_token] or
    // a base64url-encoded JSON with access_token field
    let accessToken: string | undefined;

    // Try parsing as JSON first (Supabase v2 stores as base64 JSON)
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

    // Decode JWT payload (second segment)
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return { tier: 'single_a', isAuthenticated: false };
    }

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

    // Check expiration
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ---- Skip: API routes, static files, Next.js internals ----
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // ---- Public routes — no tier check needed ----
  const publicPaths = [
    '/',
    '/compare',
    '/methodology',
    '/faq',
    '/accuracy',
    '/subscribe',
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
  ];

  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // ---- Extract user tier from JWT cookie ----
  const { tier, isAuthenticated } = getUserTierFromCookies(request);

  // ---- Tier-gated routes: redirect if tier too low ----
  for (const route of TIER_GATED_ROUTES) {
    if (pathname === route.path || pathname.startsWith(route.path + '/')) {
      if (!isAuthenticated) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
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
    // Pass tier to the page via a request header (readable in server components)
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-subscription-tier', tier);
    requestHeaders.set('x-is-authenticated', isAuthenticated ? '1' : '0');

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // ---- All other routes: pass through ----
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
