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
    
    // 🎯 Cleaned title: "Kimetsu no Yaiba" এবং "Arc" বাদ
    const cleanedTitle = titleToUse
        .replace(/:\s*Kimetsu no Yaiba/i, '')
        .replace(/\s+Arc\s*$/i, '')
        .replace(/\s+\(TV\)\s*$/i, '')
        .trim();

    // 🎯 Synonyms (সর্বোচ্চ ৩টি) এবং মূল টাইটেল মিলিয়ে কুয়েরি তৈরি
    const synonyms = (aniMeta?.synonyms || []).slice(0, 3);
    const queries = [...new Set([cleanedTitle, titleToUse, romajiToUse, ...synonyms])]
        .filter((q, i, arr) => q && q.length > 2 && arr.indexOf(q) === i) as string[];

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
                
                // 🎯 Strict Season Filtering: S1 চাইলে S2/S3 ব্লক করব
                // (কিন্তু Demon Slayer-এর মতো মার্জড সিজনের ক্ষেত্রে S3 চাইলে S2 পাস হবে)
                if (input.season === 1) {
                    const hasHigherSeason = /season[\s-]*[2-9]|(\d+)(?:st|nd|rd|th)[\s-]*season/i.test(apiTitleLower) || /season-[2-9]/i.test(anime.id.toLowerCase());
                    if (hasHigherSeason) return; // S2/S3 ব্লক
                }
                
                candidates.push({ rawSlug: anime.id, score });
            });
        } catch (e) {}
    });

    await Promise.allSettled(searchPromises);

    // সর্বোচ্চ স্কোরের ভিত্তিতে সর্ট
    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    // 🎯 শুধুমাত্র Top 1 (মিক্সিং বন্ধ)
    return Array.from(unique.values()).slice(0, 1);
}
