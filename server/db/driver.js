const config = require('../config');

let _neo4j, _driver, _initError;

function getDriver() {
  if (_initError) throw _initError;
  if (_driver) return _driver;
  try {
    _neo4j = require('neo4j-driver');
    _driver = _neo4j.driver(
      config.neo4j.uri,
      _neo4j.auth.basic(config.neo4j.username, config.neo4j.password)
    );
    return _driver;
  } catch (e) {
    _initError = e;
    throw e;
  }
}

function getNeo4j() {
  getDriver();
  return _neo4j;
}

function toNum(val) {
  if (val == null) return null;
  if (getNeo4j().isInt(val)) return val.toNumber();
  return val;
}

function getSession() {
  return getDriver().session({ database: config.neo4j.database });
}

module.exports = { getDriver, getNeo4j, toNum, getSession };
