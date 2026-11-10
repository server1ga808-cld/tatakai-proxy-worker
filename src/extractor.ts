import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function getInfo(slug: string) {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, 8000);
        if (res.ok) {
            const data = await res.json();
            const episodes = data?.data?.episodes || [];
            const realBaseName = data?.data?.realBaseName || slug;
            let derivedBaseName: string | null = null;
            if (episodes.length > 0 && episodes[0].id) {
                const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                if (match) derivedBaseName = match[1];
            }
            return { realBaseName, derivedBaseName, episodes };
        }
    } catch (e) {}
    return { realBaseName: null, derivedBaseName: null, episodes: [] as any[] };
}

async function probeWatch(base: string, epNum: number) {
    try {
        const tryId = `${base}-episode-${epNum}`;
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
        if (!res.ok) return null;
        const json = await res.json();
        const sources = json?.data?.sources || [];
        const title = json?.data?.title || '';
        return sources.length > 0 ? { sources, title } : null;
    } catch (e) {
        return null;
    }
}

async function probeMovieSlug(slug: string) {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${slug}`, 8000);
        if (res.ok) {
            const json = await res.json();
            const sources = json?.data?.sources || [];
            return sources.length > 0 ? sources : null;
        }
    } catch (e) {}
    return null;
}

function collectSources(sources: any[], finalServers: any[], seenUrls: Set<string>) {
    for (const src of sources) {
        const name = (src.server || '').toLowerCase();
        if (!name.includes('mirror') && !name.includes('abyss') && !name.includes('vmoly')) continue;
        const decoded = decodeEmbedId(src.url);
        const url = cleanIframeUrl(decoded?.url || src.url);
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            finalServers.push({ server: src.server, url, source: 'tatakai' });
        }
    }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

    const titleBlob = (input.title + ' ' + (input.romaji_title || '')).toLowerCase();
    const isContinuation = /(?:part\s*\d+|final\s*season|arc|cour\s*\d+|season\s*[2-9]|\b(?:2nd|3rd|4th|5th|6th|7th|8th|9th)\s*season)/i.test(titleBlob);

    console.log(`[EXTRACT] prequelEps=${prequelEps} isContinuation=${isContinuation} candidates=${candidates.length}`);

    for (const cand of candidates) {
        // 🎯 FIX 1: Format Check (API call ছাড়াই)
        const candType = (cand.type || 'TV').toUpperCase();
        if (input.is_movie && candType !== 'MOVIE') {
            console.log(`[EXTRACT] SKIP (Format): ${cand.rawSlug} is ${candType}`);
            continue;
        }
        if (!input.is_movie && candType === 'MOVIE') {
            console.log(`[EXTRACT] SKIP (Format): ${cand.rawSlug} is MOVIE`);
            continue;
        }

        // 🎯 MOVIE HANDLING
        if (input.is_movie) {
            const sources = await probeMovieSlug(cand.rawSlug);
            if (sources) {
                collectSources(sources, finalServers, seenUrls);
                if (finalServers.length > 0) return finalServers;
            }
            continue;
        }

        // 🎯 GET INFO
        const info = await getInfo(cand.rawSlug);
        if (!info.realBaseName) continue;

        // Compute minEp
        let minEp = Infinity;
        for (const e of info.episodes) {
            const n = Number(e.number);
            if (!isNaN(n) && n < minEp) minEp = n;
        }

        // 🎯 FIX 2: derivedBaseName first (আসল watch URL base)
        const bases: string[] = [];
        if (info.derivedBaseName) bases.push(info.derivedBaseName);
        if (info.realBaseName && !bases.includes(info.realBaseName)) bases.push(info.realBaseName);
        if (!bases.includes(cand.rawSlug)) bases.push(cand.rawSlug);

        // 🎯 Determine Episode Candidates
        let epCandidates: number[];
        if (!aniMeta || prequelEps === 0) {
            epCandidates = [input.episode];
        } else if (isContinuation || minEp > 1) {
            epCandidates = [input.episode + prequelEps, input.episode];
        } else {
            epCandidates = [input.episode, input.episode + prequelEps];
        }
        epCandidates = [...new Set(epCandidates.filter(e => e > 0))];

        console.log(`[EXTRACT] ${cand.rawSlug}: minEp=${minEp} bases=[${bases.join(', ')}] epCandidates=[${epCandidates.join(', ')}]`);

        // 🎯 FIX 3 & 4: Probe with Title Verification + Early Return
        outerLoop:
        for (const base of bases) {
            for (const ep of epCandidates) {
                const result = await probeWatch(base, ep);
                if (result) {
                    const titleMatch = result.title.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                    const returnedEp = titleMatch ? parseInt(titleMatch[1], 10) : null;
                    
                    if (returnedEp !== null && returnedEp !== ep) {
                        console.log(`[EXTRACT] SKIP (Title ${returnedEp} ≠ ${ep}): ${base}-episode-${ep}`);
                        continue;
                    }
                    
                    console.log(`[EXTRACT] ✓ SUCCESS: ${base}-episode-${ep} (title="${result.title}")`);
                    collectSources(result.sources, finalServers, seenUrls);
                    break outerLoop;
                }
            }
        }
        
        // 🎯 FIX 5: Early Return (প্রথম candidate-এ সফল হলে বাকিগুলো স্কিপ)
        if (finalServers.length > 0) return finalServers;
    }

    console.log(`[EXTRACT] FINAL: ${finalServers.length} servers`);
    return finalServers;
}
