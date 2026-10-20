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
                                // 🎯 Robust Matching: "Episode 25 (S2EP01)" থেকে 25, 2, 01 সব বের করবে
                                const matched = list.find((item: any) => {
                                    const nums = String(item.name).match(/\d+/g) || [];
                                    const numArray = nums.map((n: string) => parseInt(n, 10));
                                    return numArray.includes(absoluteEpisode) || numArray.includes(input.episode);
                                });
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
                            const foundEp = episodes.find((e: any) => {
                                if (e.number && Number(e.number) === input.episode) return true;
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i);
                                    if (idMatch && parseInt(idMatch[1], 10) === input.episode) return true;
                                }
                                return false;
                            });

                            if (foundEp && foundEp.id) {
                                targetEpId = foundEp.id;
                            } else {
                                // Direct Watch URL (Season-Specific)
                                const directId = `${cand.slug}-episode-${input.episode}`;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${directId}`, 8000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources) {
                                        targetEpId = directId;
                                    }
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
