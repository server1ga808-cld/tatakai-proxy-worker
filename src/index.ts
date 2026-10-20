import { getCandidateSlugs } from './searcher';
import { extractStreams } from './extractor';
import { ProxyInput } from './types';

export default {
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        try {
            const input: ProxyInput = await request.json();
            
            if (!input.title || input.episode === undefined || !input.anilist_id) {
                return new Response(JSON.stringify({ error: 'Missing required parameters (title, episode, anilist_id)' }), { 
                    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
                });
            }

            // ১. AniList + Tatakai Search
            const candidates = await getCandidateSlugs(input);
            
            // ২. স্ট্রিম লিংক এক্সট্রাক্ট (এখানে পুরো input পাস করা হলো)
            const hindiStreams = await extractStreams(candidates, input);

            // ৩. রেসপন্স রিটার্ন
            return new Response(JSON.stringify({ hindi: hindiStreams }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
            
        } catch (error: any) {
            return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
                status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
