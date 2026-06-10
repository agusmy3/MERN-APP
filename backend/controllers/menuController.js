const Menu = require ('../models/Menu');

exports.getAllMenu = async (req, res) => {
  const menus = await Menu.find()
    .populate("parent_id")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ parent_id: 1 });
  res.json(menus);
};

exports.getMenu = async (req, res) => {
  try {
    console.log(req.query);
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

    const data = await Menu.find(filter)
      .populate("parent_id")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
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
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMenuTree = async (req, res) => {
  try {
    const tree = await getMenuHierarchy();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createMenu = async (req, res) => {
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
  res.status(201).json(menu);
};

exports.updateMenu = async (req, res) => {
  const { id } = req.params;
  const menu = await Menu.findByIdAndUpdate(
    id,
    {
        menu: req.body.menu,
        parent_id: req.body.parent_id === "" ? null : req.body.parent_id,
        component: req.body.component,
        img: req.body.img,
        icon: req.body.icon,
        updatedDate: new Date(),
        updatedBy: req.user._id
    },
    { new: true }
  );

  res.json(menu);
};

exports.deleteMenu = async (req, res) => {
  const { id } = req.params;
  await Menu.findByIdAndDelete(id);
  res.json({ message: "Menu deleted" });
};
