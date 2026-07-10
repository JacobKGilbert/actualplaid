# actualplaid

Unofficial tool to sync bank transactions from [Plaid](https://plaid.com) into [Actual Budget](https://actualbudget.org) using Plaid Link + `/transactions/sync`.

Aligned with:
- Current Plaid API (sandbox + production only; development env removed June 2024)
- Plaid Trial plan (production keys, up to 10 Items)
- Cursor-based `/transactions/sync` (not legacy `/transactions/get`)
- Current `@actual-app/api` client for self-hosted Actual

**During Plaid pairing (`setup`), Actual Budget accounts can be created automatically** from each linked bank account—no need to pre-create them in Actual first.

## Requirements

- Node.js 18+
- Self-hosted Actual Budget server (sync ID from Advanced settings)
- Plaid developer account ([dashboard](https://dashboard.plaid.com/signup))
- For real banks: Plaid **Trial** or paid production access

## Where to run this

**actualplaid does not need to run on the same machine as your Actual Budget server.**

It is a separate client process. It talks to Actual over HTTP(S) using `ACTUAL_SERVER_URL` and your server password, and it talks to Plaid’s cloud API over the internet. Co-locating it with Actual is optional convenience, not a requirement.

### What the machine running actualplaid needs

1. **Outbound access to your Actual server** — the URL in `ACTUAL_SERVER_URL` must be reachable (LAN hostname, reverse-proxy URL, VPN, etc.).
2. **Outbound internet access to Plaid** — for Link and `/transactions/sync`.
3. **A browser that can open the Link helper** during `setup` — actualplaid starts a small local web server (`APP_PORT`, default `3000`). For many OAuth banks, that helper must be exposed as **HTTPS** via `APP_URL` (often through a reverse proxy).
4. **Persistent local storage** — Plaid access tokens, account mappings, and sync cursors are stored in this tool’s config on the host that runs it (see `actualplaid config`), not inside Actual.

### Common layouts

| Layout | Works? | When to use it |
| --- | --- | --- |
| Same host as Actual | Yes | Simplest networking; one box to maintain |
| Different host on the same network | Yes | Keep Actual on a server/NAS and run imports from another always-on machine |
| Laptop / workstation only when you sync | Yes | Manual `setup` and occasional `import` without a dedicated worker |
| Remote host over VPN or public HTTPS | Yes | As long as `ACTUAL_SERVER_URL` is reachable and secrets stay private |

### Tips

- Point `ACTUAL_SERVER_URL` at whatever URL your Actual clients already use (local IP, Traefik/Caddy/Nginx hostname, Tailscale, etc.).
- You can run **setup** on one machine (for interactive bank linking) and **import** later on another, but each host keeps its own config unless you copy it.
- For scheduled imports, any always-on host that can reach Actual and Plaid is enough (cron, systemd timer, container, etc.).
- Protect `.env` and the config directory: they hold Plaid tokens and server credentials.

## Plaid Trial plan

1. Sign up at https://dashboard.plaid.com/signup
2. Apply for Trial at https://dashboard.plaid.com/trial-plan (up to **10 Items**)
3. Create an app and copy **production** `client_id` + `secret`
4. Set `PLAID_ENV=production` and `PLAID_SECRET_PRODUCTION=...`
5. Note: removing an Item does **not** free a Trial slot

Sandbox is free for fake banks only. Trial uses production keys with real institutions.

### OAuth banks (Chase, etc.)

Many US institutions require OAuth + production:

1. Complete company profile, app branding, and security questionnaire in the Plaid dashboard
2. Apply for production / Trial access (pay-as-you-go is typical for personal use)
3. Serve the Link helper over **HTTPS** (see [Exposing the Link helper via HTTPS](#exposing-the-link-helper-via-https))
4. Set `APP_URL=https://your.domain` and register that origin as an allowed redirect URI in Plaid API settings if prompted
5. Link accounts from a desktop browser

## Exposing the Link helper via HTTPS

During `setup`, actualplaid starts a small HTTP server that serves the Plaid Link page and two endpoints (`/create_link_token`, `/get_access_token`). By default it listens on `127.0.0.1:3000` (`APP_BIND_ADDRESS` / `APP_PORT`).

For **non-OAuth** sandbox testing, opening `http://localhost:3000` is enough.

For **OAuth institutions** (and most production/Trial bank links), Plaid expects a public **HTTPS** origin. Put any reverse proxy in front of the helper so browsers hit HTTPS while actualplaid itself stays on plain HTTP locally.

### Architecture

```
Browser  --HTTPS-->  Reverse proxy (TLS cert)
                        |
                        | HTTP (LAN / loopback)
                        v
                 actualplaid Link helper
                 (APP_BIND_ADDRESS:APP_PORT)
```

### Steps (any reverse proxy)

1. **Run actualplaid on a host the proxy can reach**
   - For same-machine proxying: bind to loopback (`APP_BIND_ADDRESS=127.0.0.1`).
   - For a proxy on another host: bind to a LAN interface or `0.0.0.0` and firewall so only the proxy (or your LAN) can reach `APP_PORT`.

2. **Create a proxy host / route**
   - Scheme: HTTPS on the public side
   - Backend / forward target: `http://<actualplaid-host>:<APP_PORT>` (default port `3000`)
   - Enable WebSocket only if your proxy requires it for other apps; Link does not need it
   - Force HTTPS / HTTP→HTTPS redirect is recommended

3. **Issue a TLS certificate** for the hostname (Let's Encrypt, internal CA, DNS challenge, etc.)

4. **Set environment variables** on the machine running actualplaid:

   ```bash
   APP_PORT=3000
   APP_BIND_ADDRESS=127.0.0.1   # or 0.0.0.0 if the proxy is remote
   APP_URL=https://plaid-link.example.com
   ```

   `APP_URL` must be the exact public origin users open in the browser (no trailing slash required). When `APP_URL` is HTTPS and not localhost, actualplaid includes it as `redirect_uri` in `/link/token/create`.

5. **Register the redirect URI in Plaid** (dashboard → Team settings / API → Allowed redirect URIs) if your institutions require it:

   - `https://plaid-link.example.com`
   - Match the scheme and host used in `APP_URL`

6. **Start setup and open the HTTPS URL** in a desktop browser (not only the raw localhost port):

   ```bash
   node index.js setup
   # open https://plaid-link.example.com  (same value as APP_URL)
   ```

7. **When linking is finished**, you can stop the process and (optionally) disable or remove the public proxy host. Ongoing `import` jobs only call Plaid and Actual APIs; they do **not** need the Link helper exposed.

### Example: Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name plaid-link.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Example: Caddy

```caddy
plaid-link.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Example: Traefik (label-style, conceptual)

Point a router/service at `http://actualplaid:3000` (or the host port you published), enable the TLS certificate resolver you already use, and set the Host rule to your Link hostname. Set `APP_URL` to that same `https://…` host.

### Example: UI-based proxies (Nginx Proxy Manager, etc.)

Create a Proxy Host:

| Field | Value |
| --- | --- |
| Domain names | `plaid-link.example.com` |
| Scheme | `http` |
| Forward hostname / IP | host running actualplaid (e.g. `127.0.0.1` or LAN IP) |
| Forward port | `3000` (or your `APP_PORT`) |
| SSL | Request/attach certificate; enable Force SSL |

Then set `APP_URL=https://plaid-link.example.com` in `.env`.

### Security notes

- The Link helper is only required during interactive `setup`. Prefer keeping the hostname private (VPN, auth front door, or temporary DNS) if you do not want it on the open internet.
- Do not put Plaid secrets or Actual passwords in the reverse proxy; they stay in actualplaid’s `.env` / environment.
- If Link fails with redirect or OAuth errors, confirm `APP_URL`, the proxy hostname, and Plaid’s allowed redirect URIs are identical (including `https://`).

## Automatic Actual accounts during Plaid pairing

When you run `setup` and finish Plaid Link, actualplaid asks which bank accounts to keep. **By default it creates a matching Actual Budget account for each selected Plaid account** and stores the pairing.

You do **not** need to create empty accounts in Actual beforehand (unless you prefer manual mapping).

### What happens in `setup`

1. Complete Plaid Link in the browser (authenticate with your bank).
2. Choose which Plaid accounts to pair.
3. Choose how to add them to Actual:
   - **Create new Actual accounts automatically (recommended / default)** — uses Actual’s `createAccount` API
   - **Map to existing Actual accounts** — for accounts you already created in Actual
4. Mappings are saved locally; run `import` to pull transactions.

### How Plaid accounts map to Actual

| Plaid type / subtype | Actual type | Off-budget? | Example Actual name |
| --- | --- | --- | --- |
| depository / checking | `checking` | no | `Chase - TOTAL CHECKING (1234)` |
| depository / savings, money market, CD | `savings` | no | `Ally - Savings (0001)` |
| credit / credit card | `credit` | no | `Chase Freedom (9999)` |
| investment / brokerage | `investment` | yes | `Fidelity - Brokerage (4321)` |
| loan / mortgage | `mortgage` | yes | `Bank - Mortgage (5678)` |
| other loans | `debt` | yes | `Bank - Student Loan (1111)` |

- Names combine bank name, account label, and last-four mask when available.
- If an account name already exists in Actual, a suffix like `(2)` is added.
- **Initial balance is always `0`** so a full transaction history import does not double-count against a starting balance. Adjust opening balances in Actual after the first import if you need them.

### Manual mapping (optional)

If you already maintain accounts in Actual, choose **Map to existing Actual accounts** during setup and pair each selected Plaid account to an existing Actual account instead of creating new ones.

## Setup

```bash
git clone https://github.com/JacobKGilbert/actualplaid.git
cd actualplaid
npm ci   # or: npm install
cp .env.sample .env
# edit .env with Actual + Plaid credentials
```

1. Open Actual and ensure the budget is available on your server
2. Run setup (Plaid Link in the browser, then choose accounts):

```bash
node index.js setup
# or after npm link / global install:
# actualplaid setup
```

3. Select the Plaid accounts to pair. **Actual accounts are created automatically by default** (see [Automatic Actual accounts during Plaid pairing](#automatic-actual-accounts-during-plaid-pairing)). Optionally map to existing Actual accounts instead.
4. Import:

```bash
node index.js import
```

First import uses a full `/transactions/sync` history pull (empty cursor). Later imports are incremental via stored cursors.

New Actual accounts are created with a **zero** starting balance so imported history is not double-counted. Adjust opening balances in Actual if needed after the first import.

## Commands

```
  Usage
    $ actualplaid <command> <flags>

  Commands & Options
    setup            Link banks via Plaid; auto-create Actual accounts (or map existing)
    ls               List currently syncing accounts
    import           Sync bank accounts to Actual Budget via /transactions/sync
      --account, -a  The account to import, ex: --account="My Checking"
      --since, -s    Optional lower-bound date filter (yyyy-MM-dd). Cursor still advances.
    config           Print the location of the actualplaid config file
    check            Compare Actual Budget balances to Plaid balances
    test-notify      Send a test Pushover notification
    --version        Print the version

  Options for all commands
    --user, -u       Specify the user to load configs for

  Examples
    $ actualplaid import --account="My Checking" --since="2026-01-01"
```

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| ACTUAL_SERVER_URL | yes | — | Actual server URL |
| ACTUAL_SERVER_PASSWORD | yes | — | Server password |
| ACTUAL_SERVER_ENCRYPTION_PASSWORD | no | — | Budget file encryption password |
| PLAID_CLIENT_ID | yes | — | From Plaid dashboard |
| PLAID_SECRET_SANDBOX | for sandbox | — | Or set `PLAID_SECRET` |
| PLAID_SECRET_PRODUCTION | for production/Trial | — | Or set `PLAID_SECRET` |
| PLAID_ENV | no | sandbox | `sandbox` or `production` only |
| PLAID_PRODUCTS | no | transactions | Comma-separated |
| PLAID_COUNTRY_CODES | no | US | Comma-separated |
| PLAID_LANGUAGE | no | en | Link language |
| PLAID_TRANSACTIONS_DAYS_REQUESTED | no | (Plaid default 90) | 1–730 on first Item init |
| APP_PORT | no | 3000 | Local Link server port |
| APP_BIND_ADDRESS | no | 127.0.0.1 | Bind address |
| APP_URL | no | http://localhost | Public HTTPS URL for OAuth |
| PUSHOVER_TOKEN | no | — | Optional notifications |
| PUSHOVER_USER_KEY | no | — | Optional notifications |

## How sync works

1. **Link**: `/link/token/create` → Plaid Link → `/item/public_token/exchange`
2. **Import**: `/transactions/sync` with stored cursor; handles `has_more` pagination and restarts on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`
3. **Accounts**: `setup` can auto-create Actual accounts via `createAccount`, then map them to Plaid
4. **Map txs**: Plaid transactions → Actual via `importTransactions` (`imported_id` = Plaid `transaction_id`)
5. **Cursor**: stored per account/Item so subsequent imports are incremental

## Notes and limitations

- By default, `setup` creates matching Actual accounts from linked Plaid accounts (you can still map to existing ones)
- Initial balance on auto-created accounts is 0; adjust opening balances in Actual if needed after import
- Pending transactions are imported with `cleared: false`
- Removed transactions from Plaid are logged but not auto-deleted in Actual
- Trial cap: 10 Items
- Run `npm test` to execute unit tests (config + `/transactions/sync` helpers + account mapping)

## Development

```bash
npm test
npm start setup
npm run import
```

## License

MIT
