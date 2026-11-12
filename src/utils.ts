import type { DesiSource } from './types';

export function slugify(text: string): string {
  if (!text) return '';
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// 🎯 Cloudflare Edge Cache Helpers
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const cacheUrl = `https://cache.internal/${key}`;
    const res = await caches.default.match(new Request(cacheUrl));
    if (!res) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttlSeconds: number = 86400): Promise<void> {
  try {
    const cacheUrl = `https://cache.internal/${key}`;
    const res = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
    });
    await caches.default.put(new Request(cacheUrl), res);
  } catch { /* Ignore cache write errors */ }
}

export function isAllowedServer(serverName: string): boolean {
  const s = serverName.toLowerCase();
  return s.includes('mirror') || s.includes('abyss') || s.includes('vmoly');
}

const LANG_SYNONYMS: Record<string, string[]> = {
  'bengali': ['bangla', 'bengali'], 'tamil': ['tamil'], 'telugu': ['telugu'],
  'malayalam': ['malayalam'], 'kannada': ['kannada'], 'english': ['english', 'eng'], 'hindi': ['hindi', 'desi']
};

export function isLanguageRestricted(slugOrTitle: string, preferredLang: string = 'hindi'): boolean {
  const s = slugOrTitle.toLowerCase();
  const pref = preferredLang.toLowerCase();
  
  let prefSynonyms: string[] = [pref];
  for (const [key, syns] of Object.entries(LANG_SYNONYMS)) {
    if (syns.some(langSyn => pref.includes(langSyn) || langSyn.includes(pref))) {
      prefSynonyms = syns; break;
    }
  }
  for (const [langKey, syns] of Object.entries(LANG_SYNONYMS)) {
    if (syns.some(l => s.includes(l))) {
      if (!syns.some(l => prefSynonyms.includes(l))) return true;
    }
  }
  return false;
}

const ROMAN_MAP: Record<string, string> = { 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10' };

export function normalizeNumeric(text: string): string {
  if (!text) return '';
  let s = ' ' + text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/_/g, ' ') + ' ';
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\s+(season|part|cour)\b/g, ' $2 $1 ');
  s = s.replace(/\b(season|part|cour)\s+(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (_, kw, rm) => ` ${kw} ${ROMAN_MAP[rm]} `);
  s = s.replace(/\bs(\d+)\b/g, ' season $1 ').replace(/\bp(\d+)\b/g, ' part $1 ');
  return s.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function getRootTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/:\s*(the\s+)?final\s+season.*/i, '').replace(/\s+(the\s+)?final\s+season.*/i, '')
    .replace(/\s+season\s+\d+.*/i, '').replace(/\s+part\s+\d+.*/i, '').replace(/\s+\d+(?:st|nd|rd|th)\s+season.*/i, '')
    .replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s+.*)?$/i, '').replace(/\s+s\d+(?:\s+.*)?$/i, '').replace(/\s+p\d+(?:\s+.*)?$/i, '').trim();
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'on', 'at', 'is', 'as', 'with', 'no', 'by']);
function tokenize(s: string): string[] { return normalizeNumeric(s).split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w)); }

export function getSimilarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(tokenize(a)); const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0; for (const t of sa) if (sb.has(t)) inter++;
  const jaccard = inter / (sa.size + sb.size - inter);
  
  const ta = tokenize(a); const tb = tokenize(b); const minLen = Math.min(ta.length, tb.length);
  let prefixMatch = 0; for (let i = 0; i < minLen; i++) { if (ta[i] === tb[i]) prefixMatch++; else break; }
  return Math.min(1, (jaccard * 0.7) + ((prefixMatch === minLen && minLen > 0 ? 1 : (prefixMatch >= 2 ? 0.5 : 0)) * 0.3));
}

export function verifyEpisodeNumber(desiTitle: string, targetEp: number, isMovie: boolean = false): boolean {
  if (isMovie) return true;
  if (!desiTitle) return false;
  const normalized = desiTitle.toLowerCase();
  const match = normalized.match(/(?:episode|ep)\.?\s*[-:/\s]*\s*0?(\d+)(?!\d)/i);
  if (!match) return false; 
  return parseInt(match[1], 10) === targetEp;
}
