// Plain-text extractor: strips script/style, decodes entities, collapses whitespace.
// Written to scratch only (read-only discipline for the repo).
const fs = require("fs");

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "\u2014",
  ndash: "\u2013", hellip: "\u2026", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201c", rdquo: "\u201d", times: "\u00d7", rarr: "\u2192",
  larr: "\u2190", deg: "\u00b0", middot: "\u00b7", bull: "\u2022", copy: "\u00a9",
  minus: "\u2212", plusmn: "\u00b1", le: "\u2264", ge: "\u2265", frac12: "\u00bd",
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code)) return m;
      try { return String.fromCodePoint(code); } catch (e) { return m; }
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, body)) return NAMED[body];
    return m;
  });
}

// Decode JS/JSON unicode escapes (\uXXXX and \u{XXXX}) only — hex bodies, no quote mangling.
function decodeUnicodeEscapes(s) {
  return s.replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; }
  }).replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; }
  });
}

function toText(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "\n");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "\n");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "\n");
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = decodeUnicodeEscapes(s);
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// Raw extraction of <script> bodies that carry data payloads (Next.js flight data etc.)
function scriptPayloads(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

const src = process.argv[2];
const mode = process.argv[3] || "text";
const html = fs.readFileSync(src, "utf8");
if (mode === "text") {
  process.stdout.write(toText(html));
} else {
  const bodies = scriptPayloads(html);
  const joined = bodies.map((b) => decodeUnicodeEscapes(decodeEntities(b))).join("\n\n---8<---\n\n");
  process.stdout.write(joined);
}
