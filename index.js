'use strict';
const assert = require('assert');
const minimatch = require('minimatch');
const glob = require('glob');
const path = require('path');
const slash = require('slash'); // fixes slashes in file paths for windows

const PLUGIN_NAME = 'HtmlWebpackTagsPlugin';

const IS = {
  isDefined: v => v !== void 0,
  isObject: v => v !== null && v !== void 0 && typeof v === 'object' && !Array.isArray(v),
  isBoolean: v => v === true || v === false,
  isNumber: v => v !== void 0 && (typeof v === 'number' || v instanceof Number) && isFinite(v),
  isString: v => v !== null && v !== void 0 && (typeof v === 'string' || v instanceof String),
  isArray: v => Array.isArray(v),
  isFunction: v => typeof v === 'function'
};

const { isDefined, isObject, isBoolean, isNumber, isString, isArray, isFunction } = IS;

const DEFAULT_OPTIONS = {
  append: true,
  useHash: false,
  addHash: (assetPath, hash) => assetPath + '?' + hash,
  usePublicPath: true,
  addPublicPath: (assetPath, publicPath) => path.join(publicPath, assetPath),
  jsExtensions: ['.js'],
  cssExtensions: ['.css'],
  tags: [],
  links: [],
  scripts: []
};

const ASSET_TYPE_CSS = 'css';
const ASSET_TYPE_JS = 'js';

const ASSET_TYPES = [ASSET_TYPE_CSS, ASSET_TYPE_JS];

const ATTRIBUTES_TEXT = 'strings, booleans or numbers';

const isValidAttributeValue = v => isString(v) || isBoolean(v) || isNumber(v);

const isType = type => ASSET_TYPES.indexOf(type) !== -1;

const isTypeCss = type => type === ASSET_TYPE_CSS;

const isFunctionReturningString = v => isFunction(v) && isString(v('', ''));

const isArrayOfString = v => isArray(v) && v.every(i => isString(i));

const createExtensionsRegex = extensions => new RegExp(`.*(${extensions.join('|')})$`);

const getExtensions = (options, optionExtensionName, optionPath) => {
  let extensions = DEFAULT_OPTIONS[optionExtensionName];
  if (isDefined(options[optionExtensionName])) {
    if (isString(options[optionExtensionName])) {
      extensions = [options[optionExtensionName]];
    } else {
      extensions = options[optionExtensionName];
      assert(isArray(extensions), `${optionPath}.${optionExtensionName} should be a string or array of strings (${extensions})`);
      extensions.forEach(function (extension) {
        assert(isString(extension), `${optionPath}.${optionExtensionName} array should only contain strings (${extension})`);
      });
    }
  }
  return extensions;
};

const getHasExtensions = (options, optionExtensionName, optionPath) => {
  const regexp = createExtensionsRegex(getExtensions(options, optionExtensionName, optionPath));
  return value => regexp.test(value);
};

const getAssetTypeCheckers = (options, optionPath) => {
  const hasJsExtensions = getHasExtensions(options, 'jsExtensions', optionPath);
  const hasCssExtensions = getHasExtensions(options, 'cssExtensions', optionPath);
  return {
    isAssetTypeCss (value) {
      return hasCssExtensions(value);
    },
    isAssetTypeJs (value) {
      return hasJsExtensions(value);
    }
  };
};

const splitLinkScriptTags = (tagObjects, options, optionName, optionPath) => {
  const linkObjects = [];
  const scriptObjects = [];
  const { isAssetTypeCss, isAssetTypeJs } = getAssetTypeCheckers(options, optionPath);

  tagObjects.forEach(tagObject => {
    if (isDefined(tagObject.type)) {
      const { type, ...others } = tagObject;
      assert(isType(type), `${optionPath}.${optionName} type must be css or js (${type})`);
      (isTypeCss(type) ? linkObjects : scriptObjects).push({
        ...others
      });
    } else {
      const { path } = tagObject;
      if (isAssetTypeCss(path)) {
        linkObjects.push(tagObject);
      } else if (isAssetTypeJs(path)) {
        scriptObjects.push(tagObject);
      } else {
        assert(false, `${optionPath}.${optionName} could not determine asset type for (${path})`);
      }
    }
  });

  return [linkObjects, scriptObjects];
};

const getTagObjects = (tag, optionName, optionPath) => {
  let tagObjects;
  assert(isString(tag) || isObject(tag), `${optionPath}.${optionName} items must be an object or string`);
  if (isString(tag)) {
    tagObjects = [{
      path: tag
    }];
  } else {
    assert(isString(tag.path), `${optionPath}.${optionName} object must have a string path property`);
    if (isDefined(tag.append)) {
      assert(isBoolean(tag.append), `${optionPath}.${optionName} object append should be a boolean`);
    }
    if (isDefined(tag.publicPath)) {
      const { publicPath } = tag;
      assert(isBoolean(publicPath) || isFunctionReturningString(publicPath), `${optionPath}.${optionName} object publicPath should be a boolean or function that returns a string`);
    }
    if (isDefined(tag.hash)) {
      const { hash } = tag;
      assert(isBoolean(hash) || isFunctionReturningString(hash), `${optionPath}.${optionName} object hash should be a boolean or function that returns a string`);
    }
    if (isDefined(tag.sourcePath)) {
      assert(isString(tag.sourcePath), `${optionPath}.${optionName} object should have a string sourcePath property`);
    }
    if (isDefined(tag.attributes)) {
      const { attributes } = tag;
      assert(isObject(attributes), `${optionPath}.${optionName} object should have an object attributes property`);
      Object.keys(attributes).forEach(attribute => {
        const value = attributes[attribute];
        assert(isValidAttributeValue(value), `${optionPath}.${optionName} object attribute values should be ` + ATTRIBUTES_TEXT);
      });
    }
    if (isDefined(tag.glob) || isDefined(tag.globPath)) {
      const { glob: assetGlob, globPath, ...otherAssetProperties } = tag;
      assert(isString(assetGlob), `${optionPath}.${optionName} object should have a string glob property`);
      assert(isString(globPath), `${optionPath}.${optionName} object should have a string globPath property`);
      const globAssets = glob.sync(assetGlob, { cwd: globPath });
      const globAssetPaths = globAssets.map(globAsset => slash(path.join(tag.path, globAsset)));
      assert(globAssetPaths.length > 0, `${optionPath}.${optionName} object glob found no files (${tag.path} ${assetGlob} ${globPath})`);
      tagObjects = [];
      globAssetPaths.forEach(globAssetPath => {
        tagObjects.push({
          ...otherAssetProperties,
          path: globAssetPath
        });
      });
    } else {
      tagObjects = [tag];
    }
  }
  return tagObjects;
};

const getValidatedTagObjects = (options, optionName, optionPath) => {
  let tagObjects;
  if (isDefined(options[optionName])) {
    const tags = options[optionName];
    assert(isString(tags) || isObject(tags) || isArray(tags), `${optionPath}.${optionName} should be a string, object, or array (${tags})`);
    if (isArray(tags)) {
      tagObjects = [];
      tags.forEach(asset => {
        tagObjects = tagObjects.concat(getTagObjects(asset, optionName, optionPath));
      });
    } else {
      tagObjects = getTagObjects(tags, optionName, optionPath);
    }
  }
  return tagObjects;
};

const getAllTagObjects = (options, append, optionName, optionPath) => {
  let tagObjects = getValidatedTagObjects(options, optionName, optionPath);
  if (tagObjects) {
    tagObjects = tagObjects.map(tag => {
      if (!isDefined(tag.append)) {
        tag = {
          ...tag,
          append: append
        };
      }
      return tag;
    });
  }
  return tagObjects;
};

const validateTagObjectExternals = (tagObjects, isScript, optionName, optionPath) => {
  if (isArray(tagObjects)) {
    tagObjects.forEach(tagObject => {
      if (isObject(tagObject) && isDefined(tagObject.external)) {
        const { external } = tagObject;
        if (isScript) {
          assert(isObject(external), `${optionPath}.${optionName}.external should be an object`);
          const { packageName, variableName } = external;
          assert(isString(packageName) || isString(variableName), `${optionPath}.${optionName}.external should have a string packageName and variableName property`);
          assert(isString(packageName), `${optionPath}.${optionName}.external should have a string packageName property`);
          assert(isString(variableName), `${optionPath}.${optionName}.external should have a string variableName property`);
        } else {
          assert(false, `${optionPath}.${optionName}.external should not be used on non script tags`);
        }
      }
    });
  }
};

const getShouldSkip = files => {
  let shouldSkip = () => false;
  if (isDefined(files)) {
    shouldSkip = htmlPluginData => !files.some(function (file) {
      return minimatch(htmlPluginData.outputName, file);
    });
  }
  return shouldSkip;
};

const processShortcuts = (options, optionPath, keyShortcut, keyUse, keyAdd, add) => {
  const processedOptions = {};
  if (isDefined(options[keyUse]) || isDefined(options[keyAdd])) {
    assert(!isDefined(options[keyShortcut]), `${optionPath}.${keyShortcut} should not be used with either ${keyUse} or ${keyAdd}`);
    if (isDefined(options[keyUse])) {
      assert(isBoolean(options[keyUse]), `${optionPath}.${keyUse} should be a boolean`);
      processedOptions[keyUse] = options[keyUse];
    }
    if (isDefined(options[keyAdd])) {
      assert(isFunctionReturningString(options[keyAdd]), `${optionPath}.${keyAdd} should be a function that returns a string`);
      processedOptions[keyAdd] = options[keyAdd];
    }
  } else if (isDefined(options[keyShortcut])) {
    const shortcut = options[keyShortcut];
    assert(isBoolean(shortcut) || isString(shortcut) || isFunctionReturningString(shortcut),
      `${optionPath}.${keyShortcut} should be a boolean or a string or a function that returns a string`);
    if (isBoolean(shortcut)) {
      processedOptions[keyUse] = shortcut;
    } else if (isString(shortcut)) {
      processedOptions[keyUse] = true;
      processedOptions[keyAdd] = path => add(path, shortcut);
    } else {
      processedOptions[keyUse] = true;
      processedOptions[keyAdd] = shortcut;
    }
  }
  return processedOptions;
};

const getValidatedMainOptions = (options, optionPath, defaultOptions = {}) => {
  assert(isObject(options), `${optionPath} should be an object`);
  let { append, usePublicPath, addPublicPath, useHash, addHash } = defaultOptions;
  if (isDefined(options.append)) {
    assert(isBoolean(options.append), `${optionPath}.append should be a boolean`);
    append = options.append;
  }
  const publicPathOptions = processShortcuts(options, optionPath, 'publicPath', 'usePublicPath', 'addPublicPath', addPublicPath);
  if (isDefined(publicPathOptions.usePublicPath)) {
    usePublicPath = publicPathOptions.usePublicPath;
  }
  if (isDefined(publicPathOptions.addPublicPath)) {
    addPublicPath = publicPathOptions.addPublicPath;
  }
  const hashOptions = processShortcuts(options, optionPath, 'hash', 'useHash', 'addHash', addHash);
  if (isDefined(hashOptions.useHash)) {
    useHash = hashOptions.useHash;
  }
  if (isDefined(hashOptions.addHash)) {
    addHash = hashOptions.addHash;
  }

  return {
    ...defaultOptions,
    append,
    usePublicPath,
    addPublicPath,
    useHash,
    addHash
  };
};

const getValidatedOptions = (options, optionPath, defaultOptions = DEFAULT_OPTIONS) => {
  assert(isObject(options), `${optionPath} should be an object`);

  const { append, usePublicPath, addPublicPath, useHash, addHash } = getValidatedMainOptions(options, optionPath, defaultOptions);

  let { links, scripts } = defaultOptions;
  if (isDefined(options.tags)) {
    const tagObjects = getAllTagObjects(options, append, 'tags', optionPath);
    let [linkObjects, scriptObjects] = splitLinkScriptTags(tagObjects, options, 'tags', optionPath);
    validateTagObjectExternals(linkObjects, false, 'tags', optionPath);
    validateTagObjectExternals(scriptObjects, true, 'tags', optionPath);
    links = links.concat(linkObjects);
    scripts = scripts.concat(scriptObjects);
  }
  if (isDefined(options.links)) {
    let linkObjects = getAllTagObjects(options, append, 'links', optionPath);
    validateTagObjectExternals(linkObjects, false, 'links', optionPath);
    links = links.concat(linkObjects);
  }
  if (isDefined(options.scripts)) {
    let scriptObjects = getAllTagObjects(options, append, 'scripts', optionPath);
    validateTagObjectExternals(scriptObjects, true, 'scripts', optionPath);
    scripts = scripts.concat(scriptObjects);
  }
  const linksPrepend = links.filter(({ append }) => !append);
  const linksAppend = links.filter(({ append }) => append);
  const scriptsPrepend = scripts.filter(({ append }) => !append);
  const scriptsAppend = scripts.filter(({ append }) => append);

  return {
    links,
    linksPrepend,
    linksAppend,
    scripts,
    scriptsPrepend,
    scriptsAppend,
    append,
    usePublicPath,
    addPublicPath,
    useHash,
    addHash
  };
};

const getTagPath = (tagObject, options, webpackPublicPath, compilationHash) => {
  const { usePublicPath, addPublicPath, useHash, addHash } = options;
  const { publicPath, hash } = tagObject;
  let { path } = tagObject;

  if (isDefined(publicPath)) {
    if (publicPath === true) {
      path = addPublicPath(path, webpackPublicPath);
    } else if (isFunction(publicPath)) {
      path = publicPath(path, webpackPublicPath);
    }
  } else if (usePublicPath) {
    path = addPublicPath(path, webpackPublicPath);
  }
  if (isDefined(hash)) {
    if (hash === true) {
      path = addHash(path, compilationHash);
    } else if (isFunction(hash)) {
      path = hash(path, compilationHash);
    }
  } else if (useHash) {
    path = addHash(path, compilationHash);
  }
  return slash(path);
};

const getAllValidatedOptions = (options, optionPath) => {
  const validatedOptions = getValidatedOptions(options, optionPath);
  let { files } = options;
  if (isDefined(files)) {
    assert((isString(files) || isArrayOfString(files)), `${optionPath}.files should be a string or array of strings`);
    if (isString(files)) {
      files = [files];
    }
    return {
      ...validatedOptions,
      files
    };
  }
  return validatedOptions;
};

function HtmlWebpackTagsPlugin (options) {
  const validatedOptions = getAllValidatedOptions(options, PLUGIN_NAME + '.options');

  const shouldSkip = getShouldSkip(validatedOptions.files);

  // Allows tests to be run with html-webpack-plugin v4
  const htmlPluginName = isDefined(options.htmlPluginName) ? options.htmlPluginName : 'html-webpack-plugin';

  this.options = {
    ...validatedOptions,
    shouldSkip,
    htmlPluginName
  };
}

HtmlWebpackTagsPlugin.prototype.apply = function (compiler) {
  const { options } = this;
  const { shouldSkip, htmlPluginName } = options;
  const { scripts, scriptsPrepend, scriptsAppend, linksPrepend, linksAppend } = options;

  const externals = compiler.options.externals || {};
  scripts.forEach(script => {
    const { external } = script;
    if (isObject(external)) {
      externals[external.packageName] = external.variableName;
    }
  });
  compiler.options.externals = externals;

  // Hook into the html-webpack-plugin processing
  const onCompilation = compilation => {
    const onBeforeHtmlGeneration = (htmlPluginData, callback) => {
      if (shouldSkip(htmlPluginData)) {
        if (callback) {
          return callback(null, htmlPluginData);
        } else {
          return Promise.resolve(htmlPluginData);
        }
      }

      const { assets } = htmlPluginData;
      const pluginPublicPath = assets.publicPath;
      const compilationHash = compilation.hash;
      const assetPromises = [];

      const addAsset = assetPath => {
        try {
          return htmlPluginData.plugin.addFileToAssets(assetPath, compilation);
        } catch (err) {
          return Promise.reject(err);
        }
      };

      const getPath = tag => {
        if (isString(tag.sourcePath)) {
          assetPromises.push(addAsset(tag.sourcePath));
        }
        return getTagPath(tag, options, pluginPublicPath, compilationHash);
      };

      const jsPrependPaths = scriptsPrepend.map(getPath);
      const jsAppendPaths = scriptsAppend.map(getPath);

      const cssPrependPaths = linksPrepend.map(getPath);
      const cssAppendPaths = linksAppend.map(getPath);

      assets.js = jsPrependPaths.concat(assets.js).concat(jsAppendPaths);
      assets.css = cssPrependPaths.concat(assets.css).concat(cssAppendPaths);

      Promise.all(assetPromises).then(
        () => {
          if (callback) {
            callback(null, htmlPluginData);
          } else {
            return Promise.resolve(htmlPluginData);
          }
        },
        (err) => {
          if (callback) {
            callback(err);
          } else {
            return Promise.reject(err);
          }
        }
      );
    };

    const onAlterAssetTag = (htmlPluginData, callback) => {
      if (shouldSkip(htmlPluginData)) {
        if (callback) {
          return callback(null, htmlPluginData);
        } else {
          return Promise.resolve(htmlPluginData);
        }
      }

      const pluginHead = htmlPluginData.head ? htmlPluginData.head : htmlPluginData.headTags;
      const pluginBody = htmlPluginData.body ? htmlPluginData.body : htmlPluginData.bodyTags;

      const pluginLinks = pluginHead.filter(({ tagName }) => tagName === 'link');
      const pluginScripts = pluginBody.filter(({ tagName }) => tagName === 'script');

      const headPrepend = pluginLinks.slice(0, linksPrepend.length);
      const headAppend = pluginLinks.slice(pluginLinks.length - linksAppend.length);

      const bodyPrepend = pluginScripts.slice(0, scriptsPrepend.length);
      const bodyAppend = pluginScripts.slice(pluginScripts.length - scriptsAppend.length);

      const copyAttributes = (tags, tagObjects) => {
        tags.forEach((tag, i) => {
          const { attributes } = tagObjects[i];
          if (attributes) {
            const { attributes: tagAttributes } = tag;
            Object.keys(attributes).forEach(attribute => {
              tagAttributes[attribute] = attributes[attribute];
            });
          }
        });
      };

      copyAttributes(headPrepend.concat(headAppend), linksPrepend.concat(linksAppend));
      copyAttributes(bodyPrepend.concat(bodyAppend), scriptsPrepend.concat(scriptsAppend));

      if (callback) {
        callback(null, htmlPluginData);
      } else {
        return Promise.resolve(htmlPluginData);
      }
    };

    // Webpack >= 4
    if (compilation.hooks) {
      // HtmlWebPackPlugin - new
      if (compilation.hooks.htmlWebpackPluginBeforeHtmlGeneration) {
        compilation.hooks.htmlWebpackPluginBeforeHtmlGeneration.tapAsync('htmlWebpackTagsPlugin', onBeforeHtmlGeneration);
        compilation.hooks.htmlWebpackPluginAlterAssetTags.tapAsync('htmlWebpackTagsPlugin', onAlterAssetTag);
      } else {
        const HtmlWebpackPlugin = require(htmlPluginName);
        if (HtmlWebpackPlugin.getHooks) {
          const hooks = HtmlWebpackPlugin.getHooks(compilation);
          const htmlPlugins = compilation.options.plugins.filter(plugin => plugin instanceof HtmlWebpackPlugin);
          if (htmlPlugins.length === 0) {
            const message = "Error running html-webpack-tags-plugin, are you sure you have html-webpack-plugin before it in your webpack config's plugins?";
            throw new Error(message);
          }
          hooks.beforeAssetTagGeneration.tapAsync('htmlWebpackTagsPlugin', onBeforeHtmlGeneration);
          hooks.alterAssetTagGroups.tapAsync('htmlWebpackTagsPlugin', onAlterAssetTag);
        } else {
          const message = "Error running html-webpack-tags-plugin, are you sure you have html-webpack-plugin before it in your webpack config's plugins?";
          throw new Error(message);
        }
      }
    } else {
      // Webpack < 4
      compilation.plugin('html-webpack-plugin-before-html-generation', onBeforeHtmlGeneration);
      compilation.plugin('html-webpack-plugin-alter-asset-tags', onAlterAssetTag);
    }
  };

  // Webpack 4+
  if (compiler.hooks) {
    compiler.hooks.compilation.tap('htmlWebpackTagsPlugin', onCompilation);
  } else {
    // Webpack 3
    compiler.plugin('compilation', onCompilation);
  }
};

HtmlWebpackTagsPlugin.api = {
  IS,
  getValidatedOptions
};

module.exports = HtmlWebpackTagsPlugin;
