const mongoose = require("mongoose");
const ColorBetSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, required: true },
  roundId:  { type: Number, required: true },
  gameMode: { type: String, enum: ["wingo", "fastparity"], required: true },
  type:     { type: String, enum: ["color", "number", "size"], required: true },
  value:    { type: String, required: true },
  amount:   { type: Number, required: true, min: 10 },
  status:   { type: String, enum: ["pending", "won", "lost"], default: "pending" },
  payout:   { type: Number, default: 0 },
  profit:   { type: Number, default: 0 },
  result:   { number: Number, colors: [String], size: String },
}, { timestamps: true });
ColorBetSchema.index({ userId: 1, createdAt: -1 });
ColorBetSchema.index({ roundId: 1, gameMode: 1 });
module.exports = mongoose.model("ColorBet", ColorBetSchema);