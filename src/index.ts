import { getCandidateSlugs } from './searcher';
import { extractStreams } from './extractor';
import type { ProxyInput } from './types';

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let input: ProxyInput;
    try { input = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    if (!input?.title || input.episode === undefined || !input.anilist_id) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      const candidates = await getCandidateSlugs(input);
      const streams = await extractStreams(candidates, input);

      const uniqueStreamsMap = new Map<string, typeof streams[0]>();
      for (const s of streams) { if (!uniqueStreamsMap.has(s.url)) uniqueStreamsMap.set(s.url, s); }

      const formattedStreams = Array.from(uniqueStreamsMap.values()).map(s => ({ server: s.server, url: s.url, source: 'tatakai-final' }));
      const langKey = input.preferred_lang || 'hindi';

      return new Response(JSON.stringify({ [langKey]: formattedStreams, hindi: formattedStreams }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};
