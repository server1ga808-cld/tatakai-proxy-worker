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

// 🎯 পুরনো ম্যাচার (এরর এড়াতে রাখা হলো)
export function isTitleMatch(searchTitle: string, apiTitle: string): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanSearch === cleanApi) return true;
  if (cleanApi.includes(cleanSearch) || cleanSearch.includes(cleanApi)) return true;
  const distance = getLevenshteinDistance(cleanSearch, cleanApi);
  const maxAllowed = Math.max(3, Math.floor(Math.max(cleanSearch.length, cleanApi.length) * 0.3));
  return distance <= maxAllowed;
}

// 🎯 নতুন স্ট্রিক্ট ম্যাচার (Season/Part ইগনোর করবে)
export function strictTitleMatch(searchTitle: string, apiTitle: string, isMovie: boolean): boolean {
  const cleanSearchFull = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApiFull = apiTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  // মুভি বনাম সিরিজ চেক
  if (isMovie && (cleanApiFull.includes('season') || cleanApiFull.includes('episode'))) return false;
  if (!isMovie && cleanApiFull.includes('movie')) return false;

  if (cleanSearchFull === cleanApiFull) return true;

  // 🎯 Bleach Fix: সার্চ যদি লম্বা হয় (Bleach TYBW) কিন্তু API টাইটেল ছোট হয় (Bleach), তবে ব্লক করব
  if (cleanSearchFull.length > 12 && cleanApiFull.length < 10) return false;

  // 🎯 Season/Part বাদ দিয়ে মেইন নাম বের করা (JJK S2 ফিক্স)
  const stripSeason = (s: string) => s.replace(/season\d+/g, '').replace(/\d+(?:st|nd|rd|th)season/g, '').replace(/part\d+/g, '').trim();
  
  const cleanSearchStripped = stripSeason(cleanSearchFull);
  const cleanApiStripped = stripSeason(cleanApiFull);

  if (cleanSearchStripped === cleanApiStripped) return true;
  if (cleanApiStripped.includes(cleanSearchStripped) || cleanSearchStripped.includes(cleanApiStripped)) return true;

  const distance = getLevenshteinDistance(cleanSearchStripped, cleanApiStripped);
  const maxAllowed = Math.max(3, Math.floor(Math.max(cleanSearchStripped.length, cleanApiStripped.length) * 0.25));
  return distance <= maxAllowed;
}
