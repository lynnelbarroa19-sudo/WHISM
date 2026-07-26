import { NextRequest, NextResponse } from 'next/server';
import { verifyCaptcha } from '@/lib/captcha';

export async function POST(req: NextRequest) {
  try {
    const { token, answer } = await req.json();

    if (!token || !answer) {
      return NextResponse.json(
        { valid: false, error: 'Missing token or answer' },
        { status: 400 }
      );
    }

    const valid = verifyCaptcha(token, answer);
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json(
      { valid: false, error: 'Invalid request' },
      { status: 400 }
    );
  }
}
