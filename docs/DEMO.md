# Presenting it live

This is the run of show I wrote for presenting it: about seven minutes, typed live, with what to say while each proof runs. It's here because how you present a security property is part of whether people believe it.

## Before you start

```
sudo service docker start          # WSL without systemd: Docker doesn't survive a restart
cd zk-loan-demo
npm run env:up
npm run demo
```

Wait for `READY  contract <address>`, which takes under a minute. Some `RPC-CORE ... Normal Closure` lines during the wallet sync are noise. Bump the terminal font, type `clear`, then share.

**Timing:** `apply`, `accept` and `decline` take about 20 seconds each (local proof, then the block lands). That pause is where the talking goes. Blocked attempts fail instantly. Everything else is instant. Typing ahead during a proof is safe; input is queued.

## The beats

Type the left column. Say the right one.

### 1. Setup already happened

| Type | Say |
|---|---|
| (point at READY) | A lender deployed this contract and registered one credit bureau's public key. Three parties: a borrower, a bureau that signs facts about the borrower, and a lender who only needs a yes or a no. |

### 2. Honest applicant

| Type | Say |
|---|---|
| `profile alice 720 2500 36` | The bureau signs Alice's profile. It signs over a hash of her on-chain identity, so the credential is bound to her. It never sees her secret. |
| `apply alice 5000` | Her machine builds a proof: this profile carries a valid bureau signature, for this identity, and it clears a tier. The signature check runs inside the circuit. |
| (point at PUBLIC line) | Approved, 5,000. That line is everything the chain knows. |

### 3. Below threshold

| Type | Say |
|---|---|
| `profile dave 540 1200 6` | Honestly signed, doesn't qualify. |
| `apply dave 3000` | |
| (point at PASS, then Rejected) | The proof *passed*. What it proved is that Dave doesn't qualify. Rejected on chain, and nobody can tell whether it was score, income or tenure. |

### 4. Forgery

| Type | Say |
|---|---|
| `profile bob 560 1300 8` | A legitimate signature on a weak profile. |
| `forge bob 800` | Bob edits his own private state. On a normal system he'd just submit this. |
| `apply bob 9000` | |
| (point at BLOCKED, 0.1s) | Instant, on his own machine. No valid proof can be built, so there's nothing to submit and the chain never hears about it. Unprovable rather than rejected. |

### 5. Stolen credential

| Type | Say |
|---|---|
| `steal carol alice` | Carol gets a byte-for-byte copy of Alice's approved credential. Every byte is genuine. |
| `apply carol 5000` | |
| (point at BLOCKED) | Same assert, different reason. The signature covers a hash of Alice's identity, and Carol can't derive that without Alice's secret. A leaked credential is worthless to anyone else. |

### 6. Over-ask (skip if short on time)

| Type | Say |
|---|---|
| `apply alice 15000` | More than her tier allows. |
| (point at Proposed 10000) | Counter-offer at the cap. The lender learns the cap, not the score behind it. |
| `accept alice 2` | |

### 7. What an observer sees

| Type | Say |
|---|---|
| `ledger` | Everything public. Opaque borrower keys, statuses, amounts. No names, scores or incomes, and identity comes from a secret, not from the wallet paying the fee. The outcome a regulator cares about is public; the personal data never touches the chain. |

### Close

Pick one and stop talking:

- "The gap I'd go after next is the bureau. Today one key is the whole trust root, and attestations never expire. Threshold attestation and in-circuit expiry fix both."
- "This pattern drops straight into KYC, accredited-investor checks or age gating: prove the predicate, publish the outcome, keep the data."

## Questions people ask

**Why not encrypt the data on chain?** Encrypted data is still data. Keys leak, and ciphertext ages badly. Here the data never goes on chain at all, only a proof and an outcome.

**Who trusts the bureau?** The lender does, explicitly, by registering its key. The circuit only accepts signatures from registered keys.

**What stops one person applying under a hundred identities?** Every identity needs its own bureau signature, so the bureau is the Sybil gate. There's also an admin blacklist.

**Are a borrower's loans linkable?** Yes, under one PIN. That's the biggest limitation; see THREAT-MODEL.md.

**Revocation?** Not in this contract. Signatures don't expire either. Both are in the threat model with the fix I'd use.

**How long does a proof take?** About 20 seconds here, including the block. Proving is on the borrower's machine; verification on chain is cheap.

**What's Compact?** Midnight's contract language, TypeScript-flavoured. Each circuit compiles to a ZK circuit plus TypeScript bindings. Private inputs come in through witnesses, and anything written to public state has to go through `disclose()`, so every leak is explicit in the source.

**Why local and not testnet?** Reliability in a live demo. Same contract, same proof system; `MIDNIGHT_NETWORK=preprod` runs it on Preprod.

## If it breaks

- **A proof hangs past 90 seconds:** Ctrl+C, `npm run demo` again. Setup is under a minute. Talk through `contract/zk-loan.compact` meanwhile.
- **Setup fails:** `npm run env:down`, `npm run env:up`, `npm run demo`.
- **Nothing runs:** put `evaluateApplicant` on screen and walk the witness, the in-circuit `schnorrVerify`, and the `disclose` calls. That carries the same argument without a chain.
