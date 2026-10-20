import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    // AniList থেকে মেটাডেটা নিয়ে আসা (পিকুয়েল এপিসোড কাউন্টের জন্য)
    const aniMeta = await getAniListMeta(input.anilist_id);
    const prequelEpisodes = aniMeta?.prequelEpisodes || 0;

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
                        
                        ['filemoon', 'servabyss'].forEach(serverName => {
                            if (serverObj[serverName] && Array.isArray(serverObj[serverName])) {
                                const list = serverObj[serverName];
                                if (input.is_movie) {
                                    if (list.length > 0) servers.push({ server: serverName, url: list[0].url, source: 'tatakai' });
                                } else {
                                    // Hindi-র এপিসোড ম্যাচিং (এখানে সমস্যা কম)
                                    const matched = list.find((item: any) => {
                                        const match = String(item.name).match(/\d+/);
                                        return match && parseInt(match[0], 10) === input.episode;
                                    });
                                    if (matched) servers.push({ server: serverName, url: matched.url, source: 'tatakai' });
                                }
                            }
                        });
                    }
                } else if (cand.provider === 'desi') {
                    const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`);
                    if (infoRes.ok) {
                        const infoJson = await infoRes.json();
                        const episodes = infoJson?.data?.episodes || [];
                        
                        let targetEp = null;
                        if (input.is_movie) {
                            targetEp = episodes[0]; 
                        } else {
                            // ১. প্রথমে episodes অ্যারেতে requested episode খোঁজা
                            targetEp = episodes.find((e: any) => {
                                let idEpNum = -1;
                                if (e.id) {
                                    const idMatch = String(e.id).match(/episode-(\d+)/i) || String(e.id).match(/-(\d+)$/);
                                    if (idMatch) idEpNum = parseInt(idMatch[1], 10);
                                }
                                let urlEpNum = -1;
                                if (e.url) {
                                    const urlMatch = String(e.url).match(/episode-(\d+)/i);
                                    if (urlMatch) urlEpNum = parseInt(urlMatch[1], 10);
                                }
                                if (idEpNum !== -1 && idEpNum !== input.episode) return false;
                                if (urlEpNum !== -1 && urlEpNum !== input.episode) return false;
                                if (e.title && e.title.toLowerCase().includes('movie') && !input.is_movie) return false;
                                if (e.number && Number(e.number) === input.episode) return true;
                                if (e.title) {
                                    const titleMatch = String(e.title).match(/\d+/);
                                    if (titleMatch && parseInt(titleMatch[0], 10) === input.episode) return true;
                                }
                                return false;
                            });

                            // 🎯 ২. Smart Offset Calculation
                            if (!targetEp) {
                                // episodes অ্যারের প্রথম এন্ট্রি থেকে id নিয়ে তাতে এপিসোড নাম্বার চেক করি
                                const firstEp = episodes[0];
                                if (firstEp && firstEp.id) {
                                    const idMatch = String(firstEp.id).match(/episode-(\d+)/i);
                                    if (idMatch) {
                                        const providerStartEp = parseInt(idMatch[1], 10);
                                        // offset = প্রোভাইডারের প্রথম এপিসোড - (AniList প্রিকুয়েল এপিসোড + 1)
                                        // যেমন JJK S2: providerStartEp=47, prequelEpisodes=24 -> offset = 47 - 25 = 22 (ভুল হলে এডজাস্ট)
                                        // আমরা সরাসরি calculatedEpName দিয়ে ট্রাই করবো
                                        const calculatedEpName = `${cand.slug.replace(/-season-\d+$/, '')}-episode-${providerStartEp}`;
                                        
                                        // প্রথমে calculatedEpName দিয়ে watch URL ট্রাই
                                        let directWatchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${calculatedEpName}`);
                                        if (directWatchRes.ok) {
                                            const directJson = await directWatchRes.json();
                                            if (directJson?.data?.sources) {
                                                targetEp = { id: calculatedEpName };
                                            }
                                        }

                                        // যদি ফেইল করে, তবে ±৫ রেঞ্জের মধ্যে অন্যান্য এপিসোডও ট্রাই করি
                                        if (!targetEp) {
                                            for (let offset = -5; offset <= 5; offset++) {
                                                const tryEp = providerStartEp + offset;
                                                if (tryEp <= 0) continue;
                                                const tryId = `${cand.slug.replace(/-season-\d+$/, '')}-episode-${tryEp}`;
                                                const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`);
                                                if (res.ok) {
                                                    const json = await res.json();
                                                    if (json?.data?.sources) {
                                                        targetEp = { id: tryId };
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // ৩. যদি এখনো না পাওয়া যায়, তবে Romaji Title দিয়ে ফলব্যাক
                            if (!targetEp) {
                                const titlesToTry = [input.romaji_title, input.title].filter(Boolean) as string[];
                                for (const t of titlesToTry) {
                                    const cleanBase = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                                    const possibleEpId = `${cleanBase}-episode-${input.episode}`;
                                    const directWatchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${possibleEpId}`);
                                    if (directWatchRes.ok) {
                                        const directJson = await directWatchRes.json();
                                        if (directJson?.data?.sources) {
                                            targetEp = { id: possibleEpId };
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        if (targetEp && targetEp.id) {
                            const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEp.id}`);
                            if (watchRes.ok) {
                                const watchJson = await watchRes.json();
                                const sources = watchJson?.data?.sources || [];
                                const allowedDesiServers = ['mirrordub', 'abyssdub', 'vmolydub'];
                                
                                sources.forEach((src: any) => {
                                    if (allowedDesiServers.includes(src.server.toLowerCase())) {
                                        servers.push({ server: src.server, url: cleanIframeUrl(src.url), source: 'tatakai' });
                                    }
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Extractor error on ${cand.provider} ${cand.slug}:`, e);
            }
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
        
        if (finalServers.length >= 5) {
            break; 
        }
    }
    
    return finalServers;
}
