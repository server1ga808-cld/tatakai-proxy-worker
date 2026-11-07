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
    
    const mainTitle = titleToUse.split(':')[0].trim();
    const queries = [titleToUse, romajiToUse, mainTitle].filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];
    
    const queryLower = titleToUse.toLowerCase();
    const partKeywords = ['separation', 'conflict', 'calamity', 'ketsubetsu', 'kashin', 'culling game'];
    const queryHasPart = partKeywords.find(kw => queryLower.includes(kw));

    const searchPromises = queries.map(async (query) => {
        const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);

        if (res.ok) {
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                if (score < 55) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                const apiTitleLower = anime.title.toLowerCase();
                const apiHasPart = partKeywords.find(kw => apiTitleLower.includes(kw));

                if (queryHasPart && apiHasPart !== queryHasPart) return;
                if (!queryHasPart && apiHasPart) return;

                candidates.push({ rawSlug: anime.id, score });
            });
        }
    });

    await Promise.allSettled(searchPromises);

    // 🎯 স্কোর অনুযায়ী সর্ট করব এবং শুধুমাত্র টপ ১টি স্লাগ নিবো (ডুপ্লিকেট ও স্লো ফিক্স)
    candidates.sort((a, b) => b.score - a.score);
    const unique = new Map();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    return Array.from(unique.values()).slice(0, 1); // টপ ১টি
}
