import { fetchWithTimeout, isTitleMatch } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export interface Candidate {
    provider: 'hindi' | 'desi';
    slug: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    
    // ১. AniList ডেটা লোড
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    const yearToUse = aniMeta?.year || input.year;
    
    const userSeason = input.season || 1;
    const absoluteSeason = userSeason + (aniMeta?.seasonsBefore || 0);
    const targetFormat = aniMeta?.format || (input.is_movie ? 'MOVIE' : 'TV');

    const queries = [titleToUse, romajiToUse].filter(Boolean) as string[];
    const baseSlugs = new Set<string>();

    for (const query of queries) {
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`),
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`)
        ]);

        // Hindi Search
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            const list = data?.data?.animeList || [];
            list.forEach((anime: any) => {
                if (isTitleMatch(query, anime.title)) {
                    candidates.push({ provider: 'hindi', slug: anime.slug });
                    baseSlugs.add(anime.slug);
                }
            });
        }

        // Desi Search
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            const list = data?.data?.results || [];
            list.forEach((anime: any) => {
                if (!isTitleMatch(query, anime.title)) return;

                // Strict Format Filtering
                if (targetFormat === 'MOVIE' && anime.type !== 'MOVIE') return;
                if (targetFormat !== 'MOVIE' && anime.type === 'MOVIE') return;

                // Strict Season Matching
                const apiTitle = anime.title.toLowerCase();
                const slug = anime.id.toLowerCase();
                const seasonMatch = apiTitle.match(/season\s*(\d+)/) || slug.match(/season-(\d+)/);

                if (seasonMatch) {
                    const apiSeason = parseInt(seasonMatch[1], 10);
                    if (apiSeason !== userSeason && apiSeason !== absoluteSeason) return;
                } else if (userSeason > 1 && absoluteSeason > 1) {
                    return; 
                }

                candidates.push({ provider: 'desi', slug: anime.id });
                baseSlugs.add(anime.id);
            });
        }
    }

    // Year Suffix Logic
    if (yearToUse) {
        Array.from(baseSlugs).forEach(baseSlug => {
            const yearSlug = `${baseSlug}-${yearToUse}`;
            candidates.push({ provider: 'hindi', slug: yearSlug });
            candidates.push({ provider: 'desi', slug: yearSlug });
        });
    }

    // Remove Duplicates
    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.slug, c));
    
    return Array.from(uniqueCandidates.values());
}
