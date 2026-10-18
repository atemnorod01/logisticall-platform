export async function telephonyRequest(
  path: string,
  csrf: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch("/v1/platform/" + path, {
    method,
    credentials: "include",
    headers: {
      ...(method !== "GET"
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw Error(
      response.status === 409
        ? "Setup cannot start. Check organization status, provider configuration, or an operation already in progress."
        : response.status === 503
          ? "Telephony service is unavailable. Check the server configuration."
          : "The request could not be completed. Check the settings and try again.",
    );
  return response.json();
}
