// npm run near:seed (Nearby Passes spec 3.6.6, 3.7, F13.2; REQ-14-02): tops each sample offer of 3.8 up to three open
// passes once, signing as each sample merchant. Needs the NEAR variables (the operator's .env.near) and DATABASE_URL.
// Prints counts and links, never a key.
import { createPool } from '../models/db.js';
import { applySchema } from '../models/schema/runner.js';
import { seedSampleData } from './seed.js';
import { loadNearConfig } from '../services/near/nearConfig.js';
import { LiveNearAdapter } from '../services/near/liveNearAdapter.js';
import { PassService } from '../services/passes/passService.js';
import { PassUpkeep } from '../services/passes/upkeep.js';

const near = loadNearConfig(process.env);
const url = process.env.DATABASE_URL;
if (!near || !url) {
  console.error('near:seed needs NEAR_NETWORK=testnet with the NEAR variables (scripts/near/setup-testnet.sh writes them to .env.near) and DATABASE_URL.');
  process.exit(1);
}
const db = createPool(url);
try {
  await applySchema(db);
  await seedSampleData(db, near.merchantAccounts);
  const adapter = new LiveNearAdapter(near);
  const passes = new PassService(db, adapter, near, process.env.APP_BASE_URL ?? 'http://localhost:3000', process.env.APP_REPO_URL ?? null);
  const report = await new PassUpkeep(db, adapter, near, passes).topUp();
  console.log(`near:seed: minted ${report.minted} pass(es).`);
  for (const line of [...report.skipped, ...report.errors]) console.log(line);
  if (report.errors.length) process.exitCode = 1;
} finally {
  await db.end();
}
