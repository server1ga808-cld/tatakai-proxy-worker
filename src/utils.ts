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

// 🎯 জাপানি পার্ট নাম (Ketsubetsu, Kashin) যোগ করা হয়েছে
export function isSequelTitle(title: string, romajiTitle?: string): boolean {
  const combined = `${title} ${romajiTitle || ''}`.toLowerCase();
  return /season\s*[2-9]|part\s*[2-9]|blood war|final season|2nd season|3rd season|4th season|2nd part|3rd part|cour\s*[2-9]|separation|conflict|calamity|ketsubetsu|kashin|sou|kessen/i.test(combined);
}

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
