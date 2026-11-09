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
    
    // Clean title
    const cleanedTitle = titleToUse.replace(/:\s*Kimetsu no Yaiba/i, '').replace(/\s+Arc\s*$/i, '').replace(/\s+\(TV\)\s*$/i, '').trim();

    // 🎯 Synonyms এবং মূল টাইটেল মিলিয়ে কুয়েরি তৈরি (সর্বোচ্চ ৫টি)
    const synonyms = (aniMeta?.synonyms || []).slice(0, 5);
    const queries = [...new Set([cleanedTitle, titleToUse, romajiToUse, ...synonyms])]
        .filter((q, i, arr) => q && q.length > 2 && arr.indexOf(q) === i) as string[];

    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;

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
                
                // 🎯 পারফেক্ট সিজন ফিল্টার
                if (isInputSequel) {
                    // সিক্যুয়েল হলে সিজন ১ ব্লক (তবে "Final" থাকলে ব্লক করব না)
                    if (/\bseason 1\b/i.test(apiTitleLower) && !animeIdLower.includes('final')) return;
                    if (/season-1$/i.test(animeIdLower) && !animeIdLower.includes('final')) return;
                } else {
                    // সিজন ১ হলে সিজন ২+ ব্লক (তবে "Final" বা "Entertainment" থাকলে ব্লক করব না)
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
