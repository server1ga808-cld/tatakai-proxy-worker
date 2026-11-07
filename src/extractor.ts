import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const isSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            let targetEpId = null;
            
            const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 8000);
            let realBaseName = null;
            if (infoRes.ok) {
                const infoJson = await infoRes.json();
                const episodes = infoJson?.data?.episodes || [];
                if (episodes.length > 0 && episodes[0].id) {
                    const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                    if (match) realBaseName = match[1];
                }
            }

            // 🎯 Absolute এবং Input Episode দুটোই ট্রাই করব (ফলব্যাক)
            let epsToTry = [absoluteEpisode, input.episode];
            epsToTry = [...new Set(epsToTry)]; 

            if (realBaseName) {
                for (const epNum of epsToTry) {
                    const tryId = `${realBaseName}-episode-${epNum}`;
                    const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        const sources = checkJson?.data?.sources || [];
                        if (sources.length > 0) { targetEpId = tryId; break; }
                    }
                }
            }

            if (!targetEpId) {
                for (const epNum of epsToTry) {
                    const tryId = `${cand.rawSlug}-episode-${epNum}`;
                    const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        if (checkJson?.data?.sources?.length > 0) { targetEpId = tryId; break; }
                    }
                }
            }

            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                            const decoded = decodeEmbedId(src.url);
                            const finalUrl = decoded?.url || src.url;
                            servers.push({ 
                                server: src.server, 
                                url: cleanIframeUrl(finalUrl), // 🎯 iframe ট্যাগ সেফটি
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
