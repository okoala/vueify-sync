var options = require('./options')
var assign = require('object-assign')
var path = require('path')

module.exports = function (raw, compiler, filePath) {
  var stylus = require('stylus')

  var opts = assign({
    filename: path.basename(filePath)
  }, options.stylus || {})

  var dir = path.dirname(filePath)
  var paths = [dir, process.cwd()]
  opts.paths = opts.paths
    ? opts.paths.concat(paths)
    : paths

  // using the renderer API so that we can
  // check deps after compilation
  var renderer = stylus(raw)
  Object.keys(opts).forEach(function (key) {
    renderer.set(key, opts[key])
  })

  var css = renderer.renderSync()
  renderer.deps().forEach(function (file) {
    compiler.emit('dependency', file)
  })
  return css
}
