// fetch-notion-data.js
// Runs in GitHub Actions. Pulls data from Notion and writes data.json
// so the dashboard.html can read it without CORS issues.

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID; // Daily 10 database ID — separate from NOTION_PAGE_ID

const ALL_HABIT_PROPS = [
  '⛪ Oración (45-60 min)',
  '🚲 Entrenamiento (Gym / 40km Bici)',
  '❄️ Ducha Fría',
  '😴 Apagón 9:30PM / Despertar 4:30AM',
  '📚 Lectura (10 págs)',
  '💻 Deep Work (90+ min)',
  '🚫 Pureza (Cero Alcohol / Cero Dopamina Barata)',
  '🗓️ Planificación del Día Siguiente',
  '✍️ Journaling Mañana/Noche',
  '🎹 Sesión de Música (Piano/Guitarra)',
];

const AREAS = [
  { label: 'Spiritual', props: ['⛪ Oración (45-60 min)'] },
  { label: 'Physical', props: ['🚲 Entrenamiento (Gym / 40km Bici)', '❄️ Ducha Fría', '😴 Apagón 9:30PM / Despertar 4:30AM'] },
  { label: 'Intellectual', props: ['📚 Lectura (10 págs)', '💻 Deep Work (90+ min)'] },
  { label: 'Character', props: ['🚫 Pureza (Cero Alcohol / Cero Dopamina Barata)'] },
  { label: 'Execution', props: ['🗓️ Planificación del Día Siguiente', '✍️ Journaling Mañana/Noche'] },
  { label: 'Creative', props: ['🎹 Sesión de Música (Piano/Guitarra)'] },
];

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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error: ${err}`);
  }
  return res.json();
}

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

(async () => {
  if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!DB_ID) throw new Error('Missing NOTION_DB_ID');

  // Fetch all pages
  const allPages = [];
  let cursor;
  do {
    const res = await queryNotion(cursor);
    allPages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`Fetched ${allPages.length} entries from Notion.`);

  // Scores
  const scores = allPages.map(p => getScore(p));
  const daysLogged = scores.length;

  // Perfect days
  const perfectDays = scores.filter(s => s === 10).length;

  // Streak
  let streak = 0;
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] >= 1) streak++;
    else break;
  }

  // 7-day avg
  const last7 = scores.slice(-7);
  const avg7 = last7.length > 0
    ? Math.round((last7.reduce((a, b) => a + b, 0) / last7.length) * 10) / 10
    : 0;

  // Previous 7 for improvement %
  const prev7 = scores.slice(-14, -7);
  const prevAvg = prev7.length > 0
    ? prev7.reduce((a, b) => a + b, 0) / prev7.length
    : null;
  const improvement = (prevAvg !== null && prevAvg > 0)
    ? Math.round(((avg7 - prevAvg) / prevAvg) * 100)
    : null;

  // Score distribution
  const scoreDist = Array(11).fill(0);
  scores.forEach(s => scoreDist[s]++);

  // Area averages
  const areaAvgs = AREAS.map(area => {
    const vals = allPages.map(p => getAreaScore(p, area));
    return vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 0;
  });

  const data = {
    updatedAt: new Date().toISOString(),
    daysLogged,
    perfectDays,
    streak,
    avg7,
    improvement,
    scoreDist,
    areaLabels: AREAS.map(a => a.label),
    areaAvgs,
  };

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json written successfully.');
  console.log(JSON.stringify(data, null, 2));
})();