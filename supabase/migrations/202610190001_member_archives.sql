-- Retain exact PBX targets and partial progress; never delete call/message history.
CREATE TABLE telephony.member_archives (
 id text PRIMARY KEY,
 organization_id uuid NOT NULL,
 user_id uuid NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON telephony.member_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON telephony.member_archives TO platform_telephony_runtime;

ALTER TABLE telephony.member_archives ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_archives_runtime ON telephony.member_archives TO platform_telephony_runtime USING(true) WITH CHECK(true);
