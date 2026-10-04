import { config } from '../config/env.js';

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;color:#111827">
<h2 style="margin:0 0 16px">${esc(title)}</h2>${bodyHtml}
<p style="color:#6b7280;font-size:12px;margin-top:28px">${esc(config.collegeName)} Student Council Election</p></div>`;
}

export function otpEmail({ label, code, minutes }) {
  return {
    subject: `Your ${label} OTP`,
    text: `Your OTP for ${label} is ${code}.\n\nIt is valid for ${minutes} minutes and can be used only once.\nNever share this code with anyone. If you did not request it, ignore this email.`,
    html: layout(
      `Your ${label} OTP`,
      `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:8px 0">${esc(code)}</p>
<p>This code is valid for ${minutes} minutes and can be used only once.</p>
<p style="color:#b91c1c">Never share this code with anyone. If you did not request it, ignore this email.</p>`,
    ),
  };
}

export function nominationReceivedEmail({ fullName, postName }) {
  return {
    subject: `Nomination received: ${postName}`,
    text: `Hello ${fullName},\n\nYou have successfully enrolled for the nomination for the post of ${postName}.\nThe election committee will review it and you will receive another email once it is approved.`,
    html: layout(
      'Nomination received',
      `<p>Hello ${esc(fullName)},</p><p>You have successfully enrolled for the nomination for the post of <b>${esc(postName)}</b>.</p>
<p>The election committee will review it and you will receive another email once it is approved.</p>`,
    ),
  };
}

export function nominationApprovedEmail({ fullName, postName }) {
  return {
    subject: `Nomination confirmed: ${postName}`,
    text: `Hello ${fullName},\n\nYour nomination is confirmed for the post of ${postName}. Be ready for the voting session.`,
    html: layout(
      'Nomination confirmed',
      `<p>Hello ${esc(fullName)},</p><p>Your nomination is confirmed for the post of <b>${esc(postName)}</b>.</p><p>Be ready for the voting session.</p>`,
    ),
  };
}

export function nominationRejectedEmail({ fullName, postName }) {
  return {
    subject: `Nomination update: ${postName}`,
    text: `Hello ${fullName},\n\nYour nomination for the post of ${postName} was not approved. Please contact the election committee if you have questions.`,
    html: layout(
      'Nomination update',
      `<p>Hello ${esc(fullName)},</p><p>Your nomination for the post of <b>${esc(postName)}</b> was not approved.</p>
<p>Please contact the election committee if you have questions.</p>`,
    ),
  };
}
