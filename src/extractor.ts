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
        return sources.length > 0 ? sources : null;
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

    // 🎯 Step 1: Determine if this is a continuation-type title
    const titleBlob = (input.title + ' ' + (input.romaji_title || '')).toLowerCase();
    const isContinuation = /(?:part\s*\d+|final\s*season|arc|cour\s*\d+|season\s*[2-9]|\b(?:2nd|3rd|4th|5th|6th|7th|8th|9th)\s*season)/i.test(titleBlob);

    console.log(`[EXTRACT] prequelEps=${prequelEps} isContinuation=${isContinuation}`);

    for (const cand of candidates) {
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

        // 🎯 Compute minEp
        let minEp = Infinity;
        for (const e of info.episodes) {
            const n = Number(e.number);
            if (!isNaN(n) && n < minEp) minEp = n;
        }
        console.log(`[EXTRACT] slug=${cand.rawSlug} minEp=${minEp}`);

        // 🎯 Build bases (in priority order)
        const bases: string[] = [];
        if (info.realBaseName) bases.push(info.realBaseName);
        if (info.derivedBaseName && !bases.includes(info.derivedBaseName)) bases.push(info.derivedBaseName);
        if (!bases.includes(cand.rawSlug)) bases.push(cand.rawSlug);

        // 🎯 Determine Episode Candidates
        let epCandidates: number[];
        if (!aniMeta || prequelEps === 0) {
            // S1 of a franchise (Frieren, One Piece, Oshi no Ko S1)
            epCandidates = [input.episode];
        } else if (isContinuation) {
            // Continuation (AoT S4 P2, Bleach P2, Demon Slayer Ent District)
            epCandidates = [input.episode + prequelEps, input.episode];
        } else if (minEp > 1) {
            // Info shows high episodes → continuous numbering (JJK S2)
            epCandidates = [input.episode + prequelEps, input.episode];
        } else {
            // Restart series (Naruto Shippuden, AoT S2)
            epCandidates = [input.episode, input.episode + prequelEps];
        }
        epCandidates = [...new Set(epCandidates.filter(e => e > 0))];
        console.log(`[EXTRACT] epCandidates=`, epCandidates);

        // 🎯 Probe each (base, ep) combination
        for (const base of bases) {
            for (const ep of epCandidates) {
                const sources = await probeWatch(base, ep);
                if (sources) {
                    console.log(`[EXTRACT] SUCCESS: ${base}-episode-${ep}`);
                    collectSources(sources, finalServers, seenUrls);
                    if (finalServers.length > 0) return finalServers;
                }
            }
        }
    }

    return finalServers;
}
