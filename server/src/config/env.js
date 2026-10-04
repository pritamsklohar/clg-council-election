import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be a number`);
  return value;
}

const jwtSecret = need('JWT_SECRET');
const otpSecret = need('OTP_SECRET');

if (isProd && (jwtSecret.length < 32 || otpSecret.length < 32)) {
  throw new Error('JWT_SECRET and OTP_SECRET must be at least 32 characters in production');
}

// smtp  -> real emails via Nodemailer
// console -> prints emails (including OTPs) to the terminal, development only
// memory  -> keeps emails in an array, used by the automated tests
const mailMode = process.env.MAIL_MODE || (process.env.SMTP_HOST ? 'smtp' : 'console');
if (isProd && mailMode !== 'smtp') {
  throw new Error('Set SMTP_HOST, SMTP_USER and SMTP_PASS: real email delivery is required in production');
}

export const config = {
  isProd,
  port: num('PORT', 5000),
  mongoUri: need('MONGODB_URI'),
  jwtSecret,
  otpSecret,
  clientOrigin: process.env.CLIENT_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0,
  collegeName: process.env.COLLEGE_NAME || 'College',

  mailMode,
  smtp: {
    host: process.env.SMTP_HOST,
    port: num('SMTP_PORT', 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com',

  otpMinutes: {
    vote: num('VOTE_OTP_MINUTES', 5),
    nomination: num('NOMINATION_OTP_MINUTES', 5),
    admin: num('ADMIN_OTP_MINUTES', 10),
  },
  otpMaxAttempts: num('OTP_MAX_ATTEMPTS', 5),
  otpResendCooldownSeconds: num('OTP_RESEND_COOLDOWN_SECONDS', 60),

  sessionMinutes: {
    vote: 20,
    nomination: 30,
    admin: 120,
  },

  rateLimit: {
    otpRequests: num('RATE_LIMIT_OTP_REQUESTS', 10),
    otpVerify: num('RATE_LIMIT_OTP_VERIFY', 30),
    api: num('RATE_LIMIT_API', 600),
  },
};
