/**
 * @license
 * Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

import * as dom5 from 'dom5';
import * as url from 'url';
import * as estree from 'estree';

import {AnalyzedDocument} from './analyzed-document';
import {reduceMetadata} from './ast/document-descriptor';
import * as docs from './ast-utils/docs';
import {HtmlParser, ParsedImport, LocNode} from './parser/html-parser';
import {jsParse} from './ast-utils/js-parse';
import {
  BehaviorDescriptor,
  Descriptor,
  DocumentDescriptor,
  ElementDescriptor,
  FeatureDescriptor,
} from './ast/ast';
import {UrlLoader} from './url-loader/url-loader';
import {UrlResolver} from './url-loader/url-resolver';

var EMPTY_METADATA: DocumentDescriptor = {elements: [], features: [], behaviors: []};

/**
 * Package of a parsed JS script
 */
interface ParsedJS {
  ast: estree.Program;
  scriptElement: dom5.Node;
}

/**
 * Options for `Analyzer.analzye`
 */
interface LoadOptions {
  /**
   * Whether `annotate()` should be skipped.
   */
  noAnnotations?: boolean;
  /**
   * Content to resolve `href` to instead of loading from the file system.
   */
  content?: string;
  /**
   * Whether the generated descriptors should be cleaned of redundant data.
   */
  clean?: boolean;
  /**
   * `xhr` to use XMLHttpRequest.
   * `fs` to use the local filesystem.
   * `permissive` to use the local filesystem and return empty files when a
   * path can't be found.
   * Default is `fs` in node and `xhr` in the browser.
   */
  resolver?: string;
  /**
   * A predicate function that indicates which files should be ignored by
   * the loader. By default all files not located under the dirname
   * of `href` will be ignored.
   */
  filter?: (path:string)=> boolean;
}

/**
 * An Error extended with location metadata.
 */
interface LocError extends Error{
  location: {line: number; column: number};
  ownerDocument: string;
}

/**
 * A database of Polymer metadata defined in HTML
 */
export class Analyzer {
  loader: UrlLoader;

  /**
   * A list of all elements the `Analyzer` has metadata for.
   */
  elements: ElementDescriptor[] = [];
  /**
   * A view into `elements`, keyed by tag name.
   */
  elementsByTagName: {[tagName: string]: ElementDescriptor} = {};

  /**
   * A list of API features added to `Polymer.Base` encountered by the
   * analyzer.
   */
  features: FeatureDescriptor[] = [];

  /**
   * The behaviors collected by the analysis pass.
   */
  behaviors: BehaviorDescriptor[] = [];
  /**
   * The behaviors collected by the analysis pass by name.
   */
  behaviorsByName: {[name:string]: BehaviorDescriptor} = {};

  /**
   * A map, keyed by absolute path, of Document metadata.
   */
  html: {[path: string]: AnalyzedDocument} = {};

  /**
   * A map, keyed by path, of HTML document ASTs.
   */
  parsedDocuments: {[path:string]: dom5.Node} = {};

  /**
   * A map, keyed by path, of JS script ASTs.
   *
   * If the path is an HTML file with multiple scripts,
   * the entry will be an array of scripts.
   */
  parsedScripts: {[path:string]: ParsedJS[]} = {};

  private _htmlParser = new HtmlParser();

  /**
   * A map, keyed by path, of document content.
   */
  private _content: Map<string, string> = new Map();

  private _documents: Map<string, Promise<AnalyzedDocument>> = new Map();
  private _documentDescriptors: Map<string, Promise<DocumentDescriptor>> = new Map();

  /**
   * @param {UrlLoader} loader
   */
  constructor(loader: UrlLoader) {
    this.loader = loader;
  }

  async load(url: string): Promise<AnalyzedDocument> {
    // TODO(justinfagnani): normalize url
    if (this._documents.has(url)) {
      return this._documents.get(url);
    }
    if (!this.loader.canLoad(url)) {
      throw new Error(`Can't load URL: ${url}`);
    }
    // Use an immediately executed async function to create the final Promise
    // synchronously so we can store it in this._documents before any other
    // operations to avoid any race conditions with the loader
    let promise = (async () => {
      let content = await this.loader.load(url);
      return this._parseHTML(content, url);
    })();
    this._documents.set(url, promise);
    return promise;
  };

  /**
   * Returns an `AnalyzedDocument` representing the provided document
   * @private
   * @param  {string} htmlImport Raw text of an HTML document
   * @param  {string} href       The document's URL.
   * @return {AnalyzedDocument}       An  `AnalyzedDocument`
   */
  _parseHTML(htmlImport: string, href: string): AnalyzedDocument {
    if (href in this.html) {
      return this.html[href];
    }
    var depsLoaded: Promise<Object>[] = [];
    var depHrefs: string[] = [];
    var metadataLoaded = Promise.resolve(EMPTY_METADATA);
    var parsed: ParsedImport;
    try {
      parsed = this._htmlParser.parse(htmlImport, href);
    } catch (err) {
      console.error('Error parsing!');
      throw err;
    }
    var htmlLoaded = Promise.resolve(parsed);
    if (parsed.script) {
      metadataLoaded = this._processScripts(parsed.script, href);
    }
    var commentText = parsed.comment.map(function(comment){
      return dom5.getTextContent(comment);
    });
    var pseudoElements = docs.parsePseudoElements(commentText);
    for (const element of pseudoElements) {
      element.contentHref = href;
      this.elements.push(element);
      this.elementsByTagName[element.is] = element;
    }
    metadataLoaded = metadataLoaded.then(function(metadata){
      var metadataEntry: DocumentDescriptor = {
        elements: pseudoElements,
        features: [],
        behaviors: []
      };
      return [metadata, metadataEntry].reduce(reduceMetadata);
    });
    depsLoaded.push(metadataLoaded);


    if (this.loader) {
      var baseUri = href;
      if (parsed.base.length > 1) {
        console.error("Only one base tag per document!");
        throw "Multiple base tags in " + href;
      } else if (parsed.base.length == 1) {
        var baseHref = dom5.getAttribute(parsed.base[0], "href");
        if (baseHref) {
          baseHref = baseHref + "/";
          baseUri = url.resolve(baseUri, baseHref);
        }
      }
      for (const link of parsed.import) {
        var linkurl = dom5.getAttribute(link, 'href');
        if (linkurl) {
          var resolvedUrl = url.resolve(baseUri, linkurl);
          depHrefs.push(resolvedUrl);
          depsLoaded.push(this._dependenciesLoadedFor(resolvedUrl, href));
        }
      }
      for (const styleElement of parsed.style) {
        if (polymerExternalStyle(styleElement)) {
          var styleHref = dom5.getAttribute(styleElement, 'href');
          if (href) {
            styleHref = url.resolve(baseUri, styleHref);
            // TODO(justinfagnani): use this.load()
            depsLoaded.push(this.loader.load(styleHref).then((content) => {
              this._content.set(styleHref, content);
              return {};
            }));
          }
        }
      }
    }
    const depsStrLoaded = Promise.all(depsLoaded)
          .then(function() {return depHrefs;})
          .catch(function(err) {throw err;});
    this.parsedDocuments[href] = parsed.ast;
    this.html[href] = new AnalyzedDocument({
        url: href,
        htmlLoaded: htmlLoaded,
        descriptor: metadataLoaded,
        dependencies: depHrefs,
        transitiveDependencies: depsStrLoaded
    });
    return this.html[href];
  };

  _processScripts(scripts: LocNode[], href: string) {
    var scriptPromises: Promise<DocumentDescriptor>[] = [];
    scripts.forEach((script) => {
      scriptPromises.push(this._processScript(script, href));
    });
    return Promise.all(scriptPromises).then(function(metadataList) {
      // TODO(ajo) remove this cast.
      var list: DocumentDescriptor[] = <any>metadataList;
      return list.reduce(reduceMetadata, EMPTY_METADATA);
    });
  };

  _processScript(script: LocNode, href: string):Promise<DocumentDescriptor> {
    const src = dom5.getAttribute(script, 'src');
    var parsedJs: DocumentDescriptor;
    if (!src) {
      try {
        parsedJs = jsParse((script.childNodes.length) ? script.childNodes[0].value : '');
      } catch (err) {
        // Figure out the correct line number for the error.
        var line = 0;
        var col = 0;
        if (script.__ownerDocument && script.__ownerDocument == href) {
          line = script.__locationDetail.line - 1;
          col = script.__locationDetail.column - 1;
        }
        line += err.lineNumber;
        col += err.column;
        var message = "Error parsing script in " + href + " at " + line + ":" + col;
        message += "\n" + err.stack;
        var fixedErr = <LocError>(new Error(message));
        fixedErr.location = {line: line, column: col};
        fixedErr.ownerDocument = script.__ownerDocument;
        return Promise.reject<DocumentDescriptor>(fixedErr);
      }
      if (parsedJs.elements) {
        parsedJs.elements.forEach((element) => {
          element.scriptElement = script;
          element.contentHref = href;
          this.elements.push(element);
          if (element.is in this.elementsByTagName) {
            console.warn('Ignoring duplicate element definition: ' + element.is);
          } else {
            this.elementsByTagName[element.is] = element;
          }
        });
      }
      if (parsedJs.features) {
        parsedJs.features.forEach(function(feature){
          feature.contentHref = href;
          feature.scriptElement = script;
        });
        this.features = this.features.concat(parsedJs.features);
      }
      if (parsedJs.behaviors) {
        parsedJs.behaviors.forEach((behavior) => {
          behavior.contentHref = href;
          this.behaviorsByName[behavior.is] = behavior;
          this.behaviorsByName[behavior.symbol] = behavior;
        });
        this.behaviors = this.behaviors.concat(parsedJs.behaviors);
      }
      if (!Object.hasOwnProperty.call(this.parsedScripts, href)) {
        this.parsedScripts[href] = [];
      }
      var scriptElement : LocNode;
      if (script.__ownerDocument && script.__ownerDocument == href) {
        scriptElement = script;
      }
      this.parsedScripts[href].push({
        ast: parsedJs.parsedScript,
        scriptElement: scriptElement
      });
      return Promise.resolve(parsedJs);
    }
    if (this.loader) {
      var resolvedSrc = url.resolve(href, src);
      // TODO(justinfagnani): use this.load()
      return this.loader.load(resolvedSrc).then((content) => {
        this._content.set(resolvedSrc, content);
        var scriptText = dom5.constructors.text(content);
        dom5.append(script, scriptText);
        dom5.removeAttribute(script, 'src');
        script.__hydrolysisInlined = src;
        return this._processScript(script, resolvedSrc);
      }).catch(function(err) {throw err;});
    } else {
      return Promise.resolve(EMPTY_METADATA);
    }
  };

  _dependenciesLoadedFor(href: string, root: string) {
    var found: {[href: string]: boolean} = {};
    if (root !== undefined) {
      found[root] = true;
    }
    return this._getDependencies(href, found).then((deps) => {
      var depPromises = deps.map((depHref) =>{
        return this.load(depHref).then((htmlMonomer) => {
          return htmlMonomer.descriptor;
        });
      });
      return Promise.all(depPromises);
    });
  };

  /**
   * List all the html dependencies for the document at `href`.
   * @param  {string}                   href      The href to get dependencies for.
   * @param  {Object.<string,boolean>=} found     An object keyed by URL of the
   *     already resolved dependencies.
   * @param  {boolean=}                transitive Whether to load transitive
   *     dependencies. Defaults to true.
   * @return {Array.<string>}  A list of all the html dependencies.
   */
  _getDependencies(href:string, found?:{[url:string]: boolean}, transitive?:boolean):Promise<string[]> {
    if (found === undefined) {
      found = {};
      found[href] = true;
    }
    if (transitive === undefined) {
      transitive = true;
    }
    var deps: string[] = [];
    return this.load(href).then((htmlMonomer) => {
      var transitiveDeps: Promise<string[]>[] = [];
      htmlMonomer.dependencies.forEach((depHref) => {
        if (found[depHref]) {
          return;
        }
        deps.push(depHref);
        found[depHref] = true;
        if (transitive) {
          transitiveDeps.push(this._getDependencies(depHref, found));
        }
      });
      return Promise.all(transitiveDeps);
    }).then(function(transitiveDeps) {
      var alldeps = transitiveDeps.reduce(function(a, b) {
        return a.concat(b);
      }, []).concat(deps);
      return alldeps;
    });
  };

  /**
   * Returns the elements defined in the folder containing `href`.
   * @param {string} href path to search.
   */
  elementsForFolder(href: string): ElementDescriptor[] {
    return this.elements.filter(function(element){
      return matchesDocumentFolder(element, href);
    });
  };

  /**
   * Returns the behaviors defined in the folder containing `href`.
   * @param {string} href path to search.
   * @return {Array.<BehaviorDescriptor>}
   */
  behaviorsForFolder(href:string):BehaviorDescriptor[] {
    return this.behaviors.filter(function(behavior){
      return matchesDocumentFolder(behavior, href);
    });
  };

  /**
   * Returns a Promise that resolves to a DocumentDescriptor of the transitive
   * import tree, which maintains the ordering of the HTML imports spec.
   *
   * @param {string} url the location of the HTML file to analyze
   * @return {Promise<DocumentDescriptor>}
   */
  async analyze(url: string): Promise<DocumentDescriptor> {
    if (this._documentDescriptors.has(url)) {
      return this._documentDescriptors.get(url);
    }

    let promise = (async () => {
      let document = await this.load(url);
      let localMetadata = await document.descriptor;
      // TODO(justinfagnani): remove casts with Typescript 2.0
      let dependencies = <DocumentDescriptor[]><any>(
        await Promise.all(document.dependencies.map((d) => this.analyze(d))));
      let parsedHtml = await document.htmlLoaded;

      let tranitiveMetadata: DocumentDescriptor = {
        elements: localMetadata.elements,
        features: localMetadata.features,
        behaviors: [],
        href: document.url,
        imports: dependencies,
        html: parsedHtml,
      };
      if (tranitiveMetadata.elements) {
        tranitiveMetadata.elements.forEach((element) => {
          attachDomModule(parsedHtml, element);
        });
      }
      return tranitiveMetadata;
    })();
    this._documentDescriptors.set(url, promise);
    return promise;
  };

  /** Annotates all loaded metadata with its documentation. */
  annotate() {
    if (this.features.length > 0) {
      var featureEl = docs.featureElement(this.features);
      this.elements.unshift(featureEl);
      this.elementsByTagName[featureEl.is] = featureEl;
    }
    var behaviorsByName = this.behaviorsByName;
    var elementHelper = (descriptor: ElementDescriptor) => {
      docs.annotateElement(descriptor, behaviorsByName);
    };
    this.elements.forEach(elementHelper);
    this.behaviors.forEach(elementHelper); // Same shape.
    this.behaviors.forEach((behavior) =>{
      if (behavior.is !== behavior.symbol && behavior.symbol) {
        this.behaviorsByName[behavior.symbol] = undefined;
      }
    });
  };

  /** Removes redundant properties from the collected descriptors. */
  clean() {
    this.elements.forEach(docs.cleanElement);
  };
};



/**
 * @private
 * @param {string} href
 * @return {function(string): boolean}
 */
function _defaultFilter(href:string) {
  // Everything up to the last `/` or `\`.
  var base = href.match(/^(.*?)[^\/\\]*$/)[1];
  return function(uri:string) {
    return uri.indexOf(base) !== 0;
  };
}

function matchesDocumentFolder(descriptor: ElementDescriptor, href: string) {
  if (!descriptor.contentHref) {
    return false;
  }
  var descriptorDoc = url.parse(descriptor.contentHref);
  if (!descriptorDoc || !descriptorDoc.pathname) {
    return false;
  }
  var searchDoc = url.parse(href);
  if (!searchDoc || !searchDoc.pathname) {
    return false;
  }
  var searchPath = searchDoc.pathname;
  var lastSlash = searchPath.lastIndexOf("/");
  if (lastSlash > 0) {
    searchPath = searchPath.slice(0, lastSlash);
  }
  return descriptorDoc.pathname.indexOf(searchPath) === 0;
}

// TODO(ajo): Refactor out of vulcanize into dom5.
var polymerExternalStyle = dom5.predicates.AND(
  dom5.predicates.hasTagName('link'),
  dom5.predicates.hasAttrValue('rel', 'import'),
  dom5.predicates.hasAttrValue('type', 'css')
);

var externalScript = dom5.predicates.AND(
  dom5.predicates.hasTagName('script'),
  dom5.predicates.hasAttr('src')
);

var isHtmlImportNode = dom5.predicates.AND(
  dom5.predicates.hasTagName('link'),
  dom5.predicates.hasAttrValue('rel', 'import'),
  dom5.predicates.NOT(
    dom5.predicates.hasAttrValue('type', 'css')
  )
);

function attachDomModule(parsedImport: ParsedImport, element: ElementDescriptor) {
  var domModules = parsedImport['dom-module'];
  for (const domModule of domModules) {
    if (dom5.getAttribute(domModule, 'id') === element.is) {
      element.domModule = domModule;
      return;
    }
  }
}
