<div align="center">

<img src="assets/zk-loan-demo.png" width="96" alt="ZK Loan Demo">

# ZK Loan Demo

**Prove you qualify for a loan without handing over your credit file. Then try to cheat and watch where it breaks.**

[![license](https://img.shields.io/badge/license-Apache--2.0-d6262a?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Midnight%20(ledger%209)-d6262a?style=flat-square)](#requirements)
[![compact](https://img.shields.io/badge/compact-0.36.1-d6262a?style=flat-square)](#requirements)

</div>

---

A privacy-preserving lending contract on [Midnight](https://midnight.network), driven from an interactive console I built to show the idea to people live, typed in real time.

A borrower holds a credit profile signed by a credit bureau. To borrow, they prove in zero knowledge that the bureau really signed that profile, for them, and that it clears a lending tier. The chain records the outcome (approved, rejected, or a counter-offer and its amount) and nothing else. Score, income and tenure never leave the borrower's machine.

Then the console lets you try to break it: forge the profile after signing, steal someone else's valid credential, apply while unqualified. Each attempt fails in a specific place for a specific reason, and the docs say which and why. They also say where the design doesn't hold up, because it doesn't everywhere.

## What is in here, and whose it is

| Part | Origin |
|---|---|
| `contract/` (the Compact contract and the in-circuit Schnorr verifier), `attestation-api/`, `src/wallet.ts`, `src/providers.ts`, `src/config.ts`, the test suites | Midnight Foundation's `zk-loan` example from [midnightntwrk/midnight-examples](https://github.com/midnightntwrk/midnight-examples) at commit `df56a534`, Apache-2.0. The contract is **unmodified**. |
| `src/demo.ts`, the interactive console | Mine. |
| `docs/` (except `UPSTREAM-README.md`) | Mine. |
| Standalone packaging: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, two relative paths in `src/wallet.ts` | Adapted by me so the example builds outside the monorepo. Listed in [NOTICE](NOTICE). |

Using the reviewed upstream contract instead of writing a new one was a deliberate choice, explained in [docs/APPROACH.md](docs/APPROACH.md). The work here is understanding the model, finding where it holds and where it does not, and making that visible.

## Read in this order

1. **[docs/APPROACH.md](docs/APPROACH.md)**: how I went at the problem, what broke, and what I decided at each fork and why. If you only read one, read this.
2. **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**: the contract walked through line by line: identity, the witness, the in-circuit signature check, what gets disclosed and what does not.
3. **[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)**: parties, assets, every attack the console demonstrates, and the limitations I found that the contract does not address.
4. **[docs/RUNNING.md](docs/RUNNING.md)**: setup, commands, Preprod, and troubleshooting.
5. **[docs/sample-session.txt](docs/sample-session.txt)**: a real, unedited console session, so you can see the output without installing anything.

## Quick start

Linux or WSL2, Docker, Node 22+, and the Compact toolchain. Details in [docs/RUNNING.md](docs/RUNNING.md).

```
npx -y npm@11.21.0 install
npm run compile        # 8 circuits, a few minutes the first time
npm run test:sim       # 75 tests, no chain needed
npm run env:up         # local node, indexer and proof server in Docker
npm run demo           # the console
```

At the `zkloan>` prompt:

```
profile alice 720 2500 36     # the bureau signs Alice's profile
apply alice 5000              # ZK proof, about 20 s, then: Approved 5000
profile bob 560 1300 8
forge bob 800                 # Bob edits his score after signing
apply bob 9000                # BLOCKED: Invalid attestation signature
steal carol alice             # Carol copies Alice's valid credential
apply carol 5000              # BLOCKED: same assert, different reason
ledger                        # everything an observer can see
```

## Requirements

| Tool | Version used |
|---|---|
| Compact compiler | 0.36.1 (Compact CLI 0.5.3) |
| Midnight node / indexer / proof server | 2.1.101 / 4.4.101 / 9.0.2 (Docker images, see `compose.yml`) |
| midnight-js / wallet-sdk | 5.0.1 / 2.0.1 |
| Node | 22 or later |
| npm | 11.21.0. npm 10 crashes on this dependency tree; see RUNNING.md |
| Docker | Engine plus the Compose plugin |

These are ledger 9 versions. Midnight moved to ledger 9 in November 2026, and ledger 8 tooling cannot transact on any public network; [docs/APPROACH.md](docs/APPROACH.md) has the story of finding that out.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
