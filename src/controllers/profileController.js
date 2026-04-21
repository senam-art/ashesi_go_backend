const { supabaseAdmin } = require('../config/supabase');

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// ---------------------------------------------------------------------------
// GET /api/profile/username/available?u=<name>
// ---------------------------------------------------------------------------
const checkUsernameAvailable = async (req, res) => {
  const u = (req.query.u || '').trim().toLowerCase();
  if (!u) return res.status(400).json({ available: false, reason: 'empty' });
  if (!USERNAME_RE.test(u)) {
    return res.status(200).json({ available: false, reason: 'format' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', u)
      .maybeSingle();

    if (error) throw error;
    return res.status(200).json({ available: !data });
  } catch (err) {
    console.error('Username availability error:', err.message);
    return res.status(500).json({ available: false, reason: 'server_error' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/profile/username  { userId, username }
// ---------------------------------------------------------------------------
const updateUsername = async (req, res) => {
  const { userId, username } = req.body;
  const u = (username || '').trim().toLowerCase();

  if (!userId || !u) {
    return res.status(400).json({ success: false, message: 'userId and username required' });
  }
  if (!USERNAME_RE.test(u)) {
    return res.status(400).json({ success: false, message: 'Invalid username format' });
  }

  try {
    // Availability re-check (cheap).
    const { data: taken } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', u)
      .neq('id', userId)
      .maybeSingle();

    if (taken) {
      return res.status(409).json({ success: false, message: 'Username already taken' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ username: u, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, username')
      .single();

    if (error) throw error;
    return res.status(200).json({ success: true, username: data.username });
  } catch (err) {
    console.error('Username update error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/profile/lookup/:username  (for friend-pay autocomplete)
// ---------------------------------------------------------------------------
const lookupByUsername = async (req, res) => {
  const u = (req.params.username || '').trim().toLowerCase();
  if (!u) return res.status(400).json({ found: false });

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, first_name, last_name, profile_image_url, role')
      .eq('username', u)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ found: false });

    return res.status(200).json({
      found: true,
      profile: {
        id: data.id,
        username: data.username,
        full_name: `${data.first_name} ${data.last_name}`.trim(),
        profile_image_url: data.profile_image_url,
        role: data.role,
      },
    });
  } catch (err) {
    console.error('Lookup username error:', err.message);
    return res.status(500).json({ found: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/profile/:userId  (full profile with wallet)
// ---------------------------------------------------------------------------
const getProfile = async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select(
        'id, first_name, last_name, username, phone_number, role, total_rides, wallet_balance, profile_image_url, updated_at'
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Profile not found' });

    return res.status(200).json({ success: true, profile: data });
  } catch (err) {
    console.error('Get profile error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  checkUsernameAvailable,
  updateUsername,
  lookupByUsername,
  getProfile,
};
