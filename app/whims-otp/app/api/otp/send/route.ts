import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { generateOtpCode, signOtp } from '@/lib/otp';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 });
    }

    const code = generateOtpCode();
    const { token } = signOtp(email, code);

    await resend.emails.send({
      // Using Resend's shared test sender — works out of the box without
      // domain verification, but (on the free plan) can only deliver to
      // the email address registered on your Resend account until you
      // verify your own domain. See: https://resend.com/docs/dashboard/domains/introduction
      from: 'WHIMS <onboarding@resend.dev>',
      to: email,
      subject: 'Your WHIMS verification code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto;">
          <h2 style="color: #111827;">Verify your sign-in</h2>
          <p style="color: #374151;">Use the code below to complete your sign-in. This code expires in 5 minutes.</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 10px; color: #111827; margin: 24px 0;">
            ${code}
          </p>
          <p style="color: #9ca3af; font-size: 12px;">
            If you did not attempt to sign in, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">RHU Lopez, Quezon — WHIMS</p>
        </div>
      `,
    });

    return NextResponse.json({ token });
  } catch (err) {
    console.error('OTP send error:', err);
    return NextResponse.json({ error: 'Failed to send OTP email' }, { status: 500 });
  }
}
