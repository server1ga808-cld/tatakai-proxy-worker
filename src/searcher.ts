import { fetchWithTimeout, getSimilarityScore, isSequelTitle } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export interface Candidate {
    provider: 'hindi' | 'desi';
    rawSlug: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    let candidates: Candidate[] = [];
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    const mainTitle = titleToUse.split(':')[0].trim();
    const queries = [titleToUse, romajiToUse, mainTitle].filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];
    
    const queryLower = titleToUse.toLowerCase();

    // 🎯 পার্ট কীওয়ার্ড ডিটেকশন (The Separation, The Conflict ইত্যাদি)
    const partKeywords = ['separation', 'conflict', 'calamity', 'ketsubetsu', 'kashin', 'culling game'];
    const queryHasPart = partKeywords.find(kw => queryLower.includes(kw));

    const searchPromises = queries.map(async (query) => {
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`, 8000),
            fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000)
        ]);

        const processResult = (anime: any, provider: 'hindi' | 'desi', slug: string) => {
            if (getSimilarityScore(query, anime.title) < 55) return;

            const apiTitleLower = anime.title.toLowerCase();
            const apiHasPart = partKeywords.find(kw => apiTitleLower.includes(kw));

            // 🎯 পার্ট ম্যাচিং রুল:
            // ১. যদি ইউজার নির্দিষ্ট পার্ট চায় (separation/conflict), তাহলে সেই পার্টই আসবে
            // ২. যদি ইউজার জেনেরিক চায় (TYBW), তাহলে Part 1 (কোনো পার্ট কীওয়ার্ড নেই) আসবে
            if (queryHasPart && apiHasPart !== queryHasPart) return;
            if (!queryHasPart && apiHasPart) return;

            candidates.push({ provider, rawSlug: slug });
        };

        // Hindi
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            (data?.data?.animeList || []).forEach((anime: any) => processResult(anime, 'hindi', anime.slug));
        }

        // Desi
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            (data?.data?.results || []).forEach((anime: any) => {
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;
                processResult(anime, 'desi', anime.id);
            });
        }
    });

    await Promise.allSettled(searchPromises);

    const unique = new Map();
    candidates.forEach(c => unique.set(c.provider + '-' + c.rawSlug, c));
    return Array.from(unique.values()).slice(0, 3);
}
