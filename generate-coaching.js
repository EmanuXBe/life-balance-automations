// generate-coaching.js
// Runs in GitHub Actions twice daily:
//   4:30 AM Bogotá → AM coach  (cron: '30 9 * * *')
//   9:30 PM Bogotá → PM coach  (cron: '30 2 * * *')
//
// PROVIDER: set via GitHub Secret COACHING_PROVIDER = "anthropic" or "gemini"
// Default: anthropic
//
// ANTHROPIC: ANTHROPIC_API_KEY secret → claude-haiku (~$0.60/year for 2 calls/day)
// GEMINI:    GEMINI_API_KEY secret    → gemini-1.5-flash (free tier: NEW project at aistudio.google.com)

const fs = require('fs');

const PROVIDER = (process.env.COACHING_PROVIDER || 'anthropic').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ─── TIME (Bogotá = UTC-5, no DST) ───────────────────────────────────────────

function getBogotaHour() {
  return (new Date().getUTCHours() - 5 + 24) % 24;
}

function getTodayBogota() {
  const bogota = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return bogota.toISOString().slice(0, 10);
}

// ─── DATA ─────────────────────────────────────────────────────────────────────

function readJSON(path, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

function getWeakestArea(areaLabels, areaAvgs, areaTrends) {
  return (areaLabels || [])
    .map((label, i) => ({
      label,
      avg: areaAvgs?.[i] ?? 0,
      trend: areaTrends?.[i] ?? 0,
      score: (areaAvgs?.[i] ?? 0) + (areaTrends?.[i] ?? 0) * 0.5,
    }))
    .sort((a, b) => a.score - b.score)[0];
}

function getWeakestHabit(habitRates) {
  if (!habitRates?.length) return null;
  return [...habitRates].sort((a, b) => a.rate - b.rate)[0];
}

function getJournalExcerpt(journalingData, forDate = null) {
  const entries = journalingData?.recentEntries;
  if (!entries?.length) return null;
  if (forDate) return entries.find(e => e.date === forDate)?.excerpt?.trim() || null;
  return entries[0]?.excerpt?.trim() || null;
}

// ─── AI PROVIDERS ─────────────────────────────────────────────────────────────

async function callAnthropic(prompt) {
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY secret');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
  return (await res.json()).content[0]?.text?.trim() || '';
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('Missing GEMINI_API_KEY secret');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callAI(prompt) {
  console.log(`Using provider: ${PROVIDER}`);
  return PROVIDER === 'gemini' ? callGemini(prompt) : callAnthropic(prompt);
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

function buildAMPrompt(habits, journaling) {
  const weakArea = getWeakestArea(habits.areaLabels, habits.areaAvgs, habits.areaTrends);
  const weakHabit = getWeakestHabit(habits.habitRates);
  const excerpt = getJournalExcerpt(journaling);

  return [
    `You are a direct, ruthless performance coach for an elite founder. No fluff. No greetings. 2-3 sharp sentences only.`,
    ``,
    `YESTERDAY'S PERFORMANCE:`,
    `- 7-day avg: ${habits.avg7}/10 | Current streak: ${habits.streak} perfect days`,
    `- Weakest area: ${weakArea?.label} at ${weakArea?.avg}% (trend: ${weakArea?.trend >= 0 ? '+' : ''}${weakArea?.trend}%)`,
    weakHabit ? `- Most skipped habit: "${weakHabit.prop.replace(/^[^\w]+/, '')}" (${weakHabit.rate}% completion)` : '',
    excerpt ? `\nYESTERDAY'S JOURNAL:\n"${excerpt.substring(0, 400)}"` : '',
    ``,
    `Name the exact gap. Set a clear intention. Challenge the founder to close it today. Be specific to the data.`,
  ].filter(Boolean).join('\n');
}

function buildPMPrompt(habits, journaling, todayDate) {
  const weakArea = getWeakestArea(habits.areaLabels, habits.areaAvgs, habits.areaTrends);
  const todayExcerpt = getJournalExcerpt(journaling, todayDate);
  const recentExcerpt = getJournalExcerpt(journaling);

  return [
    `You are a direct, ruthless performance coach for an elite founder. No fluff. No greetings. 2-3 sharp sentences only.`,
    ``,
    `TODAY'S PERFORMANCE:`,
    `- 7-day avg: ${habits.avg7}/10 | Streak: ${habits.streak} perfect days`,
    `- Weakest area: ${weakArea?.label} at ${weakArea?.avg}% (trend: ${weakArea?.trend >= 0 ? '+' : ''}${weakArea?.trend}%)`,
    `- S-days this week: ${habits.sDaysLast7 ?? 0}/7`,
    (todayExcerpt || recentExcerpt) ? `\nTODAY'S JOURNAL:\n"${(todayExcerpt || recentExcerpt).substring(0, 400)}"` : '',
    ``,
    `Honest evening debrief: acknowledge what was won, name what was lost, give the single most important intention for tomorrow.`,
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
    console.log('Generating AM coaching…');
    coachAM = await callAI(buildAMPrompt(habits, journaling));
    console.log('AM Coach:', coachAM);
  } else if (!isAM && !coachPM) {
    console.log('Generating PM coaching…');
    coachPM = await callAI(buildPMPrompt(habits, journaling, todayDate));
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