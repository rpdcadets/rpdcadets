// check-attendance.mjs  |  Build v1  |  2026-07-01
// Runs in GitHub Actions (see .github/workflows/attendance-reminder.yml).
// Reads the encrypted attendance log from Firebase exactly the way the site
// does, checks whether THIS week's Thursday meeting has been recorded (a real
// session or a "No meeting" marker both count), and if not, sends a reminder
// email through Formspark. No npm dependencies: Node 20 built-ins only.
//
// File location in the repo: scripts/check-attendance.mjs

const DB = 'https://rpdcadets-quartermaster-default-rtdb.firebaseio.com';
const ROOT = 'roster';
const ITERATIONS = 150000;
const TZ = 'America/Chicago';
const TRACKERS_URL = 'https://rpdcadets.com/trackers';

const PASSCODE = process.env.CADET_PASSCODE;
const FORM_ID = process.env.FORMSPARK_REMINDER_ID;
const FORCE = String(process.env.FORCE) === 'true';
const SEND_TEST = String(process.env.SEND_TEST) === 'true';

const { subtle } = globalThis.crypto;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64ToArr = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));

// ---- local-time helpers (Richardson = America/Chicago) ----
function chicagoNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get('weekday'),                       // 'Thu'
    hour: Number(get('hour')) % 24,                // 0-23
    iso: `${get('year')}-${get('month')}-${get('day')}`,
  };
}
// Same week logic as the admin console: map any date to its week's Thursday
// (weeks run Sunday through Saturday), so an off-day meeting still covers
// the week.
function thursdayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + (4 - d.getDay()));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmt(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ---- crypto (mirrors roster.js pwDecrypt / keyDecrypt) ----
async function pwDecrypt(blob, password) {
  const [h, c] = blob.split('.');
  const header = b64ToArr(h);
  const salt = header.slice(0, 16), iv = header.slice(16, 28), tag = header.slice(28, 44);
  const ct = b64ToArr(c);
  const combined = new Uint8Array(ct.length + 16);
  combined.set(ct); combined.set(tag, ct.length);
  const km = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv }, key, combined));
}
async function keyDecrypt(blob, rawKeyBytes) {
  const [ivB64, dataB64] = blob.split('.');
  const key = await subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  return dec.decode(await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToArr(ivB64) }, key, b64ToArr(dataB64)));
}

// ---- Firebase REST reads (public read path, same data the site fetches) ----
async function dbGet(path) {
  const res = await fetch(`${DB}/${ROOT}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase read failed: ${path} (${res.status})`);
  return res.json();
}

async function sendReminder(missingIso, isTest) {
  const res = await fetch(`https://submit-form.com/${FORM_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      'Reminder': (isTest ? '[TEST] ' : '') +
        'Weekly attendance has not been submitted for ' + fmt(missingIso) + '.',
      'Missing meeting date': fmt(missingIso),
      'Submit it here': TRACKERS_URL,
      'Note': 'If there was no meeting this week, an advisor can mark "No meeting" in the admin console (Attendance and Hours) to clear this.',
    }),
  });
  if (!res.ok) throw new Error(`Formspark send failed (${res.status})`);
}

async function main() {
  if (!PASSCODE) throw new Error('CADET_PASSCODE secret is not set');
  if (!FORM_ID) throw new Error('FORMSPARK_REMINDER_ID secret is not set');

  const now = chicagoNow();
  console.log(`Local time in Richardson: ${now.weekday} ${now.iso}, hour ${now.hour}`);

  // Time gate: only the firing that lands in the 10 PM hour on a Thursday
  // proceeds, so of the two UTC cron entries exactly one runs year-round.
  if (!FORCE) {
    if (now.weekday !== 'Thu' || now.hour !== 22) {
      console.log('Outside the Thursday 10 PM window. Nothing to do.');
      return;
    }
  } else {
    console.log('Time gate skipped (manual run).');
  }

  const targetThursday = thursdayOf(now.iso);
  console.log(`Checking week of Thursday ${targetThursday}...`);

  const wrapped = await dbGet('wrap/cadet');
  if (!wrapped) throw new Error('Could not read the key wrap from Firebase');
  const rosterKey = b64ToArr(await pwDecrypt(wrapped, PASSCODE));

  const blob = await dbGet('attendance');
  const all = blob ? JSON.parse(await keyDecrypt(blob, rosterKey)) : {};
  const covered = Object.values(all).some((s) => s && thursdayOf(s.date) === targetThursday);

  if (covered && !SEND_TEST) {
    console.log('This week is recorded (session or no-meeting marker). No email sent.');
    return;
  }
  if (covered && SEND_TEST) console.log('Week is recorded, but send_test was requested.');
  else console.log('No record for this week. Sending the reminder...');

  await sendReminder(targetThursday, covered && SEND_TEST);
  console.log('Reminder email sent.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
