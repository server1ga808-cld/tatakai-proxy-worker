import { fetchWithTimeout, getSimilarityScore } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export interface Candidate {
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

    // 🎯 এক্সট্রা পার্টগুলো ব্লক করার লিস্ট (যেমন Bleach TYBW-এর The Separation)
    const partKeywords = ['separation', 'conflict', 'calamity', 'ketsubetsu', 'kashin', 'culling game'];
    const queryHasPart = partKeywords.find(kw => queryLower.includes(kw));

    const searchPromises = queries.map(async (query) => {
        // 🎯 শুধুমাত্র Desi Dub Search API
        const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);

        if (res.ok) {
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                // টাইটেল সিমিলারিটি চেক (>= 55%)
                if (getSimilarityScore(query, anime.title) < 55) return;
                
                // মুভি বনাম সিরিজ চেক
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                const apiTitleLower = anime.title.toLowerCase();
                const apiHasPart = partKeywords.find(kw => apiTitleLower.includes(kw));

                // পার্ট ম্যাচিং রুল (ইউজার Part 2 চাইলে Part 1 আসবে না, এবং উল্টোটাও না)
                if (queryHasPart && apiHasPart !== queryHasPart) return;
                if (!queryHasPart && apiHasPart) return;

                candidates.push({ rawSlug: anime.id });
            });
        }
    });

    await Promise.allSettled(searchPromises);

    const unique = new Map();
    candidates.forEach(c => unique.set(c.rawSlug, c));
    return Array.from(unique.values()).slice(0, 3); // সর্বোচ্চ ৩টি ক্যান্ডিডেট
}
