import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import NominationModal from '../components/NominationModal.jsx';

function phaseInfo(settings) {
  if (settings.votingState === 'open') return { label: 'Voting is open', tone: 'live' };
  if (settings.votingState === 'closed') return { label: 'Voting has ended', tone: 'done' };
  if (settings.nominationsOpen) return { label: 'Nominations are open', tone: 'open' };
  return { label: 'Nominations closed. Voting opens soon.', tone: 'wait' };
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [nominating, setNominating] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/posts'));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="alert error">{error}</p>;
  if (!data) return <p className="empty">Loading…</p>;

  const { posts, settings } = data;
  const phase = phaseInfo(settings);
  const votingOpen = settings.votingState === 'open';

  return (
    <>
      <section className="hero">
        <span className={`pill ${phase.tone}`}>{phase.label}</span>
        <h1>Choose your student council</h1>
        <p>
          Every student votes once, and every ballot is anonymous. Verify with your college email, pick your
          candidates, and you are done.
        </p>
        {votingOpen ? (
          <Link to="/vote" className="btn accent large">Vote now</Link>
        ) : (
          <button className="btn accent large" disabled>Vote now</button>
        )}
        {!votingOpen && (
          <p className="hint">
            {settings.votingState === 'closed' ? 'Voting is over. Thank you to everyone who voted.' : 'Voting has not started yet.'}
          </p>
        )}
      </section>

      <h2 className="section-title">Posts</h2>
      {posts.length === 0 ? (
        <p className="empty">No posts have been announced yet. Please check back soon.</p>
      ) : (
        <div className="grid">
          {posts.map((post) => (
            <article key={post.id} className="card post">
              <h3>{post.name}</h3>
              <h4>Eligibility</h4>
              <p>{post.eligibility}</p>
              <h4>Key responsibilities</h4>
              <p>{post.responsibilities}</p>

              {post.candidates.length > 0 && (
                <>
                  <h4>Candidates ({post.candidates.length})</h4>
                  <ul className="candidates">
                    {post.candidates.map((c) => (
                      <li key={c.id}>
                        <b>{c.fullName}</b>
                        <span>{c.department}, {c.year}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {settings.nominationsOpen && (
                <button className="btn outline block" onClick={() => setNominating(post)}>
                  Fill nomination form
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {nominating && (
        <NominationModal post={nominating} onClose={() => setNominating(null)} onSubmitted={load} />
      )}
    </>
  );
}
