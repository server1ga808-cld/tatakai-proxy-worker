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

            // 🎯 Smart Candidate Generation (Offset First, Then Direct)
            let candidateNums: number[] = [];
            
            // ১. Immediate Prequel Offset (সবচেয়ে গুরুত্বপূর্ণ: Demon Slayer S3 = 1+7=8, Bleach P2 = 1+13=14)
            if (aniMeta?.immediatePrequelEpisodes && aniMeta.immediatePrequelEpisodes > 0) {
                candidateNums.push(input.episode + aniMeta.immediatePrequelEpisodes);
            }
            
            // ২. Total Prequel Offset (Bleach P3 = 1+26=27, P4 = 1+39=40)
            if (aniMeta?.prequelEpisodes && aniMeta.prequelEpisodes > 0 && 
                aniMeta.prequelEpisodes !== aniMeta.immediatePrequelEpisodes) {
                candidateNums.push(input.episode + aniMeta.prequelEpisodes);
            }
            
            // ৩. Direct Episode (প্রথম সিজন বা অফসেট ফেইল করলে)
            candidateNums.push(input.episode);

            // ডুপ্লিকেট রিমুভ এবং ফিল্টার
            candidateNums = [...new Set(candidateNums)].filter(n => n > 0);

            // 🎯 ধাপ ৩: প্রথমে Info অ্যারে-তে সরাসরি খোঁজা (offset প্রায়োরিটি অনুযায়ী)
            let targetEpId = null;
            for (const epNum of candidateNums) {
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

            // 🎯 ধাপ ৪: Blind Watch (যদি Info অ্যারে-তে না পাই)
            if (!targetEpId) {
                const basesToTry = [];
                if (realBaseName) basesToTry.push(realBaseName);
                if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

                outerLoop:
                for (const base of basesToTry) {
                    for (const epNum of candidateNums) {
                        const tryId = `${base}-episode-${epNum}`;
                        const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                        if (checkRes.ok) {
                            const checkJson = await checkRes.json();
                            const responseTitle = checkJson?.data?.title || "";
                            const sources = checkJson?.data?.sources || [];
                            
                            // Response verification (ভুল এপিসোড ব্লক)
                            const titleMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                            if (titleMatch && sources.length > 0) {
                                const returnedEp = parseInt(titleMatch[1], 10);
                                if (!candidateNums.includes(returnedEp)) {
                                    continue;
                                }
                            }
                            
                            if (sources.length > 0) {
                                targetEpId = tryId;
                                break outerLoop;
                            }
                        }
                    }
                }
            }

            // 🎯 ধাপ ৫: সোর্স এক্সট্রাক্ট
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
