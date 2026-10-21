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

    const allVariants: { provider: 'hindi'|'desi', slug: string }[] = [];
    
    candidates.forEach(cand => {
        if (cand.provider === 'hindi') {
            allVariants.push({ provider: 'hindi', slug: cand.rawSlug });
        } else {
            allVariants.push({ provider: 'desi', slug: cand.rawSlug });
            if (userSeason === 2) allVariants.push({ provider: 'desi', slug: `${cand.baseName}-2nd-season` });
            else if (userSeason > 1) allVariants.push({ provider: 'desi', slug: `${cand.baseName}-season-${userSeason}` });
            else allVariants.push({ provider: 'desi', slug: cand.baseName });
        }
    });

    const uniqueVariants = Array.from(new Map(allVariants.map(v => [v.provider + '-' + v.slug, v])).values());

    // Batch = 2
    for (let i = 0; i < uniqueVariants.length; i += 2) {
        const batch = uniqueVariants.slice(i, i + 2);
        
        const batchResults = await Promise.allSettled(batch.map(async (variant) => {
            let servers: any[] = [];
            try {
                if (variant.provider === 'hindi') {
                    const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${variant.slug}`, 8000);
                    if (res.ok) {
                        const json = await res.json();
                        const serverObj = json?.data?.servers || {};
                        
                        ['filemoon', 'servabyss'].forEach(serverName => {
                            if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                                const list = serverObj[serverName];
                                if (input.is_movie) {
                                    // 🎯 মুভি হলে সরাসরি প্রথম এন্ট্রি নিবো (এপিসোড খুঁজব না)
                                    if (list.length > 0) {
                                        servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                                    }
                                } else {
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
                } else {
                    if (input.is_movie) {
                        // মুভির জন্য Desi ডাইরেক্ট ওয়াচ (এপিসোড ছাড়া)
                        const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${variant.slug}`, 8000);
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
                        const episodesToTry = [absoluteEpisode, input.episode].filter((v, i, a) => a.indexOf(v) === i);
                        for (const epNum of episodesToTry) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}-episode-${epNum}`, 8000);
                            if (watchRes.ok) {
                                const watchJson = await watchRes.json();
                                const sources = watchJson?.data?.sources || [];
                                sources.forEach((src: any) => {
                                    if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                        servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                    }
                                });
                            }
                            if (servers.length > 0) break;
                        }
                    }
                }
            } catch (e) {}
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

        if (finalServers.length >= 5) break; 
    }
    
    return finalServers;
}
