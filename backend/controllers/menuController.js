const Menu = require ('../models/Menu');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");

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
  const menus = await Menu.find({ parent_id: parentId }).lean();

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
  const menus = await Menu.find({ parent_id: parentId }).lean().sort({ menu: 1 });

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

exports.getMenuTree = async (req, res) => {
  try {
    const tree = await getMenuHierarchy();
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
    const menu = new Menu({
      menu: req.body.menu,
      parent_id: req.body.parent_id === "" ? null : req.body.parent_id,
      component: req.body.component,
      img: req.body.img,
      icon: req.body.icon,
      createdDate: new Date(),
      createdBy: req.user._id,
      updatedDate: null,
      updatedBy: null
    });

    await menu.save();

    return successResponse(
      res,
      menu,
      "Menu successfully added",
      201
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

exports.updateMenu = async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu){
      return errorResponse(
        res,
        'Menu not found',
        404
      );
    }
    
    menu.menu = req.body.menu;
    menu.parent_id = req.body.parent_id === "" ? null : req.body.parent_id;
    menu.component = req.body.component;
    menu.img = req.body.img;
    menu.icon = req.body.icon;
    menu.updatedDate = new Date();
    menu.updatedBy = req.user._id;
    await menu.save();

    return successResponse(
      res,
      menu,
      "Menu successfully Updated",
      201
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
  
};

exports.deleteMenu = async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu){
      return errorResponse(
        res,
        'Menu not found',
        404
      );
    }

    await menu.deleteOne();
    
    return successResponse(
      res,
      menu,
      "Menu successfully deleted",
      201
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
  
};
