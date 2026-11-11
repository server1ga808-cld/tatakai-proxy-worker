const ANILIST_PROXY_URL = "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql";
const CACHE_VERSION = "v11";

interface ChainSeason {
    anilistId: number;
    seasonNumber: number;
    title: string;
    romajiTitle: string;
    synonyms: string[];
    episodes: number;
    format: string;
    cumulativeBefore: number;
    cumulativeAfter: number;
}

interface AniListMeta {
    format: string;
    englishTitle: string;
    romajiTitle: string;
    year: number;
    seasonsBefore: number;
    prequelEpisodes: number;
    prequelYear: number;
    immediatePrequelTitle: string;
    immediatePrequelEpisodes: number;
    synonyms: string[];
    chain: ChainSeason[];
}

const cache = new Map<string, { data: AniListMeta | null; expiry: number }>();

async function fetchMedia(id: number): Promise<any> {
    const query = `
    query ($id: Int) {
      Media(id: $id) {
        id
        format
        startDate { year }
        seasonYear
        title { english romaji }
        episodes
        synonyms
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
        const json: any = await res.json();
        return json?.data?.Media || null;
    } catch (e) {
        return null;
    }
}

async function buildChain(anilistId: number, media: any): Promise<ChainSeason[]> {
    const visited = new Map<number, any>();
    visited.set(anilistId, media);
    const chainIds: number[] = [anilistId];

    let current = media;
    for (let depth = 0; depth < 8; depth++) {
        const prequels: any[] = current?.relations?.edges?.filter(
            (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
        ) || [];
        const sorted = prequels.sort((a: any, b: any) =>
            (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
        );
        const best = sorted[0];
        if (!best || visited.has(best.node.id)) break;
        const prequelData = await fetchMedia(best.node.id);
        if (!prequelData) break;
        visited.set(best.node.id, prequelData);
        chainIds.unshift(best.node.id);
        current = prequelData;
    }

    current = media;
    for (let depth = 0; depth < 5; depth++) {
        const sequels: any[] = current?.relations?.edges?.filter(
            (e: any) => e.relationType === 'SEQUEL' && e.node.format === 'TV'
        ) || [];
        const sorted = sequels.sort((a: any, b: any) =>
            (a.node.startDate?.year || 0) - (b.node.startDate?.year || 0)
        );
        const best = sorted[0];
        if (!best || visited.has(best.node.id)) break;
        const sequelData = await fetchMedia(best.node.id);
        if (!sequelData) break;
        visited.set(best.node.id, sequelData);
        chainIds.push(best.node.id);
        current = sequelData;
    }

    const chain: ChainSeason[] = [];
    let cumBefore = 0;
    for (let i = 0; i < chainIds.length; i++) {
        const data = visited.get(chainIds[i]);
        if (!data) continue;
        const eps: number = data.episodes || 0;
        const rawSynonyms: any[] = data.synonyms || [];
        chain.push({
            anilistId: chainIds[i],
            seasonNumber: i + 1,
            title: data.title?.english || data.title?.romaji || '',
            romajiTitle: data.title?.romaji || '',
            synonyms: rawSynonyms
                .filter((s: any) => typeof s === 'string' && s.length > 3 && s.length < 80)
                .filter((s: string) => /^[a-zA-Z0-9\s\-:.,!?'&()]+$/.test(s))
                .slice(0, 3),
            episodes: eps,
            format: data.format || 'TV',
            cumulativeBefore: cumBefore,
            cumulativeAfter: cumBefore + eps
        });
        cumBefore += eps;
    }

    return chain;
}

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
    if (!anilistId) return null;

    const now = Date.now();
    const cacheKey = `${CACHE_VERSION}-${anilistId}`;
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (cached && now < cached.expiry) return cached.data;
    }

    const media = await fetchMedia(anilistId);
    if (!media) {
        cache.set(cacheKey, { data: null, expiry: now + 60 * 1000 });
        return null;
    }

    let seasonsBefore = 0;
    let prequelEpisodes = 0;
    let prequelYear = 0;
    let immediatePrequelTitle = "";
    let immediatePrequelEpisodes = 0;
    let currentMedia: any = media;
    const visited = new Set<number>([anilistId]);

    for (let depth = 0; depth < 10; depth++) {
        const prequels: any[] = currentMedia?.relations?.edges?.filter(
            (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
        ) || [];
        const sorted = prequels.sort((a: any, b: any) =>
            (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
        );
        const best = sorted[0];
        if (!best || visited.has(best.node.id)) break;
        visited.add(best.node.id);
        seasonsBefore++;
        prequelEpisodes += (best.node.episodes || 0);
        if (prequelYear === 0) {
            prequelYear = best.node.startDate?.year || 0;
            immediatePrequelTitle = best.node.title?.english || best.node.title?.romaji || "";
            immediatePrequelEpisodes = best.node.episodes || 0;
        }
        const prequelMedia = await fetchMedia(best.node.id);
        if (!prequelMedia) break;
        currentMedia = prequelMedia;
    }

    const chain = await buildChain(anilistId, media);

    const rawSynonyms: any[] = media.synonyms || [];
    const meta: AniListMeta = {
        format: media.format || 'TV',
        englishTitle: media.title?.english || '',
        romajiTitle: media.title?.romaji || '',
        year: media.startDate?.year || media.seasonYear || 0,
        seasonsBefore,
        prequelEpisodes,
        prequelYear,
        immediatePrequelTitle,
        immediatePrequelEpisodes,
        synonyms: rawSynonyms
            .filter((s: any) => typeof s === 'string')
            .filter((s: string) => /^[a-zA-Z0-9\s\-:.,!?'&()]+$/.test(s))
            .slice(0, 5),
        chain
    };

    cache.set(cacheKey, { data: meta, expiry: now + 5 * 60 * 1000 });
    return meta;
}

export type { AniListMeta, ChainSeason };
