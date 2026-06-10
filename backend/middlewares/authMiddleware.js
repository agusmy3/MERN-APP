const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token = req.headers.authorization;

  if (token && token.startsWith('Bearer ')) {
    try {
      token = token.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password'); // hapus password
      next();
    } catch (err) {
      res.status(401).json({ message: 'Token tidak valid' });
    }
  } else {
    res.status(401).json({ message: 'Tidak ada token' });
  }
};

module.exports = protect;
