# Threat model

What this protects, against whom, how, and where it stops protecting anything. The limitations section is the part I'd spend the most time on in a review.

## Assets

| Asset | Who holds it | Should be visible to |
|---|---|---|
| Credit profile (score, income, tenure) | Borrower, and the bureau that attested it | Nobody else |
| Borrower secret and PIN | Borrower only | Nobody |
| Loan outcome (status, amount) | Public ledger | Everyone, by design |
| Bureau signing key | Bureau | Nobody |
| Admin secret | Lender | Nobody |

## Trust assumptions

- **The bureau signs honest data.** The contract proves a profile was signed. It can't prove the profile is true. That's the same trust a lender puts in a credit bureau today, made explicit and narrower.
- **The lender chooses bureaus well.** Registration is the trust root.
- **The borrower's machine is theirs.** Proving happens locally. A compromised borrower machine leaks that borrower's data, the same as anything else on it.
- **The proof system is sound.** Taken as given.

## Attacks the console demonstrates

| Attack | Console | Where it fails | Why |
|---|---|---|---|
| Inflate the profile after signing | `forge bob 800` then `apply bob 9000` | `Schnorr_schnorrVerify` in `evaluateApplicant` | The signature covers the exact profile numbers. Change one and no valid proof exists. Fails on the attacker's machine; nothing is ever submitted. |
| Use someone else's valid credential | `steal carol alice` then `apply carol 5000` | Same assert, different field | The signed message includes a hash of the borrower's derived key. Carol can't derive Alice's key without Alice's secret. A leaked credential is worthless to anyone else. |
| Apply while unqualified | `profile dave 540 1200 6` then `apply dave 3000` | Not an attack, a policy outcome | The proof verifies and records `Rejected`, amount 0. The reason stays private. |
| Ask for more than you qualify for | `apply alice 15000` | Contract logic | Recorded as `Proposed` at the cap. Only the cap is revealed. |

Covered by the upstream test suite rather than the console:

| Attack | Defence |
|---|---|
| Signature from an unregistered bureau | `providers.member` check before verification |
| Non-admin registers a bureau, blacklists, rotates admin | Every admin circuit proves knowledge of the admin secret |
| Blacklisted borrower applies | Blacklist check on the derived key |
| Applying under the old PIN during a PIN migration | Blocked until the migration completes |

## What an observer learns

From the ledger, per loan: an opaque borrower key, a loan number, a status, and an amount. Per contract: the admin key hash, the registered bureau keys, and the blacklist. Plus whatever the network itself reveals: transaction timing, and which wallet paid the fee (next section).

What an observer does **not** learn: any profile field, any secret or PIN, and which applications were rejected *for what reason*.

## Limitations

These are real, and I'd raise them myself rather than wait to be asked.

**1. A borrower's loans are linkable to each other.** Every loan under the same secret and PIN lands under the same key. An observer can count a borrower's loans, see their amounts and their history of rejections. `changePin` moves loans to a new key, but that transaction names the old and new keys together, so the link survives. Properly unlinkable applications would need a fresh per-application identifier with a nullifier to stop double use. That's a meaningful redesign, not a patch.

**2. Attestations never expire.** A bureau signature is valid forever. A borrower whose finances collapse can keep applying on a profile signed years ago. The fix is straightfoward: add an epoch or expiry to the signed message and check it in-circuit against a value on the ledger.

**3. No revocation short of removing the bureau.** If one attestation was issued in error, the only lever is `removeProvider`, which kills every attestation that bureau ever signed. Per-attestation revocation needs a revocation set the circuit can check non-membership against, ideally without revealing which attestation is being checked.

**4. One bureau is the entire trust root.** A compromised bureau key can mint approvals for anyone. Threshold attestation (k of n bureaus) would remove the single point of failure.

**5. The bureau sees everything.** The bureau learns the full profile, by definition, and sees a hash of the borrower's key. If it also watches the chain, it can link that key to the person it attested and then read that person's whole loan history (see 1). Privacy here is privacy from the *lender and the public*, not from the attester. Fixing that would mean blinded signing so the bureau never sees the key it's signing for.

**6. Fee payment is a separate privacy question.** In the demo, one wallet pays every party's fees, which is why the console can truthfully say there are no wallet links on the ledger. In a real deployment each borrower would pay their own fees, and how linkable that is depends on how Midnight's fee mechanism (DUST, generated by holding NIGHT) is used and which addresses are involved. I haven't analysed that properly, so I'm listing it as open rather than claiming an answer.

**7. Amounts are public.** Status and amount are disclosed. For a lender that's a reasonable trade, but a borrower's approved amounts are a decent proxy for their tier. If that matters, the tier could be committed to rather than revealed.

**8. Witness-side bugs are invisible to the chain.** The circuit only checks what it's told to check. If the off-chain code that builds private state had a bug (say, signing the wrong key hash), the contract would happily enforce the wrong thing. Here, `attestation-api/signing.ts` and the circuit compute the challenge with the same exported pure circuit (`schnorrChallenge`), which is exactly the kind of shared definition that prevents that class of drift.
