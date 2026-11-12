import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, isAllowedServer, verifyEpisodeNumber, getSimilarityScore, getCache, setCache } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function fetchTatakaiWatch(baseName: string, epNum: number | null, isMovie: boolean): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${TATAKAI_BASE}/api/v1/desidubanime/watch/${baseName}${suffix}`;
    
    // 🎯 Timeout increased to 10s
    const res = await fetchWithTimeout(url, {}, 10000); 
    if (!res.ok) return null;
    
    const json: any = await res.json();
    const rawSources = json?.data?.sources || [];
    const title = json?.data?.title || "";
    
    // Title Verification with relaxed regex
    if (epNum !== null && !verifyEpisodeNumber(title, epNum, isMovie)) return null;
    
    const validSources: DesiSource[] = [];
    for (const src of rawSources) {
      if (isAllowedServer(src.server || '')) validSources.push({ server: src.server, url: src.url, type: src.type || 'embed' });
    }
    return validSources.length > 0 ? validSources : null;
  } catch { return null; }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  if (candidates.length === 0) return [];

  const preferredLang = input.preferred_lang || 'hindi';
  const resolvedCacheKey = `resolved-${input.anilist_id}-${preferredLang}`;

  const cachedResolved = await getCache<{ bestSlug: string, offset: number }>(resolvedCacheKey);
  if (cachedResolved) {
    if (input.is_movie) {
      const valid = (await Promise.all([null, 1].map(ep => fetchTatakaiWatch(cachedResolved.bestSlug, ep, true)))).find(r => r && r.length > 0);
      if (valid) return valid;
    } else {
      const targetEp = input.episode + cachedResolved.offset;
      const sources = await fetchTatakaiWatch(cachedResolved.bestSlug, targetEp, false);
      if (sources) return sources;
    }
  }

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  // 🎯 Dynamic Prequels Check from Timeline
  const targetIndex = aniMeta?.timeline.findIndex(t => t.anilistId === input.anilist_id) ?? -1;
  const prequelTitles = targetIndex > 0 ? aniMeta!.timeline.slice(0, targetIndex).map(t => t.romajiTitle) : [];

  for (const cand of candidates) {
    const bases = [cand.slug, cand.derivedBaseName].filter(Boolean) as string[];
    
    for (const base of bases) {
      const isPrequelSlug = prequelTitles.some(p => getSimilarityScore(p, base.replace(/-/g, ' ')) > 0.8);

      // 🎯 Phase 1: Primary Targets
      let primaryEps: (number | null)[] = [];
      if (input.is_movie) {
        primaryEps = [null, 1];
      } else {
        // Absolute Numbering (AoT P2 / Bleach P2)
        if (prequelEps > 0) {
           primaryEps.push(input.episode + prequelEps);
        }
        // Normal Numbering (AoT S2)
        primaryEps.push(input.episode);
        
        // P1 Blocking Logic
        if (isPrequelSlug) {
           primaryEps = primaryEps.filter(e => e !== null && e > input.episode);
        }
      }
      
      primaryEps = [...new Set(primaryEps.filter(e => e === null || e > 0))];

      console.log(`[EXTRACT] Phase 1 on ${base} | Eps: [${primaryEps.join(', ')}]`);
      let results = await Promise.all(primaryEps.map(ep => fetchTatakaiWatch(base, ep, !!input.is_movie).then(sources => ({ ep, sources }))));
      let valid = results.find(r => r.sources && r.sources.length > 0);

      // 🎯 Phase 2: Tolerance Fallback (±1)
      if (!valid && !input.is_movie) {
        let fallbackEps: (number|null)[] = [input.episode + 1, input.episode - 1];
        if (prequelEps > 0) fallbackEps.push(input.episode + prequelEps + 1, input.episode + prequelEps - 1);
        
        if (isPrequelSlug) fallbackEps = fallbackEps.filter(e => e !== null && e > input.episode);
        fallbackEps = [...new Set(fallbackEps.filter(e => e !== null && e > 0 && !primaryEps.includes(e)))];

        if (fallbackEps.length > 0) {
          console.log(`[EXTRACT] Phase 2 Fallback on ${base} | Eps: [${fallbackEps.join(', ')}]`);
          results = await Promise.all(fallbackEps.map(ep => fetchTatakaiWatch(base, ep, false).then(sources => ({ ep, sources }))));
          valid = results.find(r => r.sources && r.sources.length > 0);
        }
      }

      if (valid) {
        console.log(`[EXTRACT] ✓ Success: ${base} | Ep: ${valid.ep}`);
        const finalOffset = input.is_movie ? 0 : ((valid.ep || 0) - input.episode);
        await setCache(resolvedCacheKey, { bestSlug: base, offset: finalOffset }, 86400 * 7); // ৭ দিন ক্যাশ
        return valid.sources!;
      }
    }
  }
  return [];
}
