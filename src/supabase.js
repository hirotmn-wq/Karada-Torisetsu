const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, key)
export default supabase