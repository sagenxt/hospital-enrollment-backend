require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sequelize = require('./src/models/sequelize');
const hospitalRoutes = require('./src/routes/hospital');
const securityHeaders = require('./src/middleware/securityHeaders');

const app = express();
// Allow only specific origins
const allowedOrigins = [
  'https://eoi-application.vercel.app/',
  'http://localhost:3000',
];
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// Security headers to mitigate clickjacking and related risks
app.use(securityHeaders);
// Also handle preflight requests for all routes with the same cors options
app.options('*', cors(corsOptions));
app.use(express.json());

app.use('/hospitals', hospitalRoutes);

const PORT = process.env.PORT || 3000;

// Ensure Sequelize is synced and connected before starting the server
sequelize.sync()
  .then(() => {
    console.log('Database synced.');
    return sequelize.authenticate();
  })
  .then(() => {
    console.log('Database connected.');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
    process.exit(1);
  });
