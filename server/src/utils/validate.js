import { HttpError } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[a-f0-9]{24}$/i;

export function cleanEmail(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Please enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }
  return email;
}

export function cleanOtp(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) {
    throw new HttpError(400, 'The OTP must be 6 digits.');
  }
  return value.trim();
}

export function cleanText(value, label, { min = 1, max }) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is required.`);
  const text = value.trim();
  if (text.length < min) {
    throw new HttpError(400, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
  }
  if (text.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
  return text;
}

export function cleanId(value, label = 'id') {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, `Invalid ${label}.`);
  return value;
}
