// End-to-end test of the whole election flow against an in-memory MongoDB.
// Run with: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;
let server;
let base;
let m; // models
let outbox;
let mongoose;

const ADMIN = 'admin@college.edu';
const S1 = 'student1@college.edu';
const S2 = 'student2@college.edu';
const S3 = 'student3@college.edu';
const S4 = 'student4@college.edu';
const OUTSIDER = 'outsider@gmail.com';

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function lastOtp(email) {
  const mails = outbox.filter((x) => x.to === email && /OTP/.test(x.subject));
  assert.ok(mails.length, `no OTP email sent to ${email}`);
  return mails[mails.length - 1].text.match(/\b(\d{6})\b/)[1];
}

// Skip the 60 second resend cooldown so tests can request several OTPs quickly.
const skipCooldown = (email) => m.Otp.updateMany({ email }, { lastSentAt: new Date(0) });

async function login(email, route, extra = {}) {
  await skipCooldown(email);
  const r = await api('POST', `${route}/request-otp`, { email, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await api('POST', `${route}/verify-otp`, { email, otp: lastOtp(email), ...extra });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.token;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongod.getUri('voting_test'),
    JWT_SECRET: 'j'.repeat(48),
    OTP_SECRET: 'o'.repeat(48),
    MAIL_MODE: 'memory',
    RATE_LIMIT_OTP_REQUESTS: '10000',
    RATE_LIMIT_OTP_VERIFY: '10000',
    RATE_LIMIT_API: '100000',
  });
  mongoose = (await import('mongoose')).default;
  await mongoose.connect(process.env.MONGODB_URI);
  m = await import('../src/models/index.js');
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await m.getSettings();
  outbox = (await import('../src/utils/mailer.js')).outbox;

  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  await m.Voter.insertMany([S1, S2, S3, S4].map((email) => ({ email })));
  await m.Admin.create({ email: ADMIN });
});

after(async () => {
  server?.close();
  await mongoose?.disconnect();
  await mongod?.stop();
});

const state = {};

test('admin login: only admin emails get an OTP, wrong OTP fails, correct OTP works', async () => {
  let r = await api('POST', '/admin/request-otp', { email: S1 });
  assert.equal(r.status, 403);

  r = await api('POST', '/admin/request-otp', { email: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.expiresInMinutes, 10);

  r = await api('POST', '/admin/request-otp', { email: ADMIN });
  assert.equal(r.status, 429, 'resend cooldown');

  r = await api('POST', '/admin/verify-otp', { email: ADMIN, otp: '000000' });
  assert.equal(r.status, 400);

  r = await api('POST', '/admin/verify-otp', { email: ADMIN, otp: lastOtp(ADMIN) });
  assert.equal(r.status, 200);
  state.admin = r.body.token;

  r = await api('POST', '/admin/verify-otp', { email: ADMIN, otp: lastOtp(ADMIN) });
  assert.equal(r.status, 400, 'OTP is single use');
});

test('admin endpoints reject missing or wrong-purpose tokens', async () => {
  assert.equal((await api('GET', '/admin/dashboard')).status, 401);
  assert.equal((await api('GET', '/admin/dashboard', undefined, 'garbage')).status, 401);
});

test('admin dashboard shows total voters (mail stack) and zero votes', async () => {
  const r = await api('GET', '/admin/dashboard', undefined, state.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.totalVoters, 4);
  assert.equal(r.body.successfulVotes, 0);
});

test('admin adds posts and they appear on the public home data', async () => {
  let r = await api('POST', '/admin/posts', { name: 'President' }, state.admin);
  assert.equal(r.status, 400);

  r = await api('POST', '/admin/posts', { name: 'President', eligibility: 'Final year student', responsibilities: 'Lead the council' }, state.admin);
  assert.equal(r.status, 201);
  state.president = r.body.post.id;

  r = await api('POST', '/admin/posts', { name: 'Secretary', eligibility: 'Any student', responsibilities: 'Keep records' }, state.admin);
  state.secretary = r.body.post.id;

  r = await api('GET', '/posts');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.posts.map((p) => p.name), ['President', 'Secretary']);
  assert.equal(r.body.settings.nominationsOpen, true);
});

test('nomination: non-students are rejected, students get OTP then the form', async () => {
  let r = await api('POST', '/nominations/request-otp', { email: OUTSIDER, postId: state.president });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not eligible for nomination/);

  // an OTP issued for one post cannot unlock another post
  await api('POST', '/nominations/request-otp', { email: S1, postId: state.president });
  r = await api('POST', '/nominations/verify-otp', { email: S1, postId: state.secretary, otp: lastOtp(S1) });
  assert.equal(r.status, 400);

  state.s1nom = await login(S1, '/nominations', { postId: state.president });
  state.s2nom = await login(S2, '/nominations', { postId: state.president });

  r = await api('POST', '/nominations', { fullName: 'A', department: 'CS' }, state.s1nom);
  assert.equal(r.status, 400, 'incomplete form');

  r = await api('POST', '/nominations', { fullName: 'Student One', department: 'CSE', year: '4th', manifesto: 'I will improve campus life for everyone.' }, state.s1nom);
  assert.equal(r.status, 201);
  assert.match(r.body.message, /President/);
  assert.ok(outbox.some((x) => x.to === S1 && /successfully enrolled for the nomination for the post of President/.test(x.text)));

  r = await api('POST', '/nominations', { fullName: 'Student One', department: 'CSE', year: '4th', manifesto: 'I will improve campus life for everyone.' }, state.s1nom);
  assert.equal(r.status, 409, 'duplicate nomination');

  r = await api('POST', '/nominations', { fullName: 'Student Two', department: 'ECE', year: '4th', manifesto: 'Better labs and better events for all.' }, state.s2nom);
  assert.equal(r.status, 201);

  const s3 = await login(S3, '/nominations', { postId: state.secretary });
  r = await api('POST', '/nominations', { fullName: 'Student Three', department: 'ME', year: '3rd', manifesto: 'Transparent records for everybody.' }, s3);
  assert.equal(r.status, 201);

  // a nomination token for one student is useless on the vote endpoints
  assert.equal((await api('GET', '/vote/ballot', undefined, state.s1nom)).status, 401);
});

test('admin sees nominations, approves them, candidate is emailed', async () => {
  let r = await api('GET', '/admin/nominations', undefined, state.admin);
  assert.equal(r.body.nominations.length, 3);
  assert.equal(r.body.nominations.every((n) => n.status === 'pending'), true);
  assert.equal((await api('GET', '/admin/dashboard', undefined, state.admin)).body.pendingNominations, 3);

  for (const n of r.body.nominations) {
    const a = await api('POST', `/admin/nominations/${n.id}/approve`, {}, state.admin);
    assert.equal(a.status, 200);
    state[n.email] = n.id;
  }
  assert.ok(outbox.some((x) => x.to === S1 && /nomination is confirmed for the post of President. Be ready for the voting session/.test(x.text)));

  r = await api('POST', `/admin/nominations/${state[S1]}/approve`, {}, state.admin);
  assert.equal(r.status, 409, 'cannot review twice');

  r = await api('GET', '/posts');
  assert.equal(r.body.posts[0].candidates.length, 2);
  assert.equal(r.body.posts[0].candidates[0].email, undefined, 'candidate emails are not public');
});

test('voting cannot start before nominations close', async () => {
  let r = await api('PUT', '/admin/settings', { votingState: 'open' }, state.admin);
  assert.equal(r.status, 409);

  r = await api('POST', '/vote/request-otp', { email: S4 });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not started/);

  r = await api('PUT', '/admin/settings', { nominationsOpen: false }, state.admin);
  assert.equal(r.status, 200);
  r = await api('POST', '/nominations/request-otp', { email: S4, postId: state.president });
  assert.equal(r.status, 403, 'nominations closed');

  r = await api('GET', '/admin/results', undefined, state.admin);
  assert.equal(r.status, 403, 'no early results');

  r = await api('PUT', '/admin/settings', { votingState: 'open' }, state.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.votingState, 'open');
});

test('Vote Now: non-members are not eligible, members get an OTP and status goes pending -> confirmed', async () => {
  let r = await api('POST', '/vote/request-otp', { email: OUTSIDER });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, 'You are not eligible for voting.');

  r = await api('POST', '/vote/request-otp', { email: S1 });
  assert.equal(r.status, 200);
  assert.equal((await m.VotingStatus.findOne({ email: S1 })).status, 'pending');

  r = await api('POST', '/vote/verify-otp', { email: S1, otp: '123456' === lastOtp(S1) ? '654321' : '123456' });
  assert.equal(r.status, 400);
  assert.equal((await m.VotingStatus.findOne({ email: S1 })).status, 'pending', 'wrong OTP keeps it pending');

  r = await api('POST', '/vote/verify-otp', { email: S1, otp: lastOtp(S1) });
  assert.equal(r.status, 200);
  assert.equal((await m.VotingStatus.findOne({ email: S1 })).status, 'confirmed');
  state.s1vote = r.body.token;
});

test('casting: validation, one vote per post, success records email in successful votes', async () => {
  const ballot = await api('GET', '/vote/ballot', undefined, state.s1vote);
  assert.equal(ballot.status, 200);
  assert.equal(ballot.body.posts.length, 2);

  let r = await api('POST', '/vote/cast', { choices: [] }, state.s1vote);
  assert.equal(r.status, 400);

  // a candidate of another post is invalid
  r = await api('POST', '/vote/cast', { choices: [{ postId: state.secretary, candidateId: state[S1] }] }, state.s1vote);
  assert.equal(r.status, 400);

  // two candidates for the same post
  r = await api('POST', '/vote/cast', { choices: [{ postId: state.president, candidateId: state[S1] }, { postId: state.president, candidateId: state[S2] }] }, state.s1vote);
  assert.equal(r.status, 400);

  // NoSQL injection attempt
  r = await api('POST', '/vote/cast', { choices: [{ postId: { $ne: null }, candidateId: { $ne: null } }] }, state.s1vote);
  assert.equal(r.status, 400);

  assert.equal(await m.SuccessfulVote.countDocuments(), 0, 'failed attempts do not count');

  r = await api('POST', '/vote/cast', { choices: [{ postId: state.president, candidateId: state[S1] }, { postId: state.secretary, candidateId: state[S3] }] }, state.s1vote);
  assert.equal(r.status, 201);
  assert.equal(await m.SuccessfulVote.countDocuments(), 1);
  assert.ok(await m.SuccessfulVote.exists({ email: S1 }));
});

test('double voting is blocked every way', async () => {
  let r = await api('POST', '/vote/cast', { choices: [{ postId: state.president, candidateId: state[S2] }] }, state.s1vote);
  assert.equal(r.status, 409, 'reusing the session');

  r = await api('POST', '/vote/request-otp', { email: S1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.message, 'You have already voted.');

  // 8 parallel submissions from one verified voter: exactly one wins
  const token = await login(S2, '/vote');
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => api('POST', '/vote/cast', { choices: [{ postId: state.president, candidateId: state[S2] }] }, token)),
  );
  assert.equal(attempts.filter((x) => x.status === 201).length, 1);
  assert.equal(attempts.filter((x) => x.status === 409).length, 7);
  assert.equal(await m.SuccessfulVote.countDocuments(), 2);
  assert.equal(await m.Ballot.countDocuments({ post: state.president }), 2);
});

test('ballots are anonymous: no email, no voter reference, no timestamp, uuid ids', async () => {
  const ballots = await m.Ballot.find().lean();
  assert.equal(ballots.length, 3);
  for (const b of ballots) {
    assert.deepEqual(Object.keys(b).sort(), ['_id', 'candidate', 'post']);
    assert.match(b._id, /^[0-9a-f-]{36}$/);
  }
  const dump = JSON.stringify(await m.SuccessfulVote.find().lean());
  assert.ok(!/createdAt|updatedAt/.test(dump), 'successful votes carry no timestamps');
});

test('expired OTP: voter can request a new one and still vote', async () => {
  let r = await api('POST', '/vote/request-otp', { email: S3 });
  assert.equal(r.status, 200);
  const stale = lastOtp(S3);
  await m.Otp.updateOne({ email: S3, purpose: 'vote' }, { expiresAt: new Date(Date.now() - 1000) });

  r = await api('POST', '/vote/verify-otp', { email: S3, otp: stale });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /expired/);
  assert.equal((await m.VotingStatus.findOne({ email: S3 })).status, 'pending');

  const token = await login(S3, '/vote');
  r = await api('POST', '/vote/cast', { choices: [{ postId: state.secretary, candidateId: state[S3] }] }, token);
  assert.equal(r.status, 201);
});

test('too many wrong OTP attempts locks the OTP, even for the right code', async () => {
  await skipCooldown(S4);
  await api('POST', '/vote/request-otp', { email: S4 });
  const right = lastOtp(S4);
  const wrong = right === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await api('POST', '/vote/verify-otp', { email: S4, otp: wrong })).status, 400);
  }
  let r = await api('POST', '/vote/verify-otp', { email: S4, otp: right });
  assert.equal(r.status, 429);
  r = await api('POST', '/vote/verify-otp', { email: S4, otp: right });
  assert.equal(r.status, 400, 'record is gone, a new OTP is needed');
});

test('OTPs are stored hashed, not in plain text', async () => {
  await skipCooldown(S4);
  assert.equal((await api('POST', '/vote/request-otp', { email: S4 })).status, 200);
  const code = lastOtp(S4);
  const rec = await m.Otp.findOne({ email: S4, purpose: 'vote' }).lean();
  assert.ok(rec);
  assert.ok(!JSON.stringify(rec).includes(code));
  assert.equal(rec.codeHash.length, 64);
});

test('dashboard counts, results only after closing, and the phase is final', async () => {
  const dash = await api('GET', '/admin/dashboard', undefined, state.admin);
  assert.equal(dash.body.totalVoters, 4);
  assert.equal(dash.body.successfulVotes, 3);
  assert.equal(dash.body.turnoutPercent, 75);

  assert.equal((await api('GET', '/admin/results', undefined, state.admin)).status, 403);

  let r = await api('PUT', '/admin/settings', { nominationsOpen: true }, state.admin);
  assert.equal(r.status, 409, 'cannot reopen nominations after voting started');

  r = await api('PUT', '/admin/settings', { votingState: 'closed' }, state.admin);
  assert.equal(r.status, 200);

  r = await api('PUT', '/admin/settings', { votingState: 'open' }, state.admin);
  assert.equal(r.status, 409, 'closed is final');

  r = await api('POST', '/vote/request-otp', { email: S4 });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /ended/);

  r = await api('GET', '/admin/results', undefined, state.admin);
  assert.equal(r.status, 200);
  const president = r.body.posts.find((p) => p.name === 'President');
  assert.equal(president.totalVotes, 2);
  assert.deepEqual(president.candidates.map((c) => c.votes).sort(), [1, 1]);
  const secretary = r.body.posts.find((p) => p.name === 'Secretary');
  assert.equal(secretary.candidates[0].votes, 2);
});

test('audit log records admin actions', async () => {
  const r = await api('GET', '/admin/audit-log', undefined, state.admin);
  const actions = r.body.entries.map((e) => e.action);
  for (const expected of ['admin_login', 'post_created', 'nomination_approved', 'nominations_closed', 'voting_opened', 'voting_closed', 'results_viewed']) {
    assert.ok(actions.includes(expected), `missing ${expected}`);
  }
});

test('removing admin access takes effect immediately', async () => {
  await m.Admin.updateOne({ email: ADMIN }, { isAdmin: false });
  assert.equal((await api('GET', '/admin/dashboard', undefined, state.admin)).status, 403);
});
