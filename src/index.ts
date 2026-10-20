import { getCandidateSlugs } from './searcher';
import { extractStreams } from './extractor';
import { ProxyInput } from './types';

export default {
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
        // CORS হেডার্স (যাতে W3 বা ফ্রন্টএন্ড থেকে কল করা যায়)
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), { 
                status: 405, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
        }

        try {
            const input: ProxyInput = await request.json();
            
            // ভ্যালিডেশন
            if (!input.title || input.episode === undefined) {
                return new Response(JSON.stringify({ error: 'Missing title or episode parameter' }), { 
                    status: 400, 
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
                });
            }

            // ১. সার্চ করে স্লাগ খোঁজা
            const candidates = await getCandidateSlugs(input);
            
            // ২. স্ট্রিমিং লিংক এক্সট্রাক্ট করা
            const hindiStreams = await extractStreams(candidates, input.episode, input.is_movie);

            // ৩. W3-কে ক্লিন রেসপন্স দেওয়া
            return new Response(JSON.stringify({ hindi: hindiStreams }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
            
        } catch (error: any) {
            return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
