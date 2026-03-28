const mongoose = require("mongoose");
const ColorRoundSchema = new mongoose.Schema({
  roundId:    { type: Number, required: true, unique: true },
  gameMode:   { type: String, enum: ["wingo", "fastparity"], required: true },
  result: {
    number: { type: Number, required: true },
    colors: [String],
    size:   String,
    hash:   String,
  },
  serverSeed:   { type: String, select: false },
  totalBets:    { type: Number, default: 0 },
  totalPayout:  { type: Number, default: 0 },
  bets: [{ type: mongoose.Schema.Types.ObjectId, ref: "ColorBet" }],
}, { timestamps: true });
module.exports = mongoose.model("ColorRound", ColorRoundSchema);