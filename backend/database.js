import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Инициализация базы данных SQLite
 * Создаёт все необходимые таблицы
 */
export async function initDatabase() {
  return new Promise((resolve, reject) => {
    const dbPath = join(__dirname, '..', 'pomodoro.db');
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Ошибка подключения к БД:', err);
        reject(err);
        return;
      }
      console.log('✅ Подключение к SQLite установлено');
      createTables().then(resolve).catch(reject);
    });
  });
}

/**
 * Создание таблиц в базе данных
 */
async function createTables() {
  const run = promisify(db.run.bind(db));
  
  // Таблица комнат (для пары пользователей)
  await run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица пользователей
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      room_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `);

  // Таблица задач
  await run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Таблица сессий таймера
  await run(`
    CREATE TABLE IF NOT EXISTS timer_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'stopped',
      phase TEXT NOT NULL DEFAULT 'work',
      start_time INTEGER,
      duration_seconds INTEGER NOT NULL DEFAULT 1500,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  console.log('✅ Таблицы созданы');
}

/**
 * Получить экземпляр базы данных
 */
export function getDatabase() {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  return db;
}

/**
 * Промис-обёртки для работы с БД
 */
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};
