import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

const ISSUER = 'college-voting';

export function signToken(payload, minutes) {
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: minutes * 60,
    issuer: ISSUER,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER });
}
