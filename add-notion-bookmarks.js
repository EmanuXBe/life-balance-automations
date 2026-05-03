// update-verse.js
// Runs daily at 4 AM Bogotá via GitHub Actions (daily-updates.yml).
//
// SETUP REQUIREMENT: run add-notion-bookmarks.js once locally to create
// the VOTD embed block on your Life Balance page. After that, this script
// only PATCHes the existing block — no POSTing needed.
//
// What it does each day:
//  1. Calculates day-of-year → constructs YouVersion VOTD URL
//  2. Scrapes YouVersion OpenGraph meta for verse text + image
//  3. Updates the 📖 callout (verse text)
//  4. Updates the VOTD embed block URL to today's day
//  5. Writes verse.json for the dashboard

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID?.trim(); // trim whitespace/newlines

// ─── DAY OF YEAR (Bogotá = UTC-5) ────────────────────────────────────────────

function getDayOfYear() {
  const now = new Date();
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const year = bogota.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  return Math.floor((bogota - start) / 86400000) + 1;
}

function getVotdUrl(day) {
  return `https://www.bible.com/verse-of-the-day?day=${day}`;
}

// ─── SCRAPE YOUVERSION VOTD (OpenGraph) ──────────────────────────────────────

async function scrapeVOTD(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LifeBalanceDashboard/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const getMeta = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
      return m ? m[1].replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).trim() : null;
    };

    const title = getMeta('og:title');
    const description = getMeta('og:description');
    const image = getMeta('og:image');

    if (description && title) {
      console.log(`✅ Scraped YouVersion: ${title}`);
      return { text: description, reference: title, image, version: 'NIV', source: 'youversion' };
    }
    throw new Error('Missing og:description or og:title');
  } catch (err) {
    console.warn(`Scraping failed (${err.message}), using fallback.`);
    return null;
  }
}

// ─── FALLBACK VERSES ─────────────────────────────────────────────────────────

const FALLBACK_VERSES = [
  { text: "I can do all things through Christ who strengthens me.", reference: "Philippians 4:13" },
  { text: "Trust in the LORD with all your heart, and lean not on your own understanding.", reference: "Proverbs 3:5" },
  { text: "But seek first the kingdom of God and His righteousness, and all these things shall be added to you.", reference: "Matthew 6:33" },
  { text: "For I know the plans I have for you, declares the LORD, plans to prosper you and not to harm you.", reference: "Jeremiah 29:11" },
  { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you.", reference: "Joshua 1:9" },
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
  { text: "Be anxious for nothing, but in everything by prayer and supplication, with thanksgiving, let your requests be made known to God.", reference: "Philippians 4:6" },
  { text: "The fear of the LORD is the beginning of wisdom.", reference: "Proverbs 9:10" },
  { text: "Whatever is true, whatever is noble, whatever is right — think about such things.", reference: "Philippians 4:8" },
  { text: "I am the vine; you are the branches. If you remain in me and I in you, you will bear much fruit.", reference: "John 15:5" },
  { text: "But those who hope in the LORD will renew their strength. They will soar on wings like eagles.", reference: "Isaiah 40:31" },
  { text: "Ask and it will be given to you; seek and you will find; knock and the door will be opened.", reference: "Matthew 7:7" },
  { text: "I have been crucified with Christ and I no longer live, but Christ lives in me.", reference: "Galatians 2:20" },
  { text: "Create in me a pure heart, O God, and renew a steadfast spirit within me.", reference: "Psalm 51:10" },
  { text: "Greater is he that is in you, than he that is in the world.", reference: "1 John 4:4" },
  { text: "My grace is sufficient for you, for my power is made perfect in weakness.", reference: "2 Corinthians 12:9" },
  { text: "Do not conform to the pattern of this world, but be transformed by the renewing of your mind.", reference: "Romans 12:2" },
  { text: "Let us not become weary in doing good, for at the proper time we will reap a harvest.", reference: "Galatians 6:9" },
  { text: "He who began a good work in you will carry it on to completion.", reference: "Philippians 1:6" },
  { text: "With man this is impossible, but with God all things are possible.", reference: "Matthew 19:26" },
  { text: "This is the day the LORD has made; let us rejoice and be glad in it.", reference: "Psalm 118:24" },
  { text: "Not by might nor by power, but by my Spirit, says the LORD Almighty.", reference: "Zechariah 4:6" },
  { text: "The LORD is my light and my salvation — whom shall I fear?", reference: "Psalm 27:1" },
  { text: "Call to me and I will answer you and tell you great and unsearchable things.", reference: "Jeremiah 33:3" },
  { text: "In everything give thanks: for this is the will of God in Christ Jesus concerning you.", reference: "1 Thessalonians 5:18" },
  { text: "I praise you because I am fearfully and wonderfully made.", reference: "Psalm 139:14" },
  { text: "Your word is a lamp to my feet and a light to my path.", reference: "Psalm 119:105" },
  { text: "The LORD makes firm the steps of the one who delights in him.", reference: "Psalm 37:23" },
  { text: "Humble yourselves before the Lord, and he will lift you up.", reference: "James 4:10" },
  { text: "Where there is no vision, the people perish.", reference: "Proverbs 29:18" },
];

// ─── NOTION HELPERS ───────────────────────────────────────────────────────────

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${await res.text()}`);
  return res.json();
}

async function notionPatch(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${await res.text()}`);
  return res.json();
}

// ─── FIND BLOCKS ─────────────────────────────────────────────────────────────

async function getPageBlocks(pageId) {
  const { results } = await notionGet(`/blocks/${pageId}/children?page_size=100`);
  return results;
}

function findCallout(blocks, emoji) {
  return blocks.find(b => b.type === 'callout' && b.callout?.icon?.emoji === emoji);
}

function findVotdBlock(blocks) {
  return blocks.find(b =>
    (b.type === 'bookmark' && b.bookmark?.url?.includes('bible.com/verse-of-the-day')) ||
    (b.type === 'embed' && b.embed?.url?.includes('bible.com/verse-of-the-day'))
  );
}

// ─── UPDATE 📖 CALLOUT ────────────────────────────────────────────────────────

async function updateVerseCallout(blocks, verse) {
  const callout = findCallout(blocks, '📖');
  if (!callout) { console.warn('⚠️  No 📖 callout found — run add-notion-bookmarks.js first.'); return; }

  await notionPatch(`/blocks/${callout.id}`, {
    callout: {
      rich_text: [{ type: 'text', text: { content: `${verse.text}  —  ${verse.reference}` } }],
      icon: { type: 'emoji', emoji: '📖' },
      color: 'blue_background',
    },
  });
  console.log('✅ 📖 Callout updated.');
}

// ─── UPDATE VOTD EMBED (PATCH only — no POST) ────────────────────────────────

async function updateVotdBlock(blocks, votdUrl) {
  const existing = findVotdBlock(blocks);

  if (!existing) {
    // Don't crash — just warn. User needs to run add-notion-bookmarks.js once first.
    console.warn('⚠️  No VOTD embed/bookmark block found on page.');
    console.warn('    Run add-notion-bookmarks.js once locally, then this will update it daily.');
    return;
  }

  const blockType = existing.type; // 'embed' or 'bookmark'
  await notionPatch(`/blocks/${existing.id}`, { [blockType]: { url: votdUrl } });
  console.log(`✅ VOTD ${blockType} updated → ${votdUrl}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!NOTION_PAGE_ID) throw new Error('Missing NOTION_PAGE_ID');

  const day = getDayOfYear();
  const votdUrl = getVotdUrl(day);
  console.log(`Day ${day} → ${votdUrl}`);

  // 1. Scrape YouVersion for verse text + image
  let verse = await scrapeVOTD(votdUrl);
  if (!verse) {
    const fb = FALLBACK_VERSES[day % FALLBACK_VERSES.length];
    verse = { ...fb, image: null, source: 'fallback' };
    console.log(`Using fallback: ${verse.reference}`);
  }

  // 2. Fetch page blocks
  const blocks = await getPageBlocks(NOTION_PAGE_ID);

  // 3. Update callout (PATCH existing block — safe)
  await updateVerseCallout(blocks, verse);

  // 4. Update VOTD embed (PATCH only — never POST)
  await updateVotdBlock(blocks, votdUrl);

  // 5. Write verse.json for dashboard — always succeeds regardless of Notion state
  fs.writeFileSync('verse.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    day,
    votdUrl,
    text: verse.text,
    reference: verse.reference,
    image: verse.image || null,
    version: verse.version || 'NIV',
    source: verse.source,
  }, null, 2));

  console.log('✅ verse.json written.');
  console.log(`Verse: "${verse.text.substring(0, 70)}…" — ${verse.reference}`);
})();