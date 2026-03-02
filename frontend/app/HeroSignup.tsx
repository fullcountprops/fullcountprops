'use client'

import { useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function HeroSignup() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      setMessage('Please enter a valid email address.')
      setStatus('error')
      return
    }

    setStatus('loading')
    setMessage('')

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setStatus('success')
        setMessage("You're in! We'll send you picks before Opening Day.")
        setEmail('')
      } else {
        const data = await res.json().catch(() => ({}))
        setStatus('error')
        setMessage(data.error || 'Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setMessage('Network error. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex items-center gap-3 p-4 bg-green-900/30 border border-green-700 rounded-xl max-w-md">
        <span className="text-green-400 text-xl">&#10003;</span>
        <p className="text-green-300 text-sm">{message}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={status === 'loading'}
          className="flex-1 min-w-0 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-6 py-3 font-semibold bg-green-600 hover:bg-green-500 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {status === 'loading' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Joining...
            </span>
          ) : (
            'Join Waitlist'
          )}
        </button>
      </div>
      {status === 'error' && message && (
        <p className="text-red-400 text-xs mt-2">{message}</p>
      )}
      <p className="text-slate-600 text-xs mt-2">
        Free picks daily. No spam, unsubscribe anytime.
      </p>
    </form>
  )
}
