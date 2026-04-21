const { supabaseAdmin } = require('../config/supabase');
const { httpJson } = require('../utils/http');

const PAYSTACK_BASE = 'https://api.paystack.co';

// Paystack statuses we treat as terminal in the DB.
const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned', 'reversed']);

// --- INITIALIZE PAYMENT ---------------------------------------------------
const initializePayment = async (req, res) => {
  const { email, amount, userId, phoneNumber } = req.body;
  const amountInPesewas = Math.round(parseFloat(amount) * 100);

  try {
    const paystack = await httpJson(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      body: {
        email,
        amount: amountInPesewas,
        callback_url: 'https://ashesigo.com/payment-complete',
        metadata: {
          user_id: userId,
          phone_number: phoneNumber,
          custom_fields: [
            { display_name: 'Service', variable_name: 'service', value: 'Ashesi Go Top-up' },
          ],
        },
      },
    });

    const { authorization_url, reference } = paystack.data;

    const { error: dbError } = await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      amount,
      type: 'top-up',
      status: 'pending',
      reference,
      description: `Wallet top-up via MoMo (${phoneNumber})`,
    });

    if (dbError) {
      console.error('Transactions insert error:', dbError.message);
    }

    return res.status(200).json({ success: true, url: authorization_url, reference });
  } catch (error) {
    const msg = error.body?.message || error.message;
    console.error('Paystack initialize error:', msg);
    return res.status(500).json({ success: false, message: 'Payment initialization failed', error: msg });
  }
};

// --- VERIFY PAYMENT (verify-only, idempotent) -----------------------------
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
    // 1. Lookup local record.
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('transactions')
      .select('id, user_id, status, amount, metadata')
      .eq('reference', reference)
      .maybeSingle();

    if (selErr) throw selErr;
    if (!existing) {
      return res.status(404).json({ success: false, status: 'not_found' });
    }

    // 2. Idempotency: if we've already credited this transaction, short-circuit.
    if (existing.status === 'success') {
      return res.status(200).json({
        success: true,
        status: 'success',
        alreadyCredited: true,
      });
    }

    // 3. Ask Paystack.
    const paystack = await httpJson(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const tx = paystack?.data;
    if (!tx) {
      return res.status(502).json({ success: false, status: 'unknown', message: 'Empty Paystack response' });
    }

    const next = tx.status; // one of: abandoned, failed, ongoing, pending, processing, queued, reversed, success

    // 4. Metadata patch — always record gateway_response; if card, store auth_code.
    const metaPatch = {
      channel: tx.channel,
      gateway_response: tx.gateway_response,
      authorization:
        tx.authorization && tx.authorization.channel === 'card'
          ? {
              authorization_code: tx.authorization.authorization_code,
              last4: tx.authorization.last4,
              bank: tx.authorization.bank,
              card_type: tx.authorization.card_type,
              reusable: tx.authorization.reusable,
            }
          : null,
    };

    // 5. Persist. The DB trigger on_transaction_success fires the wallet credit
    //    only when status transitions from non-success into success.
    const update = {
      status: next,
      metadata: { ...(existing.metadata || {}), ...metaPatch },
    };
    if (next === 'success') update.verified_at = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
      .from('transactions')
      .update(update)
      .eq('reference', reference);

    if (upErr) throw upErr;

    return res.status(200).json({
      success: next === 'success',
      status: next,
      terminal: TERMINAL_STATUSES.has(next),
      gateway_response: tx.gateway_response,
    });
  } catch (error) {
    console.error('Verification error:', error.body?.message || error.message);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Verification failed',
    });
  }
};

// --- GET BALANCE ----------------------------------------------------------
const getBalance = async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return res.status(200).json({ balance: data.balance });
  } catch (error) {
    console.error('Balance fetch error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET TRANSACTIONS -----------------------------------------------------
const getTransactions = async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) {
    console.error('Transactions fetch error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { initializePayment, getBalance, getTransactions, verifyPayment };
