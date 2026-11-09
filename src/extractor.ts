import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

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

async function findPrequelSlug(prequelTitle: string): Promise<string | null> {
    if (!prequelTitle) return null;
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(prequelTitle)}`, 8000);
        if (res.ok) {
            const data = await res.json();
            const results = data?.data?.results || [];
            if (results.length > 0) return results[0].id;
        }
    } catch (e) {}
    return null;
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            const currentInfo = await getInfo(cand.rawSlug);
            const realBaseName = currentInfo.realBaseName;
            const infoEpisodes = currentInfo.episodes;

            let prequelSlug: string | null = null;
            let prequelInfo: any = null;

            if (aniMeta?.immediatePrequelTitle) {
                prequelSlug = await findPrequelSlug(aniMeta.immediatePrequelTitle);
                if (prequelSlug) prequelInfo = await getInfo(prequelSlug);
            }

            // 🎯 Step 1: Dynamic Combined Slug Detection
            const isCombined = 
                (prequelSlug === cand.rawSlug) || 
                (prequelInfo?.realBaseName && realBaseName && prequelInfo.realBaseName === realBaseName);

            // 🎯 Step 2: Try List তৈরি করা
            let epNumbers: number[] = [];
            const prequelEps = aniMeta?.immediatePrequelEpisodes || 0;

            if (isCombined) {
                // Case 1: Combined (AoT S4 P2, Bleach P2, Demon Slayer S3)
                epNumbers = [input.episode + prequelEps];
            } else if (prequelEps > 0) {
                // Case 2: Different Slug with Prequel (AoT S2, JJK S2, Naruto Shippuden)
                // প্রথমে Direct, তারপর Offset (Direct-এ কাজ করলে Offset-এ যাবে না)
                epNumbers = [input.episode, input.episode + prequelEps];
            } else {
                // Case 3: Season 1 (Frieren, One Piece, Death Note)
                epNumbers = [input.episode];
            }

            // ডুপ্লিকেট এপিসোড নাম্বার রিমুভ
            epNumbers = [...new Set(epNumbers)];

            // 🎯 Step 3: Watch URL হিট করা (Verify সহ)
            let targetEpId: string | null = null;
            
            const basesToTry: string[] = [];
            if (realBaseName) basesToTry.push(realBaseName);
            if (!basesToTry.includes(cand.rawSlug)) basesToTry.push(cand.rawSlug);

            outerLoop:
            for (const epNum of epNumbers) {
                for (const base of basesToTry) {
                    const tryId = `${base}-episode-${epNum}`;
                    const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
                    
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        const sources = checkJson?.data?.sources || [];
                        const responseTitle = checkJson?.data?.title || "";
                        
                        // Title Verification
                        const titleMatch = responseTitle.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
                        const returnedEp = titleMatch ? parseInt(titleMatch[1], 10) : null;
                        
                        if (returnedEp !== null && returnedEp !== epNum) {
                            continue; 
                        }
                        
                        if (sources.length > 0) {
                            targetEpId = tryId;
                            break outerLoop;
                        }
                    }
                }
            }

            // 🎯 Step 4: সোর্স এক্সট্রাক্ট
            if (targetEpId) {
                const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 8000);
                if (watchRes.ok) {
                    const watchJson = await watchRes.json();
                    (watchJson?.data?.sources || []).forEach((src: any) => {
                        const serverName = (src.server || '').toLowerCase();
                        if (serverName.includes('mirror') || serverName.includes('abyss') || serverName.includes('vmoly')) {
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
