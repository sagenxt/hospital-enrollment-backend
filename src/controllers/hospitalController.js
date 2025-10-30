const hospitalService = require('../services/hospitalService');

exports.createHospital = async (req, res) => {
  try {
    const result = await hospitalService.createHospital(req);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getHospitalsByStatus = async (req, res) => {
  try {
    const { status = 'new', page = 1, limit = 10 } = req.query;
    const result = await hospitalService.getHospitalsByStatus(status, parseInt(page), parseInt(limit));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateHospitalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    const updated = await hospitalService.updateHospitalStatus(id, status);
    if (updated) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Hospital not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDocumentsByHospitalId = async (req, res) => {
  try {
    const { id } = req.params;
    const documents = await hospitalService.getDocumentsByHospitalId(id);
    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
