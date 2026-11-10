BEGIN;
LOCK TABLE brag.voice_pitch IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=8) THEN
   RAISE EXCEPTION 'Pitch recovery requires schema 8';
 END IF;
END $$;
ALTER TABLE brag.voice_pitch
 ADD COLUMN audio_removed_at timestamptz,
 ADD COLUMN recovery_config_version integer REFERENCES brag.processor_config(version) ON DELETE RESTRICT,
 ADD COLUMN transcription_attempt integer NOT NULL DEFAULT 1 CHECK(transcription_attempt BETWEEN 1 AND 4),
 ADD COLUMN transcription_started_at timestamptz;
ALTER TABLE brag.voice_pitch ADD CONSTRAINT voice_recovery_attempt CHECK (
 (transcription_attempt=1 AND transcription_started_at IS NULL AND recovery_config_version IS NULL) OR
 (transcription_attempt>1 AND transcription_started_at IS NOT NULL AND isfinite(transcription_started_at)
  AND transcription_started_at>=created_at AND transcription_started_at<created_at+interval '24 hours'));
GRANT UPDATE(audio_removed_at,recovery_config_version,transcription_attempt,transcription_started_at) ON brag.voice_pitch TO brag_runtime;
CREATE INDEX voice_pitch_retained_cleanup ON brag.voice_pitch(created_at) WHERE audio_removed_at IS NULL;
UPDATE brag.runtime_metadata SET schema_version=9 WHERE id=1;
COMMIT;
