import {DocumentDescriptor} from './ast/document-descriptor';
import {ParsedImport} from './parser/html-parser';

/**
 * The metadata of an entire HTML document, in promises.
 */
export class AnalyzedDocument {

  /**
   * The url of the document.
   */
  url: string;

  /**
   * The parsed representation of the doc. Use the `ast` property to get
   * the full `parse5` ast.
   */
  htmlLoaded: Promise<ParsedImport>;

  /**
   * Resolves to the list of this Document's transitive import dependencies.
   */
  transitiveDependencies: Promise<string[]>;

  /**
   * The direct dependencies of the document.
   */
  dependencies: string[];

  /**
   * Resolves to the list of this Document's import dependencies
   */
  descriptor: Promise<DocumentDescriptor>;

  constructor(init: AnalyzedDocumentInit) {
    this.url = init.url;
    this.htmlLoaded = init.htmlLoaded;
    this.transitiveDependencies = init.transitiveDependencies;
    this.dependencies = init.dependencies;
    this.descriptor = init.descriptor;
  }
}

export interface AnalyzedDocumentInit {

  /**
   * The url of the document.
   */
  url?: string;

  /**
   * The parsed representation of the doc. Use the `ast` property to get
   * the full `parse5` ast.
   */
  htmlLoaded?: Promise<ParsedImport>;

  /**
   * Resolves to the list of this Document's transitive import dependencies.
   */
  transitiveDependencies?: Promise<string[]>;

  /**
   * The direct dependencies of the document.
   */
  dependencies?: string[];

  /**
   * Resolves to the list of this Document's import dependencies
   */
  descriptor?: Promise<DocumentDescriptor>;
}
