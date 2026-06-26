const OTP_LENGTH = 6;

export const generateSixDigitOtp = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(OTP_LENGTH));
  return Array.from(bytes, (value) => String(value % 10)).join('');
};

export const hashVocalOtp = async (matchId: string, otp: string): Promise<string> => {
  const payload = new TextEncoder().encode(`${matchId}:${otp}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
