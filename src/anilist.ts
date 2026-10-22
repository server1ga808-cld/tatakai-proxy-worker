const ANILIST_PROXY_URL = "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql";
const cache = new Map<number, { data: any, expiry: number }>();

export interface AniListMeta {
    format: string;
    englishTitle: string;
    romajiTitle: string;
    year: number;
    seasonsBefore: number;
    prequelEpisodes: number;
    prequelYear: number;
}

async function fetchMedia(id: number) {
    const query = `
    query ($id: Int) {
      Media(id: $id) {
        format
        startDate { year }
        seasonYear
        title { english romaji }
        episodes
        relations {
          edges {
            relationType
            node {
              id
              format
              episodes
              title { english romaji }
              startDate { year }
            }
          }
        }
      }
    }
    `;
    try {
        const res = await fetch(ANILIST_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { id } })
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.Media;
    } catch (e) {
        return null;
    }
}

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
    if (!anilistId) return null;

    const now = Date.now();
    if (cache.has(anilistId)) {
        const cached = cache.get(anilistId)!;
        if (now < cached.expiry) return cached.data;
    }

    const media = await fetchMedia(anilistId);
    if (!media) return null;

    let seasonsBefore = 0;
    let prequelEpisodes = 0;
    let prequelYear = 0;
    let currentMedia = media;
    let visited = new Set<number>();
    visited.add(anilistId);

    for (let depth = 0; depth < 10; depth++) {
        const prequels = currentMedia.relations?.edges?.filter(
            (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
        ) || [];

        const bestPrequel = prequels.sort((a: any, b: any) => 
            (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
        )[0];

        if (bestPrequel && !visited.has(bestPrequel.node.id)) {
            visited.add(bestPrequel.node.id);
            seasonsBefore++;
            prequelEpisodes += (bestPrequel.node.episodes || 0);
            
            if (prequelYear === 0) {
                prequelYear = bestPrequel.node.startDate?.year || 0;
            }
            
            const prequelMedia = await fetchMedia(bestPrequel.node.id);
            if (!prequelMedia) break;
            currentMedia = prequelMedia;
        } else {
            break;
        }
    }

    const meta: AniListMeta = {
        format: media.format || 'TV',
        englishTitle: media.title?.english || '',
        romajiTitle: media.title?.romaji || '',
        year: media.startDate?.year || media.seasonYear || 0,
        seasonsBefore,
        prequelEpisodes,
        prequelYear
    };

    cache.set(anilistId, { data: meta, expiry: now + 5 * 60 * 1000 });
    return meta;
}
