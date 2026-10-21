export async function fetchWithTimeout(url: string, timeoutMs: number = 15000): Promise<Response> {
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

export function getLevenshteinDistance(a: string, b: string): number {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// 🎯 স্ট্রিক্ট টাইটেল ম্যাচ (Bleach 2004 ব্লক করতে)
export function strictTitleMatch(searchTitle: string, apiTitle: string, isMovie: boolean): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  // ১. মুভি বনাম সিরিজ চেক
  if (isMovie && (cleanApi.includes('season') || cleanApi.includes('episode'))) return false;
  if (!isMovie && cleanApi.includes('movie')) return false;

  // ২. ডাইরেক্ট ম্যাচ
  if (cleanSearch === cleanApi) return true;
  if (cleanApi.includes(cleanSearch) || cleanSearch.includes(cleanApi)) {
      // 🎯 Bleach Fix: সার্চ লম্বা, কিন্তু API-তে ছোট নাম (যেমন Bleach) থাকলে ব্লক করব
      if (cleanSearch.length > 12 && cleanApi.length < 10) return false;
      return true;
  }

  // ৩. ফাজি ম্যাচ (Levenshtein)
  const distance = getLevenshteinDistance(cleanSearch, cleanApi);
  const maxAllowed = Math.max(3, Math.floor(Math.max(cleanSearch.length, cleanApi.length) * 0.25));
  return distance <= maxAllowed;
}
