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
    
    // 🎯 শুধুমাত্র ২টি কুয়েরি (স্পিড বাড়াতে)
    const queries = [...new Set([romajiToUse, titleToUse])]
        .filter(q => q && q.length > 2) as string[];

    // 🎯 সিজন ডিটেকশন (Fixed Regex)
    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;
    const isInputSeasonOne = !isInputSequel && (input.season || 1) === 1;

    const searchPromises = queries.map(async (query) => {
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                if (score < 25) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                const apiTitleLower = anime.title.toLowerCase();
                const animeIdLower = anime.id.toLowerCase();
                
                // 🎯 Fixed: "Season 2", "2nd Season", "3rd Season" সবই ধরবে
                const hasHigherSeason = 
                    /\b(season|s)\s*[2-9]\b/i.test(apiTitleLower) ||
                    /\b[2-9](?:nd|rd|th)\s+season\b/i.test(apiTitleLower) ||
                    /(?:season-|s-|\d)(?:[2-9])-?season/i.test(animeIdLower) ||
                    /-[2-9](?:nd|rd|th)-season/i.test(animeIdLower);

                if (isInputSeasonOne && hasHigherSeason) {
                    // S1 চাইলে S2+ ব্লক, তবে "final" বা "entertainment" বাদ
                    if (!apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) {
                        return;
                    }
                }

                candidates.push({ rawSlug: anime.id, score });
            });
        } catch (e) {}
    });

    await Promise.allSettled(searchPromises);

    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    return Array.from(unique.values()).slice(0, 1);
}
