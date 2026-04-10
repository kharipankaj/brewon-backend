process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

const { setAdminNamespace } = require('./services/adminSocketService');
const { getDashboardStats } = require('./services/adminAnalyticsService');
const { initColorTrading } = require('./ColorServer');
const connectDB = require('./db');
const GameEngine = require('./gameEngine');
const User = require('./models/User');
const { AviatorRound } = require('./models/Aviator-round');
const { Bet: AviatorBet } = require('./models/Aviator-bet');

const app = express();
const server = http.createServer(app);

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const parseOrigins = (...values) =>
  values
    .flatMap((value) => String(value || '').split(','))
    .map(normalizeOrigin)
    .filter(Boolean);

const allowedOrigins = Array.from(
  new Set(
    parseOrigins(
      process.env.FRONTEND_URL,
      process.env.CORS_ALLOWED_ORIGINS,
      'https://www.fuseconnects.in',
      'https://fuseconnects.in'
    )
  )
);

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.includes(normalizedOrigin);
};

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    console.error('[CORS] Blocked origin:', origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

console.log('[BOOT] Allowed origins:', allowedOrigins);

app.set('trust proxy', 1);
app.use(compression());
app.use(morgan('combined'));
app.use((req, res, next) => {
  console.log('[API]', req.method, req.originalUrl, {
    origin: req.headers.origin || 'n/a',
    ip: req.ip,
  });
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              scriptSrc: ["'self'"],
            },
          }
        : undefined,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.body) {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim().substring(0, 1000);
      }
    }
  }
  next();
});

const requiredEnv = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'MONGO_URL'];
const missingEnv = requiredEnv.filter((env) => !process.env[env]);

if (missingEnv.length > 0) {
  console.error('[BOOT] Missing env vars:', missingEnv);
  process.exit(1);
}

const io = new Server(server, {
  path: '/socket.io',
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
});

let engine = null;

function startGame() {
  if (engine?.isRunning) {
    console.warn('[Aviator] Game engine already running - skipping duplicate start');
    return;
  }

  engine = new GameEngine(io, User, AviatorRound, AviatorBet);
  engine.start();
}

io.use(async (socket, next) => {
  console.log('[Socket] Connect attempt:', socket.id?.slice(0, 8), {
    origin: socket.handshake.headers.origin || 'n/a',
    transport: socket.conn.transport.name,
  });

  let token;

  try {
    token = socket.handshake.auth?.token;

    if (!token && socket.handshake.headers.cookie) {
      const cookies = socket.handshake.headers.cookie.split(';');
      const match = cookies.find((c) => c.trim().startsWith('accessToken='));
      if (match) {
        token = decodeURIComponent(match.split('=')[1]);
      }
    }

    if (!token) {
      console.error('[Socket] Missing token for', socket.id);
      return next(new Error('Unauthorized: no token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      userId: decoded.id || decoded.userId,
      username: decoded.username,
      role: decoded.role || 'user',
    };

    const dbUser = await User.findById(socket.user.userId).select('status').lean();
    if (!dbUser || dbUser.status !== 'active') {
      console.error('[Socket] Inactive user rejected:', socket.user.userId);
      return next(new Error('Unauthorized: user inactive'));
    }

    console.log('[Socket] Auth success:', socket.user.username, socket.id);
    next();
  } catch (err) {
    console.error('[Socket] Auth failed:', err.message, {
      socketId: socket.id,
      tokenPreview: token ? `${token.slice(0, 12)}...` : 'missing',
    });
    socket.user = null;
    next(new Error(`Authentication failed: ${err.message}`));
  }
});

io.on('connection', (socket) => {
  console.log('[Socket] Connected:', socket.id, {
    user: socket.user?.username,
    transport: socket.conn.transport.name,
  });

  socket.emit('user:connected', socket.user);

  if (engine) {
    socket.emit('game:state', engine.getState());
  }

  socket.on('bet:place', async (data, cb) => {
    console.log('[Aviator] bet:place', {
      socketId: socket.id,
      user: socket.user?.username,
      roundState: engine?.state,
      betAmount: data?.betAmount,
    });

    try {
      if (!engine) {
        return cb?.({ success: false, message: 'Game not ready' });
      }

      if (!socket.user) {
        return cb?.({ success: false, message: 'Not authenticated' });
      }

      const result = await engine.placeBet(socket, data);
      cb?.(result);
    } catch (error) {
      console.error('[Aviator] bet:place failed:', error);
      cb?.({ success: false, message: 'Bet placement failed' });
    }
  });

  socket.on('bet:cashout', async (data, cb) => {
    console.log('[Aviator] bet:cashout', {
      socketId: socket.id,
      user: socket.user?.username,
      roundState: engine?.state,
    });

    try {
      if (!engine) {
        return cb?.({ success: false, message: 'Game not ready' });
      }

      if (!socket.user) {
        return cb?.({ success: false, message: 'Not authenticated' });
      }

      const result = await engine.cashOut(socket, data);
      cb?.(result);
    } catch (error) {
      console.error('[Aviator] bet:cashout failed:', error);
      cb?.({ success: false, message: 'Cashout failed' });
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', socket.id, reason);
  });
});

const adminIo = io.of('/admin');
setAdminNamespace(adminIo);

adminIo.use(async (socket, next) => {
  try {
    let token = socket.handshake.auth?.token;

    if (!token && socket.handshake.headers?.cookie) {
      const cookies = socket.handshake.headers.cookie.split(';');
      const match = cookies.find((entry) => entry.trim().startsWith('accessToken='));
      if (match) {
        token = decodeURIComponent(match.split('=')[1]);
      }
    }

    if (!token) {
      return next(new Error('Unauthorized: no token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = decoded.role || 'user';

    if (!['super_admin', 'admin', 'staff', 'moderator'].includes(role)) {
      return next(new Error('Unauthorized: admin access required'));
    }

    socket.user = {
      userId: decoded.userId || decoded.id,
      username: decoded.username,
      role,
    };

    const dbUser = await User.findById(socket.user.userId).select('status role').lean();
    if (
      !dbUser ||
      dbUser.status !== 'active' ||
      !['super_admin', 'admin', 'staff', 'moderator'].includes(dbUser.role)
    ) {
      return next(new Error('Unauthorized: admin user inactive'));
    }

    console.log('[AdminSocket] Auth success:', socket.user.username);
    return next();
  } catch (error) {
    console.error('[AdminSocket] Auth failed:', error.message);
    return next(new Error(`Authentication failed: ${error.message}`));
  }
});

adminIo.on('connection', (socket) => {
  console.log('[AdminSocket] Connected:', socket.user.username);

  getDashboardStats()
    .then((stats) => {
      socket.emit('updateStats', stats);
    })
    .catch((error) => {
      console.error('[AdminSocket] Failed to send initial stats:', error.message);
    });

  socket.on('disconnect', (reason) => {
    console.warn('[AdminSocket] Disconnected:', socket.user.username, reason);
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Server running',
    uptimeSeconds: Math.round(process.uptime()),
    now: Date.now(),
  });
});

app.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'ok',
    now: Date.now(),
    uptimeSeconds: Math.round(process.uptime()),
    socketClients: io.engine.clientsCount,
    engineState: engine?.getState?.() || null,
  });
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/refer', require('./routes/refer'));
app.use('/refresh', require('./routes/refresh'));
app.use('/signup', require('./routes/signup'));
app.use('/profile', require('./routes/profile'));
app.use('/login', require('./routes/login'));
app.use('/aviator', require('./routes/aviator'));
app.use('/logout', require('./routes/logout'));
app.use('/color', require('./routes/colorTrading'));
app.use('/revenue', require('./routes/revenue'));
app.use('/wallet', require('./routes/wallet'));
app.use('/games', require('./routes/games'));

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Server error' });
});

const startServer = async () => {
  try {
    console.log('[BOOT] Connecting database...');
    await connectDB();
    console.log('[BOOT] Database connected');

    console.log('[BOOT] Initializing color trading namespaces...');
    initColorTrading(io, mongoose);
    console.log('[BOOT] Color trading ready');

    startGame();

    const port = Number(process.env.PORT || 5000);
    server.listen(port, () => {
      console.log(`[BOOT] Server running on port ${port}`);
    });
  } catch (err) {
    console.error('[BOOT] Server start failed:', err);
    process.exit(1);
  }
};

startServer();
