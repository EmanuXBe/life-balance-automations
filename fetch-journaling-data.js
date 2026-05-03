// fetch-journaling-data.js
// Fetches journaling entries from Notion, processes text, generates AI insight.
// Writes journaling-data.json for the dashboard.
// ADDED: recentEntries (last 3 entries with text excerpts for AI coaching)

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const JOURNALING_DB_ID = process.env.NOTION_JOURNALING_DB_ID;

// ─── THEME KEYWORD MAP ───────────────────────────────────────────────────────

const THEME_KEYWORDS = {
    'spiritual clarity': ['god', 'lord', 'prayer', 'faith', 'worship', 'surrender', 'grace', 'holy', 'peace', 'promise', 'repentance', 'christ', 'strength', 'scripture', 'trust', 'believe'],
    'strategic thinking': ['strategy', 'market', 'vision', 'opportunity', 'trend', 'competitive', 'industry', 'signal', 'pivot', 'growth', 'analysis', 'direction', 'goals', 'objectives'],
    'execution discipline': ['execute', 'build', 'deliver', 'complete', 'finish', 'task', 'frog', 'action', 'output', 'done', 'launch', 'move', 'priority', 'distraction', 'win'],
    'leadership depth': ['lead', 'team', 'align', 'mentor', 'people', 'network', 'connect', 'invest', 'relationship', 'culture', 'influence', 'partner', 'alliance', 'seed'],
    'mental clarity': ['clarity', 'focus', 'discipline', 'mindset', 'resilience', 'balance', 'intention', 'reflect', 'awareness', 'decision', 'control', 'better', 'progress'],
    'financial focus': ['revenue', 'profit', 'cash', 'invest', 'fund', 'money', 'financial', 'cost', 'income', 'budget', 'equity', 'runway', 'valuation', 'clients'],
    'physical health': ['gym', 'exercise', 'bike', 'sleep', 'body', 'rest', 'health', 'cold', 'shower', 'recover', 'train', 'physical', 'strength', 'endurance'],
    'creative expression': ['music', 'piano', 'guitar', 'jazz', 'art', 'create', 'improvise', 'compose', 'melody', 'practice', 'rhythm', 'creative'],
};

function generateInsightAlgorithmic(wordFrequency, amPct, pmPct, trend) {
    const themeScores = {};
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
        let score = 0;
        for (const w of wordFrequency) { if (keywords.includes(w.word)) score += w.count; }
        themeScores[theme] = score;
    }
    const sorted = Object.entries(themeScores).sort((a, b) => b[1] - a[1]);
    const strongest = sorted[0]?.[0] || 'spiritual clarity';
    const weakest = sorted.slice(-3).find(([, v]) => v === 0)?.[0] || sorted[sorted.length - 1]?.[0] || 'execution discipline';
    let qualifier = '';
    if (amPct > 70) qualifier = ' — mornings are strong but evenings need more reflection';
    else if (pmPct > 70) qualifier = ' — evening debriefs are rich but mornings need more intention';
    let trendNote = '';
    if (trend > 50) trendNote = ' Your writing depth is increasing — keep building this habit.';
    else if (trend < -50) trendNote = ' Your writing volume is dropping — protect this reflection time.';
    return `This month you're strengthening your ${strongest} but need to give more attention to your ${weakest}.${qualifier}.${trendNote}`.replace(/\.+/g, '.').trim();
}

// ─── STOP WORDS ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'not', 'no', 'so', 'if', 'as', 'than', 'then', 'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just', 'because', 'while', 'during', 'before', 'after', 'above', 'below', 'between', 'through', 'into', 'about', 'against', 'along', 'among', 'around', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'any', 'every', 'also', 'get', 'got', 'make', 'made', 'go', 'going', 'gone', 'come', 'came', 'take', 'took', 'know', 'knew', 'see', 'saw', 'think', 'thought', 'want', 'wanted', 'need', 'needed', 'day', 'time', 'today', 'tomorrow', 'morning', 'night', 'week', 'month', 'year', 'one', 'two',
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'en', 'de', 'del', 'al', 'que', 'es', 'son', 'fue', 'era', 'ser', 'estar', 'haber', 'tener', 'hacer', 'poder', 'deber', 'mi', 'mis', 'tu', 'sus', 'su', 'me', 'te', 'se', 'nos', 'les', 'lo', 'le', 'ya', 'no', 'si', 'por', 'para', 'con', 'sin', 'sobre', 'entre', 'desde', 'hasta', 'como', 'más', 'muy', 'bien', 'todo', 'todos', 'toda', 'todas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquí', 'allí', 'cuando', 'donde', 'cómo', 'qué', 'quién', 'cual', 'esto', 'eso', 'algo', 'nada', 'nadie', 'cada', 'otro', 'otra', 'hay', 'han', 'he', 'ha', 'hoy', 'ayer', 'mañana', 'vez', 'veces', 'días', 'tiempo',
]);

// ─── NOTION HELPERS ──────────────────────────────────────────────────────────

async function notionFetch(path, method = 'GET', body = null) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Notion API ${path}: ${await res.text()}`);
    return res.json();
}

async function queryAllPages() {
    const pages = [];
    let cursor;
    do {
        const body = { page_size: 100, sorts: [{ property: 'Fecha', direction: 'ascending' }] };
        if (cursor) body.start_cursor = cursor;
        const res = await notionFetch(`/databases/${JOURNALING_DB_ID}/query`, 'POST', body);
        pages.push(...res.results);
        cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return pages;
}

async function getPageText(pageId) {
    const res = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
    const USER_TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'quote'];
    let text = '';
    for (const block of res.results) {
        if (USER_TYPES.includes(block.type)) {
            const richText = block[block.type]?.rich_text || [];
            const blockText = richText.map(r => r.plain_text).join('').trim();
            if (blockText.startsWith('→')) {
                const userContent = blockText.replace(/^→\s*/, '').trim();
                if (userContent.length > 2) text += userContent + ' ';
            }
        }
    }
    return text.trim();
}

// ─── TEXT PROCESSING ─────────────────────────────────────────────────────────

function cleanWord(w) { return w.toLowerCase().replace(/[^a-záéíóúñüàèì]/g, ''); }
function countWords(t) { return t.split(/\s+/).filter(w => w.length > 0).length; }

function wordFrequency(text) {
    const freq = {};
    for (const raw of text.split(/\s+/)) {
        const w = cleanWord(raw);
        if (w.length < 3 || STOP_WORDS.has(w)) continue;
        freq[w] = (freq[w] || 0) + 1;
    }
    return freq;
}

function mergeFreq(a, b) {
    const result = { ...a };
    for (const [k, v] of Object.entries(b)) result[k] = (result[k] || 0) + v;
    return result;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
    if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
    if (!JOURNALING_DB_ID) throw new Error('Missing NOTION_JOURNALING_DB_ID');

    const pages = await queryAllPages();
    console.log(`Fetched ${pages.length} journal entries.`);

    if (pages.length === 0) {
        fs.writeFileSync('journaling-data.json', JSON.stringify({
            updatedAt: new Date().toISOString(),
            totalEntries: 0, totalWords: 0, avgWordsPerEntry: 0,
            wordFrequency: [], wordsByDate: [], heatmapData: [],
            sectionBalance: { am: { words: 0, pct: 50 }, pm: { words: 0, pct: 50 } },
            recentEntries: [], aiInsight: null,
        }, null, 2));
        return;
    }

    let globalFreq = {}, amFreq = {}, pmFreq = {};
    const wordsByDate = [], heatmapData = [];
    const allEntries = []; // for recentEntries

    for (const page of pages) {
        const dateVal = page.properties?.['Fecha']?.date?.start
            || page.properties?.['Date']?.date?.start
            || null;

        console.log(`Processing page ${page.id} (${dateVal || 'no date'})...`);
        let text = '';
        try { text = await getPageText(page.id); }
        catch (e) { console.warn(`Failed to fetch blocks for ${page.id}:`, e.message); continue; }

        const totalWords = countWords(text);
        wordsByDate.push({ date: dateVal, count: totalWords });
        heatmapData.push({ date: dateVal, count: totalWords });

        // Store excerpt for coaching
        allEntries.push({
            date: dateVal,
            wordCount: totalWords,
            excerpt: text.substring(0, 600).trim() + (text.length > 600 ? '...' : ''),
        });

        const freq = wordFrequency(text);
        globalFreq = mergeFreq(globalFreq, freq);

        const pmIdx = text.search(/Evening|🌙/i);
        const amText = pmIdx > 0 ? text.slice(0, pmIdx) : text;
        const pmText = pmIdx > 0 ? text.slice(pmIdx) : '';
        amFreq = mergeFreq(amFreq, wordFrequency(amText));
        pmFreq = mergeFreq(pmFreq, wordFrequency(pmText));
    }

    const sortedFreq = Object.entries(globalFreq)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);

    const counts = wordsByDate.map(d => d.count);
    const last7avg = counts.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, counts.length);
    const prev7avg = counts.length > 7
        ? counts.slice(-14, -7).reduce((a, b) => a + b, 0) / Math.min(7, counts.length - 7)
        : last7avg;
    const trend = last7avg - prev7avg;

    const amWords = Object.values(amFreq).reduce((a, b) => a + b, 0);
    const pmWords = Object.values(pmFreq).reduce((a, b) => a + b, 0);
    const totalSection = amWords + pmWords || 1;
    const amPct = Math.round(amWords / totalSection * 100);
    const pmPct = 100 - amPct;

    const totalWords = counts.reduce((a, b) => a + b, 0);
    const avgWordsPerEntry = Math.round(totalWords / pages.length);

    const aiInsight = generateInsightAlgorithmic(sortedFreq, amPct, pmPct, trend);

    // Recent entries — last 3, most recent first, for coaching context
    const recentEntries = [...allEntries]
        .filter(e => e.date)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);

    const output = {
        updatedAt: new Date().toISOString(),
        totalEntries: pages.length,
        totalWords, avgWordsPerEntry,
        wordFrequency: sortedFreq,
        wordsByDate, heatmapData,
        sectionBalance: {
            am: { words: amWords, pct: amPct },
            pm: { words: pmWords, pct: pmPct },
        },
        recentEntries, // ← NEW: used by generate-coaching.js
        aiInsight,
    };

    fs.writeFileSync('journaling-data.json', JSON.stringify(output, null, 2));
    console.log('✅ journaling-data.json written.');
    console.log(`Total entries: ${pages.length}, Words: ${totalWords}, Recent entries: ${recentEntries.length}`);
})();