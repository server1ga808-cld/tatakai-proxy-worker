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

// 🎯 সিক্যুয়েল কি না চেক (Bleach TYBW বা S2+ হলে true)
export function isSequelTitle(title: string, romajiTitle?: string): boolean {
  const combined = `${title} ${romajiTitle || ''}`.toLowerCase();
  return /season\s*[2-9]|part\s*[2-9]|blood war|final season|2nd season|3rd season|4th season|2nd part|3rd part/i.test(combined);
}

// 🎯 Universal Strict Title Matcher
export function strictTitleMatch(searchTitle: string, apiTitle: string, isMovie: boolean): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '');

  // মুভি বনাম সিরিজ চেক
  if (isMovie && (cleanApi.includes('season') || cleanApi.includes('episode'))) return false;
  if (!isMovie && cleanApi.includes('movie')) return false;

  // 🎯 "2nd", "3rd" ইত্যাদি বাদ দেওয়া
  const stripSuffixes = (s: string) => s.replace(/\b\d+(st|nd|rd|th)\b/g, '');
  const sClean = stripSuffixes(cleanSearch);
  const aClean = stripSuffixes(cleanApi);

  const stopWords = ['the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'part', 'season', 'cour', 'arc', 'movie', 'hen'];
  const getKeywords = (str: string) => str.split(/\s+/).filter(w => w.length > 0 && !stopWords.includes(w) && !/^\d+$/.test(w));

  const sWords = getKeywords(sClean);
  const aWords = getKeywords(aClean);

  if (sWords.length === 0 || aWords.length === 0) return false;

  // 🎯 Bleach 2004 ব্লক করার মেইন লজিক
  const isSearchSequel = isSequelTitle(searchTitle);
  const isApiSequel = isSequelTitle(apiTitle);
  if (isSearchSequel && !isApiSequel) return false;

  // যদি API-র টাইটেল ১ শব্দের হয় (যেমন "Frieren"), তবে সার্চের প্রথম শব্দের সাথে মিলতে হবে
  if (aWords.length === 1) {
      return sWords[0] === aWords[0];
  }

  let matches = 0;
  for (const sw of sWords) {
    if (aWords.includes(sw)) matches++;
  }
  return (matches / sWords.length) >= 0.5; 
}
