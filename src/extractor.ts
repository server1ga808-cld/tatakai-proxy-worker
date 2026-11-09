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
    const candidates = new Set<string>();
    const cleaned = prequelTitle.replace(/:\s*Kimetsu no Yaiba/i, '').replace(/\s+Arc\s*$/i, '').replace(/\s+\(TV\)\s*$/i, '').trim();
    if (cleaned && cleaned !== prequelTitle) candidates.add(cleaned);
    candidates.add(prequelTitle);
    const mainTitle = prequelTitle.split(':')[0].trim();
    if (mainTitle && mainTitle !== prequelTitle) candidates.add(mainTitle);
    
    for (const q of candidates) {
        if (q.length < 3) continue;
        try {
            const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, 8000);
            if (res.ok) {
                const data = await res.json();
                const results = data?.data?.results || [];
                if (results.length > 0) return results[0].id;
            }
        } catch (e) {}
    }
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

            let prequelSlug: string | null = null;
            let prequelInfo: any = null;

            if (aniMeta?.immediatePrequelTitle) {
                prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
                if (prequelSlug) prequelInfo = await getInfo(prequelSlug);
            }

            // 🎯 Smart Offset Calculation
            let offset = 0;
            if (aniMeta?.immediatePrequelEpisodes && aniMeta.immediatePrequelEpisodes > 0) {
                // যদি আগের সিজনের স্লাগ এবং বর্তমান স্লাগ একই হয় (Bleach P2, AoT S4 P2)
                if (prequelInfo?.realBaseName && realBaseName && prequelInfo.realBaseName === realBaseName) {
                    offset = aniMeta.immediatePrequelEpisodes;
                }
            }

            const targetEp = input.episode + offset;

            // 🎯 Blind Watch (Render API-র Pagination বাইপাস)
            const basesToTry: string[] = [];
            if (realBaseName) basesToTry.push(realBaseName);
            if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

            outerLoop:
            for (const base of basesToTry) {
                const tryId = `${base}-episode-${targetEp}`;
                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                
                if (checkRes.ok) {
                    const checkJson = await checkRes.json();
                    const sources = checkJson?.data?.sources || [];
                    if (sources.length > 0) {
                        // সোর্স এক্সট্রাক্ট
                        sources.forEach((src: any) => {
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
                        if (servers.length > 0) break outerLoop;
                    }
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
