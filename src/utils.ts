export async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { 
        signal: controller.signal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        }
    });
  } finally {
    clearTimeout(id);
  }
}

export function cleanIframeUrl(htmlString: string): string {
  if (!htmlString) return '';
  if (htmlString.trim().startsWith('http')) return htmlString.trim();
  const match = htmlString.match(/src=['"](.*?)['"]/i);
  if (match && match[1]) {
    let url = match[1];
    if (url.startsWith('//')) url = 'https:' + url;
    return url;
  }
  return htmlString;
}

export function decodeEmbedId(raw: string): { server: string; url: string } | null {
  try {
    const [nameB64, urlB64] = raw.split(":");
    if (!nameB64 || !urlB64) return null;
    const server = Buffer.from(nameB64, "base64").toString("utf-8");
    let url = Buffer.from(urlB64, "base64").toString("utf-8");
    url = cleanIframeUrl(url);
    return { server, url };
  } catch {
    return null;
  }
}

// 🎯 সিক্যুয়েল ডিটেকশন (পুরনো extractor compatibility)
export function isSequelTitle(title: string, romajiTitle?: string): boolean {
  const combined = `${title} ${romajiTitle || ''}`.toLowerCase();
  return /season\s*[2-9]|part\s*[2-9]|blood war|final season|2nd season|3rd season|4th season|2nd part|3rd part|cour\s*[2-9]|separation|conflict|calamity|ketsubetsu|kashin|sou|kessen/i.test(combined);
}

// 🎯 পুরনো similarity (extractor-এর backward compatibility-র জন্য রাখা)
export function getSimilarityScore(s1: string, s2: string): number {
  const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (clean1 === clean2) return 100;
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 90;

  const tokens1 = new Set(s1.toLowerCase().split(/\s+/));
  const tokens2 = new Set(s2.toLowerCase().split(/\s+/));
  let intersection = 0;
  tokens1.forEach(t => { if (tokens2.has(t)) intersection++; });
  const jaccard = intersection / (tokens1.size + tokens2.size - intersection);

  const matrix = [];
  for (let i = 0; i <= clean2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= clean1.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= clean2.length; i++) {
    for (let j = 1; j <= clean1.length; j++) {
      matrix[i][j] = clean2[i - 1] === clean1[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  const maxLen = Math.max(clean1.length, clean2.length);
  const levScore = maxLen === 0 ? 1 : (1 - matrix[clean2.length][clean1.length] / maxLen);
  
  return (levScore * 50) + (jaccard * 50);
}

// ==================================================
// 🎯 NEW: Math-Based Functions for Chain Discovery
// ==================================================

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'on', 'at', 'is', 'as', 'with']);

/**
 * Numeric Normalization: "2nd Season" → "season 2", "II" → "2", "Final Season" → "final"
 */
export function normalizeNumeric(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/(\d+)(?:st|nd|rd|th)\s+season/g, 'season $1')
        .replace(/season\s+0*(\d+)/g, 'season $1')
        .replace(/part\s+0*(\d+)/g, 'part $1')
        .replace(/\bii\b/g, '2')
        .replace(/\biii\b/g, '3')
        .replace(/\biv\b/g, '4')
        .replace(/\bvi\b/g, '6')
        .replace(/\bvii\b/g, '7')
        .replace(/final\s+season/g, 'final')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Word Jaccard: intersection/union of meaningful words
 * Returns 0-100
 */
export function wordJaccardMatch(a: string, b: string): number {
    const extractWords = (s: string) => {
        const normalized = normalizeNumeric(s);
        return normalized.split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
    };
    const wordsA = new Set(extractWords(a));
    const wordsB = new Set(extractWords(b));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });
    const union = wordsA.size + wordsB.size - intersection;
    return (intersection / union) * 100;
}

/**
 * Prefix Bonus: if first 3+ words match in order, huge boost
 * "Attack on Titan Final Season Part 2" vs "Attack on Titan Season 4: Final Season"
 *   → "attack", "titan" match in order → +40
 */
export function prefixMatchBonus(a: string, b: string): number {
    const wordsA = normalizeNumeric(a).split(/\s+/).filter(w => w && !STOP_WORDS.has(w));
    const wordsB = normalizeNumeric(b).split(/\s+/).filter(w => w && !STOP_WORDS.has(w));
    let matching = 0;
    for (let i = 0; i < Math.min(wordsA.length, wordsB.length); i++) {
        if (wordsA[i] === wordsB[i]) matching++;
        else break;
    }
    if (matching >= 3) return 40;
    if (matching >= 2) return 20;
    if (matching >= 1) return 5;
    return 0;
}

/**
 * Root Title: Strip season/part/arc suffix
 * "Demon Slayer: Kimetsu no Yaiba Entertainment District Arc" → "Demon Slayer"
 */
export function getRootTitle(title: string): string {
    if (!title) return '';
    return title
        .replace(/:\s*Kimetsu no Yaiba/i, '')
        .replace(/\s+Arc\s*$/i, '')
        .replace(/\s+\(TV\)\s*$/i, '')
        .replace(/:\s*(the\s+)?final\s+season.*/i, '')
        .replace(/\s+(the\s+)?final\s+season.*/i, '')
        .replace(/\s+season\s+\d+.*/i, '')
        .replace(/\s+part\s+\d+.*/i, '')
        .trim();
}

/**
 * Multi-Reference Scoring: 
 *   English title (0.4) + rootTitle (0.2) + romaji (0.2) + synonyms (0.2)
 *   + Prefix Bonus (up to 40)
 * Returns 0-100
 */
export function multiReferenceScore(
    refs: { title: string; romaji: string; rootTitle: string; synonyms: string[] },
    desiTitle: string
): number {
    const titleScore = wordJaccardMatch(refs.title, desiTitle);
    const rootScore = refs.rootTitle ? wordJaccardMatch(refs.rootTitle, desiTitle) : 0;
    const romajiScore = refs.romaji ? wordJaccardMatch(refs.romaji, desiTitle) : 0;
    const synonymScore = refs.synonyms.length > 0
        ? Math.max(...refs.synonyms.map(s => wordJaccardMatch(s, desiTitle)))
        : 0;

    const base = (titleScore * 0.4) + (rootScore * 0.2) + (romajiScore * 0.2) + (synonymScore * 0.2);

    // Prefix bonus (compare desiTitle against the strongest reference)
    const bonus = Math.max(
        prefixMatchBonus(refs.title, desiTitle),
        prefixMatchBonus(refs.rootTitle, desiTitle)
    );

    return Math.min(100, base + bonus);
}
