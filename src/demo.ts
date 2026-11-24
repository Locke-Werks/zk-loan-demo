// Live interview console for the zk-loan contract on a local Midnight network.
//
// Setup (wallet sync, attestation provider, deploy, provider registration) runs
// once and takes a minute or two, so start this before the call. After setup it
// opens a `zkloan>` prompt; type `help` for the commands.
//
//   npm run demo

import { randomBytes } from 'node:crypto';
import * as readline from 'node:readline/promises';
import { WebSocket } from 'ws';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  CompactTypeBytes,
  transientHash,
} from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet, resolveWallet } from './wallet.js';
import { buildProviders, ledgerState, type ZkLoanProviders } from './providers.js';
import { createZkLoanPrivateState, type ZkLoanPrivateState } from '../contract/witnesses.js';
import { CompiledZkLoanContract, LoanStatus, ledger, pureCircuits, zkConfigPath } from '../contract/index.js';
import { createServer } from '../attestation-api/server.js';
import { generateKeyPair } from '../attestation-api/signing.js';
import type { AttestationResponse, ProviderInfoResponse } from '../attestation-api/types.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const PROVIDER_ID = 1n;
const bytes32 = new CompactTypeBytes(32);
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const short = (b: Uint8Array) => `${hex(b).slice(0, 10)}...${hex(b).slice(-6)}`;
const statusName = (s: number) => LoanStatus[s] ?? String(s);
const say = (s: string) => console.log(`  ${s}`);
const ok = (s: string) => console.log(`  ${C.green('PASS')}  ${s}`);
const blocked = (s: string) => console.log(`  ${C.red('BLOCKED')}  ${s}`);

function firstLine(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n').find((l) => l.trim().length > 0)?.trim().slice(0, 160) ?? m;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  process.stdout.write(`  ${C.dim(label + ' ...')}`);
  const done = () => process.stdout.write(C.dim(` ${((Date.now() - t0) / 1000).toFixed(1)}s\n`));
  try {
    const r = await fn();
    done();
    return r;
  } catch (e) {
    done();
    throw e;
  }
}

const HELP = `
  profile <name> <score> <income> <months>   bureau signs a credit profile for <name>
  show <name>                                what is on <name>'s machine (private)
  apply <name> <amount>                      prove eligibility and request a loan
  forge <name> <score>                       edit <name>'s score after the bureau signed it
  steal <thief> <victim>                     thief copies victim's signed credential
  accept <name> <loanId>                     accept a Proposed counter-offer
  decline <name> <loanId>                    decline a Proposed counter-offer
  ledger                                     everything the public ledger holds
  clear                                      clear the screen
  exit                                       stop
  Tiers: 700+/2000+/24mo = 10,000   600+/1500+ = 7,000   580+ = 3,000   else rejected`;

async function main() {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  const config = getConfig();
  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  // Created before setup so anything typed while setup runs is queued, not lost.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();

  console.log(C.bold(`\n  zk-loan setup (network: ${network})`));
  const setup = resolveWallet(network);
  const wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret);
  await timed('Starting fee wallet', () => wallet.start());
  await timed('Syncing fee wallet', () => syncWallet(logger, wallet.wallet, 10 * 60_000));
  const providers: ZkLoanProviders = buildProviders(wallet, zkConfigPath, config);

  const attestation = createServer(generateKeyPair().sk, Number(PROVIDER_ID));
  await new Promise<void>((r) => attestation.listen(0, '127.0.0.1', r));
  const addr = attestation.address();
  const attestationUrl = `http://127.0.0.1:${typeof addr === 'string' ? addr : addr.port}`;

  const lenderSecret = new Uint8Array(randomBytes(32));
  const deployed = await timed('Deploying zk-loan contract (lender becomes admin)', () =>
    deployContract(providers, {
      compiledContract: CompiledZkLoanContract,
      privateStateId: 'lender',
      initialPrivateState: createZkLoanPrivateState(lenderSecret),
    }),
  );
  const contractAddress: ContractAddress = deployed.deployTxData.public.contractAddress;

  const call = (id: string, circuitId: string, ...args: unknown[]) =>
    submitCallTx(providers, {
      compiledContract: CompiledZkLoanContract,
      contractAddress,
      privateStateId: id,
      circuitId,
      args,
    } as any);
  const setPrivate = (id: string, st: ZkLoanPrivateState) =>
    providers.privateStateProvider.forContract(contractAddress).set(id, st);
  const query = async () => ledger(ledgerState(await providers.publicDataProvider.queryContractState(contractAddress)));

  const info = (await (await fetch(`${attestationUrl}/provider-info`)).json()) as ProviderInfoResponse;
  await timed('Lender registers the bureau public key on chain', () =>
    call('lender', 'registerProvider', PROVIDER_ID, { x: BigInt(info.publicKey.x), y: BigInt(info.publicKey.y) }),
  );

  // Each party has a private 32-byte secret and a PIN; their on-chain identity
  // is a hash of both. Created on first mention.
  type Party = { secret: Uint8Array; pin: bigint; state?: ZkLoanPrivateState };
  const parties = new Map<string, Party>();
  const party = (name: string): Party => {
    const key = name.toLowerCase();
    let p = parties.get(key);
    if (!p) {
      p = { secret: new Uint8Array(randomBytes(32)), pin: BigInt(1000 + parties.size * 1111) };
      parties.set(key, p);
    }
    return p;
  };
  const userPk = (p: Party) => pureCircuits.deriveUserPublicKey(p.secret, p.pin);
  const label = (n: string) => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();

  function showPrivate(name: string) {
    const p = party(name);
    if (!p.state) return say(`${label(name)} has no signed profile yet. Use: profile ${name} <score> <income> <months>`);
    const st = p.state;
    say(`${C.yellow(`PRIVATE, ${label(name)}'s machine only:`)}  score ${st.creditScore}, income ${st.monthlyIncome}/mo, ${st.monthsAsCustomer} months`);
    say(C.dim(`bureau signature: R.x=${st.attestationSignature.announcement.x.toString().slice(0, 14)}...  s=${st.attestationSignature.response.toString().slice(0, 14)}...`));
  }

  async function showLoans(name: string) {
    const st = await query();
    const key = userPk(party(name));
    if (!st.loans.member(key)) return say(`${C.cyan('PUBLIC ledger:')}  no record for borrower ${short(key)}`);
    const m = st.loans.lookup(key);
    for (let id = 1n; id <= m.size(); id++) {
      if (!m.member(id)) continue;
      const l = m.lookup(id);
      say(`${C.cyan('PUBLIC ledger:')}  borrower ${short(key)}  loan #${id}  ${C.bold(statusName(l.status))}  amount ${l.authorizedAmount}`);
    }
  }

  const commands: Record<string, (a: string[]) => Promise<void>> = {
    async help() {
      console.log(HELP);
    },
    async clear() {
      console.clear();
    },
    async profile([name, score, income, months]) {
      if (!months) return say('Usage: profile <name> <score> <income> <months>');
      const p = party(name);
      // The bureau sees the hash of the borrower's derived key, never the secret or PIN.
      const userPubKeyHash = transientHash(bytes32, userPk(p));
      const res = await fetch(`${attestationUrl}/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creditScore: Number(score),
          monthlyIncome: Number(income),
          monthsAsCustomer: Number(months),
          userPubKeyHash: userPubKeyHash.toString(),
        }),
      });
      if (res.status !== 200) return blocked(`Bureau refused: HTTP ${res.status}`);
      const { signature } = (await res.json()) as AttestationResponse;
      p.state = {
        creditScore: BigInt(score),
        monthlyIncome: BigInt(income),
        monthsAsCustomer: BigInt(months),
        attestationSignature: {
          announcement: { x: BigInt(signature.announcement.x), y: BigInt(signature.announcement.y) },
          response: BigInt(signature.response),
        },
        attestationProviderId: PROVIDER_ID,
        userSecretKey: p.secret,
      };
      await setPrivate(name.toLowerCase(), p.state);
      ok(`Bureau signed ${label(name)}'s profile, bound to identity ${short(userPk(p))}`);
      showPrivate(name);
    },
    async show([name]) {
      if (!name) return say('Usage: show <name>');
      showPrivate(name);
    },
    async apply([name, amount]) {
      if (!amount) return say('Usage: apply <name> <amount>');
      const p = party(name);
      if (!p.state) return say(`${label(name)} has no profile. Use: profile ${name} <score> <income> <months>`);
      try {
        await timed(`${label(name)} proves locally and submits a request for ${amount}`, () =>
          call(name.toLowerCase(), 'requestLoan', BigInt(amount), p.pin),
        );
        ok('Proof verified on chain.');
      } catch (e) {
        blocked(`No valid proof. ${C.dim(firstLine(e))}`);
      }
      await showLoans(name);
    },
    async forge([name, score]) {
      if (!score) return say('Usage: forge <name> <score>');
      const p = party(name);
      if (!p.state) return say(`${label(name)} has no profile to forge.`);
      say(`${label(name)} changes score ${p.state.creditScore} to ${C.bold(score)}. The bureau signature is unchanged.`);
      p.state = { ...p.state, creditScore: BigInt(score) };
      await setPrivate(name.toLowerCase(), p.state);
      showPrivate(name);
    },
    async steal([thief, victim]) {
      if (!victim) return say('Usage: steal <thief> <victim>');
      const v = party(victim);
      if (!v.state) return say(`${label(victim)} has no credential to steal.`);
      const t = party(thief);
      t.state = { ...v.state, userSecretKey: t.secret };
      await setPrivate(thief.toLowerCase(), t.state);
      say(`${label(thief)} now holds a byte-for-byte copy of ${label(victim)}'s profile and bureau signature.`);
      showPrivate(thief);
    },
    async accept([name, id]) {
      if (!id) return say('Usage: accept <name> <loanId>');
      try {
        await timed(`${label(name)} accepts loan #${id}`, () => call(name.toLowerCase(), 'respondToLoan', BigInt(id), party(name).pin, true));
      } catch (e) {
        blocked(C.dim(firstLine(e)));
      }
      await showLoans(name);
    },
    async decline([name, id]) {
      if (!id) return say('Usage: decline <name> <loanId>');
      try {
        await timed(`${label(name)} declines loan #${id}`, () => call(name.toLowerCase(), 'respondToLoan', BigInt(id), party(name).pin, false));
      } catch (e) {
        blocked(C.dim(firstLine(e)));
      }
      await showLoans(name);
    },
    async ledger() {
      const st = await query();
      say(C.bold('Everything on the public ledger for this contract:'));
      say(`contract            ${contractAddress}`);
      say(`admin (hash only)   ${short(st.contractAdmin)}`);
      say(`registered bureaus  ${st.providers.size()}`);
      say(`borrowers           ${st.loans.size()}`);
      for (const [name, p] of parties) {
        if (st.loans.member(userPk(p))) await showLoans(name);
      }
      say(C.dim('No names, scores, incomes, tenures or wallet links. Those columns do not exist.'));
    },
  };

  console.log(`\n  ${C.green('READY')}  contract ${C.bold(contractAddress)}`);
  console.log(C.dim('  type help for commands'));

  // The async iterator buffers lines, so nothing typed during a long proof or
  // during setup is dropped; rl.question discards lines that arrive early.
  const prompt = `\n${C.cyan('zkloan>')} `;
  rl.setPrompt(prompt);
  rl.prompt();
  for await (const raw of { [Symbol.asyncIterator]: () => lines }) {
    const line = raw.trim();
    if (!process.stdin.isTTY) console.log(line);
    if (!line) {
      rl.prompt();
      continue;
    }
    const [cmd, ...args] = line.split(/\s+/);
    if (cmd === 'exit' || cmd === 'quit') break;
    const fn = commands[cmd.toLowerCase()];
    if (!fn) {
      say(`Unknown command "${cmd}". Type help.`);
      rl.prompt();
      continue;
    }
    try {
      await fn(args);
    } catch (e) {
      say(C.red(`Error: ${firstLine(e)}`));
    }
    rl.prompt();
  }
  rl.close();
  await new Promise<void>((r) => attestation.close(() => r()));
  await wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(C.red(`\nSetup failed: ${firstLine(e)}`));
  console.error(e);
  process.exit(1);
});
