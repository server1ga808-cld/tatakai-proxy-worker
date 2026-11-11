import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";
const DESI_BASE = "https://www.desidubanime.me";

// 🎯 Native Fallback: যদি Tatakai API ফেল করে
async function searchDesiNative(query: string): Promise<DesiSearchResult[]> {
  try {
    const url = `${DESI_BASE}/wp-json/kiranime/v1/anime/search?query=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 8000);
    if (!res.ok) return [];
    
    const json: any = await res.json();
    const html = json?.result || '';
    
    // HTML থেকে slug এবং title এক্সট্রাক্ট করা
    const results: DesiSearchResult[] = [];
    const regex = /<a href="https:\/\/www\.desidubanime\.me\/anime\/([^/]+)\/".*?<span class="group-data-\[language=jp\]\/body:hidden"[^>]*>([^<]+)<\/span>/gs;
    
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        id: match[1], // slug
        title: match[2].trim(), // title
        type: 'TV',
        url: `${DESI_BASE}/anime/${match[1]}/`
      });
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
  const synonyms = aniMeta?.synonyms || [];
  
  const romajiSlug = slugify(romajiToUse);
  const rootTitle = getRootTitle(titleToUse);
  
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle, ...synonyms].filter(q => q && q.length > 2))];

  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number, queries: Set<string> }>();

  // ১. Tatakai Search API (Primary)
  const tatakaiPromises = queries.map(q => 
    fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, {}, 8000)
      .then(res => res.ok ? res.json() : null)
      .then(data => ({ query: q, results: data?.data?.results || [] }))
      .catch(() => ({ query: q, results: [] }))
  );

  const tatakaiResults = await Promise.all(tatakaiPromises);
  let hasResults = false;

  for (const { query, results } of tatakaiResults) {
    if (results.length > 0) hasResults = true;
    for (const cand of results) {
      if (!scoreMap.has(cand.id)) {
        scoreMap.set(cand.id, { cand, score: 0, queries: new Set() });
      }
      scoreMap.get(cand.id)!.queries.add(query);
    }
  }

  // ২. Tatakai ফেল করলে Desi Native Fallback (Secondary)
  if (!hasResults) {
    console.log(`[SEARCH] Tatakai empty, using Desi Native Fallback...`);
    const nativePromises = queries.map(q => searchDesiNative(q).then(res => ({ query: q, results: res })));
    const nativeResults = await Promise.all(nativePromises);

    for (const { query, results } of nativeResults) {
      for (const cand of results) {
        if (!scoreMap.has(cand.id)) {
          scoreMap.set(cand.id, { cand, score: 0, queries: new Set() });
        }
        scoreMap.get(cand.id)!.queries.add(query);
      }
    }
  }

  if (scoreMap.size === 0) return [];

  const scored: Candidate[] = [];
  
  for (const [slug, data] of scoreMap) {
    if (input.is_movie && data.cand.type.toUpperCase() !== 'MOVIE') continue;
    if (!input.is_movie && data.cand.type.toUpperCase() === 'MOVIE') continue;

    let score = Math.max(
      getSimilarityScore(titleToUse, data.cand.title),
      getSimilarityScore(romajiToUse, data.cand.title),
      getSimilarityScore(rootTitle, data.cand.title)
    );

    if (data.queries.has(romajiToUse)) score += 0.5; 
    if (data.queries.has(titleToUse)) score += 0.3;
    
    if (score < 0.2) continue;

    scored.push({
      slug: slug,
      title: data.cand.title,
      type: data.cand.type,
      score: score,
      derivedBaseName: romajiSlug // রোমাজি থেকে অটো-জেনারেট করা স্লাগ
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}
