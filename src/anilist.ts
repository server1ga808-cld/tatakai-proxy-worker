import type { AniListMeta, ChainSeason } from './types';

const ANILIST_PROXY_URL = "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql";
const CACHE_VERSION = "V10";
const cache = new Map<string, { data: AniListMeta | null; expiry: number }>();

async function fetchMedia(id: number) {
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
        const json = await res.json();
        return json?.data?.Media;
    } catch (e) {
        return null;
    }
}

async function buildChain(anilistId: number, media: any): Promise<ChainSeason[]> {
    const visited = new Map<number, any>();
    visited.set(anilistId, media);
    const chainIds: number[] = [anilistId];

    // 1. Walk PREQUELS back to S1
    let current = media;
    for (let depth = 0; depth < 8; depth++) {
        const prequels = current.relations?.edges?.filter(
            (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
        ) || [];
        const best = prequels.sort((a: any, b: any) =>
            (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
        )[0];
        if (!best || visited.has(best.node.id)) break;
        const prequelData = await fetchMedia(best.node.id);
        if (!prequelData) break;
        visited.set(best.node.id, prequelData);
        chainIds.unshift(best.node.id);
        current = prequelData;
    }

    // 2. Walk SEQUELS forward from target
    current = media;
    for (let depth = 0; depth < 5; depth++) {
        const sequels = current.relations?.edges?.filter(
            (e: any) => e.relationType === 'SEQUEL' && e.node.format === 'TV'
        ) || [];
        const best = sequels.sort((a: any, b: any) =>
            (a.node.startDate?.year || 0) - (b.node.startDate?.year || 0)
        )[0];
        if (!best || visited.has(best.node.id)) break;
        const sequelData = await fetchMedia(best.node.id);
        if (!sequelData) break;
        visited.set(best.node.id, sequelData);
        chainIds.push(best.node.id);
        current = sequelData;
    }

    // 3. Build chain with cumulative
    const chain: ChainSeason[] = [];
    let cumBefore = 0;
    for (let i = 0; i < chainIds.length; i++) {
        const data = visited.get(chainIds[i]);
        if (!data) continue;
        const eps = data.episodes || 0;
        chain.push({
            anilistId: chainIds[i],
            seasonNumber: i + 1,
            title: data.title?.english || data.title?.romaji || '',
            romajiTitle: data.title?.romaji || '',
            synonyms: (data.synonyms || [])
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
        const cached = cache.get(cacheKey)!;
        if (now < cached.expiry) return cached.data;
    }

    const media = await fetchMedia(anilistId);
    if (!media) {
        cache.set(cacheKey, { data: null, expiry: now + 60 * 1000 }); // short cache for null
        return null;
    }

    // Existing meta fields (backward compatible with current extractor)
    let seasonsBefore = 0;
    let prequelEpisodes = 0;
    let prequelYear = 0;
    let immediatePrequelTitle = "";
    let immediatePrequelEpisodes = 0;
    let currentMedia = media;
    const visited = new Set<number>([anilistId]);

    for (let depth = 0; depth < 10; depth++) {
        const prequels = currentMedia.relations?.edges?.filter(
            (e: any) => e.relationType === 'PREQUEL' && e.node.format === 'TV'
        ) || [];
        const best = prequels.sort((a: any, b: any) =>
            (b.node.startDate?.year || 0) - (a.node.startDate?.year || 0)
        )[0];
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

    // Build full chain (new)
    const chain = await buildChain(anilistId, media);

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
        synonyms: (media.synonyms || [])
            .filter((s: any) => typeof s === 'string')
            .filter((s: string) => /^[a-zA-Z0-9\s\-:.,!?'&()]+$/.test(s))
            .slice(0, 5),
        chain
    };

    cache.set(cacheKey, { data: meta, expiry: now + 5 * 60 * 1000 });
    return meta;
}
