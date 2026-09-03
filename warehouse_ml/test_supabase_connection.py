"""
test_supabase_connection.py
--------------------------------------------------------------------------
Standalone test -- ini-isolate natin kung ang PYTHON supabase client
mismo (hindi ang buong api_server.py) ay kayang kumonekta sa Supabase.

Run: python test_supabase_connection.py
"""
import os
import time
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

print(f"SUPABASE_URL: {url}")
print(f"SUPABASE_KEY: {key[:15]}..." if key else "SUPABASE_KEY: WALA/EMPTY")
print()

if not url or not key:
    print("❌ Walang SUPABASE_URL o SUPABASE_KEY sa .env -- ayusin muna ito.")
    exit(1)

print("Sinusubukan kumonekta... (may 10s timeout, hihintayin natin)")
start = time.time()

try:
    from supabase import create_client
    sb = create_client(url, key)
    resp = sb.table("medicines").select("generic_name").limit(1).execute()
    elapsed = time.time() - start
    print(f"✅ SUCCESS pagkatapos ng {elapsed:.2f}s")
    print(f"Sample data: {resp.data}")
except Exception as e:
    elapsed = time.time() - start
    print(f"❌ FAILED pagkatapos ng {elapsed:.2f}s")
    print(f"Error type: {type(e).__name__}")
    print(f"Error message: {e}")