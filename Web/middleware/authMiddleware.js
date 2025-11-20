const jwt = require('jsonwebtoken');
const colors = require('colors')

let db = require('../config/database');

const verifyToken = (req, res, next) => {
    req.user = req.user || {};

    const token = req.cookies.auth_token;

    if (!token) {
        console.log('[SAFE] - authMiddleware redirect - NO TOKEN'.yellow)
        return res.redirect(`${req.protocol}://${req.get('host')}/login`);
    }

    jwt.verify(token, process.env.SECRET_KEY, async (err, decoded) => {
        if (err) {
            console.log('[SAFE] - authMiddleware redirect - BAD TOKEN'.yellow)
            return res.redirect(`${req.protocol}://${req.get('host')}/login`);
        }

        req.user.id = decoded && decoded.id ? decoded.id : null;
        req.user.email = decoded && decoded.email ? decoded.email : null;

        try {

            const donnee = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM users WHERE userId = ?", [decoded.id], (err, user) => {
                    if (err) {
                        console.error("[USER] - Error fetching user data".red, err);
                        return reject(err);
                    }
                    resolve(user || null);
                });
            });

            const donneeLogin = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM password WHERE id = ? AND email = ?", [decoded.id, decoded.email], (err, user) => {
                    if (err) {
                        console.error("[USER] - Error fetching user password data".red, err);
                        return reject(err);
                    }
                    resolve(user || null);
                })
            });

            const badges = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM badges WHERE userId = ?", [decoded.id], (err, rows) => {
                    if (err) {
                        console.error("[USER] - Error fetching user badges data".red, err);
                        return reject(err);
                    }
                    resolve(rows || null);
                });
            });

            if (donneeLogin == null) return res.redirect(`${req.protocol}://${req.get('host')}/login`);

            req.user.username = donnee && donnee.username ? donnee.username : null;
            req.user.avatar = donnee && donnee.avatar ? donnee.avatar : null;

            req.user.timeCodeEmail = donneeLogin.timeCodeEmail;
            req.user.github = donneeLogin && donneeLogin.githubId   ? true : false
            req.user.discord = donneeLogin && donneeLogin.discordId ? true : false
            req.user.emailUpdateNote = donnee.emailUpdateNote == 1  ? true : false
            req.user.badges = { staff: badges?.staff, verify: badges?.verify, job: badges?.job, premium: badges?.premium }

            function long(str, len) {
                str = String(str);
                if (str.length <= len) return str.padEnd(len, ' ');
                return str.slice(-len);
            }

            const routeInfo = long(`${req.protocol}://${req.get('host')}${req.originalUrl}`, 55);

            if (routeInfo.includes('/api/')) return next()

            console.log(req.user.username ? `[SAFE] - ${routeInfo} - ${long(req.user.username, 20)} - ${req.user.email}`.green : `[SAFE] - ${routeInfo} - User ID: ${long(req.user.id, 20 - 'User ID: '.length)} - ${req.user.email}`.yellow)
            return next();

        } catch (e) {
            console.error('[AUTH] - authMiddleware caught error'.red, e);
            return res.redirect(`${req.protocol}://${req.get('host')}/login`);
        }
    });
};

module.exports = verifyToken;
