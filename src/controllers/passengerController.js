const supabase = require('../config/supabase');

const { supabaseAdmin } = require('../config/supabase');


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
        res.status(500).json({ error: error.message });
        
    }
}






const processBoarding = async (req, res) => {
  const { vehicleId, passengerId } = req.body;

  try {
    // DEBUG: Log what we are looking for
    console.log(`Searching for active journey. Bus: ${vehicleId}, Status: ONGOING`);

    // 1. Resolve: Find the ONGOING journey for this specific Bus
    const { data: journey, error: jError } = await supabaseAdmin
      .from('active_journeys')
      .select(`
        act_jou_id, 
        route_id,
        routes (
          route_name, 
          fare
        )
      `)
      .eq('vehicle_id', vehicleId)
      .eq('status', 'ONGOING') 
      .single();

    // If jError exists, log it to the console so you can see exactly what Supabase says
    if (jError || !journey) {
      console.error("Supabase Query Error:", jError);
      return res.status(404).json({ 
        success: false, 
        message: "This bus is not currently on an active journey." 
      });
    }

    // FIX: Using 'route_name' and the correct 'act_jou_id'
    const fare = journey.routes.fare;
    const routeDisplayName = journey.routes.route_name;

    // 2. Execute Transaction
    const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('handle_boarding_transaction', {
    p_passenger_id: passengerId,
    p_journey_id: journey.act_jou_id,
    p_fare: fare
    });

    if (rpcError) {
  if (rpcError.message.includes('Overdraft')) {
    return res.status(402).json({ 
      success: false, 
      message: "Overdraft limit reached (GHS 50). Please top up to ride again." 
    });
  }
  throw rpcError;
}
        /// 3. Logic for the Debt Warning
    let warning = null;
    if (newBalance < 0) {
    warning = `Warning: Your balance is GHS ${newBalance.toFixed(2)}. Please top up your wallet soon! ⚠️`;
    }

    // 4. Success Response
    res.status(200).json({
    success: true,
        message: `Boarded: ${routeDisplayName}
    `,
    warning: warning, // This will be null if they have money, or a string if they don't
    details: {
        fare_deducted: fare,
        remaining_balance: newBalance,
        journey_id: journey.act_jou_id
    }
});
      
  } catch (error) {
    console.error("Boarding Error:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "An internal error occurred during boarding." 
    });
  }

};
module.exports = { getBalance, processBoarding  };