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
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC (Bleach 2004 Blocker)
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
                                if (list.length > 0) {
                                    const link = list[0].url;
                                    if (!(isSequel && link.includes('bleach-2004'))) {
                                        servers.push({ server: serverName, url: link, source: 'tatakai' });
                                    }
                                }
                            } else {
                                let matched = null;
                                
                                // ১. Absolute Episode Match (যেমন Bleach TYBW = 367)
                                if (absoluteEpisode > 0) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(absoluteEpisode);
                                    });
                                }
                                
                                // ২. Regex Match (সিজন ১ হলে S01E01)
                                if (!matched && isSeasonOne) {
                                    matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                }

                                // ৩. Direct Episode Match (শুধুমাত্র সিজন ১ হলে)
                                if (!matched && isSeasonOne) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(input.episode);
                                    });
                                }
                                
                                // 🎯 Bleach 2004 ব্লক করার সেফটি নেট
                                if (matched && isSequel && matched.url.includes('bleach-2004')) {
                                    matched = null; 
                                }

                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Fetch Exact ID)
            // ==========================================
            else {
                // প্রথমে Info endpoint থেকে episodes বের করি
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${variant.slug}`, 10000);
                if (!infoRes.ok) return servers;

                const infoJson = await infoRes.json();
                const episodes = infoJson?.data?.episodes || [];
                
                let targetEpId = null;

                if (input.is_movie) {
                    if (episodes.length > 0) targetEpId = episodes[0].id;
                } else {
                    // ১. অ্যারে-তে সরাসরি খুঁজি (number বা id এর ভেতরে input.episode বা absoluteEpisode থাকলে)
                    const foundEp = episodes.find((e: any) => {
                        let idEpNum = -1;
                        if (e.id) {
                            const idMatch = String(e.id).match(/episode-(\d+)/i);
                            if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                        }
                        return Number(e.number) === input.episode || idEpNum === input.episode 
                            || Number(e.number) === absoluteEpisode || idEpNum === absoluteEpisode;
                    });

                    if (foundEp) {
                        targetEpId = foundEp.id;
                    } else {
                        // ২. অ্যারে-তে না পেলে, আসল এপিসোডের আইডি থেকে বেস নাম বের করি (Regex)
                        // যেমন: bleach-sennen-kessen-hen-episode-4 -> bleach-sennen-kessen-hen
                        let realBaseName = null;
                        if (episodes.length > 0 && episodes[0].id) {
                            const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                            if (match) realBaseName = match[1];
                        }

                        const epsToTry = [input.episode, absoluteEpisode].filter((v, i, a) => a.indexOf(v) === i);
                        
                        // যদি realBaseName পাই, তবে সেটা দিয়ে ট্রাই করব
                        if (realBaseName) {
                            for (const epNum of epsToTry) {
                                const tryId = `${realBaseName}-episode-${epNum}`;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 10000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources?.length > 0) {
                                        targetEpId = tryId;
                                        break;
                                    }
                                }
                            }
                        }

                        // যদি তাও না পাই, তবে সরাসরি raw slug দিয়ে ট্রাই করব (যদিও এটা কম কাজ করে)
                        if (!targetEpId) {
                            for (const epNum of epsToTry) {
                                const tryId = `${variant.slug}-episode-${epNum}`;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 10000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    if (checkJson?.data?.sources?.length > 0) {
                                        targetEpId = tryId;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // সোর্স আনা
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
