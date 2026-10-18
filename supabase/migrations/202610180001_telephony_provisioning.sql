-- Dedicated control-plane role: no tenant communications or IAM privileges.
CREATE SCHEMA IF NOT EXISTS telephony;
REVOKE ALL ON SCHEMA telephony FROM PUBLIC;
DO $$ BEGIN CREATE ROLE platform_telephony_runtime NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE telephony.organizations (
 organization_id uuid PRIMARY KEY,
 data jsonb NOT NULL CHECK (data->>'id'=organization_id::text),
 state text NOT NULL CHECK(state IN ('running','failed','complete')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX telephony_customer_unique ON telephony.organizations ((data->>'portaoneId')) WHERE data->>'portaoneId' IS NOT NULL;
CREATE UNIQUE INDEX telephony_domain_unique ON telephony.organizations ((data->>'netsapiensDomain')) WHERE data->>'netsapiensDomain' IS NOT NULL;
CREATE TABLE telephony.integration_secrets(id text PRIMARY KEY,envelope jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE telephony.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid,actor_id uuid NOT NULL,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE telephony.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.audit ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA telephony TO platform_telephony_runtime;
GRANT SELECT,INSERT,UPDATE ON telephony.organizations,telephony.integration_secrets TO platform_telephony_runtime;
GRANT INSERT ON telephony.audit TO platform_telephony_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA telephony TO platform_telephony_runtime;
CREATE POLICY telephony_operations ON telephony.organizations TO platform_telephony_runtime USING(true) WITH CHECK(true);
CREATE POLICY telephony_credentials ON telephony.integration_secrets TO platform_telephony_runtime USING(true) WITH CHECK(true);
CREATE POLICY telephony_audit_insert ON telephony.audit FOR INSERT TO platform_telephony_runtime WITH CHECK(true);
