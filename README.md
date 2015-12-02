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
require('@literacyplanet/lambda_gulp_deploy')(gulp);
```

### Gulp Options

* **--handlerPath** *prefix to match path. Defaults to ./lambda/handlers/*
* **--dist** *path to dist dir. Defaults to ./lambda/dist/*
* **--configsPath** *path to configs dir. Defaults to ./lambda/configs/*
* **--match** *match packages using [node-glob](https://www.npmjs.com/package/glob). It looks for [handlerPath]/[match]/package.json*
* **--env** *adds env to name of lambda and uses env to lookup .env file in [configsPath]/.env.[env]*
* **--lambdaRole** *needed when creating new lambdas*

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
