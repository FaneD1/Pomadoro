import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { initDatabase, getDatabase } from './backend/database.js';
import { setupAuthRoutes } from './backend/routes/auth.js';
import { setupTaskRoutes } from './backend/routes/tasks.js';
import { setupTimerRoutes } from './backend/routes/timer.js';
import { setupPartnerRoutes } from './backend/routes/partner.js';
import { setupWebSocket } from './backend/websocket.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Инициализация базы данных
await initDatabase();

// Маршруты
setupAuthRoutes(app);
setupTaskRoutes(app);
setupTimerRoutes(app);
setupPartnerRoutes(app);

// WebSocket сервер
setupWebSocket(wss);

// Запуск сервера
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📝 Используйте invite-код для входа`);
});
