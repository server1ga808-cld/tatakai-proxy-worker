import { fetchWithTimeout, isTitleMatch } from './utils';
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
    const userSeason = input.season || 1;
    const targetFormat = aniMeta?.format || (input.is_movie ? 'MOVIE' : 'TV');

    // রুট টাইটেল (সিজন/আর্ক নাম বাদ দিয়ে)
    const rootTitle = titleToUse.replace(/(?:\d+(?:st|nd|rd|th)?\s+season|season\s+\d+|part\s+\d+)/gi, '').trim();
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
                if (isTitleMatch(query, anime.title)) {
                    // Base Name বের করা (যেমন: jujutsu-kaisen-season-2 -> jujutsu-kaisen)
                    const baseName = anime.slug.replace(/-season-\d+$/, '').replace(/-s\d+$/, '').replace(/-\d+(?:st|nd|rd|th)-season$/, '');
                    candidates.push({ provider: 'hindi', rawSlug: anime.slug, baseName });
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

                // Base Name বের করা
                const baseName = anime.id.replace(/-season-\d+$/, '').replace(/-s\d+$/, '').replace(/-\d+(?:st|nd|rd|th)-season$/, '');
                candidates.push({ provider: 'desi', rawSlug: anime.id, baseName });
            });
        }

        // যদি রেজাল্ট পাওয়া যায়, তবে লুপ ব্রেক
        if (candidates.length > 0) break;
    }

    // ডুপ্লিকেট রিমুভ
    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.rawSlug, c));
    
    return Array.from(uniqueCandidates.values()).slice(0, 4);
}
