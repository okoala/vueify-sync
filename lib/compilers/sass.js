var options = require('./options')
var assign = require('object-assign')
var path = require('path')

module.exports = function (raw,  compiler, filePath) {
  var sass = require('node-sass')

  var sassOptions = assign({
    data: raw
  }, options.sass)

  var dir = path.dirname(filePath)
  var paths = [dir, process.cwd()]
  sassOptions.includePaths = sassOptions.includePaths
    ? sassOptions.includePaths.concat(paths)
    : paths

  var res = sass.renderSync(sassOptions)
  res.stats.includedFiles.forEach(function(file){
    compiler.emit('dependency', file)
  })
  return res.css.toString()
}
