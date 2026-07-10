# actualplaid

Unofficial tool to sync bank transactions from [Plaid](https://plaid.com) into [Actual Budget](https://actualbudget.org) using Plaid Link + `/transactions/sync`.

Aligned with:
- Current Plaid API (sandbox + production only; development env removed June 2024)
- Plaid Trial plan (production keys, up to 10 Items)
- Cursor-based `/transactions/sync` (not legacy `/transactions/get`)
- Current `@actual-app/api` client for self-hosted Actual

## Requirements

- Node.js 18+
- Self-hosted Actual Budget server (sync ID from Advanced settings)
- Plaid developer account ([dashboard](https://dashboard.plaid.com/signup))
- For real banks: Plaid **Trial** or paid production access

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
3. Serve this tool over **HTTPS** (reverse-proxy localhost:3000)
4. Set `APP_URL=https://your.domain` and register redirect URI in Plaid API settings if prompted
5. Link accounts from a desktop browser

## Setup

```bash
git clone https://github.com/JacobKGilbert/actualplaid.git
cd actualplaid
npm ci   # or: npm install
cp .env.sample .env
# edit .env with Actual + Plaid credentials
```

1. Open Actual and ensure the budget is available on your server
2. Create empty accounts in Actual that will receive imports
3. Run setup:

```bash
node index.js setup
# or after npm link / global install:
# actualplaid setup
```

4. Complete Plaid Link in the browser for each bank
5. Map each Actual account to a Plaid account in the CLI
6. Import:

```bash
node index.js import
```

First import uses a full `/transactions/sync` history pull (empty cursor). Later imports are incremental via stored cursors.

## Commands

```
  Usage
    $ actualplaid <command> <flags>

  Commands & Options
    setup            Link bank accounts with your Actual Budget accounts via Plaid
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
3. **Map**: Plaid transactions → Actual via `importTransactions` (`imported_id` = Plaid `transaction_id`)
4. **Cursor**: stored per account/Item so subsequent imports are incremental

## Notes and limitations

- Manually create Actual accounts before mapping
- Initial import may not set a starting balance; add one in Actual if needed
- Pending transactions are imported with `cleared: false`
- Removed transactions from Plaid are logged but not auto-deleted in Actual
- Trial cap: 10 Items
- Run `npm test` to execute unit tests (config + `/transactions/sync` helpers)

## Development

```bash
npm test
npm start setup
npm run import
```

## License

MIT
