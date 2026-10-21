import { fetchWithTimeout, isTitleMatch, getLevenshteinDistance } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export interface Candidate {
    provider: 'hindi' | 'desi';
    rawSlug: string;
    baseName: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    const targetFormat = aniMeta?.format || (input.is_movie ? 'MOVIE' : 'TV');

    const rootTitle = titleToUse
        .replace(/(?:\d+(?:st|nd|rd|th)?\s+season|season\s+\d+|part\s+\d+)/gi, '')
        .replace(/(?:entertainment district|mugen train|infinity castle|swordsmith village|hashira training)\s*arc/gi, '')
        .trim();

    const queries = [titleToUse, romajiToUse, rootTitle].filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];

    const searchPromises = queries.map(async (query) => {
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

                // Strict Movie Filter
                if (input.is_movie) {
                    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanApi = anime.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (/\d/.test(cleanQuery) && !/\d/.test(cleanApi)) return;
                    if (getLevenshteinDistance(cleanQuery, cleanApi) > 4) return;
                } else {
                    const cleanApi = anime.title.toLowerCase();
                    if (cleanApi.includes('movie') || cleanApi.includes('film')) return;
                }

                const baseName = anime.slug.replace(/-season-\d+$/, '').replace(/-s\d+$/, '').replace(/-\d+(?:st|nd|rd|th)-season$/, '');
                candidates.push({ provider: 'hindi', rawSlug: anime.slug, baseName });
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

                if (input.is_movie) {
                    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanApi = anime.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (/\d/.test(cleanQuery) && !/\d/.test(cleanApi)) return;
                }

                const baseName = anime.id.replace(/-season-\d+$/, '').replace(/-s\d+$/, '').replace(/-\d+(?:st|nd|rd|th)-season$/, '');
                candidates.push({ provider: 'desi', rawSlug: anime.id, baseName });
            });
        }
    });

    await Promise.allSettled(searchPromises);

    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.rawSlug, c));
    
    return Array.from(uniqueCandidates.values()).slice(0, 4);
}
