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

// ─── SCRAPE YOUVERSION VOTD ───────────────────────────────────────────────────

async function scrapeVOTD(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LifeBalanceDashboard/1.0)',
        'Accept': 'text/html',
      },
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
      return { text: description, reference: title, image, source: 'youversion' };
    }
    throw new Error('Missing og meta tags');
  } catch (err) {
    console.warn(`Scraping failed (${err.message}), using fallback.`);
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
        rich_text: [{ type: 'text', text: { content: `${verse.text}  —  ${verse.reference}` } }],
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

  // 1. Scrape verse
  let verse = await scrapeVOTD(votdUrl);
  if (!verse) {
    verse = { ...FALLBACK[day % FALLBACK.length], image: null, source: 'fallback' };
    console.log(`Fallback: ${verse.reference}`);
  }

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
    source: verse.source,
  }, null, 2));

  console.log('✅ verse.json written.');
  console.log(`   "${verse.text.substring(0, 60)}…" — ${verse.reference}`);
})();