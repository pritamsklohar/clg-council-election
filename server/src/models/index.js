import crypto from 'crypto';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const emailField = { type: String, required: true, unique: true, lowercase: true, trim: true };

// The "mail stack": the only voter data stored. Emails of everyone allowed to vote or be nominated.
export const Voter = model(
  'Voter',
  new Schema({ email: emailField }, { collection: 'mailstack', versionKey: false }),
);

// Emails that may log in as admin.
export const Admin = model(
  'Admin',
  new Schema(
    { email: emailField, isAdmin: { type: Boolean, default: true } },
    { collection: 'admins', versionKey: false },
  ),
);

export const Post = model(
  'Post',
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      eligibility: { type: String, required: true, trim: true, maxlength: 2000 },
      responsibilities: { type: String, required: true, trim: true, maxlength: 3000 },
      createdBy: { type: String },
    },
    { collection: 'posts', timestamps: true, versionKey: false },
  ),
);

const nominationSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    department: { type: String, required: true, trim: true, maxlength: 80 },
    year: { type: String, required: true, trim: true, maxlength: 20 },
    manifesto: { type: String, required: true, trim: true, maxlength: 1500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: String },
  },
  { collection: 'nominations', timestamps: true, versionKey: false },
);
// One nomination per student per post.
nominationSchema.index({ post: 1, email: 1 }, { unique: true });
export const Nomination = model('Nomination', nominationSchema);

// pending   = an OTP was requested for this email
// confirmed = the OTP was verified successfully
export const VotingStatus = model(
  'VotingStatus',
  new Schema(
    { email: emailField, status: { type: String, enum: ['pending', 'confirmed'], default: 'pending' } },
    { collection: 'votingstatus', timestamps: true, versionKey: false },
  ),
);

// Emails that have completed voting. The unique index is what makes double voting impossible.
// No timestamp is stored, on purpose, so it cannot be matched against ballot timing.
export const SuccessfulVote = model(
  'SuccessfulVote',
  new Schema({ email: emailField }, { collection: 'successfulvotes', timestamps: false, versionKey: false }),
);

// Anonymous ballots: no email, no voter reference, no timestamp.
// A random UUID is used as _id because a Mongo ObjectId embeds its creation time.
export const Ballot = model(
  'Ballot',
  new Schema(
    {
      _id: { type: String, default: () => crypto.randomUUID() },
      post: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
      candidate: { type: Schema.Types.ObjectId, ref: 'Nomination', required: true },
    },
    { collection: 'ballots', timestamps: false, versionKey: false },
  ),
);

const otpSchema = new Schema(
  {
    email: { type: String, required: true },
    purpose: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'otps', versionKey: false },
);
otpSchema.index({ email: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // clean up stale records
export const Otp = model('Otp', otpSchema);

export const Setting = model(
  'Setting',
  new Schema(
    {
      _id: { type: String },
      nominationsOpen: { type: Boolean, default: true },
      // not_started -> open -> closed. "closed" is final.
      votingState: { type: String, enum: ['not_started', 'open', 'closed'], default: 'not_started' },
    },
    { collection: 'settings', versionKey: false },
  ),
);

export function getSettings() {
  return Setting.findOneAndUpdate(
    { _id: 'election' },
    { $setOnInsert: { nominationsOpen: true, votingState: 'not_started' } },
    { upsert: true, new: true },
  );
}

export const AuditLog = model(
  'AuditLog',
  new Schema(
    {
      actor: { type: String, required: true },
      action: { type: String, required: true },
      detail: { type: String, default: '' },
    },
    { collection: 'auditlog', timestamps: { createdAt: 'at', updatedAt: false }, versionKey: false },
  ),
);

export function audit(actor, action, detail = '') {
  return AuditLog.create({ actor, action, detail }).catch((err) => console.error('Audit log failed:', err.message));
}
