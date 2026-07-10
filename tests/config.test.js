/**
 * Config validation tests for Trial / production Plaid alignment.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const REQUIRED = {
    PLAID_CLIENT_ID: "client-id",
    PLAID_SECRET_SANDBOX: "sbx",
    PLAID_SECRET_PRODUCTION: "prod",
    PLAID_ENV: "sandbox",
    ACTUAL_SERVER_URL: "http://actual.local",
    ACTUAL_SERVER_PASSWORD: "pw",
    APP_URL: "http://localhost",
};

function withEnv(vars, fn) {
    const prev = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    // Clear module cache so config re-reads env
    delete require.cache[require.resolve("../config.js")];
    try {
        return fn(require("../config.js"));
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        delete require.cache[require.resolve("../config.js")];
    }
}

describe("getAppConfigFromEnv", () => {
    it("loads sandbox config with production secret optional", () => {
        withEnv(
            {
                ...REQUIRED,
                PLAID_SECRET_DEVELOPMENT: undefined,
                PLAID_ENV: "sandbox",
                PUSHOVER_TOKEN: undefined,
                PUSHOVER_USER_KEY: undefined,
            },
            ({ getAppConfigFromEnv }) => {
                const cfg = getAppConfigFromEnv();
                assert.equal(cfg.PLAID_ENV, "sandbox");
                assert.equal(cfg.PLAID_CLIENT_ID, "client-id");
                assert.equal(cfg.PLAID_SECRETS.sandbox, "sbx");
                assert.ok(Array.isArray(cfg.PLAID_PRODUCTS));
                assert.ok(cfg.PLAID_PRODUCTS.includes("transactions"));
            }
        );
    });

    it("defaults PLAID_ENV to sandbox (not development)", () => {
        withEnv(
            {
                ...REQUIRED,
                PLAID_ENV: undefined,
            },
            ({ getAppConfigFromEnv }) => {
                const cfg = getAppConfigFromEnv();
                assert.equal(cfg.PLAID_ENV, "sandbox");
            }
        );
    });

    it("exposes PLAID_TRANSACTIONS_DAYS_REQUESTED when set", () => {
        withEnv(
            {
                ...REQUIRED,
                PLAID_TRANSACTIONS_DAYS_REQUESTED: "730",
            },
            ({ getAppConfigFromEnv }) => {
                const cfg = getAppConfigFromEnv();
                assert.equal(cfg.PLAID_TRANSACTIONS_DAYS_REQUESTED, 730);
            }
        );
    });

    it("treats Pushover vars as optional", () => {
        withEnv(
            {
                ...REQUIRED,
                PUSHOVER_TOKEN: undefined,
                PUSHOVER_USER_KEY: undefined,
            },
            ({ getAppConfigFromEnv }) => {
                const cfg = getAppConfigFromEnv();
                assert.equal(cfg.PUSHOVER_TOKEN, "");
                assert.equal(cfg.PUSHOVER_USER_KEY, "");
            }
        );
    });
});
