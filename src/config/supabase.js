/**
 * Supabase Client Configuration
 * Uses the service-role key for all server-side operations (bypasses RLS).
 * Never expose the service-role key to the frontend.
 */

import { createClient } from '@supabase/supabase-js';

let supabaseClient = null;

const getSupabase = () => {
  if (!supabaseClient) {
    const rawUrl = process.env.SUPABASE_URL;
    const key    = process.env.SUPABASE_SERVICE_ROLE;

    if (!rawUrl || !key) {
      throw new Error(
        'Supabase configuration missing. ' +
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE in your .env file.'
      );
    }

    // Remove trailing slash — the Supabase JS client breaks with a trailing slash.
    const url = rawUrl.replace(/\/+$/, '');

    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
      db: {
        schema: 'public',
      },
    });
  }
  return supabaseClient;
};

export default getSupabase;
