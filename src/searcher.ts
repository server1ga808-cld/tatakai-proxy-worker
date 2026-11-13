import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify, getCache, setCache, extractBaseNameFromEpisodeId } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function searchTatakai(query: string): Promise<DesiSearchResult[]> {
  try {
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, {}, 8000);
    if (!res.ok) return [];
    const json: any = await res.json();
    return json?.data?.results || [];
  } catch { return []; }
}

async function fetchDerivedBase(slug: string): Promise<string | undefined> {
  try {
    // 🎯 Safe timeout 10s for Render cold starts
    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, {}, 10000);
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
  if (rootTitle && rootTitle !== titleToUse) queries.add(rootTitle);

  const cleanSearchQuery = rootTitle.replace(/\s+part\s+\d+.*/i, '').replace(/\s+season\s+\d+.*/i, '').trim();
  if (cleanSearchQuery && cleanSearchQuery !== rootTitle && cleanSearchQuery !== titleToUse) queries.add(cleanSearchQuery);

  const seasonMatch = titleToUse.match(/season\s*(\d+)/i) || (input.season ? [null, String(input.season)] : null);
  if (seasonMatch && seasonMatch[1] && !rootTitle.toLowerCase().includes('season')) {
    queries.add(`${rootTitle} Season ${seasonMatch[1]}`);
  } else if (titleToUse === rootTitle) {
    queries.add(`${rootTitle} Season 1`);
  }

  const finalQueries = Array.from(queries).filter(q => q && q.length > 2).slice(0, 4);
  // 🎯 Bumped Cache to v27 to bypass any old/stale data
  const cacheKey = `search-v27-${slugify(titleToUse)}`;
  
  const cached = await getCache<Candidate[]>(cacheKey);
  if (cached) return cached;

  const tatakaiResults = await Promise.all(finalQueries.map(q => searchTatakai(q)));

  let scored: Candidate[] = [];
  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number }>();
  const reqHasSeason = /season|part|cour|arc|village|movie/i.test(titleToUse);
  const romajiIndex = finalQueries.indexOf(romajiToUse);

  for (let i = 0; i < finalQueries.length; i++) {
    const query = finalQueries[i];
    const results = tatakaiResults[i];

    for (const cand of results) {
      if (!cand || !cand.id) continue;
      
      let score = Math.max(
        getSimilarityScore(titleToUse, cand.title), 
        getSimilarityScore(romajiToUse, cand.title), 
        getSimilarityScore(rootTitle, cand.title)
      );

      const cameFromRomaji = (romajiIndex !== -1 && tatakaiResults[romajiIndex].some(r => r.id === cand.id));
      if (cameFromRomaji) score += 0.4;
      else if (query === titleToUse) score += 0.2;
      
      if (input.is_movie && cand.type.toUpperCase() !== 'MOVIE') score -= 0.2;
      if (!input.is_movie && cand.type.toUpperCase() === 'MOVIE') score -= 0.5;
      
      const candHasSeason = /season|part|cour|arc|village|movie/i.test(cand.title);
      if (reqHasSeason !== candHasSeason) score -= 0.3;

      if (!scoreMap.has(cand.id) || score > scoreMap.get(cand.id)!.score) {
        scoreMap.set(cand.id, { cand, score });
      }
    }
  }

  if (scoreMap.size > 0) {
    for (const [slug, data] of scoreMap) {
      if (data.score < 0.35) continue; 
      scored.push({ slug, title: data.cand.title, type: data.cand.type, score: data.score });
    }
    scored.sort((a, b) => b.score - a.score);
    scored = scored.slice(0, 3);
  }

  if (scored.length === 0 && (rootTitle || romajiToUse || titleToUse)) {
    const fallbackSlug = slugify(rootTitle || romajiToUse || titleToUse);
    scored.push({ slug: fallbackSlug, title: rootTitle || romajiToUse || titleToUse, type: input.is_movie ? 'MOVIE' : 'TV', score: 1 });
  }

  const basePromises = scored.map(c => fetchDerivedBase(c.slug));
  const bases = await Promise.all(basePromises);

  for (let i = 0; i < scored.length; i++) {
    // 🎯 THE GOLDEN FALLBACK CHAIN (As suggested by you)
    const cleanRomajiRoot = getRootTitle(romajiToUse || titleToUse);
    const fallbackBase = slugify(cleanRomajiRoot);
    
    // 1. Try Info API Base
    // 2. Try Root Romaji/Title Base (e.g. shingeki-no-kyojin-the-final-season)
    // 3. Try Tatakai Search Slug (e.g. demon-slayer-season-3)
    scored[i].derivedBaseName = bases[i] || fallbackBase || scored[i].slug;
  }

  await setCache(cacheKey, scored, 86400); 
  return scored;
}
