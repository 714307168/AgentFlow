import { createECDH, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { EventEmitter } from "events";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const CURVE = "prime256v1"; // Also known as secp256r1 or P-256, widely supported

export interface EncryptedPayload {
  encrypted: true;
  ciphertext: string; // base64
  nonce: string;      // base64
}

class E2ECrypto extends EventEmitter {
  private ecdh = createECDH(CURVE);
  private sharedSecrets: Map<string, Buffer> = new Map(); // deviceId -> sharedSecret
  private publicKey: string; // base64

  constructor() {
    super();
    this.ecdh.generateKeys();
    this.publicKey = this.ecdh.getPublicKey("base64");
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  deriveSharedSecret(peerId: string, peerPublicKey: string): void {
    const peerKey = Buffer.from(peerPublicKey, "base64");
    const shared = this.ecdh.computeSecret(peerKey);
    this.sharedSecrets.set(peerId, shared);
    this.emit("key-established", peerId);
  }

  hasKey(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  encrypt(peerId: string, plaintext: string): EncryptedPayload | null {
    const secret = this.sharedSecrets.get(peerId);
    if (!secret) return null;

    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, secret.subarray(0, 32), nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      encrypted: true,
      ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
      nonce: nonce.toString("base64"),
    };
  }

  decrypt(peerId: string, payload: EncryptedPayload): string | null {
    const secret = this.sharedSecrets.get(peerId);
    if (!secret) return null;

    const nonce = Buffer.from(payload.nonce, "base64");
    const data = Buffer.from(payload.ciphertext, "base64");
    const tag = data.subarray(data.length - 16);
    const ciphertext = data.subarray(0, data.length - 16);

    const decipher = createDecipheriv(ALGORITHM, secret.subarray(0, 32), nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  removeKey(peerId: string): void {
    this.sharedSecrets.delete(peerId);
  }

  reset(): void {
    this.sharedSecrets.clear();
    this.ecdh.generateKeys();
    this.publicKey = this.ecdh.getPublicKey("base64");
  }
}

export default E2ECrypto;
