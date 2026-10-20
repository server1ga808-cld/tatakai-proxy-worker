// W3 থেকে আসা রিকোয়েস্টের টাইপ
export interface ProxyInput {
  title: string;
  romaji_title?: string;
  english_title?: string;
  episode: number;
  is_movie: boolean;
  season?: number;
  year?: number;
  anilist_id?: number; // ডিবাগিং-এর জন্য
}

// W3-কে রিটার্ন করা রেসপন্সের টাইপ
export interface ProxyOutput {
  hindi: {
    server: string;
    url: string;
    source: string;
  }[];
}

// Tatakai API থেকে আসা সার্ভার অবজেক্টের টাইপ (Hindi)
export interface TatakaiHindiServerItem {
  name: string;
  url: string;
}

// Tatakai API থেকে আসা সোর্সের টাইপ (Desi)
export interface TatakaiDesiSource {
  server: string;
  url: string;
  type: string;
  referer?: string;
}
