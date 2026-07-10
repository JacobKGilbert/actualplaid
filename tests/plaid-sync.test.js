/**
 * Unit tests for Plaid /transactions/sync helpers and Trial/production alignment.
 * Run: npm test
 */
const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
    fetchAllTransactionUpdates,
    filterTransactionsForAccount,
    buildLinkTokenRequest,
    resolvePlaidSecret,
} = require("../plaid-sync.js");

describe("resolvePlaidSecret", () => {
    it("accepts sandbox and production secrets", () => {
        assert.equal(
            resolvePlaidSecret({
                PLAID_ENV: "sandbox",
                PLAID_SECRETS: { sandbox: "sbx-secret", production: "prod-secret" },
            }),
            "sbx-secret"
        );
        assert.equal(
            resolvePlaidSecret({
                PLAID_ENV: "production",
                PLAID_SECRETS: { sandbox: "sbx-secret", production: "prod-secret" },
            }),
            "prod-secret"
        );
    });

    it("rejects deprecated development environment", () => {
        assert.throws(
            () =>
                resolvePlaidSecret({
                    PLAID_ENV: "development",
                    PLAID_SECRETS: { development: "dev" },
                }),
            /sandbox|production|June 2024|Trial/i
        );
    });

    it("throws when secret for selected env is missing", () => {
        assert.throws(
            () =>
                resolvePlaidSecret({
                    PLAID_ENV: "production",
                    PLAID_SECRETS: { sandbox: "only-sbx" },
                }),
            /Missing Plaid secret/
        );
    });
});

describe("buildLinkTokenRequest", () => {
    const base = {
        PLAID_PRODUCTS: ["transactions"],
        PLAID_COUNTRY_CODES: ["US"],
        PLAID_LANGUAGE: "en",
        APP_URL: "http://localhost",
    };

    it("includes required Link fields for transactions product", () => {
        const req = buildLinkTokenRequest(base, "user-1");
        assert.deepEqual(req.user, { client_user_id: "user-1" });
        assert.equal(req.client_name, "Actual Budget Plaid Importer");
        assert.deepEqual(req.products, ["transactions"]);
        assert.deepEqual(req.country_codes, ["US"]);
        assert.equal(req.language, "en");
        assert.equal(req.redirect_uri, undefined);
    });

    it("sets redirect_uri for HTTPS non-localhost APP_URL (OAuth banks)", () => {
        const req = buildLinkTokenRequest(
            { ...base, APP_URL: "https://plaid.example.com" },
            "user-1"
        );
        assert.equal(req.redirect_uri, "https://plaid.example.com");
    });

    it("includes transactions.days_requested when configured", () => {
        const req = buildLinkTokenRequest(
            { ...base, PLAID_TRANSACTIONS_DAYS_REQUESTED: 730 },
            "user-1"
        );
        assert.deepEqual(req.transactions, { days_requested: 730 });
    });
});

describe("filterTransactionsForAccount", () => {
    const txs = [
        { account_id: "a1", date: "2026-01-01", transaction_id: "t1" },
        { account_id: "a2", date: "2026-02-01", transaction_id: "t2" },
        { account_id: "a1", date: "2026-03-01", transaction_id: "t3" },
    ];

    it("filters by account_id", () => {
        const out = filterTransactionsForAccount(txs, "a1");
        assert.equal(out.length, 2);
        assert.deepEqual(
            out.map((t) => t.transaction_id),
            ["t1", "t3"]
        );
    });

    it("applies optional since date (inclusive lower bound)", () => {
        const out = filterTransactionsForAccount(txs, "a1", "2026-02-01");
        assert.equal(out.length, 1);
        assert.equal(out[0].transaction_id, "t3");
    });
});

describe("fetchAllTransactionUpdates", () => {
    it("paginates until has_more is false and returns next cursor", async () => {
        const calls = [];
        const plaidClient = {
            transactionsSync: async (req) => {
                calls.push(req);
                if (!req.cursor) {
                    return {
                        data: {
                            added: [{ transaction_id: "1", account_id: "acc" }],
                            modified: [],
                            removed: [],
                            has_more: true,
                            next_cursor: "cursor-page-2",
                        },
                    };
                }
                return {
                    data: {
                        added: [{ transaction_id: "2", account_id: "acc" }],
                        modified: [{ transaction_id: "1m", account_id: "acc" }],
                        removed: [{ transaction_id: "gone" }],
                        has_more: false,
                        next_cursor: "cursor-final",
                    },
                };
            },
        };

        const result = await fetchAllTransactionUpdates(plaidClient, "access-token", "");
        assert.equal(calls.length, 2);
        assert.equal(result.added.length, 2);
        assert.equal(result.modified.length, 1);
        assert.equal(result.removed.length, 1);
        assert.equal(result.nextCursor, "cursor-final");
        assert.equal(calls[0].access_token, "access-token");
        assert.equal(calls[0].count, 500);
    });

    it("restarts pagination from page-start cursor on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", async () => {
        let attempt = 0;
        const plaidClient = {
            transactionsSync: async (req) => {
                attempt += 1;
                // First pagination attempt: first page ok, second page mutation error
                if (attempt === 1) {
                    return {
                        data: {
                            added: [{ transaction_id: "a" }],
                            modified: [],
                            removed: [],
                            has_more: true,
                            next_cursor: "c2",
                        },
                    };
                }
                if (attempt === 2) {
                    const err = new Error("mutation");
                    err.response = {
                        data: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" },
                    };
                    throw err;
                }
                // Restart from original cursor ""
                if (attempt === 3) {
                    assert.equal(req.cursor, "");
                    return {
                        data: {
                            added: [{ transaction_id: "full" }],
                            modified: [],
                            removed: [],
                            has_more: false,
                            next_cursor: "final",
                        },
                    };
                }
                throw new Error(`unexpected attempt ${attempt}`);
            },
        };

        const result = await fetchAllTransactionUpdates(plaidClient, "tok", "");
        assert.equal(result.added[0].transaction_id, "full");
        assert.equal(result.nextCursor, "final");
        assert.ok(attempt >= 3);
    });
});
