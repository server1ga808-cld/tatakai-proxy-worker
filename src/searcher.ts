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
    
    // 🎯 Multiple Query Variations (৫টি ভিন্ন কুয়েরি)
    const queries = new Set<string>();
    queries.add(titleToUse);
    queries.add(romajiToUse);
    
    // ১. Cleaned (কোলন বাদ)
    const cleaned = titleToUse.replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim();
    queries.add(cleaned);
    
    // ২. Main + Arc (Mugen Train Arc → Demon Slayer Mugen Train)
    const mainTitle = titleToUse.split(':')[0].trim();
    const arcPart = titleToUse.split(':').slice(1).join(' ').trim();
    if (arcPart) {
        const simplified = arcPart.replace(/\s*arc\s*$/i, '').trim();
        queries.add(`${mainTitle} ${simplified}`);
        queries.add(`${mainTitle} ${arcPart}`);
    }
    
    // ৩. Main Title Only (franchise name)
    if (mainTitle) queries.add(mainTitle);
    
    const validQueries = Array.from(queries).filter(q => q && q.length > 2);

    // 🎯 Parallel Search across all queries
    const searchPromises = validQueries.map(async (query) => {
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            (data?.data?.results || []).forEach((anime: any) => {
                const score = getSimilarityScore(query, anime.title);
                if (score < 25) return; // 🎯 Threshold 25
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;
                
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
    
    // 🎯 Top 2 candidates return
    return Array.from(unique.values()).slice(0, 2);
}
