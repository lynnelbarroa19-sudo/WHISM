'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';

export interface CaptchaRef {
  verify: (answer: string) => Promise<boolean>;
  refresh: () => void;
}

const Captcha = forwardRef<CaptchaRef>((_, ref) => {
  const [svg, setSvg] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchCaptcha = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/captcha');
      const data = await res.json();
      setSvg(data.svg);
      setToken(data.token);
    } catch (err) {
      console.error('Failed to load captcha', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: fetchCaptcha,
    verify: async (answer: string) => {
      try {
        const res = await fetch('/api/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, answer }),
        });
        const data = await res.json();
        return Boolean(data.valid);
      } catch {
        return false;
      }
    },
  }));

  return (
    <div className="captcha-wrapper">
      <div className="captcha-image-row">
        {loading ? (
          <div className="captcha-loading">Loading captcha...</div>
        ) : (
          <div
            className="captcha-image"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <button
          type="button"
          onClick={fetchCaptcha}
          className="captcha-refresh"
          aria-label="Refresh captcha"
        >
          🔄
        </button>
      </div>
    </div>
  );
});

Captcha.displayName = 'Captcha';

export default Captcha;
