import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify, isLanguageRestricted, getCache, setCache } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function searchTatakai(query: string): Promise<DesiSearchResult[]> {
  try {
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, {}, 8000);
    if (!res.ok) return [];
    const json: any = await res.json();
    return json?.data?.results || [];
  } catch { return []; }
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  
  const titleToUse = aniMeta?.current.title || input.title;
  const romajiToUse = aniMeta?.current.romajiTitle || input.romaji_title || '';
  const synonyms = aniMeta?.synonyms || [];
  const rootTitle = getRootTitle(titleToUse);
  const preferredLang = input.preferred_lang || 'hindi';
  
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle, ...synonyms].filter(q => q && q.length > 2))];
  const cacheKey = `search-${slugify(titleToUse)}-${preferredLang}`;
  
  const cached = await getCache<Candidate[]>(cacheKey);
  if (cached) return cached;

  const tatakaiPromises = queries.map(q => searchTatakai(q));
  const tatakaiResults = await Promise.all(tatakaiPromises);
  const flatResults = tatakaiResults.flat();

  if (flatResults.length === 0) return [];

  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number }>();

  for (const cand of flatResults) {
    if (!cand || !cand.id) continue;
    if (isLanguageRestricted(cand.id, preferredLang) || isLanguageRestricted(cand.title, preferredLang)) continue;

    let score = Math.max(getSimilarityScore(titleToUse, cand.title), getSimilarityScore(romajiToUse, cand.title), getSimilarityScore(rootTitle, cand.title));
    if (getSimilarityScore(romajiToUse, cand.title) > 0.8) score += 0.5;

    if (!scoreMap.has(cand.id) || score > scoreMap.get(cand.id)!.score) {
      scoreMap.set(cand.id, { cand, score });
    }
  }

  const scored: Candidate[] = [];
  for (const [slug, data] of scoreMap) {
    let finalScore = data.score;
    if (input.is_movie && data.cand.type.toUpperCase() !== 'MOVIE') finalScore -= 0.3;
    if (!input.is_movie && data.cand.type.toUpperCase() === 'MOVIE') finalScore -= 0.3;
    if (finalScore < 0.15) continue; 

    scored.push({ slug, title: data.cand.title, type: data.cand.type, score: finalScore, derivedBaseName: slugify(romajiToUse) !== slug ? slugify(romajiToUse) : undefined });
  }

  scored.sort((a, b) => b.score - a.score);
  const result = scored.slice(0, 3);
  await setCache(cacheKey, result, 86400); // ১ দিন ক্যাশ
  return result;
}
