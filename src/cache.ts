// 🎯 Central Cache Configuration
// Bump CACHE_VERSION here to invalidate ALL caches globally
export const CACHE_VERSION = "v33";

export const TTL = {
  ANILIST_META: 86400 * 7,      // 7 days
  SEARCH_RESULTS: 86400,         // 1 day
  RESOLVED_STREAM: 86400 * 7,    // 7 days
} as const;

// 🎯 Cache Key Generators
export function getAniListCacheKey(anilistId: number): string {
  return `anilist-${CACHE_VERSION}-${anilistId}`;
}

export function getSearchCacheKey(titleSlug: string): string {
  return `search-${CACHE_VERSION}-${titleSlug}`;
}

export function getResolvedCacheKey(anilistId: number, lang: string): string {
  return `resolved-${CACHE_VERSION}-${anilistId}-${lang}`;
}

// 🎯 Cache Access Helpers
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const res = await caches.default.match(new Request(`https://cache.internal/${key}`));
    if (!res) return null;
    return await res.json() as T;
  } catch { return null; }
}

export async function setCache<T>(key: string, data: T, ttlSeconds: number = 86400): Promise<void> {
  try {
    const res = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
    });
    await caches.default.put(new Request(`https://cache.internal/${key}`), res);
  } catch { }
}
