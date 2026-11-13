import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, isAllowedServer, verifyEpisodeNumber, getSimilarityScore, cleanIframeUrl } from './utils';
import { getCache, setCache, getResolvedCacheKey, TTL } from './cache';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function fetchTatakaiWatch(baseName: string, epNum: number | null, isMovie: boolean): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${TATAKAI_BASE}/api/v1/desidubanime/watch/${baseName}${suffix}`;
    
    const res = await fetchWithTimeout(url, {}, 10000); 
    if (!res.ok) return null;
    
    const json: any = await res.json();
    const rawSources = json?.data?.sources || [];
    const title = json?.data?.title || "";
    
    if (epNum !== null && title && !verifyEpisodeNumber(title, epNum, isMovie)) return null;
    
    const validSources: DesiSource[] = [];
    for (const src of rawSources) {
      if (isAllowedServer(src.server || '')) {
        validSources.push({ 
          server: src.server, 
          url: cleanIframeUrl(src.url), 
          type: src.type || 'embed' 
        });
      }
    }
    return validSources.length > 0 ? validSources : null;
  } catch { return null; }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  if (candidates.length === 0) return [];

  const preferredLang = input.preferred_lang || 'hindi';
  const resolvedCacheKey = getResolvedCacheKey(input.anilist_id, preferredLang);

  const cachedResolved = await getCache<{ bestSlug: string, offset: number }>(resolvedCacheKey);
  if (cachedResolved) {
    const targetEp = input.is_movie ? null : (input.episode + cachedResolved.offset);
    const sources = await fetchTatakaiWatch(cachedResolved.bestSlug, targetEp, !!input.is_movie);
    if (sources) {
      console.log(`[EXTRACT] ⚡ Cache Hit! Probed ${cachedResolved.bestSlug} | Ep: ${targetEp}`);
      return sources;
    }
  }

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;
  const prequelTitles = aniMeta?.currentPrequelTitles || [];
  const synonyms = aniMeta?.synonyms || [];

  for (const cand of candidates) {
    const bases = [...new Set([cand.derivedBaseName, cand.slug].filter(Boolean))] as string[];
    
    for (const base of bases) {
      const baseClean = base.replace(/-/g, ' ');
      
      const prequelScore = prequelTitles.length > 0 
        ? Math.max(...prequelTitles.map((p: string) => getSimilarityScore(p, baseClean))) 
        : 0;
        
      const currentScore = Math.max(
        getSimilarityScore(aniMeta?.current.title || "", baseClean),
        getSimilarityScore(aniMeta?.current.romajiTitle || "", baseClean),
        ...synonyms.map((s: string) => getSimilarityScore(s, baseClean))
      );
      
      const isPrequelSlug = prequelScore > 0.7 && prequelScore > currentScore;

      let primaryEps: (number | null)[] = [];
      if (input.is_movie) {
        primaryEps = [null, 1];
      } else {
        if (prequelEps > 0) primaryEps.push(input.episode + prequelEps);
        primaryEps.push(input.episode); 
        
        if (isPrequelSlug) primaryEps = primaryEps.filter(e => e !== null && e > prequelEps);
      }
      primaryEps = [...new Set(primaryEps.filter(e => e === null || e > 0))];

      console.log(`[EXTRACT] Phase 1 on ${base} | Eps: [${primaryEps.join(', ')}]`);
      let results = await Promise.all(primaryEps.map(ep => fetchTatakaiWatch(base, ep, !!input.is_movie).then(sources => ({ ep, sources }))));
      let valid = results.find(r => r.sources && r.sources.length > 0);

      if (!valid && !input.is_movie) {
        let fallbackEps: (number|null)[] = [input.episode + 1];
        if (prequelEps > 0) fallbackEps.push(input.episode + prequelEps + 1);
        
        if (isPrequelSlug) fallbackEps = fallbackEps.filter(e => e !== null && e > prequelEps);
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
        
        await setCache(resolvedCacheKey, { bestSlug: base, offset: finalOffset }, TTL.RESOLVED_STREAM); 
        return valid.sources!;
      }
    }
  }
  
  console.log(`[EXTRACT] ❌ All bases and offsets failed.`);
  return [];
    }
