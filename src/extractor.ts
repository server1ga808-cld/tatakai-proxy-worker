import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    // Absolute Episode Calculation (যেমন JJK S2 E1: 1 + 24 = 25)
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC (Render API is Fixed)
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
                                // Absolute Episode ম্যাচিং (যেমন "Episode 25 (S2EP01)")
                                const matched = list.find((item: any) => {
                                    const nums = String(item.name).match(/\d+/g) || [];
                                    const numArray = nums.map((n: string) => parseInt(n, 10));
                                    return numArray.includes(absoluteEpisode) || (input.season === 1 && numArray.includes(input.episode));
                                });
                                if (matched) {
                                    servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                                }
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Direct Watch URL)
            // ==========================================
            else if (cand.provider === 'desi') {
                if (input.is_movie) {
                    // মুভির জন্য API-র episodes[] থেকে প্রথম আইডি নেওয়া
                    const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`, 8000);
                    if (infoRes.ok) {
                        const infoJson = await infoRes.json();
                        const episodes = infoJson?.data?.episodes || [];
                        if (episodes.length > 0 && episodes[0].id) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${episodes[0].id}`, 8000);
                            if (watchRes.ok) {
                                const watchJson = await watchRes.json();
                                const sources = watchJson?.data?.sources || [];
                                sources.forEach((src: any) => {
                                    if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                        servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                    }
                                });
                            }
                        }
                    }
                } else {
                    // সিরিজের জন্য সরাসরি Absolute Episode URL তৈরি (বাইপাসিং /anime/ endpoint)
                    // jujutsu-kaisen-season-2 -> jujutsu-kaisen-2nd-season
                    let cleanSlug = cand.slug.replace(/-season-(\d+)/i, (match, p1) => {
                        const num = parseInt(p1, 10);
                        const suffix = num === 1 ? '' : num === 2 ? '-2nd' : num === 3 ? '-3rd' : `-${num}th`;
                        return `${suffix}-season`;
                    });
                    
                    if (!cleanSlug.includes('season')) cleanSlug = `${cand.baseName}-season-${input.season || 1}`;

                    const directId = `${cleanSlug}-episode-${absoluteEpisode}`;
                    
                    // সরাসরি Watch API-তে হিট
                    const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${directId}`, 8000);
                    if (watchRes.ok) {
                        const watchJson = await watchRes.json();
                        const sources = watchJson?.data?.sources || [];
                        sources.forEach((src: any) => {
                            if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                            }
                        });
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
