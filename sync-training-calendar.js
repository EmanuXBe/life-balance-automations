// sync-training-calendar.js
// Runs in GitHub Actions. Mirrors the Notion training sessions DB
// into the Google "Personal" calendar, so the same sessions show up in
// Google Calendar, Apple Calendar and Notion Calendar.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE-WAY SYNC: Notion is the source of truth.
//   • Each session becomes one event whose Google event id IS the Notion page
//     id (32 hex chars are valid base32hex) → re-runs update, never duplicate.
//   • Date-only sessions get the default training slot (6:00–7:30 AM Bogotá).
//   • Sessions deleted in Notion (or whose date was cleared) are removed from
//     the calendar. Only events tagged source=notion-training are ever touched.
//   • The calendar is always in English. Property names and select values are
//     read in English first, Spanish as fallback (the tracker was built in
//     Spanish), so renaming the Notion schema never breaks the sync.
//
// AUTH: a Google service account (no deps — JWT signed with node:crypto).
// The Personal calendar must be shared with the service account's email with
// "Make changes to events".
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const SESSIONS_DB_ID = process.env.NOTION_SESSIONS_DB_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const DRY_RUN = process.env.DRY_RUN === '1';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TZ = 'America/Bogota';
const TZ_OFFSET = '-05:00';                  // Bogotá has no DST
const DEFAULT_START = '06:00';
const DEFAULT_MINUTES = 90;
const LOOKBACK_DAYS = 30;                    // older sessions are left alone
const SOURCE_TAG = 'notion-training';

// Property names: English first, Spanish fallback.
const PROPS = {
  date: ['Date', 'Fecha'],
  status: ['Status', 'Estado'],
  plan: ['Plan Day', 'Día del plan'],
  minutes: ['Duration (min)', 'Duración min'],
  title: ['Session', 'Sesión'],
  notes: ['Notes', 'Notas'],
};

// Google Calendar colorIds: 6 Tangerine · 10 Basil · 8 Graphite
const STATUSES = [
  { values: ['Planned', 'Planeada'], label: 'Planned', suffix: '', colorId: '6' },
  { values: ['Done', 'Completada'], label: 'Done', suffix: ' ✓', colorId: '10' },
  { values: ['Skipped', 'Saltada'], label: 'Skipped', suffix: ' (skipped)', colorId: '8' },
];

const PLAN_LABELS = {
  'Empuje': 'Push',
  'Tirón': 'Pull',
  'Pierna A': 'Legs A',
  'Superior': 'Upper Body',
  'Pierna B': 'Legs B',
  'Deporte': 'Sports',
};

// ─── GOOGLE AUTH ─────────────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function getGoogleToken() {
  const sa = JSON.parse(SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token error: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gcal(token, method, path, body) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Google Calendar ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

// ─── NOTION QUERY ────────────────────────────────────────────────────────────
// No filter/sort by property name on purpose — names may be renamed; the DB is small.
async function queryNotion(cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const res = await fetch(`https://api.notion.com/v1/databases/${SESSIONS_DB_ID}/query`, {
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
const prop = (page, key) => PROPS[key].map(name => page.properties[name]).find(Boolean);
const plainText = (p) => (p?.title || p?.rich_text || []).map(t => t.plain_text).join('');

function toEvent(page) {
  const fecha = prop(page, 'date')?.date;
  const rawStatus = prop(page, 'status')?.select?.name;
  const rawPlan = prop(page, 'plan')?.select?.name;
  const minutes = prop(page, 'minutes')?.number || DEFAULT_MINUTES;
  const status = STATUSES.find(s => s.values.includes(rawStatus)) || STATUSES[0];
  const plan = PLAN_LABELS[rawPlan] || rawPlan || 'Training';

  let start, end;
  if (fecha.start.includes('T')) {
    start = new Date(fecha.start);
    end = fecha.end ? new Date(fecha.end) : new Date(start.getTime() + minutes * 60000);
  } else {
    start = new Date(`${fecha.start}T${DEFAULT_START}:00${TZ_OFFSET}`);
    end = new Date(start.getTime() + minutes * 60000);
  }

  const notes = plainText(prop(page, 'notes'));
  return {
    id: page.id.replace(/-/g, ''),
    status: 'confirmed',
    summary: `🏋️ ${plan}${status.suffix}`,
    description: [`Status: ${status.label}`, notes, `Notion: ${page.url}`].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString(), timeZone: TZ },
    end: { dateTime: end.toISOString(), timeZone: TZ },
    colorId: status.colorId,
    extendedProperties: { private: { source: SOURCE_TAG } },
  };
}

// Compare only the fields we own, with times normalized to instants.
function sameEvent(a, b) {
  return a.summary === b.summary
    && (a.description || '') === (b.description || '')
    && (a.colorId || '') === (b.colorId || '')
    && Date.parse(a.start.dateTime) === Date.parse(b.start?.dateTime)
    && Date.parse(a.end.dateTime) === Date.parse(b.end?.dateTime);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!SESSIONS_DB_ID) throw new Error('Missing NOTION_SESSIONS_DB_ID');
  if (!CALENDAR_ID) throw new Error('Missing GOOGLE_CALENDAR_ID');
  // Not configured yet → skip quietly so the */30 schedule doesn't spam failure emails.
  if (!SERVICE_ACCOUNT_JSON) {
    console.log('::warning::GOOGLE_SERVICE_ACCOUNT_JSON not set yet — skipping calendar sync.');
    return;
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

  const pages = [];
  let cursor;
  do {
    const res = await queryNotion(cursor);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  const dated = pages.filter(pg => (prop(pg, 'date')?.date?.start || '').slice(0, 10) >= since);
  const wanted = new Map(dated.map(pg => {
    const ev = toEvent(pg);
    return [ev.id, ev];
  }));
  console.log(`Fetched ${pages.length} sessions from Notion (${wanted.size} dated since ${since}).`);

  const token = await getGoogleToken();

  // Existing synced events in the same window.
  const existing = new Map();
  let pageToken;
  do {
    const qs = new URLSearchParams({
      privateExtendedProperty: `source=${SOURCE_TAG}`,
      timeMin: `${since}T00:00:00${TZ_OFFSET}`,
      maxResults: '250',
      showDeleted: 'false',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await gcal(token, 'GET', `/events?${qs}`);
    (res?.items || []).forEach(ev => existing.set(ev.id, ev));
    pageToken = res?.nextPageToken;
  } while (pageToken);

  const counts = { created: 0, updated: 0, unchanged: 0, deleted: 0 };

  for (const [id, ev] of wanted) {
    const current = existing.get(id);
    if (current && sameEvent(ev, current)) { counts.unchanged++; continue; }
    if (DRY_RUN) { console.log(`[dry-run] ${current ? 'update' : 'upsert'} ${ev.summary} @ ${ev.start.dateTime}`); continue; }
    // PUT revives an event with this id even if it was deleted before; 404 → brand new.
    const updated = await gcal(token, 'PUT', `/events/${id}`, ev);
    if (updated) { current ? counts.updated++ : counts.created++; continue; }
    await gcal(token, 'POST', '/events', ev);
    counts.created++;
  }

  for (const id of existing.keys()) {
    if (wanted.has(id)) continue;
    if (DRY_RUN) { console.log(`[dry-run] delete ${existing.get(id).summary}`); continue; }
    await gcal(token, 'DELETE', `/events/${id}`);
    counts.deleted++;
  }

  console.log(`✅ Calendar sync done${DRY_RUN ? ' (dry run)' : ''}:`, counts);
})().catch(err => { console.error(err); process.exit(1); });
