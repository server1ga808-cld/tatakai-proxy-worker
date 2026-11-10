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
    
    console.log(`[SEARCH] AniList:`, aniMeta ? { title: aniMeta.englishTitle, prequelEps: aniMeta.prequelEpisodes } : 'NULL');
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    // 🎯 Root Title Extraction (Season, Part, Final Season বাদ দিয়ে)
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
    
    const queries = [...new Set([titleToUse, romajiToUse, rootTitleEng, rootTitleRomaji])]
        .filter((q, i, arr) => q && q.length > 2 && arr.indexOf(q) === i) as string[];
    
    console.log(`[SEARCH] Queries:`, queries);

    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const isInputSeasonOne = !isInputSequel && (input.season || 1) === 1;
    
    console.log(`[SEARCH] isSequel: ${isInputSequel}, isSeasonOne: ${isInputSeasonOne}`);

    const searchPromises = queries.map(async (query) => {
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            
            if (!res.ok) {
                console.log(`[SEARCH] Query "${query}" FAILED (status ${res.status})`);
                return;
            }
            
            const data = await res.json();
            const results = data?.data?.results || [];
            console.log(`[SEARCH] "${query}" returned ${results.length} results`);
            
            results.forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                const apiTitleLower = anime.title.toLowerCase();
                const animeIdLower = anime.id.toLowerCase();
                
                const hasHigherSeason = 
                    /\b(season|s)\s*[2-9]\b/i.test(apiTitleLower) ||
                    /\b[2-9](?:nd|rd|th)\s+season\b/i.test(apiTitleLower) ||
                    /season-[2-9]/i.test(animeIdLower) ||
                    /-[2-9](?:nd|rd|th)-season/i.test(animeIdLower);
                
                console.log(`[SEARCH] "${anime.title}" (${anime.id}) | Score: ${score} | hasHigherSeason: ${hasHigherSeason}`);
                
                if (score < 20) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                if (isInputSeasonOne && hasHigherSeason) {
                    if (!apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) {
                        console.log(`[SEARCH] BLOCKED: "${anime.title}"`);
                        return;
                    }
                }

                candidates.push({ rawSlug: anime.id, score });
                console.log(`[SEARCH] ACCEPTED: "${anime.title}" (${anime.id})`);
            });
        } catch (e: any) {
            console.log(`[SEARCH] Error on "${query}": ${e.message}`);
        }
    });

    await Promise.allSettled(searchPromises);

    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    const result = Array.from(unique.values()).slice(0, 1);
    console.log(`[SEARCH] FINAL RESULT:`, result);
    
    return result;
}
