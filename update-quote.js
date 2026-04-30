// update-quote.js
// Picks today's quote from the list and updates the callout in your Life Balance page.

const NOTION_TOKEN  = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID; // Life Balance page ID

// ─── YOUR QUOTES ────────────────────────────────────────────────────────────

const QUOTES = [
  // ⚡ No Excuses — Discipline & Grit
  "Discipline equals freedom. — Jocko Willink",
  "Comparison is the thief of joy. — Theodore Roosevelt",
  "Comfort is the enemy of growth.",
  "Don't stop when you're tired. Stop when you're done. — David Goggins",
  "Discipline is doing what needs to be done, even if you don't want to do it.",
  "You don't have to feel like it to do it.",
  "The pain of discipline is far less than the pain of regret.",
  "Under pressure, you don't rise to the occasion; you sink to the level of your training. — Archilochus",
  "Your ego is the enemy. — Ryan Holiday",
  "Easy choices, hard life. Hard choices, easy life. — Jerzy Gregorek",
  "Action cures fear.",
  "Excuses are the nails used to build a house of failure.",
  "Discipline is choosing between what you want now and what you want most.",
  "Be the person your 8-year-old self would be proud of.",
  "If it's important, you'll find a way. If not, you'll find an excuse.",
  "The best time to plant a tree was 20 years ago. The second best time is now.",
  "Motivation gets you started. Discipline keeps you going.",
  "You are not your mistakes; you are your potential.",
  "Don't count the days; make the days count. — Muhammad Ali",
  "Average is a failing grade.",

  // 🔥 Talent is Overrated — Effort & Obsession
  "Obsession beats talent.",
  "Hard work beats talent when talent doesn't work hard. — Tim Notke",
  "Consistency is the only superpower.",
  "Amateurs wait for inspiration; pros get to work.",
  "Be so good they can't ignore you. — Steve Martin",
  "Repetition is the mother of skill.",
  "The dream is free; the hustle is sold separately.",
  "Genius is 1% inspiration and 99% perspiration. — Thomas Edison",
  "Success is a lagging indicator of your habits.",
  "Mastery requires patience.",
  "Work while they sleep. Learn while they party. Save while they spend. Live like they dream.",
  "The harder I work, the luckier I get. — Samuel Goldwyn",
  "It's not who you are that holds you back, it's who you think you're not.",
  "Don't wish it were easier; wish you were better. — Jim Rohn",
  "Your results are a mirror of your effort.",
  "Focus on the process, not the prize.",
  "Show up, show up, show up.",
  "The master has failed more times than the beginner has even tried. — Stephen McCranie",
  "Great things are not done by impulse, but by a series of small things brought together. — Vincent van Gogh",
  "Skill is only developed by hours and hours of beating on your craft. — Will Smith",

  // 🧠 Internal Compass — Mindset & Stoicism
  "You have power over your mind—not outside events. Realize this, and you will find strength. — Marcus Aurelius",
  "The obstacle is the way. — Ryan Holiday",
  "Growth begins at the end of your comfort zone.",
  "What you seek is seeking you. — Rumi",
  "Control the controllables.",
  "Waste no more time arguing what a good man should be. Be one. — Marcus Aurelius",
  "Your mind is a garden. Your thoughts are the seeds.",
  "If you are the smartest person in the room, you are in the wrong room.",
  "Change your thoughts and you change your world. — Norman Vincent Peale",
  "Respond, don't react.",
  "Everything you've ever wanted is on the other side of fear. — George Addair",
  "What consumes your mind controls your life.",
  "Silence is a source of great strength. — Lao Tzu",
  "The world belongs to the quiet who do the work.",
  "Happiness is not something readymade. It comes from your own actions. — Dalai Lama",
  "We suffer more often in imagination than in reality. — Seneca",
  "To know yourself is the beginning of all wisdom. — Aristotle",
  "Be tolerant with others and strict with yourself. — Marcus Aurelius",
  "Your life is as good as your mindset.",
  "Protect your peace.",

  // 📈 Small Steps, Big Results — Consistency & Systems
  "Standardize before you optimize. — James Clear",
  "1% better every day.",
  "Win the morning, win the day.",
  "Systems rise to the level of your goals; people fall to the level of their systems.",
  "Tiny changes, remarkable results. — James Clear",
  "Direction is more important than speed.",
  "Success is the sum of small efforts, repeated day in and day out. — Robert Collier",
  "You don't need more time; you need more focus.",
  "How you do anything is how you do everything.",
  "Do it for the Future You.",
  "Momentum is the best motivator.",
  "Slow is smooth, and smooth is fast.",
  "Start where you are. Use what you have. Do what you can. — Arthur Ashe",
  "The secret of your future is hidden in your daily routine.",
  "Don't break the chain.",
  "Patience is a competitive advantage.",
  "Big things have small beginnings.",
  "Compound interest is the eighth wonder of the world. Applies to habits, too.",
  "Stop overthinking; start overdoing.",
  "Small wins lead to big victories.",

  // 🚀 Risk, Failure & Evolution
  "Fail fast, fail often.",
  "Fear is a compass, not a barrier.",
  "If you're not failing, you're not playing big enough.",
  "The only way to do great work is to love what you do. — Steve Jobs",
  "Don't be afraid to give up the good to go for the great. — John D. Rockefeller",
  "Burn the ships.",
  "The man who moves a mountain begins by carrying away small stones. — Confucius",
  "Everything is figureoutable. — Marie Forleo",
  "Risk being seen in all of your glory.",
  "A ship in harbor is safe, but that is not what ships are built for. — John A. Shedd",
  "Your potential is endless.",
  "Turn your wounds into wisdom. — Oprah Winfrey",
  "Life begins at the end of your comfort zone. — Neale Donald Walsch",
  "Mistakes are proof that you are trying.",
  "Fail forward.",
  "The only person you should try to be better than is the person you were yesterday.",
  "Go the extra mile. It's never crowded. — Wayne Dyer",
  "Fortune favors the bold. — Virgil",
  "Your life does not get better by chance, it gets better by change. — Jim Rohn",
  "Live as if you were to die tomorrow. Learn as if you were to live forever. — Mahatma Gandhi",
];

// ─── PICK TODAY'S QUOTE ─────────────────────────────────────────────────────

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

const todayIndex = getDayOfYear() % QUOTES.length;
const todayQuote = QUOTES[todayIndex];

console.log(`Day ${getDayOfYear()} → Quote #${todayIndex + 1}: "${todayQuote}"`);

// ─── FIND THE CALLOUT BLOCK ──────────────────────────────────────────────────

async function getCalloutBlockId(pageId) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch blocks: ${err}`);
  }

  const data = await res.json();
  const callout = data.results.find(b => b.type === 'callout');

  if (!callout) throw new Error('No callout block found on the Life Balance page.');
  return callout.id;
}

// ─── UPDATE THE CALLOUT ──────────────────────────────────────────────────────

async function updateCallout(blockId, quote) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      callout: {
        rich_text: [{ type: 'text', text: { content: quote } }],
        icon: { type: 'emoji', emoji: '💬' },
        color: 'gray_background',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update callout: ${err}`);
  }

  console.log('✅ Callout updated successfully.');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  if (!NOTION_TOKEN)   throw new Error('Missing NOTION_TOKEN secret.');
  if (!NOTION_PAGE_ID) throw new Error('Missing NOTION_PAGE_ID secret.');

  const calloutId = await getCalloutBlockId(NOTION_PAGE_ID);
  await updateCallout(calloutId, todayQuote);
})();
