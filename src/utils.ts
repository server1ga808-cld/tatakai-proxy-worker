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

// 🎯 Universal Strict Matcher (Bleach 2004 ব্লক করতে)
export function strictTitleMatch(searchTitle: string, apiTitle: string, isMovie: boolean): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '');

  if (isMovie && (cleanApi.includes('season') || cleanApi.includes('episode'))) return false;
  if (!isMovie && cleanApi.includes('movie')) return false;

  // স্টপ ওয়ার্ড (যেমন: the, of, a) এবং সংখ্যা বাদ দেওয়া
  const stopWords = ['the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'part', 'season', 'cour', 'arc', 'movie'];
  const getKeywords = (str: string) => str.split(/\s+/).filter(w => w.length > 0 && !stopWords.includes(w) && !/^\d+$/.test(w));

  const searchWords = getKeywords(cleanSearch);
  const apiWords = getKeywords(cleanApi);

  if (searchWords.length === 0 || apiWords.length === 0) return false;

  let matches = 0;
  for (const sw of searchWords) {
    if (apiWords.includes(sw)) matches++;
  }

  // 🎯 রুল: সার্চের অন্তত ৭০% শব্দ API-তে থাকতে হবে (Bleach TYBW vs Bleach ব্লক করতে)
  const searchMatchRatio = matches / searchWords.length;
  if (searchMatchRatio < 0.7) return false;

  // যদি API-তে খুব কম শব্দ থাকে (যেমন শুধু "Bleach"), তবে সেটা ব্লক করব (যদি সার্চে ৪+ শব্দ থাকে)
  if (searchWords.length >= 4 && apiWords.length <= 1) return false;

  return true;
}
