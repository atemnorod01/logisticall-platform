// Presentation only: provider identifiers and provisioning requests stay unchanged.
export function numberWorkflowMessage(message: string | null | undefined): string {
  return (message ?? '')
    .replace(/\bBandwidth\b/gi, 'Carrier')
    .replace(/\bPorta[\s-]?One\b/gi, 'Calling service')
    .replace(/\bNet[\s-]?Sapiens\b/gi, 'Phone system')
    .replace(/\bOpen[\s-]?SIPS\b/gi, 'Call routing')
    .replace(/\b(?:Jambonz|Bambos)\b/gi, 'Voice service');
}

export const telephoneNumberMonthlyPrice = 10;

export function numberMonthlyPrice(quantity: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(quantity * telephoneNumberMonthlyPrice) + '/month';
}
