-- Short-lived anti-replay receipts, isolated from tenant and credential schemas.
CREATE TABLE telephony.number_service_requests (
 id uuid PRIMARY KEY,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes'
);
CREATE INDEX number_service_request_expiry ON telephony.number_service_requests(expires_at);
ALTER TABLE telephony.number_service_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON telephony.number_service_requests TO platform_telephony_runtime;
CREATE POLICY number_service_receipts ON telephony.number_service_requests TO platform_telephony_runtime USING(true) WITH CHECK(true);
