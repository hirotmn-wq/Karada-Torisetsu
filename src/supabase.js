const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
console.log("SUPABASE URL:", url?.slice(0,40));
console.log("SUPABASE KEY:", key ? key.slice(0,20)+"..." : "NOT SET");

import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, key)
export default supabase