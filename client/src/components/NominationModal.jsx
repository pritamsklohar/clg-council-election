import { useState } from 'react';
import { api } from '../api.js';
import EmailOtpFlow from './EmailOtpFlow.jsx';
import { Modal } from './Modal.jsx';

const YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'Postgraduate'];

export default function NominationModal({ post, onClose, onSubmitted }) {
  const [step, setStep] = useState('verify'); // verify -> form -> confirm -> done
  const [session, setSession] = useState(null);
  const [form, setForm] = useState({ fullName: '', department: '', year: YEARS[0], manifesto: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const formValid = form.fullName.trim().length >= 2 && form.department.trim() && form.manifesto.trim().length >= 20;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const r = await api('/nominations', { method: 'POST', token: session.token, body: form });
      setResult(r);
      setStep('done');
      onSubmitted?.();
    } catch (err) {
      setError(err.message);
      if (err.status === 401) {
        setSession(null);
        setStep('verify');
      } else {
        setStep('form');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Nomination: ${post.name}`} onClose={busy ? undefined : onClose}>
      {step === 'verify' && (
        <div className="modal-body stack">
          <p className="muted">Enter your college email. Only students can be nominated, and we will send an OTP to confirm it is you.</p>
          {error && <p className="alert error" role="alert">{error}</p>}
          <EmailOtpFlow
            base="/nominations"
            extra={{ postId: post.id }}
            onVerified={(s) => {
              setSession(s);
              setError('');
              setStep('form');
            }}
          />
        </div>
      )}

      {step === 'form' && (
        <form
          className="modal-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            setStep('confirm');
          }}
        >
          <p className="alert success">Email verified: {session.email}</p>
          {error && <p className="alert error" role="alert">{error}</p>}
          <label className="field">
            <span>Full name</span>
            <input value={form.fullName} onChange={set('fullName')} maxLength={80} required />
          </label>
          <div className="two-col">
            <label className="field">
              <span>Department</span>
              <input value={form.department} onChange={set('department')} maxLength={80} required />
            </label>
            <label className="field">
              <span>Year</span>
              <select value={form.year} onChange={set('year')}>
                {YEARS.map((y) => <option key={y}>{y}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Why do you want this post? <em>(min 20 characters)</em></span>
            <textarea rows={5} value={form.manifesto} onChange={set('manifesto')} maxLength={1500} required />
            <small className="muted">{form.manifesto.length}/1500</small>
          </label>
          <button className="btn primary block" disabled={!formValid}>Submit nomination</button>
        </form>
      )}

      {step === 'confirm' && (
        <div className="modal-body stack">
          <h3 className="plain">Please confirm</h3>
          <p>
            You are about to submit your nomination for <b>{post.name}</b>. You cannot edit it afterwards.
          </p>
          <dl className="summary">
            <dt>Name</dt><dd>{form.fullName}</dd>
            <dt>Email</dt><dd>{session.email}</dd>
            <dt>Department</dt><dd>{form.department}, {form.year}</dd>
          </dl>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setStep('form')} disabled={busy}>Go back</button>
            <button type="button" className="btn primary" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Yes, submit'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="modal-body stack center">
          <div className="big-check" aria-hidden="true">✓</div>
          <h3 className="plain">Nomination submitted</h3>
          <p>{result?.message}</p>
          <p className="muted">
            {result?.emailSent === false
              ? 'We could not send the confirmation email, but your nomination was received.'
              : 'A confirmation email is on its way. You will get another one when the committee approves your nomination.'}
          </p>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
