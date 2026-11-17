// Si quieres que solo ciertos correos entren como Dueño, ponlos aquí.
// Ejemplo: ['dueno@micorreo.com']   (vacío = cualquiera puede elegir Dueño)
const CORREOS_DUENO = [];

// Si ya hay sesión, pasa directo al sistema
if (sessionStorage.getItem('sl-sesion')) location.replace('index.html');

const $ = id => document.getElementById(id);

// CURP y RFC siempre en mayúsculas
['curp', 'rfc'].forEach(id =>
  $(id).addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); }));

// Quita el aviso rojo al volver a escribir
document.querySelectorAll('#form input').forEach(i =>
  i.addEventListener('input', () => i.classList.remove('is-invalid')));

const RX = {
  correo:   /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  nombre:   /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'. -]+$/,
  curp:     /^[A-Z]{4}\d{6}[HMX][A-Z]{2}[A-Z]{3}[A-Z\d]\d$/,
  rfc:      /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/,
  empleado: /^[A-Za-z0-9-]{3,15}$/
};

$('form').addEventListener('submit', ev => {
  ev.preventDefault();

  const rol = document.querySelector('input[name="rol"]:checked').value;
  const v = {
    correo:   $('correo').value.trim().toLowerCase(),
    nombre:   $('nombre').value.trim().replace(/\s+/g, ' '),
    curp:     $('curp').value.trim(),
    rfc:      $('rfc').value.trim(),
    empleado: $('empleado').value.trim()
  };

  const ok = {
    correo:   RX.correo.test(v.correo),
    nombre:   v.nombre.length >= 5 && v.nombre.split(' ').length >= 2 && RX.nombre.test(v.nombre),
    curp:     RX.curp.test(v.curp),
    rfc:      v.rfc === '' || RX.rfc.test(v.rfc),
    empleado: v.empleado === '' || RX.empleado.test(v.empleado)
  };
  Object.keys(ok).forEach(k => $(k).classList.toggle('is-invalid', !ok[k]));

  // Se necesita RFC o número de empleado (al menos uno)
  const faltaId = v.rfc === '' && v.empleado === '';
  if (faltaId){
    $('rfc').classList.add('is-invalid');
    $('empleado').classList.add('is-invalid');
  }

  let msg = '';
  if (faltaId) msg = 'Captura tu RFC, tu número de empleado, o ambos.';
  else if (rol === 'dueno' && CORREOS_DUENO.length &&
           !CORREOS_DUENO.map(c => c.toLowerCase()).includes(v.correo)){
    msg = 'Este correo no tiene permiso de dueño.';
  }
  $('error').textContent = msg;
  $('error').classList.toggle('d-none', !msg);

  if (msg || Object.values(ok).includes(false)) return;

  // Solo se guarda rol, nombre y correo. CURP/RFC/empleado NO se guardan.
  sessionStorage.setItem('sl-sesion', JSON.stringify({rol, nombre: v.nombre, correo: v.correo}));
  location.href = 'index.html';
});
