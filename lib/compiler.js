require('es6-promise').polyfill()
var fs = require('fs')
var path = require('path')
var parse5 = require('parse5')
var hash = require('hash-sum')
var compilers = require('./compilers')
var options = require('./compilers/options')
var rewriteStyle = require('./style-rewriter')
var rewriteTemplate = require('./template-rewriter')
var validateTemplate = require('vue-template-validator')
var chalk = require('chalk')
var assign = require('object-assign')
var deindent = require('de-indent')
var Emitter = require('events').EventEmitter

// production minifiers
if (process.env.NODE_ENV === 'production') {
  var htmlMinifier = require('html-minifier')
  // required for Vue 1.0 shorthand syntax
  var htmlMinifyOptions = {
    customAttrSurround: [[/@/, new RegExp('')], [/:/, new RegExp('')]],
    collapseWhitespace: true,
    removeComments: true,
    collapseBooleanAttributes: true,
    removeAttributeQuotes: true,
    // this is disabled by default to avoid removing
    // "type" on <input type="text">
    removeRedundantAttributes: false,
    useShortDoctype: true,
    removeEmptyAttributes: true,
    removeOptionalTags: true
  }
}

// expose compiler
var compiler = module.exports = new Emitter()
compiler.setMaxListeners(Infinity)

// load user config
compiler.loadConfig = function () {
  var fs = require('fs')
  var path = require('path')
  var configPath = path.resolve(process.cwd(), 'vue.config.js')
  if (fs.existsSync(configPath)) {
    compiler.applyConfig(require(configPath))
  }
}

// apply config
compiler.applyConfig = function (config) {
  // copy user options to default options
  Object.keys(config).forEach(function (key) {
    if (key === 'htmlMinifier') {
      if (process.env.NODE_ENV === 'production') {
        htmlMinifyOptions = assign(htmlMinifyOptions, config[key])
      }
    } else if (key !== 'customCompilers') {
      options[key] = config[key]
    } else {
      // register compilers
      Object.keys(config[key]).forEach(function (name) {
        compilers[name] = config[key][name]
      })
    }
  })
}

compiler.compileSync = function (content, filePath) {
  // path is optional
  if (!filePath) {
    filePath = process.cwd()
  }

  // generate css scope id
  var id = '_v-' + hash(filePath || content)

  // parse the file into an HTML tree
  var fragment = parse5.parseFragment(content, { locationInfo: true })

  // check node numbers
  if (!validateNodeCount(fragment)) {
    return new Error(
      'Only one script tag and one template tag allowed per *.vue file.'
    )
  }

  // check for scoped style nodes
  var hasScopedStyle = fragment.childNodes.some(function (node) {
    return node.nodeName === 'style' && isScoped(node)
  })

  var output = ''
  var parts = []

  fragment.childNodes.map(function (node) {
    switch (node.nodeName) {
      case 'template':
        parts.push(processTemplate(node, filePath, id, hasScopedStyle, content))
        break
      case 'style':
        parts.push(processStyle(node, filePath, id))
        break
      case 'script':
        parts.push(processScript(node, filePath, content))
        break
    }
  })
  output = mergeParts(parts, filePath)
  return output
}

// merg
function mergeParts (parts, filePath) {
  var output = ''
  // styles
  var style = extract(parts, 'style')
  if (style) {
    style = JSON.stringify(style)
    output +=
      'var __vueify_style__ = require("vueify-insert-css").insert(' + style + ')\n'
  }
  // script
  var script = extract(parts, 'script')
  if (script) {
    output +=
      script + '\n' +
      // babel 6 compat
      'if (module.exports.__esModule) module.exports = module.exports.default\n'
  }
  // template
  var template = extract(parts, 'template')
  if (template) {
    output +=
      ';(typeof module.exports === "function"' +
        '? module.exports.options' +
        ': module.exports).template = ' + JSON.stringify(template) + '\n'
  }

  return output
}

/**
 * Ensure there's only one template node.
 *
 * @param {Fragment} fragment
 * @return {Boolean}
 */

function validateNodeCount (fragment) {
  var count = 0
  fragment.childNodes.forEach(function (node) {
    if (node.nodeName === 'template') {
      count++
    }
  })
  return count <= 1
}

/**
 * Check if a style node is scoped.
 *
 * @param {Node} node
 * @return {Boolean}
 */

function isScoped (node) {
  return node.attrs && node.attrs.some(function (attr) {
    return attr.name === 'scoped'
  })
}

/**
 * Process a template node
 *
 * @param {Node} node
 * @param {String} filePath
 * @param {String} id
 * @param {Boolean} hasScopedStyle
 * @param {String} fullSource
 * @return {Promise}
 */

function processTemplate (node, filePath, id, hasScopedStyle, fullSource) {
  var template = checkSrc(node, filePath) || parse5.serialize(node.content)
  template = deindent(template)
  var lang = checkLang(node)
  if (!lang) {
    var warnings = validateTemplate(node.content, fullSource)
    if (warnings) {
      var relativePath = path.relative(process.cwd(), filePath)
      warnings.forEach(function (msg) {
        console.warn(chalk.red('\n  Error in ' + relativePath + ':\n') + msg)
      })
    }
  }
  var res = compileSource('template', template, lang, filePath)
  if (hasScopedStyle) {
    res = rewriteTemplate(id, res.source)
  }
  if (process.env.NODE_ENV === 'production') {
    res.source = htmlMinifier.minify(res.source, htmlMinifyOptions)
  }
  return res
}

/**
 * Process a style node
 *
 * @param {Node} node
 * @param {String} id
 * @param {String} filePath
 * @return {Promise}
 */

function processStyle (node, filePath, id) {
  var style = checkSrc(node, filePath) || parse5.serialize(node)
  var lang = checkLang(node)
  style = deindent(style)
  var res = compileSource('style', style, lang, filePath)
  return rewriteStyle(id, res.source, isScoped(node))
}

/**
 * Process a script node
 *
 * @param {Node} node
 * @param {String} filePath
 * @param {String} content
 * @return {Promise}
 */

function processScript (node, filePath, content) {
  var lang = checkLang(node) || 'babel'
  var script = checkSrc(node, filePath)
  if (!script) {
    script = parse5.serialize(node)
    // pad the script to ensure correct line number for syntax errors
    var location = content.indexOf(script)
    var before = padContent(content.slice(0, location))
    script = before + script
  }
  script = deindent(script)
  return compileSource('script', script, lang, filePath)
}

/**
 * Check the lang attribute of a parse5 node.
 *
 * @param {Node} node
 * @return {String|undefined}
 */

function checkLang (node) {
  if (node.attrs) {
    var i = node.attrs.length
    while (i--) {
      var attr = node.attrs[i]
      if (attr.name === 'lang') {
        return attr.value
      }
    }
  }
}

/**
 * Check src import for a node, relative to the filePath if
 * available. Using readFileSync for now since this is a
 * rare use case.
 *
 * @param {Node} node
 * @param {String} filePath
 * @return {String}
 */

function checkSrc (node, filePath) {
  var dir = path.dirname(filePath)
  if (node.attrs) {
    var i = node.attrs.length
    while (i--) {
      var attr = node.attrs[i]
      if (attr.name === 'src') {
        var src = attr.value
        if (src) {
          filePath = path.resolve(dir, src)
          compiler.emit('dependency', filePath)
          try {
            return fs.readFileSync(filePath, 'utf-8')
          } catch (e) {
            console.warn(
              'Failed to load src: "' + src +
              '" from file: "' + filePath + '"'
            )
          }
        }
      }
    }
  }
}

/**
 * Compile a piece of source code with an async compiler and
 * return a Promise.
 *
 * @param {String} type
 * @param {String} source
 * @param {String} lang
 * @param {String} filePath
 * @return {Promise}
 */

function compileSource (type, source, lang, filePath) {
  var compile = compilers[lang]
  if (compile) {
    var res = compile(source, compiler, filePath)
    return {
      source: res,
      type: type
    }
  } else {
    return {
      source: source,
      type: type
    }
  }
}

/**
 * Extract parts from resolved array.
 *
 * @param {Array} parts
 * @param {String} type
 */

function extract (parts, type) {
  return parts
    .filter(function (part) {
      return part.type === type
    })
    .map(function (part) {
      return part.source
    })
    .join('\n')
}

function padContent (content, lang) {
  return content
    .split(/\r?\n/g)
    .map(function () { return '' })
    .join('\n')
}
