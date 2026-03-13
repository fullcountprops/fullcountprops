'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV_LINKS = [
  { href: '/edges', label: 'Edges' },
  { href: '/most-likely', label: 'Most Likely' },
  { href: '/trends', label: 'Trends' },
  { href: '/park-factors', label: 'Park Factors' },
  { href: '/pitchers/preview', label: 'Pitchers' },
  { href: '/matchups', label: 'Matchups' },
  { href: '/compare', label: 'Compare' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/faq', label: 'FAQ' },
]

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on route change
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight hover:text-white transition-colors">
          ⚾ FullCountProps
        </Link>

        {/* Desktop links */}
        <div className="hidden lg:flex items-center gap-6 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition-colors ${
                pathname === link.href
                  ? 'text-white font-medium'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/subscribe"
            className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg font-medium transition-colors"
          >
            Subscribe
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 text-slate-400 hover:text-white"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile slide-in */}
      {isOpen && (
        <div className="fixed inset-0 top-14 z-40 bg-black/50 lg:hidden">
          <div
            ref={menuRef}
            className="absolute right-0 top-0 h-full w-72 bg-slate-950 border-l border-slate-800 p-6 overflow-y-auto"
          >
            <div className="flex flex-col gap-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-base py-2 transition-colors ${
                    pathname === link.href
                      ? 'text-white font-medium'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/subscribe"
                className="mt-4 bg-green-600 hover:bg-green-500 text-white px-4 py-2.5 rounded-lg font-medium text-center transition-colors"
              >
                Subscribe
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
