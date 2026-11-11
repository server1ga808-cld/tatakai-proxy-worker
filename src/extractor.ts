import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, decodeEmbedId, isAllowedServer } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";
const DESI_BASE = "https://www.desidubanime.me";

// ─── 1. Direct HTML Scraper (epNum: null হলে স্লাগে -episode লাগবে না) ───
async function scrapeDesiHtml(baseName: string, epNum: number | null): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${DESI_BASE}/watch/${baseName}${suffix}/`;
    
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${DESI_BASE}/`
      }
    }, 8000);

    if (!res.ok) return null;
    const html = await res.text();

    const regex = /data-embed-id="([^"]+)"/g;
    const sources: DesiSource[] = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const decoded = decodeEmbedId(match[1]);
      if (decoded && isAllowedServer(decoded.server)) {
        sources.push(decoded);
      }
    }
    return sources.length > 0 ? sources : null;
  } catch {
    return null;
  }
}

// ─── 2. Tatakai Watch API (Fallback) ───────────────────
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

// ─── 3. Parallel Probing Logic ─────────────────────────
async function probeParallel(base: string, epCandidates: (number | null)[]): Promise<DesiSource[] | null> {
  // প্রথমে প্যারালালি HTML স্ক্র্যাপ করব (সবচেয়ে ফাস্ট)
  const htmlPromises = epCandidates.map(ep => scrapeDesiHtml(base, ep));
  const htmlResults = await Promise.all(htmlPromises);
  const validHtml = htmlResults.find(r => r && r.length > 0);
  if (validHtml) return validHtml;

  // HTML ফেল করলে প্যারালালি Tatakai API তে হিট করব
  const tatakaiPromises = epCandidates.map(ep => fetchTatakaiWatch(base, ep));
  const tatakaiResults = await Promise.all(tatakaiPromises);
  const validTatakai = tatakaiResults.find(r => r && r.length > 0);
  if (validTatakai) return validTatakai;

  return null;
}

// ─── 4. Main Extractor ─────────────────────────────────
export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  if (candidates.length === 0) return [];

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  for (const cand of candidates) {
    const bases = [cand.derivedBaseName, cand.slug].filter(Boolean) as string[];

    for (const base of bases) {
      let epCandidates: (number | null)[] = [];

      if (input.is_movie) {
        // মুভির জন্য: সরাসরি base এবং base-episode-1
        epCandidates = [null, 1];
      } else {
        // TV সিরিজের জন্য: [ep + prequelEps, ep]
        let eps = [input.episode + prequelEps, input.episode];
        epCandidates = [...new Set(eps.filter(e => e > 0))];
      }

      console.log(`[EXTRACT] Probing Base: ${base} | Eps: [${epCandidates.join(', ')}]`);
      
      const sources = await probeParallel(base, epCandidates);
      if (sources) {
        console.log(`[EXTRACT] ✓ Success: ${base}`);
        return sources;
      }
    }
  }

  console.log(`[EXTRACT] ❌ All candidates and offsets failed.`);
  return [];
}
