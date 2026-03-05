import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  const { password } = await req.json()
  
  if (password === process.env.GATE_PASSWORD) {
    const response = NextResponse.json({ success: true })
    response.cookies.set('gate_auth', 'true', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return response
  }
  
  return NextResponse.json({ success: false }, { status: 401 })
}
