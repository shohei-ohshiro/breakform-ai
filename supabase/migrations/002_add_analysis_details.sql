-- BreakForm AI: Add detailed analysis columns for multi-frame pipeline
-- Run this SQL in Supabase SQL Editor after 001_create_tables.sql

-- New columns for rule-based analysis pipeline
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS feature_json JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS event_json JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS rule_result_json JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS viewpoint TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS quality_check_result JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS final_score INTEGER CHECK (final_score BETWEEN 0 AND 100);

-- Add comments for clarity
COMMENT ON COLUMN analyses.feature_json IS 'Extracted features: angles, CoG, velocities, static intervals';
COMMENT ON COLUMN analyses.event_json IS 'Detected technique events (hand plants, leg swings, phase changes)';
COMMENT ON COLUMN analyses.rule_result_json IS 'Full rule-based evaluation result with score breakdown';
COMMENT ON COLUMN analyses.viewpoint IS 'Detected camera viewpoint: front, side, back, top, unknown';
COMMENT ON COLUMN analyses.quality_check_result IS 'Pose detection quality metrics';
COMMENT ON COLUMN analyses.final_score IS 'Rule-based final score (deterministic)';
