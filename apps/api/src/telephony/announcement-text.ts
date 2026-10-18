export const inventoryAttendantName = "Unassigned Inventory";

/** Remove only trailing legal suffixes; retain the organization's stored name. */
export function spokenCompanyName(name: string): string {
  let result = name.trim();
  const suffix =
    /(?:[\s,]+)(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|l\.?l\.?c\.?|l\.?l\.?p\.?|l\.?p\.?|p\.?l\.?c\.?)\s*[,\.]*$/i;
  while (suffix.test(result)) {
    const next = result
      .replace(suffix, "")
      .trim()
      .replace(/[,\s]+$/, "");
    if (!next) break;
    result = next;
  }
  return result.replace(/[.\s]+$/, "");
}

export function inventoryAnnouncementText(name: string): string {
  return `You have reached an unassigned number at ${spokenCompanyName(name)}.`;
}
