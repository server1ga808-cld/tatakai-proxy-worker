import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function searchTatakai(query: string): Promise<DesiSearchResult[]> {
  try {
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, {}, 8000);
    if (!res.ok) {
      console.log(`[SEARCH] Tatakai Error: ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    return json?.data?.results || [];
  } catch (e: any) {
    console.log(`[SEARCH] Tatakai Fetch Failed: ${e.message}`);
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
  console.log(`[SEARCH] Queries:`, queries);

  // ১. Tatakai Search API
  const tatakaiPromises = queries.map(q => searchTatakai(q));
  const tatakaiResults = await Promise.all(tatakaiPromises);
  
  // 🎯 ফ্ল্যাট করা হচ্ছে (Array of Arrays -> Flat Array)
  const flatResults = tatakaiResults.flat();
  console.log(`[SEARCH] Total raw results from Tatakai: ${flatResults.length}`);

  if (flatResults.length === 0) return [];

  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number }>();

  for (const cand of flatResults) {
    if (!cand || !cand.id) continue;

    let score = Math.max(
      getSimilarityScore(titleToUse, cand.title),
      getSimilarityScore(romajiToUse, cand.title),
      getSimilarityScore(rootTitle, cand.title)
    );

    // রোমাজি টাইটেল ম্যাচ করলে বোনাস
    if (getSimilarityScore(romajiToUse, cand.title) > 0.8) score += 0.5;

    if (!scoreMap.has(cand.id) || score > scoreMap.get(cand.id)!.score) {
      scoreMap.set(cand.id, { cand, score });
    }
  }

  const scored: Candidate[] = [];
  for (const [slug, data] of scoreMap) {
    if (input.is_movie && data.cand.type.toUpperCase() !== 'MOVIE') continue;
    if (!input.is_movie && data.cand.type.toUpperCase() === 'MOVIE') continue;
    if (data.score < 0.2) continue;

    scored.push({
      slug: slug,
      title: data.cand.title,
      type: data.cand.type,
      score: data.score,
      derivedBaseName: romajiSlug
    });
  }

  scored.sort((a, b) => b.score - a.score);
  console.log(`[SEARCH] Final Candidates:`, scored.slice(0, 3).map(c => `${c.slug} (${c.score.toFixed(1)})`));
  
  return scored.slice(0, 3);
}
