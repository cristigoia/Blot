var basename = require('path').basename;
var dateFromFileName = require('./dateFromFileName');

function titlify (path) {

  var name, nameWithoutExtension, title;
  var hasDate = dateFromFileName(path);

  // Otherwise basename doesn't work right?
  if (path[0] !== '/') path = '/' + path;

  if (hasDate && hasDate.fileName) {
    name = hasDate.fileName;
  } else {
    name = basename(path);
  }

  // Strip extension
  if (name.lastIndexOf('.') > -1) {
    nameWithoutExtension = name.slice(0, name.lastIndexOf('.'));
  } else {
    nameWithoutExtension = name;
  }

  title = nameWithoutExtension;

  // Replace dashes and underscores
  // with spaces to make things nice
  // but only if the file name doesn't
  // already contain spaces.
  if (title.indexOf(' ') === -1) {

    if (name.indexOf('-') > -1 && name.indexOf('_') > -1) {
      title = title.split('_').join(' ');
    } else {
      title = title.split('_').join(' ');
      title = title.split('-').join(' ');
    }

    while (title[0] === '-' || title[0] === '_')
      title = title.slice(1);

    while (title.slice(-1) === '-' || title.slice(-1) === '_')
      title = title.slice(0, -1);
  }

  title = title.trim() || nameWithoutExtension.trim() || name;

  return title;
}


function tests () {

  function is (str, expected) {

    if (titlify(str) !== expected) {

      console.log('INPUT', str);
      console.log('OUTPUT', titlify(str));
      console.log('EXPECTED', expected);
    }
  }

  // Preserve case
  is('/fOo.txt', 'fOo');

  // Replace dashes and underscores
  // But only at start and end
  is('/-f_o_o-.txt', 'f o o');

  // Only replace dashes with spaces
  // when file name has no spaces.
  is('/2-1 Match report.txt', '2-1 Match report');
  is('/2-1_Match_report.txt', '2-1 Match report');

  // work without path
  is('test.md', 'test');

  // work with multiple dots
  is('preview.html.txt', 'preview.html');

  // extract date
  is('2016/1/2 Bar.txt', 'Bar');
  is('2016-1/2 Bar.txt', 'Bar');
  is('/2016-1 2 Bar.txt', 'Bar');

  // Ignore bad date
  is('2-12-2000 Bar.txt', '2-12-2000 Bar');
  is('/2000/34-23 Bar.txt', '34-23 Bar');
  is('/11-1_Bar.txt', '11-1 Bar');

  // Ensure title exists
  is('___.jpg', '___');
  is('---.jpg', '---');
  is('-_-.jpg', '-_-');
  is('.jpg', '.jpg');

}

tests();

module.exports = titlify;