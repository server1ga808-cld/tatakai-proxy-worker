import { fetchWithTimeout, getSimilarityScore } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

export interface Candidate {
    rawSlug: string;
    score: number;
    title: string;
    type: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    let candidates: Candidate[] = [];
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    // 🎯 Query Generation (সবচেয়ে বেশি কভারেজের জন্য)
    const getRootTitle = (title: string) => {
        return title
            .replace(/:\s*Kimetsu no Yaiba/i, '') 
            .replace(/\s+Arc\s*$/i, '') 
            .replace(/\s+\(TV\)\s*$/i, '')
            .replace(/:\s*(the\s+)?final\s+season.*/i, '') 
            .replace(/\s+(the\s+)?final\s+season.*/i, '')
            .replace(/\s+season\s+\d+.*/i, '')
            .replace(/\s+part\s+\d+.*/i, '')
            .trim();
    };

    const rootTitleEng = getRootTitle(titleToUse);
    const rootTitleRomaji = getRootTitle(romajiToUse);
    
    // Non-ASCII synonyms filter (জাপানিজ/পার্সিয়ান বাদ - অপ্রয়োজনীয় API কল বাঁচাতে)
    const synonyms = (aniMeta?.synonyms || [])
        .filter(s => s && s.length > 3 && s.length < 80)
        .filter(s => /^[a-zA-Z0-9\s\-:.,!?'&()]+$/.test(s))
        .slice(0, 2);
    
    const queryList = [titleToUse, romajiToUse, ...synonyms, rootTitleEng, rootTitleRomaji]
        .filter((q): q is string => Boolean(q && q.length > 2));
    
    const queries: string[] = [];
    for (const q of queryList) {
        const trimmed = q.trim();
        if (trimmed.length > 2 && !queries.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
            queries.push(trimmed);
        }
    }

    console.log(`[SEARCH] Queries (${queries.length}):`, queries);

    // 🎯 Parallel Search (কোনো ফিল্টারিং নেই, শুধু Score Threshold)
    const searchPromises = queries.map(async (query, queryIndex) => {
        const specificityBonus = Math.max(0, 10 - queryIndex * 2);
        
        try {
            const res = await fetchWithTimeout(`https://tatakai-api-2qqx.onrender.com/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) return;
            
            const data = await res.json();
            const results = data?.data?.results || [];
            
            results.forEach((anime: any) => {
                const baseScore = getSimilarityScore(query, anime.title);
                const finalScore = baseScore + specificityBonus;
                
                // 🎯 Universal Filter 1: Score Threshold
                if (baseScore < 20) return;
                
                // 🎯 Universal Filter 2: Movie vs TV (খুব বেসিক ফিল্টার)
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                candidates.push({ 
                    rawSlug: anime.id, 
                    score: finalScore,
                    title: anime.title,
                    type: anime.type
                });
                
                console.log(`[SEARCH] Found: "${anime.title}" (${anime.id}) | Type: ${anime.type} | Score: ${finalScore.toFixed(1)}`);
            });
        } catch (e: any) {
            console.log(`[SEARCH] Error on "${query}": ${e.message}`);
        }
    });

    await Promise.allSettled(searchPromises);

    // 🎯 Score অনুযায়ী সর্ট
    candidates.sort((a, b) => b.score - a.score);
    
    // 🎯 Dedupe (একই slug একবার)
    const unique = new Map<string, Candidate>();
    candidates.forEach(c => {
        if (!unique.has(c.rawSlug)) unique.set(c.rawSlug, c);
    });
    
    // 🎯 Top 5 Candidates রিটার্ন (extractor বাকিটা হ্যান্ডেল করবে)
    const result = Array.from(unique.values()).slice(0, 5);
    
    console.log(`[SEARCH] FINAL RESULT (${result.length}):`, result.map(r => ({ slug: r.rawSlug, score: r.score.toFixed(1) })));
    
    return result;
}
