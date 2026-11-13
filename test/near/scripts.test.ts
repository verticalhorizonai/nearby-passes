// SEC-14-01-01 (REQ-14-01; Nearby Passes spec rule 3, 3.7): the operator's NEAR scripts never print a key, write
// .env.near with mode 600, and .env.near is git-ignored. Reads the scripts as text; runs nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '../../scripts/near');
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') || f.endsWith('.sh'));
const SECRET_NAMES = /PRIVATE_KEY|KEYS_JSON|DEMO_ACCOUNT_SECRET|_KEY\b|\bkp\b|merchantKey|kp\.toString|secretKey/;

describe('SEC-14-01-01: the NEAR scripts never print a key', () => {
  it('has the six scripts of spec 3.7', () => {
    for (const f of ['setup-testnet.sh', 'deploy.sh', 'rotate-agent.sh', 'push-railway.sh', 'smoke.mjs']) expect(files).toContain(f);
  });

  for (const f of files) {
    it(`${f}: no output line names a key`, () => {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      const printing = lines.filter((l) => /console\.(log|error|info|warn)|process\.(stdout|stderr)\.write|\becho\b|\bprintf\b|\bsay\(|\bfail\(/.test(l));
      const leaks = printing.filter((l) => SECRET_NAMES.test(l) && !/is not set|is missing|not in \.env\.near|skipped|set"|<hidden>|holds the variables|Holds private keys/.test(l));
      expect(leaks).toEqual([]);
    });
  }

  it('push-railway.sh sends values through standard input only, and never the operator-only keys', () => {
    const s = readFileSync(join(dir, 'push-railway.sh'), 'utf8');
    expect(s).toMatch(/railway variable set "\$name" --stdin/);
    expect(s).not.toMatch(/NEAR_OWNER_PRIVATE_KEY|NEAR_CONTRACT_PRIVATE_KEY/);
    expect(s).not.toMatch(/--set\b|--set-from-stdin/);
    expect(s).toMatch(/refusing the service 'nearby'/);
  });

  it('.env.near is written with mode 600 and is git-ignored', () => {
    const lib = readFileSync(join(dir, 'lib.mjs'), 'utf8');
    expect(lib).toMatch(/mode: 0o600/);
    expect(lib).toMatch(/chmodSync\(path, 0o600\)/);
    expect(readFileSync(join(__dirname, '../../.gitignore'), 'utf8')).toMatch(/^\.env\.near$/m);
  });
});
