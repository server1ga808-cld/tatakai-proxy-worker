import { fetchWithTimeout, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";
const HINDI_BASE = "https://animehindidubbed.in";

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    // Absolute Episode Calculation (যেমন JJK S2 E1 = 24 + 1 = 25)
    const absoluteEpisode = input.episode + (aniMeta?.prequelEpisodes || 0);

    const extractionPromises = candidates.map(async (cand) => {
        let servers: any[] = [];
        try {
            // ==========================================
            // 🎯 ১. HINDI DUBBED LOGIC (Direct Scraping)
            // ==========================================
            if (cand.provider === 'hindi') {
                // সরাসরি হিন্দি ওয়েবসাইট থেকে HTML আনছি
                const res = await fetchWithTimeout(`${HINDI_BASE}/${cand.slug}/`, 8000);
                if (res.ok) {
                    const html = await res.text();
                    
                    // HTML থেকে bysewihe এবং servabyss এর JSON অ্যারে বের করার রেজেক্স
                    const serverNames = ['bysewihe', 'servabyss'];
                    
                    serverNames.forEach(sName => {
                        // রেজেক্স দিয়ে JSON অ্যারে খোঁজা (bysewihe: [ ... ])
                        const regex = new RegExp(`${sName}:\\s*(\\[[\\s\\S]*?\\])`, 'i');
                        const match = html.match(regex);
                        
                        if (match && match[1]) {
                            try {
                                // JSON পার্স করা
                                const parsedList = JSON.parse(match[1]);
                                
                                // এপিসোড ম্যাচ করা (Absolute Episode 25 অথবা সরাসরি 1)
                                const matched = parsedList.find((item: any) => {
                                    const nums = String(item.name).match(/\d+/g) || [];
                                    const numArray = nums.map((n: string) => parseInt(n, 10));
                                    return numArray.includes(absoluteEpisode) || numArray.includes(input.episode);
                                });

                                if (matched && matched.url) {
                                    servers.push({ 
                                        server: sName === 'bysewihe' ? 'Filemoon' : 'Servabyss', 
                                        url: matched.url, 
                                        source: 'tatakai' 
                                    });
                                }
                            } catch (err) {
                                console.error(`JSON Parse error for ${sName}`, err);
                            }
                        }
                    });
                }
            } 
            // ==========================================
            // 🎯 ২. DESI DUB LOGIC (Direct Watch URL)
            // ==========================================
            else if (cand.provider === 'desi') {
                let targetEpId = null;

                if (input.is_movie) {
                    // মুভির ক্ষেত্রে আগের মতোই API হিট করবো
                    const infoRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${cand.slug}`, 8000);
                    if (infoRes.ok) {
                        const infoJson = await infoRes.json();
                        if (infoJson?.data?.episodes?.length > 0) {
                            targetEpId = infoJson.data.episodes[0].id;
                        }
                    }
                } else {
                    // 🚀 সিরিজের ক্ষেত্রে সরাসরি Absolute Episode URL তৈরি করছি
                    // cand.slug (jujutsu-kaisen-season-2) -> jujutsu-kaisen-2nd-season-episode-25
                    let cleanSlug = cand.slug.replace(/-season-(\d+)/i, (match, p1) => {
                        const num = parseInt(p1, 10);
                        const suffix = num === 1 ? '' : num === 2 ? '-2nd' : num === 3 ? '-3rd' : `-${num}th`;
                        return `${suffix}-season`;
                    });
                    
                    // যদি স্লাগে season না থাকে, তবে baseName ব্যবহার করবো
                    if (!cleanSlug.includes('season')) {
                        cleanSlug = `${cand.baseName}-season-${input.season || 1}`; // ফলব্যাক
                    }

                    const directId = `${cleanSlug}-episode-${absoluteEpisode}`;
                    
                    // API-তে ডাইরেক্ট watch কল করে চেক করছি
                    const checkRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${directId}`, 8000);
                    if (checkRes.ok) {
                        const checkJson = await checkRes.json();
                        if (checkJson?.data?.sources) {
                            targetEpId = directId;
                        }
                    }
                }
                
                // যদি targetEpId পাওয়া যায়, তবেই সোর্স আনবো
                if (targetEpId) {
                    const watchRes = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${targetEpId}`, 8000);
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
        } catch (e) {
            console.error(`Extractor error on ${cand.provider} ${cand.slug}:`, e);
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
