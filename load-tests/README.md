# VoltSafe Growth OS — Load Tests

k6-based load tests for validating system performance at 100 concurrent active users.

## Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Linux
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (Chocolatey)
choco install k6
```

## Configuration

Set the target base URL before running:

```bash
export BASE_URL=https://your-app.replit.app
# or for local dev:
export BASE_URL=http://localhost:5000
```

You also need a valid session cookie from a logged-in admin user. Open DevTools →
Application → Cookies, copy the `connect.sid` value:

```bash
export SESSION_COOKIE="connect.sid=s%3A..."
```

## Running Tests

### Smoke test (5 users, 2 minutes) — run before every deploy

```bash
k6 run -e BASE_URL=$BASE_URL -e SESSION_COOKIE="$SESSION_COOKIE" load-tests/smoke.js
```

### Normal team load (25 concurrent users, 10 minutes)

```bash
k6 run -e BASE_URL=$BASE_URL -e SESSION_COOKIE="$SESSION_COOKIE" load-tests/normal-load.js
```

### Scale target (100 concurrent users, 10 minutes)

```bash
k6 run -e BASE_URL=$BASE_URL -e SESSION_COOKIE="$SESSION_COOKIE" load-tests/scale-target.js
```

### Spike test (0 → 100 users in 60 s, 3-minute hold)

```bash
k6 run -e BASE_URL=$BASE_URL -e SESSION_COOKIE="$SESSION_COOKIE" load-tests/spike.js
```

## Safety rules for running against staging/production

1. **Always warn your team** before running a scale or spike test in production.
2. **Run smoke first** to confirm the session cookie is valid and the baseline is healthy.
3. **Monitor** `/api/admin/performance` in another tab while tests run to watch DB pool and event loop lag.
4. **Stop immediately** (`Ctrl+C`) if error rate exceeds 5% or p95 > 3000 ms — investigate before continuing.
5. **Never run spike or scale tests during peak business hours** (9 am–5 pm on weekdays).
6. **AI generation endpoints** (`/api/crm/ai-summary/*/suggest-next-email`) are intentionally excluded from load tests — they invoke the live OpenAI API and would incur real cost and risk rate limits.

## Interpreting results

Key thresholds (defined in each test):
- `http_req_failed < 1%` — less than 1% of requests should error
- Normal API p95 < 800 ms
- Heavy dashboard API p95 < 1500 ms

After each test, k6 prints a summary. Save it with:

```bash
k6 run --out json=results.json load-tests/normal-load.js
```
