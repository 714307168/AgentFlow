import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "crypto";
import { EventEmitter } from "events";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const CURVE = "prime256v1"; // secp256r1 / P-256

export interface EncryptedPayload {
  encrypted: true;
  ciphertext: string; // base64
  nonce: string;      // base64
}

class E2ECrypto extends EventEmitter {
  private privateKey: KeyObject;
  private publicKeyObject: KeyObject;
  private sharedSecrets: Map<string, Buffer> = new Map(); // deviceId -> sharedSecret
  private roomKeys: Map<string, Buffer> = new Map();
  private publicKey: string; // base64

  constructor() {
    super();
    const keyPair = this.generateKeyPair();
    this.privateKey = keyPair.privateKey;
    this.publicKeyObject = keyPair.publicKey;
    this.publicKey = this.exportPublicKeyBase64(this.publicKeyObject);
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  deriveSharedSecret(peerId: string, peerPublicKey: string): void {
    const peerKey = createPublicKey({
      key: Buffer.from(peerPublicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const shared = diffieHellman({
      privateKey: this.privateKey,
      publicKey: peerKey,
    });
    this.sharedSecrets.set(peerId, shared);
    this.emit("key-established", peerId);
  }

  hasKey(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  encrypt(peerId: string, plaintext: string): EncryptedPayload | null {
    const secret = this.sharedSecrets.get(peerId);
    if (!secret) return null;

    return this.encryptWithKey(secret, plaintext);
  }

  encryptWithRoomKey(roomId: string, plaintext: string): EncryptedPayload | null {
    const roomKey = this.roomKeys.get(roomId);
    if (!roomKey) return null;

    return this.encryptWithKey(roomKey, plaintext);
  }

  decrypt(peerId: string, payload: EncryptedPayload): string | null {
    const secret = this.sharedSecrets.get(peerId);
    if (!secret) return null;

    return this.decryptWithKey(secret, payload);
  }

  decryptWithRoomKey(roomId: string, payload: EncryptedPayload): string | null {
    const roomKey = this.roomKeys.get(roomId);
    if (!roomKey) return null;

    return this.decryptWithKey(roomKey, payload);
  }

  hasRoomKey(roomId: string): boolean {
    return this.roomKeys.has(roomId);
  }

  getOrCreateRoomKey(roomId: string): string {
    const existing = this.roomKeys.get(roomId);
    if (existing) {
      return existing.toString("base64");
    }
    const nextKey = randomBytes(32);
    this.roomKeys.set(roomId, nextKey);
    return nextKey.toString("base64");
  }

  setRoomKey(roomId: string, encodedKey: string): void {
    const decoded = Buffer.from(encodedKey, "base64");
    if (decoded.length >= 32) {
      this.roomKeys.set(roomId, decoded.subarray(0, 32));
    }
  }

  removeRoomKey(roomId: string): void {
    this.roomKeys.delete(roomId);
  }

  private encryptWithKey(key: Buffer, plaintext: string): EncryptedPayload {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key.subarray(0, 32), nonce);
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

  private decryptWithKey(key: Buffer, payload: EncryptedPayload): string | null {
    const nonce = Buffer.from(payload.nonce, "base64");
    const data = Buffer.from(payload.ciphertext, "base64");
    const tag = data.subarray(data.length - 16);
    const ciphertext = data.subarray(0, data.length - 16);

    const decipher = createDecipheriv(ALGORITHM, key.subarray(0, 32), nonce);
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
    this.roomKeys.clear();
    const keyPair = this.generateKeyPair();
    this.privateKey = keyPair.privateKey;
    this.publicKeyObject = keyPair.publicKey;
    this.publicKey = this.exportPublicKeyBase64(this.publicKeyObject);
  }

  private generateKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
    return generateKeyPairSync("ec", {
      namedCurve: CURVE,
    });
  }

  private exportPublicKeyBase64(publicKey: KeyObject): string {
    return publicKey.export({
      format: "der",
      type: "spki",
    }).toString("base64");
  }
}

export default E2ECrypto;
