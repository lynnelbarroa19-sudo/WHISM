import crypto from 'crypto';

// IMPORTANT: Add OTP_SECRET to your .env.local file
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const SECRET = process.env.OTP_SECRET || 'dev-secret-change-me-in-production';
const EXPIRY_MS = 5 * 60 * 1000; // code valid for 5 minutes

/**
 * Generates a random 4-digit numeric code, zero-padded (e.g. "0042").
 */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 10000).toString().padStart(4, '0');
}

function sign(email: string, code: string, expires: number): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${email.trim().toLowerCase()}:${code}:${expires}`)
    .digest('hex');
}

/**
 * Signs a code for a given email. Returns a token that does NOT contain
 * the plaintext code — only a verifiable HMAC signature + expiry.
 */
export function signOtp(email: string, code: string): { token: string; expires: number } {
  const expires = Date.now() + EXPIRY_MS;
  const sig = sign(email, code, expires);
  const payload = `${expires}.${sig}`;
  const token = Buffer.from(payload).toString('base64url');
  return { token, expires };
}

/**
 * Verifies a user-entered code against the signed token for a given email.
 */
export function verifyOtp(email: string, code: string, token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [expiresStr, sig] = decoded.split('.');
    const expires = Number(expiresStr);

    if (!expires || !sig) return false;
    if (Date.now() > expires) return false; // expired

    const expectedSig = sign(email, code.trim(), expires);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
