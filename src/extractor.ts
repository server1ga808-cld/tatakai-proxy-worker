import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, isAllowedServer, slugify } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function fetchTatakaiWatch(baseName: string, epNum: number | null): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${TATAKAI_BASE}/api/v1/desidubanime/watch/${baseName}${suffix}`;
    
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return null;
    
    const json: any = await res.json();
    const rawSources = json?.data?.sources || [];
    
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
  if (candidates.length === 0) {
    console.log(`[EXTRACT] No candidates found to extract.`);
    return [];
  }

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  // সম্ভাব্য সব BaseName 
  const allBases = new Set<string>();
  for (const cand of candidates) {
    if (cand.derivedBaseName) allBases.add(cand.derivedBaseName);
    allBases.add(cand.slug);
  }
  if (aniMeta?.current.title) allBases.add(slugify(aniMeta.current.title));
  if (aniMeta?.current.romajiTitle) allBases.add(slugify(aniMeta.current.romajiTitle));

  console.log(`[EXTRACT] All bases to check:`, Array.from(allBases));

  const probePromises: Promise<{ base: string, ep: number | null, sources: DesiSource[] | null }>[] = [];

  for (const base of allBases) {
    if (!base) continue;
    
    let epCandidates: (number | null)[] = [];
    if (input.is_movie) {
      epCandidates = [null, 1];
    } else {
      let eps = [input.episode + prequelEps, input.episode];
      epCandidates = [...new Set(eps.filter(e => e > 0))];
    }

    for (const ep of epCandidates) {
      probePromises.push(
        fetchTatakaiWatch(base, ep).then(sources => ({ base, ep, sources }))
      );
    }
  }

  // 🚀 সব একসাথে প্যারালালি চেক
  const results = await Promise.all(probePromises);
  
  // প্রথম সাকসেস হওয়া রেজাল্ট রিটার্ন করবে
  for (const res of results) {
    if (res.sources && res.sources.length > 0) {
      console.log(`[EXTRACT] ✓ Success on: ${res.base} | Ep: ${res.ep}`);
      return res.sources;
    }
  }

  console.log(`[EXTRACT] ❌ All candidates failed.`);
  return [];
}
