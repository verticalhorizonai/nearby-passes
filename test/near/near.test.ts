// Nearby Passes units: the testnet-only start-up guard (spec 3.6.9 test 7), the demo account (3.6.2), amounts, the
// agent's pass lines and amount check (3.6.5), the pass image (3.6.9 test 8), the outbound guard and the leak scan.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPairEd25519, baseEncode, keyToImplicitAddress } from 'near-api-js';
import { KNOWN_MAINNET_RPC_HOSTS, NearConfigError, loadNearConfig } from '../../src/services/near/nearConfig.js';
import { demoAccountId, demoSeed, ed25519PublicKey } from '../../src/services/near/demoAccount.js';
import { formatNear, nearText, parseNear } from '../../src/services/near/format.js';
import { amountNotCarried, validateAgentPicks } from '../../src/services/agent/outputValidation.js';
import { PASS_INSTRUCTIONS, SYSTEM_PROMPT, passForTool, systemPrompt } from '../../src/services/agent/agentLoop.js';
import { passReference, passSvg, STATUS_STYLE } from '../../src/services/passes/passImage.js';
import { installOutboundFetchGuard, OutboundBoundaryError } from '../../src/guards/outboundBoundary.js';
import { findLeaks } from '../../src/guards/credentialLeakScan.js';
import { nearEnv } from '../helpers/passesApp.js';
import type { ChainPass } from '../../src/services/near/adapter.js';
import type { PickPass, PassStatus } from '../../src/shared/types.js';

// WCAG relative luminance, as test/design/contrast.test.ts computes it.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('NEG-14-03-01: the start-up guard refuses mainnet settings (spec 3.6.9 test 7)', () => {
  it('NEAR_NETWORK unset or empty: passes off, null', () => {
    expect(loadNearConfig({})).toBeNull();
    expect(loadNearConfig({ NEAR_NETWORK: '  ' })).toBeNull();
  });
  it('NEAR_NETWORK testnet with valid settings loads them', () => {
    const c = loadNearConfig(nearEnv())!;
    expect(c.network).toBe('testnet');
    expect(c.storageEstimateYocto).toBe(parseNear('0.03'));
    expect(c.explorerTxUrl).toBe('https://testnet.near.rocks/tx/{hash}');
  });
  it.each(['mainnet', 'Testnet', 'localnet', 'testnet-x'])('NEAR_NETWORK=%s stops the start, naming the variable', (v) => {
    expect(() => loadNearConfig(nearEnv({ NEAR_NETWORK: v }))).toThrow(/NEAR_NETWORK must be testnet/);
  });
  it.each(['https://rpc.mainnet.near.org', 'https://free.rpc.fastnear.com', 'https://rpc.mainnet.fastnear.com', 'https://my-mainnet-rpc.example.com', 'http://test.rpc.fastnear.com'])('NEAR_RPC_URL %s is refused', (url) => {
    expect(() => loadNearConfig(nearEnv({ NEAR_RPC_URL: url }))).toThrow(NearConfigError);
  });
  it('accounts that are not on testnet are refused', () => {
    expect(() => loadNearConfig(nearEnv({ NEAR_PASSES_CONTRACT_ID: 'contract.nearby-passes.near' }))).toThrow(/NEAR_PASSES_CONTRACT_ID/);
    expect(() => loadNearConfig(nearEnv({ NEAR_AGENT_ACCOUNT_ID: 'agent.near' }))).toThrow(/NEAR_AGENT_ACCOUNT_ID/);
    expect(() => loadNearConfig(nearEnv({ NEAR_MERCHANT_ACCOUNTS_JSON: JSON.stringify({ '00000000-0000-4000-8000-000000000001': 'saguaro.near' }) }))).toThrow(/NEAR_MERCHANT_ACCOUNTS_JSON/);
    expect(() => loadNearConfig(nearEnv({ NEAR_EXPLORER_TX_URL: 'https://nearblocks.io/txns/{hash}' }))).toThrow(/mainnet explorer/);
  });
  it('a missing secret or key names its variable', () => {
    expect(() => loadNearConfig(nearEnv({ NEAR_AGENT_PRIVATE_KEY: undefined }))).toThrow(/NEAR_AGENT_PRIVATE_KEY/);
    expect(() => loadNearConfig(nearEnv({ NEAR_DEMO_ACCOUNT_SECRET: 'short' }))).toThrow(/NEAR_DEMO_ACCOUNT_SECRET/);
  });
  it('the scripts refuse the same mainnet hosts as the app', () => {
    const lib = readFileSync(join(__dirname, '../../scripts/near/lib.mjs'), 'utf8');
    const m = /KNOWN_MAINNET_RPC_HOSTS = (\[[^\]]+\])/.exec(lib)!;
    expect(JSON.parse(m[1].replace(/'/g, '"'))).toEqual(KNOWN_MAINNET_RPC_HOSTS);
  });
});

describe('AC-REQ-09-06-01: the demo account is derived (spec 3.6.2)', () => {
  const secret = Buffer.from('ab'.repeat(32), 'hex');
  it('is the implicit account of the ed25519 key whose seed is HMAC-SHA256(secret, session:index), as near-api-js computes it', () => {
    const seed = demoSeed(secret, 'session-1', 0);
    const pub = ed25519PublicKey(seed);
    const kp = new KeyPairEd25519(baseEncode(Buffer.concat([seed, pub])));
    expect(demoAccountId(secret, 'session-1', 0)).toBe(keyToImplicitAddress(kp.getPublicKey()));
  });
  it('is stable for a session and index, and differs across sessions and indexes', () => {
    const a = demoAccountId(secret, 's', 0);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(demoAccountId(secret, 's', 0)).toBe(a);
    expect(demoAccountId(secret, 's', 1)).not.toBe(a);
    expect(demoAccountId(secret, 't', 0)).not.toBe(a);
  });
});

describe('amounts', () => {
  it('parse and format testnet NEAR without floating point', () => {
    expect(parseNear('0.1')).toBe(10n ** 23n);
    expect(formatNear(parseNear('0.05'))).toBe('0.05');
    expect(nearText(parseNear('2.99894'))).toBe('2.9989 testnet NEAR');
    expect(() => parseNear('-1')).toThrow();
  });
});

describe('REQ-10-06: pass facts for Claude (spec 3.6.5)', () => {
  const pass: PickPass = { openCount: 3, cashBackYocto: parseNear('0.1').toString(), cashBackText: '0.1 testnet NEAR', expiresAt: '2026-11-18T00:00:00Z' };
  it('AC-REQ-10-06-01: the candidates tool carries the pass only when passes are on; the four tools are unchanged', async () => {
    expect(passForTool(pass)).toEqual({ open_count: 3, cash_back: '0.1 testnet NEAR' });
    expect(passForTool(null)).toBeNull();
    const { AGENT_TOOL_NAMES } = await import('../../src/services/agent/agentLoop.js');
    expect(AGENT_TOOL_NAMES).toEqual(['list_upcoming_appointments', 'find_places_near', 'find_offer_candidates', 'propose_offer']);
  });
  it('AC-REQ-10-06-02: two lines are added to the instructions when passes are on, and none when off', () => {
    expect(systemPrompt(false)).toBe(SYSTEM_PROMPT);
    expect(systemPrompt(true)).toBe(`${SYSTEM_PROMPT}\n${PASS_INSTRUCTIONS}`);
    expect(PASS_INSTRUCTIONS.split('\n')).toHaveLength(2);
    expect(PASS_INSTRUCTIONS).toMatch(/cash back in testnet NEAR/);
    expect(PASS_INSTRUCTIONS).toMatch(/Never promise that a pass is still available/);
  });
  it('NEG-10-06-01: a reason with the pass’s cash back is accepted; any amount not carried is refused', () => {
    expect(amountNotCarried('Saguaro Bean is 0.2 mi away; claim 0.1 testnet NEAR back until 11.', pass)).toBeNull();
    expect(amountNotCarried('Saguaro Bean is 0.2 mi away and the deal runs until 11.', null)).toBeNull();
    expect(amountNotCarried('Get 0.5 testnet NEAR back at Saguaro Bean.', pass)).toBe('0.5 testnet NEAR');
    expect(amountNotCarried('Get 0.1 NEAR back.', null)).toBe('0.1 NEAR');
    expect(amountNotCarried('Coffee for $6 at Saguaro Bean.', pass)).toBe('$6');
    const c = { offer: { id: 'o1' } } as never;
    const ok = validateAgentPicks([{ appointment_id: 'a', offer_id: 'o1', reason: 'Saguaro Bean pays 0.1 testnet NEAR back near your 9:30.' }], 'a', [c], new Map([['o1', pass]]));
    expect(ok.ok).toBe(true);
    const bad = validateAgentPicks([{ appointment_id: 'a', offer_id: 'o1', reason: 'Saguaro Bean pays 1 testnet NEAR back.' }], 'a', [c], new Map([['o1', pass]]));
    expect(bad).toMatchObject({ ok: false });
  });
});

describe('AC-REQ-10-05-01 / AC-REQ-10-05-02: the pass image and reference for each status (spec 3.6.9 test 8)', () => {
  const base: ChainPass = {
    tokenId: 'pass-7', merchantId: 'saguaro-bean.nearby-passes.testnet', offerId: 'o', title: 'Saguaro Bean Co. pass <b>',
    description: 'Any drink plus pastry Sample merchant. Testnet only.', valueYocto: parseNear('0.1').toString(), expiresAtMs: Date.UTC(2026, 10, 18, 17),
    status: 'Open', claimedAtMs: null, settledAtMs: null, ownerId: 'contract.nearby-passes.testnet', updatedAtMs: 1,
  };
  it.each(['Open', 'Claimed', 'Redeemed', 'Refunded'] as PassStatus[])('%s: its color, merchant, balance, expiry, number and Sample; text meets AA on its band', (status) => {
    const svg = passSvg({ ...base, status }, 'Saguaro Bean Co.');
    expect(svg).toContain(`fill="${STATUS_STYLE[status].band}"`);
    expect(svg).toContain(`>${status}<`);
    for (const s of ['Saguaro Bean Co.', '0.1 testnet NEAR', 'pass-7', 'SAMPLE', 'Expires Nov 18']) expect(svg).toContain(s);
    expect(svg.includes('M352 30 l8 8')).toBe(status === 'Redeemed');
    expect(contrastRatio(STATUS_STYLE[status].ink, STATUS_STYLE[status].band)).toBeGreaterThanOrEqual(4.5);
    expect(passReference({ ...base, status }, 'Saguaro Bean Co.', 'https://x/passes/pass-7.svg')).toMatchObject({ token_id: 'pass-7', status, value: '0.1 testnet NEAR', sample: true, network: 'testnet' });
  });
  it('text from the chain is escaped, never markup', () => {
    const svg = passSvg({ ...base, description: '<script>alert(1)</script>' }, null);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<b>');
  });
});

describe('SEC-14-05-01 / SEC-14-05-02: secrets stay on the server; outbound calls only to the allowed hosts', () => {
  it('the leak scan finds the NEAR secrets and any ed25519 private key', () => {
    const key = `ed25519:${'3'.repeat(87)}`;
    const env = { NEAR_AGENT_PRIVATE_KEY: key, NEAR_MERCHANT_KEYS_JSON: JSON.stringify({ 'm.testnet': `ed25519:${'4'.repeat(87)}` }), NEAR_DEMO_ACCOUNT_SECRET: 'cd'.repeat(32) };
    expect(findLeaks(`x${key}x`, env)).toEqual(expect.arrayContaining(['NEAR_AGENT_PRIVATE_KEY']));
    expect(findLeaks(`x${'4'.repeat(87)}`, env)).toEqual([]);
    expect(findLeaks(`ed25519:${'4'.repeat(87)}`, env)).toEqual(expect.arrayContaining(['NEAR_MERCHANT_KEYS_JSON']));
    expect(findLeaks('cd'.repeat(32), env)).toEqual(['NEAR_DEMO_ACCOUNT_SECRET']);
    expect(findLeaks('ed25519:ER1GPbVaXLqxpK3UjYvy1phDWBumvgf4AENtb6UKAixG', {})).toEqual([]); // a public key is not a secret
  });
  it('the global fetch guard allows the three services and the testnet RPC only', async () => {
    const reached: string[] = [];
    const target = { fetch: (async (input: string) => { reached.push(new URL(input).hostname); return new Response('{}'); }) as unknown as typeof fetch };
    installOutboundFetchGuard(['test.rpc.fastnear.com'], target);
    await target.fetch('https://test.rpc.fastnear.com');
    await target.fetch('https://api.anthropic.com/v1/messages');
    await expect(target.fetch('https://rpc.mainnet.near.org')).rejects.toThrow(OutboundBoundaryError);
    await expect(target.fetch('http://test.rpc.fastnear.com')).rejects.toThrow(OutboundBoundaryError);
    expect(reached).toEqual(['test.rpc.fastnear.com', 'api.anthropic.com']);
  });
});
