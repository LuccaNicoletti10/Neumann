-- Migration 0015 — RBAC overlay lives on the same policy generation as EPID rows.
-- WHY: HTTP object:/action: grants, field masks, and classification must survive
-- restart without a second policy table-of-record. Empty overlay = deny-all.

ALTER TABLE policy_meta
  ADD COLUMN IF NOT EXISTS overlay jsonb NOT NULL DEFAULT '{}'::jsonb;
