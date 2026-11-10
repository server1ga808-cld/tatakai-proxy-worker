import { fetchWithTimeout, getSimilarityScore } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export interface Candidate {
    rawSlug: string;
    score: number;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    let candidates: Candidate[] = [];
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    const getRootTitle = (title: string) => {
        return title
            .replace(/:\s*Kimetsu no Yaiba/i, '') 
            .replace(/\s+Arc\s*$/i, '') 
            .replace(/\s+\(TV\)\s*$/i, '')
            .replace(/:\s*(the\s+)?final\s+season.*/i, '') 
            .replace(/\s+(the\s+)?final\s+season.*/i, '')
            .replace(/\s+season\s+\d+.*/i, '')
            .replace(/\s+part\s+\d+.*/i, '')
            .trim();
    };

    const rootTitleEng = getRootTitle(titleToUse);
    const rootTitleRomaji = getRootTitle(romajiToUse);
    
    const synonyms = (aniMeta?.synonyms || [])
        .filter(s => s && s.length > 3 && s.length < 80)
        .slice(0, 2);
    
    const queryList = [titleToUse, romajiToUse, ...synonyms, rootTitleEng, rootTitleRomaji].filter((q): q is string => Boolean(q && q.length > 2));
    
    const queries: string[] = [];
    for (const q of queryList) {
        const trimmed = q.trim();
        if (trimmed.length > 2 && !queries.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
            queries.push(trimmed);
        }
    }

    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const isInputSeasonOne = !isInputSequel && (input.season || 1) === 1;
    
    const arcKeywords = ['final', 'entertainment', 'yuukaku', 'swordsmith', 'katanakaji', 'hashira', 'training', 'separation', 'conflict', 'ketsubetsu', 'kashin', 'culling', 'shippuden', 'next generations', 'part', 'cour', 'movie', 'ova', 'oad'];
    const inputTitleLower = (titleToUse + ' ' + romajiToUse).toLowerCase();
    const isInputArc = arcKeywords.some(kw => inputTitleLower.includes(kw));

    const searchPromises = queries.map(async (query, queryIndex) => {
        const specificityBonus = Math.max(0, 10 - queryIndex * 2);
        
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            const results = data?.data?.results || [];
            
            results.forEach((anime: any) => {
                const baseScore = getSimilarityScore(query, anime.title);
                const apiTitleLower = anime.title.toLowerCase();
                const animeIdLower = anime.id.toLowerCase();
                
                const hasHigherSeason = 
                    /\b(season|s)\s*[2-9]\b/i.test(apiTitleLower) ||
                    /\b[2-9](?:nd|rd|th)\s+season\b/i.test(apiTitleLower) ||
                    /season-[2-9]/i.test(animeIdLower) ||
                    /-[2-9](?:nd|rd|th)-season/i.test(animeIdLower) ||
                    /\b(second|third|fourth|fifth|sixth)\s+season\b/i.test(apiTitleLower) ||
                    /\b(II|III|IV|V|VI)\s*(?:$|:|\s)/i.test(anime.title);
                
                const isExplicitSeasonOne = 
                    /\b(season|s)\s*1\b/i.test(apiTitleLower) ||
                    /\b1(?:st)\s+season\b/i.test(apiTitleLower) ||
                    /season-1/i.test(animeIdLower);
                
                const finalScore = baseScore + specificityBonus;
                
                if (baseScore < 20) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                // 🎯 FIX: Sequel চাইলে S1 বা বেস নাম ব্লক
                if (isInputSequel && !input.is_movie) {
                    const isS1 = isExplicitSeasonOne;
                    const isBareBase = !hasHigherSeason && !isExplicitSeasonOne && !isInputArc && !apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment') && !apiTitleLower.includes('arc') && !apiTitleLower.includes('part');
                    
                    if (isS1 || isBareBase) {
                        console.log(`[SEARCH] BLOCKED (S1/Bare for Sequel): "${anime.title}"`);
                        return;
                    }
                }

                // Season 1 চাইলে S2+ ব্লক
                if (isInputSeasonOne && hasHigherSeason) {
                    if (!isInputArc && !apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) {
                        return;
                    }
                }

                candidates.push({ rawSlug: anime.id, score: finalScore });
            });
        } catch (e) {}
    });

    await Promise.allSettled(searchPromises);

    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    return Array.from(unique.values()).slice(0, 2);
}
