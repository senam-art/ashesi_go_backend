import asyncio  # <--- This was the missing piece!
import math
import time
from supabase import create_async_client, AsyncClient

# 1. Setup Connection
# Use the details from your Supabase Project Settings > API
URL = "https://gllwtrtbjkercgnuqyjp.supabase.co" 
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsbHd0cnRiamtlcmNnbnVxeWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTE3NzYsImV4cCI6MjA4NzUyNzc3Nn0.gURz0rj5nZyijdzbnv0VfClGTkbFz4BedIS3IqVRU5M"
JOURNEY_ID = "bus-402-demo"

# Berekuso Waypoints
BEREKUSO_PATH = [
    (5.7596, -0.2197), (5.7580, -0.2185), (5.7555, -0.2160),
    (5.7520, -0.2130), (5.7490, -0.2100), (5.7450, -0.2070),
]

def calculate_heading(p1, p2):
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    d_lon = lon2 - lon1
    y = math.sin(d_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

async def run_journey():
    # Use the ASYNC client
    supabase: AsyncClient = await create_async_client(URL, KEY)
    channel = supabase.channel(f'journey_{JOURNEY_ID}')
    
    await channel.subscribe()
    print(f"🚀 Async Bus {JOURNEY_ID} is online...")
    await asyncio.sleep(2)

    full_route = BEREKUSO_PATH + BEREKUSO_PATH[::-1]

    while True:
        for i in range(len(full_route) - 1):
            start_node = full_route[i]
            end_node = full_route[i+1]
            heading = calculate_heading(start_node, end_node)
            
            steps = 8 # Smoother movement
            for step in range(steps):
                curr_lat = start_node[0] + (end_node[0] - start_node[0]) * (step / steps)
                curr_lng = start_node[1] + (end_node[1] - start_node[1]) * (step / steps)

                # Broadcast must be awaited in async
                await channel.send_broadcast(
                    "location_update", # First argument: The Event
                    {                  # Second argument: The Data (Dictionary)
                        'lat': curr_lat, 
                        'lng': curr_lng, 
                        'heading': heading
                    }
                )
                print(f"📡 {JOURNEY_ID}: {curr_lat:.5f}, {curr_lng:.5f}")
                await asyncio.sleep(1.2) # Adjusted for the 1500ms Flutter animation

if __name__ == "__main__":
    try:
        asyncio.run(run_journey())
    except KeyboardInterrupt:
        print("\nBus parked.")