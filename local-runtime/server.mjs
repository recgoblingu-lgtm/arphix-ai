import { createServer } from 'node:http';
import { readFile, stat, unlink, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 4173);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8' };

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) { reject(new Error('Audio exceeds 25 MB local limit.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`)));
  });
}

async function transcribe(req, res) {
  const whisper = process.env.WHISPER_CLI;
  const model = process.env.WHISPER_MODEL;
  if (!whisper || !model) {
    reply(res, 501, JSON.stringify({ error: 'Offline transcription is not configured.', setup: 'Install whisper.cpp locally, then run WHISPER_CLI=/path/to/whisper-cli WHISPER_MODEL=/path/to/model.bin npm start. No hosted speech service is used.' }), { 'Content-Type': 'application/json' });
    return;
  }
  const audio = await collectBody(req);
  const id = randomUUID();
  const dir = join(tmpdir(), 'arphix');
  const source = join(dir, `${id}.webm`);
  const wav = join(dir, `${id}.wav`);
  await mkdir(dir, { recursive: true });
  await writeFile(source, audio, { mode: 0o600 });
  try {
    await run('ffmpeg', ['-y', '-i', source, '-ar', '16000', '-ac', '1', wav]);
    const { stdout } = await run(whisper, ['-m', model, '-f', wav, '--no-timestamps']);
    const transcript = stdout.replace(/^\[[^\]]+\]\s*/gm, '').replace(/\s+/g, ' ').trim();
    reply(res, 200, JSON.stringify({ transcript, engine: 'whisper.cpp-local' }), { 'Content-Type': 'application/json' });
  } catch (error) {
    reply(res, 500, JSON.stringify({ error: 'Local transcription failed.', detail: error.message }), { 'Content-Type': 'application/json' });
  } finally {
    await Promise.allSettled([unlink(source), unlink(wav)]);
  }
}

function approvedLocalModelUrl() {
  const raw = process.env.LLAMA_SERVER_URL;
  if (!raw) return null;
  const url = new URL(raw);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!['http:', 'https:'].includes(url.protocol) || !allowedHosts.has(url.hostname)) throw new Error('LLAMA_SERVER_URL must point to localhost, 127.0.0.1, or ::1.');
  return url;
}

async function chat(req, res) {
  let localUrl;
  try { localUrl = approvedLocalModelUrl(); } catch (error) { return reply(res, 500, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json' }); }
  if (!localUrl) return reply(res, 501, JSON.stringify({ error: 'No local LLM is configured.' }), { 'Content-Type': 'application/json' });
  try {
    const body = JSON.parse((await collectBody(req)).toString('utf8'));
    const system = String(body.system ?? '').slice(0, 2400);
    const prompt = String(body.prompt ?? '').slice(0, 12000);
    if (!prompt.trim()) return reply(res, 400, JSON.stringify({ error: 'A prompt is required.' }), { 'Content-Type': 'application/json' });
    const modelResponse = await fetch(localUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `${system}\n\nUser: ${prompt}\nAssistant:`, n_predict: 640, temperature: 0.65, stream: false })
    });
    if (!modelResponse.ok) throw new Error(`Local llama.cpp server returned ${modelResponse.status}.`);
    const payload = await modelResponse.json();
    const content = String(payload.content ?? payload.response ?? '').trim();
    if (!content) throw new Error('Local llama.cpp server returned an empty completion.');
    return reply(res, 200, JSON.stringify({ content, engine: 'llama.cpp-local' }), { 'Content-Type': 'application/json' });
  } catch (error) {
    return reply(res, 502, JSON.stringify({ error: `Local model error: ${error.message}` }), { 'Content-Type': 'application/json' });
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/transcribe') return await transcribe(req, res);
    if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
    const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filename = normalize(join(ROOT, requested));
    if (!filename.startsWith(ROOT) || requested.includes('..')) return reply(res, 403, 'Forbidden');
    const info = await stat(filename);
    if (!info.isFile()) return reply(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'" });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filename).pipe(res);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    reply(res, status, status === 404 ? 'Not found' : 'Local server error');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`ARPHIX local runtime: http://127.0.0.1:${PORT}`);
  console.log('Network policy: no external API calls. Voice transcription requires a local whisper.cpp binary and model.');
});
