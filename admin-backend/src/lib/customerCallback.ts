import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ parseTagValue: false, trimValues: false, processEntities: false });
export function parseCallbackXml(text: string) {
  if (typeof text !== 'string' || text.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Invalid callback XML');
  const value = parser.parse(text).xml;
  if (!value || typeof value !== 'object') throw new Error('Invalid callback XML');
  return value;
}
export function decryptCallback(config: { token: string; aesKey: string }, corpid: string, encrypted: string, signature: string, timestamp: string, nonce: string, now = Date.now()) {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 600 || nonce.length > 256 || !/^[a-f0-9]{40}$/.test(signature)) throw new Error('Invalid callback signature');
  const expected = createHash('sha1').update([config.token, timestamp, nonce, encrypted].sort().join('')).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('Invalid callback signature');
  if (!/^[A-Za-z0-9+/]{43}$/.test(config.aesKey)) throw new Error('Invalid callback key');
  const key = Buffer.from(config.aesKey + '=', 'base64'); const bytes = Buffer.from(encrypted, 'base64');
  if (!bytes.length || bytes.length % 16) throw new Error('Invalid ciphertext');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)); decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(bytes), decipher.final()]); const pad = padded.at(-1)!;
  if (pad < 1 || pad > 32 || !padded.subarray(-pad).every(byte => byte === pad)) throw new Error('Invalid padding');
  const data = padded.subarray(0, -pad); if (data.length < 20) throw new Error('Invalid ciphertext');
  const length = data.readUInt32BE(16);
  if (20 + length > data.length || data.subarray(20 + length).toString('utf8') !== corpid) throw new Error('Invalid callback receiver');
  return data.subarray(20, 20 + length).toString('utf8');
}
