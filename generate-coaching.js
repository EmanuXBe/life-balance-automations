// generate-coaching.js
// Runs twice daily via GitHub Actions (generate-coaching.yml).
// Uses Gemini 2.5 Flash — requires GEMINI_API_KEY secret.

const fs = require('fs');

const GEMINI_KEY = process.env.GEMINI_API_KEY;

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

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('Missing GEMINI_API_KEY secret — add it in GitHub repo Settings → Secrets');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`);
  return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
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
    `- NEVER restate numbers or percentages — the founder already sees their dashboard`,
    `- Cross-reference the journal entries with the habit failures: what the founder WROTE reveals WHY the habits are breaking down — use that to give coaching that speaks to their real life, not generic advice`,
    `- Find the ROOT CAUSE or PATTERN connecting the journal and the habit data`,
    `- Give exactly ONE concrete action for today — a specific behavior, not a category`,
    `- 2-3 sentences max. No greeting. No softening. No generic advice.`,
    ``,
    `HABITS — 7-day completion (sorted worst to best):`,
    habitLines,
    ``,
    `Overall: ${habits.avg7}/10 avg | ${habits.streak} perfect days streak`,
    journalContext ? `\nJOURNAL (use this to understand the WHY):\n${journalContext}` : '',
    ``,
    `What does the journal reveal about why these habits are breaking down? Give one action that fixes the root cause today.`,
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
    `- NEVER restate numbers or percentages — the founder already sees their dashboard`,
    `- Cross-reference the journal entries with the habit failures: what the founder WROTE reveals WHY the habits are breaking down — use that to give coaching that speaks to their real life, not generic advice`,
    `- Name the real win (if earned), diagnose the root cause of what was skipped, give ONE intention for tomorrow`,
    `- 2-3 sentences max. No greeting. No softening. No generic advice.`,
    ``,
    `HABITS — 7-day completion (sorted worst to best):`,
    habitLines,
    ``,
    `Today: ${habits.avg7}/10 avg | S-days this week: ${habits.sDaysLast7 ?? 0}/7 | ${habits.streak} perfect days streak`,
    journalContext ? `\nJOURNAL (use this to understand the WHY):\n${journalContext}` : '',
    ``,
    `What does the journal reveal about today? Name the real win, the real loss, and the one intention for tomorrow.`,
  ].filter(Boolean).join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  const habits = readJSON('data.json', {});
  const journaling = readJSON('journaling-data.json', {});
  const existing = readJSON('coaching.json', {});

  const bogotaHour = getBogotaHour();
  const todayDate = getTodayBogota();
  const isAM = bogotaHour < 14;

  console.log(`Bogotá hour: ${bogotaHour} | Session: ${isAM ? 'AM' : 'PM'} | Date: ${todayDate}`);

  let coachAM = existing.coachAM ?? null;
  let coachPM = existing.coachPM ?? null;

  if (existing.date !== todayDate) {
    coachAM = null; coachPM = null;
    console.log('New day — resetting coaching.');
  }

  if (isAM && !coachAM) {
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