'use strict';

var rx_one = /^[\],:{}\s]*$/,
	rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,
	rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,
	rx_four = /(?:^|:|,)(?:\s*\[)+/g,
	rx_escapable = /[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
	rx_dangerous = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
	MJSON = {};

var meta,
    rep;

meta = {    // table of character substitutions
	'\b': '\\b',
	'\t': '\\t',
	'\n': '\\n',
	'\f': '\\f',
	'\r': '\\r',
	'"': '\\"',
	'\\': '\\\\'
};

function quote(string) {
	rx_escapable.lastIndex = 0;
	return rx_escapable.test(string) 
		? '"' + string.replace(rx_escapable, function (a) {
			var c = meta[a];
			return typeof c === 'string'
				? c
				: '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
		}) + '"' 
		: '"' + string + '"';
}

function str(key, holder) {

	var i,          // The loop counter.
		k,          // The member key.
		v,          // The member value.
		length,
		partial,
		value = holder[key];

	if (value && typeof value === 'object') {
		if (value.constructor && value.constructor.name == 'Buffer') {
			// Don't handle buffers
		} else if (typeof value.toJSON === 'function' && typeof value.toDry != 'function') {
			value = value.toJSON(key);
		}
	}

	// There will always be a replacer function
	value = rep(holder, key, value);

	switch (typeof value) {

		case 'object':
			if (value == null) return 'null';

			partial = [];

			if (Array.isArray(value)) {

				length = value.length;
				for (i = 0; i < length; i += 1) {
					partial[i] = str(i, value) || 'null';
				}

				v = partial.length === 0 ? '[]' : '[' + partial.join(',') + ']';
				return v;
			}

			for (k in value) {
				if (value.hasOwnProperty(k)) {
					v = str(k, value);
					if (v) {
						partial.push(quote(k) + ':' + v);
					}
				}
			}

			v = partial.length === 0 ? '{}' : '{' + partial.join(',') + '}';
			return v;

		case 'string':
			return quote(value);

		case 'number':
			return isFinite(value) ? String(value) : 'null';

		case 'boolean':
		case 'null':
			return String(value);
	}
}

/**
 * Stringify function, to be used with JSON-dry
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {Object}   value
 * @param    {Function} replacer
 */
MJSON.stringify = function stringify(value, replacer) {
	rep = replacer;
	return str('', {'': value});
};

module.exports = MJSON;