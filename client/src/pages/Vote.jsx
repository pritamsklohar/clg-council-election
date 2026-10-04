import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import EmailOtpFlow from '../components/EmailOtpFlow.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';

export default function Vote() {
  const [phase, setPhase] = useState(null);
  const [step, setStep] = useState('email'); // email -> ballot -> done
  const [session, setSession] = useState(null);
  const [ballot, setBallot] = useState([]);
  const [picks, setPicks] = useState({}); // postId -> candidateId
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  useEffect(() => {
    api('/posts').then((d) => setPhase(d.settings.votingState)).catch((e) => setError(e.message));
  }, []);

  function backToStart(message) {
    setSession(null);
    setBallot([]);
    setPicks({});
    setReviewing(false);
    setStep('email');
    setError(message);
  }

  async function loadBallot(s) {
    setError('');
    try {
      const r = await api('/vote/ballot', { token: s.token });
      setSession(s);
      setBallot(r.posts);
      setStep('ballot');
    } catch (err) {
      if (err.status === 409) {
        setDoneMessage(err.message);
        setStep('already');
      } else {
        backToStart(err.message);
      }
    }
  }

  async function cast() {
    setBusy(true);
    try {
      const choices = Object.entries(picks).map(([postId, candidateId]) => ({ postId, candidateId }));
      const r = await api('/vote/cast', { method: 'POST', token: session.token, body: { choices } });
      setDoneMessage(r.message);
      setStep('done');
      setReviewing(false);
    } catch (err) {
      setReviewing(false);
      if (err.status === 409) {
        setDoneMessage(err.message);
        setStep('already');
      } else if (err.status === 401) {
        backToStart(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && phase === null && step === 'email') return <p className="alert error">{error}</p>;
  if (phase === null) return <p className="empty">Loading…</p>;

  if (phase !== 'open' && step === 'email') {
    return (
      <div className="panel narrow center stack">
        <h1>{phase === 'closed' ? 'Voting has ended' : 'Voting has not started yet'}</h1>
        <p className="muted">
          {phase === 'closed' ? 'Thank you to everyone who took part.' : 'Please come back when the election committee opens voting.'}
        </p>
        <Link className="btn outline" to="/">Back to home</Link>
      </div>
    );
  }

  if (step === 'email') {
    return (
      <div className="panel narrow stack">
        <h1>Vote now</h1>
        <p className="muted">
          Enter your college email. If you are on the voter list, we will send you an OTP. You can vote only once.
        </p>
        {error && <p className="alert error" role="alert">{error}</p>}
        <EmailOtpFlow base="/vote" onVerified={loadBallot} />
      </div>
    );
  }

  if (step === 'done' || step === 'already') {
    return (
      <div className="panel narrow center stack">
        <div className={`big-check ${step === 'already' ? 'info' : ''}`} aria-hidden="true">{step === 'done' ? '✓' : 'i'}</div>
        <h1>{step === 'done' ? 'Vote submitted' : 'You have already voted'}</h1>
        <p className="muted">{doneMessage}</p>
        <Link className="btn primary" to="/">Back to home</Link>
      </div>
    );
  }

  const chosenCount = Object.keys(picks).length;
  const nameOf = (post) => post.candidates.find((c) => c.id === picks[post.id])?.fullName;

  return (
    <>
      <div className="row between wrap">
        <div>
          <h1>Your ballot</h1>
          <p className="muted">Verified as {session.email}. Choose one candidate per post. You may skip any post.</p>
        </div>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}

      {ballot.length === 0 && <p className="empty">There are no candidates to vote for.</p>}

      {ballot.map((post) => (
        <fieldset key={post.id} className="card ballot-post">
          <legend>{post.name}</legend>
          <div className="options">
            {post.candidates.map((c) => (
              <label key={c.id} className={`option ${picks[post.id] === c.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={`post-${post.id}`}
                  checked={picks[post.id] === c.id}
                  onChange={() => setPicks((p) => ({ ...p, [post.id]: c.id }))}
                />
                <span>
                  <b>{c.fullName}</b>
                  <small>{c.department}, {c.year}</small>
                  <em>{c.manifesto}</em>
                </span>
              </label>
            ))}
          </div>
          {picks[post.id] && (
            <button type="button" className="link-btn small" onClick={() => setPicks((p) => { const n = { ...p }; delete n[post.id]; return n; })}>
              Clear my choice for {post.name}
            </button>
          )}
        </fieldset>
      ))}

      <div className="sticky-bar">
        <span>{chosenCount} of {ballot.length} posts selected</span>
        <button className="btn primary" disabled={chosenCount === 0} onClick={() => setReviewing(true)}>
          Review and submit
        </button>
      </div>

      {reviewing && (
        <ConfirmDialog
          title="Confirm your vote"
          confirmLabel="Yes, submit my vote"
          busy={busy}
          onConfirm={cast}
          onCancel={() => setReviewing(false)}
        >
          <p>Your vote is final and cannot be changed after you submit it.</p>
          <dl className="summary">
            {ballot.map((post) => (
              <div key={post.id} className="summary-row">
                <dt>{post.name}</dt>
                <dd>{nameOf(post) || <span className="muted">No selection</span>}</dd>
              </div>
            ))}
          </dl>
        </ConfirmDialog>
      )}
    </>
  );
}
