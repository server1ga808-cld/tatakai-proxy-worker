import type { AniListMeta, ChainSeason } from './types';
import { fetchWithTimeout } from './utils';
import { getCache, setCache, getAniListCacheKey, TTL } from './cache';

// 🎯 Dual Render Hybrid Proxy Setup
const ANILIST_PROXIES = [
  "https://hy-proxy.onrender.com/graphql",
  "https://hy-proxy-2.onrender.com/graphql"
];

// 🎯 Render Proxy API Key
const PROXY_API_KEY = "my-super-secret-key-123";

const ALLOWED_FORMATS = ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'];

// 🎯 Round-Robin Counter for load balancing
let currentProxyIndex = 0;

async function tryProxy(proxyIndex: number, query: string, variables: any, timeoutMs: number): Promise<any | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': PROXY_API_KEY
    };

    const res = await fetchWithTimeout(ANILIST_PROXIES[proxyIndex], {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    }, timeoutMs);
    
    if (!res.ok) {
      console.log(`[ANILIST] Proxy ${proxyIndex} failed with status: ${res.status}`);
      return null; 
    }
    
    const json: any = await res.json();
    if (!json?.data?.Media) return null;
    return json.data;
  } catch (e: any) { 
    console.log(`[ANILIST] Proxy ${proxyIndex} error: ${e.message}`);
    return null; 
  }
}

async function gqlRequest(query: string, variables: any): Promise<any> {
  // Determine which proxies to try (Current and Next)
  const firstProxy = currentProxyIndex;
  const secondProxy = (currentProxyIndex + 1) % 2;
  
  // Rotate for the NEXT request
  currentProxyIndex = secondProxy;

  // Try 1st Proxy (10s timeout)
  let result = await tryProxy(firstProxy, query, variables, 10000);
  if (result) return result;

  // Try 2nd Proxy (10s timeout)
  result = await tryProxy(secondProxy, query, variables, 10000);
  if (result) return result;

  // Final fallback to direct AniList (5s timeout - fail fast since CF blocks it usually)
  try {
    const res = await fetchWithTimeout("https://graphql.anilist.co", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    }, 5000); // 🎯 Reduced from 8s to 5s
    
    if (res.ok) {
      const json: any = await res.json();
      return json?.data || null;
    }
  } catch { 
    console.log(`[ANILIST] Direct fallback failed or timed out.`);
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
