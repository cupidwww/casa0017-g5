import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function pwdHash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}_${hash.toString('hex')}`;
}

export function pwdVerify(password, stored) {
  const [saltHex, hashHex] = stored.split('_');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);   // constant-time compare
}
