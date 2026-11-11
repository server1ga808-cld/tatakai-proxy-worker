import { fetchWithTimeout, getRootTitle, multiReferenceScore } from './utils';
import { ProxyInput, ChainSeason, Candidate } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

interface DesiMatch {
    slug: string;
    title: string;
    type: string;
    score: number;
}

async function findBestDesiMatch(chainSeason: ChainSeason, is_movie: boolean): Promise<DesiMatch | null> {
    const queries = [
        chainSeason.title,
        chainSeason.romajiTitle,
        ...chainSeason.synonyms
    ].filter((q): q is string => Boolean(q && q.length > 2));
    
    const uniqueQueries = [...new Set(queries)];
    const rootTitle = getRootTitle(chainSeason.title);
    
    let bestMatch: DesiMatch | null = null;
    
    for (const q of uniqueQueries) {
        try {
            const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(q)}`, 8000);
            if (!res.ok) continue;
            const data = await res.json();
            
            for (const cand of data?.data?.results || []) {
                if (is_movie && cand.type !== 'MOVIE') continue;
                if (!is_movie && cand.type === 'MOVIE') continue;
                
                const score = multiReferenceScore({
                    title: chainSeason.title,
                    romaji: chainSeason.romajiTitle,
                    rootTitle: rootTitle,
                    synonyms: chainSeason.synonyms
                }, cand.title);
                
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { slug: cand.id, title: cand.title, type: cand.type, score };
                }
            }
        } catch (e) {}
        
        if (bestMatch && bestMatch.score >= 60) break;
    }
    
    if (bestMatch && bestMatch.score >= 40) return bestMatch;
    return null;
}

async function getInfo(slug: string) {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, 8000);
        if (!res.ok) return null;
        const data = await res.json();
        const episodes = data?.data?.episodes || [];
        const realBaseName = data?.data?.realBaseName || slug;
        let derivedBaseName: string | null = null;
        if (episodes.length > 0 && episodes[0].id) {
            const match = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
            if (match) derivedBaseName = match[1];
        }
        return { realBaseName, derivedBaseName, episodes };
    } catch (e) {
        return null;
    }
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const aniMeta = await getAniListMeta(input.anilist_id);
    if (!aniMeta?.chain || aniMeta.chain.length === 0) {
        console.log(`[SEARCH] No chain`);
        return [];
    }
    
    const chain = aniMeta.chain;
    const targetIdx = chain.findIndex(s => s.anilistId === input.anilist_id);
    if (targetIdx === -1) {
        console.log(`[SEARCH] Target not in chain`);
        return [];
    }
    
    const target = chain[targetIdx];
    const prequel = targetIdx > 0 ? chain[targetIdx - 1] : null;
    const prequelEps = prequel?.episodes || 0;
    
    console.log(`[SEARCH] Target: S${target.seasonNumber} "${target.title}" (${target.episodes}eps) prequelEps=${prequelEps}`);
    
    const targetMatch = await findBestDesiMatch(target, input.is_movie);
    if (!targetMatch) {
        console.log(`[SEARCH] No target match`);
        return [];
    }
    console.log(`[SEARCH] ✓ Match: "${targetMatch.title}" (${targetMatch.slug}) score=${targetMatch.score.toFixed(1)}`);
    
    const info = await getInfo(targetMatch.slug);
    const baseName = info?.derivedBaseName || info?.realBaseName || targetMatch.slug;
    const targetDerivedBase = info?.derivedBaseName || '';
    
    // 🎯 CRITICAL: Merge detection via derivedBaseName equality
    let isMerged = false;
    if (prequel) {
        const prequelMatch = await findBestDesiMatch(prequel, input.is_movie);
        if (prequelMatch) {
            if (prequelMatch.slug === targetMatch.slug) {
                isMerged = true;
                console.log(`[SEARCH] Merged (same slug with S${prequel.seasonNumber})`);
            } else {
                const prequelInfo = await getInfo(prequelMatch.slug);
                const prequelDerivedBase = prequelInfo?.derivedBaseName || '';
                if (prequelDerivedBase && targetDerivedBase && prequelDerivedBase === targetDerivedBase) {
                    isMerged = true;
                    console.log(`[SEARCH] Merged (same derivedBase "${targetDerivedBase}")`);
                }
            }
        }
    }
    
    // 🎯 Offsets: merged → prequelEps first; not merged → 0 first
    const offsets: number[] = [];
    if (isMerged) {
        offsets.push(prequelEps, 0);
    } else if (prequelEps > 0) {
        offsets.push(0, prequelEps);
    } else {
        offsets.push(0);
    }
    
    console.log(`[SEARCH] isMerged=${isMerged} baseName="${baseName}" offsets=[${offsets.join(', ')}]`);
    
    return [{
        rawSlug: targetMatch.slug,
        baseName,
        offsets,
        score: targetMatch.score,
        debug: {
            aniSeason: target.seasonNumber,
            groupSize: isMerged ? 2 : 1,
            desiSlug: targetMatch.slug,
            desiTitle: targetMatch.title
        }
    }];
}
