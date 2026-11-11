import type { AniListMeta, ChainSeason, Format } from './types';
import { fetchWithTimeout } from './utils';

// ১. প্রাইমারি প্রক্সি, ২. অফিসিয়াল ফলব্যাক
const ANILIST_ENDPOINTS = [
  "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql",
  "https://graphql.anilist.co"
];

const CACHE_VERSION = "v12-dynamic"; 
const cache = new Map<string, { data: AniListMeta | null; expiry: number }>();

interface MediaNode {
  id: number;
  title: { english?: string; romaji?: string };
  synonyms?: string[];
  format?: Format;
  episodes?: number | null;
  relations?: {
    edges: Array<{ relationType: string; node: MediaNode }>;
  };
}

async function fetchMedia(id: number): Promise<MediaNode | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id format episodes synonyms
        title { english romaji }
        relations {
          edges {
            relationType
            node { id format episodes title { english romaji } }
          }
        }
      }
    }
  `;

  for (const endpoint of ANILIST_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id } })
      }, 8000);
      
      if (res.ok) {
        const json: any = await res.json();
        if (json?.data?.Media) return json.data.Media;
      }
    } catch {
      // এক এন্ডপয়েন্ট ফেল করলে লুপ চলে পরেরটায় যাবে
    }
  }
  return null;
}

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
  if (!anilistId) return null;

  const now = Date.now();
  const cacheKey = `${CACHE_VERSION}-${anilistId}`;
  const cached = cache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const media = await fetchMedia(anilistId);
  if (!media) {
    cache.set(cacheKey, { data: null, expiry: now + 60 * 1000 });
    return null;
  }

  // 🎯 Unicode Supported Regex for Synonyms (\p{L} = Letters, \p{N} = Numbers)
  const filterSynonyms = (syns: string[] = []) => 
    syns.filter(s => /^[\p{L}\p{N}\s\-:.,!?'&()]+$/u.test(s)).slice(0, 5);

  const toChainSeason = (node: MediaNode, rel: 'CURRENT' | 'PREQUEL' | 'SEQUEL'): ChainSeason => ({
    anilistId: node.id,
    title: node.title?.english || node.title?.romaji || '',
    romajiTitle: node.title?.romaji || '',
    synonyms: filterSynonyms(node.synonyms),
    episodes: node.episodes || 0,
    format: node.format || 'TV',
    relationType: rel
  });

  const prequelEdges = (media.relations?.edges || [])
    .filter(e => e.relationType === 'PREQUEL' && e.node.format === 'TV')
    .sort((a, b) => (b.node.id - a.node.id)); 

  const meta: AniListMeta = {
    current: toChainSeason(media, 'CURRENT'),
    prequels: prequelEdges.map(e => toChainSeason(e.node, 'PREQUEL')),
    immediatePrequelEpisodes: prequelEdges[0]?.node?.episodes || 0,
    synonyms: filterSynonyms(media.synonyms)
  };

  cache.set(cacheKey, { data: meta, expiry: now + 5 * 60 * 1000 });
  return meta;
}
