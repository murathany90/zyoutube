import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixture.html')));
  } else if (url.pathname === '/mock-transcript.xml') {
    res.writeHead(200, { 
      'Content-Type': 'text/xml',
      'Access-Control-Allow-Origin': '*' // Mock CORS
    });
    res.end(`<?xml version="1.0" encoding="utf-8" ?>
      <transcript>
        <text start="0" dur="5">hello this is a test</text>
        <text start="5" dur="5">we are testing the transcript</text>
        <text start="10" dur="5">with playwright</text>
      </transcript>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
});
