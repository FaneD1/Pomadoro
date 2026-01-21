import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from '../database.js';

/**
 * Настройка маршрутов аутентификации
 * Вход по invite-коду без паролей
 */
export function setupAuthRoutes(app) {
  // Вход по invite-коду
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { inviteCode, name } = req.body;

      if (!inviteCode || !name) {
        return res.status(400).json({ error: 'Требуется invite-код и имя' });
      }

      // Проверяем, существует ли пользователь с таким invite-кодом
      let user = await dbGet('SELECT * FROM users WHERE invite_code = ?', [inviteCode]);

      if (!user) {
        // Создаём нового пользователя
        const userId = uuidv4();
        let roomId = null;

        // Проверяем, есть ли комната с одним пользователем
        const roomsWithOneUser = await dbAll(`
          SELECT r.id, COUNT(u.id) as user_count
          FROM rooms r
          LEFT JOIN users u ON u.room_id = r.id
          GROUP BY r.id
          HAVING user_count = 1
        `);

        if (roomsWithOneUser.length > 0) {
          // Присоединяемся к существующей комнате
          roomId = roomsWithOneUser[0].id;
        } else {
          // Создаём новую комнату
          roomId = uuidv4();
          await dbRun('INSERT INTO rooms (id) VALUES (?)', [roomId]);
        }

        await dbRun(
          'INSERT INTO users (id, name, invite_code, room_id) VALUES (?, ?, ?, ?)',
          [userId, name, inviteCode, roomId]
        );

        user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
      }

      // Устанавливаем cookie для сессии
      res.cookie('userId', user.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.cookie('inviteCode', inviteCode, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      res.json({
        user: {
          id: user.id,
          name: user.name,
          inviteCode: user.invite_code,
          roomId: user.room_id
        }
      });
    } catch (error) {
      console.error('Ошибка входа:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Получить информацию о текущем пользователе
  app.get('/api/auth/me', async (req, res) => {
    try {
      const userId = req.cookies?.userId;

      if (!userId) {
        return res.status(401).json({ error: 'Не авторизован' });
      }

      const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

      if (!user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }

      res.json({
        user: {
          id: user.id,
          name: user.name,
          inviteCode: user.invite_code,
          roomId: user.room_id
        }
      });
    } catch (error) {
      console.error('Ошибка получения пользователя:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Выход
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('userId');
    res.clearCookie('inviteCode');
    res.json({ success: true });
  });
}

/**
 * Middleware для проверки аутентификации
 */
export async function requireAuth(req, res, next) {
  const userId = req.cookies?.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }

  req.user = user;
  next();
}
