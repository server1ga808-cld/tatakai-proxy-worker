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
    return { realBaseName: null as string | null, derivedBaseName: null as string | null, episodes: [] as any[] };
}

async function findPrequelSlug(prequelTitle: string): Promise<string | null> {
    if (!prequelTitle) return null;
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(prequelTitle)}`, 8000);
        if (res.ok) {
            const data = await res.json();
            const results = data?.data?.results || [];
            if (results.length > 0) return results[0].id;
        }
    } catch (e) {}
    return null;
}

async function tryWatch(base: string, epNum: number) {
    try {
        const tryId = `${base}-episode-${epNum}`;
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
        if (!res.ok) return null;
        const json = await res.json();
        const title = json?.data?.title || "";
        const sources = json?.data?.sources || [];
        if (sources.length === 0) return null;
        const match = title.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
        if (match && parseInt(match[1], 10) !== epNum) return null;
        return sources;
    } catch (e) {
        return null;
    }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    for (const cand of candidates) {
        // 🎯 MOVIE FIX: মুভির জন্য শুধু slug হিট করব (episode suffix ছাড়া)
        if (input.is_movie) {
            try {
                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${cand.rawSlug}`, 8000);
                if (res.ok) {
                    const json = await res.json();
                    const sources = json?.data?.sources || [];
                    if (sources.length > 0) {
                        sources.forEach((src: any) => {
                            const serverName = (src.server || '').toLowerCase();
                            if (serverName.includes('mirror') || serverName.includes('abyss') || serverName.includes('vmoly')) {
                                const decoded = decodeEmbedId(src.url);
                                const url = cleanIframeUrl(decoded?.url || src.url);
                                if (!seenUrls.has(url)) {
                                    seenUrls.add(url);
                                    finalServers.push({ server: src.server, url, source: 'tatakai' });
                                }
                            }
                        });
                    }
                }
            } catch (e) {}
            if (finalServers.length > 0) break;
            continue;
        }

        const currentInfo = await getInfo(cand.rawSlug);
        if (!currentInfo.realBaseName) continue;

        const realBaseName = currentInfo.realBaseName;
        const derivedBaseName = currentInfo.derivedBaseName;
        const infoEpisodes = currentInfo.episodes;

        const bases: string[] = [];
        if (derivedBaseName) bases.push(derivedBaseName);
        if (realBaseName && !bases.includes(realBaseName)) bases.push(realBaseName);
        if (!bases.includes(cand.rawSlug)) bases.push(cand.rawSlug);

        const resetKeywords = ['shippuden', 'super', 'gt', 'kai', 'brotherhood', 'diamond', 'crystal', 'dbs', 'boruto', 'next generations'];
        const isReset = resetKeywords.some(kw => realBaseName.toLowerCase().includes(kw));

        let prequelSlug: string | null = null;
        if (!isReset && aniMeta?.immediatePrequelTitle) {
            prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
        }
        
        const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

        // 🎯 minEp চেক (Pagination/Offset এর জন্য)
        let minEp = 9999;
        for (const e of infoEpisodes) {
            const num = Number(e.number);
            if (!isNaN(num) && num < minEp) minEp = num;
        }

        // 🎯 Dynamic Episode Priority Logic
        let epNumbers: number[] = [];
        
        if (isReset) {
            epNumbers = [input.episode];
        } else if (prequelEps > 0 && (prequelSlug === cand.rawSlug || minEp > 1)) {
            // Combined অথবা Pagination/Offset থাকলে (JJK S2 minEp = 38, Bleach minEp = 4)
            epNumbers = [input.episode + prequelEps, input.episode];
        } else if (prequelEps > 0) {
            // Standard Sequel (AoT S2 minEp = 1)
            epNumbers = [input.episode, input.episode + prequelEps];
        } else {
            epNumbers = [input.episode];
        }
        epNumbers = [...new Set(epNumbers)];

        outerLoop:
        for (const epNum of epNumbers) {
            for (const base of bases) {
                const sources = await tryWatch(base, epNum);
                if (sources && sources.length > 0) {
                    sources.forEach((src: any) => {
                        const serverName = (src.server || '').toLowerCase();
                        if (serverName.includes('mirror') || serverName.includes('abyss') || serverName.includes('vmoly')) {
                            const decoded = decodeEmbedId(src.url);
                            const url = cleanIframeUrl(decoded?.url || src.url);
                            if (!seenUrls.has(url)) {
                                seenUrls.add(url);
                                finalServers.push({ server: src.server, url, source: 'tatakai' });
                            }
                        }
                    });
                    break outerLoop;
                }
            }
        }
        
        if (finalServers.length > 0) break;
    }
    
    return finalServers;
}
