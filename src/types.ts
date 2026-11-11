// ─── Input ─────────────────────────────────────────────
export interface ProxyInput {
  title: string;
  romaji_title?: string;
  english_title?: string;
  episode: number;
  is_movie?: boolean;
  year?: number;
  season?: string;
  anilist_id: number;
}

// ─── AniList ───────────────────────────────────────────
export type Format = 'TV' | 'TV_SHORT' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | string;

export interface ChainSeason {
  anilistId: number;
  title: string;
  romajiTitle: string;
  synonyms: string[];
  episodes: number;
  format: Format;
  relationType: 'CURRENT' | 'PREQUEL' | 'SEQUEL';
}

export interface AniListMeta {
  current: ChainSeason;
  prequels: ChainSeason[];
  immediatePrequelEpisodes: number; // এটাই আমাদের মেইন ম্যাথ (অফসেট)
  synonyms: string[];
}

// ─── Tatakai / Desi Data ───────────────────────────────
export interface DesiSearchResult {
  id: string; // slug (e.g., "demon-slayer-season-2")
  title: string;
  type: string;
  url: string;
}

export interface Candidate {
  slug: string;       // e.g., "demon-slayer-season-2"
  title: string;
  type: string;
  score: number;
  derivedBaseName?: string; // e.g., "kimetsu-no-yaiba-yuukaku-hen-season-2"
}

export interface DesiSource {
  server: string;
  url: string;
  type?: string;
  referer?: string;
}
