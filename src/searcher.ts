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
    
    const isSequel = isSequelTitle(titleToUse, romajiToUse);
    const queryLower = titleToUse.toLowerCase();

    // 🎯 এক্সট্রা পার্টগুলো ব্লক করার লিস্ট (যেমন Bleach TYBW-এর The Separation, The Conflict)
    const sequelParts = ['separation', 'conflict', 'calamity', 'culling game', 'part 2', 'part 3', 'cour 2'];

    const searchPromises = queries.map(async (query) => {
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`, 8000),
            fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000)
        ]);

        // Hindi Search
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            (data?.data?.animeList || []).forEach((anime: any) => {
                if (getSimilarityScore(query, anime.title) >= 55) {
                    if (isSequel && !isSequelTitle(anime.title)) return;
                    
                    const apiTitleLower = anime.title.toLowerCase();
                    if (sequelParts.some(part => apiTitleLower.includes(part) && !queryLower.includes(part))) return;

                    candidates.push({ provider: 'hindi', rawSlug: anime.slug });
                }
            });
        }

        // Desi Search
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            (data?.data?.results || []).forEach((anime: any) => {
                if (getSimilarityScore(query, anime.title) >= 55) {
                    if (isSequel && !isSequelTitle(anime.title)) return;
                    if (input.is_movie && anime.type !== 'MOVIE') return;
                    if (!input.is_movie && anime.type === 'MOVIE') return;

                    const apiTitleLower = anime.title.toLowerCase();
                    // 🎯 এক্সট্রা পার্ট ব্লক করা হচ্ছে
                    if (sequelParts.some(part => apiTitleLower.includes(part) && !queryLower.includes(part))) return;

                    candidates.push({ provider: 'desi', rawSlug: anime.id });
                }
            });
        }
    });

    await Promise.allSettled(searchPromises);

    const unique = new Map();
    candidates.forEach(c => unique.set(c.provider + '-' + c.rawSlug, c));
    return Array.from(unique.values()).slice(0, 3); // সর্বোচ্চ ৩টি ক্যান্ডিডেট
}
