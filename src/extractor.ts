import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ১. Info Endpoint থেকে realBaseName এবং episodes[] আনা
            const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 8000);
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

            // 🎯 ২. সম্ভাব্য সব এপিসোড নাম্বার তৈরি করা
            let epsToTry: number[] = [];
            
            // ১. Immediate Prequel Offset (যেমন Ent Dist: 1 + 7 = 8)
            if (aniMeta?.immediatePrequelEpisodes && aniMeta.immediatePrequelEpisodes > 0) {
                epsToTry.push(input.episode + aniMeta.immediatePrequelEpisodes);
            }
            
            // ২. Direct Episode (যেমন Mugen Train: 1)
            epsToTry.push(input.episode);

            // ৩. Full Absolute Offset (যেমন Bleach Part 2: 1 + 13 = 14)
            if (aniMeta?.prequelEpisodes && aniMeta.prequelEpisodes > 0) {
                epsToTry.push(input.episode + aniMeta.prequelEpisodes);
            }

            // ডুপ্লিকেট রিমুভ
            epsToTry = [...new Set(epsToTry)];

            // ৩. প্রথমে Info অ্যারে-তে খুঁজি
            let targetEpId = null;
            if (infoEpisodes.length > 0) {
                for (const epNum of epsToTry) {
                    const found = infoEpisodes.find((e: any) => {
                        let idEpNum = -1;
                        if (e.id) {
                            const m = String(e.id).match(/episode-(\d+)/i);
                            if (m) idEpNum = parseInt(m[1], 10);
                        }
                        return Number(e.number) === epNum || idEpNum === epNum;
                    });
                    if (found) {
                        targetEpId = found.id;
                        break;
                    }
                }
            }

            // ৪. Blind Watch (যদি Info অ্যারে-তে না পাই)
            if (!targetEpId) {
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

            // ৫. সোর্স এক্সট্রাক্ট
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
