'use strict';
// PlantUML text-encoding: deflate + PlantUML's base64 variant.
// The encoded string IS the image URL — no image hosting or upload auth needed.

const zlib = require('zlib');

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode64(data) {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;
    out += B64[(b1 >> 2) & 0x3f];
    out += B64[((b1 << 4) | (b2 >> 4)) & 0x3f];
    out += B64[((b2 << 2) | (b3 >> 6)) & 0x3f];
    out += B64[b3 & 0x3f];
  }
  return out;
}

function encodeDiagram(text) {
  return encode64(zlib.deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 }));
}

function diagramUrl(server, format, text) {
  return `${server.replace(/\/$/, '')}/${format}/${encodeDiagram(text)}`;
}

async function fetchSvg(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`PlantUML server returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return body;
}

module.exports = {
  encodeDiagram,
  diagramUrl,
  fetchSvg,
  DEFAULT_SERVER: 'https://www.plantuml.com/plantuml',
};
