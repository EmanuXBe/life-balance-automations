// generate-coaching.js
// Runs in GitHub Actions twice daily (4:30 AM Bogotá = AM coach, 9:30 PM Bogotá = PM coach).
// Reads data.json (habits) + journaling-data.json (journal excerpts).
// Calls Claude API to generate personalized founder coaching advice.
// Writes coaching.json for the GitHub Pages dashboard.

const fs = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

// ─── TIME CONTEXT (Bogotá = UTC-5, no DST) ───────────────────────────────────

function getBogotaHour() {
  return (new Date().getUTCHours() - 5 + 24) % 24;
}

function getTodayBogota() {
  const now = new Date();
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return bogota.toISOString().slice(0, 10);
}

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────

function readJSON(path, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

function getWeakestArea(areaLabels, areaAvgs, areaTrends) {
  // Score = avg + trend weight. Lower = more problematic.
  const scored = areaLabels.map((label, i) => ({
    label,
    avg: areaAvgs[i] ?? 0,
    trend: areaTrends?.[i] ?? 0,
    score: (areaAvgs[i] ?? 0) + (areaTrends?.[i] ?? 0) * 0.5,
  }));
  return scored.sort((a, b) => a.score - b.score)[0];
}

function getWeakestHabit(habitRates) {
  if (!habitRates?.length) return null;
  const sorted = [...habitRates].sort((a, b) => a.rate - b.rate);
  return sorted[0];
}

function getJournalExcerpt(journalingData, forDate = null) {
  const entries = journalingData?.recentEntries;
  if (!entries?.length) return null;
  if (forDate) {
    const entry = entries.find(e => e.date === forDate);
    return entry?.excerpt?.trim() || null;
  }
  return entries[0]?.excerpt?.trim() || null; // most recent
}

// ─── CLAUDE API CALL ─────────────────────────────────────────────────────────

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${await res.text()}`);
  const data = await res.json();
  return data.content[0]?.text?.trim() || '';
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

function buildAMPrompt(habits, journaling) {
  const weakArea = getWeakestArea(habits.areaLabels, habits.areaAvgs, habits.areaTrends);
  const weakHabit = getWeakestHabit(habits.habitRates);
  const excerpt = getJournalExcerpt(journaling); // most recent entry (yesterday)

  const lines = [
    `You are a direct, ruthless performance coach for an elite founder. No fluff. No greetings. 2-3 sharp sentences only.`,
    ``,
    `YESTERDAY'S PERFORMANCE:`,
    `- 7-day avg: ${habits.avg7}/10 | Current streak: ${habits.streak} perfect days`,
    `- Weakest area: ${weakArea?.label} at ${weakArea?.avg}% (trend: ${weakArea?.trend > 0 ? '+' : ''}${weakArea?.trend}%)`,
    weakHabit ? `- Most skipped habit: "${weakHabit.prop.replace(/^[^\w]+/, '')}" (${weakHabit.rate}% completion)` : '',
    excerpt ? `\nYESTERDAY'S JOURNAL EXCERPT:\n"${excerpt.substring(0, 400)}"` : '',
    ``,
    `Give morning coaching that names the exact gap, sets a clear intention, and challenges the founder to close it today. Be specific to the data.`,
  ];
  return lines.filter(Boolean).join('\n');
}

function buildPMPrompt(habits, journaling, todayDate) {
  const weakArea = getWeakestArea(habits.areaLabels, habits.areaAvgs, habits.areaTrends);
  const todayExcerpt = getJournalExcerpt(journaling, todayDate);
  const recentExcerpt = getJournalExcerpt(journaling); // fallback to most recent

  const lines = [
    `You are a direct, ruthless performance coach for an elite founder. No fluff. No greetings. 2-3 sharp sentences only.`,
    ``,
    `TODAY'S PERFORMANCE:`,
    `- 7-day avg: ${habits.avg7}/10 | Streak: ${habits.streak} perfect days`,
    `- Weakest area: ${weakArea?.label} at ${weakArea?.avg}% (trend: ${weakArea?.trend > 0 ? '+' : ''}${weakArea?.trend}%)`,
    `- S-days this week: ${habits.sDaysLast7 ?? 0}/7`,
    (todayExcerpt || recentExcerpt) ? `\nTODAY'S JOURNAL:\n"${(todayExcerpt || recentExcerpt).substring(0, 400)}"` : '',
    ``,
    `Give an honest evening debrief: acknowledge what was won, name what was lost, and give the single most important intention for tomorrow. Be specific.`,
  ];
  return lines.filter(Boolean).join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const habits    = readJSON('data.json', {});
  const journaling = readJSON('journaling-data.json', {});
  const existing  = readJSON('coaching.json', {});

  const bogotaHour = getBogotaHour();
  const todayDate  = getTodayBogota();
  const isAM = bogotaHour < 14; // Before 2PM Bogotá = morning/midday window

  console.log(`Bogotá hour: ${bogotaHour} | Session: ${isAM ? 'AM' : 'PM'} | Date: ${todayDate}`);

  let coachAM = existing.coachAM ?? null;
  let coachPM = existing.coachPM ?? null;
  const existingDate = existing.date;

  // Reset daily at midnight Bogotá
  if (existingDate !== todayDate) {
    coachAM = null;
    coachPM = null;
    console.log('New day — resetting coaching.');
  }

  if (isAM && !coachAM) {
    console.log('Generating AM coaching...');
    const prompt = buildAMPrompt(habits, journaling);
    coachAM = await callClaude(prompt);
    console.log('AM Coach:', coachAM);
  } else if (!isAM && !coachPM) {
    console.log('Generating PM coaching...');
    const prompt = buildPMPrompt(habits, journaling, todayDate);
    coachPM = await callClaude(prompt);
    console.log('PM Coach:', coachPM);
  } else {
    console.log('Coaching already generated for this session today, skipping API call.');
  }

  const output = {
    updatedAt: new Date().toISOString(),
    date: todayDate,
    coachAM,
    coachPM,
  };

  fs.writeFileSync('coaching.json', JSON.stringify(output, null, 2));
  console.log('✅ coaching.json written.');
})();
