const AdminActivityLog = require('../models/AdminActivityLog');

async function logAdminActivity({
  adminId,
  targetUserId = null,
  action,
  module,
  description,
  metadata = {},
}) {
  if (!adminId || !action || !module) {
    return null;
  }

  return AdminActivityLog.create({
    adminId,
    targetUserId,
    action,
    module,
    description,
    metadata,
  });
}

module.exports = {
  logAdminActivity,
};
