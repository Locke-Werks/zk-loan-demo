# How I approached this

I was asked how I think and how I go at problems. The honest answer is in what happened over five days building this, including the parts that went sideways, so that is what this document is. Dates are November 2026.

## The brief I gave myself

I had a second interview with Input Output coming and wanted to show something that proved I understood what Midnight is for, not just that I can follow a tutorial. Midnight's pitch is "rational privacy": keep data private by default, disclose what a counterparty or a regulator actually needs, and prove the rest. So the demo had to do three things:

1. Show a real zero-knowledge contract doing a real job on a real Midnight network.
2. Show what is public and what is not, in a way a person can see on one screen.
3. Show the attacks failing. A privacy system that only demonstrates its happy path has demonstrated nothing.

Lending was the right domain. Credit decisions are exactly where people get asked for far more data than the decision needs, and "prove you clear the bar without showing me the file" is an idea anyone in the room already understands.

## Decision 1: don't write the contract

The obvious move was to write my own Compact contract. I didn't, and this was the most important call in the project.

Midnight Foundation publishes a `zk-loan` example that already does what I wanted: a bureau signs a credit profile off chain, the contract verifies that Schnorr signature inside the circuit, runs tier rules on the private data, and discloses only the outcome. Writing my own version a few days out would have meant demoing my first Compact contract, unreviewed, to the people who designed the language. Every minute spent on syntax would be a minute not spent on the part that actually shows judgment: understanding the model, finding where it holds, and finding where it doesn't.

So the contract is theirs and unmodified. What I built is the instrument around it (the console), the adversarial walkthrough, and the analysis in `THREAT-MODEL.md`, including the limitations the example doesn't address. I'd rather be obviously right about someone else's well-built contract than subtly wrong about my own.

## Decision 2: prove the stack works before planning anything on top of it

Before designing a single beat of the demo I ran a go/no-go spike: get Midnight's hello-world template deployed to a local network, end to end, on my machine. If the tooling fought me, I wanted to know on day one, not the night before.

It fought me immediately, in useful ways:

- **No Docker on Windows, and no Compact compiler for Windows at all.** The proof server only ships as a container. I moved everything into WSL Debian, installed Docker Engine there, and started the daemon by hand because systemd is off in that distro. That last bit matters later: Docker doesn't survive a WSL restart, so it's a step in the runbook rather than an assumption.
- **Compiler/runtime mismatch.** The latest compiler (0.36.1) emitted code the template's runtime library rejected ("expects 0.21.0, runtime is 0.16.0"). The template's own generator pinned 0.31.1, so I pinned to that and the deploy went through.

The spike passed. That told me the demo was doable. It also left me with a quiet assumption I hadn't checked, which bit me next.

## The version archaeology

Next I pointed the same template at Preprod, the public testnet closest to mainnet, because a contract you can look up on a public explorer is more convincing than one on my laptop. Three failures, in order:

1. **The Preprod indexer returned HTTP 410 Gone.** It had been decommissioned on 2026-10-09, and Preprod access had moved behind Blockfrost, which needs a project key in every request.
2. **With a key, the wallet couldn't parse what the network sent back** (`Wallet.Sync ParseError`).
3. Digging into that, I found the real cause: **Midnight had moved to ledger 9 in November, and Preprod had been upgraded in place on 2026-11-09.** The template's whole stack (wallet SDK 1.2, midnight-js 4.1, compiler 0.31) was ledger 8. Ledger 8 tooling can't transact on any public network anymore.

The pin I'd been pleased with in the spike was pinning me to the past. The lesson I took: **a working template tells you the template's world was consistent at the time it was published. It tells you nothing about the network today.** Check the network's current state before trusting the scaffold.

The fix wasn't to patch the template forward version by version. Midnight's official examples repository tracks the current ledger and keeps every pin in one place (`toolchain.json`) with a check that the copies agree. I moved to that. Compiler 0.36.1, ledger 9 SDKs, compiled clean, 75 simulator tests passing.

## Decision 3: local network, not Preprod

I generated Preprod wallets, funded one through the faucet (which has a captcha, so a human has to do it), and started the upstream on-chain test suite against Preprod. The wallet sat syncing for over ten minutes without finishing. The SDK has a fast-sync path that should get a fresh wallet ready in about six minutes; a sync from genesis takes about seventy.

I could have kept pushing. Instead I asked what the demo actually needed. On a live call, Preprod adds a public network I don't control, a slow first sync, a captcha-gated faucet and a third-party API key, and in exchange I'd get a block explorer link. None of that changes what the demo proves. A local Midnight network (the same node, indexer and proof server images, in Docker) runs the identical contract through the identical proof system, and nobody's testnet outage can sink it.

So: local for the live demo, and the Preprod path stays wired up (`MIDNIGHT_NETWORK=preprod`) for anyone who wants to run it there. I'd make the same call again. Scope cut for reliability, not for convenience; the thing being demonstrated didn't shrink.

## Decision 4: verify the foundation before building on it

Before writing any of the console, I ran the upstream on-chain suite against the local network: deploy, provider registration, approvals, counter-offers, blacklisting, PIN migration, admin rotation. 10 of 10 passed.

It also gave me a number I didn't have: **each transaction takes about 20 seconds** (proof generation plus the block landing), against the "several seconds" I'd been assuming. That number changed the design. Twenty seconds of silence on a call is a long time, so every proving step in the demo got a talking point sized to fill it.

## Designing the console

The first version was a scripted walkthrough: press Enter, the next beat runs. Easy to build, impossible to get wrong on stage.

It was also wrong for the audience. Watching someone press Enter proves they can press Enter. I wanted to type the commands live, so the room can see nothing is canned and can ask "what if you tried X" and get an answer on the spot.

That forced a design question. Every new process would have to sync a wallet before doing anything, so separate CLI commands per step would mean dead air on every step. So the console does the slow setup once (sync the fee wallet, start the bureau, deploy, register the bureau's key) and then hands over a prompt:

```
profile <name> <score> <income> <months>
apply <name> <amount>
forge <name> <score>
steal <thief> <victim>
accept | decline <name> <loanId>
ledger
```

The verbs come straight from the threat model rather than from the contract's API. `forge` and `steal` aren't contract operations, they're attacks, and making them first-class commands is the point: the console is for exploring the attack surface, not just the happy path.

A few smaller choices I'd defend:

- **Parties are created on first mention.** Type a name and that person exists, with their own 32-byte secret. No setup ceremony, and it makes the identity model visible: every person is a secret, not a wallet.
- **Every result says PUBLIC or PRIVATE.** The whole argument is about where data lives, so the output labels it every time.
- **Failures print the actual assert.** "BLOCKED: Invalid attestation signature" beats a generic error, and it lets you point at the exact line of Compact that stopped the attack.

## The bug that would have hurt live

To test the console I piped the full demo script into it. It hung forever at the first prompt.

Cause: Node's `readline.question()` only receives a line if a question is already waiting for it. Piped input arrived all at once during setup, while nothing was asking, and those lines were silently dropped. The console then waited for input that had already come and gone.

That isn't a test-harness quirk. It's the exact situation of a presenter who types the next command while a 20-second proof is still running, which I would absolutely have done on the call. The automated run surfaced a live failure mode before it ever got the chance to happen in front of people.

The fix was to consume input through readline's async iterator, which buffers every line, and to create the reader before setup starts so nothing typed early is lost. Then I reran every beat end to end and checked the real output against the run-of-show line by line. Two things in the script changed as a result: the rejected applicant's proof actually *passes* (what's proven is that he doesn't qualify, which turned out to be a better talking point than the one I'd written), and forged and stolen credentials fail instantly on the attacker's own machine, before a proof is ever generated, so the chain never hears about them.

## Packaging it to stand on its own

The example lives inside a monorepo and leaned on it in places that weren't obvious until it was moved: a shared base `tsconfig`, npm overrides at the repo root pinning ledger 9 packages, and two `../../` paths for env files and wallet state. Each was a small fix, and each is listed in `NOTICE` so the delta from upstream is auditable.

One more trip-up: `npm install` on npm 10 crashed with `Cannot read properties of null (reading 'edgesOut')`. My first guess (an override colliding with a direct dependency) was wrong. The real answer was already sitting in the upstream repo: `toolchain.json` pins npm 11.21.0. With that version it installed clean. Second lesson in the same project about the same thing: **when a project bothers to pin a tool version, the pin is information, not decoration.**

## Credential hygiene

Two things worth recording because they're how real leaks happen:

- The RPC client logs full request URLs, and Blockfrost takes its key as a query parameter, so the key ends up in plain text in the logs. I redacted the logs with `sed` before anything was shared, and treated the key as exposed.
- Wallet seeds live in a gitignored, mode-600 env file and nowhere else. This repository's `.gitignore` excludes every `.env.*` file and the wallet state cache, and I checked the tree before the first push.

## What I'd do next

In the order I'd do them, with the reasoning in `THREAT-MODEL.md`:

1. **Expiry or revocation on attestations.** A bureau signature is valid forever. Add an epoch to the signed message and check it in-circuit against a ledger value.
2. **Unlinkable applications.** All of a borrower's loans under one PIN share an on-chain key, so they're linkable to each other. A per-application nullifier design would fix that.
3. **More than one bureau.** Right now one key is the whole trust root. Threshold attestation from several providers removes the single point of failure.
4. **Run it on Preprod as a standing deployment**, so anyone can look up the contract on a public explorer.
