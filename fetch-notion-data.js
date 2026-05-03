// fetch-notion-data.js
// Runs in GitHub Actions. Pulls data from Notion and writes data.json
// so the dashboard can read it without CORS issues.
//
// ─────────────────────────────────────────────────────────────────────────────
// DAILY 10 — FOUNDER STANDARD
// Philosophy: depth over quantity. Each habit is binary but the standard
// is quality, not clock-watching. Streak only continues on 10/10.
//
// AREA MAPPING (equal weight regardless of habits per area):
//   Spiritual    → Prayer
//   Physical     → Sleep Protocol + Training
//   Intellectual → Reading + Deep Work
//   Character    → Sovereign Morning + Reflection
//   Execution    → Traction Move + Tomorrow Locked
//   Leadership   → Relationship Capital
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID;

// ─── HABITS ──────────────────────────────────────────────────────────────────
const ALL_HABIT_PROPS = [
  '⛪ Prayer — Full Surrender',
  '😴 Sleep Protocol — 9:30PM / 4:30AM',
  '🏋️ Training — Output Over Comfort',
  '🚫 Sovereign Morning — Zero Inputs Before Outputs',
  '📚 Reading — 1 Insight Captured',
  '💻 Deep Work — #1 Deliverable Advanced',
  '🎯 Traction Move — Civora / Prediu',
  '🗓️ Tomorrow Locked — #1 Priority Clear',
  '🤝 Relationship Capital — 1 Person Invested',
  '✍️ Reflection — AM Intention + PM Review',
];

// ─── AREAS ───────────────────────────────────────────────────────────────────
const AREAS = [
  { label: 'Spiritual', props: ['⛪ Prayer — Full Surrender'] },
  { label: 'Physical', props: ['😴 Sleep Protocol — 9:30PM / 4:30AM', '🏋️ Training — Output Over Comfort'] },
  { label: 'Intellectual', props: ['📚 Reading — 1 Insight Captured', '💻 Deep Work — #1 Deliverable Advanced'] },
  { label: 'Character', props: ['🚫 Sovereign Morning — Zero Inputs Before Outputs', '✍️ Reflection — AM Intention + PM Review'] },
  { label: 'Execution', props: ['🎯 Traction Move — Civora / Prediu', '🗓️ Tomorrow Locked — #1 Priority Clear'] },
  { label: 'Leadership', props: ['🤝 Relationship Capital — 1 Person Invested'] },
];

// ─── TIERS ───────────────────────────────────────────────────────────────────
function getTier(score) {
  if (score === 10) return 'S';
  if (score >= 8) return 'A';
  if (score >= 6) return 'B';
  return 'C';
}

// ─── NOTION QUERY ────────────────────────────────────────────────────────────
async function queryNotion(cursor) {
  const body = { page_size: 100, sorts: [{ property: 'Fecha', direction: 'ascending' }] };
  if (cursor) body.start_cursor = cursor;
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion API error: ${await res.text()}`);
  return res.json();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getCheck(page, propName) {
  return page.properties[propName]?.checkbox ? 1 : 0;
}

function getScore(page) {
  return ALL_HABIT_PROPS.reduce((acc, p) => acc + getCheck(page, p), 0);
}

function getAreaScore(page, area) {
  const total = area.props.reduce((acc, p) => acc + getCheck(page, p), 0);
  return Math.round((total / area.props.length) * 100);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!DB_ID) throw new Error('Missing NOTION_DB_ID');

  const allPages = [];
  let cursor;
  do {
    const res = await queryNotion(cursor);
    allPages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`Fetched ${allPages.length} entries from Notion.`);

  const scores = allPages.map(p => getScore(p));
  const daysLogged = scores.length;

  const tierCounts = { S: 0, A: 0, B: 0, C: 0 };
  scores.forEach(s => tierCounts[getTier(s)]++);
  const perfectDays = tierCounts.S;

  let streak = 0;
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] === 10) streak++;
    else break;
  }

  let bestStreak = 0, cur = 0;
  for (const s of scores) {
    cur = s === 10 ? cur + 1 : 0;
    if (cur > bestStreak) bestStreak = cur;
  }

  const last7 = scores.slice(-7);
  const avg7 = last7.length > 0
    ? Math.round((last7.reduce((a, b) => a + b, 0) / last7.length) * 10) / 10
    : 0;

  const sDaysLast7 = last7.filter(s => s === 10).length;

  const prev7 = scores.slice(-14, -7);
  const prevAvg = prev7.length > 0
    ? prev7.reduce((a, b) => a + b, 0) / prev7.length
    : null;
  const improvement = (prevAvg !== null && prevAvg > 0)
    ? Math.round(((avg7 - prevAvg) / prevAvg) * 100)
    : null;

  const scoreDist = Array(11).fill(0);
  scores.forEach(s => scoreDist[s]++);

  const areaAvgs = AREAS.map(area => {
    const vals = allPages.map(p => getAreaScore(p, area));
    return vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 0;
  });

  const areaTrends = AREAS.map(area => {
    const allVals = allPages.map(p => getAreaScore(p, area));
    const last = allVals.slice(-7);
    const prev = allVals.slice(-14, -7);
    if (last.length === 0) return 0;
    const lastAvg = last.reduce((a, b) => a + b, 0) / last.length;
    const prevAvg2 = prev.length > 0 ? prev.reduce((a, b) => a + b, 0) / prev.length : lastAvg;
    return Math.round(lastAvg - prevAvg2);
  });

  const habitRates = ALL_HABIT_PROPS.map(prop => {
    const done = allPages.filter(p => getCheck(p, prop) === 1).length;
    return { prop, rate: daysLogged > 0 ? Math.round((done / daysLogged) * 100) : 0, done };
  });

  const data = {
    updatedAt: new Date().toISOString(),
    daysLogged,
    perfectDays,
    tierCounts,
    streak,
    bestStreak,
    sDaysLast7,
    avg7,
    improvement,
    scoreDist,
    areaLabels: AREAS.map(a => a.label),
    areaAvgs,
    areaTrends,
    habitRates,
  };

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json written.');
  console.log(`Days: ${daysLogged} | S-days: ${perfectDays} | Streak: ${streak} | Best: ${bestStreak} | Avg7: ${avg7}`);
  console.log('Tiers:', tierCounts);
  console.log('Weakest habit:', [...habitRates].sort((a, b) => a.rate - b.rate)[0]?.prop);
})();