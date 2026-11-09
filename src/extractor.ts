import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function getInfo(slug: string): Promise<{ realBaseName: string | null; episodes: any[] }> {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, 8000);
        if (res.ok) {
            const data = await res.json();
            const episodes = data?.data?.episodes || [];
            let realBaseName: string | null = null;
            if (episodes.length > 0 && episodes[0].id) {
                const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                if (match) realBaseName = match[1];
            }
            return { realBaseName, episodes };
        }
    } catch (e) {}
    return { realBaseName: null, episodes: [] };
}

async function findPrequelSlug(prequelTitle: string): Promise<string | null> {
    if (!prequelTitle) return null;
    // শুধুমাত্র ১টি কুয়েরি
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

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            const currentInfo = await getInfo(cand.rawSlug);
            const realBaseName = currentInfo.realBaseName;
            const infoEpisodes = currentInfo.episodes;

            // 🎯 অফসেট ক্যালকুলেশন (শুধুমাত্র immediate prequel check)
            let offset = 0;
            if (aniMeta?.immediatePrequelTitle && (aniMeta.immediatePrequelEpisodes || 0) > 0) {
                const prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
                
                if (prequelSlug) {
                    // Case 1: Same slug (Combined Season - Ent District)
                    if (prequelSlug === cand.rawSlug) {
                        offset = aniMeta.immediatePrequelEpisodes;
                    } else if (realBaseName) {
                        // Case 2: Different slug → check realBaseName prefix (Bleach P2)
                        const prequelInfo = await getInfo(prequelSlug);
                        if (prequelInfo.realBaseName) {
                            const resetKeywords = ['shippuden', 'super', 'gt', 'kai', 'brotherhood', 'diamond', 'crystal', 'dbs', 'boruto'];
                            const isReset = resetKeywords.some(kw => realBaseName.toLowerCase().includes(kw));
                            
                            if (!isReset && (
                                prequelInfo.realBaseName === realBaseName ||
                                realBaseName.startsWith(prequelInfo.realBaseName) ||
                                prequelInfo.realBaseName.startsWith(realBaseName)
                            )) {
                                offset = aniMeta.immediatePrequelEpisodes;
                            }
                        }
                    }
                }
            }

            const targetEp = input.episode + offset;

            // 🎯 Info-তে খোঁজা
            let targetEpId: string | null = null;
            if (infoEpisodes.length > 0) {
                const found = infoEpisodes.find((e: any) => {
                    let idEpNum = -1;
                    if (e.id) {
                        const m = String(e.id).match(/episode-(\d+)/i);
                        if (m) idEpNum = parseInt(m[1], 10);
                    }
                    return Number(e.number) === targetEp || idEpNum === targetEp;
                });
                if (found) targetEpId = found.id;
            }

            // 🎯 Blind Watch
            if (!targetEpId && realBaseName) {
                const tryId = `${realBaseName}-episode-${targetEp}`;
                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                
                if (checkRes.ok) {
                    const checkJson = await checkRes.json();
                    const sources = checkJson?.data?.sources || [];
                    if (sources.length > 0) {
                        targetEpId = tryId;
                    }
                }
            }

            // 🎯 সোর্স এক্সট্রাক্ট
            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        const serverName = (src.server || '').toLowerCase();
                        if (serverName.includes('mirror') || serverName.includes('abyss') || serverName.includes('vmoly')) {
                            const decoded = decodeEmbedId(src.url);
                            servers.push({ 
                                server: src.server, 
                                url: cleanIframeUrl(decoded?.url || src.url), 
                                source: 'tatakai' 
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.error(`Extraction error on ${cand.rawSlug}:`, e);
        }
        return servers;
    });

    const results = await Promise.allSettled(extractionPromises);
    
    results.forEach(res => {
        if (res.status === 'fulfilled' && res.value.length > 0) {
            res.value.forEach((serverObj: any) => {
                if (!seenUrls.has(serverObj.url)) {
                    seenUrls.add(serverObj.url);
                    finalServers.push(serverObj);
                }
            });
        }
    });
    
    return finalServers;
}
