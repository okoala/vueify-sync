var options = require('./options')
var assign = require('object-assign')
var path = require('path')

module.exports = function (raw, compiler, filePath) {
  var less = require('less')

  var opts = assign({
    filename: path.basename(filePath)
  }, options.less)

  // provide import path
  var dir = path.dirname(filePath)
  var paths = [dir, process.cwd()]
  opts.paths = opts.paths
    ? opts.paths.concat(paths)
    : paths

  var res = less.renderSync(raw, opts)
  // Less 2.0 returns an object instead rendered string
  if (typeof res === 'object') {
    res.imports.forEach(function (file) {
      compiler.emit('dependency', file)
    })
    res = res.css
  }
  return res
}
