// ============================================================
// POST /api/send-opening-day-email
// FullCountProps — Opening Day email blast
//
// Queries email_signups (source = 'opening_day') and sends
// each subscriber an HTML email via Resend announcing that
// Opening Day picks are live.
//
// Authorization: requires x-api-secret header matching CRON_SECRET.
// Intended to be called once on Opening Day morning, either from
// scripts/send_opening_day_email.py or a cron job.
//
// Returns: { sent: number, errors: number }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── Env ──────────────────────────────────────────────────────
const CRON_SECRET = process.env.CRON_SECRET
const RESEND_API_KEY = process.env.RESEND_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const FROM_ADDRESS = 'FullCountProps <noreply@fullcountprops.com>'
const SUBJECT = "Opening Day is here — your projections are live"

// ── Email HTML ────────────────────────────────────────────────

function buildEmailHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Opening Day is here — FullCountProps</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f1f12;border:1px solid #166534;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#4ade80;">
                FullCountProps
              </p>
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Opening Day is here ⚾
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#111827;border-left:1px solid #1e293b;border-right:1px solid #1e293b;padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#cbd5e1;">
                The 2026 MLB season is underway — and your Opening Day projections are live.
                Our model has already run <strong style="color:#ffffff;">3,000 Monte Carlo simulations</strong>
                across today&apos;s full slate, surfacing the highest-confidence strikeout and batter prop edges.
              </p>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:#cbd5e1;">
                Every edge includes a full factor breakdown — park, umpire, platoon, recent
                form — so you can see exactly why the model likes each pick before you act on it.
              </p>

              <!-- Primary CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <a href="https://www.fullcountprops.com/edges"
                       style="display:inline-block;background-color:#16a34a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">
                      View Today&apos;s Edges &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0;" />

              <!-- Secondary info -->
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#94a3b8;">
                Free (Single-A) accounts see the top 3 edges each day.
                Upgrade to <strong style="color:#ffffff;">Double-A ($9/mo)</strong> for the full daily slate,
                email digest, and unlimited player history.
              </p>

              <!-- Secondary CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-top:16px;">
                    <a href="https://www.fullcountprops.com/pricing"
                       style="display:inline-block;background-color:#1e293b;color:#94a3b8;font-size:13px;font-weight:500;text-decoration:none;padding:10px 24px;border-radius:6px;border:1px solid #334155;">
                      See Pricing
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#0c1322;border:1px solid #1e293b;border-top:none;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
                You signed up for Opening Day notifications at fullcountprops.com.<br />
                This is not financial or gambling advice.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Resend send ───────────────────────────────────────────────

async function sendEmail(to: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: SUBJECT,
      html: buildEmailHtml(),
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[send-opening-day-email] Failed to send to ${to}: ${res.status} ${text.slice(0, 120)}`)
    return false
  }

  return true
}

// ── Handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Authorize via secret header
  const secret = req.headers.get('x-api-secret')
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate remaining env vars
  if (!RESEND_API_KEY) {
    console.error('[send-opening-day-email] RESEND_API_KEY is not set')
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[send-opening-day-email] Supabase env vars not set')
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  // 3. Fetch email_signups with source = 'opening_day'
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: signups, error: dbError } = await supabase
    .from('email_signups')
    .select('email')
    .eq('source', 'opening_day')

  if (dbError) {
    console.error('[send-opening-day-email] Supabase query error:', dbError)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const emails: string[] = (signups ?? [])
    .map((row: { email: string }) => row.email)
    .filter(Boolean)

  console.log(`[send-opening-day-email] Sending to ${emails.length} recipients`)

  // 4. Send emails, tracking successes and failures
  let sent = 0
  let errors = 0

  for (const email of emails) {
    const ok = await sendEmail(email)
    if (ok) {
      sent++
    } else {
      errors++
    }
  }

  console.log(`[send-opening-day-email] Complete — sent: ${sent}, errors: ${errors}`)

  return NextResponse.json({ sent, errors })
}
