import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, decodeEmbedId, isAllowedServer } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

// ─── Tatakai Watch API ─────────────────────────────────
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

// ─── Main Extractor ────────────────────────────────────
export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  if (candidates.length === 0) return [];

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  // অফসেট অ্যারে: [ep + prequelEps, ep]
  let epCandidates: (number | null)[] = [];
  if (input.is_movie) {
    epCandidates = [null, 1];
  } else {
    let eps = [input.episode + prequelEps, input.episode];
    epCandidates = [...new Set(eps.filter(e => e > 0))];
  }

  // 🎯 ক্যান্ডিডেটগুলো স্কোর অনুযায়ী সাজানো (বেস্ট ক্যান্ডিডেট আগে চেক হবে)
  for (const cand of candidates) {
    const bases = [cand.derivedBaseName, cand.slug].filter(Boolean) as string[];

    for (const base of bases) {
      console.log(`[EXTRACT] Probing Base: ${base} | Eps: [${epCandidates.join(', ')}]`);
      
      // একই বেসের জন্য epCandidates গুলো প্যারালালি চেক করা হবে
      const probePromises = epCandidates.map(ep => fetchTatakaiWatch(base, ep));
      const results = await Promise.all(probePromises);

      // যদি এই বেসে সাকসেস হয়, তবে সাথে সাথে রিটার্ন করব
      const validResult = results.find(r => r && r.length > 0);
      if (validResult) {
        console.log(`[EXTRACT] ✓ Success: ${base}`);
        return validResult;
      }
    }
  }

  console.log(`[EXTRACT] ❌ All candidates and offsets failed.`);
  return [];
}
