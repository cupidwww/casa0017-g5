import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { insertUser, verifyUser, updateToken, verifyToken } from './db/db_util.mjs';
import { routing } from './db/planner.mjs';
import { fill } from './server_util.js';

const app = express();
const PORT = 1018;
const db = new DatabaseSync('./db/database.db');

function tokenAuth(req, res, next) {
  const result = verifyToken(req.cookies.sid, db);
  if (!result.is_success) {
    // page visits want html, fetch calls send */* and get 401 instead of a redirect
    if (req.accepts(['json', 'html']) === 'html') {
      return res.redirect(req.cookies.sid ? '/?expired=1' : '/');
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
      maxAge: 1e3 * 60 * 60 * 24,
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

const card_template =
  `<article class="place-card">
  <div class="placeholder card-photo" style="background-image: url('assets/places/%PLACEID%.jpg')"></div>
  <p class="card-title">%PLACENAME%</p>
  <p class="tip">%ADDR%</p>
</article>`

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getCurrentTrip(user_id) {
  const query = db.prepare('SELECT * FROM trips WHERE user_id = ? ORDER BY id DESC LIMIT 1');
  return query.get(user_id);
}

function getPlaces(ids) {
  // returns places in the same order as ids
  const query = db.prepare('SELECT id, name, city, longitude, latitude, estimated_time, type, address FROM places WHERE id = ?');
  let places = [];
  for (const id of ids) {
    const place = query.get(id);
    if (place) {
      places.push(place);
    }
  }
  return places;
}

app.get('/api/random-trip', tokenAuth, (req, res) => {
  const sight_count = (req.query.pace === 'easygoing') ? 2 : 3;
  // exclude the current city so a re-pick always gives a new one
  const exclude = req.query.exclude || '';
  const city = db.prepare('SELECT DISTINCT city FROM places WHERE city != ? ORDER BY RANDOM() LIMIT 1').get(exclude).city;
  const query = db.prepare('SELECT id, name, city, address, type FROM places WHERE city = ? AND type = ? ORDER BY RANDOM() LIMIT ?');
  res.status(200).json({
    city: city,
    sights: query.all(city, 'sight', sight_count),
    food: query.all(city, 'food', 3),
  });
});

app.post('/api/trip', tokenAuth, async (req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length < 2 || getPlaces(ids).length !== ids.length) {
    return res.status(400).json({ is_success: false, message: 'Invalid place ids.' });
  }
  const result = await routing(ids, db);
  if (!result.is_success) {
    return res.status(500).json({ is_success: false, message: 'Routing failed.' });
  }
  const insert = db.prepare('INSERT INTO trips (user_id, place_ids, route, created_at) VALUES (?, ?, ?, ?)');
  insert.run(req.user_id, JSON.stringify(result.order_ids), JSON.stringify(result.response), Date.now());
  res.status(200).json({ is_success: true, message: '' });
});

app.get('/planner', tokenAuth, (req, res) => {
  const trip = getCurrentTrip(req.user_id);
  if (!trip) {
    return res.redirect('/home');
  }
  const places = getPlaces(JSON.parse(trip.place_ids));
  let cards = '';
  let sight_count = 0;
  let food_count = 0;
  for (const place of places) {
    cards += fill(card_template, {
      '%PLACEID%': place.id,
      '%PLACENAME%': escapeHtml(place.name),
      '%ADDR%': escapeHtml(place.address),
    });
    if (place.type === 'sight') {
      sight_count++;
    } else {
      food_count++;
    }
  }
  const pace = (sight_count >= 3) ? 'Trailblazer' : 'Easygoing';
  const html = fs.readFileSync(path.join(__dirname, 'views', 'planner.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id,
    '%CITYNAME%': escapeHtml(places[0].city),
    '%PACE%': pace,
    '%SIGHTCOUNT%': sight_count,
    '%FOODCOUNT%': food_count,
    '%CARDS%': cards,
  }));
});

app.post('/api/finish', tokenAuth, (req, res) => {
  const trip = getCurrentTrip(req.user_id);
  if (!trip) {
    return res.status(404).json({ is_success: false, message: 'No trip found.' });
  }
  const insert = db.prepare('INSERT OR IGNORE INTO stamps (user_id, place_id, visited_at) VALUES (?, ?, ?)');
  const now = Date.now();
  for (const place of getPlaces(JSON.parse(trip.place_ids))) {
    if (place.type === 'sight') {
      insert.run(req.user_id, place.id, now);
    }
  }
  res.status(200).json({ is_success: true, message: '' });
});

app.get('/api/stamps', tokenAuth, (req, res) => {
  const query = db.prepare(`SELECT places.id, places.name, places.city, stamps.visited_at FROM stamps
    JOIN places ON stamps.place_id = places.id
    WHERE stamps.user_id = ? ORDER BY stamps.visited_at, places.id`);
  const total = db.prepare('SELECT COUNT(*) AS total FROM places WHERE type = ?').get('sight').total;
  res.status(200).json({ stamps: query.all(req.user_id), total: total });
});

app.get('/passport', tokenAuth, (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'passport.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/map-service/plan', tokenAuth, (req, res) => {
  const trip = getCurrentTrip(req.user_id);
  if (!trip) {
    return res.status(404).json({ is_success: false, message: 'No trip found.' });
  }
  res.status(200).json({
    is_success: true,
    places: getPlaces(JSON.parse(trip.place_ids)),
    route: JSON.parse(trip.route),
  });
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
