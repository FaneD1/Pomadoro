import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from '../database.js';
import { requireAuth } from './auth.js';
import { notifyTaskUpdate } from '../websocket.js';

/**
 * Настройка маршрутов для работы с задачами
 */
export function setupTaskRoutes(app) {
  // Получить все задачи пользователя
  app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
      const tasks = await dbAll(
        'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id]
      );

      res.json({ tasks });
    } catch (error) {
      console.error('Ошибка получения задач:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Создать новую задачу
  app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
      const { title } = req.body;

      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Название задачи обязательно' });
      }

      const taskId = uuidv4();
      await dbRun(
        'INSERT INTO tasks (id, user_id, title, is_active) VALUES (?, ?, ?, 0)',
        [taskId, req.user.id, title.trim()]
      );

      const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [taskId]);
      
      // Уведомляем через WebSocket
      await notifyTaskUpdate(req.user.id);
      
      res.json({ task });
    } catch (error) {
      console.error('Ошибка создания задачи:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Активировать задачу (делает её активной, деактивирует остальные)
  app.post('/api/tasks/:taskId/activate', requireAuth, async (req, res) => {
    try {
      const { taskId } = req.params;

      // Проверяем, что задача принадлежит пользователю
      const task = await dbGet('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);

      if (!task) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }

      // Деактивируем все задачи пользователя
      await dbRun('UPDATE tasks SET is_active = 0 WHERE user_id = ?', [req.user.id]);

      // Активируем выбранную задачу
      await dbRun('UPDATE tasks SET is_active = 1 WHERE id = ?', [taskId]);

      const activeTask = await dbGet('SELECT * FROM tasks WHERE id = ?', [taskId]);
      
      // Уведомляем через WebSocket
      await notifyTaskUpdate(req.user.id);
      
      res.json({ task: activeTask });
    } catch (error) {
      console.error('Ошибка активации задачи:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Удалить задачу
  app.delete('/api/tasks/:taskId', requireAuth, async (req, res) => {
    try {
      const { taskId } = req.params;

      const task = await dbGet('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);

      if (!task) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }

      await dbRun('DELETE FROM tasks WHERE id = ?', [taskId]);
      
      // Уведомляем через WebSocket
      await notifyTaskUpdate(req.user.id);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка удаления задачи:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}
