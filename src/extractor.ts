import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    // Absolute Episode (যেমন JJK S2 E1 = 24 + 1 = 25)
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC
            // ==========================================
            if (cand.provider === 'hindi') {
                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${cand.slug}`, 8000);
                if (res.ok) {
                    const json = await res.json();
                    const serverObj = json?.data?.servers || {};
                    
                    ['filemoon', 'servabyss'].forEach(serverName => {
                        if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                            const list = serverObj[serverName];
                            if (input.is_movie) {
                                if (list.length > 0) servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                            } else {
                                // 🎯 শুধুমাত্র Absolute Episode (25) ম্যাচ করবো। input.episode (1) ম্যাচ করবো না।
                                let matched = list.find((item: any) => {
                                    const nums = String(item.name).match(/\d+/g) || [];
                                    const numArray = nums.map((n: string) => parseInt(n, 10));
                                    return numArray.includes(absoluteEpisode); 
                                });

                                // যদি absoluteEpisode না পাওয়া যায় (যেমন S1-এর জন্য absoluteEpisode = 1), 
                                // তবেই input.episode চেক করবো
                                if (!matched) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        const numArray = nums.map((n: string) => parseInt(n, 10));
                                        return numArray.includes(input.episode);
                                    });
                                }

                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC
            // ==========================================
            else if (cand.provider === 'desi') {
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`, 8000);
                if (infoRes.ok) {
                    const infoJson = await infoRes.json();
                    const episodes = infoJson?.data?.episodes || [];
                    
                    if (episodes.length > 0) {
                        let targetEpId = null;
                        
                        if (input.is_movie) {
                            targetEpId = episodes[0].id; 
                        } else {
                            // 🎯 ১. Direct Slug Construction (জুজুৎসু কাইসেন S2-এর জন্য)
                            // আমরা API-র number: 1 (যা episode-47 কে পয়েন্ট করে) এর ওপর ভরসা করব না
                            const directIds = [
                                `${cand.slug}-episode-${input.episode}`, // jujutsu-kaisen-season-2-episode-1
                                `${cand.baseName}-season-${input.season}-episode-${input.episode}`,
                                `${cand.slug.replace('season-2', '2nd-season')}-episode-${input.episode}` // jujutsu-kaisen-2nd-season-episode-1
                            ];

                            for (const tryId of directIds) {
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources && checkJson.data.sources.length > 0) {
                                        targetEpId = tryId;
                                        break; // সঠিক লিংক পেয়ে গেছি, লুপ ব্রেক করো
                                    }
                                }
                            }

                            // 🎯 ২. Fallback: যদি ডাইরেক্ট আইডি না পাওয়া যায়, তবে episodes[] অ্যারে চেক
                            if (!targetEpId) {
                                const foundEp = episodes.find((e: any) => {
                                    // id-র ভেতরে episode-1 আছে কি না চেক
                                    if (e.id) {
                                        const idMatch = String(e.id).match(/episode-(\d+)/i);
                                        if (idMatch && parseInt(idMatch[1], 10) === input.episode) return true;
                                    }
                                    return false;
                                });

                                if (foundEp && foundEp.id) {
                                    targetEpId = foundEp.id;
                                }
                            }
                        }
                        
                        if (targetEpId) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                            if (watchRes.ok) {
                                const watchJson = await watchRes.json();
                                const sources = watchJson?.data?.sources || [];
                                const allowedDesiServers = ['mirrordub', 'abyssdub', 'vmolydub'];
                                
                                sources.forEach((src: any) => {
                                    if (allowedDesiServers.includes(src.server.toLowerCase())) {
                                        servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                    }
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Extractor error on ${cand.provider} ${cand.slug}:`, e);
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
