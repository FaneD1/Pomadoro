import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet } from '../database.js';
import { requireAuth } from './auth.js';
import { notifyTimerUpdate } from '../websocket.js';

/**
 * Настройка маршрутов для управления таймером
 */
export function setupTimerRoutes(app) {
  // Получить текущее состояние таймера
  app.get('/api/timer', requireAuth, async (req, res) => {
    try {
      let session = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      if (!session) {
        // Создаём начальную сессию
        const sessionId = uuidv4();
        await dbRun(
          `INSERT INTO timer_sessions 
           (id, user_id, status, phase, duration_seconds) 
           VALUES (?, ?, 'stopped', 'work', 1500)`,
          [sessionId, req.user.id]
        );
        session = await dbGet('SELECT * FROM timer_sessions WHERE id = ?', [sessionId]);
      }

      res.json({ session });
    } catch (error) {
      console.error('Ошибка получения таймера:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Запустить таймер
  app.post('/api/timer/start', requireAuth, async (req, res) => {
    try {
      const { phase = 'work', durationSeconds = 1500 } = req.body;

      // Получаем активную задачу
      const activeTask = await dbGet(
        'SELECT * FROM tasks WHERE user_id = ? AND is_active = 1',
        [req.user.id]
      );

      // Получаем или создаём сессию
      let session = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      const now = Date.now();
      const sessionId = session?.id || uuidv4();

      if (session) {
        // Обновляем существующую сессию
        await dbRun(
          `UPDATE timer_sessions 
           SET status = 'running', phase = ?, start_time = ?, duration_seconds = ?, task_id = ?
           WHERE id = ?`,
          [phase, now, durationSeconds, activeTask?.id || null, sessionId]
        );
      } else {
        // Создаём новую сессию
        await dbRun(
          `INSERT INTO timer_sessions 
           (id, user_id, task_id, status, phase, start_time, duration_seconds) 
           VALUES (?, ?, ?, 'running', ?, ?, ?)`,
          [sessionId, req.user.id, activeTask?.id || null, phase, now, durationSeconds]
        );
      }

      session = await dbGet('SELECT * FROM timer_sessions WHERE id = ?', [sessionId]);
      
      // Уведомляем через WebSocket
      await notifyTimerUpdate(req.user.id);
      
      res.json({ session });
    } catch (error) {
      console.error('Ошибка запуска таймера:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Приостановить таймер
  app.post('/api/timer/pause', requireAuth, async (req, res) => {
    try {
      const session = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      if (!session || session.status !== 'running') {
        return res.status(400).json({ error: 'Таймер не запущен' });
      }

      await dbRun(
        'UPDATE timer_sessions SET status = ? WHERE id = ?',
        ['paused', session.id]
      );

      const updatedSession = await dbGet('SELECT * FROM timer_sessions WHERE id = ?', [session.id]);
      
      // Уведомляем через WebSocket
      await notifyTimerUpdate(req.user.id);
      
      res.json({ session: updatedSession });
    } catch (error) {
      console.error('Ошибка паузы таймера:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Возобновить таймер
  app.post('/api/timer/resume', requireAuth, async (req, res) => {
    try {
      const session = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      if (!session || session.status !== 'paused') {
        return res.status(400).json({ error: 'Таймер не на паузе' });
      }

      // Вычисляем оставшееся время
      const elapsed = Math.floor((Date.now() - session.start_time) / 1000);
      const remaining = Math.max(0, session.duration_seconds - elapsed);

      // Обновляем start_time для корректного продолжения
      const now = Date.now();
      await dbRun(
        `UPDATE timer_sessions 
         SET status = 'running', start_time = ?, duration_seconds = ? 
         WHERE id = ?`,
        [now - (session.duration_seconds - remaining) * 1000, remaining, session.id]
      );

      const updatedSession = await dbGet('SELECT * FROM timer_sessions WHERE id = ?', [session.id]);
      
      // Уведомляем через WebSocket
      await notifyTimerUpdate(req.user.id);
      
      res.json({ session: updatedSession });
    } catch (error) {
      console.error('Ошибка возобновления таймера:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Остановить таймер
  app.post('/api/timer/stop', requireAuth, async (req, res) => {
    try {
      const session = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      if (!session) {
        return res.status(400).json({ error: 'Таймер не найден' });
      }

      await dbRun(
        'UPDATE timer_sessions SET status = ? WHERE id = ?',
        ['stopped', session.id]
      );

      const updatedSession = await dbGet('SELECT * FROM timer_sessions WHERE id = ?', [session.id]);
      
      // Уведомляем через WebSocket
      await notifyTimerUpdate(req.user.id);
      
      res.json({ session: updatedSession });
    } catch (error) {
      console.error('Ошибка остановки таймера:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}
