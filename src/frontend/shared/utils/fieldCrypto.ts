const ENC_PREFIX = 'enc:';

// Cachea la PROMESA, no el resultado. Así todas las llamadas concurrentes esperan
// la misma importación en vez de recibir null antes de que termine.
const getKey = (() => {
  let promise: Promise<CryptoKey | null> | null = null;
  return (): Promise<CryptoKey | null> => {
    if (promise) return promise;
    promise = (async () => {
      const hex = import.meta.env.VITE_DATA_ENC_KEY as string | undefined;
      if (!hex || hex.length < 64) return null;
      try {
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
      } catch {
        return null;
      }
    })();
    return promise;
  };
})();

export const encryptField = async (value: string): Promise<string> => {
  if (!value) return value;
  const key = await getKey();
  if (!key) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  const buf = new Uint8Array(12 + cipher.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(cipher), 12);
  return ENC_PREFIX + btoa(String.fromCharCode(...buf));
};

export const decryptField = async (value: string): Promise<string> => {
  if (!value?.startsWith(ENC_PREFIX)) return value;
  const key = await getKey();
  if (!key) return value;
  try {
    const buf = Uint8Array.from(atob(value.slice(ENC_PREFIX.length)), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(0, 12) },
      key,
      buf.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return value;
  }
};
