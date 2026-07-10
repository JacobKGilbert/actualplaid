/**
 * Plaid /transactions/sync helpers.
 * Cursor-based incremental transaction updates (replaces legacy transactionsGet).
 *
 * @see https://plaid.com/docs/api/products/transactions/#transactionssync
 * @see https://plaid.com/docs/transactions/sync-migration/
 */

/**
 * Fetch all available transaction updates for an Item since the given cursor.
 * Handles pagination via has_more and restarts the full page loop on
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION.
 *
 * @param {import('plaid').PlaidApi} plaidClient
 * @param {string} accessToken
 * @param {string} [cursor=''] - empty string for full history; stored next_cursor thereafter
 * @param {{ count?: number, daysRequested?: number }} [options]
 * @returns {Promise<{ added: object[], modified: object[], removed: object[], nextCursor: string }>}
 */
async function fetchAllTransactionUpdates(plaidClient, accessToken, cursor = "", options = {}) {
    const count = options.count || 500;
    const daysRequested = options.daysRequested;

    // Restart the entire pagination from the original page-start cursor if
    // Plaid mutates data mid-pagination (required by Plaid docs).
    let pageStartCursor = cursor == null ? "" : cursor;
    let nextCursor = pageStartCursor;
    let added = [];
    let modified = [];
    let removed = [];

    // Outer loop: restart from pageStartCursor on mutation errors.
    // Inner loop: page through has_more until complete.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        added = [];
        modified = [];
        removed = [];
        nextCursor = pageStartCursor;
        let hasMore = true;
        let mutationRestart = false;

        while (hasMore) {
            const request = {
                access_token: accessToken,
                cursor: nextCursor,
                count,
            };
            if (daysRequested != null && (nextCursor === "" || nextCursor == null)) {
                request.options = { days_requested: daysRequested };
            }

            let response;
            try {
                response = await plaidClient.transactionsSync(request);
            } catch (err) {
                const code =
                    err?.response?.data?.error_code ||
                    err?.error_code ||
                    err?.data?.error_code;
                if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
                    mutationRestart = true;
                    break;
                }
                throw err;
            }

            const data = response.data;
            added = added.concat(data.added || []);
            modified = modified.concat(data.modified || []);
            removed = removed.concat(data.removed || []);
            hasMore = Boolean(data.has_more);
            nextCursor = data.next_cursor;
        }

        if (mutationRestart) {
            // Restart entire update from the original page-start cursor.
            continue;
        }

        return {
            added,
            modified,
            removed,
            nextCursor: nextCursor || "",
        };
    }
}

/**
 * Filter transactions to a single Plaid account_id and optional since date (yyyy-MM-dd).
 * @param {object[]} transactions
 * @param {string} accountId
 * @param {string|null} [sinceDate] - inclusive lower bound on transaction.date
 */
function filterTransactionsForAccount(transactions, accountId, sinceDate = null) {
    return (transactions || []).filter((tx) => {
        if (tx.account_id !== accountId) return false;
        if (sinceDate && tx.date && tx.date < sinceDate) return false;
        return true;
    });
}

/**
 * Build link token create payload for current Plaid API (sandbox/production).
 * Includes redirect_uri when APP_URL is a non-localhost HTTPS origin (OAuth banks).
 *
 * @param {object} appConfig
 * @param {string} clientUserId
 */
function buildLinkTokenRequest(appConfig, clientUserId) {
    const configs = {
        user: { client_user_id: clientUserId },
        client_name: "Actual Budget Plaid Importer",
        products: appConfig.PLAID_PRODUCTS,
        country_codes: appConfig.PLAID_COUNTRY_CODES,
        language: appConfig.PLAID_LANGUAGE,
    };

    const daysRequested = appConfig.PLAID_TRANSACTIONS_DAYS_REQUESTED;
    if (daysRequested != null) {
        configs.transactions = { days_requested: daysRequested };
    }

    const appUrl = (appConfig.APP_URL || "").replace(/\/$/, "");
    if (appUrl && /^https:\/\//i.test(appUrl) && !/localhost|127\.0\.0\.1/i.test(appUrl)) {
        configs.redirect_uri = appUrl;
    }

    return configs;
}

/**
 * Validate and resolve the Plaid secret for the selected environment.
 * Development env was removed by Plaid (2024); only sandbox and production remain.
 *
 * @param {object} appConfig
 * @returns {string}
 */
function resolvePlaidSecret(appConfig) {
    const env = appConfig.PLAID_ENV;
    if (env !== "sandbox" && env !== "production") {
        throw new Error(
            `Invalid PLAID_ENV "${env}". Plaid only supports "sandbox" and "production" ` +
                `(development was removed in June 2024). For Trial plan use production.`
        );
    }
    const secret =
        (appConfig.PLAID_SECRETS && appConfig.PLAID_SECRETS[env]) ||
        process.env.PLAID_SECRET ||
        "";
    if (!secret) {
        throw new Error(
            `Missing Plaid secret for PLAID_ENV=${env}. ` +
                `Set PLAID_SECRET_${env.toUpperCase()} or PLAID_SECRET.`
        );
    }
    return secret;
}

module.exports = {
    fetchAllTransactionUpdates,
    filterTransactionsForAccount,
    buildLinkTokenRequest,
    resolvePlaidSecret,
};
