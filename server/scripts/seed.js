// Usage:
//   npm run seed -- voters path/to/emails.csv     import the mail stack from a file (one email per line, or a CSV)
//   npm run seed -- voters --email a@college.edu  add a single voter email
//   npm run seed -- admin you@college.edu         give an email admin access (isAdmin = true)
import fs from 'fs';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { Admin, Voter } from '../src/models/index.js';

const EMAIL_RE = /[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+/g;
const [, , command, ...rest] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

let emails = [];
if (command === 'voters') {
  if (rest[0] === '--email' && rest[1]) {
    emails = [rest[1]];
  } else if (rest[0]) {
    if (!fs.existsSync(rest[0])) fail(`File not found: ${rest[0]}`);
    emails = fs.readFileSync(rest[0], 'utf8').match(EMAIL_RE) || [];
  } else {
    fail('Usage: npm run seed -- voters <file.csv> | --email <address>');
  }
} else if (command === 'admin') {
  if (!rest[0]) fail('Usage: npm run seed -- admin <email>');
  emails = [rest[0]];
} else {
  fail('Usage: npm run seed -- voters <file.csv|--email address> | admin <email>');
}

const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
if (unique.length === 0) fail('No valid email addresses found.');

await mongoose.connect(config.mongoUri);
const Model = command === 'admin' ? Admin : Voter;
await Model.init();

const ops = unique.map((email) => ({
  updateOne: {
    filter: { email },
    update: { $set: command === 'admin' ? { email, isAdmin: true } : { email } },
    upsert: true,
  },
}));
const result = await Model.bulkWrite(ops);
console.log(`${command}: ${result.upsertedCount} added, ${unique.length - result.upsertedCount} already existed.`);
console.log(`Total ${command === 'admin' ? 'admins' : 'voters'} in database: ${await Model.countDocuments()}`);
await mongoose.disconnect();
