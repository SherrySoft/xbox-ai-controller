/**
 * Xbox AI Controller - Main Module Export
 */

const config = require("./config");
const smartglass = require("./smartglass");
const xccs = require("./xccs");
const auth = require("./auth");
const database = require("./database");

module.exports = {
  ...config,
  ...smartglass,
  ...xccs,
  ...auth,
  ...database,
};
