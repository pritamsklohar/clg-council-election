import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import EmailOtpFlow from '../components/EmailOtpFlow.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';

const KEY = 'admin-session';

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export default function Admin() {
  const [session, setSession] = useState(loadSession);
  const [note, setNote] = useState('');

  const logout = useCallback((message = '') => {
    sessionStorage.removeItem(KEY);
    setSession(null);
    setNote(message);
  }, []);

  if (!session) {
    return (
      <div className="panel narrow stack">
        <h1>Admin login</h1>
        <p className="muted">Only emails with admin access can sign in. We will email you an OTP that is valid for 10 minutes.</p>
        {note && <p className="alert info">{note}</p>}
        <EmailOtpFlow
          base="/admin"
          emailLabel="Admin email"
          onVerified={(s) => {
            sessionStorage.setItem(KEY, JSON.stringify(s));
            setNote('');
            setSession(s);
          }}
        />
      </div>
    );
  }
  return <Dashboard session={session} logout={logout} />;
}

const TABS = [
  ['overview', 'Overview'],
  ['posts', 'Posts'],
  ['nominations', 'Nominations'],
  ['results', 'Results'],
  ['audit', 'Audit log'],
];

function Dashboard({ session, logout }) {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [toast, setToast] = useState(null);

  const call = useCallback(
    async (path, options = {}) => {
      try {
        return await api(path, { ...options, token: session.token });
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          if (err.status === 401) logout('Your session has ended. Please sign in again.');
        }
        throw err;
      }
    },
    [session.token, logout],
  );

  const notify = useCallback((text, type = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStats(await call('/admin/dashboard'));
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [call, notify]);
  useEffect(() => { refresh(); }, [refresh]);

  const shared = { call, notify, refresh, stats };

  return (
    <>
      <div className="row between wrap">
        <div>
          <h1>Admin dashboard</h1>
          <p className="muted">Signed in as {session.email}</p>
        </div>
        <button className="btn ghost" onClick={() => logout()}>Sign out</button>
      </div>

      {toast && <p className={`alert ${toast.type}`} role="status">{toast.text}</p>}

      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'nominations' && stats?.pendingNominations > 0 && <span className="count">{stats.pendingNominations}</span>}
          </button>
        ))}
      </div>

      {!stats ? <p className="empty">Loading…</p> : (
        <>
          {tab === 'overview' && <Overview {...shared} />}
          {tab === 'posts' && <PostsTab {...shared} />}
          {tab === 'nominations' && <NominationsTab {...shared} />}
          {tab === 'results' && <ResultsTab {...shared} />}
          {tab === 'audit' && <AuditTab {...shared} />}
        </>
      )}
    </>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Overview({ stats, call, notify, refresh }) {
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const { settings } = stats;

  async function run() {
    setBusy(true);
    try {
      await call('/admin/settings', { method: 'PUT', body: action.body });
      notify(action.success);
      await refresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
      setAction(null);
    }
  }

  const phaseText = { not_started: 'Not started', open: 'Open', closed: 'Closed' }[settings.votingState];

  return (
    <>
      <div className="stats">
        <Stat label="Total voters" value={stats.totalVoters} hint="Emails in the mail stack" />
        <Stat label="Successful votes" value={stats.successfulVotes} hint={`${stats.turnoutPercent}% turnout`} />
        <Stat label="Pending nominations" value={stats.pendingNominations} />
        <Stat label="Approved candidates" value={stats.approvedNominations} />
        <Stat label="Posts" value={stats.totalPosts} />
      </div>

      <h2 className="section-title">Election controls</h2>
      <div className="grid two">
        <div className="card stack">
          <h3>Nominations</h3>
          <p>Status: <span className={`badge ${settings.nominationsOpen ? 'ok' : 'muted'}`}>{settings.nominationsOpen ? 'Open' : 'Closed'}</span></p>
          {settings.nominationsOpen ? (
            <button
              className="btn outline"
              onClick={() => setAction({
                title: 'Close nominations?',
                body: { nominationsOpen: false },
                success: 'Nominations are now closed.',
                confirm: 'Close nominations',
                text: 'Students will no longer be able to submit nomination forms.',
              })}
            >
              Close nominations
            </button>
          ) : (
            <button
              className="btn outline"
              onClick={() => setAction({
                title: 'Reopen nominations?',
                body: { nominationsOpen: true },
                success: 'Nominations are open again.',
                confirm: 'Reopen nominations',
                text: 'Nomination forms will appear on the home page again.',
              })}
            >
              Reopen nominations
            </button>
          )}
        </div>

        <div className="card stack">
          <h3>Voting</h3>
          <p>Status: <span className={`badge ${settings.votingState === 'open' ? 'ok' : 'muted'}`}>{phaseText}</span></p>
          {settings.votingState === 'not_started' && (
            <>
              <button
                className="btn primary"
                disabled={settings.nominationsOpen || stats.approvedNominations === 0}
                onClick={() => setAction({
                  title: 'Open voting?',
                  body: { votingState: 'open' },
                  success: 'Voting is now open.',
                  confirm: 'Open voting',
                  text: 'Students on the mail stack will be able to vote. Posts and nominations can no longer be changed.',
                })}
              >
                Open voting
              </button>
              {(settings.nominationsOpen || stats.approvedNominations === 0) && (
                <p className="muted small">
                  {settings.nominationsOpen ? 'Close nominations first. ' : ''}
                  {stats.approvedNominations === 0 ? 'Approve at least one nomination.' : ''}
                </p>
              )}
            </>
          )}
          {settings.votingState === 'open' && (
            <button
              className="btn danger"
              onClick={() => setAction({
                title: 'Close voting?',
                body: { votingState: 'closed' },
                success: 'Voting is closed. Results are now available.',
                confirm: 'Close voting permanently',
                danger: true,
                text: 'This is final. Voting cannot be reopened, and results will become visible.',
              })}
            >
              Close voting
            </button>
          )}
          {settings.votingState === 'closed' && <p className="muted small">Voting is finished. See the Results tab.</p>}
        </div>
      </div>

      {action && (
        <ConfirmDialog title={action.title} confirmLabel={action.confirm} danger={action.danger} busy={busy} onConfirm={run} onCancel={() => setAction(null)}>
          <p>{action.text}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function PostsTab({ call, notify, refresh, stats }) {
  const empty = { name: '', eligibility: '', responsibilities: '' };
  const [posts, setPosts] = useState(null);
  const [form, setForm] = useState(empty);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = stats.settings.votingState !== 'not_started';

  const load = useCallback(async () => {
    try {
      setPosts((await call('/admin/posts')).posts);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [call, notify]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function publish() {
    setBusy(true);
    try {
      await call('/admin/posts', { method: 'POST', body: form });
      notify(`"${form.name}" has been posted and its nomination form is now on the home page.`);
      setForm(empty);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="grid two align-start">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirming(true);
        }}
      >
        <h3>Add a post</h3>
        {locked && <p className="alert info">Posts cannot be added once voting has started.</p>}
        <label className="field">
          <span>Post name</span>
          <input value={form.name} onChange={set('name')} maxLength={100} placeholder="e.g. President" required disabled={locked} />
        </label>
        <label className="field">
          <span>Eligibility</span>
          <textarea rows={4} value={form.eligibility} onChange={set('eligibility')} maxLength={2000} required disabled={locked} />
        </label>
        <label className="field">
          <span>Key responsibilities</span>
          <textarea rows={5} value={form.responsibilities} onChange={set('responsibilities')} maxLength={3000} required disabled={locked} />
        </label>
        <button className="btn primary" disabled={locked || !form.name.trim() || !form.eligibility.trim() || !form.responsibilities.trim()}>
          Review and post
        </button>
      </form>

      <div className="stack">
        <h3 className="plain">Posted ({posts?.length ?? 0})</h3>
        {posts?.length === 0 && <p className="empty">No posts yet.</p>}
        {posts?.map((p) => (
          <div key={p.id} className="card">
            <h3>{p.name}</h3>
            <h4>Eligibility</h4>
            <p>{p.eligibility}</p>
            <h4>Key responsibilities</h4>
            <p>{p.responsibilities}</p>
          </div>
        ))}
      </div>

      {confirming && (
        <ConfirmDialog title="Post this now?" confirmLabel="Yes, post it" busy={busy} onConfirm={publish} onCancel={() => setConfirming(false)}>
          <p>
            <b>{form.name}</b> will appear on the home page right away, with a "Fill nomination form" button for students.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function NominationsTab({ call, notify, refresh, stats }) {
  const [filter, setFilter] = useState('pending');
  const [items, setItems] = useState(null);
  const [busyId, setBusyId] = useState('');
  const locked = stats.settings.votingState !== 'not_started';

  const load = useCallback(async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      setItems((await call(`/admin/nominations${query}`)).nominations);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [call, notify, filter]);
  useEffect(() => { load(); }, [load]);

  async function review(id, decision) {
    setBusyId(id);
    try {
      const r = await call(`/admin/nominations/${id}/${decision}`, { method: 'POST', body: {} });
      notify(`Nomination ${decision === 'approve' ? 'approved' : 'rejected'}${r.emailSent ? ' and the candidate was emailed.' : ', but the email could not be sent.'}`, r.emailSent ? 'success' : 'error');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <div className="row between wrap">
        <h3 className="plain">Nominations</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter nominations">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      {items === null && <p className="empty">Loading…</p>}
      {items?.length === 0 && <p className="empty">No {filter === 'all' ? '' : filter} nominations.</p>}
      <div className="stack">
        {items?.map((n) => (
          <div key={n.id} className="card">
            <div className="row between wrap">
              <div>
                <h3>{n.fullName}</h3>
                <p className="muted">{n.email} · {n.department}, {n.year}</p>
              </div>
              <div className="right">
                <span className={`badge ${n.status === 'approved' ? 'ok' : n.status === 'rejected' ? 'bad' : 'warn'}`}>{n.status}</span>
                <p className="small muted">For <b>{n.postName}</b></p>
              </div>
            </div>
            <p className="quote">{n.manifesto}</p>
            {n.status === 'pending' && (
              <div className="actions left">
                <button className="btn primary" disabled={busyId === n.id} onClick={() => review(n.id, 'approve')}>Approve</button>
                <button className="btn ghost" disabled={busyId === n.id} onClick={() => review(n.id, 'reject')}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ResultsTab({ call, notify, stats }) {
  const closed = stats.settings.votingState === 'closed';
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!closed) return;
    call('/admin/results').then((r) => setResults(r.posts)).catch((err) => notify(err.message, 'error'));
  }, [closed, call, notify]);

  if (!closed) {
    return <p className="empty">Results are hidden until voting is closed, so nobody can see a running tally.</p>;
  }
  if (!results) return <p className="empty">Loading…</p>;

  return (
    <div className="grid two align-start">
      {results.map((p) => (
        <div key={p.id} className="card">
          <h3>{p.name}</h3>
          <p className="muted small">{p.totalVotes} vote(s) cast for this post</p>
          {p.candidates.length === 0 && <p className="muted">No candidates.</p>}
          <ol className="results">
            {p.candidates.map((c, i) => (
              <li key={c.id}>
                <div className="row between">
                  <span>{i === 0 && c.votes > 0 && p.candidates[1]?.votes !== c.votes ? '🏆 ' : ''}<b>{c.fullName}</b> <small className="muted">{c.department}, {c.year}</small></span>
                  <b>{c.votes}</b>
                </div>
                <div className="bar"><span style={{ width: `${p.totalVotes ? (c.votes / p.totalVotes) * 100 : 0}%` }} /></div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function AuditTab({ call, notify }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    call('/admin/audit-log').then((r) => setEntries(r.entries)).catch((err) => notify(err.message, 'error'));
  }, [call, notify]);

  if (!entries) return <p className="empty">Loading…</p>;
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr><th>When</th><th>Admin</th><th>Action</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td>{new Date(e.at).toLocaleString()}</td>
              <td>{e.actor}</td>
              <td>{e.action.replaceAll('_', ' ')}</td>
              <td>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p className="empty">Nothing recorded yet.</p>}
    </div>
  );
}
