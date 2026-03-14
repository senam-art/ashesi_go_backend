import asyncio  # <--- This was the missing piece!
import math
from supabase import create_async_client, AsyncClient

# 1. Setup Connection
# Use the details from your Supabase Project Settings > API
URL = "https://gllwtrtbjkercgnuqyjp.supabase.co" 
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsbHd0cnRiamtlcmNnbnVxeWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTE3NzYsImV4cCI6MjA4NzUyNzc3Nn0.gURz0rj5nZyijdzbnv0VfClGTkbFz4BedIS3IqVRU5M"

async def run_dummy_driver():
    # Initialize the ASYNC client
    supabase: AsyncClient = await create_async_client(URL, KEY)
    
    # 2. Define the Channel
    topic = 'journey_bus-402-demo'
    channel = supabase.channel(topic)
    
    # Subscribe to the channel
    await channel.subscribe()

    # 3. Dummy Route Logic
    start_lat = 5.7596
    start_lng = -0.2197
    angle = 0

    print(f"🚀 Async Driver started on channel: {topic}")
    print("📡 Broadcasting live coordinates... Press Ctrl+C to stop.")

    try:
        while True:
            lat = start_lat + (0.001 * math.cos(angle))
            lng = start_lng + (0.001 * math.sin(angle))
            heading = (angle * 180 / math.pi) % 360
            
            # POSITIONAL ARGUMENTS: event first, then the data dict
            await channel.send_broadcast(
                "location_update",
                {
                    "lat": lat,
                    "lng": lng,
                    "heading": heading
                }
            )
            
            print(f"📡 Sending: Lat {lat:.5f}, Lng {lng:.5f}, Heading {heading:.1f}")
            
            angle += 0.1
            await asyncio.sleep(2) 
            
    except asyncio.CancelledError:
        print("\n🛑 Shutting down...")
    finally:
        await channel.unsubscribe()

if __name__ == "__main__":
    try:
        asyncio.run(run_dummy_driver())
    except KeyboardInterrupt:
        print("\n🛑 Simulation ended by user.")