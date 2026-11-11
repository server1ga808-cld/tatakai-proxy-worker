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

export interface Candidate {
  rawSlug: string;
  score: number;
}

// AniListMeta এবং ChainSeason এখন anilist.ts-এ define করা আছে
