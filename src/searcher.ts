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
    
    // 🎯 rawQueries তৈরি (Title + Romaji + Synonyms)
    const rawQueries = [
        titleToUse,
        romajiToUse,
        ...(aniMeta?.synonyms || [])
    ];

    const queries = new Set<string>();
    rawQueries.forEach(q => {
        if (!q || q.length < 3) return;
        queries.add(q);
        
        // ১. কোলনের আগের অংশ (যেমন: "Shingeki no Kyojin" থেকে "Shingeki no Kyojin")
        const clean = q.split(':')[0].trim();
        if (clean.length > 2) queries.add(clean);
        
        // ২. "Season X", "Part X", "Final Season" বাদ দেওয়া (যেমন: "Attack on Titan: The Final Season Part 2" থেকে "Attack on Titan")
        const stripped = q
            .replace(/\b(the\s+)?(final\s+)?season\s*\d+.*/i, '')
            .replace(/\bpart\s*\d+.*/i, '')
            .trim();
        if (stripped.length > 2) queries.add(stripped);
    });
    
    const finalQueries = Array.from(queries);
    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;

    const searchPromises = finalQueries.map(async (query) => {
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
                
                // 🎯 সিজন ফিল্টার
                if (isInputSequel) {
                    if (/\bseason 1\b/i.test(apiTitleLower) && !animeIdLower.includes('final')) return;
                    if (/season-1$/i.test(animeIdLower) && !animeIdLower.includes('final')) return;
                } else {
                    if (/\bseason [2-9]\b/i.test(apiTitleLower) && !apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) return;
                    if (/season-[2-9]/i.test(animeIdLower) && !animeIdLower.includes('final')) return;
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
