const express = require("express");
const authController = require("../controllers/authController-fixed.js");

const router = express.Router();

router.post("/", authController.signup);

module.exports = router;
