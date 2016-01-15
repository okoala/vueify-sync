var options = require('./options')

module.exports = function (raw) {
  var jade = require('jade')
  return jade.compile(raw)(options.jade || {})
}
