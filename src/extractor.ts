import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

// 🎯 Helper: Info থেকে realBaseName এবং episodes বের করা
async function getInfo(slug: string): Promise<{ realBaseName: string | null; episodes: any[] }> {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, 8000);
        if (res.ok) {
            const data = await res.json();
            const episodes = data?.data?.episodes || [];
            let realBaseName: string | null = null;
            if (episodes.length > 0 && episodes[0].id) {
                const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
                if (match) realBaseName = match[1];
            }
            return { realBaseName, episodes };
        }
    } catch (e) {}
    return { realBaseName: null, episodes: [] };
}

// 🎯 Helper: Prequel Slug খোঁজা (cleaned query দিয়ে)
async function findPrequelSlug(prequelTitle: string): Promise<string | null> {
    if (!prequelTitle) return null;
    
    const candidates = new Set<string>();
    
    const cleaned = prequelTitle
        .replace(/:\s*Kimetsu no Yaiba/i, '')
        .replace(/\s+Arc\s*$/i, '')
        .replace(/\s+\(TV\)\s*$/i, '')
        .trim();
    if (cleaned && cleaned !== prequelTitle) candidates.add(cleaned);
    
    candidates.add(prequelTitle);
    
    const mainTitle = prequelTitle.split(':')[0].trim();
    if (mainTitle && mainTitle !== prequelTitle) candidates.add(mainTitle);
    
    for (const q of candidates) {
        if (q.length < 3) continue;
        try {
            const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, 8000);
            if (res.ok) {
                const data = await res.json();
                const results = data?.data?.results || [];
                if (results.length > 0) return results[0].id;
            }
        } catch (e) {}
    }
    return null;
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // 🎯 Step 1: বর্তমান স্লাগের Info
            const currentInfo = await getInfo(cand.rawSlug);
            const realBaseName = currentInfo.realBaseName;
            const infoEpisodes = currentInfo.episodes;

            // 🎯 Step 2: Offset ক্যালকুলেশন (RealBaseName Comparison)
            let offset = 0;
            if (aniMeta?.immediatePrequelTitle && (aniMeta.immediatePrequelEpisodes || 0) > 0) {
                const prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
                if (prequelSlug) {
                    // Case 1: Same slug (Combined Season - Ent District)
                    if (prequelSlug === cand.rawSlug) {
                        offset = aniMeta.immediatePrequelEpisodes;
                    } else {
                        // Case 2: Different slug → RealBaseName Comparison
                        const prequelInfo = await getInfo(prequelSlug);
                        if (prequelInfo.realBaseName && realBaseName && prequelInfo.realBaseName === realBaseName) {
                            // Same base (Bleach P2 - continuous)
                            offset = aniMeta.immediatePrequelEpisodes;
                        }
                        // Case 3: Different realBaseName → offset = 0 (AoT, Mugen Train, Swordsmith)
                    }
                }
            }

            const targetEp = input.episode + offset;

            // 🎯 Step 3: প্রথমে Info-তে খোঁজা
            let targetEpId: string | null = null;
            if (infoEpisodes.length > 0) {
                const found = infoEpisodes.find((e: any) => {
                    let idEpNum = -1;
                    if (e.id) {
                        const m = String(e.id).match(/episode-(\d+)/i);
                        if (m) idEpNum = parseInt(m[1], 10);
                    }
                    return Number(e.number) === targetEp || idEpNum === targetEp;
                });
                if (found) targetEpId = found.id;
            }

            // 🎯 Step 4: Blind Watch (যদি Info-তে না পাই)
            if (!targetEpId) {
                const basesToTry: string[] = [];
                if (realBaseName) basesToTry.push(realBaseName);
                if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

                outerLoop:
                for (const base of basesToTry) {
                    const tryId = `${base}-episode-${targetEp}`;
                    const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        const sources = checkJson?.data?.sources || [];
                        const responseTitle = checkJson?.data?.title || "";
                        
                        // Strict Verification
                        const titleMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                        const returnedEp = titleMatch ? parseInt(titleMatch[1], 10) : null;
                        
                        if (returnedEp !== null && returnedEp !== targetEp) {
                            continue;
                        }
                        
                        if (sources.length > 0) {
                            targetEpId = tryId;
                            break outerLoop;
                        }
                    }
                }
            }

            // 🎯 Step 5: সোর্স এক্সট্রাক্ট
            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        if (['mirrordub', 'abyssdub', 'vmolydub'].includes(src.server.toLowerCase())) {
                            const decoded = decodeEmbedId(src.url);
                            servers.push({ 
                                server: src.server, 
                                url: cleanIframeUrl(decoded?.url || src.url), 
                                source: 'tatakai' 
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.error(`Extraction error on ${cand.rawSlug}:`, e);
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
