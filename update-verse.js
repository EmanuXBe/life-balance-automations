// update-verse.js
// Runs daily at 4 AM Bogotá via GitHub Actions (daily-updates.yml).
//
// Does three things:
//  1. Scrapes YouVersion VOTD page for verse text + image (OpenGraph)
//  2. PATCHes the 📖 callout on your Life Balance Notion page
//  3. Writes verse.json for the GitHub Pages dashboard
//
// NOTE: The VOTD embed block update is intentionally removed.
//       Add the embed manually in Notion once: /embed → https://www.bible.com/verse-of-the-day
//       The script will never crash regardless of Notion page state.

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN?.trim();
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID?.trim();

// ─── DAY OF YEAR (Bogotá = UTC-5) ────────────────────────────────────────────

function getDayOfYear() {
  const bogota = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(bogota.getUTCFullYear(), 0, 1));
  return Math.floor((bogota - start) / 86400000) + 1;
}

// ─── VERSE SOURCES ───────────────────────────────────────────────────────────
// Primary  : OurManna JSON API — stable, key-free, returns the reference cleanly.
// Fallback : scrape YouVersion (now serves a bot-challenge page to many IPs, and
//            its <meta> tags no longer carry the reference — so we parse it out
//            of the verse text ourselves).
// Last     : the hard-coded FALLBACK rotation below.

// A leading/trailing Bible reference: "Psalms 18:2", "1 John 4:4",
// "Song of Songs 2:1", "2 Cor. 12:9-10".
const BOOK = String.raw`(?:[1-3]\s)?(?:(?:[A-Z][a-zA-Z]+|of|the)\.?\s){0,3}[A-Z][a-zA-Z]+\.?`;
const LEADING_REF_RE = new RegExp(`^\\s*(${BOOK}\\s\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?(?:,\\s?\\d{1,3})?)\\s+`);
const TRAILING_REF_RE = new RegExp(`\\s+(${BOOK}\\s\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?(?:,\\s?\\d{1,3})?)\\s*$`);

// Separate the reference from the verse text when they arrive glued together.
function splitReference(text, fallbackTitle) {
  const clean = (text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

  const lead = clean.match(LEADING_REF_RE);
  if (lead && clean.slice(lead[0].length).trim().length > 10) {
    return { text: clean.slice(lead[0].length).trim(), reference: lead[1].replace(/\s+/g, ' ').trim() };
  }

  const tail = clean.match(TRAILING_REF_RE);
  if (tail && clean.slice(0, tail.index).trim().length > 10) {
    return { text: clean.slice(0, tail.index).trim(), reference: tail[1].replace(/\s+/g, ' ').trim() };
  }

  // Only trust the scraped <title> if it actually looks like a reference.
  if (fallbackTitle && /\d+:\d+/.test(fallbackTitle) && !/verse of the day|bible app/i.test(fallbackTitle)) {
    return { text: clean, reference: fallbackTitle.replace(/\s*\(.*?\)\s*$/, '').trim() };
  }

  return { text: clean, reference: '' };
}

// ─── PRIMARY: OurManna JSON API ─────────────────────────────────────────────

async function fetchOurManna() {
  try {
    const res = await fetch('https://beta.ourmanna.com/api/v1/get/?format=json&order=daily', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const det = (await res.json())?.verse?.details;
    if (!det?.text || !det?.reference) throw new Error('Malformed response');
    console.log(`✅ OurManna: ${det.reference}`);
    return {
      text: det.text.replace(/\s+/g, ' ').trim(),
      reference: det.reference.trim(),
      version: det.version || 'NIV',
      image: null,
      source: 'ourmanna',
    };
  } catch (err) {
    console.warn(`OurManna failed (${err.message}).`);
    return null;
  }
}

// ─── FALLBACK: SCRAPE YOUVERSION VOTD ───────────────────────────────────────

function makeGetMeta(html) {
  return (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=(["'])([\\s\\S]*?)\\1`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+(?:property|name)=["']${prop}["']`, 'i'));
    if (!m) return null;
    return m[2]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/\r\n/g, '\n')
      .trim();
  };
}

async function fetchYouVersionHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!/og:description/i.test(html)) throw new Error('no og tags (bot challenge)');
  return html;
}

async function scrapeVOTD(url) {
  try {
    const getMeta = makeGetMeta(await fetchYouVersionHtml(url));
    const description = getMeta('og:description');
    if (!description) throw new Error('Missing og:description');
    const { text, reference } = splitReference(description, getMeta('og:title'));
    console.log(`✅ Scraped YouVersion: ${reference || '(no reference found)'}`);
    return { text, reference, version: 'NIV', image: getMeta('og:image'), source: 'youversion' };
  } catch (err) {
    console.warn(`YouVersion scrape failed (${err.message}).`);
    return null;
  }
}

// Best-effort: pull just the YouVersion card image to illustrate the verse.
async function fetchYouVersionImage(url) {
  try {
    return makeGetMeta(await fetchYouVersionHtml(url))('og:image') || null;
  } catch {
    return null;
  }
}

// ─── FALLBACK VERSES ─────────────────────────────────────────────────────────

const FALLBACK = [
  { text: "I can do all things through Christ who strengthens me.", reference: "Philippians 4:13" },
  { text: "Trust in the LORD with all your heart, and lean not on your own understanding.", reference: "Proverbs 3:5" },
  { text: "But seek first the kingdom of God and His righteousness.", reference: "Matthew 6:33" },
  { text: "For I know the plans I have for you, declares the LORD.", reference: "Jeremiah 29:11" },
  { text: "Be strong and courageous. Do not be afraid; do not be discouraged.", reference: "Joshua 1:9" },
  { text: "No weapon that is formed against you will prosper.", reference: "Isaiah 54:17" },
  { text: "The LORD is my shepherd; I shall not want.", reference: "Psalm 23:1" },
  { text: "Whatever you do, work at it with all your heart, as working for the Lord.", reference: "Colossians 3:23" },
  { text: "And we know that in all things God works for the good of those who love him.", reference: "Romans 8:28" },
  { text: "Commit to the LORD whatever you do, and he will establish your plans.", reference: "Proverbs 16:3" },
  { text: "For God has not given us a spirit of fear, but of power and of love and of a sound mind.", reference: "2 Timothy 1:7" },
  { text: "Be still, and know that I am God.", reference: "Psalm 46:10" },
  { text: "Delight yourself in the LORD, and he will give you the desires of your heart.", reference: "Psalm 37:4" },
  { text: "Cast all your anxiety on him because he cares for you.", reference: "1 Peter 5:7" },
  { text: "If God is for us, who can be against us?", reference: "Romans 8:31" },
  { text: "Now faith is confidence in what we hope for and assurance about what we do not see.", reference: "Hebrews 11:1" },
  { text: "Be anxious for nothing, but in everything by prayer and supplication, with thanksgiving.", reference: "Philippians 4:6" },
  { text: "I am the vine; you are the branches. If you remain in me you will bear much fruit.", reference: "John 15:5" },
  { text: "But those who hope in the LORD will renew their strength.", reference: "Isaiah 40:31" },
  { text: "I have been crucified with Christ and I no longer live, but Christ lives in me.", reference: "Galatians 2:20" },
  { text: "My grace is sufficient for you, for my power is made perfect in weakness.", reference: "2 Corinthians 12:9" },
  { text: "Do not conform to the pattern of this world, but be transformed by the renewing of your mind.", reference: "Romans 12:2" },
  { text: "This is the day the LORD has made; let us rejoice and be glad in it.", reference: "Psalm 118:24" },
  { text: "Not by might nor by power, but by my Spirit, says the LORD Almighty.", reference: "Zechariah 4:6" },
  { text: "Your word is a lamp to my feet and a light to my path.", reference: "Psalm 119:105" },
  { text: "In everything give thanks: for this is the will of God in Christ Jesus.", reference: "1 Thessalonians 5:18" },
  { text: "I praise you because I am fearfully and wonderfully made.", reference: "Psalm 139:14" },
  { text: "He who began a good work in you will carry it on to completion.", reference: "Philippians 1:6" },
  { text: "The LORD is my light and my salvation — whom shall I fear?", reference: "Psalm 27:1" },
  { text: "Greater is he that is in you, than he that is in the world.", reference: "1 John 4:4" },
];

// ─── NOTION ───────────────────────────────────────────────────────────────────

async function updateCallout(verse) {
  // Fetch page blocks
  const res = await fetch(`https://api.notion.com/v1/blocks/${NOTION_PAGE_ID}/children?page_size=100`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch blocks: ${await res.text()}`);
  const { results } = await res.json();

  // Find the 📖 callout
  const callout = results.find(b => b.type === 'callout' && b.callout?.icon?.emoji === '📖');
  if (!callout) {
    console.warn('⚠️  No 📖 callout found on Life Balance page — skipping Notion update.');
    return;
  }

  // PATCH it
  const patch = await fetch(`https://api.notion.com/v1/blocks/${callout.id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      callout: {
        rich_text: [{ type: 'text', text: { content: verse.reference ? `${verse.text}  —  ${verse.reference}` : verse.text } }],
        icon: { type: 'emoji', emoji: '📖' },
        color: 'blue_background',
      },
    }),
  });
  if (!patch.ok) throw new Error(`Failed to patch callout: ${await patch.text()}`);
  console.log('✅ 📖 Callout updated.');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!NOTION_PAGE_ID) throw new Error('Missing NOTION_PAGE_ID');

  const day = getDayOfYear();
  const votdUrl = `https://www.bible.com/verse-of-the-day?day=${day}`;
  console.log(`Day ${day} → ${votdUrl}`);

  // 1. OurManna JSON API  →  2. YouVersion scrape  →  3. hard-coded rotation
  let verse = await fetchOurManna();
  if (!verse) verse = await scrapeVOTD(votdUrl);
  if (!verse) {
    verse = { ...FALLBACK[day % FALLBACK.length], version: 'NIV', image: null, source: 'fallback' };
    console.log(`Using hard-coded fallback: ${verse.reference}`);
  }

  // Best-effort: illustrate with the YouVersion card image when we don't have one.
  if (!verse.image) verse.image = await fetchYouVersionImage(votdUrl);

  // 2. Update Notion callout (safe — only PATCHes, never POSTs)
  await updateCallout(verse);

  // 3. Write verse.json — always succeeds
  fs.writeFileSync('verse.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    day,
    votdUrl,
    text: verse.text,
    reference: verse.reference,
    image: verse.image || null,
    version: verse.version || null,
    source: verse.source,
  }, null, 2));

  console.log('✅ verse.json written.');
  console.log(`   "${verse.text.substring(0, 60)}…" — ${verse.reference}`);
})();