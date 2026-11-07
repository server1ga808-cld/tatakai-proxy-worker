import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // 🎯 ১. Info Endpoint থেকে এপিসোড লিস্ট নেওয়া
            const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 8000);
            if (!infoRes.ok) return servers;
            
            const infoJson = await infoRes.json();
            const episodes = infoJson?.data?.episodes || [];
            
            // 🎯 ২. অ্যারে-তে থাকা এপিসোডের সাথে ম্যাচ করা
            let targetEpId = null;

            if (input.is_movie) {
                if (episodes.length > 0) targetEpId = episodes[0].id;
            } else {
                // Exact Match (number বা id-তে absolute বা input episode)
                const foundEp = episodes.find((e: any) => {
                    let idEpNum = -1;
                    if (e.id) {
                        const idMatch = String(e.id).match(/episode-(\d+)/i);
                        if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                    }
                    return Number(e.number) === input.episode || idEpNum === input.episode 
                        || Number(e.number) === absoluteEpisode || idEpNum === absoluteEpisode;
                });

                if (foundEp) {
                    targetEpId = foundEp.id;
                }
            }

            // 🎯 ৩. যদি API-তে এপিসোড না থাকে, তবে কিছুই রিটার্ন করব না (No Guess)
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
                                url: cleanIframeUrl(finalUrl), 
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
