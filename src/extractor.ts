import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, isAllowedServer, verifyEpisodeNumber, getSimilarityScore } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

const resolvedCache = new Map<string, { bestSlug: string, offset: number, baseName?: string }>();

async function fetchTatakaiWatch(baseName: string, epNum: number | null, isMovie: boolean): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${TATAKAI_BASE}/api/v1/desidubanime/watch/${baseName}${suffix}`;
    
    const res = await fetchWithTimeout(url, {}, 6000); 
    if (!res.ok) return null;
    
    const json: any = await res.json();
    const rawSources = json?.data?.sources || [];
    const title = json?.data?.title || "";
    
    if (epNum !== null && !verifyEpisodeNumber(title, epNum, isMovie)) {
       return null; 
    }
    
    const validSources: DesiSource[] = [];
    for (const src of rawSources) {
      if (isAllowedServer(src.server || '')) {
        validSources.push({ server: src.server, url: src.url, type: src.type || 'embed' });
      }
    }
    return validSources.length > 0 ? validSources : null;
  } catch {
    return null;
  }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  if (candidates.length === 0) return [];

  const preferredLang = input.preferred_lang || 'hindi';
  const cacheKey = `${input.anilist_id}-${preferredLang}`;

  if (resolvedCache.has(cacheKey)) {
    const cached = resolvedCache.get(cacheKey)!;
    
    if (input.is_movie) {
      const moviePromises = [null, 1].map(ep => fetchTatakaiWatch(cached.bestSlug, ep, true));
      const results = await Promise.all(moviePromises);
      const valid = results.find(r => r && r.length > 0);
      if (valid) return valid;
    } else {
      const targetEp = input.episode + cached.offset;
      console.log(`[EXTRACT] ⚡ Cache Hit! Probing ${cached.bestSlug} Ep ${targetEp}`);
      const sources = await fetchTatakaiWatch(cached.bestSlug, targetEp, false);
      if (sources) return sources;
    }
  }

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  for (const cand of candidates) {
    const bases = [cand.slug, cand.derivedBaseName].filter(Boolean) as string[];
    
    for (const base of bases) {
      const isPrequelSlug = aniMeta?.prequels?.some(p => 
         getSimilarityScore(p.romajiTitle, base.replace(/-/g, ' ')) > 0.8 || 
         getSimilarityScore(p.title, base.replace(/-/g, ' ')) > 0.8
      );

      let epList: (number | null)[] = [];
      
      if (input.is_movie) {
         epList = [null, 1]; 
      } else {
         const currEp = input.episode;
         epList.push(currEp, currEp + 1, currEp - 1);
         
         const absEp = input.episode + prequelEps;
         epList.push(absEp, absEp + 1, absEp - 1);
      }

      if (isPrequelSlug && !input.is_movie) {
         epList = epList.filter(e => e !== null && e > input.episode); 
      }

      epList = [...new Set(epList.filter(e => e === null || e > 0))];

      console.log(`[EXTRACT] Probing ${base} | Eps: [${epList.join(', ')}]`);

      const probePromises = epList.map(ep => 
        fetchTatakaiWatch(base, ep, !!input.is_movie).then(sources => ({ ep, sources }))
      );
      
      const results = await Promise.all(probePromises);
      
      for (const res of results) {
        if (res.sources && res.sources.length > 0) {
          console.log(`[EXTRACT] ✓ Success: ${base} | Ep: ${res.ep}`);
          
          const finalOffset = input.is_movie ? 0 : ((res.ep || 0) - input.episode);
          
          resolvedCache.set(cacheKey, { 
            bestSlug: base, 
            offset: finalOffset 
          });
          
          return res.sources;
        }
      }
    }
  }

  console.log(`[EXTRACT] ❌ All candidates and offsets failed.`);
  return [];
}
