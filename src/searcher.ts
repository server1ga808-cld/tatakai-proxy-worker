import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, extractBaseNameFromEpisodeId } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

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
  const synonyms = aniMeta?.synonyms || [];
  
  const rootTitle = getRootTitle(titleToUse);
  
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle, ...synonyms].filter(q => q && q.length > 2))];

  const candidateMap = new Map<string, DesiSearchResult>();
  const searchPromises = queries.map(q => 
    fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, {}, 8000)
      .then(res => res.ok ? res.json() : null)
      .catch(() => null)
  );

  const results = await Promise.all(searchPromises);
  for (const data of results) {
    for (const cand of (data?.data?.results || [])) {
      if (!candidateMap.has(cand.id)) candidateMap.set(cand.id, cand);
    }
  }

  if (candidateMap.size === 0) return [];

  const scored: Candidate[] = [];
  for (const [slug, data] of candidateMap) {
    if (input.is_movie && data.type.toUpperCase() !== 'MOVIE') continue;
    if (!input.is_movie && data.type.toUpperCase() === 'MOVIE') continue;

    const scoreTitle = Math.max(
      getSimilarityScore(titleToUse, data.title),
      getSimilarityScore(romajiToUse, data.title),
      getSimilarityScore(rootTitle, data.title)
    );

    if (scoreTitle < 0.2) continue; 

    scored.push({ slug, title: data.title, type: data.type, score: scoreTitle });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  const basePromises = top.map(c => fetchDerivedBase(c.slug));
  const bases = await Promise.all(basePromises);

  for (let i = 0; i < top.length; i++) {
    top[i].derivedBaseName = bases[i];
    if (bases[i]) {
      const derivedText = bases[i]!.replace(/-/g, ' ');
      const derivedScore = Math.max(
        getSimilarityScore(titleToUse, derivedText),
        getSimilarityScore(romajiToUse, derivedText)
      );
      top[i].score = (top[i].score * 0.4) + (derivedScore * 0.6);
    }
  }

  top.sort((a, b) => b.score - a.score);
  return top;
}
