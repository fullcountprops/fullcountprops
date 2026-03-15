// frontend/app/signup/page.tsx
import type { Metadata } from 'next';
import LoginClient from '../login/LoginClient';

export const metadata: Metadata = {
  title: 'Sign Up — FullCountProps',
  description: 'Create your FullCountProps account to access MLB prop analytics.',
};

export default function SignupPage() {
  return <LoginClient defaultView="sign_up" />;
}
