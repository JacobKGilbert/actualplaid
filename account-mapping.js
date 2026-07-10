/**
 * Map Plaid account metadata to Actual Budget createAccount fields.
 * @see https://actualbudget.org/docs/api/reference/#createaccount
 */

/**
 * @param {{ type?: string, subtype?: string }} plaidAccount
 * @returns {{ type: string, offbudget: boolean }}
 */
function mapPlaidAccountToActual(plaidAccount) {
    const type = (plaidAccount.type || "").toLowerCase();
    const subtype = (plaidAccount.subtype || "").toLowerCase();

    if (type === "credit" || subtype === "credit card") {
        return { type: "credit", offbudget: false };
    }
    if (type === "investment" || type === "brokerage") {
        return { type: "investment", offbudget: true };
    }
    if (type === "loan") {
        if (subtype === "mortgage") {
            return { type: "mortgage", offbudget: true };
        }
        return { type: "debt", offbudget: true };
    }
    if (type === "depository") {
        if (subtype === "savings" || subtype === "money market" || subtype === "cd") {
            return { type: "savings", offbudget: false };
        }
        // checking, paypal, prepaid, cash management, etc.
        return { type: "checking", offbudget: false };
    }
    return { type: "other", offbudget: false };
}

/**
 * Build a unique-ish Actual account name from Plaid + bank name.
 * @param {string} bankName
 * @param {{ name?: string, official_name?: string, mask?: string|null }} plaidAccount
 */
function buildActualAccountName(bankName, plaidAccount) {
    const accountLabel =
        plaidAccount.official_name || plaidAccount.name || "Account";
    const bank = (bankName || "").trim();
    const mask = plaidAccount.mask ? ` (${plaidAccount.mask})` : "";
    if (bank && !accountLabel.toLowerCase().includes(bank.toLowerCase())) {
        return `${bank} - ${accountLabel}${mask}`;
    }
    return `${accountLabel}${mask}`;
}

/**
 * Fields for actual.createAccount (without id).
 * @param {string} bankName
 * @param {object} plaidAccount
 */
function buildActualAccountPayload(bankName, plaidAccount) {
    const mapped = mapPlaidAccountToActual(plaidAccount);
    return {
        name: buildActualAccountName(bankName, plaidAccount),
        type: mapped.type,
        offbudget: mapped.offbudget,
    };
}

module.exports = {
    mapPlaidAccountToActual,
    buildActualAccountName,
    buildActualAccountPayload,
};
