import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function getInfo(slug: string): Promise<{ realBaseName: string | null; derivedBaseName: string | null; episodes: any[] }> {
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
    return { realBaseName: null, derivedBaseName: null, episodes: [] };
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

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            const currentInfo = await getInfo(cand.rawSlug);
            const realBaseName = currentInfo.realBaseName; 
            const derivedBaseName = currentInfo.derivedBaseName; 

            const resetKeywords = ['shippuden', 'super', 'gt', 'kai', 'brotherhood', 'diamond', 'crystal', 'dbs', 'boruto'];
            const isReset = realBaseName && resetKeywords.some(kw => realBaseName.toLowerCase().includes(kw));

            let prequelSlug: string | null = null;
            let prequelInfo: any = null;

            if (!isReset && aniMeta?.immediatePrequelTitle) {
                prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
                if (prequelSlug) {
                    prequelInfo = await getInfo(prequelSlug);
                }
            }

            const isCombined = !isReset && (
                (prequelSlug === cand.rawSlug) || 
                (prequelInfo?.derivedBaseName && derivedBaseName && prequelInfo.derivedBaseName === derivedBaseName) ||
                (prequelInfo?.realBaseName && realBaseName && prequelInfo.realBaseName === realBaseName)
            );

            let epNumbers: number[] = [];
            const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

            if (isCombined) {
                epNumbers = [input.episode + prequelEps];
            } else if (prequelEps > 0 && !isReset) {
                epNumbers = [input.episode, input.episode + prequelEps];
            } else {
                epNumbers = [input.episode];
            }
            epNumbers = [...new Set(epNumbers)];

            // 🎯 Critical Fix: derivedBaseName first, then realBaseName
            const basesToTry: string[] = [];
            if (derivedBaseName) basesToTry.push(derivedBaseName);
            if (realBaseName && !basesToTry.includes(realBaseName)) basesToTry.push(realBaseName);
            if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

            let targetEpId: string | null = null;

            outerLoop:
            for (const epNum of epNumbers) {
                for (const base of basesToTry) {
                    const tryId = `${base}-episode-${epNum}`;
                    const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                    
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        const sources = checkJson?.data?.sources || [];
                        const responseTitle = checkJson?.data?.title || "";
                        
                        const titleMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                        const returnedEp = titleMatch ? parseInt(titleMatch[1], 10) : null;
                        
                        // 🎯 API ভুল দিলে break না করে continue করব (যাতে পরের base ট্রাই করা যায়)
                        if (returnedEp !== null && returnedEp !== epNum) {
                            continue; 
                        }
                        
                        if (sources.length > 0) {
                            targetEpId = tryId;
                            break outerLoop;
                        }
                    }
                }
            }

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
