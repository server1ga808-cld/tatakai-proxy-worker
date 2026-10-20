// ১. Timeout সহ Fetch (Render Server হ্যাং এড়াতে)
export async function fetchWithTimeout(url: string, timeoutMs: number = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// ২. Iframe ট্যাগ থেকে সরাসরি URL বের করা (Desi Dub-এর জন্য)
export function cleanIframeUrl(htmlString: string): string {
  if (!htmlString) return '';
  // যদি সরাসরি http বা https দিয়ে শুরু হয়
  if (htmlString.trim().startsWith('http')) return htmlString.trim();
  
  // Regex দিয়ে src='...' এর ভেতরের লিংক বের করা
  const match = htmlString.match(/src=['"](.*?)['"]/i);
  if (match && match[1]) {
    let url = match[1];
    // যদি // দিয়ে শুরু হয় (protocol-relative)
    if (url.startsWith('//')) url = 'https:' + url;
    return url;
  }
  return htmlString; // কিছু না পেলে আসলটাই রিটার্ন করবে
}

// ৩. এপিসোড নাম্বার ম্যাচিং ("01", "1", "Episode 1" থেকে নাম্বার বের করা)
export function matchEpisodeNumber(nameStr: string, targetEp: number): boolean {
  if (!nameStr) return false;
  // যেকোনো স্ট্রিং থেকে ডিজিট (Number) বের করবে
  const match = nameStr.match(/\d+/); 
  if (match) {
    return parseInt(match[0], 10) === targetEp;
  }
  return false;
}

// ৪. ফাজি ম্যাচিং (ভুল অ্যানিমে যেমন Frieren আসা বন্ধ করতে)
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

// ৫. স্মার্ট টাইটেল ম্যাচিং (Levenshtein ব্যবহার করে)
export function isTitleMatch(searchTitle: string, apiTitle: string): boolean {
  const cleanSearch = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApi = apiTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (cleanApi.includes(cleanSearch) || cleanSearch.includes(cleanApi)) return true;
  
  const distance = getLevenshteinDistance(cleanSearch, cleanApi);
  const maxAllowed = Math.min(4, Math.floor(cleanSearch.length * 0.3));
  return distance <= maxAllowed;
}
