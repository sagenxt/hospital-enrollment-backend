const Hospital = require('../models/Hospital');
const Document = require('../models/Document');
const sequelize = require('../models/sequelize');

exports.insertHospital = async (mainDetails, metadata, options = {}) => {
  // options can include { transaction }
  const hospital = await Hospital.create({ ...mainDetails, metadata }, options);
  return hospital.id;
};

exports.insertDocument = async (type, originalName, hospitalId, fileBuffer, options = {}) => {
  const document = await Document.create({
    type,
    original_name: originalName,
    hospital_id: hospitalId,
    file_data: fileBuffer
  }, options);
  return {
    id: document.id,
    type: document.type,
    original_name: document.original_name
  };
};

// Return underlying sequelize instance so services can start transactions
exports.getDb = () => sequelize;

exports.getHospitalsByStatus = async (status, page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  const { count, rows } = await Hospital.findAndCountAll({
    where: { status },
    order: [['createdAt', 'DESC']],
    offset,
    limit,
    attributes: { exclude: ['metadata'] }
  });
  return {
    hospitals: rows,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit)
    }
  };
};

exports.updateHospitalStatus = async (id, status) => {
  const [updated] = await Hospital.update({ status }, { where: { id } });
  return updated > 0;
};

exports.getDocumentsByHospitalId = async (hospitalId) => {
  // Fetch all fields so we can include file_data for base64
  const docs = await Document.findAll({
    where: { hospital_id: hospitalId },
    attributes: ['id', 'type', 'original_name', 'createdAt', 'file_data']
  });
  // Map to include base64
  return docs.map(doc => ({
    id: doc.id,
    type: doc.type,
    original_name: doc.original_name,
    createdAt: doc.createdAt,
    base64: doc.file_data ? doc.file_data.toString('base64') : null
  }));
};
