import type { AniListMeta, ChainSeason, Format } from './types';
import { fetchWithTimeout, getCache, setCache } from './utils';

const ANILIST_ENDPOINTS = [
  "https://gojotv-anilist-proxy.taiwansixtynine0987-arch.deno.net/graphql",
  "https://graphql.anilist.co"
];

const CACHE_VERSION = "v19-edge-masterpiece"; 
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

const RELATION_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji } format episodes synonyms relations { edges { relationType node { id format episodes } } } } }`;
const BULK_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id title { english romaji } format episodes synonyms } } }`;

export async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
  if (!anilistId) return null;

  const cacheKey = `anilist-${CACHE_VERSION}-${anilistId}`;
  const cached = await getCache<AniListMeta>(cacheKey);
  if (cached) return cached;

  const currentData = await gqlRequest(RELATION_QUERY, { id: anilistId });
  if (!currentData?.Media) return null;
  const currentMedia = currentData.Media;
  
  // 🎯 Optimization: Limit Depth to 4 to prevent infinite sequential calls
  let rootId = anilistId;
  let tempMedia = currentMedia;
  for (let depth = 0; depth < 4; depth++) {
    const prequelEdge = tempMedia.relations?.edges?.find((e: any) => e.relationType === 'PREQUEL' && ALLOWED_FORMATS.includes(e.node.format));
    if (!prequelEdge) break; 
    rootId = prequelEdge.node.id;
    const rootData = await gqlRequest(RELATION_QUERY, { id: rootId });
    if (!rootData?.Media) break;
    tempMedia = rootData.Media;
  }

  const timelineIds: number[] = [rootId];
  let currentId = rootId;
  let walkMedia = tempMedia; 

  for (let depth = 0; depth < 5; depth++) {
    const sequelEdge = walkMedia?.relations?.edges?.find((e: any) => e.relationType === 'SEQUEL' && ALLOWED_FORMATS.includes(e.node.format));
    if (!sequelEdge) break; 
    currentId = sequelEdge.node.id;
    timelineIds.push(currentId);
    const nextData = await gqlRequest(RELATION_QUERY, { id: currentId });
    if (!nextData?.Media) break;
    walkMedia = nextData.Media;
  }

  const bulkData = await gqlRequest(BULK_QUERY, { ids: timelineIds });
  const mediaList = bulkData?.Page?.media || [];
  const orderedMedia = timelineIds.map(id => mediaList.find((m: any) => m.id === id)).filter(Boolean);

  const filterSynonyms = (syns: string[] = []) => syns.filter(s => /^[\p{L}\p{N}\s\-:.,!?'&()]+$/u.test(s)).slice(0, 5);
  const toChainSeason = (node: any): ChainSeason => ({
    anilistId: node.id, title: node.title?.english || node.title?.romaji || '', romajiTitle: node.title?.romaji || '', episodes: node.episodes || 0, format: node.format || 'TV'
  });

  const targetIndex = timelineIds.indexOf(anilistId);
  const prequelId = targetIndex > 0 ? timelineIds[targetIndex - 1] : null;
  const prequelMedia = prequelId ? mediaList.find((m: any) => m.id === prequelId) : null;

  const meta: AniListMeta = {
    current: toChainSeason(currentMedia),
    timeline: orderedMedia.map(m => toChainSeason(m)),
    immediatePrequelEpisodes: prequelMedia?.episodes || 0,
    synonyms: filterSynonyms(currentMedia.synonyms)
  };

  await setCache(cacheKey, meta, 86400 * 7); // ৭ দিন ক্যাশ
  return meta;
}
