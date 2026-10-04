# College Student Council Voting System (MERN)

Email-only voting with OTP verification. The database holds **no student data** other than email addresses.

## How it works

| Who | Flow |
| --- | --- |
| **Admin** | `/admin` → email → OTP (valid 10 min) → dashboard. Adds posts (with a confirmation step), reviews nominations, opens/closes nominations and voting, sees results after voting closes. |
| **Candidate** | Home page → "Fill nomination form" on a post → email → OTP (only emails in the mail stack) → form → confirmation → emailed receipt. Admin approval sends a second email. |
| **Voter** | Home page → "Vote now" → email → OTP (only emails in the mail stack that have not voted) → ballot → confirmation → vote recorded. |

Not in the mail stack? The user sees *"You are not eligible for voting"* / *"You are not eligible for nomination"*.

### Collections

| Collection | Contents |
| --- | --- |
| `mailstack` | `{ email }`: everyone allowed to vote or be nominated. Its count is "Total voters". |
| `admins` | `{ email, isAdmin: true }` |
| `votingstatus` | `{ email, status: pending \| confirmed }`: pending when an OTP is requested, confirmed after OTP verification |
| `successfulvotes` | `{ email }`: added when a vote succeeds. Its count is "Successful votes". The unique index blocks double voting. |
| `ballots` | `{ _id (random UUID), post, candidate }`: anonymous votes, no email and no timestamp |
| `posts`, `nominations`, `otps`, `settings`, `auditlog` | Supporting data |

## Setup

Requirements: Node 18+ and MongoDB (local or a free MongoDB Atlas cluster).

```bash
# 1. Server
cd server
npm install
cp .env.example .env        # then edit it: MONGODB_URI, JWT_SECRET, OTP_SECRET

# 2. Load the mail stack and admins
npm run seed -- admin you@college.edu
npm run seed -- voters students.csv         # any file containing emails, one per line or CSV
npm run seed -- voters --email one@college.edu

# 3. Run the API (port 5000)
npm run dev

# 4. In a second terminal: the React app (port 5173)
cd client
npm install
npm run dev
```

Open http://localhost:5173.

**Emails in development:** while `SMTP_HOST` is empty, emails (including OTPs) are printed in the server terminal instead of being sent, so you can test without an email account.

**Real emails (Gmail):** turn on 2-Step Verification, create an *App Password*, then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<your gmail>`, `SMTP_PASS=<app password>`. Gmail limits daily sends, so for a large college use a transactional provider (Brevo, Amazon SES, Resend). They all work with the same Nodemailer settings.

### Running the election

1. Admin adds posts. Students nominate from the home page.
2. Admin approves nominations on the **Nominations** tab (candidate is emailed).
3. Admin closes nominations, then opens voting. Both are one-way: nominations cannot reopen once voting starts, and a closed election cannot be reopened.
4. Admin closes voting. The **Results** tab unlocks. Results are hidden until then.

### Production

```bash
cd client && npm run build            # creates client/dist
cd ../server
NODE_ENV=production npm start         # serves the API and the built React app together
```

In production the server refuses to start without real SMTP settings and 32+ character secrets. Serve it over HTTPS and set `TRUST_PROXY=1` behind a reverse proxy.

### Tests

```bash
cd server && npm test
```

Runs the full flow (OTP, nominations, approvals, voting, double-vote races, expiry, lockout, anonymity, results) against a temporary in-memory MongoDB. The first run downloads a MongoDB binary (about 100 MB).

## Security design

- **OTPs:** 6 digits from a cryptographic RNG, stored as a keyed HMAC (not plain text), single use, 5 wrong tries then locked, 60 s resend cooldown. Each OTP is bound to its purpose, so an admin OTP cannot be used to vote and a nomination OTP for one post cannot unlock another.
- **Sessions:** after OTP, a short-lived signed token (vote 20 min, nomination 30 min, admin 2 h) that works only for its own purpose. Admin access is re-checked against the `admins` collection on every request.
- **One person, one vote:** a unique index on `successfulvotes.email`; submitted ballots are claimed atomically, so parallel submissions cannot both succeed.
- **Secrecy:** ballots carry no email and no timestamp, and use random UUIDs because Mongo's default `_id` embeds creation time. Emails of voters and ballots are never joined.
- **Hardening:** rate limiting, `helmet` headers, input validation (blocks NoSQL operator injection), no OTPs in production logs, `no-store` on API responses.
- **Audit log:** admin logins, posts, approvals, phase changes and result views.

## Honest limitations

- OTP proves someone controls the inbox, not who is holding the phone. A student can still share their OTP or vote under supervision of someone else. Only supervised (lab/kiosk) voting prevents this.
- Anyone with direct database access can read or alter data. Restrict Atlas/server access to one or two trusted people and keep the audit log.
- The "not eligible" messages tell outsiders whether an email is on the voter list. That is what was specified; rate limiting slows down guessing.
- Vote submission uses one OTP (at "Vote now"), as in the specified flow. A second OTP at final submit is a small change if you want it.
- If the server crashes in the instant between recording a vote claim and storing the ballot, that voter is locked out and an admin must remove their `successfulvotes` entry. This avoids needing a MongoDB replica set. Atlas supports transactions if you prefer to wrap both writes in one.
