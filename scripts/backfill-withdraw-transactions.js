const mongoose = require('mongoose');
const connectDB = require('../db');
const WithdrawRequest = require('../models/WithdrawRequest');
const Transaction = require('../models/Transaction');

async function backfill() {
  await connectDB();
  console.log('Connected to DB. Backfilling withdraw Transactions...');

  const paidWithdraws = await WithdrawRequest.find({ status: "paid" }).lean();
  console.log(`Found ${paidWithdraws.length} paid withdrawals to backfill.`);

  let created = 0;
  for (const w of paidWithdraws) {
    const exists = await Transaction.findOne({
      referenceId: `${w._id}:withdraw`,
      type: "withdraw"
    });
    if (!exists) {
      await Transaction.create({
        userId: w.userId,
        type: "withdraw",
        amount: w.amount,
        status: "paid",
        upiId: w.upiId,
        referenceId: `${w._id}:withdraw`,
        description: `Withdraw payout to ${w.upiId || 'UPI'}`,
        metadata: { withdrawRequestId: w._id.toString() }
      });
      created++;
    }
  }

  console.log(`✅ Backfill complete. Created ${created} new Transaction records.`);
  process.exit(0);
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
