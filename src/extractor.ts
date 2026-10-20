import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    // Absolute Episode Calculation (যেমন JJK S2 E1 = 24 + 1 = 25)
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);
    const userSeason = input.season || 1;

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
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
                                const matched = list.find((item: any) => {
                                    const match = String(item.name).match(/\d+/);
                                    if (!match) return false;
                                    const num = parseInt(match[0], 10);
                                    return num === input.episode || num === absoluteEpisode;
                                });
                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } else if (cand.provider === 'desi') {
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`, 8000);
                if (infoRes.ok) {
                    const infoJson = await infoRes.json();
                    const episodes = infoJson?.data?.episodes || [];
                    
                    if (episodes.length > 0) {
                        let targetEp = null;
                        
                        if (input.is_movie) {
                            targetEp = episodes[0]; 
                        } else {
                            // 🎯 প্রথমে Absolute Episode দিয়ে সরাসরি Watch URL ট্রাই
                            const baseForAbs = `${cand.baseName}-season-${userSeason}`;
                            const absId1 = `${baseForAbs}-episode-${absoluteEpisode}`;
                            const absId2 = `${cand.baseName}-2nd-season-episode-${absoluteEpisode}`; // বিশেষ ক্ষেত্রে
                            
                            for (const tryId of [absId1, absId2, `${cand.slug}-episode-${absoluteEpisode}`]) {
                                if (!tryId.includes('episode-')) continue;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources) {
                                        targetEp = { id: tryId };
                                        break;
                                    }
                                }
                            }

                            // যদি Absolute fail করে, তবে API-র episodes[] অ্যারে চেক
                            if (!targetEp) {
                                targetEp = episodes.find((e: any) => {
                                    let idEpNum = -1;
                                    if (e.id) {
                                        const idMatch = String(e.id).match(/episode-(\d+)/i);
                                        if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                                    }
                                    // API-তে "number" যদি ১ থাকে, কিন্তু id-তে episode-47 থাকে, তবে 
                                    // আমরা number: 1 কে ভ্যালিড ধরবো (কারণ Tatakai API-র ডেটা এরকমই)
                                    if (e.number && Number(e.number) === input.episode) return true;
                                    // অথবা যদি id-তে absolute episode থাকে
                                    if (idEpNum !== -1 && idEpNum === absoluteEpisode) return true;
                                    return false;
                                });
                            }
                        }
                        
                        if (targetEp && targetEp.id) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEp.id}`, 8000);
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
