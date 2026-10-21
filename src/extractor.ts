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

    const seasonStr = userSeason.toString();
    const episodeStr = input.episode.toString();
    const sxxeyyRegex = new RegExp(`S0?${seasonStr}E0?${episodeStr}`, 'i');

    const allVariants: { provider: 'hindi'|'desi', slug: string }[] = [];
    
    candidates.forEach(cand => {
        if (cand.provider === 'hindi') {
            allVariants.push({ provider: 'hindi', slug: cand.rawSlug });
        } else {
            allVariants.push({ provider: 'desi', slug: cand.rawSlug });
            // Desi-র জন্য সম্ভাব্য সব ভ্যারিয়েন্ট তৈরি করা
            if (userSeason === 2) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-2nd-season` });
            } else if (userSeason > 1) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-season-${userSeason}` });
            }
            // আর্ক-বেসড নাম থাকলে
            if (input.title.toLowerCase().includes('entertainment district')) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-entertainment-district-arc` });
            }
            if (input.title.toLowerCase().includes('mugen train')) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-mugen-train-arc` });
            }
        }
    });

    const uniqueVariants = Array.from(new Map(allVariants.map(v => [v.provider + '-' + v.slug, v])).values());

    // 🎯 TURBO MODE: সব ভ্যারিয়েন্ট একসাথে প্যারালালি হিট করছি
    const extractionPromises = uniqueVariants.map(async (variant) => {
        let servers: any[] = [];
        try {
            if (variant.provider === 'hindi') {
                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${variant.slug}`, 10000);
                if (res.ok) {
                    const json = await res.json();
                    const serverObj = json?.data?.servers || {};
                    
                    ['filemoon', 'servabyss'].forEach(serverName => {
                        if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                            const list = serverObj[serverName];
                            if (input.is_movie) {
                                if (list.length > 0) servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                            } else {
                                let matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                if (!matched) matched = list.find((item: any) => (String(item.name).match(/\d+/g) || []).map((n: string) => parseInt(n, 10)).includes(absoluteEpisode));
                                if (!matched) matched = list.find((item: any) => (String(item.name).match(/\d+/g) || []).map((n: string) => parseInt(n, 10)).includes(input.episode));
                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } else {
                // Desi Logic
                if (input.is_movie) {
                    const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}`, 10000);
                    if (watchRes.ok) {
                        const watchJson = await watchRes.json();
                        const sources = watchJson?.data?.sources || [];
                        sources.forEach((src: any) => {
                            if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                            }
                        });
                    }
                } else {
                    const epsToTry = [absoluteEpisode, input.episode].filter((v, i, a) => a.indexOf(v) === i);
                    const watchPromises = epsToTry.map(epNum => 
                        fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}-episode-${epNum}`, 10000)
                    );
                    
                    const watchResults = await Promise.allSettled(watchPromises);
                    for (const wRes of watchResults) {
                        if (wRes.status === 'fulfilled' && wRes.value.ok) {
                            const watchJson = await wRes.value.json();
                            const sources = watchJson?.data?.sources || [];
                            sources.forEach((src: any) => {
                                if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                    servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                }
                            });
                            if (servers.length > 0) break;
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Extractor error on ${variant.provider} ${variant.slug}:`, e);
        }
        return servers;
    });

    // সব প্রমিজ একসাথে রান হবে (কোনো Early Exit নেই)
    const results = await Promise.allSettled(extractionPromises);
    
    // ডুপ্লিকেট রিমুভ করে ফাইনাল রেজাল্ট তৈরি
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
