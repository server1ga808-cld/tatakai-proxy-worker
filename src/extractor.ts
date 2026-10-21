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
    // 🎯 FIX 1: রেজেক্সের শেষে (?!\d) যোগ করা হলো, যাতে S01E1 ম্যাচ করার সময় S01E10 না ধরে
    const sxxeyyRegex = new RegExp(`S0?${seasonStr}E0?${episodeStr}(?!\\d)`, 'i');

    const allVariants: { provider: 'hindi'|'desi', slug: string }[] = [];
    
    candidates.forEach(cand => {
        if (cand.provider === 'hindi') {
            allVariants.push({ provider: 'hindi', slug: cand.rawSlug });
        } else {
            allVariants.push({ provider: 'desi', slug: cand.rawSlug });
            if (userSeason === 2) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-2nd-season` });
            } else if (userSeason > 1) {
                allVariants.push({ provider: 'desi', slug: `${cand.baseName}-season-${userSeason}` });
            }
        }
    });

    const uniqueVariants = Array.from(new Map(allVariants.map(v => [v.provider + '-' + v.slug, v])).values());

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
                                // ১. URL Regex Match
                                let matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                // ২. Absolute Episode Match
                                if (!matched) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(absoluteEpisode);
                                    });
                                }
                                // 🎯 FIX 2: Direct Episode Match শুধুমাত্র তখনই হবে যখন prequelEpisodes = 0 (মানে সিজন ১)
                                if (!matched && (aniMeta?.prequelEpisodes === 0 || userSeason === 1)) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(input.episode);
                                    });
                                }
                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } else {
                // Desi Logic (আগের মতোই)
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${variant.slug}`, 10000);
                if (infoRes.ok) {
                    const infoJson = await infoRes.json();
                    const episodes = infoJson?.data?.episodes || [];
                    
                    if (episodes.length > 0) {
                        let targetEpId = null;
                        
                        if (input.is_movie) {
                            targetEpId = episodes[0].id;
                        } else {
                            const foundEp = episodes.find((e: any) => {
                                let idEpNum = -1;
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i);
                                    if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                                }
                                if (Number(e.number) === absoluteEpisode || idEpNum === absoluteEpisode) return true;
                                if ((aniMeta?.prequelEpisodes === 0 || userSeason === 1) && (Number(e.number) === input.episode || idEpNum === input.episode)) return true;
                                return false;
                            });

                            if (foundEp) targetEpId = foundEp.id;
                        }
                        
                        if (targetEpId) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 10000);
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
                }
            }
        } catch (e) {
            console.error(`Extractor error on ${variant.provider} ${variant.slug}:`, e);
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
