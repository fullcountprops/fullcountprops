// frontend/app/login/page.tsx
import { Suspense } from 'react';
import type { Metadata } from 'next';
import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Log In — FullCountProps',
  description: 'Sign in to your FullCountProps account to access MLB prop analytics.',
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginClient />
    </Suspense>
  );
}
