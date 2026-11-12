import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import express from 'express';
import { fill } from './server_util.js';

const app = express();
const PORT = 1018;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.get('/', (req, res) => {
  console.log("login GET");
  const html = fs.readFileSync(path.join(__dirname, 'views', 'login.html'), 'utf8');
  res.send(html);
});
// serve static folder AFTER! '/' route, otherwise index.html bypass the route above
app.use(express.static(path.join(__dirname, 'views')));

app.get('/home', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/planner', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'planner.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/passport', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'passport.html'), 'utf8');
  res.send(fill(html, {
    '%USERNAME%': req.username,
    '%USERID%': req.user_id
  }));
});

app.get('/map-service', (req, res) => {
  // TODO: map-service may have multiple endpoints, ./route ./update ...
});

// TODO: the connection remain open, this api expose threats, no token auth yet
// app.get('/close', (req, res) => {
//   db.close();
// });

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
