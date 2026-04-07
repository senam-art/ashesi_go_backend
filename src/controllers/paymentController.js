
const axios = require('axios');
// 1. IMPORTANT: Destructure { supabaseAdmin } from the config object
const { supabaseAdmin } = require('../config/supabase');

const initializePayment = async (req, res) => {
  const { email, amount, userId, phoneNumber } = req.body;

  // Paystack expects amount in Pesewas (GHS 1.00 = 100 Pesewas)
  const amountInPesewas = Math.round(parseFloat(amount) * 100);

  try {
    // 2. Initialize Transaction with Paystack
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: email,
        amount: amountInPesewas,
        callback_url: "https://ashesigo.com/payment-complete",
        metadata: {
          user_id: userId,
          phone_number: phoneNumber,
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: "Ashesi Go Top-up" }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url, reference } = response.data.data;

    // 3. LOGGING: Verify the userId is present before insertion
    console.log(`Recording pending transaction for UUID: ${userId}`);

    // 4. DATABASE INSERT: Using the Admin client to bypass RLS
    const { data, error: dbError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        amount: amount,
        type: 'top-up',
        status: 'pending',
        reference: reference,
        description: `Wallet top-up via MoMo (${phoneNumber})`
      })
      .select(); // Added select() to return the created record for logging

    if (dbError) {
      console.error("❌ Supabase Error:", dbError.message);
      // We don't stop the flow (res.send) here because the user can still pay, 
      // but we need to know why the log failed.
    } else {
      console.log("✅ Pending transaction saved successfully:", data[0].id);
    }

    // 5. SUCCESS: Send the Paystack URL back to Flutter
    res.status(200).json({ success: true, url: authorization_url, reference: reference });

  } catch (error) {
    // Capture Paystack errors specifically
    const paystackMsg = error.response?.data?.message || error.message;
    console.error("❌ Initialization Error:", paystackMsg);
    
    res.status(500).json({ 
      success: false, 
      message: "Payment initialization failed",
      error: paystackMsg 
    });
  }
};



// --- GET BALANCE ---
const getBalance = async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    res.status(200).json({ balance: data.balance });
  } catch (error) {
    console.error("Balance Fetch Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET TRANSACTIONS ---
const getTransactions = async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error("Transaction Fetch Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};


//Verify payment

const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
    // 1. Ask Paystack: "Is this reference actually paid?"
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        }
      }
    );

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      // 2. If Paystack says yes, update Supabase to 'success'
      // THIS WILL FIRE YOUR TRIGGER AND ADD THE MONEY
      const { error } = await supabaseAdmin
        .from('transactions')
        .update({ status: 'success' })
        .eq('reference', reference);

      if (error) throw error;

      return res.status(200).json({ success: true, message: "Balance updated!" });
    } else {
      return res.status(400).json({ success: false, message: "Payment not confirmed yet." });
    }

  } catch (error) {
    console.error("Verification Error:", error.message);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
};



module.exports = { initializePayment, getBalance, getTransactions,verifyPayment };