import { fetchWithTimeout, decodeEmbedId, cleanIframeUrl } from './utils';
import { Candidate } from './searcher';
import { ProxyInput } from './types';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

async function probeWatch(base: string, epNum: number) {
    try {
        const tryId = `${base}-episode-${epNum}`;
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${tryId}`, 8000);
        if (!res.ok) return null;
        const json = await res.json();
        const sources = json?.data?.sources || [];
        const title = json?.data?.title || '';
        
        // Title verification
        const match = title.match(/(?:episode|ep)\s*0?(\d+)(?!\d)/i);
        if (match && parseInt(match[1], 10) !== epNum) {
            console.log(`[EXTRACT] Title mismatch at ${tryId}: expected ${epNum}, got ${match[1]}`);
            return null;
        }
        
        return sources.length > 0 ? sources : null;
    } catch (e) {
        return null;
    }
}

async function probeMovieSlug(slug: string) {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/watch/${slug}`, 8000);
        if (res.ok) {
            const json = await res.json();
            const sources = json?.data?.sources || [];
            return sources.length > 0 ? sources : null;
        }
    } catch (e) {}
    return null;
}

function collectSources(sources: any[], finalServers: any[], seenUrls: Set<string>) {
    for (const src of sources) {
        const name = (src.server || '').toLowerCase();
        if (!name.includes('mirror') && !name.includes('abyss') && !name.includes('vmoly')) continue;
        const decoded = decodeEmbedId(src.url);
        const url = cleanIframeUrl(decoded?.url || src.url);
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            finalServers.push({ server: src.server, url, source: 'tatakai' });
        }
    }
}

export async function extractStreams(candidates: Candidate[], input: ProxyInput) {
    let finalServers: any[] = [];
    let seenUrls = new Set<string>();
    
    for (const cand of candidates) {
        console.log(`[EXTRACT] Candidate: ${cand.rawSlug} baseName=${cand.baseName} offsets=[${cand.offsets.join(', ')}]`);
        
        // 🎯 Movie handling
        if (input.is_movie) {
            const sources = await probeMovieSlug(cand.rawSlug);
            if (sources) {
                collectSources(sources, finalServers, seenUrls);
                if (finalServers.length > 0) return finalServers;
            }
            continue;
        }
        
        const bases = [cand.baseName, cand.rawSlug].filter((b, i, arr) => b && arr.indexOf(b) === i);
        
        outerLoop:
        for (const offset of cand.offsets) {
            const targetEp = input.episode + offset;
            
            for (const base of bases) {
                const sources = await probeWatch(base, targetEp);
                if (sources) {
                    console.log(`[EXTRACT] ✓ SUCCESS: ${base}-episode-${targetEp} (offset=${offset})`);
                    collectSources(sources, finalServers, seenUrls);
                    if (finalServers.length > 0) break outerLoop;
                }
            }
        }
        
        if (finalServers.length > 0) return finalServers;
    }
    
    return finalServers;
}
