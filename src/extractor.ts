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
            // ১. Info Endpoint থেকে episodes[] আনা
            const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 8000);
            let realBaseName = null;
            let targetEpId = null;
            
            if (infoRes.ok) {
                const infoJson = await infoRes.json();
                const episodes = infoJson?.data?.episodes || [];
                
                // 🎯 ১. first check: episodes[] অ্যারে-তে সরাসরি খোঁজা
                if (episodes.length > 0) {
                    const foundEp = episodes.find((e: any) => {
                        let idEpNum = -1;
                        if (e.id) {
                            const idMatch = String(e.id).match(/episode-(\d+)/i);
                            if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                        }
                        // input.episode অথবা absoluteEpisode
                        return Number(e.number) === input.episode || idEpNum === input.episode 
                            || Number(e.number) === absoluteEpisode || idEpNum === absoluteEpisode;
                    });
                    
                    if (foundEp) targetEpId = foundEp.id;

                    // realBaseName বের করা
                    if (episodes[0].id) {
                        const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                        if (match) realBaseName = match[1];
                    }
                }
            }

            // 🎯 ২. Blind Watch: অ্যারে-তে না পেলে সরাসরি URL চেক করা (প্রথমে input.episode, তারপর absolute)
            if (!targetEpId) {
                const epsToTry = [input.episode, absoluteEpisode].filter((v, i, a) => a.indexOf(v) === i);
                
                const basesToTry = [];
                if (realBaseName) basesToTry.push(realBaseName);
                if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

                outerLoop:
                for (const base of basesToTry) {
                    for (const epNum of epsToTry) {
                        const tryId = `${base}-episode-${epNum}`;
                        const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                        if (checkRes.ok) {
                            const checkJson = await checkRes.json();
                            const sources = checkJson?.data?.sources || [];
                            if (sources.length > 0) { 
                                targetEpId = tryId; 
                                break outerLoop; 
                            }
                        }
                    }
                }
            }

            // 🎯 ৩. সোর্স এক্সট্রাক্ট
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
