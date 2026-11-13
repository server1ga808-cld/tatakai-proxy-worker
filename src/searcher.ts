import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify, getCache, setCache, extractBaseNameFromEpisodeId } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function searchTatakai(query: string): Promise<DesiSearchResult[]> {
  try {
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, {}, 10000);
    if (!res.ok) return [];
    const json: any = await res.json();
    return json?.data?.results || [];
  } catch { return []; }
}

async function fetchDerivedBase(slug: string): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, {}, 8000);
    if (!res.ok) return undefined;
    const data: any = await res.json();
    const episodes = data?.data?.episodes || [];
    if (episodes.length > 0 && episodes[0].id) {
      return extractBaseNameFromEpisodeId(episodes[0].id) || undefined;
    }
  } catch {}
  return undefined;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  
  const titleToUse = aniMeta?.current.title || input.title;
  const romajiToUse = aniMeta?.current.romajiTitle || input.romaji_title || '';
  const rootTitle = getRootTitle(titleToUse);
  
  const queries = new Set<string>();
  queries.add(titleToUse);
  if (romajiToUse) queries.add(romajiToUse);
  if (rootTitle) queries.add(rootTitle);

  // 🎯 Clean Query (Remove "Part N" or "Season N" to prevent AoT P2 search fail)
  const cleanSearchQuery = rootTitle.replace(/\s+part\s+\d+.*/i, '').replace(/\s+season\s+\d+.*/i, '').trim();
  if (cleanSearchQuery) queries.add(cleanSearchQuery);

  const seasonMatch = titleToUse.match(/season\s*(\d+)/i) || (input.season ? [null, String(input.season)] : null);
  if (seasonMatch && seasonMatch[1]) {
    queries.add(`${rootTitle} Season ${seasonMatch[1]}`);
  } else if (titleToUse === rootTitle) {
    queries.add(`${rootTitle} Season 1`);
  }

  const finalQueries = Array.from(queries).filter(q => q && q.length > 2).slice(0, 4);
  const cacheKey = `search-${slugify(titleToUse)}`;
  
  const cached = await getCache<Candidate[]>(cacheKey);
  if (cached) return cached;

  const tatakaiResults = await Promise.all(finalQueries.map(q => searchTatakai(q)));
  const flatResults = tatakaiResults.flat();

  let scored: Candidate[] = [];

  if (flatResults.length > 0) {
    const scoreMap = new Map<string, { cand: DesiSearchResult, score: number }>();
    
    // 🎯 Symmetric check includes Arc, Village, Movie to prevent False Penalties
    const reqHasSeason = /season|part|cour|arc|village|movie/i.test(titleToUse);
    
    for (const cand of flatResults) {
      if (!cand || !cand.id) continue;
      
      // 🎯 Synonyms added to Scoring Array
      let score = Math.max(
        getSimilarityScore(titleToUse, cand.title), 
        getSimilarityScore(romajiToUse, cand.title), 
        getSimilarityScore(rootTitle, cand.title),
        ...(aniMeta?.synonyms || []).map((s: string) => getSimilarityScore(s, cand.title))
      );
      
      if (input.is_movie && cand.type.toUpperCase() !== 'MOVIE') score -= 0.2;
      if (!input.is_movie && cand.type.toUpperCase() === 'MOVIE') score -= 0.5;
      
      const candHasSeason = /season|part|cour|arc|village|movie/i.test(cand.title);
      if (reqHasSeason !== candHasSeason) score -= 0.3;

      if (!scoreMap.has(cand.id) || score > scoreMap.get(cand.id)!.score) {
        scoreMap.set(cand.id, { cand, score });
      }
    }

    for (const [slug, data] of scoreMap) {
      if (data.score < 0.35) continue; 
      scored.push({ slug, title: data.cand.title, type: data.cand.type, score: data.score });
    }
    scored.sort((a, b) => b.score - a.score);
    scored = scored.slice(0, 3);
  }

  // 🎯 Root Fallback: Falls back to Root Title slug instead of Romaji (AoT P2 fix)
  if (scored.length === 0 && (rootTitle || romajiToUse || titleToUse)) {
    const fallbackSlug = slugify(rootTitle || romajiToUse || titleToUse);
    scored.push({ slug: fallbackSlug, title: rootTitle || romajiToUse || titleToUse, type: input.is_movie ? 'MOVIE' : 'TV', score: 1 });
  }

  const basePromises = scored.map(c => fetchDerivedBase(c.slug));
  const bases = await Promise.all(basePromises);

  for (let i = 0; i < scored.length; i++) {
    scored[i].derivedBaseName = bases[i] || scored[i].slug;
  }

  await setCache(cacheKey, scored, 86400); 
  return scored;
}
