(function() {
	"use strict";
	var templates = {};

	/**
	 * @const
	 * @enum {number}
	 * @private
	 */
	var ElementTypes = {
		ELEMENT_NODE: 1,
		TEXT_NODE: 3
	};

	/**
	 * @const
	 * @enum {number}
	 * @private
	 */
	var TemplateTypes = {
		VARIABLE: 0,
		TEMPLATE: 1,
		CONDITION: 2,
		IDENTITY: 3
	};

	/**
	 *  @constructor
	 *  @struct
	 *  @param {string} templ
	 */
	function Flint(templ) {
		this.requiredVars = [];
		this.templs = [];
		this.templTargets = [];
		this.requiredTempls = {};

		if (typeof templ === 'string' || templ instanceof String) {
			this.markup = copyNodesAsObjects((function() {
				var rootTemplElem = document.createElement("template");
				rootTemplElem.innerHTML = templ;
				if (rootTemplElem.content) {
					return rootTemplElem.content;
				} else {
					var frag = document.createDocumentFragment();
					for (var i = 0; i < rootTemplElem.childNodes.length; i++) {
						frag.appendChild(rootTemplElem.childNodes[i].cloneNode(true));
					}
					return frag;
				}
			})());
		} else if (templ instanceof DocumentFragment) {
			this.markup = copyNodesAsObjects(templ);
		} else if (templ instanceof Element && templ.content) {
			this.markup = copyNodesAsObjects(templ.content);
		} else if (templ instanceof Element) {
			this.markup = copyNodesAsObjects((function() {
				var rootTemplElem = document.createElement("template");
				if (rootTemplElem.content) {
					return rootTemplElem.content;
				} else {
					var frag = document.createDocumentFragment();
					for (var i = 0; i < templ.childNodes.length; i++) {
						frag.appendChild(templ.childNodes[i].cloneNode(true));
					}
					return frag;
				}
			})());
		}
		traverseChildren(this, this.markup);
		this.markup = new PseudoDoc(this.markup, false);

		return this;
	}

	/** @constructor */
	function RenderError(msg, templ, ctx) {
		this.template = templ;
		this.context = ctx;
		this.message = msg;
		return this;
	}

	RenderError.prototype = Error.prototype;

	Flint.prototype.render = function(ctx) {
		var missingVars = [];
		for (var i = 0; i < this.requiredVars.length; i++) {
			if (this.requiredVars[i] !== ".") {
				var varProgression = this.requiredVars[i].split(".");
				var root = ctx;
				for (var j = 0; j < varProgression.length; j++) {
					if (!varProgression[j] in root) {
						missingVars.push(varProgression.slice(0, j + 1).join(","));
					}
					root = root[varProgression[j]];
				}
			}
		}
		if (missingVars.length > 0) {
			if (missingVars.length === 1) {
				throw new RenderError("Context missing variable: " + missingVars[0], this, ctx);
			} else {
				throw new RenderError("Context missing variables: " + missingVars.join(", "), this, ctx);
			}
		}

		return this.markup.render(ctx);//objToHtml(cloneAndRender(this, this.markup, ctx));
	};

	Flint.prototype.partial = function(ctx) {
		for (var attr in ctx) {
			if (!ctx.hasOwnProperty(attr)) continue;
			var ind = this.requiredVars.indexOf(attr);
			if (ind !== -1) continue;
			this.requiredVars.splice(ind, 1);
		}
		this.markup.partial(ctx);
		return this;
	};

	function map(arr, func) {
		var collect = [];
		for (var i = 0, l = arr.length; i < l; i++) {
			collect.push(func(arr[i]));
		}
		return collect;
	}
	function each(arr, func) {
		for (var i = 0, l = arr.length; i < l; i++) {
			func(arr[i]);
		}
	}
	function all(arr, func) {
		var yes = true;
		for (var i = 0, l = arr.length; yes && i < l; i++) {
			yes = func(arr[i]);
		}
		return yes;
	}
	function any(arr, func) {
		var yes = false;
		for (var i = 0, l = arr.length; !yes && i < l; i++) {
			yes = func(arr[i]);
		}
		return yes;
	}

	function newNodeBasedOnType(node, create) {
		switch(node.nodeType) {
		case ElementTypes.ELEMENT_NODE:
			return new PseudoNode(node, create);
		case ElementTypes.TEXT_NODE:
			return new PseudoText(node, create);
		default:
			throw new Error("What are you?");
		}
	}

	var emptyArr = [];

	/** @constructor */
	function PseudoNode(src, create) {
		this.watchers = src.watchers ? src.watchers : create ? [] : emptyArr;
		this.nodeType = src.nodeType;
		this.localName = src.localName;
		this.attributes = map(src.attributes, function(attr) {
			return new PseudoAttr(attr, create);	
		});

		this.fullyRendered = false;

		if (src instanceof PseudoNode && src.static) {
			this.static = src.static.cloneNode(false);
		} else {
			var requiresRendering = any(this.attributes, function(attr) {
				return attr.watchers.length > 0;
			});
			if (!requiresRendering && !create) {
				var node = this.static = document.createElement(this.localName);
				each(this.attributes, function(attr) {
					node.setAttribute(attr.name, attr.value);
				});
			}
		}
		this.childNodes = src.childNodes.length === 0 ? (create ? emptyArr : []) : map(src.childNodes, function(child) {
			return newNodeBasedOnType(child, create);
		});

		if (this.childNodes.length == 0) {
			this.fullyRendered = true;
		} else {
			var allStatic = all(this.childNodes, function(child) {
				return child.fullyRendered;
			});
			if (allStatic) {
				this.fullyRendered = true;
				var parent = this.static;
				each(this.childNodes, function(child) {
					parent.appendChild(child.static);
				});
				this.childNodes = null;
				this.attributes = null;
			}
		}

		return this;
	}

	/** @constructor */
	function PseudoAttr(src, create) {
		this.watchers = src.watchers ? src.watchers : create ? [] : emptyArr;
		this.name = src.name;
		this.value = src.value;
		return this;
	}

	/** @constructor */
	function PseudoText(src, create) {
		if (src.static) {
			return src;
		}
		if (src instanceof Element) {
			var templDecls = getTemplDecls(src.nodeValue);
			if (templDecls.length === 0) {
				this.static = document.createTextNode(src.nodeValue);
				this.fullyRendered = true;
				return;
			}
		}
		this.watchers = src.watchers ? src.watchers : create ? [] : emptyArr;
		this.nodeValue = src.nodeValue;
		this.nodeType = src.nodeType;
		return this;
	}

	/** @constructor */
	function PseudoDoc(src, create) {
		this.watchers = emptyArr;
		this.nodeType = src.nodeType;
		this.childNodes = src.childNodes.length === 0 ? emptyArr : map(src.childNodes, function(child) {
			return newNodeBasedOnType(child, create);
		});
		var allStatic = all(this.childNodes, function(child) {
			return child.fullyRendered;
		});
		if (allStatic) {
			var doc = this.static = document.createDocumentFragment();
			each(this.childNodes, function(child) {
				doc.appendChild(child.static);
			});
			this.fullyStatic = true;
		}
		return this;
	}

	PseudoDoc.prototype.render = function(ctx) {
		if (this.static) {
			return this.static.cloneNode(true);
		}
		var doc = document.createDocumentFragment();
		each(this.childNodes, function(child) {
			doc.appendChild(child.render(ctx));
		});
		return doc;
	};

	PseudoText.prototype.render = function(ctx) {
		var ret = new PseudoText(this);
		each(ret.watchers, function(watcher) {
			watcher.render(ret, ctx);
		});
		return document.createTextNode(ret.nodeValue);
	};

	PseudoAttr.prototype.render = function(ctx) {
		var ret = new PseudoAttr(this);
		each(ret.watchers, function(watcher) {
			watcher.render(ret, ctx);
		});
		return ret;
	};
	
	PseudoNode.prototype.render = function(ctx) {
		var node;
		if (this.fullyRendered) {
			node = this.static.cloneNode(true);
			return node;
		} else if (this.static) {
			node = this.static.cloneNode(false);
		} else {
			node = document.createElement(this.localName);
			each(this.attributes, function(attr) {
				var newAttr = attr.render(ctx);
				node.setAttribute(newAttr.name, newAttr.value);
			});
		}
		each(this.childNodes, function(child) {
			node.appendChild(child.render(ctx));
		});
		return node;
	};

	PseudoAttr.prototype.addWatcher = PseudoNode.prototype.addWatcher = function(watcher) {
		this.watchers.push(watcher);
	};

	PseudoAttr.prototype.addWatcher = PseudoNode.prototype.addWatcher = function(watcher) {
		this.watchers.push(watcher);
	};

	PseudoAttr.prototype.addWatchers = PseudoNode.prototype.addWatchers = function(watchers) {
		this.watchers = this.watchers.concat(watchers);
	};

	/** @constructor */
	function Watcher(templ, func) {
		this.templ = templ;
		this.func = func;
	};

	Watcher.prototype = {
		render: function(node, ctx) {
			this.func(node, ctx);
		},
		partial: function(node, ctx) {
			if (ctx.hasOwnProperty(this.templ.name)) {
				this.render(node, ctx);
			}
		}
	};

	function objToHtml(obj) {
		var frag = document.createDocumentFragment();
		for (var i = 0; i < obj.childNodes.length; i++) {
			frag.appendChild(_objToHtml(obj.childNodes[i]));
		}
		return frag;
	}

	function _objToHtml(obj) {
		if (obj.nodeType === ElementTypes.TEXT_NODE) {
			return document.createTextNode(obj.nodeValue);
		}
		var node = document.createElement(obj.nodeName);
		for (var i = 0; i < obj.attributes.length; i++) {
			node.setAttribute(obj.attributes[i].name, obj.attributes[i].value);
		}
		for (var i = 0; i < obj.childNodes.length; i++) {
			node.appendChild(_objToHtml(obj.childNodes[i]));
		}
		return node;
	}

	function addUpdater(templ, name, node, func) {
		if (templ.requiredVars.indexOf(name) === -1) {
			templ.requiredVars.push(name);
		}
		node.watchers.push(new Watcher(templ, func));
	}

	var emptyChildNodes = [];
	function copyNodesAsObjects(node) {
		return new PseudoDoc(node, true);
	}

	/**
	 * @constructor
	 */
	function TemplDecl(decl) {
		this.decl = decl;
		var str = decl.replace(/^{{(.*)}}$/, "$1");
		if (str === ".") {
			this.type = TemplateTypes.IDENTITY;
			this.name = ".";
			this.resolver = null;
			return;
		}
		var parts = [];
		var currPart = "";
		var i = 0;
		while (i < str.length) {
			switch(str[i]) {
			default:
				currPart += str[i];
				break;
			case " ":
				parts.push(currPart);
				currPart = "";
				break;
			case '"':
			case "'":
				var startingQuote = str[i];
				currPart += str[i];
				i++;
				while (i < str.length && str[i] !== startingQuote) {
					currPart += str[i];
					i++;
				}
				if (i === str.length) {
					throw "Unterminated string literal in template! '" + decl + "'";
				}
			}
			i++;
		}
		parts.push(currPart);
		if (parts.length < 1) {
			throw "Nonsensical empty template.";
		}
		switch(parts[0].charAt(0)) {
		case ".":
			this.type = TemplateTypes.TEMPLATE;
			this.ctxHooks = [];
			break;
		case "?":
			this.type = TemplateTypes.CONDITION;
			break;
		default:
			this.type = TemplateTypes.VARIABLE;
			this.name = parts[0];
			this.resolver = parts[0].split(".");
			if (parts.length > 1) {
				throw "Extra paramters after variable in template declaration. '" + decl + "'";
			}
			break;
		}
	}

	TemplDecl.prototype = {
		render: function(str, ctx) {
			switch (this.type) {
			case TemplateTypes.IDENTITY:
				return ctx;
			case TemplateTypes.VARIABLE:
				var branch = ctx;
				for (var i = 0, l = this.resolver.length; i < l; i++) {
					branch = branch[this.resolver[i]];
				}
				return str.replace(this.decl, branch);
			case TemplateTypes.TEMPLATE:
				var subCtx = cloneObject(ctx);
				for (var i = 0; i < this.ctxHooks.length; i++) {
					subCtx = this.ctxHooks[i](subCtx);
				}
				return str.replace(this.decl, templates[this.name].render(subCtx));
			}
		}
	};

	function cloneObject(obj) {
		return obj;
	}

	function cloneAndRender(templ, obj, ctx) {
		var ret;
		if (typeof obj !== "object" || obj instanceof Array) {
			if (obj instanceof Array) {
				var newArr = [];
				for (var i = 0; i < obj.length; i++) {
					newArr.push(cloneAndRender(templ, obj[i], ctx));
				}
				ret = newArr;
			} else {
				ret = obj;
			}
		} else {
			ret = {};
			for (var attr in obj) {
				if (obj.hasOwnProperty(attr)) {
					ret[attr] = cloneAndRender(templ, obj[attr], ctx);
				}
			}
		}
		var nodeIndex = templ.templTargets.indexOf(obj);
		if (nodeIndex !== -1) {
			for (var i = 0; i < templ.templs[nodeIndex].length; i++) {
				templ.templs[nodeIndex][i](ret, ctx);
			}
		}
		return ret;
	}

	function traverseChildren(templ, elem) {
		if (elem.nodeType === ElementTypes.TEXT_NODE) {
			checkContent(templ, elem);
			return;
		}
		for (var i = 0, l = elem.childNodes.length; i < l; i++) {
			var child = elem.childNodes[i];
			switch(child.nodeType) {
			case ElementTypes.ELEMENT_NODE:
				checkAttrs(templ, child);
				traverseChildren(templ, child);
				break;
			case ElementTypes.TEXT_NODE:
				checkContent(templ, child);
				break;
			}
		}
	}

	function checkContent(templ, elem) {
		var text = elem.nodeValue;
		var templDecls = getTemplDecls(text);
		if (templDecls.length === 0) {
			elem.static = document.createTextNode(text);
			elem.fullyRendered = true;
			return;
		}
		for (var i = 0; i < templDecls.length; i++) {
			/*elem.watchers.push(new Watcher(templDecls[i], function(elem, ctx) {
				elem.nodeValue = templ.render(elem.nodeValue, ctx);
			}));*/
			addUpdater(templ, templDecls[i].name, elem, (function(templ) {
				return function(elem, ctx) {
					elem.nodeValue = templ.render(elem.nodeValue, ctx);
				};
			}(templDecls[i])));
		}
	}

	function checkAttrs(templ, elem) {
		var attrs = elem.attributes;
		for (var i = 0; i < attrs.length; i++) {
			var attr = attrs[i];
			if (hasTemplDecl(attr.name)) {
				updateAttrLive(templ, attr);
			} else {
				var attrVal = attr.value;
				if (hasTemplDecl(attrVal)) {
					updateAttr(templ, attr);
				}
			}
		}
	}

	function updateAttrLive(templ, attr) {
		var templDecls = getTemplDecls(attr.name);
		for (var i = 0; i < templDecls.length; i++) {
			addUpdater(templ, templDecls[i].name, attr, (function(templ) {
				return function(attr, val) {
					attr.name = templ.render(attr.name, val);
				}
			}(templDecls[i])));
		}

		templDecls = getTemplDecls(attr.value);
		for (var i = 0; i < templDecls.length; i++) {
			addUpdater(templ, templDecls[i].name, attr, (function(templ) {
				return function(attr, val) {
					attr.value = templ.render(attr.value, val);
				}
			}(templDecls[i])));
		}
	}
	
	function updateAttr(templ, attr) {
		var templDecls = getTemplDecls(attr.value);
		for (var i = 0; i < templDecls.length; i++) {
			addUpdater(templ, templDecls[i].name, attr, (function(templ) {
				return function(attr, ctx) {
					attr.value = templ.render(attr.value, ctx);
				}
			}(templDecls[i])));
		}
	}

	var templDecl = /{{([^}]+?)\s*}}/g;
	function hasTemplDecl(str) {
		return templDecl.test(str);
	}

	var templSplit = /({{[^}]+}})/g;
	function getTemplDecls(str) {
		var matches = str.match(templSplit);
		var ret = [];
		for (var i = 0; matches !== null && i < matches.length; i++) {
			ret.push(new TemplDecl(matches[i]));
		}
		return ret;
	}

	/**
	 * @namespace
	 */
	window["Flint"] = {
		"register": function(name, templ) {
			if (templates[name]) {
				throw "Template '" + name + "' already registered.";
			}
			templates[name] = new Flint(templ);
		},
		"create": function(templ) {
			return new Flint(templ);
		},
		"once": function(templ, ctx) {
			return new Flint(templ).render(ctx);
		}
	};
})();
