export interface ProxyInput {
  title: string;
  romaji_title?: string;
  english_title?: string;
  episode: number;
  is_movie?: boolean;
  year?: number;
  season?: string;
  anilist_id: number;
  preferred_lang?: string;
}

export type Format = 'TV' | 'TV_SHORT' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | string;

export interface ChainSeason {
  anilistId: number;
  title: string;
  romajiTitle: string;
  episodes: number;
  format: Format;
}

export interface AniListMeta {
  current: ChainSeason;
  timeline: ChainSeason[];
  immediatePrequelEpisodes: number; 
  synonyms: string[];
}

export interface DesiSearchResult {
  id: string; 
  title: string;
  type: string;
  url: string;
}

export interface Candidate {
  slug: string;       
  title: string;
  type: string;
  score: number;
  derivedBaseName?: string; 
}

export interface DesiSource {
  server: string;
  url: string;
  type?: string;
  referer?: string;
}
