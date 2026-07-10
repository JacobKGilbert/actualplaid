const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    mapPlaidAccountToActual,
    buildActualAccountName,
    buildActualAccountPayload,
} = require("../account-mapping.js");

describe("mapPlaidAccountToActual", () => {
    it("maps depository/checking to on-budget checking", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "depository", subtype: "checking" }),
            { type: "checking", offbudget: false }
        );
    });

    it("maps depository/savings to on-budget savings", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "depository", subtype: "savings" }),
            { type: "savings", offbudget: false }
        );
    });

    it("maps credit cards to on-budget credit", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "credit", subtype: "credit card" }),
            { type: "credit", offbudget: false }
        );
    });

    it("maps investments off-budget", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "investment", subtype: "brokerage" }),
            { type: "investment", offbudget: true }
        );
    });

    it("maps mortgage loans off-budget", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "loan", subtype: "mortgage" }),
            { type: "mortgage", offbudget: true }
        );
    });

    it("maps other loans as debt off-budget", () => {
        assert.deepEqual(
            mapPlaidAccountToActual({ type: "loan", subtype: "student" }),
            { type: "debt", offbudget: true }
        );
    });
});

describe("buildActualAccountName", () => {
    it("includes bank name and mask when useful", () => {
        assert.equal(
            buildActualAccountName("Chase", {
                name: "TOTAL CHECKING",
                mask: "1234",
            }),
            "Chase - TOTAL CHECKING (1234)"
        );
    });

    it("avoids duplicating bank name already in account label", () => {
        assert.equal(
            buildActualAccountName("Chase", {
                name: "Chase Freedom",
                mask: "9999",
            }),
            "Chase Freedom (9999)"
        );
    });
});

describe("buildActualAccountPayload", () => {
    it("returns createAccount-ready fields", () => {
        const payload = buildActualAccountPayload("Ally", {
            name: "Spending",
            type: "depository",
            subtype: "checking",
            mask: "0001",
        });
        assert.equal(payload.name, "Ally - Spending (0001)");
        assert.equal(payload.type, "checking");
        assert.equal(payload.offbudget, false);
    });
});
