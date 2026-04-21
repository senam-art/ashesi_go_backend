const { supabaseAdmin } = require('../config/supabase');

// ---------------------------------------------------------------------------
// CRUD for public.payment_methods.
//
// Cards are only ever inserted by the server after a successful Paystack
// verification (see paymentController.verifyPayment), so the create endpoint
// here intentionally only accepts momo entries from clients.
// ---------------------------------------------------------------------------

const TYPES = new Set(['card', 'momo']);
const NETWORKS = new Set(['MTN', 'VOD', 'ATL']); // Paystack MoMo codes

function sanitizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits;
}

async function listMethods(req, res) {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) {
    console.error('payment_methods list error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function createMethod(req, res) {
  const { userId, type, label, phoneNumber, network, makeDefault } = req.body || {};

  if (!userId || !TYPES.has(type)) {
    return res.status(400).json({ success: false, message: 'userId and valid type required' });
  }
  if (type === 'card') {
    return res.status(400).json({
      success: false,
      message: 'Cards are saved automatically after a successful top-up.',
    });
  }

  const phone = sanitizePhone(phoneNumber);
  const net = (network || '').toUpperCase();
  if (!phone || !NETWORKS.has(net)) {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber and network (MTN|VOD|ATL) required for momo.',
    });
  }

  try {
    // Insert ignoring duplicates; the unique index will reject dupes.
    const row = {
      user_id: userId,
      type: 'momo',
      label: (label || `MoMo ${phone.slice(-4)}`).slice(0, 60),
      phone_number: phone,
      network: net,
      is_default: false,
    };

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('payment_methods')
      .insert(row)
      .select()
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'That mobile money number is already saved.',
        });
      }
      throw insErr;
    }

    if (makeDefault === true) {
      await setDefault(userId, inserted.id);
    }

    return res.status(201).json({ success: true, data: inserted });
  } catch (error) {
    console.error('payment_methods create error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function updateMethod(req, res) {
  const { id } = req.params;
  const { userId, label, makeDefault } = req.body || {};

  if (!userId || !id) {
    return res.status(400).json({ success: false, message: 'id and userId required' });
  }

  try {
    const patch = {};
    if (typeof label === 'string') patch.label = label.slice(0, 60);

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('payment_methods')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId);
      if (upErr) throw upErr;
    }

    if (makeDefault === true) {
      await setDefault(userId, id);
    }

    const { data, error: selErr } = await supabaseAdmin
      .from('payment_methods')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!data) return res.status(404).json({ success: false, message: 'Not found' });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('payment_methods update error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteMethod(req, res) {
  const { id } = req.params;
  const { userId } = req.query;

  if (!userId || !id) {
    return res.status(400).json({ success: false, message: 'id and userId required' });
  }

  try {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('payment_methods')
      .select('id, is_default')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const { error: delErr } = await supabaseAdmin
      .from('payment_methods')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (delErr) throw delErr;

    // If we deleted the default, promote the most recent remaining row.
    if (existing.is_default) {
      const { data: next } = await supabaseAdmin
        .from('payment_methods')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (next) await setDefault(userId, next.id);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('payment_methods delete error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function setDefault(userId, id) {
  // Clear existing default, then set the new one. Doing this in two statements
  // is fine because the unique index is ON is_default=true and both writes run
  // under the service role.
  const { error: clearErr } = await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true);
  if (clearErr) throw clearErr;

  const { error: setErr } = await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: true })
    .eq('user_id', userId)
    .eq('id', id);
  if (setErr) throw setErr;
}

/**
 * Upsert a saved card when Paystack returns a reusable authorization.
 * Intentionally forgiving — called from verifyPayment, and must never throw
 * so a successful top-up is never blocked by a storage quirk.
 */
async function upsertCardFromAuthorization(userId, authorization) {
  if (!userId || !authorization?.authorization_code) return;
  if (authorization.reusable === false) return;

  try {
    const last4 = authorization.last4 || '****';
    const brand = authorization.card_type || 'card';
    const row = {
      user_id: userId,
      type: 'card',
      label: `${brand.toUpperCase()} •••• ${last4}`,
      last4,
      brand: brand.toLowerCase(),
      bank: authorization.bank || null,
      exp_month: authorization.exp_month || null,
      exp_year: authorization.exp_year || null,
      authorization_code: authorization.authorization_code,
    };

    await supabaseAdmin
      .from('payment_methods')
      .upsert(row, { onConflict: 'user_id,authorization_code' });
  } catch (err) {
    console.warn('upsertCardFromAuthorization skipped:', err.message);
  }
}

module.exports = {
  listMethods,
  createMethod,
  updateMethod,
  deleteMethod,
  upsertCardFromAuthorization,
};
