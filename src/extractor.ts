import { fetchWithTimeout, decodeEmbedId } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    // 🎯 AniList-এর prequelEpisodes > 0 হলেই সেটাকে সিক্যুয়েল ধরব
    const isSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            let targetEpId = null;
            
            // ১. Info Endpoint থেকে আসল নাম বের করা (Pagination বাইপাস)
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

            // ২. Blind Watch Strategy (সিক্যুয়েল হলে absoluteEpisode, নাহলে input.episode)
            let epsToTry = [absoluteEpisode];
            const hasSeasonInSlug = /season|part|2nd|3rd|4th|cour/i.test(cand.rawSlug);
            if (!isSequel || hasSeasonInSlug) {
                epsToTry.push(input.episode);
            }
            epsToTry = [...new Set(epsToTry)]; // ডুপ্লিকেট রিমুভ

            // ৩. realBaseName দিয়ে ট্রাই
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

            // ৪. Fallback: raw slug দিয়ে ট্রাই
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

            // ৫. সোর্স এক্সট্রাক্ট করা
            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                            servers.push({ server: src.server, url: decodeEmbedId(src.url)?.url || src.url, source: 'tatakai' });
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
