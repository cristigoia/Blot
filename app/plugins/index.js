var config = require('../../config');
var helper = require('../helper');
var marked = require('marked');
var cheerio = require('cheerio');
var fs = require('fs');
var ensure = helper.ensure;
var callOnce = helper.callOnce;
var forEach = helper.forEach;
var extend = helper.extend;
var deCamelize = helper.deCamelize;
var log = new helper.logg('PLUGIN');
var time = helper.time;

// Wait 10s to go to next plugin
var TIMEOUT = 10000;

// Will contain a dictionary
// of every public plugin on
// blog, can be used to render a string
var defaultPlugins = {};

var loaded = loadPlugins(__dirname);

var list = loaded.list;
var plugins = loaded.plugins;
var prerenderers = loaded.prerenderers;

// Takes a string and based on the user's
// plugins converts it into an HTML string
function convert (blog, path, contents, callback) {

  ensure(contents, 'string')
    .and(path, 'string')
    .and(blog, 'object')
    .and(callback, 'function');

  var enabled = Enabled(blog.plugins);

  // This is passed to all plugins
  // I need to change this when we move
  // to HTTPS... Ideally it shouldn't be
  // needed. I'd look up local files on disk...
  var globalOptions = {
    isHTML: isHTML(path),
    domain: blog.domain,
    blogID: blog.id,
    path: path,
    baseURL: 'http://' + blog.handle + '.' + config.host
  };

  forEach(prerenderers, function(plugin, next){

    var name = plugin.id;

    if (!enabled[name]) return next();

    var prerender = plugin.prerender;
    var options = {};

    extend(options)
      .and(blog.plugins[name].options)
      .and(globalOptions);

    var timeout = Timeout(name, next);

    time(name);

    prerender(contents, function(err, result){

      time.end(name);
      clearTimeout(timeout);

      if (result && !err) contents = result;

      next();

    }, options);

  }, function(){

    // Not sure why we decode entities. Maybe it fucks
    // with the typesetting plugin?
    var $ = cheerio.load(contents, {decodeEntities: false});

    forEach(plugins, function (plugin, next) {

      var id = plugin.id;

      if (!plugin.render || !enabled[id]) return next();

      // We wrap the callback passed to the function
      // to ensure its called once. This allows us
      // to set a timeout safely.
      next = callOnce(next);

      var options = {};

      extend(options)
        .and(blog.plugins[id].options)
        .and(globalOptions);

      var timeout = Timeout(id, next);

      time(id);

      plugin.render($, function(){

        time.end(id);

        clearTimeout(timeout);

        next();

      }, options);

    }, function () {

      // Return the entry's completed HTML
      // pass the HTML so it can be rendered totally tast
      callback(null, $.html());
    });
  });
}

// Load plugin templates,
// this is currently async but uses
// a callback for when I need it
function load (file, blogPlugins, callback) {

  var response = '';

  for (var i in blogPlugins) {

    if (blogPlugins[i].enabled && list[i]) {

      if (file === 'entryHTML' && list[i].entryHTML)
        response += list[i].entryHTML || '';

      if (file === 'css' && list[i].publicCSS)
        response += list[i].publicCSS || '';

      if (file === 'js' && list[i].publicJS)
        response += list[i].publicJS || '';
    }
  }

  return callback(null, response);
}

function Enabled (blogPlugins) {

  var enabled = {};

  for (var i in blogPlugins)
    if (blogPlugins[i].enabled)
      enabled[i] = true;

  return enabled;
}

function isHTML (path) {
  return path.slice(-5) === '.html' ||
         path.slice(-4) === '.htm';
}

function read (name, file) {

  var path = __dirname + '/' + name + '/' + file;

  var contents = '';

  try {
    contents = fs.readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return contents;
}


function loadPlugins (dir) {

  var _list = {};
  var _plugins = [];
  var _prerenderers = [];

  fs.readdirSync(dir).forEach(function(name){

    // Ignore this file (index.js) and sys files
    if (name[0] === '.') return;
    if (name.slice(-3) === '.js') return;

    var plugin = require('./' + name);

    if (plugin.disabled) return;

    // Generate the title and ID automatically
    // for each plugin to avoid bloatage
    // Plugins are used by default unless
    // explicitly blacklisted in config
    plugin.title = plugin.title || deCamelize(name);
    plugin.description = marked(plugin.description || '');
    plugin.id = name;

    // undefined -> true, defined to defined
    plugin.optional = plugin.optional === undefined || plugin.optional !== false;
    plugin.isDefault = plugin.isDefault === undefined || plugin.isDefault !== false;

    // undefined -> false, defined to defined
    plugin.first = !!plugin.first;

    // This goes on the plugin settings page
    // and is used to pass options to each plugin
    // JS to be appended to every user blog
    // CSS to be appended to every user blog
    // HTML to be appended to every full entry
    plugin.formHTML = read(name, 'form.html');
    plugin.publicJS = read(name, 'public.js');
    plugin.publicCSS = read(name, 'public.css');
    plugin.entryHTML = read(name, 'entry.html');

    // Store this plugin for internal use
    // plugins[name] = plugin;
    if (plugin.first) {
      _plugins.unshift(plugin);
    } else {
      _plugins.push(plugin);
    }

    if (plugin.prerender) {
      _prerenderers.push(plugin);
    }

    _list[name] = plugin;

    // Push this plugin to the list of
    // default plugins for each user
    defaultPlugins[name] = {
      enabled: plugin.isDefault,
      options: plugin.options || {}
    };
  });

  return {
    plugins: _plugins,
    prerenderers: _prerenderers,
    list: _list
  };
}

function Timeout (name, cb) {
  return setTimeout(function(){
    log.debug(name + ' timed out. Moving to next plugin.');
    cb();
  }, TIMEOUT);
}

module.exports = {
  convert: convert,
  load: load,
  list: list,
  defaultList: defaultPlugins
};