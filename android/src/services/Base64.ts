// atob is available at runtime via Hermes's global polyfill (same as btoa,
// already used elsewhere in this codebase — TS just doesn't have it in its
// configured lib types, hence the @ts-ignore).

export function base64ToBytes(b64: string): Uint8Array {
  // @ts-ignore
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
