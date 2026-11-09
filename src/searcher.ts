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
    
    // 🎯 ১. রুট টাইটেল বের করা (Season, Part, Final Season বাদ দিয়ে)
    const getRootTitle = (title: string) => {
        return title
            .replace(/:\s*Kimetsu no Yaiba/i, '') // Demon Slayer-এর জন্য
            .replace(/\s+Arc\s*$/i, '') // Demon Slayer-এর জন্য
            .replace(/\s+\(TV\)\s*$/i, '')
            .replace(/:\s*(the\s+)?final\s+season.*/i, '') // AoT-এর জন্য
            .replace(/\s+(the\s+)?final\s+season.*/i, '')
            .replace(/\s+season\s+\d+.*/i, '')
            .replace(/\s+part\s+\d+.*/i, '')
            .trim();
    };

    const rootTitleEng = getRootTitle(titleToUse);
    const rootTitleRomaji = getRootTitle(romajiToUse);
    const synonyms = (aniMeta?.synonyms || []).slice(0, 2); 
    
    // 🎯 ২. সম্ভাব্য সব কুয়েরি তৈরি
    const queries = [...new Set([rootTitleEng, rootTitleRomaji, titleToUse, romajiToUse, ...synonyms])]
        .filter((q, i, arr) => q && q.length > 2 && arr.indexOf(q) === i) as string[];

    const isInputSequel = (aniMeta?.prequelEpisodes || 0) > 0;

    // 🎯 ৩. প্যারালাল সার্চ ও ফিল্টারিং
    const searchPromises = queries.map(async (query) => {
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                if (score < 15) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                const apiTitleLower = anime.title.toLowerCase();
                const animeIdLower = anime.id.toLowerCase();
                
                // 2nd Season, 3rd Season, Season 2—সবই ধরার জন্য Regex
                const hasHigherSeason = /\b(season|s)\s*[2-9]\b|\b[2-9](nd|rd|th)\s+season\b/i.test(apiTitleLower) || /season-[2-9]/i.test(animeIdLower);

                if (isInputSequel) {
                    // সিক্যুয়েল হলে S1 ব্লক (Final Season হলে ব্লক করব না)
                    const isSeasonOne = (/\bseason 1\b/i.test(apiTitleLower) || /\b1st season\b/i.test(apiTitleLower)) && !animeIdLower.includes('final');
                    if (isSeasonOne) return;
                } else {
                    // S1 হলে S2+ ব্লক (Final বা Entertainment হলে ব্লক করব না)
                    if (hasHigherSeason && !apiTitleLower.includes('final') && !apiTitleLower.includes('entertainment')) return;
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
    
    // 🎯 ৪. শুধুমাত্র সেরা ম্যাচটি রিটার্ন
    return Array.from(unique.values()).slice(0, 1);
}
