var config = require('config');
var Dropbox = require('dropbox');
var database = require('database');
var get_account = require('./get_account');
var set_account = require('./set_account');
var join = require('path').join;
var helper = require('helper');
var forEach = helper.forEach;
var callback_uri = require('./callback_uri');

var authenticate = require('express').Router();

// This route sends the user to Dropbox
// to consent to Blot's connection.
authenticate.get('/redirect', function (req, res) {

  var callback, key, secret, authentication_url;

  if (req.query.full_access) {
    key = config.dropbox.full.key;
    secret = config.dropbox.full.secret;
    callback = callback_uri(req) + '?full_access=true';
  } else {
    key = config.dropbox.app.key;
    secret = config.dropbox.app.secret;
    callback = callback_uri(req);
  }

  var client = new Dropbox({
    "clientId": key,
    "secret": secret
  });

  authentication_url = client.getAuthenticationUrl(callback, null, 'code');
  authentication_url = authentication_url.replace('response_type=token', 'response_type=code');

  res.redirect(authentication_url);
});

function create_folder (req, res, next) {

  var new_account = req.new_account;
  var client = new Dropbox({accessToken: new_account.access_token});

  mkdir(client, '/' + req.blog.title, function(err, folder, folder_id){

    if (err) return next(err);

    req.new_account.folder = folder;
    req.new_account.folder_id = folder_id;

    return next();
  });
}

function migrate_files (req, res, next) {

  // This could get tripped up if the blog's title
  // contains characters that are not valid in a dropbox
  // folder name. Perhaps we should handle this error?
  var new_account = req.new_account;
  var new_site_folder = '/' + req.blog.title;
  var existing_blog = req.existing_blog;
  var existing_site_folder = '/' + existing_blog.title;
  var client = new Dropbox({accessToken: new_account.access_token});

  readdir(client, '', function(err, contents){

    if (err) return next(err);

    mkdir(client, existing_site_folder, function(err, existing_site_folder, existing_site_folder_id){

      if (err) return next(err);

      contents = contents.map(function(i){
        return {
          from_path: i.path_display,
          to_path: join(existing_site_folder, i.path_display)
        };
      });

      move(client, contents, function(err){

        if (err) return next(err);

        var updates = {
          folder: existing_site_folder,
          folder_id:  existing_site_folder_id,
          cursor: ''
        };

        database.set(existing_blog.id, updates, function(err){

          if (err) return next(err);

          mkdir(client, new_site_folder, function(err, folder, folder_id){

            if (err) return next(err);

            req.new_account.folder = folder;
            req.new_account.folder_id = folder_id;
            req.migration = existing_site_folder;

            return next();
          });
        });
      });
    });
  });
}

function move (client, entries, callback) {
  client.filesMoveBatch({entries: entries})
    .then(function(res){
      if (!res) return callback(new Error('No response from Dropbox'));
      callback(null);
    }).catch(callback);
}

function readdir (client, path, callback) {

  client.filesListFolder({path: path})
    .then(function(res){
      if (!res) return callback(new Error('No response from Dropbox'));
      callback(null, res.entries);
    })
    .catch(callback);
}

function mkdir (client, path, callback) {
  client.filesCreateFolder({path: path, autorename: true})
    .then(function(res){

      if (!res) return callback(new Error('No response from Dropbox'));

      callback(null, res.path_display, res.id);
    })
    .catch(callback);
}

function sites_in_app_folder (blog_id, account_id, callback) {

  var sites = [];

  database.get_blogs_by_account_id(account_id, function(err, blogs){

    if (err) return callback(err);

    forEach.parallel(blogs, function(blog, next){

      // This blog was already connected to this
      // account. It's possible the user is reauthenticating
      // to refresh an expired or revoked token, or switching
      // from partial access permissions to full folder permissions.
      if (blog.id === blog_id) return next();

      database.get(blog.id, function(err, account){

        if (err) return callback(err);

        // This site is not in the app folder
        if (account.full_access) return next();

        sites.push([blog, account]);
        next();
      });
    }, function(){

      callback(null, sites);
    });
  });
}


function prepare_folder (req, res, next){

  var full_access = req.new_account.full_access;
  var new_account_id = req.new_account.account_id;

  // My general strategy is to create a folder
  // on behalf of the user somewhere in their
  // Dropbox. This location depends on the permissions
  // they have granted us. I will also offer a one
  // click 'undo feature' which will remove the folder
  // where possible and revoke Blot's access in the case
  // of an accidental click or something like that.

  // We really should be able to use the user's existing
  // folder instead of creating a whole new one.
  // if (full_access && req.account && req.account.account_id === new_account_id)
  //   return select_existing_folder(req, res, next);

  // If we have access to the entire Dropbox folder
  // just create a new folder for this site in the
  // root directory of the user's dropbox, then
  // tell them they can move it wherever they like.
  if (full_access) return create_folder(req, res, next);

  // We basically need to determine if there is another
  // site using the app folder. It's possible that there
  // is another site using this dropbox, but with full
  // permission. or another site using a subfolder
  // inside the app folder.
  sites_in_app_folder(req.blog.id, new_account_id, function(err, sites){

    if (err) return next(err);

    // There multiple sites inside this app folder
    // and we assume that these sites each have their
    // own sub folder inside the app folder, we can just
    // create another folder for this site.
    if (sites.length > 1) {
      return create_folder(req, res, next);
    }

    // Since the other site uses the app folde as root
    // we need to move its files into a sub folder, then
    // create a new folder for this site.
    if (sites.length === 1) {

      var existing_site = sites[0];

      req.existing_blog = existing_site[0];
      req.existing_account = existing_site[1];

      return migrate_files(req, res, next);
    }

    // There are no other sites anywhere inside this Dropbox
    // folder so let's just use the entire app folder.
    return next();
  });
}

// This route recieves the user back from
// Dropbox when they have accepted or denied
// the request to access their folder.
authenticate.get('/', get_account, prepare_folder, set_account);

module.exports = authenticate;