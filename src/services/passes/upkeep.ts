// Upkeep (Nearby Passes spec 3.6.6, F13.4; REQ-14-04): every five minutes, for the NEAR-enabled sample merchants only,
// (1) refund their passes that expired more than fifteen minutes ago (the delay leaves a person time to press Refund
// expired themselves), (2) top each sample offer of 3.8 back up to three open passes with the values of 3.8, unless
// the merchant account holds less than NEAR_MERCHANT_FLOOR_NEAR, in which case it mints nothing for that merchant and
// logs one line; (3) the agent's balance is read by the availability check, which reports passes unavailable below
// NEAR_AGENT_FLOOR_NEAR. `npm run near:seed` runs step 2 once (src/seed/nearSeed.ts). A NEAR failure is logged and
// the next run tries again; upkeep never stops the server.
import type { Db } from '../../models/db.js';
import { OPEN_PASSES_KEPT, SAMPLE_PASS_EXPIRY_MS, UPKEEP_INTERVAL_MS, UPKEEP_REFUND_DELAY_MS } from '../../shared/types.js';
import type { NearAdapter } from '../near/adapter.js';
import type { NearConfig } from '../near/nearConfig.js';
import { nearText, parseNear } from '../near/format.js';
import type { PassService } from './passService.js';

/** The sample passes of spec 3.8: the seeded offer of each NEAR-enabled merchant and its cash back. */
export const SAMPLE_PASS_TOP_UP: { offerId: string; cashBackNear: string }[] = [
  { offerId: '00000000-0000-4000-8000-000000000101', cashBackNear: '0.1' }, // Saguaro Bean Co., any drink plus pastry
  { offerId: '00000000-0000-4000-8000-000000000102', cashBackNear: '0.1' }, // Fourth Ave Noodle Bar, 15% off lunch
  { offerId: '00000000-0000-4000-8000-000000000106', cashBackNear: '0.2' }, // Rillito Tacos, free horchata
  { offerId: '00000000-0000-4000-8000-000000000108', cashBackNear: '0.1' }, // Mesquite Dog Wash, self-serve wash
];

export interface UpkeepReport {
  refunded: number;
  minted: number;
  skipped: string[];
  errors: string[];
}

export class PassUpkeep {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly near: NearAdapter,
    private readonly cfg: NearConfig,
    private readonly passes: PassService,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  private async sampleOffers() {
    const { rows } = await this.db.query<{ merchant_id: string; name: string; near_account_id: string; offer_id: string; title: string }>(
      `SELECT m.id AS merchant_id, m.name, m.near_account_id, o.id AS offer_id, o.title
         FROM offers o JOIN merchants m ON m.id = o.merchant_id
        WHERE m.near_account_id IS NOT NULL AND o.owner_session_id IS NULL AND o.id = ANY($1::uuid[]) ORDER BY o.id`,
      [SAMPLE_PASS_TOP_UP.map((x) => x.offerId)],
    );
    return rows;
  }

  /** Step 2 of 3.6.6: bring each sample offer back to OPEN_PASSES_KEPT open passes, above the merchant's floor. */
  async topUp(report: UpkeepReport = { refunded: 0, minted: 0, skipped: [], errors: [] }): Promise<UpkeepReport> {
    for (const r of await this.sampleOffers()) {
      try {
        const open = await this.passes.openCountFresh(r.near_account_id, r.offer_id);
        const need = OPEN_PASSES_KEPT - open;
        if (need <= 0) continue;
        const balance = await this.near.balance(r.near_account_id);
        if (balance === null || BigInt(balance) < this.cfg.merchantFloorYocto) {
          const line = `upkeep: ${r.near_account_id} holds ${balance === null ? 'nothing' : nearText(balance, 2)}, under the floor of ${nearText(this.cfg.merchantFloorYocto)}; no top-up`;
          if (!report.skipped.includes(line)) report.skipped.push(line);
          continue;
        }
        const value = parseNear(SAMPLE_PASS_TOP_UP.find((x) => x.offerId === r.offer_id)!.cashBackNear);
        const res = await this.passes.mintFor({ id: r.merchant_id, name: r.name, near_account_id: r.near_account_id }, { id: r.offer_id, title: r.title }, need, value, this.now().getTime() + SAMPLE_PASS_EXPIRY_MS, 'upkeep', null);
        report.minted += res.tokenIds.length;
      } catch (e) {
        report.errors.push(`upkeep: top-up of ${r.near_account_id} failed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    return report;
  }

  /** One run of 3.6.6 steps 1 and 2. */
  async runOnce(): Promise<UpkeepReport> {
    const report: UpkeepReport = { refunded: 0, minted: 0, skipped: [], errors: [] };
    const merchants = [...new Set((await this.sampleOffers()).map((r) => r.merchant_id))];
    for (const id of merchants) {
      try {
        report.refunded += (await this.passes.refundExpired(null, id, { actor: 'upkeep', minAgeMs: UPKEEP_REFUND_DELAY_MS })).refunded.length;
      } catch (e) {
        report.errors.push(`upkeep: refunds for merchant ${id} failed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    await this.topUp(report);
    for (const line of [...report.skipped, ...report.errors]) this.log(line);
    if (report.refunded || report.minted) this.log(`upkeep: refunded ${report.refunded}, minted ${report.minted}`);
    return report;
  }

  /** Starts the timer: a first run shortly after start, then every UPKEEP_INTERVAL_MS. Runs never overlap. */
  start(firstDelayMs = 15_000): void {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.runOnce();
      } catch (e) {
        this.log(`upkeep: run failed: ${(e as Error).message.slice(0, 160)}`);
      } finally {
        this.running = false;
      }
    };
    setTimeout(() => void tick(), firstDelayMs).unref();
    this.timer = setInterval(() => void tick(), UPKEEP_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
