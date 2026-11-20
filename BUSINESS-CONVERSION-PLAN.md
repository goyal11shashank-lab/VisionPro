# Private Business conversion checkpoint

20 November 2026. Source-only implementation and disposable synthetic tests. Not a release approval or a migration runbook.

## Working behavior

- Every existing Business keeps its identifier. New generic supplier/customer links do not require a MAIN/DEALER classification or a parent hierarchy.
- Linked order creation, dispatch, partial inspection and purchase posting work through that generic relationship in synthetic tests. Both existing logistics families remain stored and are not deleted.
- Exact stock lookup returns two labelled availability booleans. It does not grant another Business's quantities, rates, accounts or settings. Old raw-feed HTTP aliases are retired; raw service defaults deny ordinary callers.
- Ordinary Business navigation uses the standard own-Business dashboard and permission-filtered modules. The Business profile form no longer asks for a warehouse/dealer type. Supplier-link changes have a separate Super Admin confirmation.
- New legacy stock-scope creation is retired through both HTTP mounts. Existing stock-scope records, configurations, staff attribution and B2B history remain visible in legacy administration while conversion is incomplete.
- Receiving includes per-line powers, prior counts, remaining counts, half-pair validation, review, explicit confirmation, history and result. A stable attempt reference protects partial receipts from duplicate posting after a lost response, including after a page reload.
- Receipt posting, attempt record and accounting audit commit together. Failed pre-commit transactions roll back. An uncertain commit keeps the saved attempt rather than encouraging a new posting.

## Explicit one-Business login candidate

`business_login_bindings` is an additive SQL proposal under `server/db/proposals`, not an automatic migration. It contains no real mappings or backfill. The runtime candidate is disabled unless `BUSINESS_LOGIN_BINDINGS_ENABLED=true` is explicitly configured after approved schema/mapping work.

A reviewed binding narrows active login, session, list, detail and switch choices to one existing authorized Business. It does not delete historical memberships or defaults, change credentials, or alter Super Admin access. Unmapped ordinary logins are unchanged. Existing defaults do not count as permission to revoke another active Business.

Legacy stock-assigned users cannot use this candidate for cutover until historical read adapters are complete. A parent-Business membership is not a substitute for that stock restriction.

## Legacy identity staging, not active conversion

`business_origin_bindings` is a separate additive SQL proposal, also outside automatic migrations. The staging service has no HTTP execution endpoint. Given an explicit reviewed identity/name choice, it stages a separate INACTIVE Business and a binding to the original owning Business and stock-scope identifier.

- No stock, reservation, document or ledger row moves.
- No historical foreign key is rewritten.
- No user is provisioned or reassigned. Passwords and memberships remain unchanged.
- Existing inter-business orders, shipments, receipts and godown-linked B2B records remain untouched.
- Repeated matching staging is idempotent; conflicting identities reject.
- Audit failure rolls identity creation back.
- The proposal schema deliberately permits only STAGED, not ACTIVE.

Staging is reversible preparation. It is not permission to activate a new Business, remap users, or run a migration.

## Historical scope safety

Legacy stock-assigned authentication resolves an owning Business. That does not make all of the owning Business's data safe for that login.

Private changes explicitly scope inventory and stock-ledger reads to the assigned origin and ignore client attempts to select MAIN, ALL or a foreign stock scope. Unadapted dashboard, search, exports, settings and cross-Business paths deny these historical logins. Direct financial-document access also requires an exact matching stock-scope identifier, including denial of unassigned parent documents. A dedicated assigned-stock history screen uses the scoped report.

This is intentionally restrictive until conversion adapters exist. It is not a claim that all historical staff workflows are ready. Ordinary Business users and intentional Super Admin behavior are separate cases.

## Concrete mapping proposal

- `sales`: keep the current login identifier and password. Proposed operating Business is Lumina. Prepare a local Salesman role, not a shared global-role rename. Before any live change, inspect effective user overrides and current assignments again.
- `aocity`: preserve the existing Ankit Optical stock assignment and credentials. Proposed independent identity is a separate Ankit Optical Business, not broad Lumina access. Its final identity/name and current reference inventory need review before any staging or cutover.
- `dlr_only_l1nq5n1` and `user_dlra_l1nq5n1`: owner identified these as AI-created tests on November20. No further A/B choice is needed for these names. No live access changes have been applied.
- Ordinary users with no membership rows may have derived access. Do not bulk-lock them out from a membership-only inventory.

The protected backup snapshot showed aocity assigned to Ankit Optical under Lumina and no attributed stock, ledger, reservation, SO/SI, PO/PI, customer/supplier-ledger, payment or destination-B2B rows in that snapshot. This is stale backup evidence only, not a current all-history clearance.

## Still required before full readiness

1. Complete and verify all historical scoped-read adapters and reviewed opening-balance/cutover behavior before any staged Business becomes active.
2. Refresh current mapping/reference evidence; obtain only the unresolved identity/access choices.
3. Replace the remaining legacy management/provisioning adapters with generic Business workflows without breaking either logistics family.
4. Verify the preserved godown-linked B2B lifecycle under the eventual identity adapter, not merely preserve its rows.
5. Finish broader mobile checks for ordinary Business, staff, settings and historical views. Receiving and exact-availability phone checks are separate tested slices.
6. Re-run clean-apply, full regression and operational checks on the final combined candidate. Physical paper print verification remains separate.
7. Obtain the owner's explicit release/account/migration go-ahead. No source checkpoint lifts the current holds.


## November20 cleanup clarification and protection gate

The owner clarified that other Businesses besides Lumina may be cleaned up and new test Businesses may be created; non-SuperAdmin users may be edited. Lumina and the Super Admin user are protected. Preserve every existing Super Admin account unless the owner identifies an exception, including memberships and shared roles, not merely password and isSuperAdmin flag.

Current read-only inspection found VisionCraft Optical Labs remains a secondary membership of existing Super Admin accounts admin, manager and accounts. That target is held because deletion would change protected access. Lumina also parents existing test dealer records; no inference of deletion safety follows from a zero displayed user count.

The baseline Business deletion surface omitted newer cascading logistics references and swallowed dependency-query errors. The legacy dealer-delete path could also delete counterpart parties. Private fixes use a conservative reference-free deletion gate, including every declared Business foreign key, JSON relationships and counterpart party notes. Protected/current Business and cleanup whose audit would write to protected Lumina are blocked. Any referenced row, including roles, access, settings and audits, blocks deletion rather than silently cascading. Inspection errors fail closed. Target locking and a second check occur in the deletion transaction; audit failure rolls deletion back. The old bulk cleanup execution script is retired. None of these fixes is published or a clearance for live cleanup.

## Additional historical financial slice

Assigned-origin sales/purchase registers, detail, returns and payment reports now use the exact origin scope for rows and summaries. Return scope is derived through the original invoice. Exports remain denied.

A separate Assigned Financial Activity view reports only attributed debit/credit activity. It never selects stored parent-wide running balances. Exact referenced documents can recover attribution for an origin-omitting reversal, while parent/foreign/conflicting attribution is excluded. No opening, closing or outstanding balance is inferred. The view states its incomplete reconciliation status before showing totals. True statements/outstanding remain unavailable until reviewed reconciliation, and this slice does not make independent identity cutover ready.


## November20 reversible Super Admin visibility

The owner permits removing the AI-created non-Lumina Businesses from the Super Admin view. A separate Hide/Show operation clears normal administration and top-dropdown clutter without changing operational status, user rows, roles, membership/default access, staff login, linked availability or transactions. Hidden Businesses remain available through an explicit filter and can be shown again. This is not a second operational inactive status; the owner's separate inactive-login/new-entry semantics question remains open.

Visibility is saved in the target Business configuration with an atomic audit. Lumina cannot be hidden, including in a mixed bulk request. Super Admin membership is not a hiding blocker because membership rows never change. Existing protected-SuperAdmin-linked deletion targets remain blocked for destructive cleanup. Replays add no writes; missing targets or audit failure roll the entire batch back. Login and session responses carry the display flag, while ordinary users' choices and existing sessions are unaffected.

The real isolated UI test covers Hide, normal-list/dropdown absence, hidden-filter recovery, Show, restored list/dropdown, desktop and390px pixels. HTTP tests compare all other tables, preserve settings and operational status, reject ordinary callers, protect Lumina and test rollback. No live visibility change has run. The deployed site still shows48 ACTIVE Businesses at12:11, with old hierarchy navigation. Its frontend bundle exactly matches the earlier admin/half-sheet print candidate; the newer work here remains private.


## Later read-history and generic creation slice

Assigned Supplier Order History now has a read-only exact-reference adapter. Original owner Business, destination origin, destination purchase order and source order/invoice must agree; raw sync payloads, diagnostic text, source prices and parent party fields are never selected. Unlinked and conflicting records are excluded, not silently attributed. Original IDs remain visible as provenance. This does not activate an independent identity or allow retries/acceptance/receiving.

Generic Business creation now atomically creates its row, default settings and audit without changing existing Super Admin memberships/roles/defaults. Existing Super Admin authority already provides access. New creation rejects a legacy dealer/warehouse parent hierarchy; supplier links remain a separate reviewed action. Failure of settings or audit rolls creation back. No users, parties, stock or documents are auto-created. Historical profile records are not rewritten.

The deletion gate also checks the legacy parent_business_id relationship, which has no database foreign key, alongside JSON references.

At12:16 the owner reiterated an all-active Super Admin view expectation after the synthetic screenshot caused confusion. Prospective bulk visibility application is paused pending clarification. Live12:17 inspection confirms the same48ACTIVE Business IDs/names as12:09, protected Lumina Opticals Pvt Ltd present andACTIVE. No exact separate Meena/Mina name/trade-name match was found. Absence is not evidence of deletion, and those names are not assumed identical. No live hide/delete/status/account/release effect occurred.

Owner12:18 clarified the screenshot was mistaken for live. Future synthetic screenshots delivered to the owner must carry a conspicuous TEST / NOT LIVE label inside the pixels. This resolves the screenshot provenance confusion, not the separate pending inactive-access or Meena-name questions, and does not lift any live-effect hold.
