import type { Candidate, ProxyInput, DesiSource } from './types';
import { getAniListMeta } from './anilist';
import { fetchWithTimeout, decodeEmbedId, isAllowedServer, slugify } from './utils';

const DESI_BASE = "https://www.desidubanime.me";

// ─── Direct HTML Scraper ───────────────────────────────
async function scrapeDesiHtml(baseName: string, epNum: number | null): Promise<DesiSource[] | null> {
  try {
    const suffix = epNum !== null ? `-episode-${epNum}` : '';
    const url = `${DESI_BASE}/watch/${baseName}${suffix}/`;
    
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${DESI_BASE}/`
      }
    }, 6000);

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

// ─── Main Extractor Logic ───────────────────────────────
export async function extractStreams(candidates: Candidate[], input: ProxyInput): Promise<DesiSource[]> {
  const aniMeta = await getAniListMeta(input.anilist_id);
  const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

  // 🎯 সম্ভাব্য সব BaseName জেনারেট করা
  const allBases = new Set<string>();

  // ১. Native Search থেকে পাওয়া স্লাগসমূহ
  for (const cand of candidates) allBases.add(cand.slug);

  // ২. AniList ডেটা থেকে অটো-জেনারেট করা স্লাগসমূহ
  if (aniMeta) {
    if (aniMeta.current.title) allBases.add(slugify(aniMeta.current.title));
    if (aniMeta.current.romajiTitle) allBases.add(slugify(aniMeta.current.romajiTitle));
    
    // প্রিকোয়েল থাকলে (AoT P2, Bleach P2-এর জন্য)
    if (aniMeta.prequels && aniMeta.prequels.length > 0) {
      if (aniMeta.prequels[0].title) allBases.add(slugify(aniMeta.prequels[0].title));
      if (aniMeta.prequels[0].romajiTitle) allBases.add(slugify(aniMeta.prequels[0].romajiTitle));
    }
  }

  const probePromises: Promise<DesiSource[] | null>[] = [];

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
      probePromises.push(scrapeDesiHtml(base, ep));
    }
  }

  // 🚀把所有可能的结果一次性轰炸出去！(Super Parallel)
  const results = await Promise.all(probePromises);
  
  // প্রথম যেটা সাকসেস হবে, সেটাই রিটার্ন করব
  const validResult = results.find(r => r && r.length > 0);
  return validResult || [];
}
