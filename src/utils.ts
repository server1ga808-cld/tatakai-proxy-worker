import type { DesiSource } from './types';

export function slugify(text: string): string {
  if (!text) return '';
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function padBase64(str: string): string {
  const pad = str.length % 4;
  return pad ? str + '='.repeat(4 - pad) : str;
}

export function decodeEmbedId(raw: string): DesiSource | null {
  try {
    const parts = raw.split(':');
    if (parts.length !== 2) return null;
    
    const server = atob(padBase64(parts[0])).trim();
    let url = atob(padBase64(parts[1])).trim();
    
    if (!url.startsWith('http')) {
      const match = url.match(/src=['"](.*?)['"]/i);
      if (match && match[1]) {
        url = match[1];
        if (url.startsWith('//')) url = 'https:' + url;
      }
    }
    return { server, url, type: 'embed' };
  } catch {
    return null;
  }
}

export function isAllowedServer(serverName: string): boolean {
  const s = serverName.toLowerCase();
  return s.includes('mirror') || s.includes('abyss') || s.includes('vmoly');
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

const ROMAN_MAP: Record<string, string> = {
  'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10'
};

export function normalizeNumeric(text: string): string {
  if (!text) return '';
  let s = ' ' + text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/_/g, ' ') + ' ';
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\s+(season|part|cour)\b/g, ' $2 $1 ');
  s = s.replace(/\b(season|part|cour)\s+(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (_, kw, rm) => ` ${kw} ${ROMAN_MAP[rm]} `);
  s = s.replace(/\bs(\d+)\b/g, ' season $1 ');
  s = s.replace(/\bp(\d+)\b/g, ' part $1 ');
  s = s.replace(/\bfinal\s+season\b/g, ' final ');
  return s.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'for', 'on', 'at', 'is', 'as', 'with', 'no', 'by']);

function tokenize(s: string): string[] {
  return normalizeNumeric(s).split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
}

export function wordJaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function prefixBonus(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const minLen = Math.min(ta.length, tb.length);
  let matchLen = 0;
  for (let i = 0; i < minLen; i++) {
    if (ta[i] === tb[i]) matchLen++;
    else break;
  }
  if (matchLen === minLen && minLen > 0) return 1;
  if (matchLen >= 2) return 0.5;
  return 0;
}

export function getSimilarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const jac = wordJaccard(a, b);
  const prefix = prefixBonus(a, b);
  return Math.min(1, (jac * 0.7) + (prefix * 0.3));
}

export function getRootTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/:\s*(the\s+)?final\s+season.*/i, '')
    .replace(/\s+(the\s+)?final\s+season.*/i, '')
    .replace(/\s+season\s+\d+.*/i, '')
    .replace(/\s+part\s+\d+.*/i, '')
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season.*/i, '')
    .replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s+.*)?$/i, '')
    .replace(/\s+s\d+(?:\s+.*)?$/i, '')
    .replace(/\s+p\d+(?:\s+.*)?$/i, '')
    .trim();
}
