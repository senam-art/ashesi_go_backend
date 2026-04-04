const supabase = require('../config/supabase');

const getBalance = async (req, res) => {
     const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }
    
    try {
        // 1. Fetch from Supabase
    const { data, error } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    // 2. Send clean JSON back to the Flutter app
    res.status(200).json({ 
      success: true,
      balance: data.balance 
    });
       
    } catch (error) {
        res.status(500).json({ error: err.message });
        
    }
}