// lib/crypto.js
// AES-256-GCM with a PBKDF2-SHA256 derived key. The envelope is portable JSON
// and is decrypted byte-for-byte by the WebCrypto code in dashboard.html.
//
//   envelope = { v, alg:"AES-GCM", kdf:"PBKDF2-SHA256", iter, salt, iv, ct }   (salt/iv/ct base64)

const { webcrypto, createHmac } = require('crypto');
const { subtle } = webcrypto;

const ITER = 150000;

// Deterministic salt/iv derived from key+plaintext, so unchanged data encrypts
// to identical bytes (no spurious git commits every 15 min). Safe here:
// identical plaintext -> identical nonce is fine; distinct plaintext -> distinct
// nonce via HMAC-SHA256, so AES-GCM nonce reuse across *different* data cannot
// happen (would require a hash collision).
function detBytes(passphrase, plaintext, label, n) {
  return new Uint8Array(createHmac('sha256', passphrase).update(label + '\0').update(plaintext).digest().subarray(0, n));
}

const b64enc = (buf) => Buffer.from(buf).toString('base64');
const b64dec = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(passphrase, salt, iterations = ITER) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJSON(obj, passphrase) {
  if (!passphrase) throw new Error('encryptJSON: missing passphrase');
  const plaintext = JSON.stringify(obj);
  const salt = detBytes(passphrase, plaintext, 'salt', 16);
  const iv = detBytes(passphrase, plaintext, 'iv', 12);
  const key = await deriveKey(passphrase, salt);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(ct) };
}

async function decryptJSON(env, passphrase) {
  if (!passphrase) throw new Error('decryptJSON: missing passphrase');
  const key = await deriveKey(passphrase, b64dec(env.salt), env.iter || ITER);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64dec(env.iv) }, key, b64dec(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

module.exports = { encryptJSON, decryptJSON };
