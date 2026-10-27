import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 1;

export type Vencimiento = {
  id: number;
  nombre: string;
  fecha: string;
  textoOcr: string | null;
  creadoEn: string;
};

type VencimientoRow = {
  id: number;
  nombre: string;
  fecha: string;
  texto_ocr: string | null;
  creado_en: string;
};

function mapRow(row: VencimientoRow): Vencimiento {
  return {
    id: row.id,
    nombre: row.nombre,
    fecha: row.fecha,
    textoOcr: row.texto_ocr,
    creadoEn: row.creado_en,
  };
}

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentDbVersion = result?.user_version ?? 0;
  if (currentDbVersion >= DATABASE_VERSION) {
    return;
  }

  if (currentDbVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      CREATE TABLE IF NOT EXISTS vencimientos (
        id INTEGER PRIMARY KEY NOT NULL,
        nombre TEXT NOT NULL,
        fecha TEXT NOT NULL,
        texto_ocr TEXT,
        creado_en TEXT NOT NULL
      );
    `);
    currentDbVersion = 1;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export async function listVencimientos(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<VencimientoRow>(
    'SELECT id, nombre, fecha, texto_ocr, creado_en FROM vencimientos ORDER BY fecha ASC, id ASC',
  );
  return rows.map(mapRow);
}

export async function insertVencimiento(
  db: SQLiteDatabase,
  input: { nombre: string; fecha: string; textoOcr: string | null },
) {
  await db.runAsync(
    'INSERT INTO vencimientos (nombre, fecha, texto_ocr, creado_en) VALUES (?, ?, ?, ?)',
    input.nombre,
    input.fecha,
    input.textoOcr,
    new Date().toISOString(),
  );
}

export async function deleteVencimiento(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM vencimientos WHERE id = ?', id);
}
