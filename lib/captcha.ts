import svgCaptcha from 'svg-captcha';
import crypto from 'crypto';

// IMPORTANT: Add CAPTCHA_SECRET to your .env.local file
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const SECRET = process.env.CAPTCHA_SECRET || 'dev-secret-change-me-in-production';
const EXPIRY_MS = 5 * 60 * 1000; // captcha valid for 5 minutes

/**
 * Generates a new captcha image (SVG) and a signed token.
 * The token contains no plaintext answer - it's an HMAC signature
 * that can only be validated by verifyCaptcha() using the same secret.
 */
export function generateCaptcha() {
  const captcha = svgCaptcha.create({
    size: 5,               // number of characters
    noise: 3,               // noise lines
    color: true,
    background: '#f4f4f4',
    ignoreChars: '0oO1ilI', // avoid confusing characters
    width: 150,
    height: 50,
  });

  const text = captcha.text.toUpperCase();
  const expires = Date.now() + EXPIRY_MS;
  const token = signCaptcha(text, expires);

  return { svg: captcha.data, token };
}

function sign(text: string, expires: number): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${text}:${expires}`)
    .digest('hex');
}

function signCaptcha(text: string, expires: number): string {
  const sig = sign(text, expires);
  const payload = `${expires}.${sig}`;
  return Buffer.from(payload).toString('base64url');
}

/**
 * Verifies a user's typed answer against the signed token.
 * Returns false if expired, tampered, or wrong answer.
 */
export function verifyCaptcha(token: string, userAnswer: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [expiresStr, sig] = decoded.split('.');
    const expires = Number(expiresStr);

    if (!expires || !sig) return false;
    if (Date.now() > expires) return false; // expired

    const answer = userAnswer.trim().toUpperCase();
    const expectedSig = sign(answer, expires);

    // timing-safe comparison to avoid timing attacks
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
