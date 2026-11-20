-- PRIVATE PROPOSAL, excluded from automatic migrations. Do not run on live.
-- Additive identity staging. Existing godown/document/stock foreign keys are retained.
BEGIN;
CREATE TABLE business_origin_bindings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE RESTRICT,
  storage_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  legacy_godown_id uuid NOT NULL UNIQUE REFERENCES godowns(id) ON DELETE RESTRICT,
  state varchar(20) NOT NULL DEFAULT 'STAGED' CHECK(state IN ('STAGED')),
  decision_reference text NOT NULL CHECK(length(trim(decision_reference)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  CHECK(business_id <> storage_business_id)
);
COMMENT ON TABLE business_origin_bindings IS 'Staged independent Business identity only. No active login cutover until all historical read and ledger adapters are reviewed.';
COMMIT;
-- No row backfill or stock/document/user rewrite is included.
-- ACTIVE is deliberately not a valid state in this proposal.
