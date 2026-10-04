import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Two-step email + OTP form shared by voting, nomination and admin login.
 * `base` is the API prefix that has /request-otp and /verify-otp. `extra` is merged into both bodies.
 */
export default function EmailOtpFlow({ base, extra = {}, emailLabel = 'Your college email', onVerified }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestOtp(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(`${base}/request-otp`, { method: 'POST', body: { email, ...extra } });
      setStep('otp');
      setOtp('');
      setCooldown(60);
      setNotice(`We sent a 6-digit OTP to ${email.trim()}. It is valid for ${r.expiresInMinutes} minutes.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(`${base}/verify-otp`, { method: 'POST', body: { email, otp, ...extra } });
      onVerified({ token: r.token, email: email.trim().toLowerCase() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={requestOtp} className="stack">
        <label className="field">
          <span>{emailLabel}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@college.edu"
            autoComplete="email"
            required
            autoFocus
          />
        </label>
        {error && <p className="alert error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || !email}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="stack">
      {notice && <p className="alert info">{notice}</p>}
      <label className="field">
        <span>Enter the 6-digit OTP</span>
        <input
          className="otp-input"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          maxLength={6}
          required
          autoFocus
        />
      </label>
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy || otp.length !== 6}>{busy ? 'Verifying…' : 'Verify OTP'}</button>
      <div className="row between small">
        <button type="button" className="link-btn" onClick={() => { setStep('email'); setError(''); }}>Change email</button>
        <button type="button" className="link-btn" onClick={requestOtp} disabled={busy || cooldown > 0}>
          {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
        </button>
      </div>
    </form>
  );
}
