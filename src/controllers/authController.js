
const supabase = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');

// Initialize the Admin Client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use the SERVICE role, not the ANON key
);

// Node.js (Express) Endpoint
const signUp = async (req, res) => {
  const { email, password, first_name, last_name, role } = req.body;

  try {
    // 1. Only create the user in Auth
    // The moment this succeeds, the Postgres Trigger "wakes up" 
    // and creates the profile + wallet automatically.
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { 
        first_name, 
        last_name, 
        role,
        username: email.split('@')[0] // Passing this so the trigger can grab it
      }
    });

    if (authError) throw authError;

    // 2. Success!
    return res.status(201).json({
      success: true,
      message: "Registration successful. Profile and Wallet initialized.",
      user: authData.user
    });

  } catch (error) {
    console.error("Signup Error:", error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
};



module.exports = {
    signUp
};