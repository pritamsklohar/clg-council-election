import { Router } from 'express';
import { config } from '../config/env.js';
import { requireToken } from '../middleware/auth.js';
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/limits.js';
import { Ballot, Nomination, Post, SuccessfulVote, Voter, VotingStatus, getSettings } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { sendOtp, verifyOtp } from '../utils/otp.js';
import { signToken } from '../utils/tokens.js';
import { cleanEmail, cleanId, cleanOtp } from '../utils/validate.js';

const router = Router();

async function assertVotingOpen() {
  const { votingState } = await getSettings();
  if (votingState === 'not_started') throw new HttpError(403, 'Voting has not started yet.');
  if (votingState === 'closed') throw new HttpError(403, 'Voting has ended.');
}

// Step 1: "Vote Now". Only emails in the mail stack that have not voted yet get an OTP.
router.post(
  '/request-otp',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    await assertVotingOpen();

    if (!(await Voter.exists({ email }))) throw new HttpError(403, 'You are not eligible for voting.');
    if (await SuccessfulVote.exists({ email })) throw new HttpError(409, 'You have already voted.');

    await sendOtp({ email, purpose: 'vote', label: 'voting', minutes: config.otpMinutes.vote });

    // Status starts as "pending". An existing "confirmed" record is left alone, so a stranger who
    // knows your email cannot knock you back to pending by requesting OTPs.
    await VotingStatus.updateOne({ email }, { $setOnInsert: { status: 'pending' } }, { upsert: true });

    res.json({ message: 'An OTP has been sent to your email.', expiresInMinutes: config.otpMinutes.vote });
  }),
);

// Step 2: OTP check. Status becomes "confirmed" and a short-lived voting session starts.
router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const code = cleanOtp(req.body?.otp);
    await assertVotingOpen();

    await verifyOtp({ email, purpose: 'vote', code });

    if (!(await Voter.exists({ email }))) throw new HttpError(403, 'You are not eligible for voting.');
    if (await SuccessfulVote.exists({ email })) throw new HttpError(409, 'You have already voted.');

    await VotingStatus.updateOne({ email }, { $set: { status: 'confirmed' } }, { upsert: true });

    const token = signToken({ purpose: 'vote', email }, config.sessionMinutes.vote);
    res.json({ token, expiresInMinutes: config.sessionMinutes.vote });
  }),
);

// Step 3: the ballot paper (posts with approved candidates only).
router.get(
  '/ballot',
  requireToken('vote'),
  asyncHandler(async (req, res) => {
    const { email } = req.auth;
    await assertVotingOpen();
    if (await SuccessfulVote.exists({ email })) throw new HttpError(409, 'You have already voted.');

    const [posts, candidates] = await Promise.all([
      Post.find().sort({ createdAt: 1 }).lean(),
      Nomination.find({ status: 'approved' }).sort({ createdAt: 1 }).lean(),
    ]);

    const ballot = posts
      .map((p) => ({
        id: p._id,
        name: p.name,
        candidates: candidates
          .filter((c) => String(c.post) === String(p._id))
          .map((c) => ({
            id: c._id,
            fullName: c.fullName,
            department: c.department,
            year: c.year,
            manifesto: c.manifesto,
          })),
      }))
      .filter((p) => p.candidates.length > 0);

    res.json({ posts: ballot });
  }),
);

// Step 4: submit. choices = [{ postId, candidateId }], at most one per post. Posts may be skipped.
router.post(
  '/cast',
  requireToken('vote'),
  asyncHandler(async (req, res) => {
    const { email } = req.auth;
    await assertVotingOpen();

    if (!(await Voter.exists({ email }))) throw new HttpError(403, 'You are not eligible for voting.');
    const status = await VotingStatus.findOne({ email }).lean();
    if (!status || status.status !== 'confirmed') {
      throw new HttpError(403, 'Please verify your OTP before voting.');
    }
    if (await SuccessfulVote.exists({ email })) throw new HttpError(409, 'You have already voted.');

    const choices = req.body?.choices;
    if (!Array.isArray(choices) || choices.length === 0 || choices.length > 50) {
      throw new HttpError(400, 'Select at least one candidate before submitting.');
    }

    const seenPosts = new Set();
    const parsed = choices.map((c) => {
      const postId = cleanId(c?.postId, 'post');
      const candidateId = cleanId(c?.candidateId, 'candidate');
      if (seenPosts.has(postId)) throw new HttpError(400, 'You can vote for only one candidate per post.');
      seenPosts.add(postId);
      return { postId, candidateId };
    });

    // Every chosen candidate must be an approved nominee for exactly that post.
    const approved = await Nomination.find({
      _id: { $in: parsed.map((c) => c.candidateId) },
      status: 'approved',
    })
      .select('post')
      .lean();
    const postOf = new Map(approved.map((n) => [String(n._id), String(n.post)]));
    for (const c of parsed) {
      if (postOf.get(c.candidateId) !== c.postId) throw new HttpError(400, 'One of the selected candidates is not valid.');
    }

    // 1) Claim the vote. The unique index on email makes this succeed exactly once per voter,
    //    even if two requests arrive at the same moment.
    try {
      await SuccessfulVote.create({ email });
    } catch (err) {
      if (err.code === 11000) throw new HttpError(409, 'You have already voted.');
      throw err;
    }

    // 2) Store the anonymous ballots. If this fails, release the claim so the voter can retry.
    try {
      await Ballot.insertMany(parsed.map((c) => ({ post: c.postId, candidate: c.candidateId })));
    } catch (err) {
      await SuccessfulVote.deleteOne({ email });
      throw err;
    }

    res.status(201).json({ message: 'Your vote has been recorded. Thank you for voting!' });
  }),
);

export default router;
