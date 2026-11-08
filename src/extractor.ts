import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    // 🎯 Prequel Slug একবার চেক করি
    let prequelSlug: string | null = null;
    if (aniMeta?.immediatePrequelTitle) {
        try {
            const prequelRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(aniMeta.immediatePrequelTitle)}`, 8000);
            if (prequelRes.ok) {
                const prequelData = await prequelRes.json();
                prequelSlug = prequelData?.data?.results?.[0]?.id || null;
            }
        } catch (e) {}
    }

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 10000);
            let realBaseName = null;
            let infoEpisodes: any[] = [];
            
            if (infoRes.ok) {
                const infoJson = await infoRes.json();
                infoEpisodes = infoJson?.data?.episodes || [];
                if (infoEpisodes.length > 0 && infoEpisodes[0].id) {
                    const match = String(infoEpisodes[0].id).match(/(.+?)-episode-\d+/i);
                    if (match) realBaseName = match[1];
                }
            }

            // 🎯 Offset Calculation
            let offset = 0;
            if (aniMeta?.immediatePrequelEpisodes && aniMeta.immediatePrequelEpisodes > 0) {
                if (prequelSlug === cand.rawSlug) {
                    offset = aniMeta.immediatePrequelEpisodes;
                }
            }
            const targetEp = input.episode + offset;

            // 🎯 Step 1: Info Episodes array-তে খুঁজি
            let targetEpId = null;
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

            // 🎯 Step 2: Blind Watch (শুধু targetEp দিয়ে, কোনো input.episode fallback নেই)
            if (!targetEpId) {
                const basesToTry = [];
                if (realBaseName) basesToTry.push(realBaseName);
                if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

                outerLoop:
                for (const base of basesToTry) {
                    const tryId = `${base}-episode-${targetEp}`;
                    const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                    
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        const sources = checkJson?.data?.sources || [];
                        const responseTitle = checkJson?.data?.title || "";
                        
                        // 🎯 Strict Title Verification: returnedEp === targetEp হতে হবে
                        const titleMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                        const returnedEp = titleMatch ? parseInt(titleMatch[1], 10) : null;
                        
                        if (returnedEp !== null && returnedEp !== targetEp) {
                            // ভুল এপিসোড, skip
                            continue;
                        }
                        
                        if (sources.length > 0) {
                            targetEpId = tryId;
                            break outerLoop;
                        }
                    }
                }
            }

            // 🎯 Step 3: সোর্স এক্সট্রাক্ট
            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
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
        } catch (e) {}
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
