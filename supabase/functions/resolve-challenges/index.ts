import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const corsHeaders = { 'content-type': 'application/json; charset=utf-8' }

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders })
  }

  const expectedSecret = Deno.env.get('CHALLENGE_CRON_SECRET')
  if (!expectedSecret || request.headers.get('x-cron-secret') !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server configuration missing' }), { status: 500, headers: corsHeaders })
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('resolve_expired_challenges')
  if (error) {
    console.error('Could not resolve expired challenges', error)
    return new Response(JSON.stringify({ error: 'Resolution failed' }), { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ resolved: data }), { status: 200, headers: corsHeaders })
})
