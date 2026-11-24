# How it works

The contract is `contract/zk-loan.compact`, about 300 lines of Compact plus the Schnorr verifier in `contract/schnorr.compact`. This walks through what matters in it, in the order a loan request actually flows. Read it with the source open.

## Three parties

- **The borrower.** Holds a private 32-byte secret and a PIN. Never reveals either.
- **The bureau** (the attestation provider in `attestation-api/`). Holds a Jubjub key pair. Looks at a borrower's credit data off chain and signs it.
- **The lender.** Deployed the contract and is its admin. Decides which bureaus to trust by registering their public keys on chain. Sees outcomes, never profiles.

The wallet that pays transaction fees is a fourth thing, and deliberately not an identity. More on that below.

## Identity is a hash, not a wallet

```compact
export pure circuit deriveUserPublicKey(sk: UserSecretKey, pin: Uint<16>): UserPublicKey {
    const pinBytes = persistentHash<Uint<16>>(pin);
    return persistentHash<[Bytes<17>, Bytes<32>, UserSecretKey]>([
        "zkloan:user:pk:v1",
        pinBytes,
        sk
    ]) as UserPublicKey;
}
```

A borrower's on-chain identity is a hash of their secret and PIN, with a domain-separation string so the same secret can never collide with the admin key derivation. The contract keys loans by this value.

The comment at the top of the contract explains why it doesn't use Midnight's `ownPublicKey()`: that returns a value the prover claims, with no cryptographic binding to whoever signs the transaction. Anything that depends on it can be bypassed. Deriving identity from a secret that has to be known to produce the proof closes that.

The consequence I find most interesting: **the wallet paying the fee has nothing to do with who is borrowing.** In the demo, one wallet pays every fee for every party. The ledger can't tell Alice from Carol by wallet, because wallets aren't identities here.

## The witness: private data comes in from outside the circuit

```compact
witness getAttestedScoringWitness(): [Applicant, Schnorr_SchnorrSignature, Uint<16>];
witness getUserSecret(): UserSecretKey;
```

A witness is a function that runs on the prover's machine and feeds private values into the circuit. Witness output is **untrusted input**: the borrower controls their own machine and can make it return anything. The whole design rests on what the circuit does with those values before trusting them. The TypeScript side of the witnesses is in `contract/witnesses.ts`, and it just hands back what's in the borrower's private state. That's exactly the thing `forge` and `steal` tamper with.

## requestLoan, step by step

```compact
export circuit requestLoan(amountRequested: Uint<16>, secretPin: Uint<16>): [] {
    assert(amountRequested > 0, "Loan amount must be greater than zero");
    const requesterPubKey = deriveUserPublicKey(getUserSecret(), secretPin);
    const disclosedRequesterPubKey = disclose(requesterPubKey);
    assert(!blacklist.member(disclosedRequesterPubKey), "Requester is blacklisted");
    ...
    const userPubKeyHash = transientHash<Bytes<32>>(disclosedRequesterPubKey as Bytes<32>);
    const [topTierAmount, status] = evaluateApplicant(userPubKeyHash);
    const disclosedTopTierAmount = disclose(topTierAmount);
    const disclosedStatus = disclose(status);
    createLoan(disclosedRequesterPubKey as Bytes<32>, amountRequested, disclosedTopTierAmount, disclosedStatus);
}
```

1. Derive the borrower's key from the private secret and PIN, and **disclose** it, because it's the public key of the loan map. The secret and PIN stay private; only the hash goes out.
2. Check the blacklist and that no PIN migration is in flight.
3. Hash the borrower's key. This hash is what the bureau signed, and it's how a signature gets bound to one person.
4. Run the private evaluation.
5. Disclose **only** the tier cap and the status, and record the loan.

### disclose() is the whole privacy argument

In Compact, anything derived from witness data has to pass through `disclose()` before it can touch public state. The compiler enforces that. So the complete list of what this circuit leaks is the list of `disclose` calls: the derived borrower key, the tier cap, the status. You can audit the privacy of the contract by grepping for one word. That's the property I'd point at first if someone asked why Compact is a good idea.

## evaluateApplicant: verify, then decide

```compact
circuit evaluateApplicant(userPubKeyHash: Field): [Uint<16>, LoanStatus] {
    const [profile, signature, providerId] = getAttestedScoringWitness();
    assert(providers.member(disclose(providerId)), "Attestation provider not registered");
    const providerPk = providers.lookup(disclose(providerId));

    const msg: Vector<4, Field> = [
        profile.creditScore as Field,
        profile.monthlyIncome as Field,
        profile.monthsAsCustomer as Field,
        userPubKeyHash
    ];
    Schnorr_schnorrVerify<4>(msg, signature, providerPk);

    if (profile.creditScore >= 700 && profile.monthlyIncome >= 2000 && profile.monthsAsCustomer >= 24) {
        return [10000, LoanStatus.Approved];
    } ...
}
```

This is where the forgery and theft attacks die:

- The bureau must be registered on chain by the lender. A key the lender never registered gets nothing.
- The signed message is **four** fields: the three profile numbers *and* the hash of the borrower's key. Change any profile number and the signature no longer verifies. Use the signature under a different identity and the fourth field doesn't match. Both fail the same assert, for different reasons.
- `schnorrVerify` runs **inside the circuit**. The point isn't that the chain checks a signature. It's that a proof can't be built at all unless the signature is valid over exactly this data. That's why forged and stolen requests fail instantly, on the attacker's own machine, without ever reaching the network.

Only after verification does the tier logic run, and only its output leaves.

The bureau, for its part, never sees the borrower's secret or PIN. It receives the hash of the derived key (`attestation-api/server.ts`) and signs over it.

## createLoan: outcomes and the counter-offer

If the request is over the tier cap, the loan is recorded as **Proposed** at the cap rather than rejected, and the borrower calls `respondToLoan` to accept or decline. The lender learns the maximum the borrower qualifies for, not the profile behind it. That's a real disclosure, and a reasonable one: a lender has to know what it's offering.

A rejection is recorded too, as `Rejected` with amount 0. The proof for a rejected application **verifies**: what's been proven is that this borrower doesn't qualify. The chain learns that, and not why.

## Admin operations

`registerProvider`, `removeProvider`, `blacklistUser`, `removeBlacklistUser` and `rotateAdmin` each start with:

```compact
assert(contractAdmin == deriveAdminPublicKey(getUserSecret()), "...");
```

The admin key on chain is a hash. Anyone can read it; only someone who knows the secret behind it can produce a proof that satisfies this equality. Rotating admin hands the role to a new public key, so no private key ever changes hands.

## What the console adds

`src/demo.ts` doesn't change any of this. It:

- runs the slow setup once (fee wallet sync, deploy, bureau registration),
- creates parties on first mention, each with a fresh random secret and PIN,
- calls the bureau over HTTP exactly as the upstream tests do,
- writes private state through the same private state provider the witnesses read from, which is how `forge` and `steal` work: they edit the borrower's local state, the way a real attacker with a copy of the data would,
- reads the public ledger back after each call and labels every line PUBLIC or PRIVATE.
