declare class TemplateInstanceBase extends
  Polymer.PropertyEffects(
  Polymer.Element) {
  _addEventListenerToNode(node: any, eventName: any, handler: any): any;

  /**
   * Overrides default property-effects implementation to intercept
   * textContent bindings while children are "hidden" and cache in
   * private storage for later retrieval.
   */
  _setUnmanagedPropertyToNode(node: any, prop: any, value: any): any;

  /**
   * Configure the given `props` by calling `_setPendingProperty`. Also
   * sets any properties stored in `__hostProps`.
   */
  _configureProperties(props: Object|null): any;

  /**
   * Forwards a host property to this instance.  This method should be
   * called on instances from the `options.forwardHostProp` callback
   * to propagate changes of host properties to each instance.
   * 
   * Note this method enqueues the change, which are flushed as a batch.
   */
  forwardHostProp(prop: string, value: any): any;

  /**
   * Shows or hides the template instance top level child elements. For
   * text nodes, `textContent` is removed while "hidden" and replaced when
   * "shown."
   */
  _showHideChildren(hide: boolean): any;
}

declare namespace Polymer {

  namespace Templatize {


    /**
     * Returns an anonymous `Polymer.PropertyEffects` class bound to the
     * `<template>` provided.  Instancing the class will result in the
     * template being stamped into document fragment stored as the instance's
     * `root` property, after which it can be appended to the DOM.
     * 
     * Templates may utilize all Polymer data-binding features as well as
     * declarative event listeners.  Event listeners and inline computing
     * functions in the template will be called on the host of the template.
     * 
     * The constructor returned takes a single argument dictionary of initial
     * property values to propagate into template bindings.  Additionally
     * host properties can be forwarded in, and instance properties can be
     * notified out by providing optional callbacks in the `options` dictionary.
     * 
     * Valid configuration in `options` are as follows:
     * 
     * - `forwardHostProp(property, value)`: Called when a property referenced
     *   in the template changed on the template's host. As this library does
     *   not retain references to templates instanced by the user, it is the
     *   templatize owner's responsibility to forward host property changes into
     *   user-stamped instances.  The `instance.forwardHostProp(property, value)`
     *    method on the generated class should be called to forward host
     *   properties into the template to prevent unnecessary property-changed
     *   notifications. Any properties referenced in the template that are not
     *   defined in `instanceProps` will be notified up to the template's host
     *   automatically.
     * - `instanceProps`: Dictionary of property names that will be added
     *   to the instance by the templatize owner.  These properties shadow any
     *   host properties, and changes within the template to these properties
     *   will result in `notifyInstanceProp` being called.
     * - `mutableData`: When `true`, the generated class will skip strict
     *   dirty-checking for objects and arrays (always consider them to be
     *   "dirty").
     * - `notifyInstanceProp(instance, property, value)`: Called when
     *   an instance property changes.  Users may choose to call `notifyPath`
     *   on e.g. the owner to notify the change.
     * - `parentModel`: When `true`, events handled by declarative event listeners
     *   (`on-event="handler"`) will be decorated with a `model` property pointing
     *   to the template instance that stamped it.  It will also be returned
     *   from `instance.parentModel` in cases where template instance nesting
     *   causes an inner model to shadow an outer model.
     * 
     * Note that the class returned from `templatize` is generated only once
     * for a given `<template>` using `options` from the first call for that
     * template, and the cached class is returned for all subsequent calls to
     * `templatize` for that template.  As such, `options` callbacks should not
     * close over owner-specific properties since only the first `options` is
     * used; rather, callbacks are called bound to the `owner`, and so context
     * needed from the callbacks (such as references to `instances` stamped)
     * should be stored on the `owner` such that they can be retrieved via `this`.
     */
    function templatize(template: HTMLTemplateElement, owner: Polymer_PropertyEffects, options?: Object|null): () => any;


    /**
     * Returns the template "model" associated with a given element, which
     * serves as the binding scope for the template instance the element is
     * contained in. A template model is an instance of
     * `TemplateInstanceBase`, and should be used to manipulate data
     * associated with this template instance.
     * 
     * Example:
     * 
     *   let model = modelForElement(el);
     *   if (model.index < 10) {
     *     model.set('item.checked', true);
     *   }
     */
    function modelForElement(template: HTMLTemplateElement|null, node: Node|null): TemplateInstanceBase|null;
  }
}
