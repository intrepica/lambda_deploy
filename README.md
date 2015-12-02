##AWS Lambda Gulp Tasks

This is a set of gulp tasks that copy, configure, npm install, zip, test, upload gulp tasks for aws lambda. The main difference between these gulp tasks and others I have found is it allows you to run tasks against multiple lambda handlers at once.

### Installation

Install @literacyplanet/lambda_gulp_deploy

```sh
npm install @literacyplanet/lambda_gulp_deploy --save-dev
```

Install gulp (global is optional)

```sh
npm install gulp -g
```

In your local gulpfile.js

```js
// add to gulpfile.js
var gulp = require('gulp');
// pass along gulp reference to have tasks imported
var tasks = require('@literacyplanet/lambda_gulp_deploy');

tasks.init(gulp);
```

### Gulp Options

* **--handlerPath** *prefix to match path. Defaults to ./lambda/handlers/*
* **--dist** *path to dist dir. Defaults to ./lambda/dist/*
* **--configsPath** *path to configs dir. Defaults to ./lambda/configs/*
* **--match** *match packages using [node-glob](https://www.npmjs.com/package/glob). It looks for [handlerPath]/[match]/package.json*
* **--env** *adds env to name of lambda and uses env to lookup .env file in [configsPath]/.env.[env]*
* **--lambdaRole** *needed when creating new lambdas*

aws credentials are looked up in your environment. Check the aws-sdk for info as to where the configs live (hint ~/.aws/credentials).

### Deploy Example

```sh
gulp deploy --match=** --env=staging --lambdaRole=arn:aws:iam::xxxxxx:role/
```

* Deletes the {dist}/{handler} dir
* Copies all files (excluding node_modules, test, README.md, MakeFile) from handler folder to {dist}/{handler} folder
* Runs npm install --production on {dist}/{handler} folder
* Copies environment vars from {configsPath}/{handler}/.env.{env} to {dist}/{handler}/.env
* Zips {dist}/{handler} directory to {dist}/{handler}.zip
* Uploads zip file to Lambda service using the name from {handler}/package.json with a -environment prefix (eg. my_awsome_lambda_handler-staging)

### Test Example

```sh
gulp test --match=**
```

* Deletes the {handler}/node_modules dir
* Runs npm in handlers folder (no production flag)
* Runs tests from handlers folder
* Concatenates coverage reports into one file (coverage/lcov.info) to make lambdas appear to be one project

### Independent tasks

#### Build & deploy
* build-clean
* copy-files
* env
* build-npm-install
* zip
* upload

#### Running tests
* test-clean
* test-npm-install
* run-test
* concat-coverage-reports

### Custom tasks

This module exports an `eachPackage` method that uses [async.eachLimit](https://github.com/caolan/async) to apply the task in parallel (up to limit). The `eachPackage` method calls back with a handler that has the following props on.

**pkg** *the package.json as an object literal*
**pkgPath** *the path to the handlers package.json*
**srcDir** *the path to the handler*
**destDir** *the path to packages destination*

```js
var gulp = require('gulp');
var tasks = require('@literacyplanet/lambda_gulp_deploy');

tasks.init(gulp);

gulp.task('my-custom-task', ['find-packages'], function(callback) {
  var limit = 5; // apply this task to 5 packages at once!
  tasks.eachPackage(limit, function iterator(handler, cb) {

    // do something with this package
    console.log(handler);

    // { pkg:
    //    { name: 'my_handler',
    //      version: '1.0.0',
    //      description: '',
    //      main: 'index.js',
    //      author: 'Tim Fairbrother',
    //      scripts:
    //       { test: 'node_modules/.bin/mocha --compilers js:babel/register',
    //         watch_test: 'node_modules/.bin/mocha -w --compilers js:babel/register',
    //         run: 'node_modules/.bin/babel index.js' },
    //      license: 'ISC',
    //      dependencies:
    //       { dotenv: '^1.2.0',
    //         moment: '^2.10.3' },
    //      devDependencies:
    //       { babel: '^5.6.14',
    //         'expect.js': '^0.3.1',
    //         mocha: '^2.2.4',
    //         nock: '^2.12.0',
    //         proxyquire: '^1.4.0',
    //         sinon: '^1.14.1' } },
    //   pkgPath: '/Users/timfairbrother/code/lambda/handlers/my_handler/package.json',
    //   srcDir: '/Users/timfairbrother/code/lambda/handlers/my_handler',
    //   destDir: 'dist/my_handler/' }

    // Call this when done!
    cb();
  }, callback);
});
```

To override the deploy or test tasks, use `https://www.npmjs.com/package/run-sequence` to create a newly named task with the tasks in the order you choose.
