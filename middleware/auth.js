const jwt = require("jsonwebtoken");

module.exports = async function (req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const token = req.cookies?.accessToken || bearerToken;

    if (!token) {
      return res.status(401).json({
        message: "No access token provided",
        code: "NO_TOKEN"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const resolvedUserId = decoded.userId || decoded.id;

    req.user = {
      userId: resolvedUserId,
      id: resolvedUserId,
      username: decoded.username,
      role: decoded.role || 'user',
    };

// 🔍 DB VALIDATION: Verify user exists and is active (with error handling)
    try {
      const User = require('../models/User');
      const dbUser = await User.findById(resolvedUserId).select('status').lean();
      if (!dbUser || dbUser.status !== 'active') {
        console.warn(`[AUTH] User validation failed: ${resolvedUserId.slice(-4)}`);
        return res.status(404).json({
          message: 'User not found or inactive',
          code: 'USER_NOT_FOUND'
        });
      }
      console.log(`[AUTH] User validated: ${req.user.username}`);
    } catch (dbErr) {
      console.error(`[AUTH] DB validation error for ${resolvedUserId.slice(-4)}:`, dbErr.message);
      return res.status(503).json({
        message: 'Service temporarily unavailable',
        code: 'DB_TEMP_ERROR'
      });
    }

    next();
    
  } catch (err) {
    return res.status(401).json({
      message: "Token invalid/expired",
      code: "ACCESS_TOKEN_EXPIRED",
      error: err.message.includes('expired') ? 'expired' : 'invalid'
    });
  }
};
