'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const OPENING_DAY = new Date('2026-03-27T00:00:00-04:00');

interface OpeningDaySignupProps {
  source?: string;
  className?: string;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function OpeningDaySignup({
  source = 'opening_day',
  className = '',
}: OpeningDaySignupProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-remove after Opening Day
  if (new Date() >= OPENING_DAY) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = email.trim().toLowerCase();

    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Please enter a valid email address.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const { error } = await supabase
        .from('email_signups')
        .insert({ email: trimmed, source });

      if (error) {
        if (error.code === '23505') {
          // Already signed up — treat as success
          setStatus('success');
          return;
        }
        throw error;
      }

      // Track in GA4
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'email_signup', {
          source,
          event_category: 'conversion',
        });
      }

      setStatus('success');
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className={`rounded-lg border border-green-900/50 bg-green-950/30 p-4 text-center ${className}`}>
        <p className="text-sm font-medium text-green-300">
          You&apos;re in. We&apos;ll email you when Opening Day picks go live.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col sm:flex-row items-center gap-2 ${className}`}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (status === 'error') setStatus('idle');
        }}
        placeholder="your@email.com"
        className="w-full sm:w-64 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        disabled={status === 'loading'}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="w-full sm:w-auto whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {status === 'loading' ? 'Saving...' : 'Notify Me on Opening Day'}
      </button>
      {status === 'error' && errorMsg && (
        <p className="w-full text-xs text-red-400 sm:w-auto">{errorMsg}</p>
      )}
    </form>
  );
}
