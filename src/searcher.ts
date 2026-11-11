import type { ProxyInput, Candidate, DesiSearchResult } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, getSimilarityScore, getRootTitle, slugify } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";
const DESI_BASE = "https://www.desidubanime.me";

// DesiDub Native Search (যদি Tatakai ডাউন থাকে)
async function searchDesiNative(query: string): Promise<DesiSearchResult[]> {
  try {
    const url = `${DESI_BASE}/wp-json/kiranime/v1/anime/search?query=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 6000);
    if (!res.ok) return [];
    
    const json: any = await res.json();
    const html = json?.result || '';
    const regex = /href="https:\/\/www\.desidubanime\.me\/anime\/([^/]+)\/".*?<span class="group-data-\[language=jp\]\/body:hidden"[^>]*>([^<]+)<\/span>/gs;
    
    const results: DesiSearchResult[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({ id: match[1], title: match[2].trim(), type: 'TV', url: '' });
    }
    return results;
  } catch { return []; }
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  
  const titleToUse = aniMeta?.current.title || input.title;
  const romajiToUse = aniMeta?.current.romajiTitle || input.romaji_title || '';
  const rootTitle = getRootTitle(titleToUse);
  const romajiSlug = slugify(romajiToUse);
  
  const queries = [...new Set([titleToUse, romajiToUse, rootTitle].filter(q => q && q.length > 2))];

  const scoreMap = new Map<string, { cand: DesiSearchResult, score: number }>();

  // ১. Tatakai Search
  const tatakaiPromises = queries.map(q => 
    fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, {}, 8000)
      .then(res => res.ok ? res.json() : null)
      .then(data => data?.data?.results || [])
      .catch(() => [])
  );
  
  const tatakaiResults = await Promise.all(tatakaiPromises);
  let flatResults = tatakaiResults.flat();

  // ২. Fallback: Native Search (যদি Tatakai খালি থাকে)
  if (flatResults.length === 0) {
    console.log(`[SEARCH] Tatakai empty, trying Native...`);
    const nativeResults = await Promise.all(queries.map(q => searchDesiNative(q)));
    flatResults = nativeResults.flat();
  }

  for (const cand of flatResults) {
    if (!scoreMap.has(cand.id)) {
      let score = Math.max(
        getSimilarityScore(titleToUse, cand.title),
        getSimilarityScore(romajiToUse, cand.title)
      );
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
  return scored.slice(0, 3); // টপ ৩ ক্যান্ডিডেট
}
