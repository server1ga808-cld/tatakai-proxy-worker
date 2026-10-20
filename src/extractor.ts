import { fetchWithTimeout, cleanIframeUrl } from './utils';
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
                                    // Hindi-র এপিসোড ম্যাচিং
                                    const matched = list.find((item: any) => {
                                        const match = String(item.name).match(/\d+/);
                                        return match && parseInt(match[0], 10) === episode;
                                    });
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
                            // 🎯 Strict Episode Matching (id এবং url কে প্রায়োরিটি দেওয়া হচ্ছে)
                            targetEp = episodes.find((e: any) => {
                                // ১. id থেকে এপিসোড নাম্বার বের করা
                                let idEpNum = -1;
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i) || String(e.id).match(/-(\d+)$/);
                                    if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                                }

                                // ২. url থেকে এপিসোড নাম্বার বের করা
                                let urlEpNum = -1;
                                if (e.url) {
                                    const urlMatch = String(e.url).match(/episode-(\d+)/i);
                                    if (urlMatch) urlEpNum = parseInt(urlMatch[1], 10);
                                }

                                // যদি id বা url-এ ভিন্ন এপিসোড নাম্বার থাকে (যেমন episode-26), তবে বাদ দাও
                                if (idEpNum !== -1 && idEpNum !== episode) return false;
                                if (urlEpNum !== -1 && urlEpNum !== episode) return false;

                                // যদি টাইটেলে "Full Movie" বা "Movie" থাকে কিন্তু আমরা TV এপিসোড খুঁজছি, তবে বাদ দাও
                                if (e.title && e.title.toLowerCase().includes('movie') && !is_movie) return false;

                                // ৩. number ফিল্ড চেক (সবশেষে)
                                if (e.number && Number(e.number) === episode) return true;

                                // ৪. title ফিল্ড চেক
                                if (e.title) {
                                    const titleMatch = String(e.title).match(/\d+/);
                                    if (titleMatch && parseInt(titleMatch[0], 10) === episode) return true;
                                }

                                return false;
                            });
                        }
                        
                        // যদি উপরে না পাওয়া যায়, তবে Direct Watch URL ফলব্যাক
                        if (!targetEp && !is_movie) {
                            const baseName = cand.slug.replace(/-season-\d+$/, ''); 
                            const possibleEpId = `${baseName}-episode-${episode}`;
                            
                            const directWatchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${possibleEpId}`);
                            if (directWatchRes.ok) {
                                const directJson = await directWatchRes.json();
                                if (directJson?.data?.title) {
                                    targetEp = { id: possibleEpId };
                                }
                            }
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
