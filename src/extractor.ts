import { fetchWithTimeout, cleanIframeUrl, isSequelTitle } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const isSequel = isSequelTitle(input.title, input.romaji_title);
    const isSeasonOne = !isSequel && (!aniMeta || aniMeta.prequelEpisodes === 0);
    
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);
    const userSeason = input.season || 1;

    const seasonStr = userSeason.toString();
    const episodeStr = input.episode.toString();
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
                                let matched = null;
                                // ১. সিজন ১ হলে Regex Match
                                if (isSeasonOne) {
                                    matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                }
                                // ২. Absolute Episode Match (Bleach TYBW-এর জন্য 367)
                                if (!matched) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(absoluteEpisode);
                                    });
                                }
                                // ৩. সিজন ১ হলে input.episode ফলব্যাক
                                if (!matched && isSeasonOne) {
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
                if (input.is_movie) {
                    let watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}`, 10000);
                    if (!watchRes.ok) {
                        const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${variant.slug}`, 10000);
                        if (infoRes.ok) {
                            const infoJson = await infoRes.json();
                            if (infoJson?.data?.episodes?.[0]?.id) {
                                watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${infoJson.data.episodes[0].id}`, 10000);
                            }
                        }
                    }
                    if (watchRes && watchRes.ok) {
                        const watchJson = await watchRes.json();
                        const sources = watchJson?.data?.sources || [];
                        sources.forEach((src: any) => {
                            if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                            }
                        });
                    }
                } else {
                    // 🎯 Desi-তে input.episode এবং absoluteEpisode দুটোই প্যারালালি ট্রাই করব
                    const epsToTry = [input.episode, absoluteEpisode].filter((v, i, a) => a.indexOf(v) === i);
                    const watchPromises = epsToTry.map(epNum => 
                        fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${variant.slug}-episode-${epNum}`, 10000)
                    );
                    
                    const watchResults = await Promise.allSettled(watchPromises);
                    for (const wRes of watchResults) {
                        if (wRes.status === 'fulfilled' && wRes.value.ok) {
                            const watchJson = await wRes.value.json();
                            const responseTitle = watchJson?.data?.title || "";
                            const responseEpMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                            
                            // ভুল এপিসোড চেক
                            if (responseEpMatch && parseInt(responseEpMatch[1], 10) !== input.episode && parseInt(responseEpMatch[1], 10) !== absoluteEpisode) {
                                continue; 
                            }
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
