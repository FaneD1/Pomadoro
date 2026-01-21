import { dbGet } from './database.js';
import { URL } from 'url';

// Хранилище активных WebSocket соединений
// Структура: { userId: ws }
const connections = new Map();

// Хранилище комнат и пользователей
// Структура: { roomId: Set<userId> }
const rooms = new Map();

/**
 * Настройка WebSocket сервера для realtime синхронизации
 */
export function setupWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    // Получаем userId из cookie
    const cookies = parseCookies(req.headers.cookie || '');
    const userId = cookies.userId;

    if (!userId) {
      ws.close(1008, 'Не авторизован');
      return;
    }

    // Проверяем пользователя в БД
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      ws.close(1008, 'Пользователь не найден');
      return;
    }

    // Сохраняем соединение
    connections.set(userId, ws);

    // Добавляем пользователя в комнату
    if (!rooms.has(user.room_id)) {
      rooms.set(user.room_id, new Set());
    }
    rooms.get(user.room_id).add(userId);

    console.log(`✅ WebSocket подключён: ${user.name} (${userId})`);

    // Отправляем начальное состояние
    await sendUserState(userId, user.room_id);

    // Обработка сообщений от клиента
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await handleMessage(userId, data);
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
      }
    });

    // Обработка отключения
    ws.on('close', () => {
      connections.delete(userId);
      if (rooms.has(user.room_id)) {
        rooms.get(user.room_id).delete(userId);
      }
      console.log(`❌ WebSocket отключён: ${user.name} (${userId})`);
    });

    // Обработка ошибок
    ws.on('error', (error) => {
      console.error('WebSocket ошибка:', error);
    });
  });
}

/**
 * Парсинг cookies из строки
 */
function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;

  cookieString.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Обработка сообщений от клиента
 */
async function handleMessage(userId, data) {
  const { type } = data;

  switch (type) {
    case 'ping':
      // Heartbeat для поддержания соединения
      sendToUser(userId, { type: 'pong' });
      break;

    case 'state:request':
      // Запрос текущего состояния
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
      if (user) {
        await sendUserState(userId, user.room_id);
      }
      break;

    default:
      console.log('Неизвестный тип сообщения:', type);
  }
}

/**
 * Отправка состояния пользователя всем в комнате
 */
async function sendUserState(userId, roomId) {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return;

  // Получаем активную задачу
  const activeTask = await dbGet(
    'SELECT * FROM tasks WHERE user_id = ? AND is_active = 1',
    [userId]
  );

  // Получаем текущую сессию таймера
  const timerSession = await dbGet(
    'SELECT * FROM timer_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  const state = {
    type: 'user:state',
    userId,
    data: {
      user: {
        id: user.id,
        name: user.name
      },
      activeTask: activeTask || null,
      timerSession: timerSession || null
    }
  };

  // Отправляем всем в комнате (включая самого пользователя)
  broadcastToRoom(roomId, state);
}

/**
 * Отправка сообщения конкретному пользователю
 */
function sendToUser(userId, message) {
  const ws = connections.get(userId);
  if (ws && ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(message));
  }
}

/**
 * Отправка сообщения всем пользователям в комнате
 */
function broadcastToRoom(roomId, message) {
  const userIds = rooms.get(roomId);
  if (!userIds) return;

  userIds.forEach(userId => {
    sendToUser(userId, message);
  });
}

/**
 * Уведомление о изменении таймера
 */
export async function notifyTimerUpdate(userId) {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (user) {
    await sendUserState(userId, user.room_id);
  }
}

/**
 * Уведомление о изменении задачи
 */
export async function notifyTaskUpdate(userId) {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (user) {
    await sendUserState(userId, user.room_id);
  }
}
