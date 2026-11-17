
/* ===== SESIÓN Y ROLES ===== */
let sesion = null;
try { sesion = JSON.parse(sessionStorage.getItem('sl-sesion')); } catch (e) {}
if (!sesion){
  location.replace('login.html');
  sesion = {rol:'usuario', nombre:'', correo:''};
}
const ES_DUENO = sesion.rol === 'dueno';

// ¿Los usuarios (clientes) pueden ver los datos de quien ocupa un locker?
// false = solo ven disponible/ocupado.  true = ven también los datos.
const USUARIO_VE_DATOS = false;

/* ===== ESTADOS Y DATOS POR ESTADO ===== */
const ESTADOS = [
  {k:'propietario', nombre:'Propietario',     sub:'Propio',   w:15},
  {k:'rentado',     nombre:'Rentado',         sub:'Usuario',  w:35},
  {k:'prestado',    nombre:'Prestado',        sub:'Administrador',    w:8},
  {k:'empleados',   nombre:'Empleados',       sub:'',         w:7},
  {k:'disponible',  nombre:'Disponible',      sub:'',         w:30},
  {k:'noident',     nombre:'No identificado', sub:'',         w:5}
];
const LABEL = Object.fromEntries(ESTADOS.map(e => [e.k, e.nombre]));

// Icono que se ve dentro del locker al abrir la puerta (los demás usan 🔒)
const ICONOS = {disponible:'🔓', noident:'❔'};

// ro:true = campo de solo lectura (se calcula solo)
const CAMPOS = {
  propietario: [
    {k:'nombre',     l:'Nombre',            t:'text'},
    {k:'accion',     l:'Número de acción',  t:'text'},
    {k:'activo',     l:'Activo',            t:'select', o:['Sí','No']}
  ],
  rentado: [
    {k:'usuario',    l:'Nombre del usuario',                   t:'text'},
    {k:'inicio',     l:'Inicio de contrato',                   t:'date'},
    {k:'fin',        l:'Fin de contrato (corte a diciembre)',  t:'date', ro:true},
    {k:'monto',      l:'Monto de renta (MXN)',                 t:'text', ro:true},
    {k:'recibo',     l:'Recibo de pago (No.)',                 t:'text'}
  ],
  prestado: [
    {k:'usuario',     l:'Nombre del usuario',      t:'text'},
    {k:'propietario', l:'Nombre del propietario',  t:'text'},
    {k:'accion',      l:'Número de acción',        t:'text'},
    {k:'periodo',     l:'Periodo de préstamo',     t:'text'}
  ],
  empleados: [
    {k:'nombre',      l:'Nombre',               t:'text'},
    {k:'asignacion',  l:'Fecha de asignación',  t:'date'}
  ],
  disponible: [],
  noident: []
};

const esc = t => String(t).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Dinero en pesos mexicanos y fechas
const MXN = n => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(n);
const hoyISO = () => {
  const h = new Date();
  return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0');
};
// Cómo se muestra un dato en la tarjeta
function fmt(c, v){
  if (c.k === 'monto' && !isNaN(parseFloat(v))) return MXN(parseFloat(v));
  if (c.t === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(8) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4);
  return v;
}

/* ===== BARRA DE SESIÓN ===== */
document.getElementById('sesion').innerHTML =
  '<span class="badge text-bg-dark">' + (ES_DUENO ? 'Administrador' : 'Usuario') + '</span>' +
  '<span class="small">' + esc(sesion.nombre) + '</span>' +
  '<button type="button" class="btn btn-outline-dark btn-sm" id="btnSalir">Cerrar sesión</button>';
document.getElementById('btnSalir').addEventListener('click', () => {
  sessionStorage.removeItem('sl-sesion');
  location.href = 'login.html';
});

/* ===== CAMBIOS GUARDADOS EN ESTE NAVEGADOR =====
   (Cuando el equipo tenga base de datos/API, aquí se reemplaza localStorage.) */
const CLAVE = 'statuslocker-cambios';
let cambios = {};
try { cambios = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { cambios = {}; }
function guardar(){
  try { localStorage.setItem(CLAVE, JSON.stringify(cambios)); } catch (e) {}
}

/* ===== AVISOS PARA EL DUEÑO ===== */
const CLAVE_AVISOS = 'statuslocker-avisos';
let avisos = [];
try { avisos = JSON.parse(localStorage.getItem(CLAVE_AVISOS)) || []; } catch (e) { avisos = []; }
function guardarAvisos(){
  try { localStorage.setItem(CLAVE_AVISOS, JSON.stringify(avisos)); } catch (e) {}
}
// Se llama cuando un usuario registra un locker disponible
function nuevoAviso(L){
  avisos.unshift({
    id: Date.now(),
    locker: L.id,
    seccion: L.seccion,
    usuario: L.datos.usuario || sesion.nombre,
    correo: sesion.correo,
    fecha: new Date().toISOString(),
    leido: false
  });
  avisos = avisos.slice(0, 100);   // conserva los 100 más recientes
  guardarAvisos();
}

/* ===== CONFIGURACIÓN DE RENTA POR AÑO =====
   Cada año tiene su costo anual y su forma de cobro proporcional.
   La renta siempre termina el 31 de diciembre (corte a diciembre). */
const CLAVE_RENTA = 'statuslocker-renta';
let configRenta = {};
try { configRenta = JSON.parse(localStorage.getItem(CLAVE_RENTA)) || {}; } catch (e) { configRenta = {}; }
function guardarRenta(){
  try { localStorage.setItem(CLAVE_RENTA, JSON.stringify(configRenta)); } catch (e) {}
}
// Si todavía no hay nada configurado, se propone el año actual con $3,000 (el ejemplo del equipo)
if (!Object.keys(configRenta).length){
  configRenta[String(new Date().getFullYear())] = {costo: 3000, metodo: 'diario'};
  guardarRenta();
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Calcula la renta de un contrato que inicia en la fecha dada (AAAA-MM-DD) y termina el 31 de diciembre
function calcularRenta(inicioISO){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicioISO || '');
  if (!m) return {error: 'Elige la fecha de inicio del contrato.'};
  const anio = +m[1], mes = +m[2] - 1, dia = +m[3];
  if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return {error: 'La fecha de inicio no es válida.'};
  const cfg = configRenta[String(anio)];
  if (!cfg) return {error: 'El Administrador aún no configura el costo de renta de ' + anio + '.'};

  let monto, texto;
  if (cfg.metodo === 'diario'){
    // costo anual ÷ 365 por cada día, del inicio al 31 de diciembre (incluye ambos días)
    const dias = Math.round((Date.UTC(anio, 11, 31) - Date.UTC(anio, mes, dia)) / 86400000) + 1;
    monto = Math.min(cfg.costo, cfg.costo / 365 * dias);
    texto = dias + (dias === 1 ? ' día' : ' días') + ' × ' + MXN(cfg.costo / 365) + ' por día';
  } else {
    // costo anual ÷ 12 por cada mes, contando el mes de inicio completo, hasta diciembre
    const meses = 12 - mes;
    monto = cfg.costo / 12 * meses;
    texto = meses + (meses === 1 ? ' mes' : ' meses') + ' (' + MESES[mes] + ' a diciembre) × ' + MXN(cfg.costo / 12) + ' por mes';
  }
  return {anio, fin: anio + '-12-31', monto: Math.round(monto * 100) / 100, texto};
}

/* ===== DATOS DE EJEMPLO (estado inicial al azar) ===== */
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function estadoAzar(){
  let r = rnd() * 100;
  for (const e of ESTADOS){ if ((r -= e.w) < 0) return e.k; }
  return 'disponible';
}

/* ===== CREAR LOCKERS ===== */
const lockers = {};   // id -> {id, seccion, num, s, datos, el}

function pintar(L){
  L.el.dataset.s = L.s;
  L.el.setAttribute('aria-label', 'Locker ' + L.id + ', ' + LABEL[L.s]);
  L.el.querySelector('.inside').textContent = ICONOS[L.s] || '🔒';
}

function crear(prefijo, total, destino, seccion){
  const grid = document.getElementById(destino);
  for (let i = 1; i <= total; i++){
    const id = prefijo + '-' + String(i).padStart(3, '0');
    const base = estadoAzar();
    const g = cambios[id];
    const L = {id, seccion, num:i, s: g ? g.s : base, datos: g ? g.datos : {}};
    const b = document.createElement('button');
    b.className = 'locker';
    b.style.setProperty('--col', i % 20);
    b.innerHTML = '<span class="inside" aria-hidden="true"></span><span class="door">' + i + '</span>';
    b.addEventListener('click', () => abrir(L));
    L.el = b;
    lockers[id] = L;
    pintar(L);
    grid.appendChild(b);
  }
}
crear('H', 530, 'g-h', 'Hombres');
crear('M', 478, 'g-m', 'Mujeres');

/* ===== TARJETA DE INFORMACIÓN ===== */
const tarjeta = document.getElementById('tarjeta');
let abierto = null;

function abrir(L){
  if (abierto === L){ cerrar(); return; }
  if (abierto) abierto.el.classList.remove('open');
  L.el.classList.add('open');
  abierto = L;
  mostrarTarjeta();
}

function cerrar(){
  if (abierto) abierto.el.classList.remove('open');
  abierto = null;
  tarjeta.hidden = true;
}

function mostrarTarjeta(){
  const L = abierto; if (!L) return;

  // El usuario puede ver los datos de un locker si el nombre registrado es el suyo
  const esMio = !ES_DUENO && L.datos.usuario &&
                L.datos.usuario.trim().toLowerCase() === sesion.nombre.trim().toLowerCase();
  const verDatos = ES_DUENO || USUARIO_VE_DATOS || esMio;
  let cuerpo;

  if (L.s === 'disponible'){
    cuerpo = '<p class="t-msg"><span class="punto"></span>Este locker está disponible.</p>';
  } else {
    const titulo = L.s === 'noident' ? 'Locker sin identificar' : 'Ocupado · ' + LABEL[L.s];
    cuerpo = '<p class="t-msg">' + titulo + '</p>';
    if (verDatos){
      const filas = CAMPOS[L.s].filter(c => L.datos[c.k]);
      cuerpo += filas.length
        ? '<dl class="t-datos">' + filas.map((c, i) =>
            '<div style="--i:' + i + '"><dt>' + c.l + '</dt><dd>' + esc(fmt(c, L.datos[c.k])) + '</dd></div>').join('') + '</dl>'
        : '<p class="text-secondary small mb-0">Aún no hay datos registrados.</p>';
      // Aviso si el contrato ya pasó su fecha de corte
      if (L.s === 'rentado' && L.datos.fin && L.datos.fin < hoyISO()){
        cuerpo += '<p class="small text-danger mt-2 mb-0">Contrato vencido (corte a diciembre).</p>';
      }
      if (L.s === 'rentado' && typeof resumenPagos === 'function') cuerpo += resumenPagos(L);
    } else {
      cuerpo += '<p class="text-secondary small mb-0">Los datos del ocupante solo los puede ver el administrador.</p>';
    }
  }

  tarjeta.hidden = true;   // se oculta y se vuelve a mostrar para repetir la animación
  tarjeta.innerHTML =
    '<div class="t-head" data-s="' + L.s + '">' +
      '<div><span class="t-id num">' + L.id + '</span><span class="t-sec">' + L.seccion + '</span></div>' +
      '<button type="button" class="btn-close" id="tCerrar" aria-label="Cerrar"></button>' +
    '</div>' +
    '<div class="t-body">' + cuerpo + '</div>' +
    (ES_DUENO
      ? '<div class="t-foot d-grid gap-2">' +          (L.s === 'disponible' ? '<button type="button" class="btn btn-success btn-sm" id="btn-rentar">Rentar locker</button>' : '') +          (L.s === 'rentado' ? '<button type="button" class="btn btn-outline-dark btn-sm" id="btn-pagos">Historial de pagos</button>' : '') +          '<button type="button" class="btn btn-dark btn-sm" id="btn-editar">Cambiar estado</button></div>'
      : (L.s === 'disponible'
          ? '<div class="t-foot"><button type="button" class="btn btn-success btn-sm w-100" id="btn-reservar">Registrar mis datos en este locker</button></div>'
          : ''));
  void tarjeta.offsetWidth;
  tarjeta.hidden = false;
  posicionar();
}

// Coloca la tarjeta junto al locker (en celular sale desde abajo por CSS)
function posicionar(){
  if (!abierto || tarjeta.hidden) return;
  if (window.innerWidth < 576){ tarjeta.style.left = ''; tarjeta.style.top = ''; return; }
  const r = abierto.el.getBoundingClientRect();
  const w = tarjeta.offsetWidth, h = tarjeta.offsetHeight;
  let x = r.right + 10;
  if (x + w > window.innerWidth - 8) x = r.left - w - 10;
  x = Math.max(8, x);
  const y = Math.min(r.top - 10, window.innerHeight - h - 8);
  tarjeta.style.left = x + 'px';
  tarjeta.style.top = Math.max(8, y) + 'px';
}
window.addEventListener('scroll', posicionar, {passive:true});
window.addEventListener('resize', posicionar);

// Cerrar con Esc o al cambiar de pestaña (Hombres / Mujeres)
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && abierto && !document.querySelector('.modal.show')) cerrar();
});
document.querySelectorAll('[data-bs-toggle="pill"]').forEach(b =>
  b.addEventListener('shown.bs.tab', cerrar));

/* ===== CONTEOS Y LEYENDA ===== */
function conteos(){
  const c = {};
  Object.values(lockers).forEach(L => c[L.s] = (c[L.s] || 0) + 1);
  return c;
}

const ley = document.getElementById('leyenda');
const inicial = conteos();
ESTADOS.forEach(e => {
  const c = document.createElement('div');
  c.className = 'col-6 col-md-4 col-lg-2';
  c.innerHTML = '<button type="button" class="status-btn" aria-pressed="false" data-k="' + e.k + '">' +
    '<span class="swatch" style="background:var(--' + e.k + ');' + (e.k === 'noident' ? 'border-style:dashed;' : '') + '"></span>' +
    '<span>' + e.nombre + '<small>' + e.sub + '</small></span>' +
    '<span class="n" data-to="' + (inicial[e.k] || 0) + '">0</span></button>';
  ley.appendChild(c);
});

function actualizarConteos(){
  const c = conteos();
  document.querySelectorAll('.status-btn').forEach(b => {
    b.querySelector('.n').textContent = c[b.dataset.k] || 0;
  });
}

/* ===== FILTRO POR ESTADO ===== */
let filtro = null;
function aplicarFiltro(){
  document.querySelectorAll('.grid-l').forEach(g => {
    if (filtro) g.dataset.f = filtro; else delete g.dataset.f;
  });
  Object.values(lockers).forEach(L =>
    L.el.toggleAttribute('data-f-match', !!filtro && L.s === filtro));
}

ley.addEventListener('click', ev => {
  const b = ev.target.closest('.status-btn'); if (!b) return;
  const activar = b.getAttribute('aria-pressed') !== 'true';
  ley.querySelectorAll('.status-btn').forEach(x => x.setAttribute('aria-pressed', 'false'));
  filtro = activar ? b.dataset.k : null;
  if (activar) b.setAttribute('aria-pressed', 'true');
  aplicarFiltro();
});

/* ===== VENTANA DE EDICIÓN (dueño cambia estado / usuario registra sus datos) ===== */
const modal = new bootstrap.Modal(document.getElementById('modalEditar'));
const sel = document.getElementById('selEstado');
const cont = document.getElementById('campos');
ESTADOS.forEach(e => sel.add(new Option(e.nombre, e.k)));

function dibujarCampos(L, estado){
  const previo = (estado === L.s) ? L.datos : {};
  cont.innerHTML = CAMPOS[estado].map(c => {
    const v = previo[c.k] || '';
    const id = 'f-' + c.k;
    const etiqueta = '<label class="form-label" for="' + id + '">' + c.l + '</label>';
    if (c.t === 'select'){
      return '<div class="mb-3">' + etiqueta +
        '<select class="form-select" id="' + id + '" data-k="' + c.k + '">' +
        c.o.map(o => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') +
        '</select></div>';
    }
    return '<div class="mb-3">' + etiqueta +
      '<input class="form-control" type="' + c.t + '" id="' + id +
      '" data-k="' + c.k + '" value="' + esc(v) + '"' + (c.ro ? ' readonly' : '') + '></div>';
  }).join('') || '<p class="text-secondary mb-0">Este estado no requiere datos adicionales.</p>';

  if (estado === 'rentado') engancharRenta();
}

// En los rentados, el fin de contrato (31 de diciembre) y el monto se calculan solos
function engancharRenta(){
  const inicio = document.getElementById('f-inicio');
  const fin = document.getElementById('f-fin');
  const monto = document.getElementById('f-monto');
  if (!inicio || !fin || !monto) return;

  const info = document.createElement('div');
  info.id = 'infoRenta';
  cont.appendChild(info);

  const recalcular = forzar => {
    const r = calcularRenta(inicio.value);
    if (r.error){
      fin.value = '';
      if (forzar) monto.value = '';
      info.className = 'small rounded p-2 mb-3 text-bg-warning';
      info.textContent = r.error;
      return;
    }
    fin.value = r.fin;
    if (forzar || !monto.value) monto.value = r.monto.toFixed(2);
    info.className = 'small rounded p-2 mb-3 text-bg-success';
    info.innerHTML =
      '<strong>Vigencia:</strong> del ' + fmt({t:'date'}, inicio.value) + ' al ' + fmt({t:'date'}, r.fin) + ' (corte a diciembre)<br>' +
      '<strong>Cálculo:</strong> ' + r.texto + '<br>' +
      '<strong>Total a pagar:</strong> ' + MXN(parseFloat(monto.value));
  };
  inicio.addEventListener('input', () => recalcular(true));
  recalcular(false);
}

let modo = 'dueno';   // 'dueno' = cambiar estado  |  'usuario' = registrar mis datos

// Muestra u oculta el selector de estado según quién usa la ventana
function configurarModal(m){
  modo = m;
  sel.classList.toggle('d-none', m === 'usuario');
  sel.previousElementSibling.classList.toggle('d-none', m === 'usuario');   // etiqueta "Estado"
  document.getElementById('btnGuardar').textContent = m === 'usuario' ? 'Guardar mis datos' : 'Guardar';
}

// Clics dentro de la tarjeta
tarjeta.addEventListener('click', ev => {
  if (ev.target.closest('#tCerrar')){ cerrar(); return; }

  // DUEÑO: cambiar el estado de cualquier locker
  if (ev.target.closest('#btn-editar') && abierto && ES_DUENO){
    configurarModal('dueno');
    document.getElementById('modalTitulo').textContent = 'Locker ' + abierto.id + ' · ' + abierto.seccion;
    sel.value = abierto.s;
    dibujarCampos(abierto, abierto.s);
    modal.show();
  }

  // USUARIO: registrar sus datos, SOLO si el locker está disponible
  if (ev.target.closest('#btn-reservar') && abierto && !ES_DUENO && abierto.s === 'disponible'){
    configurarModal('usuario');
    document.getElementById('modalTitulo').textContent = 'Registrar mis datos · ' + abierto.id;
    sel.value = 'rentado';
    dibujarCampos(abierto, 'rentado');

    // Precarga tu nombre y la fecha de hoy; el monto se calcula solo
    document.getElementById('f-usuario').value = sesion.nombre;
    const inicio = document.getElementById('f-inicio');
    inicio.value = hoyISO();
    inicio.dispatchEvent(new Event('input'));
    modal.show();
  }
});

sel.addEventListener('change', () => { if (abierto) dibujarCampos(abierto, sel.value); });

document.getElementById('btnGuardar').addEventListener('click', () => {
  const L = abierto;
  if (!L) return;

  // Permisos: el dueño edita cualquier locker; el usuario SOLO uno disponible
  if (modo === 'dueno' && !ES_DUENO) return;
  if (modo === 'usuario' && (ES_DUENO || L.s !== 'disponible')) return;

  const datos = {};
  cont.querySelectorAll('[data-k]').forEach(i => {
    if (i.value.trim()) datos[i.dataset.k] = i.value.trim();
  });

  // El usuario debe poner su nombre y debe haber un monto calculated
  if (modo === 'usuario'){
    if (!datos.usuario){
      document.getElementById('f-usuario').classList.add('is-invalid');
      return;
    }
    if (!datos.monto){
      alert('No se pudo calcular la renta. Revisa la fecha de inicio o pide al administrador que configure el costo de renta de ese año.');
      return;
    }
  }

  L.s = (modo === 'usuario') ? 'rentado' : sel.value;
  L.datos = datos;
  cambios[L.id] = {s: L.s, datos: datos};
  guardar();
  if (modo === 'usuario') nuevoAviso(L);   // crea el aviso para el dueño
  pintar(L);
  mostrarTarjeta();
  actualizarConteos();
  aplicarFiltro();
  dibujarRenta();
  modal.hide();
});

/* ===== SINCRONIZAR ENTRE PESTAÑAS DEL MISMO NAVEGADOR ===== */
let dibujarAvisos = null;
let dibujarRenta = () => {};

window.addEventListener('storage', ev => {
  if (ev.key === CLAVE){
    try { cambios = JSON.parse(ev.newValue) || {}; } catch (e) { cambios = {}; }
    Object.keys(cambios).forEach(id => {
      const L = lockers[id];
      if (L){ L.s = cambios[id].s; L.datos = cambios[id].datos; pintar(L); }
    });
    actualizarConteos();
    aplicarFiltro();
    dibujarRenta();
    if (abierto) mostrarTarjeta();
  }
  if (ev.key === CLAVE_AVISOS && dibujarAvisos){
    try { avisos = JSON.parse(ev.newValue) || []; } catch (e) { avisos = []; }
    dibujarAvisos();
  }
  if (ev.key === CLAVE_RENTA){
    try { configRenta = JSON.parse(ev.newValue) || {}; } catch (e) { configRenta = {}; }
    dibujarRenta();
  }
});

/* ===== PANEL DE AVISOS (solo dueño) ===== */
if (ES_DUENO){
  const panel = document.createElement('section');
  panel.className = 'avisos mb-4';
  panel.setAttribute('aria-label', 'Avisos');
  ley.parentNode.insertBefore(panel, ley);

  const fechaCorta = iso => new Date(iso).toLocaleString('es-MX',
    {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});

  dibujarAvisos = () => {
    const sinLeer = avisos.filter(a => !a.leido).length;
    panel.innerHTML =
      '<div class="avisos-head">' +
        '<h2 class="avisos-titulo">Avisos' +
          (sinLeer ? '<span class="avisos-badge">' + sinLeer + '</span>' : '') + '</h2>' +
        (sinLeer ? '<button type="button" class="btn btn-outline-dark btn-sm" data-accion="todo">Marcar todo como leído</button>' : '') +
      '</div>' +
      (avisos.length
        ? '<ul class="avisos-lista">' + avisos.slice(0, 20).map(a =>
            '<li class="aviso' + (a.leido ? ' leido' : '') + '" data-id="' + a.id + '">' +
              '<div class="aviso-texto"><strong>' + esc(a.usuario) + '</strong> registró el locker <strong>' +
                esc(a.locker) + '</strong> (' + esc(a.seccion) + ') que estaba disponible e ingresó sus datos para usarlo.' +
                '<small>' + fechaCorta(a.fecha) + ' · ' + esc(a.correo) + '</small></div>' +
              '<div class="aviso-acciones">' +
                '<button type="button" class="btn btn-dark btn-sm" data-accion="ver">Ver locker</button>' +
                (a.leido ? '' : '<button type="button" class="btn btn-outline-dark btn-sm" data-accion="leer">Leído</button>') +
              '</div></li>').join('') + '</ul>'
        : '<p class="text-secondary mb-0">Sin avisos por ahora. Aquí aparecerá cuando un usuario registre un locker disponible.</p>');
  };

  // Va a la pestaña correcta, baja al locker y abre su tarjeta
  const irAlLocker = a => {
    const L = lockers[a.locker]; if (!L) return;
    const mostrar = () => {
      L.el.scrollIntoView({block:'center'});
      if (abierto !== L) abrir(L);
    };
    const btn = document.querySelector('[data-bs-target="' + (a.locker.charAt(0) === 'H' ? '#p-h' : '#p-m') + '"]');
    if (btn.classList.contains('active')){ mostrar(); return; }
    btn.addEventListener('shown.bs.tab', mostrar, {once:true});
    bootstrap.Tab.getOrCreateInstance(btn).show();
  };

  panel.addEventListener('click', ev => {
    const b = ev.target.closest('[data-accion]'); if (!b) return;
    const li = b.closest('.aviso');
    const a = li ? avisos.find(x => String(x.id) === li.dataset.id) : null;
    if (b.dataset.accion === 'todo') avisos.forEach(x => { x.leido = true; });
    if (b.dataset.accion === 'leer' && a) a.leido = true;
    if (b.dataset.accion === 'ver' && a){ a.leido = true; irAlLocker(a); }
    guardarAvisos();
    dibujarAvisos();
  });

  dibujarAvisos();
}

/* ===== RENTA DE LOCKERS: TOTAL Y CONFIGURACIÓN POR AÑO (solo dueño) ===== */
if (ES_DUENO){
  const panel = document.createElement('section');
  panel.className = 'bg-white rounded-3 shadow-sm p-3 mb-4';
  panel.setAttribute('aria-label', 'Renta de lockers');
  ley.parentNode.insertBefore(panel, ley);

  // Total de renta: suma del monto de todos los lockers rentados
  dibujarRenta = () => {
    const porAnio = {};
    let total = 0, conMonto = 0, sinMonto = 0;
    Object.values(lockers).forEach(L => {
      if (L.s !== 'rentado') return;
      const m = parseFloat(L.datos.monto);
      if (isNaN(m)){ sinMonto++; return; }
      const a = (L.datos.inicio || '').slice(0, 4) || 'Sin año';
      porAnio[a] = porAnio[a] || {monto: 0, n: 0};
      porAnio[a].monto += m;
      porAnio[a].n++;
      total += m;
      conMonto++;
    });
    const filas = Object.keys(porAnio).sort().map(a =>
      '<li class="d-flex justify-content-between border-top py-1"><span>' + esc(a) + ' · ' + porAnio[a].n +
      (porAnio[a].n === 1 ? ' locker' : ' lockers') + '</span><strong>' + MXN(porAnio[a].monto) + '</strong></li>').join('');
    panel.innerHTML =
      '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">' +
        '<h2 class="m-0 num" style="font-size:1.5rem;font-weight:700">Renta de lockers</h2>' +
        '<div class="d-flex flex-wrap gap-2">' +          '<button type="button" class="btn btn-dark btn-sm" id="btnReporte">Ver reporte de ingresos</button>' +          '<button type="button" class="btn btn-outline-dark btn-sm" id="btnConfigRenta">Configurar renta por año</button>' +        '</div>' +
      '</div>' +
      '<div class="d-flex flex-wrap align-items-end gap-3">' +
        '<div><div class="small text-secondary">Total de renta</div>' +
        '<div class="num" style="font-size:2rem;font-weight:700;line-height:1">' + MXN(total) + '</div></div>' +
        '<div class="small text-secondary">' + conMonto + (conMonto === 1 ? ' locker' : ' lockers') + ' con monto' +
        (sinMonto ? ' · ' + sinMonto + ' rentados sin monto registrado' : '') + '</div>' +
      '</div>' +
      (filas ? '<ul class="list-unstyled small mt-2 mb-0">' + filas + '</ul>' : '');
  };

  // Ventana para configurar el costo de renta de cada año
  const mc = document.createElement('div');
  mc.className = 'modal fade';
  mc.tabIndex = -1;
  mc.setAttribute('aria-hidden', 'true');
  mc.innerHTML =
    '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h2 class="modal-title fs-4">Configuración de renta por año</h2>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body">' +
        '<p class="small text-secondary">La renta va del inicio del contrato al 31 de diciembre (corte a diciembre). ' +
          'Si el contrato empieza a mitad de año, se cobra solo la parte proporcional. ' +
          'Los contratos ya registrados conservan el monto con el que se registraron.</p>' +
        '<div class="row g-2 mb-3">' +
          '<div class="col-5"><label class="form-label" for="cfgAnio">Año</label><select class="form-select" id="cfgAnio"></select></div>' +
          '<div class="col-7"><label class="form-label" for="cfgCosto">Costo de renta anual (MXN)</label>' +
            '<input class="form-control" type="number" min="0" step="0.01" id="cfgCosto" placeholder="3000"></div>' +
        '</div>' +
        '<label class="form-label" for="cfgMetodo">Cobro proporcional</label>' +
        '<select class="form-select mb-3" id="cfgMetodo">' +
          '<option value="mensual">Por meses (costo anual ÷ 12)</option>' +
          '<option value="diario">Por días (costo anual ÷ 365)</option></select>' +
        '<div class="rounded p-2 mb-3 text-bg-light small" id="cfgVista"></div>' +
        '<h3 class="fs-6">Años configurados</h3>' +
        '<ul class="list-unstyled small mb-0" id="cfgLista"></ul>' +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button>' +
        '<button type="button" class="btn btn-dark" id="cfgGuardar">Guardar año</button></div>' +
    '</div></div>';
  document.body.appendChild(mc);
  const modalCfg = new bootstrap.Modal(mc);
  const $ = id => document.getElementById(id);
  const anioActual = new Date().getFullYear();

  const llenarAnios = (elegido) => {
    const anios = new Set([anioActual - 1, anioActual, anioActual + 1, anioActual + 2]);
    Object.keys(configRenta).forEach(a => anios.add(+a));
    $('cfgAnio').innerHTML = [...anios].sort().map(a => '<option>' + a + '</option>').join('');
    $('cfgAnio').value = String(elegido || anioActual);
  };
  const vistaCfg = () => {
    const costo = parseFloat($('cfgCosto').value);
    $('cfgVista').innerHTML = isNaN(costo)
      ? 'Escribe el costo anual para ver el desglose.'
      : '<strong>Por mes:</strong> ' + MXN(costo / 12) + ' &nbsp;·&nbsp; <strong>Por día:</strong> ' + MXN(costo / 365) +
        '<br><strong>Ejemplo, de agosto a diciembre:</strong> por meses 5 × ' + MXN(costo / 12) + ' = ' + MXN(costo / 12 * 5) +
        ' · por días 153 × ' + MXN(costo / 365) + ' = ' + MXN(costo / 365 * 153);
  };
  const cargarAnio = () => {
    const c = configRenta[$('cfgAnio').value];
    $('cfgCosto').value = c ? c.costo : '';
    $('cfgMetodo').value = c ? c.metodo : 'diario';
    vistaCfg();
  };
  const listaCfg = () => {
    const anios = Object.keys(configRenta).sort();
    $('cfgLista').innerHTML = anios.length
      ? anios.map(a => '<li class="d-flex justify-content-between align-items-center border-top py-1"><span>' + esc(a) + ' · ' +
          MXN(configRenta[a].costo) + ' · ' + (configRenta[a].metodo === 'diario' ? 'por días' : 'por meses') + '</span>' +
          '<button type="button" class="btn btn-outline-danger btn-sm" data-quitar="' + esc(a) + '">Quitar</button></li>').join('')
      : '<li class="text-secondary">Todavía no hay años configurados.</li>';
  };

  panel.addEventListener('click', ev => {
    if (ev.target.closest('#btnConfigRenta')){
      llenarAnios();
      cargarAnio();
      listaCfg();
      modalCfg.show();
    }
  });

  $('cfgAnio').addEventListener('change', cargarAnio);
  $('cfgCosto').addEventListener('input', vistaCfg);
  $('cfgMetodo').addEventListener('change', vistaCfg);

  $('cfgGuardar').addEventListener('click', () => {
    const a = $('cfgAnio').value;
    const costo = parseFloat($('cfgCosto').value);
    if (isNaN(costo) || costo < 0){ $('cfgCosto').classList.add('is-invalid'); return; }
    $('cfgCosto').classList.remove('is-invalid');
    configRenta[a] = {costo, metodo: $('cfgMetodo').value};
    guardarRenta();
    dibujarRenta();
    listaCfg();
    modalCfg.hide();
  });

  mc.addEventListener('click', ev => {
    const b = ev.target.closest('[data-quitar]'); if (!b) return;
    delete configRenta[b.dataset.quitar];
    guardarRenta();
    dibujarRenta();
    cargarAnio();
    listaCfg();
  });

  dibujarRenta();
}