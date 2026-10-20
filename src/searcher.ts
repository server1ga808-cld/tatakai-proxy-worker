import { fetchWithTimeout, isTitleMatch } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export interface Candidate {
    provider: 'hindi' | 'desi';
    slug: string;
    baseName: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    const userSeason = input.season || 1;
    const absoluteSeason = userSeason + (aniMeta?.seasonsBefore || 0);
    const targetFormat = aniMeta?.format || (input.is_movie ? 'MOVIE' : 'TV');

    const rootTitle = titleToUse.replace(/(?:\d+(?:st|nd|rd|th)?\s+season|season\s+\d+)/gi, '').trim();
    const queries = [titleToUse, romajiToUse, rootTitle].filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];

    for (const query of queries) {
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`, 8000),
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 8000)
        ]);

        // Hindi Search
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            const list = data?.data?.animeList || [];
            list.forEach((anime: any) => {
                if (!isTitleMatch(query, anime.title)) return;

                // 🎯 Strict Season Rejection: S2 চাইলে S1 এর স্লাগ নেবে না
                const apiTitle = anime.title.toLowerCase();
                const slug = anime.slug.toLowerCase();
                const hasSeason = /season[\s-]*\d+|(\d+)(?:st|nd|rd|th)[\s-]*season/i.test(apiTitle) || /season-\d+/i.test(slug);

                if (userSeason > 1 && !hasSeason) return; // S1 এর স্লাগ ব্লক

                candidates.push({ provider: 'hindi', slug: anime.slug, baseName: slug.replace(/-season-\d+$/, '') });
            });
        }

        // Desi Search
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            const list = data?.data?.results || [];
            list.forEach((anime: any) => {
                if (!isTitleMatch(query, anime.title)) return;

                if (targetFormat === 'MOVIE' && anime.type !== 'MOVIE') return;
                if (targetFormat !== 'MOVIE' && anime.type === 'MOVIE') return;

                const apiTitle = anime.title.toLowerCase();
                const slug = anime.id.toLowerCase();
                const seasonMatch = apiTitle.match(/(?:season|s)\s*(\d+)/i) || slug.match(/(?:season|s)-(\d+)/i) || apiTitle.match(/(\d+)(?:st|nd|rd|th)\s*season/i);

                if (seasonMatch) {
                    const apiSeason = parseInt(seasonMatch[1], 10);
                    if (apiSeason !== userSeason && apiSeason !== absoluteSeason) return;
                } else if (userSeason > 1 && absoluteSeason > 1) {
                    return; // S1 স্লাগ ব্লক
                }

                candidates.push({ provider: 'desi', slug: anime.id, baseName: slug.replace(/-season-\d+$/, '') });
            });
        }
        
        if (candidates.length > 0) break;
    }

    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.slug, c));
    
    return Array.from(uniqueCandidates.values()).slice(0, 4);
}
