'use client';
// frontend/app/login/LoginClient.tsx
// ============================================================
// Supabase Auth UI login/signup component.
// Supports magic link + email/password. Handles ?redirect= and ?view= params.
// ============================================================

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { getSupabaseBrowserClient } from '@/app/lib/supabase-browser';

interface Props {
  defaultView?: 'sign_in' | 'sign_up';
}

export default function LoginClient({ defaultView = 'sign_in' }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const basePath = searchParams.get('redirect') || '/pricing';
  const plan = searchParams.get('plan');
  const redirectTo = plan ? `${basePath}?plan=${plan}` : basePath;
  const view = (searchParams.get('view') as 'sign_in' | 'sign_up') || defaultView;

  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.push(redirectTo);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, router, redirectTo]);

  const callbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`
      : `/auth/callback?redirect=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold text-white mb-1">FullCountProps</div>
          <div className="text-sm text-slate-400">MLB Prop Analytics</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
          <Auth
            supabaseClient={supabase}
            view={view}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#16a34a',
                    brandAccent: '#15803d',
                    brandButtonText: 'white',
                    defaultButtonBackground: '#1e293b',
                    defaultButtonBackgroundHover: '#334155',
                    defaultButtonBorder: '#334155',
                    defaultButtonText: '#f1f5f9',
                    dividerBackground: '#334155',
                    inputBackground: '#0f172a',
                    inputBorder: '#334155',
                    inputBorderHover: '#475569',
                    inputBorderFocus: '#16a34a',
                    inputText: '#f1f5f9',
                    inputLabelText: '#94a3b8',
                    inputPlaceholder: '#475569',
                    messageText: '#f1f5f9',
                    messageTextDanger: '#f87171',
                    anchorTextColor: '#4ade80',
                    anchorTextHoverColor: '#86efac',
                  },
                },
              },
            }}
            providers={[]}
            redirectTo={callbackUrl}
            magicLink={true}
            localization={{
              variables: {
                sign_in: {
                  email_label: 'Email address',
                  password_label: 'Password',
                  button_label: 'Sign in',
                  loading_button_label: 'Signing in...',
                  link_text: "Don't have an account? Sign up",
                },
                sign_up: {
                  email_label: 'Email address',
                  password_label: 'Create a password',
                  button_label: 'Create account',
                  loading_button_label: 'Creating account...',
                  link_text: 'Already have an account? Sign in',
                },
                magic_link: {
                  email_input_label: 'Email address',
                  button_label: 'Send magic link',
                  loading_button_label: 'Sending...',
                  link_text: 'Send a magic link email',
                },
              },
            }}
          />
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          By signing in you agree to our{' '}
          <a href="/terms" className="underline hover:text-slate-300 transition-colors">
            Terms
          </a>{' '}
          and{' '}
          <a href="/privacy" className="underline hover:text-slate-300 transition-colors">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
