/**
 * Weekly activity report from the Cámara de Diputados SIL API.
 * Sweeps every subject group × type, collects initiatives whose last principal
 * change falls in the target window, then pulls each one's status history to
 * extract the specific events that happened that week.
 */
const BASE = "https://www.diputadosrd.gob.do/sil/api/iniciativa";
const H = {
  Referer: "https://www.diputadosrd.gob.do/sil/iniciativa",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};
const WIN_START = "2026-06-15";
const WIN_END = "2026-06-19"; // inclusive (Mon–Fri)

const inWin = (iso) => {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= WIN_START && d <= WIN_END;
};

async function j(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: H });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error("HTTP " + r.status);
    } catch (e) {
      if (a === 3) throw e;
    }
    await new Promise((res) => setTimeout(res, 300 * 2 ** a));
  }
}

const groups = await j(`${BASE}/Grupos?periodoId=0`);
const touched = new Map(); // id -> row (last principal change in window)

for (const g of groups) {
  for (const tipo of [true, false]) {
    let page = 1;
    while (true) {
      const env = await j(
        `${BASE}/iniciativas?page=${page}&grupo=${g.id}&tipo=${tipo}&perimidas=false&keyword=&periodoId=0`,
      );
      if (!env?.results?.length) break;
      let belowWindow = false;
      for (const row of env.results) {
        const chg = (row.fechaUltimoCambioPrincipal || "").slice(0, 10);
        if (inWin(row.fechaUltimoCambioPrincipal) || inWin(row.fechaDeposito)) {
          touched.set(row.id, row);
        }
        // list is sorted by last-change desc; once we pass below window start, stop slice
        if (chg && chg < WIN_START) belowWindow = true;
      }
      if (belowWindow || page * env.pageSize >= env.total) break;
      page++;
    }
  }
}

// Pull status history for each touched initiative; keep events inside the window.
const events = [];
const ids = [...touched.keys()];
for (const id of ids) {
  const row = touched.get(id);
  let hist = [];
  try {
    const env = await j(`${BASE}/historicos?page=1&id=${id}`);
    hist = env?.results ?? [];
  } catch {
    // A single unavailable history endpoint should not abort the weekly report.
  }
  const wk = hist.filter((h) => inWin(h.inicio) || inWin(h.fin));
  const deposited = inWin(row.fechaDeposito);
  events.push({
    id,
    numero: row.numero,
    tipo: row.tipo,
    grupo: row.grupo,
    materia: row.materia,
    camara: row.camaraInicio,
    origen: row.origen,
    estado: row.estado,
    condicion: row.condicion,
    titulo: (row.descripcion || "").split(/\r?\n/)[0].trim(),
    fechaDeposito: (row.fechaDeposito || "").slice(0, 10),
    ultimoCambio: (row.fechaUltimoCambioPrincipal || "").slice(0, 10),
    deposited,
    weekEvents: wk.map((h) => ({ estado: h.estado, fecha: (h.inicio || h.fin || "").slice(0, 10) })),
  });
}

console.log(JSON.stringify({ window: [WIN_START, WIN_END], total: events.length, events }, null, 2));
