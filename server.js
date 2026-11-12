import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { insertUser, verifyUser, updateToken, verifyToken } from './db/db_util.mjs';
import { fill } from './server_util.js';

const app = express();
const PORT = 1018;
const db = new DatabaseSync('./db/database.db');

function tokenAuth(req, res, next) {
  const result = verifyToken(req.cookies.sid, db);
  if (!result.is_success) {
    if (req.accepts('html')) {
      return res.redirect('/login?expired=1');
    } else {
      return res.sendStatus(401);
    }
  } else {
    req.user_id = result.user_id;
    req.username = result.username;
    next();
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json(), cookieParser());
app.get('/', (req, res) => {
  console.log("login GET");
  const html = fs.readFileSync(path.join(__dirname, 'views', 'login.html'), 'utf8');
  res.send(html);
});
app.use(express.static(path.join(__dirname, 'views')));

app.post('/signup', (req, res) => {
  const user_obj = req.body;
  const result = insertUser(user_obj.username, user_obj.password, db);
  if (!result.is_success) {
    res.status(500).json(result);
  } else {
    res.status(200).json(result);
  }
});

app.post('/login', (req, res) => {
  const user_obj = req.body;
  const result = verifyUser(user_obj.username, user_obj.password, db);
  if (!result.is_success) {
    res.status(401).json(result);
  } else {
    res.cookie('sid', updateToken(result.user_id, db), {
      httpOnly: false,   // JS can't read it (blocks XSS theft)
      secure: false,     // HTTPS only
      sameSite: 'lax',  // basic CSRF protection
      maxAge: 10 * 1e3 * 60,
    });
    res.status(200).json(result);
  }
});

app.get('/home', tokenAuth, (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/planner', tokenAuth, (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'planner.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/passport', tokenAuth, (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'passport.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
