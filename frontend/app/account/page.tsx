// frontend/app/account/page.tsx
import { Suspense } from 'react';
import type { Metadata } from 'next';
import AccountClient from './AccountClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account — FullCountProps',
  description: 'Manage your FullCountProps account and subscription.',
};

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <AccountClient />
    </Suspense>
  );
}
