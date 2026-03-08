#!/usr/bin/env python3
"""
SMS-MAN Number Buyer — Tiger Claw v2
Acquires phone numbers via SMS-MAN API and polls for Telegram verification codes.
Outputs a CSV of verified numbers ready for Telegram account creation.

Usage:
    export SMSMAN_API_KEY="your_api_key_here"
    python3 smsman_number_buyer.py --count 50 --country 4

Country IDs (cheapest for Telegram):
    0=Russia, 4=Indonesia, 6=India, 15=Colombia, 16=Kenya
    1=Ukraine, 12=England, 187=USA
"""

import os, sys, time, json, csv, argparse, logging
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency. Run: pip3 install requests")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "https://api.sms-man.com/control"
TELEGRAM_APP_ID = 3
POLL_INTERVAL = 5       # seconds between SMS checks
POLL_TIMEOUT = 180      # seconds before giving up on a number
RETRY_DELAY = 2         # seconds between API retries on transient errors
MAX_RETRIES = 3         # retries per API call on transient failure

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smsman")

# ---------------------------------------------------------------------------
# API Client
# ---------------------------------------------------------------------------
class SmsManClient:
    def __init__(self, token: str):
        self.token = token
        self.session = requests.Session()
        self.session.params = {"token": token}

    def _get(self, endpoint: str, params: dict = None) -> dict:
        url = f"{BASE_URL}/{endpoint}"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = self.session.get(url, params=params or {}, timeout=15)
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and data.get("success") is False:
                    raise ApiError(data.get("error_code", "unknown"), data.get("error_msg", ""))
                return data
            except requests.exceptions.RequestException as e:
                if attempt == MAX_RETRIES:
                    raise
                log.warning(f"Request failed (attempt {attempt}): {e}. Retrying...")
                time.sleep(RETRY_DELAY)

    def get_balance(self) -> float:
        data = self._get("get-balance")
        return float(data["balance"])

    def get_prices(self, country_id: int) -> dict:
        return self._get("get-prices", {"country_id": country_id})

    def get_limits(self, country_id: int) -> int:
        data = self._get("limits", {"country_id": country_id, "application_id": TELEGRAM_APP_ID})
        if isinstance(data, list) and data:
            return int(data[0].get("numbers", 0))
        return 0

    def buy_number(self, country_id: int) -> dict:
        return self._get("get-number", {"country_id": country_id, "application_id": TELEGRAM_APP_ID})

    def get_sms(self, request_id: int) -> dict:
        return self._get("get-sms", {"request_id": request_id})

    def set_status(self, request_id: int, status: str) -> dict:
        return self._get("set-status", {"request_id": request_id, "status": status})


class ApiError(Exception):
    def __init__(self, code: str, msg: str):
        self.code = code
        super().__init__(f"[{code}] {msg}")

# ---------------------------------------------------------------------------
# Core Logic
# ---------------------------------------------------------------------------
def poll_for_code(client: SmsManClient, request_id: int, number: str) -> str | None:
    """Poll get-sms until code arrives or timeout. Returns code or None."""
    start = time.time()
    while time.time() - start < POLL_TIMEOUT:
        try:
            data = client.get_sms(request_id)
            code = data.get("sms_code")
            if code:
                return str(code)
        except ApiError as e:
            if e.code != "wait_sms":
                log.error(f"  Unexpected error polling {number}: {e}")
                return None
        time.sleep(POLL_INTERVAL)
    return None


def acquire_numbers(client: SmsManClient, count: int, country_id: int, output_path: Path):
    """Buy `count` numbers, poll for SMS codes, write results to CSV."""

    # Pre-flight checks
    balance = client.get_balance()
    log.info(f"Account balance: ${balance:.2f}")

    stock = client.get_limits(country_id)
    log.info(f"Telegram numbers in stock (country {country_id}): {stock}")
    if stock < count:
        log.warning(f"Only {stock} numbers available. You requested {count}. Will buy what's available.")
        count = min(count, stock)

    if count == 0:
        log.error("No numbers available. Try a different country_id.")
        return

    # Results tracking
    results = []
    success = 0
    failed = 0

    for i in range(1, count + 1):
        log.info(f"--- Number {i}/{count} ---")

        # Buy
        try:
            purchase = client.buy_number(country_id)
        except (ApiError, Exception) as e:
            log.error(f"  Failed to buy number: {e}")
            failed += 1
            time.sleep(RETRY_DELAY)
            continue

        request_id = purchase["request_id"]
        number = purchase["number"]
        log.info(f"  Purchased: +{number} (request_id={request_id})")
        log.info(f"  >>> ENTER THIS NUMBER IN TELEGRAM NOW: +{number}")
        log.info(f"  Waiting for SMS code (up to {POLL_TIMEOUT}s)...")

        # Poll for code
        code = poll_for_code(client, request_id, number)

        if code:
            log.info(f"  CODE RECEIVED: {code}")
            client.set_status(request_id, "close")
            results.append({
                "number": f"+{number}",
                "code": code,
                "request_id": request_id,
                "status": "verified",
                "timestamp": datetime.now().isoformat(),
            })
            success += 1
        else:
            log.warning(f"  TIMEOUT — no code received for +{number}. Rejecting for refund.")
            try:
                client.set_status(request_id, "reject")
            except Exception:
                pass
            results.append({
                "number": f"+{number}",
                "code": "",
                "request_id": request_id,
                "status": "failed",
                "timestamp": datetime.now().isoformat(),
            })
            failed += 1

        # Brief pause between purchases to avoid rate limiting
        if i < count:
            time.sleep(1)

    # Write CSV
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["number", "code", "request_id", "status", "timestamp"])
        writer.writeheader()
        writer.writerows(results)

    log.info(f"\n{'='*50}")
    log.info(f"DONE. Success: {success} | Failed: {failed} | Total: {success + failed}")
    log.info(f"Results saved to: {output_path}")
    log.info(f"Remaining balance: ${client.get_balance():.2f}")

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="SMS-MAN Telegram Number Buyer")
    parser.add_argument("--count", type=int, default=50, help="Number of phone numbers to acquire (default: 50)")
    parser.add_argument("--country", type=int, default=4, help="Country ID (default: 4=Indonesia). Use 0 for random.")
    parser.add_argument("--output", type=str, default="numbers.csv", help="Output CSV path (default: numbers.csv)")
    parser.add_argument("--check-only", action="store_true", help="Only check balance and stock, don't buy")
    args = parser.parse_args()

    token = os.environ.get("SMSMAN_API_KEY")
    if not token:
        sys.exit("ERROR: Set SMSMAN_API_KEY environment variable.\n  export SMSMAN_API_KEY=\"your_key_here\"")

    client = SmsManClient(token)

    if args.check_only:
        balance = client.get_balance()
        stock = client.get_limits(args.country)
        print(f"Balance: ${balance:.2f}")
        print(f"Telegram stock (country {args.country}): {stock} numbers")
        return

    acquire_numbers(client, args.count, args.country, Path(args.output))


if __name__ == "__main__":
    main()
