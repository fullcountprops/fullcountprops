// ==============================================================
// HeroPickCard.tsx
// ==============================================================
// Place at: frontend/app/components/HeroPickCard.tsx
//
// Wrapper component that:
//   - Pre-season: renders the hardcoded Corbin Burnes sample card
//   - Post-Opening Day: fetches and renders the live top edge
//
// USAGE in page.tsx:
//   import { HeroPickCard } from './components/HeroPickCard';
//   <HeroPickCard />
// ==============================================================

import { Suspense } from 'react';
import { TopEdgeCard } from './TopEdgeCard';

const OPENING_DAY = new Date('2026-03-27T00:00:00-04:00');

// =================================================================
// SamplePickCard — your existing hardcoded Corbin Burnes card.
//
// IMPORTANT: Copy your EXACT existing JSX from page.tsx into this
// function. Below is a recreation based on what I saw on the live
// site — but match your actual code exactly (classNames, structure).
// =================================================================
function SamplePickCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="rounded-full border border-green-400/30 bg-green-400/10 px-2.5 py-0.5 text-xs font-semibold text-green-400">
          HIGH
        </span>
        <span className="text-xs text-slate-500">Today 7:10 PM ET</span>
      </div>

      {/* Edge badge */}
      <div className="mt-2">
        <span className="text-sm font-bold text-green-400">+9.2% edge</span>
      </div>

      {/* Player + matchup */}
      <div className="mt-3">
        <div className="text-lg font-semibold text-white">Corbin Burnes</div>
        <p className="mt-0.5 text-sm text-slate-500">
          BAL vs NYY · Yankee Stadium
        </p>
      </div>

      {/* Prop line */}
      <div className="mt-4">
        <span className="text-xl font-bold text-white">O 6.5 Ks</span>
        <span className="ml-2 text-sm text-slate-500">-115 DraftKings</span>
      </div>

      {/* Factor breakdown */}
      <div className="mt-4 space-y-1.5 border-t border-slate-800 pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Factor Breakdown
        </p>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Base matchup K rate</span>
          <span className="text-slate-300">26.3%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Park K factor</span>
          <span className="text-green-400">+1.4pp</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Umpire tendency</span>
          <span className="text-green-400">+2.2pp</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Catcher framing</span>
          <span className="text-green-400">+3.0pp</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-slate-800 pt-4">
        <div>
          <p className="text-xs text-slate-500">Sim mean</p>
          <p className="text-sm font-semibold text-white">6.8 Ks</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">P(Over)</p>
          <p className="text-sm font-semibold text-white">60.7%</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Book implied</p>
          <p className="text-sm font-semibold text-white">54.3%</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Kelly</p>
          <p className="text-sm font-semibold text-white">2.4%</p>
        </div>
      </div>

      {/* Sample badge */}
      <p className="mt-4 text-xs text-slate-600">
        Sample pick · Not real-time data
      </p>
    </div>
  );
}

// Loading skeleton while TopEdgeCard fetches
function PickCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex items-center justify-between">
        <div className="h-5 w-14 rounded-full bg-slate-800" />
        <div className="h-4 w-24 rounded bg-slate-800" />
      </div>
      <div className="mt-3 h-6 w-48 rounded bg-slate-800" />
      <div className="mt-2 h-4 w-36 rounded bg-slate-800" />
      <div className="mt-4 h-8 w-32 rounded bg-slate-800" />
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-800 pt-4">
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
      </div>
    </div>
  );
}

export function HeroPickCard() {
  const isPreSeason = new Date() < OPENING_DAY;

  if (isPreSeason) {
    return <SamplePickCard />;
  }

  return (
    <Suspense fallback={<PickCardSkeleton />}>
      {/* @ts-expect-error Async Server Component */}
      <TopEdgeCard />
    </Suspense>
  );
}
