import { dbGet } from '../database.js';
import { requireAuth } from './auth.js';

/**
 * Настройка маршрутов для получения информации о партнёре
 */
export function setupPartnerRoutes(app) {
  // Получить состояние партнёра (таймер + активная задача)
  app.get('/api/partner/state', requireAuth, async (req, res) => {
    try {
      // Находим партнёра в той же комнате
      const partner = await dbGet(
        'SELECT * FROM users WHERE room_id = ? AND id != ? LIMIT 1',
        [req.user.room_id, req.user.id]
      );

      if (!partner) {
        return res.json({ partner: null });
      }

      // Получаем активную задачу партнёра
      const activeTask = await dbGet(
        'SELECT * FROM tasks WHERE user_id = ? AND is_active = 1',
        [partner.id]
      );

      // Получаем текущую сессию таймера партнёра
      const timerSession = await dbGet(
        'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [partner.id]
      );

      res.json({
        partner: {
          id: partner.id,
          name: partner.name,
          activeTask: activeTask || null,
          timerSession: timerSession || null
        }
      });
    } catch (error) {
      console.error('Ошибка получения состояния партнёра:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}
