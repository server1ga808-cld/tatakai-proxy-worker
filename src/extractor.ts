import { fetchWithTimeout, decodeEmbedId, isSequelTitle } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const isSequel = isSequelTitle(input.title, input.romaji_title);
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);
    const prequelYearStr = aniMeta?.prequelYear ? String(aniMeta.prequelYear) : "";

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUB
            // ==========================================
            if (cand.provider === 'hindi') {
                const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/hindidubbed/anime/${cand.rawSlug}`, 8000);
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
                                matched = list.find((item: any) => {
                                    const nums = String(item.name).match(/\d+/g) || [];
                                    const numArray = nums.map((n: string) => parseInt(n, 10));
                                    return numArray.includes(absoluteEpisode) || numArray.includes(input.episode);
                                });
                                
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
            // 🎯 ২. DESI DUB (Blind Watch Strategy)
            // ==========================================
            else {
                let targetEpId = null;
                
                // ১. Info Endpoint থেকে আসল নাম বের করা (Pagination বাইপাস)
                const infoRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/anime/${cand.rawSlug}`, 8000);
                let realBaseName = null;
                if (infoRes.ok) {
                    const infoJson = await infoRes.json();
                    const episodes = infoJson?.data?.episodes || [];
                    if (episodes.length > 0 && episodes[0].id) {
                        const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                        if (match) realBaseName = match[1];
                    }
                }

                // ২. Blind Watch Strategy (realBaseName দিয়ে সরাসরি হিট)
                const epsToTry = [absoluteEpisode, input.episode].filter((v, i, a) => a.indexOf(v) === i);
                
                if (realBaseName) {
                    for (const epNum of epsToTry) {
                        const tryId = `${realBaseName}-episode-${epNum}`;
                        const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                        if (checkRes.ok) {
                            const checkJson = await checkRes.json();
                            const sources = checkJson?.data?.sources || [];
                            if (sources.length > 0) { targetEpId = tryId; break; }
                        }
                    }
                }

                // ৩. Fallback: raw slug দিয়ে ট্রাই
                if (!targetEpId) {
                    for (const epNum of epsToTry) {
                        const tryId = `${cand.rawSlug}-episode-${epNum}`;
                        const checkRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${tryId}`, 8000);
                        if (checkRes.ok) {
                            const checkJson = await checkRes.json();
                            if (checkJson?.data?.sources?.length > 0) { targetEpId = tryId; break; }
                        }
                    }
                }

                // সোর্স এক্সট্রাক্ট
                if (targetEpId) {
                    const watchRes = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                    if (watchRes.ok) {
                        const watchJson = await watchRes.json();
                        (watchJson?.data?.sources || []).forEach((src: any) => {
                            if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                                servers.push({ server: src.server, url: decodeEmbedId(src.url)?.url || src.url, source: 'tatakai' });
                            }
                        });
                    }
                }
            }
        } catch (e) {}
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
