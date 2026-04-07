// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 1. Standard client (subject to RLS)
const supabase = createClient(supabaseUrl, anonKey);

// 2. Admin client (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Exporting both as an object
module.exports = { supabase, supabaseAdmin };