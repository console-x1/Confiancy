# Confiancy

Confiancy est une application web Node.js/Express permettant de donner et recevoir des avis sur les utilisateurs — d'où son nom !  
Chaque utilisateur peut recevoir des notes/commentaires d'autres membres, ce qui favorise la confiance au sein de la plateforme.

## Fonctionnalités principales
- Authentification email/mot de passe (JWT via cookie HttpOnly)
- Vérification d'email par code (envoi via SMTP)
- Connexion et liaison de comptes via OAuth2 (Discord & GitHub)
- Tableau de bord protégé, gestion du profil et avis entre utilisateurs
- Notation et dépôt d'avis sur d'autres profils utilisateurs
- Limiteur de débit global, gestion des cookies, fichiers statiques et rendu EJS
- Tâche CRON pour la purge automatique de la blacklist

## Pile technique
- Node.js (CommonJS), Express 5
- EJS pour les vues
- SQLite3 pour la base de données (fichier `Web/config/database.sqlite`)
- JWT (`jsonwebtoken`), `express-session` non utilisé directement ici (cookies JWT)
- `nodemailer` pour l'email, `node-cron` pour tâches planifiées

## Prérequis
- Node.js 18+
- Variables d’environnement (voir ci-dessous)

## Installation
```bash
npm install
```

## Configuration (.env)
Créer un fichier `.env` à la racine avec au minimum:
```
PORT=3000
APP_NAME=Confiancy

# JWT
SECRET_KEY=remplacez_par_une_chaine_secrete
STATE_SECRET=etat_oauth2_discord
STATE2_SECRET=etat_oauth2_github

# SMTP
SMTP_HOST=smtp.exemple.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-utilisateur
SMTP_PASS=motdepasse

# Discord OAuth2
CLIENT_ID=...
CLIENT_SECRET=...

# GitHub OAuth2
GITHUB_CLIENT=...
GITHUB_SECRET=...
GITHUB_CLIENTprod=...
GITHUB_SECRETprod=...
```

## Lancer le projet
```bash
node index.js
```
Par défaut, l’app écoute sur `http://localhost:${PORT}`.

## Scripts utiles
Les scripts NPM ne sont pas encore définis. Exemples possibles à ajouter:
```json
"scripts": {
  "start": "node index.js",
  "dev": "nodemon index.js"
}
```

## Structure du projet
```
Confiancy/
├─ index.js                 # Point d’entrée Express
├─ Web/
│  ├─ public/               # Fichiers statiques (HTML/CSS/JS, images)
│  │  ├─ index.html         # Accueil (style dans public/css/index.css)
│  │  ├─ login.html         # Page de connexion
│  │  ├─ register.html      # Page d’inscription
│  │  ├─ css/               # Styles (login.css, register.css, profile.css, index.css)
│  │  └─ javascript/        # JS front (ex: auth.js)
│  ├─ login/                # Vues EJS (dashboard, verify-email, etc.)
│  ├─ routes/               # Routes Express (public, auth, dashboard, oauth2, ...) 
│  ├─ middleware/           # Middlewares (authMiddleware.js)
│  └─ config/               # DB SQLite, blacklist, etc.
└─ package.json
```

## À quoi servent les principaux fichiers/dossiers
- `index.js`: Initialise Express, charge les middlewares (`json`, `cookie-parser`, limiter), sert le statique `Web/public`, configure EJS, déclare les routes et démarre le serveur. Lance aussi une tâche CRON pour purger la blacklist.
- `Web/public/`: Contenu statique côté client.
  - `index.html`: page d’accueil.
  - `login.html`, `register.html`: formulaires d’authentification.
  - `css/`: styles spécifiques à chaque page (ex: `login.css`, `register.css`, `profile.css`, `index.css`).
  - `javascript/auth.js`: logique front d’auth (soumission, animations, etc.).
  - `media/`: images (logos, illustrations).
- `Web/login/`: Vues EJS pour les écrans authentifiés ou semi-authentifiés (dashboard, verify-email, delete-account, etc.).
- `Web/routes/`:
  - `publicRoutes.js`: sert `index.html`, `login.html`, `register.html` et routes publiques (profil public `GET /user/:id`).
  - `userRoutesAuth.js`: API auth (register/login, verify-email, update-password, delete-account). Gère l’emailing de codes, hash des mots de passe, et cookies JWT.
  - `dashboardRoutes.js`: routes protégées du tableau de bord (rendu EJS, avis de l’utilisateur, logout, reset password flow).
  - `Oauth2.js`: intégrations OAuth2 (Discord, GitHub) pour login/liaison de compte.
  - `blacklistRoutes.js`, `reviewRoutes.js`: administration blacklist et avis.
- `Web/middleware/authMiddleware.js`: vérifie le cookie JWT, hydrate `req.user` depuis la DB, et protège les routes (redirige vers `/login` si non authentifié).
- `Web/config/database.js`: initialisation SQLite (tables `password`, `users`, `avis`, `badges`) et export du handle `db`.
- `Web/config/blacklist.*`: gestion d’emails interdits (purge planifiée via CRON dans `index.js`).

## Endpoints principaux (aperçu)
- Public:
  - `GET /index` → `Web/public/index.html`
  - `GET /login` → `Web/public/login.html`
  - `GET /register` → `Web/public/register.html`
  - `GET /user/:id` → profil public (EJS)
- Auth API (`/api/auth`):
  - `POST /register`, `POST /login`, `POST /resend-code`, `POST /verify-email`, `POST /update-password`, `POST /sendResetPasswordCode`, `POST /delete-account`
- Dashboard (`/dashboard`): rendu EJS protégé; `GET /avis`, `GET /logout`, `GET /update-password`
- OAuth2 (`/api/Oauth2`): Discord (`/discord/*`) et GitHub (`/github`)

## Développement
- Lancer avec `node index.js` (ou ajouter un script `dev` avec nodemon).
- Les fichiers statiques sont dans `Web/public`. Les vues EJS sont dans `Web/login`.
- Pour changer le style de l’accueil, modifier `Web/public/css/index.css`.

## Contribuer
1. Forker le repo
2. Commits clairs (ex: `feat(index): améliore le style`)
3. PR vers `main` (cf. conventions du projet)

## Licence
Voir `LICENCE` à la racine.


