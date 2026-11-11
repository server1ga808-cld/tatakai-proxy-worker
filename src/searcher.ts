import type { ProxyInput, Candidate } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getRootTitle } from './utils';

const DESI_BASE = "https://www.desidubanime.me";

async function searchDesiNative(query: string): Promise<Candidate[]> {
  try {
    const url = `${DESI_BASE}/wp-json/kiranime/v1/anime/search?query=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { 
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } 
    }, 5000); // ৫ সেকেন্ড টাইমআউট

    if (!res.ok) return [];
    const json: any = await res.json();
    const html = json?.result || '';
    
    // DesiDub HTML থেকে slug বের করার নিখুঁত রেজেক্স
    const regex = /href="https:\/\/www\.desidubanime\.me\/anime\/([^/]+)\/"/g;
    const results: Candidate[] = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const slug = match[1];
      if (slug && !results.some(r => r.slug === slug)) {
        results.push({
          slug: slug,
          title: slug.replace(/-/g, ' '), // সাময়িক টাইটেল
          type: 'TV',
          score: 1
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  
  const titleToUse = aniMeta?.current.title || input.title;
  const romajiToUse = aniMeta?.current.romajiTitle || input.romaji_title || '';
  const rootTitle = getRootTitle(titleToUse);
  
  // ৩টি কুয়েরি দিয়েই হিট করব
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle].filter(q => q && q.length > 2))];

  // প্যারালালি Native Search চালানো
  const searchPromises = queries.map(q => searchDesiNative(q));
  const resultsArr = await Promise.all(searchPromises);

  const candidateMap = new Map<string, Candidate>();
  for (const results of resultsArr) {
    for (const cand of results) {
      if (!candidateMap.has(cand.slug)) {
        candidateMap.set(cand.slug, cand);
      }
    }
  }

  // সব ক্যান্ডিডেট রিটার্ন করব, এক্সট্র্যাক্টর নিজেই যাচাই করে নেবে
  return Array.from(candidateMap.values());
}
