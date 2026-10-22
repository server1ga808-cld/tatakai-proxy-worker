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

export function isSequelTitle(title: string, romajiTitle?: string): boolean {
  const combined = `${title} ${romajiTitle || ''}`.toLowerCase();
  return /season\s*[2-9]|part\s*[2-9]|blood war|final season|2nd season|3rd season|4th season|2nd part|3rd part|cour\s*[2-9]/i.test(combined);
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

export function strictTitleMatch(searchTitle: string, apiTitle: string, isMovie: boolean): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (isMovie && (cleanApi.includes('season') || cleanApi.includes('episode'))) return false;
  if (!isMovie && cleanApi.includes('movie')) return false;

  if (cleanSearch === cleanApi) return true;
  if (cleanApi.includes(cleanSearch) || cleanSearch.includes(cleanApi)) return true;

  const distance = getLevenshteinDistance(cleanSearch, cleanApi);
  const maxAllowed = Math.max(3, Math.floor(Math.max(cleanSearch.length, cleanApi.length) * 0.3));
  return distance <= maxAllowed;
}
