import type { AniListMeta, ChainSeason } from './types';
import { fetchWithTimeout } from './utils';
import { getCache, setCache, getAniListCacheKey, TTL } from './cache';

// 🎯 Updated: Deno Deploy replaced with new Render Hybrid Proxy
const ANILIST_ENDPOINTS = [
  "https://hy-proxy.onrender.com/graphql", // নতুন Render Hybrid Proxy
  "https://graphql.anilist.co"            // Fallback (যদিও Cloudflare Worker থেকে ব্লক হতে পারে)
];

const ALLOWED_FORMATS = ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'];

// 🎯 Health-Tracking: Remember which endpoint works to avoid double calls
let healthyEndpointIdx = 0;

async function tryEndpoint(idx: number, query: string, variables: any, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetchWithTimeout(ANILIST_ENDPOINTS[idx], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    }, timeoutMs);
    
    // যদি রেসপন্স 429 (Rate Limit) বা 500 হয়, তবে null রিটার্ন করবে যাতে ফলব্যাক ট্রাই করা যায়
    if (!res.ok) return null; 
    
    const json: any = await res.json();
    if (!json?.data?.Media) return null;
    return json.data;
  } catch { return null; }
}

async function gqlRequest(query: string, variables: any): Promise<any> {
  // 🎯 Step 1: Try current healthy endpoint with 12s timeout (Increased for Render cold starts)
  let result = await tryEndpoint(healthyEndpointIdx, query, variables, 12000);
  if (result) return result;

  // 🎯 Step 2: Try backup endpoint with 8s timeout
  const backupIdx = 1 - healthyEndpointIdx;
  result = await tryEndpoint(backupIdx, query, variables, 8000);
  if (result) {
    healthyEndpointIdx = backupIdx; // Mark backup as healthy for future
    return result;
  }

  return null;
}

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

  const cacheKey = getAniListCacheKey(anilistId);
  const cached = await getCache<AniListMeta>(cacheKey);
  if (cached) return cached;

  const data = await gqlRequest(SINGLE_CALL_QUERY, { id: anilistId });
  if (!data?.Media) return null;
  
  const currentMedia = data.Media;
  
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
    timeline: [
       ...(prequelEdge ? [toChainSeason(prequelEdge.node)] : []),
       toChainSeason(currentMedia)
    ],
    immediatePrequelEpisodes: prequelEps,
    currentPrequelTitles: [prequelTitleEn, prequelTitleRo].filter(Boolean),
    synonyms: filterSynonyms(currentMedia.synonyms)
  };

  await setCache(cacheKey, meta, TTL.ANILIST_META); 
  return meta;
}
