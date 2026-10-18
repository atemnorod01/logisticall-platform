-- Provider credentials live in Supabase Vault, not application-managed ciphertext.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION telephony.read_integration_secret(p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF p_id NOT IN ('portaone','netsapiens','template') OR p_id IS NULL THEN
    RAISE EXCEPTION 'Unsupported integration secret';
  END IF;
  SELECT decrypted_secret::jsonb INTO result FROM vault.decrypted_secrets
    WHERE name = 'logisticall.platform.telephony.' || p_id;
  RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION telephony.write_integration_secret(p_id text, p_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret_id uuid;
BEGIN
  IF p_id NOT IN ('portaone','netsapiens','template') OR p_id IS NULL
     OR p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Invalid integration secret';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id,711203));
  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'logisticall.platform.telephony.' || p_id;
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_value::text,'logisticall.platform.telephony.' || p_id,'LogistiCall Platform telephony integration');
  ELSE
    PERFORM vault.update_secret(secret_id,p_value::text);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION telephony.read_integration_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION telephony.write_integration_secret(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telephony.read_integration_secret(text),telephony.write_integration_secret(text,jsonb) TO platform_telephony_runtime;
-- Keep any legacy encrypted records for controlled migration, without runtime access.
REVOKE ALL ON telephony.integration_secrets FROM platform_telephony_runtime;
-- The existing provisioning service needs the same token lock during cutover,
-- without access to Platform organization records.
DO $$ BEGIN CREATE ROLE platform_telephony_credential_runtime NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA telephony TO platform_telephony_credential_runtime;
CREATE OR REPLACE FUNCTION telephony.read_provider_secret(p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_id NOT IN ('portaone','netsapiens') OR p_id IS NULL THEN RAISE EXCEPTION 'Unsupported provider'; END IF;
 RETURN telephony.read_integration_secret(p_id);
END;
$$;
CREATE OR REPLACE FUNCTION telephony.write_provider_secret(p_id text,p_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_id NOT IN ('portaone','netsapiens') OR p_id IS NULL THEN RAISE EXCEPTION 'Unsupported provider'; END IF;
 PERFORM telephony.write_integration_secret(p_id,p_value);
END;
$$;
REVOKE ALL ON FUNCTION telephony.read_provider_secret(text),telephony.write_provider_secret(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telephony.read_provider_secret(text),telephony.write_provider_secret(text,jsonb) TO platform_telephony_credential_runtime;
