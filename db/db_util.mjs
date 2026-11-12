import { createHash, randomBytes } from 'crypto';
import { pwdHash, pwdVerify } from './pwd_util.mjs';

export function insertUser(username, password, db) {
  try {
    const insert = db.prepare('INSERT INTO users (username, pwd_hash) VALUES (?, ?)');
    const result = insert.run(username, pwdHash(password));
    return { is_success: true, message: "", inserted_id: result.lastInsertRowid };
  } catch (err) {
    if (err.errcode == 2067 && err.message.includes("UNIQUE")) {
      console.log("UNIQUE constraint unsatisfied. Not inserted.");
      return { is_success: false, message: "Duplicate username.", inserted_id: -1 };
    }
  }
}

export function verifyUser(username, password, db) {
  try {
    const query = db.prepare('SELECT * FROM users WHERE username = ?');
    const result = query.get(username);
    if (!result) {
      return { is_success: false, message: "Username not exist.", user_id: -1 };
    }
    const check = pwdVerify(password, result.pwd_hash);
    if (!check) {
      return { is_success: false, message: "Password not correct.", user_id: -1 };
    }
    return { is_success: true, message: "", user_id: result.id, username: username };
  } catch (err) {
    return { is_success: false, message: err.message, user_id: -1 };
  }
}

export function updateToken(user_id, db) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const insert = db.prepare('INSERT INTO sessions (id_hash, user_id, expiration) VALUES (?, ?, ?)');
  insert.run(hash, user_id, Date.now() + 10 * 1e3 * 60);
  return token;
}

export function verifyToken(token, db) {
  const hash = createHash('sha256').update(token).digest('hex');
  const query = db.prepare('SELECT * FROM sessions WHERE id_hash = ?');
  const result = query.get(hash);
  if (!result || result.expiration < Date.now()) {
    return { is_success: false, user_id: -1, username: "" };
  }
  const query_name = db.prepare('SELECT * FROM users WHERE id = ?');
  const result_name = query_name.get(result.user_id).username;
  return { is_success: true, user_id: result.user_id, username: result_name };
}
