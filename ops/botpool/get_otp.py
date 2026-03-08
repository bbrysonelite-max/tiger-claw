#!/usr/bin/env python3
"""
SMS-MAN OTP Poller — Tiger Claw
Usage: python3 get_otp.py +62XXXXXXXXXX

Looks up the request_id for the given phone number from sms_numbers.json,
then polls SMS-MAN until the OTP arrives (up to 3 minutes).
Run this in a second terminal when create-bot-pool asks for a verification code.
"""
import os, sys, time, json, warnings
from pathlib import Path
warnings.filterwarnings("ignore")

try:
    import requests
except ImportError:
    sys.exit("Missing dependency. Run: pip3 install requests")

BASE_URL = "https://api.sms-man.com/control"
NUMBERS_FILE = Path(__file__).parent / "sms_numbers.json"
POLL_INTERVAL = 4
POLL_TIMEOUT = 180

def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 get_otp.py +62XXXXXXXXXX")

    phone = sys.argv[1].strip()
    token = os.environ.get("SMSMAN_API_KEY", "1MnU16axIhaoYB354wnZZ7ouRx3Cy9Lv")

    if not NUMBERS_FILE.exists():
        sys.exit(f"sms_numbers.json not found at {NUMBERS_FILE}")

    numbers = json.loads(NUMBERS_FILE.read_text())
    entry = next((n for n in numbers if n["phone"] == phone), None)
    if not entry:
        sys.exit(f"Phone {phone} not found in sms_numbers.json\nKnown: {[n['phone'] for n in numbers]}")

    request_id = entry["request_id"]
    print(f"Polling for OTP — phone={phone} request_id={request_id} (timeout={POLL_TIMEOUT}s)...")

    start = time.time()
    while time.time() - start < POLL_TIMEOUT:
        try:
            r = requests.get(f"{BASE_URL}/get-sms",
                             params={"token": token, "request_id": request_id},
                             timeout=10)
            data = r.json()
            code = data.get("sms_code")
            if code:
                print(f"\n>>> OTP for {phone}: {code} <<<\n")
                # Mark as used
                requests.get(f"{BASE_URL}/set-status",
                             params={"token": token, "request_id": request_id, "status": "close"},
                             timeout=10)
                return
            err = data.get("error_code", "")
            if err != "wait_sms":
                print(f"Unexpected error: {data}")
                return
        except Exception as e:
            print(f"Poll error: {e}")
        time.sleep(POLL_INTERVAL)

    print(f"TIMEOUT — no OTP received for {phone} within {POLL_TIMEOUT}s")

if __name__ == "__main__":
    main()
