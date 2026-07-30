/**
 * UtahMeta - Encryption utilities for edge node cache at rest
 *
 * Uses AES-256-GCM to encrypt/decrypt media files chunk-by-chunk.
 * Each encrypted file has a 12-byte IV prepended, followed by the
 * ciphertext. The GCM auth tag is appended at the end (Node.js convention).
 *
 * The encryption key is a 256-bit (32-byte) random value generated per
 * HomeNode by the server and delivered to the edge agent over the
 * authenticated API channel.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const CHUNK_SIZE = 64 * 1024; // 64KB chunks
const TAG_LENGTH = 16; // GCM auth tag

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

export function hexToKey(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext Buffer. Returns a Buffer with IV prepended:
 * [12-byte IV][ciphertext][16-byte auth tag]
 */
export function encryptChunk(
  key: Buffer,
  plaintext: Buffer,
  iv: Buffer
): Buffer {
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}

/**
 * Decrypt a chunk. Input is [ciphertext][16-byte auth tag].
 * Returns the plaintext.
 */
export function decryptChunk(
  key: Buffer,
  ciphertext: Buffer,
  iv: Buffer
): Buffer {
  if (ciphertext.length < TAG_LENGTH) {
    throw new Error("Ciphertext too short to contain auth tag");
  }
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Generate a new random IV for a chunk.
 */
export function generateIV(): Buffer {
  return randomBytes(IV_LENGTH);
}

export { ALGORITHM, IV_LENGTH, CHUNK_SIZE, TAG_LENGTH };
