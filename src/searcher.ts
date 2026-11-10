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
    
    console.log(`[SEARCH] AniList:`, aniMeta ? { 
        title: aniMeta.englishTitle, 
        prequelEps: aniMeta.prequelEpisodes, 
        synonymsCount: (aniMeta.synonyms || []).length 
    } : 'NULL');
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    // ========================================
    // 🎯 ১. Root Title Extraction (আগের মতোই)
    // ========================================
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
    
    // 🆕 ২. Synonyms (সর্বোচ্চ ২টি - স্পিড বাঁচাতে)
    const synonyms = (aniMeta?.synonyms || [])
        .filter(s => s && s.length > 3 && s.length < 80)
        .slice(0, 2);
    
    // 🆕 ৩. Query Priority List (index 0 = সবচেয়ে specific)
    const queryList = [
        titleToUse,       // index 0
        romajiToUse,      // index 1
        ...synonyms,      // index 2, 3
        rootTitleEng,     // index 4
        rootTitleRomaji,  // index 5
    ].filter((q): q is string => Boolean(q && q.length > 2));
    
    // ডুপ্লিকেট রিমুভ (অর্ডার প্রিজার্ভ করে)
    const queries: string[] = [];
    for (const q of queryList) {
        const trimmed = q.trim();
        const norm = trimmed.toLowerCase();
        if (trimmed.length > 2 && !queries.some(existing => existing.toLowerCase() === norm)) {
            queries.push(trimmed);
        }
    }
    
    console.log(`[SEARCH] Queries (${queries.length}):`, queries);

    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const isInputSeasonOne = !isInputSequel && (input.season || 1) === 1;
    
    // 🆕 Arc keywords (আগের মতোই)
    const arcKeywords = ['final', 'entertainment', 'yuukaku', 'swordsmith', 'katanakaji', 'hashira', 'training', 'separation', 'conflict', 'ketsubetsu', 'kashin', 'culling', 'shippuden', 'next generations'];
    const inputTitleLower = (titleToUse + ' ' + romajiToUse).toLowerCase();
    const isInputArc = arcKeywords.some(kw => inputTitleLower.includes(kw));
    
    console.log(`[SEARCH] isSequel: ${isInputSequel}, isSeasonOne: ${isInputSeasonOne}, isArc: ${isInputArc}`);

    // ========================================
    // 🎯 ৪. Parallel Search (Specificity Bonus সহ)
    // ========================================
    const searchPromises = queries.map(async (query, queryIndex) => {
        // 🆕 Specificity Bonus: index 0 = +10, index 1 = +8, ...
        const specificityBonus = Math.max(0, 10 - queryIndex * 2);
        
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            
            if (!res.ok) {
                console.log(`[SEARCH] Query "${query}" FAILED (${res.status})`);
                return;
            }
            
            const data = await res.json();
            const results = data?.data?.results || [];
            console.log(`[SEARCH] "${query}" → ${results.length} results (bonus: +${specificityBonus})`);
            
            results.forEach((anime: any) => {
                const baseScore = getSimilarityScore(query, anime.title);
                const apiTitleLower = anime.title.toLowerCase();
                const animeIdLower = anime.id.toLowerCase();
                
                // 🆕 Enhanced Season Detection (Roman numerals & spelled-out)
                const hasHigherSeason = 
                    /\b(season|s)\s*[2-9]\b/i.test(apiTitleLower) ||
                    /\b[2-9](?:nd|rd|th)\s+season\b/i.test(apiTitleLower) ||
                    /season-[2-9]/i.test(animeIdLower) ||
                    /-[2-9](?:nd|rd|th)-season/i.test(animeIdLower) ||
                    /\b(second|third|fourth|fifth|sixth)\s+season\b/i.test(apiTitleLower) ||
                    /\b(II|III|IV|V|VI)\s*(?:$|:|\s)/i.test(anime.title);
                
                const finalScore = baseScore + specificityBonus;
                
                console.log(`[SEARCH] "${anime.title}" (${anime.id}) | Base: ${baseScore} | Final: ${finalScore} | higherSeason: ${hasHigherSeason}`);
                
                if (baseScore < 20) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                if (isInputSeasonOne && hasHigherSeason) {
                    if (!isInputArc && !apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) {
                        console.log(`[SEARCH] BLOCKED: "${anime.title}"`);
                        return;
                    }
                }

                candidates.push({ rawSlug: anime.id, score: finalScore });
                console.log(`[SEARCH] ACCEPTED: "${anime.title}" (${anime.id}) | Score: ${finalScore}`);
            });
        } catch (e: any) {
            console.log(`[SEARCH] Error on "${query}": ${e.message}`);
        }
    });

    await Promise.allSettled(searchPromises);

    // ========================================
    // 🎯 ৫. Ranking & Return Top 2 (Extractor Fallback)
    // ========================================
    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    const result = Array.from(unique.values()).slice(0, 2);
    console.log(`[SEARCH] FINAL RESULT (${result.length}):`, result);
    
    return result;
}
