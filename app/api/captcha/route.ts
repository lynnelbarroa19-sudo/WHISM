import { NextResponse } from 'next/server';
import { generateCaptcha } from '@/lib/captcha';

export async function GET() {
  const { svg, token } = generateCaptcha();

  return NextResponse.json({ svg, token });
}
