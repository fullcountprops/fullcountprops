'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/app/lib/supabase-browser';

const ADMIN_EMAIL = 'grantlescallett.work@gmail.com';

const quickLinks = [
  { name: 'GitHub Actions', url: 'https://github.com/fullcountprops/fullcountprops/actions' },
  { name: 'Stripe', url: 'https://dashboard.stripe.com' },
  { name: 'Supabase', url: 'https://supabase.com/dashboard' },
  { name: 'Vercel', url: 'https://vercel.com/dashboard' },
  { name: 'Sentry', url: 'https://full-count-props.sentry.io' },
  { name: 'Discord', url: 'https://discord.com/channels/@me' },
  { name: 'Linear', url: 'https://linear.app/fullcountprops' },
  { name: 'Resend', url: 'https://resend.com/emails' },
  { name: 'The Odds API', url: 'https://the-odds-api.com/account' },
];

export default function AdminPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login?redirect=/admin'); return; }
      if (user.email !== ADMIN_EMAIL) { router.push('/'); return; }
      setUserEmail(user.email);
      setLoading(false);
    }
    checkAuth();
  }, [supabase, router]);

  if (loading) {
    return (<div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="text-slate-400">Loading admin...</div></div>);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div><h1 className="text-2xl font-bold">FCP Admin</h1><p className="text-sm text-slate-400 mt-1">{userEmail}</p></div>
          <a href="/" className="text-sm text-slate-400 hover:text-white transition-colors">Back to site</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Model Health</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Algorithm</span><span>LightGBM</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Features</span><span>41</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Training PAs</span><span>~990K (2020-2025)</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Sims/Game</span><span>5,000</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Outcome Classes</span><span>8</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Trees</span><span>6,400</span></div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Pipeline Schedule (ET)</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">7:00 AM</span><span>Pre-market refresh</span></div>
              <div className="flex justify-between"><span className="text-slate-400">8:00 AM</span><span>Games + rosters</span></div>
              <div className="flex justify-between"><span className="text-slate-400">10:30 AM</span><span>Lineups + projections</span></div>
              <div className="flex justify-between"><span className="text-slate-400">~10:45 AM</span><span>Twitter + newsletter</span></div>
              <div className="flex justify-between"><span className="text-slate-400">4:30 PM</span><span>Afternoon refresh</span></div>
              <div className="flex justify-between"><span className="text-slate-400">2:00 AM</span><span>Grading + Statcast</span></div>
            </div>
            <a href="https://github.com/fullcountprops/fullcountprops/actions" target="_blank" rel="noopener noreferrer" className="block mt-3 text-center text-sm text-green-400 hover:text-green-300">View GitHub Actions</a>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Links</h2>
            <div className="grid grid-cols-2 gap-2">
              {quickLinks.map((link) => (<a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-300 hover:text-green-400 transition-colors py-1">{link.name}</a>))}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Revenue</h2>
            <p className="text-sm text-slate-500 mb-3">Live data post-launch</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Founding ($4.99)</span><span className="text-slate-500">-</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Double-A ($7.99)</span><span className="text-slate-500">-</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Triple-A ($29.99)</span><span className="text-slate-500">-</span></div>
              <div className="flex justify-between"><span className="text-slate-400">The Show ($49.99)</span><span className="text-slate-500">-</span></div>
            </div>
            <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="block mt-3 text-center text-sm text-green-400 hover:text-green-300">View Stripe</a>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Key Reference</h2>
            <div className="space-y-2 text-sm">
              <div><span className="text-slate-400">Founding Price ID</span><br /><code className="text-xs text-green-400">price_1TB8vOCHMWdtVF7LZY7ThWrX</code></div>
              <div><span className="text-slate-400">Double-A Price ID</span><br /><code className="text-xs text-green-400">price_1TBIRyCHMWdtVF7LxSqpG5r7</code></div>
              <div><span className="text-slate-400">Admin Email</span><br /><code className="text-xs text-green-400">grantlescallett.work@gmail.com</code></div>
              <div><span className="text-slate-400">Kill Switch</span><br /><code className="text-xs text-green-400">NEXT_PUBLIC_SHOW_BACKTEST_ONLY=true</code></div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Pre-Launch</h2>
            <div className="space-y-1.5 text-sm">
              <div className="text-green-400">✓ Model wired into simulator</div>
              <div className="text-green-400">✓ Pipeline dry run passed</div>
              <div className="text-green-400">✓ Stripe checkout validated</div>
              <div className="text-green-400">✓ 285/285 tests passing</div>
              <div className="text-green-400">✓ Twitter API live</div>
              <div className="text-green-400">✓ Discord alerts wired</div>
              <div className="text-slate-400">○ Real-phone mobile test</div>
              <div className="text-slate-400">○ EIN + bank account</div>
              <div className="text-slate-400">○ War room rehearsal</div>
              <div className="text-slate-400">○ Code freeze (Mar 25)</div>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-600 text-center mt-8">Opening Day: March 26, 2026 | Code Freeze: March 25</p>
      </div>
    </div>
  );
}
