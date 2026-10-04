import { Router } from 'express';
import { config } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/limits.js';
import {
  Admin,
  AuditLog,
  Ballot,
  Nomination,
  Post,
  SuccessfulVote,
  Voter,
  VotingStatus,
  audit,
  getSettings,
} from '../models/index.js';
import { nominationApprovedEmail, nominationRejectedEmail } from '../utils/emails.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { sendMail } from '../utils/mailer.js';
import { sendOtp, verifyOtp } from '../utils/otp.js';
import { signToken } from '../utils/tokens.js';
import { cleanEmail, cleanId, cleanOtp, cleanText } from '../utils/validate.js';

const router = Router();

// ---- Admin login (OTP valid for 10 minutes) -------------------------------------------------

router.post(
  '/request-otp',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    if (!(await Admin.exists({ email, isAdmin: true }))) {
      throw new HttpError(403, 'This email does not have admin access.');
    }
    await sendOtp({ email, purpose: 'admin', label: 'admin login', minutes: config.otpMinutes.admin });
    res.json({ message: 'An OTP has been sent to your email.', expiresInMinutes: config.otpMinutes.admin });
  }),
);

router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const code = cleanOtp(req.body?.otp);
    if (!(await Admin.exists({ email, isAdmin: true }))) {
      throw new HttpError(403, 'This email does not have admin access.');
    }
    await verifyOtp({ email, purpose: 'admin', code });
    await audit(email, 'admin_login');
    const token = signToken({ purpose: 'admin', email }, config.sessionMinutes.admin);
    res.json({ token, email, expiresInMinutes: config.sessionMinutes.admin });
  }),
);

// Everything below needs a valid admin session.
router.use(requireAdmin);

// ---- Dashboard ------------------------------------------------------------------------------

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [totalVoters, successfulVotes, totalPosts, pendingNominations, approvedNominations, settings] =
      await Promise.all([
        Voter.countDocuments(),
        SuccessfulVote.countDocuments(),
        Post.countDocuments(),
        Nomination.countDocuments({ status: 'pending' }),
        Nomination.countDocuments({ status: 'approved' }),
        getSettings(),
      ]);
    res.json({
      totalVoters,
      successfulVotes,
      turnoutPercent: totalVoters ? Math.round((successfulVotes / totalVoters) * 1000) / 10 : 0,
      totalPosts,
      pendingNominations,
      approvedNominations,
      settings: { nominationsOpen: settings.nominationsOpen, votingState: settings.votingState },
    });
  }),
);

// ---- Posts ----------------------------------------------------------------------------------

router.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const posts = await Post.find().sort({ createdAt: 1 }).lean();
    res.json({ posts: posts.map((p) => ({ id: p._id, name: p.name, eligibility: p.eligibility, responsibilities: p.responsibilities })) });
  }),
);

router.post(
  '/posts',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = cleanText(body.name, 'Post name', { max: 100 });
    const eligibility = cleanText(body.eligibility, 'Eligibility', { max: 2000 });
    const responsibilities = cleanText(body.responsibilities, 'Key responsibilities', { max: 3000 });

    const settings = await getSettings();
    if (settings.votingState !== 'not_started') {
      throw new HttpError(409, 'Posts cannot be added once voting has started.');
    }

    const post = await Post.create({ name, eligibility, responsibilities, createdBy: req.auth.email });
    await audit(req.auth.email, 'post_created', name);
    res.status(201).json({ post: { id: post._id, name, eligibility, responsibilities } });
  }),
);

// ---- Nominations ----------------------------------------------------------------------------

router.get(
  '/nominations',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (typeof req.query.status === 'string' && ['pending', 'approved', 'rejected'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const [nominations, posts] = await Promise.all([
      Nomination.find(filter).sort({ createdAt: -1 }).lean(),
      Post.find().lean(),
    ]);
    const postName = new Map(posts.map((p) => [String(p._id), p.name]));
    res.json({
      nominations: nominations.map((n) => ({
        id: n._id,
        postId: n.post,
        postName: postName.get(String(n.post)) || '(deleted post)',
        email: n.email,
        fullName: n.fullName,
        department: n.department,
        year: n.year,
        manifesto: n.manifesto,
        status: n.status,
        submittedAt: n.createdAt,
      })),
    });
  }),
);

async function reviewNomination(req, res, status) {
  const id = cleanId(req.params.id, 'nomination');
  const settings = await getSettings();

  const nomination = await Nomination.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status, reviewedBy: req.auth.email },
    { new: true },
  );
  if (!nomination) throw new HttpError(409, 'This nomination was not found or has already been reviewed.');

  const post = await Post.findById(nomination.post).lean();
  const postName = post?.name || 'the selected post';
  await audit(req.auth.email, `nomination_${status}`, `${nomination.email} for ${postName}`);

  let emailSent = true;
  try {
    const template = status === 'approved' ? nominationApprovedEmail : nominationRejectedEmail;
    await sendMail({ to: nomination.email, ...template({ fullName: nomination.fullName, postName }) });
  } catch (err) {
    emailSent = false;
    console.error('Nomination review email failed:', err.message);
  }
  res.json({ message: `Nomination ${status}.`, emailSent });
}

router.post('/nominations/:id/approve', asyncHandler((req, res) => reviewNomination(req, res, 'approved')));
router.post('/nominations/:id/reject', asyncHandler((req, res) => reviewNomination(req, res, 'rejected')));

// ---- Election phase -------------------------------------------------------------------------

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const { nominationsOpen, votingState } = req.body ?? {};
    const settings = await getSettings();
    const changes = [];

    if (nominationsOpen !== undefined) {
      if (typeof nominationsOpen !== 'boolean') throw new HttpError(400, 'nominationsOpen must be true or false.');
      if (nominationsOpen !== settings.nominationsOpen) {
        settings.nominationsOpen = nominationsOpen;
        changes.push(nominationsOpen ? 'nominations_opened' : 'nominations_closed');
        if (nominationsOpen) {
          await Promise.all([
            Nomination.deleteMany({}),
            Ballot.deleteMany({}),
            SuccessfulVote.deleteMany({}),
            VotingStatus.deleteMany({}),
          ]);
          settings.votingState = 'not_started';
        }
      }
    }

    if (votingState !== undefined) {
      if (!['open', 'closed'].includes(votingState)) throw new HttpError(400, 'votingState must be "open" or "closed".');
      if (votingState === 'open') {
        if (settings.votingState !== 'not_started') throw new HttpError(409, 'Voting has already been opened.');
        if (settings.nominationsOpen) throw new HttpError(409, 'Close nominations before opening voting.');
        if ((await Nomination.countDocuments({ status: 'approved' })) === 0) {
          throw new HttpError(409, 'Approve at least one nomination before opening voting.');
        }
      } else if (settings.votingState !== 'open') {
        throw new HttpError(409, 'Voting is not open, so it cannot be closed.');
      }
      settings.votingState = votingState;
      changes.push(votingState === 'open' ? 'voting_opened' : 'voting_closed');
    }

    await settings.save();
    for (const change of changes) await audit(req.auth.email, change);
    res.json({ settings: { nominationsOpen: settings.nominationsOpen, votingState: settings.votingState } });
  }),
);

// ---- Results (only after voting is closed) --------------------------------------------------

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (settings.votingState !== 'closed') {
      throw new HttpError(403, 'Results are available only after voting is closed.');
    }

    const [posts, nominations, tallies] = await Promise.all([
      Post.find().sort({ createdAt: 1 }).lean(),
      Nomination.find({ status: 'approved' }).lean(),
      Ballot.aggregate([{ $group: { _id: { post: '$post', candidate: '$candidate' }, votes: { $sum: 1 } } }]),
    ]);
    const votesFor = new Map(tallies.map((t) => [String(t._id.candidate), t.votes]));

    await audit(req.auth.email, 'results_viewed');
    res.json({
      posts: posts.map((p) => {
        const candidates = nominations
          .filter((n) => String(n.post) === String(p._id))
          .map((n) => ({ id: n._id, fullName: n.fullName, department: n.department, year: n.year, votes: votesFor.get(String(n._id)) || 0 }))
          .sort((a, b) => b.votes - a.votes);
        return { id: p._id, name: p.name, totalVotes: candidates.reduce((s, c) => s + c.votes, 0), candidates };
      }),
    });
  }),
);

// ---- Audit log ------------------------------------------------------------------------------

router.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const entries = await AuditLog.find().sort({ at: -1 }).limit(100).lean();
    res.json({ entries: entries.map((e) => ({ actor: e.actor, action: e.action, detail: e.detail, at: e.at })) });
  }),
);

export default router;
