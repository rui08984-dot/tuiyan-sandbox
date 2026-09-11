// Summarize yt-dlp json dumps: handles UTF-16LE (PS5.1 redirect) and UTF-8 files
// Usage: node tools\bv_summarize.mjs <dir>
import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2] || '_resolve';
for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const buf = readFileSync(dir + '/' + f);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le').slice(1);
  else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8').slice(1);
  else text = buf.toString('utf8');
  if (text.trim().length < 30) { console.log(f + ' EMPTY'); continue; }
  try {
    const j = JSON.parse(text);
    const dur = j.duration ? Math.round(j.duration / 60) + 'min' : '?';
    const views = j.view_count != null ? j.view_count : '?';
    console.log([j.id, j.uploader || '?', views, dur, (j.title || '').slice(0, 55)].join(' | '));
  } catch (e) {
    console.log(f + ' PARSE_ERR ' + text.slice(0, 60).replace(/\s+/g, ' '));
  }
}
