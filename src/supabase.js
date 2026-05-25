console.log("SUPABASE URL:", import.meta.env.VITE_SUPABASE_URL ? "SET" : "NOT SET");
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export default supabase
