var options = require('./options')
var babel = require('babel-core')

module.exports = function (raw) {
  return babel.transform(raw, options.babel || {})
}
