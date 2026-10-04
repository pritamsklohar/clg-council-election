import { Router } from 'express';
import { config } from '../config/env.js';
import { requireToken } from '../middleware/auth.js';
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/limits.js';
import { Nomination, Post, Voter, getSettings } from '../models/index.js';
import { nominationReceivedEmail } from '../utils/emails.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { sendMail } from '../utils/mailer.js';
import { sendOtp, verifyOtp } from '../utils/otp.js';
import { signToken } from '../utils/tokens.js';
import { cleanEmail, cleanId, cleanOtp, cleanText } from '../utils/validate.js';

const router = Router();
const purposeFor = (postId) => `nomination:${postId}`;

async function assertNominationsOpen() {
  const settings = await getSettings();
  if (!settings.nominationsOpen) throw new HttpError(403, 'Nominations are closed.');
}

// Step 1: the candidate enters an email. Only emails in the mail stack get an OTP.
router.post(
  '/request-otp',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const postId = cleanId(req.body?.postId, 'post');

    await assertNominationsOpen();
    const post = await Post.findById(postId).lean();
    if (!post) throw new HttpError(404, 'This post no longer exists.');

    if (!(await Voter.exists({ email }))) {
      throw new HttpError(403, 'You are not eligible for nomination. Only college students can be nominated.');
    }

    await sendOtp({
      email,
      purpose: purposeFor(postId),
      label: `nomination for ${post.name}`,
      minutes: config.otpMinutes.nomination,
    });
    res.json({ message: 'An OTP has been sent to your email.', expiresInMinutes: config.otpMinutes.nomination });
  }),
);

// Step 2: OTP check. On success the nomination form is unlocked with a short-lived token.
router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const postId = cleanId(req.body?.postId, 'post');
    const code = cleanOtp(req.body?.otp);

    await assertNominationsOpen();
    await verifyOtp({ email, purpose: purposeFor(postId), code });

    if (await Nomination.exists({ post: postId, email })) {
      throw new HttpError(409, 'You have already submitted a nomination for this post.');
    }

    const token = signToken({ purpose: 'nomination', email, postId }, config.sessionMinutes.nomination);
    res.json({ token, expiresInMinutes: config.sessionMinutes.nomination });
  }),
);

// Step 3: the form itself.
router.post(
  '/',
  requireToken('nomination'),
  asyncHandler(async (req, res) => {
    const { email, postId } = req.auth;
    const body = req.body ?? {};
    const fullName = cleanText(body.fullName, 'Full name', { min: 2, max: 80 });
    const department = cleanText(body.department, 'Department', { max: 80 });
    const year = cleanText(body.year, 'Year', { max: 20 });
    const manifesto = cleanText(body.manifesto, 'Why you want this post', { min: 20, max: 1500 });

    await assertNominationsOpen();
    const post = await Post.findById(postId).lean();
    if (!post) throw new HttpError(404, 'This post no longer exists.');
    if (!(await Voter.exists({ email }))) {
      throw new HttpError(403, 'You are not eligible for nomination. Only college students can be nominated.');
    }

    try {
      await Nomination.create({ post: postId, email, fullName, department, year, manifesto });
    } catch (err) {
      if (err.code === 11000) throw new HttpError(409, 'You have already submitted a nomination for this post.');
      throw err;
    }

    let emailSent = true;
    try {
      await sendMail({ to: email, ...nominationReceivedEmail({ fullName, postName: post.name }) });
    } catch (err) {
      emailSent = false;
      console.error('Nomination confirmation email failed:', err.message);
    }

    res.status(201).json({
      message: `You have successfully enrolled for the nomination for ${post.name}.`,
      emailSent,
    });
  }),
);

export default router;
