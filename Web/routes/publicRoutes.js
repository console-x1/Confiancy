const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const path = require('path');
const db = require("../config/database");

const router = express.Router();

console.log('[INIT] - Start publicRoutes.js'.blue)

router.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/login.html"));
});
router.get("/register", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/register.html"));
})
router.get("/index", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
})

module.exports = router;
