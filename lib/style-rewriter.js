var postcss = require('postcss')
var selectorParser = require('postcss-selector-parser')
var cache = require('lru-cache')(100)
var options = require('./compilers/options')

var currentId
var addId = postcss.plugin('add-id', function () {
  return function (root) {
    root.each(function rewriteSelector (node) {
      if (!node.selector) {
        // handle media queries
        if (node.type === 'atrule' && node.name === 'media') {
          node.each(rewriteSelector)
        }
        return
      }
      node.selector = selectorParser(function (selectors) {
        selectors.each(function (selector) {
          var node = null
          selector.each(function (n) {
            if (n.type !== 'pseudo') node = n
          })
          selector.insertAfter(node, selectorParser.attribute({
            attribute: currentId
          }))
        })
      }).process(node.selector).result
    })
  }
})

/**
 * Add attribute selector to css
 *
 * @param {String} id
 * @param {String} css
 * @param {Boolean} scoped
 * @return {Promise}
 */

module.exports = function (id, css, scoped) {
  var key = id + '!!' + css
  var val = cache.get(key)
  if (val) {
    return val
  } else {
    var plugins = options.postcss
      ? options.postcss.slice()
      : []
    // scoped css rewrite
    if (scoped) {
      plugins.push(addId)
    }
    // autoprefixing
    if (options.autoprefixer !== false) {
      var autoprefixer = require('autoprefixer')(options.autoprefixer)
      plugins.push(autoprefixer)
    }
    // minification
    // 报错，先关闭
    // if (process.env.NODE_ENV === 'production') {
    //   plugins.push(require('cssnano')({
    //     autoprefixer: false
    //   }))
    // }
    currentId = id
    var res = postcss(plugins).process(css).css
    var val = {
      source: res,
      type: 'style'
    }
    cache.set(key, val)
    return val
  }
}
