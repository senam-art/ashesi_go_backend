const { supabaseAdmin } = require('../config/supabase');

// Node.js (Express) signup. The Postgres trigger handle_new_profile fires on
// auth.users insert and populates profiles + wallets automatically.
const signUp = async (req, res) => {
  const { email, password, first_name, last_name, role, username } = req.body;

  try {
    const fallbackUsername = (email || '').split('@')[0].toLowerCase();

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name,
        last_name,
        role,
        username: (username || fallbackUsername).trim().toLowerCase(),
      },
    });

    if (authError) throw authError;

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Profile and Wallet initialized.',
      user: authData.user,
    });
  } catch (error) {
    console.error('Signup Error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { signUp };
