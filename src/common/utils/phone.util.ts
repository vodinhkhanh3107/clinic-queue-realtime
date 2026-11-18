export function normalizePhoneE164(phone: string): string {
  const cleaned = phone.replace(/[\s.-]/g, '');
  if (cleaned.startsWith('+84')) {
    return cleaned;
  }
  if (cleaned.startsWith('84') && cleaned.length >= 11) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    return `+84${cleaned.slice(1)}`;
  }
  return cleaned;
}