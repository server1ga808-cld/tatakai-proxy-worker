export interface ProxyInput {
  title: string;
  romaji_title?: string;
  english_title?: string;
  episode: number;
  is_movie: boolean;
  season?: number;
  year?: number;
  anilist_id: number;
}

export interface ProxyOutput {
  hindi: {
    server: string;
    url: string;
    source: string;
  }[];
}

export interface ChainSeason {
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

export interface AniListMeta {
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

export interface Candidate {
  rawSlug: string;         // Desi search slug
  baseName: string;        // watch URL base
  offsets: number[];       // ordered offsets to try
  score: number;
  debug: {
    aniSeason: number;
    groupSize: number;
    desiSlug: string;
    desiTitle: string;
  };
}
