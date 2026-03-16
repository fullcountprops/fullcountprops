// frontend/app/signup/page.tsx
import { Suspense } from 'react';
import type { Metadata } from 'next';
import LoginClient from '../login/LoginClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign Up — FullCountProps',
  description: 'Create your FullCountProps account to access MLB prop analytics.',
};

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginClient defaultView="sign_up" />
    </Suspense>
  );
}
