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

        // Hindi Search (এখানে স্ট্রিক্ট সিজন ফিল্টার নেই, কারণ Hindi Absolute Episode ব্যবহার করে)
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            const list = data?.data?.animeList || [];
            list.forEach((anime: any) => {
                if (isTitleMatch(query, anime.title)) {
                    candidates.push({ 
                        provider: 'hindi', 
                        slug: anime.slug, 
                        baseName: anime.slug.replace(/-season-\d+$/, '') 
                    });
                }
            });
        }

        // Desi Search (এখানে Strict Season Filtering আছে, যাতে S1, S3 বাদ পড়ে)
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            const list = data?.data?.results || [];
            list.forEach((anime: any) => {
                if (!isTitleMatch(query, anime.title)) return;

                if (targetFormat === 'MOVIE' && anime.type !== 'MOVIE') return;
                if (targetFormat !== 'MOVIE' && anime.type === 'MOVIE') return;

                // 🎯 Strict Season Filtering for Desi
                const apiTitle = anime.title.toLowerCase();
                const slug = anime.id.toLowerCase();
                const seasonMatch = apiTitle.match(/(?:season|s)\s*(\d+)/i) || slug.match(/(?:season|s)[\s-]*(\d+)/i) || apiTitle.match(/(\d+)(?:st|nd|rd|th)\s*season/i);

                if (seasonMatch) {
                    const apiSeason = parseInt(seasonMatch[1], 10);
                    // যদি API-র সিজন আর ইউজারের সিজন না মেলে, বাদ দাও (যেমন S2 চাইলে S3 বাদ যাবে)
                    if (apiSeason !== userSeason && apiSeason !== absoluteSeason) return;
                } else {
                    // যদি API-তে সিজন নাম্বার না থাকে (মানে সিজন ১), আর ইউজার সিজন ১ এর বেশি চায়, বাদ দাও
                    if (userSeason > 1) return;
                }

                candidates.push({ 
                    provider: 'desi', 
                    slug: anime.id, 
                    baseName: anime.id.replace(/-season-\d+$/, '') 
                });
            });
        }
    }

    // ডুপ্লিকেট রিমুভ
    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.slug, c));
    
    return Array.from(uniqueCandidates.values());
}
