import { fetchWithTimeout, isTitleMatch } from './utils';
import { ProxyInput } from './types';

const TATAKAI_BASE = "https://tatakai-api-2qqx.onrender.com";

export interface Candidate {
    provider: 'hindi' | 'desi';
    slug: string;
}

export async function getCandidateSlugs(input: ProxyInput): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    // ইংলিশ এবং রোমাজি টাইটেল দিয়ে সার্চ করা হবে
    const queries = [input.title, input.romaji_title, input.english_title].filter(Boolean) as string[];

    for (const query of queries) {
        // প্যারালালি Hindi এবং Desi সার্চ
        const [hindiRes, desiRes] = await Promise.allSettled([
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/hindidubbed/search?title=${encodeURIComponent(query)}`),
            fetchWithTimeout(`${TATAKAI_BASE}/api/v1/desidubanime/search/${encodeURIComponent(query)}`)
        ]);

        // ১. Hindi Search রেসপন্স প্রসেস করা
        if (hindiRes.status === 'fulfilled' && hindiRes.value.ok) {
            const data = await hindiRes.value.json();
            const list = data?.data?.animeList || [];
            list.forEach((anime: any) => {
                // Fuzzy Match করে ভুল অ্যানিমে (যেমন Frieren) বাদ দেওয়া
                if (isTitleMatch(query, anime.title)) {
                    candidates.push({ provider: 'hindi', slug: anime.slug });
                }
            });
        }

        // ২. Desi Search রেসপন্স প্রসেস করা
        if (desiRes.status === 'fulfilled' && desiRes.value.ok) {
            const data = await desiRes.value.json();
            const list = data?.data?.results || [];
            list.forEach((anime: any) => {
                if (isTitleMatch(query, anime.title)) {
                    // Type Filtering (Movie vs TV)
                    if (input.is_movie && anime.type !== 'MOVIE') return;
                    if (!input.is_movie && anime.type === 'MOVIE') return;
                    
                    candidates.push({ provider: 'desi', slug: anime.id });
                }
            });
        }

        // যদি প্রথম টাইটেল দিয়েই রেজাল্ট পাওয়া যায়, তবে পরের টাইটেল ট্রাই করার দরকার নেই
        if (candidates.length > 0) break; 
    }

    // ডুপ্লিকেট স্লাগ রিমুভ করা
    const uniqueCandidates = new Map();
    candidates.forEach(c => uniqueCandidates.set(c.provider + '-' + c.slug, c));
    
    return Array.from(uniqueCandidates.values());
}
