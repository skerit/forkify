var MJSON = require('./mjson'),
    stream = require('stream');

/**
 * Circular-JSON code:
 * Copyright (C) 2013 by WebReflection
 * Modified by Jelle De Loecker
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */
var safeStartWithSpecialCharRG,
    escapedSafeSpecialChar,
    safeSpecialCharRG,
    safeSpecialChar,
    specialCharRg,
    specialChar,
    getregex,
    FORKOBJ,
    iso8061;

specialChar = '~';
safeSpecialChar = '\\x' + ('0' + specialChar.charCodeAt(0).toString(16)).slice(-2);
escapedSafeSpecialChar = '\\' + safeSpecialChar;
specialCharRg = new RegExp(safeSpecialChar, 'g');
safeSpecialCharRG = new RegExp(escapedSafeSpecialChar, 'g');

safeStartWithSpecialCharRG = new RegExp('(?:^|([^\\\\]))' + escapedSafeSpecialChar);

iso8061 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/;
getregex = /^\/(.*)\/(.*)/;

FORKOBJ = {
	ForkError: {
		unDry: function unDry(obj) {
			var result = new Error(obj.message);
			result.stack = obj.stack;
			return result;
		}
	}
};

/**
 * Get the path from the given object
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Function}
 */
function objPath(obj, pathString) {

	var pieces,
	    result,
	    here,
	    key,
	    end,
	    i;

	if (typeof pathString !== 'string') {
		if (Array.isArray(pathString)) {
			pieces = pathString;
		} else {
			return;
		}
	} else {
		pieces = [];

		for (i = 1; i < arguments.length; i++) {
			pieces = pieces.concat(arguments[i].split('.'));
		}
	}

	here = obj;

	// Go over every piece in the path
	for (i = 0; i < pieces.length; i++) {

		// Get the current key
		key = pieces[i];

		if (here !== null && here !== undefined) {
			here = here[key];

			// Is this the final piece?
			end = ((i+1) == pieces.length);

			if (end) {
				result = here;
			}
		}
	}

	return result;
}

/**
 * Create a path in an object.
 * Example: my.special.object would create an object like
 * {my: {special: {object: {}}}}
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function setPath(obj, path, value, skipLastEntry) {

	var argLength = arguments.length,
	    pieces,
	    here,
	    key,
	    end,
	    i;

	if (typeof path !== 'string') {
		if (Array.isArray(path)) {
			pieces = path;
		} else {
			return;
		}
	} else {
		pieces = path.split('.');
	}

	// If no default end value is given, use a new object
	// Caution: undefined is also a valid end value,
	// so we check the arguments length for that
	if (typeof value == 'undefined' && argLength < 3) {
		value = {};
	}

	// Set out current position
	here = obj;

	for (i = 0; i < pieces.length; i++) {
		key = pieces[i];

		// Is this the final piece?
		end = ((i+1) == pieces.length);

		if (end) {

			// Only set the last entry if we don't want to skip it
			if (!skipLastEntry) {
				here[key] = value;
			}
		} else if (typeof here[key] != 'object' || here[key] === null) {
			here[key] = {};
		}

		here = here[key];
	}

	return obj;
}

/**
 * Generate a replacer function
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Function}
 */
function generateReplacer(root, replacer, buffers, streams) {

	var seenByConstructor,
	    constructorMap,
	    seenObjects,
	    seenMap,
	    isRoot,
	    chain,
	    isObj,
	    path,
	    last,
	    temp,
	    i;

	isObj = typeof root === 'object';
	isRoot = true;

	// Don't create a replacer if the root isn't an object
	if (isObj === false || root == null) {
		return;
	}

	seenByConstructor = {};
	constructorMap = {};

	chain = [];
	path = [];

	last = null;

	seenObjects = [];
	seenMap = [];

	return function dryReplacer(holder, key, value) {

		var jsonValue,
		    nameType,
		    valType,
		    len,
		    j;

		// Get the type of the value after possible `replacer` ran
		valType = typeof value;

		if (value != null && valType === 'object') {

			// Get the name of the constructor
			if (value.constructor) {
				nameType = value.constructor.name;
			} else {
				nameType = 'Object';
			}

			// Create the map if it doesn't exist yet
			if (seenByConstructor[nameType] == null) {
				seenByConstructor[nameType] = [];
				constructorMap[nameType] = [];
			}

			while (len = chain.length) {

				// If the current object at the end of the chain does not
				// match the current holder (this), move one up
				if (holder !== chain[len-1]) {
					chain.pop();
					path.pop();
				} else {
					break;
				}
			}

			// Now see if this object has been seen before
			if (seenByConstructor[nameType].length) {
				i = seenByConstructor[nameType].indexOf(value);
			} else {
				i = -1;
			}

			if (i < 0) {

				// Store the object in the seen array and return the index
				i = seenObjects.push(value) - 1;
				j = seenByConstructor[nameType].push(value) - 1;
				constructorMap[nameType][j] = i;

				// Key cannot contain specialChar but could be not a string
				if (!isRoot) {
					path.push(('' + key).replace(specialCharRg, safeSpecialChar));
				}

				seenMap[i] = specialChar + path.join(specialChar);

				if (value.constructor && value.constructor.name == 'RegExp') {
					value = {dry: 'regexp', value: value.toString()};
				} else if (value.constructor && value.constructor.name == 'Buffer') {
					value = {dry: 'buffer', index: buffers.push(value) - 1};
				} else if (typeof value.toDry === 'function') {
					value = value.toDry();
					value.dry = 'toDry';
					value.drypath = path.slice(0);
				} else if (value instanceof stream.Stream) {
					value = {dry: 'stream', index: streams.push(value) - 1};
				}
			} else {
				value = seenMap[constructorMap[nameType][i]];
			}
		} else {

			if (valType === 'string') {
				// Make sure the "special char" doesn't mess things up
				value = value.replace(safeSpecialChar, escapedSafeSpecialChar)
				             .replace(specialChar, safeSpecialChar);
			} else if (valType === 'number') {

				// Allow infinite values
				if (!isFinite(value)) {
					if (value > 0) {
						value = {dry: '+Infinity'};
					} else {
						value = {dry: '-Infinity'};
					}
				}
			}
		}

		isRoot = false;
		last = value;

		// Push the current object to the chain,
		// it is now the active item
		if (value != null & typeof value == 'object') {
			chain.push(value);
		}

		return value;
	};
};

/**
 * Generate reviver function
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Function}
 */
function generateReviver(reviver, undryPaths, buffers, streams) {

	return function dryReviver(key, value) {

		var valType = typeof value,
		    constructor,
		    temp;

		if (valType === 'string') {
			if (value.charAt(0) === specialChar) {
				return new String(value.slice(1));
			} else if (value.match(iso8061)) {
				return new Date(value);
			}
		} else if (value && valType == 'object' && value.dry != null) {

			if (value.dry == 'buffer') {
				return buffers[value.index];
			} else if (value.dry == 'stream') {
				return streams[value.index];
			} else if (value.dry == 'toDry') {

				constructor = objPath(GLOBAL, value.path);

				if (!constructor) {
					constructor = objPath(FORKOBJ, value.path);
				}

				// Undry this element, but don't put it in the parsed object yet
				if (constructor && typeof constructor.unDry === 'function') {
					value.undried = constructor.unDry(value.value);
				} else {
					value.undried = value.value;
				}

				undryPaths[value.drypath.join(specialChar)] = value;
			} else if (value.dry == 'regexp' && value.value) {
				return RegExp.apply(undefined, getregex.exec(value.value).slice(1));
			} else if (value.dry == '+Infinity') {
				return Infinity;
			} else if (value.dry == '-Infinity') {
				return -Infinity;
			}
		}

		if (valType === 'string') {
			value = value.replace(safeStartWithSpecialCharRG, '$1' + specialChar)
			             .replace(escapedSafeSpecialChar, safeSpecialChar);
		}

		if (reviver == null) {
			return value;
		}

		return reviver.call(this, key, value);
	};
};

/**
 * Regenerate an array
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Array}
 */
function regenerateArray(root, current, chain, retrieve, undryPaths) {

	var length = current.length,
	    i;

	for (i = 0; i < length; i++) {
		// Only regenerate if it's not in the chain
		if (chain.indexOf(current[i]) == -1) {
			current[i] = regenerate(root, current[i], chain, retrieve, undryPaths);
		}
	}

	return current;
};

/**
 * Regenerate an object
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Object}
 */
function regenerateObject(root, current, chain, retrieve, undryPaths) {

	var key;

	for (key in current) {
		if (current.hasOwnProperty(key)) {
			// Only regenerate if it's not in the cain
			if (chain.indexOf(current[key]) == -1) {
				current[key] = regenerate(root, current[key], chain, retrieve, undryPaths);
			}
		}
	}

	return current;
};

/**
 * Regenerate a value
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.3
 *
 * @return   {Mixed}
 */
function regenerate(root, current, chain, retrieve, undryPaths) {

	var temp,
	    i;

	chain.push(current);

	if (current != null && typeof current == 'object') {

		if (current.constructor.name == 'Buffer' || current instanceof stream.Stream) {
			chain.pop();
			return current;
		}

		if (Array.isArray(current)) {
			return regenerateArray(root, current, chain, retrieve, undryPaths);
		}

		if (current instanceof String) {

			if (current.length) {
				if (undryPaths[current]) {
					return undryPaths[current].undried;
				}

				if (retrieve.hasOwnProperty(current)) {
					temp = retrieve[current];
				} else {
					temp = retrieve[current] = retrieveFromPath(root, current.split(specialChar));
				}

				return temp;
			} else {
				return root;
			}
		}

		if (current instanceof Object) {
			return regenerateObject(root, current, chain, retrieve, undryPaths);
		}
	}

	chain.pop();

	return current;
};

/**
 * Retrieve from path.
 * Set the given value, but only if the containing object exists.
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Mixed}
 */
function retrieveFromPath(current, keys, value) {

	var length = keys.length,
	    prev,
	    key,
	    i;

	for (i = 0; i < length; i++) {

		// Normalize the key
		key = keys[i].replace(safeSpecialCharRG, specialChar);
		prev = current;

		if (current) {
			current = current[key];
		} else {
			return undefined;
		}
	}

	if (arguments.length === 3) {
		prev[key] = value;
		current = value;
	}

	return current;
};

/**
 * Dry it
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {String}
 */
module.exports.dry = function dry(value, replacer) {

	var buffers = [],
	    streams = [];

	return {
		string: MJSON.stringify(value, generateReplacer(value, replacer, buffers, streams)),
		buffers: buffers,
		streams: streams
	};
};

/**
 * Undry string
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Mixed}
 */
module.exports.undry = function undry(text, reviver) {

	var undryPaths = {},
	    retrieve = {},
	    buffers,
	    streams,
	    result,
	    path;

	if (typeof text == 'object') {
		streams = text.streams;
		buffers = text.buffers;
		text = text.string;
	}

	result = JSON.parse(text, generateReviver(reviver, undryPaths, buffers, streams));

	for (path in undryPaths) {
		undryPaths[path].undried = regenerate(result, undryPaths[path].undried, [], retrieve, undryPaths)
	}

	// Only now can we resolve paths
	result = regenerate(result, result, [], retrieve, undryPaths);

	// Now we can replace all the undried values
	for (path in undryPaths) {
		setPath(result, undryPaths[path].drypath, undryPaths[path].undried);
	}

	if (result.undried != null && result.dry == 'toDry') {
		return result.undried;
	}

	return result;
};