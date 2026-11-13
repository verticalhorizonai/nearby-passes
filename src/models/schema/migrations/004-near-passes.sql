-- Migration 004 (Nearby Passes, delta spec builds/nearby-passes/spec.md 3.6.1; build ruling 49): the NEAR passes.
-- merchants.near_account_id names the testnet account of a NEAR-enabled sample merchant (set by the seed from
-- NEAR_MERCHANT_ACCOUNTS_JSON); proposals.accept_intent records the intent of the last Yes ('paypal' or 'pass').
-- The new tables near_accounts, pass_claims and pass_actions are created by schema.sql (CREATE TABLE IF NOT EXISTS),
-- which runs before this file; this file adds what IF NOT EXISTS cannot add to tables that already exist.
-- Additive and idempotent, keyed on the old shape: applied at every start after schema.sql, 001, 002 and 003.
-- The schema.sql it replaces is frozen as specs/migrations/baselines/004-before.sql; tools/schema-audit.mjs proves a
-- database built from it (or from an earlier baseline) converges to specs/schema.sql.

BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS near_account_id VARCHAR(64) NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accept_intent VARCHAR(8) NULL;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_merchants_near_account' AND conrelid = 'merchants'::regclass
  ) THEN
    ALTER TABLE merchants ADD CONSTRAINT uq_merchants_near_account UNIQUE (near_account_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_proposals_accept_intent' AND conrelid = 'proposals'::regclass
  ) THEN
    ALTER TABLE proposals ADD CONSTRAINT chk_proposals_accept_intent
      CHECK (accept_intent IS NULL OR accept_intent IN ('paypal', 'pass'));
  END IF;
END
$do$;

COMMIT;
