// frontend/app/api/founding-status/route.ts
// GET /api/founding-status — returns founding member availability, cached 60s

import { NextResponse } from 'next/server';
import { getFoundingStatus } from '@/app/lib/founding';

export const revalidate = 60;

export async function GET() {
  const status = await getFoundingStatus();
  return NextResponse.json({
    isAvailable: status.isAvailable,
    remaining: status.remaining,
    cap: status.cap,
  });
}
