import http from 'http';
import { sum_to_n_a, sum_to_n_b, sum_to_n_c } from './index';

const PORT = process.env.PORT ?? 3004;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Problem 4 — Sum to N</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1e293b; border-radius: 16px; padding: 2rem; width: min(480px, 90vw); box-shadow: 0 25px 50px rgba(0,0,0,.5); }
    h1 { font-size: 1.5rem; color: #38bdf8; margin-bottom: .25rem; }
    .subtitle { color: #94a3b8; font-size: .875rem; margin-bottom: 1.5rem; }
    label { display: block; color: #94a3b8; font-size: .8rem; margin-bottom: .4rem; }
    input { width: 100%; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 8px; padding: .6rem .8rem; font-size: 1rem; outline: none; transition: border-color .2s; }
    input:focus { border-color: #38bdf8; }
    button { width: 100%; margin-top: 1rem; padding: .7rem; background: #0284c7; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: background .2s; }
    button:hover { background: #0369a1; }
    .results { margin-top: 1.5rem; display: flex; flex-direction: column; gap: .75rem; }
    .result-row { background: #0f172a; border-radius: 10px; padding: .9rem 1rem; border-left: 3px solid #0284c7; }
    .result-row h3 { font-size: .8rem; color: #38bdf8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: .3rem; }
    .result-row .value { font-size: 1.5rem; font-weight: 700; color: #f8fafc; }
    .result-row .meta { font-size: .75rem; color: #64748b; margin-top: .2rem; }
    .error { color: #f87171; font-size: .875rem; margin-top: .75rem; display: none; }
  </style>
</head>
<body>
<div class="card">
  <h1>Problem 4 — Sum to N</h1>
  <p class="subtitle">Three unique implementations of <code>sum_to_n(n)</code></p>
  <label for="n">Enter integer n</label>
  <input id="n" type="number" value="10" min="-10000" max="10000" />
  <button onclick="compute()">Compute</button>
  <div class="error" id="err"></div>
  <div class="results" id="results"></div>
</div>
<script>
  async function compute() {
    const n = parseInt(document.getElementById('n').value, 10);
    const err = document.getElementById('err');
    const results = document.getElementById('results');
    err.style.display = 'none';
    if (isNaN(n)) { err.textContent = 'Please enter a valid integer.'; err.style.display = 'block'; return; }
    const res = await fetch('/compute?n=' + n);
    const data = await res.json();
    if (data.error) { err.textContent = data.error; err.style.display = 'block'; results.innerHTML = ''; return; }
    results.innerHTML = data.results.map(r => \`
      <div class="result-row">
        <h3>\${r.name}</h3>
        <div class="value">\${r.value.toLocaleString()}</div>
        <div class="meta">\${r.description} &nbsp;|&nbsp; \${r.time.toFixed(4)} ms</div>
      </div>
    \`).join('');
  }
  compute();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost`);

  if (url.pathname === '/compute') {
    const raw = url.searchParams.get('n');
    const n = parseInt(raw ?? '', 10);
    if (isNaN(n)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'n must be a valid integer' }));
      return;
    }

    const impls: Array<{ name: string; fn: (n: number) => number; description: string }> = [
      { name: 'A — Gauss formula', fn: sum_to_n_a, description: 'O(1) time · O(1) space' },
      { name: 'B — Iterative loop', fn: sum_to_n_b, description: 'O(n) time · O(1) space' },
      { name: 'C — Array + reduce', fn: sum_to_n_c, description: 'O(n) time · O(n) space' },
    ];

    const results = impls.map(({ name, fn, description }) => {
      const t0 = performance.now();
      const value = fn(n);
      const time = performance.now() - t0;
      return { name, value, description, time };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ n, results }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`Problem 4 demo running → http://localhost:${PORT}`);
});
