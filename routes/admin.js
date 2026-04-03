const express = require('express');

const adminController = require('../controllers/adminController');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

router.get('/me', adminAuth(), adminController.getMe);
router.get('/dashboard', adminAuth(), adminController.getDashboard);

router.get('/users', adminAuth(), adminController.getUsers);
router.post('/users', adminAuth(['super_admin', 'admin']), adminController.createUser);
router.put('/users/:id', adminAuth(['super_admin', 'admin']), adminController.updateUser);
router.post('/users/:id/ban', adminAuth(['super_admin', 'admin']), adminController.toggleBan);
router.delete('/users/:id', adminAuth(['super_admin', 'admin']), adminController.deleteUser);

router.get('/transactions', adminAuth(), adminController.getTransactions);
router.get('/deposit-requests', adminAuth(), adminController.getDepositRequests);
router.post('/deposit-requests/:id/approve', adminAuth(['super_admin', 'admin']), adminController.approveDepositRequest);
router.post('/deposit-requests/:id/reject', adminAuth(['super_admin', 'admin']), adminController.rejectDepositRequest);
router.post('/withdraw/:id/approve', adminAuth(['super_admin', 'admin']), adminController.approveWithdraw);
router.post('/withdraw/:id/reject', adminAuth(['super_admin', 'admin']), adminController.rejectWithdraw);

router.get('/analytics', adminAuth(), adminController.getAnalytics);

module.exports = router;
