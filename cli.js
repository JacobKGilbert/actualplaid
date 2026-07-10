const util = require("util");
const { Configuration, PlaidEnvironments, PlaidApi } = require("plaid");
const path = require("path");
const Fastify = require("fastify");
const fastifyStatic = require("@fastify/static");
const opn = require("better-opn");
const dateFns = require("date-fns");
const inquirer = require("inquirer");
const terminalLink = require("terminal-link");
const { getAppConfigFromEnv, getConf } = require("./config.js");
const { initialize, getLastTransactionDate, importPlaidTransactions, listAccounts, finalize, getBalance } = require("./actual.js");
const { sendPushoverNotification } = require("./pushover.js");
const {
    fetchAllTransactionUpdates,
    filterTransactionsForAccount,
    buildLinkTokenRequest,
    resolvePlaidSecret,
} = require("./plaid-sync.js");

const fastify = Fastify({
    logger: {
        level: "error"
    }
});

let config;
const appConfig = getAppConfigFromEnv();
// Trial plan uses production secrets; development env was removed by Plaid (2024).
const plaidSecret = resolvePlaidSecret(appConfig);
const configuration = new Configuration({
    basePath: PlaidEnvironments[appConfig.PLAID_ENV],
    baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': appConfig.PLAID_CLIENT_ID,
          'PLAID-SECRET': plaidSecret,
        }
    }
});
const plaidClient = new PlaidApi(configuration);

fastify.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
});

const startFastifyServer = async () => {
    await fastify.listen({ port: appConfig.APP_PORT, host: appConfig.APP_BIND_ADDRESS });
};

const printSyncedAccounts = () => {
    const actualData = config.get("actualSync");
    const plaidData = config.get("plaidAccounts");
    if (!actualData) {
        console.log("No syncing data found");
        return;
    }

    console.log("The following accounts are linked to Actual:");
    console.table(
        Object.values(actualData).map((account) => ({
            "Actual Account": account.actualName,
            "Actual Type": account.actualType,
            "Plaid Bank": account.plaidBankName,
            "Plaid Account": account.plaidAccount.name,
            "Plaid Type": `${account.plaidAccount.subtype}/${account.plaidAccount.type}`,
            "Plaid Account #": account.plaidAccount.mask,
        }))
    );

    const linkedToActual = Object.entries(actualData).map(
        ([actualId, { plaidAccount }]) => { return { plaid: plaidAccount.account_id, actual: actualId } }
    )

    linkedToActual.forEach((ids) => {
        delete plaidData[ids.plaid];
    });

    console.log("The following Plaid accounts are linked to this app, but not to Actual:");
    console.table(
        Object.values(plaidData).map(({ account, plaidBankName }) => ({
            "Bank": plaidBankName,
            "Account": account.name,
            "Type": `${account.subtype}/${account.type}`,
            "Account #": account.mask,
        }))
    );
};

async function startLinkingPlaid() {
    const { dissmissedWarning } = await inquirer.prompt({
        type: "confirm",
        name: "dissmissedWarning",
        message: `WARNING: Plaid Trial allows up to 10 Items (linked bank connections). ` +
            `Removed Items do not free the quota. See the ${terminalLink(
            "Plaid Dashboard",
            "https://dashboard.plaid.com/"
        )} to check usage. Proceed?`,
    });
    if (!dissmissedWarning) {
        throw new Error("Plaid Linking cancelled");
    }
    startFastifyServer();

    const { confirm } = await inquirer.prompt({
        type: "confirm",
        name: "confirm",
        message: `Please link each bank you expect to sync with Actual, using the URL to follow. Proceed?`,
    });

    if (!confirm) {
        throw new Error("Plaid Linking cancelled");
    }

    //If running locally, open the browser to localhost.
    if (`${appConfig.APP_URL}` == 'http://localhost') {

        const plaidLinkLink = `http://localhost:${appConfig.APP_PORT}`;
        console.log(
            `Opening ${plaidLinkLink} to link with Plaid...\nNOTE: Please return to your CLI when completed.`
        );
        opn(plaidLinkLink);

    } else { //If not running locally / needing https, let the user open it themselves.

        const plaidLinkLink = `${appConfig.APP_URL}`;
        console.log(
            `Open ${plaidLinkLink} to link with Plaid in a browser...\nNOTE: Please return to your CLI when completed.`
        );

    }

    let doneLinking = false;

    while (!doneLinking) {
        let result = await inquirer.prompt({
            type: "confirm",
            name: "doneLinking",
            message: `Are you done linking banks?`,
        });
        doneLinking = result.doneLinking;
    }

    const plaidAccounts = config.get("plaidAccounts");
    if (!plaidAccounts) {
        throw new Error("You did not link any Plaid accounts");
    }
    return plaidAccounts
}


/**
 * 
 * @param {string} command 
 * @param {object} flags 
 * @param {string} flags.account
 * @param {string} flags.since
 */
module.exports = async (command, flags) => {
    if (!command) {
        console.log('Try "actualplaid --help"');
        process.exit();
    }

    config = getConf(flags.user || "default")

    if (command === "config") {
        console.log(`Config for this app is located at: ${config.path}`);
    } else if (command === "import") {
        const syncingData = config.get(`actualSync`) || {};

        if (Object.keys(syncingData).length) {
            const actual = await initialize(config);
            const accountsToSync = Object.entries(syncingData).filter(
                ([_, account]) =>
                    !flags.account || account.actualName === flags.account
            );

            // Cache /transactions/sync results per access_token so multi-account
            // Items only hit Plaid once per import run.
            const updatesPerToken = {};

            const getTokenUpdates = async (token, storedCursor) => {
                const key = token;
                if (!updatesPerToken[key]) {
                    const cursor = storedCursor == null ? "" : storedCursor;
                    console.log(
                        `Plaid transactions/sync for Item (cursor ${cursor ? "incremental" : "full history"})...`
                    );
                    updatesPerToken[key] = await fetchAllTransactionUpdates(
                        plaidClient,
                        token,
                        cursor,
                        {
                            daysRequested:
                                appConfig.PLAID_TRANSACTIONS_DAYS_REQUESTED,
                        }
                    );
                }
                return updatesPerToken[key];
            };

            for (let [actualId, account] of accountsToSync) {
                const sinceDate = flags["since"]
                    ? dateFns.format(new Date(flags["since"]), "yyyy-MM-dd")
                    : null;

                console.log(
                    "Importing transactions for account:",
                    account.plaidAccount.name,
                    sinceDate ? `(since ${sinceDate})` : "(cursor-based sync)"
                );
                const tempStartTime = new Date();

                // Prefer per-account cursor; fall back to shared Item cursor.
                const storedCursor =
                    account.plaidCursor != null
                        ? account.plaidCursor
                        : config.get(`plaidCursors.${account.plaidToken}`) ||
                          "";

                const updates = await getTokenUpdates(
                    account.plaidToken,
                    storedCursor
                );

                // Import both newly added and modified transactions; Actual
                // dedupes on imported_id (transaction_id).
                const candidates = (updates.added || []).concat(
                    updates.modified || []
                );
                const transactionsForThisAccount = filterTransactionsForAccount(
                    candidates,
                    account.plaidAccount.account_id,
                    sinceDate
                );

                if (updates.removed && updates.removed.length) {
                    const removedForAccount = updates.removed.filter(
                        (r) =>
                            !r.account_id ||
                            r.account_id === account.plaidAccount.account_id
                    );
                    if (removedForAccount.length) {
                        console.log(
                            `Note: ${removedForAccount.length} removed transaction(s) reported by Plaid for ${account.plaidAccount.name}; Actual import does not auto-delete them.`
                        );
                    }
                }

                // Sleep at least 2 sec to let user cancel
                const timeTookForPlaid = new Date() - tempStartTime;
                const timeToSleep = 2000 - timeTookForPlaid;
                if (timeToSleep > 0) {
                    await new Promise((resolve) => setTimeout(resolve, timeToSleep));
                }

                const importResult = await importPlaidTransactions(
                    actual,
                    actualId,
                    account.plaidBankName,
                    transactionsForThisAccount
                );
                config.set(`actualSync.${actualId}.lastImport`, new Date());
                config.set(
                    `actualSync.${actualId}.plaidCursor`,
                    updates.nextCursor
                );
                config.set(
                    `plaidCursors.${account.plaidToken}`,
                    updates.nextCursor
                );

                const newTransactionCount = importResult.added
                    ? importResult.added.length
                    : 0;
                if (newTransactionCount > 0) {
                    await sendPushoverNotification(appConfig, {
                        title: `${account.actualName}: ${newTransactionCount} new transaction${newTransactionCount === 1 ? "" : "s"}`,
                        message: `Found ${newTransactionCount} new transaction${newTransactionCount === 1 ? "" : "s"} for ${account.actualName} (${account.plaidBankName})`,
                    });
                }
            }
            console.log("Import completed for all accounts");

            await finalize(actual)
        } else {
            throw new Error("No syncing data found please run `actualplaid setup`");
        }

    } else if (command === "setup") {
        /** Configuration for every plaid account */
        let plaidAccounts = config.get("plaidAccounts") || {};

        /** Every plaid account that has been linked to an actual account */
        const linkedToActual = Object.entries(config.get("actualSync") || {}).map(
            ([actualId, { plaidAccount }]) => { return { plaid: plaidAccount.account_id, actual: actualId } }
        )

        linkedToActual.forEach((ids) => {
            delete plaidAccounts[ids.plaid];
        });


        if (Object.keys(plaidAccounts).length == 0) {
            console.log("There are no accounts linked to Plaid that are not already in Actual. Please link at least one new account to continue.")
            plaidAccounts = await startLinkingPlaid();
        } else {
            console.log("The following accounts are linked to Plaid, but not to Actual:");
            console.table(
                Object.values(plaidAccounts).map(({ account, plaidBankName }) => ({
                    "Bank": plaidBankName,
                    "Account": account.name,
                    "Type": `${account.subtype}/${account.type}`,
                    "Account #": account.mask,
                }))
            );
            const { confirm } = await inquirer.prompt({
                type: "confirm",
                name: "confirm",
                message: `Do you want to re-link your accounts or add extra?`,
                default: false,

            });

            if (confirm) {
                plaidAccounts = await startLinkingPlaid();
            }
        }

        // Remove accounts that are now linked again.
        linkedToActual.forEach((ids) => {
            delete plaidAccounts[ids.plaid];
        });

        console.log("The following accounts will be used to link to actual:");
        console.table(
            Object.values(plaidAccounts).map(({ account, plaidBankName }) => ({
                "Bank": plaidBankName,
                "Account": account.name,
                "Type": `${account.subtype}/${account.type}`,
                "Account #": account.mask,
            }))
        );

        const accountsInTheActualBudget = await listAccounts(await initialize(config));
        const { accountsToSync } = await inquirer.prompt({
            type: "checkbox",
            name: "accountsToSync",
            message: `Which actual accounts do you want to sync with plaid?`,
            // Only show accounts that are not already linked
            choices: accountsInTheActualBudget.map(({ name, id }) => ({ name, value: id })).filter(({ value }) => !linkedToActual.find(({ actual }) => actual === value)),
        });

        for (acctId of accountsToSync) {
            const actualAcct = accountsInTheActualBudget.find((a) => a.id === acctId);
            let syncChoices = Object.values(plaidAccounts).map(
                ({ account, plaidBankName }) => ({
                    value: account.account_id,
                    name: `${plaidBankName}: ${account.name} - ${account.subtype}/${account.type} (${account.mask})`,
                })
            );
            const { plaidAccountIDToSync } = await inquirer.prompt({
                type: "list",
                name: "plaidAccountIDToSync",
                message: `Which Plaid acount do you want to sync with "${actualAcct.name}"?`,
                choices: syncChoices,
            });
            const plaidAccountToSync = Object.values(plaidAccounts).find(
                ({ account }) => account.account_id === plaidAccountIDToSync
            );

            delete plaidAccounts[plaidAccountIDToSync]

            config.set(`actualSync.${acctId}`, {
                actualName: actualAcct.name,
                actualType: actualAcct.type,
                actualAccountId: actualAcct.id,
                plaidItemId: plaidAccountToSync.plaidItemId,
                plaidToken: plaidAccountToSync.plaidToken,
                plaidAccount: plaidAccountToSync.account,
                plaidBankName: plaidAccountToSync.plaidBankName,
            });
        }
        printSyncedAccounts();
        console.log(
            `Setup completed sucessfully. Run \`actualplaid import\` to sync your setup banks with their respective actual accounts`
        );

    } else if (command == "check") {
        const actual = await initialize(config);
        const syncingData = config.get(`actualSync`) || {};

        if (Object.keys(syncingData).length == 0) {
            console.log("No syncing data found please run `actualplaid setup`");
        }

        for (let [actualId, account] of Object.entries(syncingData)) {
            const balanceFromActual = await getBalance(actual, actualId);
            const plaidBalanceInformation = await plaidClient.accountsBalanceGet({
                access_token: account.plaidToken, 
                options: {
                    account_ids: [account.plaidAccount.account_id],
                }
            });

            const balanceFromPlaid = plaidBalanceInformation.data.accounts[0].balances.current
            const actualConverted = actual.utils.integerToAmount(balanceFromActual);

            console.log(`Checking balance for account: ${account.actualName} (${account.plaidBankName})`)
            console.log("Actual balance: ", actualConverted)
            console.log("Plaid balance: ", balanceFromPlaid)

            if (actualConverted !== balanceFromPlaid) {
                throw new Error(`Balance for account ${account.actualName} (${account.plaidBankName}) does not match. Actual: ${balanceFromActual} Plaid: ${balanceFromPlaid}`)
            }
        }

    } else if (command === "ls") {
        printSyncedAccounts();

    } else if (command === "test-notify") {
        if (!appConfig.PUSHOVER_TOKEN || !appConfig.PUSHOVER_USER_KEY) {
            console.log("Pushover is not configured. Set PUSHOVER_TOKEN and PUSHOVER_USER_KEY to enable notifications.");
            process.exitCode = 1;
        } else {
            console.log("Sending test notification to Pushover...");
            const result = await sendPushoverNotification(appConfig, {
                title: "actualplaid test notification",
                message: "If you're seeing this, actualplaid is able to send you Pushover notifications.",
            });
            if (result.ok) {
                console.log("Test notification sent successfully. Check your Pushover devices.");
            } else {
                console.log("Failed to send test notification:", result.error || `HTTP ${result.statusCode} ${result.responseBody}`);
                process.exitCode = 1;
            }
        }
    }
    process.exit();
};

fastify.get("/", (req, reply) => reply.sendFile("index.html"));

fastify.post("/create_link_token", (request, reply) => {
    const appConfig = getAppConfigFromEnv();
    const configs = buildLinkTokenRequest(appConfig, config.get("user"));
    plaidClient.linkTokenCreate(configs)
        .then((response) => reply.send({ link_token: response.data.link_token }))
        .catch((error) => {
            console.error("Failed to create Plaid link token:", error?.response?.data || error);
            reply.code(500).send({ error: "Failed to create link token" });
        });
});

fastify.post("/get_access_token", async (request, reply) => {
    console.log("Received new request to link accounts")
    const appConfig = getAppConfigFromEnv()
    const body = JSON.parse(request.body);

    try {
        const tokenResponse = await plaidClient.itemPublicTokenExchange({ public_token: body.public_token });
        const access_token = tokenResponse.data.access_token;
        const item_id = tokenResponse.data.item_id;

        const accountResponse = await plaidClient.accountsGet({ access_token: access_token });
        const accounts = accountResponse.data.accounts;
        const institution_id = accountResponse.data.item.institution_id;

        const institutionResponse = await plaidClient.institutionsGetById({
            institution_id: institution_id,
            country_codes: appConfig.PLAID_COUNTRY_CODES
        });
        const name = institutionResponse.data.institution.name;

        accounts.forEach((account) => {
            console.log("Linked new account: ", name)
            // TODO: Duplicate prevention
            config.set(`plaidAccounts.${account.account_id}`, {
                account,
                plaidToken: access_token,
                plaidItemId: item_id,
                plaidBankName: name,
                plaidInstitutionId: institution_id,
            });
        });
        reply.send({ ok: true });

    } catch (e) {
        console.error("ERR when linking tokens", e)
    }
});
