#!/usr/bin/env node
global.navigator = global.navigator || { platform: "", userAgent: "" };
const meow = require("meow");
const actualPlaid = require("./cli.js");
const cli = meow(
    `
  Usage
    $ actualplaid <command> <flags>

  Commands & Options
    setup            Link bank accounts with your Actual Budget accounts via Plaid
    ls               List currently syncing accounts
    import           Sync bank accounts to Actual Budget via /transactions/sync
      --account, -a  The account to import, ex: --account="My Checking"
      --since, -s    Optional lower-bound date filter (yyyy-MM-dd). Cursor still advances.
    config           Print the location of the actualplaid config file
    check            Compare the Actual Budget balance to the synced accounts
    test-notify      Send a test Pushover notification to verify PUSHOVER_TOKEN/PUSHOVER_USER_KEY are configured correctly
    --version        Print the version of actualplaid being used


  Options for all commands
    --user, -u       Specify the user to load configs for 

  Examples
    $ actualplaid import --account="My Checking" --since="2020-05-28"
`,
    {
        flags: {
            user: {
                alias: "u",
                type: "string",
            },
            account: {
                alias: "a",
                type: "string",
            },
            since: {
                alias: "s",
                type: "string",
            },
        },
    }
);

actualPlaid(cli.input[0], cli.flags);
