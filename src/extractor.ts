import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);
    const isSeasonOne = !aniMeta || aniMeta.prequelEpisodes === 0;
    const userSeason = input.season || 1;

    const seasonStr = userSeason.toString();
    const episodeStr = input.episode.toString();
    const sxxeyyRegex = new RegExp(`S0?${seasonStr}E0?${episodeStr}(?!\\d)`, 'i');

    const extractionPromises = candidates.map(async (variant) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC
            // ==========================================
            if (variant.provider === 'hindi') {
                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${variant.rawSlug}`, 10000);
                if (res.ok) {
                    const json = await res.json();
                    const serverObj = json?.data?.servers || {};
                    
                    ['filemoon', 'servabyss'].forEach(serverName => {
                        if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                            const list = serverObj[serverName];
                            if (input.is_movie) {
                                if (list.length > 0) servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                            } else {
                                let matched = null;
                                // ১. URL Regex Match (শুধুমাত্র সিজন ১ হলে)
                                if (isSeasonOne) {
                                    matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                }
                                // ২. Absolute Episode Match
                                if (!matched) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(absoluteEpisode);
                                    });
                                }
                                // ৩. Direct Episode Match (শুধুমাত্র সিজন ১ হলে, Bleach ব্লক করতে)
                                if (!matched && isSeasonOne) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(input.episode);
                                    });
                                }
                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Strict Title Verification)
            // ==========================================
            else {
                if (input.is_movie) {
                    const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.rawSlug}`, 10000);
                    if (watchRes.ok) {
                        const watchJson = await watchRes.json();
                        const sources = watchJson?.data?.sources || [];
                        sources.forEach((src: any) => {
                            if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                            }
                        });
                    }
                } else {
                    const epsToTry = isSeasonOne ? [absoluteEpisode, input.episode].filter((v, i, a) => a.indexOf(v) === i) : [absoluteEpisode];
                    
                    const watchPromises = epsToTry.map(epNum => 
                        fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.rawSlug}-episode-${epNum}`, 10000)
                    );
                    
                    const watchResults = await Promise.allSettled(watchPromises);
                    for (const wRes of watchResults) {
                        if (wRes.status === 'fulfilled' && wRes.value.ok) {
                            const watchJson = await wRes.value.json();
                            
                            // 🎯 Desi Verification: রেসপন্সের Title-এ এপিসোড নাম্বার ম্যাচ করছে কি না চেক
                            const responseTitle = watchJson?.data?.title || "";
                            const responseEpMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                            if (responseEpMatch && parseInt(responseEpMatch[1], 10) !== input.episode && parseInt(responseEpMatch[1], 10) !== absoluteEpisode) {
                                continue; // ভুল এপিসোড, স্কিপ
                            }

                            const sources = watchJson?.data?.sources || [];
                            sources.forEach((src: any) => {
                                if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                    servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                }
                            });
                            if (servers.length > 0) break;
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Extractor error on ${variant.provider} ${variant.rawSlug}:`, e);
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
