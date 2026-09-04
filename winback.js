// winback.js
// Sends a personalised "come back" email when you've gone quiet in the
// Daily 10 / Journaling databases. Runs daily via GitHub Actions
// (winback.yml); also runnable manually with FORCE=true for a test send.
//
// The AI (Gemini 2.5 Flash) writes the message using your real history —
// streaks, 7-day average and your last journal entries (pulled live from
// Notion, never from the repo).

const fs = require('fs');

const GEMINI_KEY       = process.env.GEMINI_API_KEY;
const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const DAILY10_DB_ID    = process.env.NOTION_DB_ID;
const JOURNALING_DB_ID = process.env.NOTION_JOURNALING_DB_ID;
const SMTP_USER        = process.env.SMTP_USER;

const FORCE          = /^(1|true|yes)$/i.test(process.env.FORCE || '');
const THRESHOLD_DAYS = parseInt(process.env.WINBACK_THRESHOLD_DAYS || '3', 10); // silence before the first nudge
const MIN_GAP_DAYS   = parseInt(process.env.WINBACK_MIN_GAP_DAYS   || '3', 10); // don't email more often than this

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function readJSON(p, fb = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; }
}
function setOutput(k, v) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}

// ─── NOTION ──────────────────────────────────────────────────────────────────

async function notion(path, method = 'GET', body = null) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Notion ${path}: ${await r.text()}`);
  return r.json();
}

async function lastEntryDate(dbId) {
  if (!dbId) return null;
  try {
    const r = await notion(`/databases/${dbId}/query`, 'POST', {
      page_size: 1,
      sorts: [{ property: 'Fecha', direction: 'descending' }],
    });
    const p = r.results?.[0];
    return p?.properties?.Fecha?.date?.start || p?.properties?.Date?.date?.start || null;
  } catch (e) {
    console.warn(`lastEntryDate(${dbId}): ${e.message}`);
    return null;
  }
}

async function getPageText(id) {
  const r = await notion(`/blocks/${id}/children?page_size=100`);
  const TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'quote'];
  let t = '';
  for (const b of r.results) {
    if (!TYPES.includes(b.type)) continue;
    const line = (b[b.type]?.rich_text || []).map((x) => x.plain_text).join('').trim();
    if (line.startsWith('→')) {
      const c = line.replace(/^→\s*/, '').trim();
      if (c.length > 2) t += c + ' ';
    }
  }
  return t.trim();
}

async function recentJournal(limit = 2) {
  if (!JOURNALING_DB_ID) return [];
  try {
    const r = await notion(`/databases/${JOURNALING_DB_ID}/query`, 'POST', {
      page_size: 10,
      sorts: [{ property: 'Fecha', direction: 'descending' }],
    });
    const out = [];
    for (const p of r.results) {
      const d = p.properties?.Fecha?.date?.start || p.properties?.Date?.date?.start;
      if (!d) continue;
      let txt = '';
      try { txt = await getPageText(p.id); } catch { continue; }
      if (txt) out.push({ date: d, excerpt: txt.slice(0, 500).trim() });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn(`recentJournal: ${e.message}`);
    return [];
  }
}

// ─── GEMINI ──────────────────────────────────────────────────────────────────

async function gemini(prompt, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.85, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } catch (err) {
    if (attempt < 5) { await sleep(attempt * 15000); return gemini(prompt, attempt + 1); }
    throw err;
  }
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 5) {
    console.warn(`Gemini ${res.status} — retry ${attempt} in ${attempt * 15}s`);
    await sleep(attempt * 15000);
    return gemini(prompt, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const parts = (await res.json()).candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => !p.thought).map((p) => p.text).join('').trim();
}

function buildPrompt({ daysInactive, habits, journal }) {
  const j = journal.map((e) => `[${e.date}] "${e.excerpt}"`).join('\n') || '(no recent journal entries on record)';
  const best = habits?.bestStreak ?? 0;
  const sDays = habits?.perfectDays ?? 0;
  const avg = habits?.avg7 ?? 0;
  return [
    `You are this person's Founder & CEO coach — the voice they hired to hold their standard when motivation fails. Faith-driven, direct, warm but with an edge. You are writing a short email because they have gone quiet on their own system.`,
    ``,
    `SITUATION`,
    `- Days since their last logged day: ${daysInactive}`,
    `- Lifetime perfect (10/10) days: ${sDays} | best streak: ${best} days | 7-day average before they stopped: ${avg}/10`,
    `- They have told their team they are "about to restart".`,
    ``,
    `THEIR LAST JOURNAL ENTRIES`,
    j,
    ``,
    `WRITE THE EMAIL`,
    `- Line 1 must be exactly: SUBJECT: <6-9 word subject line, direct, no clickbait, no emoji>`,
    `- Then one blank line, then the body: 110-170 words, exactly 2 short paragraphs.`,
    `- Paragraph 1: name what is really happening (they drifted — that is human) and tie it to something concrete from their journal: their own words, their own goals. No shame, no lecture.`,
    `- Paragraph 2: give ONE specific tiny action for TODAY that re-opens the system (e.g. open the Daily 10 and check a single box tonight). Close with one sharp sentence that reminds them who they said they want to become.`,
    `- Address them as "you". No greeting, no "Dear", no sign-off, no name. Plain text only — no markdown, no bullet points.`,
  ].join('\n');
}

// ─── EMAIL FILE (consumed by curl in the workflow) ──────────────────────────

function rfc2822Date(d = new Date()) { return d.toUTCString().replace('GMT', '+0000'); }
function encodeSubject(s) { return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`; }

function buildEml({ from, to, subject, body }) {
  const b = body.replace(/\r?\n/g, '\r\n').replace(/^\./, '..').replace(/\r\n\./g, '\r\n..');
  return [
    `From: Life Balance Coach <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${rfc2822Date()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    b,
    ``,
  ].join('\r\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  for (const [k, v] of Object.entries({ GEMINI_API_KEY: GEMINI_KEY, NOTION_TOKEN, SMTP_USER })) {
    if (!v) throw new Error(`Missing ${k}`);
  }

  const today = todayBogota();
  const [d10Date, journalDate] = await Promise.all([
    lastEntryDate(DAILY10_DB_ID),
    lastEntryDate(JOURNALING_DB_ID),
  ]);
  const lastActive = [d10Date, journalDate].filter(Boolean).sort().pop() || null;
  const daysInactive = lastActive ? daysBetween(lastActive, today) : 999;
  console.log(`Last active: ${lastActive || 'never'} | days inactive: ${daysInactive} | force: ${FORCE}`);

  const state = readJSON('winback.json', {});
  const gapOK = !state.lastSentAt || daysBetween(state.lastSentAt.slice(0, 10), today) >= MIN_GAP_DAYS;

  if (!FORCE) {
    if (daysInactive < THRESHOLD_DAYS) { console.log('Still active — nothing to send.'); setOutput('send', 'false'); return; }
    if (!gapOK) { console.log(`Last emailed ${state.lastSentAt} — within ${MIN_GAP_DAYS}-day gap, skipping.`); setOutput('send', 'false'); return; }
  }

  const habits = readJSON('data.json', {});
  const journal = await recentJournal(2);
  const raw = await gemini(buildPrompt({ daysInactive, habits, journal }));

  const m = raw.match(/^\s*SUBJECT:\s*(.+?)\s*\n([\s\S]+)$/i);
  const subject = (m ? m[1] : 'About that restart you mentioned').trim();
  const body = (m ? m[2] : raw).trim();
  const finalSubject = FORCE ? `[prueba] ${subject}` : subject;

  fs.writeFileSync('email.eml', buildEml({ from: SMTP_USER, to: SMTP_USER, subject: finalSubject, body }));
  console.log(`\n────────────────────────\nSubject: ${finalSubject}\n\n${body}\n────────────────────────\n`);
  setOutput('send', 'true');

  if (!FORCE) {
    fs.writeFileSync('winback.json', JSON.stringify({
      lastSentAt: new Date().toISOString(),
      lastSentForInactiveDays: daysInactive,
      lastActive,
    }, null, 2));
    setOutput('commit_state', 'true');
  }
})();
