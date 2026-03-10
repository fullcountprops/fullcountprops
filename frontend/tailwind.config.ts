import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'fcp-bg': '#0a0e1a',
        'fcp-card': '#111827',
        'fcp-border': '#1f2937',
        'fcp-accent': '#3b82f6',
        'fcp-green': '#10b981',
        'fcp-red': '#ef4444',
        'fcp-yellow': '#f59e0b',
      },
    },
  },
  plugins: [],
}
export default config
