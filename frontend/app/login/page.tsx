// frontend/app/login/page.tsx
import type { Metadata } from 'next';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Log In — FullCountProps',
  description: 'Sign in to your FullCountProps account to access MLB prop analytics.',
};

export default function LoginPage() {
  return <LoginClient />;
}
