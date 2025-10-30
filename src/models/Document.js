const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');
const Hospital = require('./Hospital');

const Document = sequelize.define('Document', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  type: { type: DataTypes.STRING, allowNull: false },
  original_name: { type: DataTypes.STRING, allowNull: false },
  file_data: { type: DataTypes.BLOB, allowNull: false },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  hospital_id: {
    type: DataTypes.INTEGER,
    references: { model: Hospital, key: 'id' },
    onDelete: 'CASCADE',
    allowNull: false
  }
}, {
  tableName: 'documents',
  timestamps: false
});

Document.belongsTo(Hospital, { foreignKey: 'hospital_id' });
Hospital.hasMany(Document, { foreignKey: 'hospital_id' });

module.exports = Document;
