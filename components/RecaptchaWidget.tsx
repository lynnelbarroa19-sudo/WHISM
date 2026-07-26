'use client';

import ReCAPTCHA from 'react-google-recaptcha';
import { forwardRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';

const RecaptchaWidget = forwardRef<ReCAPTCHA>((_, ref) => {
  if (!SITE_KEY) {
    return (
      <p style={{ color: '#dc2626', fontSize: 12 }}>
        Missing NEXT_PUBLIC_RECAPTCHA_SITE_KEY in .env.local
      </p>
    );
  }

  return <ReCAPTCHA ref={ref} sitekey={SITE_KEY} />;
});

RecaptchaWidget.displayName = 'RecaptchaWidget';

export default RecaptchaWidget;
