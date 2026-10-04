import crypto from 'crypto';
import { config } from '../config/env.js';
import { Otp } from '../models/index.js';
import { HttpError } from './errors.js';
import { otpEmail } from './emails.js';
import { sendMail } from './mailer.js';

const generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

// Keyed hash (HMAC): a leaked database cannot be used to brute-force the 6-digit codes.
const hashCode = (code, email, purpose) =>
  crypto.createHmac('sha256', config.otpSecret).update(`${purpose}:${email}:${code}`).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Creates (or replaces) the OTP for email + purpose and emails it.
 * A purpose is a string such as "vote", "admin" or "nomination:<postId>", so an OTP
 * issued for one action can never be used for another.
 */
export async function sendOtp({ email, purpose, label, minutes }) {
  const existing = await Otp.findOne({ email, purpose }).lean();
  if (existing) {
    const waitMs = config.otpResendCooldownSeconds * 1000 - (Date.now() - existing.lastSentAt.getTime());
    if (waitMs > 0) {
      throw new HttpError(429, `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new OTP.`);
    }
  }

  const code = generateCode();
  await Otp.findOneAndUpdate(
    { email, purpose },
    {
      codeHash: hashCode(code, email, purpose),
      attempts: 0,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + minutes * 60 * 1000),
    },
    { upsert: true },
  );

  try {
    await sendMail({ to: email, ...otpEmail({ label, code, minutes }) });
  } catch (err) {
    await Otp.deleteOne({ email, purpose });
    console.error('Sending OTP email failed:', err.message);
    throw new HttpError(502, 'We could not send the OTP email. Please try again in a moment.');
  }
}

/** Verifies and consumes an OTP. Throws an HttpError if it is wrong, expired or used up. */
export async function verifyOtp({ email, purpose, code }) {
  const record = await Otp.findOne({ email, purpose });
  if (!record) throw new HttpError(400, 'No active OTP. Please request a new one.');

  if (record.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: record._id });
    throw new HttpError(400, 'This OTP has expired. Please request a new one.');
  }

  // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const counted = await Otp.findOneAndUpdate(
    { _id: record._id, attempts: { $lt: config.otpMaxAttempts } },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!counted) {
    await Otp.deleteOne({ _id: record._id });
    throw new HttpError(429, 'Too many wrong attempts. Please request a new OTP.');
  }

  if (!safeEqual(hashCode(code, email, purpose), record.codeHash)) {
    const left = config.otpMaxAttempts - counted.attempts;
    throw new HttpError(400, left > 0 ? `Incorrect OTP. ${left} attempt(s) left.` : 'Incorrect OTP. Please request a new one.');
  }

  // Single use: only one concurrent request can delete the record and succeed.
  const consumed = await Otp.deleteOne({ _id: record._id, codeHash: record.codeHash });
  if (consumed.deletedCount !== 1) throw new HttpError(400, 'This OTP has already been used.');
}
