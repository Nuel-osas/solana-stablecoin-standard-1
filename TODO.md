# TODO — Bounty Improvements

## Priority 1: CT Proof Artifacts — DONE
- [x] Created `evidence/CT-PROOF.md` with full documentation
- [x] Re-run `yarn test:ct` — all 8/8 checks passed
- [x] Captured `evidence/ct-localnet-proof.log` with full output
- [ ] Consider screen recording of the CT demo (nice-to-have)

## Priority 2: GitHub Actions CI — DONE
- [x] Add `.github/workflows/ci.yml` — 5 jobs (build, anchor test, SDK test, backend test, frontend build)
- [x] Add badge to README

## Priority 3: More Tests — DONE (134 anchor + 13 CLI + 24 SDK + 24 backend + 6 docker + 17 fuzz = 218+)
- [x] Role escalation attempts (non-authority tries to assign all roles) — 5 tests
- [x] Minter can't escalate to assign other minters — 1 test
- [x] Pauser can't escalate to assign roles — 1 test
- [x] Burner can't mint (cross-role protection) — 1 test
- [x] Double-blacklist / re-blacklist after removal — 2 tests
- [x] Mint beyond supply cap edge cases — 4 tests
- [x] Burn-then-remint within cap (net supply check) — 1 test
- [x] Pause/unpause cycle + revoked pauser — 7 tests
- [x] Burn more than balance, burn exact balance, burn empty — 3 tests
- [x] Burn from non-burner rejected — 1 test
- [x] Freeze already frozen (double freeze) — 1 test
- [x] Thaw non-frozen account fails — 1 test
- [x] Frozen account can't receive minted tokens — 1 test
- [x] Allowlist: non-authority add/remove, duplicate, SSS-1 rejection — 6 tests
- [x] Minter quota: mint exactly at boundary — 1 test
- [x] Minter quota: mint 1 over quota — 1 test
- [x] Authority transfer: overwrite nomination, wrong accept, old authority locked — 6 tests
- [x] Direct transfer clears pending — 1 test
- [x] Seize from non-blacklisted account — 1 test
- [x] Authority as direct blacklister (no role needed) — 1 test
- [x] Unauthorized blacklist rejected — 1 test
- [x] Multiple minters with independent quotas — 4 tests
- [x] Initialization edge cases (0/9 decimals, all features, min cap, metadata) — 6 tests
- [x] Combined compliance lifecycle (mint→pause→reject→unpause→burn, mint→blacklist→seize) — 3 tests
- [x] Minter quota management (unauthorized update, increase, reset to unlimited) — 4 tests
- [x] Audit trail preservation (revoke preserves PDA with active=false) — 1 test
- [x] CLI smoke tests (help, status, roles list/check on devnet) — 13 tests
- [x] Trident fuzz invariants expanded to 17 flows (was 7)
- [x] Oracle stale/depeg rejection — tested on devnet via `yarn test:oracle:devnet` (4 tests, SOL/USD depeg detection works)
- [x] Transfer hook enforcement — proven in e2e CT test (14/14, hook enforces allowlist during CT)

## Priority 4: RBAC Audit Fields — DONE
- [x] Added `granted_by: Pubkey` and `granted_at: i64` to `RoleAssignment`
- [x] Updated `RoleAssignment::LEN` for new fields
- [x] Populated in `assign_role_handler`
- [x] Test assertions for `grantedBy == authority` and `grantedAt > 0`
- [x] Redeployed to devnet
- Our revocation (active=false) still preserves audit trail — better than competitor's close-account

## Priority 5: Post X Video (required by bounty)
- [ ] Record demo showcasing CT, CLI, frontend, TUI
- [ ] Post on X with bounty hashtags

## Lower Priority (if time allows)
- [x] Add `update-metadata` on-chain instruction
- [x] End-to-end CT through SSS-3 program mint with hook + allowlist — 14/14 checks passed!

## Already Done
- [x] Generic role management CLI (roles assign/revoke/list/check)
- [x] Human-readable amounts in CLI mint/burn
- [x] Oracle null fix in CLI + frontend MintBurn.tsx
- [x] Oracle overflow fix (u16 → i64 comparison)
- [x] Centralized .env config for CLI/TUI/frontend
- [x] transfer-authority CLI command
- [x] CT verified on localnet (Phase 1 + Phase 2 with real ZK proofs)
- [x] End-to-end CT on SSS-3 program mint with hook + allowlist (14/14 checks)
- [x] Transfer hook fallback handler fix (Token-2022 uses interface discriminator, not Anchor's)
- [x] CLI auto-initializes ExtraAccountMetaList on `init sss-2` / `init sss-3`
- [x] 218+ tests (134 anchor + 13 CLI + 24 SDK + 24 backend + 6 docker + 17 fuzz)
- [x] GitHub Actions CI pipeline (5 jobs) + README badge
- [x] evidence/CT-PROOF.md with full CT documentation
- [x] Programs deployed to devnet
- [x] security_txt! macro on both programs
- [x] PR #41 updated with full description
- [x] README comprehensive with all CLI commands documented

## Key Context
- Bounty: $5K pool, Superteam Earn
- Our PR: #41 at solanabr/solana-stablecoin-standard
- Our biggest advantage: ONLY submission with END-TO-END ZK confidential transfers on SSS-3 program mints (14/14 checks, hook + allowlist enforced)
- Main competitor: #6 (rz1989s, 133/150) — we now match/exceed on tests (218+ vs 203) and CI (5 jobs each)
- Fork repo (PR source): Nuel-osas/solana-stablecoin-standard-1
- Program IDs: sss_token=BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq, sss_transfer_hook=B9HzG9fuxbuJBG2wTSP6UmxBSQLdaUAk62Kcdf41WxAt
