const Menu = require ('../models/Menu');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const { hasPermission, isValidResource } = require('../config/permissions');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

// resource tidak dikenal / kosong -> null (menu tanpa batasan izin)
const toResource = (value) => (isValidResource(value) ? value : null);

// urutan: null/kosong -> tidak diatur
const toOrder = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new HttpError('Order must be a whole number between 0 and 9999', 400);
  return n;
};

// urutan saudara di sidebar: order (yang kosong paling akhir), lalu nama
const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || String(a.menu).localeCompare(String(b.menu));

exports.getAllMenu = async (req, res) => {
  try {
    const menus = await Menu.find()
      .populate("parent_id")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .sort({ parent_id: 1 });

    return successResponse(
      res,
      menus
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

exports.getMenu = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = req.query.sortField || 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    let filter = {};

    if (search) {
      filter.menu = {
        $regex: search,
        $options: "i"
      }
    }

    const totalData = await Menu.countDocuments(filter);

    const dataMenu = await Menu.find(filter)
      .populate("parent_id")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .sort({
        [sortField]: sortOrder
      })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    const pagination = {
      dataMenu,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    };

    return successResponse(
      res,
      pagination
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

async function getMenuWithChildren(parentId = null) {
  const menus = (await Menu.find({ parent_id: parentId }).lean()).sort(byOrder);

  const withChildren = await Promise.all(
    menus.map(async (menu) => {
      const children = await getMenuWithChildren(menu._id);
      return {
        ...menu,
        children: children.length ? children : undefined
      };
    })
  );

  return withChildren;
}

async function getMenuHierarchy(parentId = null) {
  const menus = (await Menu.find({ parent_id: parentId }).lean()).sort(byOrder);

  const withChildren = await Promise.all(
    menus.map(async (menu) => {
      const children = await getMenuHierarchy(menu._id);
      return {
        ...menu,
        children: children.length ? children : undefined
      };
    })
  );

  return withChildren;
}

exports.getHierarchy = async (req, res) => {
  try {
    const tree = await getMenuWithChildren();
    return successResponse(
      res,
      tree
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

/**
 * Saring pohon menu sesuai izin user:
 * - menu dengan `resource` tampil jika user punya izin 'view' untuk resource itu
 * - menu tanpa `resource` yang punya route (mis. Dashboard, Appearance) tampil untuk semua user
 * - menu grup (tanpa route) tampil jika minimal satu anaknya tampil
 * - menu yang tidak diizinkan tapi punya anak yang diizinkan tetap tampil sebagai grup (route dikosongkan)
 */
function filterMenuTree(nodes, user) {
  const result = [];
  for (const node of nodes || []) {
    const children = filterMenuTree(node.children, user);
    const allowed = node.resource
      ? hasPermission(user, node.resource, 'view')
      : !!node.component;

    if (allowed) {
      result.push({ ...node, children: children.length ? children : undefined });
    } else if (children.length) {
      result.push({ ...node, component: null, children });
    }
  }
  return result;
}

exports.getMenuTree = async (req, res) => {
  try {
    const tree = filterMenuTree(await getMenuHierarchy(), req.user);
    return successResponse(
      res,
      tree
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

exports.createMenu = async (req, res) => {
  try {
    const menu = await runInTransaction(async () => {
      await lock(ref('menu', req.body.parent_id || null)); // parent tidak boleh terhapus bersamaan
      const menu = new Menu({
        menu: req.body.menu,
        parent_id: req.body.parent_id === "" ? null : req.body.parent_id,
        component: req.body.component,
        img: req.body.img,
        icon: req.body.icon,
        deskripsi: req.body.deskripsi,
        resource: toResource(req.body.resource),
        order: toOrder(req.body.order),
        createdDate: new Date(),
        createdBy: req.user._id,
        updatedDate: null,
        updatedBy: null
      });
      await menu.save();
      await audit.logCreate(req, 'menu', [menu]);
      return menu;
    });

    return successResponse(res, menu, "Menu successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateMenu = async (req, res) => {
  try {
    const menu = await runInTransaction(async () => {
      const menu = await Menu.findById(req.params.id);
      if (!menu) throw new HttpError('Menu not found', 404);

      await lock(ref('menu', req.body.parent_id || null));
      const before = await audit.snap('menu', [menu]);
      menu.menu = req.body.menu;
      menu.parent_id = req.body.parent_id === "" ? null : req.body.parent_id;
      menu.component = req.body.component;
      menu.img = req.body.img;
      menu.icon = req.body.icon;
      menu.deskripsi = req.body.deskripsi;
      menu.resource = toResource(req.body.resource);
      if (req.body.order !== undefined) menu.order = toOrder(req.body.order);
      menu.updatedDate = new Date();
      menu.updatedBy = req.user._id;
      await menu.save();
      await audit.logUpdate(req, 'menu', before, [menu]);
      return menu;
    });

    return successResponse(res, menu, "Menu successfully Updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.deleteMenu = async (req, res) => {
  try {
    const menu = await runInTransaction(async () => {
      const menu = await Menu.findById(req.params.id);
      if (!menu) throw new HttpError('Menu not found', 404);

      await lock(ref('menu', menu._id)); // bentrok dengan menu baru / pindah ke bawah menu ini
      // sub-menu akan kehilangan induknya: minta dipindah/dihapus dulu
      const childCount = await Menu.countDocuments({ parent_id: menu._id });
      if (childCount > 0) {
        throw new HttpError(`Menu still has ${childCount} sub-menu(s). Move or delete them first.`, 400);
      }

      const before = await audit.snap('menu', [menu]);
      await menu.deleteOne();
      await audit.logDelete(req, 'menu', before);
      return menu;
    });

    return successResponse(res, menu, "Menu successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
