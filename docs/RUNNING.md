# Running it

Tested on Debian under WSL2 on Windows 11. Any Linux with Docker should work. macOS should too, since the Compact toolchain ships for it, but I haven't tried it.

## Prerequisites

- **Docker Engine with the Compose plugin.** The proof server only ships as a container. On WSL without systemd, start the daemon yourself: `sudo service docker start`. It doesn't survive `wsl --shutdown`.
- **Node 22 or later.**
- **npm 11.21.0.** npm 10.9 crashes on this dependency tree with `Cannot read properties of null (reading 'edgesOut')`. You don't need to install it globally: `npx -y npm@11.21.0 install` works.
- **The Compact toolchain**, compiler 0.36.1. Install the `compact` CLI from Midnight's docs, then `compact update 0.36.1`. Check with `compact compile --version`. There is no Windows build, which is the reason for WSL.

## Build and test without a chain

```
npx -y npm@11.21.0 install
npm run compile      # 8 circuits; generates contract/managed/ (gitignored)
npm run typecheck
npm run test:sim     # 75 tests against the contract simulator
```

`npm run compile:fast` skips proving key generation, which is enough for `test:sim` but not for anything that submits transactions.

## Local network

```
npm run env:up       # node 2.1.101, indexer 4.4.101, proof server 9.0.2
npm run test:local   # upstream on-chain suite: 10 tests, about 4 minutes
npm run demo         # the console
npm run env:down
```

The local node starts with a pre-funded genesis wallet, so there's nothing to fund.

## Preprod

Preprod is Midnight's public testnet. It's reachable through Blockfrost and needs a project key.

1. Get a Blockfrost project ID for Midnight Preprod.
2. Create `.env.preprod` in the repo root (gitignored) with `BLOCKFROST_PROJECT_ID=...` and the wallet seeds the tests expect: `MIDNIGHT_PREPROD_ALICE_SEED`, and the other roles if you use them. Keep it `chmod 600`.
3. Fund the Alice wallet from the faucet (https://midnight-tmnight-preprod.nethermind.dev/). It has a captcha, so a person does this step.
4. `npm run proof:up`, then `npm run test:preprod`, or `MIDNIGHT_NETWORK=preprod npm run demo`.

The first wallet sync is slow: minutes with the SDK's fast-sync path, over an hour from genesis. State is cached in `.wallet-state/` afterwards.

**Watch your logs.** The RPC client logs full URLs, and Blockfrost takes the key as a query parameter, so the key shows up in plain text. Pipe through `sed "s/project_id=[^& ]*/project_id=REDACTED/g"` before sharing anything.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker isn't running (WSL restarted) | `sudo service docker start` |
| `env:up` fails, port 6300, 8088 or 9944 in use | Another Midnight compose stack is up | `docker ps`, then `docker compose down` in that project |
| `npm install` dies with `edgesOut` | npm 10 | `npx -y npm@11.21.0 install` |
| Runtime version mismatch at deploy | Compiler and runtime from different releases | Recompile with 0.36.1; don't mix ledger 8 and 9 packages |
| Preprod indexer returns 410 | The old public indexer was retired in October 2026 | Use the Blockfrost endpoints in `src/config.ts` |
| `Wallet.Sync ParseError` on Preprod | Ledger 8 wallet SDK against a ledger 9 network | Use the versions in this repo |
| Console sits at setup for minutes | Wallet sync against a remote network | Expected on first Preprod run; local should take seconds |
