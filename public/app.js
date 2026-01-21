// Глобальное состояние приложения
const state = {
  user: null,
  myTimer: {
    session: null,
    interval: null,
    remaining: 0
  },
  partner: {
    user: null,
    timer: null,
    task: null
  },
  tasks: [],
  ws: null
};

// Константы
const WORK_DURATION = 25 * 60; // 25 минут в секундах
const BREAK_DURATION = 5 * 60; // 5 минут в секундах
const CIRCUMFERENCE = 2 * Math.PI * 90; // Длина окружности для прогресс-бара

/**
 * Инициализация приложения
 */
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initApp();
  checkAuth();
});

/**
 * Проверка аутентификации
 */
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.ok) {
      const data = await response.json();
      state.user = data.user;
      showApp();
      await loadInitialData();
      connectWebSocket();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error('Ошибка проверки auth:', error);
    showLogin();
  }
}

/**
 * Инициализация экрана входа
 */
function initLogin() {
  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inviteCode = document.getElementById('inviteCodeInput').value.trim();
    const name = document.getElementById('nameInput').value.trim();

    if (!inviteCode || !name) {
      alert('Заполните все поля');
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode, name })
      });

      if (response.ok) {
        const data = await response.json();
        state.user = data.user;
        showApp();
        await loadInitialData();
        connectWebSocket();
      } else {
        const error = await response.json();
        alert(error.error || 'Ошибка входа');
      }
    } catch (error) {
      console.error('Ошибка входа:', error);
      alert('Ошибка подключения к серверу');
    }
  });
}

/**
 * Инициализация основного приложения
 */
function initApp() {
  // Выход
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    state.user = null;
    if (state.ws) {
      state.ws.close();
    }
    showLogin();
  });

  // Управление задачами
  document.getElementById('addTaskBtn').addEventListener('click', addTask);
  document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addTask();
    }
  });

  // Управление таймером
  document.getElementById('startTimerBtn').addEventListener('click', startTimer);
  document.getElementById('pauseTimerBtn').addEventListener('click', pauseTimer);
  document.getElementById('stopTimerBtn').addEventListener('click', stopTimer);
}

/**
 * Загрузка начальных данных
 */
async function loadInitialData() {
  await Promise.all([
    loadTasks(),
    loadMyTimer(),
    loadPartnerState()
  ]);
}

/**
 * Загрузка задач
 */
async function loadTasks() {
  try {
    const response = await fetch('/api/tasks');
    if (response.ok) {
      const data = await response.json();
      state.tasks = data.tasks;
      renderTasks();
      updateActiveTaskDisplay();
    }
  } catch (error) {
    console.error('Ошибка загрузки задач:', error);
  }
}

/**
 * Загрузка состояния моего таймера
 */
async function loadMyTimer() {
  try {
    const response = await fetch('/api/timer');
    if (response.ok) {
      const data = await response.json();
      state.myTimer.session = data.session;
      updateMyTimerDisplay();
      startTimerInterval();
    }
  } catch (error) {
    console.error('Ошибка загрузки таймера:', error);
  }
}

/**
 * Загрузка состояния партнёра
 */
async function loadPartnerState() {
  try {
    const response = await fetch('/api/partner/state');
    if (response.ok) {
      const data = await response.json();
      if (data.partner) {
        state.partner.user = data.partner;
        state.partner.timer = data.partner.timerSession;
        state.partner.task = data.partner.activeTask;
        updatePartnerDisplay();
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки партнёра:', error);
  }
}

/**
 * Подключение WebSocket
 */
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('✅ WebSocket подключён');
    // Запрашиваем текущее состояние
    state.ws.send(JSON.stringify({ type: 'state:request' }));
  };

  state.ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWebSocketMessage(message);
  };

  state.ws.onerror = (error) => {
    console.error('WebSocket ошибка:', error);
  };

  state.ws.onclose = () => {
    console.log('❌ WebSocket отключён');
    // Переподключение через 3 секунды
    setTimeout(() => {
      if (state.user) {
        connectWebSocket();
      }
    }, 3000);
  };

  // Heartbeat
  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

/**
 * Обработка сообщений WebSocket
 */
function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'user:state':
      // Обновляем состояние партнёра
      if (message.userId !== state.user.id) {
        state.partner.user = message.data.user;
        state.partner.timer = message.data.timerSession;
        state.partner.task = message.data.activeTask;
        updatePartnerDisplay();
      } else {
        // Обновляем своё состояние
        state.myTimer.session = message.data.timerSession;
        updateMyTimerDisplay();
      }
      break;

    case 'pong':
      // Heartbeat ответ
      break;

    default:
      console.log('Неизвестное сообщение:', message);
  }
}

/**
 * Добавление задачи
 */
async function addTask() {
  const input = document.getElementById('newTaskInput');
  const title = input.value.trim();

  if (!title) return;

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });

    if (response.ok) {
      const data = await response.json();
      state.tasks.push(data.task);
      renderTasks();
      input.value = '';
    }
  } catch (error) {
    console.error('Ошибка создания задачи:', error);
    alert('Ошибка создания задачи');
  }
}

/**
 * Активация задачи
 */
async function activateTask(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/activate`, {
      method: 'POST'
    });

    if (response.ok) {
      const data = await response.json();
      // Обновляем состояние задач
      state.tasks.forEach(task => {
        task.is_active = task.id === taskId ? 1 : 0;
      });
      renderTasks();
      updateActiveTaskDisplay();
    }
  } catch (error) {
    console.error('Ошибка активации задачи:', error);
  }
}

/**
 * Удаление задачи
 */
async function deleteTask(taskId) {
  if (!confirm('Удалить задачу?')) return;

  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      state.tasks = state.tasks.filter(task => task.id !== taskId);
      renderTasks();
      updateActiveTaskDisplay();
    }
  } catch (error) {
    console.error('Ошибка удаления задачи:', error);
  }
}

/**
 * Отображение списка задач
 */
function renderTasks() {
  const container = document.getElementById('tasksList');
  container.innerHTML = '';

  state.tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = `task-item ${task.is_active ? 'active' : ''}`;
    item.innerHTML = `
      <span class="task-item-title">${escapeHtml(task.title)}</span>
      <div class="task-item-actions">
        <button class="btn-icon" onclick="activateTask('${task.id}')" title="Активировать">
          ✓
        </button>
        <button class="btn-icon" onclick="deleteTask('${task.id}')" title="Удалить">
          ×
        </button>
      </div>
    `;
    container.appendChild(item);
  });
}

/**
 * Обновление отображения активной задачи
 */
function updateActiveTaskDisplay() {
  const activeTask = state.tasks.find(task => task.is_active);
  const titleEl = document.getElementById('activeTaskTitle');
  titleEl.textContent = activeTask ? activeTask.title : '—';
}

/**
 * Запуск таймера
 */
async function startTimer() {
  // Если таймер на паузе, возобновляем его
  if (state.myTimer.session?.status === 'paused') {
    await resumeTimer();
    return;
  }

  const workDuration = parseInt(document.getElementById('workDuration').value) * 60;
  const breakDuration = parseInt(document.getElementById('breakDuration').value) * 60;
  
  // Определяем фазу на основе текущего состояния
  let phase = 'work';
  let duration = workDuration;
  
  if (state.myTimer.session) {
    if (state.myTimer.session.phase === 'work' && state.myTimer.session.status === 'stopped') {
      phase = 'work';
      duration = workDuration;
    } else if (state.myTimer.session.phase === 'work') {
      phase = 'break';
      duration = breakDuration;
    } else {
      phase = 'work';
      duration = workDuration;
    }
  }

  try {
    const response = await fetch('/api/timer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, durationSeconds: duration })
    });

    if (response.ok) {
      const data = await response.json();
      state.myTimer.session = data.session;
      updateMyTimerDisplay();
      startTimerInterval();
      updateTimerControls();
    }
  } catch (error) {
    console.error('Ошибка запуска таймера:', error);
  }
}

/**
 * Пауза таймера
 */
async function pauseTimer() {
  try {
    const response = await fetch('/api/timer/pause', {
      method: 'POST'
    });

    if (response.ok) {
      const data = await response.json();
      state.myTimer.session = data.session;
      stopTimerInterval();
      updateTimerControls();
    }
  } catch (error) {
    console.error('Ошибка паузы таймера:', error);
  }
}

/**
 * Возобновление таймера
 */
async function resumeTimer() {
  try {
    const response = await fetch('/api/timer/resume', {
      method: 'POST'
    });

    if (response.ok) {
      const data = await response.json();
      state.myTimer.session = data.session;
      startTimerInterval();
      updateTimerControls();
    }
  } catch (error) {
    console.error('Ошибка возобновления таймера:', error);
  }
}

/**
 * Остановка таймера
 */
async function stopTimer() {
  try {
    const response = await fetch('/api/timer/stop', {
      method: 'POST'
    });

    if (response.ok) {
      const data = await response.json();
      state.myTimer.session = data.session;
      stopTimerInterval();
      updateMyTimerDisplay();
      updateTimerControls();
    }
  } catch (error) {
    console.error('Ошибка остановки таймера:', error);
  }
}

/**
 * Запуск интервала обновления таймера
 */
function startTimerInterval() {
  stopTimerInterval();
  
  state.myTimer.interval = setInterval(() => {
    updateMyTimerDisplay();
    
    // Проверяем, не закончился ли таймер
    if (state.myTimer.remaining <= 0 && state.myTimer.session?.status === 'running') {
      stopTimer();
      alert(`Время ${state.myTimer.session.phase === 'work' ? 'работы' : 'перерыва'} закончилось!`);
    }
  }, 100);
}

/**
 * Остановка интервала таймера
 */
function stopTimerInterval() {
  if (state.myTimer.interval) {
    clearInterval(state.myTimer.interval);
    state.myTimer.interval = null;
  }
}

/**
 * Обновление отображения моего таймера
 */
function updateMyTimerDisplay() {
  if (!state.myTimer.session) return;

  const session = state.myTimer.session;
  const now = Date.now();

  if (session.status === 'running' && session.start_time) {
    const elapsed = Math.floor((now - session.start_time) / 1000);
    state.myTimer.remaining = Math.max(0, session.duration_seconds - elapsed);
  } else if (session.status === 'paused') {
    // Остаётся то же значение
  } else {
    state.myTimer.remaining = session.duration_seconds;
  }

  const minutes = Math.floor(state.myTimer.remaining / 60);
  const seconds = Math.floor(state.myTimer.remaining % 60);
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  document.getElementById('myTimerTime').textContent = timeStr;
  
  const phaseText = session.phase === 'work' ? 'Работа' : 'Перерыв';
  document.getElementById('myTimerPhase').textContent = phaseText;

  // Обновляем прогресс-бар
  const progress = session.duration_seconds > 0 
    ? (state.myTimer.remaining / session.duration_seconds) * CIRCUMFERENCE
    : CIRCUMFERENCE;
  const offset = CIRCUMFERENCE - progress;
  document.getElementById('myTimerProgress').style.strokeDashoffset = offset;

  updateTimerControls();
}

/**
 * Обновление отображения таймера партнёра
 */
function updatePartnerDisplay() {
  if (!state.partner.user) {
    document.getElementById('partnerName').textContent = 'Ожидание партнёра...';
    document.getElementById('partnerTaskTitle').textContent = '—';
    document.getElementById('partnerTimerTime').textContent = '—';
    document.getElementById('partnerTimerPhase').textContent = '—';
    return;
  }

  document.getElementById('partnerName').textContent = state.partner.user.name;

  if (state.partner.task) {
    document.getElementById('partnerTaskTitle').textContent = state.partner.task.title;
  } else {
    document.getElementById('partnerTaskTitle').textContent = '—';
  }

  if (state.partner.timer) {
    const timer = state.partner.timer;
    const now = Date.now();

    let remaining = 0;
    if (timer.status === 'running' && timer.start_time) {
      const elapsed = Math.floor((now - timer.start_time) / 1000);
      remaining = Math.max(0, timer.duration_seconds - elapsed);
    } else if (timer.status === 'paused') {
      // Вычисляем оставшееся время на основе последнего состояния
      if (timer.start_time) {
        const elapsed = Math.floor((now - timer.start_time) / 1000);
        remaining = Math.max(0, timer.duration_seconds - elapsed);
      } else {
        remaining = timer.duration_seconds;
      }
    } else {
      remaining = timer.duration_seconds;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    document.getElementById('partnerTimerTime').textContent = timeStr;
    
    const phaseText = timer.phase === 'work' ? 'Работа' : 'Перерыв';
    document.getElementById('partnerTimerPhase').textContent = phaseText;

    // Обновляем прогресс-бар
    const progress = timer.duration_seconds > 0 
      ? (remaining / timer.duration_seconds) * CIRCUMFERENCE
      : CIRCUMFERENCE;
    const offset = CIRCUMFERENCE - progress;
    document.getElementById('partnerTimerProgress').style.strokeDashoffset = offset;
  } else {
    document.getElementById('partnerTimerTime').textContent = '—';
    document.getElementById('partnerTimerPhase').textContent = '—';
  }
}

/**
 * Обновление кнопок управления таймером
 */
function updateTimerControls() {
  const session = state.myTimer.session;
  const startBtn = document.getElementById('startTimerBtn');
  const pauseBtn = document.getElementById('pauseTimerBtn');
  const stopBtn = document.getElementById('stopTimerBtn');

  if (!session || session.status === 'stopped') {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.textContent = '▶ Старт';
  } else if (session.status === 'running') {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    pauseBtn.textContent = '⏸ Пауза';
  } else if (session.status === 'paused') {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
    startBtn.textContent = '▶ Продолжить';
  }
}

/**
 * Показ экрана входа
 */
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
}

/**
 * Показ основного приложения
 */
function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('userName').textContent = state.user.name;
}

/**
 * Экранирование HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Экспорт функций для использования в onclick
window.activateTask = activateTask;
window.deleteTask = deleteTask;

// Периодическое обновление таймера партнёра
setInterval(() => {
  if (state.partner.timer) {
    updatePartnerDisplay();
  }
}, 100);
