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
    
    // 🎯 Root Title Extraction (Final Season, Part 2, Season 4 ইত্যাদি বাদ দেওয়া)
    const getRootTitle = (title: string) => {
        return title
            .replace(/:\s*(the\s+)?final\s+season.*/i, '')
            .replace(/\s+(the\s+)?final\s+season.*/i, '')
            .replace(/\s+season\s+\d+.*/i, '')
            .replace(/\s+part\s+\d+.*/i, '')
            .trim();
    };

    const rootTitleEng = getRootTitle(titleToUse);
    const rootTitleRomaji = getRootTitle(romajiToUse);
    const synonyms = (aniMeta?.synonyms || []).slice(0, 2);
    
    // 🎯 সব সম্ভাব্য কুয়েরি তৈরি
    const queries = [...new Set([rootTitleEng, rootTitleRomaji, titleToUse, romajiToUse, ...synonyms])]
        .filter((q, i, arr) => q && q.length > 2 && arr.indexOf(q) === i) as string[];

    const searchPromises = queries.map(async (query) => {
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                // 🎯 Root Title স্কোর কম আসতে পারে, তাই থ্রেশহোল্ড ১৫ করলাম
                if (score < 15) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

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
