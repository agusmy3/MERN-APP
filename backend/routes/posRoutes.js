const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const Outlet = require('../models/Outlet');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { canUseOutlet } = require('../helpers/posHelper');
const outletCtrl = require('../controllers/outletController');
const pos = require('../controllers/posController');

/** Outlet (/api/outlet): master standar; /dropdown cukup login (+ assigned = boleh dipakai user untuk POS) */
const outlet = express.Router();
outlet.get('/dropdown', protect, async (req, res) => {
  try {
    const list = await Outlet.find().select('_id code name isActive gudang').sort({ code: 1 }).lean();
    list.forEach((o) => { o.assigned = canUseOutlet(req, o._id); });
    return successResponse(res, list);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
outlet.get('/', protect, authorize('outlet', 'view'), outletCtrl.getOutlets);
outlet.get('/:id', protect, authorize('outlet', 'view'), outletCtrl.getOutlet);
outlet.post('/', protect, authorize('outlet', 'create'), outletCtrl.createOutlet);
outlet.put('/:id', protect, authorize('outlet', 'update'), outletCtrl.updateOutlet);
outlet.delete('/:id', protect, authorize('outlet', 'delete'), outletCtrl.deleteOutlet);

/**
 * Layar kasir (/api/pos): view = buka layar kasir; create = buka/tutup shift sendiri, kas masuk/keluar,
 * transaksi. Outlet harus ditugaskan ke user (User.outlets; Super Admin semua).
 */
const posRouter = express.Router();
posRouter.get('/context', protect, authorize('pos', 'view'), pos.getContext);
posRouter.get('/skus', protect, authorize('pos', 'view'), pos.searchSkus);
posRouter.post('/prices', protect, authorize('pos', 'view'), pos.prices);
posRouter.get('/sales/:id/receipt', protect, authorize('pos', 'view'), pos.getReceipt);
posRouter.post('/shift/open', protect, authorize('pos', 'create'), pos.openShift);
posRouter.post('/shift/cash', protect, authorize('pos', 'create'), pos.cashMove);
posRouter.post('/shift/close', protect, authorize('pos', 'create'), pos.closeShift);
posRouter.post('/sales', protect, authorize('pos', 'create'), pos.createSale);

/** Daftar shift (/api/pos-shift): view = semua shift & ringkasannya; update = tutup shift kasir lain */
const posShift = express.Router();
posShift.get('/', protect, authorize('posShift', 'view'), pos.getShifts);
posShift.get('/:id', protect, authorize('posShift', 'view'), pos.getShift);
posShift.post('/:id/close', protect, authorize('posShift', 'update'), pos.forceCloseShift);

module.exports = { outlet, pos: posRouter, posShift };
