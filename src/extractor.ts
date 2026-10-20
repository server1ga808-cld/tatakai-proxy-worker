import { fetchWithTimeout, matchEpisodeNumber, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], episode: number, is_movie: boolean) {
    const results: any[] = [];
    
    // Rate-Limit Safe: প্রতিবার সর্বোচ্চ ২টি স্লাগে হিট করা হবে (Batch = 2)
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
                        
                        // শুধুমাত্র filemoon এবং servabyss সার্ভার চেক করা হবে
                        ['filemoon', 'servabyss'].forEach(serverName => {
                            if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                                const list = serverObj[serverName];
                                if (is_movie) {
                                    // মুভি হলে সরাসরি প্রথম লিংক নেবে
                                    if (list.length > 0) {
                                        servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                                    }
                                } else {
                                    // সিরিজ হলে এপিসোড নাম্বার ম্যাচ করবে
                                    const matched = list.find((item: any) => matchEpisodeNumber(item.name, episode));
                                    if (matched) {
                                        servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                                    }
                                }
                            }
                        });
                    }
                } else if (cand.provider === 'desi') {
                    // Desi-তে ২ স্টেপ: আগে Info, তারপর Watch
                    const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`);
                    if (infoRes.ok) {
                        const infoJson = await infoRes.json();
                        const episodes = infoJson?.data?.episodes || [];
                        
                        let targetEp = null;
                        if (is_movie) {
                            targetEp = episodes[0];
                        } else {
                            targetEp = episodes.find((e: any) => Number(e.number) === episode);
                        }
                        
                        if (targetEp && targetEp.id) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEp.id}`);
                            if (watchRes.ok) {
                                const watchJson = await watchRes.json();
                                const sources = watchJson?.data?.sources || [];
                                const allowedDesiServers = ['mirrordub', 'abyssdub', 'vmolydub'];
                                
                                sources.forEach((src: any) => {
                                    if (allowedDesiServers.includes(src.server.toLowerCase())) {
                                        servers.push({
                                            server: src.server,
                                            url: cleanIframeUrl(src.url), // Iframe ট্যাগ থেকে URL বের করা
                                            source: 'tatakai'
                                        });
                                    }
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Extract Error on ${cand.provider} ${cand.slug}`);
            }
            return servers;
        }));
        
        // ব্যাচ রেজাল্ট অ্যারেতে পুশ করা
        batchResults.forEach(res => {
            if (res.status === 'fulfilled') {
                results.push(...res.value);
            }
        });
        
        // Early Exit: ৫টি বা তার বেশি সার্ভার পেলে লুপ ব্রেক
        if (results.length >= 5) {
            break; 
        }
    }
    
    return results;
}
