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
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);
    const prequelYearStr = aniMeta?.prequelYear ? String(aniMeta.prequelYear) : "";
    
    const isAniListFailed = !aniMeta;
    const isSeasonOne = !isSequel && (!aniMeta || aniMeta.prequelEpisodes === 0);

    const seasonStr = (input.season || 1).toString();
    const episodeStr = input.episode.toString();
    const sxxeyyRegex = new RegExp(`S0?${seasonStr}E0?${episodeStr}(?!\\d)`, 'i');

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC
            // ==========================================
            if (cand.provider === 'hindi') {
                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/anime/${cand.rawSlug}`, 10000);
                if (res.ok) {
                    const json = await res.json();
                    const serverObj = json?.data?.servers || {};
                    
                    ['filemoon', 'servabyss'].forEach(serverName => {
                        if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                            const list = serverObj[serverName];
                            if (input.is_movie) {
                                if (list.length > 0) {
                                    const link = list[0].url;
                                    if (!(isSequel && prequelYearStr && link.includes(prequelYearStr))) {
                                        servers.push({ server: serverName, url: link, source: 'tatakai' });
                                    }
                                }
                            } else {
                                let matched = null;
                                
                                // ১. Absolute Episode Match (যেমন 367)
                                if (!isAniListFailed) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(absoluteEpisode);
                                    });
                                }
                                
                                // ২. Direct Episode Match (যদি Absolute না পায় বা AniList ফেইল করে)
                                if (!matched) {
                                    matched = list.find((item: any) => {
                                        const nums = String(item.name).match(/\d+/g) || [];
                                        return nums.map((n: string) => parseInt(n, 10)).includes(input.episode);
                                    });
                                }
                                
                                // ৩. Regex Match
                                if (!matched && isSeasonOne) {
                                    matched = list.find((item: any) => item.url && sxxeyyRegex.test(item.url));
                                }
                                
                                // 🎯 ইউনিভার্সাল সেফটি নেট: Bleach TYBW-এর জন্য ২০০৪ লিংক ব্লক
                                if (matched && isSequel && prequelYearStr && matched.url.includes(prequelYearStr)) {
                                    matched = null; 
                                }

                                if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC
            // ==========================================
            else {
                const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.rawSlug}`, 10000);
                if (!infoRes.ok) return servers;

                const infoJson = await infoRes.json();
                const episodes = infoJson?.data?.episodes || [];
                
                let targetEpId = null;

                if (input.is_movie) {
                    if (episodes.length > 0) targetEpId = episodes[0].id;
                } else {
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
                        // ডাইনামিক বেস নাম এক্সট্রাকশন (র‍্যান্ডম স্লাগ থেকে আসল নাম)
                        let realBaseName = null;
                        if (episodes.length > 0 && episodes[0].id) {
                            const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                            if (match) realBaseName = match[1];
                        }

                        const epsToTry = [input.episode, absoluteEpisode].filter((v, i, a) => a.indexOf(v) === i);
                        
                        if (realBaseName) {
                            for (const epNum of epsToTry) {
                                const tryId = `${realBaseName}-episode-${epNum}`;
                                const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 10000);
                                if (checkRes.ok) {
                                    const checkJson = await checkRes.json();
                                    const responseTitle = checkJson?.data?.title || "";
                                    const responseEpMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                                    
                                    if (responseEpMatch && parseInt(responseEpMatch[1], 10) !== epNum) {
                                        continue; 
                                    }
                                    if (checkJson?.data?.sources?.length > 0) {
                                        targetEpId = tryId;
                                        break;
                                    }
                                }
                            }
                        }
                    }
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
        } catch (e) {
            console.error(`Extractor error on ${cand.provider} ${cand.rawSlug}:`, e);
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
