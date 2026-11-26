/* Agenda Ferretería — Google Calendar + buscador de llaves en bruto
   Todo funciona en el navegador. Los ajustes y proveedores se guardan en este
   navegador (localStorage); las citas, en Google Calendar. */
'use strict';

const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const ESTADOS = ['Recibido', 'En reparación', 'Esperando pieza', 'Listo para recoger', 'Entregado'];
const COLOR = { ferreteria: '9', reparacion: '6' }; // 9 = arándano (azul), 6 = mandarina (naranja)
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

const PROVEEDORES_INICIALES = [
  { id: 'ibermadrid', nombre: 'Ibermadrid', url: 'https://www.google.com/search?q=Ibermadrid+llave+{q}', activo: true },
  { id: 'marcabel', nombre: 'Marcabel', url: 'https://www.google.com/search?q=Marcabel+llave+{q}', activo: true },
  { id: 'illanes', nombre: 'Illanes', url: 'https://www.google.com/search?q=Illanes+llave+{q}', activo: true },
];

/* ---------- almacenamiento local ---------- */
const store = {
  get(k, def) {
    try { const v = localStorage.getItem('fr_' + k); return v === null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(k, v) { try { localStorage.setItem('fr_' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}
const fmtDia = (d) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtHora = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/* ---------- pestañas ---------- */
$$('.tab').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
function mostrarTab(nombre) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + nombre));
  store.set('tab', nombre);
  if (token && nombre === 'reparaciones') cargarReparaciones();
}

/* =====================================================================
   GOOGLE: autenticación
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
      pintarAuth();
      cbs.forEach((c) => c.resolve(token));
    },
    error_callback: (err) => {
      const cbs = pendientes; pendientes = [];
      cbs.forEach((c) => c.reject(new Error(err?.type || 'popup_cerrado')));
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
    pendientes.push({ resolve, reject });
    tokenClient.requestAccessToken({ prompt: interactivo ? 'consent' : '' });
  });
}

async function api(path, opts = {}, reintento = true) {
  // El permiso de Google dura ~1 h; se renueva antes de caducar para no fallar a mitad.
  if (!token || Date.now() > tokenExpira) await pedirToken(false);
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401 && reintento) { token = null; return api(path, opts, false); }
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.json()).error?.message || ''; } catch { /* */ }
    throw new Error(`Google Calendar respondió ${r.status}${detalle ? ': ' + detalle : ''}`);
  }
  return r.status === 204 ? null : r.json();
}

function pintarAuth() {
  $('#authEstado').textContent = token ? 'Conectado' : 'Sin conectar';
  $('#btnConectar').classList.toggle('hidden', !!token);
  $('#btnDesconectar').classList.toggle('hidden', !token);
}

$('#btnConectar').addEventListener('click', async () => {
  try {
    await pedirToken(true);
    toast('Conectado con Google Calendar');
    await cargarCalendarios();
    cargarAgenda();
  } catch (e) { toast(e.message); if (!store.get('clientId', '')) mostrarTab('ajustes'); }
});

$('#btnDesconectar').addEventListener('click', () => {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; store.set('conectado', false); pintarAuth();
  $('#listaCitas').innerHTML = '<p class="muted">Desconectado.</p>';
  $('#listaReparaciones').innerHTML = '<p class="muted">Desconectado.</p>';
});

/* =====================================================================
   AJUSTES
   ===================================================================== */
$('#inpClientId').value = store.get('clientId', '');
$('#btnGuardarClientId').addEventListener('click', () => {
  const v = $('#inpClientId').value.trim();
  if (v && !v.endsWith('.apps.googleusercontent.com')) { toast('El ID debe terminar en .apps.googleusercontent.com'); return; }
  store.set('clientId', v); tokenClient = null; token = null; pintarAuth();
  toast('ID guardado. Pulsa "Conectar Google Calendar".');
});

const calId = (tipo) => store.get(tipo === 'reparacion' ? 'calReparaciones' : 'calFerreteria', 'primary');

async function cargarCalendarios() {
  const data = await api('/users/me/calendarList?minAccessRole=writer');
  const opts = (data.items || []).map((c) =>
    `<option value="${esc(c.primary ? 'primary' : c.id)}">${esc(c.summaryOverride || c.summary)}${c.primary ? ' (principal)' : ''}</option>`).join('');
  for (const [sel, tipo] of [['#selCalFerreteria', 'ferreteria'], ['#selCalReparaciones', 'reparacion']]) {
    $(sel).innerHTML = opts; $(sel).value = calId(tipo);
    if (!$(sel).value) $(sel).value = 'primary';
  }
}
$('#btnGuardarCalendarios').addEventListener('click', () => {
  store.set('calFerreteria', $('#selCalFerreteria').value);
  store.set('calReparaciones', $('#selCalReparaciones').value);
  toast('Calendarios guardados'); if (token) cargarAgenda();
});

/* =====================================================================
   EVENTOS
   ===================================================================== */
function datosDe(ev, calendario) {
  const p = ev.extendedProperties?.private || {};
  let tipo = p.fr_tipo;
  if (!tipo) tipo = calendario === calId('reparacion') && calendario !== calId('ferreteria') ? 'reparacion' : 'ferreteria';
  const inicio = new Date(ev.start?.dateTime || ev.start?.date + 'T00:00:00');
  return {
    id: ev.id, cal: calendario, tipo, inicio, todoElDia: !ev.start?.dateTime,
    titulo: p.fr_titulo || ev.summary || '(sin título)',
    cliente: p.fr_cliente || '', telefono: p.fr_telefono || '', articulo: p.fr_articulo || '',
    presupuesto: p.fr_presupuesto || '', estado: p.fr_estado || '', notas: p.fr_notas ?? (ev.description || ''),
    link: ev.htmlLink, privado: p,
  };
}

function resumen(d) {
  if (d.tipo === 'reparacion') {
    return `[${d.estado || 'Recibido'}] Reparación: ${d.articulo || d.titulo}${d.cliente ? ' – ' + d.cliente : ''}`;
  }
  return `${d.titulo}${d.cliente ? ' – ' + d.cliente : ''}`;
}
function descripcion(d) {
  return [
    d.cliente && 'Cliente: ' + d.cliente,
    d.telefono && 'Teléfono: ' + d.telefono,
    d.articulo && 'Artículo: ' + d.articulo,
    d.presupuesto && 'Presupuesto: ' + d.presupuesto + ' €',
    d.estado && 'Estado: ' + d.estado,
    d.notas && '\n' + d.notas,
  ].filter(Boolean).join('\n');
}
function privado(d) {
  return {
    fr_tipo: d.tipo, fr_titulo: d.titulo, fr_cliente: d.cliente, fr_telefono: d.telefono,
    fr_articulo: d.articulo, fr_presupuesto: String(d.presupuesto || ''), fr_estado: d.estado,
    fr_notas: (d.notas || '').slice(0, 1000), // Google limita cada propiedad a 1024 caracteres
  };
}

async function listarEventos(desde, hasta, soloReparaciones) {
  const cals = soloReparaciones ? [calId('reparacion')] : [...new Set([calId('ferreteria'), calId('reparacion')])];
  const res = [];
  for (const c of cals) {
    const q = new URLSearchParams({
      timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
    if (soloReparaciones) q.append('privateExtendedProperty', 'fr_tipo=reparacion');
    const data = await api(`/calendars/${encodeURIComponent(c)}/events?${q}`);
    (data.items || []).forEach((ev) => res.push(datosDe(ev, c)));
  }
  return res.sort((a, b) => a.inicio - b.inicio);
}

/* ---------- formulario nueva cita ---------- */
const form = $('#formCita');
form.fecha.value = hoyISO();
$('#citaTipo').addEventListener('change', () => $('#camposReparacion').classList.toggle('hidden', $('#citaTipo').value !== 'reparacion'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const d = {
    tipo: f.tipo, titulo: f.titulo.trim(), cliente: f.cliente.trim(), telefono: f.telefono.trim(),
    articulo: f.tipo === 'reparacion' ? f.articulo.trim() : '',
    presupuesto: f.tipo === 'reparacion' ? f.presupuesto : '',
    estado: f.tipo === 'reparacion' ? f.estado : '', notas: f.notas.trim(),
  };
  const inicio = new Date(`${f.fecha}T${f.hora}:00`);
  const fin = new Date(inicio.getTime() + Number(f.duracion) * 60000);
  const boton = form.querySelector('button[type=submit]');
  boton.disabled = true;
  try {
    await api(`/calendars/${encodeURIComponent(calId(d.tipo))}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: resumen(d), description: descripcion(d), colorId: COLOR[d.tipo],
        start: { dateTime: inicio.toISOString(), timeZone: TZ },
        end: { dateTime: fin.toISOString(), timeZone: TZ },
        extendedProperties: { private: privado(d) },
      }),
    });
    toast('Cita guardada en Google Calendar');
    const tipo = form.tipo.value; form.reset(); form.tipo.value = tipo; form.fecha.value = f.fecha;
    cargarAgenda();
  } catch (err) { toast(err.message); }
  finally { boton.disabled = false; }
});

/* ---------- lista de agenda ---------- */
function htmlItem(d, conEstado) {
  const etiquetaEstado = d.estado
    ? `<span class="etiqueta ${d.estado === 'Listo para recoger' ? 'listo' : 'estado'}">${esc(d.estado)}</span>` : '';
  const tel = d.telefono ? ` · <a href="tel:${esc(d.telefono.replace(/\s/g, ''))}">${esc(d.telefono)}</a>` : '';
  const selEstado = conEstado && d.tipo === 'reparacion'
    ? `<select data-accion="estado" data-id="${esc(d.id)}" data-cal="${esc(d.cal)}">${ESTADOS.map((s) => `<option${s === d.estado ? ' selected' : ''}>${s}</option>`).join('')}</select>` : '';
  return `<div class="item ${d.tipo}">
    <div class="linea1">
      <span class="titulo">${d.todoElDia ? 'Todo el día' : fmtHora(d.inicio)} · ${esc(d.tipo === 'reparacion' ? (d.articulo || d.titulo) : d.titulo)}</span>
      <span><span class="etiqueta ${d.tipo}">${d.tipo === 'reparacion' ? 'Reparación' : 'Ferretería'}</span> ${etiquetaEstado}</span>
    </div>
    ${d.cliente || d.telefono ? `<div class="meta">${esc(d.cliente)}${tel}</div>` : ''}
    ${d.presupuesto ? `<div class="meta">Presupuesto: ${esc(d.presupuesto)} €</div>` : ''}
    ${d.notas ? `<div class="meta">${esc(d.notas)}</div>` : ''}
    <div class="acciones">
      ${selEstado}
      ${d.link ? `<a class="btn ghost small" href="${esc(d.link)}" target="_blank" rel="noopener">Abrir en Calendar</a>` : ''}
      <button class="btn ghost small danger" data-accion="borrar" data-id="${esc(d.id)}" data-cal="${esc(d.cal)}">Borrar</button>
    </div>
  </div>`;
}

function agrupadoPorDia(lista, conEstado) {
  let html = '', dia = '';
  for (const d of lista) {
    const k = d.inicio.toDateString();
    if (k !== dia) { dia = k; html += `<div class="dia">${esc(fmtDia(d.inicio))}</div>`; }
    html += htmlItem(d, conEstado);
  }
  return html;
}

let cacheEventos = new Map();

async function cargarAgenda() {
  const cont = $('#listaCitas');
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde.getTime() + Number($('#rangoAgenda').value) * 86400000);
    let lista = await listarEventos(desde, hasta, false);
    lista.forEach((d) => cacheEventos.set(d.cal + '|' + d.id, d));
    const filtro = $('#filtroAgenda').value;
    if (filtro !== 'todas') lista = lista.filter((d) => d.tipo === filtro);
    cont.innerHTML = lista.length ? agrupadoPorDia(lista, true) : '<p class="muted">No hay citas en este periodo.</p>';
  } catch (e) { cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
$('#btnRecargar').addEventListener('click', cargarAgenda);
$('#filtroAgenda').addEventListener('change', cargarAgenda);
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
    cont.innerHTML = lista.length ? agrupadoPorDia(lista, true) : '<p class="muted">No hay reparaciones con ese filtro.</p>';
  } catch (e) { cont.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
$('#btnRecargarRep').addEventListener('click', cargarReparaciones);
$('#filtroEstado').addEventListener('change', cargarReparaciones);

/* ---------- acciones sobre eventos (cambiar estado, borrar) ---------- */
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.accion !== 'estado') return;
  const d = cacheEventos.get(el.dataset.cal + '|' + el.dataset.id);
  if (!d) return;
  const nuevo = { ...d, estado: el.value };
  try {
    await api(`/calendars/${encodeURIComponent(d.cal)}/events/${encodeURIComponent(d.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        summary: resumen(nuevo), description: descripcion(nuevo),
        extendedProperties: { private: { ...d.privado, ...privado(nuevo) } },
      }),
    });
    toast('Estado actualizado: ' + el.value);
    cargarAgenda(); if (!$('#tab-reparaciones').classList.contains('hidden')) cargarReparaciones();
  } catch (err) { toast(err.message); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-accion="borrar"]');
  if (!el) return;
  if (!confirm('¿Borrar esta cita de Google Calendar?')) return;
  try {
    await api(`/calendars/${encodeURIComponent(el.dataset.cal)}/events/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
    toast('Cita borrada');
    cargarAgenda(); if (!$('#tab-reparaciones').classList.contains('hidden')) cargarReparaciones();
  } catch (err) { toast(err.message); }
});

/* =====================================================================
   LLAVES EN BRUTO: proveedores
   ===================================================================== */
let proveedores = store.get('proveedores', null) || structuredClone(PROVEEDORES_INICIALES);
const guardarProv = () => store.set('proveedores', proveedores);
const urlBusqueda = (p, ref) => p.url.replaceAll('{q}', encodeURIComponent(ref));
// Se abre sin 'noopener' para poder saber si el navegador bloqueó la pestaña; luego se corta el vínculo.
function abrir(url) { const w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch { /* */ } } return !!w; }
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
  const activos = proveedores.filter((p) => p.activo);
  let bloqueadas = 0;
  activos.forEach((p) => { if (!abrir(urlBusqueda(p, ref))) bloqueadas++; });
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
    proveedores.push({ id: 'p' + Date.now().toString(36), nombre, url, activo: true });
  }
  guardarProv(); resetFormProv(); pintarProveedores();
  toast('Proveedor guardado');
});

$('#btnExportar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(proveedores, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'proveedores-llaves.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#inpImportar').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((p) => p.nombre && typeof p.url === 'string' && p.url.includes('{q}'))) throw new Error();
    proveedores = data.map((p, i) => ({ id: p.id || 'p' + Date.now().toString(36) + i, nombre: String(p.nombre), url: p.url, activo: p.activo !== false }));
    guardarProv(); pintarProveedores(); toast(`Importados ${proveedores.length} proveedores`);
  } catch { toast('El archivo no tiene el formato esperado'); }
  e.target.value = '';
});

/* =====================================================================
   ARRANQUE
   ===================================================================== */
pintarProveedores();
pintarHistorial();
pintarAuth();
mostrarTab(store.get('tab', 'agenda'));

// El navegador bloquea la ventana de Google si no sale de un clic, así que no se reconecta sola.
if (store.get('conectado', false)) $('#btnConectar').textContent = 'Reconectar Google Calendar';
