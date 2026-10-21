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
    const userSeason = input.season || 1;

    // ১. ডাইনামিক স্লাগ ভ্যারিয়েন্ট জেনারেটর
    const allVariants: { provider: 'hindi'|'desi', slug: string }[] = [];
    
    candidates.forEach(cand => {
        if (cand.provider === 'hindi') {
            allVariants.push({ provider: 'hindi', slug: cand.rawSlug });
        } else {
            // Desi-র জন্য সম্ভাব্য সব স্লাগ ভ্যারিয়েন্ট তৈরি করা
            allVariants.push({ provider: 'desi', slug: cand.rawSlug });
            
            // যদি সিজন ২ হয়, তবে 2nd-season ভ্যারিয়েন্টও ট্রাই করবো
            if (userSeason === 2) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-2nd-season` });
            } else if (userSeason > 1) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-${userSeason}th-season` }); // 3th-season (যদিও ভুল, তবু ট্রাই)
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-season-${userSeason}` });
            } else {
                // সিজন ১ হলে বেস নেম দিয়েই ট্রাই
                allVariants.push({ provider: 'desi', slug: cand.baseName });
            }
        }
    });

    // ডুপ্লিকেট ভ্যারিয়েন্ট রিমুভ
    const uniqueVariants = Array.from(new Map(allVariants.map(v => [v.provider + '-' + v.slug, v])).values());

    // ২. Batch = 2 (Rate Limit Safe)
    for (let i = 0; i < uniqueVariants.length; i += 2) {
        const batch = uniqueVariants.slice(i, i + 2);
        
        const batchResults = await Promise.allSettled(batch.map(async (variant) => {
            let servers: any[] = [];
            try {
                // প্রথমে Absolute Episode ট্রাই করবো, না পেলে User Episode
                const episodesToTry = [absoluteEpisode, input.episode].filter((v, i, a) => a.indexOf(v) === i);

                for (const epNum of episodesToTry) {
                    if (variant.provider === 'hindi') {
                        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${variant.slug}`, 8000);
                        if (res.ok) {
                            const json = await res.json();
                            const serverObj = json?.data?.servers || {};
                            
                            ['filemoon', 'servabyss'].forEach(serverName => {
                                if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                                    const matched = serverObj[serverName].find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(epNum);
                                    });
                                    if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                                }
                            });
                        }
                    } else {
                        // Desi-র জন্য ডাইরেক্ট Watch URL
                        const watchUrl = `${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}-episode-${epNum}`;
                        const watchRes = await fetchWithTimeout(watchUrl, 8000);
                        
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
                    
                    // যদি এই এপিসোড নাম্বারে সার্ভার পাওয়া যায়, তবে পরের এপিসোড নাম্বার ট্রাই করার দরকার নেই
                    if (servers.length > 0) break;
                }
            } catch (e) {
                console.error(`Extractor error on ${variant.provider} ${variant.slug}:`, e);
            }
            return servers;
        }));

        // মার্জ
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

        // Early Exit: ৫টি বা তার বেশি সার্ভার পেলে লুপ ব্রেক
        if (finalServers.length >= 5) {
            break; 
        }
    }
    
    return finalServers;
}
