import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/otp';

export async function POST(req: NextRequest) {
  try {
    const { email, code, token } = await req.json();

    if (!email || !code || !token) {
      return NextResponse.json(
        { valid: false, error: 'Missing fields' },
        { status: 400 }
      );
    }

    const valid = verifyOtp(email, code, token);
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid request' }, { status: 400 });
  }
}
