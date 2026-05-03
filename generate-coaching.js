// generate-coaching.js
// Runs twice daily via GitHub Actions (generate-coaching.yml).
// Uses Gemini 1.5 Flash — requires GEMINI_API_KEY secret.

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

// ─── GEMINI ───────────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('Missing GEMINI_API_KEY secret — add it in GitHub repo Settings → Secrets');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`;
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
    console.log('Generating AM coaching via Gemini 1.5 Flash...');
    coachAM = await callGemini(buildAMPrompt(habits, journaling));
    console.log('AM Coach:', coachAM);
  } else if (!isAM && !coachPM) {
    console.log('Generating PM coaching via Gemini 1.5 Flash...');
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