const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
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

    next();
    
  } catch (err) {
    return res.status(401).json({
      message: "Token invalid/expired",
      code: "ACCESS_TOKEN_EXPIRED",
      error: err.message.includes('expired') ? 'expired' : 'invalid'
    });
  }
};
