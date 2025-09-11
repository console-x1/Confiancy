const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const path = require('path');
const db = require('../config/database.js');

const router = express.Router();

console.log('[INIT] - Start dashboardRoutes.js'.blue)

router.use(express.json());

router.get("/", verifyToken, async (req, res) => {
    if (req.user.username) res.render(path.join(__dirname, "../login/dashboard"), { baseUrl: `${req.protocol}://${req.get('host')}`, user: req.user });
    else res.render(path.join(__dirname, "../login/verify-email"), { email: req.user.email, timeCode: (((new Date() - Number(req.user.timeCodeEmail)) / 1000 ) / 60).toFixed(0) })
});

router.get("/verify-email", verifyToken, async (req, res) => {
    res.render(path.join(__dirname, "../login/verify-email"), { email: req.user.email, timeCode: (((new Date() - Number(req.user.timeCodeEmail)) / 1000 ) / 60).toFixed(0) })
})

module.exports = router;