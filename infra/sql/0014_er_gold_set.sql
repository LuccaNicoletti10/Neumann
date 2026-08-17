-- Passo 22 — gold set (MATCH/NO_MATCH) para métricas e revisão humana
-- US20250165857A1 — feedback fecha o loop de aprendizado

CREATE TABLE IF NOT EXISTS er_gold_pairs (
  pair_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('MATCH', 'NO_MATCH')),
  labeled_by TEXT NOT NULL,
  labeled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

CREATE INDEX IF NOT EXISTS er_gold_pairs_label_idx ON er_gold_pairs (label);
