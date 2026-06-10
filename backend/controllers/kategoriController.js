const Kategori = require('../models/Kategori');

// GET semua kategori
exports.getAllKategori = async (req, res) => {
  const kategori = await Kategori.find().populate('createdBy', 'name');
  res.json(kategori);
};

exports.getKategori = async (req, res) => {
  try {
    console.log(req.query);
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = req.query.sortField || 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    let filter = {};

    if (search) {
      filter.$or = [
        {
          name: {
            $regex: search,
            $options: "i"
          }
        },
        {
          deskripsi: {
            $regex: search,
            $options: "i"
          }
        }
      ];
    }

    const totalData = await Kategori.countDocuments(filter);

    const data = await Kategori.find(filter)
      .populate('createdBy', 'name')
      .sort({
        [sortField]: sortOrder
      })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    res.json({
      data,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

// GET single kategori
exports.getSingleKategori = async (req, res) => {
  const kategori = await Kategori.findById(req.params.id).populate('createdBy', 'name');
  if (!kategori) return res.status(404).json({ message: 'Kategori tidak ditemukan' });
  res.json(kategori);
};

// POST tambah kategori
exports.createKategori = async (req, res) => {
  const kategori = await Kategori.create({
    name: req.body.name,
    deskripsi: req.body.deskripsi,
    createdBy: req.user._id,
  });
  res.status(201).json(kategori);
};

// PUT update kategori
exports.updateKategori = async (req, res) => {
  const kategori = await Kategori.findById(req.params.id);
  if (!kategori) return res.status(404).json({ message: 'Kategori tidak ditemukan' });

  kategori.name = req.body.name || kategori.name;
  kategori.deskripsi = req.body.deskripsi || kategori.deskripsi;
  await kategori.save();
  res.json(kategori);
};

// DELETE kategori
exports.deleteKategori = async (req, res) => {
  const kategori = await Kategori.findById(req.params.id);
  if (!kategori) return res.status(404).json({ message: 'Kategori tidak ditemukan' });

  await kategori.deleteOne();
  res.json({ message: 'Kategori dihapus' });
};
