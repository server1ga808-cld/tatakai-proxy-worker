const ANILIST_PROXY_URL = "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql";

// ৫ মিনিটের জন্য ইন-মেমোরি ক্যাশ (Cloudflare Worker Isolate ভিত্তিক)
const cache = new Map<number, { data: any, expiry: number }>();

export interface AniListMeta {
    format: string;
    englishTitle: string;
    romajiTitle: string;
    year: number;
    seasonsBefore: number; // রুট সিরিজ থেকে কতটি সিজন আগে
}

const GRAPHQL_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    format
    startDate { year }
    seasonYear
    title { english romaji }
    relations {
      edges {
        relationType
        node {
          id
          format
          title { english romaji }
          startDate { year }
        }
      }
    }
  }
}
`;

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
    if (!anilistId) return null;

    // ক্যাশ চেক
    const now = Date.now();
    if (cache.has(anilistId)) {
        const cached = cache.get(anilistId)!;
        if (now < cached.expiry) return cached.data;
    }

    try {
        const res = await fetch(ANILIST_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { id: anilistId } })
        });

        if (!res.ok) return null;
        const json = await res.json();
        const media = json?.data?.Media;
        if (!media) return null;

        // 🧠 seasonsBefore ক্যালকুলেশন (Prequel Chain Analysis)
        let seasonsBefore = 0;
        let currentMedia = media;
        let visited = new Set<number>();

        // যতক্ষণ TV প্রিকুয়েল পাওয়া যায়, ততক্ষণ পেছনে যাবে
        while (true) {
            const prequels = currentMedia.relations?.edges?.filter(
                (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
            ) || [];

            // সবচেয়ে রিসেন্ট প্রিকুয়েলটি খোঁজা (যেটার বছর সবচেয়ে কাছের)
            const bestPrequel = prequels.sort((a: any, b: any) => 
                (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
            )[0];

            if (bestPrequel && !visited.has(bestPrequel.node.id)) {
                visited.add(bestPrequel.node.id);
                seasonsBefore++;
                // রিকার্সিভলি চেক করার জন্য চেইন আপডেট
                currentMedia = { 
                    relations: bestPrequel.node.relations || [], 
                    format: bestPrequel.node.format 
                };
            } else {
                break;
            }
        }

        const meta: AniListMeta = {
            format: media.format || 'TV',
            englishTitle: media.title?.english || '',
            romajiTitle: media.title?.romaji || '',
            year: media.startDate?.year || media.seasonYear || 0,
            seasonsBefore
        };

        // ৫ মিনিটের ক্যাশ
        cache.set(anilistId, { data: meta, expiry: now + 5 * 60 * 1000 });
        return meta;
    } catch (error) {
        console.error("AniList Fetch Error:", error);
        return null;
    }
}
