import { Admin } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { verifyToken } from '../utils/tokens.js';

/** Requires a valid Bearer token that was issued for exactly this purpose ("vote", "nomination", "admin"). */
export function requireToken(purpose) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new HttpError(401, 'Please verify your email with an OTP first.'));
    }
    try {
      const payload = verifyToken(token);
      if (payload.purpose !== purpose) throw new Error('wrong purpose');
      req.auth = payload;
      return next();
    } catch {
      return next(new HttpError(401, 'Your session has expired. Please verify your email again.'));
    }
  };
}

/** Admin token + the email must still be in the admin collection on every request. */
export const requireAdmin = [
  requireToken('admin'),
  asyncHandler(async (req, res, next) => {
    const admin = await Admin.exists({ email: req.auth.email, isAdmin: true });
    if (!admin) throw new HttpError(403, 'Admin access has been removed for this email.');
    next();
  }),
];
