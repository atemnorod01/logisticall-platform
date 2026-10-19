import { lazy, Suspense, useMemo } from "react";
import {
  createNumberConsole,
  NumberConsoleContext,
} from "./number-provisioning/console-api.js";
import "./styles/platform-phone-numbers.css";
const TelephoneNumbers = lazy(() =>
  import("./number-provisioning/TelephoneNumbers.js").then((m) => ({
    default: m.TelephoneNumbers,
  })),
);
export function OrganizationPhoneNumbers({
  csrf,
  organization,
}: {
  csrf: string;
  organization: { id: string; name: string };
}) {
  const client = useMemo(
    () => createNumberConsole(csrf, organization.id),
    [csrf, organization.id],
  );
  return (
    <section className="admin lc-platform-admin lc-organization-numbers">
      <div className="lc-number-console">
        <NumberConsoleContext.Provider value={client}>
          <Suspense fallback={<p role="status">Loading phone numbers…</p>}>
            <TelephoneNumbers organization={organization} />
          </Suspense>
        </NumberConsoleContext.Provider>
      </div>
    </section>
  );
}
