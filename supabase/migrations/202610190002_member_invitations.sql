-- Recover interrupted pending-member PBX setup without replaying ambiguous writes.
-- Contains identities and progress only; invitation tokens/passwords are never saved here.
CREATE TABLE telephony.member_invitations (
 id text PRIMARY KEY,
 organization_id uuid NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_invitations_pending ON telephony.member_invitations(organization_id) WHERE data->>'stage' IN ('reserved','writing');
REVOKE ALL ON telephony.member_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON telephony.member_invitations TO platform_telephony_runtime;
ALTER TABLE telephony.member_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_invitations_runtime ON telephony.member_invitations TO platform_telephony_runtime USING(true) WITH CHECK(true);
