-- PRIVATE PROPOSAL. Not in the automatic migration directory. Do not run on live.
-- Additive access policy only. No account/role/password/membership/stock/document rewrite.
BEGIN;
CREATE TABLE business_login_bindings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  decision_reference text NOT NULL CHECK(length(trim(decision_reference)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT
);
COMMENT ON TABLE business_login_bindings IS 'Explicit reviewed one-login/one-Business assignment; historical membership rows remain unchanged. No default-derived backfill.';
COMMIT;
-- Rollback is operationally gated: disable BUSINESS_LOGIN_BINDINGS_ENABLED first,
-- preserve reviewed binding records, then remove this additive table only if approved.
-- This proposal deliberately contains no binding inserts or executable rollback deletion.
