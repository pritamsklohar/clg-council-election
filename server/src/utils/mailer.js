import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

// Used only when MAIL_MODE=memory (automated tests).
export const outbox = [];

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  if (config.mailMode === 'memory') {
    outbox.push({ to, subject, text });
    return;
  }
  if (config.mailMode === 'console') {
    console.log(`\n--- EMAIL (console mode, not actually sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------------------------------------\n`);
    return;
  }
  await getTransporter().sendMail({ from: config.mailFrom, to, subject, text, html });
}
