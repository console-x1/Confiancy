const fs = require("fs");
const colors = require("colors");
const express = require('express')
const rateLimit = require('express-rate-limit');
const app = express()
require('dotenv').config();
const port = process.env.PORT
const path = require('path');
const cookieParser = require('cookie-parser')

app.listen(port, () => {
    console.log(`Serveur démarré sur le port ${port}`.green);
});

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { error: "Trop de requêtes. Réessaie plus tard." },
    standardHeaders: true,
    legacyHeaders: true,
});

app.use(express.json());
app.use(cookieParser()); 
app.use(express.urlencoded({ extended: true }));
app.use(express.static('./Web/public'));
app.set('views', path.join(__dirname, 'Web'));
app.set('view engine', 'ejs');
app.use('/api/auth', require('./Web/routes/userRoutesAuth.js'));
app.use('/api/Oauth2', require('./Web/routes/Oauth2.js'))
app.use('/admin', require('./Web/routes/blacklistRoutes.js'));
app.use('/dashboard', require('./Web/routes/dashboardRoutes.js'));
app.use('/', require('./Web/routes/publicRoutes.js'));
app.set('trust proxy', false);
app.use(limiter);

// GESTION DES ERREURS :
const erreurs = {
    // 1xx : Information
    100: "Continuer",
    101: "Changement de protocole",
    102: "Traitement en cours",
    103: "Hints précoces",

    // 2xx : Succès (pas vraiment des erreurs mais pour référence)
    200: "OK",
    201: "Créé",
    202: "Accepté",
    203: "Informations non autoritatives",
    204: "Aucun contenu",
    205: "Réinitialiser le contenu",
    206: "Contenu partiel",
    207: "Multi-statuts",
    208: "Déjà signalé",
    226: "IM utilisé",

    // 3xx : Redirections
    300: "Choix multiples",
    301: "Déplacé de façon permanente",
    302: "Trouvé (Redirection temporaire)",
    303: "Voir autre",
    304: "Non modifié",
    305: "Utiliser un proxy",
    307: "Redirection temporaire",
    308: "Redirection permanente",

    // 4xx : Erreurs client
    400: "Requête invalide",
    401: "Non autorisé",
    402: "Paiement requis",
    403: "Accès interdit",
    404: "Page non trouvée",
    405: "Méthode non autorisée",
    406: "Non acceptable",
    407: "Authentification proxy requise",
    408: "Délai d'attente dépassé",
    409: "Conflit",
    410: "Disparu",
    411: "Longueur requise",
    412: "Échec de précondition",
    413: "Charge utile trop grande",
    414: "URI trop longue",
    415: "Type de média non supporté",
    416: "Plage demandée non satisfaisable",
    417: "Échec de l'attente",
    418: "Je suis une théière ☕",
    421: "Requête mal dirigée",
    422: "Entité non traitable",
    423: "Verrouillé",
    424: "Dépendance échouée",
    425: "Trop tôt",
    426: "Mise à jour requise",
    428: "Précondition requise",
    429: "Trop de requêtes",
    431: "Champs d'en-tête trop grands",
    451: "Indisponible pour des raisons légales",

    // 5xx : Erreurs serveur
    500: "Erreur interne du serveur",
    501: "Non implémenté",
    502: "Mauvaise passerelle",
    503: "Service indisponible",
    504: "Délai d'attente de la passerelle dépassé",
    505: "Version HTTP non supportée",
    506: "Négociation de contenu variante",
    507: "Stockage insuffisant",
    508: "Boucle détectée",
    510: "Non étendu",
    511: "Authentification réseau requise"
};

app.use((req, res) => {
    const code = res.statusCode >= 400 ? res.statusCode : 404;
    const description = erreurs[code] || "Erreur inconnue";

    res.status(code).render('public/erreur', { code, description });
});