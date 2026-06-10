const Produk = require('../models/Produk');

// GET semua produk
exports.getAllProduk = async (req, res) => {
  const produk = await Produk.find()
    .populate('kategori', 'name')
    .populate('createdBy', 'name');
  res.json(produk);
};

// POST tambah produk
exports.createProduk = async (req, res) => {
  const { name, deskripsi, harga, qty, kategori } = req.body;

  const produk = await Produk.create({
    name,
    deskripsi,
    harga,
    qty,
    kategori,
    createdBy: req.user._id
  });

  res.status(201).json(produk);
};

// PUT update produk
exports.updateProduk = async (req, res) => {
  const produk = await Produk.findById(req.params.id);
  if (!produk) return res.status(404).json({ message: 'Produk tidak ditemukan' });

  const { name, deskripsi, harga, qty, kategori } = req.body;

  produk.name = name || produk.name;
  produk.deskripsi = deskripsi || produk.deskripsi;
  produk.harga = harga || produk.harga;
  produk.qty = qty ?? produk.qty;
  produk.kategori = kategori || produk.kategori;

  await produk.save();
  res.json(produk);
};

// DELETE produk
exports.deleteProduk = async (req, res) => {
  const produk = await Produk.findById(req.params.id);
  if (!produk) return res.status(404).json({ message: 'Produk tidak ditemukan' });

  await produk.deleteOne();
  res.json({ message: 'Produk dihapus' });
};
