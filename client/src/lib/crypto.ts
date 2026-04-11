
export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"]
  );
  return keyPair as KeyPair;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const binaryString = atob(pem);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    "spki",
    bytes.buffer,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: publicKey,
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 32768;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as any); // Use chunking to prevent stack overflow
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptMessage(
  sharedKey: CryptoKey,
  message: string
): Promise<{ encrypted: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedMessage = new TextEncoder().encode(message);

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sharedKey,
    encodedMessage
  );

  return {
    encrypted: bufferToBase64(encrypted),
    iv: bufferToBase64(iv.buffer),
  };
}

export async function decryptMessage(
  sharedKey: CryptoKey,
  encryptedData: string,
  iv: string
): Promise<string> {
  const encryptedBytes = new Uint8Array(base64ToBuffer(encryptedData));
  const ivBytes = new Uint8Array(base64ToBuffer(iv));

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    sharedKey,
    encryptedBytes
  );

  return new TextDecoder().decode(decrypted);
}

export async function encryptBuffer(
  sharedKey: CryptoKey,
  buffer: ArrayBuffer | ArrayBufferLike
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as any,
    },
    sharedKey,
    buffer as any
  );
  return { encrypted: encrypted as ArrayBuffer, iv };
}

export async function decryptBuffer(
  sharedKey: CryptoKey,
  encryptedBuffer: ArrayBuffer | ArrayBufferLike,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as any,
    },
    sharedKey,
    encryptedBuffer as any
  );
  return decrypted as ArrayBuffer;
}


