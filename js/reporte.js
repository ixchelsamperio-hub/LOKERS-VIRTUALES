/* ===== PAGOS: historial por locker ===== */
const CLAVE_PAGOS = 'statuslocker-pagos';
let pagos = {};   // { 'H-010': [ {id, fecha, monto, recibo} ] }
try { pagos = JSON.parse(localStorage.getItem(CLAVE_PAGOS)) || {}; } catch (e) { pagos = {}; }
function guardarPagos(){
  try { localStorage.setItem(CLAVE_PAGOS, JSON.stringify(pagos)); } catch (e) {}
}
const redondear = n => Math.round(n * 100) / 100;
const totalPagado = id => redondear((pagos[id] || []).reduce((s, p) => s + p.monto, 0));

// Línea que se agrega a la tarjeta de un locker rentado: cuánto lleva pagado
function resumenPagos(L){
  const renta = parseFloat(L.datos.monto);
  if (isNaN(renta)) return '';
  const pagado = totalPagado(L.id);
  const saldo = Math.max(0, redondear(renta - pagado));
  return '<p class="small mt-2 mb-0"><strong>Pagado:</strong> ' + MXN(pagado) + ' de ' + MXN(renta) + ' · ' +
    (saldo > 0 ? '<span class="text-danger"><strong>Por pagar:</strong> ' + MXN(saldo) + '</span>'
               : '<span class="text-success"><strong>Liquidado</strong></span>') + '</p>';
}

// Si cambian los pagos en otra pestaña, se actualiza la tarjeta abierta
window.addEventListener('storage', ev => {
  if (ev.key !== CLAVE_PAGOS) return;
  try { pagos = JSON.parse(ev.newValue) || {}; } catch (e) { pagos = {}; }
  if (abierto) mostrarTarjeta();
});

/* =========================================================
   SOLO ADMINISTRADOR
   ========================================================= */
if (ES_DUENO){
  const $ = id => document.getElementById(id);
  const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  /* ---------- Ventana: historial de pagos de un locker ---------- */
  const mp = document.createElement('div');
  mp.className = 'modal fade';
  mp.tabIndex = -1;
  mp.setAttribute('aria-hidden', 'true');
  mp.innerHTML =
    '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h2 class="modal-title fs-4" id="pgTitulo">Historial de pagos</h2>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body">' +
        '<div class="rounded p-2 mb-3 text-bg-light small" id="pgResumen"></div>' +
        '<div class="row g-2 mb-2">' +
          '<div class="col-6"><label class="form-label" for="pgFecha">Fecha de pago</label><input class="form-control" type="date" id="pgFecha"></div>' +
          '<div class="col-6"><label class="form-label" for="pgMonto">Monto (MXN)</label><input class="form-control" type="number" min="0" step="0.01" id="pgMonto"></div>' +
          '<div class="col-12"><label class="form-label" for="pgRecibo">Recibo de pago (No.)</label><input class="form-control" type="text" id="pgRecibo"></div>' +
        '</div>' +
        '<div class="text-danger small mb-2 d-none" id="pgError"></div>' +
        '<button type="button" class="btn btn-dark btn-sm mb-3" id="pgAgregar">Registrar pago</button>' +
        '<h3 class="fs-6">Pagos registrados</h3>' +
        '<ul class="list-unstyled small mb-0" id="pgLista"></ul>' +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button></div>' +
    '</div></div>';
  document.body.appendChild(mp);
  const modalPg = new bootstrap.Modal(mp);
  let lockerPagos = null;

  const renderPagos = () => {
    const L = lockerPagos;
    const lista = pagos[L.id] || [];
    const renta = parseFloat(L.datos.monto) || 0;
    const pagado = totalPagado(L.id);
    $('pgResumen').innerHTML =
      '<strong>Usuario:</strong> ' + esc(L.datos.usuario || '—') + '<br>' +
      '<strong>Renta:</strong> ' + MXN(renta) + ' · <strong>Pagado:</strong> ' + MXN(pagado) +
      ' · <strong>Por pagar:</strong> ' + MXN(Math.max(0, redondear(renta - pagado)));
    $('pgLista').innerHTML = lista.length
      ? [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(p =>
          '<li class="d-flex justify-content-between align-items-center border-top py-1"><span>' +
          fmt({t:'date'}, p.fecha) + ' · <strong>' + MXN(p.monto) + '</strong>' +
          (p.recibo ? ' · Recibo ' + esc(p.recibo) : '') + '</span>' +
          '<button type="button" class="btn btn-outline-danger btn-sm" data-quitar="' + p.id + '">Quitar</button></li>').join('')
      : '<li class="text-secondary">Todavía no hay pagos registrados.</li>';
  };

  const abrirPagos = L => {
    lockerPagos = L;
    $('pgTitulo').textContent = 'Historial de pagos · ' + L.id;
    $('pgFecha').value = hoyISO();
    $('pgMonto').value = '';
    $('pgRecibo').value = '';
    $('pgError').classList.add('d-none');
    renderPagos();
    modalPg.show();
  };

  $('pgAgregar').addEventListener('click', () => {
    const L = lockerPagos; if (!L) return;
    const err = m => { $('pgError').textContent = m; $('pgError').classList.remove('d-none'); };
    const fecha = $('pgFecha').value;
    const monto = redondear(parseFloat($('pgMonto').value));
    const renta = parseFloat(L.datos.monto);
    if (isNaN(renta)) return err('Este locker no tiene un monto de renta registrado.');
    const saldo = redondear(renta - totalPagado(L.id));
    if (!fecha) return err('Elige la fecha del pago.');
    if (isNaN(monto) || monto <= 0) return err('Escribe un monto mayor a cero.');
    if (monto > saldo) return err('El pago supera lo que falta por pagar (' + MXN(Math.max(0, saldo)) + ').');
    (pagos[L.id] = pagos[L.id] || []).push({id: Date.now(), fecha, monto, recibo: $('pgRecibo').value.trim().slice(0, 40)});
    guardarPagos();
    $('pgError').classList.add('d-none');
    $('pgMonto').value = '';
    $('pgRecibo').value = '';
    renderPagos();
    if (abierto) mostrarTarjeta();
  });

  $('pgLista').addEventListener('click', ev => {
    const b = ev.target.closest('[data-quitar]'); if (!b || !lockerPagos) return;
    pagos[lockerPagos.id] = (pagos[lockerPagos.id] || []).filter(p => String(p.id) !== b.dataset.quitar);
    guardarPagos();
    renderPagos();
    if (abierto) mostrarTarjeta();
  });

  /* ---------- Botones nuevos de la tarjeta: Rentar locker e Historial de pagos ---------- */
  tarjeta.addEventListener('click', ev => {
    if (!abierto) return;

    // El administrador renta un locker disponible
    if (ev.target.closest('#btn-rentar') && abierto.s === 'disponible'){
      configurarModal('dueno');
      document.getElementById('modalTitulo').textContent = 'Rentar locker ' + abierto.id + ' · ' + abierto.seccion;
      sel.value = 'rentado';
      dibujarCampos(abierto, 'rentado');
      const inicio = document.getElementById('f-inicio');
      inicio.value = hoyISO();
      inicio.dispatchEvent(new Event('input'));   // calcula fin de contrato y monto
      modal.show();
    }

    if (ev.target.closest('#btn-pagos') && abierto.s === 'rentado') abrirPagos(abierto);
  });

  /* ---------- Reporte de ingresos por año ---------- */
  const mr = document.createElement('div');
  mr.className = 'modal fade';
  mr.tabIndex = -1;
  mr.setAttribute('aria-hidden', 'true');
  mr.innerHTML =
    '<div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h2 class="modal-title fs-4">Reporte de ingresos</h2>' +
        '<div class="ms-auto d-flex align-items-center gap-2 me-3"><label class="form-label m-0" for="rpAnio">Año</label>' +
          '<select class="form-select form-select-sm w-auto" id="rpAnio"></select></div>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body" id="rpCuerpo"></div>' +
    '</div></div>';
  document.body.appendChild(mr);
  const modalRp = new bootstrap.Modal(mr);

  // Tabla sencilla: cols = [{t:'Título', der:true}], filas = [[celda, ...]], pie = [celda, ...]
  const TABLA = (cols, filas, pie) =>
    '<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>' +
    cols.map(c => '<th' + (c.der ? ' class="text-end"' : '') + '>' + c.t + '</th>').join('') + '</tr></thead><tbody>' +
    filas.map(f => '<tr>' + f.map((v, i) => '<td' + (cols[i].der ? ' class="text-end"' : '') + '>' + v + '</td>').join('') + '</tr>').join('') +
    '</tbody>' + (pie ? '<tfoot class="table-light"><tr>' + pie.map((v, i) =>
      '<th' + (cols[i].der ? ' class="text-end"' : '') + '>' + v + '</th>').join('') + '</tr></tfoot>' : '') +
    '</table></div>';

  const rentadosDelAnio = anio => Object.values(lockers)
    .filter(L => L.s === 'rentado' && !isNaN(parseFloat(L.datos.monto)) && (L.datos.inicio || '').slice(0, 4) === String(anio))
    .sort((a, b) => a.num - b.num);
  const sumaRenta = filas => filas.reduce((s, L) => s + parseFloat(L.datos.monto), 0);
  const sumaPagado = filas => filas.reduce((s, L) => s + totalPagado(L.id), 0);
  const porPagar = (renta, pagado) => Math.max(0, redondear(renta - pagado));
  const pct = (x, total) => (total > 0 ? (x / total * 100).toFixed(1) : '0.0') + '%';

  // Lockers rentados de una sección (hombres o mujeres)
  const bloqueRentados = (nombre, filas) => {
    if (!filas.length) return '<h3 class="fs-6 mt-3">' + nombre + '</h3><p class="text-secondary small">No hay lockers rentados de ' + nombre.toLowerCase() + ' en este año.</p>';
    const renta = sumaRenta(filas), pagado = sumaPagado(filas);
    const cols = [{t:'Locker'}, {t:'Nombre'}, {t:'Periodo'}, {t:'Renta', der:true}, {t:'Pagado', der:true}, {t:'Por pagar', der:true}];
    const rows = filas.map(L => {
      const m = parseFloat(L.datos.monto), pg = totalPagado(L.id);
      const mes = +L.datos.inicio.slice(5, 7) - 1;
      return [esc(L.id), esc(L.datos.usuario || '—'),
        MESES_CORTOS[mes] + ' – Dic <span class="text-secondary small">(desde ' + fmt({t:'date'}, L.datos.inicio) + ')</span>',
        MXN(m), MXN(pg), MXN(porPagar(m, pg))];
    });
    return '<h3 class="fs-6 mt-3">' + nombre + '</h3>' +
      TABLA(cols, rows, ['Subtotal ' + nombre.toLowerCase(), filas.length + (filas.length === 1 ? ' locker' : ' lockers'), '', MXN(renta), MXN(pagado), MXN(porPagar(renta, pagado))]);
  };

  // Hombres, mujeres y el total de los dos, con su porcentaje
  const bloqueTotales = (h, m, anio) => {
    const rh = sumaRenta(h), rm = sumaRenta(m), tot = rh + rm;
    const ph = sumaPagado(h), pm = sumaPagado(m);
    const cols = [{t:'Concepto'}, {t:'Lockers', der:true}, {t:'Renta', der:true}, {t:'Pagado', der:true}, {t:'Por pagar', der:true}, {t:'% del total', der:true}];
    const fila = (n, k, r, p) => [n, String(k), MXN(r), MXN(p), MXN(porPagar(r, p)), pct(r, tot)];
    const ancho = tot > 0 ? rh / tot * 100 : 0;
    const barra = tot > 0
      ? '<div class="progress-stacked mt-3" role="img" aria-label="Distribución de la renta entre hombres y mujeres">' +
          '<div class="progress" style="width:' + ancho.toFixed(1) + '%"><div class="progress-bar bg-dark">' + pct(rh, tot) + '</div></div>' +
          '<div class="progress" style="width:' + (100 - ancho).toFixed(1) + '%"><div class="progress-bar bg-secondary">' + pct(rm, tot) + '</div></div></div>' +
        '<div class="small mt-1"><span class="badge text-bg-dark">Hombres</span> <span class="badge text-bg-secondary">Mujeres</span></div>'
      : '';
    return TABLA(cols, [fila('Hombres', h.length, rh, ph), fila('Mujeres', m.length, rm, pm)],
        ['Total ' + anio, String(h.length + m.length), MXN(tot), MXN(ph + pm), MXN(porPagar(tot, ph + pm)), tot > 0 ? '100.0%' : '0.0%']) + barra;
  };

  // Lockers prestados, de empleados y de propietarios
  const listaEstado = (estado, titulo) => {
    const todos = Object.values(lockers).filter(L => L.s === estado);
    const conDatos = todos.filter(L => Object.keys(L.datos || {}).length)
      .sort((a, b) => a.seccion.localeCompare(b.seccion) || a.num - b.num);
    const campos = CAMPOS[estado];
    const cols = [{t:'Locker'}].concat(campos.map(c => ({t: c.l})));
    const rows = conDatos.map(L => [esc(L.id)].concat(campos.map(c => esc(fmt(c, L.datos[c.k] || '—')))));
    const sin = todos.length - conDatos.length;
    return '<h3 class="fs-5 mt-4">' + titulo + ' <span class="text-secondary fs-6">(' + todos.length + ')</span></h3>' +
      (rows.length ? TABLA(cols, rows) : '<p class="text-secondary small mb-0">Ningún locker tiene datos registrados todavía.</p>') +
      (sin && rows.length ? '<p class="small text-secondary mt-1 mb-0">' + sin + (sin === 1 ? ' locker sin datos registrados.' : ' lockers sin datos registrados.') + '</p>' : '');
  };

  const dibujarReporte = () => {
    const anio = $('rpAnio').value;
    const todos = rentadosDelAnio(anio);
    const h = todos.filter(L => L.seccion === 'Hombres');
    const m = todos.filter(L => L.seccion === 'Mujeres');
    const cfg = configRenta[anio];
    $('rpCuerpo').innerHTML =
      '<h3 class="fs-5">Lockers rentados (ingresos) · Año ' + esc(anio) + '</h3>' +
      '<p class="small text-secondary">' + (cfg
        ? 'Costo anual del locker: <strong>' + MXN(cfg.costo) + '</strong> · ' +
          (cfg.metodo === 'diario' ? 'cobro por días (' + MXN(cfg.costo / 365) + ' por día hasta el 31 de diciembre)'
                                   : 'cobro por meses (' + MXN(cfg.costo / 12) + ' por mes hasta diciembre)')
        : 'Este año todavía no tiene costo de renta configurado.') + '</p>' +
      bloqueRentados('Hombres', h) + bloqueRentados('Mujeres', m) +
      '<h3 class="fs-6 mt-4">Total · Año ' + esc(anio) + '</h3>' + bloqueTotales(h, m, esc(anio)) +
      listaEstado('prestado', 'Lockers prestados') +
      listaEstado('empleados', 'Lockers de empleados') +
      listaEstado('propietario', 'Lockers de propietarios');
  };

  const llenarAniosReporte = () => {
    const actual = new Date().getFullYear();
    const anios = new Set([actual]);
    Object.keys(configRenta).forEach(a => anios.add(+a));
    Object.values(lockers).forEach(L => {
      if (L.s === 'rentado' && /^\d{4}/.test(L.datos.inicio || '')) anios.add(+L.datos.inicio.slice(0, 4));
    });
    const lista = [...anios].sort();
    const previo = +$('rpAnio').value;
    $('rpAnio').innerHTML = lista.map(a => '<option>' + a + '</option>').join('');
    $('rpAnio').value = String(lista.includes(previo) ? previo : actual);
  };

  $('rpAnio').addEventListener('change', dibujarReporte);
  document.addEventListener('click', ev => {
    if (!ev.target.closest('#btnReporte')) return;
    llenarAniosReporte();
    dibujarReporte();
    modalRp.show();
  });
}
