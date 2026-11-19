/**
 * Web Crypto password hashing (PBKDF2-SHA256) and token utilities
 * built specifically for Cloudflare Workers runtime (zero Node dependencies).
 */

const PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export function randomHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateAccountId(): string {
  return `acc_${randomHex(16)}`;
}

export function generatePublicPlayerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `WA-${suffix}`;
}

export function generatePlayerTag(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const val = ((bytes[0] << 8) | bytes[1]) % 10000;
  return String(val).padStart(4, '0');
}

export function generateResetCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(
  password: string,
  saltHex?: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = saltHex || randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const saltBytes = hexToBytes(salt);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS,
  );
  return {
    hash: bytesToHex(new Uint8Array(derived)),
    salt,
    iterations,
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<boolean> {
  if (!password || !storedHash || !storedSalt) return false;
  const computed = await hashPassword(password, storedSalt, iterations);
  return timingSafeEqualHex(computed.hash, storedHash);
}
