require('dotenv').config();
const express = require('express');
const sequelize = require('./src/models/sequelize');
const hospitalRoutes = require('./src/routes/hospital');

const app = express();
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
