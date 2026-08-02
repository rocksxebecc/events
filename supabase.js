// ==========================================================================
// CampusEventX — Standalone Supabase Client Initialization (No Build Required)
// ==========================================================================

const SUPABASE_URL  = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || 'https://zzlukkwtrveawikbfpyh.supabase.co';
const SUPABASE_ANON = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6bHVra3d0cnZlYXdpa2JmcHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjkxNDMsImV4cCI6MjEwMTE0NTE0M30.VqCeLmyC7q7-eIynyRPcchNDPn9Bg6m6uGOZDwiyKKY';

const getCreateClient = () => {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    return window.supabase.createClient;
  }
  try {
    return require('@supabase/supabase-js').createClient;
  } catch (_) {}
  return null;
};

const createClientFn = getCreateClient();

let _client = null;
try {
  if (createClientFn && SUPABASE_URL && SUPABASE_ANON) {
    _client = createClientFn(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession:   true,
        autoRefreshToken: true,
        storage:          typeof window !== 'undefined' ? window.localStorage : undefined,
        storageKey:       'campuseventx-auth-token',
        detectSessionInUrl: true,
      },
    });
  }
} catch (err) {
  console.error('[CampusEventX] Supabase createClient failed:', err.message);
}

// Fallback stub
const stub = {
  auth: {
    getSession:      async () => ({ data: { session: null }, error: null }),
    signUp:          async () => { throw new Error('Supabase client initialization failed.'); },
    signInWithPassword: async () => { throw new Error('Supabase client initialization failed.'); },
    signOut:         async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: () => ({
    select:  () => ({ eq: () => ({ single: async () => ({ data: null, error: new Error('Not configured') }), data: [], error: null }), order: () => ({ data: [], error: null }), data: [], error: null }),
    insert:  () => ({ select: () => ({ single: async () => ({ data: null, error: new Error('Not configured') }) }) }),
    update:  () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: new Error('Not configured') }) }) }) }),
    delete:  () => ({ eq: () => ({ data: null, error: null }) }),
  }),
};

export const supabase = _client || stub;
