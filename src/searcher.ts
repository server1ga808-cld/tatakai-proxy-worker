import { fetchWithTimeout, getLevenshteinDistance } from './utils';
import { ProxyInput, Candidate } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'on', 'at', 'is', 'as', 'with', 'no', 'by'
]);

function normalizeNumericLocal(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/(\d+)(?:st|nd|rd|th)\s+season/g, 'season $1')
        .replace(/season\s+0*(\d+)/g, 'season $1')
        .replace(/part\s+0*(\d+)/g, 'part $1')
        .replace(/\bii\b/g, '2')
        .replace(/\biii\b/g, '3')
        .replace(/\biv\b/g, '4')
        .replace(/\bvi\b/g, '6')
        .replace(/\bvii\b/g, '7')
        .replace(/final\s+season/g, 'final')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractWords(text: string): string[] {
    if (!text) return [];
    return normalizeNumericLocal(text)
        .split(/\s+/)
        .filter(w => w.length > 0 && !STOP_WORDS.has(w));
}

function fuzzyWordMatch(w1: string, w2: string): number {
    if (w1 === w2) return 100;
    const dist = getLevenshteinDistance(w1, w2);
    const maxLen = Math.max(w1.length, w2.length);
    if (maxLen === 0) return 0;
    return Math.max(0, 100 - (dist / maxLen) * 100);
}

/**
 * Weighted Jaccard: weight = word length
 * intersection / union, weighted by character length
 */
function weightedJaccard(a: string, b: string): number {
    const wordsA = extractWords(a);
    const wordsB = extractWords(b);
    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const matchedB = new Set<string>();
    let intersectionWeight = 0;
    let totalWeightA = 0;

    for (const wA of wordsA) {
        totalWeightA += wA.length;
        let bestScore = 0;
        let bestWord = '';
        for (const wB of wordsB) {
            if (matchedB.has(wB)) continue;
            const score = fuzzyWordMatch(wA, wB);
            if (score > bestScore) {
                bestScore = score;
                bestWord = wB;
            }
        }
        if (bestScore >= 80) {
            intersectionWeight += wA.length * (bestScore / 100);
            matchedB.add(bestWord);
        }
    }

    // Union weight = total A words + unmatched B words
    let unionWeight = totalWeightA;
    for (const wB of wordsB) {
        if (!matchedB.has(wB)) unionWeight += wB.length;
    }

    return unionWeight > 0 ? (intersectionWeight / unionWeight) * 100 : 0;
}

function formatMatches(aniFormat: string, desiType: string): boolean {
    const af = (aniFormat || 'TV').toUpperCase();
    const dt = (desiType || 'TV').toUpperCase();
    if (af === 'TV') return dt === 'TV';
    if (af === 'MOVIE') return dt === 'MOVIE';
    if (['OVA', 'ONA', 'SPECIAL'].includes(af)) return ['OVA', 'ONA', 'SPECIAL'].includes(dt);
    return dt === af;
}

async function fetchDerivedBase(slug: string): Promise<string> {
    try {
        const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/anime/${slug}`, 8000);
        if (!res.ok) return '';
        const data = await res.json();
        const episodes = data?.data?.episodes || [];
        if (episodes.length > 0 && episodes[0].id) {
            const m = String(episodes[0].id).match(/(.+?)-episode-\d+/i);
            if (m) return m[1];
        }
    } catch (e) {}
    return '';
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const aniMeta = await getAniListMeta(input.anilist_id);
    if (!aniMeta) {
        console.log(`[SEARCH] No AniList meta`);
        return [];
    }
    
    const aniFormat = aniMeta.format || 'TV';
    const isMovie = aniFormat === 'MOVIE';
    
    const titleToUse = aniMeta.englishTitle || input.title;
    const romajiToUse = aniMeta.romajiTitle || input.romaji_title || '';
    const synonyms = (aniMeta.synonyms || [])
        .filter(s => s && s.length > 3 && s.length < 100)
        .slice(0, 3);
    
    // All reference texts (used for scoring candidate titles)
    const references = [titleToUse, romajiToUse, ...synonyms].filter(r => r && r.length > 2);
    
    // Query list (what we send to Desi search)
    const rootTitle = titleToUse
        .replace(/:\s*Kimetsu no Yaiba/i, '')
        .replace(/\s+Arc\s*$/i, '')
        .replace(/\s+\(TV\)\s*$/i, '')
        .replace(/:\s*(the\s+)?final\s+season.*/i, '')
        .replace(/\s+(the\s+)?final\s+season.*/i, '')
        .replace(/\s+season\s+\d+.*/i, '')
        .replace(/\s+part\s+\d+.*/i, '')
        .trim();
    
    const allQueries = [titleToUse, romajiToUse, rootTitle, ...synonyms].filter(q => q && q.length > 2);
    const uniqueQueries = [...new Set(allQueries)];
    
    console.log(`[SEARCH] Queries (${uniqueQueries.length}): ${uniqueQueries.join(' | ')}`);
    console.log(`[SEARCH] Format: ${aniFormat}`);
    
    // Gather candidates
    const candidateMap = new Map<string, { title: string; type: string; titleScore: number }>();
    
    for (const query of uniqueQueries) {
        try {
            const res = await fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000);
            if (!res.ok) continue;
            const data = await res.json();
            for (const cand of data?.data?.results || []) {
                if (candidateMap.has(cand.id)) continue;
                
                // Score = max match against any reference text
                let maxScore = 0;
                for (const ref of references) {
                    maxScore = Math.max(maxScore, weightedJaccard(ref, cand.title));
                }
                candidateMap.set(cand.id, { title: cand.title, type: cand.type, titleScore: maxScore });
            }
        } catch (e) {}
    }
    
    console.log(`[SEARCH] Total candidates: ${candidateMap.size}`);
    
    if (candidateMap.size === 0) return [];
    
    // Filter by format + basic score
    const scored: { slug: string; title: string; type: string; titleScore: number; derivedScore: number; combinedScore: number }[] = [];
    
    for (const [slug, data] of candidateMap) {
        // Format filter
        if (!formatMatches(aniFormat, data.type)) {
            console.log(`[SEARCH] FORMAT REJECT: "${data.title}" (${data.type} vs ${aniFormat})`);
            continue;
        }
        if (data.titleScore < 20) {
            console.log(`[SEARCH] LOW SCORE REJECT: "${data.title}" (${data.titleScore.toFixed(1)})`);
            continue;
        }
        scored.push({
            slug,
            title: data.title,
            type: data.type,
            titleScore: data.titleScore,
            derivedScore: 0,
            combinedScore: data.titleScore
        });
    }
    
    // If format filter killed everything, relax
    if (scored.length === 0) {
        console.log(`[SEARCH] Format filter too strict, relaxing`);
        for (const [slug, data] of candidateMap) {
            if (data.titleScore < 20) continue;
            scored.push({
                slug,
                title: data.title,
                type: data.type,
                titleScore: data.titleScore,
                derivedScore: 0,
                combinedScore: data.titleScore
            });
        }
    }
    
    if (scored.length === 0) {
        console.log(`[SEARCH] No valid candidates`);
        return [];
    }
    
    // Fetch derivedBaseName for top 5 title-scores
    scored.sort((a, b) => b.titleScore - a.titleScore);
    const top = scored.slice(0, 5);
    
    for (const cand of top) {
        const derivedBase = await fetchDerivedBase(cand.slug);
        if (derivedBase) {
            const derivedText = derivedBase.replace(/-/g, ' ');
            let maxDerived = 0;
            for (const ref of references) {
                maxDerived = Math.max(maxDerived, weightedJaccard(ref, derivedText));
            }
            cand.derivedScore = maxDerived;
        }
        // Combined = 40% title + 60% derivedBase
        cand.combinedScore = cand.titleScore * 0.4 + cand.derivedScore * 0.6;
        console.log(`[SEARCH] "${cand.title}" (${cand.slug}) → title=${cand.titleScore.toFixed(1)} derived=${cand.derivedScore.toFixed(1)} combined=${cand.combinedScore.toFixed(1)}`);
    }
    
    // Sort by combined score, take top 2
    top.sort((a, b) => b.combinedScore - a.combinedScore);
    const result = top.slice(0, 2).map(c => ({ rawSlug: c.slug, score: c.combinedScore }));
    
    console.log(`[SEARCH] FINAL:`);
    result.forEach(r => console.log(`  → ${r.rawSlug} (score: ${r.score.toFixed(1)})`));
    
    return result;
}
