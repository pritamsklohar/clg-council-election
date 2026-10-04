import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const make = (limit, windowMinutes) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  });

export const apiLimiter = make(config.rateLimit.api, 15);
export const otpRequestLimiter = make(config.rateLimit.otpRequests, 15);
export const otpVerifyLimiter = make(config.rateLimit.otpVerify, 15);
