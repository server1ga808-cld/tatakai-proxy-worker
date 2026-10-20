import { fetchWithTimeout, matchEpisodeNumber, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], episode: number, is_movie: boolean) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
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
                            // 🎯 স্মার্ট এপিসোড ম্যাচিং (number, id, title তিনটাই চেক করবে)
                            targetEp = episodes.find((e: any) => {
                                // ১. number ফিল্ড চেক
                                if (e.number && Number(e.number) === episode) return true;
                                
                                // ২. id ফিল্ড চেক (যেমন: kimetsu-no-yaiba-episode-1)
                                if (e.id) {
                                    const match = String(e.id).match(/episode-(\d+)/i) || String(e.id).match(/-(\d+)$/);
                                    if (match && parseInt(match[1], 10) === episode) return true;
                                }

                                // ৩. title ফিল্ড চেক
                                if (e.title) {
                                    const match = String(e.title).match(/\d+/);
                                    if (match && parseInt(match[0], 10) === episode) return true;
                                }
                                return false;
                            });
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
        
        batchResults.forEach(res => {
            if (res.status === 'fulfilled' && res.value.length > 0) {
                res.value.forEach((serverObj: any) => {
                    if (!seenUrls.has(serverObj.url)) {
                        seenUrls.add(serverObj.url);
                        finalServers.push(serverObj);
                    }
                });
            }
        });
        
        if (finalServers.length >= 5) {
            break; 
        }
    }
    
    return finalServers;
}
