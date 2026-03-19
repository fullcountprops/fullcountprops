'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getPublicClient } from '@/app/lib/supabase'
import type { User } from '@supabase/supabase-js'

// Nav structure: 3 grouped categories + standalone Subscribe CTA
// Reduces 10 flat links → 3 dropdowns (Hick's Law optimization)
interface NavGroup {
  label: string
  items: { href: string; label: string; desc: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { href: '/edges', label: 'Edges', desc: 'Props with 3%+ mathematical edge' },
      { href: '/most-likely', label: 'Most Likely', desc: 'Highest-probability outcomes' },
      { href: '/trends', label: 'Trends', desc: 'Line movement & model shifts' },
    ],
  },
  {
    label: 'Research',
    items: [
      { href: '/pitchers/preview', label: 'Pitcher Preview', desc: 'Matchup-adjusted K projections' },
      { href: '/matchups', label: 'Matchup Tool', desc: 'Batter vs. pitcher breakdowns' },
      { href: '/park-factors', label: 'Park Factors', desc: 'Venue-adjusted stat modifiers' },
      { href: '/compare', label: 'Compare', desc: 'Side-by-side prop analysis' },
    ],
  },
  {
    label: 'Transparency',
    items: [
      { href: '/accuracy', label: 'Accuracy', desc: 'Nightly graded results & calibration' },
      { href: '/methodology', label: 'Methodology', desc: 'LightGBM + Monte Carlo pipeline' },
      { href: '/faq', label: 'FAQ', desc: 'Common questions answered' },
    ],
  },
]

// All link hrefs flattened for active-state matching
const ALL_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))

// Desktop dropdown component
function DesktopDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const hasActive = group.items.some((i) => pathname === i.href)

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setOpen(true)
  }
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }

  // Close on route change
  useEffect(() => { setOpen(false) }, [pathname])

  return (
    <div ref={ref} className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className={`flex items-center gap-1 text-sm transition-colors ${
          hasActive ? 'text-white font-medium' : 'text-slate-400 hover:text-slate-100'
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {group.label}
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 z-50">
          <div className="bg-slate-900 border border-slate-700/50 rounded-lg shadow-xl shadow-black/30 min-w-[240px] py-1.5 overflow-hidden">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-2.5 transition-colors ${
                  pathname === item.href
                    ? 'bg-slate-800/60 text-white'
                    : 'text-slate-300 hover:bg-slate-800/40 hover:text-white'
                }`}
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{item.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Mobile accordion section
function MobileSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const hasActive = group.items.some((i) => pathname === i.href)
  const [open, setOpen] = useState(hasActive)

  return (
    <div className="border-b border-slate-800/50 last:border-0">
      <button
        className={`flex items-center justify-between w-full py-3 text-left text-base transition-colors ${
          hasActive ? 'text-white font-medium' : 'text-slate-400'
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {group.label}
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-3 pl-3 flex flex-col gap-1">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block py-2 px-3 rounded-md text-sm transition-colors ${
                pathname === item.href
                  ? 'text-white bg-slate-800/50 font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/30'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// User avatar icon
function UserIcon() {
  return (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

// Main Navbar export
export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auth state
  useEffect(() => {
    const supabase = getPublicClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Close dropdown on route change
  useEffect(() => { setDropdownOpen(false) }, [pathname])

  // Close mobile menu on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileOpen(false)
      }
    }
    if (mobileOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mobileOpen])

  // Close dropdown on click outside + Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [dropdownOpen])

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  async function handleSignOut() {
    const supabase = getPublicClient()
    await supabase.auth.signOut()
    setDropdownOpen(false)
    router.push('/')
  }

  // Desktop auth section
  function DesktopAuth() {
    if (loading) return <div className="w-24" />

    if (!user) {
      return (
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-slate-400 hover:text-slate-100 transition-colors"
          >
            Log In
          </Link>
          <Link
            href="/pricing"
            className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            Sign Up
          </Link>
        </div>
      )
    }

    return (
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label="User menu"
          aria-expanded={dropdownOpen}
        >
          <UserIcon />
        </button>
        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden">
            <Link
              href="/account"
              className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Account
            </Link>
            <Link
              href="/pricing"
              className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Pricing
            </Link>
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Log Out
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg tracking-tight hover:text-white transition-colors">
          FullCountProps
        </Link>

        {/* Desktop nav: 3 dropdowns + auth CTA */}
        <div className="hidden lg:flex items-center gap-8">
          {NAV_GROUPS.map((group) => (
            <DesktopDropdown key={group.label} group={group} pathname={pathname} />
          ))}
          <DesktopAuth />
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 text-slate-400 hover:text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile slide-in panel */}
      {mobileOpen && (
        <div className="fixed inset-0 top-14 z-40 bg-black/50 lg:hidden">
          <div
            ref={menuRef}
            className="absolute right-0 top-0 h-full w-72 bg-slate-950 border-l border-slate-800 p-5 overflow-y-auto flex flex-col"
          >
            <div className="flex-1">
              {NAV_GROUPS.map((group) => (
                <MobileSection key={group.label} group={group} pathname={pathname} />
              ))}
            </div>

            {/* Mobile auth footer */}
            {!loading && (
              <div className="mt-5 flex flex-col gap-2">
                {user ? (
                  <>
                    <Link
                      href="/account"
                      className="block text-center px-4 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Account
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="block w-full text-center px-4 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Log Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="block text-center px-4 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Log In
                    </Link>
                    <Link
                      href="/pricing"
                      className="block bg-green-600 hover:bg-green-500 text-white px-4 py-2.5 rounded-lg font-medium text-center text-sm transition-colors"
                    >
                      Sign Up
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
