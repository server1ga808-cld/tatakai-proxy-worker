import type { AniListMeta, ChainSeason, Format } from './types';
import { fetchWithTimeout, getCache, setCache } from './utils';

const ANILIST_ENDPOINTS = [
  "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql",
  "https://graphql.anilist.co"
];

const CACHE_VERSION = "v20-god-mode"; 
const ALLOWED_FORMATS = ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'];

async function gqlRequest(query: string, variables: any): Promise<any> {
  for (const endpoint of ANILIST_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables })
      }, 8000);
      if (res.ok) { const json: any = await res.json(); if (json?.data) return json.data; }
    } catch { }
  }
  return null;
}

// 🎯 Single Query containing Current + Prequel details
const SINGLE_CALL_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id title { english romaji } format episodes synonyms
      relations { 
        edges { 
          relationType 
          node { id format episodes title { english romaji } } 
        } 
      }
    }
  }
`;

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
  if (!anilistId) return null;

  const cacheKey = `anilist-${CACHE_VERSION}-${anilistId}`;
  const cached = await getCache<AniListMeta>(cacheKey);
  if (cached) return cached;

  const data = await gqlRequest(SINGLE_CALL_QUERY, { id: anilistId });
  if (!data?.Media) return null;
  
  const currentMedia = data.Media;
  
  // 🎯 1-Call Magic: Extract Immediate Prequel directly from first query
  const prequelEdge = currentMedia.relations?.edges?.find(
    (e: any) => e.relationType === 'PREQUEL' && ALLOWED_FORMATS.includes(e.node.format)
  );

  const prequelEps = prequelEdge?.node?.episodes || 0;
  const prequelTitleEn = prequelEdge?.node?.title?.english || '';
  const prequelTitleRo = prequelEdge?.node?.title?.romaji || '';

  const filterSynonyms = (syns: string[] = []) => 
    syns.filter(s => /^[\p{L}\p{N}\s\-:.,!?'&()]+$/u.test(s)).slice(0, 5);

  const toChainSeason = (node: any): ChainSeason => ({
    anilistId: node.id, 
    title: node.title?.english || node.title?.romaji || '', 
    romajiTitle: node.title?.romaji || '', 
    episodes: node.episodes || 0, 
    format: node.format || 'TV'
  });

  const meta: AniListMeta = {
    current: toChainSeason(currentMedia),
    timeline: [ // We mock the timeline just to keep types happy for P1 blocking
       ...(prequelEdge ? [toChainSeason(prequelEdge.node)] : []),
       toChainSeason(currentMedia)
    ],
    immediatePrequelEpisodes: prequelEps,
    synonyms: filterSynonyms(currentMedia.synonyms),
    // Storing prequel titles directly in synonyms/current to help extractor
    currentPrequelTitles: [prequelTitleEn, prequelTitleRo].filter(Boolean) 
  } as AniListMeta; // Type cast to include custom field

  await setCache(cacheKey, meta, 86400 * 7); // ৭ দিন ক্যাশ
  return meta;
}
