#!/usr/bin/env node
/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, $$BLACKLIST, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const $$BLACKLIST = null;
const ignorePattern = $$BLACKLIST ? new RegExp($$BLACKLIST) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}/;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![A-Za-z]:)(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["@esy-ocaml/substs",
new Map([["0.0.1",
         {
           packageLocation: "/home/jacob/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
           packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"]])}]])],
  ["@opam/angstrom",
  new Map([["opam:0.15.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__angstrom__opam__c__0.15.0__c5dca2a1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/astring",
  new Map([["opam:0.8.5",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/base-bytes",
  new Map([["opam:base",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/base-threads",
  new Map([["opam:base",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"]])}]])],
  ["@opam/base-unix",
  new Map([["opam:base",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"]])}]])],
  ["@opam/base64",
  new Map([["opam:3.5.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__base64__opam__c__3.5.1__28596b1d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base64", "opam:3.5.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/bigarray-compat",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__bigarray_compat__opam__c__1.1.0__ec432e34/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.1.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/bigarray-overlap",
  new Map([["opam:0.2.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__bigarray_overlap__opam__c__0.2.1__470919ab/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-overlap",
                                             "opam:0.2.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/bigstringaf",
  new Map([["opam:0.9.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__bigstringaf__opam__c__0.9.1__94edc918/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/camlp-streams",
  new Map([["opam:5.0.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__camlp_streams__opam__c__5.0.1__35498539/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/caqti",
  new Map([["opam:1.9.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__caqti__opam__c__1.9.0__15467c92/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/caqti", "opam:1.9.0"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/caqti-lwt",
  new Map([["opam:1.9.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__caqti_lwt__opam__c__1.9.0__28b8c95f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/caqti", "opam:1.9.0"],
                                             ["@opam/caqti-lwt",
                                             "opam:1.9.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/chrome-trace",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__chrome_trace__opam__c__3.10.0__a2a9c161/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/chrome-trace",
                                             "opam:3.10.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/conf-autoconf",
  new Map([["github:esy-packages/esy-autoconf:package.json#fb93edf",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__conf_autoconf__823a11c2/",
             packageDependencies: new Map([["@opam/conf-autoconf",
                                           "github:esy-packages/esy-autoconf:package.json#fb93edf"],
                                             ["esy-help2man",
                                             "github:esy-packages/esy-help2man#c8e6931d1dcf58a81bd801145a777fd3b115c443"]])}]])],
  ["@opam/conf-libev",
  new Map([["archive:http://dist.schmorp.de/libev/Attic/libev-4.27.tar.gz#sha1:b67aff18f6f1ffec4422e188c98d9fe458c5ed0b",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__conf_libev__7bb9dd3a/",
             packageDependencies: new Map([["@opam/conf-libev",
                                           "archive:http://dist.schmorp.de/libev/Attic/libev-4.27.tar.gz#sha1:b67aff18f6f1ffec4422e188c98d9fe458c5ed0b"]])}]])],
  ["@opam/conf-libssl",
  new Map([["opam:3",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__conf_libssl__opam__c__3__22b43f9d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libssl", "opam:3"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["esy-openssl",
                                             "archive:https://www.openssl.org/source/openssl-1.1.1l.tar.gz#sha256:0b7a3e5e59c34827fe0c3a74b7ec8baef302b98fa80088d7f9153aa16fa76bd1"]])}]])],
  ["@opam/conf-pkg-config",
  new Map([["opam:2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__conf_pkg_config__opam__c__2__f94434f0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["yarn-pkg-config",
                                             "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  ["@opam/cppo",
  new Map([["opam:1.6.9",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__cppo__opam__c__1.6.9__327e8fcf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/csexp",
  new Map([["opam:1.5.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__csexp__opam__c__1.5.2__d986413e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/cstruct",
  new Map([["opam:6.2.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__cstruct__opam__c__6.2.0__cdef52c2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/digestif",
  new Map([["opam:1.1.4",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__digestif__opam__c__1.1.4__f22cdb86/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/digestif", "opam:1.1.4"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/eqaf", "opam:0.9"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dream",
  new Map([["opam:1.0.0~alpha5",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dream__opam__c__1.0.0~alpha5__9a2769f1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.1.0"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/caqti", "opam:1.9.0"],
                                             ["@opam/caqti-lwt",
                                             "opam:1.9.0"],
                                             ["@opam/conf-libev",
                                             "archive:http://dist.schmorp.de/libev/Attic/libev-4.27.tar.gz#sha1:b67aff18f6f1ffec4422e188c98d9fe458c5ed0b"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dream",
                                             "opam:1.0.0~alpha5"],
                                             ["@opam/dream-httpaf",
                                             "opam:1.0.0~alpha2"],
                                             ["@opam/dream-pure",
                                             "opam:1.0.0~alpha2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/graphql-lwt",
                                             "opam:0.14.0"],
                                             ["@opam/graphql_parser",
                                             "opam:0.14.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/lwt_ppx", "opam:2.1.0"],
                                             ["@opam/lwt_ssl", "opam:1.2.0"],
                                             ["@opam/magic-mime",
                                             "opam:1.3.0"],
                                             ["@opam/mirage-clock",
                                             "opam:4.2.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.11.1"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.11.1"],
                                             ["@opam/mirage-crypto-rng-lwt",
                                             "opam:0.11.1"],
                                             ["@opam/multipart_form",
                                             "opam:0.5.0"],
                                             ["@opam/multipart_form-lwt",
                                             "opam:0.5.0"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/ssl", "opam:0.7.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["@opam/yojson", "opam:2.1.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dream-httpaf",
  new Map([["opam:1.0.0~alpha2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dream_httpaf__opam__c__1.0.0~alpha2__278887f6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/base64", "opam:3.5.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/digestif", "opam:1.1.4"],
                                             ["@opam/dream-httpaf",
                                             "opam:1.0.0~alpha2"],
                                             ["@opam/dream-pure",
                                             "opam:1.0.0~alpha2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/faraday", "opam:0.8.2"],
                                             ["@opam/faraday-lwt-unix",
                                             "opam:0.8.2"],
                                             ["@opam/ke", "opam:0.6"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/lwt_ppx", "opam:2.1.0"],
                                             ["@opam/lwt_ssl", "opam:1.2.0"],
                                             ["@opam/psq", "opam:0.2.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/ssl", "opam:0.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dream-pure",
  new Map([["opam:1.0.0~alpha2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dream_pure__opam__c__1.0.0~alpha2__b7f756c5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base64", "opam:3.5.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dream-pure",
                                             "opam:1.0.0~alpha2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/lwt_ppx", "opam:2.1.0"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dune",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dune__opam__c__3.10.0__cd773bfa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dune-build-info",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dune_build_info__opam__c__3.10.0__b4cf9ac2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dune-configurator",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dune_configurator__opam__c__3.10.0__b903aba5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dune-rpc",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dune_rpc__opam__c__3.10.0__fe0ce024/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-rpc",
                                             "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/ordering",
                                             "opam:3.10.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["@opam/stdune", "opam:3.10.0"],
                                             ["@opam/xdg", "opam:3.10.0"]])}]])],
  ["@opam/duration",
  new Map([["opam:0.2.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__duration__opam__c__0.2.1__47dede4e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/duration", "opam:0.2.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/dyn",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__dyn__opam__c__3.10.0__365ea3ab/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/ordering",
                                             "opam:3.10.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/eqaf",
  new Map([["opam:0.9",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__eqaf__opam__c__0.9__a8a52410/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/eqaf", "opam:0.9"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/faraday",
  new Map([["opam:0.8.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__faraday__opam__c__0.8.2__3b4fa51d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/faraday", "opam:0.8.2"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/faraday-lwt",
  new Map([["opam:0.8.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__faraday_lwt__opam__c__0.8.2__0d0042ac/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/faraday", "opam:0.8.2"],
                                             ["@opam/faraday-lwt",
                                             "opam:0.8.2"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/faraday-lwt-unix",
  new Map([["opam:0.8.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__faraday_lwt_unix__opam__c__0.8.2__2233f855/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/faraday-lwt",
                                             "opam:0.8.2"],
                                             ["@opam/faraday-lwt-unix",
                                             "opam:0.8.2"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/fiber",
  new Map([["opam:3.7.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__fiber__opam__c__3.7.0__283d7f54/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/fiber", "opam:3.7.0"],
                                             ["@opam/stdune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/fix",
  new Map([["opam:20230505",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__fix__opam__c__20230505__c9f697a2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fix", "opam:20230505"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/fmt",
  new Map([["opam:0.9.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__fmt__opam__c__0.9.0__2f7f274d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/graphql",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__graphql__opam__c__0.14.0__3b53d072/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/graphql", "opam:0.14.0"],
                                             ["@opam/graphql_parser",
                                             "opam:0.14.0"],
                                             ["@opam/rresult", "opam:0.7.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/yojson", "opam:2.1.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/graphql-lwt",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__graphql_lwt__opam__c__0.14.0__c49e0a78/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/graphql", "opam:0.14.0"],
                                             ["@opam/graphql-lwt",
                                             "opam:0.14.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/graphql_parser",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__graphql__parser__opam__c__0.14.0__ccdb35fa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/graphql_parser",
                                             "opam:0.14.0"],
                                             ["@opam/menhir",
                                             "opam:20230608"],
                                             ["@opam/re", "opam:1.10.4"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/hmap",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ke",
  new Map([["opam:0.6",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ke__opam__c__0.6__85dc60de/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/ke", "opam:0.6"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/logs",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__logs__opam__c__0.7.0__da3c2fe0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/lwt",
  new Map([["opam:5.7.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__lwt__opam__c__5.7.0__028524d8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/conf-libev",
                                             "archive:http://dist.schmorp.de/libev/Attic/libev-4.27.tar.gz#sha1:b67aff18f6f1ffec4422e188c98d9fe458c5ed0b"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.2"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/lwt_ppx",
  new Map([["opam:2.1.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__lwt__ppx__opam__c__2.1.0__0ca5f7dc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/lwt_ppx", "opam:2.1.0"],
                                             ["@opam/ppxlib", "opam:0.29.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/lwt_ssl",
  new Map([["opam:1.2.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__lwt__ssl__opam__c__1.2.0__580f9f87/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/lwt_ssl", "opam:1.2.0"],
                                             ["@opam/ssl", "opam:0.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/magic-mime",
  new Map([["opam:1.3.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__magic_mime__opam__c__1.3.0__6c4c7d76/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/magic-mime",
                                             "opam:1.3.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/menhir",
  new Map([["opam:20230608",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__menhir__opam__c__20230608__0810eba1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/menhir",
                                             "opam:20230608"],
                                             ["@opam/menhirLib",
                                             "opam:20230608"],
                                             ["@opam/menhirSdk",
                                             "opam:20230608"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/menhirLib",
  new Map([["opam:20230608",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__menhirlib__opam__c__20230608__a7ac68c6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/menhirLib",
                                             "opam:20230608"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/menhirSdk",
  new Map([["opam:20230608",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__menhirsdk__opam__c__20230608__73ffbfe2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/menhirSdk",
                                             "opam:20230608"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/merlin-extend",
  new Map([["opam:0.6.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__merlin_extend__opam__c__0.6.1__d2c1532e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/merlin-extend",
                                             "opam:0.6.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/merlin-lib",
  new Map([["opam:4.9-414",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__merlin_lib__opam__c__4.9_414__54a1a09b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/merlin-lib",
                                             "opam:4.9-414"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/mirage-clock",
  new Map([["opam:4.2.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__mirage_clock__opam__c__4.2.0__56880d81/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/mirage-clock",
                                             "opam:4.2.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/mirage-crypto",
  new Map([["opam:0.11.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__mirage_crypto__opam__c__0.11.1__27573702/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["@opam/eqaf", "opam:0.9"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.11.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/mirage-crypto-rng",
  new Map([["opam:0.11.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__mirage_crypto_rng__opam__c__0.11.1__f4560324/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["@opam/duration", "opam:0.2.1"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.11.1"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.11.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/mirage-crypto-rng-lwt",
  new Map([["opam:0.11.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__mirage_crypto_rng_lwt__opam__c__0.11.1__b20c5265/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/duration", "opam:0.2.1"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.11.1"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.11.1"],
                                             ["@opam/mirage-crypto-rng-lwt",
                                             "opam:0.11.1"],
                                             ["@opam/mtime", "opam:2.0.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/mtime",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__mtime__opam__c__2.0.0__012608b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/mtime", "opam:2.0.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/multipart_form",
  new Map([["opam:0.5.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__multipart__form__opam__c__0.5.0__bb803b92/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/base64", "opam:3.5.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/ke", "opam:0.6"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/multipart_form",
                                             "opam:0.5.0"],
                                             ["@opam/pecu", "opam:0.6"],
                                             ["@opam/prettym", "opam:0.0.3"],
                                             ["@opam/unstrctrd", "opam:0.3"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/multipart_form-lwt",
  new Map([["opam:0.5.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__multipart__form_lwt__opam__c__0.5.0__2626425a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ke", "opam:0.6"],
                                             ["@opam/lwt", "opam:5.7.0"],
                                             ["@opam/multipart_form",
                                             "opam:0.5.0"],
                                             ["@opam/multipart_form-lwt",
                                             "opam:0.5.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocaml-compiler-libs",
  new Map([["opam:v0.12.4",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__35cddb8b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocaml-lsp-server",
  new Map([["opam:1.16.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.16.2__ccbb0aef/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/chrome-trace",
                                             "opam:3.10.0"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.10.0"],
                                             ["@opam/dune-rpc",
                                             "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/fiber", "opam:3.7.0"],
                                             ["@opam/merlin-lib",
                                             "opam:4.9-414"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.16.2"],
                                             ["@opam/ocamlc-loc",
                                             "opam:3.10.0"],
                                             ["@opam/ocamlformat-rpc-lib",
                                             "opam:0.26.0"],
                                             ["@opam/odoc-parser",
                                             "opam:2.0.0"],
                                             ["@opam/ordering",
                                             "opam:3.10.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.16.0"],
                                             ["@opam/re", "opam:1.10.4"],
                                             ["@opam/spawn", "opam:v0.15.1"],
                                             ["@opam/stdune", "opam:3.10.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["@opam/xdg", "opam:3.10.0"],
                                             ["@opam/yojson", "opam:2.1.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocaml-syntax-shims",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocamlbuild",
  new Map([["opam:0.14.2+win",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.2+win__45651b9d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocamlc-loc",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocamlc_loc__opam__c__3.10.0__5227c53b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/ocamlc-loc",
                                             "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocamlfind",
  new Map([["opam:1.9.6",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocamlfind__opam__c__1.9.6__84cbadfb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocamlformat-rpc-lib",
  new Map([["opam:0.26.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocamlformat_rpc_lib__opam__c__0.26.0__608d8506/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocamlformat-rpc-lib",
                                             "opam:0.26.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ocplib-endian",
  new Map([["opam:1.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ocplib_endian__opam__c__1.2__572dceaf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.2"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/odoc-parser",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__odoc_parser__opam__c__2.0.0__aafafc33/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/odoc-parser",
                                             "opam:2.0.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ordering",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ordering__opam__c__3.10.0__6909349a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ordering",
                                             "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/pecu",
  new Map([["opam:0.6",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__pecu__opam__c__0.6__7c76fd36/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/pecu", "opam:0.6"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/pp",
  new Map([["opam:1.1.2",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__pp__opam__c__1.1.2__ebad31ff/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ppx_derivers",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ppx_yojson_conv_lib",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.16.0__d6ba8277/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.16.0"],
                                             ["@opam/yojson", "opam:2.1.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ppxlib",
  new Map([["opam:0.29.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ppxlib__opam__c__0.29.1__17823afa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib", "opam:0.29.1"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/prettym",
  new Map([["opam:0.0.3",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__prettym__opam__c__0.0.3__983d2b4e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-overlap",
                                             "opam:0.2.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/ke", "opam:0.6"],
                                             ["@opam/prettym", "opam:0.0.3"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/psq",
  new Map([["opam:0.2.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__psq__opam__c__0.2.1__dc38ca7c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/psq", "opam:0.2.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ptime",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ptime__opam__c__1.1.0__4fdf2d49/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/re",
  new Map([["opam:1.10.4",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__re__opam__c__1.10.4__39debd71/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/re", "opam:1.10.4"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/reason",
  new Map([["opam:3.9.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__reason__opam__c__3.9.0__79d677a9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.10.0"],
                                             ["@opam/fix", "opam:20230505"],
                                             ["@opam/menhir",
                                             "opam:20230608"],
                                             ["@opam/merlin-extend",
                                             "opam:0.6.1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib", "opam:0.29.1"],
                                             ["@opam/reason", "opam:3.9.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/result",
  new Map([["opam:1.5",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/rresult",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__rresult__opam__c__0.7.0__46070e80/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/rresult", "opam:0.7.0"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/seq",
  new Map([["opam:base",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/sexplib0",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__sexplib0__opam__c__v0.16.0__c52bdb53/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/spawn",
  new Map([["opam:v0.15.1",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__spawn__opam__c__v0.15.1__cdb37477/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/spawn", "opam:v0.15.1"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/ssl",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__ssl__opam__c__0.7.0__e43d39f9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libssl", "opam:3"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.10.0"],
                                             ["@opam/ssl", "opam:0.7.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/stdlib-shims",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/stdune",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__stdune__opam__c__3.10.0__a100e9d2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/dyn", "opam:3.10.0"],
                                             ["@opam/ordering",
                                             "opam:3.10.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["@opam/stdune", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/stringext",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__stringext__opam__c__1.6.0__199e37a7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/topkg",
  new Map([["opam:1.0.7",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__topkg__opam__c__1.0.7__64f1b51f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/unstrctrd",
  new Map([["opam:0.3",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__unstrctrd__opam__c__0.3__1990b6de/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/unstrctrd", "opam:0.3"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/uri",
  new Map([["opam:4.2.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__uri__opam__c__4.2.0__9b4b8867/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/uutf",
  new Map([["opam:1.0.3",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__uutf__opam__c__1.0.3__8c042452/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.2+win"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/xdg",
  new Map([["opam:3.10.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__xdg__opam__c__3.10.0__cf9247df/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/xdg", "opam:3.10.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["@opam/yojson",
  new Map([["opam:2.1.0",
           {
             packageLocation: "/home/jacob/.esy/source/i/opam__s__yojson__opam__c__2.1.0__2bfdb164/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/yojson", "opam:2.1.0"],
                                             ["ocaml", "4.14.1000"]])}]])],
  ["esy-help2man",
  new Map([["github:esy-packages/esy-help2man#c8e6931d1dcf58a81bd801145a777fd3b115c443",
           {
             packageLocation: "/home/jacob/.esy/source/i/esy_help2man__b3621e54/",
             packageDependencies: new Map([["esy-help2man",
                                           "github:esy-packages/esy-help2man#c8e6931d1dcf58a81bd801145a777fd3b115c443"]])}]])],
  ["esy-openssl",
  new Map([["archive:https://www.openssl.org/source/openssl-1.1.1l.tar.gz#sha256:0b7a3e5e59c34827fe0c3a74b7ec8baef302b98fa80088d7f9153aa16fa76bd1",
           {
             packageLocation: "/home/jacob/.esy/source/i/esy_openssl__f305f612/",
             packageDependencies: new Map([["@opam/conf-autoconf",
                                           "github:esy-packages/esy-autoconf:package.json#fb93edf"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["esy-openssl",
                                             "archive:https://www.openssl.org/source/openssl-1.1.1l.tar.gz#sha256:0b7a3e5e59c34827fe0c3a74b7ec8baef302b98fa80088d7f9153aa16fa76bd1"]])}]])],
  ["ocaml",
  new Map([["4.14.1000",
           {
             packageLocation: "/home/jacob/.esy/source/i/ocaml__4.14.1000__cecb4e0a/",
             packageDependencies: new Map([["ocaml", "4.14.1000"]])}]])],
  ["yarn-pkg-config",
  new Map([["github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79",
           {
             packageLocation: "/home/jacob/.esy/source/i/yarn_pkg_config__9829fc81/",
             packageDependencies: new Map([["yarn-pkg-config",
                                           "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/mnt/part3/src/example/w-fullstack-rescript/",
             packageDependencies: new Map([["@opam/conf-libssl", "opam:3"],
                                             ["@opam/dream",
                                             "opam:1.0.0~alpha5"],
                                             ["@opam/dune", "opam:3.10.0"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.16.2"],
                                             ["@opam/reason", "opam:3.9.0"],
                                             ["ocaml", "4.14.1000"]])}]])]]);

let topLevelLocatorPath = "../../";
let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../../../../../home/jacob/.esy/source/i/esy_help2man__b3621e54/",
  {
    name: "esy-help2man",
    reference: "github:esy-packages/esy-help2man#c8e6931d1dcf58a81bd801145a777fd3b115c443"}],
  ["../../../../../../../home/jacob/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
  {
    name: "@esy-ocaml/substs",
    reference: "0.0.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/esy_openssl__f305f612/",
  {
    name: "esy-openssl",
    reference: "archive:https://www.openssl.org/source/openssl-1.1.1l.tar.gz#sha256:0b7a3e5e59c34827fe0c3a74b7ec8baef302b98fa80088d7f9153aa16fa76bd1"}],
  ["../../../../../../../home/jacob/.esy/source/i/ocaml__4.14.1000__cecb4e0a/",
  {
    name: "ocaml",
    reference: "4.14.1000"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__angstrom__opam__c__0.15.0__c5dca2a1/",
  {
    name: "@opam/angstrom",
    reference: "opam:0.15.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
  {
    name: "@opam/astring",
    reference: "opam:0.8.5"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__base64__opam__c__3.5.1__28596b1d/",
  {
    name: "@opam/base64",
    reference: "opam:3.5.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
  {
    name: "@opam/base-bytes",
    reference: "opam:base"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
  {
    name: "@opam/base-threads",
    reference: "opam:base"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
  {
    name: "@opam/base-unix",
    reference: "opam:base"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__bigarray_compat__opam__c__1.1.0__ec432e34/",
  {
    name: "@opam/bigarray-compat",
    reference: "opam:1.1.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__bigarray_overlap__opam__c__0.2.1__470919ab/",
  {
    name: "@opam/bigarray-overlap",
    reference: "opam:0.2.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__bigstringaf__opam__c__0.9.1__94edc918/",
  {
    name: "@opam/bigstringaf",
    reference: "opam:0.9.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__camlp_streams__opam__c__5.0.1__35498539/",
  {
    name: "@opam/camlp-streams",
    reference: "opam:5.0.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__caqti__opam__c__1.9.0__15467c92/",
  {
    name: "@opam/caqti",
    reference: "opam:1.9.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__caqti_lwt__opam__c__1.9.0__28b8c95f/",
  {
    name: "@opam/caqti-lwt",
    reference: "opam:1.9.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__chrome_trace__opam__c__3.10.0__a2a9c161/",
  {
    name: "@opam/chrome-trace",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__conf_autoconf__823a11c2/",
  {
    name: "@opam/conf-autoconf",
    reference: "github:esy-packages/esy-autoconf:package.json#fb93edf"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__conf_libev__7bb9dd3a/",
  {
    name: "@opam/conf-libev",
    reference: "archive:http://dist.schmorp.de/libev/Attic/libev-4.27.tar.gz#sha1:b67aff18f6f1ffec4422e188c98d9fe458c5ed0b"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__conf_libssl__opam__c__3__22b43f9d/",
  {
    name: "@opam/conf-libssl",
    reference: "opam:3"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__conf_pkg_config__opam__c__2__f94434f0/",
  {
    name: "@opam/conf-pkg-config",
    reference: "opam:2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__cppo__opam__c__1.6.9__327e8fcf/",
  {
    name: "@opam/cppo",
    reference: "opam:1.6.9"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__csexp__opam__c__1.5.2__d986413e/",
  {
    name: "@opam/csexp",
    reference: "opam:1.5.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__cstruct__opam__c__6.2.0__cdef52c2/",
  {
    name: "@opam/cstruct",
    reference: "opam:6.2.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__digestif__opam__c__1.1.4__f22cdb86/",
  {
    name: "@opam/digestif",
    reference: "opam:1.1.4"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dream__opam__c__1.0.0~alpha5__9a2769f1/",
  {
    name: "@opam/dream",
    reference: "opam:1.0.0~alpha5"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dream_httpaf__opam__c__1.0.0~alpha2__278887f6/",
  {
    name: "@opam/dream-httpaf",
    reference: "opam:1.0.0~alpha2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dream_pure__opam__c__1.0.0~alpha2__b7f756c5/",
  {
    name: "@opam/dream-pure",
    reference: "opam:1.0.0~alpha2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dune__opam__c__3.10.0__cd773bfa/",
  {
    name: "@opam/dune",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dune_build_info__opam__c__3.10.0__b4cf9ac2/",
  {
    name: "@opam/dune-build-info",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dune_configurator__opam__c__3.10.0__b903aba5/",
  {
    name: "@opam/dune-configurator",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dune_rpc__opam__c__3.10.0__fe0ce024/",
  {
    name: "@opam/dune-rpc",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__duration__opam__c__0.2.1__47dede4e/",
  {
    name: "@opam/duration",
    reference: "opam:0.2.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__dyn__opam__c__3.10.0__365ea3ab/",
  {
    name: "@opam/dyn",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__eqaf__opam__c__0.9__a8a52410/",
  {
    name: "@opam/eqaf",
    reference: "opam:0.9"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__faraday__opam__c__0.8.2__3b4fa51d/",
  {
    name: "@opam/faraday",
    reference: "opam:0.8.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__faraday_lwt__opam__c__0.8.2__0d0042ac/",
  {
    name: "@opam/faraday-lwt",
    reference: "opam:0.8.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__faraday_lwt_unix__opam__c__0.8.2__2233f855/",
  {
    name: "@opam/faraday-lwt-unix",
    reference: "opam:0.8.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__fiber__opam__c__3.7.0__283d7f54/",
  {
    name: "@opam/fiber",
    reference: "opam:3.7.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__fix__opam__c__20230505__c9f697a2/",
  {
    name: "@opam/fix",
    reference: "opam:20230505"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__fmt__opam__c__0.9.0__2f7f274d/",
  {
    name: "@opam/fmt",
    reference: "opam:0.9.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__graphql__opam__c__0.14.0__3b53d072/",
  {
    name: "@opam/graphql",
    reference: "opam:0.14.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__graphql__parser__opam__c__0.14.0__ccdb35fa/",
  {
    name: "@opam/graphql_parser",
    reference: "opam:0.14.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__graphql_lwt__opam__c__0.14.0__c49e0a78/",
  {
    name: "@opam/graphql-lwt",
    reference: "opam:0.14.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
  {
    name: "@opam/hmap",
    reference: "opam:0.8.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ke__opam__c__0.6__85dc60de/",
  {
    name: "@opam/ke",
    reference: "opam:0.6"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__logs__opam__c__0.7.0__da3c2fe0/",
  {
    name: "@opam/logs",
    reference: "opam:0.7.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__lwt__opam__c__5.7.0__028524d8/",
  {
    name: "@opam/lwt",
    reference: "opam:5.7.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__lwt__ppx__opam__c__2.1.0__0ca5f7dc/",
  {
    name: "@opam/lwt_ppx",
    reference: "opam:2.1.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__lwt__ssl__opam__c__1.2.0__580f9f87/",
  {
    name: "@opam/lwt_ssl",
    reference: "opam:1.2.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__magic_mime__opam__c__1.3.0__6c4c7d76/",
  {
    name: "@opam/magic-mime",
    reference: "opam:1.3.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__menhir__opam__c__20230608__0810eba1/",
  {
    name: "@opam/menhir",
    reference: "opam:20230608"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__menhirlib__opam__c__20230608__a7ac68c6/",
  {
    name: "@opam/menhirLib",
    reference: "opam:20230608"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__menhirsdk__opam__c__20230608__73ffbfe2/",
  {
    name: "@opam/menhirSdk",
    reference: "opam:20230608"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__merlin_extend__opam__c__0.6.1__d2c1532e/",
  {
    name: "@opam/merlin-extend",
    reference: "opam:0.6.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__merlin_lib__opam__c__4.9_414__54a1a09b/",
  {
    name: "@opam/merlin-lib",
    reference: "opam:4.9-414"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__mirage_clock__opam__c__4.2.0__56880d81/",
  {
    name: "@opam/mirage-clock",
    reference: "opam:4.2.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__mirage_crypto__opam__c__0.11.1__27573702/",
  {
    name: "@opam/mirage-crypto",
    reference: "opam:0.11.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__mirage_crypto_rng__opam__c__0.11.1__f4560324/",
  {
    name: "@opam/mirage-crypto-rng",
    reference: "opam:0.11.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__mirage_crypto_rng_lwt__opam__c__0.11.1__b20c5265/",
  {
    name: "@opam/mirage-crypto-rng-lwt",
    reference: "opam:0.11.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__mtime__opam__c__2.0.0__012608b8/",
  {
    name: "@opam/mtime",
    reference: "opam:2.0.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__multipart__form__opam__c__0.5.0__bb803b92/",
  {
    name: "@opam/multipart_form",
    reference: "opam:0.5.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__multipart__form_lwt__opam__c__0.5.0__2626425a/",
  {
    name: "@opam/multipart_form-lwt",
    reference: "opam:0.5.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__35cddb8b/",
  {
    name: "@opam/ocaml-compiler-libs",
    reference: "opam:v0.12.4"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.16.2__ccbb0aef/",
  {
    name: "@opam/ocaml-lsp-server",
    reference: "opam:1.16.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
  {
    name: "@opam/ocaml-syntax-shims",
    reference: "opam:1.0.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.2+win__45651b9d/",
  {
    name: "@opam/ocamlbuild",
    reference: "opam:0.14.2+win"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocamlc_loc__opam__c__3.10.0__5227c53b/",
  {
    name: "@opam/ocamlc-loc",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocamlfind__opam__c__1.9.6__84cbadfb/",
  {
    name: "@opam/ocamlfind",
    reference: "opam:1.9.6"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocamlformat_rpc_lib__opam__c__0.26.0__608d8506/",
  {
    name: "@opam/ocamlformat-rpc-lib",
    reference: "opam:0.26.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ocplib_endian__opam__c__1.2__572dceaf/",
  {
    name: "@opam/ocplib-endian",
    reference: "opam:1.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__odoc_parser__opam__c__2.0.0__aafafc33/",
  {
    name: "@opam/odoc-parser",
    reference: "opam:2.0.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ordering__opam__c__3.10.0__6909349a/",
  {
    name: "@opam/ordering",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__pecu__opam__c__0.6__7c76fd36/",
  {
    name: "@opam/pecu",
    reference: "opam:0.6"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__pp__opam__c__1.1.2__ebad31ff/",
  {
    name: "@opam/pp",
    reference: "opam:1.1.2"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
  {
    name: "@opam/ppx_derivers",
    reference: "opam:1.2.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.16.0__d6ba8277/",
  {
    name: "@opam/ppx_yojson_conv_lib",
    reference: "opam:v0.16.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ppxlib__opam__c__0.29.1__17823afa/",
  {
    name: "@opam/ppxlib",
    reference: "opam:0.29.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__prettym__opam__c__0.0.3__983d2b4e/",
  {
    name: "@opam/prettym",
    reference: "opam:0.0.3"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__psq__opam__c__0.2.1__dc38ca7c/",
  {
    name: "@opam/psq",
    reference: "opam:0.2.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ptime__opam__c__1.1.0__4fdf2d49/",
  {
    name: "@opam/ptime",
    reference: "opam:1.1.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__re__opam__c__1.10.4__39debd71/",
  {
    name: "@opam/re",
    reference: "opam:1.10.4"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__reason__opam__c__3.9.0__79d677a9/",
  {
    name: "@opam/reason",
    reference: "opam:3.9.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
  {
    name: "@opam/result",
    reference: "opam:1.5"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__rresult__opam__c__0.7.0__46070e80/",
  {
    name: "@opam/rresult",
    reference: "opam:0.7.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
  {
    name: "@opam/seq",
    reference: "opam:base"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__sexplib0__opam__c__v0.16.0__c52bdb53/",
  {
    name: "@opam/sexplib0",
    reference: "opam:v0.16.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__spawn__opam__c__v0.15.1__cdb37477/",
  {
    name: "@opam/spawn",
    reference: "opam:v0.15.1"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__ssl__opam__c__0.7.0__e43d39f9/",
  {
    name: "@opam/ssl",
    reference: "opam:0.7.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
  {
    name: "@opam/stdlib-shims",
    reference: "opam:0.3.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__stdune__opam__c__3.10.0__a100e9d2/",
  {
    name: "@opam/stdune",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__stringext__opam__c__1.6.0__199e37a7/",
  {
    name: "@opam/stringext",
    reference: "opam:1.6.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__topkg__opam__c__1.0.7__64f1b51f/",
  {
    name: "@opam/topkg",
    reference: "opam:1.0.7"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__unstrctrd__opam__c__0.3__1990b6de/",
  {
    name: "@opam/unstrctrd",
    reference: "opam:0.3"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__uri__opam__c__4.2.0__9b4b8867/",
  {
    name: "@opam/uri",
    reference: "opam:4.2.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__uutf__opam__c__1.0.3__8c042452/",
  {
    name: "@opam/uutf",
    reference: "opam:1.0.3"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__xdg__opam__c__3.10.0__cf9247df/",
  {
    name: "@opam/xdg",
    reference: "opam:3.10.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/opam__s__yojson__opam__c__2.1.0__2bfdb164/",
  {
    name: "@opam/yojson",
    reference: "opam:2.1.0"}],
  ["../../../../../../../home/jacob/.esy/source/i/yarn_pkg_config__9829fc81/",
  {
    name: "yarn-pkg-config",
    reference: "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 100 && relativeLocation[99] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 100)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 98 && relativeLocation[97] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 98)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 97 && relativeLocation[96] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 97)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 96 && relativeLocation[95] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 96)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 95 && relativeLocation[94] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 95)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 94 && relativeLocation[93] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 94)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 93 && relativeLocation[92] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 93)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 92 && relativeLocation[91] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 92)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 91 && relativeLocation[90] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 91)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 90 && relativeLocation[89] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 90)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 89 && relativeLocation[88] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 89)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 88 && relativeLocation[87] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 88)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 87 && relativeLocation[86] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 87)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 86 && relativeLocation[85] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 86)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 85 && relativeLocation[84] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 85)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 84 && relativeLocation[83] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 84)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 82 && relativeLocation[81] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 82)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 79 && relativeLocation[78] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 79)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 76 && relativeLocation[75] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 76)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 73 && relativeLocation[72] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 73)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 72 && relativeLocation[71] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 72)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 69 && relativeLocation[68] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 69)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 68 && relativeLocation[67] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 68)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

    /*
      this can only happen if inside the _esy
      as any other path will implies the opposite

      topLevelLocatorPath = ../../

      | folder              | relativeLocation |
      | ------------------- | ---------------- |
      | /workspace/app      | ../../           |
      | /workspace          | ../../../        |
      | /workspace/app/x    | ../../x/         |
      | /workspace/app/_esy | ../              |

    */
    if (!relativeLocation.startsWith(topLevelLocatorPath)) {
      return topLevelLocator;
    }
    return null;
  };
  

/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "$$BLACKLIST")`,
        {
          request,
          issuer
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {extensions});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath);
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    const issuerModule = getIssuerModule(parent);
    const issuer = issuerModule ? issuerModule.filename : process.cwd() + '/';

    const resolution = exports.resolveRequest(request, issuer);
    return resolution !== null ? resolution : request;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);

  if (process.env.ESY__NODE_BIN_PATH != null) {
    const delimiter = require('path').delimiter;
    process.env.PATH = `${process.env.ESY__NODE_BIN_PATH}${delimiter}${process.env.PATH}`;
  }
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        }
      }
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
