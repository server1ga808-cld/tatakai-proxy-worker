import { fetchWithTimeout, matchEpisodeNumber, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], episode: number, is_movie: boolean) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>(); // ডুপ্লিকেট লিংক রিমুভ করার জন্য
    
    for (let i = 0; i < candidates.length; i += 2) {
        const batch = candidates.slice(i, i + 2);
        
        const batchResults = await Promise.allSettled(batch.map(async (cand) => {
            let servers: any[] = [];
            try {
                if (cand.provider === 'hindi') {
                    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${cand.slug}`);
                    if (res.ok) {
                        const json = await res.json();
                        const serverObj = json?.data?.servers || {};
                        
                        ['filemoon', 'servabyss'].forEach(serverName => {
                            if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                                const list = serverObj[serverName];
                                if (is_movie) {
                                    if (list.length > 0) servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                                } else {
                                    const matched = list.find((item: any) => matchEpisodeNumber(item.name, episode));
                                    if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                                }
                            }
                        });
                    }
                } else if (cand.provider === 'desi') {
                    const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`);
                    if (infoRes.ok) {
                        const infoJson = await infoRes.json();
                        const episodes = infoJson?.data?.episodes || [];
                        
                        let targetEp = null;
                        if (is_movie) {
                            targetEp = episodes[0]; 
                        } else {
                            targetEp = episodes.find((e: any) => matchEpisodeNumber(String(e.number), episode));
                        }
                        
                        if (targetEp && targetEp.id) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEp.id}`);
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
            } catch (e) {
                console.error(`Extractor error on ${cand.provider} ${cand.slug}:`, e);
            }
            return servers;
        }));
        
        // 🎯 মার্জিং লজিক (Hindi + Desi সবগুলো রাখবে)
        batchResults.forEach(res => {
            if (res.status === 'fulfilled' && res.value.length > 0) {
                res.value.forEach((serverObj: any) => {
                    // একই লিংক বারবার আসলে একবারই নেবে
                    if (!seenUrls.has(serverObj.url)) {
                        seenUrls.add(serverObj.url);
                        finalServers.push(serverObj);
                    }
                });
            }
        });
        
        // Early Exit: ৫ বা তার বেশি সার্ভার পেলে লুপ ব্রেক
        if (finalServers.length >= 5) {
            break; 
        }
    }
    
    return finalServers;
}
