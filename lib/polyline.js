// Google's encoded polyline format (precision 5), used for the track lines in data/shapes.json.
// Any polyline decoder reads them, for example @mapbox/polyline's decode(text).

export function encode(points, precision = 5) {
  const f = 10 ** precision;
  let lat = 0, lon = 0, out = "";
  for (const [a, b] of points) {
    const y = Math.round(a * f), x = Math.round(b * f);
    out += num(y - lat) + num(x - lon);
    lat = y; lon = x;
  }
  return out;
}

function num(v) {
  v = v < 0 ? ~(v << 1) : v << 1;
  let s = "";
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return s + String.fromCharCode(v + 63);
}

// "_p~iF~ps|U_ulLnnqC" -> [[38.5, -120.2], [40.7, -120.95]]
export function decode(text, precision = 5) {
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, v = 0, b;
    do { b = text.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < text.length) {
    lat += next(); lon += next();
    out.push([lat / f, lon / f]);
  }
  return out;
}
