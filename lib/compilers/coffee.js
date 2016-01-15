var options = require('./options')

module.exports = function (raw) {
  var coffee = require('coffee-script')
  return coffee.compile(raw, options.coffee || {})
}
