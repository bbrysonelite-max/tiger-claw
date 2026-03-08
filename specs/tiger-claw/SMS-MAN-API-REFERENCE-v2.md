# SMS-MAN API Reference for Tiger Claw v2

**Purpose:** Acquire 50 phone numbers via API to create 50 Telegram accounts, then spawn 1,000 bot tokens (20 per account).

---

## The Math

| Item | Count | Notes |
|------|-------|-------|
| Bot tokens needed | 1,000 | Tiger Claw requirement |
| Bots per Telegram account | 20 | BotFather hard limit |
| Telegram accounts needed | 50 | 1,000 / 20 = 50 |
| Phone numbers needed | 50 | 1 per account |
| Estimated SMS-MAN cost | $6 - $60 | Depends on country selection |

---

## Step 0: Get Your API Key

Go to [sms-man.com](https://sms-man.com), create an account, and fund it. Your API key is on your profile page. Minimum deposit is around $2. For 50 cheap numbers, deposit $15-$20 to be safe.

---

## API v2.0 — Complete Endpoint Reference

**Base URL:** `https://api.sms-man.com/control/`

Every request requires the `token` parameter (your API key). Supports both GET and POST. All responses are JSON.

---

### 1. Check Balance

```
GET https://api.sms-man.com/control/get-balance?token=YOUR_API_KEY
```

**Response:**
```json
{"balance": "799.70"}
```

**Error:**
```json
{"success": false, "error_code": "wrong_token", "error_msg": "Wrong token!"}
```

---

### 2. List All Countries

```
GET https://api.sms-man.com/control/countries?token=YOUR_API_KEY
```

**Response:**
```json
[{"id": 0, "title": "Russia"}, {"id": 3, "title": "China"}, ...]
```

Key country IDs you care about (cheapest for Telegram):

| country_id | Country | Typical Telegram Price |
|------------|---------|----------------------|
| 0 | Russia | $0.06 - $0.15 |
| 4 | Indonesia | $0.10 - $0.20 |
| 6 | India | $0.05 - $0.15 |
| 15 | Colombia | $0.10 - $0.20 |
| 16 | Kenya | $0.08 - $0.15 |
| 1 | Ukraine | $0.10 - $0.20 |
| 12 | England | $0.50 - $1.50 |
| 187 | USA | $1.00 - $3.00 |

---

### 3. List All Services

```
GET https://api.sms-man.com/control/applications?token=YOUR_API_KEY
```

**Response:**
```json
[
  {"id": "1", "name": "Vkontakte", "code": "vk"},
  {"id": "2", "name": "WeChat", "code": "wb"},
  {"id": "3", "name": "Telegram", "code": "tg"}
]
```

**Telegram's application_id is `3` (code: `tg`).** This is the only value you need.

---

### 4. Check Availability and Pricing

```
GET https://api.sms-man.com/control/limits?token=YOUR_API_KEY&country_id=4&application_id=3
```

**Response:**
```json
[{"application_id": "3", "country_id": "4", "numbers": "32302"}]
```

The `numbers` field tells you how many Telegram numbers are currently in stock for that country.

To get pricing:

```
GET https://api.sms-man.com/control/get-prices?token=YOUR_API_KEY&country_id=4
```

**Response:**
```json
{"4": {"3": {"cost": "0.15", "count": 32302}}}
```

The structure is `{country_id: {application_id: {cost, count}}}`. So this says Indonesia has 32,302 Telegram numbers at $0.15 each.

---

### 5. Buy a Phone Number (THE CORE CALL)

```
GET https://api.sms-man.com/control/get-number?token=YOUR_API_KEY&country_id=4&application_id=3
```

| Parameter | Type | Required | Value |
|-----------|------|----------|-------|
| token | String | Yes | Your API key |
| country_id | Integer | Yes | Country ID (use 0 for random) |
| application_id | Integer | Yes | 3 (Telegram) |
| currency | String | No | RUB / USD / EUR |
| ref | String | No | Referral ID |
| hasMultipleSms | String | No | True / False |

**Response:**
```json
{"request_id": 1, "country_id": 4, "application_id": 3, "number": "6281234567890"}
```

You now have a phone number. The `request_id` is your handle for everything that follows. The `number` is what you type into Telegram's registration screen.

---

### 6. Retrieve the SMS Code (POLL THIS)

```
GET https://api.sms-man.com/control/get-sms?token=YOUR_API_KEY&request_id=1
```

**Success response (code received):**
```json
{
  "request_id": 1,
  "country_id": 4,
  "application_id": 3,
  "number": "6281234567890",
  "sms_code": "54821"
}
```

**Waiting response (code not yet received):**
```json
{
  "request_id": 1,
  "country_id": 4,
  "application_id": 3,
  "number": "6281234567890",
  "error_code": "wait_sms",
  "error_msg": "Still waiting..."
}
```

**You must poll this endpoint.** Typical wait is 10-120 seconds. Poll every 5 seconds. If no code after 3 minutes, the number is dead — reject it and buy another.

---

### 7. Set Status (Close/Reject the Number)

```
GET https://api.sms-man.com/control/set-status?token=YOUR_API_KEY&request_id=1&status=close
```

| Status Value | Meaning |
|-------------|---------|
| `ready` | Confirm number is ready (optional) |
| `close` | Mark as successfully used, close activation |
| `reject` | Number didn't work, request refund |
| `used` | Number was already used elsewhere |

**Response:**
```json
{"request_id": 1, "success": true}
```

**Always call `reject` if the SMS never arrives** — you get your money back. Always call `close` after successful verification — this is good citizenship and keeps your account in good standing.

---

## The Full Workflow (One Number)

```
1. GET /get-balance          → Confirm you have funds
2. GET /get-prices           → Find cheapest country with stock
3. GET /get-number           → Buy number, get request_id + number
4. [Enter number in Telegram registration]
5. GET /get-sms (poll)       → Wait for verification code
6. [Enter code in Telegram]
7. GET /set-status?status=close  → Mark complete
```

If step 5 times out after 3 minutes:
```
7. GET /set-status?status=reject  → Get refund, go back to step 3
```

---

## Compatible API (SMS-Activate Format)

If you have existing tools built for SMS-Activate, SMS-MAN offers a drop-in compatible API. Just change the base URL.

**Base URL:** `https://api.sms-man.com/stubs/handler_api.php`

The key difference is the parameter naming and response format:

| Action | Compatible API | API v2.0 |
|--------|---------------|----------|
| Auth param | `api_key` | `token` |
| Service param | `service=tg` (string code) | `application_id=3` (integer) |
| Get number response | `ACCESS_NUMBER:$id:$number` | JSON object |
| Get status response | `STATUS_OK:$code` | JSON with `sms_code` field |
| Cancel status | `setStatus&status=-1` | `set-status&status=reject` |
| Complete status | `setStatus&status=6` | `set-status&status=close` |

The v2.0 API is cleaner and recommended for new code. Use the Compatible API only if you are migrating existing SMS-Activate scripts.

---

## References

- SMS-MAN API v2.0 Docs: https://sms-man.com/api
- SMS-MAN Compatible API Docs: https://sms-man.com/api/compatible
- SMS-MAN Registration: https://sms-man.com
