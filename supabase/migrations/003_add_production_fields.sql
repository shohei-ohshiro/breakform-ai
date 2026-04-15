-- BreakForm AI: Sprint 3 production fields
-- Adds columns for quality classification, retake reasons, structured summary,
-- and build/evaluator versioning. Run after 002_add_analysis_details.sql.

-- Overall reliability score (0..1) derived from quality impact summary.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS reliability REAL
  CHECK (reliability IS NULL OR (reliability >= 0 AND reliability <= 1));

-- 3-level UX classification: good / reference / retry
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS quality_level TEXT
  CHECK (quality_level IS NULL OR quality_level IN ('good', 'reference', 'retry'));

-- Structured retake hints surfaced on the result UI
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS retake_reasons JSONB DEFAULT '[]'::jsonb;

-- Versioned structured summary (currently middle_split only)
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS structured_summary JSONB;

-- Provenance: which evaluator/client/server version produced this row
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS evaluator_config_version TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS build_id TEXT;

-- Comments
COMMENT ON COLUMN analyses.reliability IS
  'Overall reliability derived from quality impact summary (0..1).';
COMMENT ON COLUMN analyses.quality_level IS
  'UX classification based on reliability + technique-specific gates.';
COMMENT ON COLUMN analyses.retake_reasons IS
  'List of { code, message, howToFix } for the result UI retake banner.';
COMMENT ON COLUMN analyses.structured_summary IS
  'Versioned canonical summary object (e.g. middle_split_summary_v1).';
COMMENT ON COLUMN analyses.evaluator_config_version IS
  'Evaluator/config version used to score this row.';
COMMENT ON COLUMN analyses.app_version IS
  'NEXT_PUBLIC_APP_VERSION at the time of scoring.';
COMMENT ON COLUMN analyses.build_id IS
  'NEXT_PUBLIC_BUILD_ID at the time of scoring.';

-- Helpful index for quality dashboards
CREATE INDEX IF NOT EXISTS idx_analyses_quality_level ON analyses(quality_level);
CREATE INDEX IF NOT EXISTS idx_analyses_evaluator_config_version ON analyses(evaluator_config_version);
