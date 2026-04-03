const auth = require('./auth');

const DEFAULT_ALLOWED_ROLES = ['super_admin', 'admin', 'staff', 'moderator'];

function adminAuth(allowedRoles = DEFAULT_ALLOWED_ROLES) {
  return (req, res, next) => {
    auth(req, res, () => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
          code: 'FORBIDDEN',
        });
      }

      return next();
    });
  };
}

module.exports = adminAuth;
