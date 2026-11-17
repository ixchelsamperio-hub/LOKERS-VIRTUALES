require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');

const app = express();
app.use(express.json({ limit: '100kb' }));


const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME || 'StatusLocker',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Conectado a SQL Server ( - server.js:23' + config.server + ':' + config.port + ', base ' + config.database + ')');
    return pool;
  })
  .catch(err => {
    console.error('NO se pudo conectar a SQL Server: - server.js:27' + err.message);
    process.exit(1);
  });


const ESTADOS = ['propietario', 'rentado', 'prestado', 'empleados', 'disponible', 'noident'];
const ID_LOCKER = /^[HM]-\d{3}$/;

// Atrapa errores de funciones async y los manda al manejador de errores
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Por ahora el rol viaja en un encabezado. NO es seguridad real:
// cuando haya inicio de sesión verificado en el servidor se reemplaza por un token.
const soloDueno = (req, res, next) =>
  req.get('x-rol') === 'dueno' ? next() : res.status(403).json({ error: 'Solo el dueño puede hacer esto.' });

// Deja solo textos cortos y no vacíos
function limpiarDatos(d) {
  const out = {};
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'string' && v.trim()) out[String(k).slice(0, 30)] = v.trim().slice(0, 150);
    }
  }
  return out;
}
const aJSON = datos => (Object.keys(datos).length ? JSON.stringify(datos) : null);


// Prueba rápida de que todo está conectado
app.get('/api/salud', wrap(async (req, res) => {
  const pool = await poolPromise;
  const r = await pool.request().query('SELECT @@SERVERNAME AS servidor, DB_NAME() AS base, SYSDATETIME() AS ahora');
  res.json({ ok: true, ...r.recordset[0] });
}));

// Lista de los 1,008 lockers
app.get('/api/lockers', wrap(async (req, res) => {
  const pool = await poolPromise;
  const r = await pool.request().query('SELECT id, seccion, numero, estado, datos FROM dbo.Lockers ORDER BY seccion, numero');
  res.json(r.recordset.map(f => ({ ...f, datos: f.datos ? JSON.parse(f.datos) : {} })));
}));

// DUEÑO: cambiar el estado y los datos de un locker
app.put('/api/lockers/:id', soloDueno, wrap(async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!ID_LOCKER.test(id)) return res.status(400).json({ error: 'Locker no válido.' });
  if (!ESTADOS.includes(body.estado)) return res.status(400).json({ error: 'Estado no válido.' });
  const datos = limpiarDatos(body.datos);

  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.VarChar(10), id)
    .input('estado', sql.VarChar(20), body.estado)
    .input('datos', sql.NVarChar(sql.MAX), aJSON(datos))
    .query('UPDATE dbo.Lockers SET estado = @estado, datos = @datos, actualizado = SYSDATETIME() WHERE id = @id');
  if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Locker no encontrado.' });
  res.json({ ok: true });
}));

// USUARIO: registrar sus datos en un locker DISPONIBLE 
app.post('/api/lockers/:id/registrar', wrap(async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!ID_LOCKER.test(id)) return res.status(400).json({ error: 'Locker no válido.' });
  const datos = limpiarDatos(body.datos);
  if (!datos.usuario) return res.status(400).json({ error: 'Escribe tu nombre.' });
  const correo = String(body.correo || '').slice(0, 150);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Solo cambia si SIGUE disponible (evita que dos personas tomen el mismo locker)
    const upd = await new sql.Request(tx)
      .input('id', sql.VarChar(10), id)
      .input('datos', sql.NVarChar(sql.MAX), aJSON(datos))
      .query("UPDATE dbo.Lockers SET estado = 'rentado', datos = @datos, actualizado = SYSDATETIME() WHERE id = @id AND estado = 'disponible'");
    if (upd.rowsAffected[0] === 0) {
      await tx.rollback();
      return res.status(409).json({ error: 'Ese locker ya no está disponible.' });
    }
    await new sql.Request(tx)
      .input('locker', sql.VarChar(10), id)
      .input('usuario', sql.NVarChar(150), datos.usuario)
      .input('correo', sql.NVarChar(150), correo || null)
      .query('INSERT INTO dbo.Avisos (locker_id, usuario, correo) VALUES (@locker, @usuario, @correo)');
    await tx.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ya estaba cerrada */ }
    throw e;
  }
}));

// DUEÑO: ver avisos
app.get('/api/avisos', soloDueno, wrap(async (req, res) => {
  const pool = await poolPromise;
  const r = await pool.request().query(`
    SELECT TOP (100) a.id, a.locker_id AS locker, l.seccion, a.usuario, a.correo, a.fecha, a.leido
    FROM dbo.Avisos a
    JOIN dbo.Lockers l ON l.id = a.locker_id
    ORDER BY a.fecha DESC`);
  res.json(r.recordset);
}));

// DUEÑO: marcar todos como leídos
app.put('/api/avisos/leidos', soloDueno, wrap(async (req, res) => {
  const pool = await poolPromise;
  await pool.request().query('UPDATE dbo.Avisos SET leido = 1 WHERE leido = 0');
  res.json({ ok: true });
}));

// DUEÑO: marcar un aviso como leído
app.put('/api/avisos/:id/leido', soloDueno, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Aviso no válido.' });
  const pool = await poolPromise;
  await pool.request().input('id', sql.Int, id).query('UPDATE dbo.Avisos SET leido = 1 WHERE id = @id');
  res.json({ ok: true });
}));

const raiz = path.join(__dirname, '..');
const estatico = dir => express.static(path.join(raiz, dir), {
  etag: false, maxAge: 0, setHeaders: res => res.set('Cache-Control', 'no-store')
});
app.use('/css', estatico('css'));
app.use('/js', estatico('js'));
['login.html', 'index.html'].forEach(f =>
  app.get('/' + f, (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(raiz, f)); }));
app.get('/', (req, res) => res.redirect('/login.html'));

// Errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor.' });
});

const PORT = Number(process.env.PORT) || 5600;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor listo: http://localhost: - server.js:168' + PORT + '/login.html');
});

