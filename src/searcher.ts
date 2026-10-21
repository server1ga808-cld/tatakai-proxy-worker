import { fetchWithTimeout, strictTitleMatch, isSequelTitle } from './utils';
import { ProxyInput } from './types';
import { getAniListMeta } from './anilist';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export interface Candidate {
    provider: 'hindi' | 'desi';
    rawSlug: string;
    baseName: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    let candidates: Candidate[] = [];
    
    const aniMeta = await getAniListMeta(input.anilist_id);
    const titleToUse = aniMeta?.englishTitle || input.title;
    const romajiToUse = aniMeta?.romajiTitle || input.romaji_title || '';
    
    const isSequel = isSequelTitle(titleToUse, romajiToUse);
    const mainTitle = titleToUse.split(':')[0].trim();
    
    let queries = [titleToUse, romajiToUse];
    // 🎯 সিক্যুয়েল হলে mainTitle ("Bleach") সার্চ করব না, যাতে ২০০৪-এর স্লাগ না আসে
    if (!isSequel && mainTitle) {
        queries.push(mainTitle);
    }
    
    const validQueries = queries.filter((q, i, arr) => q && arr.indexOf(q) === i) as string[];

    // 🎯 Bleach TYBW-এর স্লাগ চেক (যেমন: slug-এ blood/war/season না থাকলে বাদ)
    const sequelRegex = /season|part|blood|war|sennen|2nd|3rd|4th|final|movie|ova/i;

    const searchPromises = validQueries.map(async (query) => {
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`, 10000),
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`, 10000)
        ]);

        // Hindi Search
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            const list = data?.data?.animeList || [];
            list.forEach((anime: any) => {
                if (!strictTitleMatch(query, anime.title, input.is_movie)) return;
                // 🎯 সিক্যুয়েল হলে বেস স্লাগ (bleach) ব্লক করব
                if (isSequel && !sequelRegex.test(anime.slug)) return;
                
                const baseName = anime.slug.replace(/-season-\d+$/, '').replace(/-s\d+$/, '');
                candidates.push({ provider: 'hindi', rawSlug: anime.slug, baseName });
            });
        }

        // Desi Search
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            const list = data?.data?.results || [];
            list.forEach((anime: any) => {
                if (!strictTitleMatch(query, anime.title, input.is_movie)) return;
                
                if (input.is_movie && anime.type !== 'MOVIE') return;
                if (!input.is_movie && anime.type === 'MOVIE') return;

                // 🎯 সিক্যুয়েল হলে বেস স্লাগ ব্লক করব
                if (isSequel && !sequelRegex.test(anime.id)) return;

                const baseName = anime.id.replace(/-season-\d+$/, '').replace(/-s\d+$/, '');
                candidates.push({ provider: 'desi', rawSlug: anime.id, baseName });
            });
        }
    });

    await Promise.allSettled(searchPromises);

    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.rawSlug, c));
    
    return Array.from(uniqueCandidates.values());
}
