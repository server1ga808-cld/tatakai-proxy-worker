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

            // 🎯 ১. অফসেট ক্যালকুলেশন
            let anilistOffset = 0;
            if (aniMeta?.immediatePrequelEpisodes && aniMeta.immediatePrequelEpisodes > 0) {
                if (prequelSlug === cand.rawSlug) {
                    anilistOffset = aniMeta.immediatePrequelEpisodes; // Combined Season (Demon Slayer)
                } else if (prequelInfo?.realBaseName && realBaseName) {
                    if (prequelInfo.realBaseName === realBaseName) {
                        anilistOffset = aniMeta.immediatePrequelEpisodes; // Continuous (Bleach P2)
                    } else {
                        const resetKeywords = ['shippuden', 'super', 'gt', 'kai', 'brotherhood', 'diamond', 'crystal', 'dbs', 'boruto', 'next generations'];
                        const isReset = resetKeywords.some(kw => realBaseName.toLowerCase().includes(kw));
                        
                        if (!isReset && (realBaseName.startsWith(prequelInfo.realBaseName) || prequelInfo.realBaseName.startsWith(realBaseName))) {
                            anilistOffset = aniMeta.immediatePrequelEpisodes;
                        }
                    }
                }
            }

            // 🎯 ২. টার্গেট এপিসোড ক্যালকুলেশন
            const targetNum = input.episode + anilistOffset;

            // 🎯 ৩. প্রথমে Info-তে খোঁজা
            let targetEpId: string | null = null;
            if (infoEpisodes.length > 0) {
                const found = infoEpisodes.find((e: any) => {
                    let idEpNum = -1;
                    if (e.id) {
                        const m = String(e.id).match(/episode-(\d+)/i);
                        if (m) idEpNum = parseInt(m[1], 10);
                    }
                    return Number(e.number) === targetNum || idEpNum === targetNum;
                });
                if (found) targetEpId = found.id;
            }

            // 🎯 ৪. Blind Watch (শুধুমাত্র অফসেট নাম্বার দিয়েই)
            // অফসেট > ০ হলে আমরা ভুল করে input.episode দেব না (যাতে AoT-তে ভুল এপিসোড না আসে)
            if (!targetEpId && realBaseName) {
                const tryId = `${realBaseName}-episode-${targetNum}`;
                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                
                if (checkRes.ok) {
                    const checkJson = await checkRes.json();
                    const sources = checkJson?.data?.sources || [];
                    if (sources.length > 0) {
                        targetEpId = tryId;
                    }
                }
            }

            // 🎯 ৫. লিংক এক্সট্রাক্ট
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
