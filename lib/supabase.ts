import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://fvwctpehdpcjakvpawke.supabase.co"
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2d2N0cGVoZHBjamFrdnBhd2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTgxMjAsImV4cCI6MjA3MTY5NDEyMH0.492Dzhnzl2IHa-rI_PqvlWFP4bxFN4k1IaHKBSUNZv4"

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
