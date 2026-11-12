import type { DesiSource } from './types';

export function slugify(text: string): string {
  if (!text) return '';
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const cacheUrl = `https://cache.internal/${key}`;
    const res = await caches.default.match(new Request(cacheUrl));
    if (!res) return null;
    return await res.json() as T;
  } catch { return null; }
}

export async function setCache<T>(key: string, data: T, ttlSeconds: number = 86400): Promise<void> {
  try {
    const cacheUrl = `https://cache.internal/${key}`;
    const res = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
    });
    await caches.default.put(new Request(cacheUrl), res);
  } catch { }
}

export function isAllowedServer(serverName: string): boolean {
  const s = serverName.toLowerCase();
  return s.includes('mirror') || s.includes('abyss') || s.includes('vmoly');
}

export function isLanguageRestricted(slugOrTitle: string, preferredLang: string = 'hindi'): boolean {
  return false; // Streams are multi-audio, no need to block
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

// 🎯 ১০০% বুলেটপ্রুফ ভেরিফিকেশন (মাল্টি-অডিও ট্যাগ হ্যান্ডেল করার জন্য)
export function verifyEpisodeNumber(desiTitle: string, targetEp: number, isMovie: boolean = false): boolean {
  if (isMovie) return true;
  if (!desiTitle) return false;
  
  const normalized = desiTitle.toLowerCase();
  
  // ১. প্রথমে "Episode X" বা "Ep X" খোঁজা
  let match = normalized.match(/(?:episode|ep)\.?\s*[-:/\s]*\s*0?(\d+)(?!\d)/i);
  if (match) return parseInt(match[1], 10) === targetEp;
  
  // ২. ব্র্যাকেট এবং সিজন/পার্ট রিমুভ করে ক্লিন করা
  const cleanTitle = normalized
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '') // ব্র্যাকেটের ভেতরের সব লেখা মুছে ফেলবে (যেমন [Hindi + Bengali])
    .replace(/\b(?:season|part|cour|s|p)\s*\d+\b/gi, '') // "part 2" বা "season 3" মুছে ফেলবে
    .trim();
    
  // ৩. এবার ক্লিন করা টাইটেলের শেষে থাকা এপিসোড নম্বর খোঁজা
  match = cleanTitle.match(/(?:^|[-:/\s])\s*0?(\d+)(?!\d)\s*$/i);
  if (match) return parseInt(match[1], 10) === targetEp;
  
  return false; 
}
