const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const Hospital = sequelize.define('Hospital', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  city: DataTypes.STRING,
  address: DataTypes.TEXT,
  telephone: DataTypes.STRING,
  mobile: DataTypes.STRING,
  fax: DataTypes.STRING,
  email: DataTypes.STRING,
  superintendent_name: DataTypes.STRING,
  superintendent_contact: DataTypes.STRING,
  superintendent_email: DataTypes.STRING,
  superintendent_phone: DataTypes.STRING,
  metadata: DataTypes.JSONB,
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'new'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'hospitals',
  timestamps: false
});

module.exports = Hospital;
