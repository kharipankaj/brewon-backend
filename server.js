// 🔥 GLOBAL ERROR HANDLERS
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED PROMISE:', err);
});

console.log("🚀 SERVER FILE LOADED");
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { setAdminNamespace } = require('./services/adminSocketService');
const { getDashboardStats } = require('./services/adminAnalyticsService');

const { initColorTrading } = require("./colorServer");

const connectDB = require('./db');

const GameEngine = require('./gameEngine');
const User = require('./models/User');
const { AviatorRound } = require('./models/Aviator-round');
const { Bet: AviatorBet } = require('./models/Aviator-bet');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://www.fuseconnects.in",
  "https://fuseconnects.in"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"), false);
  },
  credentials: true,
}));


const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ✅ SOCKET
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

// ✅ PRODUCTION MIDDLEWARE
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 req/user
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(compression());
app.use(morgan('combined'));
app.use(limiter);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
    },
  } : undefined,
}));
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.NODE_ENV === 'production' ? { secure: true } : undefined));

// ✅ SANITIZATION + PROD SEC
app.use((req, res, next) => {
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim().substring(0, 1000);
      }
    }
  }
  next();
});

// ✅ ENV CHECK
const requiredEnv = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'MONGO_URL'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  console.error('Missing env vars:', missingEnv);
  console.log('Create Backend/.env with all vars');
  process.exit(1);
}

// ✅ GAME ENGINE
let engine;

function startGame() {
  engine = new GameEngine(io, User, AviatorRound, AviatorBet);
  engine.start();
}

// ✅ SOCKET AUTH MIDDLEWARE - ENHANCED DEBUG LOGGING
io.use(async (socket, next) => {
  console.log('🔌 Socket connect attempt:', socket.id?.slice(0, 8));
  let token;

  try {
    token = socket.handshake.auth?.token;
    console.log('🔌 Token source:', token ? 'auth.token' : 'checking cookies');

    if (!token && socket.handshake.headers['cookie']) {
      const cookies = socket.handshake.headers['cookie'].split(';');
      const match = cookies.find(c => c.trim().startsWith('accessToken='));
      if (match) {
        token = decodeURIComponent(match.split('=')[1]);
        console.log('🔌 Token extracted from cookie');
      } else {
        console.log('🔌 No accessToken cookie found');
      }
    }

    if (!token) {
      console.log('❌ No token provided - blocking socket');
      return next(new Error('No token provided'));
    }

    if ((token.match(/\./g) || []).length !== 2) {
      console.log('❌ Invalid JWT format, dots:', (token.match(/\./g) || []).length);
      return next(new Error('Invalid token format'));
    }

    console.log('🔐 Verifying token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      userId: decoded.id || decoded.userId,
      username: decoded.username,
      role: decoded.role || 'user',
    };

    console.log('✅ Socket auth success:', socket.user.username, socket.user.userId?.slice(-4));

    // 🔒 DB VALIDATION - Check user exists and active
    try {
      const User = require('./models/User');
      const dbUser = await User.findById(socket.user.userId).select('status').lean();
      if (!dbUser || dbUser.status !== 'active') {
        console.log(`❌ Socket auth DB FAIL: userId ${socket.user.userId.slice(-4)} not found/active`);
        return next(new Error('User not found or inactive'));
      }
      console.log('✅ Socket DB validated:', socket.user.username);
    } catch (dbErr) {
      console.error('❌ Socket DB check failed:', dbErr.message);
      return next(new Error('User validation failed'));
    }

    next();

  } catch (err) {
    console.error('❌ Socket auth FAILED:', err.message);
    console.error('   Token preview:', token ? token.slice(0, 20) + '...' : 'MISSING');
    socket.user = null;
    next(new Error('Authentication failed: ' + err.message));
  }
});

// ✅ SOCKET EVENTS
io.on('connection', (socket) => {
  socket.emit('user:connected', socket.user);

  if (engine) {
    socket.emit('game:state', engine.getState());
  }

  socket.on('bet:place', async (data, cb) => {
    if (!engine) {
      return cb?.({ success: false, message: 'Game not ready' });
    }

    if (!socket.user) {
      return cb?.({ success: false, message: 'Not authenticated' });
    }

    const result = await engine.placeBet(socket, data);
    cb?.(result);
  });

  socket.on('bet:cashout', async (data, cb) => {
    if (!engine) {
      return cb?.({ success: false, message: 'Game not ready' });
    }

    if (!socket.user) {
      return cb?.({ success: false, message: 'Not authenticated' });
    }

    const result = await engine.cashOut(socket, data);
    cb?.(result);
  });

  socket.on('disconnect', () => { });
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
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = decoded.role || 'user';

    if (!['super_admin', 'admin', 'staff', 'moderator'].includes(role)) {
      return next(new Error('Admin access required'));
    }

    socket.user = {
      userId: decoded.userId || decoded.id,
      username: decoded.username,
      role,
    };

    // 🔒 ADMIN DB VALIDATION
    try {
      const User = require('./models/User');
      const dbUser = await User.findById(socket.user.userId).select('status role').lean();
      if (!dbUser || dbUser.status !== 'active' || !['super_admin', 'admin', 'staff', 'moderator'].includes(dbUser.role)) {
        console.log(`❌ Admin socket DB FAIL: ${socket.user.username}`);
        return next(new Error('Admin user not found or unauthorized'));
      }
    } catch (dbErr) {
      console.error('❌ Admin DB check failed:', dbErr.message);
      return next(new Error('Admin validation failed'));
    }

    return next();
  } catch (error) {
    return next(new Error(`Authentication failed: ${error.message}`));
  }
});

adminIo.on('connection', (socket) => {
  console.log(`[ADMIN] Admin connected: ${socket.user.username}`);

  getDashboardStats()
    .then((stats) => {
      socket.emit('updateStats', stats);
    })
    .catch(() => { });

  socket.on('disconnect', () => {
    console.log(`[ADMIN] Admin disconnected: ${socket.user.username}`);
  });
});


// ✅ ROUTES
app.get('/', (req, res) => {
  res.json({ message: 'Server running 🚀' });
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/refer', require('./routes/refer'));
app.use('/refresh', require('./routes/refresh'));
app.use('/signup', require('./routes/signup'));
app.use('/profile', require('./routes/profile'));
app.use('/login', require('./routes/login'));
app.use('/aviator', require('./routes/aviator'));
app.use('/logout', require('./routes/logout'));
app.use("/color", require("./routes/colorTrading"));
app.use('/revenue', require('./routes/revenue'));
app.use('/wallet', require('./routes/wallet'));
app.use('/games', require('./routes/games'));
// routes/ping.js
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'ok', time: Date.now() });
});


// ✅ 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// ✅ ERROR
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: 'Server error' });
});

const startServer = async () => {
  try {
    console.log("🔌 Connecting DB...");
    await connectDB();
    console.log("✅ DB Connected");

    console.log("🎯 Initializing Color Trading...");
    initColorTrading(io, mongoose);
    console.log("✅ Color Trading Ready");

    startGame();

    const PORT = process.env.PORT || 5000;

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error("💀 SERVER START FAILED:", err);
    process.exit(1);
  }
};

startServer();
