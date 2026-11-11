import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, decodeEmbedId, isAllowedServer } from './utils';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";
const DESI_BASE = "https://www.desidubanime.me";

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
  if (candidates.length === 0) return [];

  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  // সব ইউনিক BaseName এবং Slug বের করা
  const allBases = new Set<string>();
  for (const cand of candidates) {
    if (cand.derivedBaseName) allBases.add(cand.derivedBaseName);
    allBases.add(cand.slug);
  }

  const probePromises: Promise<DesiSource[] | null>[] = [];

  for (const base of allBases) {
    let epCandidates: (number | null)[] = [];
    if (input.is_movie) {
      epCandidates = [null, 1];
    } else {
      let eps = [input.episode + prequelEps, input.episode];
      epCandidates = [...new Set(eps.filter(e => e > 0))];
    }

    // প্রতিটা base এবং episode কম্বিনেশনের জন্য HTML স্ক্র্যাপ পুশ করা
    for (const ep of epCandidates) {
      probePromises.push(scrapeDesiHtml(base, ep));
    }
  }

  // 🚀 ১. প্রথমে সব HTML স্ক্র্যাপ প্যারালালি চেক করব
  const htmlResults = await Promise.all(probePromises);
  const validHtml = htmlResults.find(r => r && r.length > 0);
  if (validHtml) return validHtml;

  // 🚀 ২. যদি HTML স্ক্র্যাপ ফেল করে, তবে Tatakai API প্যারালালি চেক করব
  const tatakaiPromises: Promise<DesiSource[] | null>[] = [];
  for (const base of allBases) {
    let epCandidates: (number | null)[] = [];
    if (input.is_movie) {
      epCandidates = [null, 1];
    } else {
      let eps = [input.episode + prequelEps, input.episode];
      epCandidates = [...new Set(eps.filter(e => e > 0))];
    }
    for (const ep of epCandidates) {
      tatakaiPromises.push(fetchTatakaiWatch(base, ep));
    }
  }

  const tatakaiResults = await Promise.all(tatakaiPromises);
  const validTatakai = tatakaiResults.find(r => r && r.length > 0);
  if (validTatakai) return validTatakai;

  return [];
}
