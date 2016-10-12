'use strict';

var fs = require('fs');
var async = require('async');
var parsePath = require('parse-filepath');
var path = require('path');
var minimist = require('minimist');

var Q = require('q');
var concatStreamCallback = require('concat-stream-callback');
var runSequence = require('run-sequence');

var debug = require('gulp-debug');
var concat = require('gulp-concat');
var tap = require('gulp-tap');
var rename = require('gulp-rename');
var del = require('del');
var zip = require('gulp-zip');
var gulpIgnore = require('gulp-ignore');
var mocha = require('gulp-spawn-mocha');
var gutil = require('gulp-util');
var plumber = require('gulp-plumber');
var npmInstall = require('gulp-install');
var awslambda = require('gulp-awslambda');
var babel = require('gulp-babel');
var es2015Preset = require('babel-preset-es2015');

var configureSources =
require('@literacyplanet/lambda_configure_event_sources');

var memory = {
  packages: {},
  deferred: false
};

function eachPackage(limit, iterator, callback) {
  var packages = Object.keys(memory.packages);
  var LIMIT = 5;
  async.eachLimit(packages, limit, function(name, cb) {
    var handler = memory.packages[name];
    iterator(handler, cb);
  }, callback);
}

function init(gulp) {

  var gulpSrc = gulp.src;
  gulp.src = function() {
    return gulpSrc.apply(gulp, arguments)
      .pipe(plumber(function(error) {
        // Output an error message
        var msg = 'Error (' + error.plugin + '): ' + error.message;
        gutil.log(gutil.colors.red(msg));
        // emit the end event, to properly end the task
        this.emit('end');
      })
    );
  };

  var knownOptions = {
    string: ['env','configsPath','lambdaRole','dist','match', 'handlerPath', 'testTimeout'],
    default: {
      handlerPath: './lambda/handlers/',
      dist: './lambda/dist/',
      env: 'staging',
      configsPath: './lambda/configs/',
      testTimeout: '2000'
    }
  };

  var options = minimist(process.argv.slice(2), knownOptions);

  if (!options.match) {
    throw 'required gulp argument "match" is not defined.' +
    ' Match supports any pattern node-glob does.';
  }

  var handlersSrc = [
    path.join(options.handlerPath,
      options.match, 'package.json'),
    path.join(
      ('!' + options.handlerPath),
      options.match, 'node_modules', '**', 'package.json')
  ];

  gulp.task('find-packages', function(callback) {
    if (!memory.deferred) {
      memory.deferred = Q.defer();
      return gulp.src(handlersSrc)
        .pipe(tap(function(file, t) {
          var pkg = JSON.parse(file.contents.toString());
          var pkgPath = file.path;
          var parsedPath = parsePath(pkgPath);
          var srcDir = parsedPath.dirname;
          var destDir = path.join(options.dist, pkg.name, '/');
          gutil.log('Loading ', gutil.colors.cyan(pkgPath));
          memory.packages[pkg.name] = {
            pkg: pkg,
            pkgPath: pkgPath,
            srcDir: srcDir,
            destDir: destDir
          };
          memory.deferred.resolve();
        }));
    }
    // Only load this task once - hence a promise is returned
    return memory.deferred.promise;
  });

  gulp.task('get-config', ['find-packages'], function(callback) {
    var limit = 4;
    eachPackage(limit, function iterator(handler, cb) {
      var awsConfig = [
        options.configsPath,
        handler.pkg.name,
        '/aws.' + options.env + '.json'
      ].join('');
      gutil.log('Loading aws config at', gutil.colors.cyan(awsConfig));
      fs.readFile(awsConfig, 'utf8', function(err, file) {
        if (err && err.code === 'ENOENT') {
          gutil.log(gutil.colors.red('WARNING:') +
            ' No aws config found in', gutil.colors.cyan(awsConfig));
          return cb();
        }
        if (err) {
          gutil.log(err);
          return cb(err);
        }
        var config = JSON.parse(file);
        handler.lambdaConfig = config;
        cb();
      });
    }, callback);
  });

  function clean(options, callback) {
    var limit = 100;
    eachPackage(limit, function iterator(handler, cb) {
      gutil.log('Cleaning ', gutil.colors.cyan(handler.pkg.name));
      var opts = {force: true};
      if (options.dest) {
        del(handler.destDir, cb);
      } else if (options.src) {
        del(path.join(handler.srcDir, 'node_modules'), cb);
      }
    }, callback);
  }

  gulp.task('test-clean', ['find-packages'], function(callback) {
    clean({src: true}, callback);
  });

  gulp.task('build-clean', ['find-packages'], function(callback) {
    clean({dest: true}, callback);
  });

  gulp.task('copy-files', ['find-packages'], function(callback) {
    var excludeFiles = [
      '!package.json',
      '!README.md',
      '!Makefile',
      '!test',
      '!test/**/*',
      '!.env',
      '!shared_lib',
      '!node_modules',
      '!node_modules/**/*'
    ];
    var limit = 5;
    eachPackage(limit, function iterator(handler, cb) {
      var srcFiles = ['**/*'].concat(excludeFiles);
      gutil.log('Copying ', gutil.colors.cyan(handler.pkg.name));
      gulp.src(srcFiles, {cwd: handler.srcDir})
        .pipe(gulp.dest(handler.destDir))
        .on('end', cb);
    }, callback);
  });

  gulp.task('transpile-js', ['find-packages'], function(callback) {
    var excludeFiles = [
      '!node_modules',
      '!node_modules/**/*'
    ];
    var limit = 5;
    eachPackage(limit, function iterator(handler, cb) {
      var srcFiles = ['**/*.js'].concat(excludeFiles);
      gutil.log('Transpiling js files', gutil.colors.cyan(handler.pkg.name));
      gulp.src(srcFiles, {cwd: handler.destDir})
        .pipe(babel({
          presets: [es2015Preset]
        }))
        .pipe(gulp.dest(handler.destDir))
        .on('end', cb);
    }, callback);
  });

  function runNpmInstall(options, callback) {
    var limit = 1;
    eachPackage(limit, function iterator(handler, cb) {
      var logMsg = 'npm install (' + options.production ? 'dest' : 'src' + ') ';
      var dest = options.production ? handler.destDir : handler.srcDir;
      gutil.log(logMsg, gutil.colors.cyan(dest));
      var installPipe = npmInstall(options);
      gulp.src(handler.pkgPath)
        .pipe(gulp.dest(dest))
        .pipe(installPipe)
        .pipe(concatStreamCallback(installPipe, cb));
    }, callback);
  }

  gulp.task('test-npm-install', ['find-packages'], function(callback) {
    runNpmInstall({}, callback);
  });

  gulp.task('build-npm-install', ['find-packages'], function(callback) {
    runNpmInstall({production: true}, callback);
  });

  gulp.task('run-test', ['find-packages'], function(callback) {
    process.env.NODE_ENV = 'test';
    var limit = 1;
    eachPackage(limit, function iterator(handler, cb) {
      var opts = {cwd: handler.srcDir, read: false};
      var istanbul = {
        report: 'lcovonly',
        dir: path.join('coverage', handler.pkg.name)
      };
      gulp.src('test/**/*_spec.js', opts)
        .pipe(mocha({
          R: 'spec',
          t: options.testTimeout,
          istanbul: istanbul,
          compilers: [
            'js:babel/register'
          ]
        }))
        .on('end', cb);
    }, callback);
  });

  gulp.task('concat-coverage-reports', function() {
    return gulp.src('./coverage/**/*/lcov.info')
      .pipe(debug({
        title: 'concat-coverage-reports'
      }))
      .pipe(concat('lcov.info', {newLine: ''}))
      .pipe(gulp.dest('./coverage'));
  });

  gulp.task('env', ['find-packages'], function(callback) {
    var limit = 5;
    eachPackage(limit, function iterator(handler, cb) {
      gutil.log('Copying config.env to dist/.env', gutil.colors.cyan(handler.pkg.name));
      var secretConfigsEnvPath = [
        options.configsPath,
        handler.pkg.name,
        '/config.env.',
        options.env
      ].join('');
      gulp.src(secretConfigsEnvPath, {dot: true})
          .pipe(rename('.env'))
          .pipe(gulp.dest(handler.destDir))
          .on('end', cb);
    }, callback);
  });

  gulp.task('zip', ['find-packages'], function(callback) {
    var limit = 5;
    gutil.log('Starting Zip');
    eachPackage(limit, function iterator(handler, cb) {
      gutil.log('Zipping', gutil.colors.cyan(handler.pkg.name));
      gulp.src(path.join(handler.destDir, '/**/*'), {dot: true})
          .pipe(zip(handler.pkg.name + '.zip'))
          .pipe(gulp.dest(options.dist))
          .on('end', cb);
    }, callback);
  });

  function getLambdaName(handler) {
    return [
      handler.pkg.name,
      '-',
      options.env
    ].join('');
  }

  gulp.task('upload', ['find-packages', 'get-config'], function(callback) {
    var limit = 1;
    eachPackage(limit, function iterator(handler, cb) {
      var lambdaName = getLambdaName(handler);
      var zipFile = path.join(options.dist, handler.pkg.name + '.zip');
      gutil.log('Uploading', gutil.colors.cyan(zipFile));
      var config = handler.lambdaConfig;
      var role = config && config.Role || options.lambdaRole;
      var handler = config && config.Handler || 'index.handler';
      var timeout = config && config.Timeout || 5;
      var memorySize = config && config.MemorySize || 128;
      var region = config && region.Region || 'us-east-1';
      gulp.src(zipFile)
       .pipe(awslambda({
          FunctionName: lambdaName,
          Handler: handler,
          Role: role,
          Timeout: timeout,
          MemorySize: memorySize
        }, {
          region: region
        }))
       .on('end', cb);
    }, callback);
  });

  gulp.task('link-event-sources', ['get-config'], function(callback) {
    var limit = 1;
    eachPackage(limit, function iterator(handler, cb) {
      var lambdaName = getLambdaName(handler);
      gutil.log('Setting event sources for',
        gutil.colors.cyan(lambdaName));
      var config = handler.lambdaConfig;
      if (config && config.EventSources) {
        configureSources.createOrUpdateSources({
          eventSources: config.EventSources,
          region: config.Region,
          lambdaName: lambdaName
        }, cb);
      } else {
        gutil.log('No event sources found for',
          gutil.colors.cyan(handler.pkg.name));
      }
    }, callback);
  });

  runSequence = runSequence.use(gulp);

  gulp.task('deploy', function(callback) {
    runSequence(
      'build-clean',
      ['copy-files', 'env', 'build-npm-install'],
      'transpile-js',
      'zip',
      'upload',
      'link-event-sources',
      callback);
  });

  gulp.task('test', function(callback) {
    runSequence(
      'test-clean',
      'test-npm-install',
      'run-test',
      'concat-coverage-reports',
      callback);
  });
};

exports.init = init;
exports.eachPackage = eachPackage;
