// The pass service (Nearby Passes spec 3.1 "Pass service", 3.6; REQ-09-01 to REQ-13-02): the session's NEAR account,
// the pass facts on picks, the claim behind the single-use token, My passes, and the merchant's account, funding,
// redeeming and refunds. The contract is the source of truth for a pass (3.6.1): no table here holds a pass's status.
// Counts and lists come through a cache of at most NEAR_VIEW_CACHE_MS; every action reads the contract fresh first.
// Every chain call goes through the one NearAdapter (REQ-14-05). Amounts are never read from a request.
import type { Db, DbClient } from '../../models/db.js';
import { withTransaction } from '../../models/db.js';
import type {
  AgentKeysResult, ClaimPassResult, FundPassesResult, MerchantPassesResult, MyPassesResult, NearAccountResult, OfferPassStats,
  PassActivityItem, PassActivityResult, PassConfirmSheet, PassView, Pick, PickPass, PickPassClaim, RedeemPassResult, RefundExpiredResult,
} from '../../shared/types.js';
import {
  DEMO_ACCOUNT_LABEL, MERCHANT_PASSES_NOT_SET_UP, NEAR_CALL_TIMEOUT_MS, NEAR_VIEW_CACHE_MS, PASS_AGENT_SENTENCE, PASS_CASH_BACK_OPTIONS,
  PASS_CLAIMS_PER_HOUR, PASS_CLAIMS_PER_SESSION_PER_HOUR, PASS_EXPIRY_OPTIONS, PASS_FUND_COUNT_MAX, PASS_FUND_COUNT_MIN,
  PASS_FUNDINGS_PER_SESSION_PER_HOUR, PASS_REDEMPTIONS_PER_SESSION_PER_HOUR, PASS_TOKEN_ID_PATTERN, REFUND_EXPIRED_MAX_PER_CALL,
  SALES_FEED_MAX_ITEMS,
} from '../../shared/types.js';
import { ApiError, badRequest, notFound } from '../../api/http.js';
import { WindowLimiter } from '../offersMcp/windowLimiter.js';
import { hashToken, looksLikeToken } from '../proposals/confirmationToken.js';
import { applyLazyTransitions } from '../proposals/lifecycle.js';
import { loadProposal, type ProposalJoinedRow } from '../proposals/proposalRows.js';
import type { NearConfig } from '../near/nearConfig.js';
import { ChainRefusedError, ChainUnavailableError, type ChainPass, type NearAdapter } from '../near/adapter.js';
import { demoAccountId } from '../near/demoAccount.js';
import { isTestnetAccount } from '../near/nearConfig.js';
import { nearText, parseNear } from '../near/format.js';

const tokenRefused = () => new ApiError(403, 'confirmation_token_invalid', 'A valid confirmation token is required. Tap Claim as pass again.');
const unavailable = (msg: string) => new ApiError(409, 'pass_unavailable', msg);
const nearDown = (msg: string) => new ApiError(503, 'near_unavailable', msg);
const limited = () => new ApiError(429, 'rate_limited', 'Too many requests from this browser in the last hour. Try again later.');

/** A plain sentence for a contract refusal (F8.4, 3.6.3: "marked failed with a plain message"). */
export function plainRefusal(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('paused')) return 'Claiming is paused right now.';
  if (m.includes('already claimed')) return 'This account already holds a pass for this offer.';
  if (m.includes('no open pass') || m.includes('none left') || m.includes('no pass')) return 'No pass is left for this offer right now.';
  if (m.includes('expired')) return 'This pass has expired.';
  return 'The pass could not be claimed.';
}

/** pass-7 or 7 -> pass-7 (ruling 49(c)); anything else is a 400. */
export function parseTokenId(raw: unknown): string {
  const t = String(raw ?? '').trim().replace(/^#/, '');
  const id = /^\d+$/.test(t) ? `pass-${t}` : t;
  if (!PASS_TOKEN_ID_PATTERN.test(id)) throw badRequest('A pass number is pass- followed by digits, for example pass-7.');
  return id;
}

const tokenNumber = (id: string) => Number(id.slice(5));

interface MerchantRow { id: string; name: string; is_sample: boolean; near_account_id: string | null }

class ViewCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();
  constructor(private readonly now: () => number, private readonly ttl = NEAR_VIEW_CACHE_MS) {}
  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const e = this.entries.get(key);
    const age = e ? this.now() - e.at : -1;
    if (e && age >= 0 && age < this.ttl) return e.value as Promise<T>; // an entry from a later time than now is stale
    const value = load();
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => this.entries.delete(key));
    return value;
  }
  clear(): void {
    this.entries.clear();
  }
}

export interface Availability {
  available: boolean;
  reason: string | null;
}

export class PassService {
  private readonly cache: ViewCache;
  private readonly claimsPerSession: WindowLimiter;
  private readonly claimsOverall: WindowLimiter;
  private readonly fundings: WindowLimiter;
  private readonly redemptions: WindowLimiter;

  constructor(
    private readonly db: Db,
    private readonly near: NearAdapter,
    private readonly cfg: NearConfig,
    private readonly appBaseUrl: string,
    private readonly repoUrl: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    const ms = () => this.now().getTime();
    this.cache = new ViewCache(ms);
    this.claimsPerSession = new WindowLimiter(PASS_CLAIMS_PER_SESSION_PER_HOUR, 3_600_000, ms);
    this.claimsOverall = new WindowLimiter(PASS_CLAIMS_PER_HOUR, 3_600_000, ms);
    this.fundings = new WindowLimiter(PASS_FUNDINGS_PER_SESSION_PER_HOUR, 3_600_000, ms);
    this.redemptions = new WindowLimiter(PASS_REDEMPTIONS_PER_SESSION_PER_HOUR, 3_600_000, ms);
  }

  // ------------------------------------------------------------------ links and shapes
  txUrl(hash: string): string {
    return this.cfg.explorerTxUrl.replace('{hash}', hash);
  }
  accountUrl(account: string): string {
    return this.cfg.explorerAccountUrl.replace('{account}', account);
  }

  private async merchantsByAccount(client: DbClient = this.db): Promise<Map<string, MerchantRow>> {
    const { rows } = await client.query<MerchantRow>('SELECT id, name, is_sample, near_account_id FROM merchants WHERE near_account_id IS NOT NULL');
    return new Map(rows.map((r) => [r.near_account_id!, r]));
  }

  /** The transaction of the last action the app sent for each pass (ruling 49(b)). */
  private async lastTx(tokenIds: string[]): Promise<Map<string, string>> {
    if (tokenIds.length === 0) return new Map();
    const { rows } = await this.db.query<{ token_id: string; tx: string }>(
      `SELECT DISTINCT ON (token_id) token_id, tx FROM (
         SELECT token_id, tx_hash AS tx, created_at FROM pass_actions WHERE token_id = ANY($1)
         UNION ALL SELECT token_id, claim_tx AS tx, updated_at AS created_at FROM pass_claims WHERE token_id = ANY($1) AND status = 'claimed' AND claim_tx IS NOT NULL
       ) t ORDER BY token_id, created_at DESC`,
      [tokenIds],
    );
    return new Map(rows.map((r) => [r.token_id, r.tx]));
  }

  async toViews(passes: ChainPass[]): Promise<PassView[]> {
    const merchants = await this.merchantsByAccount();
    const txs = await this.lastTx(passes.map((p) => p.tokenId));
    const nowMs = this.now().getTime();
    return passes.map((p) => {
      const m = merchants.get(p.merchantId);
      const tx = txs.get(p.tokenId);
      return {
        tokenId: p.tokenId,
        status: p.status,
        expired: nowMs >= p.expiresAtMs,
        merchantAccountId: p.merchantId,
        merchantId: m?.id ?? null,
        merchantName: m?.name ?? null,
        merchantIsSample: m?.is_sample ?? false,
        offerId: p.offerId,
        title: p.title,
        description: p.description,
        valueYocto: p.valueYocto,
        valueText: nearText(p.valueYocto),
        expiresAt: new Date(p.expiresAtMs).toISOString(),
        claimedAt: p.claimedAtMs ? new Date(p.claimedAtMs).toISOString() : null,
        settledAt: p.settledAtMs ? new Date(p.settledAtMs).toISOString() : null,
        ownerId: p.ownerId,
        mediaUrl: `${this.appBaseUrl}/passes/${p.tokenId}.svg`,
        ownerExplorerUrl: this.accountUrl(p.ownerId),
        lastTxUrl: tx ? this.txUrl(tx) : null,
      };
    });
  }

  // ------------------------------------------------------------------ the session's account (F8.1, 3.6.2)
  /** The session's account, derived and recorded on first use (a near_accounts row; no key is stored). */
  async accountFor(sessionId: string, client: DbClient = this.db): Promise<{ accountId: string; source: 'demo' | 'wallet' }> {
    const { rows } = await client.query<{ account_id: string; source: 'demo' | 'wallet' }>('SELECT account_id, source FROM near_accounts WHERE session_id = $1', [sessionId]);
    if (rows[0]) return { accountId: rows[0].account_id, source: rows[0].source };
    const accountId = demoAccountId(this.cfg.demoAccountSecret, sessionId, 0);
    await client.query(`INSERT INTO near_accounts (session_id, account_id, source, account_index) VALUES ($1,$2,'demo',0) ON CONFLICT (session_id) DO NOTHING`, [sessionId, accountId]);
    const again = await client.query<{ account_id: string; source: 'demo' | 'wallet' }>('SELECT account_id, source FROM near_accounts WHERE session_id = $1', [sessionId]);
    return { accountId: again.rows[0].account_id, source: again.rows[0].source };
  }

  /**
   * F8.2 (Should): after a NEAR Connect sign-in the browser posts the account id; it is accepted only if it is a valid
   * testnet account id and the RPC says the account exists (3.6.2). Later claims go to it. Nothing is signed.
   */
  async setWallet(sessionId: string, raw: unknown): Promise<NearAccountResult> {
    const accountId = typeof raw === 'string' ? raw.trim() : '';
    if (!isTestnetAccount(accountId)) throw badRequest('Use a NEAR testnet account (a name ending in .testnet, or a 64-character implicit account).');
    let balance: string | null;
    try {
      balance = await this.near.balance(accountId);
    } catch {
      throw nearDown('The NEAR testnet did not answer. Try again in a moment.');
    }
    if (balance === null) throw badRequest('That account does not exist on NEAR testnet.');
    await this.accountFor(sessionId);
    await this.db.query(`UPDATE near_accounts SET account_id = $2, source = 'wallet' WHERE session_id = $1`, [sessionId, accountId]);
    return this.account(sessionId);
  }

  /** Reset demo (3.6.2): the session's next demo account, in the reset's transaction. */
  async resetAccount(tx: DbClient, sessionId: string): Promise<string> {
    const { rows } = await tx.query<{ account_index: number }>('SELECT account_index FROM near_accounts WHERE session_id = $1 FOR UPDATE', [sessionId]);
    const next = rows[0] ? rows[0].account_index + 1 : 1;
    const accountId = demoAccountId(this.cfg.demoAccountSecret, sessionId, next);
    await tx.query(
      `INSERT INTO near_accounts (session_id, account_id, source, account_index) VALUES ($1,$2,'demo',$3)
       ON CONFLICT (session_id) DO UPDATE SET account_id = EXCLUDED.account_id, source = 'demo', account_index = EXCLUDED.account_index`,
      [sessionId, accountId, next],
    );
    return accountId;
  }

  /** Claiming is available unless paused on chain or the agent runs low (F13.3; ruling 49(f)). */
  availability(fresh = false): Promise<Availability> {
    const load = async (): Promise<Availability> => {
      const [config, balance, keys] = await Promise.all([this.near.config(), this.near.balance(this.cfg.agentAccountId), this.near.accessKeys(this.cfg.agentAccountId)]);
      if (config.claimsPaused) return { available: false, reason: 'Claiming is paused on the contract right now.' };
      if (balance === null || BigInt(balance) < this.cfg.agentFloorYocto) return { available: false, reason: "Nearby's agent is low on testnet NEAR for gas." };
      const fc = keys.filter((k) => k.kind === 'function_call' && k.methodNames.includes('claim_pass'));
      const allowance = fc.reduce((t, k) => (k.allowanceYocto === null ? t : t > BigInt(k.allowanceYocto) ? t : BigInt(k.allowanceYocto)), -1n);
      if (fc.length === 0 || (allowance >= 0n && allowance < this.cfg.agentFloorYocto)) return { available: false, reason: "Nearby's agent key is nearly out of its gas allowance." };
      return { available: true, reason: null };
    };
    return fresh ? load() : this.cache.get('availability', load);
  }

  async account(sessionId: string): Promise<NearAccountResult> {
    const { accountId, source } = await this.accountFor(sessionId);
    let avail: Availability;
    try {
      avail = await this.availability();
    } catch {
      avail = { available: false, reason: 'The NEAR testnet did not answer. Try again in a moment.' };
    }
    return {
      passesEnabled: true, claimsAvailable: avail.available, unavailableReason: avail.reason, network: 'testnet',
      accountId, source, explorerUrl: this.accountUrl(accountId),
    };
  }

  /** The label the account panel shows for a demo account (F8.1). */
  static readonly demoLabel = DEMO_ACCOUNT_LABEL;

  // ------------------------------------------------------------------ pass facts (F8.3, 3.6.5)
  /** The merchant's passes for one offer that a claim could take now: Open, unexpired, oldest first. */
  private async openPasses(merchantAccount: string, offerId: string, fresh = false): Promise<ChainPass[]> {
    const list = fresh
      ? await this.near.passesForMerchant(merchantAccount, 0, 100)
      : await this.cache.get(`merchant:${merchantAccount}`, () => this.near.passesForMerchant(merchantAccount, 0, 100));
    const nowMs = this.now().getTime();
    return list
      .filter((p) => p.offerId === offerId && p.status === 'Open' && p.expiresAtMs > nowMs && p.merchantId === merchantAccount)
      .sort((a, b) => tokenNumber(a.tokenId) - tokenNumber(b.tokenId));
  }

  private toPickPass(open: ChainPass[]): PickPass | null {
    if (open.length === 0) return null;
    const first = open[0];
    return { openCount: open.length, cashBackYocto: first.valueYocto, cashBackText: nearText(first.valueYocto), expiresAt: new Date(first.expiresAtMs).toISOString() };
  }

  /**
   * The pass facts of offers, keyed by offer id (picks, the agent's candidates, the MCP tools). Only a seed offer of a
   * merchant with a NEAR account, and only passes minted by that known account (NEG-09-03-01). Null when claiming is
   * unavailable. A NEAR failure gives no pass facts, never an error: picks never depend on NEAR.
   */
  async passFacts(offerIds: string[]): Promise<Map<string, PickPass | null>> {
    const out = new Map<string, PickPass | null>(offerIds.map((id) => [id, null]));
    if (offerIds.length === 0) return out;
    try {
      if (!(await this.availability()).available) return out;
      const { rows } = await this.db.query<{ id: string; near_account_id: string }>(
        `SELECT o.id, m.near_account_id FROM offers o JOIN merchants m ON m.id = o.merchant_id
          WHERE o.id = ANY($1::uuid[]) AND o.owner_session_id IS NULL AND m.near_account_id IS NOT NULL`,
        [offerIds],
      );
      for (const r of rows) out.set(r.id, this.toPickPass(await this.openPasses(r.near_account_id, r.id)));
    } catch {
      return new Map(offerIds.map((id) => [id, null]));
    }
    return out;
  }

  /**
   * Fills Pick.pass for picks that are not settled (F8.3), after settling any of their claims left `pending` (ruling
   * 54(a)): a claim whose outcome was not known is checked by its hash here too, so a pick never stays pending after
   * its sheet was closed. A pending claim with no hash, older than twice NEAR_CALL_TIMEOUT_MS, sent nothing: failed.
   */
  async decoratePicks<T extends { picks: Pick[] }>(result: T): Promise<T> {
    const settled = await this.settlePending(result.picks.filter((p) => p.passClaim?.status === 'pending').map((p) => p.proposalId));
    const picks = result.picks.map((p) => (settled.has(p.proposalId) ? { ...p, passClaim: settled.get(p.proposalId)! } : p));
    const facts = await this.passFacts(picks.map((p) => p.offerId));
    return { ...result, picks: picks.map((p) => ({ ...p, pass: p.purchased || p.passClaim?.status === 'claimed' ? null : (facts.get(p.offerId) ?? null) })) };
  }

  /** Settles pending claims by their hash; returns the new claim state of those that changed. */
  async settlePending(proposalIds: string[]): Promise<Map<string, PickPassClaim>> {
    const out = new Map<string, PickPassClaim>();
    if (proposalIds.length === 0) return out;
    const { rows } = await this.db.query<{ proposal_id: string; claim_tx: string | null; updated_at: Date }>(
      `SELECT proposal_id, claim_tx, updated_at FROM pass_claims WHERE proposal_id = ANY($1::uuid[]) AND status = 'pending'`,
      [proposalIds],
    );
    for (const r of rows) {
      try {
        if (r.claim_tx) {
          const o = await this.near.txOutcome(r.claim_tx, this.cfg.agentAccountId);
          if (o.state === 'succeeded') {
            const done = await this.finishClaim(r.proposal_id, String(o.value), r.claim_tx);
            out.set(r.proposal_id, { status: 'claimed', tokenId: done.pass.tokenId, error: null });
          } else if (o.state === 'failed') {
            const msg = plainRefusal(o.message);
            await this.db.query(`UPDATE pass_claims SET status = 'failed', error = $2 WHERE proposal_id = $1 AND status = 'pending'`, [r.proposal_id, msg]);
            out.set(r.proposal_id, { status: 'failed', tokenId: null, error: msg });
          }
        } else if (this.now().getTime() - r.updated_at.getTime() > 2 * NEAR_CALL_TIMEOUT_MS) {
          const msg = 'The NEAR testnet did not answer. Nothing was claimed. Try again.';
          await this.db.query(`UPDATE pass_claims SET status = 'failed', error = $2 WHERE proposal_id = $1 AND status = 'pending'`, [r.proposal_id, msg]);
          out.set(r.proposal_id, { status: 'failed', tokenId: null, error: msg });
        }
      } catch {
        /* NEAR did not answer: left pending, tried again on the next read */
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ the yes (3.6.3) and the claim (F8.4)
  /** The pass gate of accept: fresh reads, then the pass confirm sheet. Throws 409 pass_unavailable. */
  passGate = async (tx: DbClient, sessionId: string, p: ProposalJoinedRow): Promise<PassConfirmSheet> => {
    if (!p.merchant_near_account_id || p.offer_owner_session_id) throw unavailable('This offer has no passes.');
    let open: ChainPass[];
    try {
      const avail = await this.availability(true);
      if (!avail.available) throw unavailable(avail.reason ?? 'Passes are not available right now.');
      open = await this.openPasses(p.merchant_near_account_id, p.offer_id, true);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw nearDown('The NEAR testnet did not answer. Try again in a moment.');
    }
    if (open.length === 0) throw unavailable('No pass is left for this offer right now.');
    const { accountId } = await this.accountFor(sessionId, tx);
    return {
      proposalId: p.id, merchantName: p.merchant_name, merchantIsSample: p.merchant_is_sample, offerTitle: p.offer_title,
      cashBackText: nearText(open[0].valueYocto), expiresAt: new Date(open[0].expiresAtMs).toISOString(), receivingAccountId: accountId,
      agentSentence: PASS_AGENT_SENTENCE,
    };
  };

  /** POST /api/passes/claim (api-contracts.md "Nearby Passes", steps 1 to 8). */
  async claim(sessionId: string, proposalId: string, token: unknown): Promise<ClaimPassResult> {
    if (!this.claimsPerSession.take(sessionId) || !this.claimsOverall.take('all')) throw limited();
    await applyLazyTransitions(this.db, this.now(), { sessionId, proposalId });
    const prep = await withTransaction(this.db, async (tx) => {
      const now = this.now();
      if (!(await loadProposal(tx, sessionId, proposalId, true))) throw notFound('No proposal exists with this id.');
      if (!looksLikeToken(token)) throw tokenRefused();
      const hash = hashToken(token);
      const used = await tx.query(
        `UPDATE proposals SET confirm_token_used_at = $4
          WHERE id = $1 AND session_id = $2 AND confirm_token_hash = $3 AND confirm_token_used_at IS NULL
            AND confirm_token_expires_at > $4 AND accept_intent = 'pass' AND status = 'accepted'
          RETURNING id`,
        [proposalId, sessionId, hash, now],
      );
      if (used.rowCount !== 1) throw tokenRefused();
      const p = (await loadProposal(tx, sessionId, proposalId))!;
      if (p.claim_status === 'claimed') throw unavailable('This pick was already claimed as a pass.');
      if (!p.merchant_near_account_id || p.offer_owner_session_id) throw unavailable('This offer has no passes.');
      const { accountId } = await this.accountFor(sessionId, tx);
      return { p, hash, accountId, pendingTx: p.claim_status === 'pending' ? p.claim_tx : null };
    });
    const { p, hash, accountId } = prep;
    const release = () =>
      this.db.query(`UPDATE proposals SET confirm_token_used_at = NULL WHERE id = $1 AND confirm_token_hash = $2`, [proposalId, hash]);

    // An earlier claim whose outcome was not known is checked by its hash before anything is sent (3.6.3).
    if (prep.pendingTx) {
      const o = await this.near.txOutcome(prep.pendingTx, this.cfg.agentAccountId);
      if (o.state === 'succeeded') return this.finishClaim(proposalId, String(o.value), prep.pendingTx);
      if (o.state === 'unknown') {
        await release();
        throw nearDown('We could not confirm the claim yet. Try again in a moment.');
      }
    }

    await this.db.query(
      `INSERT INTO pass_claims (proposal_id, session_id, offer_id, merchant_id, account_id, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (proposal_id) DO UPDATE SET status = 'pending', account_id = EXCLUDED.account_id, token_id = NULL, claim_tx = NULL, error = NULL`,
      [proposalId, sessionId, p.offer_id, p.merchant_id, accountId],
    );
    try {
      const res = await this.near.claimPass(p.merchant_near_account_id!, p.offer_id, accountId);
      return await this.finishClaim(proposalId, res.value, res.hash);
    } catch (e) {
      if (e instanceof ChainRefusedError) {
        const msg = plainRefusal(e.message);
        await this.db.query(`UPDATE pass_claims SET status = 'failed', error = $2, claim_tx = $3 WHERE proposal_id = $1`, [proposalId, msg, e.hash]);
        await release();
        throw unavailable(msg);
      }
      if (e instanceof ChainUnavailableError && e.hash) {
        await this.db.query(`UPDATE pass_claims SET status = 'pending', claim_tx = $2, error = NULL WHERE proposal_id = $1`, [proposalId, e.hash]);
        await release();
        throw nearDown('We could not confirm the claim yet. Try again in a moment.');
      }
      const msg = 'The NEAR testnet did not answer. Nothing was claimed. Try again.';
      await this.db.query(`UPDATE pass_claims SET status = 'failed', error = $2 WHERE proposal_id = $1`, [proposalId, msg]);
      await release();
      throw nearDown(msg);
    }
  }

  private async finishClaim(proposalId: string, tokenId: string, txHash: string): Promise<ClaimPassResult> {
    await this.db.query(`UPDATE pass_claims SET status = 'claimed', token_id = $2, claim_tx = $3, error = NULL WHERE proposal_id = $1`, [proposalId, tokenId, txHash]);
    this.cache.clear();
    const chain = await this.near.getPass(tokenId);
    if (!chain) throw nearDown('The pass was claimed; it will show in My passes in a moment.');
    const [pass] = await this.toViews([chain]);
    return { pass, txHash, txUrl: this.txUrl(txHash) };
  }

  // ------------------------------------------------------------------ My passes (F9.1 to F9.3)
  async mine(sessionId: string): Promise<MyPassesResult> {
    const { accountId } = await this.accountFor(sessionId);
    const list = await this.cache.get(`owner:${accountId}`, () => this.near.passesForOwner(accountId, 0, 50));
    return { accountId, passes: await this.toViews(list) };
  }

  async get(raw: string): Promise<PassView> {
    const id = parseTokenId(raw);
    const p = await this.near.getPass(id);
    if (!p) throw notFound('No pass has this number.');
    return (await this.toViews([p]))[0];
  }

  /** The public image and JSON read the pass with the cache (they are cacheable for ten seconds anyway). */
  async publicPass(raw: string): Promise<ChainPass | null> {
    if (!PASS_TOKEN_ID_PATTERN.test(raw)) return null;
    return this.cache.get(`pass:${raw}`, () => this.near.getPass(raw));
  }

  // ------------------------------------------------------------------ the merchant (F10, F11)
  private async merchant(merchantId: string): Promise<MerchantRow> {
    const { rows } = await this.db.query<MerchantRow>('SELECT id, name, is_sample, near_account_id FROM merchants WHERE id = $1', [merchantId]);
    if (!rows[0]) throw notFound('No merchant exists with this id.');
    return rows[0];
  }

  async merchantPasses(merchantId: string): Promise<MerchantPassesResult> {
    const m = await this.merchant(merchantId);
    if (!m.near_account_id) {
      return { nearEnabled: false, notice: MERCHANT_PASSES_NOT_SET_UP, accountId: null, balanceYocto: null, balanceText: null, explorerUrl: null, heldYocto: '0', heldText: nearText(0n), storageEstimateYocto: this.cfg.storageEstimateYocto.toString(), offers: [], passes: [] };
    }
    const acct = m.near_account_id;
    const offers = await this.db.query<{ id: string; title: string }>('SELECT id, title FROM offers WHERE merchant_id = $1 AND owner_session_id IS NULL ORDER BY id', [merchantId]);
    const [balance, list, stats] = await Promise.all([
      this.cache.get(`balance:${acct}`, () => this.near.balance(acct)),
      this.cache.get(`merchant:${acct}`, () => this.near.passesForMerchant(acct, 0, 100)),
      Promise.all(offers.rows.map((o) => this.cache.get(`stats:${acct}:${o.id}`, () => this.near.offerStats(acct, o.id)))),
    ]);
    const offerStats: OfferPassStats[] = offers.rows.map((o, i) => ({
      offerId: o.id, offerTitle: o.title, open: stats[i].open, claimed: stats[i].claimed, redeemed: stats[i].redeemed, refunded: stats[i].refunded,
      heldYocto: stats[i].heldYocto, heldText: nearText(stats[i].heldYocto),
    }));
    const held = list.filter((p) => p.status === 'Open' || p.status === 'Claimed').reduce((t, p) => t + BigInt(p.valueYocto), 0n);
    return {
      nearEnabled: true, notice: null, accountId: acct, balanceYocto: balance, balanceText: balance === null ? null : nearText(balance, 2),
      explorerUrl: this.accountUrl(acct), heldYocto: held.toString(), heldText: nearText(held), storageEstimateYocto: this.cfg.storageEstimateYocto.toString(),
      offers: offerStats, passes: await this.toViews(list),
    };
  }

  async fund(sessionId: string, merchantId: string, offerId: string, body: unknown): Promise<FundPassesResult> {
    const b = (body ?? {}) as { count?: unknown; cashBack?: unknown; expiry?: unknown };
    const count = b.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < PASS_FUND_COUNT_MIN || count > PASS_FUND_COUNT_MAX) throw badRequest(`Choose 1 to ${PASS_FUND_COUNT_MAX} passes.`);
    if (typeof b.cashBack !== 'string' || !(PASS_CASH_BACK_OPTIONS as readonly string[]).includes(b.cashBack)) throw badRequest('Choose a cash back of 0.05, 0.1 or 0.25 testnet NEAR.');
    if (typeof b.expiry !== 'string' || !(b.expiry in PASS_EXPIRY_OPTIONS)) throw badRequest('Choose an expiry of 5 minutes, 24 hours or 7 days.');
    const m = await this.merchant(merchantId);
    const offer = await this.db.query<{ id: string; title: string; owner_session_id: string | null }>('SELECT id, title, owner_session_id FROM offers WHERE id = $1 AND merchant_id = $2', [offerId, merchantId]);
    if (!offer.rows[0]) throw notFound('No offer exists with this id.');
    if (!m.near_account_id) throw badRequest(MERCHANT_PASSES_NOT_SET_UP);
    if (offer.rows[0].owner_session_id) throw badRequest('Passes are funded only on the sample offers.');
    if (!this.fundings.take(sessionId)) throw limited();
    const expiresAtMs = this.now().getTime() + PASS_EXPIRY_OPTIONS[b.expiry as keyof typeof PASS_EXPIRY_OPTIONS];
    let minted;
    try {
      minted = await this.mintFor({ ...m, near_account_id: m.near_account_id }, { id: offerId, title: offer.rows[0].title }, count, parseNear(b.cashBack), expiresAtMs, 'merchant', sessionId);
    } catch (e) {
      throw this.chainError(e, 'The passes could not be funded.');
    }
    const passes = (await Promise.all(minted.tokenIds.map((id) => this.near.getPass(id)))).filter((p): p is ChainPass => !!p);
    return { tokenIds: minted.tokenIds, passes: await this.toViews(passes), depositYocto: minted.depositYocto.toString(), depositText: nearText(minted.depositYocto), txHash: minted.hash, txUrl: this.txUrl(minted.hash) };
  }

  /** Mints `count` passes for a seed offer as its merchant, attaching the balances plus the storage estimate (3.4.4),
   * and records the transaction (ruling 49(b)). Funding (F10.2) and upkeep (F13.4) both mint through here. */
  async mintFor(
    m: { id: string; name: string; near_account_id: string },
    offer: { id: string; title: string },
    count: number,
    valueYocto: bigint,
    expiresAtMs: number,
    actor: 'merchant' | 'upkeep',
    sessionId: string | null,
  ): Promise<{ tokenIds: string[]; hash: string; depositYocto: bigint }> {
    const depositYocto = BigInt(count) * (valueYocto + this.cfg.storageEstimateYocto);
    const res = await this.near.mintPasses(m.near_account_id, { offerId: offer.id, title: `${m.name} pass`, description: offer.title, valueYocto, expiresAtMs, count, depositYocto });
    for (const id of res.value) await this.recordAction(m.id, id, 'fund', actor, sessionId, res.hash);
    this.cache.clear();
    return { tokenIds: res.value, hash: res.hash, depositYocto };
  }

  /** The merchant's Open, unexpired passes for an offer, read fresh (upkeep). */
  openCountFresh(merchantAccount: string, offerId: string): Promise<number> {
    return this.openPasses(merchantAccount, offerId, true).then((l) => l.length);
  }

  async redeem(sessionId: string, merchantId: string, rawTokenId: string): Promise<RedeemPassResult> {
    const tokenId = parseTokenId(rawTokenId);
    const m = await this.merchant(merchantId);
    if (!m.near_account_id) throw badRequest(MERCHANT_PASSES_NOT_SET_UP);
    if (!this.redemptions.take(sessionId)) throw limited();
    const p = await this.near.getPass(tokenId); // fresh: never the cache before an action
    if (!p) throw notFound('No pass has this number.');
    if (p.merchantId !== m.near_account_id) throw badRequest('This pass belongs to another merchant.');
    if (p.status !== 'Claimed') throw unavailable(`This pass is ${p.status} and cannot be redeemed.`);
    if (this.now().getTime() >= p.expiresAtMs) throw unavailable('This pass has expired. Use Refund expired instead.');
    let res;
    try {
      res = await this.near.redeemPass(m.near_account_id, tokenId);
    } catch (e) {
      throw this.chainError(e, 'The pass could not be redeemed.');
    }
    await this.recordAction(merchantId, tokenId, 'redeem', 'merchant', sessionId, res.hash);
    this.cache.clear();
    const after = (await this.near.getPass(tokenId)) ?? { ...p, status: 'Redeemed' as const };
    const [view] = await this.toViews([after]);
    return { pass: view, message: `Redeemed. ${nearText(p.valueYocto)} sent to the holder.`, txHash: res.hash, txUrl: this.txUrl(res.hash) };
  }

  /** Refund expired passes of a merchant (F11.2; upkeep calls it with actor 'upkeep' and a minimum age). */
  async refundExpired(sessionId: string | null, merchantId: string, opts: { actor?: 'merchant' | 'upkeep'; minAgeMs?: number } = {}): Promise<RefundExpiredResult> {
    const m = await this.merchant(merchantId);
    if (!m.near_account_id) throw badRequest(MERCHANT_PASSES_NOT_SET_UP);
    const nowMs = this.now().getTime();
    const list = await this.near.passesForMerchant(m.near_account_id, 0, 100);
    const due = list
      .filter((p) => (p.status === 'Open' || p.status === 'Claimed') && nowMs >= p.expiresAtMs + (opts.minAgeMs ?? 0))
      .sort((a, b) => tokenNumber(a.tokenId) - tokenNumber(b.tokenId))
      .slice(0, REFUND_EXPIRED_MAX_PER_CALL);
    const refunded: RefundExpiredResult['refunded'] = [];
    for (const p of due) {
      try {
        const res = await this.near.refundExpired(m.near_account_id, p.tokenId);
        await this.recordAction(merchantId, p.tokenId, 'refund', opts.actor ?? 'merchant', sessionId, res.hash);
        refunded.push({ tokenId: p.tokenId, valueText: nearText(p.valueYocto), txHash: res.hash, txUrl: this.txUrl(res.hash) });
      } catch (e) {
        if (refunded.length === 0 && !(e instanceof ChainRefusedError)) throw this.chainError(e, 'The refund could not be sent.');
      }
    }
    this.cache.clear();
    const balance = await this.near.balance(m.near_account_id).catch(() => null);
    return { refunded, balanceText: balance === null ? null : nearText(balance, 2) };
  }

  private async recordAction(merchantId: string, tokenId: string, action: 'fund' | 'redeem' | 'refund', actor: 'merchant' | 'upkeep', sessionId: string | null, hash: string) {
    await this.db.query(
      `INSERT INTO pass_actions (merchant_id, token_id, action, actor, session_id, tx_hash) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (token_id, action) DO NOTHING`,
      [merchantId, tokenId, action, actor, sessionId, hash],
    );
  }

  private chainError(e: unknown, fallback: string): ApiError {
    if (e instanceof ApiError) return e;
    if (e instanceof ChainRefusedError) return unavailable(`${fallback} ${plainRefusal(e.message) === 'The pass could not be claimed.' ? '' : plainRefusal(e.message)}`.trim());
    return nearDown(`${fallback} The NEAR testnet did not answer. Try again in a moment.`);
  }

  /** F11.3 (Should): claims of this merchant's passes made through the app, and the fundings, redemptions and refunds
   * the server sent, newest first. Token ids and transaction hashes only: they are public on chain. */
  async activity(merchantId: string): Promise<PassActivityResult> {
    await this.merchant(merchantId);
    const { rows } = await this.db.query<{ kind: PassActivityItem['kind']; token_id: string; at: Date; tx: string | null }>(
      `SELECT kind, token_id, at, tx FROM (
         SELECT 'claim' AS kind, token_id, updated_at AS at, claim_tx AS tx FROM pass_claims WHERE merchant_id = $1 AND status = 'claimed' AND token_id IS NOT NULL
         UNION ALL SELECT action AS kind, token_id, created_at AS at, tx_hash AS tx FROM pass_actions WHERE merchant_id = $1
       ) a ORDER BY at DESC, token_id DESC LIMIT $2`,
      [merchantId, SALES_FEED_MAX_ITEMS],
    );
    return { items: rows.map((r) => ({ kind: r.kind, tokenId: r.token_id, at: r.at.toISOString(), txUrl: r.tx ? this.txUrl(r.tx) : null })) };
  }

  // ------------------------------------------------------------------ the agent's limits, in public (F12.2)
  async agentKeys(): Promise<AgentKeysResult> {
    return this.cache.get('agentKeys', async () => {
      const [keys, config] = await Promise.all([this.near.accessKeys(this.cfg.agentAccountId), this.near.config()]);
      return {
        accountId: this.cfg.agentAccountId,
        explorerUrl: this.accountUrl(this.cfg.agentAccountId),
        contractId: this.cfg.contractId,
        contractSourceUrl: this.repoUrl ? `${this.repoUrl.replace(/\/+$/, '')}/tree/main/contracts/passes` : null,
        claimsPaused: config.claimsPaused,
        keys: keys.map((k) => ({ ...k, allowanceText: k.allowanceYocto === null ? null : nearText(k.allowanceYocto) })),
      };
    });
  }
}
