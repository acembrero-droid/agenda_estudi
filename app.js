/* Agenda Ferretería
   - Registro de visitas a la tienda (con etiquetas y búsqueda)  → Google Sheets
   - Agenda: citas en tienda, visitas a clientes y reparaciones   → Google Calendar
   - Mensajes de WhatsApp con plantillas (enlace wa.me)
   - Buscador de llaves en bruto en varios proveedores
   Todo funciona en el navegador; no hay servidor propio. */
'use strict';

/* =====================================================================
   CONSTANTES
   ===================================================================== */
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPE_CAL_EV = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_CAL_RO = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file'; // solo archivos creados por esta app
const SCOPES = [SCOPE_CAL_EV, SCOPE_CAL_RO, SCOPE_DRIVE].join(' ');
const NOMBRE_HOJA = 'Agenda Ferretería – Datos';
const PREFIJO_PAIS = '34';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

const TIPOS = {
  ferreteria: { nombre: 'Cita en tienda', color: '9' },   // arándano (azul)
  visita: { nombre: 'Visita a cliente', color: '10' },    // albahaca (verde)
  reparacion: { nombre: 'Reparación', color: '6' },       // mandarina (naranja)
};
const ESTADOS_REP = ['Recibido', 'En reparación', 'Esperando pieza', 'Listo para recoger', 'Entregado'];

const HOJAS = {
  Registro: ['ID', 'Fecha', 'Cliente', 'Teléfono', 'Necesidad', 'Etiquetas', 'Estado', 'Notas', 'Operador'],
  Etiquetas: ['Etiqueta'],
  Plantillas: ['Nombre', 'Texto'],
  Proveedores: ['Nombre', 'URL de búsqueda', 'Activo'],
  Operadores: ['Nombre', 'Color'],
};
const NOMBRE_CARPETA = 'Agenda Ferretería – Fotos';

const ETIQUETAS_INICIALES = ['Encargo', 'Urgente', 'Fontanería', 'Electricidad', 'Cerrajería', 'Pintura', 'Jardín', 'Presupuesto'];

const PLANTILLAS_INICIALES = [
  { nombre: 'Pedido recibido', texto: 'Hola {cliente}, le escribimos de {tienda}.\nYa tenemos lo que nos pidió:\n{necesidad}\nPuede pasar a recogerlo cuando quiera. Un saludo.' },
  { nombre: 'Reparación lista', texto: 'Hola {cliente}, le escribimos de {tienda}.\nSu {articulo} ya está reparado y puede pasar a recogerlo.\nImporte: {presupuesto} €\nUn saludo.' },
  { nombre: 'Visita a domicilio', texto: 'Hola {cliente}, le escribimos de {tienda}.\nLe confirmamos la visita el {fecha} a las {hora}\nen {direccion}.\nSi no le va bien, avísenos. Un saludo.' },
  { nombre: 'Recordatorio de cita', texto: 'Hola {cliente}, le recordamos su cita en {tienda} el {fecha} a las {hora}.\nUn saludo.' },
  { nombre: 'Mensaje libre', texto: 'Hola {cliente}, le escribimos de {tienda}.\n' },
];
const VARS_WA = ['cliente', 'fecha', 'hora', 'articulo', 'presupuesto', 'direccion', 'necesidad', 'tienda', 'operador'];
const VARS_SIEMPRE = ['cliente', 'tienda']; // si están vacías no se quita la línea

const PROVEEDORES_INICIALES = [
  { nombre: 'Ibermadrid', url: 'https://www.google.com/search?q=Ibermadrid+llave+{q}', activo: true },
  { nombre: 'Marcabel', url: 'https://www.google.com/search?q=Marcabel+llave+{q}', activo: true },
  { nombre: 'Illanes', url: 'https://www.google.com/search?q=Illanes+llave+{q}', activo: true },
];

/* =====================================================================
   UTILIDADES
   ===================================================================== */
const store = {
  get(k, def) {
    try { const v = localStorage.getItem('fr_' + k); return v === null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(k, v) { try { localStorage.setItem('fr_' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const claveDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyISO = () => claveDia(new Date());
const horaAhora = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtDia = (d) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtHora = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function fmtFechaRegistro(s) {
  const [f, h] = String(s).split(' ');
  const [y, m, d] = (f || '').split('-');
  return d ? `${d}/${m}/${y}${h ? ' ' + h : ''}` : s;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}
// Se abre sin 'noopener' para poder saber si el navegador bloqueó la pestaña; luego se corta el vínculo.
function abrir(url) { const w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch { /* */ } } return !!w; }

/* =====================================================================
   PESTAÑAS
   ===================================================================== */
$$('.tab').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
function mostrarTab(nombre) {
  if (!$('#tab-' + nombre)) nombre = 'registro';
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + nombre));
  store.set('tab', nombre);
  if (token && nombre === 'reparaciones') cargarReparaciones();
}

/* =====================================================================
   GOOGLE: autenticación y llamadas
   ===================================================================== */
let token = null;
let tokenExpira = 0;
let tokenClient = null;
let pendientes = [];

function initTokenClient() {
  const clientId = store.get('clientId', '');
  if (!clientId || !window.google?.accounts?.oauth2) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      const cbs = pendientes; pendientes = [];
      if (resp.error) { cbs.forEach((c) => c.reject(new Error(resp.error))); return; }
      token = resp.access_token;
      tokenExpira = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
      store.set('conectado', true);
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_CAL_EV, SCOPE_CAL_RO, SCOPE_DRIVE)) {
        toast('No se dieron todos los permisos. Pulsa "Reconectar" y marca todas las casillas.');
      }
      pintarAuth();
      cbs.forEach((c) => c.resolve(token));
    },
    error_callback: (err) => {
      const cbs = pendientes; pendientes = [];
      cbs.forEach((c) => c.reject(new Error(err?.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : 'No se pudo abrir la ventana de Google (¿ventanas emergentes bloqueadas?).')));
    },
  });
  return true;
}

function pedirToken(interactivo) {
  if (!tokenClient && !initTokenClient()) {
    return Promise.reject(new Error(store.get('clientId', '')
      ? 'No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'
      : 'Falta el ID de cliente de Google (pestaña Ajustes).'));
  }
  return new Promise((resolve, reject) => {
    const yaPedido = pendientes.length > 0;
    pendientes.push({ resolve, reject });
    if (!yaPedido) tokenClient.requestAccessToken({ prompt: interactivo ? 'consent' : '' });
  });
}

function traducirError(status, msg) {
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    const cual = /sheets/i.test(msg) ? 'Google Sheets API' : /drive/i.test(msg) ? 'Google Drive API' : 'Google Calendar API';
    return `Falta activar "${cual}" en Google Cloud (ver README, paso 1).`;
  }
  if (status === 403 && /insufficient|scope/i.test(msg)) return 'Falta un permiso de Google. Pulsa "Reconectar" y marca todas las casillas.';
  return `Google respondió ${status}${msg ? ': ' + msg : ''}`;
}

async function api(url, opts = {}, reintento = true) {
  // El permiso de Google dura ~1 h; se renueva antes de caducar para no fallar a mitad.
  if (!token || Date.now() > tokenExpira) await pedirToken(false);
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  if (r.status === 401 && reintento) { token = null; return api(url, opts, false); }
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).error?.message || ''; } catch { /* */ }
    const err = new Error(traducirError(r.status, msg));
    err.status = r.status;
    err.apiDesactivada = /has not been used|is disabled|accessNotConfigured/i.test(msg);
    throw err;
  }
  return r.status === 204 ? null : r.json();
}
const cal = (path, opts) => api(CAL_API + path, opts);

function pintarAuth() {
  $('#authEstado').textContent = token ? 'Conectado' : 'Sin conectar';
  $('#btnConectar').classList.toggle('hidden', !!token);
  $('#btnDesconectar').classList.toggle('hidden', !token);
}

$('#btnConectar').addEventListener('click', async () => {
  try {
    await pedirToken(true);
    toast('Conectado con Google');
  } catch (e) { toast(e.message); if (!store.get('clientId', '')) mostrarTab('ajustes'); return; }
  // Calendario y hoja se preparan por separado: si una falla, la otra sigue funcionando.
  cargarCalendarios().then(cargarAgenda).catch((e) => toast(e.message));
  iniciarHoja();
  cargarFotos().then(repintarConFotos).catch(() => { /* las fotos son opcionales */ });
  if (fotoPendiente) {
    $('#avisoFoto').classList.add('hidden');
    abrirFotos(fotoPendiente.ref, fotoPendiente.titulo);
    fotoPendiente = null;
  }
});

$('#btnDesconectar').addEventListener('click', () => {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; hojaOk = false; fotosPorRef = new Map(); store.set('conectado', false); pintarAuth();
  $('#listaCitas').innerHTML = '<p class="muted">Desconectado.</p>';
  $('#listaReparaciones').innerHTML = '<p class="muted">Desconectado.</p>';
  $('#listaRegistro').innerHTML = '<p class="muted">Desconectado.</p>';
  $('#estadoHoja').textContent = 'Sin conectar.';
});

/* =====================================================================
   GOOGLE SHEETS: hoja de datos
   ===================================================================== */
let hojaId = store.get('hojaId', '');
let hojaOk = false;
let gids = {};

async function prepararHoja() {
  if (hojaId) {
    try { await cargarMetaHoja(); }
    catch (e) { if (e.apiDesactivada || (e.status !== 404 && e.status !== 403)) throw e; hojaId = ''; }
  }
  if (!hojaId) {
    // Busca la hoja creada por esta app (p. ej. desde otro dispositivo) antes de crear una nueva.
    const q = `name='${NOMBRE_HOJA}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const r = await api(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=createdTime`);
    if (r.files?.length) { hojaId = r.files[0].id; await cargarMetaHoja(); }
    else await crearHoja();
  }
  store.set('hojaId', hojaId);
  hojaOk = true;
}

async function cargarMetaHoja() {
  const m = await api(`${SHEETS_API}/${hojaId}?fields=sheets.properties(sheetId,title)`);
  gids = {};
  m.sheets.forEach((s) => { gids[s.properties.title] = s.properties.sheetId; });
  const faltan = Object.keys(HOJAS).filter((t) => !(t in gids));
  if (faltan.length) {
    const r = await api(`${SHEETS_API}/${hojaId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: faltan.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) }),
    });
    r.replies.forEach((rep) => { const p = rep.addSheet.properties; gids[p.title] = p.sheetId; });
  }
  // Reescribe las cabeceras: así una hoja de una versión anterior recibe las columnas nuevas.
  await api(`${SHEETS_API}/${hojaId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: Object.keys(HOJAS).map((t) => ({ range: `${t}!A1`, values: [HOJAS[t]] })) }),
  });
}

async function crearHoja() {
  const r = await api(SHEETS_API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: NOMBRE_HOJA, locale: 'es_ES', timeZone: TZ },
      sheets: Object.entries(HOJAS).map(([t, cab]) => ({
        properties: { title: t, gridProperties: { frozenRowCount: 1 } },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values: cab.map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }] }],
      })),
    }),
  });
  hojaId = r.spreadsheetId;
  gids = {};
  r.sheets.forEach((s) => { gids[s.properties.title] = s.properties.sheetId; });
}

const rangoUrl = (rango) => `${SHEETS_API}/${hojaId}/values/${encodeURIComponent(rango)}`;
async function leer(rango) { return (await api(rangoUrl(rango))).values || []; }
async function reescribir(hoja, filas) {
  await api(rangoUrl(`${hoja}!A2:Z`) + ':clear', { method: 'POST', body: '{}' });
  if (filas.length) await api(rangoUrl(`${hoja}!A2`) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: filas }) });
}

async function iniciarHoja() {
  $('#estadoHoja').textContent = 'Preparando la hoja de datos…';
  $('#listaRegistro').innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await prepararHoja();
    $('#estadoHoja').innerHTML = `Conectada. <a href="https://docs.google.com/spreadsheets/d/${esc(hojaId)}/edit" target="_blank" rel="noopener">Abrir la hoja en Google Sheets</a>`;
    await sincronizarListas();
    await cargarRegistros();
  } catch (e) {
    $('#estadoHoja').textContent = e.message;
    $('#listaRegistro').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

/* Etiquetas, plantillas y proveedores: la hoja manda; el navegador guarda una copia
   para funcionar antes de conectar. Si la hoja está vacía (primera vez), se rellena con la copia local. */
async function sincronizarListas() {
  const [eti, pla, pro, ope] = await Promise.all([leer('Etiquetas!A2:A'), leer('Plantillas!A2:B'), leer('Proveedores!A2:C'), leer('Operadores!A2:B')]);
  if (ope.length) operadores = ope.filter((f) => f[0]).map((f) => ({ nombre: String(f[0]).trim(), color: colorValido(f[1]) }));
  else if (operadores.length) await reescribir('Operadores', operadores.map((o) => [o.nombre, o.color]));
  store.set('operadores', operadores);
  pintarOperadores();
  if (eti.length) etiquetas = eti.map((f) => String(f[0] || '').trim()).filter(Boolean);
  else await reescribir('Etiquetas', etiquetas.map((e) => [e]));
  if (pla.length) plantillas = pla.filter((f) => f[0]).map((f) => ({ nombre: f[0], texto: f[1] || '' }));
  else await reescribir('Plantillas', plantillas.map((p) => [p.nombre, p.texto]));
  if (pro.length) proveedores = pro.filter((f) => f[0] && f[1]).map((f, i) => ({ id: 'p' + i, nombre: f[0], url: f[1], activo: norm(f[2]) !== 'no' }));
  else await reescribir('Proveedores', proveedores.map((p) => [p.nombre, p.url, p.activo ? 'sí' : 'no']));
  store.set('etiquetas', etiquetas); store.set('plantillas', plantillas); store.set('proveedores', proveedores);
  pintarEtiquetas(); pintarPlantillas(); pintarProveedores();
}

function guardarEnHoja(hoja, filas) {
  if (!hojaOk) return;
  reescribir(hoja, filas).catch((e) => toast('No se pudo guardar en la hoja: ' + e.message));
}

/* =====================================================================
   REGISTRO DE VISITAS A LA TIENDA
   ===================================================================== */
let registros = [];
let etiquetas = store.get('etiquetas', null) || [...ETIQUETAS_INICIALES];
const selEtiquetasForm = new Set();
const filtroEtiquetas = new Set();

const aFila = (r) => [r.id, r.fecha, r.cliente, r.telefono, r.necesidad, r.etiquetas.join(', '), r.estado, r.notas, r.operador || ''];
const deFila = (f) => ({
  id: f[0] || '', fecha: f[1] || '', cliente: f[2] || '', telefono: f[3] || '', necesidad: f[4] || '',
  etiquetas: String(f[5] || '').split(',').map((s) => s.trim()).filter(Boolean), estado: f[6] || 'Pendiente', notas: f[7] || '',
  operador: f[8] || '',
});

async function cargRegistrosRaw() { return (await leer('Registro!A2:I')).filter((f) => f[0]).map(deFila); }
async function cargarRegistros() {
  if (!hojaOk) return;
  $('#listaRegistro').innerHTML = '<p class="muted">Cargando…</p>';
  try { registros = await cargRegistrosRaw(); pintarRegistros(); pintarEtiquetas(); pintarClientes(); pintarSelectsOperador(); }
  catch (e) { $('#listaRegistro').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
async function filaDe(id) {
  const col = await leer('Registro!A:A');
  const i = col.findIndex((f) => f[0] === id);
  if (i < 1) throw new Error('No se encontró ese registro (¿se borró desde otro dispositivo?).');
  return i + 1;
}
async function guardarRegistro(r, esNuevo) {
  if (esNuevo) {
    await api(rangoUrl('Registro!A:I') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [aFila(r)] }) });
  } else {
    const n = await filaDe(r.id);
    await api(rangoUrl(`Registro!A${n}:I${n}`) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: [aFila(r)] }) });
  }
}
async function borrarRegistro(id) {
  const n = await filaDe(id);
  await api(`${SHEETS_API}/${hojaId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: gids.Registro, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }] }),
  });
}

/* ---------- etiquetas ---------- */
function todasEtiquetas() {
  const m = new Map();
  [...etiquetas, ...registros.flatMap((r) => r.etiquetas)].forEach((e) => { if (!m.has(norm(e))) m.set(norm(e), e); });
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
function pintarEtiquetas() {
  $('#regEtiquetas').innerHTML = etiquetas.length
    ? etiquetas.map((e) => `<button type="button" class="chip ${selEtiquetasForm.has(e) ? 'on' : ''}" data-tagform="${esc(e)}">${esc(e)}</button>`).join('')
    : '<span class="muted small">Aún no hay etiquetas.</span>';
  const todas = todasEtiquetas();
  $('#filtroEtiquetas').innerHTML = todas.length
    ? todas.map((e) => `<button type="button" class="chip ${filtroEtiquetas.has(e) ? 'on' : ''}" data-tagfiltro="${esc(e)}">${esc(e)}</button>`).join('')
    : '<span class="muted small">Sin etiquetas.</span>';
  $('#gestionEtiquetas').innerHTML = etiquetas.length
    ? etiquetas.map((e) => `<button type="button" class="chip" data-tagborrar="${esc(e)}" title="Quitar de la lista">${esc(e)}<span class="x">×</span></button>`).join('')
    : '<span class="muted small">La lista está vacía.</span>';
}
function guardarEtiquetas() {
  store.set('etiquetas', etiquetas);
  guardarEnHoja('Etiquetas', etiquetas.map((e) => [e]));
  pintarEtiquetas();
}
function añadirEtiqueta() {
  const v = $('#inpNuevaEtiqueta').value.trim().replace(/,/g, ' ');
  if (!v) return;
  const existente = etiquetas.find((e) => norm(e) === norm(v));
  if (!existente) { etiquetas.push(v); etiquetas.sort((a, b) => a.localeCompare(b, 'es')); }
  selEtiquetasForm.add(existente || v);
  $('#inpNuevaEtiqueta').value = '';
  guardarEtiquetas();
}
$('#btnNuevaEtiqueta').addEventListener('click', añadirEtiqueta);
$('#inpNuevaEtiqueta').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); añadirEtiqueta(); } });

/* ---------- clientes conocidos (autocompletar) ---------- */
function pintarClientes() {
  const vistos = new Map();
  [...registros].sort((a, b) => b.fecha.localeCompare(a.fecha)).forEach((r) => {
    if (r.cliente && !vistos.has(norm(r.cliente))) vistos.set(norm(r.cliente), r);
  });
  $('#dlClientes').innerHTML = [...vistos.values()].map((r) => `<option value="${esc(r.cliente)}">${esc(r.telefono)}</option>`).join('');
}
function autocompletarTelefono(form) {
  form.cliente.addEventListener('change', () => {
    if (form.telefono.value.trim()) return;
    const r = [...registros].sort((a, b) => b.fecha.localeCompare(a.fecha)).find((x) => norm(x.cliente) === norm(form.cliente.value) && x.telefono);
    if (r) form.telefono.value = r.telefono;
  });
}

/* ---------- formulario ---------- */
const formReg = $('#formRegistro');
autocompletarTelefono(formReg);
function resetFormRegistro() {
  formReg.reset(); formReg.id.value = '';
  formReg.fecha.value = hoyISO(); formReg.hora.value = horaAhora();
  selEtiquetasForm.clear(); pintarEtiquetas();
  ponerOperador(formReg.operador, operadorActual());
  $('#tituloFormRegistro').textContent = 'Nueva visita a la tienda';
  $('#btnGuardarRegistro').textContent = 'Guardar visita';
  $('#btnCancelarRegistro').classList.add('hidden');
}
$('#btnCancelarRegistro').addEventListener('click', resetFormRegistro);

formReg.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!hojaOk) { toast('Conecta con Google primero.'); return; }
  const f = Object.fromEntries(new FormData(formReg));
  const esNuevo = !f.id;
  const r = {
    id: f.id || nuevoId(), fecha: `${f.fecha} ${f.hora}`, cliente: f.cliente.trim(), telefono: f.telefono.trim(),
    necesidad: f.necesidad.trim(), etiquetas: [...selEtiquetasForm], estado: f.estado, notas: f.notas.trim(),
    operador: f.operador || '',
  };
  const boton = $('#btnGuardarRegistro'); boton.disabled = true;
  try {
    await guardarRegistro(r, esNuevo);
    if (esNuevo) registros.push(r); else registros = registros.map((x) => (x.id === r.id ? r : x));
    toast(esNuevo ? 'Visita guardada' : 'Cambios guardados');
    resetFormRegistro(); pintarRegistros(); pintarEtiquetas(); pintarClientes();
  } catch (err) { toast(err.message); }
  finally { boton.disabled = false; }
});

function editarRegistro(r) {
  formReg.id.value = r.id;
  const [f, h] = r.fecha.split(' ');
  formReg.fecha.value = f || hoyISO(); formReg.hora.value = h || '';
  formReg.cliente.value = r.cliente; formReg.telefono.value = r.telefono;
  formReg.necesidad.value = r.necesidad; formReg.estado.value = r.estado; formReg.notas.value = r.notas;
  ponerOperador(formReg.operador, r.operador);
  selEtiquetasForm.clear();
  r.etiquetas.forEach((e) => {
    if (!etiquetas.some((x) => norm(x) === norm(e))) etiquetas.push(e);
    selEtiquetasForm.add(etiquetas.find((x) => norm(x) === norm(e)));
  });
  pintarEtiquetas();
  $('#tituloFormRegistro').textContent = 'Editar visita';
  $('#btnGuardarRegistro').textContent = 'Guardar cambios';
  $('#btnCancelarRegistro').classList.remove('hidden');
  formReg.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- búsqueda y listado ---------- */
function filtrarRegistros() {
  const orden = new Map(registros.map((r, i) => [r.id, i]));
  const palabras = norm($('#buscaTexto').value).split(/\s+/).filter(Boolean);
  const est = $('#buscaEstado').value;
  const ope = $('#buscaOperador').value;
  const desde = $('#buscaDesde').value;
  const hasta = $('#buscaHasta').value;
  return registros.filter((r) => {
    if (est !== 'todos' && r.estado !== est) return false;
    if (ope && r.operador !== ope) return false;
    const dia = r.fecha.slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (filtroEtiquetas.size && ![...filtroEtiquetas].every((t) => r.etiquetas.some((e) => norm(e) === norm(t)))) return false;
    if (palabras.length) {
      const texto = norm([r.cliente, r.telefono, r.telefono.replace(/\D/g, ''), r.necesidad, r.notas, r.etiquetas.join(' ')].join(' '));
      if (!palabras.every((p) => texto.includes(p))) return false;
    }
    return true;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || orden.get(b.id) - orden.get(a.id)); // mismo minuto: la última añadida primero
}

const MAX_MOSTRAR = 200;
function pintarRegistros() {
  if (!hojaOk) return;
  const lista = filtrarRegistros();
  $('#contadorRegistro').textContent = `${lista.length} de ${registros.length} visitas` + (lista.length > MAX_MOSTRAR ? ` (se muestran las ${MAX_MOSTRAR} más recientes)` : '');
  $('#listaRegistro').innerHTML = lista.length ? lista.slice(0, MAX_MOSTRAR).map((r) => `
    <div class="item registro ${r.estado === 'Resuelto' ? 'resuelto' : ''}">
      <div class="linea1">
        <span class="titulo">${esc(r.cliente || 'Sin nombre')} · <span class="muted">${esc(fmtFechaRegistro(r.fecha))}</span></span>
        <span>${badgeOp(r.operador)} <span class="etiqueta ${r.estado === 'Resuelto' ? 'listo' : 'estado'}">${esc(r.estado)}</span></span>
      </div>
      <div class="texto">${esc(r.necesidad)}</div>
      ${r.etiquetas.length ? `<div class="chips mini">${r.etiquetas.map((e) => `<button type="button" class="chip tag" data-tagfiltro="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : ''}
      ${r.telefono ? `<div class="meta"><a href="tel:${esc(r.telefono.replace(/\s/g, ''))}">${esc(r.telefono)}</a></div>` : ''}
      ${r.notas ? `<div class="meta">${esc(r.notas)}</div>` : ''}
      <div class="acciones">
        <button class="btn ghost small" data-reg="editar" data-id="${esc(r.id)}">Editar</button>
        <button class="btn ghost small" data-reg="estado" data-id="${esc(r.id)}">${r.estado === 'Resuelto' ? 'Marcar pendiente' : 'Marcar resuelto'}</button>
        ${r.telefono ? `<button class="btn ghost small wa" data-wa="reg:${esc(r.id)}">WhatsApp</button>` : ''}
        ${botonFotos('reg:' + r.id, (r.cliente || 'Visita') + ' · ' + r.necesidad.split('\n')[0].slice(0, 40))}
        ${r.cliente || r.telefono ? `<button class="btn ghost small" data-reg="historial" data-id="${esc(r.id)}">Historial del cliente</button>` : ''}
        <button class="btn ghost small" data-reg="cita" data-id="${esc(r.id)}">Crear cita</button>
        <button class="btn ghost small danger" data-reg="borrar" data-id="${esc(r.id)}">Borrar</button>
      </div>
    </div>`).join('') : `<p class="muted">${registros.length ? 'Ninguna visita coincide con la búsqueda.' : 'Aún no hay visitas registradas.'}</p>`;
}

['#buscaTexto', '#buscaEstado', '#buscaOperador', '#buscaDesde', '#buscaHasta'].forEach((s) => $(s).addEventListener('input', pintarRegistros));
$('#btnLimpiarBusqueda').addEventListener('click', () => {
  $('#buscaTexto').value = ''; $('#buscaEstado').value = 'todos'; $('#buscaOperador').value = ''; $('#buscaDesde').value = ''; $('#buscaHasta').value = '';
  filtroEtiquetas.clear(); pintarEtiquetas(); pintarRegistros();
});
$('#btnRecargarRegistro').addEventListener('click', () => { if (hojaOk) cargarRegistros(); else toast('Conecta con Google primero.'); });

/* ---------- clics en etiquetas y acciones del registro ---------- */
document.addEventListener('click', async (e) => {
  const tf = e.target.closest('[data-tagform]');
  if (tf) { const t = tf.dataset.tagform; selEtiquetasForm.has(t) ? selEtiquetasForm.delete(t) : selEtiquetasForm.add(t); pintarEtiquetas(); return; }

  const tfi = e.target.closest('[data-tagfiltro]');
  if (tfi) {
    const t = todasEtiquetas().find((x) => norm(x) === norm(tfi.dataset.tagfiltro)) || tfi.dataset.tagfiltro;
    filtroEtiquetas.has(t) ? filtroEtiquetas.delete(t) : filtroEtiquetas.add(t);
    pintarEtiquetas(); pintarRegistros(); return;
  }

  const tb = e.target.closest('[data-tagborrar]');
  if (tb) {
    const t = tb.dataset.tagborrar;
    if (!confirm(`¿Quitar "${t}" de la lista de etiquetas?\nLas visitas que ya la tienen la conservan.`)) return;
    etiquetas = etiquetas.filter((x) => x !== t); selEtiquetasForm.delete(t); guardarEtiquetas(); return;
  }

  const a = e.target.closest('[data-reg]');
  if (!a) return;
  const r = registros.find((x) => x.id === a.dataset.id);
  if (!r) return;
  switch (a.dataset.reg) {
    case 'editar': editarRegistro(r); break;
    case 'estado': {
      const nuevo = { ...r, estado: r.estado === 'Resuelto' ? 'Pendiente' : 'Resuelto' };
      try { await guardarRegistro(nuevo, false); registros = registros.map((x) => (x.id === r.id ? nuevo : x)); pintarRegistros(); toast('Estado: ' + nuevo.estado); }
      catch (err) { toast(err.message); }
      break;
    }
    case 'historial':
      $('#buscaTexto').value = r.telefono ? r.telefono.replace(/\D/g, '') : r.cliente;
      $('#buscaEstado').value = 'todos'; $('#buscaOperador').value = ''; $('#buscaDesde').value = ''; $('#buscaHasta').value = '';
      filtroEtiquetas.clear(); pintarEtiquetas(); pintarRegistros();
      $('#buscaTexto').scrollIntoView({ behavior: 'smooth', block: 'center' });
      break;
    case 'cita':
      mostrarTab('agenda');
      formCita.titulo.value = r.necesidad.split('\n')[0].slice(0, 80);
      formCita.cliente.value = r.cliente; formCita.telefono.value = r.telefono;
      formCita.notas.value = r.necesidad;
      formCita.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'borrar':
      if (!confirm('¿Borrar esta visita del registro? No se puede deshacer.' + (numFotos('reg:' + r.id) ? '\nTambién se borrarán sus fotos.' : ''))) return;
      try {
        await borrarRegistro(r.id); registros = registros.filter((x) => x.id !== r.id); pintarRegistros(); toast('Visita borrada');
        await borrarFotosDe('reg:' + r.id);
      }
      catch (err) { toast(err.message); }
      break;
  }
});

/* =====================================================================
   AJUSTES
   ===================================================================== */
$('#inpClientId').value = store.get('clientId', '');
$('#btnGuardarClientId').addEventListener('click', () => {
  const v = $('#inpClientId').value.trim();
  if (v && !v.endsWith('.apps.googleusercontent.com')) { toast('El ID debe terminar en .apps.googleusercontent.com'); return; }
  store.set('clientId', v); tokenClient = null; token = null; pintarAuth(); pintarQRConfig();
  toast('ID guardado. Pulsa "Conectar con Google".');
});
$('#inpTienda').value = store.get('tienda', '');
$('#btnGuardarTienda').addEventListener('click', () => { store.set('tienda', $('#inpTienda').value.trim()); toast('Guardado'); });

const CLAVE_CAL = { ferreteria: 'calFerreteria', visita: 'calVisitas', reparacion: 'calReparaciones' };
const SEL_CAL = { ferreteria: '#selCalFerreteria', visita: '#selCalVisitas', reparacion: '#selCalReparaciones' };
const calId = (tipo) => store.get(CLAVE_CAL[tipo], 'primary');

async function cargarCalendarios() {
  const data = await cal('/users/me/calendarList?minAccessRole=writer');
  const opts = (data.items || []).map((c) =>
    `<option value="${esc(c.primary ? 'primary' : c.id)}">${esc(c.summaryOverride || c.summary)}${c.primary ? ' (principal)' : ''}</option>`).join('');
  for (const tipo of Object.keys(SEL_CAL)) {
    const sel = $(SEL_CAL[tipo]);
    sel.innerHTML = opts; sel.value = calId(tipo);
    if (!sel.value) sel.value = 'primary';
  }
}
$('#btnGuardarCalendarios').addEventListener('click', () => {
  for (const tipo of Object.keys(SEL_CAL)) store.set(CLAVE_CAL[tipo], $(SEL_CAL[tipo]).value);
  toast('Calendarios guardados'); if (token) cargarAgenda();
});

/* =====================================================================
   AGENDA (Google Calendar)
   ===================================================================== */
function tipoPorCalendario(c) {
  const coinciden = Object.keys(TIPOS).filter((t) => calId(t) === c);
  return coinciden.length === 1 ? coinciden[0] : 'ferreteria';
}
function datosDe(ev, calendario) {
  const p = ev.extendedProperties?.private || {};
  const tipo = TIPOS[p.fr_tipo] ? p.fr_tipo : tipoPorCalendario(calendario);
  const inicio = new Date(ev.start?.dateTime || ev.start?.date + 'T00:00:00');
  return {
    id: ev.id, cal: calendario, tipo, inicio, todoElDia: !ev.start?.dateTime,
    titulo: p.fr_titulo || ev.summary || '(sin título)',
    cliente: p.fr_cliente || '', telefono: p.fr_telefono || '', articulo: p.fr_articulo || '',
    presupuesto: p.fr_presupuesto || '', estado: p.fr_estado || '', direccion: p.fr_direccion || ev.location || '',
    operador: p.fr_operador || '',
    notas: p.fr_notas ?? (ev.description || ''), link: ev.htmlLink, privado: p,
  };
}
function resumen(d) {
  const cli = d.cliente ? ' – ' + d.cliente : '';
  if (d.tipo === 'reparacion') return `[${d.estado || 'Recibido'}] Reparación: ${d.articulo || d.titulo}${cli}`;
  if (d.tipo === 'visita') return `Visita: ${d.titulo}${cli}`;
  return `${d.titulo}${cli}`;
}
function descripcion(d) {
  return [
    d.cliente && 'Cliente: ' + d.cliente,
    d.telefono && 'Teléfono: ' + d.telefono,
    d.direccion && 'Dirección: ' + d.direccion,
    d.articulo && 'Artículo: ' + d.articulo,
    d.presupuesto && 'Presupuesto: ' + d.presupuesto + ' €',
    d.estado && 'Estado: ' + d.estado,
    d.operador && 'Operador: ' + d.operador,
    d.notas && '\n' + d.notas,
  ].filter(Boolean).join('\n');
}
function privado(d) {
  return {
    fr_tipo: d.tipo, fr_titulo: d.titulo, fr_cliente: d.cliente, fr_telefono: d.telefono, fr_direccion: d.direccion || '',
    fr_operador: d.operador || '',
    fr_articulo: d.articulo, fr_presupuesto: String(d.presupuesto || ''), fr_estado: d.estado,
    fr_notas: (d.notas || '').slice(0, 1000), // Google limita cada propiedad a 1024 caracteres
  };
}

async function listarEventos(desde, hasta, soloReparaciones) {
  const cals = soloReparaciones ? [calId('reparacion')] : [...new Set(Object.keys(TIPOS).map(calId))];
  const res = [];
  for (const c of cals) {
    const q = new URLSearchParams({
      timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
    if (soloReparaciones) q.append('privateExtendedProperty', 'fr_tipo=reparacion');
    const data = await cal(`/calendars/${encodeURIComponent(c)}/events?${q}`);
    (data.items || []).forEach((ev) => res.push(datosDe(ev, c)));
  }
  return res.sort((a, b) => a.inicio - b.inicio);
}

/* ---------- formulario nueva cita ---------- */
const formCita = $('#formCita');
formCita.fecha.value = hoyISO();
autocompletarTelefono(formCita);
function camposPorTipo() {
  const t = $('#citaTipo').value;
  $('#camposReparacion').classList.toggle('hidden', t !== 'reparacion');
}
$('#citaTipo').addEventListener('change', camposPorTipo);

formCita.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(formCita));
  const d = {
    tipo: f.tipo, titulo: f.titulo.trim(), cliente: f.cliente.trim(), telefono: f.telefono.trim(),
    direccion: f.direccion.trim(), operador: f.operador || '',
    articulo: f.tipo === 'reparacion' ? f.articulo.trim() : '',
    presupuesto: f.tipo === 'reparacion' ? f.presupuesto : '',
    estado: f.tipo === 'reparacion' ? f.estado : '', notas: f.notas.trim(),
  };
  const inicio = new Date(`${f.fecha}T${f.hora}:00`);
  const fin = new Date(inicio.getTime() + Number(f.duracion) * 60000);
  const boton = formCita.querySelector('button[type=submit]');
  boton.disabled = true;
  try {
    await cal(`/calendars/${encodeURIComponent(calId(d.tipo))}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: resumen(d), description: descripcion(d), colorId: TIPOS[d.tipo].color,
        ...(d.direccion ? { location: d.direccion } : {}),
        start: { dateTime: inicio.toISOString(), timeZone: TZ },
        end: { dateTime: fin.toISOString(), timeZone: TZ },
        extendedProperties: { private: privado(d) },
      }),
    });
    toast('Cita guardada en Google Calendar');
    const tipo = formCita.tipo.value; formCita.reset(); formCita.tipo.value = tipo; formCita.fecha.value = f.fecha; camposPorTipo();
    ponerOperador(formCita.operador, operadorActual());
    cargarAgenda();
  } catch (err) { toast(err.message); }
  finally { boton.disabled = false; }
});

/* ---------- elementos de la agenda ---------- */
let cacheEventos = new Map();
function htmlItem(d) {
  const etiquetaEstado = d.estado
    ? `<span class="etiqueta ${d.estado === 'Listo para recoger' ? 'listo' : 'estado'}">${esc(d.estado)}</span>` : '';
  const tel = d.telefono ? ` · <a href="tel:${esc(d.telefono.replace(/\s/g, ''))}">${esc(d.telefono)}</a>` : '';
  const selEstado = d.tipo === 'reparacion'
    ? `<select data-accion="estado" data-id="${esc(d.id)}" data-cal="${esc(d.cal)}">${ESTADOS_REP.map((s) => `<option${s === d.estado ? ' selected' : ''}>${s}</option>`).join('')}</select>` : '';
  const mapa = d.direccion
    ? `<div class="meta">📍 <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.direccion)}" target="_blank" rel="noopener">${esc(d.direccion)}</a></div>` : '';
  return `<div class="item ${d.tipo}">
    <div class="linea1">
      <span class="titulo">${d.todoElDia ? 'Todo el día' : fmtHora(d.inicio)} · ${esc(d.tipo === 'reparacion' ? (d.articulo || d.titulo) : d.titulo)}</span>
      <span>${badgeOp(d.operador)} <span class="etiqueta ${d.tipo}">${TIPOS[d.tipo].nombre}</span> ${etiquetaEstado}</span>
    </div>
    ${d.cliente || d.telefono ? `<div class="meta">${esc(d.cliente)}${tel}</div>` : ''}
    ${mapa}
    ${d.presupuesto ? `<div class="meta">Presupuesto: ${esc(d.presupuesto)} €</div>` : ''}
    ${d.notas ? `<div class="meta">${esc(d.notas)}</div>` : ''}
    <div class="acciones">
      ${selEstado}
      ${d.telefono ? `<button class="btn ghost small wa" data-wa="ev:${esc(d.cal + '|' + d.id)}">WhatsApp</button>` : ''}
      ${botonFotos('ev:' + d.id, (d.cliente ? d.cliente + ' · ' : '') + (d.articulo || d.titulo))}
      ${d.link ? `<a class="btn ghost small" href="${esc(d.link)}" target="_blank" rel="noopener">Abrir en Calendar</a>` : ''}
      <button class="btn ghost small danger" data-accion="borrar" data-id="${esc(d.id)}" data-cal="${esc(d.cal)}">Borrar</button>
    </div>
  </div>`;
}
function agrupadoPorDia(lista) {
  let html = '', dia = '';
  for (const d of lista) {
    const k = d.inicio.toDateString();
    if (k !== dia) { dia = k; html += `<div class="dia">${esc(fmtDia(d.inicio))}</div>`; }
    html += htmlItem(d);
  }
  return html;
}
const aplicarFiltroAgenda = (lista) => {
  const f = $('#filtroAgenda').value;
  const o = $('#filtroOperadorAgenda').value;
  return lista.filter((d) => (f === 'todas' || d.tipo === f) && (!o || d.operador === o));
};

/* ---------- vista lista / mes ---------- */
let vista = store.get('vista', 'mes');
let mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
let diaSel = hoyISO();
let eventosMes = [];

function pintarVista() {
  $$('.vista-btn').forEach((b) => b.classList.toggle('on', b.dataset.vista === vista));
  $('#vistaMes').classList.toggle('hidden', vista !== 'mes');
  $('#listaCitas').classList.toggle('hidden', vista !== 'lista');
  $('#rangoAgenda').classList.toggle('hidden', vista !== 'lista');
}
$$('.vista-btn').forEach((b) => b.addEventListener('click', () => { vista = b.dataset.vista; store.set('vista', vista); pintarVista(); if (token) cargarAgenda(); }));

async function cargarAgenda() {
  if (!token) return;
  if (vista === 'mes') return cargarMes();
  const cont = $('#listaCitas');
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde.getTime() + Number($('#rangoAgenda').value) * 86400000);
    const todos = await listarEventos(desde, hasta, false);
    todos.forEach((d) => cacheEventos.set(d.cal + '|' + d.id, d));
    const lista = aplicarFiltroAgenda(todos);
    cont.innerHTML = lista.length ? agrupadoPorDia(lista) : '<p class="muted">No hay citas en este periodo.</p>';
  } catch (e) { cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

function inicioGrid() {
  const d = new Date(mes);
  d.setDate(1 - ((d.getDay() + 6) % 7)); // lunes anterior o igual al día 1
  return d;
}
async function cargarMes() {
  const t = mes.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  $('#tituloMes').textContent = t.charAt(0).toUpperCase() + t.slice(1);
  const inicio = inicioGrid();
  const fin = new Date(inicio); fin.setDate(inicio.getDate() + 42);
  $('#detalleDia').innerHTML = '<p class="muted">Cargando…</p>';
  try {
    eventosMes = await listarEventos(inicio, fin, false);
    eventosMes.forEach((d) => cacheEventos.set(d.cal + '|' + d.id, d));
    pintarMes();
  } catch (e) { $('#detalleDia').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
function pintarMes() {
  const lista = aplicarFiltroAgenda(eventosMes);
  const porDia = new Map();
  lista.forEach((d) => { const k = claveDia(d.inicio); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(d); });
  const inicio = inicioGrid();
  const hoy = hoyISO();
  let html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="cab">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const dia = new Date(inicio); dia.setDate(inicio.getDate() + i);
    const k = claveDia(dia);
    const evs = porDia.get(k) || [];
    const cls = ['celda', dia.getMonth() !== mes.getMonth() && 'fuera', k === hoy && 'hoy', k === diaSel && 'sel'].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-dia="${k}" aria-label="${esc(fmtDia(dia))}: ${evs.length} citas">
      <span class="num">${dia.getDate()}</span>
      ${evs.slice(0, 3).map((d) => `<span class="ev ${d.tipo}">${d.todoElDia ? '' : fmtHora(d.inicio) + ' '}${esc(d.cliente || d.titulo)}</span>`).join('')}
      ${evs.length > 3 ? `<span class="mas">+${evs.length - 3} más</span>` : ''}
      <span class="puntos">${evs.slice(0, 6).map((d) => `<i class="punto ${d.tipo}"></i>`).join('')}</span>
    </button>`;
  }
  $('#gridMes').innerHTML = html;
  const delDia = porDia.get(diaSel) || [];
  const [y, m, d] = diaSel.split('-').map(Number);
  $('#detalleDia').innerHTML = `<div class="dia">${esc(fmtDia(new Date(y, m - 1, d)))}</div>` +
    (delDia.length ? delDia.map(htmlItem).join('') : '<p class="muted small">Sin citas este día.</p>');
}
$('#gridMes').addEventListener('click', (e) => {
  const c = e.target.closest('[data-dia]');
  if (!c) return;
  diaSel = c.dataset.dia;
  formCita.fecha.value = diaSel; // para crear la cita en ese día
  pintarMes();
});
function moverMes(n) { mes.setMonth(mes.getMonth() + n); cargarMes(); }
$('#mesAnterior').addEventListener('click', () => moverMes(-1));
$('#mesSiguiente').addEventListener('click', () => moverMes(1));
$('#mesHoy').addEventListener('click', () => { mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0); diaSel = hoyISO(); cargarMes(); });

$('#btnRecargar').addEventListener('click', cargarAgenda);
['#filtroAgenda', '#filtroOperadorAgenda'].forEach((s) => $(s).addEventListener('change', () => { if (vista === 'mes' && eventosMes.length) pintarMes(); else cargarAgenda(); }));
$('#rangoAgenda').addEventListener('change', cargarAgenda);

/* ---------- reparaciones ---------- */
async function cargarReparaciones() {
  const cont = $('#listaReparaciones');
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const desde = new Date(Date.now() - 120 * 86400000);
    const hasta = new Date(Date.now() + 120 * 86400000);
    let lista = await listarEventos(desde, hasta, true);
    lista.forEach((d) => cacheEventos.set(d.cal + '|' + d.id, d));
    const f = $('#filtroEstado').value;
    if (f === 'pendientes') lista = lista.filter((d) => d.estado !== 'Entregado');
    else if (f !== 'todas') lista = lista.filter((d) => d.estado === f);
    cont.innerHTML = lista.length ? agrupadoPorDia(lista) : '<p class="muted">No hay reparaciones con ese filtro.</p>';
  } catch (e) { cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
$('#btnRecargarRep').addEventListener('click', cargarReparaciones);
$('#filtroEstado').addEventListener('change', cargarReparaciones);

function refrescarVistasEventos() {
  cargarAgenda();
  if (!$('#tab-reparaciones').classList.contains('hidden')) cargarReparaciones();
}

/* ---------- cambiar estado / borrar evento ---------- */
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.accion !== 'estado') return;
  const d = cacheEventos.get(el.dataset.cal + '|' + el.dataset.id);
  if (!d) return;
  const nuevo = { ...d, estado: el.value };
  try {
    await cal(`/calendars/${encodeURIComponent(d.cal)}/events/${encodeURIComponent(d.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        summary: resumen(nuevo), description: descripcion(nuevo),
        extendedProperties: { private: { ...d.privado, ...privado(nuevo) } },
      }),
    });
    toast('Estado actualizado: ' + el.value);
    refrescarVistasEventos();
    if (el.value === 'Listo para recoger' && d.telefono && confirm('¿Avisar al cliente por WhatsApp?')) {
      abrirWA(ctxEvento(nuevo), 'Reparación lista');
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-accion="borrar"]');
  if (!el) return;
  if (!confirm('¿Borrar esta cita de Google Calendar?' + (numFotos('ev:' + el.dataset.id) ? '\nTambién se borrarán sus fotos.' : ''))) return;
  try {
    await cal(`/calendars/${encodeURIComponent(el.dataset.cal)}/events/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
    toast('Cita borrada');
    refrescarVistasEventos();
    await borrarFotosDe('ev:' + el.dataset.id);
  } catch (err) { toast(err.message); }
});

/* =====================================================================
   WHATSAPP (enlace wa.me: abre WhatsApp con el mensaje escrito)
   ===================================================================== */
let plantillas = store.get('plantillas', null) || structuredClone(PLANTILLAS_INICIALES);
let waCtx = {};

function telWA(t) {
  let s = String(t || '').trim();
  const internacional = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!internacional && s.startsWith('00')) s = s.slice(2);
  else if (!internacional && s.length === 9) s = PREFIJO_PAIS + s; // número español sin prefijo
  return s;
}
function rellenar(texto, ctx) {
  const datos = { tienda: store.get('tienda', '') || 'la ferretería', ...ctx };
  const val = (k) => String(datos[k] ?? '').trim();
  return texto.split('\n')
    .filter((linea) => [...linea.matchAll(/\{(\w+)\}/g)].every(([, k]) => !VARS_WA.includes(k) || VARS_SIEMPRE.includes(k) || val(k)))
    .map((linea) => linea.replace(/\{(\w+)\}/g, (m, k) => (VARS_WA.includes(k) ? val(k) : m)).replace(/ +,/g, ',').replace(/ {2,}/g, ' '))
    .join('\n').trim();
}
function ctxEvento(d) {
  return {
    cliente: d.cliente, telefono: d.telefono, fecha: fmtDia(d.inicio), hora: d.todoElDia ? '' : fmtHora(d.inicio),
    articulo: d.articulo, presupuesto: d.presupuesto, direccion: d.direccion, necesidad: d.titulo,
    operador: d.operador || operadorActual(),
  };
}
function ctxRegistro(r) { return { cliente: r.cliente, telefono: r.telefono, necesidad: r.necesidad, operador: r.operador || operadorActual() }; }

function abrirWA(ctx, preferida) {
  waCtx = ctx;
  $('#waTel').value = ctx.telefono || '';
  $('#waPlantilla').innerHTML = plantillas.map((p, i) => `<option value="${i}">${esc(p.nombre)}</option>`).join('');
  const i = plantillas.findIndex((p) => norm(p.nombre) === norm(preferida));
  $('#waPlantilla').value = String(i >= 0 ? i : 0);
  aplicarPlantilla();
  $('#dlgWA').showModal();
}
function aplicarPlantilla() {
  const p = plantillas[Number($('#waPlantilla').value)];
  $('#waTexto').value = p ? rellenar(p.texto, waCtx) : '';
}
$('#waPlantilla').addEventListener('change', aplicarPlantilla);
$('#waEnviar').addEventListener('click', (e) => {
  const n = telWA($('#waTel').value);
  if (n.length < 8) { e.preventDefault(); toast('Escribe un teléfono válido.'); return; }
  const url = `https://wa.me/${n}?text=${encodeURIComponent($('#waTexto').value)}`;
  if (!abrir(url)) { e.preventDefault(); toast('El navegador bloqueó la ventana. Permite ventanas emergentes.'); }
});
$('#btnWALibre').addEventListener('click', () => abrirWA({}, 'Mensaje libre'));

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wa]');
  if (!b) return;
  const [tipo, clave] = [b.dataset.wa.slice(0, b.dataset.wa.indexOf(':')), b.dataset.wa.slice(b.dataset.wa.indexOf(':') + 1)];
  if (tipo === 'reg') {
    const r = registros.find((x) => x.id === clave);
    if (r) abrirWA(ctxRegistro(r), 'Pedido recibido');
  } else {
    const d = cacheEventos.get(clave);
    if (d) abrirWA(ctxEvento(d), d.tipo === 'reparacion' ? 'Reparación lista' : d.tipo === 'visita' ? 'Visita a domicilio' : 'Recordatorio de cita');
  }
});

/* ---------- gestión de plantillas ---------- */
function pintarPlantillas() {
  $('#listaPlantillas').innerHTML = plantillas.length ? plantillas.map((p, i) => `
    <div class="prov">
      <div class="info"><strong>${esc(p.nombre)}</strong><div class="url" style="white-space:pre-wrap">${esc(p.texto)}</div></div>
      <div class="row tight">
        <button class="btn ghost small" data-pla="editar" data-i="${i}">Editar</button>
        <button class="btn ghost small danger" data-pla="borrar" data-i="${i}">Eliminar</button>
      </div>
    </div>`).join('') : '<p class="muted">No hay plantillas.</p>';
}
function guardarPlantillas() {
  store.set('plantillas', plantillas);
  guardarEnHoja('Plantillas', plantillas.map((p) => [p.nombre, p.texto]));
  pintarPlantillas();
}
function resetFormPlantilla() {
  const f = $('#formPlantilla'); f.reset(); f.idx.value = '';
  $('#btnGuardarPlantilla').textContent = 'Añadir plantilla';
  $('#btnCancelarPlantilla').classList.add('hidden');
}
$('#btnCancelarPlantilla').addEventListener('click', resetFormPlantilla);
$('#formPlantilla').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const p = { nombre: f.nombre.value.trim(), texto: f.texto.value.replace(/\r/g, '').trim() };
  if (f.idx.value !== '') plantillas[Number(f.idx.value)] = p; else plantillas.push(p);
  guardarPlantillas(); resetFormPlantilla(); toast('Plantilla guardada');
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-pla]');
  if (!a) return;
  const i = Number(a.dataset.i);
  if (a.dataset.pla === 'borrar') {
    if (!confirm(`¿Eliminar la plantilla "${plantillas[i].nombre}"?`)) return;
    plantillas.splice(i, 1); guardarPlantillas();
  } else {
    const f = $('#formPlantilla');
    f.idx.value = i; f.nombre.value = plantillas[i].nombre; f.texto.value = plantillas[i].texto;
    $('#btnGuardarPlantilla').textContent = 'Guardar cambios';
    $('#btnCancelarPlantilla').classList.remove('hidden');
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

/* =====================================================================
   OPERADORES (quién atiende): color propio y nombre en cada registro
   ===================================================================== */
const PALETA = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
let operadores = store.get('operadores', []);
const colorValido = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#888888');
function textoSobre(hex) {
  const n = parseInt(colorValido(hex).slice(1), 16);
  const lum = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}
const operadorActual = () => { const n = store.get('operador', ''); return operadores.some((o) => o.nombre === n) ? n : ''; };
const colorOperador = (n) => colorValido(operadores.find((o) => o.nombre === n)?.color);
function badgeOp(n) {
  if (!n) return '';
  const c = colorOperador(n);
  return `<span class="op" style="--c:${c};--ct:${textoSobre(c)}">${esc(n)}</span>`;
}
function aplicarTemaOperador() {
  const n = operadorActual();
  document.body.classList.toggle('con-op', !!n);
  if (n) {
    const c = colorOperador(n);
    document.documentElement.style.setProperty('--op', c);
    document.documentElement.style.setProperty('--op-texto', textoSobre(c));
  }
}
function ponerOperador(sel, nombre) {
  if (nombre && ![...sel.options].some((o) => o.value === nombre)) sel.add(new Option(nombre, nombre)); // dado de baja
  sel.value = nombre || '';
}
function pintarSelectsOperador() {
  const opts = operadores.map((o) => `<option value="${esc(o.nombre)}">${esc(o.nombre)}</option>`).join('');
  const actual = operadorActual();
  $('#selOperador').innerHTML = `<option value="">${operadores.length ? '— Elige —' : '(sin operadores)'}</option>` + opts;
  $('#selOperador').value = actual;
  $$('.sel-operador').forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = '<option value="">—</option>' + opts;
    sel.required = operadores.length > 0;
    ponerOperador(sel, prev || actual);
  });
  const nombres = [...new Set([...operadores.map((o) => o.nombre), ...registros.map((r) => r.operador).filter(Boolean)])];
  for (const [id, todos] of [['#buscaOperador', 'Todos'], ['#filtroOperadorAgenda', 'Todos los operadores']]) {
    const sel = $(id); const prev = sel.value;
    sel.innerHTML = `<option value="">${todos}</option>` + nombres.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = nombres.includes(prev) ? prev : '';
  }
  $('#filtroOperadorAgenda').classList.toggle('hidden', !nombres.length);
  aplicarTemaOperador();
}
function pintarOperadores() {
  $('#listaOperadores').innerHTML = operadores.length ? operadores.map((o, i) => `
    <div class="prov">
      <div class="info">${badgeOp(o.nombre)}</div>
      <div class="row tight">
        <button class="btn ghost small" data-op="editar" data-i="${i}">Editar</button>
        <button class="btn ghost small danger" data-op="borrar" data-i="${i}">Dar de baja</button>
      </div>
    </div>`).join('') : '<p class="muted">Aún no hay operadores. Da de alta al primero aquí abajo.</p>';
  pintarSelectsOperador();
}
function guardarOperadores() {
  store.set('operadores', operadores);
  guardarEnHoja('Operadores', operadores.map((o) => [o.nombre, o.color]));
  pintarOperadores();
}
function resetFormOperador() {
  const f = $('#formOperador'); f.reset(); f.idx.value = '';
  f.color.value = PALETA.find((c) => !operadores.some((o) => o.color.toLowerCase() === c)) || PALETA[0];
  $('#btnGuardarOperador').textContent = 'Dar de alta';
  $('#btnCancelarOperador').classList.add('hidden');
}
$('#paletaOperador').innerHTML = PALETA.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
$('#paletaOperador').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) $('#formOperador').color.value = b.dataset.color; });
$('#btnCancelarOperador').addEventListener('click', resetFormOperador);
$('#formOperador').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const idx = f.idx.value === '' ? -1 : Number(f.idx.value);
  if (operadores.some((o, i) => i !== idx && norm(o.nombre) === norm(nombre))) { toast('Ya hay un operador con ese nombre.'); return; }
  const nuevo = { nombre, color: colorValido(f.color.value) };
  if (idx >= 0) {
    if (operadores[idx].nombre === store.get('operador', '')) store.set('operador', nombre);
    operadores[idx] = nuevo;
  } else {
    operadores.push(nuevo);
    if (!operadorActual()) store.set('operador', nombre);
  }
  guardarOperadores(); resetFormOperador(); toast(idx >= 0 ? 'Operador actualizado' : `${nombre} dado de alta`);
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-op]');
  if (!a) return;
  const i = Number(a.dataset.i);
  const o = operadores[i];
  if (a.dataset.op === 'borrar') {
    if (!confirm(`¿Dar de baja a "${o.nombre}"?\nLas visitas y citas que ya tienen su nombre lo conservan.`)) return;
    operadores.splice(i, 1);
    if (store.get('operador', '') === o.nombre) store.set('operador', '');
    guardarOperadores();
  } else {
    const f = $('#formOperador');
    f.idx.value = i; f.nombre.value = o.nombre; f.color.value = o.color;
    $('#btnGuardarOperador').textContent = 'Guardar cambios';
    $('#btnCancelarOperador').classList.remove('hidden');
    f.nombre.focus();
  }
});
$('#selOperador').addEventListener('change', (e) => {
  store.set('operador', e.target.value);
  if (!formReg.id.value) ponerOperador(formReg.operador, e.target.value); // no se toca una visita en edición
  ponerOperador(formCita.operador, e.target.value);
  aplicarTemaOperador();
});

/* =====================================================================
   FOTOS (Google Drive, carpeta "Agenda Ferretería – Fotos")
   Cada foto lleva en sus propiedades la ficha a la que pertenece:
   reg:<id> para visitas del registro, ev:<id> para citas y reparaciones.
   ===================================================================== */
let carpetaId = store.get('carpetaFotos', '');
let fotosPorRef = new Map();
const miniaturas = new Map(); // id de foto -> URL local de la imagen ya descargada
let fotoRef = '', fotoTitulo = '', fotoTimer = null, fotoPendiente = null;
const qEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function carpetaFotos() {
  if (carpetaId) return carpetaId;
  const q = `name='${qEsc(NOMBRE_CARPETA)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await api(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=createdTime`);
  carpetaId = r.files?.[0]?.id
    || (await api(`${DRIVE_API}?fields=id`, { method: 'POST', body: JSON.stringify({ name: NOMBRE_CARPETA, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  store.set('carpetaFotos', carpetaId);
  return carpetaId;
}
async function listarFotos(extraQ) {
  const carpeta = await carpetaFotos();
  const res = [];
  let pageToken = '';
  do {
    const q = `'${qEsc(carpeta)}' in parents and trashed=false${extraQ ? ' and ' + extraQ : ''}`;
    const r = await api(`${DRIVE_API}?q=${encodeURIComponent(q)}&pageSize=1000&orderBy=createdTime&fields=nextPageToken,files(id,description,appProperties,createdTime,webViewLink)${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
    res.push(...(r.files || []));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return res;
}
async function cargarFotos(reintento = true) {
  try {
    const mapa = new Map();
    (await listarFotos()).forEach((f) => {
      const ref = f.appProperties?.fr_ref;
      if (!ref) return;
      if (!mapa.has(ref)) mapa.set(ref, []);
      mapa.get(ref).push(f);
    });
    fotosPorRef = mapa;
  } catch (e) {
    if (reintento && e.status === 404) { carpetaId = ''; store.set('carpetaFotos', ''); return cargarFotos(false); } // carpeta borrada
    throw e;
  }
}
const numFotos = (ref) => fotosPorRef.get(ref)?.length || 0;
function botonFotos(ref, titulo) {
  const n = numFotos(ref);
  return `<button class="btn ghost small" data-fotos="${esc(ref)}" data-titulo="${esc(titulo)}">📷 Fotos${n ? ` (${n})` : ''}</button>`;
}
function repintarConFotos() {
  pintarRegistros();
  if (vista === 'mes' && eventosMes.length) pintarMes();
}

// Reduce la foto (máx. 1600 px, JPEG) para que suba rápido desde el móvil.
async function comprimir(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
  } catch { return file; } // formato que el navegador no sabe leer: se sube tal cual
}
async function subirFoto(file, ref, descripcion) {
  const blob = await comprimir(file);
  const carpeta = await carpetaFotos();
  const ahora = new Date();
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (blob.type.split('/')[1] || 'jpg');
  const meta = {
    name: `${ref.replace(/[^\w-]/g, '_')}_${claveDia(ahora)}_${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}.${ext}`,
    parents: [carpeta],
    description: descripcion,
    appProperties: { fr_ref: ref, fr_operador: operadorActual().slice(0, 40) },
  };
  const limite = 'frlimite' + Date.now();
  const cuerpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${limite}\r\nContent-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`,
    blob, `\r\n--${limite}--`,
  ]);
  return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', body: cuerpo, headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
  });
}
async function borrarFotosDe(ref) {
  const fotos = fotosPorRef.get(ref) || [];
  for (const f of fotos) { try { await api(`${DRIVE_API}/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); } catch { /* */ } }
  fotosPorRef.delete(ref);
}
async function urlMiniatura(id) {
  if (miniaturas.has(id)) return miniaturas.get(id);
  if (!token || Date.now() > tokenExpira) await pedirToken(false);
  const r = await fetch(`${DRIVE_API}/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('No se pudo cargar la foto');
  const url = URL.createObjectURL(await r.blob());
  miniaturas.set(id, url);
  return url;
}

async function abrirFotos(ref, titulo) {
  fotoRef = ref; fotoTitulo = titulo;
  $('#fotosTitulo').textContent = titulo;
  $('#fotoDesc').value = ''; $('#fotoEstado').textContent = '';
  $('#fotosQR').open = false;
  pintarQR('#qrFoto', enlaceApp({ foto: ref, t: titulo }));
  if (!$('#dlgFotos').open) $('#dlgFotos').showModal();
  await refrescarFotos();
  clearInterval(fotoTimer);
  // Mientras el código QR está a la vista, se comprueba cada pocos segundos si llegan fotos del móvil.
  fotoTimer = setInterval(() => { if ($('#fotosQR').open) refrescarFotos(true); }, 5000);
}
async function refrescarFotos(silencioso) {
  const grid = $('#fotosGrid');
  if (!silencioso) grid.innerHTML = '<p class="muted small">Cargando fotos…</p>';
  try {
    const fotos = await listarFotos(`appProperties has { key='fr_ref' and value='${qEsc(fotoRef)}' }`);
    const antes = (fotosPorRef.get(fotoRef) || []).map((f) => f.id).join();
    if (fotos.length) fotosPorRef.set(fotoRef, fotos); else fotosPorRef.delete(fotoRef);
    if (silencioso && antes === fotos.map((f) => f.id).join()) return;
    grid.innerHTML = fotos.length ? fotos.map((f) => `
      <div class="foto">
        <img data-foto="${esc(f.id)}" alt="${esc(f.description || 'Foto')}">
        <div class="pie">${esc(f.description || '')}${f.description ? ' · ' : ''}${esc(new Date(f.createdTime).toLocaleDateString('es-ES'))}</div>
        <div class="acc">
          <a href="${esc(f.webViewLink || '#')}" target="_blank" rel="noopener">Abrir</a>
          <button type="button" class="btn ghost small danger" data-borrarfoto="${esc(f.id)}">Borrar</button>
        </div>
      </div>`).join('') : '<p class="muted small">Todavía no hay fotos.</p>';
    $$('img[data-foto]', grid).forEach((img) => urlMiniatura(img.dataset.foto).then((u) => { img.src = u; }).catch(() => { img.alt = 'No se pudo cargar'; }));
  } catch (e) { if (!silencioso) grid.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}
async function alElegirFotos(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const desc = $('#fotoDesc').value.trim();
  try {
    for (let i = 0; i < files.length; i++) {
      $('#fotoEstado').textContent = files.length > 1 ? `Subiendo foto ${i + 1} de ${files.length}…` : 'Subiendo foto…';
      await subirFoto(files[i], fotoRef, desc);
    }
    $('#fotoEstado').textContent = files.length > 1 ? `${files.length} fotos guardadas.` : 'Foto guardada.';
    $('#fotoDesc').value = '';
    await refrescarFotos();
  } catch (err) { $('#fotoEstado').textContent = err.message; }
}
$('#fotoCamara').addEventListener('change', alElegirFotos);
$('#fotoDesc').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // Intro no cierra la ventana
$('#fotoGaleria').addEventListener('change', alElegirFotos);
$('#dlgFotos').addEventListener('close', () => { clearInterval(fotoTimer); repintarConFotos(); });
$('#fotosQR').addEventListener('toggle', () => { if ($('#fotosQR').open) refrescarFotos(true); });

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fotos]');
  if (b) { if (!token) { toast('Conecta con Google primero.'); return; } abrirFotos(b.dataset.fotos, b.dataset.titulo); return; }
  const d = e.target.closest('[data-borrarfoto]');
  if (d) {
    if (!confirm('¿Borrar esta foto?')) return;
    try { await api(`${DRIVE_API}/${encodeURIComponent(d.dataset.borrarfoto)}`, { method: 'DELETE' }); refrescarFotos(); }
    catch (err) { toast(err.message); }
  }
});

/* =====================================================================
   ENLACES Y CÓDIGOS QR (para usar el móvil)
   ===================================================================== */
const URL_APP = location.origin + location.pathname;
function enlaceApp(params) {
  return URL_APP + '#' + new URLSearchParams({ cid: store.get('clientId', ''), ...params }).toString();
}
function pintarQR(sel, texto) {
  const el = $(sel);
  if (!window.qrcode) { el.textContent = 'No se pudo generar el código QR.'; return; }
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
function pintarQRConfig() {
  if (!store.get('clientId', '')) { $('#qrConfig').innerHTML = '<p class="muted small">Guarda primero el ID de cliente de Google.</p>'; return; }
  pintarQR('#qrConfig', enlaceApp({}));
}
// Lee el enlace con el que se abrió la app (#cid=…&foto=…&t=…) y lo borra de la barra de direcciones.
function leerEnlace() {
  if (!location.hash.includes('=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const cid = p.get('cid') || '';
  const actual = store.get('clientId', '');
  if (cid.endsWith('.apps.googleusercontent.com') && cid !== actual
      && (!actual || confirm('Este enlace trae otro ID de cliente de Google. ¿Usarlo en este dispositivo?'))) {
    store.set('clientId', cid); $('#inpClientId').value = cid; tokenClient = null;
  }
  const foto = p.get('foto');
  if (foto) {
    fotoPendiente = { ref: foto, titulo: p.get('t') || '' };
    $('#avisoFoto').textContent = `Pulsa "Conectar con Google" para añadir fotos a: ${fotoPendiente.titulo || 'la ficha'}`;
    $('#avisoFoto').classList.remove('hidden');
  }
  history.replaceState(null, '', location.pathname + location.search);
}

/* =====================================================================
   LLAVES EN BRUTO: proveedores
   ===================================================================== */
let proveedores = (store.get('proveedores', null) || structuredClone(PROVEEDORES_INICIALES))
  .map((p, i) => ({ id: p.id || 'p' + i, nombre: p.nombre, url: p.url, activo: p.activo !== false }));
function guardarProv() {
  store.set('proveedores', proveedores);
  guardarEnHoja('Proveedores', proveedores.map((p) => [p.nombre, p.url, p.activo ? 'sí' : 'no']));
}
const urlBusqueda = (p, ref) => p.url.replaceAll('{q}', encodeURIComponent(ref));
const esGenerica = (p) => /google\.[a-z.]+\/search/i.test(p.url);

function pintarProveedores() {
  const ref = $('#refLlave').value.trim();
  const activos = proveedores.filter((p) => p.activo);
  $('#botonesProveedores').innerHTML = activos.length
    ? activos.map((p) => `<button class="btn ghost" data-buscar="${esc(p.id)}" ${ref ? '' : 'disabled'}>${esc(p.nombre)}</button>`).join('')
    : '<p class="muted small">No hay proveedores activos.</p>';

  $('#listaProveedores').innerHTML = proveedores.length ? proveedores.map((p, i) => `
    <div class="prov ${p.activo ? '' : 'inactivo'}">
      <div class="info">
        <strong>${esc(p.nombre)}</strong>
        <div class="url">${esc(p.url)}</div>
        ${esGenerica(p) ? '<div class="aviso">Busca en Google: cámbiala por la URL de búsqueda del proveedor si la tienes.</div>' : ''}
      </div>
      <div class="row tight">
        <button class="btn ghost small" data-prov="subir" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
        <button class="btn ghost small" data-prov="activo" data-i="${i}">${p.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn ghost small" data-prov="editar" data-i="${i}">Editar</button>
        <button class="btn ghost small danger" data-prov="borrar" data-i="${i}">Eliminar</button>
      </div>
    </div>`).join('') : '<p class="muted">No hay proveedores. Añade uno abajo.</p>';
}

function pintarHistorial() {
  const h = store.get('historial', []);
  $('#historial').innerHTML = h.length
    ? '<span class="muted">Recientes:</span>' + h.map((r) => `<button data-hist="${esc(r)}">${esc(r)}</button>`).join('') : '';
}
function añadirHistorial(ref) {
  const h = [ref, ...store.get('historial', []).filter((r) => r.toLowerCase() !== ref.toLowerCase())].slice(0, 12);
  store.set('historial', h); pintarHistorial();
}

$('#refLlave').addEventListener('input', pintarProveedores);
$('#formLlave').addEventListener('submit', (e) => {
  e.preventDefault();
  const ref = $('#refLlave').value.trim();
  if (!ref) return;
  let bloqueadas = 0;
  proveedores.filter((p) => p.activo).forEach((p) => { if (!abrir(urlBusqueda(p, ref))) bloqueadas++; });
  añadirHistorial(ref);
  if (bloqueadas) toast(`El navegador bloqueó ${bloqueadas} pestaña(s). Permite ventanas emergentes o usa los botones de cada proveedor.`);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-buscar]');
  if (b) {
    const ref = $('#refLlave').value.trim();
    const p = proveedores.find((x) => x.id === b.dataset.buscar);
    if (ref && p) { abrir(urlBusqueda(p, ref)); añadirHistorial(ref); }
    return;
  }
  const h = e.target.closest('[data-hist]');
  if (h) { $('#refLlave').value = h.dataset.hist; pintarProveedores(); $('#refLlave').focus(); return; }

  const a = e.target.closest('[data-prov]');
  if (!a) return;
  const i = Number(a.dataset.i);
  const p = proveedores[i];
  switch (a.dataset.prov) {
    case 'activo': p.activo = !p.activo; break;
    case 'subir': if (i > 0) [proveedores[i - 1], proveedores[i]] = [proveedores[i], proveedores[i - 1]]; break;
    case 'borrar':
      if (!confirm(`¿Eliminar el proveedor "${p.nombre}"?`)) return;
      proveedores.splice(i, 1); break;
    case 'editar': {
      const f = $('#formProveedor');
      f.id.value = p.id; f.nombre.value = p.nombre; f.url.value = p.url;
      $('#btnGuardarProv').textContent = 'Guardar cambios';
      $('#btnCancelarProv').classList.remove('hidden');
      f.nombre.focus();
      return;
    }
  }
  guardarProv(); pintarProveedores();
});

function resetFormProv() {
  const f = $('#formProveedor'); f.reset(); f.id.value = '';
  $('#btnGuardarProv').textContent = 'Añadir proveedor';
  $('#btnCancelarProv').classList.add('hidden');
}
$('#btnCancelarProv').addEventListener('click', resetFormProv);

$('#formProveedor').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const url = f.url.value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('La URL debe empezar por http:// o https://'); return; }
  if (!url.includes('{q}')) { toast('Falta {q} en la URL: es donde se pondrá la referencia de la llave.'); return; }
  if (f.id.value) {
    const p = proveedores.find((x) => x.id === f.id.value);
    if (p) { p.nombre = nombre; p.url = url; }
  } else {
    proveedores.push({ id: 'p' + nuevoId(), nombre, url, activo: true });
  }
  guardarProv(); resetFormProv(); pintarProveedores();
  toast('Proveedor guardado');
});

$('#btnExportar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(proveedores.map(({ nombre, url, activo }) => ({ nombre, url, activo })), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'proveedores-llaves.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#inpImportar').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((p) => p.nombre && typeof p.url === 'string' && p.url.includes('{q}'))) throw new Error();
    proveedores = data.map((p, i) => ({ id: 'p' + nuevoId() + i, nombre: String(p.nombre), url: p.url, activo: p.activo !== false }));
    guardarProv(); pintarProveedores(); toast(`Importados ${proveedores.length} proveedores`);
  } catch { toast('El archivo no tiene el formato esperado'); }
  e.target.value = '';
});

/* =====================================================================
   ARRANQUE
   ===================================================================== */
leerEnlace();
pintarOperadores();
resetFormOperador();
pintarQRConfig();
resetFormRegistro();
ponerOperador(formCita.operador, operadorActual());
camposPorTipo();
pintarVista();
pintarEtiquetas();
pintarPlantillas();
pintarProveedores();
pintarHistorial();
pintarAuth();
mostrarTab(store.get('tab', 'registro'));
// El navegador bloquea la ventana de Google si no sale de un clic, así que no se reconecta sola.
if (store.get('conectado', false)) $('#btnConectar').textContent = 'Reconectar con Google';
