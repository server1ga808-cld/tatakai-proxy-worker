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
            // 🎯 ১. HINDI DUBBED LOGIC (Absolute Episode)
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
                                // Hindi-তে Absolute Episode ম্যাচ করবে (যেমন: 25)
                                const matched = list.find((item: any) => {
                                    const match = String(item.name).match(/\d+/);
                                    if (!match) return false;
                                    const num = parseInt(match[0], 10);
                                    // Absolute Episode অথবা সরাসরি ইউজারের চাওয়া এপিসোড
                                    return num === absoluteEpisode || num === input.episode;
                                });
                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Season-specific Slug)
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
                            // Desi-তে আগে episodes[] অ্যারের ভেতরে সিজন-স্পেসিফিক এপিসোড খুঁজবো
                            const foundEp = episodes.find((e: any) => {
                                // ডাইরেক্ট number চেক (যেমন S2-এর জন্য number: 1)
                                if (e.number && Number(e.number) === input.episode) return true;
                                
                                // id-র ভেতরে episode-1 আছে কি না চেক (যদি number ভুল থাকে)
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i);
                                    if (idMatch && parseInt(idMatch[1], 10) === input.episode) return true;
                                }
                                return false;
                            });

                            if (foundEp && foundEp.id) {
                                targetEpId = foundEp.id;
                            } else {
                                // 🚨 Fallback: যদি API-র অ্যারে ভুল ডেটা থাকে (যেমন JJK S2-এর ক্ষেত্রে),
                                // তবে সরাসরি স্লাগ দিয়ে Watch URL তৈরি করবো (jujutsu-kaisen-season-2-episode-1)
                                const directId = `${cand.slug}-episode-${input.episode}`;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${directId}`, 8000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources) {
                                        targetEpId = directId;
                                    }
                                }

                                // যদি ডাইরেক্ট URL-ও কাজ না করে, তবেই Absolute Episode ট্রাই করবো
                                if (!targetEpId) {
                                    const absId = `${cand.slug}-episode-${absoluteEpisode}`;
                                    const absRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${absId}`, 8000);
                                    if (absRes.ok) {
                                        const absJson = await absRes.json();
                                        if (absJson?.data?.sources) {
                                            targetEpId = absId;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // যদি সঠিক এপিসোড আইডি পাওয়া যায়, তবেই সোর্স আনবো
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

    // সব প্রমিজ প্যারালালি রান হবে (ফাস্ট রেসপন্স)
    const results = await Promise.allSettled(extractionPromises);
    
    // ডেটা মার্জ (No Deduplication)
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
