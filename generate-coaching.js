// generate-coaching.js
// Runs twice daily via GitHub Actions (generate-coaching.yml).
// Uses Gemini 2.5 Flash — requires GEMINI_API_KEY secret.
// Reads the last few journal entries straight from Notion (NOTION_TOKEN +
// NOTION_JOURNALING_DB_ID) so raw journal text is never committed to the repo.

const fs = require('fs');
const { decryptJSON } = require('./lib/crypto');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const JOURNALING_DB_ID = process.env.NOTION_JOURNALING_DB_ID;
const DATA_KEY = process.env.DATA_ENCRYPTION_KEY;

// ─── TIME (Bogotá = UTC-5, no DST) ───────────────────────────────────────────

function getBogotaHour() {
  return (new Date().getUTCHours() - 5 + 24) % 24;
}

function getTodayBogota() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─── DATA ─────────────────────────────────────────────────────────────────────

function readJSON(path, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

// Reads <name>.json if present (local dev), otherwise decrypts <name>.enc.json.
async function readData(name, fallback = {}) {
  if (fs.existsSync(`${name}.json`)) return readJSON(`${name}.json`, fallback);
  if (fs.existsSync(`${name}.enc.json`) && DATA_KEY) {
    try { return await decryptJSON(readJSON(`${name}.enc.json`), DATA_KEY); }
    catch (e) { console.warn(`Could not decrypt ${name}.enc.json: ${e.message}`); return fallback; }
  }
  return fallback;
}

// ─── JOURNAL ENTRIES FROM NOTION (never committed to the repo) ────────────────

async function notionFetch(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion API ${path}: ${await res.text()}`);
  return res.json();
}

async function getPageText(pageId) {
  const res = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
  const USER_TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'quote'];
  let text = '';
  for (const block of res.results) {
    if (!USER_TYPES.includes(block.type)) continue;
    const line = (block[block.type]?.rich_text || []).map(r => r.plain_text).join('').trim();
    if (line.startsWith('→')) {
      const content = line.replace(/^→\s*/, '').trim();
      if (content.length > 2) text += content + ' ';
    }
  }
  return text.trim();
}

// Last N dated journal entries, most recent first. Returns [] on any problem —
// the coach still works, just without journal context.
async function fetchRecentJournalEntries(limit = 3) {
  if (!NOTION_TOKEN || !JOURNALING_DB_ID) {
    console.warn('No NOTION_TOKEN / NOTION_JOURNALING_DB_ID — coaching without journal context.');
    return [];
  }
  try {
    const res = await notionFetch(`/databases/${JOURNALING_DB_ID}/query`, 'POST', {
      page_size: 12,
      sorts: [{ property: 'Fecha', direction: 'descending' }],
    });
    const entries = [];
    for (const page of res.results) {
      const date = page.properties?.['Fecha']?.date?.start
        || page.properties?.['Date']?.date?.start || null;
      if (!date) continue;
      let text = '';
      try { text = await getPageText(page.id); } catch { continue; }
      if (!text) continue;
      entries.push({ date, excerpt: text.slice(0, 600).trim() + (text.length > 600 ? '...' : '') });
      if (entries.length >= limit) break;
    }
    console.log(`Loaded ${entries.length} recent journal entries from Notion.`);
    return entries;
  } catch (e) {
    console.warn(`Could not load journal entries from Notion: ${e.message}`);
    return [];
  }
}

function buildJournalContext(journalingData, todayDate = null) {
  const entries = journalingData?.recentEntries;
  if (!entries?.length) return null;

  const lines = [];

  const relevant = todayDate
    ? [entries.find(e => e.date === todayDate), ...entries.filter(e => e.date !== todayDate)].filter(Boolean)
    : entries;

  for (const e of relevant.slice(0, 3)) {
    if (e.excerpt?.trim()) {
      lines.push(`[${e.date}]: "${e.excerpt.trim().substring(0, 300)}"`);
    }
  }

  const am = journalingData?.sectionBalance?.am?.pct;
  const pm = journalingData?.sectionBalance?.pm?.pct;
  if (am !== undefined && pm !== undefined) {
    lines.push(`Journal balance: ${am}% morning entries / ${pm}% evening entries`);
  }

  return lines.length ? lines.join('\n') : null;
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini Flash regularly returns 429 (rate) / 503 ("high demand") for a few
// seconds at a time. Those are transient — retry with backoff instead of
// failing the whole workflow (which is what was emailing you).
const MAX_ATTEMPTS = 5;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

async function callGemini(prompt, attempt = 1) {
  if (!GEMINI_KEY) throw new Error('Missing GEMINI_API_KEY secret — add it in GitHub repo Settings → Secrets');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 350,
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (err) {
    // Network-level failure (DNS, reset, timeout) — also transient.
    if (attempt < MAX_ATTEMPTS) {
      const wait = attempt * 15000;
      console.warn(`Gemini request failed (${err.message}) — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s`);
      await sleep(wait);
      return callGemini(prompt, attempt + 1);
    }
    throw err;
  }

  if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
    const wait = attempt * 15000;
    console.warn(`Gemini ${res.status} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s`);
    await sleep(wait);
    return callGemini(prompt, attempt + 1);
  }

  if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
  const parts = (await res.json()).candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought).map(p => p.text).join('').trim();
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

function buildAMPrompt(habits, journaling) {
  const journalContext = buildJournalContext(journaling);
  const habitLines = (habits.habitRates || [])
    .sort((a, b) => a.rate - b.rate)
    .map(h => `  ${h.prop}: ${h.rate}%`)
    .join('\n');

  return [
    `You are a high-performance coach for a faith-driven founder building at an elite level. You understand how physical, spiritual, and execution disciplines compound or collapse together.`,
    ``,
    `STRICT OUTPUT RULES:`,
    `- Write exactly 3 sentences, at least 90 words total`,
    `- Sentence 1: diagnose what's really breaking down and WHY — use the journal to speak to the founder's actual life, not generic patterns`,
    `- Sentence 2: name the root cause and why it matters for their trajectory`,
    `- Sentence 3: one sharp, concrete CTA — a specific behavior to execute today, not a category`,
    `- NEVER restate numbers or percentages — the founder sees the dashboard`,
    `- No greeting. No softening. No filler words.`,
    ``,
    `HABITS — 7-day completion (sorted worst to best):`,
    habitLines,
    ``,
    `Overall: ${habits.avg7}/10 avg | ${habits.streak} perfect days streak`,
    journalContext ? `\nJOURNAL (use this to understand the WHY):\n${journalContext}` : '',
    ``,
    `Diagnose → root cause → CTA. 3 sentences, minimum 90 words.`,
  ].filter(Boolean).join('\n');
}

function buildPMPrompt(habits, journaling, todayDate) {
  const journalContext = buildJournalContext(journaling, todayDate);
  const habitLines = (habits.habitRates || [])
    .sort((a, b) => a.rate - b.rate)
    .map(h => `  ${h.prop}: ${h.rate}%`)
    .join('\n');

  return [
    `You are a high-performance coach for a faith-driven founder building at an elite level. You understand how physical, spiritual, and execution disciplines compound or collapse together.`,
    ``,
    `STRICT OUTPUT RULES:`,
    `- Write exactly 3 sentences, at least 90 words total`,
    `- Sentence 1: name the real win of the day (if earned) or the real failure — use the journal to ground it in what actually happened`,
    `- Sentence 2: diagnose the root cause of what was skipped and why it matters for tomorrow`,
    `- Sentence 3: one sharp CTA — a specific behavior or decision to lock in tonight or first thing tomorrow`,
    `- NEVER restate numbers or percentages — the founder sees the dashboard`,
    `- No greeting. No softening. No filler words.`,
    ``,
    `HABITS — 7-day completion (sorted worst to best):`,
    habitLines,
    ``,
    `Today: ${habits.avg7}/10 avg | S-days this week: ${habits.sDaysLast7 ?? 0}/7 | ${habits.streak} perfect days streak`,
    journalContext ? `\nJOURNAL (use this to understand the WHY):\n${journalContext}` : '',
    ``,
    `Win/loss → root cause → CTA. 3 sentences, minimum 90 words.`,
  ].filter(Boolean).join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  const habits = await readData('data', {});
  const journaling = await readData('journaling-data', {});
  const existing = await readData('coaching', {});

  // Pull recent journal text live from Notion (not from the repo).
  journaling.recentEntries = await fetchRecentJournalEntries(3);

  const bogotaHour = getBogotaHour();
  const todayDate = getTodayBogota();
  const isAM = bogotaHour < 14;
  const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

  console.log(`Bogotá hour: ${bogotaHour} | Session: ${isAM ? 'AM' : 'PM'} | Date: ${todayDate} | Manual: ${isManual}`);

  let coachAM = existing.coachAM ?? null;
  let coachPM = existing.coachPM ?? null;

  if (existing.date !== todayDate) {
    coachAM = null; coachPM = null;
    console.log('New day — resetting coaching.');
  }

  if (isManual) {
    // Manual run: always regenerate both sessions with fresh data
    console.log('Manual run — regenerating both AM and PM...');
    coachAM = await callGemini(buildAMPrompt(habits, journaling));
    console.log('AM Coach:', coachAM);
    coachPM = await callGemini(buildPMPrompt(habits, journaling, todayDate));
    console.log('PM Coach:', coachPM);
  } else if (isAM && !coachAM) {
    console.log('Generating AM coaching via Gemini 2.5 Flash...');
    coachAM = await callGemini(buildAMPrompt(habits, journaling));
    console.log('AM Coach:', coachAM);
  } else if (!isAM && !coachPM) {
    console.log('Generating PM coaching via Gemini 2.5 Flash...');
    coachPM = await callGemini(buildPMPrompt(habits, journaling, todayDate));
    console.log('PM Coach:', coachPM);
  } else {
    console.log('Coaching already generated for this session today — skipping.');
  }

  fs.writeFileSync('coaching.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    date: todayDate,
    coachAM,
    coachPM,
  }, null, 2));

  console.log('✅ coaching.json written.');
})();