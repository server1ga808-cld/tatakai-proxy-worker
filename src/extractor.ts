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
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC
            // ==========================================
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
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Fetch Info First for Exact ID)
            // ==========================================
            else {
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${variant.slug}`, 10000);
                if (infoRes.ok) {
                    const infoJson = await infoRes.json();
                    const episodes = infoJson?.data?.episodes || [];
                    
                    if (episodes.length > 0) {
                        let targetEpId = null;
                        
                        if (input.is_movie) {
                            targetEpId = episodes[0].id;
                        } else {
                            // 🎯 অ্যারে থেকে একদম সঠিক এপিসোড আইডি খোঁজা
                            const foundEp = episodes.find((e: any) => {
                                let idEpNum = -1;
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i);
                                    if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                                }
                                // Absolute Episode (যেমন 27) অথবা User Episode (যেমন 1) ম্যাচ
                                if (Number(e.number) === absoluteEpisode || idEpNum === absoluteEpisode) return true;
                                if (Number(e.number) === input.episode || idEpNum === input.episode) return true;
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
