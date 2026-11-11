import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  
  const titleToUse = aniMeta?.current.title || input.title;
  const romajiToUse = aniMeta?.current.romajiTitle || input.romaji_title || '';
  const synonyms = aniMeta?.synonyms || [];
  
  const romajiSlug = slugify(romajiToUse);
  const rootTitle = getRootTitle(titleToUse);
  
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle, ...synonyms].filter(q => q && q.length > 2))];

  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number, queries: Set<string> }>();

  // Parallel Search
  const searchPromises = queries.map(q => 
    fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, {}, 8000)
      .then(res => res.ok ? res.json() : null)
      .then(data => ({ query: q, results: data?.data?.results || [] }))
      .catch(() => ({ query: q, results: [] }))
  );

  const searchResults = await Promise.all(searchPromises);

  for (const { query, results } of searchResults) {
    for (const cand of results) {
      if (!scoreMap.has(cand.id)) {
        scoreMap.set(cand.id, { cand, score: 0, queries: new Set() });
      }
      scoreMap.get(cand.id)!.queries.add(query);
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

    // 🎯 কোন সার্চ কোয়েরি থেকে এসেছে তার ওপর ভিত্তি করে বোনাস
    if (data.queries.has(romajiToUse)) score += 0.5; // Romaji সবচেয়ে নির্ভুল
    if (data.queries.has(titleToUse)) score += 0.3;
    
    if (score < 0.2) continue;

    scored.push({
      slug: slug,
      title: data.cand.title,
      type: data.cand.type,
      score: score,
      derivedBaseName: romajiSlug // Render API ছাড়াই Romaji থেকে স্লাগ তৈরি
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3); // টপ ৩ ক্যান্ডিডেট
}
