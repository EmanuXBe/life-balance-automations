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

// The coaching method below is drawn from Jairo Palacios, "Neuro-marketing y
// Branding para nuevos emprendedores" (P. U. Javeriana) — applied to self-
// motivation instead of selling.
function buildPrompt({ daysInactive, habits, journal }) {
  const j = journal.map((e) => `[${e.date}] "${e.excerpt}"`).join('\n') || '(no recent journal entries on record)';
  const best = habits?.bestStreak ?? 0;
  const sDays = habits?.perfectDays ?? 0;
  const avg = habits?.avg7 ?? 0;
  return [
    `You are this founder's personal Founder & CEO coach — the voice they hired to hold their standard when motivation fails. Faith-driven, direct, warm, with fire. You are writing a short re-engagement email because they have gone quiet on their own system, "The Daily 10".`,
    ``,
    `HOW THE BRAIN YOU ARE WRITING TO ACTUALLY WORKS (apply every point):`,
    `- ~95% of decisions are emotional and subconscious; the rational mind only justifies afterward. Lead with emotion and identity, not data.`,
    `- Dopamine rewards ANTICIPATION and small wins. Make the person they are becoming vivid, and make the single action feel like a win they collect tonight.`,
    `- Primacy & recency: the first sentence and the last sentence are what they remember. Both must land.`,
    `- Story beats facts. Use THEIR own words and history as the story — quote their journal.`,
    `- Real scarcity, never fake: drift genuinely compounds. Name the true cost of another week lost — without shame.`,
    `- Anchoring: anchor against their best self (their perfect days, their best streak) so one checkbox tonight feels small by comparison.`,
    `- Commitment & identity: they told their team they would restart. Hold them to the person they said they would be.`,
    `- Less friction = decision. Give exactly ONE action, never a list.`,
    `- Never restate raw numbers — they see the dashboard. Make them FEEL resolve and hope; the behaviour follows the feeling.`,
    ``,
    `SITUATION`,
    `- Days since their last logged day: ${daysInactive}`,
    `- Lifetime perfect (10/10) days: ${sDays} | best streak: ${best} days | 7-day average before they stopped: ${avg}/10`,
    `- They have told their team they are "about to restart".`,
    ``,
    `THEIR LAST JOURNAL ENTRIES`,
    j,
    ``,
    `OUTPUT — follow this exact structure and nothing else:`,
    `SUBJECT_ES: <Spanish subject, 5-8 words, direct, motivating, no emoji, no clickbait>`,
    `SUBJECT_EN: <English subject, 5-8 words, same spirit>`,
    `===ES===`,
    `<Spanish body: exactly 2 paragraphs, 80-130 words total. Paragraph 1: name what is really happening (they drifted — human, no shame) tied to something concrete from their journal, in their words. Paragraph 2: ONE tiny action for TODAY that reopens the system (e.g. "abre el Daily 10 y marca una sola casilla esta noche"), then one sharp closing line about who they said they would become.>`,
    `===EN===`,
    `<English body: same message, NOT a literal translation, same 2-paragraph structure and length.>`,
    ``,
    `No greeting, no "Dear", no sign-off, no name, no markdown, no bullet points.`,
  ].join('\n');
}

// ─── EMAIL FILE (multipart/alternative, consumed by curl in the workflow) ────

const HERO_IMG = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=70&auto=format&fit=crop';

function rfc2822Date(d = new Date()) { return d.toUTCString().replace('GMT', '+0000'); }
function encodeSubject(s) { return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`; }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paras = (s) => String(s).split(/\n\s*\n+/).map((p) => p.trim().replace(/\s*\n\s*/g, ' ')).filter(Boolean);

function htmlPart({ headline, bodyEs, bodyEn, daysInactive }) {
  const pEs = paras(bodyEs).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join('');
  const pEn = paras(bodyEn).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join('');
  return `<div style="margin:0;padding:0;background:#0f1115;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1115;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#16181d;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td><img src="${HERO_IMG}" width="600" alt="" style="display:block;width:100%;height:180px;object-fit:cover;"></td></tr>
<tr><td style="padding:28px 30px 6px;">
<div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#8a94a6;">Life Balance &middot; Founder Standard</div>
<div style="font-size:22px;line-height:1.32;font-weight:700;color:#f2f4f8;margin-top:10px;">${esc(headline)}</div>
</td></tr>
<tr><td style="padding:14px 30px 2px;color:#c9d1de;font-size:15px;line-height:1.65;">${pEs}</td></tr>
<tr><td style="padding:6px 30px 0;"><div style="height:1px;background:#262a31;"></div>
<div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#8a94a6;margin-top:18px;">English</div></td></tr>
<tr><td style="padding:6px 30px 2px;color:#aab3c0;font-size:14px;line-height:1.65;">${pEn}</td></tr>
<tr><td style="padding:20px 30px 30px;"><div style="font-size:12px;color:#6b7484;">D&iacute;a ${daysInactive} sin registrar &middot; tu sistema sigue aqu&iacute;. Una casilla esta noche.</div></td></tr>
</table></td></tr></table></div>`;
}

function textPart({ headline, bodyEs, bodyEn, daysInactive }) {
  return [
    headline.toUpperCase(), '', bodyEs, '',
    '— — — — — — — — — —', '',
    bodyEn, '',
    `Life Balance · Día ${daysInactive} sin registrar · una casilla esta noche.`,
  ].join('\n');
}

function buildEml({ from, to, subject, headline, bodyEs, bodyEn, daysInactive }) {
  const boundary = 'LB_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const raw = [
    `From: Life Balance Coach <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${rfc2822Date()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    textPart({ headline, bodyEs, bodyEn, daysInactive }),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    htmlPart({ headline, bodyEs, bodyEn, daysInactive }),
    ``,
    `--${boundary}--`,
    ``,
  ].join('\n');
  return raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'); // CRLF + SMTP dot-stuffing
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

  const subjEs = (raw.match(/SUBJECT_ES:\s*(.+)/i)?.[1] || 'Tu sistema te está esperando').trim();
  const subjEn = (raw.match(/SUBJECT_EN:\s*(.+)/i)?.[1] || 'Your system is waiting for you').trim();
  const esBlock = (raw.split(/===\s*EN\s*===/i)[0].split(/===\s*ES\s*===/i)[1] || '').trim();
  const enBlock = (raw.split(/===\s*EN\s*===/i)[1] || '').trim();
  const bodyEs = esBlock || raw.trim();
  const bodyEn = enBlock;
  const subject = (FORCE ? '[prueba] ' : '') + subjEs;

  fs.writeFileSync('email.eml', buildEml({
    from: SMTP_USER, to: SMTP_USER, subject,
    headline: subjEs, bodyEs, bodyEn, daysInactive,
  }));
  console.log(`\n──────── ${subject} ────────\n[ES] ${subjEs}\n${bodyEs}\n\n[EN] ${subjEn}\n${bodyEn}\n────────\n`);
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
