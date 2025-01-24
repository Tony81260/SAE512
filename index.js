const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { InfluxDB, Point } = require('@influxdata/influxdb-client'); // Client InfluxDB

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configurer la connexion MySQL pour Alwaysdata (gestion des utilisateurs uniquement)
const db = mysql.createConnection({
    host: 'mysql-dossantos.alwaysdata.net', // Hôte MySQL Alwaysdata
    user: 'dossantos', // Identifiant utilisateur
    password: 'dbmdp512', // Mot de passe
    database: 'dossantos_r512_db' // Nom de la base de données
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connecté à MySQL sur Alwaysdata');
});

// Configurer la connexion à InfluxDB (pour enregistrer les pannes)
const influxDB = new InfluxDB({
    url: 'https://us-east-1-1.aws.cloud2.influxdata.com', // Remplacez par l'URL de votre InfluxDB
    token: 'cD5UbhjrCkPFTnWnI728qyTHXwsw-_Pwd301yAhqCs3dBzMZqItjn92JNpVrmr9tZUncRs_wykQw_9zgtsRTcg==', // Remplacez par votre token d'accès
});
const writeApi = influxDB.getWriteApi('23741d8d40efea1f', 'panne');
writeApi.useDefaultTags({ app: 'panne-management' }); // Tags par défaut

// Fonction pour générer un token aléatoire
function generateRandomToken() {
    return [...Array(32)]
        .map(() => Math.random().toString(36)[2])
        .join('');
}

// Fonction pour vérifier la validité du token
function tokenIsValid(token, callback) {
    const query = 'SELECT username FROM utilisateurs WHERE token = ?';
    db.query(query, [token], (err, results) => {
        if (err) {
            return callback(false);
        }
        callback(results.length > 0);
    });
}

app.get('/', (req, res) => {
    const authToken = req.cookies.authToken;

    // Vérifier la validité du token
    tokenIsValid(authToken, (isValid) => {
        if (isValid) {
            return res.status(200).redirect('/panne');
        }
        res.sendFile(path.join(__dirname, 'formulaire.html'), (err) => {
            if (err) {
                res.status(500).send(__dirname);
            }
        });
    });
});

// Route pour afficher la page de gestion des pannes
app.get('/panne', (req, res) => {
    const authToken = req.cookies.authToken;

    tokenIsValid(authToken, (isValid) => {
        if (isValid) {
            res.sendFile(path.join(__dirname, 'panne.html'), (err) => {
                if (err) res.status(500).send('Erreur interne');
            });
        } else {
            res.redirect('/');
        }
    });
});

// Route pour ajouter une panne dans InfluxDB
app.post('/add-panne', (req, res) => {
    const authToken = req.cookies.authToken;

    // Vérifier la validité du token
    tokenIsValid(authToken, (isValid) => {
        if (!isValid) {
            return res.status(403).redirect('/');
        }

        const panne = req.body.panne; // Type de panne
        const timestamp = req.body.timestamp; // Timestamp fourni

        // Créer un point pour InfluxDB
        const point = new Point('panne')
            .tag('type', panne) // Ajout du type de panne comme tag
            .floatField('count', 1) // Exemple : une panne est enregistrée
            .timestamp(new Date(timestamp)); // Utiliser le timestamp fourni

        // Écrire les données dans InfluxDB
        writeApi.writePoint(point);
        writeApi.flush() // Finaliser l'écriture des points
            .then(() => {
                console.log('Données écrites dans InfluxDB avec succès');
                return res.status(200).json({ message: 'Panne ajoutée avec succès' });
            })
            .catch((err) => {
                console.error('Erreur lors de l\'écriture dans InfluxDB', err);
                return res.status(500).json({ message: 'Erreur lors de l\'enregistrement dans InfluxDB' });
            });
    });
});

// Route pour l'authentification
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Vérification des identifiants dans la base de données
    const query = 'SELECT * FROM utilisateurs WHERE username = ? AND password = ?';
    db.query(query, [username, password], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Erreur serveur' });
        }

        if (results.length > 0) {
            // Identifiants valides : Générer un cookie
            const token = generateRandomToken();
            res.cookie('authToken', token, {
                httpOnly: true, // Plus sécurisé : interdit l'accès au cookie depuis JavaScript
                maxAge: 24 * 60 * 60 * 1000 // Expiration dans 24 heures
            });

            // Mettre à jour le token dans la base de données
            db.query('UPDATE utilisateurs SET token = ? WHERE username = ?', [token, username], (err, results) => {
                if (err) {
                    return res.status(500).json({ message: 'Erreur lors de la mise à jour du token' });
                }
            });

            return res.status(200).redirect('/panne');
        } else {
            return res.status(401).json({ message: 'Nom d’utilisateur ou mot de passe incorrect' });
        }
    });
});

// Route de déconnexion
app.get('/logout', (req, res) => {
    const authToken = req.cookies.authToken;

    if (!authToken) {
        return res.status(400).json({ message: 'Aucun token trouvé' });
    }

    // Supprimer le token de la base de données
    db.query('UPDATE utilisateurs SET token = NULL WHERE token = ?', [authToken], (err, result) => {
        if (err) {
            return res.status(500).json({ message: 'Erreur lors de la déconnexion' });
        }

        // Supprimer le cookie contenant le token
        res.clearCookie('authToken');
        return res.status(200).send('Déconnexion réussie');  // Répondre au client
    });
});

// Lancer le serveur sur le port 8100
app.listen(process.env.PORT || 8100, () => {
    console.log('API en cours d\'exécution sur le port 8100');
});
