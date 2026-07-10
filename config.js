const Conf = require("conf");
const config = require("dotenv").config;
config();

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "";
const ACTUAL_SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || "";
const ACTUAL_SERVER_ENCRYPTION_PASSWORD =
    process.env.ACTUAL_SERVER_ENCRYPTION_PASSWORD || "";

const APP_PORT = process.env.APP_PORT || 3000;
const APP_BIND_ADDRESS = process.env.APP_BIND_ADDRESS || "127.0.0.1";

const APP_URL = process.env.APP_URL || "http://localhost";

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || "";
// Plaid removed the "development" environment in June 2024.
// Only sandbox and production remain. Trial plan uses production keys.
const PLAID_SECRETS = {
    sandbox: process.env.PLAID_SECRET_SANDBOX || process.env.PLAID_SECRET || "",
    production:
        process.env.PLAID_SECRET_PRODUCTION || process.env.PLAID_SECRET || "",
};

const PLAID_ENV = process.env.PLAID_ENV || "sandbox";
const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || "transactions").split(
    ","
);
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || "US").split(
    ","
);
const PLAID_LANGUAGE = process.env.PLAID_LANGUAGE || "en";

// Max days of history to request on first Link/item init (1–730). Trial/production default 90.
const PLAID_TRANSACTIONS_DAYS_REQUESTED = process.env
    .PLAID_TRANSACTIONS_DAYS_REQUESTED
    ? parseInt(process.env.PLAID_TRANSACTIONS_DAYS_REQUESTED, 10)
    : undefined;

const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN || "";
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY || "";

// Env vars that are allowed to be empty (optional features).
const OPTIONAL_ENV_VARS = [
    "PUSHOVER_TOKEN",
    "PUSHOVER_USER_KEY",
    "ACTUAL_SERVER_ENCRYPTION_PASSWORD",
    "PLAID_TRANSACTIONS_DAYS_REQUESTED",
];

function getAppConfigFromEnv() {
    const appConfig = {
        APP_PORT,
        APP_BIND_ADDRESS,
        APP_URL,
        PLAID_CLIENT_ID,
        PLAID_SECRETS,
        PLAID_ENV,
        PLAID_PRODUCTS,
        PLAID_LANGUAGE,
        PLAID_COUNTRY_CODES,
        PLAID_TRANSACTIONS_DAYS_REQUESTED,
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_SERVER_ENCRYPTION_PASSWORD,
        PUSHOVER_TOKEN,
        PUSHOVER_USER_KEY,
    };

    // Assert that all required environment variables are set
    Object.entries(appConfig).forEach(([key, value]) => {
        if (OPTIONAL_ENV_VARS.includes(key)) {
            return;
        }
        // PLAID_SECRETS is an object; validated per-env at client setup time
        if (key === "PLAID_SECRETS") {
            return;
        }
        if (value === undefined || value === null || value === "") {
            throw new Error(`Missing environment variable: ${key}`);
        }
    });

    if (PLAID_ENV !== "sandbox" && PLAID_ENV !== "production") {
        throw new Error(
            `Invalid PLAID_ENV "${PLAID_ENV}". Use "sandbox" or "production" ` +
                `(development was removed by Plaid in June 2024). For Trial use production.`
        );
    }

    return appConfig;
}

function getConf(username) {
    const appConfig = getAppConfigFromEnv();
    const key = `${username}_${appConfig.PLAID_ENV}`;

    const tmp = new Conf({
        configName: key,
    });
    tmp.set("user", key);
    return tmp;
}

module.exports = {
    getAppConfigFromEnv,
    getConf,
};
