// One-time setup script: adds the YouVersion VOTD and Reading Plan
// as proper Notion bookmark blocks to the Life Balance page.
// Run once manually: NOTION_TOKEN=xxx NOTION_PAGE_ID=xxx node add-notion-bookmarks.js

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${await res.text()}`);
  return res.json();
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${await res.text()}`);
  return res.json();
}

function getDayOfYear() {
  const now = new Date();
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const year = bogota.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  return Math.floor((bogota - start) / 86400000) + 1;
}

(async () => {
  if (!NOTION_TOKEN || !NOTION_PAGE_ID) throw new Error('Missing env vars');

  const votdUrl = `https://www.bible.com/verse-of-the-day?day=${getDayOfYear()}`;
  const planUrl = 'https://www.bible.com/users/emanuelbenavides012/reading-plans/70779-devocional-mayo-arbol-de-vida/subscription/1288335562/day/1';

  // Add bookmark blocks to the page
  await notionPost(`/blocks/${NOTION_PAGE_ID}/children`, {
    children: [
      // Section heading
      {
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: '📖 YouVersion' } }],
        },
      },
      // VOTD as embed (Notion will try to load it; falls back to a preview card)
      {
        type: 'embed',
        embed: { url: votdUrl },
      },
      // Reading plan as bookmark (rich link preview card)
      {
        type: 'bookmark',
        bookmark: { url: planUrl },
      },
    ],
  });

  console.log('✅ Bookmark blocks added to Life Balance page.');
  console.log(`VOTD embed: ${votdUrl}`);
  console.log(`Reading plan bookmark: ${planUrl}`);
})();
