import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = (body.email || '').trim().toLowerCase()

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'A valid email address is required.' },
        { status: 400 }
      )
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      // Supabase not configured — log and return success in dev
      console.warn('[subscribe] Supabase env vars not set, skipping DB write.')
      return NextResponse.json({ ok: true })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Upsert: if email already exists, update subscribed_at
    const { error } = await supabase
      .from('email_subscribers')
      .upsert(
        {
          email,
          subscribed_at: new Date().toISOString(),
          source: 'website',
          active: true,
        },
        { onConflict: 'email' }
      )

    if (error) {
      console.error('[subscribe] Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to subscribe. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[subscribe] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    )
  }
}
